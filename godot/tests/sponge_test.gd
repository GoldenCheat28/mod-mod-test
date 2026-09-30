extends Node
## Dev test: the dirt about the level, and the sponge rubbing a wall stain
## off (the mouse to and fro), paid when it is clean.
var t := -3.0
var out := "user://"
var _done := {}
var _s: Node3D
var _dir := 1.0
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
func _shot(n: String) -> void:
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, n])
func _physics_process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	var Stain = load("res://scripts/world/stain.gd")
	if not _done.has("setup"):
		_done["setup"] = true
		var kinds := {}
		for g in load("res://scripts/world/graffiti.gd").all:
			if g.get_script() == Stain:
				kinds[g.dirt_kind] = kinds.get(g.dirt_kind, 0) + 1
				var gp: Vector3 = g.global_position
				var outside := gp.x < -10.5 or gp.x > 10.5 or gp.z > -7.5 or gp.z < -22.5
				if _s == null and g.dirt_kind in ["soot", "mud", "grime", "rust"] and gp.y < 2.2 and outside:
					_s = g
		print("stains: ", kinds)
		# (for the test: one made where it is easy to see and reach)
		_s = Stain.make(Game.main, Vector3(-4.0, 1.35, -7.99), Vector3(0, 0, 1), Vector2(1.1, 1.0), "grime" if OS.get_environment("KIND") == "" else OS.get_environment("KIND"), 77)
		if _s == null:
			get_tree().quit()
			return
		var n: Vector3 = _s.global_basis.y
		p.global_position = _s.global_position + n * 0.55
		p.global_position.y = Game.main.map.ground_height(p.global_position.x, p.global_position.z) + 0.1
		p.yaw = atan2(n.x, n.z)
		p.pitch = atan2(_s.global_position.y - (p.global_position.y + 1.55), 0.55)
		p.inventory.add("sponge", 1)
		p._switch_to("sponge")
		print("stain %s at %s, money %d" % [_s.dirt_kind, _s.global_position.snapped(Vector3.ONE * 0.1), p.inventory.count("money")])
	if t > 1.5 and not _done.has("before"):
		_done["before"] = true
		_shot("sp_before")
	if t > 2.0 and t < 16.0 and is_instance_valid(_s):
		Input.action_press("fire")
		p._fire_blocked = false
		# (to and fro across it, a bit lower and higher each pass)
		if p._sponge_on:
			if absf(p._sponge_off.x) > 0.5:
				_dir = -signf(p._sponge_off.x)
				p._sponge_off.y = randf_range(-0.55, 0.3)
			p._sponge_rub(Vector2(_dir * 60.0, 0.0))
	if int(t * 2) != int((t - delta) * 2) and t > 2.0 and is_instance_valid(_s):
		print("t=%.1f fps=%d on=%s off=%s left=%.2f" % [t, Engine.get_frames_per_second(), p._sponge_on, p._sponge_off, _s.left_fraction()])
	if t > 3.2 and not _done.has("prof"):
		_done["prof"] = true
		var arr := []
		for k in Game.prof:
			if not String(k).begins_with("max "):
				arr.append([Game.prof[k], k])
		arr.sort()
		arr.reverse()
		print("PROF ", arr.slice(0, 8))
		print("render: gpu=%.1f ms  draws=%d  proc=%.1f phys=%.1f" % [RenderingServer.viewport_get_measured_render_time_gpu(get_viewport().get_viewport_rid()),
				Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME), Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
				Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0])
	if t > 5.0 and not _done.has("mid"):
		_done["mid"] = true
		_shot("sp_mid")
		print("t=5 left=%.2f" % _s.left_fraction())
	if (t > 16.0 or not is_instance_valid(_s)) and not _done.has("end"):
		_done["end"] = true
		Input.action_release("fire")
		print("t=%.1f cleaned=%s money %d" % [t, not is_instance_valid(_s) or _s._gone, p.inventory.count("money")])
		_shot("sp_after")
	if t > 17.5:
		get_tree().quit()
