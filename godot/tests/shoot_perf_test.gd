extends Node
## Dev test: holds the AKM trigger at one spot of a wall for a while and
## prints the frame cost every second (the "shooting the same point" lag).
## Usage: godot --path . res://tests/shoot_perf_test.tscn

var t := 0.0
var _set := false
var _pmax := 0.0
var _fmax := 0.0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)


func _process(delta: float) -> void:
	_fmax = maxf(_fmax, delta * 1000.0)


func _physics_process(delta: float) -> void:
	t += delta
	_pmax = maxf(_pmax, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0)
	var p = Game.player
	if p == null:
		return
	if not _set and t > 3.0:
		_set = true
		get_window().size = Vector2i(1600, 900)
		p.global_position = Vector3(float(OS.get_environment("SX")) if OS.get_environment("SX") != "" else 3.0, 0.1, -5.0)
		p.yaw = 0.0
		p.pitch = 0.0
		p._switch_to("akm")
	if t > 5.0 and t < 20.0 and p.current:
		p.current.mag = 30
		p.current.try_fire(p.cam, [p.get_rid()] as Array[RID])
	if int(t) != int(t - delta) and t > 4.0:
		var ks: Array = Game.prof.keys().filter(func(k): return String(k).begins_with("max "))
		ks.sort_custom(func(a, b): return Game.prof[a] > Game.prof[b])
		var line := "   MAX"
		for k in ks.slice(0, 6):
			line += " %s=%.1fms" % [String(k).substr(4), Game.prof[k] / 1000.0]
		print(line, "  | worst frame %.1fms, worst physics %.1fms" % [_fmax, _pmax])
		_fmax = 0.0
		_pmax = 0.0
		Game.prof.clear()
		var vp := get_viewport().get_viewport_rid()
		print("t=%d fps=%d gpu=%.1f cpu=%.1f proc=%.1f phys=%.1f nodes=%d draws=%d" % [t, Engine.get_frames_per_second(),
				RenderingServer.viewport_get_measured_render_time_gpu(vp), RenderingServer.viewport_get_measured_render_time_cpu(vp),
				Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
				Performance.get_monitor(Performance.OBJECT_NODE_COUNT), Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)])
	if int(t) != int(t - delta) and (int(t) == 18 or int(t) == 23):
		var by := {}
		for n in get_tree().root.find_children("*", "", true, false):
			var par := n.get_parent()
			var key: String = n.get_class() + " <- " + (par.name if par else "?")
			by[key] = by.get(key, 0) + 1
		var keys := by.keys()
		keys.sort_custom(func(a, b): return by[a] > by[b])
		for k in keys.slice(0, 14):
			print("  NODES %s: %d" % [k, by[k]])
	if t > 24.0:
		get_tree().quit()
