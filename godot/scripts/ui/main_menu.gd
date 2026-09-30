extends Node3D
## The main menu: the real place at night - fog in the street, a street lamp
## that flickers and buzzes, rain, the camera drifting slowly past the
## abandoned building - and over it the title, heavy and red, and the menu:
## play, settings (sound, mouse, full screen), quit.

const MapBuilder = preload("res://scripts/world/map_builder.gd")

const PATH := [Vector3(-14.0, 1.5, 4.0), Vector3(-4.0, 1.7, 2.5), Vector3(6.0, 1.5, 3.5), Vector3(14.0, 1.8, 1.0)]
const LOOK := Vector3(0.0, 2.5, -14.0)

var _cam: Camera3D
var _t := 0.0
var _lamp: OmniLight3D
var _lamp2: OmniLight3D
var _title: Label
var _buttons: VBoxContainer
var _settings: PanelContainer
var _drone: AudioStreamPlayer
var _flicker := 0.0


func _ready() -> void:
	Game.reset()
	Game.apply_quality()
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_world()
	_ui()
	_sound()
	# (Blood.exe -- --play: straight into the game)
	if "--play" in OS.get_cmdline_user_args():
		_play.call_deferred()


func _world() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.015, 0.018, 0.025)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.08, 0.09, 0.12)
	env.ambient_light_energy = 0.6
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.1
	env.volumetric_fog_enabled = true
	env.volumetric_fog_density = 0.045
	env.volumetric_fog_albedo = Color(0.55, 0.58, 0.65)
	env.volumetric_fog_emission = Color(0.01, 0.012, 0.018)
	env.glow_enabled = true
	env.glow_intensity = 0.6
	env.glow_bloom = 0.08
	env.adjustment_enabled = true
	env.adjustment_saturation = 0.7
	env.adjustment_contrast = 1.12
	if Game.quality == 0:
		# Weak machine: plain fog instead of the volumetric, no glow.
		env.volumetric_fog_enabled = false
		env.fog_enabled = true
		env.fog_light_color = Color(0.05, 0.055, 0.07)
		env.fog_density = 0.05
		env.glow_enabled = false
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	# Cold moonlight, barely there.
	var moon := DirectionalLight3D.new()
	moon.rotation_degrees = Vector3(-35, 40, 0)
	moon.light_color = Color(0.55, 0.65, 0.85)
	moon.light_energy = 0.12
	moon.shadow_enabled = true
	add_child(moon)
	# The place itself.
	var map := MapBuilder.new()
	map.name = "Map"
	add_child(map)
	map.build()
	# Two sodium street lamps, one of them dying.
	_lamp = _street_light(Vector3(-3.0, 4.2, -4.2))
	_lamp2 = _street_light(Vector3(9.0, 4.2, -4.4))
	_lamp2.light_energy = 3.0
	# Rain in front of the camera.
	_cam = Camera3D.new()
	_cam.fov = 58.0
	add_child(_cam)
	_cam.make_current()
	var rain := GPUParticles3D.new()
	rain.amount = 1500
	rain.lifetime = 0.8
	rain.visibility_aabb = AABB(Vector3(-12, -8, -12), Vector3(24, 16, 24))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(9, 0.1, 9)
	pm.direction = Vector3(0.1, -1, 0)
	pm.spread = 3.0
	pm.initial_velocity_min = 14.0
	pm.initial_velocity_max = 17.0
	pm.gravity = Vector3.ZERO
	rain.process_material = pm
	var streak := QuadMesh.new()
	streak.size = Vector2(0.006, 0.35)
	var rm := StandardMaterial3D.new()
	rm.albedo_color = Color(0.7, 0.75, 0.85, 0.25)
	rm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	rm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	rm.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	streak.material = rm
	rain.draw_pass_1 = streak
	rain.position = Vector3(0, 6, -4)
	_cam.add_child(rain)


func _street_light(at: Vector3) -> OmniLight3D:
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.62, 0.3)
	l.light_energy = 4.0
	l.omni_range = 11.0
	l.shadow_enabled = true
	l.light_volumetric_fog_energy = 2.5
	l.position = at
	add_child(l)
	return l


func _ui() -> void:
	var ui := CanvasLayer.new()
	add_child(ui)
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(root)
	# Darkened edges.
	var vig := ColorRect.new()
	vig.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	vig.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = """shader_type canvas_item;
void fragment() {
	float d = distance(UV, vec2(0.5));
	COLOR = vec4(0.0, 0.0, 0.0, smoothstep(0.35, 0.85, d) * 0.9);
}"""
	var sm := ShaderMaterial.new()
	sm.shader = sh
	vig.material = sm
	root.add_child(vig)
	_title = Label.new()
	_title.text = "BLOOD"
	_title.add_theme_font_size_override("font_size", 150)
	_title.add_theme_color_override("font_color", Color(0.55, 0.03, 0.03))
	_title.add_theme_color_override("font_outline_color", Color(0.02, 0.0, 0.0))
	_title.add_theme_constant_override("outline_size", 18)
	_title.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_title.add_theme_constant_override("shadow_offset_x", 6)
	_title.add_theme_constant_override("shadow_offset_y", 8)
	_title.position = Vector2(90, 70)
	root.add_child(_title)
	var sub := Label.new()
	sub.text = "никто отсюда не уходит чистым"
	sub.add_theme_font_size_override("font_size", 22)
	sub.add_theme_color_override("font_color", Color(0.6, 0.58, 0.55, 0.8))
	sub.position = Vector2(100, 255)
	root.add_child(sub)
	_buttons = VBoxContainer.new()
	_buttons.position = Vector2(100, 360)
	_buttons.add_theme_constant_override("separation", 14)
	root.add_child(_buttons)
	for b in [["ИГРАТЬ", _play], ["МУЛЬТИПЛЕЕР", _toggle_mp], ["НАСТРОЙКИ", _toggle_settings], ["ВЫХОД", func(): get_tree().quit()]]:
		_buttons.add_child(_button(b[0], b[1]))
	_settings = _settings_panel()
	_settings.visible = false
	root.add_child(_settings)
	_mp = _mp_panel()
	_mp.visible = false
	root.add_child(_mp)
	Net.lobby_changed.connect(_mp_refresh)
	Net.found_changed.connect(_mp_refresh)


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.add_theme_font_size_override("font_size", 38)
	b.add_theme_color_override("font_color", Color(0.72, 0.7, 0.66))
	b.add_theme_color_override("font_hover_color", Color(0.8, 0.08, 0.06))
	b.add_theme_color_override("font_pressed_color", Color(0.5, 0.02, 0.02))
	b.add_theme_color_override("font_focus_color", Color(0.72, 0.7, 0.66))
	b.pressed.connect(cb)
	b.mouse_entered.connect(func(): _tick_sound())
	return b


func _settings_panel() -> PanelContainer:
	return preload("res://scripts/ui/settings_panel.gd").build()


func _toggle_settings() -> void:
	_settings.visible = not _settings.visible
	_mp.visible = false


# --- Multiplayer ---------------------------------------------------------------------------

var _mp: PanelContainer
var _mp_status: Label
var _mp_list: VBoxContainer
var _mp_members: VBoxContainer
var _mp_start: Button
var _mp_ip: LineEdit


func _toggle_mp() -> void:
	_mp.visible = not _mp.visible
	_settings.visible = false
	if _mp.visible and Net.steam_ok and not Net.active:
		Net.refresh()
	_mp_refresh()


func _small_button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", 18)
	b.pressed.connect(cb)
	return b


func _mp_panel() -> PanelContainer:
	var p := PanelContainer.new()
	p.position = Vector2(480, 330)
	p.custom_minimum_size = Vector2(560, 420)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.03, 0.03, 0.035, 0.9)
	sb.border_color = Color(0.35, 0.06, 0.05)
	sb.set_border_width_all(1)
	sb.set_content_margin_all(20)
	p.add_theme_stylebox_override("panel", sb)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	p.add_child(v)
	var title := Label.new()
	title.text = "МУЛЬТИПЛЕЕР (Steam P2P)"
	title.add_theme_font_size_override("font_size", 24)
	title.add_theme_color_override("font_color", Color(0.85, 0.8, 0.72))
	v.add_child(title)
	_mp_status = Label.new()
	_mp_status.add_theme_font_size_override("font_size", 16)
	_mp_status.add_theme_color_override("font_color", Color(0.7, 0.68, 0.64))
	v.add_child(_mp_status)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.add_child(_small_button("Создать лобби", func(): Net.host_lobby()))
	row.add_child(_small_button("Обновить список", func(): Net.refresh()))
	row.add_child(_small_button("Выйти из лобби", func(): Net.leave()))
	v.add_child(row)
	var l1 := Label.new()
	l1.text = "Лобби:"
	l1.add_theme_font_size_override("font_size", 17)
	v.add_child(l1)
	_mp_list = VBoxContainer.new()
	v.add_child(_mp_list)
	var l2 := Label.new()
	l2.text = "В лобби:"
	l2.add_theme_font_size_override("font_size", 17)
	v.add_child(l2)
	_mp_members = VBoxContainer.new()
	v.add_child(_mp_members)
	_mp_start = _small_button("ГОТОВ - НАЧАТЬ", func(): Net.start_match())
	_mp_start.add_theme_font_size_override("font_size", 22)
	v.add_child(_mp_start)
	# Two copies on one PC (Steam cannot join its own account's lobby): LAN.
	var lan := HBoxContainer.new()
	lan.add_theme_constant_override("separation", 8)
	lan.add_child(_small_button("LAN: хост", func(): Net.host_lan()))
	_mp_ip = LineEdit.new()
	_mp_ip.text = "127.0.0.1"
	_mp_ip.custom_minimum_size = Vector2(140, 0)
	lan.add_child(_mp_ip)
	lan.add_child(_small_button("LAN: подключиться", func(): Net.join_lan(_mp_ip.text)))
	v.add_child(lan)
	return p


func _mp_refresh() -> void:
	if _mp == null:
		return
	_mp_status.text = Net.status if Net.status != "" else ("Steam: " + Net.my_name if Net.steam_ok else "Steam не запущен - доступен только LAN")
	for c in _mp_list.get_children():
		c.queue_free()
	if not Net.active:
		for f in Net.found:
			var info: Dictionary = f
			var r := HBoxContainer.new()
			var lb := Label.new()
			lb.text = "%s   (%d/%d)" % [info.get("name", "?"), int(info.get("players", 0)), Net.MAX_PLAYERS]
			lb.custom_minimum_size = Vector2(320, 0)
			lb.add_theme_font_size_override("font_size", 17)
			r.add_child(lb)
			r.add_child(_small_button("Подключиться", func(): Net.join_lobby(int(info["id"]))))
			_mp_list.add_child(r)
		if Net.found.is_empty():
			var none := Label.new()
			none.text = "   нет открытых лобби"
			none.add_theme_color_override("font_color", Color(0.55, 0.53, 0.5))
			_mp_list.add_child(none)
	for c in _mp_members.get_children():
		c.queue_free()
	for id in Net.members:
		var m := Label.new()
		m.text = "   " + String(Net.members[id].get("name", "?")) + ("  (хост)" if int(id) == 1 else "")
		m.add_theme_font_size_override("font_size", 17)
		_mp_members.add_child(m)
	_mp_start.visible = Net.active and Net.is_host
	_mp_start.disabled = Net.members.size() < 1


func _play() -> void:
	# Black, then the game.
	var fade := ColorRect.new()
	fade.color = Color(0, 0, 0, 0)
	fade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_title.get_parent().add_child(fade)
	var tw := create_tween()
	tw.tween_property(fade, "color:a", 1.0, 0.6)
	tw.parallel().tween_property(_drone, "volume_db", -60.0, 0.6)
	tw.tween_callback(func(): get_tree().change_scene_to_file("res://scenes/main.tscn"))


func _sound() -> void:
	# A low wind and the lamp's hum, made here (no recording needed).
	var rate := 22050
	var n := rate * 6
	var data := PackedByteArray()
	data.resize(n * 2)
	var b0 := 0.0
	var b1 := 0.0
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for i in n:
		var w := rng.randf_range(-1.0, 1.0)
		b0 = b0 * 0.995 + w * 0.02            # brown-ish wind
		b1 = b1 * 0.9 + b0 * 0.1
		var t := float(i) / rate
		var gust := 0.6 + 0.4 * sin(TAU * t / 6.0) * sin(TAU * t / 2.0 + 1.0)
		var hum := sin(TAU * 100.0 * t) * 0.02 + sin(TAU * 200.0 * t) * 0.008
		var v := clampf(b1 * 5.0 * gust + hum, -1.0, 1.0)
		data.encode_s16(i * 2, int(v * 22000.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = rate
	wav.data = data
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_end = n
	_drone = AudioStreamPlayer.new()
	_drone.stream = wav
	_drone.volume_db = -8.0
	add_child(_drone)
	_drone.play()


func _tick_sound() -> void:
	Game.play_3d(preload("res://scripts/audio/sfx.gd").get_stream(&"key_press"), _cam.global_position, -12.0, 0.1, 1.0)


func _process(delta: float) -> void:
	_t += delta
	# The camera drifting along the street and back, very slowly.
	var u := (sin(_t * 0.035 - PI * 0.5) * 0.5 + 0.5) * (PATH.size() - 1)
	var i := mini(int(u), PATH.size() - 2)
	var pos: Vector3 = (PATH[i] as Vector3).lerp(PATH[i + 1], smoothstep(0.0, 1.0, u - i))
	_cam.global_position = pos + Vector3(0, sin(_t * 0.7) * 0.03, 0)
	_cam.look_at(LOOK + Vector3(sin(_t * 0.11) * 2.0, 0, 0))
	# The dying lamp.
	_flicker -= delta
	if _flicker <= 0.0:
		_flicker = randf_range(0.03, 0.4)
		_lamp.light_energy = 4.0 if randf() < 0.75 else randf_range(0.0, 1.0)
	# The title shudders now and then.
	_title.position = Vector2(90, 70) + (Vector2(randf_range(-3, 3), randf_range(-2, 2)) if randf() < 0.03 else Vector2.ZERO)
