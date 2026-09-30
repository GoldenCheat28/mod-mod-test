extends Node3D
## Another player, as seen here: a person like everyone else (humanoid.gd,
## held still - every part placed, none of its own muscles or mind), posed
## from the numbers they send: where they stand and look, how they walk and
## crouch, where their hands are (their own first-person body, player_body.gd,
## is worked out here unseen to get the legs' stride and the arms' reach, and
## its joints carried over onto this body). Bullets find its parts (weapon.gd
## sends the hit to them), and the wounds, the blood on the clothes and the
## holes show here as on anyone. Lying down, its parts are where theirs are.

const PlayerBody = preload("res://scripts/player/player_body.gd")
const Models = preload("res://scripts/weapons/weapon_models.gd")
const Humanoid = preload("res://scripts/bots/humanoid.gd")
const KINDS := ["", "pistol", "shotgun", "akm", "revolver", "sawnoff", "crossbow", "nailgun", "flaregun", "rifle"]

var peer := 0
var display_name := ""
var hitbox: StaticBody3D
var _body: Node3D
var _gun: Node3D
var _gun_kind := ""
var _rag: Node3D = null
var _label: Label3D
var _flash_t := 0.0
var _last: PackedFloat32Array
var down := false                # lying as a ragdoll
var shot_t := -99.0              # Game.clock of their last shot, and where from
var shot_pos := Vector3.INF
var _eye := Vector3.ZERO
var _h: Node3D = null             # the body seen (humanoid.gd)
var _s := 1.0                     # its size

# Where each part hangs from its parent at rest (humanoid.gd's joints),
# unscaled; x mirrored for the left side.
const JOINT := {"pelvis": Vector3(0, 0.97, 0), "abdomen": Vector3(0, 1.05, 0), "chest": Vector3(0, 1.245, 0),
		"head": Vector3(0, 1.53, 0), "upper_arm": Vector3(0.22, 1.43, 0), "forearm": Vector3(0.25, 1.155, 0),
		"hand": Vector3(0.25, 0.88, 0), "thigh": Vector3(0.1, 0.92, 0), "shin": Vector3(0.1, 0.505, 0),
		"foot": Vector3(0.1, 0.08, 0)}


func position_ground() -> Vector3:
	return hitbox.global_position


func eye_position() -> Vector3:
	return _eye if _eye != Vector3.ZERO else hitbox.global_position + Vector3.UP * 1.6


## Where a bullet aimed at them should go: the chest.
func aim_point() -> Vector3:
	return (_eye + Vector3.DOWN * 0.35) if not down else hitbox.global_position + Vector3.UP * 0.2


func _ready() -> void:
	_body = PlayerBody.new()
	add_child(_body)
	_body.setup()
	# (only worked out, never seen: the person below is what shows)
	_body.visible = false
	hitbox = StaticBody3D.new()
	# (the parts of the body are what bullets hit now)
	hitbox.collision_layer = 0
	hitbox.collision_mask = 0
	hitbox.set_meta("remote_player", peer)
	hitbox.set_meta("surface", "flesh")
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.25
	cap.height = 1.8
	cs.shape = cap
	cs.position.y = 0.9
	hitbox.add_child(cs)
	hitbox.top_level = true
	add_child(hitbox)
	_label = Label3D.new()
	_label.text = display_name
	_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_label.font_size = 28
	_label.outline_size = 6
	_label.modulate = Color(1, 1, 1, 0.8)
	_label.top_level = true
	add_child(_label)


func apply(st: PackedFloat32Array) -> void:
	_last = st


func fired(_kind: String) -> void:
	_flash_t = 0.05
	shot_t = Game.clock
	shot_pos = eye_position()


func _v(st: PackedFloat32Array, i: int) -> Vector3:
	return Vector3(st[i], st[i + 1], st[i + 2])


func _process(delta: float) -> void:
	var st := _last
	if st.size() < 31:
		return
	var ragdoll := st[30] > 0.5
	down = ragdoll
	if ragdoll:
		_show_ragdoll(st)
		return
	var root := Transform3D(Basis(Vector3.UP, st[3]), _v(st, 0))
	var view := Transform3D(Basis(Quaternion(st[21], st[22], st[23], st[24])), _v(st, 25))
	var hands := [_v(st, 9), _v(st, 12)]
	var dirs := [_v(st, 15), _v(st, 18)]
	_body.update(root, st[4], st[5], _v(st, 6), hands, dirs, view, delta, false, st[28])
	_ensure_person(root)
	_h.visible = true
	var wrist_r := _pose(root, view, hands, st[28])
	_flush(delta)
	hitbox.global_position = root.origin
	var head_p: Vector3 = _h.head.global_position
	_eye = head_p + Vector3.UP * 0.03
	_label.global_position = head_p + Vector3.UP * 0.35
	# The gun in the right hand, pointing where they look.
	var kind: String = KINDS[clampi(int(st[29]), 0, KINDS.size() - 1)]
	if kind != _gun_kind:
		_gun_kind = kind
		if _gun:
			_gun.queue_free()
			_gun = null
		match kind:
			"pistol", "revolver":
				_gun = Models.pistol()
			"shotgun":
				_gun = Models.shotgun()
			"akm":
				_gun = Models.akm()
			"sawnoff":
				_gun = Models.sawnoff()
			"crossbow":
				_gun = Models.crossbow()
			"nailgun":
				_gun = Models.nailgun()
			"flaregun":
				_gun = Models.flaregun()
			"rifle":
				_gun = Models.rifle()
		if _gun:
			add_child(_gun)
			_gun.top_level = true
	if _gun:
		_gun.visible = true
		_gun.global_transform = Transform3D(view.basis, wrist_r + view.basis * Vector3(0, 0.03, -0.05))


## Lying down: every part placed where theirs is.
func _show_ragdoll(st: PackedFloat32Array) -> void:
	var n := int(st[31]) if st.size() > 31 else 0
	_ensure_person(Transform3D(Basis(Vector3.UP, st[3]), _v(st, 0)))
	if _gun:
		_gun.visible = false
	var k := 32
	for i in mini(n, _h.parts.size()):
		if k + 7 > st.size():
			break
		var to := Transform3D(Basis(Quaternion(st[k + 3], st[k + 4], st[k + 5], st[k + 6])), Vector3(st[k], st[k + 1], st[k + 2]))
		var p: RigidBody3D = _h.parts[i]
		p.global_transform = p.global_transform.interpolate_with(to, 0.5)
		k += 7
	_flush(get_process_delta_time())
	hitbox.global_position = _h.pelvis.global_position + Vector3.DOWN * 0.9


## The person that is seen: made once, held still (placed part by part).
func _ensure_person(root: Transform3D) -> void:
	if _h != null and is_instance_valid(_h):
		return
	_h = Humanoid.new()
	_h.bot_seed = 1000 + peer % 9000
	get_parent().add_child(_h)
	_h.spawn(root.origin, atan2(root.basis.z.x, root.basis.z.z))
	if _h.ai:
		_h.ai.process_mode = Node.PROCESS_MODE_DISABLED
	_h.process_mode = Node.PROCESS_MODE_DISABLED
	_h.set_meta("puppet", true)
	_h.set_meta("remote_player", peer)
	_s = _h.scale_factor
	for p in _h.parts:
		p.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
		p.freeze = true
		p.process_mode = Node.PROCESS_MODE_ALWAYS
		p.set_meta("remote_player", peer)


func _flush(delta: float) -> void:
	if _h.blood_map:
		_h.blood_map.flush(delta)


func _j(name_: String, sx := 1.0) -> Vector3:
	var j: Vector3 = JOINT[name_]
	return Vector3(j.x * sx, j.y, j.z) * _s


## A part hung from its joint at `joint` (world), turned by `b`.
func _put(part: String, joint_name: String, sx: float, joint: Vector3, b: Basis) -> void:
	var p: RigidBody3D = _h.parts[_h.part_index[part]]
	var rest: Vector3 = p.get_meta("rest_pos")
	p.global_transform = Transform3D(b, joint + b * (rest - _j(joint_name, sx)))


## A limb's turn: its length along `d` (from its joint towards the next),
## its side towards `right`.
static func _limb(d: Vector3, right: Vector3) -> Basis:
	var y := -d.normalized()
	var x := right - y * right.dot(y)
	x = x.normalized() if x.length() > 1e-3 else Vector3.RIGHT
	return Basis(x, y, x.cross(y))


## Poses the person from the unseen first-person body's joints; returns
## where the right hand is (for the gun).
func _pose(root: Transform3D, view: Transform3D, hands: Array, crouch: float) -> Vector3:
	var pts: Dictionary = _body.pts
	var hb: Basis = pts.get("hips", Basis())
	var cb: Basis = pts.get("chest", hb)
	# The hips over the feet (dropping as they crouch).
	var body := Transform3D(hb, root.origin + Vector3.DOWN * 0.42 * crouch * _s)
	var pj := body * _j("pelvis")
	_put("pelvis", "pelvis", 1.0, pj, hb)
	var ab := hb.slerp(cb, 0.5)
	var aj := body * _j("abdomen")
	_put("abdomen", "abdomen", 1.0, aj, ab)
	var cj := aj + ab * (_j("chest") - _j("abdomen"))
	_put("chest", "chest", 1.0, cj, cb)
	var chest_f := Transform3D(cb, cj - cb * _j("chest"))
	# The head: where they look, but a neck only turns so far.
	var e := view.basis.get_euler()
	var hy := atan2(cb.z.x, cb.z.z)
	var head_b := Basis.from_euler(Vector3(clampf(e.x, -0.9, 0.7), hy + clampf(wrapf(e.y - hy, -PI, PI), -1.2, 1.2), 0.0))
	_put("head", "head", 1.0, chest_f * _j("head"), head_b)
	var wrist_r := Vector3.ZERO
	for side in ["r", "l"]:
		var sx := 1.0 if side == "r" else -1.0
		# Legs: the stride of their own body, carried over from its hips.
		var hip := body * _j("thigh", sx)
		var fps_hip: Vector3 = pts.get("hip_" + side, hip)
		var fps_ankle: Vector3 = pts.get("ankle_" + side, hip + Vector3.DOWN * 0.84)
		var foot := hip + (fps_ankle - fps_hip)
		foot.y = maxf(foot.y, root.origin.y + 0.08 * _s)
		var l1 := (_j("thigh").y - _j("shin").y)
		var l2 := (_j("shin").y - _j("foot").y)
		var leg: Array = _body._ik(hip, foot, l1, l2, -hb.z + Vector3.UP * 0.2)
		_put("thigh_" + side, "thigh", sx, hip, _limb(leg[0] - hip, hb.x))
		_put("shin_" + side, "shin", sx, leg[0], _limb(leg[1] - leg[0], hb.x))
		_put("foot_" + side, "foot", sx, leg[1], hb)
		# Arms: from this chest's shoulders to where their hands are (as far
		# out from their shoulders as those are), or hanging.
		var sh := chest_f * _j("upper_arm", sx)
		var target: Vector3 = hands[0 if side == "r" else 1]
		var fps_sh: Vector3 = pts.get("shoulder_" + side, sh)
		if target == Vector3.INF or not target.is_finite():
			var fps_w: Vector3 = pts.get("wrist_" + side, fps_sh + Vector3.DOWN * 0.55)
			target = sh + (fps_w - fps_sh)
		else:
			target = sh + (target - fps_sh)
		var a1 := _j("upper_arm").y - _j("forearm").y
		var a2 := _j("forearm").y - _j("hand").y
		var arm: Array = _body._ik(sh, target, a1, a2, Vector3.DOWN + cb.x * sx * 0.8 + cb.z * 0.3)
		var fb := _limb(arm[1] - arm[0], cb.x)
		_put("upper_arm_" + side, "upper_arm", sx, sh, _limb(arm[0] - sh, cb.x))
		_put("forearm_" + side, "forearm", sx, arm[0], fb)
		_put("hand_" + side, "hand", sx, arm[1], fb)
		if side == "r":
			wrist_r = arm[1]
	return wrist_r


## A bullet of someone's went into them here (net.gd): shown on the body.
func wound(part_i: int, local_p: Vector3, local_dir: Vector3, kind: String) -> void:
	if _h == null or not is_instance_valid(_h) or part_i < 0 or part_i >= _h.parts.size():
		return
	var part: RigidBody3D = _h.parts[part_i]
	var at := part.global_transform * local_p
	var dir := (part.global_basis * local_dir).normalized()
	var pname: String = part.get_meta("part", "")
	var region := "head" if pname == "head" else ("torso" if pname in ["chest", "abdomen", "pelvis"] else "limb")
	if Game.blood:
		Game.blood.on_hit(_h, part, at, dir, kind, region, 8.0 if region != "limb" else 4.0, false)
	load("res://scripts/fx/flesh_wounds.gd").bullet(part, at, dir, Vector3.INF, kind in ["akm", "revolver"])


func _exit_tree() -> void:
	if _h and is_instance_valid(_h):
		_h.queue_free()
