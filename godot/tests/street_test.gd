extends Node
## Dev test: screenshots of the street as it is now (street_env.gd): bus stop
## and zebra, the road works, the dumped sofa, the building front, the
## warehouse corner, the worn asphalt close up (dry, then after rain).
## Usage: godot --path . res://tests/street_test.tscn -- <out_dir>

var out := "user://"
var t := -3.0
var _done := {}
var _cam: Camera3D
# [time, eye, look at, rain]
var views := [
	[1.0, Vector3(9.0, 1.7, 3.5), Vector3(1.5, 1.0, -6.5), 0.0, "bus_stop"],
	[3.0, Vector3(7.5, 1.6, 4.5), Vector3(11.0, 0.2, 0.9), 0.0, "road_works"],
	[5.0, Vector3(-16.0, 1.7, 2.5), Vector3(-19.5, 0.4, -2.8), 0.0, "dump"],
	[7.0, Vector3(2.0, 2.2, 3.0), Vector3(1.0, 3.0, -8.0), 0.0, "building_front"],
	[9.0, Vector3(15.5, 1.7, -14.0), Vector3(19.0, 0.4, -19.5), 0.0, "warehouse"],
	[11.0, Vector3(-6.0, 1.2, 1.5), Vector3(-10.0, 0.0, 2.8), 0.0, "asphalt_dry"],
	[16.0, Vector3(-6.0, 1.2, 1.5), Vector3(-10.0, 0.0, 2.8), 1.0, "asphalt_wet"],
]


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 17.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null or Game.main.weather == null:
		return
	if _cam == null:
		_cam = Camera3D.new()
		_cam.fov = 70.0
		add_child(_cam)
		_cam.make_current()
		p.global_position = Vector3(30, 0.1, 30)
	for v in views:
		if t > v[0] - 1.8 and t <= v[0]:
			_cam.global_position = v[1]
			_cam.look_at(v[2])
			Game.main.weather.storm = v[3]
			Game.main.weather._target = v[3]
			if v[3] > 0.5:
				Game.main.weather.wetness = 1.0


func _process(_d: float) -> void:
	for v in views:
		if t >= v[0] and not _done.has(v[4]):
			_done[v[4]] = true
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, v[4]])
