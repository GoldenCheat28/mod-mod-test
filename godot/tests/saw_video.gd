extends Node
## Dev test for a video: the player's chainsaw splits a head top to bottom,
## cuts another man's belly at a slant, then (blade flat) a thigh straight across.
## CAM=front|back films from outside. Run with --write-movie.
## Usage: godot --path . res://tests/saw_video.tscn --write-movie out.avi --fixed-fps 30

var t := -3.0      # the bots settle first
var _done := {}
var _a: Node3D
var _b: Node3D
var _c: Node3D
var _view: Camera3D
var _anchor := {}
var _cam_mode := OS.get_environment("CAM")     # "", "front" or "back"


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 25.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("spawn", -2.5):
		_c = Game.main.spawn_bot(Vector3(-2.5, 0.0, 5.0), 0.0)
	if _once("setup", 0.5):
		_a = Game.bots[0]
		_b = Game.bots[1]
		_place(_a, Vector3(0, 0, 5))
		_place(_b, Vector3(2.5, 0, 5))
		_place(_c, Vector3(-2.5, 0, 5))
		p._switch_to("chainsaw")
		# A camera to the side: from the player's eyes the saw hides the cut.
		if _cam_mode != "":
			_view = Camera3D.new()
			_view.fov = 60.0
			add_child(_view)
			_view.make_current()
		# The camera is steered close in: keep the player's capsule out of it.
		p.collision_mask &= ~Game.LAYER_BOTS
		for bot in [_a, _b, _c]:
			for part in bot.parts:
				part.collision_mask &= ~Game.LAYER_PLAYER
	if _a == null:
		return
	for bot in [_a, _b, _c]:
		if is_instance_valid(bot) and bot.ai:
			bot.ai.fear = 0.0
			bot.move_velocity = Vector3.ZERO
	# The camera: the player's eyes, facing him from the front, or from behind.
	if _view and p.cam:
		var fwd: Vector3 = -p.cam.global_basis.z
		fwd = Vector3(fwd.x, 0.0, fwd.z).normalized()
		var right := fwd.cross(Vector3.UP)
		var eye: Vector3 = p.cam.global_position
		var aim: Vector3 = eye + fwd * 0.7 + Vector3.DOWN * 0.3
		var want: Vector3
		if _cam_mode == "front":
			want = eye + fwd * 2.0 + right * 0.9 + Vector3.UP * 0.1
			aim = eye.lerp(aim, 0.6)
		else:
			want = eye - fwd * 1.1 + right * 0.45 + Vector3.UP * 0.35
		_view.global_position = want if _view.global_position == Vector3.ZERO else _view.global_position.lerp(want, 0.1)
		_view.look_at(aim)
	# Each cut: the running blade is drawn through the part, in the blade's
	# own plane, from beyond one side to beyond the other; it only comes
	# apart once the blade is out.
	# 1. The head, straight down the middle.
	if t > 2.0 and t < 8.2:
		if _once("stand1", 2.0):
			p.global_position = Vector3(0.2, 0.3, 5.8)
		_pass(p, "head", _a.head, 3.0, 7.4, 0.17, 0.35, -0.2, 0.0, 0.28)
	if _once("fire1", 2.6):
		Input.action_press("fire")
	if _once("stop1", 8.0):
		Input.action_release("fire")
		print("head: alive=%s" % _a.alive)
	# 2. Another man, the blade tilted: slantwise through the belly.
	if t > 8.5 and t < 14.5:
		_pass(p, "belly", _c.parts[_c.part_index["abdomen"]], 9.8, 13.8, 0.26, 0.0, -0.2, PI * 0.25)
	if _once("fire2", 9.6):
		Input.action_press("fire")
	if _once("stop2", 14.3):
		Input.action_release("fire")
		print("belly: pieces=%d alive=%s" % [_pieces(), _c.alive])
	# 3. Blade flat, a thigh straight across.
	if t > 14.5 and t < 21.0:
		_pass(p, "thigh", _b.parts[_b.part_index["thigh_r"]], 16.0, 19.2, 0.16, 0.0, -0.3, PI * 0.5)
	if _once("fire3", 15.6):
		Input.action_press("fire")
	if _once("stop3", 20.0):
		Input.action_release("fire")
		print("thigh: pieces=%d alive=%s" % [_pieces(), _b.alive])
	if t > 21.0:
		p._saw_roll = 0.0
		p.global_position = Vector3(1.2, 0.1, 6.6)
		p.yaw = lerp_angle(p.yaw, 0.0, 0.05)
		p.pitch = lerpf(p.pitch, -0.55, 0.05)


func _place(bot: Node3D, at: Vector3) -> void:
	bot.ai.process_mode = Node.PROCESS_MODE_DISABLED
	bot.move_velocity = Vector3.ZERO
	bot.facing = Vector3.BACK
	var off: Vector3 = at - bot.position_ground()
	for part in bot.parts:
		part.global_position += off
		part.linear_velocity = Vector3.ZERO
		part.reset_physics_interpolation()


## Draws the blade through `part`: its middle starts `reach` beyond the part
## on one side (across the blade, in its plane) and between t0 and t1 moves
## to `reach` beyond the other. The spot is fixed when the pass is lined up,
## so the blade does not chase the part as it is cut.
func _pass(p, key: String, part: Node3D, t0: float, t1: float, reach: float, yaw: float, pitch: float, roll: float, out := -1.0) -> void:
	var saw = p._item_model
	if not _anchor.has(key) or t < t0:
		_anchor[key] = part.global_position
	var across: Vector3 = saw.global_basis.y if saw else Vector3.UP
	var k := clampf((t - t0) / (t1 - t0), 0.0, 1.0)
	_drive(p, _anchor[key] + across * lerpf(reach, -reach if out < 0.0 else -out, k), yaw, pitch, roll)


## Holds the view still and moves the player (floating, as if on a box)
## until the middle of the chainsaw bar is on `goal`.
func _drive(p, goal: Vector3, yaw: float, pitch: float, roll: float) -> void:
	p.velocity = Vector3.ZERO
	p.yaw = lerp_angle(p.yaw, yaw, 0.2)
	p.pitch = lerpf(p.pitch, pitch, 0.2)
	p._saw_roll = roll
	var saw = p._item_model
	if saw and saw.has_method("bar_root"):
		var mid: Vector3 = (saw.bar_root() as Vector3).lerp(saw.bar_nose(), 0.6)
		p.global_position += (goal - mid) * 0.2


func _pieces() -> int:
	var n := 0
	for c in Game.main.get_children():
		if c is RigidBody3D and c.has_meta("piece"):
			n += 1
	return n


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
