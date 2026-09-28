extends Control
## Centre-screen hand shown only when something can be grabbed: an open hand
## over a grabbable object, a closed fist while holding it. Drawn with
## primitives so it stays crisp at any resolution.

enum Mode { HIDDEN, OPEN, CLOSED }

const FILL := Color(0.95, 0.95, 0.93, 0.9)
const EDGE := Color(0.05, 0.05, 0.05, 0.55)

var mode := Mode.HIDDEN
var _shown := 0.0     # fade 0..1
var _squeeze := 0.0   # 0 open .. 1 closed, animated


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func set_mode(m: Mode) -> void:
	mode = m


func _process(delta: float) -> void:
	var shown_t := 0.0 if mode == Mode.HIDDEN else 1.0
	var squeeze_t := 1.0 if mode == Mode.CLOSED else 0.0
	var was := Vector2(_shown, _squeeze)
	_shown = move_toward(_shown, shown_t, delta * 8.0)
	_squeeze = move_toward(_squeeze, squeeze_t, delta * 10.0)
	if Vector2(_shown, _squeeze) != was:
		queue_redraw()


func _draw() -> void:
	if _shown <= 0.01:
		return
	var s := clampf(size.y / 1080.0, 0.6, 2.0) * 0.9
	var c := size * 0.5
	var a := _shown
	# Outline pass then fill pass.
	_hand(c, s * (1.0 - 0.06 * _squeeze), 2.2 * s, Color(EDGE, EDGE.a * a))
	_hand(c, s * (1.0 - 0.06 * _squeeze), 0.0, Color(FILL, FILL.a * a))


func _capsule(a: Vector2, b: Vector2, r: float, col: Color) -> void:
	draw_line(a, b, col, r * 2.0, true)
	draw_circle(a, r, col, true, -1.0, true)
	draw_circle(b, r, col, true, -1.0, true)


func _hand(c: Vector2, s: float, grow: float, col: Color) -> void:
	var k := _squeeze
	# Palm.
	var palm := Rect2(c + Vector2(-10, -4) * s - Vector2(grow, grow), Vector2(20, 18) * s + Vector2(grow, grow) * 2.0)
	draw_rect(palm, col, true, -1.0, true)
	_capsule(c + Vector2(-7, 12) * s, c + Vector2(7, 12) * s, 3.5 * s + grow, col)
	# Four fingers: straight up when open, curled into knuckles when closed.
	var xs := [-7.5, -2.5, 2.5, 7.5]
	var lens := [13.0, 16.0, 15.0, 11.0]
	for i in 4:
		var base := c + Vector2(xs[i], -4) * s
		var length: float = lens[i] * lerpf(1.0, 0.28, k)
		var tip := base + Vector2(0, -length) * s
		_capsule(base, tip, 2.3 * s + grow, col)
	# Thumb: out to the side when open, tucked across the fist when closed.
	var t0 := c + Vector2(-9, 8) * s
	var t_open := c + Vector2(-19, -2) * s
	var t_closed := c + Vector2(-1, 3) * s
	_capsule(t0, t_open.lerp(t_closed, k), 2.6 * s + grow, col)
