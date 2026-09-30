extends Node
## Dev test: the crafting screen - the pipe bomb put together step by step
## (the mouse simulated), a screenshot of each step, then it is put down.
## Usage: godot --path . res://tests/craft_test.tscn -- <out_dir>
var t := -3.0
var out := "user://"
var _done := {}
var _c
var _ang := 0.0
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
func _shot(n: String) -> void:
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, n])
func _mv(p: Vector2) -> void:
	var e := InputEventMouseMotion.new()
	e.position = p
	_c._motion(e)
func _process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.main == null or Game.main.weather == null:
		return
	if not _done.has("open"):
		_done["open"] = true
		for id in ["pipe", "powder", "clock", "wires", "tape"]:
			p.inventory.add(id, 1)
		_c = p._craft_ui
		_c.toggle()
		return
	if t > 0.5 and not _done.has("s0"):
		_done["s0"] = true
		_shot("c0_list")
		_c._press(_c._button_rect().get_center())
		_c._press(_c._bag)
		_mv(_c._mouth())
	if t > 1.3 and not _done.has("s0b"):
		_done["s0b"] = true
		_shot("c1_powder")
	if _c._step == 1:
		if not _done.has("s1"):
			_done["s1"] = true
			_c._release(Vector2.ZERO)
			_c._press(Vector2.ZERO)
		var cc: Vector2 = _c._terminal("red") - Vector2(30, 0)
		_ang += 0.4
		_mv(cc + Vector2(cos(_ang), sin(_ang)) * 60.0)
	if _c._step == 2 and not _done.has("s2"):
		_done["s2"] = true
		_c._release(Vector2.ZERO)
		_shot("c2_cap")
		_c._press(_c._clock_c() + Vector2(0, -40))
		_mv(_c._clock_c() + Vector2(50, 20))
		_c._release(Vector2.ZERO)
		_shot("c3_clock")
		_c._press(_c._button_rect().get_center())
	if _c._step == 3 and not _done.has("s3"):
		_done["s3"] = true
		for col in ["red", "black"]:
			_c._press(_c._clock_pin(col) + Vector2(0, 30))
			_mv(_c._terminal(col))
			_c._release(_c._terminal(col))
	if _c._step == 4:
		if not _done.has("s4"):
			_done["s4"] = true
			_shot("c4_wires")
			_c._press(Vector2.ZERO)
		var cc2: Vector2 = _c._pipe_rect().get_center()
		_ang += 0.4
		_mv(cc2 + Vector2(cos(_ang), sin(_ang)) * 120.0)
	if _c._step == -1 and _done.has("s4") and not _done.has("end"):
		_done["end"] = true
		_c._release(Vector2.ZERO)
		print("crafted: ", p.inventory.count("pipe_bomb"), " items=", p.inventory.items.filter(func(i): return i["id"] == "pipe_bomb"))
		_shot("c5_done")
		get_tree().quit()
	if t > 20.0:
		print("timeout step=", _c._step)
		get_tree().quit()
