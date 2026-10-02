class_name Blood
extends Node3D
# Кровь v2. Дёшево, всё в пулах.
#  - капли-штрихи (вытянуты по скорости, исчезают при ударе о поверхность) + мелкая взвесь
#  - реальные места падения считаются баллистикой (рейкасты по параболе) -> декали ровно там, где капли упали
#  - органичные брызги с сателлитами, блестящий (влажный) материал, лужа растёт под убитым врагом

static var instance: Blood

const POOL := 10
const DECAL_POOL := 80

var _drops: Array[GPUParticles3D] = []
var _mist: Array[GPUParticles3D] = []
var _pi := 0
var _decals: Array[Decal] = []
var _di := 0
var _splats: Array[ImageTexture] = []
var _pool_tex: ImageTexture
var _hole_tex: ImageTexture
var _orm: ImageTexture

func _ready() -> void:
	instance = self
	for i in 4:
		_splats.append(_make_blob(100 + i, 9, 25.0))
	_pool_tex = _make_blob(7, 0, 34.0)
	_hole_tex = _make_blob(3, 0, 6.0)
	var orm := Image.create(4, 4, false, Image.FORMAT_RGB8)
	orm.fill(Color(1.0, 0.1, 0.0))   # AO=1, roughness=0.1 (мокро), metal=0
	_orm = ImageTexture.create_from_image(orm)
	_build_particles()

func _build_particles() -> void:
	var aabb := AABB(Vector3(-8, -8, -8), Vector3(16, 16, 16))
	# крупные капли
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3.UP
	pm.spread = 35.0
	pm.initial_velocity_min = 3.0
	pm.initial_velocity_max = 8.0
	pm.gravity = Vector3(0, -9.8, 0)
	pm.scale_min = 0.5
	pm.scale_max = 1.5
	pm.particle_flag_align_y = true
	pm.collision_mode = ParticleProcessMaterial.COLLISION_HIDE_ON_CONTACT
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.007
	cyl.bottom_radius = 0.007
	cyl.height = 0.07
	cyl.radial_segments = 4
	cyl.rings = 1
	var dmat := StandardMaterial3D.new()
	dmat.albedo_color = Color(0.33, 0.0, 0.015)
	dmat.roughness = 0.1
	cyl.material = dmat
	# мелкая взвесь
	var pm2 := ParticleProcessMaterial.new()
	pm2.direction = Vector3.UP
	pm2.spread = 75.0
	pm2.initial_velocity_min = 1.0
	pm2.initial_velocity_max = 4.0
	pm2.gravity = Vector3(0, -6.0, 0)
	pm2.damping_min = 2.0
	pm2.damping_max = 4.0
	pm2.scale_min = 0.5
	pm2.scale_max = 1.3
	var sph := SphereMesh.new()
	sph.radius = 0.01
	sph.height = 0.02
	sph.radial_segments = 4
	sph.rings = 2
	var mmat := StandardMaterial3D.new()
	mmat.albedo_color = Color(0.5, 0.0, 0.03)
	sph.material = mmat
	for i in POOL:
		_drops.append(_particles(pm, cyl, 18, 1.4, aabb))
		_mist.append(_particles(pm2, sph, 45, 0.5, aabb))

func _particles(pm: ParticleProcessMaterial, mesh: Mesh, amount: int, life: float, aabb: AABB) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.process_material = pm
	p.draw_pass_1 = mesh
	p.amount = amount
	p.lifetime = life
	p.one_shot = true
	p.explosiveness = 0.95
	p.local_coords = false
	p.emitting = false
	p.custom_aabb = aabb
	add_child(p)
	return p

func _make_blob(seed_v: int, satellites: int, base_r: float) -> ImageTexture:
	var n := 128
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_v
	var ph1 := rng.randf() * TAU
	var ph2 := rng.randf() * TAU
	var ph3 := rng.randf() * TAU
	var c := Vector2(n / 2.0, n / 2.0)
	for y in n:
		for x in n:
			var v := Vector2(x, y) - c
			var ang := v.angle()
			var r := base_r * (1.0 + 0.30 * sin(3.0 * ang + ph1) + 0.18 * sin(5.0 * ang + ph2) + 0.12 * sin(9.0 * ang + ph3))
			var d := v.length()
			if d < r:
				var a := clampf((r - d) / (r * 0.2), 0.0, 1.0)
				var shade := 0.6 + 0.4 * clampf(d / r, 0.0, 1.0)
				img.set_pixel(x, y, Color(0.36 * shade, 0.0, 0.015, a))
	for i in satellites:
		var ang2 := rng.randf() * TAU
		var dist := rng.randf_range(base_r * 1.3, 58.0)
		var sc := c + Vector2.from_angle(ang2) * dist
		var sr := rng.randf_range(1.5, 5.0)
		for y in range(maxi(0, int(sc.y - sr - 1)), mini(n, int(sc.y + sr + 2))):
			for x in range(maxi(0, int(sc.x - sr - 1)), mini(n, int(sc.x + sr + 2))):
				var d2 := Vector2(x, y).distance_to(sc)
				if d2 < sr:
					var a2 := clampf((sr - d2) / (sr * 0.4), 0.0, 1.0)
					img.set_pixel(x, y, Color(0.3, 0.0, 0.012, maxf(img.get_pixel(x, y).a, a2)))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

func splash(pos: Vector3, normal: Vector3) -> void:
	var up := normal.normalized()
	var ref := Vector3.RIGHT if absf(up.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD
	var x := up.cross(ref).normalized()
	var xf := Transform3D(Basis(x, up, x.cross(up)), pos)
	_drops[_pi].global_transform = xf
	_drops[_pi].restart()
	_drops[_pi].emitting = true
	_mist[_pi].global_transform = xf
	_mist[_pi].restart()
	_mist[_pi].emitting = true
	_pi = (_pi + 1) % POOL
	# баллистика: где капли реально упадут
	var space := get_world_3d().direct_space_state
	for i in 7:
		var v := up * randf_range(2.0, 6.0) + Vector3(randf_range(-2, 2), randf_range(-1, 2), randf_range(-2, 2))
		var p := pos
		for step in 5:
			var dt := 0.1
			var np := p + v * dt + Vector3(0, -4.9, 0) * dt * dt
			v += Vector3(0, -9.8, 0) * dt
			var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(p, np))
			if hit:
				if hit.collider is StaticBody3D:
					_decal(hit.position, hit.normal, _splats[randi() % _splats.size()], randf_range(0.12, 0.55))
				break
			p = np

func bullet_hole(pos: Vector3, normal: Vector3) -> void:
	_decal(pos, normal, _hole_tex, 0.1)

func pool(pos: Vector3) -> void:
	var space := get_world_3d().direct_space_state
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(pos + Vector3(0, 0.5, 0), pos + Vector3(0, -2.0, 0)))
	if hit and hit.collider is StaticBody3D:
		var d := _decal(hit.position, hit.normal, _pool_tex, 0.3)
		var tw := d.create_tween()
		d.set_meta("tw", tw)
		tw.tween_property(d, "size", Vector3(1.7, 0.4, 1.7), 9.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)

func _decal(pos: Vector3, normal: Vector3, tex: Texture2D, size: float) -> Decal:
	var d: Decal
	if _decals.size() < DECAL_POOL:
		d = Decal.new()
		d.texture_orm = _orm
		d.distance_fade_enabled = true
		d.distance_fade_begin = 25.0
		d.distance_fade_length = 10.0
		add_child(d)
		_decals.append(d)
	else:
		d = _decals[_di]
		_di = (_di + 1) % DECAL_POOL
		if d.has_meta("tw"):
			(d.get_meta("tw") as Tween).kill()
			d.remove_meta("tw")
	d.texture_albedo = tex
	d.size = Vector3(size, 0.4, size)
	var up := normal.normalized()
	var ref := Vector3.RIGHT if absf(up.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD
	var x := up.cross(ref).normalized().rotated(up, randf() * TAU)
	d.global_transform = Transform3D(Basis(x, up, x.cross(up)), pos)
	return d
