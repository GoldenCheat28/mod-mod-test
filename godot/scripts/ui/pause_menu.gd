extends CanvasLayer
## Esc in the game: everything stops (in a game alone), and a menu comes up
## over it - go on, the settings, back to the main menu, or quit.

var _root: Control
var _settings: PanelContainer
var _open := false


func _ready() -> void:
	layer = 120
	process_mode = Node.PROCESS_MODE_ALWAYS
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.visible = false
	add_child(_root)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.62)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.add_child(dim)
	var title := Label.new()
	title.text = "ПАУЗА"
	title.add_theme_font_size_override("font_size", 64)
	title.add_theme_color_override("font_color", Color(0.72, 0.7, 0.66))
	title.position = Vector2(100, 110)
	_root.add_child(title)
	var buttons := VBoxContainer.new()
	buttons.position = Vector2(100, 240)
	buttons.add_theme_constant_override("separation", 12)
	_root.add_child(buttons)
	for b in [["ПРОДОЛЖИТЬ", close], ["НАСТРОЙКИ", func(): _settings.visible = not _settings.visible],
			["ГЛАВНОЕ МЕНЮ", _to_menu], ["ВЫХОД", func(): get_tree().quit()]]:
		buttons.add_child(_button(b[0], b[1]))
	_settings = preload("res://scripts/ui/settings_panel.gd").build()
	_settings.position = Vector2(480, 240)
	_settings.visible = false
	_root.add_child(_settings)


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.add_theme_font_size_override("font_size", 34)
	b.add_theme_color_override("font_color", Color(0.72, 0.7, 0.66))
	b.add_theme_color_override("font_hover_color", Color(0.8, 0.08, 0.06))
	b.add_theme_color_override("font_pressed_color", Color(0.5, 0.02, 0.02))
	b.add_theme_color_override("font_focus_color", Color(0.72, 0.7, 0.66))
	b.pressed.connect(cb)
	return b


func is_open() -> bool:
	return _open


func _input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_ESCAPE):
		return
	if _open:
		if _settings.visible:
			_settings.visible = false
		else:
			close()
		get_viewport().set_input_as_handled()
		return
	# (Esc first closes whatever else is open: the bag, a talk, the shop...)
	var p = Game.player
	if p and is_instance_valid(p) and "_inv_ui" in p and p._inv_ui != null and (p._inv_ui.is_open or p._craft_ui.is_open
			or p.bench != null or (p._shop_ui != null and p._shop_ui.is_open) or (p._trade_ui != null and p._trade_ui.is_open) or (p._dialog_ui != null and p._dialog_ui.is_open)):
		return
	open()
	get_viewport().set_input_as_handled()


func open() -> void:
	_open = true
	_root.visible = true
	_settings.visible = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if not Net.active:
		get_tree().paused = true


func close() -> void:
	_open = false
	_root.visible = false
	get_tree().paused = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _to_menu() -> void:
	get_tree().paused = false
	_open = false
	if Net.active and Net.has_method("leave"):
		Net.leave()
	Engine.time_scale = 1.0
	get_tree().change_scene_to_file("res://scenes/menu.tscn")
