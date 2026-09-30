extends Node
## Dev test: the main menu, a screenshot after it has settled.
var t := 0.0
var out := "user://"
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/menu.tscn").instantiate())
func _process(delta: float) -> void:
	t += delta
	if t > 6.0:
		get_viewport().get_texture().get_image().save_png(out + "/menu.png")
		get_tree().quit()
