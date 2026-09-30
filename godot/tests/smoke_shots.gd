extends Node
## Dev test: lighting a cigarette (lighter in view), a drag, breathing out.
## Usage: godot --path . res://tests/smoke_shots.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _shots := [[1.5, "smoke_light"], [3.0, "smoke_mouth"], [5.5, "smoke_drag"], [7.6, "smoke_exhale"]]
var _drag := false


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	get_window().size = Vector2i(1600, 900)
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	var p = Game.player
	if p == null or is_instance_valid(Game.main.get("loading")):
		return
	if t == 0.0:
		p.global_position = Vector3(-2, 0.3, -12)
		p.yaw = PI * 0.5
		p.pitch = 0.0
		p._start_smoke("cigarette")
	t += delta
	if t > 4.2 and not _drag:
		_drag = true
		p._smoking.drag_now()
	if not _shots.is_empty() and t > _shots[0][0]:
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, _shots[0][1]])
		print("saved ", _shots[0][1], " state=", p._smoking.state)
		_shots.pop_front()
	if _shots.is_empty():
		get_tree().quit()
