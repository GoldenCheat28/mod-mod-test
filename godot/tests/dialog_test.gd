extends Node
## Dev test: talking to a man - ask what he needs, sell it (too dear first,
## he haggles, then at his price); then another comes up on his own.
var t := -3.0
var out := "user://"
var _done := {}
var _b: Node3D
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
func _shot(n: String) -> void:
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, n])
func _find(d, text: String) -> int:
	for i in d._opts.size():
		if String(d._opts[i][0]).begins_with(text):
			return i
	return -1
func _physics_process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	var d = p._dialog_ui
	if not _done.has("setup"):
		_done["setup"] = true
		_b = Game.bots[0]
		for i in range(1, Game.bots.size()):
			Game.bots[i].ai.process_mode = Node.PROCESS_MODE_DISABLED
		var off: Vector3 = Vector3(3, 0, 2) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		if _b.ai.act:
			_b.ai._end_activity()
		_b.ai._enter(_b.ai.S.IDLE)
		p.global_position = Vector3(3, 0.1, 4)
		p.yaw = 0.0
		p.pitch = 0.0
	if _b.ai.state == _b.ai.S.IDLE:
		_b.ai._state_t = 0.0
	if t > 1.0 and not _done.has("open"):
		_done["open"] = true
		p.open_dialog(_b)
		var pe = d._persona()
		pe.trust = 0.5
		print("persona: ", pe.name, " money=", pe.money, " wants=", pe.wants, " has=", pe.has)
		if not pe.wants.is_empty():
			p.inventory.add(pe.wants[0][0], 1)
	if t > 1.5 and not _done.has("s1"):
		_done["s1"] = true
		_shot("d_main")
		d._choose(_find(d, "Спросить"))
		d._choose(_find(d, "Тебе самому"))
		print("he says: ", d._say)
		_shot("d_needs")
	if t > 2.0 and not _done.has("sell"):
		_done["sell"] = true
		d._show("main")
		d._choose(_find(d, "Предложить"))
		var pe = d._persona()
		if pe.wants.is_empty():
			print("no wants")
			return
		var want: String = pe.wants[0][0]
		d._pick_item(want)
		d._price = int(pe.wants[0][1] * 2)
		var before: int = p.inventory.count("money")
		d._offer()
		print("asked %d -> he says: %s ; opts=%s" % [d._price, d._say, d._opts.map(func(o): return o[0])])
		_shot("d_haggle")
		d._choose(0)
		print("after deal: %s ; money %d -> %d ; still has item=%s" % [d._say, before, p.inventory.count("money"), p.inventory.has(want)])
		d.close()
	if t > 3.0 and not _done.has("approach"):
		_done["approach"] = true
		var c: Node3D = Game.bots[1]
		c.ai.process_mode = Node.PROCESS_MODE_INHERIT
		var off: Vector3 = Vector3(8, 0, 6) - c.position_ground()
		for part in c.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		if c.ai.act:
			c.ai._end_activity()
		c.ai._enter(c.ai.S.IDLE)
		var pe = c.ai._persona()
		if pe.wants.is_empty():
			pe.wants.append(["water", 40])
		c.ai._approach = "job"
		c.ai._approach_at = Game.clock
	if t > 3.0 and t < 14.0 and d.is_open and not _done.has("came"):
		_done["came"] = true
		print("t=%.1f he came up: %s" % [t, d._say])
		_shot("d_approach")
	if t > 14.0:
		get_tree().quit()
