extends Node
## Dev test: bot small talk and a bot holding/aiming a gun.
## Usage: godot --path . res://tests/talk_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}
var _playing := {}
var _bot: Node3D


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 45.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.is_empty():
		return
	p.global_position = Vector3(0, 0.1, 14)
	if _once("chat", 3.0):
		for b in Game.bots:
			b.ai.talk._next_chat = 0.0
	for b in Game.bots:
		if b.ai == null:
			continue
		var v: AudioStreamPlayer3D = b.ai.talk._voice
		var key := b.name
		if v.playing and not _playing.get(key, false):
			print("%.1f %s says %s (state %d)" % [t, key, v.stream.resource_path.get_file(), b.ai.state])
		_playing[key] = v.playing
	if _once("gun", 25.0):
		_bot = Game.bots[0]
		var at: Vector3 = _bot.position_ground() + Vector3(0.4, 0.3, 0.0)
		var g = preload("res://scripts/weapons/pickup.gd").spawn(get_parent(), "shotgun", Transform3D(Basis(), at), Vector3.ZERO)
		_bot.ai.talk.end() if _bot.ai.talk.busy() else null
		_bot.ai.fear = 0.0
		g.claimed_by = _bot
		_bot.ai._pickup = g
		_bot.ai._enter(_bot.ai.S.FETCH)
	if _bot and t > 26.0:
		var bp: Vector3 = _bot.position_ground()
		var cp := bp + Vector3(2.2, 0.0, 2.2)
		p.global_position = cp
		p.yaw = atan2(-(bp.x - cp.x), -(bp.z - cp.z))
		p.pitch = -0.1
		if _once("fire", 34.0):
			Game.player_fired = true
			p._switch_to("pistol")
		if t > 36.0:
			print("%.1f bot state %d weapon %s" % [t, _bot.ai.state, _bot.weapon_kind]) if int(t * 2) != int((t - delta) * 2) else null


func _process(_d: float) -> void:
	_snap(33.0, "bot_carry")
	_snap(38.0, "bot_aim")
	_snap(40.0, "bot_aim2")


func _snap(at: float, name_: String) -> void:
	if t >= at and not _done.has(name_):
		_done[name_] = true
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name_])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
