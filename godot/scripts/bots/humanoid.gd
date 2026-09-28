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

const G := 9.81
const VECTOR3_AXIS_X := Vector3.AXIS_X
const VECTOR3_AXIS_Y := Vector3.AXIS_Y
const VECTOR3_AXIS_Z := Vector3.AXIS_Z
const PARAM_VEL := PhysicsServer3D.G6DOF_JOINT_ANGULAR_MOTOR_TARGET_VELOCITY
const PARAM_FORCE := PhysicsServer3D.G6DOF_JOINT_ANGULAR_MOTOR_FORCE_LIMIT
const BLOOD_MAX := 5000.0

enum Posture { STAND, CROUCH, HANDS_UP, COVER_HEAD }

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

var _phase := 0.0
var _stagger := 0.0
var _flinch := 0.0
var _flinch_dir := Vector3.ZERO
var _fallen_time := 0.0
var _getup := 0.0
var _getup_delay := 2.0
var _death_t := -1.0
var _death_kind := ""
var _time := 0.0
var _ray_exclude: Array[RID] = []
var _last_fall_sound := 0.0
var ai: Node

# Materials per bot.
var _skin: StandardMaterial3D
var _shirt: StandardMaterial3D
var _pants: StandardMaterial3D
var _shoes: StandardMaterial3D
var _hair: StandardMaterial3D
var _long_sleeves := false


func spawn(pos: Vector3, yaw: float) -> void:
	rng.seed = bot_seed
	scale_factor = rng.randf_range(0.93, 1.06)
	global_transform = Transform3D(Basis(Vector3.UP, yaw), pos)
	facing = -global_basis.z
	_make_materials()
	_build_body()
	ai = BotAI.new()
	ai.name = "AI"
	add_child(ai)
	ai.setup(self, rng.randi())


# --- Construction ---------------------------------------------------------------------

func _make_materials() -> void:
	var skins := [Color(0.93, 0.78, 0.67), Color(0.82, 0.63, 0.5), Color(0.62, 0.44, 0.32), Color(0.42, 0.29, 0.21), Color(0.96, 0.84, 0.74)]
	_skin = StandardMaterial3D.new()
	_skin.albedo_color = skins[rng.randi() % skins.size()]
	_skin.roughness = 0.58
	_skin.subsurf_scatter_enabled = true
	_skin.subsurf_scatter_strength = 0.25
	_skin.normal_enabled = true
	_skin.normal_texture = Tex.noise("skin", 0.35, 2, 128, true, 1.0)
	_skin.normal_scale = 0.3
	_skin.uv1_triplanar = true
	_skin.uv1_scale = Vector3.ONE * 6.0

	var shirts := [Color(0.72, 0.72, 0.7), Color(0.16, 0.2, 0.3), Color(0.35, 0.12, 0.1), Color(0.22, 0.3, 0.2),
			Color(0.1, 0.1, 0.1), Color(0.55, 0.5, 0.38), Color(0.4, 0.42, 0.46)]
	_shirt = _fabric(shirts[rng.randi() % shirts.size()], 0.92)
	var pants := [Color(0.16, 0.2, 0.3), Color(0.12, 0.12, 0.13), Color(0.35, 0.31, 0.22), Color(0.26, 0.27, 0.25)]
	_pants = _fabric(pants[rng.randi() % pants.size()], 0.95)
	_shoes = StandardMaterial3D.new()
	_shoes.albedo_color = [Color(0.08, 0.07, 0.07), Color(0.25, 0.18, 0.12), Color(0.8, 0.8, 0.78)][rng.randi() % 3]
	_shoes.roughness = 0.7
	_hair = StandardMaterial3D.new()
	_hair.albedo_color = [Color(0.07, 0.05, 0.04), Color(0.2, 0.13, 0.07), Color(0.45, 0.33, 0.2), Color(0.3, 0.3, 0.3)][rng.randi() % 4]
	_hair.roughness = 0.85
	_long_sleeves = rng.randf() < 0.45


func _fabric(color: Color, rough: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	m.normal_enabled = true
	m.normal_texture = Tex.fabric_normal()
	m.normal_scale = 0.7
	m.uv1_triplanar = true
	m.uv1_scale = Vector3.ONE * 5.0
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
	_add_part("pelvis", "", Vector3(0, 0.97, 0), _capsule(0.125, 0.34), along_x, 11.0, none, none, none, 0.0, 0.0)
	_add_part("abdomen", "pelvis", Vector3(0, 1.14, 0), _capsule(0.115, 0.3), along_x, 9.0,
			Vector3(0, 1.05, 0), Vector3(-0.55, -0.45, -0.35), Vector3(0.3, 0.45, 0.35), 17.0, 380.0)
	_add_part("chest", "abdomen", Vector3(0, 1.36, 0), _capsule(0.14, 0.36), along_x, 15.0,
			Vector3(0, 1.245, 0), Vector3(-0.45, -0.4, -0.3), Vector3(0.3, 0.4, 0.3), 17.0, 380.0)
	_add_part("head", "chest", Vector3(0, 1.665, -0.01), _capsule(0.1, 0.26), none, 5.2,
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
		var arm_lo := Vector3(-0.9, -1.2, -0.3)
		var arm_hi := Vector3(2.8, 1.0, 2.6)
		_add_part("upper_arm_" + side, "chest", Vector3(0.25 * sx, 1.3, 0), _capsule(0.052, 0.3), none, 2.2,
				Vector3(0.22 * sx, 1.43, 0), m.call(arm_lo, arm_hi, false), m.call(arm_lo, arm_hi, true), 14.0, 130.0)
		var fa_lo := Vector3(0.0, -1.3, 0.0)
		var fa_hi := Vector3(2.5, 1.3, 0.0)
		_add_part("forearm_" + side, "upper_arm_" + side, Vector3(0.25 * sx, 1.02, 0), _capsule(0.043, 0.28), none, 1.3,
				Vector3(0.25 * sx, 1.155, 0), m.call(fa_lo, fa_hi, false), m.call(fa_lo, fa_hi, true), 12.0, 80.0)
		var h_lo := Vector3(-1.0, -0.2, -0.4)
		var h_hi := Vector3(1.0, 0.2, 0.5)
		_add_part("hand_" + side, "forearm_" + side, Vector3(0.25 * sx, 0.79, -0.005), _boxs(Vector3(0.05, 0.17, 0.09)), none, 0.5,
				Vector3(0.25 * sx, 0.88, 0), m.call(h_lo, h_hi, false), m.call(h_lo, h_hi, true), 9.0, 14.0)
		var hip_lo := Vector3(-0.45, -0.6, -0.35)
		var hip_hi := Vector3(2.1, 0.6, 0.9)
		_add_part("thigh_" + side, "pelvis", Vector3(0.1 * sx, 0.72, 0), _capsule(0.077, 0.44), none, 8.0,
				Vector3(0.1 * sx, 0.92, 0), m.call(hip_lo, hip_hi, false), m.call(hip_lo, hip_hi, true), 18.0, 480.0)
		_add_part("shin_" + side, "thigh_" + side, Vector3(0.1 * sx, 0.29, 0), _capsule(0.056, 0.44), none, 3.7,
				Vector3(0.1 * sx, 0.505, 0), Vector3(-2.5, 0, 0), Vector3(0, 0, 0), 18.0, 380.0)
		var an_lo := Vector3(-0.75, -0.15, -0.25)
		var an_hi := Vector3(0.45, 0.15, 0.25)
		_add_part("foot_" + side, "shin_" + side, Vector3(0.1 * sx, 0.04, -0.05), _boxs(Vector3(0.095, 0.075, 0.25)), none, 1.2,
				Vector3(0.1 * sx, 0.08, 0), m.call(an_lo, an_hi, false), m.call(an_lo, an_hi, true), 14.0, 140.0)

	pelvis = parts[part_index["pelvis"]]
	chest = parts[part_index["chest"]]
	head = parts[part_index["head"]]
	stand_height = 0.975 * scale_factor
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
	parent.add_child(mi)
	return mi


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
	_mesh(pelvis, _sphere_mesh(0.07, 0.1), _pants, Vector3(0, -0.02, 0.07), Vector3.ZERO, Vector3(2.2, 1.0, 1.0))
	var ab := parts[part_index["abdomen"]]
	_mesh(ab, _cap_mesh(0.125, 0.31), _shirt, Vector3.ZERO, along_x, Vector3(1, 1, 0.82))
	_mesh(chest, _cap_mesh(0.15, 0.4), _shirt, Vector3(0, 0.0, 0.0), along_x, Vector3(1, 1, 0.74))
	_mesh(chest, _cap_mesh(0.09, 0.44), _shirt, Vector3(0, 0.08, 0.005), along_x, Vector3(1, 1, 1.0))   # shoulders
	_mesh(chest, _sphere_mesh(0.08, 0.1), _shirt, Vector3(0, 0.08, -0.07), Vector3.ZERO, Vector3(2.4, 1.0, 0.9)) # pecs
	# Head: skull, jaw, nose, ears, neck, hair, eyes.
	_mesh(head, _cap_mesh(0.055, 0.17), _skin, Vector3(0, -0.12, 0.012))
	_mesh(head, _sphere_mesh(0.1, 0.235), _skin, Vector3(0, 0.01, 0), Vector3.ZERO, Vector3(0.93, 1.0, 1.08))
	_mesh(head, _sphere_mesh(0.07, 0.1), _skin, Vector3(0, -0.06, -0.035), Vector3.ZERO, Vector3(1.05, 1.0, 1.2))
	_mesh(head, _cap_mesh(0.014, 0.05), _skin, Vector3(0, -0.005, -0.103), Vector3(-0.35, 0, 0), Vector3(1.2, 1, 1))
	for sx in [-1.0, 1.0]:
		_mesh(head, _sphere_mesh(0.022, 0.05), _skin, Vector3(0.093 * sx, 0.0, 0.01), Vector3.ZERO, Vector3(0.5, 1, 0.9))
		var eye := _mesh(head, _sphere_mesh(0.011, 0.022), _hair, Vector3(0.035 * sx, 0.025, -0.092))
		eye.scale = Vector3(1, 0.7, 0.5)
		_mesh(head, _cap_mesh(0.008, 0.04), _hair, Vector3(0.035 * sx, 0.047, -0.094), Vector3(0, 0, PI * 0.5 + 0.15 * sx))
	if rng.randf() < 0.8:
		_mesh(head, _sphere_mesh(0.104, 0.2), _hair, Vector3(0, 0.05, 0.012), Vector3(-0.25, 0, 0), Vector3(0.96, 0.8, 1.06))
	# Limbs.
	for side in ["r", "l"]:
		var ua := parts[part_index["upper_arm_" + side]]
		_mesh(ua, _cap_mesh(0.058, 0.32), _shirt)
		_mesh(ua, _sphere_mesh(0.062, 0.12), _shirt, Vector3(0, 0.12, 0))
		var fa := parts[part_index["forearm_" + side]]
		_mesh(fa, _cap_mesh(0.047, 0.29), _shirt if _long_sleeves else _skin)
		var hand := parts[part_index["hand_" + side]]
		_mesh(hand, _cap_mesh(0.04, 0.16), _skin, Vector3(0, 0.0, 0), Vector3.ZERO, Vector3(0.62, 1.0, 1.15))
		_mesh(hand, _cap_mesh(0.014, 0.07), _skin, Vector3(0, 0.03, -0.045), Vector3(0.5, 0, 0))    # thumb
		var th := parts[part_index["thigh_" + side]]
		_mesh(th, _cap_mesh(0.082, 0.46), _pants)
		var sh := parts[part_index["shin_" + side]]
		_mesh(sh, _cap_mesh(0.062, 0.46), _pants)
		var ft := parts[part_index["foot_" + side]]
		_mesh(ft, _cap_mesh(0.05, 0.26), _shoes, Vector3(0, -0.005, -0.005), Vector3(PI * 0.5, 0, 0), Vector3(1.0, 1.0, 0.8))
		_mesh(ft, _sphere_mesh(0.05, 0.06), _shoes, Vector3(0, 0.03, 0.06))


# --- Simulation ----------------------------------------------------------------------

func _physics_process(delta: float) -> void:
	if parts.is_empty():
		return
	_time += delta
	_update_health(delta)
	_update_state(delta)
	_compose_pose(delta)
	_apply_muscles()
	if support > 0.001:
		_apply_balance()


func _update_health(delta: float) -> void:
	if not alive:
		return
	blood = maxf(blood - bleed_rate * delta, 0.0)
	# Small wounds slowly clot.
	if bleed_rate < 12.0:
		bleed_rate = maxf(bleed_rate - delta * 0.08, 0.0)
	shock = maxf(shock - delta * 0.015, 0.0)
	pain = maxf(pain - delta * 0.08, 0.0)
	_stagger = maxf(_stagger - delta * 1.4, 0.0)
	_flinch = maxf(_flinch - delta * 1.8, 0.0)
	var frac := blood / BLOOD_MAX
	var was_conscious := conscious
	conscious = frac > 0.55 and shock < 1.0
	if was_conscious and not conscious:
		_start_death_curve("faint")
	if frac < 0.4:
		_die("bleed_out")


## Standing ability from legs, shock and blood.
func mobility() -> float:
	var legs: float = minf(leg_health["l"], leg_health["r"]) * 0.6 + (leg_health["l"] + leg_health["r"]) * 0.2
	var frac := blood / BLOOD_MAX
	return clampf(legs * (1.0 - shock * 0.5) * clampf((frac - 0.55) / 0.2, 0.0, 1.0), 0.0, 1.0)


func _update_state(delta: float) -> void:
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
					var k := clampf((_death_t - 0.1) / 1.1, 0.0, 1.0)
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
	var tipped := up_p.y < 0.45 or up_c.y < 0.35

	if not fallen:
		if tipped or (h > 0.0 and h < stand_height * 0.42 and posture != Posture.CROUCH) or mobility() < 0.2:
			_fall()
	else:
		_fallen_time += delta
		var slow := pelvis.linear_velocity.length() < 0.6
		if _getup <= 0.0:
			if slow and _fallen_time > _getup_delay and mobility() > 0.45 and conscious:
				_getup = 0.001
		else:
			_getup += delta
			if _getup > 2.2:
				fallen = false
				_getup = 0.0
				_fallen_time = 0.0
	# Support is how much balance assist is available right now.
	var target_support := 0.0
	if conscious and alive:
		if not fallen:
			target_support = mobility() * (1.0 - clampf(_stagger, 0.0, 1.0))
		elif _getup > 0.0:
			target_support = smoothstep(0.0, 1.8, _getup) * mobility()
	support = move_toward(support, target_support, delta * (6.0 if target_support < support else 1.5))
	tone = move_toward(tone, (1.0 if conscious else 0.08) * (1.0 - shock * 0.3), delta * 2.0)
	if not fallen and ph.y < -5.0:
		_die("fell")


func _fall() -> void:
	fallen = true
	_getup_delay = rng.randf_range(1.5, 3.0)
	_fallen_time = 0.0
	_getup = 0.0
	if _time - _last_fall_sound > 2.0:
		_last_fall_sound = _time
		Game.play_3d(Sfx.get_stream(&"body_fall"), pelvis.global_position, -6.0, 0.1, 4.0)


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
	if _death_kind == "headshot" and _death_t >= 0.0 and _death_t < 0.7:
		_pose_decerebrate()
		return
	if not alive or not conscious:
		return

	var fwd := Vector3(facing.x, 0, facing.z).normalized()
	var vel := move_velocity
	var speed := Vector2(vel.x, vel.z).length()
	var backwards := speed > 0.1 and vel.normalized().dot(fwd) < -0.3
	var run := clampf((speed - 1.6) / 2.4, 0.0, 1.0)
	var walk := clampf(speed / 1.0, 0.0, 1.0)
	var cadence := 0.55 + speed * 0.22
	_phase += delta * TAU * cadence * (-1.0 if backwards else 1.0)

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
	_pose_set("abdomen", Vector3(-0.06 * run, 0.07 * sin(_phase) * walk, 0))
	_pose_set("chest", Vector3(-0.08 * run + 0.015 * sin(_time * 1.7), -0.05 * sin(_phase) * walk, 0))

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

	# Flinch / protective hunch after being hit.
	if _flinch > 0.0:
		var f := _flinch
		_pose_set("abdomen", _target[part_index["abdomen"]] + Vector3(-0.35, 0, 0) * f)
		_pose_set("chest", _target[part_index["chest"]] + Vector3(-0.3, 0, 0) * f)
		for side in ["r", "l"]:
			var cur: Vector3 = _target[part_index["upper_arm_" + side]]
			_pose_set("upper_arm_" + side, cur.lerp(Vector3(0.9, 0.0, 0.1 if side == "r" else -0.1), f * 0.6))

	# Head tracking.
	if has_look_target:
		var cb := chest.global_basis.orthonormalized()
		var d := cb.inverse() * (look_target - head.global_position)
		if d.length() > 0.05:
			d = d.normalized()
			var yaw := atan2(-d.x, -d.z)
			var pitch := asin(clampf(d.y, -1.0, 1.0))
			var neck_yaw := clampf(yaw, -1.0, 1.0)
			var spill := clampf(yaw - neck_yaw, -0.8, 0.8)
			_pose_set("head", _target[part_index["head"]] + Vector3(clampf(pitch * 0.8, -0.7, 0.55), neck_yaw, 0))
			var ab_t: Vector3 = _target[part_index["abdomen"]]
			_pose_set("abdomen", ab_t + Vector3(0, spill * 0.4, 0))
			var ch_t: Vector3 = _target[part_index["chest"]]
			_pose_set("chest", ch_t + Vector3(0, spill * 0.4, 0))

	# Fallen but conscious: brace, then curl or push up.
	if fallen:
		if _getup > 0.0:
			var k := smoothstep(0.0, 2.0, _getup)
			for side in ["r", "l"]:
				_side("thigh", side, Vector3(1.2 * (1.0 - k), 0, 0.1))
				_side("shin", side, Vector3(-1.8 * (1.0 - k), 0, 0))
		else:
			var writhe := sin(_time * 2.3 + bot_seed) * 0.25 * clampf(pain, 0.0, 1.0)
			for side in ["r", "l"]:
				_side("thigh", side, Vector3(0.6 + writhe, 0, 0.1))
				_side("shin", side, Vector3(-1.0 - writhe, 0, 0))
			_pose_set("abdomen", Vector3(-0.3, 0, 0))


## Weak, asymmetric involuntary arm posture right after a brain injury (one
## arm extends, the other flexes). Legs and trunk are left to gravity.
func _pose_decerebrate() -> void:
	var ext := "r" if bot_seed % 2 == 0 else "l"
	var flex := "l" if ext == "r" else "r"
	_side("upper_arm", ext, Vector3(0.5, 0.2, 0.15))
	_side("forearm", ext, Vector3(0.15, 0.6, 0))
	_side("hand", ext, Vector3(0.6, 0, 0))
	_side("upper_arm", flex, Vector3(0.2, 0.0, 0.1))
	_side("forearm", flex, Vector3(1.6, 0.0, 0))
	_side("hand", flex, Vector3(0.8, 0, 0))


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
		var t_i := tone * _weak[i]
		if _death_t >= 0.0 and _arm[i] == 0:
			t_i *= 0.15   # trunk and legs go limp first
		var des := (pb.transposed() * err) * _omega[i] * clampf(t_i, 0.0, 1.0)
		des = des.limit_length(14.0)
		var rid := _joint_rid[i]
		# Jolt measures joint angles with the opposite sign, see _add_part().
		PhysicsServer3D.generic_6dof_joint_set_param(rid, VECTOR3_AXIS_X, PARAM_VEL, -des.x)
		PhysicsServer3D.generic_6dof_joint_set_param(rid, VECTOR3_AXIS_Y, PARAM_VEL, -des.y)
		PhysicsServer3D.generic_6dof_joint_set_param(rid, VECTOR3_AXIS_Z, PARAM_VEL, -des.z)
		var limit := _max_torque[i] * maxf(t_i, 0.02)
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
	var limp := 1.0 - minf(leg_health["l"], leg_health["r"])
	target_h -= limp * 0.08 + 0.02 * absf(sin(_phase * 2.0)) * limp
	if fallen and _getup > 0.0:
		target_h = lerpf(0.3, target_h, smoothstep(0.3, 2.0, _getup))

	var sup := support
	if h > 0.0 and h < 1.7:
		var err := target_h - h
		var vy := pelvis.linear_velocity.y
		var acc := clampf(G + err * 90.0 - vy * 16.0, 0.0, G * 2.8)
		var f := total_mass * acc * sup
		pelvis.apply_central_force(Vector3.UP * f * 0.62)
		chest.apply_central_force(Vector3.UP * f * 0.38)

		# Horizontal drive.
		var v := pelvis.linear_velocity
		var hv := Vector3(v.x, 0, v.z)
		var dv := (Vector3(move_velocity.x, 0, move_velocity.z) - hv)
		var drive := (dv * 7.0).limit_length(8.0) * total_mass * sup
		pelvis.apply_central_force(drive * 0.6)
		chest.apply_central_force(drive * 0.4)

	# Upright and heading.
	var fwd := Vector3(facing.x, 0, facing.z)
	if fwd.length() < 0.01:
		fwd = -pelvis.global_basis.z
	fwd = fwd.normalized()
	var lean := clampf(Vector2(move_velocity.x, move_velocity.z).length() * 0.025, 0.0, 0.1)
	var up := (Vector3.UP + fwd * lean).normalized()
	var target := Basis.looking_at(fwd, up)
	_upright_torque(pelvis, target, 9.0, 7.0 * sup)
	var ch_target := target
	if posture == Posture.CROUCH or posture == Posture.COVER_HEAD:
		ch_target = target.rotated(target.x, -0.6)
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
	body.apply_impulse(dir * impulse, point - body.global_position)
	var part: String = body.get_meta("part")
	var local := body.global_transform.affine_inverse() * point
	var pellet := weapon == "shotgun"
	var dmg := 0.55 if pellet else 1.0
	Game.play_3d(Sfx.get_stream(&"flesh"), point, -4.0, 0.15, 4.0)
	Game.bot_hurt.emit(self, point)

	var was_alive := alive
	var bleed_before := bleed_rate
	var wound_kind := "limb"
	var arterial := false
	_flinch = minf(_flinch + 0.7 * dmg, 1.0)
	_flinch_dir = dir
	_stagger += (0.35 if pellet else 0.55) * dmg * (0.6 + 0.4 * absf(dir.y))
	pain = minf(pain + 0.5 * dmg, 1.5)
	shock += 0.08 * dmg
	var side := "r" if part.ends_with("_r") else "l"

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
			_die("headshot")
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
	if Game.blood:
		# A shot to the brain still leaks, it just does not pump.
		var added := bleed_rate - bleed_before if wound_kind != "head" else 8.0
		Game.blood.on_hit(self, body, point, dir, weapon, wound_kind, added, arterial)
	if was_alive and ai:
		ai.on_hurt(point, dir)


func _start_death_curve(kind: String) -> void:
	if _death_t >= 0.0 and _death_kind == "headshot":
		return
	_death_kind = kind
	_death_t = 0.0
	fallen = true
	support = 0.0


func _die(kind: String) -> void:
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


func position_ground() -> Vector3:
	var p := pelvis.global_position
	return Vector3(p.x, p.y - stand_height, p.z)


func eye_position() -> Vector3:
	return head.global_position + head.global_basis.y * 0.02 * scale_factor
