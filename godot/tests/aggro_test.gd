extends Node
## Dev test: an armed hothead turns on the others; a grenade at a bot's feet
## (limbs torn off); the dark interior wall at eye level. Log + screenshots.
## Usage: godot --path . res://tests/aggro_test.tscn -- <out_dir>

const Grenade = preload("res://scripts/weapons/grenade.gd")

var out := "user://"
var t := 0.0
var _done := {}
var _a: Node3D
var _v: Node3D


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
	if p == null or Game.bots.size() < 4 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if t < 3.0:
		_view(p, Vector3(1.8, 0.2, -15.6), PI * 0.5, 0.0)
		var mode := OS.get_environment("BAND")
		if mode == "body":
			p._body.visible = false
		elif mode == "ssao":
			get_viewport().get_camera_3d().get_world_3d().environment.ssao_enabled = false
		elif mode == "nosun":
			Game.main.get_node("Sun").visible = false
		elif mode == "nodecal":
			for n in Game.main.map.get_children():
				if n is Decal:
					n.visible = false
		elif mode == "low":
			p._crouch = 1.0
		elif mode == "flash":
			p._flash.visible = false
			p._flash.set_process(false)
		elif mode == "fog":
			get_viewport().get_camera_3d().get_world_3d().environment.fog_enabled = false
	if _once("arm", 3.5):
		_a = Game.bots[0]
		var at: Vector3 = _a.position_ground() + Vector3(0.3, 0.3, 0.0)
		var g = preload("res://scripts/weapons/pickup.gd").spawn(get_parent(), "pistol", Transform3D(Basis(), at), Vector3.ZERO)
		g.claimed_by = _a
		_a.ai._pickup = g
		_a.ai._enter(_a.ai.S.FETCH)
		_a.ai._hothead = true
		_a.ai._aggro_in = 4.0
		_view(p, Vector3(30, 0.1, 30), 0.0, 0.0)
	if t > 3.5 and t < 18.0:
		_view(p, Vector3(30, 0.1, 30), 0.0, 0.0)   # far away and out of sight
	if t > 4.0 and t < 18.0 and int(t) != int(t - delta) and _a:
		var alive := 0
		for b in Game.bots:
			if b.alive:
				alive += 1
		print("t=%d armed=%s foe=%s state=%d alive_bots=%d fired=%s aimed=%s hurt=%.1f fear=%.2f sees=%s" % [t, _a.weapon_kind, _a.ai.foe.name if _a.ai.foe else "-", _a.ai.state, alive, Game.player_fired, _a.ai._aimed, _a.ai._hurt_recent, _a.ai.fear, _a.ai._sees])
		if _a.ai.foe:
			print("   can_see=%s want=%s on_target=%s dist=%.1f fire_t=%.2f foe_alive=%s foe_fallen=%s foe_bleed=%.1f" % [_a.ai._can_see(_a.ai.foe), _a.ai._want_fire, _a.ai._on_target() if _a.weapon else false, _a.position_ground().distance_to(_a.ai._target_ground()), _a.ai._fire_t, _a.ai.foe.alive, _a.ai.foe.fallen, _a.ai.foe.bleed_rate])
	# Grenade at a standing bot's feet.
	if _once("nade", 19.0):
		_v = null
		for b in Game.bots:
			if b.alive and b != _a:
				_v = b
				break
		if _v:
			_v.ai.process_mode = Node.PROCESS_MODE_DISABLED
			_v.move_velocity = Vector3.ZERO
			Grenade.throw(get_parent(), Transform3D(Basis(), _v.position_ground() + Vector3(0.4, 0.2, 0.0)), Vector3.ZERO, Vector3.ZERO, 1.5)
	if _v and t > 19.0 and t < 25.0:
		var c: Vector3 = _v.position_ground() + Vector3(0, 0, 4.5)
		p.global_position = c
		p.velocity = Vector3.ZERO
		var d: Vector3 = (_v.position_ground() + Vector3.UP * 0.6 - (c + Vector3.UP * 1.62)).normalized()
		p.yaw = atan2(-d.x, -d.z)
		p.pitch = asin(d.y)
	if _once("sev", 22.0) and _v:
		var sev := []
		for part in _v.parts:
			if part.has_meta("severed"):
				sev.append(part.name)
		print("after grenade: alive=%s severed=%s" % [_v.alive, sev])


func _process(_d: float) -> void:
	_snap(2.8, "interior_band")
	_snap(20.9, "nade_boom")
	_snap(23.0, "nade_after")


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
