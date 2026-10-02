class_name Blood
extends Node3D
# Дешёвая физическая кровь: GPU-частицы с коллизией (оседают на полу/стенах)
# + декали-брызги, найденные коротким рейкастом. Всё в пулах — без аллокаций в бою.

static var instance: Blood

const PARTICLE_POOL := 12
const DECAL_POOL := 64

var _parts: Array[GPUParticles3D] = []
var _decals: Array[Decal] = []
var _pi := 0
var _di := 0
var _blood_tex: ImageTexture
var _hole_tex: ImageTexture

func _ready() -> void:
	instance = self
	_blood_tex = _make_splat(true)
	_hole_tex = _make_splat(false)
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3.UP
	pm.spread = 40.0
	pm.initial_velocity_min = 2.0
	pm.initial_velocity_max = 6.0
	pm.gravity = Vector3(0, -9.8, 0)
	pm.scale_min = 0.6
	pm.scale_max = 1.4
	pm.collision_mode = ParticleProcessMaterial.COLLISION_RIGID
	pm.collision_friction = 0.9
	pm.collision_bounce = 0.05
	var mesh := SphereMesh.new()
	mesh.radius = 0.02
	mesh.height = 0.04
	mesh.radial_segments = 4
	mesh.rings = 2
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.45, 0.0, 0.02)
	mat.roughness = 0.2
	mesh.material = mat
	for i in PARTICLE_POOL:
		var p := GPUParticles3D.new()
		p.process_material = pm
		p.draw_pass_1 = mesh
		p.amount = 40
		p.lifetime = 2.0
		p.one_shot = true
		p.explosiveness = 0.95
		p.local_coords = false
		p.emitting = false
		p.custom_aabb = AABB(Vector3(-8, -8, -8), Vector3(16, 16, 16))
		add_child(p)
		_parts.append(p)

func _make_splat(blood: bool) -> ImageTexture:
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 11 if blood else 5
	var blobs := 7 if blood else 1
	for b in blobs:
		var c := Vector2(32, 32)
		var r := 14.0
		if blood:
			c = Vector2(rng.randf_range(16, 48), rng.randf_range(16, 48))
			r = rng.randf_range(3.0, 11.0)
		else:
			r = 5.0
		for y in 64:
			for x in 64:
				var d := Vector2(x, y).distance_to(c)
				if d < r:
					var a := clampf(1.0 - d / r, 0.0, 1.0) * 3.0
					var old := img.get_pixel(x, y).a
					var col := Color(0.4, 0.0, 0.02, minf(1.0, maxf(old, a))) if blood else Color(0.05, 0.05, 0.05, minf(1.0, maxf(old, a)))
					img.set_pixel(x, y, col)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

func splash(pos: Vector3, normal: Vector3) -> void:
	var p := _parts[_pi]
	_pi = (_pi + 1) % PARTICLE_POOL
	var up := normal.normalized()
	var ref := Vector3.RIGHT if absf(up.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD
	var x := up.cross(ref).normalized()
	p.global_transform = Transform3D(Basis(x, up, x.cross(up)), pos)
	p.restart()
	p.emitting = true
	# Брызги на ближайших поверхностях
	var space := get_world_3d().direct_space_state
	for i in 4:
		var dir := (up * 1.5 + Vector3(randf_range(-1, 1), randf_range(-1.2, 0.2), randf_range(-1, 1))).normalized()
		var q := PhysicsRayQueryParameters3D.create(pos, pos + dir * 3.0)
		var hit := space.intersect_ray(q)
		if hit and hit.collider is StaticBody3D:
			_decal(hit.position, hit.normal, _blood_tex, randf_range(0.35, 0.8))

func bullet_hole(pos: Vector3, normal: Vector3) -> void:
	_decal(pos, normal, _hole_tex, 0.12)

func _decal(pos: Vector3, normal: Vector3, tex: Texture2D, size: float) -> void:
	var d: Decal
	if _decals.size() < DECAL_POOL:
		d = Decal.new()
		d.texture_albedo = tex
		d.distance_fade_enabled = true
		d.distance_fade_begin = 25.0
		d.distance_fade_length = 10.0
		add_child(d)
		_decals.append(d)
	else:
		d = _decals[_di]
		_di = (_di + 1) % DECAL_POOL
		d.texture_albedo = tex
	d.size = Vector3(size, 0.4, size)
	var up := normal.normalized()
	var ref := Vector3.RIGHT if absf(up.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD
	var x := up.cross(ref).normalized().rotated(up, randf() * TAU)
	d.global_transform = Transform3D(Basis(x, up, x.cross(up)), pos)
