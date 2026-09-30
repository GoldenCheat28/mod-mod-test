extends Node
## Dev test: the loading screen while the level is built, and the first view.
## Usage: godot --path . res://tests/loading_shots.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _n := 0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	get_window().size = Vector2i(1600, 900)
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	t += delta
	if (_n == 0 and t > 0.3) or (_n == 1 and t > 1.2) or (_n == 2 and Game.player != null and t > 8.0):
		get_viewport().get_texture().get_image().save_png("%s/loading_%d.png" % [out, _n])
		print("saved loading_%d at %.1f status=%s" % [_n, t, Game.main.loading.status if is_instance_valid(Game.main.loading) else "-"])
		_n += 1
	if _n >= 3 or t > 30.0:
		get_tree().quit()
