extends Node3D
## Dev tool: instances the main scene as a child (so this controller survives),
## positions the camera and saves screenshots.
## Usage: godot --path . res://tests/screenshot.tscn -- <out_dir>

var views := [
	# [time, player position, yaw, pitch, name]
	[2.0, Vector3(0, 0.2, 10), 0.0, -0.05, "street"],
	[3.5, Vector3(-4, 0.2, -2), 0.4, 0.05, "building"],
	[5.0, Vector3(-2, 0.3, -12), PI * 0.5, 0.0, "inside"],
	[6.5, Vector3(12, 1.4, -8), PI * 0.9, 0.1, "dock"],
	[8.0, Vector3(3.0, 0.2, -16.5), -PI * 0.5, 0.35, "stairs"],
	[9.5, Vector3(-3.0, 0.2, -5.0), 0.2, 0.25, "windows"],
	[11.0, Vector3(-10.5, 0.1, 18.5), 2.6, -0.2, "car0"],
	[12.5, Vector3(23.0, 0.1, 5.0), -2.2, -0.2, "car1"],
	[14.0, Vector3(9.5, 0.2, -10.5), PI * 0.9, -0.45, "mop"],
]
var out := "/tmp"
var t := 0.0
var idx := 0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	get_window().size = Vector2i(1600, 900)
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	# (the clock starts once the level is loaded and the player is in it)
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if idx >= views.size():
		get_tree().quit()
		return
	var v: Array = views[idx]
	var p = Game.player
	if p and t > v[0] - 1.0:
		p.global_position = v[1]
		p.velocity = Vector3.ZERO
		p.yaw = v[2]
		p.pitch = v[3]
	if t > v[0]:
		var img := get_viewport().get_texture().get_image()
		img.save_png("%s/%s.png" % [out, v[4]])
		print("saved ", v[4])
		idx += 1
