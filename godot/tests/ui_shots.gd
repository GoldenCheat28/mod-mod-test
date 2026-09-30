extends Node
## Dev test: screenshots of the UI - the crafting notebook (choosing, and a
## few steps in), the radial menu, the grab hand, the body cam look.
## Usage: godot --path . res://tests/ui_shots.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	if OS.get_environment("BODYCAM") != "":
		Game.bodycam = true
		Game.apply_bodycam_audio()
	add_child(load("res://scenes/main.tscn").instantiate())


func _shot(name: String) -> void:
	var img := get_viewport().get_texture().get_image()
	img.save_png("%s/%s.png" % [out, name])
	print("saved ", name)


func _once(k: String, at: float) -> bool:
	if t < at or _done.has(k):
		return false
	_done[k] = true
	return true


func _process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null:
		return
	if _once("win", 0.5):
		get_window().size = Vector2i(1600, 900)
	if t < 4.0:
		p.global_position = Vector3(-2, 0.3, -12)
		p.yaw = PI * 0.5
		p.pitch = -0.1
	if _once("view", 4.0):
		_shot("ui_view")
	if _once("craft", 4.5):
		for id in ["pipe", "powder", "clock", "tape", "cloth", "cloth", "alcohol"]:
			p.inventory.add(id, 1)
		p.inventory.add("wires", 5)
		p._craft_ui.toggle()
	if _once("craft_shot", 5.5):
		_shot("ui_craft_index")
		p._craft_ui._begin()
		p._craft_ui._step = 3
		p._craft_ui._start_step()
		p._craft_ui._wire_done[0] = true
		p._craft_ui._wire_end[0] = p._craft_ui._terminal(0)
		p._craft_ui._wire_end[2] = p._craft_ui._terminal(1) + Vector2(-40, 30)
	if _once("craft_wires", 6.0):
		_shot("ui_craft_wires")
		p._craft_ui._step = 4
		p._craft_ui._start_step()
		p._craft_ui._p = 0.55
		p._craft_ui._turns = 1.65
	if _once("craft_tape", 6.5):
		_shot("ui_craft_tape")
		p._craft_ui._step = -1
		p._craft_ui._sel = 2
		p._craft_ui._begin()
	if _once("craft_bandage", 7.0):
		_shot("ui_craft_bandage")
		p._craft_ui.toggle()
	if _once("radial", 7.5):
		p._radial.open(["Сигарета", "Косяк", "Пистолет", "Дробовик", "АКМ", "Манекен", "Граната", "Бомба", "Бинт",
				"Наручники", "Бензопила", "Мачете", "Рулетка", "Баллончик"] as Array[String])
		p._radial.feed(Vector2(40, 160))
	if _once("radial_shot", 8.2):
		_shot("ui_radial")
		p._radial.close()
		p._hand.set_mode(p.HandIcon.Mode.OPEN)
	if t > 8.2:
		p._hand.set_mode(p.HandIcon.Mode.OPEN)
	if _once("hand", 8.8):
		_shot("ui_hand")
	if t > 9.5:
		get_tree().quit()
