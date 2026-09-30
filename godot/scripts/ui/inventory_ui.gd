extends Control
## The bag, opened with X: a grid of cells, each thing drawn as its picture
## over the cells it takes. Drag things about (R turns the one being
## dragged); where it would go shows green, or red if it will not fit. Right
## click for what can be done with it (take in hand / use, throw out); a
## double click takes it in hand or uses it.

signal use_item(it: Dictionary)
signal drop_item(it: Dictionary)

const Items = preload("res://scripts/game/items.gd")
const Icons = preload("res://scripts/ui/item_icons.gd")
const CELL := 58.0

var inv: RefCounted
var is_open := false
var _origin := Vector2.ZERO           # top left of the grid on screen
var _drag: Dictionary = {}            # the thing being dragged
var _drag_rot := false
var _drag_grab := Vector2.ZERO        # where on it it was picked up (cells)
var _hover := Vector2i(-1, -1)
var _menu: Dictionary = {}            # {item, pos, entries: [[label, action]]}
var _menu_hover := -1
var _font: Font


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	_font = ThemeDB.fallback_font


func toggle() -> void:
	is_open = not is_open
	visible = is_open
	_drag = {}
	_menu = {}
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if is_open else Input.MOUSE_MODE_CAPTURED
	queue_redraw()


func _process(_delta: float) -> void:
	if is_open:
		queue_redraw()        # pictures arrive as they are made; drag follows the mouse


func _grid_size() -> Vector2:
	return Vector2(inv.width, inv.height) * CELL


func _cell_at(p: Vector2) -> Vector2i:
	var c := ((p - _origin) / CELL).floor()
	return Vector2i(int(c.x), int(c.y))


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		_hover = _cell_at(event.position)
		if not _menu.is_empty():
			_menu_hover = _menu_row(event.position)
		accept_event()
	elif event is InputEventMouseButton and event.pressed:
		var cell := _cell_at(event.position)
		if not _menu.is_empty():
			var row := _menu_row(event.position)
			if row >= 0:
				_do(_menu["entries"][row][1], _menu["item"])
			_menu = {}
		elif event.button_index == MOUSE_BUTTON_LEFT:
			var it: Dictionary = inv.at(cell)
			if not it.is_empty():
				if event.double_click:
					_do("use", it)
				else:
					_drag = it
					_drag_rot = it["rot"]
					_drag_grab = (event.position - _origin) / CELL - Vector2(it["pos"])
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			var it: Dictionary = inv.at(cell)
			if not it.is_empty():
				var kind: String = Items.def(it["id"])["kind"]
				var use_label := "Взять в руки" if kind in ["weapon", "throwable", "placeable", "restraint"] else "Использовать"
				_menu = {"item": it, "pos": event.position, "entries": [[use_label, "use"], ["Выбросить", "drop"]]}
				_menu_hover = -1
		accept_event()
	elif event is InputEventMouseButton and not event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if not _drag.is_empty():
			var at := _drop_cell(event.position)
			if _drop_zone().has_point(event.position) or not _inside(event.position):
				_do("drop", _drag)
			else:
				inv.move(_drag, at, _drag_rot)
			_drag = {}
		accept_event()


func _unhandled_key_input(event: InputEvent) -> void:
	if not is_open or not event.pressed:
		return
	if (event as InputEventKey).physical_keycode == KEY_R and not _drag.is_empty():
		_drag_rot = not _drag_rot
		get_viewport().set_input_as_handled()
	# G over a thing: out of the bag onto the ground (it stays there to be
	# picked up again).
	elif (event as InputEventKey).physical_keycode == KEY_G and _drag.is_empty():
		var it: Dictionary = inv.at(_hover)
		if not it.is_empty():
			_do("drop", it)
			get_viewport().set_input_as_handled()


## The box beside the bag to drop things into.
func _drop_zone() -> Rect2:
	var gs := _grid_size()
	return Rect2(_origin + Vector2(gs.x + 34, 0), Vector2(120, gs.y))


func _inside(p: Vector2) -> bool:
	return Rect2(_origin - Vector2.ONE * 40.0, _grid_size() + Vector2.ONE * 80.0).has_point(p)


## Where the dragged thing's top left cell would land.
func _drop_cell(p: Vector2) -> Vector2i:
	var g := _drag_grab
	if _drag_rot != bool(_drag["rot"]):
		g = Vector2(g.y, g.x)
	var c := ((p - _origin) / CELL - g + Vector2(0.5, 0.5)).floor()
	return Vector2i(int(c.x), int(c.y))


func _do(action: String, it: Dictionary) -> void:
	match action:
		"use":
			use_item.emit(it)
		"drop":
			drop_item.emit(it)


func _menu_row(p: Vector2) -> int:
	if _menu.is_empty():
		return -1
	var r := p - (_menu["pos"] as Vector2)
	if r.x < 0.0 or r.x > 170.0 or r.y < 0.0:
		return -1
	var i := int(r.y / 30.0)
	return i if i < (_menu["entries"] as Array).size() else -1


func _draw() -> void:
	if not is_open or inv == null:
		return
	var vs := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vs), Color(0, 0, 0, 0.55))
	var gs := _grid_size()
	_origin = ((vs - gs) * 0.5).floor() + Vector2(0, 20)
	var panel := Rect2(_origin - Vector2(18, 58), gs + Vector2(36 + 150, 112))
	draw_rect(panel, Color(0.09, 0.1, 0.1, 0.94))
	draw_rect(panel, Color(0.35, 0.37, 0.36), false, 1.0)
	draw_string(_font, _origin + Vector2(0, -24), "РЮКЗАК", HORIZONTAL_ALIGNMENT_LEFT, -1, 22, Color(0.85, 0.85, 0.8))
	draw_string(_font, _origin + Vector2(gs.x - 170, -24), "Вес: %.1f кг" % inv.weight(), HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color(0.75, 0.75, 0.7))
	# The drop box.
	var dz := _drop_zone()
	var over_dz := not _drag.is_empty() and dz.has_point(get_local_mouse_position())
	draw_rect(dz, Color(0.35, 0.12, 0.1, 0.55) if over_dz else Color(0.14, 0.1, 0.1, 0.8))
	draw_rect(dz, Color(0.5, 0.3, 0.28), false, 1.0)
	for i in 3:
		var line: String = ["ВЫБРОСИТЬ", "перетащи сюда", "или G над вещью"][i]
		var fs: int = [16, 12, 12][i]
		var w := _font.get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string(_font, dz.get_center() + Vector2(-w * 0.5, -10 + i * 18), line, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(0.9, 0.8, 0.75))
	# Cells.
	for y in inv.height:
		for x in inv.width:
			var r := Rect2(_origin + Vector2(x, y) * CELL, Vector2(CELL, CELL))
			draw_rect(r.grow(-1), Color(0.16, 0.17, 0.17))
			draw_rect(r.grow(-1), Color(0.26, 0.27, 0.26), false, 1.0)
	# Things.
	for it in inv.items:
		if it == _drag:
			continue
		_draw_item(it, _origin + Vector2(it["pos"]) * CELL, it["rot"], 1.0)
	# The one being dragged, and where it would go.
	if not _drag.is_empty():
		var mp := get_local_mouse_position()
		var at := _drop_cell(mp)
		var s: Vector2i = Items.size_of(_drag["id"], _drag_rot)
		var ok: bool = inv.fits(s, at, _drag)
		if _inside(mp):
			draw_rect(Rect2(_origin + Vector2(at) * CELL, Vector2(s) * CELL), Color(0.2, 0.8, 0.3, 0.25) if ok else Color(0.9, 0.2, 0.2, 0.3))
		var g := _drag_grab if _drag_rot == bool(_drag["rot"]) else Vector2(_drag_grab.y, _drag_grab.x)
		_draw_item(_drag, mp - g * CELL, _drag_rot, 0.85)
	elif not _menu.is_empty():
		pass
	else:
		# What is under the mouse.
		var it: Dictionary = inv.at(_hover)
		if not it.is_empty():
			var d := Items.def(it["id"])
			var text := "%s   %.2f кг" % [d["name"], float(d["weight"]) * int(it["count"])]
			var mp := get_local_mouse_position() + Vector2(16, 24)
			draw_rect(Rect2(mp - Vector2(6, 18), Vector2(_font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x + 12, 26)), Color(0.05, 0.05, 0.05, 0.92))
			draw_string(_font, mp, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color(0.9, 0.9, 0.85))
	draw_string(_font, _origin + Vector2(0, gs.y + 24), "ЛКМ — перетащить    R — повернуть    ПКМ — действия    двойной клик — взять / использовать",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.6, 0.6, 0.58))
	draw_string(_font, _origin + Vector2(0, gs.y + 42), "вынести за край — выбросить    F — подобрать с земли    X — закрыть",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.6, 0.6, 0.58))
	# The menu.
	if not _menu.is_empty():
		var p: Vector2 = _menu["pos"]
		var entries: Array = _menu["entries"]
		draw_rect(Rect2(p, Vector2(170, 30 * entries.size())), Color(0.06, 0.06, 0.06, 0.96))
		for i in entries.size():
			if i == _menu_hover:
				draw_rect(Rect2(p + Vector2(0, 30 * i), Vector2(170, 30)), Color(0.3, 0.32, 0.3))
			draw_string(_font, p + Vector2(10, 30 * i + 21), entries[i][0], HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color(0.92, 0.92, 0.88))


func _draw_item(it: Dictionary, top_left: Vector2, rot: bool, alpha: float) -> void:
	var s: Vector2i = Items.size_of(it["id"], rot)
	var r := Rect2(top_left, Vector2(s) * CELL).grow(-2)
	draw_rect(r, Color(0.22, 0.24, 0.23, 0.95 * alpha))
	draw_rect(r, Color(0.45, 0.47, 0.44, alpha), false, 1.0)
	# The name on a strip along the top, the picture under it (never on top
	# of each other); long names are set smaller to fit.
	const BAR := 15.0
	var pic := Rect2(r.position + Vector2(0, BAR), r.size - Vector2(0, BAR)).grow(-2)
	var tex: Texture2D = Icons.get_icon(it["id"])
	if tex:
		if rot:
			# Turned a quarter: drawn about its middle.
			var c := pic.get_center()
			draw_set_transform(c, PI * 0.5, Vector2.ONE)
			var w := Vector2(pic.size.y, pic.size.x)
			draw_texture_rect(tex, Rect2(-w * 0.5, w), false, Color(1, 1, 1, alpha))
			draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		else:
			# Kept in proportion, centred.
			var ts := tex.get_size()
			var k := minf(pic.size.x / ts.x, pic.size.y / ts.y)
			var sz := ts * k
			draw_texture_rect(tex, Rect2(pic.get_center() - sz * 0.5, sz), false, Color(1, 1, 1, alpha))
	var d := Items.def(it["id"])
	draw_rect(Rect2(r.position, Vector2(r.size.x, BAR)), Color(0.05, 0.05, 0.05, 0.7 * alpha))
	var name: String = d.get("short", d["name"])
	var fsz := 12
	while fsz > 8 and _font.get_string_size(name, HORIZONTAL_ALIGNMENT_LEFT, -1, fsz).x > r.size.x - 6:
		fsz -= 1
	draw_string(_font, r.position + Vector2(3, 11), name, HORIZONTAL_ALIGNMENT_LEFT, r.size.x - 4, fsz, Color(0.9, 0.9, 0.85, alpha))
	if int(it["count"]) > 1 or int(d["stack"]) > 1:
		var ct := str(it["count"])
		var cw := _font.get_string_size(ct, HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x
		draw_string(_font, r.end - Vector2(cw + 4, 4), ct, HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(1, 1, 0.8, alpha))
