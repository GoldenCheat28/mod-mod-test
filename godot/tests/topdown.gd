extends Node
## Dev tool: the map from above (orthographic), for planning.
var t := -3.0
var out := "user://"
var _cam: Camera3D
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
func _process(delta: float) -> void:
	t += delta
	if Game.player == null or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _cam == null:
		_cam = Camera3D.new()
		_cam.projection = Camera3D.PROJECTION_ORTHOGONAL
		_cam.size = 76.0
		add_child(_cam)
		_cam.make_current()
		_cam.global_transform = Transform3D(Basis.looking_at(Vector3.DOWN, Vector3.FORWARD), Vector3(0, 60, 0))
	if t > 2.0:
		get_viewport().get_texture().get_image().save_png(out + "/top.png")
		get_tree().quit()
