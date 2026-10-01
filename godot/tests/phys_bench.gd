extends Node
## Dev test: what the people cost the physics, measured cleanly - no table
## event (it sends everyone walking), the median physics frame over a long
## window, with the usual crowd and with twelve more walking about.
## PHYS_BENCH_N: how many to add (default 12).

var t := 0.0
var _phase := 0
var _t0 := 0.0
var _samples: Array[float] = []


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(_delta: float) -> void:
	if _phase == 1 or _phase == 3 or _phase == 4:
		_samples.append(Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0)


func _process(delta: float) -> void:
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if _phase == 0 and t > 2.0:
		var tg := Game.main.get_node_or_null("TableGames")
		if tg:
			tg.process_mode = Node.PROCESS_MODE_DISABLED
		for b in Game.bots:
			if b.ai:
				b.ai.spectate = null
				b.ai.watch_spot = Vector3.INF
		_phase = 1
		_t0 = t + 2.0
		_samples.clear()
	elif _phase == 1 and t > _t0 + 8.0:
		_report("base")
		if OS.has_environment("PHYS_BENCH_NONE"):
			for b in Game.bots:
				b.process_mode = Node.PROCESS_MODE_DISABLED
			Game.main.get_node("CrowdLOD").process_mode = Node.PROCESS_MODE_DISABLED
			_samples.clear()
			_phase = 4
			_t0 = t
			return
		var n := int(OS.get_environment("PHYS_BENCH_N")) if OS.has_environment("PHYS_BENCH_N") else 12
		var at: Vector3 = Game.player.global_position + Vector3(3, 0, 3)
		var nav: RID = Game.player.get_world_3d().navigation_map
		for i in n:
			Game.main.spawn_bot(NavigationServer3D.map_get_closest_point(nav, at + Vector3((i % 6) * 0.9, 0, (i / 6) * 0.9)), 0.0, 1000 + i)
		_phase = 2
		_t0 = t
	elif _phase == 2 and t > _t0 + 3.0:
		_phase = 3
		_t0 = t
		_samples.clear()
	elif _phase == 4 and t > _t0 + 6.0:
		_report("no people")
		get_tree().quit()
	elif _phase == 3 and t > _t0 + 10.0:
		_report("more")
		get_tree().quit()


func _report(what: String) -> void:
	var s := _samples.duplicate()
	s.sort()
	var lod = Game.main.get_node_or_null("CrowdLOD")
	var fallen := 0
	for b in Game.bots:
		fallen += int(b.fallen)
	print("BENCH %s: people %d (asleep %d, fallen %d), physics median %.2f ms, p90 %.2f ms, frames %d" % [what, Game.bots.size(),
			lod.asleep.size() if lod else -1, fallen, s[s.size() / 2], s[int(s.size() * 0.9)], s.size()])
