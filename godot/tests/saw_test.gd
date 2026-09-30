extends Node
## Dev test: cuff a bot, kneel, walk them, chainsaw through the neck, bandage,
## a long fall. Log + screenshots.
## Usage: godot --path . res://tests/saw_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}
var _b: Node3D


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 32.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 4.0):
		_b = Game.bots[0]
		_b.move_velocity = Vector3.ZERO
		var off: Vector3 = Vector3(0, 0, 5) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		_b.facing = Vector3.BACK
		_b.ai.process_mode = Node.PROCESS_MODE_DISABLED
	if t > 4.0 and t < 9.8:
		_view(p, Vector3(0, 0.1, 6.5), 0.0, -0.1)
		if _b:
			_b.ai.fear = 0.0
	if _once("cuffs", 5.0):
		p._switch_to("cuffs")
	if _once("cuff", 6.0):
		print("before cuff: bot at %s look=%s item=%s kind=%s cur=%s" % [_b.position_ground(), p._look_humanoid(2.2), p._item, p._item_kind, p.current])
		Input.action_press("fire")
	if _once("cuff_r", 6.1):
		Input.action_release("fire")
		print("cuffed=", _b.cuffed, " state=", _b.ai.state)
	if _once("ai_on", 6.5):
		_b.ai.process_mode = Node.PROCESS_MODE_INHERIT
	if _once("kneel", 7.0):
		_b.ai.kneel = true
	if _once("kneel_log", 9.5):
		print("kneel posture=%d pelvis_h=%.2f fallen=%s" % [_b.posture, _b.pelvis.global_position.y, _b.fallen])
	if _once("escort", 10.0):
		_b.ai.kneel = false
		p._set_escort(_b)
		Input.action_press("move_forward")
	if t > 10.0 and t < 13.0:
		p.yaw = 0.0
		p.pitch = -0.15
	if _once("escort_end", 13.0):
		Input.action_release("move_forward")
		print("escort: player=%s bot=%s" % [p.global_position, _b.position_ground()])
		p._set_escort(null)
		_b.ai.kneel = true
	# Chainsaw through the neck of the kneeling, cuffed man.
	if _once("saw", 14.0):
		p._switch_to("chainsaw")
	if t > 14.5 and t < 18.4 and is_instance_valid(_b):
		var neck: Vector3 = _b.head.global_position + Vector3.DOWN * 0.1
		var fwd: Vector3 = (_b.position_ground() - p.global_position)
		fwd.y = 0.0
		var right: Vector3 = fwd.normalized().cross(Vector3.UP)
		var stand: Vector3 = neck - fwd.normalized() * 0.8 - right * 0.2
		p.global_position = Vector3(stand.x, 0.1, stand.z)
		p.velocity = Vector3.ZERO
		p.yaw = atan2(-fwd.x, -fwd.z)
		p.pitch = -0.32
		if int(t * 4) != int((t - delta) * 4) and t > 15.5:
			print("saw t=%.2f cuts=%s" % [t, p._saw])
	if _once("run", 15.5):
		Input.action_press("fire")
	if _once("run_end", 18.5):
		Input.action_release("fire")
		print("after saw: alive=%s head_severed=%s" % [_b.alive, _b.head.has_meta("severed")])
	# Bandage.
	if _once("bandage", 20.0):
		p._switch_to("hands")
		p.vitals.bleed = 20.0
		p._bandage_t = 0.0
	if t > 20.0 and t < 26.0:
		p.pitch = -0.1
	if t > 18.4 and t < 22.0 and int(t * 2) != int((t - delta) * 2):
		print("cam t=%.1f ragdoll=%s roll=%.2f kick=%.2f pitch=%.2f pos=%s dead=%s" % [t, p._ragdoll != null, p._kick_roll, p._kick, p.pitch, p.global_position, p._dead])
	if _once("band_log", 25.5):
		print("bandage=%.2f bleed=%.1f" % [p._body.bandage, p.vitals.bleed])
	# Long fall.
	if _once("fall", 27.0):
		p.global_position = Vector3(0, 9.0, 12)
		p.velocity = Vector3.ZERO
	if t > 27.0 and t < 31.0 and int(t * 4) != int((t - delta) * 4):
		print("fall t=%.2f y=%.2f vy=%.2f leg=%.2f ragdoll=%s" % [t, p.global_position.y, p.velocity.y, p.vitals.leg, p._ragdoll != null])
	if _once("fall_log", 31.0):
		print("after fall: leg=%.2f ragdoll=%s alive=%s" % [p.vitals.leg, p._ragdoll != null, p.vitals.alive])


func _process(_d: float) -> void:
	_snap(6.6, "cuffed")
	_snap(9.4, "kneel")
	_snap(12.0, "escort")
	_snap(16.5, "sawing")
	_snap(18.8, "sawed")
	_snap(21.8, "bandage_mid")
	_snap(25.0, "bandage_done")


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
