extends Node3D
## Life in the air round the player:
##  - dust motes hanging and drifting, caught in the light (by day in the
##    sun, at night only by the lamps);
##  - by day, fluff and seeds on the wind, and now and then scraps of litter
##    tumbling along the ground;
##  - at night, moths round every lit lamp and bulb.
## All of it GPU particles that follow the camera (the moths stay at their
## lamps); fewer on low graphics.

var _dust: GPUParticles3D
var _fluff: GPUParticles3D
var _litter: GPUParticles3D
var _moths := {}                 # OmniLight3D -> GPUParticles3D


func _ready() -> void:
	var q: int = Game.quality
	_dust = _cloud(int([90, 180, 320][q]), 7.0, Vector2(0.018, 0.018), Color(1, 1, 0.95, 0.55), 0.12, 10.0, false)
	_fluff = _cloud(int([12, 26, 40][q]), 14.0, Vector2(0.04, 0.04), Color(1, 1, 1, 0.8), 0.45, 12.0, false)
	_litter = _cloud(int([4, 8, 12][q]), 9.0, Vector2(0.09, 0.06), Color(0.55, 0.47, 0.35, 1.0), 2.2, 6.0, true)


## One cloud of flecks round the camera: `n` of them in a box `r` across,
## drifting at about `drift` m/s with the wind, each living `life` s.
func _cloud(n: int, r: float, size: Vector2, col: Color, drift: float, life: float, ground: bool) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(r, 0.05 if ground else r * 0.35, r)
	pm.direction = Vector3(1, 0.1, 0.4)
	pm.spread = 60.0
	pm.initial_velocity_min = drift * 0.3
	pm.initial_velocity_max = drift
	pm.gravity = Vector3(0, -0.4, 0) if ground else Vector3(0, 0.005, 0)
	pm.turbulence_enabled = true
	pm.turbulence_noise_strength = 0.6 if not ground else 1.4
	pm.turbulence_noise_scale = 3.0
	pm.turbulence_influence_min = 0.05
	pm.turbulence_influence_max = 0.2
	pm.angular_velocity_min = -90.0 if ground else 0.0
	pm.angular_velocity_max = 90.0 if ground else 0.0
	pm.scale_min = 0.6
	pm.scale_max = 1.4
	if ground:
		pm.collision_mode = ParticleProcessMaterial.COLLISION_RIGID
		pm.collision_bounce = 0.3
		pm.collision_friction = 0.6
	var fade := Gradient.new()
	fade.offsets = PackedFloat32Array([0.0, 0.15, 0.85, 1.0])
	fade.colors = PackedColorArray([Color(1, 1, 1, 0), Color(1, 1, 1, 1), Color(1, 1, 1, 1), Color(1, 1, 1, 0)])
	var gt := GradientTexture1D.new()
	gt.gradient = fade
	pm.color_ramp = gt
	p.process_material = pm
	var quad := QuadMesh.new()
	quad.size = size
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES if not ground else BaseMaterial3D.BILLBOARD_DISABLED
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.roughness = 1.0
	# (lit, so they show only where the light falls: a sunbeam, a lamp)
	m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_VERTEX
	quad.material = m
	p.draw_pass_1 = quad
	p.amount = maxi(n, 1)
	p.lifetime = life
	p.preprocess = life
	p.visibility_aabb = AABB(Vector3(-r * 1.5, -r, -r * 1.5), Vector3(r * 3.0, r * 2.0, r * 3.0))
	p.local_coords = false
	add_child(p)
	return p


func _process(delta: float) -> void:
	if OS.get_environment("NO_AMB") != "":
		return
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var at := cam.global_position
	var night: float = Game.main.day_night.night if Game.main and Game.main.day_night else 0.0
	var rain: float = Game.main.weather.rain_amount() if Game.main and Game.main.weather else 0.0
	_dust.global_position = at
	_fluff.global_position = at + Vector3(0, 1.0, 0)
	_litter.global_position = Vector3(at.x, at.y - 1.5, at.z)
	# Dust all day and night (the light decides what shows); no fluff or
	# litter blowing about at night or in the rain.
	_dust.amount_ratio = lerpf(1.0, 0.5, night) * (1.0 - rain * 0.7)
	_fluff.amount_ratio = (1.0 - night) * (1.0 - rain)
	_litter.amount_ratio = (1.0 - night * 0.7) * (1.0 - rain * 0.8)
	_fluff.emitting = _fluff.amount_ratio > 0.02
	_litter.emitting = _litter.amount_ratio > 0.02
	_moths_tick(night, rain)


## Moths round the lights that are on (street lamps, bulbs).
func _moths_tick(night: float, rain: float) -> void:
	for l in get_tree().get_nodes_in_group(&"lamp_light"):
		var light := l as OmniLight3D
		if not _moths.has(light):
			_moths[light] = _moth_swarm(light)
		var m: GPUParticles3D = _moths[light]
		m.global_position = light.global_position
		m.emitting = light.visible and light.light_energy > 0.3 and rain < 0.4 and night > 0.3
	for l in _moths.keys():
		if not is_instance_valid(l):
			if is_instance_valid(_moths[l]):
				_moths[l].queue_free()
			_moths.erase(l)


func _moth_swarm(light: OmniLight3D) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = 0.35
	pm.gravity = Vector3.ZERO
	pm.orbit_velocity_min = 0.6
	pm.orbit_velocity_max = 1.4
	pm.radial_accel_min = -1.5
	pm.radial_accel_max = 0.5
	pm.turbulence_enabled = true
	pm.turbulence_noise_strength = 3.0
	pm.turbulence_noise_scale = 1.5
	pm.turbulence_influence_min = 0.3
	pm.turbulence_influence_max = 0.6
	pm.initial_velocity_min = 0.3
	pm.initial_velocity_max = 0.8
	pm.direction = Vector3.UP
	pm.spread = 180.0
	p.process_material = pm
	var quad := QuadMesh.new()
	quad.size = Vector2(0.03, 0.022)
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.75, 0.68, 0.55)
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.roughness = 1.0
	quad.material = m
	p.draw_pass_1 = quad
	p.amount = 10 if Game.quality > 0 else 5
	p.lifetime = 6.0
	p.preprocess = 6.0
	p.local_coords = true
	p.visibility_aabb = AABB(Vector3(-2, -2, -2), Vector3(4, 4, 4))
	add_child(p)
	return p
