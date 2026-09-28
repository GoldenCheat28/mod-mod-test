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
## Rain puddles on the map: [centre, radius].
var water_spots: Array = []
var bots: Array[Node3D] = []
var slowmo := false

var _time_target := 1.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_setup_input()
	_setup_audio_buses()


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
	_bind_key("weapon_shotgun", KEY_3)
	_bind_key("slowmo", KEY_Z)
	_bind_key("release_mouse", KEY_ESCAPE)
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
		if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
			get_viewport().set_input_as_handled()


func _process(delta: float) -> void:
	# delta is already scaled by time_scale; ease on real time.
	var real_dt := delta / maxf(Engine.time_scale, 0.01)
	Engine.time_scale = move_toward(Engine.time_scale, _time_target, real_dt * 2.5)
	AudioServer.playback_speed_scale = lerpf(0.72, 1.0, (Engine.time_scale - SLOWMO_SCALE) / (1.0 - SLOWMO_SCALE))


func is_mouse_captured() -> bool:
	return Input.mouse_mode == Input.MOUSE_MODE_CAPTURED


## Fire-and-forget positional sound.
func play_3d(stream: AudioStream, pos: Vector3, volume_db := 0.0, pitch_jitter := 0.06, unit_size := 6.0) -> void:
	if stream == null or not is_inside_tree():
		return
	var p := AudioStreamPlayer3D.new()
	p.stream = stream
	p.bus = &"World"
	p.volume_db = volume_db
	p.unit_size = unit_size
	p.max_db = 6.0
	p.pitch_scale = 1.0 + randf_range(-pitch_jitter, pitch_jitter)
	p.attenuation_filter_cutoff_hz = 9000.0
	p.attenuation_filter_db = -12.0
	get_tree().current_scene.add_child(p)
	p.global_position = pos
	p.finished.connect(p.queue_free)
	p.play()
