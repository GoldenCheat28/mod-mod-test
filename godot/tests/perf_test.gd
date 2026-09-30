extends Node
const Explosion = preload("res://scripts/weapons/explosion.gd")
## Dev test: frame cost over 30 s of normal play (bots about, activities,
## smoke, weather). OFF=<what> switches a part off to see what it costs.
## Usage: OFF=... godot --path . res://tests/perf_test.tscn

var t := 0.0
var _off := false
var _acc := {}
var _n := 0
var _f0 := 0


var _st := {}


## A massacre in front of the camera: bodies shot to bits, limbs off, guts,
## a blast, smoke - everything that is left lying about and bleeding.
func _stress() -> void:
	var p = Game.player
	if t > 3.0 and not _st.has("put"):
		_st["put"] = true
		get_window().size = Vector2i(1920, 1080)
		for i in mini(8, Game.bots.size()):
			var b: Node3D = Game.bots[i]
			var at := Vector3(6.0 + (i % 4) * 1.2, 0.0, -3.0 + (i / 4) * 1.5)
			var off: Vector3 = at - b.position_ground()
			for part in b.parts:
				part.global_position += off
				part.linear_velocity = Vector3.ZERO
				part.reset_physics_interpolation()
	if t > 4.0 and not _st.has("kill"):
		_st["kill"] = true
		for i in mini(8, Game.bots.size()):
			var b: Node3D = Game.bots[i]
			for k in 4:
				var part: RigidBody3D = b.parts[(k * 3 + i) % b.parts.size()]
				b.receive_hit(part, part.global_position + Vector3(0, 0.03, 0), Vector3(1, 0, 0), 4.0, "rifle")
			if i % 2 == 0:
				b.sever("forearm_r" if b.part_index.has("forearm_r") else b.part_index.keys()[5], Vector3.UP)
			if i % 3 == 0:
				var ch: RigidBody3D = b.parts[b.part_index["chest"]] if b.part_index.has("chest") else b.parts[1]
				b._spill_guts(ch, ch.global_position)
	if t > 5.0 and not _st.has("boom"):
		_st["boom"] = true
		Explosion.explode(get_tree(), Vector3(9.0, 0.2, 1.0), 1.0)
		Game.smoke.add(Vector3(7.5, 0.5, -2.0), 3.0, 1.5)


var _hidden: Array = []
var _ph := -1


## Hides one kind of thing at a time and prints what the frame costs then.
func _phases() -> void:
	var groups := ["none", "flaps", "bots", "shadows", "items", "Decal", "GPUParticles3D", "MultiMeshInstance3D", "OmniLight3D", "ReflectionProbe"]
	var k := int((t - 10.0) / 2.0)
	if k < 0 or k >= groups.size() or k == _ph:
		if k >= 0 and k < groups.size() and fmod(t - 10.0, 2.0) > 1.5 and not _st.has("p%d" % k):
			_st["p%d" % k] = true
			var vp := get_viewport().get_viewport_rid()
			print("PHASE %s draws=%d gpu=%.1f fps=%d" % [groups[k], Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME), RenderingServer.viewport_get_measured_render_time_gpu(vp), Engine.get_frames_per_second()])
		return
	_ph = k
	for n in _hidden:
		if is_instance_valid(n):
			if n is Light3D and n.has_meta("sh"):
				n.shadow_enabled = true
			else:
				n.visible = true
	_hidden.clear()
	var g: String = groups[k]
	var all := get_tree().root.find_children("*", "", true, false)
	for n in all:
		var hit := false
		if g == "guts":
			hit = n.get_script() != null and str(n.get_script().resource_path).ends_with("guts.gd")
		elif g == "bots":
			hit = n in Game.bots
		elif g == "flaps":
			hit = n is Node3D and n.get_parent() != null and n.get_parent().get_parent() in Game.bots and n.top_level
		elif g == "items":
			hit = n is RigidBody3D and n.get_script() != null and str(n.get_script().resource_path).ends_with("item_drop.gd")
		elif g == "shadows":
			if n is Light3D and n.shadow_enabled:
				n.set_meta("sh", true)
				n.shadow_enabled = false
				_hidden.append(n)
			continue
		elif g != "none":
			hit = n.is_class(g)
		if hit and n is Node3D and n.visible:
			n.visible = false
			_hidden.append(n)
	print("hid %d %s" % [_hidden.size(), g])


func _ready() -> void:
	if OS.get_environment("PHYS") != "":
		Engine.physics_ticks_per_second = int(OS.get_environment("PHYS"))
	add_child(load("res://scenes/main.tscn").instantiate())
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)


func _physics_process(delta: float) -> void:
	t += delta
	if t > 32.0:
		var keys: Array = Game.prof.keys() if "prof" in Game else []
		keys.sort_custom(func(a, b): return Game.prof[a] > Game.prof[b])
		for k in keys:
			print("PROF %s=%.2f ms/frame" % [k, Game.prof[k] / 1000.0 / maxf(Engine.get_process_frames() - _f0, 1)])
		for k in _acc:
			print("AVG %s=%.2f" % [k, _acc[k] / maxf(_n, 1)])
		var fallen := 0
		for b in Game.bots:
			if b.alive and b.fallen:
				fallen += 1
		print("BOTS alive_fallen=", fallen, " of ", Game.bots.size(), " ticks=", Engine.physics_ticks_per_second)
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null or Game.main.weather == null:
		return
	if not _off:
		_off = true
		p.global_position = Vector3(3.0, 0.1, -1.5)
		p.yaw = 1.4
		var mode := OS.get_environment("OFF")
		for m in mode.split(",", false):
			if m == "bots":
				for b in Game.bots:
					b.process_mode = Node.PROCESS_MODE_DISABLED
					b.visible = false
			elif m == "shadows":
				for n in Game.main.find_children("*", "Light3D", true, false):
					n.shadow_enabled = false
			elif m == "post":
				p._post.visible = false
			else:
				var nn := Game.main.get_node_or_null(m)
				if nn:
					nn.process_mode = Node.PROCESS_MODE_DISABLED
					if nn is Node3D:
						nn.visible = false
					print("disabled ", nn.name)
				else:
					print("no node ", m)
	if OS.get_environment("STRESS") != "":
		_stress()
	if OS.get_environment("PHASES") != "":
		_phases()
	if t > 8.0 and _f0 == 0:
		_f0 = Engine.get_process_frames()
		if "prof" in Game: Game.prof.clear()
	if t > 8.0:
		if int(t) != int(t - delta):
			print("t=%d fps=%d gpu=%.1f proc=%.1f phys=%.1f" % [t, Engine.get_frames_per_second(), RenderingServer.viewport_get_measured_render_time_gpu(get_viewport().get_viewport_rid()), Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0])
		var vp := get_viewport().get_viewport_rid()
		var s := {
			"fps": Engine.get_frames_per_second(),
			"gpu": RenderingServer.viewport_get_measured_render_time_gpu(vp),
			"cpu_render": RenderingServer.viewport_get_measured_render_time_cpu(vp),
			"proc": Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
			"phys": Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0,
			"draws": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
			"prims": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME) / 1000.0,
			"objects": Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
			"bodies": Performance.get_monitor(Performance.PHYSICS_3D_ACTIVE_OBJECTS),
		}
		for k in s:
			_acc[k] = _acc.get(k, 0.0) + s[k]
		_n += 1
