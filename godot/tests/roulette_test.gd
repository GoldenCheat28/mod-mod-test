extends Node
## Dev test: a game of Russian roulette with a bot, played out (LMB pressed on
## the player's turns). CAM=side films from the side, else the player's eyes.
## LEAVE=1: the player walks off in the middle instead.
## Usage: godot --path . res://tests/roulette_test.tscn --write-movie out.avi --fixed-fps 30

const Roulette = preload("res://scripts/game/roulette.gd")

var t := -3.0
var _done := {}
var _b: Node3D
var _r: Node
var _view: Camera3D
var _last := ""
var _press_t := -1.0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 40.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 0.0):
		_b = Game.bots[0]
		_b.move_velocity = Vector3.ZERO
		var start_b := Vector3(0, 0, 5)
		if OS.get_environment("TABLE") != "":
			start_b = Vector3(3.5, 0.15, -9.6)
		var off: Vector3 = start_b - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		_b.ai._enter(_b.ai.S.IDLE)
		if OS.get_environment("ACT") != "":
			print("activity=", _b.ai._try_activity(), " state=", _b.ai.S.keys()[_b.ai.state])
		p.global_position = Vector3(0.0, 0.1, 6.3)
		p.yaw = 0.0
		if OS.get_environment("TABLE") != "":
			p.global_position = Vector3(2.5, 0.3, -9.0)
			p.yaw = -1.2
		p.pitch = -0.05
		if OS.get_environment("CAM") == "side":
			_view = Camera3D.new()
			_view.fov = 60.0
			add_child(_view)
			_view.make_current()
	if _b == null:
		return
	if _once("start", 1.0):
		_r = Roulette.new()
		p.get_parent().add_child(_r)
		print("start=", _r.start(p, _b, OS.get_environment("TABLE") != ""))
	if _view and OS.get_environment("TABLE") != "":
		_view.global_position = Vector3(7.0, 2.2, -8.6)
		_view.look_at(Vector3(7.0, 0.8, -11.0))
	elif _view and is_instance_valid(_b) and _b.chest:
		var mid: Vector3 = (_b.chest.global_position + p.cam.global_position) * 0.5
		_view.global_position = mid + Vector3(2.2, 0.15, 0.0)
		_view.look_at(mid + Vector3(0, -0.1, 0))
	if is_instance_valid(_r) and OS.get_environment("BOT_DIES") != "" and _r.state == "b_wait" and _r.gun:
		_r.gun.loaded = (_r.gun.chamber + 1) % 6
	if is_instance_valid(_r):
		if _r.state != _last:
			_last = _r.state
			print("posture=%d seat=%s held=%s" % [_b.posture, _b.seat, _b._held_pose])
			print("t=%.2f state=%s chamber=%d loaded=%d bot_alive=%s player_dead=%s" % [t, _r.state,
					_r.gun.chamber if _r.gun else -1, _r.gun.loaded if _r.gun else -1, _b.alive, p._dead])
			if _r.state == "p_wait":
				_press_t = t + 1.5
		if _press_t > 0.0 and t > _press_t:
			_press_t = -1.0
			Input.action_press("fire")
			await get_tree().physics_frame
			await get_tree().physics_frame
			Input.action_release("fire")
		if OS.get_environment("LEAVE") == "1" and _r.state == "b_wait":
			p.global_position += Vector3(0, 0, 3.0) * delta
	elif _r != null and _once("over", 0.0):
		print("t=%.2f over: bot_alive=%s player_dead=%s" % [t, _b.alive, p._dead])
	if _b and not _b.alive:
		if not _done.has("dead_t"):
			_done["dead_t"] = t
		if OS.get_environment("OUT") != "" and _view:
			for k in [0.3, 1.0, 3.0]:
				if t > float(_done["dead_t"]) + k and _once("shot%.1f" % k, 0.0):
					get_viewport().get_texture().get_image().save_png("%s/slump_%.1f.png" % [OS.get_environment("OUT"), k])
		elif t > float(_done["dead_t"]) + 3.0 and _once("slump", 0.0) and Game.main.map.roulette_table.has("center"):
			# Where he ended up: over the table (head near its middle, low) or off to the side.
			var c: Vector3 = Game.main.map.roulette_table["center"]
			var seat: Vector3 = Game.main.map.roulette_table["bot"]
			var hd: Vector3 = _b.head.global_position
			var along := (c - seat).normalized()
			var off := hd - seat
			print("slump: head forward=%.2f side=%.2f height=%.2f pelvis_on_seat=%.2f" % [off.dot(along),
					absf(off.cross(Vector3.UP).normalized().dot(along.cross(Vector3.UP))) * 0.0 + absf((off - along * off.dot(along)).x * along.z - (off - along * off.dot(along)).z * along.x),
					hd.y, (_b.pelvis.global_position - seat).length()])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
