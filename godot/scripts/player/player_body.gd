extends Node3D
## The player's own body in first person: legs that step with the walk, the
## torso, and arms that reach for whatever the hands hold (the gun's grip and
## forend, the cigarette, a grabbed object) or hang and swing when empty.
## Solved with two-bone IK every frame; casts a shadow like everyone else.
##
## The chest turns with the view and leans over when looking down; the hips
## lag behind and catch up in a step when the twist gets too big (or at once
## when walking). The head is there for the shadow only. Anything that comes
## close to the camera dissolves (dithered distance fade), so the view is
## never blocked by the inside of a sleeve or the chest.

const THIGH := 0.44
const SHIN := 0.44
const UPPER_ARM := 0.3
const FOREARM := 0.28
const BodyShader = preload("res://shaders/player_body.gdshader")
const MAX_TWIST := 0.8       # rad the chest can turn over the hips before the feet follow
const REACH := UPPER_ARM + FOREARM

var _seg := {}        # name -> MeshInstance3D (unit-height cylinder, scaled)
var _ball := {}       # name -> MeshInstance3D (joint / hand / foot)
var _torso: MeshInstance3D
var _pelvis: MeshInstance3D
var _head: MeshInstance3D
var _neck: MeshInstance3D
var _yoke: MeshInstance3D
var _mats := {}
var wounds: Array = []            # the vitals' wounds (vitals.gd), shown on the body
var _wound_mi: Array = []         # per wound: [soaked patch, hole, bandage]
var _hip_yaw := 0.0
var _hip_init := false
var _turning := false
var _blade := 0.0            # rad the chest is turned right to hold a long gun

## Filled every update, for the weapon reach limits.
var shoulder_r := Vector3.ZERO
var shoulder_l := Vector3.ZERO
var chest_a := Vector3.ZERO    # torso axis bottom
var chest_b := Vector3.ZERO    # torso axis top
## Joint points and frames of the last pose, for the ragdoll to start from.
var pts := {}
## Bandage on the left forearm: 0 = none .. 1 = wrapped wrist to elbow.
## While wrapping, `bandage_hand` is where the loose strip goes (right hand).
var bandage := 0.0
var bandage_on: Array = []        # [from point, to point, start, span]: where it is being wound on
var bandage_hand := Vector3.INF
var _bandage_wrap: MeshInstance3D
var _strip: MeshInstance3D
var _roll: MeshInstance3D


func setup() -> void:
	top_level = true
	# Placed every frame under the view (not every physics tick): physics
	# interpolation would only drag it a tick behind and make it jerk.
	physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	_mats["jacket"] = _mat(Color(0.12, 0.13, 0.15), 0.9, 0.1, 0.34)
	_mats["jeans"] = _mat(Color(0.14, 0.17, 0.24), 0.95, 0.1, 0.34)
	_mats["shoe"] = _mat(Color(0.06, 0.05, 0.05), 0.7, 0.1, 0.34)
	_mats["sleeve"] = _mat(Color(0.12, 0.13, 0.15), 0.9, 0.1, 0.22)
	_mats["skin"] = _mat(Color(0.82, 0.64, 0.52), 0.6, 0.02, 0.06)
	_torso = _capsule(0.17, 0.52, "jacket")
	_pelvis = _capsule(0.155, 0.36, "jeans")
	for side in ["l", "r"]:
		_seg["thigh_" + side] = _cyl(0.075, "jeans")
		_seg["shin_" + side] = _cyl(0.058, "jeans")
		_ball["knee_" + side] = _sphere(0.062, "jeans")
		_ball["foot_" + side] = _box(Vector3(0.1, 0.08, 0.26), "shoe")
		_seg["upper_arm_" + side] = _cyl(0.056, "sleeve")
		_seg["forearm_" + side] = _cyl(0.047, "sleeve")
		_ball["elbow_" + side] = _sphere(0.05, "sleeve")
		_ball["shoulder_" + side] = _sphere(0.07, "jacket")
		_ball["hand_" + side] = _box(Vector3(0.035, 0.085, 0.06), "skin")   # fist: thin across, tall round the grip
	# Shoulder line across the top of the chest (reads right in the shadow).
	_yoke = _capsule(0.085, 0.46, "jacket")
	# Bandage: wrapped layer, the loose strip being wound on, the roll in hand.
	_mats["cloth"] = _mat(Color(0.86, 0.84, 0.78), 0.95, 0.03, 0.08)
	_bandage_wrap = _cyl(0.054, "cloth")
	_bandage_wrap.visible = false
	_strip = _box(Vector3(0.035, 1.0, 0.003), "cloth")
	_strip.visible = false
	_roll = _cyl(0.022, "cloth")
	_roll.visible = false
	# Head and neck: seen only in the shadow.
	_head = _sphere(0.105, "skin")
	_head.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
	_neck = _cyl(0.065, "skin")
	_neck.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY


## Dithered fade near the camera: fully gone closer than `near`, solid past `far`.
## (blood soaks into all of them round the wounds: shaders/player_body.gdshader)
func _mat(c: Color, rough: float, near: float, far: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = BodyShader
	m.set_shader_parameter("albedo", c)
	m.set_shader_parameter("rough", rough)
	m.set_shader_parameter("fade_near", near)
	m.set_shader_parameter("fade_far", far)
	return m


func _add(mesh: Mesh, mat: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = _mats[mat]
	mi.layers = 4          # keeps world blood decals off the player's body
	add_child(mi)
	return mi


func _cyl(r: float, mat: String) -> MeshInstance3D:
	var c := CylinderMesh.new()
	c.top_radius = r
	c.bottom_radius = r * 0.9
	c.height = 1.0
	c.radial_segments = 12
	return _add(c, mat)


func _sphere(r: float, mat: String) -> MeshInstance3D:
	var s := SphereMesh.new()
	s.radius = r
	s.height = r * 2.0
	s.radial_segments = 12
	s.rings = 6
	return _add(s, mat)


func _capsule(r: float, h: float, mat: String) -> MeshInstance3D:
	var c := CapsuleMesh.new()
	c.radius = r
	c.height = h
	c.radial_segments = 16
	c.rings = 4
	return _add(c, mat)


func _box(size: Vector3, mat: String) -> MeshInstance3D:
	var b := BoxMesh.new()
	b.size = size
	return _add(b, mat)


## Places a unit cylinder between a and b.
func _place(mi: MeshInstance3D, a: Vector3, b: Vector3) -> void:
	var y := b - a
	var l := y.length()
	if l < 1e-4:
		return
	var yn := y / l
	var x := yn.cross(Vector3.FORWARD if absf(yn.z) < 0.9 else Vector3.RIGHT).normalized()
	var z := x.cross(yn)
	mi.global_transform = Transform3D(Basis(x, y, z), (a + b) * 0.5)


## Two-bone IK: returns [joint, end]; the joint bends towards `pole`.
func _ik(a: Vector3, target: Vector3, l1: float, l2: float, pole: Vector3) -> Array:
	var d := target - a
	var dist := clampf(d.length(), 0.02, l1 + l2 - 0.002)
	var dir := d.normalized() if d.length() > 1e-4 else Vector3.DOWN
	var cos_a := clampf((l1 * l1 + dist * dist - l2 * l2) / (2.0 * l1 * dist), -1.0, 1.0)
	var axis := dir.cross(pole)
	if axis.length() < 1e-4:
		axis = dir.cross(Vector3.RIGHT)
	axis = axis.normalized()
	var joint := a + dir.rotated(axis, acos(cos_a)) * l1
	return [joint, a + dir * dist]


## Wraps an angle difference into -PI..PI.
func _wrap(a: float) -> float:
	return wrapf(a, -PI, PI)


## root: feet position and view yaw; phase/stride: walk cycle; hands: world
## targets for [right, left] (Vector3.INF = hang free); hand_dirs: which way
## each hand points. view: the camera transform (for the lean, twist and the
## head's shadow). hide_r: the right hand is drawn by someone else (smoking).
func update(root: Transform3D, phase: float, stride: float, move_dir: Vector3, hands: Array, hand_dirs: Array,
		view: Transform3D, delta: float, hide_r := false, crouch := 0.0, feet_targets: Array = []) -> void:
	# Hips: lag behind the view yaw, catch up when walking or twisted too far.
	var view_yaw := atan2(root.basis.z.x, root.basis.z.z)
	if not _hip_init:
		_hip_yaw = view_yaw
		_hip_init = true
	var twist := _wrap(view_yaw - _hip_yaw)
	if stride > 0.15 or absf(twist) > MAX_TWIST:
		_turning = true
	if _turning:
		_hip_yaw += twist * minf(delta * (10.0 if stride > 0.15 else 7.0), 1.0)
		if absf(_wrap(view_yaw - _hip_yaw)) < 0.05:
			_turning = false
	var hb := Basis(Vector3.UP, _hip_yaw)
	var hips := Transform3D(hb, root.origin)
	var fwd := -hb.z
	twist = _wrap(view_yaw - _hip_yaw)
	# A little step in place while the feet catch up with the turn.
	var turn_step := clampf(absf(twist) * 3.0, 0.0, 1.0) if _turning and stride < 0.15 else 0.0
	stride = maxf(stride, turn_step * 0.35)

	# Chest: turned with the view, bent over when looking down.
	var pitch := view.basis.get_euler().x
	var lean := clampf(-pitch - 0.25, 0.0, 1.0) * 0.18 - clampf(pitch - 0.3, 0.0, 1.0) * 0.08
	lean += crouch * 0.35
	# A long gun held in both hands is held bladed: the chest turns a little to
	# the right so the left shoulder comes forward to the forend.
	var blade_want := 0.0
	var tl: Vector3 = hands[1]
	if tl != Vector3.INF and hands[0] != Vector3.INF:
		var cb0 := Basis(Vector3.UP, _hip_yaw + twist * 0.85)
		var sh0 := hips * Vector3(0, 0.95 - 0.5 * crouch, 0.1 + 0.12 * crouch) + cb0 * Vector3(-0.19, 0.45, 0.06)
		blade_want = clampf((sh0.distance_to(tl) - REACH * 0.8) / 0.19, 0.0, 0.75)
	_blade = move_toward(_blade, blade_want, delta * 3.0)
	var cb := Basis(Vector3.UP, _hip_yaw + twist * 0.85 - _blade) * Basis(Vector3.RIGHT, -lean)
	# Crouching: the hips drop and go back, the knees bend forward.
	var waist := hips * Vector3(0, 0.95 - 0.5 * crouch, 0.1 + 0.12 * crouch)
	_pelvis.global_transform = Transform3D(Basis(Vector3.UP, _hip_yaw + twist * 0.3) * Basis(Vector3.FORWARD, PI * 0.5), waist)
	# Chest and hips sit under and behind the eyes: looking down you see the
	# front of the chest and the legs ahead of it.
	var chest_c := waist + cb * Vector3(0, 0.22, 0.06)
	_torso.global_transform = Transform3D(cb.scaled_local(Vector3(1.0, 1.0, 0.62)), chest_c)
	chest_a = waist + cb * Vector3(0, 0.02, 0.06)
	chest_b = waist + cb * Vector3(0, 0.42, 0.04)
	pts["hips"] = hb
	pts["chest"] = cb
	pts["waist"] = waist
	pts["view"] = view

	# Head (shadow only) around the eyes, and the neck down to the chest.
	# The eyes sit in the front upper half of the head.
	var head_c := view * Vector3(0, 0.0, 0.085)
	_head.global_transform = Transform3D(view.basis.orthonormalized().scaled_local(Vector3(0.9, 1.12, 1.05)), head_c)
	_place(_neck, waist + cb * Vector3(0, 0.44, 0.07), head_c + Vector3.DOWN * 0.08)
	_yoke.global_transform = Transform3D(cb * Basis(Vector3.FORWARD, PI * 0.5), waist + cb * Vector3(0, 0.43, 0.07))

	for side in ["r", "l"]:
		var sx := 1.0 if side == "r" else -1.0
		# Legs: feet step along the direction of travel and lift on the swing.
		var ph := phase + (0.0 if side == "r" else PI)
		var hip := hips * Vector3(0.1 * sx, 0.9 - 0.5 * crouch, 0.08 + 0.12 * crouch)
		var md := move_dir if move_dir.length() > 0.1 else fwd
		var foot := hips.origin + hb.x * 0.11 * sx - hb.z * 0.02 + md * sin(ph) * 0.28 * stride \
				+ Vector3.UP * (0.06 + maxf(0.0, cos(ph)) * 0.11 * stride)
		if not feet_targets.is_empty():
			# Climbing: the foot goes where it is put (ledge, wall, tucked up).
			var ft: Array = feet_targets[0 if side == "r" else 1]
			foot = foot.lerp(ft[0], clampf(ft[1], 0.0, 1.0))
		var leg := _ik(hip, foot, THIGH, SHIN, fwd + Vector3.UP * 0.2)
		pts["hip_" + side] = hip
		pts["knee_" + side] = leg[0]
		pts["ankle_" + side] = leg[1]
		_place(_seg["thigh_" + side], hip, leg[0])
		_place(_seg["shin_" + side], leg[0], leg[1])
		_ball["knee_" + side].global_position = leg[0]
		_ball["foot_" + side].global_transform = Transform3D(hb, (leg[1] as Vector3) + fwd * 0.06 + Vector3.DOWN * 0.02)
		# Arms, from shoulders on the turned and leaning chest.
		var shoulder := waist + cb * Vector3(0.19 * sx, 0.45, 0.06)
		if side == "r":
			shoulder_r = shoulder
		else:
			shoulder_l = shoulder
		_ball["shoulder_" + side].global_position = shoulder
		var target: Vector3 = hands[0 if side == "r" else 1]
		if target == Vector3.INF:
			var swing := sin(ph + PI) * 0.12 * stride
			target = shoulder + cb.x * 0.04 * sx + Vector3.DOWN * 0.56 + (-cb.z) * (0.06 + swing)
		else:
			# The shoulder reaches out (protracts) toward a hold just out of reach.
			var d := target - shoulder
			var excess := d.length() - REACH * 0.985
			if excess > 0.0:
				shoulder += d.normalized() * minf(excess, 0.16)
				_ball["shoulder_" + side].global_position = shoulder
		var arm := _ik(shoulder, target, UPPER_ARM, FOREARM, Vector3.DOWN + cb.x * sx * 0.8 + cb.z * 0.3)
		_place(_seg["upper_arm_" + side], shoulder, arm[0])
		_place(_seg["forearm_" + side], arm[0], arm[1])
		_ball["elbow_" + side].global_position = arm[0]
		pts["shoulder_" + side] = shoulder
		pts["elbow_" + side] = arm[0]
		pts["wrist_" + side] = arm[1]
		pts["target_" + side] = target
		# The fist carries on straight from the forearm, closed round what it holds.
		var hy := ((arm[1] as Vector3) - (arm[0] as Vector3)).normalized()
		var hd: Vector3 = hand_dirs[0 if side == "r" else 1]
		var side_ref := hd if hd != Vector3.ZERO and absf(hy.dot(hd.normalized())) < 0.9 else (-cb.z if absf(hy.dot(-cb.z)) < 0.9 else Vector3.UP)
		var hx := hy.cross(side_ref).normalized()
		var hand: MeshInstance3D = _ball["hand_" + side]
		hand.global_transform = Transform3D(Basis(hx, hy, hx.cross(hy)), (arm[1] as Vector3) + hy * 0.015)
		hand.visible = not (hide_r and side == "r")
	_place_bandage()
	_place_wounds()



## The wrapped part covers the forearm from the wrist up; the strip runs from
## the edge of the wrapping to the right hand, which holds the roll.
func _place_bandage() -> void:
	_bandage_wrap.visible = bandage > 0.01 and bandage_on.size() == 4 and pts.has(bandage_on[0])
	var wrapping := bandage_hand != Vector3.INF and _bandage_wrap.visible
	_strip.visible = wrapping
	_roll.visible = wrapping
	if not _bandage_wrap.visible:
		return
	var w: Vector3 = pts[bandage_on[0]]
	var e: Vector3 = pts[bandage_on[1]]
	var s0: float = bandage_on[2]
	var front := w.lerp(e, s0 + float(bandage_on[3]) * bandage)
	_place(_bandage_wrap, w.lerp(e, s0), front)
	# (thicker round a leg than an arm)
	var thick := 1.5 if String(bandage_on[0]).begins_with("hip") or String(bandage_on[0]).begins_with("knee") else 1.0
	_bandage_wrap.global_transform.basis = _bandage_wrap.global_transform.basis.scaled_local(Vector3(thick, 1.0, thick))
	if wrapping:
		var d := bandage_hand - front
		if d.length() > 0.01:
			var y := d.normalized()
			var x := y.cross((e - w).normalized())
			x = x.normalized() if x.length() > 0.01 else y.cross(Vector3.UP).normalized()
			_strip.global_transform = Transform3D(Basis(x, y, x.cross(y)).scaled_local(Vector3(1, d.length(), 1)), (front + bandage_hand) * 0.5)
		_roll.global_transform = Transform3D(Basis(Vector3.UP, 0.0).scaled_local(Vector3(1, 0.05, 1)), bandage_hand)


# --- Wounds -------------------------------------------------------------------------

const LIMB := {"thigh": ["hip_", "knee_", 0.075], "shin": ["knee_", "ankle_", 0.058],
		"upper_arm": ["shoulder_", "elbow_", 0.056], "forearm": ["elbow_", "wrist_", 0.047]}


## Where a wound is on the body now: [point, outward normal, down along the
## surface], or [] if it is nowhere to be shown (the head).
func wound_frame(w: Dictionary) -> Array:
	var seg: String = w["seg"]
	var ang: float = w["ang"]
	if LIMB.has(seg):
		var l: Array = LIMB[seg]
		var side: String = w["side"]
		if not pts.has(l[0] + side):
			return []
		var a: Vector3 = pts[l[0] + side]
		var b: Vector3 = pts[l[1] + side]
		var y := (b - a).normalized()
		var hb: Basis = pts["hips"]
		var u := -hb.z - y * (-hb.z).dot(y)
		u = u.normalized() if u.length() > 0.05 else hb.x
		var v := y.cross(u)
		var radial := u * cos(ang) + v * sin(ang)
		var p: Vector3 = a.lerp(b, float(w["t"])) + radial * float(l[2])
		return [p, radial, _down_along(radial, y)]
	if seg == "torso" and pts.has("chest"):
		var cb: Basis = pts["chest"]
		var waist: Vector3 = pts["waist"]
		var p := waist + cb * Vector3(sin(ang) * 0.16, float(w["t"]), 0.06 - cos(ang) * 0.1)
		var n := (cb * Vector3(sin(ang) / 0.16, 0.0, -cos(ang) / 0.1)).normalized()
		return [p, n, _down_along(n, -cb.y)]
	return []


static func _down_along(n: Vector3, fallback: Vector3) -> Vector3:
	var d := Vector3.DOWN - n * Vector3.DOWN.dot(n)
	return d.normalized() if d.length() > 0.2 else fallback


## Blood soaking out round each wound (spreading, and running down) and the
## dark hole in it - drawn into the clothes and skin by their shader - and a
## bandage over it once one is on.
func _place_wounds() -> void:
	var at := []
	var run := []
	for i in 6:
		at.append(Vector4.ZERO)
		run.append(Vector4.ZERO)
	var n := 0
	for w in wounds:
		if n >= 6:
			break
		var f: Array = wound_frame(w)
		if f.is_empty() or w.get("strap", false):
			continue
		var soak := clampf(float(w["soak"]) / 220.0, 0.0, 1.0)
		var p: Vector3 = f[0]
		at[n] = Vector4(p.x, p.y, p.z, 0.02 + 0.075 * soak)
		run[n] = Vector4(0.2 * soak, 0.0 if w["bandaged"] else 1.0, 0.0, 0.0)
		n += 1
	for m in _mats.values():
		(m as ShaderMaterial).set_shader_parameter("wounds", at)
		(m as ShaderMaterial).set_shader_parameter("wound_run", run)
	while _wound_mi.size() < wounds.size():
		_wound_mi.append(_cyl(1.0, "cloth"))
	for i in _wound_mi.size():
		var wrap: MeshInstance3D = _wound_mi[i]
		var w: Dictionary = wounds[i] if i < wounds.size() else {}
		wrap.visible = not w.is_empty() and w["bandaged"]
		if not wrap.visible:
			continue
		var f: Array = wound_frame(w)
		if f.is_empty():
			wrap.visible = false
			continue
		# The bandage: round the limb, or a pad on the trunk.
		var seg: String = w["seg"]
		if LIMB.has(seg):
			var l: Array = LIMB[seg]
			var a: Vector3 = pts[l[0] + w["side"]]
			var b: Vector3 = pts[l[1] + w["side"]]
			var c: Vector3 = a.lerp(b, float(w["t"]))
			var y := (b - a).normalized()
			var rr: float = float(l[2]) * 1.15
			_place(wrap, c - y * 0.05, c + y * 0.05)
			wrap.global_transform.basis = wrap.global_transform.basis.orthonormalized().scaled_local(Vector3(rr, 0.1, rr))
		else:
			var p: Vector3 = f[0]
			var nn: Vector3 = f[1]
			var up: Vector3 = -(f[2] as Vector3)
			var x := up.cross(nn).normalized()
			wrap.global_transform = Transform3D(Basis(x * 0.07, nn * 0.01, up * 0.06), p + nn * 0.006)
