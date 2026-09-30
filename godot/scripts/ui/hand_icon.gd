extends Control
## Centre-screen marks: a faint aiming dot always, and - only when something
## can be grabbed - a small hand a little below it: an open hand over a
## grabbable object, a closed fist while holding it. The hand is just its
## outline (one line round the whole silhouette, see _outline), see-through
## inside and faint, so it never hides what it is over.

## DOT: the dot brighter (pressing keys on the bomb).
enum Mode { HIDDEN, OPEN, CLOSED, DOT }

const LINE := Color(1.0, 0.98, 0.94, 0.55)
const LINE_SHADOW := Color(0.0, 0.0, 0.0, 0.35)
const AIM := Color(1.0, 1.0, 1.0, 0.22)
const AIM_EDGE := Color(0.0, 0.0, 0.0, 0.18)

var mode := Mode.HIDDEN
## The faint dot in the middle (off while a menu is up, or the view is not
## the player's own).
var show_dot := true
var _shown := 0.0     # fade 0..1
var _squeeze := 0.0   # 0 open .. 1 closed, animated
var _bright := 0.0    # the dot brighter over a bomb key
var _cache_k := -1.0
var _cache: Array[PackedVector2Array] = []


func _ready() -> void:
	# Under a CanvasLayer there is no parent Control to stretch to: size to the
	# viewport ourselves and follow its resizes.
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	get_viewport().size_changed.connect(_fit)
	_fit()


func _fit() -> void:
	position = Vector2.ZERO
	size = get_viewport().get_visible_rect().size
	queue_redraw()


func set_mode(m: Mode) -> void:
	if m != mode:
		mode = m
		queue_redraw()


func set_dot(on: bool) -> void:
	if on != show_dot:
		show_dot = on
		queue_redraw()


func _process(delta: float) -> void:
	var shown_t := 1.0 if mode == Mode.OPEN or mode == Mode.CLOSED else 0.0
	var squeeze_t := 1.0 if mode == Mode.CLOSED else 0.0
	var bright_t := 1.0 if mode == Mode.DOT else 0.0
	var was := Vector3(_shown, _squeeze, _bright)
	_shown = move_toward(_shown, shown_t, delta * 8.0)
	_squeeze = move_toward(_squeeze, squeeze_t, delta * 10.0)
	_bright = move_toward(_bright, bright_t, delta * 10.0)
	if Vector3(_shown, _squeeze, _bright) != was:
		queue_redraw()


func _draw() -> void:
	var s := clampf(size.y / 1080.0, 0.6, 2.0)
	var c := size * 0.5
	if show_dot:
		# The aiming point: barely there, a touch brighter over a bomb's keys.
		var r := lerpf(1.6, 2.6, _bright) * s
		draw_circle(c, r + 0.8 * s, Color(AIM_EDGE, AIM_EDGE.a + 0.4 * _bright), true, -1.0, true)
		draw_circle(c, r, Color(AIM, lerpf(AIM.a, 0.95, _bright)), true, -1.0, true)
	if _shown <= 0.01:
		return
	var hs := s * 0.62 * (1.0 - 0.06 * _squeeze)
	var at := c + Vector2(0, 58.0 * s)
	var k := snappedf(_squeeze, 0.05)
	if k != _cache_k:
		_cache_k = k
		_cache = _outline(k)
	var a := _shown
	for poly in _cache:
		var pts := PackedVector2Array()
		for p in poly:
			pts.append(at + p * hs)
		pts.append(pts[0])
		draw_polyline(pts, Color(LINE_SHADOW, LINE_SHADOW.a * a), 3.2 * s, true)
		draw_polyline(pts, Color(LINE, LINE.a * a), 1.4 * s, true)


## The hand's silhouette (unit scale, centred) as one outline: palm, four
## fingers and the thumb merged into a single shape, so only its edge is drawn.
func _outline(k: float) -> Array[PackedVector2Array]:
	var parts: Array[PackedVector2Array] = []
	parts.append(PackedVector2Array([Vector2(-10, -4), Vector2(10, -4), Vector2(10, 12), Vector2(-10, 12)]))
	parts.append(_capsule(Vector2(-7, 12), Vector2(7, 12), 3.5))
	var xs := [-7.5, -2.5, 2.5, 7.5]
	var lens := [13.0, 16.0, 15.0, 11.0]
	for i in 4:
		var base := Vector2(xs[i], -3)
		var length: float = lens[i] * lerpf(1.0, 0.28, k)
		parts.append(_capsule(base, base + Vector2(0, -length), 2.3))
	parts.append(_capsule(Vector2(-9, 8), Vector2(-19, -2).lerp(Vector2(-1, 3), k), 2.6))
	# Union them one by one into the running outline.
	var shape := parts[0]
	for i in range(1, parts.size()):
		var m := Geometry2D.merge_polygons(shape, parts[i])
		var best := shape
		var best_area := -1.0
		for poly in m:
			# (the outer edge is the biggest; any holes are smaller)
			var area := absf(_area(poly))
			if area > best_area:
				best_area = area
				best = poly
		shape = best
	var out: Array[PackedVector2Array] = [shape]
	return out


func _area(poly: PackedVector2Array) -> float:
	var a := 0.0
	for i in poly.size():
		var p := poly[i]
		var q := poly[(i + 1) % poly.size()]
		a += p.x * q.y - q.x * p.y
	return a * 0.5


func _capsule(a: Vector2, b: Vector2, r: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	var d := b - a
	var ang := atan2(d.y, d.x) if d.length() > 0.001 else 0.0
	for i in 9:
		var t := ang + PI * 0.5 + PI * i / 8.0
		pts.append(a + Vector2(cos(t), sin(t)) * r)
	for i in 9:
		var t := ang - PI * 0.5 + PI * i / 8.0
		pts.append(b + Vector2(cos(t), sin(t)) * r)
	return pts
