extends Node
## Dev tool: runs the main scene, positions the camera and saves screenshots.
## Usage: godot --path . res://tests/screenshot.tscn -- <out_dir> [views]

var views := [
	# [time, player position, yaw, pitch, name]
	[4.0, Vector3(0, 0.2, 10), PI, -0.05, "street"],
	[5.5, Vector3(-4, 0.2, -2), PI + 0.4, 0.05, "building"],
	[7.0, Vector3(-2, 0.3, -12), PI * 0.5, 0.0, "inside"],
	[8.5, Vector3(12, 1.4, -8), PI * 0.9, 0.1, "dock"],
]
var out := "/tmp"
var t := 0.0
var idx := 0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	get_tree().change_scene_to_file.call_deferred("res://scenes/main.tscn")
	process_mode = Node.PROCESS_MODE_ALWAYS
	reparent.call_deferred(get_tree().root)


func _process(delta: float) -> void:
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
