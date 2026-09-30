extends Node
## Dev test: screenshots in the rain - out in the street and inside the
## abandoned building (no rain should get in under the slabs).
## Usage: godot --path . res://tests/rain_shots.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}
var views := [
	[6.0, Vector3(0, 0.2, 4), PI, 0.05, "rain_street"],
	[8.0, Vector3(-2, 0.3, -12), PI * 0.5, 0.1, "rain_inside"],
	[10.0, Vector3(3, 3.6, -12), PI, 0.2, "rain_inside2"],
]
var idx := 0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.main == null or Game.main.weather == null:
		return
	if t < 1.0:
		get_window().size = Vector2i(1600, 900)
	Game.main.weather.storm = 0.8
	Game.main.weather._target = 0.8
	if idx >= views.size():
		get_tree().quit()
		return
	var v: Array = views[idx]
	if t > v[0] - 1.5:
		p.global_position = v[1]
		p.velocity = Vector3.ZERO
		p.yaw = v[2]
		p.pitch = v[3]
	if t > v[0]:
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, v[4]])
		print("saved ", v[4])
		idx += 1
