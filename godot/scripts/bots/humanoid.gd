extends Node3D
## Physically simulated human: 15 rigid body parts on Generic6DOF joints with
## anatomical angle limits. Every joint has a "muscle" (PD torque controller)
## that pulls the child segment towards a target pose; overall muscle tone
## scales with consciousness. A balance assist (support force + upright
## torque) keeps a conscious body standing and walking; injuries, shock and
## stagger take it away, so the body falls and stays a real ragdoll.

const Sfx = preload("res://scripts/audio/sfx.gd")
const BotAI = preload("res://scripts/bots/bot_ai.gd")
const Tex = preload("res://scripts/world/textures.gd")
const SoftHead = preload("res://scripts/bots/voxel_head.gd")
const ClothShader = preload("res://shaders/cloth.gdshader")
const SkinShader = preload("res://shaders/skin_blood.gdshader")
const BodyBlood = preload("res://scripts/fx/body_blood.gd")
const Slicer = preload("res://scripts/fx/slicer.gd")
const Guts = preload("res://scripts/fx/guts.gd")
const FleshWounds = preload("res://scripts/fx/flesh_wounds.gd")
const Shape = preload("res://scripts/weapons/shape.gd")

const G := 9.81
const VECTOR3_AXIS_X := Vector3.AXIS_X
const VECTOR3_AXIS_Y := Vector3.AXIS_Y
const VECTOR3_AXIS_Z := Vector3.AXIS_Z
const PARAM_VEL := PhysicsServer3D.G6DOF_JOINT_ANGULAR_MOTOR_TARGET_VELOCITY
const PARAM_FORCE := PhysicsServer3D.G6DOF_JOINT_ANGULAR_MOTOR_FORCE_LIMIT
const BLOOD_MAX := 5000.0
var _head_wound := Vector3.INF   # where a shot to the head went in (head space)
const HEADSHOT_SPASM := 1.5
var CUFF_UPPER := Vector3(-0.2, 1.2, -0.6)
var CUFF_FORE := Vector3(0.8, 0.0, 0.0)
const CUFF_CHAIN := 0.08         # most the cuffed wrists can be apart (m)     # s the body draws in after a shot to the brain, then goes slack

enum Posture { STAND, CROUCH, HANDS_UP, COVER_HEAD, AIM, KNEEL, SQUAT, SIT }

var bot_seed := 0
var rng := RandomNumberGenerator.new()
var scale_factor := 1.0

# --- Body -----------------------------------------------------------------------
var parts: Array[RigidBody3D] = []
var part_index := {}
var _parent: PackedInt32Array = []
var _omega: PackedFloat32Array = []
var _max_torque: PackedFloat32Array = []
var _inertia: Array[Vector3] = []   # subtree inertia about the joint, per local axis
var _icm: Array[Vector3] = []       # own principal inertia about the centre of mass
var _target: Array[Vector3] = []     # target joint euler per part (YXZ), relative to parent
var _weak: PackedFloat32Array = []   # per-part muscle weakness from injuries
var _hit_weak: PackedFloat32Array = []   # per-part muscle knocked out by a hit just now (recovers)
var _joint_rid: Array[RID] = []
var _motor_limit: PackedFloat32Array = []
var _arm: PackedByteArray = []        # 1 for arm segments (keep a little tone when limp)
var total_mass := 0.0
var stand_height := 0.98

var pelvis: RigidBody3D
var chest: RigidBody3D
var head: RigidBody3D

# --- Control inputs (written by the AI) ------------------------------------------
var move_velocity := Vector3.ZERO
var facing := Vector3.FORWARD
var look_target := Vector3.ZERO
var has_look_target := false
var posture := Posture.STAND
var clutch_part := ""

# --- State ---------------------------------------------------------------------
var alive := true
var conscious := true
var fallen := false
var tone := 1.0
var support := 1.0
var blood := BLOOD_MAX
var bleed_rate := 0.0
var shock := 0.0
var pain := 0.0
var leg_health := {"l": 1.0, "r": 1.0}
var arm_health := {"l": 1.0, "r": 1.0}
var brain_dead := false
## Playing dead: drops and lies limp on purpose (still conscious).
var feign := false
## Weapon picked up off the ground (Node3D model in the right hand) and its kind.
var weapon: Node3D
var weapon_kind := ""
var weapon_item := ""           # the thing it is, to drop again (a revolver is used as a pistol)

var _phase := 0.0
var _stagger := 0.0
var _flinch := 0.0
var _flinch_dir := Vector3.ZERO
var _stumble := 0.0          # stumbling after a hard hit (1 = just hit)
var _stumble_dir := Vector3.ZERO
var _fallen_time := 0.0
var _getup := 0.0
var _getup_delay := 2.0
var _death_t := -1.0
var _death_kind := ""
var _time := 0.0
var _ray_exclude: Array[RID] = []
var ai: Node

# Materials per bot.
var _skin: ShaderMaterial
var skin_color := Color(0.8, 0.62, 0.5)
var blood_map: RefCounted = null     # the blood on him (body_blood.gd), made when first needed
var burning := 0.0                   # seconds of fire left on him
var burnt := 0.0                     # how long he has burnt, all told
var _burn_fx: Array = []
var _shirt: Material
var _pants: Material
var _shoes: StandardMaterial3D
var _hair: StandardMaterial3D
var _long_sleeves := false
var _has_hair := false
## What he wears: "casual", "suit", "hoodie", "tracksuit", "jacket".
var outfit := "casual"
var _tee: Material                 # the shirt under a jacket, the suit's white shirt
var _eye_mat: StandardMaterial3D
var _extra_cloth: Array = []       # more cloth the blood on him shows in
var _head_meshes: Array[MeshInstance3D] = []   # replaced by the soft head once it is hit
var _face_eyes: Array[MeshInstance3D] = []
var _face_brows: Array[MeshInstance3D] = []
var _face_mouth: MeshInstance3D
var _anger := 0.0                  # what the face shows, 0..1 each
var _fright := 0.0
var _sad := 0.0
var _hurt := 0.0
var sad_until := -1.0               # grief (someone he saw die, a lost game)
var _face_sent4 := Vector4(-1, -1, -1, -1)
var angry_until := -1.0            # set when he says something nasty (chatter.gd)
var soft_head: Node
## Set when this body is the player's own ragdoll: hits go to the player.
var player_owner: Node = null
## Player ragdoll: the pose the body was in when it went limp (muscles keep a
## fading hold on it instead of snapping to a rest pose), and where the
## conscious player turns the head (yaw, pitch; neck limits apply).
var _held: Array[Vector3] = []
var head_look := Vector2.ZERO
## Handcuffed: wrists together behind the back.
var cuffed := false
var wave := 0.0                     # waving hello (bot_ai.gesture_seen)
## Being cuffed: the arms are put behind the back first (full strength), the
## cuffs go on after.
var cuff_prep := false
var _cuff_meshes: Array[Node3D] = []
var _chain: MultiMeshInstance3D
var _chain_p := PackedVector3Array()   # the chain's links, a little rope (Verlet)
var _chain_q := PackedVector3Array()
## World points the hands reach for (a gun's grip and forend). INF = free.
var hand_goal := {"r": Vector3.INF, "l": Vector3.INF}


func spawn(pos: Vector3, yaw: float, owner_player: Node = null) -> void:
	rng.seed = bot_seed
	scale_factor = 1.0 if owner_player else rng.randf_range(0.93, 1.06)
	global_transform = Transform3D(Basis(Vector3.UP, yaw), pos)
	facing = -global_basis.z
	_make_materials()
	_build_body()
	if owner_player:
		# The player's own body: no mind of its own, and no head to see from inside.
		player_owner = owner_player
		for c in head.get_children():
			if c is MeshInstance3D:
				(c as MeshInstance3D).visible = false
		return
	ai = BotAI.new()
	ai.name = "AI"
	add_child(ai)
	ai.setup(self, rng.randi())
	# The head is a destructible volume from the start, so the very first hit
	# already deforms it.
	soft_head = SoftHead.new()
	soft_head.name = "Head"
	add_child(soft_head)
	soft_head.setup(self)
	soft_head.build()


# --- Construction ---------------------------------------------------------------------

func _make_materials() -> void:
	var skins := [Color(0.93, 0.78, 0.67), Color(0.82, 0.63, 0.5), Color(0.62, 0.44, 0.32), Color(0.42, 0.29, 0.21), Color(0.96, 0.84, 0.74)]
	skin_color = skins[rng.randi() % skins.size()]
	_skin = ShaderMaterial.new()
	_skin.shader = SkinShader
	_skin.set_shader_parameter("albedo", skin_color)
	_skin.set_shader_parameter("rough", 0.58)

	var r := rng.randf()
	if OS.get_environment("OUTFIT") != "":           # (dev: everyone in one outfit)
		r = {"casual": 0.1, "suit": 0.4, "hoodie": 0.6, "tracksuit": 0.8, "jacket": 0.9}.get(OS.get_environment("OUTFIT"), r)
	if has_meta("outfit"):                              # (dressed for the part: the judge)
		r = {"casual": 0.1, "suit": 0.4, "hoodie": 0.6, "tracksuit": 0.8, "jacket": 0.9}.get(get_meta("outfit"), r)
	outfit = "casual" if r < 0.34 else "suit" if r < 0.52 else "hoodie" if r < 0.7 else "tracksuit" if r < 0.85 else "jacket"
	var shirts := [Color(0.72, 0.72, 0.7), Color(0.16, 0.2, 0.3), Color(0.35, 0.12, 0.1), Color(0.22, 0.3, 0.2),
			Color(0.1, 0.1, 0.1), Color(0.55, 0.5, 0.38), Color(0.4, 0.42, 0.46)]
	var pants := [Color(0.16, 0.2, 0.3), Color(0.12, 0.12, 0.13), Color(0.35, 0.31, 0.22), Color(0.26, 0.27, 0.25)]
	var shoe_cols := [Color(0.08, 0.07, 0.07), Color(0.25, 0.18, 0.12), Color(0.8, 0.8, 0.78)]
	var shoe_rough := 0.7
	match outfit:
		"suit":
			# Jacket and trousers of one cloth, a white shirt, black shoes.
			var cloth: Color = [Color(0.08, 0.085, 0.1), Color(0.1, 0.12, 0.2), Color(0.2, 0.2, 0.21), Color(0.18, 0.14, 0.11)][rng.randi() % 4]
			_shirt = _fabric(cloth, 0.8)
			_pants = _fabric(cloth.darkened(0.08), 0.82)
			_tee = _fabric(Color(0.9, 0.9, 0.88), 0.85)
			_long_sleeves = true
			shoe_cols = [Color(0.03, 0.03, 0.03), Color(0.14, 0.07, 0.04)]
			shoe_rough = 0.3
		"hoodie":
			_shirt = _fabric([Color(0.3, 0.3, 0.32), Color(0.1, 0.1, 0.11), Color(0.35, 0.1, 0.1), Color(0.12, 0.2, 0.32),
					Color(0.25, 0.3, 0.2)][rng.randi() % 5], 0.97)
			_pants = _fabric(pants[rng.randi() % pants.size()], 0.95)
			_long_sleeves = true
		"tracksuit":
			# The same colour top and bottom, white stripes down the sides.
			var ts: Color = [Color(0.08, 0.1, 0.22), Color(0.07, 0.07, 0.08), Color(0.4, 0.06, 0.06), Color(0.08, 0.25, 0.14)][rng.randi() % 4]
			_shirt = _fabric(ts, 0.7)
			_pants = _fabric(ts, 0.7)
			_tee = _fabric(Color(0.92, 0.92, 0.9), 0.7)
			_long_sleeves = true
			shoe_cols = [Color(0.85, 0.85, 0.83), Color(0.1, 0.1, 0.1)]
		"jacket":
			# Leather or a bomber, open over a T-shirt.
			_shirt = _fabric([Color(0.07, 0.05, 0.04), Color(0.2, 0.12, 0.07), Color(0.14, 0.17, 0.12), Color(0.06, 0.06, 0.08)][rng.randi() % 4], 0.55)
			_pants = _fabric(pants[rng.randi() % pants.size()], 0.95)
			_tee = _fabric(shirts[rng.randi() % shirts.size()], 0.92)
			_long_sleeves = true
		_:
			_shirt = _fabric(shirts[rng.randi() % shirts.size()], 0.92)
			_pants = _fabric(pants[rng.randi() % pants.size()], 0.95)
			_long_sleeves = rng.randf() < 0.45
	if _tee:
		_extra_cloth.append(_tee)
	_shoes = StandardMaterial3D.new()
	_shoes.albedo_color = shoe_cols[rng.randi() % shoe_cols.size()]
	_shoes.roughness = shoe_rough
	_hair = StandardMaterial3D.new()
	_hair.albedo_color = [Color(0.05, 0.04, 0.035), Color(0.07, 0.05, 0.04), Color(0.2, 0.13, 0.07), Color(0.45, 0.33, 0.2),
			Color(0.62, 0.5, 0.3), Color(0.5, 0.5, 0.5), Color(0.45, 0.2, 0.08)][rng.randi() % 7]
	_hair.roughness = 0.85
	# (the eyes stay dark whatever the hair)
	_eye_mat = StandardMaterial3D.new()
	_eye_mat.albedo_color = Color(0.04, 0.035, 0.03)
	_eye_mat.roughness = 0.3


## Clothes (shaders/cloth.gdshader).
func _fabric(color: Color, rough: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = ClothShader
	m.set_shader_parameter("albedo", color)
	m.set_shader_parameter("rough", rough)
	m.set_shader_parameter("skin", skin_color)
	m.set_shader_parameter("weave", Tex.fabric_normal())
	return m


## Adds one body part. Positions are in the standing rest pose (feet at y=0,
## facing -Z, right side = +X), before scaling.
func _add_part(part_name: String, parent_name: String, center: Vector3, shape: Shape3D, shape_rot: Vector3,
		mass: float, joint: Vector3, lo: Vector3, hi: Vector3, omega: float, max_torque: float) -> void:
	var s := scale_factor
	var rb := RigidBody3D.new()
	rb.name = part_name
	rb.mass = mass * s * s * s
	rb.collision_layer = Game.LAYER_BOTS
	rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_PLAYER
	rb.can_sleep = false
	rb.linear_damp = 0.05
	rb.angular_damp = 0.6
	var pm := PhysicsMaterial.new()
	pm.friction = 0.85
	pm.bounce = 0.0
	rb.physics_material_override = pm
	rb.set_meta("humanoid", self)
	rb.set_meta("part", part_name)
	rb.set_meta("rest_pos", center * scale_factor)
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.rotation = shape_rot
	rb.add_child(cs)
	rb.position = center * s
	add_child(rb)
	_ray_exclude.append(rb.get_rid())

	var idx := parts.size()
	parts.append(rb)
	part_index[part_name] = idx
	_parent.append(part_index[parent_name] if parent_name != "" else -1)
	_omega.append(omega)
	_max_torque.append(max_torque * s * s * s)
	_target.append(Vector3.ZERO)
	_weak.append(1.0)
	_hit_weak.append(1.0)
	_joint_rid.append(RID())
	_motor_limit.append(-1.0)
	_arm.append(1 if part_name.begins_with("upper_arm") or part_name.begins_with("forearm") or part_name.begins_with("hand") else 0)
	_inertia.append(Vector3.ZERO)
	_icm.append(_shape_inertia(shape, shape_rot, rb.mass))
	total_mass += rb.mass

	if parent_name != "":
		var j := Generic6DOFJoint3D.new()
		j.name = "J_" + part_name
		j.position = joint * s
		add_child(j)
		j.node_a = j.get_path_to(parts[part_index[parent_name]])
		j.node_b = j.get_path_to(rb)
		# Jolt measures 6DOF angles with the opposite sign to the pose
		# convention used here (child relative to parent), so flip limits.
		for axis in 3:
			_set_axis_limit(j, axis, -hi[axis], -lo[axis])
		j.set_flag_x(Generic6DOFJoint3D.FLAG_ENABLE_MOTOR, true)
		j.set_flag_y(Generic6DOFJoint3D.FLAG_ENABLE_MOTOR, true)
		j.set_flag_z(Generic6DOFJoint3D.FLAG_ENABLE_MOTOR, true)
		_joint_rid[idx] = j.get_rid()
		rb.set_meta("joint_pos", joint * s)


func _shape_inertia(shape: Shape3D, rot: Vector3, m: float) -> Vector3:
	var i := Vector3.ONE * m * 0.001
	if shape is CapsuleShape3D:
		var r: float = shape.radius
		var h: float = shape.height
		var along := m * r * r * 0.5
		var across := m * (3.0 * r * r + h * h) / 12.0
		i = Vector3(along, across, across) if absf(rot.z) > 0.1 else Vector3(across, along, across)
	elif shape is BoxShape3D:
		var e: Vector3 = shape.size
		i = Vector3(e.y * e.y + e.z * e.z, e.x * e.x + e.z * e.z, e.x * e.x + e.y * e.y) * m / 12.0
	return i


func _set_axis_limit(j: Generic6DOFJoint3D, axis: int, lo_v: float, hi_v: float) -> void:
	match axis:
		0:
			j.set_flag_x(Generic6DOFJoint3D.FLAG_ENABLE_ANGULAR_LIMIT, true)
			j.set_param_x(Generic6DOFJoint3D.PARAM_ANGULAR_LOWER_LIMIT, lo_v)
			j.set_param_x(Generic6DOFJoint3D.PARAM_ANGULAR_UPPER_LIMIT, hi_v)
		1:
			j.set_flag_y(Generic6DOFJoint3D.FLAG_ENABLE_ANGULAR_LIMIT, true)
			j.set_param_y(Generic6DOFJoint3D.PARAM_ANGULAR_LOWER_LIMIT, lo_v)
			j.set_param_y(Generic6DOFJoint3D.PARAM_ANGULAR_UPPER_LIMIT, hi_v)
		2:
			j.set_flag_z(Generic6DOFJoint3D.FLAG_ENABLE_ANGULAR_LIMIT, true)
			j.set_param_z(Generic6DOFJoint3D.PARAM_ANGULAR_LOWER_LIMIT, lo_v)
			j.set_param_z(Generic6DOFJoint3D.PARAM_ANGULAR_UPPER_LIMIT, hi_v)


func _capsule(radius: float, height: float) -> CapsuleShape3D:
	var c := CapsuleShape3D.new()
	c.radius = radius * scale_factor
	c.height = height * scale_factor
	return c


func _boxs(size: Vector3) -> BoxShape3D:
	var b := BoxShape3D.new()
	b.size = size * scale_factor
	return b


func _build_body() -> void:
	var along_x := Vector3(0, 0, PI * 0.5)
	var none := Vector3.ZERO
	# Torso and head.
	_add_part("pelvis", "", Vector3(0, 0.97, 0), _capsule(0.125, 0.34), along_x, 10.5, none, none, none, 0.0, 0.0)
	_add_part("abdomen", "pelvis", Vector3(0, 1.14, 0), _capsule(0.115, 0.3), along_x, 10.3,
			Vector3(0, 1.05, 0), Vector3(-0.55, -0.45, -0.35), Vector3(0.3, 0.45, 0.35), 17.0, 380.0)
	_add_part("chest", "abdomen", Vector3(0, 1.36, 0), _capsule(0.14, 0.36), along_x, 16.0,
			Vector3(0, 1.245, 0), Vector3(-0.45, -0.4, -0.3), Vector3(0.3, 0.4, 0.3), 17.0, 380.0)
	_add_part("head", "chest", Vector3(0, 1.665, -0.01), _capsule(0.1, 0.26), none, 6.0,
			Vector3(0, 1.53, 0), Vector3(-0.8, -1.1, -0.5), Vector3(0.65, 1.1, 0.5), 15.0, 70.0)
	# Limbs, right (+X) then left (-X). Left limits are mirrored on Y/Z.
	for side in ["r", "l"]:
		var sx := 1.0 if side == "r" else -1.0
		var m := func(lo: Vector3, hi: Vector3, want_hi: bool) -> Vector3:
			if sx > 0.0:
				return hi if want_hi else lo
			var src := lo if want_hi else hi
			var other := hi if want_hi else lo
			return Vector3(other.x, -src.y, -src.z)
		var arm_lo := Vector3(-0.9, -1.3, -0.7)
		var arm_hi := Vector3(2.8, 1.3, 2.6)
		_add_part("upper_arm_" + side, "chest", Vector3(0.25 * sx, 1.3, 0), _capsule(0.052, 0.3), none, 2.1,
				Vector3(0.22 * sx, 1.43, 0), m.call(arm_lo, arm_hi, false), m.call(arm_lo, arm_hi, true), 14.0, 130.0)
		var fa_lo := Vector3(0.0, -1.3, 0.0)
		var fa_hi := Vector3(2.5, 1.3, 0.0)
		_add_part("forearm_" + side, "upper_arm_" + side, Vector3(0.25 * sx, 1.02, 0), _capsule(0.043, 0.28), none, 1.2,
				Vector3(0.25 * sx, 1.155, 0), m.call(fa_lo, fa_hi, false), m.call(fa_lo, fa_hi, true), 12.0, 80.0)
		# (a wrist bends only so far, and the light hand is held firmly:
		# with a loose one it whipped about at the end of every swing)
		var h_lo := Vector3(-0.6, -0.1, -0.25)
		var h_hi := Vector3(0.6, 0.1, 0.3)
		_add_part("hand_" + side, "forearm_" + side, Vector3(0.25 * sx, 0.79, -0.005), _boxs(Vector3(0.05, 0.17, 0.09)), none, 0.55,
				Vector3(0.25 * sx, 0.88, 0), m.call(h_lo, h_hi, false), m.call(h_lo, h_hi, true), 11.0, 32.0)
		parts[part_index["hand_" + side]].angular_damp = 4.0
		parts[part_index["forearm_" + side]].angular_damp = 1.5
		var hip_lo := Vector3(-0.45, -0.6, -0.35)
		var hip_hi := Vector3(2.1, 0.6, 0.9)
		_add_part("thigh_" + side, "pelvis", Vector3(0.1 * sx, 0.72, 0), _capsule(0.077, 0.44), none, 7.4,
				Vector3(0.1 * sx, 0.92, 0), m.call(hip_lo, hip_hi, false), m.call(hip_lo, hip_hi, true), 18.0, 480.0)
		_add_part("shin_" + side, "thigh_" + side, Vector3(0.1 * sx, 0.29, 0), _capsule(0.056, 0.44), none, 3.45,
				Vector3(0.1 * sx, 0.505, 0), Vector3(-2.5, 0, 0), Vector3(0, 0, 0), 18.0, 380.0)
		var an_lo := Vector3(-0.75, -0.15, -0.25)
		var an_hi := Vector3(0.65, 0.15, 0.25)     # (a deep squat needs the ankle well bent up)
		_add_part("foot_" + side, "shin_" + side, Vector3(0.1 * sx, 0.04, -0.05), _boxs(Vector3(0.095, 0.075, 0.25)), none, 1.07,
				Vector3(0.1 * sx, 0.08, 0), m.call(an_lo, an_hi, false), m.call(an_lo, an_hi, true), 14.0, 140.0)

	pelvis = parts[part_index["pelvis"]]
	chest = parts[part_index["chest"]]
	head = parts[part_index["head"]]
	stand_height = 0.975 * scale_factor
	# Folded up (squatting, kneeling, curled) the arms lie on the legs and
	# the heels under the seat: those pairs touching would have the muscles
	# forever pushing against the body's own collision - a constant tremble.
	var legs := ["thigh_r", "thigh_l", "shin_r", "shin_l"]
	for side in ["r", "l"]:
		for arm in ["forearm_", "hand_", "upper_arm_"]:
			for leg in legs:
				parts[part_index[arm + side]].add_collision_exception_with(parts[part_index[leg]])
		for other in ["thigh_r", "thigh_l", "pelvis"]:
			parts[part_index["foot_" + side]].add_collision_exception_with(parts[part_index[other]])
		parts[part_index["shin_" + side]].add_collision_exception_with(pelvis)
	_compute_inertia()
	_build_visuals()


## Effective inertia of each joint's subtree about the joint, used to make
## muscle stiffness roughly independent of limb size.
func _compute_inertia() -> void:
	for i in parts.size():
		if _parent[i] < 0:
			continue
		var jp: Vector3 = parts[i].get_meta("joint_pos")
		var total := Vector3.ZERO
		for k in parts.size():
			if _is_descendant(k, i):
				var d := parts[k].position - jp
				var m := parts[k].mass
				total += _icm[k] + m * Vector3(d.y * d.y + d.z * d.z, d.x * d.x + d.z * d.z, d.x * d.x + d.y * d.y)
		_inertia[i] = total


func _is_descendant(k: int, ancestor: int) -> bool:
	var c := k
	while c >= 0:
		if c == ancestor:
			return true
		c = _parent[c]
	return false


# --- Visuals -------------------------------------------------------------------------

func _mesh(parent: Node3D, mesh: Mesh, mat: Material, pos := Vector3.ZERO, rot := Vector3.ZERO, scl := Vector3.ONE) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos * scale_factor
	mi.rotation = rot
	mi.scale = scl
	mi.layers = 2
	# Small bits (eyes, brows, ears, nose, fingers) add nothing to the shadow
	# but cost a draw in every shadow pass.
	var ext := mesh.get_aabb().size * scl
	if maxf(ext.x, maxf(ext.y, ext.z)) < 0.07:
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	_set_rest(mi, parent)
	return mi


## Tells a piece of skin or clothes where it sits in the rest pose (for the
## blood on him: body_blood.gdshaderinc).
func _set_rest(mi: MeshInstance3D, part: Node3D) -> void:
	if not part.has_meta("rest_pos") or not (mi.material_override is ShaderMaterial):
		return
	var sh: Shader = (mi.material_override as ShaderMaterial).shader
	if sh != ClothShader and sh != SkinShader:
		return
	var t := Transform3D(Basis(), part.get_meta("rest_pos")) * mi.transform
	mi.set_instance_shader_parameter("rest_x", Vector4(t.basis.x.x, t.basis.y.x, t.basis.z.x, t.origin.x))
	mi.set_instance_shader_parameter("rest_y", Vector4(t.basis.x.y, t.basis.y.y, t.basis.z.y, t.origin.y))
	mi.set_instance_shader_parameter("rest_z", Vector4(t.basis.x.z, t.basis.y.z, t.basis.z.z, t.origin.z))


## The materials the blood on him shows in.
func blood_materials() -> Array:
	return [_skin, _shirt, _pants] + _extra_cloth


## A heavy blow to the whole body (buckshot): every part pushed along `dir`
## by `dv` m/s, whatever way he was going - he stops and goes over.
func knockback(dir: Vector3, dv: float) -> void:
	wake()
	var d := Vector3(dir.x, maxf(dir.y, 0.0) * 0.3, dir.z).normalized()
	for p in parts:
		var v: Vector3 = p.linear_velocity
		# (his own running is taken off first, so he is not carried on by it)
		var along := v.dot(-d)
		if along > 0.0:
			v += d * minf(along, dv * 1.5)
		p.linear_velocity = v + d * dv + Vector3.UP * dv * 0.12
	move_velocity = Vector3.ZERO
	_stumble = 1.0
	_stumble_dir = Vector3(d.x, 0, d.z).normalized()
	_stagger += dv * 0.4


## Set alight (a Molotov, a flare, walking into fire): flames on his back
## and legs, he screams and runs, his clothes and skin blacken; long enough
## in it, he dies.
func ignite(seconds: float) -> void:
	var was := burning > 0.0
	burning = maxf(burning, seconds)
	if was:
		return
	wake()
	for pn in ["chest", "pelvis", "thigh_r", "upper_arm_l"]:
		if part_index.has(pn):
			var fx: GPUParticles3D = load("res://scripts/fx/fire.gd").flames_on(parts[part_index[pn]], 1.0 if pn == "chest" else 0.7, 18)
			_burn_fx.append(fx)
	if ai and alive and not has_meta("puppet"):
		ai.on_hurt(chest.global_position, Vector3.UP)


func _burn_tick(delta: float) -> void:
	burning = maxf(burning - delta, 0.0)
	if burning <= 0.0:
		for fx in _burn_fx:
			if is_instance_valid(fx):
				(fx as GPUParticles3D).emitting = false
				fx.get_tree().create_timer(1.0).timeout.connect(fx.queue_free)
		_burn_fx.clear()
		return
	burnt += delta
	if alive:
		pain = minf(pain + delta * 0.6, 2.0)
		shock = minf(shock + delta * 0.03, 1.0)
		if ai and not has_meta("puppet"):
			ai.fear = 1.0
		if burnt > 14.0:
			_die("burned")
	# Blackening: clothes and skin go dark, charred.
	var k := clampf(burnt / 12.0, 0.0, 1.0)
	for m in [_shirt, _pants]:
		if m is ShaderMaterial:
			if not (m as ShaderMaterial).has_meta("base"):
				(m as ShaderMaterial).set_meta("base", (m as ShaderMaterial).get_shader_parameter("albedo"))
			var base = (m as ShaderMaterial).get_meta("base")
			if base is Color:
				(m as ShaderMaterial).set_shader_parameter("albedo", (base as Color).lerp(Color(0.04, 0.035, 0.03), k * 0.9))
	if _skin:
		_skin.set_shader_parameter("albedo", skin_color.lerp(Color(0.12, 0.06, 0.04), k * 0.75))


## A stain soaking outwards from a wound (blood.gd).
func bloom_blood(part: RigidBody3D, world_p: Vector3, r: float, dur: float, amount: float) -> void:
	if blood_map == null:
		blood_map = BodyBlood.new(self)
	var pname: String = part.get_meta("part", "")
	if not part.has_meta("rest_pos") and part_index.has(pname):
		part.set_meta("rest_pos", parts[part_index[pname]].get_meta("rest_pos"))
	blood_map.bloom(part, world_p, r, dur, amount)


## Blood on him at `world_p` on `part` (blood.gd).
func paint_blood(part: RigidBody3D, world_p: Vector3, r: float, amount: float) -> void:
	if blood_map == null:
		blood_map = BodyBlood.new(self)
	var pname: String = part.get_meta("part", "")
	# (a cut-off piece keeps the rest pose of the part it was)
	if not part.has_meta("rest_pos") and part_index.has(pname):
		part.set_meta("rest_pos", parts[part_index[pname]].get_meta("rest_pos"))
	blood_map.paint(part, world_p, r, amount)


func _cap_mesh(radius: float, height: float) -> CapsuleMesh:
	var c := CapsuleMesh.new()
	c.radius = radius * scale_factor
	c.height = height * scale_factor
	c.radial_segments = 16
	c.rings = 6
	return c


func _sphere_mesh(radius: float, height: float) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = radius * scale_factor
	s.height = height * scale_factor
	s.radial_segments = 20
	s.rings = 12
	return s


func _build_visuals() -> void:
	var along_x := Vector3(0, 0, PI * 0.5)
	_mesh(pelvis, _cap_mesh(0.135, 0.36), _pants, Vector3.ZERO, along_x, Vector3(1, 1, 0.85))
	var ab := parts[part_index["abdomen"]]
	_mesh(ab, _cap_mesh(0.125, 0.31), _shirt, Vector3.ZERO, along_x, Vector3(1, 1, 0.82))
	_mesh(chest, _cap_mesh(0.15, 0.4), _shirt, Vector3(0, 0.0, 0.0), along_x, Vector3(1, 1, 0.8))
	_mesh(chest, _cap_mesh(0.09, 0.44), _shirt, Vector3(0, 0.07, 0.01), along_x, Vector3(1, 1, 0.95))   # shoulders
	# Head: skull, jaw, nose, ears, neck, hair, eyes.
	_mesh(head, _cap_mesh(0.055, 0.17), _skin, Vector3(0, -0.12, 0.012))
	var first_head_mesh := head.get_child_count()
	_mesh(head, _sphere_mesh(0.1, 0.235), _skin, Vector3(0, 0.01, 0), Vector3.ZERO, Vector3(0.93, 1.0, 1.08))
	_mesh(head, _sphere_mesh(0.07, 0.1), _skin, Vector3(0, -0.06, -0.035), Vector3.ZERO, Vector3(1.05, 1.0, 1.2))
	_mesh(head, _cap_mesh(0.014, 0.05), _skin, Vector3(0, -0.005, -0.103), Vector3(-0.35, 0, 0), Vector3(1.2, 1, 1))
	for sx in [-1.0, 1.0]:
		_mesh(head, _sphere_mesh(0.022, 0.05), _skin, Vector3(0.093 * sx, 0.0, 0.01), Vector3.ZERO, Vector3(0.5, 1, 0.9))
		var eye := _mesh(head, _sphere_mesh(0.011, 0.022), _eye_mat, Vector3(0.035 * sx, 0.025, -0.092))
		eye.scale = Vector3(1, 0.7, 0.5)
		var brow := _mesh(head, _cap_mesh(0.008, 0.04), _hair, Vector3(0.035 * sx, 0.047, -0.094), Vector3(0, 0, PI * 0.5 + 0.15 * sx))
		_face_eyes.append(eye)
		_face_brows.append(brow)
	# The mouth: a dark slit that tightens, drops open, pulls wide.
	var lips := StandardMaterial3D.new()
	lips.albedo_color = Color(0.22, 0.08, 0.07)
	lips.roughness = 0.6
	_face_mouth = _mesh(head, _sphere_mesh(0.02, 0.04), lips, Vector3(0, -0.072, -0.108), Vector3.ZERO, Vector3(1.25, 0.2, 0.35))
	_hair_style()
	_head_wear()
	for i in range(first_head_mesh, head.get_child_count()):
		if head.get_child(i) is MeshInstance3D:
			_head_meshes.append(head.get_child(i))
	_body_wear()
	_outfit_wear()
	# Limbs.
	for side in ["r", "l"]:
		var ua := parts[part_index["upper_arm_" + side]]
		_mesh(ua, _cap_mesh(0.058, 0.32), _shirt)
		_mesh(ua, _sphere_mesh(0.062, 0.12), _shirt, Vector3(0, 0.12, 0))
		var fa := parts[part_index["forearm_" + side]]
		_mesh(fa, _cap_mesh(0.047, 0.29), _shirt if _long_sleeves else _skin)
		var hand := parts[part_index["hand_" + side]]
		# A blocky fist, like the player's own: thin across, tall, the thumb
		# a small block along its front.
		# (up to the wrist, and the wrist itself into the end of the sleeve:
		# no gap between the fist and the forearm)
		var fist := BoxMesh.new()
		fist.size = Vector3(0.044, 0.11, 0.078) * scale_factor
		_mesh(hand, fist, _skin, Vector3(0, 0.022, 0))
		_mesh(hand, _cap_mesh(0.03, 0.1), _skin, Vector3(0, 0.08, 0))
		var thumb := BoxMesh.new()
		thumb.size = Vector3(0.022, 0.045, 0.022) * scale_factor
		_mesh(hand, thumb, _skin, Vector3(0, 0.05, -0.047), Vector3(0.35, 0, 0))
		var th := parts[part_index["thigh_" + side]]
		_mesh(th, _cap_mesh(0.082, 0.46), _pants)
		var sh := parts[part_index["shin_" + side]]
		_mesh(sh, _cap_mesh(0.062, 0.46), _pants)
		var ft := parts[part_index["foot_" + side]]
		_mesh(ft, _cap_mesh(0.05, 0.26), _shoes, Vector3(0, -0.005, -0.005), Vector3(PI * 0.5, 0, 0), Vector3(1.0, 1.0, 0.8))
		_mesh(ft, _sphere_mesh(0.05, 0.06), _shoes, Vector3(0, 0.03, 0.06))


## The hair: cropped short, parted with a fringe, long to the collar,
## curly, shaved to stubble, or none; some have a moustache or a beard.
func _hair_style() -> void:
	var r := rng.randf()
	_has_hair = r < 0.9
	var cap := func(extra_r: float, y: float) -> void:
		_mesh(head, _sphere_mesh(0.104 + extra_r, 0.2 + extra_r * 2.0), _hair, Vector3(0, y, 0.012), Vector3(-0.25, 0, 0), Vector3(0.96, 0.8, 1.06))
	if r < 0.3:
		cap.call(0.0, 0.05)                                   # short
	elif r < 0.5:
		cap.call(0.002, 0.052)                                # parted, a fringe swept to one side
		var side := 1.0 if rng.randf() < 0.5 else -1.0
		var fringe := BoxMesh.new()
		fringe.size = Vector3(0.13, 0.022, 0.06) * scale_factor
		_mesh(head, fringe, _hair, Vector3(0.015 * side, 0.1, -0.065), Vector3(-0.55, 0.0, 0.18 * side))
	elif r < 0.62:
		cap.call(0.004, 0.05)                                 # long: down over the nape and the ears
		_mesh(head, _cap_mesh(0.085, 0.22), _hair, Vector3(0, -0.035, 0.055), Vector3(0.12, 0, 0), Vector3(1.05, 1.0, 0.55))
		for sx in [-1.0, 1.0]:
			_mesh(head, _cap_mesh(0.03, 0.14), _hair, Vector3(0.088 * sx, -0.02, 0.02), Vector3(0, 0, 0.08 * sx), Vector3(0.7, 1.0, 1.0))
	elif r < 0.74:
		_mesh(head, _sphere_mesh(0.118, 0.2), _hair, Vector3(0, 0.06, 0.012), Vector3(-0.2, 0, 0), Vector3(1.04, 0.86, 1.08))   # curly
	elif r < 0.9:
		# Shaved to stubble: the colour of it over the scalp, no bulk.
		var stub := StandardMaterial3D.new()
		stub.albedo_color = (_hair.albedo_color as Color).lerp(skin_color, 0.45)
		stub.roughness = 0.9
		_mesh(head, _sphere_mesh(0.1015, 0.21), stub, Vector3(0, 0.03, 0.008), Vector3(-0.25, 0, 0), Vector3(0.94, 0.9, 1.08))
	# Facial hair.
	var f := rng.randf()
	if f < 0.2:
		var moustache := _mesh(head, _cap_mesh(0.01, 0.055), _hair, Vector3(0, -0.058, -0.108), Vector3(0, 0, PI * 0.5))
		moustache.scale = Vector3(1.0, 1.0, 0.7)
	elif f < 0.34:
		_mesh(head, _cap_mesh(0.01, 0.055), _hair, Vector3(0, -0.058, -0.108), Vector3(0, 0, PI * 0.5))
		_mesh(head, _sphere_mesh(0.034, 0.05), _hair, Vector3(0, -0.103, -0.088), Vector3.ZERO, Vector3(1.35, 1.0, 1.0))   # goatee
	elif f < 0.44:
		# A full short beard: along the jaw from ear to ear, the mouth clear.
		for i in 7:
			var a := lerpf(-1.25, 1.25, float(i) / 6.0)
			_mesh(head, _sphere_mesh(0.026, 0.05), _hair, Vector3(sin(a) * 0.07, -0.085 - cos(a) * 0.012, -cos(a) * 0.075 + 0.005),
					Vector3.ZERO, Vector3(1.0, 1.0, 0.8))
		_mesh(head, _cap_mesh(0.01, 0.055), _hair, Vector3(0, -0.058, -0.108), Vector3(0, 0, PI * 0.5))


## A strap, a cord or a flat band lying along `pts` (the part's rest frame,
## before scaling), `w` wide and `h` thick, its flat side turned out from
## `centre`. `widths` (one per point) overrides `w`.
func _band(part: Node3D, pts: Array, w: float, h: float, mat: Material, centre := Vector3.ZERO, widths: Array = []) -> MeshInstance3D:
	var sections := []
	var n := pts.size()
	for i in n:
		var p: Vector3 = pts[i]
		var t: Vector3 = ((pts[mini(i + 1, n - 1)] as Vector3) - (pts[maxi(i - 1, 0)] as Vector3)).normalized()
		var face := p - centre
		face -= t * face.dot(t)
		if face.length() < 1e-4:
			face = Vector3.FORWARD
		var x := t.cross(face.normalized()).normalized()
		var y := x.cross(t).normalized()
		var wi: float = widths[i] if i < widths.size() else w
		sections.append([Transform3D(Basis(x, y, t), p * scale_factor),
				Shape.rrect(wi * scale_factor, h * scale_factor, minf(wi, h) * 0.45 * scale_factor, 2)])
	return _mesh(part, Shape.loft_mesh(sections), mat)


## Where the front of the chest and belly is, at height `y` (the chest's rest
## frame): the chest's and the belly's round sections, whichever sticks out.
func _front_z(y: float, x := 0.0) -> float:
	var cr := sqrt(maxf(0.0225 - maxf(absf(x) - 0.05, 0.0) ** 2, 0.0))
	var chest_z := -0.8 * sqrt(maxf(cr * cr - y * y, 0.0))
	var ab_y := y + 0.22
	var ab_z := -0.82 * sqrt(maxf(0.0156 - ab_y * ab_y, 0.0))
	return minf(chest_z, ab_z)


## The clothes that are more than a colour: the suit's shirt front, collar
## and tie; the hoodie's hood, pocket and cords; the tracksuit's stripes and
## zip; the open jacket with the T-shirt showing down the front.
func _outfit_wear() -> void:
	match outfit:
		"suit":
			# The white shirt showing in the V of the jacket, its collar, the tie.
			var v_pts := []
			var v_w := []
			for i in 7:
				var y := lerpf(0.145, 0.0, float(i) / 6.0)
				v_pts.append(Vector3(0, y, _front_z(y) - 0.004))
				v_w.append(lerpf(0.12, 0.018, float(i) / 6.0))
			_band(chest, v_pts, 0.1, 0.004, _tee, Vector3(0, 0.0, 0.02), v_w)
			var collar := TorusMesh.new()
			collar.inner_radius = 0.05 * scale_factor
			collar.outer_radius = 0.068 * scale_factor
			collar.rings = 20
			collar.ring_segments = 6
			_mesh(chest, collar, _tee, Vector3(0, 0.165, -0.005), Vector3(0.25, 0, 0), Vector3(1.0, 0.7, 1.05))
			var tie_m := StandardMaterial3D.new()
			tie_m.albedo_color = [Color(0.45, 0.05, 0.06), Color(0.06, 0.08, 0.2), Color(0.04, 0.04, 0.04), Color(0.3, 0.25, 0.1)][rng.randi() % 4]
			tie_m.roughness = 0.45
			var t_pts := []
			var t_w := []
			for i in 10:
				var y := lerpf(0.128, -0.25, float(i) / 9.0)
				t_pts.append(Vector3(0, y, _front_z(y) - 0.009))
				t_w.append(0.03 if i == 0 else lerpf(0.035, 0.07, float(i) / 9.0))
			_band(chest, t_pts, 0.05, 0.007, tie_m, Vector3(0, 0.0, 0.02), t_w)
			# Lapels down the edges of the V, and the buttons.
			for sx in [-1.0, 1.0]:
				var l_pts := []
				for i in 5:
					var y := lerpf(0.15, 0.0, float(i) / 4.0)
					var x: float = lerpf(0.065, 0.012, float(i) / 4.0) * sx
					l_pts.append(Vector3(x, y, _front_z(y, x) - 0.007))
				_band(chest, l_pts, 0.03, 0.006, _shirt, Vector3(0, 0.0, 0.02))
			var btn := StandardMaterial3D.new()
			btn.albedo_color = Color(0.05, 0.05, 0.05)
			for y in [-0.04, -0.12]:
				_mesh(chest, _sphere_mesh(0.009, 0.012), btn, Vector3(0.022, y, _front_z(y, 0.022) - 0.006))
		"hoodie":
			_mesh(chest, _sphere_mesh(0.1, 0.12), _shirt, Vector3(0, 0.17, 0.075), Vector3(0.4, 0, 0), Vector3(1.5, 1.0, 1.1))    # the hood down the back
			var ab := parts[part_index["abdomen"]]
			var pocket := BoxMesh.new()
			pocket.size = Vector3(0.2, 0.085, 0.012) * scale_factor
			_mesh(ab, pocket, _shirt, Vector3(0, -0.02, -0.098))
			var cord := StandardMaterial3D.new()
			cord.albedo_color = Color(0.85, 0.85, 0.82)
			for sx in [-1.0, 1.0]:
				var c_pts := []
				for i in 4:
					var y := lerpf(0.14, 0.02, float(i) / 3.0)
					c_pts.append(Vector3(0.03 * sx, y, _front_z(y, 0.03) - 0.006))
				_band(chest, c_pts, 0.007, 0.007, cord, Vector3(0, 0.0, 0.02))
		"tracksuit":
			var stripe := _tee
			for side in ["r", "l"]:
				var sx := 1.0 if side == "r" else -1.0
				for seg in [["upper_arm_", 0.059, 0.14], ["forearm_", 0.048, 0.13], ["thigh_", 0.083, 0.21], ["shin_", 0.063, 0.21]]:
					var part := parts[part_index[seg[0] + side]]
					var rr: float = seg[1]
					var hl: float = seg[2]
					_band(part, [Vector3(rr * sx, hl, 0), Vector3(rr * sx, 0, 0), Vector3(rr * sx, -hl, 0)], 0.018, 0.004, stripe)
			var z_pts := []
			for i in 8:
				var y := lerpf(0.15, -0.3, float(i) / 7.0)
				z_pts.append(Vector3(0, y, _front_z(y) - 0.004))
			var zip := StandardMaterial3D.new()
			zip.albedo_color = Color(0.6, 0.6, 0.6)
			zip.metallic = 0.8
			_band(chest, z_pts, 0.008, 0.004, zip, Vector3(0, 0.0, 0.02))
		"jacket":
			# The T-shirt down the open front, the collar turned up round the neck.
			var o_pts := []
			for i in 9:
				var y := lerpf(0.15, -0.32, float(i) / 8.0)
				o_pts.append(Vector3(0, y, _front_z(y) - 0.004))
			_band(chest, o_pts, 0.085, 0.005, _tee, Vector3(0, 0.0, 0.02))
			var collar := TorusMesh.new()
			collar.inner_radius = 0.055 * scale_factor
			collar.outer_radius = 0.08 * scale_factor
			collar.rings = 20
			collar.ring_segments = 6
			_mesh(chest, collar, _shirt, Vector3(0, 0.17, 0.005), Vector3(0.3, 0, 0), Vector3(1.05, 1.1, 1.0))


## What people wear on their heads and faces: a knitted beanie or a cap, a
## hood, glasses or shades, an earring (some of each, none on most).
func _head_wear() -> void:
	var r := rng.randf()
	var judge := has_meta("judge") or has_meta("guard")
	if judge:
		r = 1.0                     # (the judge: bare-headed, in dark glasses)
	var wool := StandardMaterial3D.new()
	wool.albedo_color = [Color(0.1, 0.1, 0.1), Color(0.5, 0.1, 0.08), Color(0.15, 0.22, 0.35), Color(0.3, 0.3, 0.28), Color(0.2, 0.3, 0.15)][rng.randi() % 5]
	wool.roughness = 0.97
	if r < 0.22:
		# Beanie, pulled down over the ears, a rolled edge.
		_mesh(head, _sphere_mesh(0.108, 0.17), wool, Vector3(0, 0.055, 0.008), Vector3(-0.15, 0, 0), Vector3(1.0, 0.95, 1.08))
		var edge := TorusMesh.new()
		edge.inner_radius = 0.094 * scale_factor
		edge.outer_radius = 0.112 * scale_factor
		edge.rings = 20
		_mesh(head, edge, wool, Vector3(0, 0.02, 0.01), Vector3(-0.15, 0, 0), Vector3(1.0, 1.0, 1.1))
	elif r < 0.4:
		# A baseball cap, the peak forward (or back to front).
		var back := rng.randf() < 0.3
		_mesh(head, _sphere_mesh(0.105, 0.14), wool, Vector3(0, 0.065, 0.008), Vector3(-0.1, 0, 0), Vector3(1.0, 0.8, 1.06))
		var peak := BoxMesh.new()
		peak.size = Vector3(0.15, 0.012, 0.09) * scale_factor
		_mesh(head, peak, wool, Vector3(0, 0.07, 0.13 if back else -0.13), Vector3(0.12 if back else -0.12, 0, 0))
	var g := rng.randf()
	if judge:
		g = 0.05
	if g < 0.22:
		# Glasses: two lenses and the bridge; some are dark.
		var frame := StandardMaterial3D.new()
		frame.albedo_color = Color(0.05, 0.05, 0.05)
		frame.roughness = 0.4
		var dark := g < 0.1
		var lens := StandardMaterial3D.new()
		lens.albedo_color = Color(0.05, 0.05, 0.06, 0.92) if dark else Color(0.7, 0.8, 0.85, 0.25)
		lens.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		lens.metallic_specular = 1.0
		lens.roughness = 0.05
		for sx in [-1.0, 1.0]:
			var lb := BoxMesh.new()
			lb.size = Vector3(0.036, 0.024, 0.004) * scale_factor
			_mesh(head, lb, lens, Vector3(0.036 * sx, 0.024, -0.1))
			var rimb := BoxMesh.new()
			rimb.size = Vector3(0.04, 0.004, 0.006) * scale_factor
			_mesh(head, rimb, frame, Vector3(0.036 * sx, 0.037, -0.1))
			var arm := BoxMesh.new()
			arm.size = Vector3(0.003, 0.004, 0.1) * scale_factor
			_mesh(head, arm, frame, Vector3(0.089 * sx, 0.03, -0.055))
		var bridge := BoxMesh.new()
		bridge.size = Vector3(0.018, 0.004, 0.005) * scale_factor
		_mesh(head, bridge, frame, Vector3(0, 0.03, -0.101))
	if rng.randf() < 0.15:
		var gold := StandardMaterial3D.new()
		gold.albedo_color = Color(0.85, 0.65, 0.2)
		gold.metallic = 1.0
		gold.roughness = 0.25
		_mesh(head, _sphere_mesh(0.006, 0.012), gold, Vector3(0.097 * (1.0 if rng.randf() < 0.5 else -1.0), -0.03, 0.012))


## On the body: a chain round the neck, a scarf, a watch, a backpack.
func _body_wear() -> void:
	if has_meta("judge"):
		_briefcase()
		return
	if has_meta("guard"):
		# Nothing on him but the suit; an earpiece, its coiled lead down the collar.
		var black := StandardMaterial3D.new()
		black.albedo_color = Color(0.04, 0.04, 0.04)
		black.roughness = 0.4
		_mesh(head, _sphere_mesh(0.009, 0.018), black, Vector3(0.094, 0.005, 0.0))
		var lead := CylinderMesh.new()
		lead.top_radius = 0.0025
		lead.bottom_radius = 0.0025
		lead.height = 0.1
		_mesh(head, lead, black, Vector3(0.09, -0.05, 0.02), Vector3(0.25, 0, 0))
		return
	if has_meta("bartender") or has_meta("cleaner"):
		_apron(has_meta("cleaner"))
		return
	var gold := StandardMaterial3D.new()
	gold.albedo_color = Color(0.85, 0.65, 0.2) if rng.randf() < 0.6 else Color(0.75, 0.76, 0.78)
	gold.metallic = 1.0
	gold.roughness = 0.25
	if rng.randf() < 0.2 and outfit != "suit":
		# A chain round the neck, lying on the chest and dipping in front.
		var c_pts := []
		for i in 21:
			var th := TAU * float(i) / 20.0
			var fr := maxf(cos(th), 0.0)
			var y := 0.168 - 0.085 * fr * fr
			var x := 0.074 * sin(th)
			var z := (_front_z(y, x) - 0.006) * fr if fr > 0.0 else 0.062 * -cos(th)
			c_pts.append(Vector3(x, y, minf(z, -0.045 * fr)) if fr > 0.3 else Vector3(x, y, z))
		_band(chest, c_pts, 0.007, 0.007, gold, Vector3(0, 0.1, 0.0))
	if rng.randf() < 0.15:
		var scarf_m := StandardMaterial3D.new()
		scarf_m.albedo_color = [Color(0.6, 0.1, 0.1), Color(0.15, 0.15, 0.35), Color(0.4, 0.35, 0.3)][rng.randi() % 3]
		scarf_m.roughness = 0.97
		var scarf := TorusMesh.new()
		scarf.inner_radius = 0.05 * scale_factor
		scarf.outer_radius = 0.085 * scale_factor
		scarf.rings = 16
		_mesh(chest, scarf, scarf_m, Vector3(0, 0.18, 0.0), Vector3(0.1, 0, 0), Vector3(1.0, 1.2, 1.0))
		# The two ends hanging down the front from the knot, lying on him.
		for k in 2:
			var x0 := 0.035 if k == 0 else 0.055
			var e_pts := []
			for i in 5:
				var y := lerpf(0.14, -0.08 - 0.04 * k, float(i) / 4.0)
				e_pts.append(Vector3(x0, y, _front_z(y, x0) - 0.012 - 0.008 * k))
			_band(chest, e_pts, 0.06, 0.014, scarf_m, Vector3(0, 0.0, 0.02))
	if rng.randf() < 0.3:
		var strap := StandardMaterial3D.new()
		strap.albedo_color = Color(0.08, 0.08, 0.08)
		strap.roughness = 0.6
		var fa := parts[part_index["forearm_l"]]
		var band := CylinderMesh.new()
		band.top_radius = 0.05 * scale_factor
		band.bottom_radius = 0.05 * scale_factor
		band.height = 0.02 * scale_factor
		_mesh(fa, band, strap, Vector3(0, -0.11, 0))
		var face := CylinderMesh.new()
		face.top_radius = 0.018 * scale_factor
		face.bottom_radius = 0.018 * scale_factor
		face.height = 0.008 * scale_factor
		_mesh(fa, face, gold, Vector3(-0.05, -0.11, 0), Vector3(0, 0, PI * 0.5))
	if rng.randf() < 0.2:
		var bag := StandardMaterial3D.new()
		bag.albedo_color = [Color(0.12, 0.13, 0.15), Color(0.3, 0.12, 0.1), Color(0.2, 0.25, 0.18)][rng.randi() % 3]
		bag.roughness = 0.85
		var pack := BoxMesh.new()
		pack.size = Vector3(0.28, 0.36, 0.13) * scale_factor
		_mesh(chest, pack, bag, Vector3(0, -0.02, 0.19))
		var pocket := BoxMesh.new()
		pocket.size = Vector3(0.2, 0.14, 0.04) * scale_factor
		_mesh(chest, pocket, bag, Vector3(0, -0.1, 0.27))
		# The straps: out of the top of the pack, over the shoulders and down
		# the front of the chest to under the arms, lying on him.
		for sx in [-1.0, 1.0]:
			var s_pts := [Vector3(0.1 * sx, 0.1, 0.13), Vector3(0.1 * sx, 0.15, 0.08), Vector3(0.1 * sx, 0.17, 0.0),
					Vector3(0.1 * sx, 0.14, -0.075), Vector3(0.105 * sx, 0.06, _front_z(0.06, 0.105) - 0.008),
					Vector3(0.115 * sx, -0.04, _front_z(-0.04, 0.115) - 0.008), Vector3(0.14 * sx, -0.12, -0.075)]
			_band(chest, s_pts, 0.036, 0.008, bag, Vector3(0.06 * sx, 0.04, 0.0))


## A long apron over the front (the bartender's white-ish, the cleaners'
## rubber, dark), tied at the waist.
func _apron(rubber: bool) -> void:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.1, 0.12, 0.1) if rubber else Color(0.78, 0.76, 0.7)
	m.roughness = 0.35 if rubber else 0.9
	var ab: Node3D = parts[part_index["abdomen"]] if part_index.has("abdomen") else chest
	var top := BoxMesh.new()
	top.size = Vector3(0.26, 0.24, 0.012) * scale_factor
	_mesh(chest, top, m, Vector3(0, 0.02, _front_z(0.02, 0.0) - 0.008))
	var mid := BoxMesh.new()
	mid.size = Vector3(0.32, 0.26, 0.012) * scale_factor
	_mesh(ab, mid, m, Vector3(0, -0.02, -0.105))
	var low := BoxMesh.new()
	low.size = Vector3(0.36, 0.34, 0.012) * scale_factor
	_mesh(pelvis, low, m, Vector3(0, -0.14, -0.115))
	var tie := BoxMesh.new()
	tie.size = Vector3(0.34, 0.018, 0.2) * scale_factor
	_mesh(ab, tie, m, Vector3(0, 0.02, 0.0))


## The judge's case, in his right hand: black leather, a handle, the metal
## corners and locks.
func _briefcase() -> void:
	var hand := parts[part_index["hand_r"]]
	var leather := StandardMaterial3D.new()
	leather.albedo_color = Color(0.035, 0.03, 0.03)
	leather.roughness = 0.45
	var metal := StandardMaterial3D.new()
	metal.albedo_color = Color(0.75, 0.72, 0.62)
	metal.metallic = 1.0
	metal.roughness = 0.3
	var body := BoxMesh.new()
	body.size = Vector3(0.09, 0.32, 0.44) * scale_factor
	_mesh(hand, body, leather, Vector3(0, -0.27, 0))
	var seam := BoxMesh.new()
	seam.size = Vector3(0.094, 0.012, 0.446) * scale_factor
	_mesh(hand, seam, metal, Vector3(0, -0.14, 0))
	var grip := TorusMesh.new()
	grip.inner_radius = 0.016 * scale_factor
	grip.outer_radius = 0.026 * scale_factor
	grip.rings = 12
	_mesh(hand, grip, leather, Vector3(0, -0.095, 0), Vector3(0, 0, PI * 0.5), Vector3(1.0, 1.0, 3.2))
	for sz in [-1.0, 1.0]:
		var lock := BoxMesh.new()
		lock.size = Vector3(0.096, 0.025, 0.035) * scale_factor
		_mesh(hand, lock, metal, Vector3(0, -0.15, 0.12 * sz))
		for sy in [-1.0, 1.0]:
			var corner := BoxMesh.new()
			corner.size = Vector3(0.096, 0.03, 0.03) * scale_factor
			_mesh(hand, corner, metal, Vector3(0, -0.27 + 0.15 * sy, 0.21 * sz))


# --- Simulation ----------------------------------------------------------------------

func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["humanoid._physics_process"] = Game.prof.get("humanoid._physics_process", 0) + __d
	Game.prof["max humanoid._physics_process"] = maxi(Game.prof.get("max humanoid._physics_process", 0), __d)


func _physics_process_real(delta: float) -> void:
	if parts.is_empty():
		return
	if blood_map:
		blood_map.flush(delta)
	if burning > 0.0 or not _burn_fx.is_empty():
		_burn_tick(delta)
	if _asleep_off_screen(delta):
		return
	_time += delta
	_update_health(delta)
	_update_state(delta)
	_compose_pose(delta)
	_apply_muscles()
	_update_chain()
	if support > 0.001:
		_apply_balance()
	_update_squat_hold(delta)
	_update_face(delta)
	_limit_speed()


## The dead lying still where nobody is looking cost nothing: the parts are
## frozen where they lie until they come into view again or something touches
## them (a shot, a blast, a hand: wake). What is still moving - falling,
## rolling, sliding - goes on being worked out until it has stopped.
var _off_frozen := false
var _off_check := 0.0


func _asleep_off_screen(delta: float) -> bool:
	if alive or _death_t < 4.0 or player_owner != null:
		return false
	_off_check -= delta
	if _off_frozen:
		if _off_check <= 0.0:
			_off_check = 0.25
			if _in_view():
				wake()
				return false
		return true
	if _off_check > 0.0:
		return false
	_off_check = 0.5
	if _in_view():
		return false
	for p in parts:
		if p.linear_velocity.length_squared() > 0.01 or p.angular_velocity.length_squared() > 0.04:
			return false
	_off_frozen = true
	for p in parts:
		p.freeze_mode = RigidBody3D.FREEZE_MODE_STATIC
		p.freeze = true
	return true


func _in_view() -> bool:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return true
	var c: Vector3 = pelvis.global_position
	if cam.global_position.distance_to(c) < 4.0:
		return true
	return cam.is_position_in_frustum(c) or cam.is_position_in_frustum(head.global_position)


## A body part squeezed into something (a wall, a door, another body) can be
## shot out of it by the solver at silly speeds - and the whole ragdoll with it
## into the sky. No part of a person moves faster than a blast throws it.
var _blast_until := -1.0


func _limit_speed() -> void:
	var cap := 60.0 if Game.clock < _blast_until else 22.0
	for p in parts:
		var v := p.linear_velocity
		if v.length_squared() > cap * cap:
			p.linear_velocity = v.normalized() * cap * 0.6
		if p.angular_velocity.length_squared() > 1600.0:
			p.angular_velocity = p.angular_velocity.normalized() * 30.0


func _update_health(delta: float) -> void:
	if not alive:
		return
	blood = maxf(blood - bleed_rate * delta, 0.0)
	# Small wounds slowly clot.
	if bleed_rate < 12.0:
		bleed_rate = maxf(bleed_rate - delta * 0.3, 0.0)   # clots within a few tens of seconds
	else:
		bleed_rate = maxf(bleed_rate * (1.0 - delta * 0.02), 12.0)   # torn vessels clamp down, slowly
	shock = maxf(shock - delta * 0.015, 0.0)
	pain = maxf(pain - delta * 0.08, 0.0)
	_stagger = maxf(_stagger - delta * 1.4, 0.0)
	# Muscle knocked out by a hit comes back over the best part of a second.
	for i in _hit_weak.size():
		if _hit_weak[i] < 1.0:
			_hit_weak[i] = minf(_hit_weak[i] + delta * 1.2, 1.0)
	_flinch = maxf(_flinch - delta * 1.8, 0.0)
	if _stumble > 0.0:
		_stumble = maxf(_stumble - delta * 0.75, 0.0)
		# Bad legs do not catch the stumble.
		if _stumble <= 0.0 and not fallen and minf(leg_health["l"], leg_health["r"]) < 0.5 and rng.randf() < 0.6:
			_fall()
	var frac := blood / BLOOD_MAX
	var was_conscious := conscious
	conscious = frac > 0.55 and shock < 1.0
	if was_conscious and not conscious:
		_start_death_curve("faint")
	# (out cold only briefly before the end)
	if frac < 0.475:
		_die("bleed_out")


## Standing ability from legs, shock and blood.
func mobility() -> float:
	var legs: float = minf(leg_health["l"], leg_health["r"]) * 0.6 + (leg_health["l"] + leg_health["r"]) * 0.2
	var frac := blood / BLOOD_MAX
	return clampf(legs * (1.0 - shock * 0.5) * clampf((frac - 0.55) / 0.2, 0.0, 1.0), 0.0, 1.0)


var _limp := false


## Loose limbs: little damping once there is no muscle tone to hold them.
func _set_limp(on: bool) -> void:
	if on == _limp:
		return
	_limp = on
	for p in parts:
		p.angular_damp = 0.12 if on else 0.6
		p.linear_damp = 0.02 if on else 0.05


func _update_state(delta: float) -> void:
	_set_limp(tone < 0.2)
	# Muscle tone envelope after a fatal/unconscious event.
	if _death_t >= 0.0:
		_death_t += delta
		match _death_kind:
			"headshot":
				# Brain shot: postural tone is gone almost at once and the body drops.
				# What is left is a weak, brief involuntary stiffening (mostly arms)
				# that fades smoothly over about a second.
				if _death_t < 0.1:
					tone = lerpf(tone, 0.32, _death_t / 0.1)
				else:
					var k := clampf((_death_t - 0.1) / (HEADSHOT_SPASM - 0.1), 0.0, 1.0)
					tone = lerpf(0.32, 0.02, 1.0 - pow(1.0 - k, 2.0))
			_:
				var k := clampf(_death_t / 1.4, 0.0, 1.0)
				tone = lerpf(tone, 0.08 if alive else 0.03, k * 0.2)
		support = 0.0
		if _death_t > 6.0 and not alive:
			for p in parts:
				p.can_sleep = true
		return

	var ph := pelvis.global_position
	var up_p := pelvis.global_basis.y
	var up_c := chest.global_basis.y
	var h := _ground_distance()
	# (squatting the trunk leans well forward over the knees on purpose)
	var tipped := up_p.y < 0.45 or up_c.y < (0.2 if posture == Posture.SQUAT else 0.35)

	if feign and not fallen:
		_fall()
	if not fallen:
		if tipped or (h > 0.0 and h < stand_height * 0.42 and posture != Posture.CROUCH and posture != Posture.KNEEL and posture != Posture.SQUAT and posture != Posture.SIT) or mobility() < 0.2:
			_fall()
		elif not (posture == Posture.SIT and seat != Vector3.INF) and _out_of_balance(delta):
			_fall()                 # (sat on a chair he is not balancing on his feet)
	else:
		_fallen_time += delta
		var slow := pelvis.linear_velocity.length() < 0.6
		if _getup <= 0.0:
			if slow and _fallen_time > _getup_delay and mobility() > 0.45 and conscious and not feign:
				_getup = 0.001
		else:
			_getup += delta
			if _getup > 3.0:
				fallen = false
				_getup = 0.0
				_fallen_time = 0.0
	# Support is how much balance assist is available right now.
	var target_support := 0.0
	if conscious and alive and not feign:
		if not fallen:
			target_support = mobility() * (1.0 - clampf(_stagger, 0.0, 1.0)) * (1.0 - 0.3 * _stumble)
		elif _getup > 0.0:
			target_support = smoothstep(0.4, 2.4, _getup) * mobility()
	support = move_toward(support, target_support, delta * (6.0 if target_support < support else 1.5))
	var limp := 0.025 if player_owner else 0.1
	# Knocked down but awake: loose, bracing, not a stiff plank; firm again to get up.
	var awake_tone := 0.35 if fallen and _getup <= 0.0 else 1.0
	if fallen and _getup <= 0.0 and _fallen_time < 1.2 and conscious:
		awake_tone = 0.85          # bracing to catch the fall
	# Losing blood, the muscles give out bit by bit.
	awake_tone *= lerpf(0.55, 1.0, clampf((blood / BLOOD_MAX - 0.55) / 0.35, 0.0, 1.0))
	tone = move_toward(tone, (limp if feign else (awake_tone if conscious else 0.08)) * (1.0 - shock * 0.3), delta * ((1.3 if player_owner else 5.0) if feign else (4.0 if awake_tone < tone else 2.0)))
	if not fallen and ph.y < -5.0:
		_die("fell")


var _unbalanced_t := 0.0
var _squat_at := Vector3.INF
var SQ_THIGH := 1.85
var SQ_SHIN := -2.3
var SQ_FOOT := 0.4
var SQ_LEAN := 0.25
var _squat_feet: Array = []        # where the feet were planted on squatting down


## Balance has a budget: where the body's weight is going to come to rest
## (the capture point - the centre of mass carried on by its speed) must be
## somewhere the feet can get to. Standing, that is a little past the feet;
## with good legs he can step further to catch himself; hurt, dizzy or
## staggering, less. Beyond that for a moment, he goes over.
func _out_of_balance(delta: float) -> bool:
	if posture == Posture.KNEEL or posture == Posture.CROUCH or posture == Posture.SQUAT or posture == Posture.SIT or (cuffed and ai and ai.escort != null):
		_unbalanced_t = 0.0
		return false
	var com := Vector3.ZERO
	var vel := Vector3.ZERO
	var m := 0.0
	for p in parts:
		if p.has_meta("severed"):
			continue
		com += p.global_position * p.mass
		vel += p.linear_velocity * p.mass
		m += p.mass
	if m <= 0.0:
		return false
	com /= m
	vel /= m
	var h := maxf(_ground_distance(), 0.3) + (com.y - pelvis.global_position.y)
	var cp := com + vel * sqrt(h / G)
	# Relative to where he means to go: walking on purpose is not falling.
	cp -= move_velocity * sqrt(h / G)
	var feet := Vector3.ZERO
	var n := 0
	for side in ["r", "l"]:
		var f := parts[part_index["foot_" + side]]
		if not f.has_meta("severed"):
			feet += f.global_position
			n += 1
	if n == 0:
		return true
	feet /= n
	var off := Vector2(cp.x - feet.x, cp.z - feet.z).length()
	var reach := 0.22 + 0.55 * mobility() * (1.0 - clampf(_stagger, 0.0, 1.0) * 0.6) * (1.0 - shock * 0.4)
	if off > reach:
		_unbalanced_t += delta
	else:
		_unbalanced_t = maxf(_unbalanced_t - delta * 2.0, 0.0)
	return _unbalanced_t > 0.12


func _fall() -> void:
	fallen = true
	_getup_delay = rng.randf_range(1.5, 3.0)
	_fallen_time = 0.0
	_getup = 0.0


func _ground_distance() -> float:
	var from := pelvis.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from + Vector3.DOWN * 1.8, Game.LAYER_WORLD | Game.LAYER_PROPS)
	q.exclude = _ray_exclude
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty():
		return -1.0
	return from.y - hit.position.y


# --- Pose generation ---------------------------------------------------------------------

func _pose_set(part_name: String, euler: Vector3) -> void:
	_target[part_index[part_name]] = euler


## Mirrors Y/Z for the left side so poses can be authored for the right side.
func _side(part: String, side: String, euler: Vector3) -> void:
	if side == "l":
		euler = Vector3(euler.x, -euler.y, -euler.z)
	_pose_set(part + "_" + side, euler)


func _compose_pose(delta: float) -> void:
	for i in _target.size():
		_target[i] = Vector3.ZERO
	if _death_kind == "headshot" and _death_t >= 0.0 and _death_t < HEADSHOT_SPASM:
		_pose_decerebrate()
		return
	if feign and not _held.is_empty() and alive:
		# Player gone limp: a slack version of the pose they were in.
		for i in _target.size():
			_target[i] = _held[i]
		# (the player's own body: nothing holds the head - it lolls where it falls)
		if conscious and not player_owner:
			_pose_set("head", Vector3(clampf(head_look.y, -0.75, 0.6), clampf(head_look.x, -1.05, 1.05), 0.0))
		return
	if not alive or not conscious or feign:
		return

	var fwd := Vector3(facing.x, 0, facing.z).normalized()
	var vel := move_velocity + _stumble_dir * 1.8 * _stumble
	var speed := Vector2(vel.x, vel.z).length()
	var backwards := speed > 0.1 and vel.normalized().dot(fwd) < -0.3
	var run := clampf((speed - 1.6) / 2.4, 0.0, 1.0)
	var walk := clampf(speed / 1.0, 0.0, 1.0)
	var cadence := 0.55 + speed * 0.22
	var was_phase := _phase
	_phase += delta * TAU * cadence * (-1.0 if backwards else 1.0)
	if walk > 0.3 and not fallen and floori(_phase / PI) != floori(was_phase / PI):
		_footstep(run)

	for side in ["r", "l"]:
		var ph := _phase + (0.0 if side == "r" else PI)
		var limp: float = 1.0 - leg_health[side]
		var hip := sin(ph) * lerpf(0.35, 0.8, run) * walk + run * 0.12
		var knee: float = -maxf(0.0, sin(ph + 0.9)) * lerpf(0.7, 1.6, run) * walk * (1.0 - limp * 0.6) - 0.06
		var ankle := 0.22 * sin(ph - 0.6) * walk
		_side("thigh", side, Vector3(hip, 0.0, 0.04))
		_side("shin", side, Vector3(knee, 0, 0))
		_side("foot", side, Vector3(ankle, 0, 0))
		var arm_swing := -sin(ph) * lerpf(0.28, 0.7, run) * walk
		_side("upper_arm", side, Vector3(arm_swing + 0.05, 0.0, 0.08))
		_side("forearm", side, Vector3(lerpf(0.2, 1.4, run) + 0.1 * walk, 0, 0))
		_side("hand", side, Vector3(0.1, 0, 0))
	_pose_set("abdomen", Vector3(-0.02 * run, 0.07 * sin(_phase) * walk, 0))
	_pose_set("chest", Vector3(-0.025 * run + 0.015 * sin(_time * 1.7), -0.05 * sin(_phase) * walk, 0))

	match posture:
		Posture.CROUCH, Posture.COVER_HEAD:
			for side in ["r", "l"]:
				_side("thigh", side, Vector3(1.55, 0.0, 0.18))
				_side("shin", side, Vector3(-2.2, 0, 0))
				_side("foot", side, Vector3(0.4, 0, 0))
			_pose_set("abdomen", Vector3(-0.45, 0, 0))
			_pose_set("chest", Vector3(-0.3, 0, 0))
			if posture == Posture.COVER_HEAD:
				for side in ["r", "l"]:
					_side("upper_arm", side, Vector3(2.3, 0.3, 0.55))
					_side("forearm", side, Vector3(2.2, 0, 0))
		Posture.AIM:
			# Gun held out in the right hand, the left one supporting it.
			_side("upper_arm", "r", Vector3(1.45, 0.05, 0.12))
			_side("forearm", "r", Vector3(0.12, 0, 0))
			_side("hand", "r", Vector3(0.0, 0, 0))
			_side("upper_arm", "l", Vector3(1.25, 0.0, -0.35))
			_side("forearm", "l", Vector3(0.7, 0, 0))
		Posture.KNEEL:
			# On both knees, sitting up: thighs upright, shins flat behind.
			for side in ["r", "l"]:
				_side("thigh", side, Vector3(0.12, 0.0, 0.08))
				_side("shin", side, Vector3(-1.65, 0, 0))
				_side("foot", side, Vector3(0.7, 0, 0))
			_pose_set("abdomen", Vector3(-0.08, 0, 0))
		Posture.SQUAT:
			# Down on the heels, knees wide, feet flat, leaning in a little,
			# the forearms resting on the knees and the hands hanging.
			for side in ["r", "l"]:
				# (these angles put the hips about 0.41 m up with the feet flat
				# under the knees - the height the balance holds him at)
				_side("thigh", side, Vector3(SQ_THIGH, 0.12, 0.3))
				_side("shin", side, Vector3(SQ_SHIN, 0, 0))
				_side("foot", side, Vector3(SQ_FOOT, 0, 0))
				_side("upper_arm", side, Vector3(0.6, 0.0, 0.22))
				_side("forearm", side, Vector3(0.75, 0, 0))
				_side("hand", side, Vector3(0.35, 0, 0))
			_pose_set("abdomen", Vector3(-0.28, 0, 0))
			_pose_set("chest", Vector3(-0.12, 0, 0))
		Posture.HANDS_UP:
			for side in ["r", "l"]:
				_side("upper_arm", side, Vector3(2.65, 0.0, 0.45))
				_side("forearm", side, Vector3(0.55, 0, 0))
				_side("hand", side, Vector3(-0.3, 0, 0))

	# Hand pressed to a wound.
	if clutch_part != "" and posture != Posture.HANDS_UP:
		var side := "l" if clutch_part.ends_with("_r") or clutch_part == "chest" else "r"
		if arm_health[side] > 0.3:
			var high := clutch_part in ["chest", "head", "upper_arm_r", "upper_arm_l"]
			_side("upper_arm", side, Vector3(0.55 if not high else 0.9, 0.3, -0.35))
			_side("forearm", side, Vector3(1.9 if not high else 2.2, 0.0, 0))

	# Bent over a wound in the belly or chest, more the more it hurts.
	if clutch_part in ["abdomen", "pelvis", "chest"] and not fallen:
		var k := clampf(pain, 0.0, 1.0)
		_pose_set("abdomen", _target[part_index["abdomen"]] + Vector3(-0.32, 0, 0) * k)
		_pose_set("chest", _target[part_index["chest"]] + Vector3(-0.2, 0, 0) * k)
		_pose_set("head", _target[part_index["head"]] + Vector3(-0.2, 0, 0) * k)
		for sd in ["r", "l"]:
			var th: Vector3 = _target[part_index["thigh_" + sd]]
			_pose_set("thigh_" + sd, th + Vector3(0.18, 0, 0) * k)
			var sh: Vector3 = _target[part_index["shin_" + sd]]
			_pose_set("shin_" + sd, sh + Vector3(-0.25, 0, 0) * k)

	# Shaking: shock, pain and blood loss.
	var tremor := clampf(shock * 0.6 + pain * 0.15 + (1.0 - blood / BLOOD_MAX) * 1.5, 0.0, 1.0)
	if tremor > 0.05:
		for i in _target.size():
			var f := 11.0 + float(i) * 1.7
			_target[i] += Vector3(sin(_time * f + i), sin(_time * f * 1.3 + i * 2.0), 0.0) * 0.035 * tremor

	# Flinch / protective hunch after being hit.
	if _flinch > 0.0:
		var f := _flinch
		_pose_set("abdomen", _target[part_index["abdomen"]] + Vector3(-0.12, 0, 0) * f)
		_pose_set("chest", _target[part_index["chest"]] + Vector3(-0.1, 0, 0) * f)
		for side in ["r", "l"]:
			var cur: Vector3 = _target[part_index["upper_arm_" + side]]
			_pose_set("upper_arm_" + side, cur.lerp(Vector3(0.9, 0.0, 0.1 if side == "r" else -0.1), f * 0.35))

	# Cuffed: wrists together behind the back, just over the backside.
	if (cuffed or cuff_prep) and alive:
		# Wrists together behind the back, the way a man in cuffs stands: the
		# arms back, the shoulders turned in, the elbows bent so the hands meet
		# over the small of the back (the chain holds them there, see
		# _update_chain).
		hand_goal = {"r": Vector3.INF, "l": Vector3.INF}
		if posture != Posture.KNEEL or true:
			for side in ["r", "l"]:
				_side("upper_arm", side, CUFF_UPPER)
				_side("forearm", side, CUFF_FORE)
				_side("hand", side, Vector3(0.0, 0.0, 0.0))
	# Hands on a held gun.
	if not fallen:
		for side in ["r", "l"]:
			if hand_goal[side] != Vector3.INF and arm_health[side] > 0.15:
				_arm_ik(side, hand_goal[side])
	# Waving (hello): the right arm up by the head, the forearm to and fro.
	if wave > 0.0 and alive and conscious and not fallen and arm_health["r"] > 0.3:
		_side("upper_arm", "r", Vector3(2.35, 0.0, 0.55).lerp(_target[part_index["upper_arm_r"]], 0.0))
		_side("forearm", "r", Vector3(0.55 + 0.4 * sin(_time * 11.0), 0.0, 0.0))
		_side("hand", "r", Vector3.ZERO)

	# Head tracking.
	if has_look_target:
		# Pitch against the chest (only the head nods), but the turn against
		# the hips: measured against the chest it would chase itself, the
		# spine turning the very thing it is measured from (a wobble).
		var cb := chest.global_basis.orthonormalized()
		var d := cb.inverse() * (look_target - head.global_position)
		var hb := pelvis.global_basis.orthonormalized()
		var dh := hb.inverse() * (look_target - head.global_position)
		if d.length() > 0.05:
			d = d.normalized()
			var yaw := atan2(-dh.x, -dh.z)
			var pitch := asin(clampf(d.y, -1.0, 1.0))
			# The spine takes a share of the turn, the neck the rest.
			var spill := clampf(yaw * 0.35, -0.8, 0.8)
			var neck_yaw := clampf(yaw - spill * 0.8, -1.0, 1.0)
			_pose_set("head", _target[part_index["head"]] + Vector3(clampf(pitch * 0.8, -0.7, 0.55), neck_yaw, 0))
			var ab_t: Vector3 = _target[part_index["abdomen"]]
			_pose_set("abdomen", ab_t + Vector3(0, spill * 0.4, 0))
			var ch_t: Vector3 = _target[part_index["chest"]]
			_pose_set("chest", ch_t + Vector3(0, spill * 0.4, 0))

	# Fallen but conscious: catch the fall, then curl or push up.
	if fallen:
		if _getup > 0.0:
			_pose_getup(_getup)
		elif _fallen_time < 1.2 and pelvis.linear_velocity.length() > 0.6:
			_pose_catch_fall()
		else:
			_pose_writhe()


## Going down awake: both hands go out to where the body is going to land,
## the head is kept up off the ground, the knees give.
func _pose_catch_fall() -> void:
	var v := pelvis.linear_velocity
	var hv := Vector3(v.x, 0.0, v.z)
	var dir := hv.normalized() if hv.length() > 0.2 else -chest.global_basis.z
	var ground := pelvis.global_position.y - maxf(_ground_distance(), 0.0)
	var cb := chest.global_basis.orthonormalized()
	var fwd_fall := dir.dot(-cb.z) > -0.2         # falling forwards (or sideways)
	var reach := chest.global_position + dir * 0.45
	for side in ["r", "l"]:
		if arm_health[side] < 0.2:
			continue
		var sx := 1.0 if side == "r" else -1.0
		var goal := Vector3(reach.x, ground + 0.05, reach.z) + cb.x * 0.2 * sx
		if not fwd_fall:
			# Backwards: hands go back and down behind.
			goal = chest.global_position + dir * 0.3 + cb.x * 0.3 * sx
			goal.y = ground + 0.1
		_arm_ik(side, goal)
	# Head: forwards it comes up (face off the ground), backwards the chin tucks.
	_pose_set("head", Vector3(0.5 if fwd_fall else -0.6, 0, 0))
	for side in ["r", "l"]:
		_side("thigh", side, Vector3(0.35, 0, 0.06))
		_side("shin", side, Vector3(-0.7, 0, 0))
	_pose_set("abdomen", Vector3(-0.15 if fwd_fall else -0.35, 0, 0))


## Down and hurt, still conscious: not a stiff plank. Curled round the
## wound, rolling a little from side to side, knees drawn up and pushing,
## now and then a hand reaching out.
func _pose_writhe() -> void:
	var k := clampf(pain + shock * 0.5, 0.15, 1.0)
	var t := _time + float(bot_seed % 97)
	var roll := sin(t * 0.7) * 0.45 * k
	var writhe := sin(t * 2.3) * 0.25 * k
	for side in ["r", "l"]:
		var sx := 1.0 if side == "r" else -1.0
		var draw := 0.6 + writhe * sx + 0.35 * k
		_side("thigh", side, Vector3(draw, 0, 0.1 + 0.1 * roll * sx))
		_side("shin", side, Vector3(-1.0 - writhe * sx - 0.4 * k, 0, 0))
	_pose_set("abdomen", Vector3(-0.3 - 0.2 * k, roll * 0.6, roll * 0.3))
	_pose_set("chest", Vector3(-0.15 * k, roll * 0.5, 0))
	_pose_set("head", Vector3(0.2 * k, -roll * 0.4, 0))
	# A hand reaching out every so often (the one not on the wound).
	var reach := maxf(sin(t * 0.37), 0.0)
	if reach > 0.3:
		var side := "r" if clutch_part.ends_with("_l") or clutch_part == "" else "l"
		if arm_health[side] > 0.3:
			_side("upper_arm", side, Vector3(1.6 * reach, 0.0, 0.3))
			_side("forearm", side, Vector3(0.3, 0, 0))


## Arm pose (upper arm and elbow bend, relative to the chest) that puts the
## hand on a world point. Solved numerically within what the shoulder and
## elbow can do (a few damped Gauss-Newton steps from last frame's answer),
## with a slight preference for the elbow hanging down - so reaching up to
## the head the elbow comes out to the side by itself, as it must.
func _arm_ik(side: String, goal: Vector3) -> void:
	var cxf := chest.global_transform.orthonormalized()
	var rest_c: Vector3 = chest.get_meta("rest_pos")
	var ua: RigidBody3D = parts[part_index["upper_arm_" + side]]
	var fa: RigidBody3D = parts[part_index["forearm_" + side]]
	var hd: RigidBody3D = parts[part_index["hand_" + side]]
	var js: Vector3 = ua.get_meta("joint_pos")
	var je: Vector3 = fa.get_meta("joint_pos")
	var ch: Vector3 = hd.get_meta("rest_pos")
	var shoulder := cxf * (js - rest_c)
	# Everything in the chest's frame, the left arm mirrored onto the right.
	var g := cxf.basis.inverse() * (goal - shoulder)
	var se := je - js
	var eh := ch - je
	if side == "l":
		g.x = -g.x
		se.x = -se.x
		eh.x = -eh.x
	var p: Vector4 = _ik_solve(_ik_last.get(side, Vector4(0.3, 0.0, 0.2, 0.8)), g, se, eh)
	if g.distance_to(_ik_hand(p, se, eh)) > 0.03:
		# Stuck against a limit: try from a few typical arm poses as well.
		for seed in [Vector4(1.2, -0.2, 0.9, 1.8), Vector4(1.6, 0.4, 0.2, 1.4), Vector4(0.2, 0.0, 1.3, 1.6), Vector4(0.6, 0.0, 0.1, 0.4)]:
			var q := _ik_solve(seed, g, se, eh)
			if g.distance_to(_ik_hand(q, se, eh)) < g.distance_to(_ik_hand(p, se, eh)):
				p = q
	_ik_last[side] = p
	_side("upper_arm", side, Vector3(p.x, p.y, p.z))
	_side("forearm", side, Vector3(p.w, 0.0, 0.0))
	_side("hand", side, Vector3.ZERO)


var _ik_last := {}


func _ik_solve(p: Vector4, g: Vector3, se: Vector3, eh: Vector3) -> Vector4:
	for it in 6:
		var h0 := _ik_hand(p, se, eh)
		var e := g - h0
		if e.length() < 0.004:
			break
		# Numeric Jacobian (3 x 4) and a damped least-squares step.
		var cols: Array[Vector3] = []
		for k in 4:
			var q := p
			q[k] += 0.01
			cols.append((_ik_hand(q, se, eh) - h0) / 0.01)
		var jjt := Basis()
		for r in 3:
			for c in 3:
				var sum := 0.0
				for k in 4:
					sum += cols[k][r] * cols[k][c]
				jjt[c][r] = sum + (0.02 if r == c else 0.0)
		var y := jjt.inverse() * e
		var step := Vector4.ZERO
		for k in 4:
			step[k] = cols[k].dot(y)
		step.y -= p.y * 0.05
		p = _ik_clamp(p + step)
	return p


## The hand (chest frame, right-side authored) for upper arm angles xyz and
## elbow bend w.
static func _ik_hand(p: Vector4, se: Vector3, eh: Vector3) -> Vector3:
	var ub := Basis.from_euler(Vector3(p.x, p.y, p.z))
	return ub * se + ub * Basis(Vector3.RIGHT, p.w) * eh


static func _ik_clamp(p: Vector4) -> Vector4:
	return Vector4(clampf(p.x, -0.9, 2.8), clampf(p.y, -1.3, 1.3), clampf(p.z, -0.7, 2.6), clampf(p.w, 0.0, 2.5))


## Player ragdoll: puts every part where the first-person body had it (joint
## points from the IK body, the view for the head) with the player's velocity,
## and keeps that pose as the muscles' (fading) target.
func match_pose(pts: Dictionary, vel: Vector3) -> void:
	var hip_b: Basis = pts["hips"]
	var chest_b: Basis = pts["chest"]
	var right: Vector3 = hip_b.x
	var xf := {}
	xf["pelvis"] = Transform3D(hip_b, pts["waist"])
	xf["chest"] = Transform3D(chest_b, (pts["waist"] as Vector3) + chest_b * Vector3(0, 0.39, 0))
	xf["abdomen"] = Transform3D(hip_b.slerp(chest_b, 0.5), (pts["waist"] as Vector3) + hip_b.slerp(chest_b, 0.5) * Vector3(0, 0.17, 0))
	var view: Transform3D = pts["view"]
	xf["head"] = Transform3D(view.basis.orthonormalized(), view * Vector3(0, -0.03, 0.09))
	for side in ["r", "l"]:
		for seg in [["thigh", "hip", "knee"], ["shin", "knee", "ankle"], ["upper_arm", "shoulder", "elbow"], ["forearm", "elbow", "wrist"]]:
			var a: Vector3 = pts[seg[1] + "_" + side]
			var b: Vector3 = pts[seg[2] + "_" + side]
			xf[seg[0] + "_" + side] = Transform3D(_limb_basis(a, b, right), (a + b) * 0.5)
		var w: Vector3 = pts["wrist_" + side]
		var fb: Basis = (xf["forearm_" + side] as Transform3D).basis
		xf["hand_" + side] = Transform3D(fb, w - fb.y * 0.09 * scale_factor)
		xf["foot_" + side] = Transform3D(hip_b, (pts["ankle_" + side] as Vector3) + Vector3(0, -0.04, 0) - hip_b.z * 0.05)
	for i in parts.size():
		var n := String(parts[i].name)
		if xf.has(n):
			parts[i].global_transform = xf[n]
			parts[i].reset_physics_interpolation()
		parts[i].linear_velocity = vel
	_held.resize(parts.size())
	for i in parts.size():
		var pi_ := _parent[i]
		if pi_ < 0:
			_held[i] = Vector3.ZERO
			continue
		var qp := parts[pi_].global_basis.orthonormalized().get_rotation_quaternion()
		var qc := parts[i].global_basis.orthonormalized().get_rotation_quaternion()
		_held[i] = Basis(qp.inverse() * qc).get_euler()
	tone = 0.55


## Capsule basis for a limb from the proximal joint a to the distal joint b
## (rest pose: limbs hang, +Y towards the body), X kept towards `right`.
func _limb_basis(a: Vector3, b: Vector3, right: Vector3) -> Basis:
	var y := (a - b).normalized()
	var x := (right - y * right.dot(y))
	x = x.normalized() if x.length() > 1e-3 else y.cross(Vector3.FORWARD).normalized()
	return Basis(x, y, x.cross(y))


## Getting up, in stages over 3 s: roll onto the front with knees tucked and
## hands under the shoulders, push up onto one knee, then stand.
func _pose_getup(g: float) -> void:
	if g < 0.9:
		for side in ["r", "l"]:
			_side("thigh", side, Vector3(1.5, 0, 0.15))
			_side("shin", side, Vector3(-2.2, 0, 0))
			_side("upper_arm", side, Vector3(1.1, 0, 0.25))
			_side("forearm", side, Vector3(1.4, 0, 0))
		_pose_set("abdomen", Vector3(-0.4, 0, 0))
	elif g < 1.9:
		# Kneeling on the left knee, right foot planted.
		var k := smoothstep(0.9, 1.5, g)
		_side("thigh", "l", Vector3(lerpf(1.5, 0.3, k), 0, 0.1))
		_side("shin", "l", Vector3(lerpf(-2.2, -1.6, k), 0, 0))
		_side("thigh", "r", Vector3(1.5, 0, 0.1))
		_side("shin", "r", Vector3(lerpf(-2.2, -1.5, k), 0, 0))
		for side in ["r", "l"]:
			_side("upper_arm", side, Vector3(lerpf(1.1, 0.5, k), 0, 0.2))
			_side("forearm", side, Vector3(lerpf(1.4, 0.6, k), 0, 0))
		_pose_set("abdomen", Vector3(lerpf(-0.4, -0.25, k), 0, 0))
		_pose_set("chest", Vector3(-0.15, 0, 0))
	else:
		# Stand up out of the kneel.
		var k := smoothstep(1.9, 2.9, g)
		_side("thigh", "l", Vector3(0.3 * (1.0 - k), 0, 0.05))
		_side("shin", "l", Vector3(-1.6 * (1.0 - k), 0, 0))
		_side("thigh", "r", Vector3(1.5 * (1.0 - k), 0, 0.05))
		_side("shin", "r", Vector3(-1.5 * (1.0 - k), 0, 0))
		_pose_set("abdomen", Vector3(-0.25 * (1.0 - k), 0, 0))


## Lying on the back: turn over onto the front to get up.
func _roll_prone() -> void:
	var front := -chest.global_basis.z
	if front.y > 0.25:
		var axis := pelvis.global_basis.y
		var side := signf(chest.global_basis.x.y) if absf(chest.global_basis.x.y) > 0.05 else 1.0
		var tq := axis * 55.0 * side * scale_factor
		chest.apply_torque(tq)
		pelvis.apply_torque(tq * 0.8)


## Weak, asymmetric involuntary arm posture right after a brain injury (one
## arm extends, the other flexes). Legs and trunk are left to gravity.
## How far into the spasm after a shot to the brain, 0..1: in almost at
## once, held a moment, then let go slowly.
func _spasm() -> float:
	var t := _death_t
	return smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.35, HEADSHOT_SPASM, t))


func _pose_decerebrate() -> void:
	# How far into the spasm: in almost at once, held a moment, then let go
	# slowly (the tone is fading at the same time, see _update_state).
	var t := _death_t
	var k := _spasm()
	# Both arms: the elbows bend right up and the fists are drawn in to the
	# wound (to the head, beside where it went in), the wrists curl.
	var wound: Vector3 = head.global_transform * (_head_wound if _head_wound != Vector3.INF else Vector3(0, 0, -0.08))
	var hc := head.global_position
	var out := (wound - hc)
	out = out.normalized() if out.length() > 0.01 else -head.global_basis.z
	var cb := chest.global_basis.orthonormalized()
	for side in ["r", "l"]:
		var sx := 1.0 if side == "r" else -1.0
		# Just off the head at the wound, the two fists side by side.
		var goal := wound + out * 0.07 + cb.x * 0.05 * sx - cb.z * 0.04
		_arm_ik(side, goal)
		var ua: Vector3 = _target[part_index["upper_arm_" + side]]
		var fa: Vector3 = _target[part_index["forearm_" + side]]
		# All the way at the elbow, whatever the reach.
		fa.x = maxf(fa.x, 2.3)
		_pose_set("upper_arm_" + side, ua * k)
		_pose_set("forearm_" + side, fa * k)
		_side("hand", side, Vector3(0.6, 0.0, 0.0) * k)
	# The whole body draws in - less than the arms: the trunk curls, the
	# chin drops, hips and knees bend a touch.
	_pose_set("abdomen", Vector3(-0.22, 0, 0) * k)
	_pose_set("chest", Vector3(-0.12, 0, 0) * k)
	_pose_set("head", Vector3(-0.2, 0, 0) * k)
	# The knees fold at once (that is what drops him where he stands), the
	# hips follow.
	var drop := smoothstep(0.0, 0.1, t)
	for side in ["r", "l"]:
		_side("thigh", side, Vector3(0.7 * drop, 0.0, 0.05))
		_side("shin", side, Vector3(-1.3 * drop, 0.0, 0.0))
		_side("foot", side, Vector3(0.3 * drop, 0.0, 0.0))


## Muscles: each joint runs a velocity servo on the Jolt joint motors. The
## pose error is turned into a desired relative angular velocity; the motor
## force limit is the muscle strength (scaled by tone). Solved implicitly by
## the physics engine, so it stays stable even for light segments. At very
## low tone the motor just acts as joint friction.
func _apply_muscles() -> void:
	for i in parts.size():
		var pi_ := _parent[i]
		if pi_ < 0:
			continue
		var c := parts[i]
		var p := parts[pi_]
		var pb := p.global_transform.basis.orthonormalized()
		var qp := pb.get_rotation_quaternion()
		var qc := c.global_transform.basis.get_rotation_quaternion()
		var qe := (qp * Quaternion.from_euler(_target[i])) * qc.inverse()
		if qe.w < 0.0:
			qe = -qe
		var v := Vector3(qe.x, qe.y, qe.z)
		var s := v.length()
		var err := Vector3.ZERO
		if s > 1e-6:
			err = v / s * (2.0 * atan2(s, qe.w))
		var t_i := tone * _weak[i] * _hit_weak[i]
		if cuffed and _arm[i] == 1:
			t_i *= 0.3        # the cuffs hold the arms: they only hang back in them
		if _death_kind == "headshot" and _death_t >= 0.0 and _death_t < HEADSHOT_SPASM and _arm[i] == 1:
			t_i = maxf(t_i, 0.95 * _spasm())
		if _death_t >= 0.0 and _arm[i] == 0:
			# Trunk and legs go limp first; after a shot to the head they
			# still draw in with the arms, only weaker.
			# The legs give at once all the same: he drops, curling as he goes.
			t_i *= 0.4 if _death_kind == "headshot" and _death_t < HEADSHOT_SPASM else 0.15
		if player_owner and conscious and alive and parts[i] == head:
			t_i = maxf(t_i, 0.8)   # the player still holds their head up and looks around
		var des := (pb.transposed() * err) * _omega[i] * clampf(t_i, 0.0, 1.0)
		des = des.limit_length(14.0)
		var rid := _joint_rid[i]
		if not rid.is_valid():
			continue          # torn off
		# Jolt measures joint angles with the opposite sign, see _add_part().
		PhysicsServer3D.generic_6dof_joint_set_param(rid, VECTOR3_AXIS_X, PARAM_VEL, -des.x)
		PhysicsServer3D.generic_6dof_joint_set_param(rid, VECTOR3_AXIS_Y, PARAM_VEL, -des.y)
		PhysicsServer3D.generic_6dof_joint_set_param(rid, VECTOR3_AXIS_Z, PARAM_VEL, -des.z)
		# Awake, a joint never goes fully slack; out cold or dead only a trace of
		# friction is left, so the body folds and flops instead of toppling stiff.
		var limit := _max_torque[i] * maxf(t_i, 0.02 if (conscious and not feign) else 0.004)
		if absf(limit - _motor_limit[i]) > _max_torque[i] * 0.01:
			_motor_limit[i] = limit
			for axis in [VECTOR3_AXIS_X, VECTOR3_AXIS_Y, VECTOR3_AXIS_Z]:
				PhysicsServer3D.generic_6dof_joint_set_param(rid, axis, PARAM_FORCE, limit)


## Balance assist: vertical support spring on pelvis/chest, horizontal drive
## toward the desired velocity and an upright + heading torque.
func _apply_balance() -> void:
	var h := _ground_distance()
	var target_h := stand_height
	var speed := Vector2(move_velocity.x, move_velocity.z).length()
	target_h -= 0.03 * clampf(speed, 0.0, 1.0) + 0.07 * clampf((speed - 1.6) / 2.4, 0.0, 1.0)
	if posture == Posture.CROUCH or posture == Posture.COVER_HEAD:
		target_h = 0.56 * scale_factor
	elif posture == Posture.KNEEL:
		target_h = 0.5 * scale_factor
	elif posture == Posture.SQUAT:
		target_h = 0.41 * scale_factor
	var limp := 1.0 - minf(leg_health["l"], leg_health["r"])
	target_h -= limp * 0.08 + 0.02 * absf(sin(_phase * 2.0)) * limp
	if fallen and _getup > 0.0:
		# Knees and hands, then a knee, then up.
		var low := lerpf(0.22, 0.5, smoothstep(0.7, 1.6, _getup)) * scale_factor
		target_h = lerpf(low, target_h, smoothstep(1.8, 2.9, _getup))
		if _getup < 0.9:
			_roll_prone()

	var sup := support
	# Down on the heels the legs carry him: the hold only keeps him there,
	# gently, instead of heaving him up and down against his own legs.
	var soft := 0.45 if posture == Posture.SQUAT else 1.0
	if h > 0.0 and h < 1.7:
		var err := target_h - h
		var vy := pelvis.linear_velocity.y
		var damp := 16.0 * sqrt(soft) if posture != Posture.SQUAT else 15.0
		var acc := clampf(G * soft + err * 90.0 * soft - vy * damp, 0.0, G * 2.8)
		var f := total_mass * acc * sup
		pelvis.apply_central_force(Vector3.UP * f * 0.62)
		chest.apply_central_force(Vector3.UP * f * 0.38)

		# Horizontal drive.
		var v := pelvis.linear_velocity
		var hv := Vector3(v.x, 0, v.z)
		var want := move_velocity + _stumble_dir * 1.8 * _stumble
		# Squatting the feet stay planted where they were put down, and the
		# hips sit just behind the heels between them (the leaning trunk
		# keeps the weight over the feet) - held there, not rocking about.
		if posture == Posture.SQUAT and not fallen:
			var fr := parts[part_index["foot_r"]]
			var fl := parts[part_index["foot_l"]]
			if _squat_at == Vector3.INF:
				_squat_at = pelvis.global_position
				_squat_feet = [fr.global_position, fl.global_position]
			for k in 2:
				var foot: RigidBody3D = fr if k == 0 else fl
				var d: Vector3 = (_squat_feet[k] as Vector3) - foot.global_position
				var fv := foot.linear_velocity
				# Held flat where it was put: not sliding, not lifting off (only
				# pressed down - the ground holds it up).
				var fa := Vector3(d.x * 200.0 - fv.x * 22.0, minf(d.y * 200.0 - fv.y * 22.0, 0.0), d.z * 200.0 - fv.z * 22.0).limit_length(60.0)
				foot.apply_central_force(fa * foot.mass * sup)
				foot.apply_torque(-foot.angular_velocity * 0.6 * sup)
			var mid: Vector3 = ((_squat_feet[0] as Vector3) + (_squat_feet[1] as Vector3)) * 0.5
			var f_dir := Vector3(facing.x, 0.0, facing.z)
			f_dir = f_dir.normalized() if f_dir.length() > 0.01 else -pelvis.global_basis.z
			var seat := mid - f_dir * 0.1 - pelvis.global_position
			want = Vector3(seat.x, 0.0, seat.z) * 4.0
		else:
			_squat_at = Vector3.INF
			_squat_feet = []
		# On his knees the hips stay over the knees (thighs upright) - not
		# pushed out ahead of them with the body leaning over.
		if posture == Posture.KNEEL and not fallen:
			var knees := (joint_world_pos(parts[part_index["shin_r"]]) + joint_world_pos(parts[part_index["shin_l"]])) * 0.5
			var off := knees - pelvis.global_position
			want = Vector3(off.x, 0.0, off.z) * 4.0
		var dv := (Vector3(want.x, 0, want.z) - hv)
		var drive := (dv * 7.0).limit_length(8.0) * total_mass * sup
		# (mostly at the hips: pulled along by the chest he would topple forward)
		pelvis.apply_central_force(drive * 0.75)
		chest.apply_central_force(drive * 0.25)

	# Upright and heading.
	var fwd := Vector3(facing.x, 0, facing.z)
	if fwd.length() < 0.01:
		fwd = -pelvis.global_basis.z
	fwd = fwd.normalized()
	# (a runner leans into it only a little - more reads as falling over)
	var lean := clampf(Vector2(move_velocity.x, move_velocity.z).length() * 0.01, 0.0, 0.04)
	var up := (Vector3.UP + fwd * lean).normalized()
	var target := Basis.looking_at(fwd, up)
	# Down on the heels the body leans forward over the feet (the weight has
	# to be over them, or he sits back and topples).
	var p_target := target.rotated(target.x, -SQ_LEAN) if posture == Posture.SQUAT else target
	_upright_torque(pelvis, p_target, 9.0, 7.0 * sup)
	var ch_target := target
	if posture == Posture.CROUCH or posture == Posture.COVER_HEAD:
		ch_target = target.rotated(target.x, -0.6)
	elif posture == Posture.SQUAT:
		ch_target = target.rotated(target.x, -0.55)
	_upright_torque(chest, ch_target, 3.0, 5.0 * sup)


## Upright/heading assist. The torso chain is stiff (motors), so the torque
## is spread over pelvis, abdomen and chest and damped with their average
## angular velocity, which keeps the explicit torque stable.
func _upright_torque(b: RigidBody3D, target: Basis, inertia: float, strength: float) -> void:
	if strength <= 0.0:
		return
	var qe := target.get_rotation_quaternion() * b.global_transform.basis.get_rotation_quaternion().inverse()
	if qe.w < 0.0:
		qe = -qe
	var v := Vector3(qe.x, qe.y, qe.z)
	var s := v.length()
	var err := Vector3.ZERO
	if s > 1e-6:
		err = v / s * (2.0 * atan2(s, qe.w))
	var ab := parts[part_index["abdomen"]]
	var w_avg := (pelvis.angular_velocity + ab.angular_velocity + chest.angular_velocity) / 3.0
	var w := strength
	var tq := ((err * w * w - w_avg * 2.0 * w) * inertia).limit_length(900.0)
	b.apply_torque(tq * 0.5)
	ab.apply_torque(tq * 0.25)
	(chest if b == pelvis else pelvis).apply_torque(tq * 0.25)


# --- Damage ---------------------------------------------------------------------------------

func receive_hit(body: RigidBody3D, point: Vector3, dir: Vector3, impulse: float, weapon: String) -> void:
	wake()
	body.apply_impulse(dir * impulse, point - body.global_position)
	if player_owner:
		player_owner.vitals.hurt_part(body.get_meta("part"), weapon)
	var part: String = body.get_meta("part")
	var local := body.global_transform.affine_inverse() * point
	var pellet := weapon == "shotgun" or weapon == "frag"
	var dmg := 0.55 if pellet else 1.0
	Game.play_3d(Sfx.get_stream(&"flesh"), point, -4.0, 0.15, 4.0)
	Game.bot_hurt.emit(self, point)

	var was_alive := alive
	var bleed_before := bleed_rate
	var wound_kind := "limb"
	var arterial := false
	_flinch = minf(_flinch + 0.7 * dmg, 1.0)
	_flinch_dir = dir
	_stagger += (0.18 if pellet else 0.28) * dmg * (0.6 + 0.4 * absf(dir.y))
	# A hit to the legs or a heavy blow makes a standing person stumble.
	if alive and not fallen and (part.begins_with("thigh") or part.begins_with("shin") or part.begins_with("foot") or part == "pelvis" or _stagger > 0.45):
		_stumble = 1.0
		_stumble_dir = Vector3(dir.x, 0, dir.z).normalized()
	pain = minf(pain + 0.5 * dmg, 1.5)
	shock += 0.08 * dmg
	var side := "r" if part.ends_with("_r") else "l"
	knock_muscle(part, 0.95 * dmg)

	if part == "head":
		if local.y < -0.075 * scale_factor:
			# Neck: jugular/carotid bleed, not instantly fatal.
			bleed_rate += 38.0 * dmg
			shock += 0.3
			clutch_part = "head"
			wound_kind = "neck"
			arterial = true
		else:
			wound_kind = "head"
			_head_wound = head.to_local(point)
			if soft_head == null:
				soft_head = SoftHead.new()
				soft_head.name = "SoftHead"
				add_child(soft_head)
				soft_head.setup(self)
			soft_head.hit(point, dir, weapon)
			_die("headshot")
			if Game.blood:
				# The smashed skull: torn vessels of the scalp and brain pour out
				# of the exit hole with every beat the heart has left.
				var hd := dir.normalized()
				var big := weapon in ["akm", "shotgun", "frag", "rifle"]
				Game.blood.open_jet(self, head, head.global_position + hd * 0.1, (hd + Vector3.UP * 0.2).normalized(), 100.0 if big else 65.0, true)
				Game.blood.open_jet(self, head, point - hd * 0.01, -hd, 14.0, true)
	elif part == "chest":
		var heart := local.x < 0.02 and local.x > -0.1 and local.y < 0.05
		bleed_rate += (55.0 if heart else 14.0) * dmg
		shock += (0.7 if heart else 0.22) * dmg
		clutch_part = "chest"
		wound_kind = "torso"
		arterial = heart
	elif part == "abdomen":
		bleed_rate += 9.0 * dmg
		shock += 0.2 * dmg
		clutch_part = "abdomen"
		wound_kind = "torso"
	elif part == "pelvis":
		bleed_rate += 10.0 * dmg
		leg_health["l"] -= 0.15 * dmg
		leg_health["r"] -= 0.15 * dmg
		clutch_part = "pelvis"
		wound_kind = "torso"
	elif part.begins_with("thigh"):
		var femoral := rng.randf() < 0.15
		arterial = femoral
		bleed_rate += (40.0 if femoral else 5.0) * dmg
		leg_health[side] -= 0.4 * dmg
		_weak[part_index[part]] *= 0.75
		clutch_part = part
		_stagger += 0.5 * dmg
	elif part.begins_with("shin") or part.begins_with("foot"):
		bleed_rate += 3.0 * dmg
		leg_health[side] -= 0.3 * dmg
		_weak[part_index[part]] *= 0.7
		_stagger += 0.4 * dmg
	else:
		bleed_rate += 3.0 * dmg
		arm_health[side] -= 0.35 * dmg
		_weak[part_index[part]] *= 0.6
		if part.begins_with("upper"):
			clutch_part = part
	for k in leg_health:
		leg_health[k] = clampf(leg_health[k], 0.0, 1.0)
	for k in arm_health:
		arm_health[k] = clampf(arm_health[k], 0.0, 1.0)
	# The hole itself, and where it came out (the head does its own).
	if part != "head" and weapon in ["pistol", "akm", "rifle", "shotgun", "revolver", "frag"] and Game.blood:
		var out_at: Vector3 = Game.blood._exit_point(self, body, point, dir)
		FleshWounds.bullet(body, point, dir, out_at, weapon in ["akm", "rifle", "revolver"])
	# Bits of flesh torn out where the bullet leaves (the head does its own).
	if Game.gibs and part != "head" and weapon in ["pistol", "akm", "rifle", "shotgun", "revolver", "frag"]:
		var n_bits := {"pistol": 2, "revolver": 3, "akm": 4, "rifle": 4, "shotgun": 1, "frag": 1}[weapon] as int
		if not pellet or randf() < 0.5:
			var ex: Vector3 = Game.blood._exit_point(self, body, point, dir) if Game.blood else Vector3.INF
			Game.gibs.burst(ex if ex != Vector3.INF else point, dir if ex != Vector3.INF else -dir, n_bits, 5.5 if ex != Vector3.INF else 2.5, 0.45)
	if Game.blood:
		# A shot to the brain still leaks, it just does not pump.
		var added := bleed_rate - bleed_before if wound_kind != "head" else 8.0
		Game.blood.on_hit(self, body, point, dir, weapon, wound_kind, added, arterial)
	if was_alive and ai:
		ai.on_hurt(point, dir)


## A blow or a bullet takes the muscle out of the part it lands on for a
## moment (so the limb really gives to it), and half as much out of the
## parts next to it; it comes back within a second.
func knock_muscle(part: String, amount: float) -> void:
	if not part_index.has(part):
		return
	var i: int = part_index[part]
	_hit_weak[i] = minf(_hit_weak[i], 1.0 - clampf(amount, 0.0, 1.0))
	var near := []
	if _parent[i] >= 0:
		near.append(_parent[i])
	for j in parts.size():
		if _parent[j] == i:
			near.append(j)
	for j in near:
		_hit_weak[j] = minf(_hit_weak[j], 1.0 - clampf(amount * 0.5, 0.0, 1.0))


## Pressure wave from an explosion `d` metres away. Up close it throws the
## body, knocks it down, stuns or kills; further out it staggers and scares.
func blast(origin: Vector3, power: float, d: float) -> void:
	wake()
	_blast_until = Game.clock + 1.0
	var k := power / maxf(d * d, 0.25)
	for p in parts:
		var off := p.global_position - origin
		var dir := off.normalized() if off.length() > 0.01 else Vector3.UP
		p.apply_central_impulse((dir * minf(k * 40.0, 70.0) + Vector3.UP * minf(k * 14.0, 25.0)) * p.mass / 5.0)
	# Limbs close to the blast are torn off (hands and feet first, then the
	# forearms and shins, then whole arms and legs; right by it the head too) -
	# the dead as well as the living.
	var torn := 0
	var most := 2 + int(clampf(k * 6.0, 0.0, 4.0))
	for pname in ["hand_r", "hand_l", "foot_r", "foot_l", "forearm_r", "forearm_l", "shin_r", "shin_l", "upper_arm_r", "upper_arm_l", "thigh_r", "thigh_l", "head"]:
		if torn >= most or not part_index.has(pname):
			continue
		var part: RigidBody3D = parts[part_index[pname]]
		if part.has_meta("severed"):
			continue
		var pd := part.global_position.distance_to(origin)
		var kp := power / maxf(pd * pd, 0.1)
		var need := 0.2 if pname.begins_with("hand") or pname.begins_with("foot") else (0.32 if pname.begins_with("fore") or pname.begins_with("shin") else 0.55)
		if pname == "head":
			need = 1.4
		if kp > need and rng.randf() < clampf((kp - need) * 0.8 + 0.35, 0.0, 0.95):
			sever(pname, (part.global_position - origin).normalized(), 1.0 + minf(kp * 0.4, 2.0))
			torn += 1
	if not alive:
		return
	shock += k * 2.2
	pain = minf(pain + k * 3.0, 1.5)
	_stagger += k * 4.0
	bleed_rate += k * 40.0
	if k > 0.07:
		_fall()
	if k > 0.13 or torn >= 2:
		bleed_rate += 60.0
		_die("blast")
	Game.bot_hurt.emit(self, chest.global_position)
	if ai:
		ai.on_hurt(origin, (chest.global_position - origin).normalized())


## Tears a limb off at its joint: the joint goes, both ends get a raw stump,
## the stump on the body pumps blood, the loose piece flies off with the blast.
func sever(pname: String, dir: Vector3, push := 1.0) -> void:
	wake()
	var i: int = part_index[pname]
	var child := parts[i]
	if child.has_meta("severed") or _parent[i] < 0:
		return
	var parent := parts[_parent[i]]
	var joint_world := joint_world_pos(child)
	var j := get_node_or_null("J_" + pname)
	if j:
		j.queue_free()
	_joint_rid[i] = RID()
	child.set_meta("severed", true)
	child.apply_central_impulse((dir * 6.0 * child.mass + Vector3.UP * 2.0) * push)
	# Raw ends: torn, ragged flesh round a bone end on both pieces.
	var axis := (child.global_position - joint_world).normalized()
	_ragged_cap(parent, joint_world, -axis, _part_radius(child), pname in ["abdomen", "chest"])
	_ragged_cap(child, joint_world, axis, _part_radius(child), pname in ["abdomen", "chest"])
	var side := "r" if pname.ends_with("_r") else "l"
	if pname.begins_with("thigh") or pname.begins_with("shin") or pname.begins_with("foot"):
		leg_health[side] = 0.0
	elif pname.ends_with("_r") or pname.ends_with("_l"):
		arm_health[side] = 0.0
	bleed_rate += 35.0
	shock += 0.25
	if Game.blood:
		Game.blood.on_hit(self, parent, joint_world, dir, "frag", "limb", 45.0, true)
		Game.blood.on_hit(self, child, joint_world, -dir, "frag", "limb", 10.0, false)
		# The open vessels of the stump: a stream under pressure.
		Game.blood.open_jet(self, parent, joint_world + axis * 0.01, axis, _stump_flow(pname), pname == "head")
	Game.play_3d(Sfx.get_stream(&"flesh"), joint_world, 2.0, 0.1, 5.0)


## Where the joint to the parent is now (it moves with the part).
func joint_world_pos(part: RigidBody3D) -> Vector3:
	var jp: Vector3 = part.get_meta("joint_pos")
	var rest: Vector3 = part.get_meta("rest_pos")
	return part.global_transform * (jp - rest)


func _part_radius(part: RigidBody3D) -> float:
	var cs := part.get_child(0) as CollisionShape3D
	for c in part.get_children():
		if c is CollisionShape3D:
			cs = c
			break
	if cs and cs.shape is CapsuleShape3D:
		return (cs.shape as CapsuleShape3D).radius
	if cs and cs.shape is BoxShape3D:
		var e: Vector3 = (cs.shape as BoxShape3D).size
		return minf(e.x, e.z) * 0.5
	return 0.05 * scale_factor


static var _cap_mats := {}


static func _cap_mat(key: String) -> StandardMaterial3D:
	if _cap_mats.has(key):
		return _cap_mats[key]
	var m := StandardMaterial3D.new()
	match key:
		"flesh":
			m.albedo_color = Color(0.42, 0.035, 0.03)
			m.roughness = 0.3
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
		"fat":
			m.albedo_color = Color(0.85, 0.72, 0.45)
			m.roughness = 0.45
		"bone":
			m.albedo_color = Color(0.92, 0.88, 0.78)
			m.roughness = 0.6
		"gut":
			# Wet, glossy, pinkish grey, a little translucent.
			m.albedo_color = Color(0.7, 0.46, 0.43)
			m.roughness = 0.14
			m.metallic_specular = 0.9
			m.subsurf_scatter_enabled = true
			m.subsurf_scatter_strength = 0.6
			m.rim_enabled = true
			m.rim = 0.25
			m.rim_tint = 0.6
		"liver":
			m.albedo_color = Color(0.3, 0.05, 0.05)
			m.roughness = 0.25
	# Cut faces are seen from either side (a slice can face either way).
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	_cap_mats[key] = m
	return m


## A cut or torn end: a ragged disc of raw flesh (the outline zig-zags), a
## rim of fat under the skin, the bone in the middle; through the trunk also
## the spine and coils of gut and dark organ showing in the cut.
func _ragged_cap(body: RigidBody3D, at: Vector3, normal: Vector3, radius: float, trunk := false) -> void:
	var n := normal.normalized()
	var u := n.cross(Vector3.UP)
	u = u.normalized() if u.length() > 0.05 else n.cross(Vector3.RIGHT).normalized()
	var v := n.cross(u)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var ring := PackedVector3Array()
	var count := 14
	for k in count:
		var a := float(k) / count * TAU
		var r := radius * (1.02 + rng.randf_range(-0.15, 0.2) * (1.0 if k % 2 == 0 else 0.5))
		ring.append((u * cos(a) + v * sin(a)) * r + n * rng.randf_range(-0.008, 0.012))
	for k in count:
		st.set_normal(n)
		st.add_vertex(n * 0.004)
		st.add_vertex(ring[k])
		st.add_vertex(ring[(k + 1) % count])
	var disc := MeshInstance3D.new()
	disc.mesh = st.commit()
	disc.material_override = _cap_mat("flesh")
	disc.layers = 2
	body.add_child(disc)
	disc.global_transform = Transform3D(Basis(), at)
	var fat := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = radius * 0.78
	tm.outer_radius = radius * 0.95
	tm.rings = 14
	tm.ring_segments = 4
	fat.mesh = tm
	fat.material_override = _cap_mat("fat")
	body.add_child(fat)
	fat.global_transform = Transform3D(Basis(u, n, -v).scaled_local(Vector3(1, 0.15, 1)), at + n * 0.002)
	var bone := MeshInstance3D.new()
	var bm := CylinderMesh.new()
	bm.top_radius = radius * (0.35 if trunk else 0.28)
	bm.bottom_radius = bm.top_radius * 1.1
	bm.height = 0.03
	bone.mesh = bm
	bone.material_override = _cap_mat("bone")
	body.add_child(bone)
	var bone_off := -v * radius * 0.45 if trunk else Vector3.ZERO     # the spine is at the back
	bone.global_transform = Transform3D(Basis(u, n, -v), at + n * 0.008 + bone_off)
	if trunk:
		for k in 5:
			var g := MeshInstance3D.new()
			var gt := TorusMesh.new()
			gt.inner_radius = 0.012
			gt.outer_radius = 0.03
			gt.rings = 10
			gt.ring_segments = 6
			g.mesh = gt
			g.material_override = _cap_mat("gut")
			body.add_child(g)
			var off := (u * rng.randf_range(-0.6, 0.6) + v * rng.randf_range(-0.1, 0.6)) * radius
			g.global_transform = Transform3D(Basis(u, n, -v).rotated(n, rng.randf() * TAU), at + off + n * 0.01)
		var liver := MeshInstance3D.new()
		var lm := SphereMesh.new()
		lm.radius = radius * 0.3
		lm.height = radius * 0.35
		liver.mesh = lm
		liver.material_override = _cap_mat("liver")
		body.add_child(liver)
		liver.global_position = at + u * radius * 0.4 + v * radius * 0.2 + n * 0.01


## Chainsaw through a body part (or a piece already cut off) along the plane
## of the blade: every mesh on it is cut, both halves get a closed cut face
## (skin and fat round the edge, torn flesh, the bone where the plane crosses
## it, organs in the trunk) and their own convex collision. The half that is
## still joined to the body stays; the other falls free, taking with it any
## part hanging beyond the cut (the hand when the forearm is cut across).
func saw_slice(body: RigidBody3D, point: Vector3, normal: Vector3) -> void:
	wake()
	var pname: String = body.get_meta("part")
	var local_plane := Plane((body.global_basis.inverse() * normal).normalized(), body.to_local(point))
	var is_part := parts.has(body)
	var idx: int = part_index[pname] if is_part else -1
	# Which side stays: the one with the joint to the parent (for the pelvis,
	# the waist; for a loose piece, the bigger half).
	var keep_pos := true
	var anchor := Vector3.INF
	if is_part and _parent[idx] >= 0:
		anchor = body.to_local(joint_world_pos(body))
	elif is_part:
		anchor = body.to_local(joint_world_pos(parts[part_index["abdomen"]]))
	var cuts := []        # [MeshInstance3D, result]
	var pos_pts := PackedVector3Array()
	var neg_pts := PackedVector3Array()
	for c in body.get_children():
		var mi := c as MeshInstance3D
		if mi == null or not mi.visible or mi.mesh == null or not mi.is_inside_tree():
			continue
		var mplane: Plane = mi.transform.affine_inverse() * local_plane
		var r := Slicer.slice(mi.mesh, mplane, mi.material_override)
		cuts.append([mi, r])
		for p in r["pos_pts"]:
			pos_pts.append(mi.transform * p)
		for p in r["neg_pts"]:
			neg_pts.append(mi.transform * p)
	if pos_pts.size() < 4 or neg_pts.size() < 4:
		return      # the blade only grazed it
	if anchor != Vector3.INF:
		keep_pos = local_plane.distance_to(anchor) >= 0.0
	else:
		keep_pos = pos_pts.size() >= neg_pts.size()
	var keep_pts := pos_pts if keep_pos else neg_pts
	var free_pts := neg_pts if keep_pos else pos_pts
	# The loose half.
	var piece := RigidBody3D.new()
	piece.collision_layer = Game.LAYER_BOTS
	piece.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_PLAYER
	piece.set_meta("humanoid", self)
	piece.set_meta("part", pname)
	piece.set_meta("piece", true)
	var share := clampf(float(free_pts.size()) / (pos_pts.size() + neg_pts.size()), 0.1, 0.9)
	piece.mass = maxf(body.mass * share, 0.1)
	body.mass = maxf(body.mass * (1.0 - share), 0.1)
	piece.angular_damp = 0.3
	get_parent().add_child(piece)
	piece.global_transform = body.global_transform
	_ray_exclude.append(piece.get_rid())
	for cut in cuts:
		var mi: MeshInstance3D = cut[0]
		var r: Dictionary = cut[1]
		var kept = r["pos"] if keep_pos else r["neg"]
		var gone = r["neg"] if keep_pos else r["pos"]
		if gone:
			var copy := MeshInstance3D.new()
			copy.mesh = gone
			copy.material_override = mi.material_override
			copy.layers = mi.layers
			copy.transform = mi.transform
			piece.add_child(copy)
			for k in ["rest_x", "rest_y", "rest_z", "hole0", "hole1", "hole2", "hole3"]:
				var v = mi.get_instance_shader_parameter(k)
				if v != null:
					copy.set_instance_shader_parameter(k, v)
		if kept:
			mi.mesh = kept
		else:
			mi.visible = false
		# Close the opening on both halves (only for a real surface cut).
		if (r["ring"] as PackedVector3Array).size() >= 6:
			var ring := PackedVector3Array()
			for p in r["ring"]:
				ring.append(mi.transform * p)
			var n_keep := -local_plane.normal if keep_pos else local_plane.normal
			for side in [[body, n_keep], [piece, -n_keep]]:
				var capped := Slicer.cap(ring, side[1], _cap_mat("fat"), _cap_mat("flesh"), rng)
				if capped[0]:
					var cm := MeshInstance3D.new()
					cm.mesh = capped[0]
					cm.layers = 2
					(side[0] as Node3D).add_child(cm)
	var section := PackedVector3Array()
	for cut in cuts:
		for p in (cut[1] as Dictionary)["ring"]:
			section.append((cut[0] as MeshInstance3D).transform * p)
	_cut_bone(body, piece, pname, local_plane, keep_pos, section)
	# Collision from what each half has left.
	for c in body.get_children():
		if c is CollisionShape3D:
			var hull := ConvexPolygonShape3D.new()
			hull.points = Slicer.hull_points(keep_pts)
			(c as CollisionShape3D).shape = hull
			(c as CollisionShape3D).transform = Transform3D.IDENTITY
			break
	var pcs := CollisionShape3D.new()
	var phull := ConvexPolygonShape3D.new()
	phull.points = Slicer.hull_points(free_pts)
	pcs.shape = phull
	piece.add_child(pcs)
	for p in parts:
		piece.add_collision_exception_with(p)
	get_tree().create_timer(0.4).timeout.connect(func():
		if is_instance_valid(piece):
			for p in parts:
				if is_instance_valid(p):
					piece.remove_collision_exception_with(p))
	var away := local_plane.normal if not keep_pos else -local_plane.normal
	piece.linear_velocity = body.linear_velocity + body.global_basis * away * 0.4
	piece.angular_velocity = body.angular_velocity
	# Anything hanging off beyond the cut goes with the loose half.
	if is_part:
		for j in parts.size():
			if _parent[j] != idx or parts[j].has_meta("severed"):
				continue
			var jp := body.to_local(joint_world_pos(parts[j]))
			if (local_plane.distance_to(jp) >= 0.0) != keep_pos:
				_rejoin(parts[j], piece, joint_world_pos(parts[j]))
	# What it does to the person.
	var across: bool = absf(local_plane.normal.y) > 0.5
	if pname in ["chest", "abdomen", "pelvis"]:
		bleed_rate += 120.0
		if pname == "abdomen" or pname == "pelvis":
			_spill_guts(body, point)
		_die("bleed_out")
	elif pname == "head":
		_die("headshot")
	else:
		bleed_rate += 35.0 if across else 20.0
		shock += 0.25
		var side := "r" if pname.ends_with("_r") else "l"
		if across and is_part:
			if pname.begins_with("thigh") or pname.begins_with("shin") or pname.begins_with("foot"):
				leg_health[side] = 0.0
			else:
				arm_health[side] = 0.0
	if Game.blood:
		Game.blood.on_hit(self, body, point, -normal, "shotgun", "limb", 45.0, true)
		Game.blood.on_hit(self, piece, point, normal, "shotgun", "limb", 10.0, false)
		# Out of the cut face of the part still on the body, under pressure.
		var out := normal if normal.dot(point - body.global_position) > 0.0 else -normal
		var flow := _stump_flow(pname) * (1.0 if across else 0.5)
		if pname in ["chest", "abdomen", "pelvis"]:
			# The trunk cut through: the great vessels and everything the
			# belly holds empty out of both halves - litres of it.
			Game.blood.open_jet(self, body, point + out * 0.01, out, 140.0, false, 1300.0, 0.09)
			Game.blood.open_jet(self, piece, point - out * 0.01, -out, 90.0, false, 700.0, 0.09)
		else:
			Game.blood.open_jet(self, body, point + out * 0.01, out, flow, pname == "head")
	get_tree().create_timer(180.0).timeout.connect(piece.queue_free)


## The bone in the cut: a round end when cut across, a strip when split along.
func _cut_bone(body: RigidBody3D, piece: RigidBody3D, pname: String, plane: Plane, keep_pos: bool, section := PackedVector3Array()) -> void:
	# All of it measured on the cut face itself, so the bone is always inside it.
	if section.size() < 3:
		return
	var trunk := pname in ["chest", "abdomen", "pelvis"]
	var n := plane.normal
	var c := Vector3.ZERO
	for p in section:
		c += p
	c /= section.size()
	var reach := 0.0          # how far the face goes from its middle, on average
	for p in section:
		reach += p.distance_to(c)
	reach /= section.size()
	# The bone's line: down the middle of a limb; the spine at the back of
	# the trunk (towards local +Z), in the middle side to side.
	var back := 0.0
	if trunk:
		for p in section:
			back = maxf(back, p.z)
		back *= 0.7
	var axis_pt := Vector3(0.0, 0.0, back)
	var bone_r := reach * (0.22 if trunk else 0.3)
	var mesh: Mesh
	var at := Vector3.ZERO
	var basis := Basis()
	if absf(n.y) > 0.35:
		# Across the bone: its round end where the line goes through the face.
		var y := -plane.distance_to(axis_pt) / n.y
		at = axis_pt + Vector3(0, y, 0)
		if at.distance_to(c) > reach * 0.8:
			return
		var cm := CylinderMesh.new()
		cm.top_radius = bone_r
		cm.bottom_radius = bone_r
		cm.height = 0.004
		mesh = cm
		var up := n
		var x := up.cross(Vector3.FORWARD if absf(up.z) < 0.9 else Vector3.RIGHT).normalized()
		basis = Basis(x, up, x.cross(up))
	else:
		# Along it: a strip of bone down the face, if the cut goes through it.
		var d := plane.distance_to(axis_pt)
		if absf(d) > bone_r:
			return
		var along := (Vector3.UP - n * n.dot(Vector3.UP)).normalized()
		var w := n.cross(along)
		var lo := INF
		var hi := -INF
		var lw := INF
		var hw := -INF
		for p in section:
			lo = minf(lo, p.dot(along))
			hi = maxf(hi, p.dot(along))
			lw = minf(lw, p.dot(w))
			hw = maxf(hw, p.dot(w))
		var inset := (hi - lo) * 0.08
		lo += inset
		hi -= inset
		var width := minf(2.0 * sqrt(maxf(bone_r * bone_r - d * d, 0.0)), (hw - lw) * 0.35)
		if hi - lo < 0.02 or width < 0.005:
			return
		var bm := BoxMesh.new()
		bm.size = Vector3(width, 0.004, hi - lo)
		mesh = bm
		at = axis_pt - n * d
		at += along * ((lo + hi) * 0.5 - at.dot(along))
		# Kept inside the face side to side.
		var aw := clampf(at.dot(w), lw + width * 0.6, hw - width * 0.6)
		at += w * (aw - at.dot(w))
		basis = Basis(w, n, along)
	for body_side in [[body, 1.0 if keep_pos else -1.0], [piece, -1.0 if keep_pos else 1.0]]:
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = _cap_mat("bone")
		mi.layers = 2
		(body_side[0] as Node3D).add_child(mi)
		mi.transform = Transform3D(basis, at - n * 0.003 * float(body_side[1]))


## Re-hangs a part on a new body at `at` (its old joint was on the cut-off
## half): a loose joint, no muscle.
func _rejoin(child: RigidBody3D, to: RigidBody3D, at: Vector3) -> void:
	var i: int = part_index[child.get_meta("part")]
	var old := get_node_or_null("J_" + String(child.get_meta("part")))
	if old:
		old.queue_free()
	_joint_rid[i] = RID()
	child.set_meta("severed", true)
	var j := Generic6DOFJoint3D.new()
	get_parent().add_child(j)
	j.global_position = at
	for axis in 3:
		_set_axis_limit(j, axis, -0.6, 0.6)
	j.node_a = j.get_path_to(to)
	j.node_b = j.get_path_to(child)


## Coils of gut hanging out of the cut belly and falling to the ground: a short
## rope of soft pieces, the first one tied to the body.
func _spill_guts(body: RigidBody3D, at: Vector3) -> void:
	# One length of bowel, out of the wound and hanging (guts.gd).
	var g := Guts.new()
	get_parent().add_child(g)
	var out := at - body.global_position
	out.y = 0.0
	if out.length() < 0.01:
		out = -body.global_basis.z
	g.spill(body, at, out.normalized(), 24, _cap_mat("gut"))
	get_tree().create_timer(180.0).timeout.connect(g.queue_free)
	if Game.blood:
		Game.blood.on_hit(self, body, at, Vector3.DOWN, "shotgun", "torso", 60.0, false)


## Cuffs on or off: steel rings round both wrists and a short chain.
func set_cuffed(on: bool) -> void:
	cuffed = on
	for m in _cuff_meshes:
		if is_instance_valid(m):
			m.queue_free()
	_cuff_meshes.clear()
	if is_instance_valid(_chain):
		_chain.queue_free()
	if not on:
		hand_goal = {"r": Vector3.INF, "l": Vector3.INF}
		return
	var steel := StandardMaterial3D.new()
	steel.albedo_color = Color(0.62, 0.62, 0.64)
	steel.metallic = 0.9
	steel.roughness = 0.3
	for side in ["r", "l"]:
		var ring := MeshInstance3D.new()
		var t := TorusMesh.new()
		t.inner_radius = 0.035 * scale_factor
		t.outer_radius = 0.045 * scale_factor
		t.rings = 16
		t.ring_segments = 6
		ring.mesh = t
		ring.material_override = steel
		parts[part_index["hand_" + side]].add_child(ring)
		ring.position = Vector3(0, 0.07, 0) * scale_factor
		_cuff_meshes.append(ring)
	cuff_prep = false
	# The chain: a few links that hang and swing between the rings.
	_chain = MultiMeshInstance3D.new()
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	var link := TorusMesh.new()
	link.inner_radius = 0.006
	link.outer_radius = 0.0115
	link.rings = 8
	link.ring_segments = 4
	mm.mesh = link
	mm.instance_count = CHAIN_N - 1
	_chain.multimesh = mm
	_chain.material_override = steel
	_chain.top_level = true
	_chain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_chain)
	_chain_p.clear()
	_chain_q.clear()


func _update_chain() -> void:
	if not cuffed or not is_instance_valid(_chain):
		return
	var hr: RigidBody3D = parts[part_index["hand_r"]]
	var hl: RigidBody3D = parts[part_index["hand_l"]]
	var a: Vector3 = hr.global_transform * (Vector3(0, 0.07, 0) * scale_factor)
	var b: Vector3 = hl.global_transform * (Vector3(0, 0.07, 0) * scale_factor)
	var d := b - a
	var l := d.length()
	# The chain is short and does not stretch: past its length it pulls the
	# wrists back together.
	if l > CUFF_CHAIN and not hr.has_meta("severed") and not hl.has_meta("severed"):
		var dir := d / l
		var rel := (hl.linear_velocity - hr.linear_velocity).dot(dir)
		var f := (l - CUFF_CHAIN) * 1600.0 + rel * 30.0
		var j := dir * f * get_physics_process_delta_time()
		hr.apply_impulse(j, a - hr.global_position)
		hl.apply_impulse(-j, b - hl.global_position)
	_chain_step(a, b)


const CHAIN_N := 6                   # points along the chain (links = N - 1)


## The chain itself: points a link apart, hanging between the two rings,
## swinging and settling (cheap: a handful of points per cuffed man).
func _chain_step(a: Vector3, b: Vector3) -> void:
	var seg := CUFF_CHAIN / float(CHAIN_N - 1)
	if _chain_p.size() != CHAIN_N:
		_chain_p.resize(CHAIN_N)
		_chain_q.resize(CHAIN_N)
		for i in CHAIN_N:
			_chain_p[i] = a.lerp(b, float(i) / (CHAIN_N - 1))
			_chain_q[i] = _chain_p[i]
	var dt := get_physics_process_delta_time()
	var g := Vector3.DOWN * 9.8 * dt * dt
	for i in range(1, CHAIN_N - 1):
		var v := (_chain_p[i] - _chain_q[i]) * 0.96
		_chain_q[i] = _chain_p[i]
		_chain_p[i] += v + g
	_chain_p[0] = a
	_chain_p[CHAIN_N - 1] = b
	for it in 4:
		for i in CHAIN_N - 1:
			var d := _chain_p[i + 1] - _chain_p[i]
			var l := d.length()
			if l < 1e-6 or l < seg:
				continue          # a chain only pulls; slack it hangs
			var fix := d * (1.0 - seg / l)
			if i == 0:
				_chain_p[i + 1] -= fix
			elif i + 1 == CHAIN_N - 1:
				_chain_p[i] += fix
			else:
				_chain_p[i] += fix * 0.5
				_chain_p[i + 1] -= fix * 0.5
	var mm := _chain.multimesh
	for i in CHAIN_N - 1:
		var d := _chain_p[i + 1] - _chain_p[i]
		var l := maxf(d.length(), 1e-4)
		var y := d / l
		var x := y.cross(Vector3.UP if absf(y.y) < 0.95 else Vector3.RIGHT).normalized()
		if i % 2 == 1:
			x = y.cross(x)          # every other link turned across
		var z := x.cross(y)
		# A torus lies in its XZ plane: the link's long way along the chain.
		mm.set_instance_transform(i, Transform3D(Basis(y * 1.25, x, z * 0.8), (_chain_p[i] + _chain_p[i + 1]) * 0.5))


func _start_death_curve(kind: String) -> void:
	if _death_t >= 0.0 and _death_kind == "headshot":
		return
	_death_kind = kind
	_death_t = 0.0
	fallen = true
	support = 0.0


func _die(kind: String) -> void:
	wake()
	if not alive:
		return
	alive = false
	conscious = false
	if kind == "headshot":
		brain_dead = true
		_death_kind = "headshot"
		_death_t = 0.0
		fallen = true
		support = 0.0
	else:
		_start_death_curve(kind)
	move_velocity = Vector3.ZERO
	has_look_target = false
	# What he had in his pockets falls out (the trader has more).
	if player_owner == null and ai and rng.randf() < 0.7:
		var cash := rng.randi_range(40, 220) * (4 if has_meta("trader") else 1)
		var at: Vector3 = pelvis.global_position + Vector3(rng.randf_range(-0.2, 0.2), 0.15, rng.randf_range(-0.2, 0.2))
		load("res://scripts/game/item_drop.gd").spawn(get_parent(), "money", cash, Transform3D(Basis(), at), pelvis.linear_velocity * 0.5)


func position_ground() -> Vector3:
	var p := pelvis.global_position
	return Vector3(p.x, p.y - stand_height, p.z)


func eye_position() -> Vector3:
	return head.global_position + head.global_basis.y * 0.02 * scale_factor


## How much a stump of this part pours at full pressure (ml/s): the big
## arteries of the thigh and neck the most, a hand or foot the least.
func _stump_flow(pname: String) -> float:
	if pname == "head":
		return 110.0
	if pname.begins_with("thigh") or pname.begins_with("upper_arm"):
		return 80.0
	if pname.begins_with("shin") or pname.begins_with("forearm"):
		return 50.0
	return 24.0


# --- Held poses (squatting, kneeling, sitting) ----------------------------------------------

## Some poses a man keeps still in - down on his heels, on his knees, sat on
## a bench. Balancing those with muscles only ever looks like fidgeting, so
## once he is in one the whole body is simply placed: every part set from
## the pose's joint angles (forward kinematics from the hips), the feet /
## knees / seat put down on what is under them. The head and arms still
## move with what he is doing (talking, looking, smoking). Anything that
## happens to him (a hit, a blast, a hand on him, getting up) gives the
## body back to physics at once.

var _held_pose := false
var _hold_t := 0.0
var _hold_blend := 0.0
var _hold_from: Array[Transform3D] = []
var _hold_angle: Array = []
var _hold_at := Vector3.INF       # where the hips are held (x, z)
var _hold_cool := 0.0
var seat := Vector3.INF            # sitting: the point of the seat under him (set by the activity)

const HOLD_LEGS := {
	# pose: [hips leaning forward, thigh, shin, foot] (right side; left mirrored)
	"squat": [0.35, Vector3(1.9, 0.12, 0.35), Vector3(-2.35, 0, 0), Vector3(0.55, 0, 0)],
	# Up on the knees, as someone made to kneel does: thighs upright, back
	# straight, the shins flat behind, the tops of the feet on the ground.
	"kneel": [0.0, Vector3(0.06, 0.0, 0.06), Vector3(-1.57, 0, 0), Vector3(-1.25, 0, 0)],
	# Sat: thighs level, shins down, feet flat.
	"sit": [-0.08, Vector3(1.57, 0.05, 0.12), Vector3(-1.5, 0, 0), Vector3(0.0, 0, 0)],
}


func _hold_kind() -> String:
	if posture == Posture.SQUAT:
		return "squat"
	if posture == Posture.KNEEL:
		return "kneel"
	if posture == Posture.SIT and seat != Vector3.INF:
		return "sit"
	return ""


func _update_squat_hold(delta: float) -> void:
	_hold_cool = maxf(_hold_cool - delta, 0.0)
	var kind := _hold_kind()
	var want := kind != "" and alive and conscious and not fallen and _hold_cool <= 0.0
	if not want:
		_hold_t = 0.0
		if _held_pose:
			wake()
		return
	_hold_t += delta
	if not _held_pose:
		# Once he has started getting down (the blend takes him the rest).
		if _hold_t < 0.3:
			return
		_held_pose = true
		_hold_blend = 0.0
		_hold_from.clear()
		_hold_angle.clear()
		for i in parts.size():
			var p := parts[i]
			_hold_from.append(p.global_transform)
			_hold_angle.append(_target[i])
			p.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
			p.freeze = true
			# (held still, he is moved by hand: he would throw anyone lying
			# against him about - other people pass through him meanwhile)
			p.collision_mask &= ~Game.LAYER_BOTS
		_hold_at = pelvis.global_position
	_hold_blend = minf(_hold_blend + delta / 0.6, 1.0)
	# Arms and head follow the pose targets smoothly; the legs are the pose's.
	var k := minf(delta * 6.0, 1.0)
	for i in parts.size():
		_hold_angle[i] = (_hold_angle[i] as Vector3).lerp(_target[i], k)
	var legs: Array = HOLD_LEGS[kind]
	var ang := _hold_angle.duplicate()
	for side in ["r", "l"]:
		var m := Vector3(1, 1, 1) if side == "r" else Vector3(1, -1, -1)
		ang[part_index["thigh_" + side]] = (legs[1] as Vector3) * m
		ang[part_index["shin_" + side]] = (legs[2] as Vector3) * m
		ang[part_index["foot_" + side]] = (legs[3] as Vector3) * m
	var fwd := Vector3(facing.x, 0.0, facing.z)
	fwd = fwd.normalized() if fwd.length() > 0.01 else -pelvis.global_basis.z
	var yaw_b := Basis.looking_at(fwd, Vector3.UP)
	var root_b := yaw_b * Basis(Vector3.RIGHT, -float(legs[0]))
	var xfs := _fk(Transform3D(root_b, Vector3.ZERO), ang)
	if kind != "kneel":
		# Feet flat on the ground.
		for side in ["r", "l"]:
			var fi: int = part_index["foot_" + side]
			var ankle := _fk_joint(xfs, fi)
			var off: Vector3 = (parts[fi].get_meta("rest_pos") as Vector3) - (parts[fi].get_meta("joint_pos") as Vector3)
			xfs[fi] = Transform3D(yaw_b, ankle + yaw_b * off)
	# Down onto whatever is under him: the lowest point of him on the ground,
	# or his seat on the seat.
	var lowest := INF
	for i in parts.size():
		lowest = minf(lowest, _lowest_y(i, xfs[i]))
	var lift := _ground_under(_hold_at) - lowest
	if kind == "sit":
		if absf(seat.y - (_hold_at.y - 0.45)) > 1.0:
			# (the seat is on another floor: he is not there)
			seat = Vector3.INF
			wake()
			return
		lift = seat.y - _lowest_y(0, xfs[0])
		_hold_at = Vector3(seat.x, _hold_at.y, seat.z) + fwd * 0.06
	var shift := Vector3(_hold_at.x, lift, _hold_at.z)
	var b := smoothstep(0.0, 1.0, _hold_blend)
	for i in parts.size():
		var x: Transform3D = xfs[i]
		x.origin += shift
		parts[i].global_transform = _hold_from[i].interpolate_with(x, b) if b < 1.0 else x


## Forward kinematics: every part's transform from the hips' and the joint
## angles (child = parent * angles, as the muscles measure it).
func _fk(root: Transform3D, ang: Array) -> Array:
	var xfs := []
	for i in parts.size():
		if _parent[i] < 0:
			xfs.append(root)
			continue
		var pi_ := _parent[i]
		var rest_c: Vector3 = parts[i].get_meta("rest_pos")
		var rest_p: Vector3 = parts[pi_].get_meta("rest_pos")
		var jp: Vector3 = parts[i].get_meta("joint_pos")
		var pxf: Transform3D = xfs[pi_]
		var cb := pxf.basis * Basis.from_euler(ang[i])
		var jw := pxf * (jp - rest_p)
		xfs.append(Transform3D(cb, jw + cb * (rest_c - jp)))
	return xfs


func _fk_joint(xfs: Array, i: int) -> Vector3:
	var rest_p: Vector3 = parts[_parent[i]].get_meta("rest_pos")
	return (xfs[_parent[i]] as Transform3D) * ((parts[i].get_meta("joint_pos") as Vector3) - rest_p)


## The lowest point of part i's collision shape placed at xf.
func _lowest_y(i: int, xf: Transform3D) -> float:
	var cs := parts[i].get_child(0) as CollisionShape3D
	if cs == null:
		return xf.origin.y
	var sx := xf * cs.transform
	var sh := cs.shape
	if sh is CapsuleShape3D:
		var c := sh as CapsuleShape3D
		var h := c.height * 0.5 - c.radius
		return minf((sx * Vector3(0, h, 0)).y, (sx * Vector3(0, -h, 0)).y) - c.radius
	if sh is BoxShape3D:
		var e := (sh as BoxShape3D).size * 0.5
		var lo := INF
		for cx in [-1.0, 1.0]:
			for cy in [-1.0, 1.0]:
				for cz in [-1.0, 1.0]:
					lo = minf(lo, (sx * Vector3(e.x * cx, e.y * cy, e.z * cz)).y)
		return lo
	if sh is SphereShape3D:
		return sx.origin.y - (sh as SphereShape3D).radius
	return sx.origin.y


func _ground_under(p: Vector3) -> float:
	var q := PhysicsRayQueryParameters3D.create(Vector3(p.x, p.y + 0.5, p.z), Vector3(p.x, p.y - 2.5, p.z), Game.LAYER_WORLD | Game.LAYER_PROPS)
	q.exclude = _ray_exclude
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	return (hit.position as Vector3).y if not hit.is_empty() else p.y - 0.45


## Back to a fully physical body (see _update_squat_hold).
func wake() -> void:
	if _off_frozen:
		_off_frozen = false
		for p in parts:
			if is_instance_valid(p):
				p.freeze = false
	if not _held_pose:
		return
	_held_pose = false
	_hold_cool = 1.5
	for p in parts:
		p.freeze = false
		p.linear_velocity = Vector3.ZERO
		p.collision_mask |= Game.LAYER_BOTS
		p.angular_velocity = Vector3.ZERO


# --- Face -----------------------------------------------------------------------------

## Calm, anger, fear on the face: brows, lids and mouth. Angry: brows drawn
## down and together, eyes narrowed, mouth pressed thin. Afraid: brows up,
## eyes wide, mouth dropped open. Pain screws it up like anger.
func _update_face(delta: float) -> void:
	if _face_mouth == null:
		return
	var vmat: ShaderMaterial = soft_head._mat if soft_head and soft_head.main_mesh else null
	if vmat == null and not _face_mouth.is_visible_in_tree():
		return
	var anger := 0.0
	var fright := 0.0
	var sadness := 0.0
	var hurt := 0.0
	if alive and conscious:
		# Pain: a fresh wound screws the face up; bleeding out, it turns to
		# despair (grief and fear together, the mouth open).
		hurt = clampf(pain * 0.9 + _flinch * 0.6, 0.0, 1.0)
		var loss := 1.0 - blood / BLOOD_MAX
		if loss > 0.15:
			sadness = clampf((loss - 0.15) / 0.25, 0.0, 1.0)
			fright = maxf(fright, sadness * 0.6)
		if cuffed:
			sadness = maxf(sadness, 0.45)
		if Game.clock < sad_until:
			sadness = maxf(sadness, 0.8)
		if ai:
			fright = clampf(ai.fear * 1.4, 0.0, 1.0)
			if ai.state in [ai.S.FLEE, ai.S.SURRENDER, ai.S.HIDE, ai.S.CUFFED]:
				fright = maxf(fright, 0.85)
			elif ai.state == ai.S.NERVOUS:
				fright = maxf(fright, 0.5)
			if ai.foe != null and ai.state == ai.S.ARMED:
				anger = 1.0
		if Game.clock < angry_until:
			anger = maxf(anger, 0.9)
		if anger > 0.5:
			fright *= 0.4
			sadness *= 0.3
	var k := minf(delta * 5.0, 1.0)
	_anger = lerpf(_anger, anger, k)
	_fright = lerpf(_fright, fright, k)
	_sad = lerpf(_sad, sadness, k * 0.5)
	_hurt = lerpf(_hurt, hurt, k * 1.5)
	var dead := 0.0 if alive else 1.0
	for i in _face_brows.size():
		var sx := -1.0 if i == 0 else 1.0
		var brow := _face_brows[i]
		brow.position = Vector3(0.035 * sx - 0.004 * sx * _anger, 0.047 - 0.007 * _anger + 0.011 * _fright, -0.094) * scale_factor
		brow.rotation = Vector3(0, 0, PI * 0.5 + 0.15 * sx - 0.45 * sx * _anger + 0.3 * sx * _fright)
		var eye := _face_eyes[i]
		eye.scale = Vector3(1.0, lerpf(0.7, 0.4, _anger) + 0.35 * _fright - 0.5 * dead, 0.5)
	if vmat:
		# The head is the volume one: its shader draws the face.
		var now := Vector4(_anger + _sad * 3.0, _fright + _hurt * 3.0, dead, 0.0)
		if (now - _face_sent4).length() > 0.02:
			_face_sent4 = now
			vmat.set_shader_parameter("anger", _anger)
			vmat.set_shader_parameter("fear", _fright)
			vmat.set_shader_parameter("dead", dead)
			vmat.set_shader_parameter("sad", _sad)
			vmat.set_shader_parameter("pain", _hurt)
		return
	var open := 0.2 + 0.55 * _fright - 0.08 * _anger + 0.2 * dead
	_face_mouth.scale = Vector3(1.25 + 0.2 * _anger - 0.25 * _fright, maxf(open, 0.1), 0.35)


# --- Done to him from a client's game (net.gd bot_call) ----------------------------------------

func net_set(prop: String, value: Variant) -> void:
	if prop in ["cuff_prep", "angry_until"]:
		set(prop, value)
	elif prop in ["kneel"] and ai:
		ai.set(prop, value)


func net_hit(part_i: int, point: Vector3, dir: Vector3, impulse: float, weapon: String) -> void:
	if part_i >= 0 and part_i < parts.size():
		receive_hit(parts[part_i], point, dir, impulse, weapon)
		var who = get_meta("net_caller", null)
		if ai and who:
			ai.on_attacked(who)


func net_slice(part_i: int, point: Vector3, normal: Vector3) -> void:
	if part_i >= 0 and part_i < parts.size():
		saw_slice(parts[part_i], point, normal)


## Something for his mind: only these.
func net_ai(what: String, args: Array = []) -> void:
	if ai == null:
		return
	var who = get_meta("net_caller", null)
	match what:
		"sprayed":
			ai.sprayed()
		"uncuff":
			set_cuffed(false)
			ai.kneel = false
			ai._enter(ai.S.FLEE)
		"gesture":
			if ai.has_method("gesture_seen"):
				ai.gesture_seen(String(args[0][0]), who, bool(args[0][1]))
		"dialog":
			if ai.has_method("dialog_act"):
				ai.dialog_act(args, who)


## A foot coming down (walking or running): heard near by, harder at a run.
func _footstep(run: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var at := pelvis.global_position + Vector3.DOWN * stand_height
	if at.distance_to(cam.global_position) > 25.0:
		return
	Game.play_3d(Sfx.get_stream(&"step"), at, -12.0 + run * 4.0, 0.08, 2.0)
