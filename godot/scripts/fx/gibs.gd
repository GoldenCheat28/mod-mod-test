extends Node3D
## Bits of flesh knocked out of a body by a bullet: small ragged lumps that
## fly out of the wound, tumble, hit the ground (or a wall) and lie there,
## leaving a smear of blood where they land. All of them are drawn in one
## MultiMesh and moved by hand (a ray per moving bit), so a firefight's worth
## of them costs next to nothing; once one has come to rest it costs nothing.

const MAX := 150

class Bit:
	var pos: Vector3
	var vel: Vector3
	var rot: Basis
	var spin: Vector3
	var size: float
	var resting := false
	var age := 0.0

var _bits: Array[Bit] = []
var _next := 0
var _mm: MultiMesh
var _q := PhysicsRayQueryParameters3D.new()


func _ready() -> void:
	_mm = MultiMesh.new()
	_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mm.mesh = _lump_mesh()
	_mm.instance_count = MAX
	_mm.visible_instance_count = 0
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = _mm
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.36, 0.05, 0.05)
	mat.roughness = 0.3
	mat.metallic_specular = 0.7
	mat.vertex_color_use_as_albedo = true
	mmi.material_override = mat
	mmi.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
	_q.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS


## Knocks `count` bits out at `at`, flying mostly along `dir`.
func burst(at: Vector3, dir: Vector3, count: int, speed := 5.0, spread := 0.5) -> void:
	var d := dir.normalized()
	for i in count:
		var b: Bit
		if _bits.size() < MAX:
			b = Bit.new()
			_bits.append(b)
		else:
			b = _bits[_next]
			_next = (_next + 1) % MAX
		var v := (d + Vector3(randf_range(-1, 1), randf_range(-0.6, 1.0), randf_range(-1, 1)) * spread).normalized()
		b.pos = at + d * 0.02
		b.vel = v * speed * randf_range(0.5, 1.2)
		b.rot = Basis.from_euler(Vector3(randf() * TAU, randf() * TAU, randf() * TAU))
		b.spin = Vector3(randf_range(-20, 20), randf_range(-20, 20), randf_range(-20, 20))
		b.size = randf_range(0.012, 0.03)
		b.resting = false
		b.age = 0.0


func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["gibs._physics_process"] = Game.prof.get("gibs._physics_process", 0) + __d
	Game.prof["max gibs._physics_process"] = maxi(Game.prof.get("max gibs._physics_process", 0), __d)


func _physics_process_real(delta: float) -> void:
	var space := get_world_3d().direct_space_state
	for b in _bits:
		if b.resting:
			continue
		b.age += delta
		b.vel += Vector3.DOWN * 9.8 * delta
		b.vel *= 1.0 - minf(delta * 0.4, 0.2)
		var to := b.pos + b.vel * delta
		_q.from = b.pos
		_q.to = to + b.vel.normalized() * b.size * 0.5
		var hit := space.intersect_ray(_q)
		if hit.is_empty():
			b.pos = to
			b.rot = b.rot.rotated(b.spin.normalized(), b.spin.length() * delta) if b.spin.length() > 0.01 else b.rot
			continue
		var n: Vector3 = hit.normal
		b.pos = (hit.position as Vector3) + n * b.size * 0.4
		var speed := b.vel.length()
		# A wet thud: it hardly bounces, slides a little, stops.
		b.vel = (b.vel - n * b.vel.dot(n) * 1.15) * 0.35
		b.spin *= 0.4
		if Game.blood and speed > 1.5:
			Game.blood.spawn_drop(b.pos + n * 0.01, n * 0.3, b.size * 60.0)
		if n.y > 0.6 and b.vel.length() < 0.4:
			b.resting = true
			# Lying flat on its side.
			b.rot = Basis(Vector3.UP, randf() * TAU) * Basis.from_scale(Vector3(1.0, 0.55, 1.0))
	var n := _bits.size()
	for i in n:
		var b := _bits[i]
		_mm.set_instance_transform(i, Transform3D(b.rot.scaled(Vector3.ONE * b.size), b.pos))
	_mm.visible_instance_count = n


## A small ragged lump (unit size): a squashed ball pushed in and out, dark
## red with paler fat and darker clotted bits.
static func _lump_mesh() -> ArrayMesh:
	var sm := SphereMesh.new()
	sm.radius = 0.5
	sm.height = 1.0
	sm.radial_segments = 8
	sm.rings = 5
	var arr := sm.get_mesh_arrays()
	var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var cols := PackedColorArray()
	var rng := RandomNumberGenerator.new()
	rng.seed = 42
	for i in verts.size():
		var v := verts[i]
		var k := 0.75 + 0.5 * (sin(v.x * 9.0 + v.y * 5.0) * 0.5 + 0.5) * rng.randf_range(0.8, 1.2)
		verts[i] = v * Vector3(k, k * 0.8, k * 1.1)
		var r := rng.randf()
		cols.append(Color(0.9, 0.75, 0.6) if r < 0.12 else (Color(0.35, 0.02, 0.02) if r < 0.4 else Color(0.65, 0.08, 0.08)))
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_COLOR] = cols
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m
