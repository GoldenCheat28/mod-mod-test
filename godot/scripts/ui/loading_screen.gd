extends CanvasLayer
## Shown while the level is put together (main.gd): the title, what is being
## done now, a bar filling up, a hint at the bottom - over black, the rain
## and a flicker of the title as in the menu. Fades out when it is done.

const TIPS := [
	"R зажать с револьвером - один патрон и прокрутить барабан.",
	"C - блокнот с чертежами: собирай руками, шаг за шагом.",
	"F на стуле или диване - сесть. F на кровати - поспать.",
	"Alt - держать оружие иначе. Alt дважды - руки на место.",
	"Не крась людей из баллончика. Им это не нравится.",
	"Ночью в дождь все сидят в заброшке.",
	"Торговец в гаражах: скотч, провода, стволы - за деньги.",
	"Q - обмякнуть. Встать - ещё раз Q.",
]

var progress := 0.0
var status := ""
var _shown := 0.0
var _root: Control
var _title: Label
var _status: Label
var _tip: Label
var _bar_bg: ColorRect
var _bar: ColorRect
var _fade: ColorRect
var _closing := false
var _t := 0.0


func _ready() -> void:
	layer = 100
	process_mode = Node.PROCESS_MODE_ALWAYS
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	var bg := ColorRect.new()
	bg.color = Color(0.012, 0.012, 0.015)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(bg)
	var rain := ColorRect.new()
	rain.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	rain.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = """shader_type canvas_item;
uniform float t;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void fragment() {
	vec2 uv = UV * vec2(80.0, 1.0);
	float col = floor(uv.x);
	float speed = 0.6 + hash(vec2(col, 1.0)) * 0.8;
	float y = fract(UV.y * 1.5 - t * speed + hash(vec2(col, 7.0)));
	float streak = smoothstep(0.0, 0.06, y) * (1.0 - smoothstep(0.06, 0.12, y)) * step(0.8, hash(vec2(col, 3.0)));
	float x = abs(fract(uv.x) - 0.5);
	float v = streak * step(x, 0.04) * 0.12;
	float d = distance(UV, vec2(0.5));
	COLOR = vec4(vec3(0.7, 0.75, 0.85), v + smoothstep(0.4, 0.9, d) * 0.0);
}"""
	var sm := ShaderMaterial.new()
	sm.shader = sh
	rain.material = sm
	_root.add_child(rain)
	_title = Label.new()
	_title.text = "BLOOD"
	_title.add_theme_font_size_override("font_size", 120)
	_title.add_theme_color_override("font_color", Color(0.55, 0.03, 0.03))
	_title.add_theme_color_override("font_outline_color", Color(0.02, 0.0, 0.0))
	_title.add_theme_constant_override("outline_size", 14)
	_title.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_title.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_title.offset_top = -180
	_title.offset_bottom = -180
	_root.add_child(_title)
	_status = Label.new()
	_status.add_theme_font_size_override("font_size", 20)
	_status.add_theme_color_override("font_color", Color(0.72, 0.7, 0.66))
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_status.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_status.position = Vector2(-400, 20)
	_status.size = Vector2(800, 30)
	_root.add_child(_status)
	_bar_bg = ColorRect.new()
	_bar_bg.color = Color(0.2, 0.2, 0.2, 0.6)
	_bar_bg.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_bar_bg.position = Vector2(-260, 64)
	_bar_bg.size = Vector2(520, 3)
	_root.add_child(_bar_bg)
	_bar = ColorRect.new()
	_bar.color = Color(0.75, 0.08, 0.06)
	_bar.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_bar.position = Vector2(-260, 63)
	_bar.size = Vector2(0, 5)
	_root.add_child(_bar)
	_tip = Label.new()
	_tip.text = TIPS[randi() % TIPS.size()]
	_tip.add_theme_font_size_override("font_size", 17)
	_tip.add_theme_color_override("font_color", Color(0.55, 0.53, 0.5))
	_tip.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_tip.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	_tip.position = Vector2(-500, -80)
	_tip.size = Vector2(1000, 30)
	_root.add_child(_tip)
	rain.set_meta("mat", sm)
	set_meta("rain", sm)


## What it is doing now, and how far along it all is (0..1).
func step(text: String, k: float) -> void:
	status = text
	progress = maxf(progress, k)
	if _status:
		_status.text = text + "..."


## Done: the bar full, then it fades away and goes.
func finish() -> void:
	progress = 1.0
	_closing = true


func _process(delta: float) -> void:
	_t += delta
	(get_meta("rain") as ShaderMaterial).set_shader_parameter("t", _t)
	_bar.size.x = lerpf(_bar.size.x, 520.0 * progress, minf(delta * 8.0, 1.0))
	var jolt := Vector2(randf_range(-3, 3), randf_range(-2, 2)) if randf() < 0.04 else Vector2.ZERO
	_title.offset_left = jolt.x
	_title.offset_right = jolt.x
	_title.offset_top = -180 + jolt.y
	_title.offset_bottom = -180 + jolt.y
	_title.modulate.a = 0.85 + 0.15 * sin(_t * 1.3)
	if _closing and _bar.size.x > 510.0:
		_root.modulate.a = move_toward(_root.modulate.a, 0.0, delta * 2.0)
		if _root.modulate.a <= 0.0:
			queue_free()
