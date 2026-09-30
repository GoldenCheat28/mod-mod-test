extends Node
## Dev test: the chainsaw run into a man's chest, right button to keep him on
## the bar, then running with him. Prints where he is against the saw.
## Usage: godot --path . res://tests/impale_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}
var _b: Node3D


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	get_window().size = Vector2i(1600, 900)
	add_child(load("res://scenes/main.tscn").instantiate())


func _once(k: String, at: float) -> bool:
	if t < at or _done.has(k):
		return false
	_done[k] = true
	return true


func _rmb(on: bool) -> void:
	var ev := InputEventMouseButton.new()
	ev.button_index = MOUSE_BUTTON_RIGHT
	ev.pressed = on
	Input.parse_input_event(ev)


func _physics_process(delta: float) -> void:
	var p = Game.player
	if p == null or is_instance_valid(Game.main.get("loading")) or Game.bots.size() < 2:
		return
	t += delta
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if _once("setup", 0.5):
		_b = Game.bots[0]
		_b.ai.process_mode = Node.PROCESS_MODE_DISABLED
		_b.move_velocity = Vector3.ZERO
		var off: Vector3 = Vector3(0, 0, 5) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		_b.facing = Vector3.BACK
		p._switch_to("chainsaw")
	if t > 0.5 and t < 3.0:
		p.global_position = Vector3(0, 0.1, 6.15 - clampf((t - 1.5) * 0.25, 0.0, 0.3))
		p.velocity = Vector3.ZERO
		p.yaw = 0.0
		p.pitch = -0.2
	if _once("rev", 1.5):
		Input.action_press("fire")
	if _once("rmb", 2.6):
		_rmb(true)
		print("RESULT in_flesh=", p._saw.in_flesh.size() if p._saw else -1)
	if _once("check", 3.0):
		print("RESULT impaled=", p._impaled != null)
		Input.action_press("move_back")
	if t > 3.0 and t < 5.0:
		p.yaw = 0.0
	if _once("shot", 4.5):
		get_viewport().get_texture().get_image().save_png("%s/impale.png" % out)
		print("saved impale")
	if _once("end", 5.0):
		Input.action_release("move_back")
		var d: float = _b.chest.global_position.distance_to(p.cam.global_position) if is_instance_valid(_b) else -1.0
		print("RESULT after run: player moved to %s, chest %.2f m from the eyes, impaled=%s alive=%s" % [p.global_position, d, p._impaled != null, _b.alive])
		_rmb(false)
		Input.action_release("fire")
	if t > 6.0:
		get_tree().quit()
