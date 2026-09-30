extends Node
## Dev test: armed people choosing whom to shoot, and chasing out of sight.
##  1) the player fired long ago and stands in view; B shoots at A: A must
##     turn on B, not the player.
##  2) the player shoots A and walks off behind the building: A must run to
##     where he last saw him and look round there.
## Usage: godot --path . res://tests/armed_test.tscn

var t := -3.0
var _a: Node3D
var _b: Node3D
var _done := {}


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _arm(b: Node3D) -> void:
	var m: Node3D = load("res://scripts/weapons/weapon_models.gd").pistol()
	b.add_child(m)
	b.weapon = m
	b.weapon_kind = "pistol"
	b.weapon_item = "pistol"
	b.ai._enter(b.ai.S.ARMED)


func _place(b: Node3D, at: Vector3) -> void:
	var off: Vector3 = at - b.position_ground()
	for part in b.parts:
		part.global_position += off
		part.linear_velocity = Vector3.ZERO
		part.reset_physics_interpolation()


func _physics_process(delta: float) -> void:
	t += delta
	if t > 30.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 3 or Game.main.weather == null:
		return
	if not _done.has("setup"):
		_done["setup"] = true
		_a = Game.bots[0]
		_b = Game.bots[1]
		for i in range(2, Game.bots.size()):
			_place(Game.bots[i], Vector3(30, 0, 30 + i))
			Game.bots[i].ai.process_mode = Node.PROCESS_MODE_DISABLED
		_place(_a, Vector3(0, 0, 4))
		_place(_b, Vector3(6, 0, 4))
		_arm(_a)
		_arm(_b)
		_b.ai._hothead = false
		_a.ai._hothead = false
		p.global_position = Vector3(-6, 0.1, 6)
		p._switch_to("pistol")
		Game.player_fired = true
		Game.player_shot_t = Game.clock - 120.0
	if _done.has("setup") and not _done.has("b_attacks") and t > 2.0:
		_done["b_attacks"] = true
		_b.ai.foe = _a
		_a.ai.on_attacked(_b)
	if t > 2.0 and t < 9.0 and int(t * 2) != int((t - delta) * 2):
		var f = _a.ai.foe
		print("P1 t=%.1f A.foe=%s B.foe=%s A.alive=%s B.alive=%s" % [t, "player" if f == p else ("B" if f == _b else str(f)),
				"A" if _b.ai.foe == _a else str(_b.ai.foe), _a.alive, _b.alive])
	if t > 9.0 and not _done.has("p2"):
		_done["p2"] = true
		# A and B out of it; a fresh armed man C, the player shoots at him and
		# goes behind the building.
		for x in [_a, _b]:
			x.ai.foe = null
			x.ai.process_mode = Node.PROCESS_MODE_DISABLED
			_place(x, Vector3(30, 0, 20 + (2 if x == _b else 0)))
		_a = Game.bots[2]
		_a.ai.process_mode = Node.PROCESS_MODE_INHERIT
		_place(_a, Vector3(0, 0, 4))
		_arm(_a)
		_a.ai._hothead = false
		_a.ai.on_attacked(p)
		Game.player_shot_t = Game.clock
		Game.player_shot_pos = p.global_position
	if t > 10.5 and not _done.has("hide"):
		_done["hide"] = true
		p.global_position = Vector3(-4, 0.2, -13)       # inside, behind the south wall
		print("player hides; last seen near (-6, 6)")
	if t > 9.0 and int(t * 2) != int((t - delta) * 2):
		var f = _a.ai.foe
		print("P2 t=%.1f A at %s foe=%s last_seen=%s speed=%.1f state=%s" % [t, _a.position_ground().snapped(Vector3.ONE * 0.1),
				"player" if f == p else str(f), _a.ai._last_seen.snapped(Vector3.ONE * 0.1) if _a.ai._last_seen != Vector3.INF else "-",
				_a.ai._speed, _a.ai.S.keys()[_a.ai.state]])
