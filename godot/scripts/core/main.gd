extends Node3D
## Entry point: builds lighting, the level, navigation, player and bots.

const MapBuilder = preload("res://scripts/world/map_builder.gd")
const Player = preload("res://scripts/player/player.gd")
const Humanoid = preload("res://scripts/bots/humanoid.gd")
const Fx = preload("res://scripts/fx/fx.gd")
const Blood = preload("res://scripts/fx/blood.gd")

const BOT_COUNT := 8

var map: Node3D


func _ready() -> void:
	preload("res://scripts/audio/sfx.gd").prewarm()
	_environment()

	var fx := Fx.new()
	fx.name = "Fx"
	add_child(fx)
	Game.fx = fx

	var blood := Blood.new()
	blood.name = "Blood"
	add_child(blood)
	Game.blood = blood

	map = MapBuilder.new()
	map.name = "Map"
	add_child(map)
	map.build()
	map.bake_navigation()

	var player := Player.new()
	player.name = "Player"
	add_child(player)
	player.global_position = Vector3(0, 0.3, 10)
	Game.player = player

	# The navigation map syncs asynchronously; wait until it has the baked mesh.
	var nav_map := get_world_3d().navigation_map
	for i in 600:
		await get_tree().physics_frame
		if NavigationServer3D.map_get_iteration_id(nav_map) > 0 \
				and NavigationServer3D.map_get_random_point(nav_map, 1, true) != Vector3.ZERO:
			break
	_spawn_bots()


func _spawn_bots() -> void:
	var nav_map := get_world_3d().navigation_map
	var spawned := 0
	var tries := 0
	while spawned < BOT_COUNT and tries < 200:
		tries += 1
		var p := NavigationServer3D.map_get_random_point(nav_map, 1, true)
		if p.distance_to(Game.player.global_position) < 12.0 or p.y > 4.0:
			continue
		var bot := Humanoid.new()
		bot.name = "Bot%d" % spawned
		bot.bot_seed = spawned * 97 + 13
		add_child(bot)
		bot.spawn(p + Vector3(0, 0.02, 0), randf() * TAU)
		Game.bots.append(bot)
		spawned += 1


func _environment() -> void:
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation_degrees = Vector3(-48, -35, 0)
	sun.light_color = Color(1.0, 0.96, 0.9)
	sun.light_energy = 1.3
	sun.shadow_enabled = true
	sun.shadow_blur = 1.2
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 70.0
	sun.directional_shadow_blend_splits = true
	add_child(sun)

	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.36, 0.45, 0.58)
	sky_mat.sky_horizon_color = Color(0.66, 0.68, 0.7)
	sky_mat.ground_bottom_color = Color(0.2, 0.2, 0.2)
	sky_mat.ground_horizon_color = Color(0.6, 0.62, 0.63)
	sky_mat.sun_angle_max = 20.0
	var sky := Sky.new()
	sky.sky_material = sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_128

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
	env.adjustment_enabled = true
	env.adjustment_saturation = 0.92
	env.adjustment_contrast = 1.05
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
