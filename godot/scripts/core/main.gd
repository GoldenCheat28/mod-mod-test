extends Node3D
## Entry point: builds lighting, the level, navigation, player and bots.

const MapBuilder = preload("res://scripts/world/map_builder.gd")
const Player = preload("res://scripts/player/player.gd")
const Humanoid = preload("res://scripts/bots/humanoid.gd")
const Fx = preload("res://scripts/fx/fx.gd")
const Blood = preload("res://scripts/fx/blood.gd")

const BOT_COUNT := 8

var map: Node3D
var day_night: Node
var _env: Environment
var _sun: DirectionalLight3D
var _sky: Sky
var weather: Node3D
var activities: Node3D           # things for people to do (activities.gd)


var loading: CanvasLayer


func _ready() -> void:
	Game.reset()
	Net.new_level()
	Game.main = self
	# The loading screen first, and a frame for it to show, before the heavy
	# work (the level is built over several frames, see MapBuilder.steps).
	loading = preload("res://scripts/ui/loading_screen.gd").new()
	add_child(loading)
	# Nothing of the half-built world is drawn behind it (every frame that
	# did would compile the new materials of whatever went in last).
	get_viewport().disable_3d = true
	loading.step("Загружаем звуки", 0.02)
	await get_tree().process_frame
	await get_tree().process_frame
	preload("res://scripts/audio/sfx.gd").prewarm()
	loading.step("Свет и небо", 0.06)
	await get_tree().process_frame
	_environment()

	var fx := Fx.new()
	fx.name = "Fx"
	add_child(fx)
	Game.fx = fx

	var blood := Blood.new()
	blood.name = "Blood"
	add_child(blood)
	Game.blood = blood

	var gibs := preload("res://scripts/fx/gibs.gd").new()
	gibs.name = "Gibs"
	add_child(gibs)
	Game.gibs = gibs

	var smoke := preload("res://scripts/fx/smoke_air.gd").new()
	smoke.name = "Smoke"
	add_child(smoke)
	Game.smoke = smoke
	activities = preload("res://scripts/bots/activities.gd").new()
	activities.name = "Activities"
	add_child(activities)

	map = MapBuilder.new()
	map.name = "Map"
	add_child(map)
	var steps: Array = map.steps()
	for i in steps.size():
		loading.step(steps[i][0], 0.08 + 0.62 * float(i) / steps.size())
		await get_tree().process_frame
		(steps[i][1] as Callable).call()
	loading.step("Прокладываем пути", 0.72)
	await get_tree().process_frame
	# Baked on a thread: the loading screen keeps moving meanwhile.
	map.bake_navigation(true)
	var nav_region: NavigationRegion3D = map.nav_region
	while nav_region.is_baking():
		await get_tree().process_frame
	loading.step("Готовим игрока", 0.84)
	await get_tree().process_frame

	var player := Player.new()
	player.name = "Player"
	add_child(player)
	player.global_position = Vector3(0, 0.3, 10)
	if Net.active and Net.in_game:
		# (side by side, not inside each other)
		var ids: Array = Net.members.keys()
		ids.sort()
		player.global_position += Vector3(1.6 * maxi(ids.find(multiplayer.get_unique_id()), 0), 0, 0)
	Game.player = player
	var ambient := preload("res://scripts/fx/ambient.gd").new()
	ambient.name = "Ambient"
	add_child(ambient)
	var hallu := preload("res://scripts/fx/hallucinations.gd").new()
	hallu.name = "Hallucinations"
	add_child(hallu)
	_prewarm_materials(player.cam)

	# The navigation map syncs asynchronously; wait until it has the baked mesh.
	var nav_map := get_world_3d().navigation_map
	for i in 600:
		await get_tree().physics_frame
		if NavigationServer3D.map_get_iteration_id(nav_map) > 0 \
				and NavigationServer3D.map_get_random_point(nav_map, 1, true) != Vector3.ZERO:
			break
	loading.step("Будим людей", 0.95)
	await get_tree().process_frame
	# In a game with others the host's people are the people: a client asks
	# for them (net.gd) instead of making its own.
	if Net.active and Net.in_game and not Net.is_host:
		Net.client_loaded()
	else:
		_spawn_bots()
	preload("res://scripts/game/trader.gd").spawn(self)
	# The games of roulette at the tables, and the event in building B.
	var tg: Node = preload("res://scripts/game/table_games.gd").new()
	tg.name = "TableGames"
	add_child(tg)
	# Now the world is drawn once, still under the loading screen: the
	# shaders are all compiled here and not in the first seconds of play.
	get_viewport().disable_3d = false
	for i in 3:
		await get_tree().process_frame
	Game.apply_bodycam_audio()
	loading.step("Готово", 1.0)
	loading.finish()


func _spawn_bots() -> void:
	var nav_map := get_world_3d().navigation_map
	var spawned := 0
	var tries := 0
	var count: int = [5, 7, BOT_COUNT][Game.quality]
	while spawned < count and tries < 200:
		tries += 1
		var p := NavigationServer3D.map_get_random_point(nav_map, 1, true)
		if p.distance_to(Game.player.global_position) < 12.0 or p.y > 4.0:
			continue
		spawn_bot(p, randf() * TAU)
		spawned += 1


var _bot_counter := 0


func spawn_bot(p: Vector3, yaw: float, seed_v := -1, outfit := "") -> Node3D:
	var bot := Humanoid.new()
	if outfit != "":
		bot.set_meta("outfit", outfit)
	bot.name = "Bot%d" % _bot_counter
	bot.bot_seed = seed_v if seed_v >= 0 else _bot_counter * 97 + 13 + randi() % 7 * 1000 * int(_bot_counter >= BOT_COUNT)
	_bot_counter += 1
	add_child(bot)
	bot.spawn(p + Vector3(0, 0.02, 0), yaw)
	Game.bots.append(bot)
	if seed_v < 0:
		Net.bot_spawned(bot)
	return bot


func _environment() -> void:
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation_degrees = Vector3(-48, -35, 0)
	sun.light_color = Color(1.0, 0.96, 0.9)
	sun.light_energy = 1.3
	sun.shadow_enabled = true
	sun.shadow_blur = 1.2
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 55.0
	# (the cascades blend into each other and the far edge fades out, rather
	# than shadows changing sharpness or vanishing at a line)
	sun.directional_shadow_blend_splits = true
	sun.directional_shadow_fade_start = 0.7
	sun.directional_shadow_split_1 = 0.08
	sun.directional_shadow_split_2 = 0.22
	sun.directional_shadow_split_3 = 0.5
	add_child(sun)

	# Sky with drifting volumetric clouds (see shaders/sky_clouds.gdshader).
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_PERLIN
	noise.frequency = 0.08
	noise.fractal_octaves = 4
	var cloud_tex := NoiseTexture3D.new()
	cloud_tex.width = 64
	cloud_tex.height = 64
	cloud_tex.depth = 64
	cloud_tex.seamless = true
	cloud_tex.normalize = true
	cloud_tex.noise = noise
	var sky_mat := ShaderMaterial.new()
	sky_mat.shader = load("res://shaders/sky_clouds.gdshader")
	sky_mat.set_shader_parameter("cloud_noise", cloud_tex)
	var sky := Sky.new()
	sky.sky_material = sky_mat
	# Animated sky: realtime radiance is the cheap path (the cubemap pass only
	# draws the plain gradient).
	sky.process_mode = Sky.PROCESS_MODE_REALTIME
	sky.radiance_size = Sky.RADIANCE_SIZE_256

	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.9
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.05
	env.ssao_enabled = true
	env.ssao_radius = 1.2
	env.ssao_intensity = 1.6
	env.ssao_detail = 0.5
	env.glow_enabled = true
	env.glow_intensity = 0.25
	env.glow_bloom = 0.02
	env.fog_enabled = true
	env.fog_light_color = Color(0.62, 0.65, 0.68)
	env.fog_density = 0.006
	env.fog_sky_affect = 0.3
	# Grade: close to what a camera sees - AgX does the film-like highlight
	# roll-off; no tint on top, natural saturation, a touch of contrast, the
	# shadows kept just off black and the whites a hair warm (daylight).
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.02
	env.adjustment_contrast = 1.04
	env.adjustment_brightness = 1.0
	var grade := Gradient.new()
	grade.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
	grade.colors = PackedColorArray([Color(0.008, 0.008, 0.01), Color(0.5, 0.5, 0.495), Color(1.0, 0.99, 0.965)])
	var grade_tex := GradientTexture1D.new()
	grade_tex.gradient = grade
	env.adjustment_color_correction = grade_tex
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	_interiors()

	weather = preload("res://scripts/world/weather.gd").new()
	weather.name = "Weather"
	add_child(weather)
	weather.setup(sun, env, sky_mat)
	var dirt := preload("res://scripts/world/dirt_spawner.gd").new()
	dirt.name = "DirtSpawner"
	add_child(dirt)
	day_night = preload("res://scripts/world/day_night.gd").new()
	day_night.name = "DayNight"
	add_child(day_night)
	day_night.setup(sun, env, sky_mat)
	_env = env
	_sun = sun
	_sky = sky
	Game.apply_quality()


## Inside the abandoned buildings there is little sky light: interior
## reflection probes replace the sky ambient with a dim one, so rooms are dark
## apart from what the sun and the openings let in.
func _interiors() -> void:
	# [min corner, max corner]
	var rooms := [
		[Vector3(-9.7, 0.15, -21.7), Vector3(9.7, 3.15, -8.3)],
		[Vector3(-9.7, 3.4, -21.7), Vector3(9.7, 6.4, -8.3)],
		[Vector3(-15.7, 0.1, -15.7), Vector3(-10.0, 3.1, -8.3)],
	]
	for r in rooms:
		var lo: Vector3 = r[0]
		var hi: Vector3 = r[1]
		var probe := ReflectionProbe.new()
		probe.interior = true
		probe.box_projection = true
		# Reaches past the floor and ceiling (a room is dark to its edges; the
		# fade-out would otherwise let sky light in near them) and only a
		# short blend at the walls, where the doorways lead out.
		probe.size = hi - lo + Vector3(0.3, 1.0, 0.3)
		probe.position = (lo + hi) * 0.5
		probe.blend_distance = 0.25
		probe.ambient_mode = ReflectionProbe.AMBIENT_COLOR
		probe.ambient_color = Color(0.36, 0.37, 0.4)
		probe.ambient_color_energy = 0.22
		# Reflections off: a box-projected interior capture draws a dark band
		# across the walls at eye level. The probe is only for the dim ambient.
		probe.intensity = 0.0
		probe.update_mode = ReflectionProbe.UPDATE_ONCE
		add_child(probe)


## Draws a tiny triangle with each effect material in front of the camera for a
## few frames at load, so their shaders are compiled now and not on the first
## headshot.
func _prewarm_materials(cam: Camera3D) -> void:
	var mats: Array[Material] = preload("res://scripts/bots/voxel_head.gd").materials()
	var holders: Array[Node] = []
	for i in mats.size():
		var mi := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2(0.0005, 0.0005)
		mi.mesh = q
		mi.material_override = mats[i]
		mi.position = Vector3(i * 0.001, 0, -0.1)
		cam.add_child(mi)
		holders.append(mi)
	for i in 5:
		await get_tree().process_frame
	for h in holders:
		h.queue_free()


## The parts of the look that depend on the graphics level (Game.apply_quality).
func tune_quality(q: int) -> void:
	if _env == null:
		return
	_env.ssao_enabled = q >= 1
	_env.glow_enabled = q >= 1
	if _sky:
		_sky.radiance_size = [Sky.RADIANCE_SIZE_32, Sky.RADIANCE_SIZE_64, Sky.RADIANCE_SIZE_256][q]
		_sky.process_mode = Sky.PROCESS_MODE_INCREMENTAL if q < 2 else Sky.PROCESS_MODE_REALTIME
	if _sun:
		_sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS if q == 0 else DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
		_sun.directional_shadow_max_distance = [28.0, 42.0, 55.0][q]
		_sun.shadow_blur = [0.6, 1.0, 1.2][q]
	if day_night:
		day_night.quality = q
