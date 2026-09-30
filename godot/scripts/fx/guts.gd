extends Node3D
## Gut spilling out of a wound: one length of bowel, drawn as a single smooth
## tube. It moves as a soft rope (Verlet): points a few centimetres apart that
## keep their spacing, bend easily but do not kink, lie on each other rather
## than through each other, and slide to a stop on whatever they fall on
## (the ground, things, the body itself). The first point stays in the wound
## and goes where the body goes, so the bowel hangs from it, slumps out,
## drapes over the edge and piles up on the ground. Every frame a tube with a
## little swelling and narrowing along it is swept along a smooth curve
## through the points; once it has come to rest it is left alone.

const COUNT := 46
const SEG := 0.035               # spacing of the points
const R := 0.02                  # thickness (for lying on things and itself)
const SIDES := 8                 # round the tube
const SUB := 2                   # tube rings per segment
const ITER := 10                 # constraint passes per step

var _body: RigidBody3D
var _anchor := Vector3.ZERO      # the wound, in the body's space
var _p := PackedVector3Array()
var _q := PackedVector3Array()   # last positions
var _thick := PackedFloat32Array()
var _mesh := ArrayMesh.new()
var _index := PackedInt32Array()  # the tube's triangles (they never change)
var _uv := PackedVector2Array()
var _dirty := true
var _tick := 0
var _mi: MeshInstance3D
var _mat: Material
var _still := 0.0
var _exclude: Array[RID] = []


## Lets the bowel out of the wound at `at` on `body`, pushed out along `out`.
func spill(body: RigidBody3D, at: Vector3, out: Vector3, _count: int, mat: Material) -> void:
	_body = body
	_anchor = body.to_local(at)
	_mat = mat
	_mi = MeshInstance3D.new()
	_mi.mesh = _mesh
	_mi.material_override = mat
	for k in SIDES:
		_cos.append(cos(TAU * k / SIDES))
		_sin.append(sin(TAU * k / SIDES))
	add_child(_mi)
	# Packed in coils at first, just out of the wound.
	var o := out.normalized()
	var side := o.cross(Vector3.UP)
	side = side.normalized() if side.length() > 0.01 else Vector3.RIGHT
	for i in COUNT:
		var a := i * 0.75
		var p := at + o * (0.02 + 0.004 * i) + side * sin(a) * 0.05 + Vector3.UP * cos(a) * 0.04
		_p.append(p)
		_q.append(p - o * 0.012 - Vector3.UP * 0.004)      # moving out
		_thick.append(R * (1.0 + 0.2 * sin(i * 0.8) + 0.1 * sin(i * 2.1)))
	var h = body.get_meta("humanoid") if body.has_meta("humanoid") else null
	if h:
		_exclude = h._ray_exclude.duplicate()
		# (it does lie on the body - only the part it comes out of is left out)
		_exclude = [body.get_rid()]


func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["guts._physics_process"] = Game.prof.get("guts._physics_process", 0) + __d
	Game.prof["max guts._physics_process"] = maxi(Game.prof.get("max guts._physics_process", 0), __d)


func _physics_process_real(delta: float) -> void:
	if _p.is_empty():
		return
	var wound := _p[0]
	if is_instance_valid(_body):
		wound = _body.global_transform * _anchor
	var woke := wound.distance_to(_p[0]) > 0.01
	if _still > 1.0 and not woke:
		return
	# A soft rope needs no more than 60 steps a second.
	_tick += 1
	if _tick % 2 == 1:
		return
	delta *= 2.0
	_dirty = true
	var g := Vector3.DOWN * 9.8 * delta * delta
	var moved := 0.0
	# Move on.
	for i in range(1, COUNT):
		var v := (_p[i] - _q[i]) * 0.985
		_q[i] = _p[i]
		_p[i] += v + g
	_p[0] = wound
	_q[0] = wound
	# Keep the spacing; do not fold back sharply; not through itself.
	for it in ITER:
		for i in COUNT - 1:
			var d := _p[i + 1] - _p[i]
			var l := d.length()
			if l < 1e-6:
				continue
			var fix := d * (1.0 - SEG / l)
			if i == 0:
				_p[i + 1] -= fix
			else:
				_p[i] += fix * 0.5
				_p[i + 1] -= fix * 0.5
		if it % 2 == 0:
			for i in COUNT - 2:
				var d := _p[i + 2] - _p[i]
				var l := d.length()
				var least := SEG * 1.35
				if l < least and l > 1e-6:
					var fix := d * (1.0 - least / l) * 0.25
					if i > 0:
						_p[i] += fix
					_p[i + 2] -= fix
		if it == ITER - 1 and _tick % 4 == 0:
			for i in range(1, COUNT):
				var pi := _p[i]
				for j in range(i + 3, COUNT):
					var d := _p[j] - pi
					var l2 := d.length_squared()
					if l2 > 0.0016:
						continue
					var l := sqrt(l2)
					var least: float = _thick[i] + _thick[j]
					if l < least and l > 1e-6:
						var fix := d * (1.0 - least / l) * 0.5
						_p[i] += fix
						_p[j] -= fix
	# What it falls on: the ground, things, bodies - it stops and slides.
	var space := get_world_3d().direct_space_state
	for i in range(1, COUNT):
		var step := _p[i] - _q[i]
		if step.length_squared() < 1e-8:
			continue           # lying still where it was: already on something
		var from := _q[i] + Vector3.UP * 0.02
		var q := PhysicsRayQueryParameters3D.create(from, _p[i] + (_p[i] - from).normalized() * _thick[i],
				Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS)
		q.exclude = _exclude
		var hit := space.intersect_ray(q)
		if not hit.is_empty():
			var n: Vector3 = hit.normal
			var p: Vector3 = hit.position + n * _thick[i]
			# Friction: most of the sliding is taken out.
			var slide := (_p[i] - _q[i])
			slide -= n * slide.dot(n)
			_p[i] = p
			_q[i] = p - slide * 0.3
		moved = maxf(moved, _p[i].distance_to(_q[i]))
	_still = _still + delta if moved < 0.001 else 0.0


func _process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["guts._process"] = Game.prof.get("guts._process", 0) + __d
	Game.prof["max guts._process"] = maxi(Game.prof.get("max guts._process", 0), __d)


func _process_real(_delta: float) -> void:
	if _p.is_empty() or not _dirty:
		return
	_dirty = false
	_rebuild()


## The tube: rings round a Catmull-Rom curve through the points, carried
## along it without twisting.
func _rebuild() -> void:
	var curve: Array[Vector3] = []
	var radii: Array[float] = []
	for i in COUNT - 1:
		var p0 := to_local(_p[maxi(i - 1, 0)])
		var p1 := to_local(_p[i])
		var p2 := to_local(_p[i + 1])
		var p3 := to_local(_p[mini(i + 2, COUNT - 1)])
		for s in SUB:
			var t := float(s) / SUB
			curve.append(_catmull(p0, p1, p2, p3, t))
			radii.append(lerpf(_thick[i], _thick[i + 1], t))
	curve.append(to_local(_p[COUNT - 1]))
	radii.append(_thick[COUNT - 1] * 0.6)
	var n := curve.size()
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	verts.resize(n * SIDES + 1)
	norms.resize(n * SIDES + 1)
	var tangent := (curve[1] - curve[0]).normalized()
	var normal := tangent.cross(Vector3.UP)
	normal = normal.normalized() if normal.length() > 0.01 else tangent.cross(Vector3.RIGHT).normalized()
	for i in n:
		var t := (curve[mini(i + 1, n - 1)] - curve[maxi(i - 1, 0)])
		t = t.normalized() if t.length() > 1e-5 else tangent
		normal = (normal - t * normal.dot(t))
		normal = normal.normalized() if normal.length() > 1e-4 else t.cross(Vector3.UP).normalized()
		var binormal := t.cross(normal)
		var r: float = radii[i]
		if i == n - 1:
			r *= 0.5
		for k in SIDES:
			var dir: Vector3 = normal * _cos[k] + binormal * _sin[k]
			verts[i * SIDES + k] = curve[i] + dir * r
			norms[i * SIDES + k] = dir
		tangent = t
	# The end: closed off.
	verts[n * SIDES] = curve[n - 1] + tangent * radii[n - 1] * 0.4
	norms[n * SIDES] = tangent
	if _index.is_empty():
		_build_index(n)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_TEX_UV] = _uv
	arrays[Mesh.ARRAY_INDEX] = _index
	_mesh.clear_surfaces()
	_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	_mesh.surface_set_material(0, _mat)


var _cos := PackedFloat32Array()
var _sin := PackedFloat32Array()


## Triangles and texture coordinates of a tube of n rings (made once).
func _build_index(n: int) -> void:
	_uv.resize(n * SIDES + 1)
	for i in n:
		for k in SIDES:
			_uv[i * SIDES + k] = Vector2(float(k) / SIDES, float(i) / n * 10.0)
	_uv[n * SIDES] = Vector2(0.5, 10.0)
	for i in n - 1:
		for k in SIDES:
			var k2 := (k + 1) % SIDES
			var a := i * SIDES + k
			var b := (i + 1) * SIDES + k
			var c := (i + 1) * SIDES + k2
			var d := i * SIDES + k2
			_index.append_array([a, c, b, a, d, c])
	var tip := n * SIDES
	for k in SIDES:
		_index.append_array([(n - 1) * SIDES + k, tip, (n - 1) * SIDES + (k + 1) % SIDES])


static func _catmull(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: float) -> Vector3:
	var t2 := t * t
	var t3 := t2 * t
	return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)
