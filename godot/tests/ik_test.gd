extends Node
## Dev test: a bot's right hand to his own temple (arm IK) - front view and
## the numbers.
var t := -3.0
var _b: Node3D
var _view: Camera3D
var out := "user://"
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
func _physics_process(delta: float) -> void:
	t += delta
	if t > 4.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.is_empty():
		return
	if _b == null:
		_b = Game.bots[0]
		_b.ai.process_mode = Node.PROCESS_MODE_DISABLED
		var off: Vector3 = Vector3(-6, 0, 12) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
		_b.facing = Vector3.BACK
		p.global_position = Vector3(20, 0.1, 30)
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
	_b.move_velocity = Vector3.ZERO
	var temple: Vector3 = _b.head.global_transform * Vector3(0.14, 0.0, 0.0)
	_b.hand_goal["r"] = temple
	var c: Vector3 = _b.chest.global_position
	_view.global_position = c + Vector3(0, 0.2, 2.2)
	_view.look_at(c + Vector3(0, 0.2, 0))
	if absf(t - 3.0) < delta * 0.6:
		var h: Vector3 = _b.parts[_b.part_index["hand_r"]].global_position
		print("goal=", temple, " hand=", h, " err=", h.distance_to(temple), " ua=", _b._target[_b.part_index["upper_arm_r"]], " fa=", _b._target[_b.part_index["forearm_r"]])
		get_viewport().get_texture().get_image().save_png(out + "/ik.png")
