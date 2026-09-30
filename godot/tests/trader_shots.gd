extends Node
## Dev test: the trader in his garage, his shop, the warehouse stock.
## Usage: godot --path . res://tests/trader_shots.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	get_window().size = Vector2i(1600, 900)
	add_child(load("res://scenes/main.tscn").instantiate())


func _shot(n: String) -> void:
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, n])
	print("saved ", n)


func _once(k: String, at: float) -> bool:
	if t < at or _done.has(k):
		return false
	_done[k] = true
	return true


func _process(delta: float) -> void:
	if Game.player == null or is_instance_valid(Game.main.get("loading")):
		return
	t += delta
	var p = Game.player
	if t < 2.0:
		p.global_position = Vector3(-23.5, 0.1, -26.6)
		p.yaw = 0.0
		p.pitch = -0.12
	if _once("trader", 2.0):
		_shot("trader")
		p._pick_up()
	if _once("shop", 2.6):
		_shot("shop")
		p._shop_ui.close()
	if t > 2.8 and t < 4.5:
		p.global_position = Vector3(24.0, 0.1, -22.5)
		p.yaw = PI + 0.6
		p.pitch = -0.2
	if _once("wh", 4.5):
		_shot("warehouse")
	if t > 4.6 and t < 6.0:
		p.global_position = Vector3(29.0, 0.1, -22.0)
		p.yaw = -0.5
		p.pitch = -0.25
	if _once("wh2", 6.0):
		_shot("warehouse2")
		get_tree().quit()
