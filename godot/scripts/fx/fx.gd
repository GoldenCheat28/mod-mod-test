extends Node3D
## Pooled world effects: muzzle smoke, impact dust/sparks, bullet holes,
## ejected casings and dropped magazines.

const Tex = preload("res://scripts/world/textures.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")

const MAX_DECALS := 96
const MAX_CASINGS := 60
const MAX_DROPPED := 12

var _smoke: Array[GPUParticles3D] = []
var _dust: Array[GPUParticles3D] = []
var _sparks: Array[GPUParticles3D] = []
var _decals: Array[Decal] = []
var _casings: Array[RigidBody3D] = []
var _dropped: Array[RigidBody3D] = []
var _smoke_i := 0
var _dust_i := 0
var _spark_i := 0
var _casing_i := 0

var _casing_meshes := {}
var _clink_cooldown := {}


func _ready() -> void:
	var smoke_pm := _smoke_process()
	var smoke_mesh := _billboard_quad(0.35, Tex.smoke_puff(), Color(0.78, 0.78, 0.78), false)
	for i in 10:
		_smoke.append(_make_emitter(smoke_pm, smoke_mesh, 18, 3.5, 0.92))
	var dust_pm := _dust_process()
	var dust_mesh := _billboard_quad(0.12, Tex.smoke_puff(), Color(0.6, 0.58, 0.55), false)
	for i in 12:
		_dust.append(_make_emitter(dust_pm, dust_mesh, 14, 1.4, 1.0))
	var spark_pm := _spark_process()
	var spark_mesh := _billboard_quad(0.02, null, Color(1.0, 0.7, 0.3), true)
	for i in 6:
		_sparks.append(_make_emitter(spark_pm, spark_mesh, 10, 0.35, 1.0))
	_build_casing_meshes()


# --- Particles ------------------------------------------------------------------

func _make_emitter(pm: ParticleProcessMaterial, mesh: Mesh, amount: int, lifetime: float, explosive: float) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.one_shot = true
	p.emitting = false
	p.amount = amount
	p.lifetime = lifetime
	p.explosiveness = explosive
	p.local_coords = false
	p.process_material = pm
	p.draw_pass_1 = mesh
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-5, -3, -5), Vector3(10, 8, 10))
	add_child(p)
	return p


func _billboard_quad(size: float, tex: Texture2D, color: Color, emissive: bool) -> QuadMesh:
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.vertex_color_use_as_albedo = true
	m.albedo_color = color
	if tex:
		m.albedo_texture = tex
		m.proximity_fade_enabled = true
		m.proximity_fade_distance = 0.25
	if emissive:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	q.material = m
	return q


func _alpha_ramp(points: Array) -> GradientTexture1D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array()
	g.colors = PackedColorArray()
	for p in points:
		g.add_point(p[0], Color(1, 1, 1, p[1]))
	var t := GradientTexture1D.new()
	t.gradient = g
	return t


func _curve(points: Array) -> CurveTexture:
	var c := Curve.new()
	c.max_value = 4.0
	for p in points:
		c.add_point(Vector2(p[0], p[1]))
	var t := CurveTexture.new()
	t.curve = c
	return t


func _smoke_process() -> ParticleProcessMaterial:
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 0, -1)
	pm.spread = 14.0
	pm.initial_velocity_min = 0.6
	pm.initial_velocity_max = 3.2
	pm.damping_min = 2.5
	pm.damping_max = 4.0
	pm.gravity = Vector3(0, 0.22, 0)
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = 0.02
	pm.angle_min = 0.0
	pm.angle_max = 360.0
	pm.angular_velocity_min = -25.0
	pm.angular_velocity_max = 25.0
	pm.scale_min = 0.35
	pm.scale_max = 0.8
	pm.scale_curve = _curve([[0.0, 0.35], [0.25, 1.4], [1.0, 3.2]])
	pm.color_ramp = _alpha_ramp([[0.0, 0.0], [0.04, 0.42], [0.35, 0.2], [1.0, 0.0]])
	pm.turbulence_enabled = true
	pm.turbulence_noise_strength = 1.2
	pm.turbulence_noise_scale = 2.5
	pm.turbulence_noise_speed_random = 0.3
	pm.turbulence_influence_min = 0.04
	pm.turbulence_influence_max = 0.12
	return pm


func _dust_process() -> ParticleProcessMaterial:
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 35.0
	pm.initial_velocity_min = 0.5
	pm.initial_velocity_max = 3.0
	pm.damping_min = 3.0
	pm.damping_max = 5.0
	pm.gravity = Vector3(0, -1.5, 0)
	pm.angle_max = 360.0
	pm.scale_min = 0.6
	pm.scale_max = 1.6
	pm.scale_curve = _curve([[0.0, 0.5], [1.0, 3.0]])
	pm.color_ramp = _alpha_ramp([[0.0, 0.7], [0.3, 0.35], [1.0, 0.0]])
	return pm


func _spark_process() -> ParticleProcessMaterial:
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 60.0
	pm.initial_velocity_min = 2.0
	pm.initial_velocity_max = 7.0
	pm.gravity = Vector3(0, -9.8, 0)
	pm.scale_min = 0.5
	pm.scale_max = 1.2
	pm.color_ramp = _alpha_ramp([[0.0, 1.0], [1.0, 0.0]])
	return pm


## Places an emitter at pos. With forward_axis its local -Z follows `axis`,
## otherwise its local +Y does.
func _place(p: GPUParticles3D, pos: Vector3, axis: Vector3, forward_axis := false) -> void:
	var d := axis.normalized()
	var helper := Vector3.UP if absf(d.dot(Vector3.UP)) < 0.95 else Vector3.RIGHT
	var b: Basis
	if forward_axis:
		b = Basis.looking_at(d, helper)
	else:
		var x := d.cross(helper).normalized()
		b = Basis(x, d, x.cross(d).normalized())
	p.global_transform = Transform3D(b, pos)


func muzzle_smoke(pos: Vector3, forward: Vector3, strength: float) -> void:
	var p := _smoke[_smoke_i]
	_smoke_i = (_smoke_i + 1) % _smoke.size()
	_place(p, pos, forward, true)
	p.amount_ratio = clampf(strength, 0.1, 1.0)
	p.restart()


func impact(pos: Vector3, normal: Vector3, collider: Object, surface: String) -> void:
	if surface == "metal":
		var s := _sparks[_spark_i]
		_spark_i = (_spark_i + 1) % _sparks.size()
		_place(s, pos + normal * 0.01, normal)
		s.restart()
		Game.play_3d(Sfx.get_stream(&"metal_hit"), pos, -6.0, 0.15)
	else:
		var d := _dust[_dust_i]
		_dust_i = (_dust_i + 1) % _dust.size()
		_place(d, pos + normal * 0.02, normal)
		d.restart()
		Game.play_3d(Sfx.get_stream(&"impact"), pos, -8.0, 0.2)
	if surface != "glass":
		bullet_hole(pos, normal, collider)


func bullet_hole(pos: Vector3, normal: Vector3, collider: Object) -> void:
	var dcl: Decal
	if _decals.size() < MAX_DECALS:
		dcl = Decal.new()
		dcl.texture_albedo = Tex.bullet_hole()
		dcl.cull_mask = 1
		dcl.upper_fade = 0.0
		dcl.lower_fade = 0.0
	else:
		dcl = _decals.pop_front()
		if is_instance_valid(dcl) and dcl.get_parent():
			dcl.get_parent().remove_child(dcl)
		if not is_instance_valid(dcl):
			return
	_decals.append(dcl)
	var s := randf_range(0.045, 0.07)
	dcl.size = Vector3(s, 0.08, s)
	var parent: Node = self
	if collider is RigidBody3D:
		parent = collider
	parent.add_child(dcl)
	var n := normal.normalized()
	var helper := Vector3.UP if absf(n.dot(Vector3.UP)) < 0.95 else Vector3.RIGHT
	var x := n.cross(helper).normalized()
	var b := Basis(x, n, x.cross(n)).rotated(n, randf() * TAU)
	dcl.global_transform = Transform3D(b, pos)


# --- Casings and dropped objects ------------------------------------------------------

func _build_casing_meshes() -> void:
	var brass := StandardMaterial3D.new()
	brass.albedo_color = Color(0.78, 0.58, 0.25)
	brass.metallic = 1.0
	brass.roughness = 0.3
	var red := StandardMaterial3D.new()
	red.albedo_color = Color(0.55, 0.06, 0.05)
	red.roughness = 0.5

	var pistol := CylinderMesh.new()
	pistol.top_radius = 0.0048
	pistol.bottom_radius = 0.0048
	pistol.height = 0.019
	pistol.radial_segments = 10
	pistol.material = brass
	_casing_meshes["pistol"] = [pistol, Vector3(0.0096, 0.019, 0.0096)]

	var hull := CylinderMesh.new()
	hull.top_radius = 0.0105
	hull.bottom_radius = 0.0105
	hull.height = 0.05
	hull.radial_segments = 12
	hull.material = red
	var base := CylinderMesh.new()
	base.top_radius = 0.011
	base.bottom_radius = 0.011
	base.height = 0.016
	base.radial_segments = 12
	base.material = brass
	var st := SurfaceTool.new()
	var am := ArrayMesh.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.append_from(hull, 0, Transform3D(Basis.IDENTITY, Vector3(0, 0.008, 0)))
	st.commit(am)
	st = SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.append_from(base, 0, Transform3D(Basis.IDENTITY, Vector3(0, -0.025, 0)))
	st.commit(am)
	am.surface_set_material(0, red)
	am.surface_set_material(1, brass)
	_casing_meshes["shell"] = [am, Vector3(0.021, 0.066, 0.021)]


func eject_casing(kind: String, xf: Transform3D, velocity: Vector3, spin: Vector3) -> void:
	var rb: RigidBody3D
	if _casings.size() < MAX_CASINGS:
		rb = RigidBody3D.new()
		rb.collision_layer = Game.LAYER_DEBRIS
		rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
		rb.continuous_cd = true
		rb.contact_monitor = true
		rb.max_contacts_reported = 1
		var pm := PhysicsMaterial.new()
		pm.bounce = 0.35
		pm.friction = 0.7
		rb.physics_material_override = pm
		rb.angular_damp = 1.5
		var mi := MeshInstance3D.new()
		mi.name = "Mesh"
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		rb.add_child(mi)
		var cs := CollisionShape3D.new()
		cs.name = "Shape"
		cs.shape = CylinderShape3D.new()
		rb.add_child(cs)
		rb.body_entered.connect(_on_casing_hit.bind(rb))
		add_child(rb)
		_casings.append(rb)
	else:
		rb = _casings[_casing_i]
		_casing_i = (_casing_i + 1) % _casings.size()
	var data: Array = _casing_meshes[kind]
	(rb.get_node("Mesh") as MeshInstance3D).mesh = data[0]
	var shape := (rb.get_node("Shape") as CollisionShape3D).shape as CylinderShape3D
	shape.radius = data[1].x * 0.5
	shape.height = data[1].y
	rb.mass = 0.008 if kind == "pistol" else 0.03
	rb.set_meta("kind", kind)
	rb.set_meta("clinks", 0)
	rb.sleeping = false
	rb.global_transform = xf
	rb.reset_physics_interpolation()
	rb.linear_velocity = velocity
	rb.angular_velocity = spin


func _on_casing_hit(_body: Node, rb: RigidBody3D) -> void:
	var clinks: int = rb.get_meta("clinks", 0)
	if clinks > 3 or rb.linear_velocity.length() < 0.4:
		return
	var now := Time.get_ticks_msec()
	if now - int(_clink_cooldown.get(rb.get_instance_id(), 0)) < 90:
		return
	_clink_cooldown[rb.get_instance_id()] = now
	rb.set_meta("clinks", clinks + 1)
	var sound := &"casing" if rb.get_meta("kind") == "pistol" else &"shell_drop"
	Game.play_3d(Sfx.get_stream(sound), rb.global_position, -10.0 - clinks * 4.0, 0.12, 3.0)


## Drops a physical copy of a weapon part (e.g. an empty magazine).
func drop_copy(visual: Node3D, box: Vector3, xf: Transform3D, velocity: Vector3, spin: Vector3, mass: float) -> void:
	var rb := RigidBody3D.new()
	rb.collision_layer = Game.LAYER_DEBRIS
	rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
	rb.mass = mass
	rb.continuous_cd = true
	rb.contact_monitor = true
	rb.max_contacts_reported = 1
	var copy := visual.duplicate() as Node3D
	copy.transform = Transform3D.IDENTITY
	rb.add_child(copy)
	var cs := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = box
	cs.shape = shape
	rb.add_child(cs)
	add_child(rb)
	rb.global_transform = xf
	rb.linear_velocity = velocity
	rb.angular_velocity = spin
	rb.body_entered.connect(func(_b):
		if rb.linear_velocity.length() > 0.8:
			Game.play_3d(Sfx.get_stream(&"mag_drop"), rb.global_position, -8.0, 0.1, 3.0))
	_dropped.append(rb)
	if _dropped.size() > MAX_DROPPED:
		var old: RigidBody3D = _dropped.pop_front()
		if is_instance_valid(old):
			old.queue_free()


func _on_drop_hit(_body: Node, rb: RigidBody3D) -> void:
	if rb.linear_velocity.length() > 0.8:
		Game.play_3d(Sfx.get_stream(&"mag_drop"), rb.global_position, -8.0, 0.1, 3.0)
