extends Node
## The event at the table in building B, run fast: prints what the judge
## says and how it goes. JOIN=1: the player takes a chair too. SMALL=1: a
## game of bots at a small table instead. OUT=<dir>: screenshots.
var t := 0.0
var _g: Node = null
var _last_state := ""
var _last_text := ""
var _shots := 0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	var tg: Node = Game.main.get_node_or_null("TableGames")
	if tg == null:
		return
	if OS.get_environment("CREW") == "1" and _done.has("start") and int(t / 5.0) != int((t - delta) / 5.0) \
			and (is_instance_valid(tg.crew) or not tg.bar.patrons.is_empty()):
		tg.event_in = 9999.0
		tg._bot_game_in = 9999.0
		var dead := 0
		for b in Game.bots:
			if is_instance_valid(b) and not b.alive:
				dead += 1
		var line := "t=%.1f dead=%d" % [t, dead]
		if is_instance_valid(tg.crew):
			for w in tg.crew.workers:
				if not is_instance_valid(w["who"]):
					continue
				var wb: Node3D = w["who"]
				line += " | %s:%s/%s job=%d at %s" % [w["role"], w["state"], w.get("stage", ""), int(w["job"]), wb.position_ground().snapped(Vector3.ONE * 0.1)]
		if tg.guards:
			for gd in tg.guards.guards:
				if is_instance_valid(gd["who"]):
					line += " | guard:%s %s" % [gd["stage"], (gd["who"] as Node3D).position_ground().snapped(Vector3.ONE * 0.1)]
		line += " || bar: " + str(tg.bar.patrons.map(func(p): return [p["sat"], p["served"]]))
		print(line)
		if t > 700.0 or (_done.has("over") and not is_instance_valid(tg.crew) and t > float(_done.get("over_t", 0.0)) + 60.0):
			get_tree().quit()
		return
	if t > 1.0 and _g == null and not _done.has("start"):
		_done["start"] = true
		Engine.time_scale = 3.0 if OS.get_environment("OUT") == "" else 1.0
		if OS.get_environment("SMALL") == "1":
			tg._bot_game_in = 0.0
		else:
			tg.event_in = 0.0
	if _g == null:
		for c in tg.get_children():
			if c.has_method("add_player"):
				_g = c
				print("t=%.1f game at table %d kind=%s players=%d judge=%s" % [t, c.table_i, c.table.get("kind"), c.seats_taken.size(), c.judge != null])
				if OS.get_environment("JOIN") == "1":
					var seat: int = c.table["seats"].size() - 1
					var s: Vector3 = c.table["seats"][seat]["pos"]
					var cc: Vector3 = c.table["center"]
					Game.player.global_position = s + (s - cc).normalized() * 0.8 + Vector3.UP * 0.1
					c.add_player(Game.player, seat)
		return
	if not is_instance_valid(_g) or _g.over:
		if not _done.has("over_t"):
			_done["over_t"] = t
		if OS.get_environment("CREW") == "1" and t - float(_done["over_t"]) < 200.0:
			if int(t / 5.0) != int((t - delta) / 5.0):
				var dead := 0
				for b in Game.bots:
					if is_instance_valid(b) and not b.alive:
						dead += 1
				var line := "t=%.1f dead=%d" % [t, dead]
				if is_instance_valid(tg.crew):
					for w in tg.crew.workers:
						if not is_instance_valid(w["who"]):
							continue
						var wb: Node3D = w["who"]
						line += " | %s:%s/%s job=%d at %s" % [w["role"], w["state"], w.get("stage", ""), int(w["job"]), wb.position_ground().snapped(Vector3.ONE * 0.1)]
				if tg.bar:
					line += " || bar: " + str(tg.bar.patrons.map(func(p): return [p["sat"], p["served"]]))
					line += " bartender=" + str(tg.bar.bartender != null)
				print(line)
			if _g != null and is_instance_valid(_g) and _g.over and not _done.has("over"):
				pass
			else:
				return
		elif not is_instance_valid(_g):
			print("t=%.1f game node gone" % t)
			get_tree().quit()
			return
	if _g.state != _last_state:
		_last_state = _g.state
		var sat := 0
		for p in _g.seats_taken:
			sat += int(p["sat"])
		print("t=%.1f state=%s sat=%d/%d alive=%d" % [t, _g.state, sat, _g.seats_taken.size(), _g._alive_in().size()])
	if _g.state == "gather" and int(t * 0.2) != int((t - delta) * 0.2):
		for p in _g.seats_taken:
			if not p["player"]:
				var b: Node3D = p["who"]
				print("    %s at %s -> %s sat=%s path=%d/%d" % [p["name"], b.position_ground(), _g._stand_point(p["seat"]), p["sat"], p.get("pi", 0), (p["path"] as PackedVector3Array).size()])
	if _g._label.text != _last_text:
		_last_text = _g._label.text
		print("   > ", _last_text)
	if Game.player.roulette == _g and _g.state == "wait" and _g._cur().get("player", false) and _g._t > 1.0:
		Input.action_press("fire")
		await get_tree().physics_frame
		Input.action_release("fire")
	if OS.get_environment("OUT") != "" and _g.state in ["wait", "after", "collect"] and not _done.has(_g.state + str(_shots)):
		_done[_g.state + str(_shots)] = true
		_shots += 1
		if _shots < 8:
			_view()
			await get_tree().create_timer(0.3).timeout
			get_viewport().get_texture().get_image().save_png("%s/table_%d_%s.png" % [OS.get_environment("OUT"), _shots, _g.state])
	if _g.over and not _done.has("over"):
		_done["over"] = true
		var money := 0
		for s in _g._stacks:
			if is_instance_valid(s):
				money += 1
		print("t=%.1f OVER winner=%s stacks_left=%d" % [t, _g._winner.get("name", "-"), money])
	if t > (750.0 if OS.get_environment("CREW") == "1" else 400.0):
		print("timeout")
		get_tree().quit()


var _done := {}


func _view() -> void:
	if Game.player.roulette == _g:
		return
	var c: Vector3 = _g.table["center"]
	Game.player.global_position = c + Vector3(2.6, 0.1, -2.2)
	Game.player.yaw = atan2(2.6, -2.2)
	Game.player.pitch = -0.35
