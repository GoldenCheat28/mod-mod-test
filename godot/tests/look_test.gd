extends Node
## Dev test: post effects and sky. Street and sky screenshots, a frame taken
## mid-turn (motion blur), switching to empty hands (2) and spawning a bot (G).

var out := "user://"
var t := 0.0
var _done := {}
var _next_log := 1.0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)


func _physics_process(delta: float) -> void:
	t += delta
	if t > 16.0:
		get_tree().quit()
	var p = Game.player
	if p == null:
		return
	if t < 5.0:
		_view(p, Vector3(-3, 0.1, 6), PI + 0.3, -0.02)
	elif t < 7.0:
		_view(p, Vector3(-3, 0.1, 6), PI + 0.6, 0.55)
	elif t < 9.0:
		# Fast turn for motion blur.
		p.global_position = Vector3(-3, 0.1, 6)
		p.yaw += delta * 6.0
	if _once("hands", 9.5):
		Input.action_press("weapon_hands")
	if _once("hands_up", 9.6):
		Input.action_release("weapon_hands")
	if t > 10.5 and t < 12.0:
		_view(p, Vector3(0, 0.1, 8), PI, -0.1)
	if _once("spawn", 12.0):
		var before: int = Game.bots.size()
		p._spawn_bot()
		print("SPAWN bots ", before, " -> ", Game.bots.size(), " armed=", p.is_armed())
	if t > _next_log:
		_next_log += 1.0
		print("t=%.0f fps=%d gpu=%.1fms" % [t, Engine.get_frames_per_second(),
				RenderingServer.viewport_get_measured_render_time_gpu(get_viewport().get_viewport_rid())])


func _process(_d: float) -> void:
	_snap(4.8, "street")
	_snap(6.8, "sky")
	_snap(8.5, "turning")
	_snap(11.8, "hands")
	_snap(14.0, "spawned")


func _view(p, pos: Vector3, yaw: float, pitch: float) -> void:
	p.global_position = pos
	p.velocity = Vector3.ZERO
	p.yaw = yaw
	p.pitch = pitch


func _snap(at: float, name_: String) -> void:
	if t >= at and not _done.has(name_):
		_done[name_] = true
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name_])
		print("saved ", name_)


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true