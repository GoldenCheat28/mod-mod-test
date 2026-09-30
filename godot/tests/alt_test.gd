extends Node
## Dev test: Alt moves and turns a chainsaw and a machete in the hands
## (as it does guns). Screenshots before and after, and the offsets logged.
## Usage: godot --path . res://tests/alt_test.tscn -- <out_dir>

var out := "user://"
var t := -3.0
var _done := {}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 11.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null or Game.main.weather == null:
		return
	if _once("pose", 0.0):
		p.global_position = Vector3(0, 0.1, 3)
		p.yaw = 0.0
		p.pitch = -0.1
	if int(t * 2) != int((t - delta) * 2) and t > 5.0:
		var m = p._item_model
		print("t=%.1f yaw=%.2f item=%s pos=%s target=%s stuck=%s cam=%s" % [t, p.yaw, p._item_kind,
				m.global_position if m else null, m.target.origin if m and "target" in m else null, m.stuck if m and "stuck" in m else null, p.cam.global_position])
	for k in [["chainsaw", 0.5], ["machete", 5.5]]:
		var at: float = k[1]
		if _once("take" + k[0], at):
			p._switch_to(k[0])
		if _once("alt" + k[0], at + 2.0):
			Input.action_press("free_aim")
			# Moved over to the left and up, then turned.
			for i in 20:
				_motion(Vector2(-6, -4))
			var rb := InputEventMouseButton.new()
			rb.button_index = MOUSE_BUTTON_RIGHT
			rb.pressed = true
			Input.parse_input_event(rb)
		if _once("turn" + k[0], at + 2.1):
			for i in 20:
				_motion(Vector2(8, 3))
		if _once("free" + k[0], at + 2.3):
			var rb := InputEventMouseButton.new()
			rb.button_index = MOUSE_BUTTON_RIGHT
			rb.pressed = false
			Input.parse_input_event(rb)
			Input.action_release("free_aim")
			var f = p._item_free(k[0])
			print("%s free_pos=%s free_rot=%s" % [k[0], f.free_pos, f.free_rot])


func _process_debug() -> void:
	pass


func _motion(rel: Vector2) -> void:
	var m := InputEventMouseMotion.new()
	m.relative = rel
	m.screen_relative = rel
	Input.parse_input_event(m)


func _process(_d: float) -> void:
	for s in [[2.3, "saw_before"], [3.5, "saw_after"], [7.3, "mach_before"], [8.5, "mach_after"]]:
		if t >= s[0] and not _done.has(s[1]):
			_done[s[1]] = true
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, s[1]])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
