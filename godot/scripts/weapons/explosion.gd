extends RefCounted
## One explosion: fragments flying out in every direction (real rays that hit
## people, doors and walls), a pressure wave that throws bodies and loose
## objects and knocks people down or kills them up close, a flash, the boom
## (it reaches everyone: the bots panic), a shake of the view, a scorch mark
## and a thick cloud of smoke that rises and hangs for a long time.
##
## power: 1 = hand grenade, ~2.5 = the demolition charge.

const Sfx = preload("res://scripts/audio/sfx.gd")
const Smoke = preload("res://scripts/fx/smoke.gd")


static func explode(tree: SceneTree, pos: Vector3, power: float, smoke := 1.0, ignore: Array[RID] = [], sound := &"grenade_blast") -> void:
	var net = tree.root.get_node_or_null("Net")
	if net:
		net.local_boom(pos, power, smoke, sound)
	var root := tree.current_scene
	var space := root.get_viewport().world_3d.direct_space_state
	var radius := 6.0 * power          # lethal-ish pressure radius
	# --- Fragments --------------------------------------------------------------
	# (a real one throws hundreds: enough that anyone standing near is hit)
	var frags := int(260 * power)
	var per_body := {}
	for i in frags:
		var dir := Vector3(randf_range(-1, 1), randf_range(-0.35, 1), randf_range(-1, 1)).normalized()
		var q := PhysicsRayQueryParameters3D.create(pos, pos + dir * 30.0,
				Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_PLAYER)
		q.exclude = ignore
		var hit := space.intersect_ray(q)
		if hit.is_empty():
			continue
		var col: Object = hit.collider
		var d := pos.distance_to(hit.position)
		var energy := clampf(1.0 - d / 30.0, 0.1, 1.0)
		if col == Game.player:
			var bh: Dictionary = Game.player.hitbox_test(pos, dir)
			if not bh.is_empty():
				Game.player.hurt(bh["point"], dir, "frag", bh["region"])
		elif col.has_meta("humanoid"):
			# (every one hurts; the wounds drawn are capped per body - blood and
			# bits for thirty holes at once would cost more than they show)
			var h = col.get_meta("humanoid")
			var nh: int = per_body.get(h, 0)
			per_body[h] = nh + 1
			if nh < 9 and (d < 12.0 or randf() < energy):
				h.receive_hit(col, hit.position, dir, 3.0 * energy, "frag")
			elif nh >= 9 and h.alive:
				h.bleed_rate += 4.0 * energy
				col.apply_impulse(dir * 3.0 * energy, hit.position - col.global_position)
		else:
			if col.has_method("damage"):
				col.damage(0.6 * energy, hit.position, dir)
			elif col is RigidBody3D:
				(col as RigidBody3D).apply_impulse(dir * 2.0 * energy, hit.position - (col as RigidBody3D).global_position)
			if i % 6 == 0 and Game.fx:
				Game.fx.impact(hit.position, hit.normal, col, col.get_meta("surface", "concrete") if col is Node else "concrete")
	# --- Pressure wave -------------------------------------------------------------
	for b in Game.bots:
		if not is_instance_valid(b):
			continue
		var c: Vector3 = b.chest.global_position
		var d := pos.distance_to(c)
		# (the wave goes round a kerb or a step: any clear line to the body will do)
		if d < radius * 1.6 and (_clear(space, pos, c, ignore) or _clear(space, pos, b.pelvis.global_position, ignore)
				or _clear(space, pos, b.head.global_position, ignore)):
			b.blast(pos, power, d)
	if Game.player and not Game.player._dead:
		var pc: Vector3 = Game.player.global_position + Vector3.UP * 1.0
		var d := pos.distance_to(pc)
		if d < radius * 1.6 and _clear(space, pos, pc, ignore):
			Game.player.blast(pos, power, d)
	for n in root.get_tree().get_nodes_in_group(&"blastable"):
		if n.has_method("blast") and _clear(space, pos, n.global_transform * n.center_local(), ignore):
			n.blast(pos, 900.0 * power)
	# Loose physics objects nearby get thrown.
	var sq := PhysicsShapeQueryParameters3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = radius
	sq.shape = sphere
	sq.transform = Transform3D(Basis(), pos)
	sq.collision_mask = Game.LAYER_PROPS | Game.LAYER_DEBRIS
	for r in space.intersect_shape(sq, 64):
		var rb := r.collider as RigidBody3D
		if rb and not rb.freeze and not rb.has_method("blast"):
			var off := rb.global_position - pos
			var k := 60.0 * power / maxf(off.length_squared(), 0.3)
			rb.apply_central_impulse(off.normalized() * minf(k, 40.0) * minf(rb.mass, 10.0) * 0.3 + Vector3.UP * minf(k, 20.0) * 0.1)
	# Shake for anyone watching.
	if Game.player:
		var pd: float = pos.distance_to(Game.player.global_position)
		Game.player.shake(clampf(power * 6.0 / maxf(pd, 1.0), 0.0, 3.0))
	# --- Sound, light, smoke, scorch ---------------------------------------------------
	# A grenade's bang; a bomb's is the same, deeper, echoing and louder (+50%).
	Game.play_3d(Sfx.get_stream(sound), pos, 11.0 + (3.5 if sound == &"bomb_blast" else 0.0), 0.05, 30.0)
	Game.gunshot.emit(pos, 3.0 * power)
	_flash(root, pos, power)
	_sparks(root, pos, power)
	_smoke(root, pos, power, smoke)
	_scorch(root, space, pos, power)


static func _clear(space: PhysicsDirectSpaceState3D, a: Vector3, b: Vector3, ignore: Array[RID]) -> bool:
	# From a little above where it went off: lying on the ground, the blast is
	# not stopped by the ground itself.
	var q := PhysicsRayQueryParameters3D.create(a + Vector3.UP * 0.25, b, Game.LAYER_WORLD)
	q.exclude = ignore
	return space.intersect_ray(q).is_empty()


static func _flash(root: Node, pos: Vector3, power: float) -> void:
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.72, 0.4)
	l.omni_range = 14.0 * power
	l.light_energy = 14.0
	l.shadow_enabled = true
	root.add_child(l)
	l.global_position = pos + Vector3.UP * 0.4
	var tw := l.create_tween()
	tw.tween_property(l, "light_energy", 0.0, 0.22).set_ease(Tween.EASE_OUT)
	tw.tween_callback(l.queue_free)
	# The fireball: a short-lived bright puff.
	var fire := GPUParticles3D.new()
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3.UP
	pm.spread = 180.0
	pm.initial_velocity_min = 3.0 * power
	pm.initial_velocity_max = 7.0 * power
	pm.damping_min = 12.0
	pm.damping_max = 18.0
	pm.scale_min = 0.8
	pm.scale_max = 1.5
	var g := Gradient.new()
	g.set_color(0, Color(1.0, 0.85, 0.5, 1.0))
	g.add_point(0.3, Color(1.0, 0.45, 0.1, 0.8))
	g.set_color(1, Color(0.2, 0.1, 0.05, 0.0))
	var gt := GradientTexture1D.new()
	gt.gradient = g
	pm.color_ramp = gt
	fire.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(1.2, 1.2) * power
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = preload("res://scripts/world/textures.gd").smoke_puff()
	q.material = m
	fire.draw_pass_1 = q
	fire.amount = 24
	fire.lifetime = 0.35
	fire.one_shot = true
	fire.explosiveness = 1.0
	fire.local_coords = false
	root.add_child(fire)
	fire.global_position = pos
	fire.emitting = true
	root.get_tree().create_timer(1.0).timeout.connect(fire.queue_free)


## Thick grey-brown smoke: rolls out along the ground, then rises and hangs.
static func _smoke(root: Node, pos: Vector3, power: float, amount: float) -> void:
	var p := GPUParticles3D.new()
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3.UP
	pm.spread = 80.0
	pm.initial_velocity_min = 1.5 * power
	pm.initial_velocity_max = 5.0 * power
	pm.damping_min = 2.5
	pm.damping_max = 4.0
	pm.gravity = Vector3(0.25, 0.28, 0.1)
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = 0.4 * power
	pm.angle_max = 360.0
	pm.angular_velocity_min = -8.0
	pm.angular_velocity_max = 8.0
	pm.scale_min = 0.8
	pm.scale_max = 1.4
	var c := Curve.new()
	c.max_value = 6.0
	c.add_point(Vector2(0.0, 0.6))
	c.add_point(Vector2(0.25, 2.2))
	c.add_point(Vector2(1.0, 5.0))
	var ct := CurveTexture.new()
	ct.curve = c
	pm.scale_curve = ct
	var g := Gradient.new()
	g.offsets = PackedFloat32Array()
	g.colors = PackedColorArray()
	for pt in [[0.0, 0.0], [0.02, 0.85], [0.35, 0.6], [0.8, 0.25], [1.0, 0.0]]:
		g.add_point(pt[0], Color(1, 1, 1, pt[1]))
	var gt := GradientTexture1D.new()
	gt.gradient = g
	pm.color_ramp = gt
	pm.turbulence_enabled = true
	pm.turbulence_noise_strength = 1.2
	pm.turbulence_noise_scale = 3.0
	pm.turbulence_influence_min = 0.03
	pm.turbulence_influence_max = 0.08
	p.process_material = pm
	p.draw_pass_1 = Smoke.quad("blast", 1.3, Color(0.52, 0.5, 0.47), 0.9)
	p.amount = int(30 * power * amount)
	p.lifetime = 9.0 + 9.0 * amount * power * 0.5
	p.explosiveness = 0.85
	p.one_shot = true
	p.local_coords = false
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-25, -5, -25), Vector3(50, 40, 50))
	root.add_child(p)
	p.global_position = pos + Vector3.UP * 0.3
	p.emitting = true
	root.get_tree().create_timer(p.lifetime + 1.0).timeout.connect(p.queue_free)


static func _scorch(root: Node, space: PhysicsDirectSpaceState3D, pos: Vector3, power: float) -> void:
	var q := PhysicsRayQueryParameters3D.create(pos + Vector3.UP * 0.3, pos + Vector3.DOWN * 1.5, Game.LAYER_WORLD)
	var hit := space.intersect_ray(q)
	if hit.is_empty():
		return
	var d := Decal.new()
	d.texture_albedo = _scorch_tex()
	d.normal_fade = 0.5
	d.upper_fade = 0.2
	d.lower_fade = 0.2
	var s := 2.2 * power
	d.size = Vector3(s, 0.6, s)
	d.cull_mask = 1
	root.add_child(d)
	d.global_transform = Transform3D(Basis(Vector3.UP, randf() * TAU), hit.position)


static var _scorch_cache: ImageTexture


## Soot blown out from the centre: dark, broken up at the edge, radial streaks.
static func _scorch_tex() -> ImageTexture:
	if _scorch_cache:
		return _scorch_cache
	var size := 192
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var n := FastNoiseLite.new()
	n.frequency = 0.04
	n.fractal_octaves = 4
	for y in size:
		for x in size:
			var p := Vector2(x, y) / (size - 1) * 2.0 - Vector2.ONE
			var r := p.length()
			var a := atan2(p.y, p.x)
			var rays := n.get_noise_2d(cos(a) * 60.0, sin(a) * 60.0) * 0.5 + 0.5
			var blot := n.get_noise_2d(x * 1.5, y * 1.5) * 0.5 + 0.5
			var reach := 0.55 + 0.4 * rays
			var alpha := (1.0 - smoothstep(reach * 0.5, reach, r)) * (0.55 + 0.45 * blot)
			alpha = clampf(alpha, 0.0, 0.92)
			var c := Color(0.03, 0.028, 0.025).lerp(Color(0.12, 0.1, 0.08), smoothstep(0.2, 0.9, r))
			img.set_pixel(x, y, Color(c.r, c.g, c.b, alpha))
	img.generate_mipmaps()
	_scorch_cache = ImageTexture.create_from_image(img)
	return _scorch_cache


## The pop and the sparks: a white-hot instant at the centre (a camera
## would blow out), and burning bits of the casing and filler streaking out
## in every direction, bouncing off the ground and dying out.
static func _sparks(root: Node, pos: Vector3, power: float) -> void:
	var pop := OmniLight3D.new()
	pop.light_color = Color(1.0, 0.95, 0.85)
	pop.omni_range = 22.0 * power
	pop.light_energy = 40.0
	pop.shadow_enabled = false
	root.add_child(pop)
	pop.global_position = pos + Vector3.UP * 0.3
	var tw := pop.create_tween()
	tw.tween_property(pop, "light_energy", 0.0, 0.06)
	tw.tween_callback(pop.queue_free)
	var core := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.6 * power
	sm.height = 1.2 * power
	core.mesh = sm
	var cm := StandardMaterial3D.new()
	cm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	cm.albedo_color = Color(1.0, 0.95, 0.8)
	cm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	core.material_override = cm
	core.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(core)
	core.global_position = pos + Vector3.UP * 0.3
	var ct := core.create_tween()
	ct.set_parallel(true)
	ct.tween_property(core, "scale", Vector3.ONE * 2.2, 0.07)
	ct.tween_property(cm, "albedo_color:a", 0.0, 0.07)
	ct.chain().tween_callback(core.queue_free)
	# The sparks: real little bodies, bouncing off what they hit (sparks.gd).
	load("res://scripts/fx/sparks.gd").burst(root, pos + Vector3.UP * 0.25, power)
