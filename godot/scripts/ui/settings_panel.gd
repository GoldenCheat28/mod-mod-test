extends RefCounted
## The settings (sound, mouse, graphics, screen, bodycam): one panel, the
## same in the main menu and in the pause menu (Esc) in the game.

static func build() -> PanelContainer:
	var p := PanelContainer.new()
	p.position = Vector2(480, 360)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.03, 0.03, 0.035, 0.88)
	sb.border_color = Color(0.35, 0.06, 0.05)
	sb.set_border_width_all(1)
	sb.set_content_margin_all(22)
	p.add_theme_stylebox_override("panel", sb)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	p.add_child(v)
	var add_slider := func(label: String, value: float, lo: float, hi: float, cb: Callable) -> void:
		var l := Label.new()
		l.text = label
		l.add_theme_font_size_override("font_size", 20)
		l.add_theme_color_override("font_color", Color(0.75, 0.72, 0.68))
		v.add_child(l)
		var s := HSlider.new()
		s.min_value = lo
		s.max_value = hi
		s.step = 0.01
		s.value = value
		s.custom_minimum_size = Vector2(320, 24)
		s.value_changed.connect(cb)
		v.add_child(s)
	add_slider.call("Громкость", db_to_linear(AudioServer.get_bus_volume_db(0)), 0.0, 1.0, func(x: float):
		AudioServer.set_bus_volume_db(0, linear_to_db(maxf(x, 0.001)))
		Game.save_settings())
	add_slider.call("Чувствительность мыши", Game.mouse_sens, 0.2, 3.0, func(x: float):
		Game.mouse_sens = x
		Game.save_settings())
	var gl := Label.new()
	gl.text = "Графика"
	gl.add_theme_font_size_override("font_size", 20)
	gl.add_theme_color_override("font_color", Color(0.75, 0.72, 0.68))
	v.add_child(gl)
	var ob := OptionButton.new()
	for t in ["Авто", "Низкая (слабый ПК)", "Средняя", "Высокая"]:
		ob.add_item(t)
	ob.selected = Game.quality_setting + 1
	ob.add_theme_font_size_override("font_size", 18)
	ob.item_selected.connect(func(i: int):
		Game.quality_setting = i - 1
		Game.quality = 1 if i == 0 else i - 1
		Game.apply_quality()
		Game.save_settings())
	v.add_child(ob)
	var al := Label.new()
	al.text = "Сглаживание"
	al.add_theme_font_size_override("font_size", 20)
	al.add_theme_color_override("font_color", Color(0.75, 0.72, 0.68))
	v.add_child(al)
	var ab := OptionButton.new()
	for t in Game.AA_NAMES:
		ab.add_item(t)
	ab.selected = Game.aa
	ab.add_theme_font_size_override("font_size", 18)
	ab.item_selected.connect(func(i: int):
		Game.aa = i
		Game.apply_aa()
		Game.save_settings())
	v.add_child(ab)
	var fp := CheckButton.new()
	fp.text = "Быстрая физика (больше FPS с толпой)"
	fp.tooltip_text = "Физика 90 раз в секунду вместо 120: люди обходятся процессору на четверть дешевле, держатся на ногах чуть менее твёрдо."
	fp.add_theme_font_size_override("font_size", 20)
	fp.button_pressed = Game.fast_physics
	fp.toggled.connect(func(on: bool):
		Game.fast_physics = on
		Game.apply_physics_rate()
		Game.save_settings())
	v.add_child(fp)
	var fs := CheckButton.new()
	fs.text = "Полный экран"
	fs.add_theme_font_size_override("font_size", 20)
	fs.button_pressed = DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN
	fs.toggled.connect(func(on: bool):
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if on else DisplayServer.WINDOW_MODE_WINDOWED)
		Game.save_settings())
	v.add_child(fs)
	var vs := CheckButton.new()
	vs.text = "Вертикальная синхронизация"
	vs.add_theme_font_size_override("font_size", 20)
	vs.button_pressed = Game.vsync
	vs.toggled.connect(func(on: bool):
		Game.vsync = on
		Game.apply_vsync()
		Game.save_settings())
	v.add_child(vs)
	var bc := CheckButton.new()
	bc.text = "Бодикамера (линза, шум, REC)"
	bc.add_theme_font_size_override("font_size", 20)
	bc.button_pressed = Game.bodycam
	bc.toggled.connect(func(on: bool):
		Game.bodycam = on
		Game.apply_bodycam_audio()
		Game.save_settings())
	v.add_child(bc)
	return p
