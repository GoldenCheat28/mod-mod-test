extends Node
## Dev test: the hands-on making (craft_bench.gd), driven: RECIPE=pipe_bomb
## (default) is made step by step with a scripted pointer; screenshots of
## each step. SETUP=1 only lays each recipe out and photographs it.

var t := -3.0
var b: Node3D
var _phase := 0
var _pt := 0.0
var _shot := 0
var _setup_i := 0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _snap(n: String) -> void:
	get_viewport().get_texture().get_image().save_png("user://bench_%02d_%s.png" % [_shot, n])
	_shot += 1
	print("snap ", n, " step ", b.step if is_instance_valid(b) else -1, " prog ", b.prog if is_instance_valid(b) else 0.0)


func _recipe(id: String) -> Dictionary:
	for r in load("res://scripts/ui/craft_ui.gd").RECIPES:
		if r["id"] == id:
			return r
	return {}


func _process(delta: float) -> void:
	t += delta
	if t > 70.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null:
		return
	if _phase == 0 and t > 1.0:
		p.global_position = Vector3(3.0, 0.2, 12.0)
		for bot in Game.bots:
			bot.ai.process_mode = Node.PROCESS_MODE_DISABLED
		var ids := ["pipe", "powder", "clock", "wires", "tape", "tin_can", "nails", "fuse_cord", "cloth", "alcohol",
				"empty_syringe", "ampoule", "chalk", "sugar", "dye", "herb", "rolling_paper"]
		for id in ids:
			p.inventory.add(id, 6)
		_phase = 1
		_pt = 0.0
		return
	if _phase == 0:
		return
	_pt += delta
	if OS.get_environment("SETUP") != "":
		_setup_tick()
		return
	if OS.get_environment("ALL") != "":
		_all_tick()
		return
	_pipe_tick(p)


func _setup_tick() -> void:
	var ids := ["pipe_bomb", "grenade", "bandage", "syringe", "pills", "joint"]
	if b == null and _setup_i < ids.size() and _pt > 0.5:
		Game.player.start_bench(_recipe(ids[_setup_i]))
		b = Game.player.bench
		_pt = 0.0
	elif b and _pt > 1.8:
		_snap(ids[_setup_i])
		b.cancel()
		b = null
		_setup_i += 1
		_pt = 0.0
	elif _setup_i >= ids.size():
		get_tree().quit()


func _pipe_tick(p) -> void:
	if b == null:
		p.start_bench(_recipe("pipe_bomb"))
		b = p.bench
		_pt = 0.0
		return
	if not is_instance_valid(b):
		get_tree().quit()
		return
	match b.step:
		0:
			# Take the powder, carry it over the open end, tip it.
			if _pt < 1.6:
				return
			if _phase == 1:
				_snap("laid_out")
				b.mouse_override = b._screen(b._obj["powder"].global_position + Vector3.UP * 0.06)
				b._lmb = true
				b._mouse = b.mouse_override
				b._press()
				_phase = 2
			var end: Vector3 = b._obj["pipe"].global_transform * Vector3(0.13, 0.02, 0)
			b.mouse_override = b.mouse_override.lerp(b._screen(end + Vector3.UP * 0.04), 0.1)
			if _pt > 3.0:
				b._rmb = true
			if _phase == 2 and b.prog > 0.5:
				_snap("pouring")
				_phase = 3
		1:
			if _phase == 3:
				b._rmb = false
				b._lmb = false
				b._release()
				_phase = 4
				_pt = 0.0
			if _phase == 4 and _pt > 0.5:
				b.mouse_override = b._screen(b._obj["cap"].global_position)
				b._lmb = true
				b._mouse = b.mouse_override
				b._press()
				_phase = 5
			if _phase == 5:
				var end: Vector3 = b._obj["pipe"].global_transform * Vector3(0.135, 0.0, 0)
				b.mouse_override = b.mouse_override.lerp(b._screen(end), 0.1)
				if b._obj["cap"].has_meta("on"):
					b._lmb = false
					b._release()
					_phase = 6
					_pt = 0.0
			if _phase == 6 and _pt > 0.3:
				b._lmb = true
				b._mouse = b.mouse_override
				b._press()
				_phase = 7
			if _phase == 7:
				var c: Vector2 = b._screen(b._turn_center())
				b.mouse_override = c + Vector2(cos(_pt * 8.0), sin(_pt * 8.0)) * 60.0
				if b.prog > 0.5 and _shot < 3:
					_snap("screwing")
		2:
			if _phase == 7:
				b._lmb = false
				b._release()
				_phase = 8
				_pt = 0.0
			if _phase == 8 and _pt > 0.6:
				var c2: Vector2 = b._screen(b._obj["clock"].global_transform * Vector3(0, 0.05, 0.012))
				b.mouse_override = c2 + Vector2(20, -5)
				b._lmb = true
				b._mouse = b.mouse_override
				b._press()
				_phase = 9
			if _phase == 9 and _pt > 1.2:
				_snap("dial")
				b._lmb = false
				b._space()
				_phase = 10
				_pt = 0.0
		3:
			if _pt < 0.8:
				return
			for w in b._wires:
				if not w["done"]:
					var e: RigidBody3D = w["end"]
					if b._drag == null:
						b.mouse_override = b._screen(e.global_position)
						b._lmb = true
						b._mouse = b.mouse_override
						b._press()
					var cpos: Vector3 = (w["contact"] as Node3D).global_position
					b.mouse_override = b.mouse_override.lerp(b._screen(cpos), 0.15)
					if n_done(b) == 2 and _shot < 5:
						_snap("wires")
					return
		4:
			if b._drag:
				b._lmb = false
				b._release()
			if not b._lmb:
				b._lmb = true
				b._mouse = b.mouse_override
				b._press()
				_pt = 0.0
			var c3: Vector2 = b._screen(b._turn_center())
			b.mouse_override = c3 + Vector2(cos(_pt * 8.0), sin(_pt * 8.0)) * 70.0
			if b.prog > 0.6 and _shot < 6:
				_snap("tape")
		_:
			pass
	if b._finished_t > 0.4 and _shot < 7:
		_snap("done")


func n_done(bb) -> int:
	var n := 0
	for w in bb._wires:
		if w["done"]:
			n += 1
	return n


var _all_i := 0
var _k := 0


## Every recipe run through its steps by calling what each one does
## (not by the pointer): to catch mistakes in the steps' own code.
func _all_tick() -> void:
	var ids := ["grenade", "bandage", "syringe", "pills", "joint"]
	if _all_i >= ids.size():
		get_tree().quit()
		return
	if b == null or not is_instance_valid(b):
		if _pt < 0.5:
			return
		Game.player.start_bench(_recipe(ids[_all_i]))
		b = Game.player.bench
		_pt = 0.0
		_k = 0
		return
	if b._finished_t >= 0.0:
		if _pt > 0.3 and not b._closing:
			_snap(ids[_all_i] + "_done")
			b._closing = true
			_all_i += 1
			b = null
			_pt = 0.0
		return
	if _pt < 0.25:
		return
	_pt = 0.0
	var st: Dictionary = b._cur()
	for k in 5:
		match st["t"]:
			"hold":
				b._pour_hook(0.2 * (k + 1))
			"turn", "tape", "saw", "pull":
				b._turn_hook(0.3, 0.2 * (k + 1))
			"click":
				b._click_hook(b, b.S, k + 1)
			"cuts":
				for i in 3:
					b._cut_mark(i, 0.2 * k)
	if st["t"] == "cuts":
		b._cloth_to_strips()
	if st["t"] == "pull" and b.rid == "grenade":
		for w in b._wires:
			w["done"] = true
	print(ids[_all_i], " step ", b.step, " ", st["t"], " ok")
	_snap("%s_%d" % [ids[_all_i], b.step])
	b._next()
