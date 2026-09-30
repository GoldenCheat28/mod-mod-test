extends Node
## Dev test: procedural slicing. A head split top to bottom (voxel kerf), a
## forearm split along its length, a thigh cut across, a cut piece cut again,
## the belly opened. Screenshots and a log.
## Usage: godot --path . res://tests/slice_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}
var _b: Node3D
var _sink := 0.0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 20.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 4.0):
		_b = Game.bots[0]
		_b.ai.process_mode = Node.PROCESS_MODE_DISABLED
		_b.move_velocity = Vector3.ZERO
		_b.facing = Vector3.BACK
		var off: Vector3 = Vector3(0, 0, 5) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
	if t > 4.0:
		p.global_position = Vector3(0.3, 0.1, 6.4)
		p.velocity = Vector3.ZERO
		p.yaw = 0.2
		p.pitch = -0.12
	# Head: the blade drawn down through it, front to back.
	if t > 5.0 and t < 9.0 and _b and int(t * 16) != int((t - delta) * 16):
		var hc: Vector3 = _b.head.global_position
		var x: Vector3 = _b.head.global_basis.x
		var zz: Vector3 = _b.head.global_basis.z
		var y0 := 0.2 - _sink
		_sink = minf(_sink + 0.006, 0.5)
		var y1 := 0.2 - _sink
		_b.soft_head.sweep(hc + Vector3.UP * y0 - zz * 0.3, hc + Vector3.UP * y0 + zz * 0.3,
				hc + Vector3.UP * y1 - zz * 0.3, hc + Vector3.UP * y1 + zz * 0.3, x)
	if _b and int(t * 2) != int((t - delta) * 2) and t > 4.5 and t < 11.0:
		print("t=%.1f pelvis=%s head=%s alive=%s" % [t, _b.pelvis.global_position, _b.head.global_position, _b.alive])
	if _once("arm", 10.0):
		var fa: RigidBody3D = _b.parts[_b.part_index["forearm_r"]]
		_b.saw_slice(fa, fa.global_position, fa.global_basis.x)      # along its length
	if _once("thigh", 11.0):
		var th: RigidBody3D = _b.parts[_b.part_index["thigh_l"]]
		_b.saw_slice(th, th.global_position, th.global_basis.y)      # across
	if _once("belly", 12.0):
		var ab: RigidBody3D = _b.parts[_b.part_index["abdomen"]]
		_b.saw_slice(ab, ab.global_position, (ab.global_basis.y + ab.global_basis.x * 0.4).normalized())
	if _once("again", 14.0):
		for n in get_parent().get_children():
			pass
		var pieces := 0
		for n in Game.main.get_children():
			if n is RigidBody3D and n.has_meta("piece"):
				pieces += 1
				if pieces == 1:
					_b.saw_slice(n, n.global_position, n.global_basis.z)
		print("pieces=", pieces, " alive=", _b.alive)


func _process(_d: float) -> void:
	_snap(9.5, "head_split")
	_snap(10.5, "arm_split")
	_snap(11.6, "thigh_cut")
	_snap(13.0, "belly")
	_snap(16.0, "after")


func _snap(at: float, name_: String) -> void:
	if t >= at and not _done.has(name_):
		_done[name_] = true
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name_])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
