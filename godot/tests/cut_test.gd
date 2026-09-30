extends Node
## Dev test: a standing dummy cut in six ways (saw_slice) - a forearm along
## its length, an upper arm slantwise, a thigh across, a shin slantwise, the
## chest top to bottom and the belly across (the gut comes out) - then close
## up pictures from four sides, to look for holes and missing faces.
## Usage: godot --path . res://tests/cut_test.tscn -- <out_dir>

var out := "user://"
var t := -3.0
var _done := {}
var _b: Node3D
var _cam: Camera3D


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 12.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 0.0):
		_b = Game.bots[0]
		_b.ai.process_mode = Node.PROCESS_MODE_DISABLED
		var spot := Vector3(-12, 0, 3.5) if OS.get_environment("GUTS") == "2" else Vector3(0, 0, 5)
		var off: Vector3 = spot - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		p.global_position = Vector3(6, 0.1, 12)
		_cam = Camera3D.new()
		_cam.fov = 55.0
		add_child(_cam)
		_cam.make_current()
	if _b == null:
		return
	var cuts := [[1.0, "forearm_r", Vector3(1, 0, 0)], [1.4, "upper_arm_l", Vector3(1, 1, 0)], [1.8, "thigh_r", Vector3(0, 1, 0)],
			[2.2, "shin_l", Vector3(0, 1, 1)], [2.6, "chest", Vector3(1, 0, 0)], [3.0, "abdomen", Vector3(0, 1, 0.2)]]
	if OS.get_environment("GUTS") == "1":
		# Just the belly, and a close look at what comes out.
		cuts = [[1.0, "abdomen", Vector3(0, 1, 0.3)]]
	if OS.get_environment("GUTS") == "2":
		# Only the gut, out of the front of the belly of a man standing.
		cuts = []
		if _once("guts", 1.0):
			var ab: RigidBody3D = _b.parts[_b.part_index["abdomen"]]
			_b._spill_guts(ab, ab.global_position - ab.global_basis.z * 0.12)
	for c in cuts:
		if _once("cut" + c[1], c[0]):
			var part: RigidBody3D = _b.parts[_b.part_index[c[1]]]
			_b.saw_slice(part, part.global_position, (part.global_basis * (c[2] as Vector3)).normalized())
	# Around it, close.
	var c: Vector3 = _b.pelvis.global_position
	var a := (t - 4.0) * 0.8
	var r := 1.6
	if OS.get_environment("GUTS") == "1":
		a = 1.2 + (t - 4.0) * 0.3
		r = 1.1
	_cam.global_position = c + Vector3(cos(a) * r, 0.4, sin(a) * r)
	if OS.get_environment("GUTS") == "2":
		var front: Vector3 = -_b.chest.global_basis.z
		front.y = 0.0
		front = front.normalized()
		_cam.global_position = c + front * 1.1 + front.cross(Vector3.UP) * 0.6 + Vector3.UP * 0.1
		_cam.look_at(c + Vector3(0, -0.4, 0) + front * 0.2)
		return
	if OS.get_environment("GUTS") == "1":
		# From above the lower half, where the gut comes out.
		_cam.global_position = c + Vector3(cos(a) * 0.5, 1.1, sin(a) * 0.5)
	_cam.look_at(c + Vector3(0, -0.2, 0))


func _process(_d: float) -> void:
	for k in 4:
		var at := 4.5 + k * 1.95
		if t >= at and not _done.has("snap%d" % k):
			_done["snap%d" % k] = true
			get_viewport().get_texture().get_image().save_png("%s/cut%d.png" % [out, k])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
