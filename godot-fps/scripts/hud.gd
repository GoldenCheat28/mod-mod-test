extends CanvasLayer

var ammo_label: Label
var hp_label: Label

func _ready() -> void:
	var dot := ColorRect.new()
	dot.color = Color(1, 1, 1, 0.85)
	dot.custom_minimum_size = Vector2(4, 4)
	dot.size = Vector2(4, 4)
	add_child(dot)
	dot.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	ammo_label = _label(Control.PRESET_BOTTOM_RIGHT, Vector2(-24, -20))
	hp_label = _label(Control.PRESET_BOTTOM_LEFT, Vector2(24, -20))

func _label(preset: Control.LayoutPreset, off: Vector2) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", 32)
	l.add_theme_color_override("font_outline_color", Color.BLACK)
	l.add_theme_constant_override("outline_size", 6)
	l.text = "-"
	add_child(l)
	l.grow_horizontal = Control.GROW_DIRECTION_BEGIN if preset == Control.PRESET_BOTTOM_RIGHT else Control.GROW_DIRECTION_END
	l.grow_vertical = Control.GROW_DIRECTION_BEGIN
	l.set_anchors_and_offsets_preset(preset, Control.PRESET_MODE_MINSIZE, 0)
	l.position += off
	return l

func set_ammo(a: int, r: int) -> void:
	ammo_label.text = "%d / %d" % [a, r]

func set_hp(hp: float) -> void:
	hp_label.text = "HP %d" % int(maxf(hp, 0.0))
