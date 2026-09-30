extends Control
## Hold-to-open radial menu. While open, mouse motion moves a virtual cursor;
## the sector it points into is highlighted and chosen when the menu closes.
## Leaving the cursor in the middle cancels.

signal chosen(index: int)

## Sized to the screen: most of its height, so every entry has room.
var RADIUS := 300.0
var INNER := 95.0
const DEAD := 45.0

var items: Array[String] = []
var icons := {}                  # entry index -> "wave" / "fuck": a hand drawn above the label
var is_open := false
var _cursor := Vector2.ZERO
var _sel := -1
var _shown := 0.0


func _ready() -> void:
	# Under a CanvasLayer there is no parent Control to stretch to: size to the
	# viewport ourselves and follow its resizes.
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	get_viewport().size_changed.connect(_fit)
	_fit()


func _fit() -> void:
	position = Vector2.ZERO
	size = get_viewport().get_visible_rect().size
	RADIUS = clampf(size.y * 0.4, 200.0, 460.0)
	INNER = RADIUS * 0.3
	queue_redraw()


func open(list: Array[String], icon_map := {}) -> void:
	items = list
	icons = icon_map
	is_open = true
	_cursor = Vector2.ZERO
	_sel = -1
	queue_redraw()


## Closes the menu; returns the chosen index or -1.
func close() -> int:
	is_open = false
	queue_redraw()
	var s := _sel
	if s >= 0:
		chosen.emit(s)
	return s


## The entry the cursor is on now (-1: none).
func selected() -> int:
	return _sel


func feed(rel: Vector2) -> void:
	_cursor = (_cursor + rel).limit_length(RADIUS)
	var s := -1
	if _cursor.length() > DEAD and not items.is_empty():
		var a := fposmod(atan2(_cursor.y, _cursor.x) + PI * 0.5, TAU)
		s = int(a / (TAU / items.size())) % items.size()
	if s != _sel:
		_sel = s
	queue_redraw()


func _process(delta: float) -> void:
	var target := 1.0 if is_open else 0.0
	if _shown != target:
		_shown = move_toward(_shown, target, delta * 9.0)
		queue_redraw()


func _draw() -> void:
	if _shown <= 0.01 or items.is_empty():
		return
	var c := size * 0.5
	var k := _shown
	var n := items.size()
	var step := TAU / n
	var font := ThemeDB.fallback_font
	var ro := RADIUS * k
	var ri := INNER * k
	# One solid ring, the sectors touching: no gaps, no second disc behind it.
	var seg := maxi(96 / n, 6)
	for i in n:
		var a0 := -PI * 0.5 + i * step
		var a1 := a0 + step
		var hot := i == _sel
		var pts := PackedVector2Array()
		var cols := PackedColorArray()
		var outer_col := Color(0.93, 0.36, 0.1, 0.78 * k) if hot else Color(0.1, 0.1, 0.11, 0.72 * k)
		var inner_col := Color(0.62, 0.2, 0.05, 0.78 * k) if hot else Color(0.05, 0.05, 0.06, 0.78 * k)
		for j in seg + 1:
			var a := lerpf(a0, a1, float(j) / seg)
			pts.append(c + Vector2(cos(a), sin(a)) * ro)
			cols.append(outer_col)
		for j in range(seg, -1, -1):
			var a := lerpf(a0, a1, float(j) / seg)
			pts.append(c + Vector2(cos(a), sin(a)) * ri)
			cols.append(inner_col)
		draw_polygon(pts, cols)
	# Hairline dividers between the entries and a thin rim, inside and out.
	for i in n:
		var a := -PI * 0.5 + i * step
		var d := Vector2(cos(a), sin(a))
		draw_line(c + d * ri, c + d * ro, Color(1, 1, 1, 0.07 * k), 1.0, true)
	draw_arc(c, ro, 0.0, TAU, 128, Color(1, 1, 1, 0.12 * k), 1.5, true)
	draw_arc(c, ri, 0.0, TAU, 96, Color(1, 1, 1, 0.1 * k), 1.5, true)
	for i in n:
		var hot := i == _sel
		var mid := -PI * 0.5 + (i + 0.5) * step
		var tp := c + Vector2(cos(mid), sin(mid)) * (RADIUS + INNER) * 0.5 * k
		# As big as fits across the sector.
		var room := minf((RADIUS + INNER) * 0.5 * step * 0.9, (RADIUS - INNER) * 0.95)
		var fs := 24
		var tw := font.get_string_size(items[i], HORIZONTAL_ALIGNMENT_CENTER, -1, fs).x
		while tw > room and fs > 12:
			fs -= 1
			tw = font.get_string_size(items[i], HORIZONTAL_ALIGNMENT_CENTER, -1, fs).x
		if icons.has(i):
			_draw_hand(tp + Vector2(0, -fs * 0.9) * k, String(icons[i]), 1.0 * k, Color(1, 1, 1, (1.0 if hot else 0.78) * k))
			tp += Vector2(0, fs * 0.9) * k
		draw_string_outline(font, tp + Vector2(-tw * 0.5, fs * 0.35), items[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 4,
				Color(0, 0, 0, 0.55 * k))
		draw_string(font, tp + Vector2(-tw * 0.5, fs * 0.35), items[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs,
				Color(1, 1, 1, (1.0 if hot else 0.78) * k))
	draw_circle(c, ri - 1.0, Color(0.03, 0.03, 0.035, 0.55 * k), true, -1.0, true)
	var cancel := "—" if _sel >= 0 else "отмена"
	var cw := font.get_string_size(cancel, HORIZONTAL_ALIGNMENT_CENTER, -1, 16).x
	draw_string(font, c + Vector2(-cw * 0.5, 6), cancel, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color(1, 1, 1, 0.6 * k))
	draw_circle(c + _cursor * k, 4.0, Color(1, 1, 1, 0.9 * k), true, -1.0, true)


## A hand as an icon: an open palm (a wave) or a fist with the middle finger up.
func _draw_hand(c: Vector2, kind: String, k: float, col: Color) -> void:
	var u := 2.2 * k
	var skin := Color(0.93, 0.8, 0.68, col.a)
	var line := Color(0.1, 0.08, 0.07, col.a)
	var rects: Array = []
	# The palm, and the wrist under it.
	rects.append(Rect2(-6, -2, 12, 10))
	rects.append(Rect2(-4, 8, 8, 5))
	if kind == "wave":
		for f in 4:
			var x := -6.0 + f * 3.1
			var h: float = [8.0, 10.0, 9.5, 7.0][f]
			rects.append(Rect2(x, -2 - h, 2.6, h + 1))
		rects.append(Rect2(-10, 0, 5, 2.6))                  # the thumb out to the side
	else:
		for f in 4:
			var x := -6.0 + f * 3.1
			if f == 1:
				rects.append(Rect2(x, -13, 2.6, 12))          # the middle finger, up
			else:
				rects.append(Rect2(x, -4.5, 2.6, 3.5))        # the others, folded
		rects.append(Rect2(-8, 1, 4, 2.6))
	for r in rects:
		var rr := Rect2(c + (r as Rect2).position * u, (r as Rect2).size * u)
		draw_rect(rr.grow(1.2), line)
	for r in rects:
		var rr := Rect2(c + (r as Rect2).position * u, (r as Rect2).size * u)
		draw_rect(rr, skin)
