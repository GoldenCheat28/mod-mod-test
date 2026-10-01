extends Node
## Dev test: what people cost - the frame with the usual crowd, the time to
## make six more (as the cleaners come up), and the frame with them about.
var t := 0.0
var _phase := 0
var _t0 := 0.0
var _frames := 0
var _usec := 0
var _phys := 0.0
var _proc := 0.0
var _n := 0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(_delta: float) -> void:
	_frames += 1
	_phys += Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS)
	_proc += Performance.get_monitor(Performance.TIME_PROCESS)
	_n += 1


func _process(delta: float) -> void:
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if _phase == 0 and t > 3.0:
		_phase = 1
		_start()
	elif _phase == 1 and t > 11.0:
		_report("base (%d people)" % Game.bots.size())
		var at: Vector3 = Game.player.global_position + Vector3(3, 0, 3)
		var nav: RID = Game.player.get_world_3d().navigation_map
		for i in 6:
			var u := Time.get_ticks_usec()
			Game.main.spawn_bot(NavigationServer3D.map_get_closest_point(nav, at + Vector3(i * 0.8, 0, 0)), 0.0, -1, "cleaner")
			print("spawn %d: %.1f ms" % [i, (Time.get_ticks_usec() - u) / 1000.0])
		_phase = 2
		_t0 = t
	elif _phase == 2 and t > _t0 + 2.0:
		_phase = 3
		_start()
	elif _phase == 3 and t > _t0 + 10.0:
		_report("with six more walking about (%d people)" % Game.bots.size())
		# The six stand still (as the staff do): held.
		for b in Game.bots.slice(Game.bots.size() - 6):
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			b.move_velocity = Vector3.ZERO
		_phase = 4
		_t0 = t
	elif _phase == 4 and t > _t0 + 4.0:
		_phase = 5
		_start()
	elif _phase == 5 and t > _t0 + 12.0:
		var held := 0
		for b in Game.bots:
			held += int(b._held_pose)
		_report("the six standing still (%d held)" % held)
		get_tree().quit()


func _start() -> void:
	Game.prof.clear()
	_frames = 0
	_phys = 0.0
	_proc = 0.0
	_n = 0


func _report(what: String) -> void:
	var keys: Array = Game.prof.keys().filter(func(k): return not str(k).begins_with("max "))
	keys.sort_custom(func(a, b): return Game.prof[a] > Game.prof[b])
	print("== %s: %d physics frames, physics %.2f ms, process %.2f ms, active bodies %d, pairs %d, islands %d" % [what, _frames, _phys / _n * 1000.0, _proc / _n * 1000.0,
			Performance.get_monitor(Performance.PHYSICS_3D_ACTIVE_OBJECTS), Performance.get_monitor(Performance.PHYSICS_3D_COLLISION_PAIRS), Performance.get_monitor(Performance.PHYSICS_3D_ISLAND_COUNT)])
	var kinds := {}
	for n in get_tree().root.find_children("*", "RigidBody3D", true, false):
		var rb := n as RigidBody3D
		if rb.freeze or rb.sleeping:
			continue
		var k: String = str(rb.get_script().resource_path.get_file()) if rb.get_script() else ("part" if rb.has_meta("humanoid") else rb.get_parent().name)
		kinds[k] = int(kinds.get(k, 0)) + 1
	var lod = Game.main.get_node_or_null("CrowdLOD")
	print("   asleep: %d of %d people" % [lod.asleep.size() if lod else -1, Game.bots.size()])
	var fallen := 0
	for b in Game.bots:
		fallen += int(b.fallen)
	print("   fallen now: %d" % fallen)
	for k in keys.slice(0, 8):
		print("   %-40s %.2f ms/frame  (max %.1f)" % [k, float(Game.prof[k]) / maxf(_frames, 1) / 1000.0, float(Game.prof.get("max " + str(k), 0)) / 1000.0])
