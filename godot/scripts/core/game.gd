extends Node
## Global game state: input map, slow motion, shared events and 3D sound helper.

signal gunshot(origin: Vector3, loudness: float)
signal bullet_passed(from: Vector3, to: Vector3)
signal bot_hurt(bot: Node3D, position: Vector3)

const LAYER_WORLD := 1
const LAYER_PROPS := 2
const LAYER_BOTS := 4
const LAYER_PLAYER := 8
const LAYER_DEBRIS := 16

const SLOWMO_SCALE := 0.5

var player: Node3D
var fx: Node3D
var blood: Node3D
var smoke: Node3D              # the air smoke goes into (smoke_air.gd)
var gibs: Node3D               # bits of flesh flying and lying about (gibs.gd)
## Rain puddles on the map: [centre, radius].
var water_spots: Array = []
var main: Node3D
var mouse_sens := 1.0            # settings (main menu), kept in user://settings.cfg
var vsync := true
## Anti-aliasing (settings): 0 auto (by the graphics level), 1 off, 2 FXAA,
## 3 TAA, 4 MSAA 2x, 5 MSAA 4x, 6 MSAA 8x, 7 MSAA 4x + TAA.
var aa := 0
const AA_NAMES := ["Авто", "Выкл", "FXAA", "TAA", "MSAA 2x", "MSAA 4x", "MSAA 8x", "MSAA 4x + TAA"]
## Body-cam look: a cheap chest camera - a strongly bent wide lens, black
## corners, noise, blown-out exposure, a hard shake on every step, the time
## and REC on screen, the sound thin and overdriven, static when the wearer
## dies (see post_fx.gd, bodycam_hud.gd).
var bodycam := false
## Graphics: -1 auto (starts at medium, drops if the frame rate is low),
## 0 low, 1 medium, 2 high.
var quality_setting := -1
var quality := 1
## Guns lying around that can be picked up.
var pickups: Array = []
## The player has fired a gun at some point: bots treat them as dangerous.
var player_fired := false
var player_shot_t := -99.0        # Game.clock of the player's last shot
var player_shot_pos := Vector3.INF
## How high the player is (0..1): rises slowly after drags on a joint, then
## wears off over a couple of minutes.
var high := 0.0
var _high_target := 0.0
var time_mod := 1.0          # extra time scaling (hallucinated slowdowns)
## Time-lapse (sleeping with the body cam): everything runs this many times
## faster, set straight away, not eased.
var fast := 1.0
var hallu_jolt := 0.0
var stare_until := -1.0
var clock := 0.0
var bots: Array[Node3D] = []
var slowmo := false
var prof := {}                  # dev: usec per system (tests)

var _time_target := 1.0


func _ready() -> void:
	_load_settings()
	if OS.get_environment("AA") != "":
		aa = int(OS.get_environment("AA"))
	if OS.get_environment("QUALITY") != "":
		quality_setting = int(OS.get_environment("QUALITY"))
		quality = maxi(quality_setting, 0)
	process_mode = Node.PROCESS_MODE_ALWAYS
	_setup_input()
	_setup_audio_buses()
	apply_vsync()
	apply_bodycam_audio()


func _setup_input() -> void:
	_bind_key("move_forward", KEY_W)
	_bind_key("move_back", KEY_S)
	_bind_key("move_left", KEY_A)
	_bind_key("move_right", KEY_D)
	_bind_key("jump", KEY_SPACE)
	_bind_key("sprint", KEY_SHIFT)
	_bind_key("reload", KEY_R)
	_bind_key("grab", KEY_E)
	_bind_key("weapon_pistol", KEY_1)
	_bind_key("weapon_hands", KEY_2)
	_bind_key("weapon_shotgun", KEY_3)
	_bind_key("weapon_akm", KEY_4)
	_bind_key("weapon_grenade", KEY_5)
	_bind_key("weapon_bomb", KEY_6)
	_bind_key("spawn_bot", KEY_H)
	_bind_key("drop", KEY_G)
	_bind_key("radial", KEY_TAB)
	_bind_key("ragdoll", KEY_Q)
	_bind_key("free_aim", KEY_ALT)
	_bind_key("flashlight", KEY_V)
	_bind_key("crouch", KEY_CTRL)
	_bind_key("slowmo", KEY_Z)
	_bind_key("release_mouse", KEY_ESCAPE)
	_bind_key("inventory", KEY_X)
	_bind_key("pickup", KEY_F)
	_bind_key("craft", KEY_C)
	if not InputMap.has_action("fire"):
		InputMap.add_action("fire")
		var ev := InputEventMouseButton.new()
		ev.button_index = MOUSE_BUTTON_LEFT
		InputMap.action_add_event("fire", ev)


func _bind_key(action: StringName, key: Key) -> void:
	if InputMap.has_action(action):
		return
	InputMap.add_action(action)
	var ev := InputEventKey.new()
	ev.physical_keycode = key
	InputMap.action_add_event(action, ev)


func _setup_audio_buses() -> void:
	if AudioServer.get_bus_index("World") != -1:
		return
	# Master gets a limiter so stacked gunshots do not clip.
	var limiter := AudioEffectHardLimiter.new()
	limiter.ceiling_db = -0.5
	AudioServer.add_bus_effect(0, limiter)

	AudioServer.add_bus()
	var idx := AudioServer.bus_count - 1
	AudioServer.set_bus_name(idx, "World")
	AudioServer.set_bus_send(idx, "Master")
	var reverb := AudioEffectReverb.new()
	reverb.room_size = 0.55
	reverb.damping = 0.6
	reverb.spread = 0.8
	reverb.wet = 0.12
	reverb.dry = 1.0
	AudioServer.add_bus_effect(idx, reverb)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("slowmo"):
		slowmo = not slowmo
		_time_target = SLOWMO_SCALE if slowmo else 1.0
	elif event.is_action_pressed("release_mouse"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseButton and event.pressed:
		# (not while a menu such as the bag is open and wants the mouse)
		var menu_open: bool = player != null and "_inv_ui" in player and player._inv_ui != null and (player._inv_ui.is_open or player._craft_ui.is_open or player.bench != null
				or (player._shop_ui != null and player._shop_ui.is_open) or (player._dialog_ui != null and player._dialog_ui.is_open))
		if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and not menu_open:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
			get_viewport().set_input_as_handled()


## Clears per-level state before the level is (re)loaded.
func reset() -> void:
	AudioServer.set_bus_mute(AudioServer.get_bus_index("Master"), false)
	if AudioServer.get_bus_index("World") != -1:
		AudioServer.set_bus_mute(AudioServer.get_bus_index("World"), false)
	bots.clear()
	pickups.clear()
	player = null
	player_fired = false
	high = 0.0
	_high_target = 0.0
	time_mod = 1.0
	fast = 1.0
	Engine.time_scale = 1.0
	stare_until = -1.0
	hallu_jolt = 0.0


func get_high(amount: float) -> void:
	_high_target = minf(_high_target + amount, 1.0)


func _process(delta: float) -> void:
	_watch_fps(delta)
	# Comes on over ~20 s, wears off over ~2 min.
	high = move_toward(high, _high_target, delta * (0.05 if high < _high_target else 0.012))
	_high_target = maxf(_high_target - delta * 0.006, 0.0)
	# delta is already scaled by time_scale; ease on real time.
	var real_dt := delta / maxf(Engine.time_scale, 0.01)
	clock += real_dt
	if fast > 1.0:
		Engine.time_scale = fast
	else:
		Engine.time_scale = move_toward(minf(Engine.time_scale, 2.0), _time_target * time_mod, real_dt * 2.5)
	AudioServer.playback_speed_scale = minf(lerpf(0.72, 1.0, (Engine.time_scale - SLOWMO_SCALE) / (1.0 - SLOWMO_SCALE)), 1.8)


func is_mouse_captured() -> bool:
	return Input.mouse_mode == Input.MOUSE_MODE_CAPTURED


## Fire-and-forget positional sound.
## `near_boost`: how much louder than `volume_db` it may get right by the ear
## (inverse-distance attenuation grows without bound as the distance goes to
## nothing - a sound at one's own mouth would otherwise always be full blast).
var _once_cache := {}


## A one-off sound never loops (some recordings are loops for footsteps and
## the like: played once here they would go on for ever).
func _once(stream: AudioStream) -> AudioStream:
	if stream == null or not ("loop" in stream) or not stream.get("loop"):
		return stream
	if not _once_cache.has(stream):
		var c: AudioStream = stream.duplicate()
		c.set("loop", false)
		_once_cache[stream] = c
	return _once_cache[stream]


func play_3d(stream: AudioStream, pos: Vector3, volume_db := 0.0, pitch_jitter := 0.06, unit_size := 6.0, near_boost := 99.0) -> void:
	if stream == null or not is_inside_tree():
		return
	var p := AudioStreamPlayer3D.new()
	p.stream = _once(stream)
	p.bus = &"World"
	p.volume_db = volume_db
	p.unit_size = unit_size
	p.max_db = minf(6.0, volume_db + near_boost)
	p.pitch_scale = 1.0 + randf_range(-pitch_jitter, pitch_jitter)
	p.attenuation_filter_cutoff_hz = 9000.0
	p.attenuation_filter_db = -12.0
	get_tree().current_scene.add_child(p)
	p.global_position = pos
	p.finished.connect(p.queue_free)
	p.play()


# --- Settings -----------------------------------------------------------------------------

const SETTINGS := "user://settings.cfg"


func save_settings() -> void:
	var c := ConfigFile.new()
	c.set_value("audio", "master", db_to_linear(AudioServer.get_bus_volume_db(0)))
	c.set_value("input", "mouse_sens", mouse_sens)
	c.set_value("video", "quality", quality_setting)
	c.set_value("video", "fullscreen", DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN)
	c.set_value("video", "vsync", vsync)
	c.set_value("video", "aa", aa)
	c.set_value("video", "bodycam", bodycam)
	c.save(SETTINGS)


func _load_settings() -> void:
	var c := ConfigFile.new()
	if c.load(SETTINGS) != OK:
		return
	AudioServer.set_bus_volume_db(0, linear_to_db(maxf(float(c.get_value("audio", "master", 1.0)), 0.001)))
	mouse_sens = float(c.get_value("input", "mouse_sens", 1.0))
	quality_setting = int(c.get_value("video", "quality", -1))
	quality = 1 if quality_setting < 0 else quality_setting
	vsync = bool(c.get_value("video", "vsync", true)) and OS.get_environment("WINDOWED") == ""
	bodycam = bool(c.get_value("video", "bodycam", false))
	aa = clampi(int(c.get_value("video", "aa", 0)), 0, AA_NAMES.size() - 1)
	if bool(c.get_value("video", "fullscreen", false)) and OS.get_environment("WINDOWED") == "":
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)


## The smoothing of edges: MSAA (the edges of things, costly), TAA (all of
## it, over frames: cheap, a touch soft), FXAA (a cheap blur of the edges).
func apply_aa() -> void:
	var vp := get_viewport()
	var mode := aa
	if mode == 0:
		mode = [2, 3, 7][clampi(quality, 0, 2)]
	vp.msaa_3d = [Viewport.MSAA_DISABLED, Viewport.MSAA_DISABLED, Viewport.MSAA_DISABLED, Viewport.MSAA_DISABLED,
			Viewport.MSAA_2X, Viewport.MSAA_4X, Viewport.MSAA_8X, Viewport.MSAA_4X][mode]
	vp.use_taa = mode in [3, 7]
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if mode == 2 else Viewport.SCREEN_SPACE_AA_DISABLED


func apply_vsync() -> void:
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if vsync else DisplayServer.VSYNC_DISABLED)


## A cheap camera's microphone: no low end, the top rolled off, squashed hard
## and driven into a little distortion - thin, loud and harsh.
func apply_bodycam_audio() -> void:
	var bus := AudioServer.get_bus_index("CamMic")
	if bus == -1:
		AudioServer.add_bus(1)
		bus = 1
		AudioServer.set_bus_name(bus, "CamMic")
		AudioServer.set_bus_send(bus, "Master")
		var hp := AudioEffectHighPassFilter.new()
		hp.cutoff_hz = 320.0
		AudioServer.add_bus_effect(bus, hp)
		var lp := AudioEffectLowPassFilter.new()
		lp.cutoff_hz = 6500.0
		AudioServer.add_bus_effect(bus, lp)
		var comp := AudioEffectCompressor.new()
		comp.threshold = -22.0
		comp.ratio = 10.0
		comp.attack_us = 800.0
		comp.release_ms = 120.0
		comp.gain = 9.0
		AudioServer.add_bus_effect(bus, comp)
		var dist := AudioEffectDistortion.new()
		dist.mode = AudioEffectDistortion.MODE_OVERDRIVE
		dist.drive = 0.35
		dist.pre_gain = 2.0
		dist.post_gain = -3.0
		dist.keep_hf_hz = 5000.0
		AudioServer.add_bus_effect(bus, dist)
	if AudioServer.get_bus_effect_count(bus) < 5:
		# (a bass shelf the shots drive into overload: hearing.gd)
		var eq := AudioEffectEQ6.new()
		AudioServer.add_bus_effect(bus, eq, 2)
	# Everything that would go to Master goes through the "microphone" first.
	for i in AudioServer.bus_count:
		var nm := AudioServer.get_bus_name(i)
		if nm != "Master" and nm != "CamMic" and AudioServer.get_bus_send(i) in [&"Master", &"CamMic"]:
			AudioServer.set_bus_send(i, "CamMic" if bodycam else "Master")
	AudioServer.set_bus_bypass_effects(bus, not bodycam)


# --- Graphics quality -----------------------------------------------------------------------

## What each level costs: low for weak machines (a third fewer pixels drawn
## and scaled up with FSR, hard short shadows, no ambient occlusion, glow or
## volumetric fog, lamps without shadows, fewer people about); medium in
## between; high everything on.
func apply_quality() -> void:
	var vp := get_viewport()
	var q := quality
	apply_aa()
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR if q < 2 else Viewport.SCALING_3D_MODE_BILINEAR
	vp.scaling_3d_scale = [0.67, 0.85, 1.0][q]
	vp.mesh_lod_threshold = [4.0, 2.0, 1.0][q]
	vp.positional_shadow_atlas_size = [1024, 2048, 4096][q]
	RenderingServer.directional_shadow_atlas_set_size([1024, 2048, 4096][q], true)
	RenderingServer.directional_soft_shadow_filter_set_quality([RenderingServer.SHADOW_QUALITY_HARD,
			RenderingServer.SHADOW_QUALITY_SOFT_LOW, RenderingServer.SHADOW_QUALITY_SOFT_MEDIUM][q])
	RenderingServer.positional_soft_shadow_filter_set_quality([RenderingServer.SHADOW_QUALITY_HARD,
			RenderingServer.SHADOW_QUALITY_SOFT_LOW, RenderingServer.SHADOW_QUALITY_SOFT_MEDIUM][q])
	RenderingServer.environment_set_ssao_quality([RenderingServer.ENV_SSAO_QUALITY_VERY_LOW,
			RenderingServer.ENV_SSAO_QUALITY_LOW, RenderingServer.ENV_SSAO_QUALITY_MEDIUM][q], q < 2, 0.5, 2, 50, 300)
	RenderingServer.environment_set_volumetric_fog_volume_size([64, 64, 128][q], [32, 48, 64][q])
	# A frame that falls behind does not pile physics steps on the next one.
	Engine.max_physics_steps_per_frame = [2, 3, 6][q]
	if main and main.has_method("tune_quality"):
		main.tune_quality(q)


## Auto: the first stretch of play is watched; if it is slow, the level drops.
var _fps_t := 0.0
var _fps_sum := 0.0
var _fps_n := 0


func _watch_fps(delta: float) -> void:
	if quality_setting >= 0 or main == null or quality == 0:
		return
	_fps_t += delta
	if _fps_t < 6.0:
		return
	_fps_sum += Engine.get_frames_per_second()
	_fps_n += 1
	if _fps_t > 12.0:
		var avg := _fps_sum / maxf(_fps_n, 1)
		_fps_t = 0.0
		_fps_sum = 0.0
		_fps_n = 0
		if avg < 45.0:
			quality -= 1
			apply_quality()
			print("graphics: auto quality -> ", quality, " (", int(avg), " fps)")
