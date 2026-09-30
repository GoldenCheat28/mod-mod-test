extends Node
## Dev test: blood running down people and staying on them (body_blood.gd).
## Three bots stand facing the camera; each is shot (chest / arm / thigh),
## then again later. Screenshots over half a minute.

var t := -3.0
var _done := {}
var _view: Camera3D
var _b: Array = []
var _pool_at := Vector3.ZERO


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _once(k: String, at: float) -> bool:
	if t < at or _done.has(k):
		return false
	_done[k] = true
	return true


func _shot(b, part: RigidBody3D, off: Vector3) -> void:
	var p: Vector3 = part.global_position + off
	b.receive_hit(part, p, Vector3.FORWARD, 2.0, "pistol")


func _snap(name: String) -> void:
	var img := get_viewport().get_texture().get_image()
	img.save_png("user://bb_%s.png" % name)
	print("snap ", name, " fps ", Engine.get_frames_per_second())


func _physics_process(delta: float) -> void:
	t += delta
	if t > float(OS.get_environment("LEN") if OS.get_environment("LEN") != "" else "34"):
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 3 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 0.0):
		p.global_position = Vector3(20, 0.1, 30)
		Game.main.activities.spots.clear()
		for i in 3:
			var b: Node3D = Game.bots[i]
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			var at := Vector3(-5.0 + i * 1.0, 0.0, 12.0)
			var off: Vector3 = at - b.position_ground()
			for part in b.parts:
				part.global_position += off
				part.linear_velocity = Vector3.ZERO
				part.reset_physics_interpolation()
			b.facing = Vector3.BACK
			b.posture = b.Posture.STAND
			_b.append(b)
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
	if _b.is_empty():
		return
	for b in _b:
		b.move_velocity = Vector3.ZERO
		b.pain = minf(b.pain, 0.2)
		b.shock = 0.0
	var c: Vector3 = _b[1].position_ground()
	if OS.get_environment("POOL") != "":
		# Looking down at the pool round the bot that lost a leg.
		if _once("cut", 1.0):
			_b[2].sever("thigh_r", Vector3.RIGHT, 0.3)
			_b[0].sever("forearm_l", Vector3.LEFT, 0.3)
		if t < 6.0:
			_pool_at = _b[2].pelvis.global_position
			_pool_at.y = 0.0
		if OS.get_environment("TOP") != "":
			_view.global_position = _pool_at + Vector3(0.0, 2.6, 0.01)
			_view.look_at(_pool_at)
		else:
			_view.global_position = _pool_at + Vector3(0.3, 0.9, 0.7)
			_view.look_at(_pool_at + Vector3(0, 0, 0.1))
	elif OS.get_environment("CLOSE") != "":
		# Close on the wounds: the first one's chest, from the front, then his back.
		var ch: Vector3 = _b[0].chest.global_position
		var side := -1.0 if int(t / 3.0) % 2 == 1 else 1.0
		_view.global_position = ch + Vector3(0.1, 0.05, 0.7 * side)
		_view.look_at(ch)
	else:
		_view.global_position = c + Vector3(0.0, 1.1, 2.3)
		_view.look_at(c + Vector3(0, 0.95, 0))
	if _once("shot1", 1.0) and OS.get_environment("POOL") == "":
		_shot(_b[0], _b[0].chest, Vector3(0.05, 0.05, 0.1))
		_shot(_b[1], _b[1].parts[_b[1].part_index["upper_arm_l"]], Vector3(0, 0, 0.05))
		_shot(_b[2], _b[2].parts[_b[2].part_index["thigh_r"]], Vector3(0, 0.05, 0.07))
	if _once("shot2", 12.0) and OS.get_environment("POOL") == "":
		_shot(_b[0], _b[0].parts[_b[0].part_index["head"]], Vector3(0.03, 0.02, 0.08))
		_shot(_b[1], _b[1].chest, Vector3(-0.06, -0.05, 0.1))
	for k in [0.5, 1.15, 1.5, 2.0, 3.0, 4.0, 8.0, 14.0, 20.0, 32.0, 45.0, 60.0, 75.0]:
		if _once("s%s" % k, k):
			_snap(str(k))
