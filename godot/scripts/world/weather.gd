extends Node3D
## Dynamic weather. A single "storm" value drifts between clear, overcast,
## rain and thunderstorm over a few minutes. It thickens and darkens the
## clouds, dims the sun and its shadows, thickens the fog, starts the rain
## (particles that stop on roofs, a looping recording that is muffled under
## cover), fills the street puddles, and in a storm brings lightning with
## thunder arriving after the flash (the further the strike, the later and
## quieter it is).

const RAIN_SOUND := "res://assets/sounds/weather/rain_loop.wav"
const THUNDER_SOUND := "res://assets/sounds/weather/thunder.wav"
const Mat = preload("res://scripts/world/materials.gd")

## Levels the weather wanders between: clear, overcast, rain, storm.
const LEVELS := [0.0, 0.35, 0.62, 1.0]
const RAIN_DIR := Vector3(0.36, -1.0, 0.16)
## A rain streak: along its direction of fall, turned about it to face the
## eye; faint, and fainter still right by the camera.
const RAIN_SHADER := """
shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, shadows_disabled, depth_draw_never, skip_vertex_transform;

uniform vec3 fall_dir = vec3(0.36, -1.0, 0.16);

void vertex() {
	vec3 centre = MODEL_MATRIX[3].xyz;
	vec3 axis = normalize(fall_dir);
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	vec3 side = normalize(cross(axis, cam - centre));
	vec3 w = centre + side * VERTEX.x + axis * VERTEX.y;
	VERTEX = (VIEW_MATRIX * vec4(w, 1.0)).xyz;
	COLOR.a *= smoothstep(0.6, 2.5, length(cam - centre));
}

void fragment() {
	float across = 1.0 - abs(UV.x * 2.0 - 1.0);
	float along = sin(UV.y * 3.14159);
	ALBEDO = vec3(0.78, 0.8, 0.86);
	ALPHA = 0.16 * across * along * COLOR.a;
}
"""

var sun: DirectionalLight3D
var env: Environment
var sky_mat: ShaderMaterial

var storm := 0.0
var _target := 0.0
var _next_change := 0.0
var _indoor := 0.6
var wetness := 0.0            # ground water, lags behind the rain
var _covered := 0.0           # 1 = under a roof
var _cover_t := 0.0
var _next_strike := 20.0
var _flash := 0.0
var _flash_seq: Array = []    # pending flicker times

var _rain: GPUParticles3D
var _heights: GPUParticlesCollisionHeightField3D
var _rain_player: AudioStreamPlayer
var _lowpass: AudioEffectLowPassFilter
var _bus := -1
var _bolt: DirectionalLight3D

# Clear-weather values captured at start.
var _sun_energy := 1.3
var _ambient := 0.9
var _fog := 0.006
var _fog_color := Color()
var _top := Color()
var _horizon := Color()
var _coverage := 0.47
var _exposure := 1.0
var _adapt := 1.0             # eye adaptation: >1 opened up for the dark


func setup(sun_light: DirectionalLight3D, environment: Environment, sky_material: ShaderMaterial) -> void:
	sun = sun_light
	env = environment
	sky_mat = sky_material
	_sun_energy = sun.light_energy
	_ambient = env.ambient_light_energy
	_fog = env.fog_density
	_fog_color = env.fog_light_color
	_exposure = env.tonemap_exposure
	# Unset uniforms read back as null: fall back to the shader's defaults.
	var top = sky_mat.get_shader_parameter("top_color")
	var hor = sky_mat.get_shader_parameter("horizon_color")
	var cov = sky_mat.get_shader_parameter("coverage")
	_top = top if top != null else Color(0.36, 0.45, 0.58)
	_horizon = hor if hor != null else Color(0.66, 0.68, 0.7)
	_coverage = cov if cov != null else 0.47
	storm = LEVELS[randi() % 2]
	_target = storm
	_next_change = randf_range(40.0, 90.0)
	_build_rain()
	_build_audio()
	_bolt = DirectionalLight3D.new()
	_bolt.light_color = Color(0.8, 0.85, 1.0)
	_bolt.light_energy = 0.0
	_bolt.shadow_enabled = false
	add_child(_bolt)


func _build_rain() -> void:
	_rain = GPUParticles3D.new()
	_rain.amount = 7000
	_rain.lifetime = 1.6
	_rain.preprocess = 1.6
	_rain.local_coords = false
	_rain.visibility_aabb = AABB(Vector3(-20, -25, -20), Vector3(40, 30, 40))
	_rain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(16, 0.5, 16)
	# Slanting in the wind, all the drops the same way.
	pm.direction = RAIN_DIR
	pm.spread = 1.5
	pm.initial_velocity_min = 10.0
	pm.initial_velocity_max = 12.0
	pm.gravity = RAIN_DIR * 2.0
	pm.collision_mode = ParticleProcessMaterial.COLLISION_HIDE_ON_CONTACT
	pm.collision_use_scale = false
	_rain.collision_base_size = 0.05
	_rain.process_material = pm
	# Streaks lined up with the fall (not stood up straight), thin and faint:
	# the rain is seen as a haze of lines, not as white sticks.
	var q := QuadMesh.new()
	q.size = Vector2(0.006, 0.5)
	var m := ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = RAIN_SHADER
	m.shader = sh
	q.material = m
	_rain.draw_pass_1 = q
	_rain.emitting = false
	_rain.top_level = true
	add_child(_rain)
	# Rain stops on roofs and slabs: a height map of the level around the camera.
	_heights = GPUParticlesCollisionHeightField3D.new()
	_heights.size = Vector3(40, 30, 40)
	_heights.resolution = GPUParticlesCollisionHeightField3D.RESOLUTION_512
	_heights.follow_camera_enabled = true
	_heights.update_mode = GPUParticlesCollisionHeightField3D.UPDATE_MODE_WHEN_MOVED
	add_child(_heights)


func _build_audio() -> void:
	_bus = AudioServer.get_bus_index("Rain")
	if _bus == -1:
		AudioServer.add_bus()
		_bus = AudioServer.bus_count - 1
		AudioServer.set_bus_name(_bus, "Rain")
		AudioServer.set_bus_send(_bus, "Master")
		_lowpass = AudioEffectLowPassFilter.new()
		_lowpass.cutoff_hz = 20000.0
		AudioServer.add_bus_effect(_bus, _lowpass)
	else:
		_lowpass = AudioServer.get_bus_effect(_bus, 0) as AudioEffectLowPassFilter
	_rain_player = AudioStreamPlayer.new()
	var s: AudioStream = load(RAIN_SOUND)
	if s is AudioStreamWAV:
		var w := s as AudioStreamWAV
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD
		w.loop_begin = 0
		w.loop_end = int(w.get_length() * w.mix_rate)
	_rain_player.stream = s
	_rain_player.bus = &"Rain"
	_rain_player.volume_db = -80.0
	add_child(_rain_player)


func rain_amount() -> float:
	return smoothstep(0.45, 0.8, storm)


func _process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["weather._process"] = Game.prof.get("weather._process", 0) + __d
	Game.prof["max weather._process"] = maxi(Game.prof.get("max weather._process", 0), __d)


func _process_real(delta: float) -> void:
	if sun == null:
		return
	# Where the weather is heading next.
	_next_change -= delta
	if _next_change <= 0.0:
		_next_change = randf_range(70.0, 200.0)
		_target = LEVELS[randi() % LEVELS.size()]
	storm = move_toward(storm, _target, delta * 0.008)

	var over := smoothstep(0.08, 0.6, storm)
	var rain := rain_amount()
	# Sky, light and fog.
	sky_mat.set_shader_parameter("coverage", lerpf(_coverage, 0.82, over))
	sky_mat.set_shader_parameter("top_color", _top.lerp(Color(0.3, 0.32, 0.35), over))
	sky_mat.set_shader_parameter("horizon_color", _horizon.lerp(Color(0.42, 0.43, 0.45), over))
	sun.light_energy = lerpf(_sun_energy, 0.3, over)
	sun.shadow_opacity = lerpf(1.0, 0.35, over)
	env.ambient_light_energy = lerpf(_ambient, 0.62, over) + _flash * 1.5
	env.fog_density = lerpf(_fog, 0.02, over * 0.6 + rain * 0.4)
	env.fog_light_color = _fog_color.lerp(Color(0.4, 0.42, 0.45), over)

	# Rain around the camera.
	var cam := get_viewport().get_camera_3d()
	if cam:
		_rain.global_position = cam.global_position + Vector3(0, 12.0, 0) + Vector3(-1.2, 0, -0.5)
	_rain.emitting = rain > 0.01
	_rain.amount_ratio = rain
	# The ground gets wet with the rain and dries slowly afterwards.
	wetness = move_toward(wetness, rain, delta * (0.02 if rain > wetness else 0.004))
	# (dry, the puddles go - down below the deepest dip in the asphalt)
	Mat.asphalt().set_shader_parameter("puddle_level", lerpf(-0.04, 0.006, smoothstep(0.0, 0.7, wetness)))
	# Indoors the water comes in through the holes in the roof and stands
	# longer: it follows the weather slowly.
	_indoor = move_toward(_indoor, wetness, delta * (0.01 if wetness > _indoor else 0.0015))
	var map = Game.main.map if Game.main else null
	if map and "indoor_puddles" in map:
		for pz in map.indoor_puddles:
			(pz[0] as ShaderMaterial).set_shader_parameter("fill", clampf(0.1 + _indoor * 0.9, 0.0, 1.0))
		for ws in Game.water_spots:
			if ws.size() < 3:
				ws.append(ws[1])
			ws[1] = float(ws[2]) * clampf(0.1 + _indoor * 0.9, 0.0, 1.0)

	# Rain sound, muffled indoors.
	_cover_t -= delta
	if _cover_t <= 0.0 and cam:
		_cover_t = 0.25
		var from := cam.global_position
		var q := PhysicsRayQueryParameters3D.create(from, from + Vector3.UP * 30.0, Game.LAYER_WORLD)
		var covered := not get_world_3d().direct_space_state.intersect_ray(q).is_empty()
		_covered = 1.0 if covered else 0.0
	var cov_k := _lowpass.cutoff_hz
	_lowpass.cutoff_hz = lerpf(cov_k, 900.0 if _covered > 0.5 else 18000.0, minf(delta * 3.0, 1.0))
	if rain > 0.01:
		if not _rain_player.playing:
			_rain_player.play()
		_rain_player.volume_db = linear_to_db(rain * (0.45 if _covered > 0.5 else 1.0)) - 4.0
	elif _rain_player.playing:
		_rain_player.stop()

	# Eye adaptation (auto exposure): in the dark the eyes open up a little over
	# a few seconds; stepping out into daylight it is too bright for a moment.
	var want := lerpf(1.28, 1.12, over) if _covered > 0.5 else 1.0
	_adapt = move_toward(_adapt, want, delta * (0.07 if want > _adapt else 0.35))
	env.tonemap_exposure = _exposure * _adapt

	_lightning(delta)


func _lightning(delta: float) -> void:
	_flash = move_toward(_flash, 0.0, delta * 6.0)
	if not _flash_seq.is_empty() and Game.clock >= float(_flash_seq[0]):
		_flash_seq.pop_front()
		_flash = randf_range(0.6, 1.0)
	_bolt.light_energy = _flash * 5.0
	if storm < 0.85:
		return
	_next_strike -= delta
	if _next_strike > 0.0:
		return
	_next_strike = randf_range(10.0, 35.0)
	# A strike somewhere around: flicker of 2-3 flashes, thunder after light.
	_bolt.rotation = Vector3(deg_to_rad(randf_range(-70, -35)), randf() * TAU, 0)
	var t := Game.clock
	for i in randi_range(2, 3):
		_flash_seq.append(t + i * randf_range(0.06, 0.14))
	var dist := randf_range(400.0, 3000.0)
	get_tree().create_timer(dist / 343.0).timeout.connect(_thunder.bind(dist))


func _thunder(dist: float) -> void:
	var p := AudioStreamPlayer.new()
	p.stream = load(THUNDER_SOUND)
	p.volume_db = lerpf(0.0, -14.0, (dist - 400.0) / 2600.0) - 2.0
	p.pitch_scale = randf_range(0.85, 1.05) * lerpf(1.0, 0.9, (dist - 400.0) / 2600.0)
	add_child(p)
	p.finished.connect(p.queue_free)
	p.play()
