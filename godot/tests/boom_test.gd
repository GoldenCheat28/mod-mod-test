extends Node
## Dev test: pistol reload (left hand), a thrown grenade among bots, a bomb
## placed at the front door with its keypad typed in by the player, and the
## door breaking. Screenshots and a log.
## Usage: godot --path . res://tests/boom_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}
var _bomb: Node = null


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 34.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 3 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	# Reload with the left hand.
	if t < 7.0:
		_view(p, Vector3(0, 0.1, 8), PI, -0.25)
	if _once("empty", 4.0):
		p.current.mag = 0
		p.current._slide_locked = true
		p.current.chambered = false
		p.current.try_reload()
	# Grenade into three bots standing on the street.
	if _once("bots", 7.0):
		for i in 3:
			var b = Game.bots[i]
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			b.move_velocity = Vector3.ZERO
			var off: Vector3 = Vector3(-2.0 + i * 1.6, 0.0, 2.0) - b.position_ground()
			for part in b.parts:
				part.global_position += off
				part.linear_velocity = Vector3.ZERO
				part.reset_physics_interpolation()
	if t > 7.0 and t < 9.5:
		_view(p, Vector3(0, 0.1, 9), 0.0, -0.12)
	if _once("nade", 8.0):
		p._switch_to("grenade")
	if _once("throw", 9.0):
		_rmb(true)
	if _once("throw_rel", 9.1):
		_rmb(false)
	if _once("run", 9.5):
		_view(p, Vector3(0, 0.1, 25), 0.0, -0.05)
		for i in 3:
			print("bot %d at %s" % [i, Game.bots[i].position_ground()])
	if _once("nade_log", 13.5):
		for i in 3:
			var b = Game.bots[i]
			print("bot %d alive=%s fallen=%s shock=%.2f bleed=%.1f" % [i, b.alive, b.fallen, b.shock, b.bleed_rate])
	# Bomb at the front door: place, type 3, red.
	if t > 15.0 and t < 16.0:
		_view(p, Vector3(-6.0, 0.2, -6.6), 0.0, -1.0)
	if _once("bomb", 15.2):
		p._switch_to("bomb")
	if _once("place", 16.0):
		Input.action_press("fire")
	if _once("place_rel", 16.1):
		Input.action_release("fire")
		for n in get_tree().current_scene.get_children():
			pass
		for n in Game.main.get_children():
			if n.has_method("press"):
				_bomb = n
		print("bomb placed: ", _bomb != null)
	if _bomb and t > 16.5 and t < 19.0 and is_instance_valid(_bomb):
		# Look straight at key "3" and then at the red button.
		var key := 2 if t < 17.6 else 9
		var target: Vector3 = _bomb.key_world(key)
		var eye: Vector3 = p.cam.global_position
		var d := (target - eye).normalized()
		p.yaw = atan2(-d.x, -d.z)
		p.pitch = asin(d.y)
	if t > 16.9 and t < 17.25 and int(t * 20) != int((t - delta) * 20):
		var d: float = p.cam.global_position.distance_to(_bomb.global_position) if is_instance_valid(_bomb) else -1.0
		print("look bomb=%s key=%d dist=%.2f" % [p._look_bomb, p._look_key, d])
	if _once("key3", 17.2):
		Input.action_press("fire")
	if _once("key3r", 17.3):
		Input.action_release("fire")
	if _once("red", 18.2):
		Input.action_press("fire")
	if _once("redr", 18.3):
		Input.action_release("fire")
	if _once("bomb_state", 18.8) and is_instance_valid(_bomb):
		print("bomb entry=%s armed=%s remaining=%.1f" % [_bomb.entry, _bomb.armed, _bomb.remaining])
	if t > 27.0:
		_view(p, Vector3(1.8, 0.2, -15.6), PI * 0.5, 0.0)
	if _once("splinter", 28.0):
		for n in Game.main.map.get_children():
			if n.has_method("damage") and n.global_position.distance_to(Vector3(0, 0.16, -16.17)) < 0.5:
				n.damage(30.0, n.global_transform * Vector3(0.6, 1.1, 0.0), Vector3(-1, 0, 0))
	if t > 19.0 and t < 27.0:
		_view(p, Vector3(-6.0, 0.2, -1.0), 0.0, -0.05)
	if _once("after", 24.0):
		var left := 0
		for n in Game.main.map.get_children():
			if n.has_method("damage"):
				left += 1
		print("doors left ", left)


func _process(_d: float) -> void:
	_snap(4.35, "reload_out")
	_snap(4.6, "reload_pocket")
	_snap(4.9, "reload_in")
	_snap(5.55, "reload_rack")
	_snap(9.15, "throw_anim")
	_snap(12.6, "grenade_boom")
	_snap(14.0, "grenade_after")
	_snap(17.35, "keypad_press")
	_snap(19.1, "bomb_armed")
	_snap(21.3, "bomb_boom")
	_snap(26.0, "bomb_smoke")
	_snap(28.12, "splinter_a")
	_snap(28.6, "splinter_b")


func _view(p, pos: Vector3, yaw: float, pitch: float) -> void:
	p.global_position = pos
	p.velocity = Vector3.ZERO
	p.yaw = yaw
	p.pitch = pitch


func _snap(at: float, name_: String) -> void:
	if t >= at and not _done.has(name_):
		_done[name_] = true
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name_])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true


func _rmb(down: bool) -> void:
	var e := InputEventMouseButton.new()
	e.button_index = MOUSE_BUTTON_RIGHT
	e.pressed = down
	Input.parse_input_event(e)
