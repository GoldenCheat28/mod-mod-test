extends Node
## Все мелкие эффекты: попадания, кровь, гильзы, трассеры, дым.
## Текстуры генерируются в коде, чтобы проект запускался без ассетов.

const WORLD_MASK := 1          # слой физики «world»
const MAX_HOLES := 150
const MAX_SHELLS := 40

const VIS_WORLD := 1           # слой рендера «world» (уровень и предметы)
const VIS_CHARACTERS := 2      # слой рендера «characters» (боты и регдоллы)

var _holes: Array[Decal] = []
var _shells: Array[RigidBody3D] = []

var _hole_tex: Texture2D
var _wound_tex: Texture2D
var _soft_tex: Texture2D

var _pm_cache := {}            # готовые ParticleProcessMaterial
var _spark_mesh: Mesh
var _drop_mesh: Mesh
var _chip_mesh: Mesh
var _splinter_mesh: Mesh
var _shell_mesh: Mesh
var _tracer_mesh: Mesh
var _dust_mesh: Mesh
var _smoke_mesh: Mesh
var _mist_mesh: Mesh


func _ready() -> void:
	_hole_tex = _make_hole_texture()
	_wound_tex = _make_wound_texture()
	_soft_tex = _make_soft_texture()
	_build_meshes()


# ==============================================================================
# Публичное API
# ==============================================================================

## Попадание в твёрдую поверхность. surface: "concrete", "metal", "wood", "rubber".
func impact(pos: Vector3, normal: Vector3, dir: Vector3, collider: Node, surface := "concrete") -> void:
	var b := _basis_from_normal(normal)
	match surface:
		"metal":
			_burst(pos, b, "sparks_metal", _spark_mesh, 16, 0.45)
			_burst(pos, b, "dust_light", _dust_mesh, 3, 0.8)
			Sfx.play_3d("impact_metal", pos, -6.0, 0.15)
		"wood":
			_burst(pos, b, "splinters", _splinter_mesh, 7, 1.2)
			_burst(pos, b, "dust_wood", _dust_mesh, 6, 1.4)
			Sfx.play_3d("impact", pos, -4.0, 0.2)
		"rubber":
			_burst(pos, b, "dust_light", _dust_mesh, 2, 0.6)
			Sfx.play_3d("thud", pos, -6.0, 0.2)
		_:
			_burst(pos, b, "sparks_concrete", _spark_mesh, 3, 0.25)
			_burst(pos, b, "chips", _chip_mesh, 8, 1.0)
			_burst(pos, b, "dust", _dust_mesh, 8, 1.8)
			Sfx.play_3d("impact", pos, -4.0, 0.2)
	_spawn_hole(pos, normal, collider, surface)


## Попадание во плоть. part — кость/часть тела, к которой прилипнет рана.
func blood_hit(pos: Vector3, normal: Vector3, dir: Vector3, part: Node3D) -> void:
	var d := dir.normalized()
	_burst(pos, _basis_from_normal(d), "blood_exit", _drop_mesh, 28, 1.2)       # выходящие брызги
	_burst(pos, _basis_from_normal(normal), "blood_back", _drop_mesh, 10, 0.9)  # обратные брызги
	_burst(pos, _basis_from_normal(d), "blood_mist", _mist_mesh, 6, 0.45)       # кровяная взвесь
	Sfx.play_3d("flesh", pos, -2.0, 0.15)
	if part:
		_spawn_wound(pos, normal, part)
	_blood_on_walls(pos, d)


## Гильза из окна выброса.
func eject_shell(pos: Vector3, basis: Basis, inherit_velocity: Vector3) -> void:
	var body := RigidBody3D.new()
	body.mass = 0.012
	body.collision_layer = 32          # shells
	body.collision_mask = 1 | 8        # world + props
	body.continuous_cd = true
	body.contact_monitor = true
	body.max_contacts_reported = 1
	body.angular_damp = 1.5
	var cs := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = 0.0055
	shape.height = 0.024
	cs.shape = shape
	body.add_child(cs)
	var mi := MeshInstance3D.new()
	mi.mesh = _shell_mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	body.add_child(mi)
	get_tree().current_scene.add_child(body)
	# Ось гильзы вдоль ствола.
	body.global_transform = Transform3D(basis * Basis(Vector3.RIGHT, PI * 0.5), pos)
	body.linear_velocity = inherit_velocity + basis.x * randf_range(1.6, 2.4) \
		+ basis.y * randf_range(1.0, 1.8) + basis.z * randf_range(-0.2, 0.5)
	body.angular_velocity = Vector3(randf_range(-25, 25), randf_range(-25, 25), randf_range(-25, 25))
	var bounces := [0]
	body.body_entered.connect(func(_other: Node) -> void:
		if bounces[0] < 3 and body.linear_velocity.length() > 0.4:
			Sfx.play_3d("shell", body.global_position, -16.0 - bounces[0] * 5.0, 0.12)
		bounces[0] += 1)
	_shells.append(body)
	if _shells.size() > MAX_SHELLS:
		var old: RigidBody3D = _shells.pop_front()
		if is_instance_valid(old):
			old.queue_free()
	get_tree().create_timer(12.0).timeout.connect(func() -> void:
		if is_instance_valid(body):
			_shells.erase(body)
			body.queue_free())


## Трассер: короткая светящаяся черта летит от дула к точке попадания.
func tracer(from: Vector3, to: Vector3) -> void:
	var dist := from.distance_to(to)
	if dist < 3.0:
		return
	var mi := MeshInstance3D.new()
	mi.mesh = _tracer_mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	get_tree().current_scene.add_child(mi)
	var dir := (to - from) / dist
	var up := Vector3.UP if absf(dir.y) < 0.99 else Vector3.RIGHT
	mi.global_transform = Transform3D(Basis.looking_at(dir, up), from + dir * 0.8)
	var tw := mi.create_tween()
	tw.tween_property(mi, "global_position", to - dir * 0.8, dist / 380.0)
	tw.tween_callback(mi.queue_free)


## Лёгкий дымок из ствола после выстрела.
func muzzle_smoke(pos: Vector3, dir: Vector3) -> void:
	_burst(pos, _basis_from_normal(dir), "smoke", _smoke_mesh, 3, 1.8)


# ==============================================================================
# Декали
# ==============================================================================

func _spawn_hole(pos: Vector3, normal: Vector3, collider: Node, surface: String) -> void:
	var d := Decal.new()
	d.texture_albedo = _hole_tex
	var s := randf_range(0.035, 0.05) if surface != "wood" else randf_range(0.03, 0.04)
	d.size = Vector3(s, 0.08, s)
	d.cull_mask = VIS_WORLD
	d.albedo_mix = 1.0
	d.modulate = Color(1, 1, 1) if surface != "wood" else Color(0.85, 0.7, 0.55)
	d.distance_fade_enabled = true
	d.distance_fade_begin = 25.0
	d.distance_fade_length = 10.0
	# На подвижных предметах дырка едет вместе с ними.
	var parent: Node = collider if collider is RigidBody3D else get_tree().current_scene
	parent.add_child(d)
	d.global_transform = Transform3D(_basis_from_normal(normal), pos + normal * 0.02)
	_holes.append(d)
	if _holes.size() > MAX_HOLES:
		var old: Decal = _holes.pop_front()
		if is_instance_valid(old):
			old.queue_free()


func _spawn_wound(pos: Vector3, normal: Vector3, part: Node3D) -> void:
	var d := Decal.new()
	d.texture_albedo = _wound_tex
	var s := randf_range(0.06, 0.09)
	d.size = Vector3(s, 0.1, s)
	d.cull_mask = VIS_CHARACTERS
	d.albedo_mix = 1.0
	part.add_child(d)
	d.global_transform = Transform3D(_basis_from_normal(normal), pos + normal * 0.03)


func _blood_on_walls(pos: Vector3, dir: Vector3) -> void:
	var space := get_viewport().get_world_3d().direct_space_state
	# Брызги по направлению пули (выходное отверстие).
	for i in 5:
		var spread := Vector3(randf_range(-0.35, 0.35), randf_range(-0.5, 0.2), randf_range(-0.35, 0.35))
		var ray_dir := (dir + spread).normalized()
		var q := PhysicsRayQueryParameters3D.create(pos, pos + ray_dir * randf_range(1.0, 3.2), WORLD_MASK)
		var r := space.intersect_ray(q)
		if not r.is_empty():
			BloodWalls.add_splat(r.position, r.normal, randf_range(0.05, 0.16))
	# Капли под раненым.
	var qd := PhysicsRayQueryParameters3D.create(pos, pos + Vector3.DOWN * 3.0, WORLD_MASK)
	var rd := space.intersect_ray(qd)
	if not rd.is_empty():
		var off := Vector3(randf_range(-0.15, 0.15), 0, randf_range(-0.15, 0.15))
		BloodWalls.add_splat(rd.position + off, rd.normal, randf_range(0.03, 0.08))


# ==============================================================================
# Частицы
# ==============================================================================

func _burst(pos: Vector3, basis: Basis, kind: String, mesh: Mesh, amount: int, lifetime: float) -> void:
	var p := GPUParticles3D.new()
	p.one_shot = true
	p.explosiveness = 1.0
	p.amount = amount
	p.lifetime = lifetime
	p.randomness = 0.4
	p.local_coords = false
	p.process_material = _process_material(kind)
	p.draw_pass_1 = mesh
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-5, -5, -5), Vector3(10, 10, 10))
	get_tree().current_scene.add_child(p)
	p.global_transform = Transform3D(basis, pos)
	p.emitting = true
	get_tree().create_timer(lifetime + 0.6).timeout.connect(p.queue_free)


func _process_material(kind: String) -> ParticleProcessMaterial:
	if _pm_cache.has(kind):
		return _pm_cache[kind]
	var m := ParticleProcessMaterial.new()
	m.direction = Vector3(0, 1, 0)       # +Y узла = нормаль / направление
	m.gravity = Vector3(0, -9.8, 0)
	match kind:
		"sparks_metal", "sparks_concrete":
			var metal := kind == "sparks_metal"
			m.spread = 55.0 if metal else 35.0
			m.initial_velocity_min = 3.0 if metal else 2.0
			m.initial_velocity_max = 10.0 if metal else 5.0
			m.damping_min = 1.0
			m.damping_max = 3.0
			m.particle_flag_align_y = true            # искра вытянута по скорости
			m.scale_min = 0.6
			m.scale_max = 1.2
			m.scale_curve = _curve_tex([Vector2(0, 1), Vector2(1, 0)])
			m.collision_mode = ParticleProcessMaterial.COLLISION_RIGID
			m.collision_bounce = 0.35
			m.collision_friction = 0.3
		"chips", "splinters":
			m.spread = 40.0
			m.initial_velocity_min = 1.5
			m.initial_velocity_max = 4.5
			m.angular_velocity_min = -720.0
			m.angular_velocity_max = 720.0
			m.scale_min = 0.5
			m.scale_max = 1.3
			m.collision_mode = ParticleProcessMaterial.COLLISION_RIGID
			m.collision_bounce = 0.2
			m.collision_friction = 0.6
		"dust", "dust_light", "dust_wood":
			m.spread = 25.0
			m.initial_velocity_min = 0.3
			m.initial_velocity_max = 1.6
			m.gravity = Vector3(0, -0.25, 0)
			m.damping_min = 2.5
			m.damping_max = 4.0
			m.angle_min = -180.0
			m.angle_max = 180.0
			m.scale_min = 0.5
			m.scale_max = 1.2
			m.scale_curve = _curve_tex([Vector2(0, 0.25), Vector2(0.3, 0.8), Vector2(1, 1.0)])
			var c := Color(0.55, 0.53, 0.5)
			if kind == "dust_wood":
				c = Color(0.5, 0.4, 0.3)
			elif kind == "dust_light":
				c = Color(0.6, 0.6, 0.6)
			m.color_ramp = _gradient_tex(Color(c, 0.45), Color(c, 0.0))
		"smoke":
			m.spread = 12.0
			m.initial_velocity_min = 0.2
			m.initial_velocity_max = 0.6
			m.gravity = Vector3(0, 0.12, 0)
			m.damping_min = 0.8
			m.damping_max = 1.2
			m.angle_min = -180.0
			m.angle_max = 180.0
			m.angular_velocity_min = -20.0
			m.angular_velocity_max = 20.0
			m.scale_curve = _curve_tex([Vector2(0, 0.2), Vector2(1, 1.0)])
			m.color_ramp = _gradient_tex(Color(0.8, 0.8, 0.8, 0.12), Color(0.8, 0.8, 0.8, 0.0))
		"blood_exit", "blood_back":
			var exit := kind == "blood_exit"
			m.spread = 22.0 if exit else 40.0
			m.initial_velocity_min = 1.5 if exit else 0.5
			m.initial_velocity_max = 5.0 if exit else 2.0
			m.scale_min = 0.5
			m.scale_max = 1.6
			m.particle_flag_align_y = true            # капли вытягиваются в полёте
			m.collision_mode = ParticleProcessMaterial.COLLISION_HIDE_ON_CONTACT
		"blood_mist":
			m.spread = 30.0
			m.initial_velocity_min = 0.3
			m.initial_velocity_max = 1.4
			m.gravity = Vector3(0, -1.0, 0)
			m.damping_min = 3.0
			m.damping_max = 5.0
			m.angle_min = -180.0
			m.angle_max = 180.0
			m.scale_curve = _curve_tex([Vector2(0, 0.3), Vector2(1, 1.0)])
			m.color_ramp = _gradient_tex(Color(0.45, 0.02, 0.02, 0.5), Color(0.3, 0.01, 0.01, 0.0))
	_pm_cache[kind] = m
	return m


func _build_meshes() -> void:
	# Искра: тонкий светящийся цилиндр, вытягивается по скорости.
	var spark := CylinderMesh.new()
	spark.top_radius = 0.0012
	spark.bottom_radius = 0.0012
	spark.height = 0.035
	spark.radial_segments = 4
	spark.rings = 1
	var spark_mat := StandardMaterial3D.new()
	spark_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	spark_mat.albedo_color = Color(5.0, 2.6, 0.8)
	spark.material = spark_mat
	_spark_mesh = spark

	# Капля крови: маленькая вытянутая сфера, блестящая.
	var drop := SphereMesh.new()
	drop.radius = 0.006
	drop.height = 0.02
	drop.radial_segments = 6
	drop.rings = 3
	var drop_mat := StandardMaterial3D.new()
	drop_mat.albedo_color = Color(0.3, 0.01, 0.01)
	drop_mat.roughness = 0.12
	drop_mat.metallic_specular = 0.7
	drop.material = drop_mat
	_drop_mesh = drop

	# Крошка бетона.
	var chip := BoxMesh.new()
	chip.size = Vector3(0.012, 0.008, 0.01)
	var chip_mat := StandardMaterial3D.new()
	chip_mat.albedo_color = Color(0.45, 0.45, 0.44)
	chip_mat.roughness = 0.95
	chip.material = chip_mat
	_chip_mesh = chip

	# Щепка.
	var splinter := BoxMesh.new()
	splinter.size = Vector3(0.006, 0.04, 0.004)
	var splinter_mat := StandardMaterial3D.new()
	splinter_mat.albedo_color = Color(0.62, 0.47, 0.3)
	splinter_mat.roughness = 0.9
	splinter.material = splinter_mat
	_splinter_mesh = splinter

	# Гильза: латунь.
	var shell := CylinderMesh.new()
	shell.top_radius = 0.0055
	shell.bottom_radius = 0.0055
	shell.height = 0.024
	shell.radial_segments = 8
	shell.rings = 1
	var shell_mat := StandardMaterial3D.new()
	shell_mat.albedo_color = Color(0.86, 0.62, 0.28)
	shell_mat.metallic = 1.0
	shell_mat.roughness = 0.28
	shell.material = shell_mat
	_shell_mesh = shell

	# Трассер.
	var tracer_box := BoxMesh.new()
	tracer_box.size = Vector3(0.006, 0.006, 1.4)
	var tracer_mat := StandardMaterial3D.new()
	tracer_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	tracer_mat.albedo_color = Color(4.0, 2.6, 1.0)
	tracer_box.material = tracer_mat
	_tracer_mesh = tracer_box

	_dust_mesh = _soft_quad(0.22, false)
	_smoke_mesh = _soft_quad(0.18, false)
	_mist_mesh = _soft_quad(0.14, true)


## Мягкий billboard-квад. Proximity fade убирает резкую линию на стыке со стеной.
func _soft_quad(size: float, unshaded: bool) -> QuadMesh:
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	var mat := StandardMaterial3D.new()
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.billboard_keep_scale = true
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = _soft_tex
	mat.proximity_fade_enabled = true
	mat.proximity_fade_distance = 0.15
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	if unshaded:
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	q.material = mat
	return q


func _curve_tex(points: Array) -> CurveTexture:
	var c := Curve.new()
	for p: Vector2 in points:
		c.add_point(p)
	var t := CurveTexture.new()
	t.curve = c
	return t


func _gradient_tex(from: Color, to: Color) -> GradientTexture1D:
	var g := Gradient.new()
	g.set_color(0, from)
	g.set_color(1, to)
	var t := GradientTexture1D.new()
	t.gradient = g
	return t


# ==============================================================================
# Процедурные текстуры
# ==============================================================================

func _make_hole_texture() -> Texture2D:
	var n := 96
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var ph := randf() * TAU
	for y in n:
		for x in n:
			var p := Vector2(x + 0.5, y + 0.5) / n * 2.0 - Vector2.ONE
			var d := p.length()
			var a := p.angle()
			var jag := 1.0 + 0.18 * sin(a * 5.0 + ph) + 0.1 * sin(a * 11.0 + ph * 2.0) + randf_range(-0.04, 0.04)
			var col := Color(0, 0, 0, 0)
			if d < 0.2 * jag:
				col = Color(0.02, 0.02, 0.02, 1.0)                        # сама дыра
			elif d < 0.42 * jag:
				var k := (d - 0.2 * jag) / (0.22 * jag)
				col = Color(0.12, 0.115, 0.11, lerpf(1.0, 0.85, k))       # тёмный край
			elif d < 0.95 * jag:
				var k2 := (d - 0.42 * jag) / (0.53 * jag)
				var speck := 1.0 if randf() < 0.25 else 0.6
				col = Color(0.32, 0.31, 0.3, (1.0 - k2) * 0.55 * speck)   # отбитый слой
			img.set_pixel(x, y, col)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func _make_wound_texture() -> Texture2D:
	var n := 64
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			var p := Vector2(x + 0.5, y + 0.5) / n * 2.0 - Vector2.ONE
			var d := p.length()
			var a := p.angle()
			var jag := 1.0 + 0.2 * sin(a * 4.0 + 1.3) + 0.12 * sin(a * 9.0 + 0.4) + randf_range(-0.05, 0.05)
			var col := Color(0, 0, 0, 0)
			if d < 0.18:
				col = Color(0.05, 0.0, 0.0, 1.0)
			elif d < 0.4 * jag:
				col = Color(0.25, 0.01, 0.01, 1.0)
			elif d < 0.95 * jag:
				var k := (d - 0.4 * jag) / (0.55 * jag)
				col = Color(0.32, 0.02, 0.02, (1.0 - k) * 0.85)
			img.set_pixel(x, y, col)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func _make_soft_texture() -> Texture2D:
	var n := 64
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			var p := Vector2(x + 0.5, y + 0.5) / n * 2.0 - Vector2.ONE
			var a := clampf(1.0 - p.length(), 0.0, 1.0)
			a = a * a * (0.85 + randf() * 0.15)
			img.set_pixel(x, y, Color(1, 1, 1, a))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


## Decal и частицы светят вдоль локальной оси Y, поэтому Y направляем по нормали.
func _basis_from_normal(n: Vector3) -> Basis:
	n = n.normalized()
	var ref := Vector3.UP if absf(n.dot(Vector3.UP)) < 0.99 else Vector3.FORWARD
	var x := ref.cross(n).normalized()
	var z := x.cross(n).normalized()
	return Basis(x, n, z).rotated(n, randf() * TAU)
