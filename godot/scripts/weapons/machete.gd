extends RigidBody3D
## Machete: a real body in the world, carried by the hand. The hand does not
## place it - it pulls it (hard, but no harder than an arm can) towards where
## it should be, so the blade stops against walls, rests on things, drags
## along them and can be left stuck in wood; in people it cuts (blade_cut.gd,
## driven by the player) and the flesh it cannot cut stops it.
## Origin at the middle of the grip; the blade points along -Z, its edge
## down (-Y), the spine up.

const Sfx = preload("res://scripts/audio/sfx.gd")
const Tex = preload("res://scripts/world/textures.gd")

const BLADE_ROOT := Vector3(0.0, 0.0, -0.1)
const BLADE_TIP := Vector3(0.0, 0.0, -0.56)
const HALF := 0.022              # blade depth either side of its line
const ARM_MASS := 1.6            # blade and the forearm behind it, for the swing (kg)
const HAND_FORCE := 520.0        # most the arm pulls with (N)
const HAND_TORQUE := 60.0        # and turns with (N m; against the blade and forearm)
const MAX_SPEED := 22.0          # an arm's limits (m/s, rad/s)
const MAX_SPIN := 30.0

var target := Transform3D()      # where the hand wants it (world)
var hand_force := HAND_FORCE     # how hard the arm pulls it there now (N)
var stuck := false               # left in wood or a wall
var _stuck_body: Node3D
var _stuck_xf := Transform3D()   # its pose relative to what it is stuck in
var _prev_speed := 0.0

## Brought up short against something solid (not flesh): how fast it was going.
signal struck(speed: float)


func _init() -> void:
	collision_layer = 0
	collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS
	mass = 0.7
	gravity_scale = 0.0
	continuous_cd = true
	can_sleep = false
	contact_monitor = true
	max_contacts_reported = 4
	linear_damp = 0.0
	angular_damp = 0.0
	top_level = true
	# Dark worn carbon steel with a bright ground edge: it has to read in the
	# gloom too, so it is not a perfect mirror (a mirror shows only the dark
	# room round it).
	var steel := StandardMaterial3D.new()
	steel.albedo_color = Color(0.64, 0.64, 0.63)
	steel.metallic = 0.45
	steel.roughness = 0.38
	steel.normal_enabled = true
	steel.normal_texture = Tex.noise("machete_scratch", 0.6, 3, 128, true, 1.0)
	steel.normal_scale = 0.25
	steel.uv1_triplanar = true
	steel.uv1_scale = Vector3.ONE * 30.0
	var edge := StandardMaterial3D.new()
	edge.albedo_color = Color(0.92, 0.92, 0.92)
	edge.metallic = 0.55
	edge.roughness = 0.22
	var grip := StandardMaterial3D.new()
	grip.albedo_color = Color(0.07, 0.055, 0.045)
	grip.roughness = 0.85
	grip.normal_enabled = true
	grip.normal_texture = Tex.noise("grip_grain", 1.2, 2, 64, true, 2.0)
	grip.uv1_triplanar = true
	grip.uv1_scale = Vector3.ONE * 20.0
	var brass := StandardMaterial3D.new()
	brass.albedo_color = Color(0.62, 0.5, 0.3)
	brass.metallic = 0.9
	brass.roughness = 0.4
	# The handle: two slabs either side of the tang, swelling to a hooked
	# butt; brass rivets through them.
	var hmesh := MeshInstance3D.new()
	hmesh.mesh = _handle()
	hmesh.material_override = grip
	add_child(hmesh)
	var tang := MeshInstance3D.new()
	var tb := BoxMesh.new()
	tb.size = Vector3(0.004, 0.026, 0.13)
	tang.mesh = tb
	tang.material_override = steel
	tang.position = Vector3(0.0, 0.0, 0.0)
	add_child(tang)
	# The steel bolster where the blade meets the handle.
	var bol := MeshInstance3D.new()
	var bb := BoxMesh.new()
	bb.size = Vector3(0.012, 0.038, 0.022)
	bol.mesh = bb
	bol.material_override = steel
	bol.position = Vector3(0.0, -0.001, -0.076)
	add_child(bol)
	for z in [0.045, -0.005, -0.05]:
		var rv := MeshInstance3D.new()
		var rc := CylinderMesh.new()
		rc.top_radius = 0.0035
		rc.bottom_radius = 0.0035
		rc.height = 0.0295
		rc.radial_segments = 8
		rv.mesh = rc
		rv.material_override = brass
		rv.rotation = Vector3(0, 0, PI * 0.5)
		rv.position = Vector3(0.0, 0.0, z)
		add_child(rv)
	# The blade: thick at the spine, thinning to the ground bevel, a fuller
	# groove along it; widening towards the tip, where the weight is.
	var blade := MeshInstance3D.new()
	blade.mesh = _blade(false)
	blade.material_override = steel
	add_child(blade)
	var bevel := MeshInstance3D.new()
	bevel.mesh = _blade(true)
	bevel.material_override = edge
	add_child(bevel)
	for c in get_children():
		(c as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(0.008, 0.05, 0.46)
	cs.shape = bs
	cs.position = Vector3(0.0, 0.0, -0.33)
	add_child(cs)
	var hs := CollisionShape3D.new()
	var hb := BoxShape3D.new()
	hb.size = Vector3(0.03, 0.035, 0.14)
	hs.shape = hb
	add_child(hs)


func _box(size: Vector3, pos: Vector3, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	add_child(mi)


## The blade's outline along its length (z), as [spine y, edge y].
static func _profile(u: float) -> Vector2:
	# Straight spine, then a clipped point dropping to the tip; the edge
	# bellies out towards the end (the weight forward) and sweeps up to it.
	var t := maxf(u - 0.74, 0.0) / 0.26
	var spine := lerpf(0.022 - 0.003 * u, -0.004, pow(t, 1.25))
	var edge_y := lerpf(-0.022 - 0.014 * sin(u * PI * 0.9), -0.004, pow(t, 2.4))
	return Vector2(spine, minf(edge_y, spine - 0.0005))


## The blade as a solid: in section a flat-sided wedge (5 mm at the spine,
## 1.5 mm where the edge bevel begins, a hair at the edge). `bevel` gives only
## the bright ground strip along the edge.
static func _blade(bevel: bool) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var steps := 24
	var rows: Array = []
	for i in steps + 1:
		var u := float(i) / steps
		var z := lerpf(-0.075, -0.56, u)
		var pr := _profile(u)
		var h := pr.x - pr.y
		var b_y := pr.y + minf(0.011, h * 0.45)       # top of the edge bevel
		var th := lerpf(0.0026, 0.0016, u)             # half-thickness at the spine
		var tb := 0.0008                               # at the top of the bevel
		# (the fuller: a shallow groove a third of the way down from the spine)
		var f_y := pr.x - h * 0.3
		rows.append([z, pr.x, f_y, b_y, pr.y, th, tb])
	for i in steps:
		var r0: Array = rows[i]
		var r1: Array = rows[i + 1]
		for side in [1.0, -1.0]:
			var bands: Array
			if bevel:
				bands = [[3, 4, 6, 0.0003]]
			else:
				bands = [[1, 2, 5, 5], [2, 3, 5, 6]]
			for bd in bands:
				var ya0: float = r0[bd[0]]
				var yb0: float = r0[bd[1]]
				var ya1: float = r1[bd[0]]
				var yb1: float = r1[bd[1]]
				var xa0: float = r0[bd[2]] if bd[2] is int else bd[2]
				var xa1: float = r1[bd[2]] if bd[2] is int else bd[2]
				var xb0: float = (r0[bd[3]] if bd[3] is int else bd[3])
				var xb1: float = (r1[bd[3]] if bd[3] is int else bd[3])
				if bd[1] == 2 and not bevel:
					# (the fuller sunk a little into the face)
					xb0 *= 0.8
					xb1 *= 0.8
				var q := [Vector3(xa0 * side, ya0, r0[0]), Vector3(xb0 * side, yb0, r0[0]),
						Vector3(xb1 * side, yb1, r1[0]), Vector3(xa1 * side, ya1, r1[0])]
				_quad(st, q, side < 0.0)
		if not bevel:
			# The flat of the spine on top.
			var t0: float = r0[5]
			var t1: float = r1[5]
			_quad(st, [Vector3(-t0, r0[1], r0[0]), Vector3(t0, r0[1], r0[0]), Vector3(t1, r1[1], r1[0]), Vector3(-t1, r1[1], r1[0])], true)
	st.generate_normals()
	return st.commit()


static func _quad(st: SurfaceTool, q: Array, flip: bool) -> void:
	var order := [0, 1, 2, 0, 2, 3] if not flip else [0, 2, 1, 0, 3, 2]
	for k in order:
		st.add_vertex(q[k])


## The handle slabs round the tang: oval in section, swelling to a hooked butt.
static func _handle() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var steps := 14
	var seg := 12
	var rings: Array = []
	for i in steps + 1:
		var u := float(i) / steps
		var z := lerpf(0.075, -0.07, u)
		var hy := 0.016 + 0.004 * sin(u * PI) + 0.008 * pow(1.0 - u, 4.0)
		var hx := 0.0135 + 0.002 * sin(u * PI)
		var dy := -0.006 * pow(1.0 - u, 3.0)          # the butt hooks down
		var ring: Array = []
		for k in seg:
			var a := TAU * k / seg
			ring.append(Vector3(cos(a) * hx, sin(a) * hy + dy, z))
		rings.append(ring)
	for i in steps:
		for k in seg:
			var k1 := (k + 1) % seg
			_quad(st, [rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]], false)
	# End caps.
	for cap in [[0, false], [steps, true]]:
		var r: Array = rings[cap[0]]
		var c := Vector3(0, 0, (r[0] as Vector3).z)
		for k in seg:
			var tri := [c, r[k], r[(k + 1) % seg]]
			var order := [0, 2, 1] if cap[1] else [0, 1, 2]
			for o in order:
				st.add_vertex(tri[o])
	st.generate_normals()
	return st.commit()


func grip() -> Vector3:
	return global_transform * Vector3(0.0, 0.0, 0.02)


func blade_root() -> Vector3:
	return global_transform * BLADE_ROOT


func blade_tip() -> Vector3:
	return global_transform * BLADE_TIP


func edge_dir() -> Vector3:
	return -global_basis.y


## Velocity of a point on it (world).
func velocity_at(p: Vector3) -> Vector3:
	return linear_velocity + angular_velocity.cross(p - global_position)


## The hand pulls it towards `target`: the velocity it would take to get
## there soon, but changed no faster than the arm's strength allows. Contacts
## (a wall) then stop it; what flesh does to it comes in as `push` (N).
func drive(delta: float, push: Vector3) -> void:
	if stuck:
		_hold_stuck(delta)
		return
	var dv := (target.origin - global_position) / delta * 0.45 - linear_velocity
	dv = dv.limit_length(hand_force * delta / ARM_MASS)
	linear_velocity += dv + push * delta / ARM_MASS
	var q := (target.basis * global_basis.inverse()).get_rotation_quaternion()
	var ang := q.get_angle()
	if ang > PI:
		ang -= TAU
	var w_des := q.get_axis() * ang / delta * 0.45 if absf(ang) > 1e-4 else Vector3.ZERO
	var dw := (w_des - angular_velocity).limit_length(HAND_TORQUE * delta / 0.12)
	angular_velocity = (angular_velocity + dw).limit_length(MAX_SPIN)
	linear_velocity = linear_velocity.limit_length(MAX_SPEED)
	# A hard swing brought up short by something solid: the edge bites into
	# it and stays (wood, the frame of a door; not the flesh - that is cut).
	var speed := velocity_at(blade_root().lerp(blade_tip(), 0.7)).length()
	if _prev_speed > 4.0 and speed < _prev_speed * 0.4 and get_contact_count() > 0:
		struck.emit(_prev_speed)
	if _prev_speed > 7.0 and speed < _prev_speed * 0.35:
		for b in get_colliding_bodies():
			# Wood: a door, a crate, a plank - not concrete.
			if b is RigidBody3D or b.has_method("damage"):
				_stick(b as Node3D, _prev_speed)
				break
	_prev_speed = speed


func _stick(body: Node3D, speed: float) -> void:
	if body == null:
		return
	stuck = true
	_stuck_body = body
	_stuck_xf = body.global_transform.affine_inverse() * global_transform
	freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
	freeze = true
	if body.has_method("damage"):
		body.damage(speed * 0.25, blade_tip(), -global_basis.y)
	Game.play_3d(Sfx.get_stream(&"metal_hit"), blade_tip(), -6.0, 0.15, 3.0)


## Stuck: it stays in (moving with a door it is in) until the hand pulls
## it out, a good tug away from where it sits.
func _hold_stuck(_delta: float) -> void:
	if not is_instance_valid(_stuck_body):
		unstick()
		return
	global_transform = _stuck_body.global_transform * _stuck_xf
	if target.origin.distance_to(global_position) > 0.3:
		unstick()
		linear_velocity = (target.origin - global_position).normalized() * 2.0


func unstick() -> void:
	stuck = false
	_stuck_body = null
	freeze = false
	_prev_speed = 0.0
