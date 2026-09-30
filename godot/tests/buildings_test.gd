extends Node
## Dev test: the tall buildings - navigation up the stairs to every floor,
## the game tables, and (with an out dir) pictures inside and out.
## Usage: godot --path . res://tests/buildings_test.tscn [-- <out_dir>]

var out := ""
var t := 0.0
var _checked := false
var views := [
	[Vector3(3.0, 1.7, 8.0), Vector3(3.0, 4.0, 22.0), "b_front"],
	[Vector3(-15.0, 1.7, 20.0), Vector3(-15.0, 4.5, 30.0), "v_front"],
	[Vector3(-2.0, 1.75, 19.5), Vector3(1.5, 0.9, 22.8), "b_hall"],
	[Vector3(7.0, 1.75, 21.5), Vector3(8.5, 2.5, 26.0), "b_stairs"],
	[Vector3(0.5, 4.95, 19.0), Vector3(-1.0, 3.9, 23.0), "b_floor2"],
	[Vector3(4.0, 8.15, 18.5), Vector3(0.0, 7.0, 24.0), "b_floor3"],
	[Vector3(-12.0, 4.95, 27.2), Vector3(-15.0, 4.0, 29.0), "v_kitchen"],
	[Vector3(-1.0, 4.95, 15.5), Vector3(-1.0, 4.4, 17.5), "b_balcony"],
]
var _vi := 0
var _cam: Camera3D


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	var p = Game.player
	if p == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if not _checked and t > 1.0:
		_checked = true
		var nav: RID = p.get_world_3d().navigation_map
		var from := NavigationServer3D.map_get_closest_point(nav, Vector3(3.0, 0.2, 10.0))
		for goal in [Vector3(1.5, 0.15, 21.0), Vector3(0.0, 3.35, 23.0), Vector3(4.0, 6.55, 20.0), Vector3(-14.0, 3.35, 28.0), Vector3(-14.0, 6.55, 33.0), Vector3(-14.0, 0.15, 33.0), Vector3(-1.0, 6.55, 21.0)]:
			var g := NavigationServer3D.map_get_closest_point(nav, goal)
			var path := NavigationServer3D.map_get_path(nav, from, g, true)
			var end: Vector3 = path[path.size() - 1] if path.size() > 0 else Vector3.INF
			print("nav to %s: closest=%s end=%s points=%d" % [goal, g, end, path.size()])
		# Piece by piece up the stairs of B: the foot of flight A, the landing,
		# the top of flight B.
		for seg in [[Vector3(9.0, 0.2, 22.8), Vector3(9.0, 0.8, 25.0)], [Vector3(9.0, 0.8, 25.0), Vector3(8.3, 1.75, 27.0)],
				[Vector3(8.3, 1.75, 27.0), Vector3(7.6, 2.8, 25.0)], [Vector3(7.6, 2.8, 25.0), Vector3(7.6, 3.35, 22.5)]]:
			var a := NavigationServer3D.map_get_closest_point(nav, seg[0])
			var b := NavigationServer3D.map_get_closest_point(nav, seg[1])
			var sp := NavigationServer3D.map_get_path(nav, a, b, true)
			print("  seg %s -> %s: a=%s b=%s end=%s" % [seg[0], seg[1], a, b, sp[sp.size() - 1] if sp.size() > 0 else Vector3.INF])
		# V's stairs, storey 2 flight B (x -19.3..-17.9, from z 33.4 down to 30.9, y 4.95..6.55).
		for zz in [33.2, 32.6, 32.0, 31.4, 30.9, 30.4]:
			var yy: float = 6.55 - (float(zz) - 30.88) / 2.52 * 1.6
			var q := Vector3(-18.6, yy + 0.15, zz)
			print("  V flightB z=%.1f want y=%.2f closest=%s" % [zz, yy, NavigationServer3D.map_get_closest_point(nav, q)])
		print("game tables: ", Game.main.map.game_tables.size(), " event hall: ", Game.main.map.event_hall)
		for gt in Game.main.map.game_tables:
			print("  table ", gt["kind"], " seats=", gt["seats"].size(), " at ", gt["center"])
		if out == "":
			get_tree().quit()
			return
		_cam = Camera3D.new()
		_cam.fov = 75.0
		add_child(_cam)
		_cam.make_current()
		t = 0.0
	if _cam and _vi < views.size():
		var v: Array = views[_vi]
		_cam.global_position = v[0]
		_cam.look_at(v[1])
		if t > 0.6:
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, v[2]])
			_vi += 1
			t = 0.0
	elif _cam:
		get_tree().quit()
