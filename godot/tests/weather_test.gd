extends Node
## Dev test: forces a thunderstorm and takes street, indoor and lightning shots.
## Usage: godot --path . res://tests/weather_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)


func _physics_process(delta: float) -> void:
	t += delta
	if t > 24.0:
		get_tree().quit()
	var p = Game.player
	var w = Game.main.weather if Game.main else null
	if p == null or w == null:
		return
	var lvl := 0.0 if OS.get_cmdline_user_args().has("clear") else 1.0
	w.storm = lvl
	w._target = lvl
	w.wetness = minf(1.0, t / 8.0)
	if t < 14.0:
		_view(p, Vector3(0, 0.1, 8), PI, 0.02)
	else:
		_view(p, Vector3(-2, 0.3, -12), PI * 0.5, 0.0)
	if _once("strike", 10.0):
		w._next_strike = 0.0
	if int(t) != int(t - delta):
		print("t=%d fps=%d gpu=%.1f covered=%.0f rain_db=%.1f" % [t, Engine.get_frames_per_second(),
			RenderingServer.viewport_get_measured_render_time_gpu(get_viewport().get_viewport_rid()), w._covered, w._rain_player.volume_db])


func _process(_d: float) -> void:
	_snap(9.0, "storm_street")
	_snap(10.05, "lightning")
	_snap(20.0, "storm_inside")


func _view(p, pos: Vector3, yaw: float, pitch: float) -> void:
	p.global_position = pos
	p.velocity = Vector3.ZERO
	p.yaw = yaw
	p.pitch = pitch


func _snap(at: float, name_: String) -> void:
	if t >= at and not _done.has(name_):
		_done[name_] = true
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name_])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
