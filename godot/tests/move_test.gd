extends Node
## Dev test: dark interior + flashlight, crouching, climbing a low barrier and
## the loading dock, shooting through a door. Screenshots and a log.
## Usage: godot --path . res://tests/move_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 30.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if t < 5.5:
		_view(p, Vector3(-2, 0.3, -12), PI * 0.5, -0.05)
	if _once("light", 4.5):
		p._flash.toggle()
	if t > 5.5 and t < 8.5:
		_view(p, Vector3(-2, 0.3, -12), PI * 0.5, -0.9)
		Input.action_press("crouch")
	if _once("uncrouch", 8.5):
		Input.action_release("crouch")
		p._flash.toggle()
	# Walk at the dock (1.2 m) and jump: climb.
	if t > 9.0 and t < 9.3:
		_view(p, Vector3(17.3, 0.1, -12), PI * 0.5, 0.0)
	if _once("climb", 9.5):
		Input.action_press("move_forward")
		Input.action_press("jump")
	if _once("climb_rel", 10.3):
		Input.action_release("jump")
	if t > 9.5 and t < 11.5 and int(t * 10) != int((t - delta) * 10):
		print("climb t=%.1f pos=%s climbing=%s" % [t, p.global_position, not p._climb.is_empty()])
	if _once("stop", 11.5):
		Input.action_release("move_forward")
		print("after climb pos=", p.global_position)
	# Shoot the front door from the street.
	if t > 13.0 and t < 16.0:
		_view(p, Vector3(-6.0, 0.2, -4.5), 0.0, 0.0)
	if _once("break", 15.5):
		Input.action_press("fire")
	if _once("break_stop", 16.9):
		Input.action_release("fire")
		var left := 0
		for n in Game.main.map.get_children():
			if n.has_method("damage"):
				left += 1
		print("doors left ", left)
	if _once("dummy", 16.5):
		p._spawn_bot(true)
		print("bots now ", Game.bots.size(), " last ai mode ", Game.bots[-1].ai.process_mode)
	if _once("akm", 12.2):
		p._switch_to("akm")
	if _once("akm_fire", 13.5):
		Input.action_press("fire")
	if _once("akm_stop", 14.3):
		Input.action_release("fire")
		print("akm mag after burst: ", p.current.mag if p.current else -1, " kind ", p.current.kind if p.current else "")
	if _once("door_log", 16.0):
		for n in Game.main.map.get_children():
			if n is RigidBody3D and n.has_meta("surface") and n.get_meta("surface") == "wood":
				print("door at ", n.global_position, " ang_vel ", n.angular_velocity, " rot ", n.global_rotation)
	# Out through a ground-floor window (sill 1 m, opening 1.3 m).
	if t > 17.0 and t < 17.3:
		_view(p, Vector3(-2.0, 0.2, -9.1), PI, 0.0)
	if _once("win", 17.4):
		Input.action_press("move_forward")
		Input.action_press("jump")
	if _once("win_rel", 17.6):
		Input.action_release("jump")
	if t > 17.4 and t < 19.5 and int(t * 10) != int((t - delta) * 10):
		print("window t=%.1f pos=%s climbing=%s kind=%s crouch=%.2f" % [t, p.global_position, not p._climb.is_empty(), p._climb.get("kind", "-"), p._crouch])
	if _once("win_end", 19.5):
		Input.action_release("move_forward")
		print("after window pos=", p.global_position)


func _process(_d: float) -> void:
	_snap(4.3, "dark_inside")
	_snap(5.4, "flashlight")
	_snap(8.0, "crouch_down")
	_snap(10.0, "climbing")
	_snap(12.0, "climbed")
	_snap(13.3, "akm_before")
	_snap(13.7, "akm_fire")
	_snap(14.1, "akm_fire2")
	_snap(16.95, "door_shot")
	_snap(17.75, "vault_a")
	_snap(18.05, "vault_b")
	_snap(10.35, "climb_legs")


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
