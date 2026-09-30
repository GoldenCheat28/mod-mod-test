extends Control
## Making things (C): a notebook opens - on the left page the blueprints
## (what can be made, what each takes, ticked off against the bag), on the
## right the one chosen, drawn out in ink on squared paper, and made there
## with your own hands, step by step - not a bar filling up:
##   hold  - drag a thing (a bag of powder, a bottle) to where it goes and hold
##           it there while it pours;
##   turn  - wind the mouse round and round a point (a cap screwed on, a mortar,
##           a roll of bandage);
##   tape  - the same round a pipe or a can, and the tape really goes on round
##           it, turn by turn, from one end along;
##   dial  - set the alarm clock's hand;
##   wires - each wire from the clock to its own contact (five of them);
##   cuts  - scissors along each dashed line;
##   pull  - drag a plunger or a cord along its way;
##   click - tap where it says, so many times;
##   saw   - to and fro (rolling a joint).
## The parts are used up only when it is done.

signal crafted(id: String, extra: Dictionary)

const Items = preload("res://scripts/game/items.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")

const RECIPES := [
	{"id": "pipe_bomb", "count": 1, "name": "Самодельная бомба", "needs": {"pipe": 1, "powder": 1, "clock": 1, "wires": 5, "tape": 1},
		"steps": [
			{"t": "hold", "text": "Засыпь порох в трубу: тащи мешок к открытому концу и держи", "time": 2.2},
			{"t": "turn", "text": "Закрути заглушку: крути мышью вокруг неё (2 оборота)", "turns": 2.0},
			{"t": "dial", "text": "Поставь время: тащи стрелку будильника, потом «Дальше»"},
			{"t": "wires", "text": "Подключи все пять проводов: каждый к контакту своего цвета"},
			{"t": "tape", "text": "Обмотай изолентой: крути мышью вокруг трубы (3 оборота)", "turns": 3.0},
		]},
	{"id": "grenade", "count": 1, "name": "Граната из банки", "needs": {"tin_can": 1, "powder": 1, "nails": 1, "fuse_cord": 1, "tape": 1},
		"steps": [
			{"t": "hold", "text": "Засыпь гвозди в банку: тащи коробку к банке и держи", "time": 1.5},
			{"t": "hold", "text": "Засыпь порох поверх: тащи мешок к банке и держи", "time": 1.8},
			{"t": "pull", "text": "Вставь шнур: протяни его вниз, в крышку"},
			{"t": "tape", "text": "Прихвати крышку изолентой: крути мышью вокруг банки (2 оборота)", "turns": 2.0},
		]},
	{"id": "bandage", "count": 2, "name": "Бинты", "needs": {"cloth": 2, "alcohol": 1},
		"steps": [
			{"t": "cuts", "text": "Разрежь тряпку на полосы: веди ножницы по каждой пунктирной линии", "n": 3},
			{"t": "hold", "text": "Смочи полосы спиртом: поднеси бутылку и держи", "time": 1.8},
			{"t": "turn", "text": "Скатай бинт: крути мышью вокруг рулона (2 оборота)", "turns": 2.0},
		]},
	{"id": "syringe", "count": 1, "name": "Шприц с обезболивающим", "needs": {"empty_syringe": 1, "ampoule": 1},
		"steps": [
			{"t": "click", "text": "Отломи кончик ампулы: щёлкни по горлышку", "n": 1},
			{"t": "pull", "text": "Набери лекарство: тяни поршень назад"},
			{"t": "click", "text": "Выгони пузырьки воздуха: постучи по шприцу (3 раза)", "n": 3},
		]},
	{"id": "pills", "count": 5, "name": "Таблетки «Улёт»", "needs": {"chalk": 1, "sugar": 1, "dye": 1},
		"steps": [
			{"t": "turn", "text": "Разотри мел с сахаром в ступке (3 оборота)", "turns": 3.0},
			{"t": "hold", "text": "Добавь краситель: поднеси пузырёк к ступке и держи", "time": 1.4},
			{"t": "click", "text": "Спрессуй таблетки: щёлкай по форме (5 раз)", "n": 5},
		]},
	{"id": "molotov", "count": 1, "name": "Коктейль Молотова", "needs": {"alcohol": 1, "cloth": 1},
		"steps": [
			{"t": "pull", "text": "Засунь тряпку в горлышко"},
			{"t": "turn", "text": "Закрути тряпку потуже", "turns": 1.5},
		]},
	{"id": "joint", "count": 1, "name": "Косяк", "needs": {"herb": 1, "rolling_paper": 1},
		"steps": [
			{"t": "turn", "text": "Измельчи траву в гриндере (2 оборота)", "turns": 2.0},
			{"t": "hold", "text": "Насыпь на бумагу: тащи щепоть к бумаге и держи", "time": 1.4},
			{"t": "saw", "text": "Скрути: води мышью влево-вправо по бумаге (4 раза)", "n": 4},
			{"t": "click", "text": "Заклей край: щёлкни по клеевой полоске", "n": 1},
		]},
]

const INK := Color(0.1, 0.19, 0.5)
const INK_SOFT := Color(0.1, 0.19, 0.5, 0.45)
const PAPER := Color(0.94, 0.915, 0.84)
const PAPER_R := Color(0.955, 0.94, 0.88)
const RULE := Color(0.45, 0.6, 0.85, 0.35)
const MARGIN := Color(0.85, 0.3, 0.3, 0.55)
const PENCIL := Color(0.2, 0.2, 0.2, 0.8)
const WIRE_COLS := [Color(0.85, 0.1, 0.1), Color(0.08, 0.08, 0.08), Color(0.12, 0.35, 0.9), Color(0.95, 0.8, 0.1), Color(0.1, 0.65, 0.2)]
const WIRE_NAMES := ["красный", "чёрный", "синий", "жёлтый", "зелёный"]

var inv: RefCounted
var is_open := false
var _font: Font
var _sel := 0
var _step := -1                  # -1: choosing; else the step of RECIPES[_sel]
var _p := 0.0                    # progress of the step, 0..1
var _drag := ""
var _obj := Vector2.ZERO         # the thing being dragged (hold), page coordinates
var _angle_prev := INF
var _turns := 0.0
var _fuse := 30.0
var _hand_a := 0.0
var _wire_end: Array = []        # per wire: its free end (INF: still hanging at the clock)
var _wire_done: Array = []
var _wire_order: Array = []      # which contact (slot) each colour goes to
var _cut_done: Array = []
var _cut_from := Vector2.INF
var _clicks := 0
var _saw_dir := 0.0
var _saw_run := 0.0
var _saw_last := Vector2.INF
var _strokes := 0
var _msg := ""
var _msg_t := 0.0
var _open_k := 0.0               # the notebook sliding up


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	_font = ThemeDB.fallback_font


func toggle() -> void:
	is_open = not is_open
	visible = is_open
	_step = -1
	_drag = ""
	_open_k = 0.0
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if is_open else Input.MOUSE_MODE_CAPTURED
	if is_open:
		Game.play_3d(Sfx.get_stream(&"item_pickup"), Game.player.global_position if Game.player else Vector3.ZERO, -12.0, 0.1, 1.0)
	queue_redraw()


func _process(delta: float) -> void:
	if not is_open:
		return
	_msg_t -= delta
	_open_k = move_toward(_open_k, 1.0, delta * 5.0)
	var st := _cur()
	if not st.is_empty() and st["t"] == "hold" and _drag == "obj" and _obj.distance_to(_hold_target()) < 70.0 * _s():
		_p += delta / float(st.get("time", 1.5))
		if _p >= 1.0:
			_next()
	queue_redraw()


func _cur() -> Dictionary:
	if _step < 0:
		return {}
	var steps: Array = RECIPES[_sel]["steps"]
	return steps[_step] if _step < steps.size() else {}


func _rid() -> String:
	return RECIPES[_sel]["id"]


# --- Layout ------------------------------------------------------------------------------

func _s() -> float:
	return clampf(get_viewport_rect().size.y / 1080.0, 0.55, 2.0)


func _book() -> Rect2:
	var vs := get_viewport_rect().size
	var w := minf(vs.x * 0.9, vs.y * 1.62)
	var h := w / 1.62
	var slide := (1.0 - smoothstep(0.0, 1.0, _open_k)) * vs.y * 0.6
	return Rect2(Vector2((vs.x - w) * 0.5, (vs.y - h) * 0.5 + slide), Vector2(w, h))


func _left() -> Rect2:
	var b := _book()
	return Rect2(b.position + Vector2(b.size.x * 0.02, b.size.y * 0.03), Vector2(b.size.x * 0.46, b.size.y * 0.94))


func _right() -> Rect2:
	var b := _book()
	return Rect2(b.position + Vector2(b.size.x * 0.52, b.size.y * 0.03), Vector2(b.size.x * 0.46, b.size.y * 0.94))


## A point on the drawing (the right page's workspace): u, v in 0..1.
func _w(u: float, v: float) -> Vector2:
	var r := _right()
	var top := r.position.y + r.size.y * 0.16
	var hgt := r.size.y * 0.7
	return Vector2(r.position.x + r.size.x * u, top + hgt * v)


func _recipe_rect(i: int) -> Rect2:
	var l := _left()
	var h := l.size.y * 0.8 / RECIPES.size()
	return Rect2(l.position + Vector2(l.size.x * 0.1, l.size.y * 0.14 + i * h), Vector2(l.size.x * 0.86, h - 6.0 * _s()))


func _button_rect() -> Rect2:
	var r := _right()
	var s := _s()
	return Rect2(r.end - Vector2(210, 70) * s, Vector2(190, 50) * s)


# --- Where things are, per blueprint ---------------------------------------------------------

func _pipe() -> Rect2:
	var a := _w(0.14, 0.52)
	var b := _w(0.72, 0.64)
	return Rect2(a, b - a)


func _can() -> Rect2:
	var a := _w(0.36, 0.34)
	var b := _w(0.6, 0.8)
	return Rect2(a, b - a)


func _clock_c() -> Vector2:
	return _w(0.45, 0.2)


func _hold_target() -> Vector2:
	match _rid():
		"pipe_bomb":
			return _pipe().position + Vector2(0, _pipe().size.y * 0.5)
		"grenade":
			return _can().position + Vector2(_can().size.x * 0.5, 0)
		"bandage":
			return _w(0.5, 0.45)
		"pills":
			return _w(0.45, 0.42)
		"joint":
			return _w(0.5, 0.62)
	return _w(0.5, 0.5)


func _hold_start() -> Vector2:
	return _w(0.12, 0.88)


func _turn_center() -> Vector2:
	match _rid():
		"pipe_bomb":
			return _pipe().end - Vector2(0, _pipe().size.y * 0.5) if _cur().get("t") == "turn" else _pipe().get_center()
		"grenade":
			return _can().get_center()
		"bandage":
			return _w(0.5, 0.55)
		"pills":
			return _w(0.45, 0.55)
		"joint":
			return _w(0.3, 0.35)
	return _w(0.5, 0.5)


func _terminal(i: int) -> Vector2:
	# The cap's five contacts, in a column by the right-hand end of the pipe;
	# which colour goes where is mixed up each time.
	var pr := _pipe()
	var slot: int = _wire_order[i] if i < _wire_order.size() else i
	return pr.end + Vector2(34 * _s(), -pr.size.y * 2.2 + slot * pr.size.y * 0.72)


func _clock_pin(i: int) -> Vector2:
	return _clock_c() + Vector2((-2 + i) * 16 * _s(), 64 * _s())


func _cut_line(i: int) -> Array:
	var a := _w(0.22, 0.3 + i * 0.16)
	var b := _w(0.78, 0.3 + i * 0.16)
	return [a, b]


func _pull_line() -> Array:
	match _rid():
		"syringe":
			return [_w(0.58, 0.5), _w(0.86, 0.5)]
		"grenade":
			return [_can().position + Vector2(_can().size.x * 0.5, -_can().size.y * 0.55), _can().position + Vector2(_can().size.x * 0.5, _can().size.y * 0.15)]
	return [_w(0.3, 0.5), _w(0.7, 0.5)]


func _click_target() -> Vector2:
	match _rid():
		"syringe":
			return _w(0.18, 0.3) if _step == 0 else _w(0.4, 0.5)
		"pills":
			return _w(0.5, 0.8)
		"joint":
			return _w(0.5, 0.56)
	return _w(0.5, 0.5)


# --- Input -----------------------------------------------------------------------------

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed:
			_press(mb.position)
		elif mb.button_index == MOUSE_BUTTON_LEFT and not mb.pressed:
			_release(mb.position)
		accept_event()
	elif event is InputEventMouseMotion:
		_motion((event as InputEventMouseMotion).position)
		accept_event()


func _press(p: Vector2) -> void:
	if _step < 0:
		for i in RECIPES.size():
			if _recipe_rect(i).has_point(p):
				if _sel != i:
					_sel = i
					Game.play_3d(Sfx.get_stream(&"key_press"), Game.player.global_position, -16.0)
		if _button_rect().has_point(p):
			if _have_all(RECIPES[_sel]):
				# Made with the hands, for real, on the floor or a table
				# (craft_bench.gd); the notebook is only for choosing.
				var r: Dictionary = RECIPES[_sel]
				toggle()
				if not Game.player.start_bench(r):
					toggle()
			else:
				_say("Не хватает деталей")
		return
	var st := _cur()
	var s := _s()
	match st["t"]:
		"hold":
			if p.distance_to(_obj) < 60.0 * s:
				_drag = "obj"
		"turn", "tape":
			_drag = "turn"
			_angle_prev = INF
		"dial":
			if p.distance_to(_clock_c()) < 110.0 * s:
				_drag = "hand"
			elif _button_rect().has_point(p):
				Game.play_3d(Sfx.get_stream(&"key_press"), Game.player.global_position, -10.0)
				_next()
		"wires":
			for i in 5:
				if _wire_done[i]:
					continue
				var end: Vector2 = _wire_end[i] if _wire_end[i] != Vector2.INF else _clock_pin(i) + Vector2(0, 34 * s)
				if p.distance_to(end) < 26.0 * s:
					_drag = "w%d" % i
					break
		"cuts":
			for i in int(st["n"]):
				if _cut_done[i]:
					continue
				var l: Array = _cut_line(i)
				if p.distance_to(l[0]) < 30.0 * s or p.distance_to(l[1]) < 30.0 * s:
					_drag = "c%d" % i
					_cut_from = p
					break
		"pull":
			var l: Array = _pull_line()
			var at: Vector2 = (l[0] as Vector2).lerp(l[1], _p)
			if p.distance_to(at) < 40.0 * s:
				_drag = "pull"
		"click":
			if p.distance_to(_click_target()) < 50.0 * s:
				_clicks += 1
				_p = float(_clicks) / float(st["n"])
				Game.play_3d(Sfx.get_stream(&"key_press"), Game.player.global_position, -12.0, 0.2)
				if _clicks >= int(st["n"]):
					_next()
		"saw":
			_drag = "saw"
			_saw_last = p
			_saw_run = 0.0
			_saw_dir = 0.0


func _release(p: Vector2) -> void:
	var st := _cur()
	if not st.is_empty() and st["t"] == "wires" and _drag.begins_with("w"):
		var i := int(_drag.substr(1))
		var hit := -1
		for k in 5:
			if p.distance_to(_terminal(k)) < 22.0 * _s():
				hit = k
		if hit == i:
			_wire_done[i] = true
			_wire_end[i] = _terminal(i)
			Game.play_3d(Sfx.get_stream(&"key_press"), Game.player.global_position, -8.0)
			if not _wire_done.has(false):
				_next()
		elif hit >= 0:
			_say("Не тот контакт! Этот провод - %s" % WIRE_NAMES[i])
			_wire_end[i] = Vector2.INF
	if _drag.begins_with("c"):
		_cut_from = Vector2.INF
	_drag = ""


func _motion(p: Vector2) -> void:
	var st := _cur()
	var s := _s()
	if _drag == "obj":
		_obj = p
	elif _drag == "hand":
		var d := p - _clock_c()
		_hand_a = fposmod(atan2(d.x, -d.y), TAU)
		_fuse = roundf(5.0 + _hand_a / TAU * 85.0)
	elif _drag.begins_with("w"):
		_wire_end[int(_drag.substr(1))] = p
	elif _drag == "turn":
		# Winding round a point: count the angle gone round it.
		var c := _turn_center()
		var a := atan2(p.y - c.y, p.x - c.x)
		if _angle_prev != INF:
			var da := wrapf(a - _angle_prev, -PI, PI)
			if absf(da) < 1.0 and p.distance_to(c) > 12.0 * s:
				_turns += absf(da) / TAU
		_angle_prev = a
		_p = clampf(_turns / float(st.get("turns", 2.0)), 0.0, 1.0)
		if _p >= 1.0:
			_next()
	elif _drag.begins_with("c"):
		# The scissors have to stay on the line, from one end to the other.
		var i := int(_drag.substr(1))
		var l: Array = _cut_line(i)
		var a: Vector2 = l[0]
		var b: Vector2 = l[1]
		var t := clampf((p - a).dot(b - a) / (b - a).length_squared(), 0.0, 1.0)
		if p.distance_to(a.lerp(b, t)) > 26.0 * s:
			_say("Мимо линии - заново")
			_drag = ""
			_cut_from = Vector2.INF
			return
		var start := 0.0 if _cut_from.distance_to(a) < _cut_from.distance_to(b) else 1.0
		if absf(t - start) > 0.97:
			_cut_done[i] = true
			_drag = ""
			Game.play_3d(Sfx.get_stream(&"key_press"), Game.player.global_position, -10.0, 0.3)
			var n := 0
			for c in _cut_done:
				n += 1 if c else 0
			_p = float(n) / float(st["n"])
			if n >= int(st["n"]):
				_next()
	elif _drag == "pull":
		var l: Array = _pull_line()
		var a: Vector2 = l[0]
		var b: Vector2 = l[1]
		_p = maxf(_p, clampf((p - a).dot(b - a) / (b - a).length_squared(), 0.0, 1.0))
		if _p >= 0.97:
			_next()
	elif _drag == "saw":
		var dx := p.x - _saw_last.x
		_saw_last = p
		var dir := signf(dx)
		if dir != 0.0 and dir != _saw_dir:
			if _saw_run > 60.0 * s:
				_strokes += 1
				_p = float(_strokes) / float(st["n"])
				if _strokes >= int(st["n"]):
					_next()
					return
			_saw_dir = dir
			_saw_run = 0.0
		_saw_run += absf(dx)


func _begin() -> void:
	_step = 0
	_start_step()
	_fuse = 30.0
	_hand_a = (30.0 - 5.0) / 85.0 * TAU
	_wire_end = [Vector2.INF, Vector2.INF, Vector2.INF, Vector2.INF, Vector2.INF]
	_wire_done = [false, false, false, false, false]
	_wire_order = [0, 1, 2, 3, 4]
	_wire_order.shuffle()
	_cut_done = [false, false, false, false]


func _start_step() -> void:
	_p = 0.0
	_turns = 0.0
	_drag = ""
	_angle_prev = INF
	_clicks = 0
	_strokes = 0
	_obj = _hold_start()


func _next() -> void:
	_step += 1
	_start_step()
	Game.play_3d(Sfx.get_stream(&"key_press"), Game.player.global_position, -10.0)
	if _step >= (RECIPES[_sel]["steps"] as Array).size():
		_finish()


func _finish() -> void:
	var r: Dictionary = RECIPES[_sel]
	for id in r["needs"]:
		inv.take(id, int(r["needs"][id]))
	var extra := {"fuse": _fuse} if r["id"] == "pipe_bomb" else {}
	for k in int(r.get("count", 1)):
		crafted.emit(r["id"], extra)
	_say("Готово: " + String(r["name"]) + (" (%d с)" % int(_fuse) if r["id"] == "pipe_bomb" else ""))
	_step = -1


func _have_all(r: Dictionary) -> bool:
	for id in r["needs"]:
		if inv.count(id) < int(r["needs"][id]):
			return false
	return true


func _say(t: String) -> void:
	_msg = t
	_msg_t = 2.5


# --- Drawing: the notebook ------------------------------------------------------------------

func _text(at: Vector2, t: String, size: float, col := INK, width := -1.0) -> void:
	draw_string(_font, at, t, HORIZONTAL_ALIGNMENT_LEFT, width, int(size * _s()), col)


func _draw() -> void:
	if not is_open:
		return
	var vs := get_viewport_rect().size
	var s := _s()
	draw_rect(Rect2(Vector2.ZERO, vs), Color(0.02, 0.02, 0.02, 0.7 * _open_k))
	var b := _book()
	# Cover, a shadow under it, the two pages.
	draw_rect(Rect2(b.position + Vector2(10, 14) * s, b.size), Color(0, 0, 0, 0.45))
	draw_rect(b.grow(8.0 * s), Color(0.22, 0.12, 0.08))
	draw_rect(b.grow(8.0 * s), Color(0.1, 0.05, 0.03), false, 2.0 * s)
	var l := _left()
	var r := _right()
	draw_rect(l, PAPER)
	draw_rect(r, PAPER_R)
	# Left: ruled like a school exercise book, the red margin.
	var y := l.position.y + 40.0 * s
	while y < l.end.y - 8.0:
		draw_line(Vector2(l.position.x, y), Vector2(l.end.x, y), RULE, 1.0)
		y += 30.0 * s
	draw_line(Vector2(l.position.x + l.size.x * 0.08, l.position.y), Vector2(l.position.x + l.size.x * 0.08, l.end.y), MARGIN, 1.5 * s)
	# Right: squared paper for drawing on.
	var g := 22.0 * s
	var x := r.position.x
	var k := 0
	while x < r.end.x:
		draw_line(Vector2(x, r.position.y), Vector2(x, r.end.y), Color(RULE, 0.5 if k % 5 == 0 else 0.22), 1.0)
		x += g
		k += 1
	y = r.position.y
	k = 0
	while y < r.end.y:
		draw_line(Vector2(r.position.x, y), Vector2(r.end.x, y), Color(RULE, 0.5 if k % 5 == 0 else 0.22), 1.0)
		y += g
		k += 1
	# The spiral binding down the middle.
	var mid := b.position.x + b.size.x * 0.5
	y = b.position.y + 26.0 * s
	while y < b.end.y - 16.0 * s:
		draw_arc(Vector2(mid, y), 9.0 * s, 0.0, TAU, 14, Color(0.55, 0.55, 0.58), 3.0 * s, true)
		draw_circle(Vector2(mid - 14.0 * s, y), 3.0 * s, Color(0.2, 0.18, 0.15))
		draw_circle(Vector2(mid + 14.0 * s, y), 3.0 * s, Color(0.2, 0.18, 0.15))
		y += 34.0 * s
	_draw_index()
	_draw_sheet()
	if _msg_t > 0.0:
		var w := _font.get_string_size(_msg, HORIZONTAL_ALIGNMENT_LEFT, -1, int(24 * s)).x
		draw_string(_font, Vector2(vs.x * 0.5 - w * 0.5, b.end.y + 44.0 * s), _msg, HORIZONTAL_ALIGNMENT_LEFT, -1, int(24 * s), Color(1, 0.9, 0.6, clampf(_msg_t, 0.0, 1.0)))
	draw_string(_font, Vector2(b.position.x, b.end.y + 30.0 * s), "C - закрыть блокнот", HORIZONTAL_ALIGNMENT_LEFT, -1, int(15 * s), Color(0.75, 0.72, 0.68))


func _draw_index() -> void:
	var l := _left()
	var s := _s()
	_text(l.position + Vector2(l.size.x * 0.12, 34.0 * s), "ЧЕРТЕЖИ", 30, INK)
	_text(l.position + Vector2(l.size.x * 0.12 + 170.0 * s, 32.0 * s), "(выбери и собери)", 15, INK_SOFT)
	for i in RECIPES.size():
		var rec: Dictionary = RECIPES[i]
		var rr := _recipe_rect(i)
		var ok := _have_all(rec)
		if i == _sel:
			# Circled in pencil.
			draw_rect(rr, Color(1.0, 0.92, 0.5, 0.35))
			draw_rect(rr, PENCIL, false, 1.5 * s)
		var name: String = rec["name"] + ("  x%d" % int(rec["count"]) if int(rec.get("count", 1)) > 1 else "")
		_text(rr.position + Vector2(6, 24) * s, "%d. %s" % [i + 1, name], 20, INK)
		var line := ""
		for id in rec["needs"]:
			var have: int = inv.count(id)
			var need := int(rec["needs"][id])
			line += ("✓ " if have >= need else "✗ ") + String(Items.def(id).get("short", Items.def(id)["name"])) + (" %d/%d" % [mini(have, need), need] if need > 1 else "") + "   "
		_text(rr.position + Vector2(18, 46) * s, line, 13, Color(0.15, 0.45, 0.15) if ok else Color(0.65, 0.15, 0.12), rr.size.x - 20.0 * s)


func _draw_sheet() -> void:
	var r := _right()
	var s := _s()
	var rec: Dictionary = RECIPES[_sel]
	_text(r.position + Vector2(20, 34) * s, rec["name"], 26, INK)
	var steps: Array = rec["steps"]
	if _step < 0:
		_text(r.position + Vector2(20, 62) * s, "Шагов: %d. Детали по всей карте (F), у торговца - за деньги." % steps.size(), 14, INK_SOFT, r.size.x - 40.0 * s)
		var ok := _have_all(rec)
		var br := _button_rect()
		draw_rect(br, Color(0.2, 0.45, 0.2, 0.85) if ok else Color(0.5, 0.25, 0.2, 0.6))
		draw_rect(br, INK, false, 2.0 * s)
		_text(br.position + Vector2(40, 33) * s, "Собрать", 22, Color(0.98, 0.96, 0.9))
	else:
		var st: Dictionary = steps[_step]
		_text(r.position + Vector2(20, 64) * s, "Шаг %d из %d: %s" % [_step + 1, steps.size(), st["text"]], 16, Color(0.55, 0.12, 0.1), r.size.x - 40.0 * s)
		# Progress, a pencil line along the bottom.
		if st["t"] != "dial" and st["t"] != "wires":
			var a := Vector2(r.position.x + 24.0 * s, r.end.y - 22.0 * s)
			draw_line(a, a + Vector2(r.size.x - 48.0 * s, 0), Color(PENCIL, 0.25), 3.0 * s)
			draw_line(a, a + Vector2((r.size.x - 48.0 * s) * _p, 0), PENCIL, 3.0 * s)
	match rec["id"]:
		"pipe_bomb":
			_draw_pipe_bomb()
		"grenade":
			_draw_can_grenade()
		"bandage":
			_draw_bandage()
		"syringe":
			_draw_syringe()
		"pills":
			_draw_pills()
		"joint":
			_draw_joint()


# --- Drawing: the blueprints ------------------------------------------------------------------

func _outline_rect(rc: Rect2, fill: Color, w := 2.0) -> void:
	draw_rect(rc, fill)
	draw_rect(rc, INK, false, w * _s())


func _bag(at: Vector2, label: String, col: Color) -> void:
	var s := _s()
	var rc := Rect2(at - Vector2(34, 44) * s, Vector2(68, 88) * s)
	_outline_rect(rc, col)
	draw_line(rc.position + Vector2(10, 12) * s, rc.position + Vector2(58, 12) * s, INK, 1.5 * s)
	var w := _font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, int(13 * s)).x
	_text(at + Vector2(-w * 0.5 / s, 6) * s, label, 13, INK)


func _pour(from: Vector2, to: Vector2, col: Color) -> void:
	if _drag == "obj" and from.distance_to(to) < 70.0 * _s():
		for k in 14:
			draw_circle(from.lerp(to, randf()) + Vector2(randf_range(-4, 4), randf_range(-4, 4)) * _s(), 2.0 * _s(), col)


## A roll of tape wound on round a tube from `x0`, `x1` long: `k` of the
## way along (0..1), each turn a band slanting across the front, the roll
## itself at the end of the last one with the strip from it to the tube.
func _tape_on(tube: Rect2, k: float, turns: float) -> void:
	var s := _s()
	if k <= 0.0:
		var start := Vector2(tube.position.x - 30.0 * s, tube.get_center().y - tube.size.y * 1.2)
		draw_arc(start, 18.0 * s, 0.0, TAU, 20, INK, 9.0 * s)
		return
	var bands := int(ceil(turns * 3.0))
	var pitch := tube.size.x * 0.92 / float(bands)
	var done := k * bands
	var tape := Color(0.08, 0.08, 0.09)
	for i in int(ceil(done)):
		var part := clampf(done - i, 0.0, 1.0)
		var x := tube.position.x + tube.size.x * 0.04 + i * pitch
		var top := Vector2(x, tube.position.y - 2.0 * s)
		var bot := Vector2(x + pitch * 0.9, tube.end.y + 2.0 * s)
		var w := pitch * 0.62
		var end := top.lerp(bot, part)
		var pts := PackedVector2Array([top, top + Vector2(w, 0), end + Vector2(w, 0), end])
		draw_colored_polygon(pts, tape)
		draw_line(top + Vector2(w * 0.3, 0), end + Vector2(w * 0.3, 0), Color(0.5, 0.5, 0.55, 0.5), 1.0)
	var i_last := clampi(int(done), 0, bands - 1)
	var part_l := done - i_last
	var xl := tube.position.x + tube.size.x * 0.04 + i_last * pitch
	var tip := Vector2(xl, tube.position.y).lerp(Vector2(xl + pitch * 0.9, tube.end.y), clampf(part_l, 0.0, 1.0))
	# The roll goes round the back and comes up again: drawn above or below.
	var ang := fposmod(k * turns * TAU, TAU)
	var roll := tube.get_center() + Vector2(0, -cos(ang) * tube.size.y * 1.4)
	roll.x = tip.x + pitch * 0.3
	draw_line(tip, roll, tape, 3.0 * s)
	draw_arc(roll, 18.0 * s, 0.0, TAU, 20, tape, 9.0 * s)
	draw_arc(roll, 23.0 * s, 0.0, TAU, 20, INK, 1.5 * s)


func _draw_pipe_bomb() -> void:
	var s := _s()
	var pr := _pipe()
	var steel := Color(0.72, 0.74, 0.78)
	_outline_rect(pr, steel)
	draw_line(pr.position + Vector2(0, pr.size.y * 0.25), pr.position + Vector2(pr.size.x, pr.size.y * 0.25), Color(1, 1, 1, 0.5), 2.0 * s)
	# Dimension line under it, as on a drawing.
	var dy := pr.end.y + 26.0 * s
	draw_line(Vector2(pr.position.x, dy), Vector2(pr.end.x, dy), INK_SOFT, 1.0)
	for x in [pr.position.x, pr.end.x]:
		draw_line(Vector2(x, dy - 6 * s), Vector2(x, dy + 6 * s), INK_SOFT, 1.0)
	_text(Vector2(pr.get_center().x - 20 * s, dy + 18 * s), "300 мм", 12, INK_SOFT)
	var fill := 1.0 if _step > 0 else (_p if _step == 0 else 0.0)
	if fill > 0.0:
		draw_rect(Rect2(pr.position + Vector2(pr.size.x * (1.0 - fill), pr.size.y * 0.3), Vector2(pr.size.x * fill, pr.size.y * 0.5)), Color(0.18, 0.16, 0.14, 0.7))
	# Caps: the far one on already, the near one screwed on at step 2.
	_outline_rect(Rect2(pr.end - Vector2(0, pr.size.y) + Vector2(0, -5 * s), Vector2(18 * s, pr.size.y + 10 * s)), steel.darkened(0.2))
	if _step >= 1:
		var turned := _p if _step == 1 else 1.0
		var cap := Rect2(pr.position + Vector2(-20 * s * turned, -5 * s), Vector2(18 * s, pr.size.y + 10 * s))
		_outline_rect(cap, steel.darkened(0.25))
		for k in 3:
			draw_line(cap.position + Vector2(4 + k * 5, 2) * s, cap.position + Vector2(4 + k * 5, cap.size.y / s - 2) * s, INK_SOFT, 1.0)
	elif _step <= 0:
		draw_circle(pr.position + Vector2(0, pr.size.y * 0.5), pr.size.y * 0.36, Color(0.05, 0.05, 0.05))
	if _step == 0:
		_bag(_obj, "ПОРОХ", Color(0.78, 0.66, 0.42))
		_pour(_obj, _hold_target(), Color(0.15, 0.12, 0.1))
	if _step < 0:
		# The idea of it in dashed lines: the clock on top, the wires.
		_dashed_circle(_clock_c(), 60.0 * s)
		_text(_clock_c() + Vector2(-40, 90) * s, "будильник", 13, INK_SOFT)
	if _step >= 2:
		_draw_clock()
	if _step >= 3:
		for i in 5:
			var c: Color = WIRE_COLS[i]
			var t := _terminal(i)
			draw_circle(t, 9.0 * s, c)
			draw_arc(t, 11.0 * s, 0.0, TAU, 16, INK, 2.0 * s)
			var pin := _clock_pin(i)
			var end: Vector2 = _wire_end[i] if _step == 3 and _wire_end[i] != Vector2.INF else (t if _step > 3 else pin + Vector2(0, 34 * s))
			var mid := (pin + end) * 0.5 + Vector2(0, 40 * s)
			var pts := PackedVector2Array()
			for k in 13:
				var u := k / 12.0
				pts.append(pin.lerp(mid, u).lerp(mid.lerp(end, u), u))
			draw_polyline(pts, INK, 7.0 * s, true)
			draw_polyline(pts, c, 4.5 * s, true)
			draw_circle(end, 6.0 * s, c.lightened(0.3))
	if _step >= 4:
		_tape_on(pr, _p if _step == 4 else 1.0, 3.0)
	elif _step >= 0:
		_tape_on(pr, 0.0, 3.0)


func _dashed_circle(c: Vector2, r: float) -> void:
	for i in 24:
		if i % 2 == 0:
			draw_arc(c, r, TAU * i / 24.0, TAU * (i + 1) / 24.0, 4, INK_SOFT, 1.5)


func _draw_clock() -> void:
	var s := _s()
	var c := _clock_c()
	draw_circle(c, 70.0 * s, Color(0.78, 0.2, 0.16))
	draw_arc(c, 70.0 * s, 0.0, TAU, 40, INK, 2.0 * s)
	draw_circle(c, 58.0 * s, Color(0.97, 0.95, 0.88))
	for i in 12:
		var a := TAU * i / 12.0
		draw_line(c + Vector2(sin(a), -cos(a)) * 50.0 * s, c + Vector2(sin(a), -cos(a)) * 56.0 * s, INK, 2.0)
	for sx in [-1.0, 1.0]:
		draw_circle(c + Vector2(40 * sx, -64) * s, 16.0 * s, Color(0.78, 0.2, 0.16))
		draw_arc(c + Vector2(40 * sx, -64) * s, 16.0 * s, 0.0, TAU, 16, INK, 1.5 * s)
	draw_line(c, c + Vector2(sin(_hand_a), -cos(_hand_a)) * 48.0 * s, INK, 4.0 * s)
	draw_circle(c, 5.0 * s, INK)
	_text(c + Vector2(80, 8) * s, "%d с" % int(_fuse), 22, INK)
	for i in 5:
		draw_circle(_clock_pin(i), 4.0 * s, INK)
	if _step == 2:
		var br := _button_rect()
		_outline_rect(br, Color(0.2, 0.45, 0.2, 0.85))
		_text(br.position + Vector2(44, 33) * s, "Дальше", 22, Color(0.98, 0.96, 0.9))


func _draw_can_grenade() -> void:
	var s := _s()
	var cr := _can()
	var tin := Color(0.78, 0.79, 0.8)
	_outline_rect(cr, tin)
	for k in 5:
		var y := cr.position.y + cr.size.y * (0.15 + k * 0.17)
		draw_line(Vector2(cr.position.x, y), Vector2(cr.end.x, y), INK_SOFT, 1.0)
	# What is in it (seen through, as on a drawing).
	var nails := 1.0 if _step > 0 else (_p if _step == 0 else 0.0)
	var powder := 1.0 if _step > 1 else (_p if _step == 1 else 0.0)
	var inner := cr.grow(-6.0 * s)
	if nails > 0.0:
		var h := inner.size.y * 0.5 * nails
		var nr := Rect2(Vector2(inner.position.x, inner.end.y - h), Vector2(inner.size.x, h))
		draw_rect(nr, Color(0.5, 0.5, 0.52, 0.5))
		var rng := RandomNumberGenerator.new()
		rng.seed = 5
		for k in int(40 * nails):
			var p := nr.position + Vector2(rng.randf() * nr.size.x, rng.randf() * nr.size.y)
			var a := rng.randf() * TAU
			draw_line(p, p + Vector2(cos(a), sin(a)) * 12.0 * s, INK, 1.5)
	if powder > 0.0:
		var h2 := inner.size.y * 0.35 * powder
		draw_rect(Rect2(Vector2(inner.position.x, inner.end.y - inner.size.y * 0.5 - h2), Vector2(inner.size.x, h2)), Color(0.15, 0.13, 0.11, 0.7))
	# The lid and the cord through it.
	_outline_rect(Rect2(cr.position - Vector2(4 * s, 10 * s), Vector2(cr.size.x + 8 * s, 10 * s)), tin.darkened(0.2))
	if _step >= 2:
		var l: Array = _pull_line()
		var k := _p if _step == 2 else 1.0
		var tip: Vector2 = (l[0] as Vector2).lerp(l[1], k)
		var top: Vector2 = tip - Vector2(0, cr.size.y * 0.55)
		draw_line(top + Vector2(-30 * s, -20 * s), top, Color(0.35, 0.3, 0.2), 5.0 * s)
		draw_line(top, tip, Color(0.35, 0.3, 0.2), 5.0 * s)
		if _step == 2:
			draw_circle(tip, 8.0 * s, Color(0.35, 0.3, 0.2))
			draw_arc(tip, 10.0 * s, 0.0, TAU, 16, INK, 1.5 * s)
	if _step == 0:
		_outline_rect(Rect2(_obj - Vector2(34, 22) * s, Vector2(68, 44) * s), Color(0.6, 0.46, 0.28))
		_text(_obj + Vector2(-26, 5) * s, "ГВОЗДИ", 12, INK)
		_pour(_obj, _hold_target(), Color(0.35, 0.35, 0.38))
	elif _step == 1:
		_bag(_obj, "ПОРОХ", Color(0.78, 0.66, 0.42))
		_pour(_obj, _hold_target(), Color(0.15, 0.12, 0.1))
	if _step >= 3:
		_tape_on(Rect2(cr.position + Vector2(0, -12 * s), Vector2(cr.size.x, cr.size.y * 0.3)), _p if _step == 3 else 1.0, 2.0)


func _draw_bandage() -> void:
	var s := _s()
	var cloth := Rect2(_w(0.18, 0.22), _w(0.82, 0.78) - _w(0.18, 0.22))
	if _step <= 0:
		_outline_rect(cloth, Color(0.8, 0.76, 0.66))
		for i in 3:
			var l: Array = _cut_line(i)
			var done: bool = _step == 0 and _cut_done[i]
			_dashes(l[0], l[1], Color(0.7, 0.1, 0.1) if not done else INK)
		if _step == 0 and _drag.begins_with("c"):
			_scissors(get_local_mouse_position())
	elif _step == 1:
		for i in 4:
			var strip := Rect2(cloth.position + Vector2(0, cloth.size.y * i / 4.0 + 3 * s), Vector2(cloth.size.x, cloth.size.y / 4.0 - 6 * s))
			_outline_rect(strip, Color(0.8, 0.76, 0.66).lerp(Color(0.72, 0.7, 0.62), _p))
		_outline_rect(Rect2(_obj - Vector2(22, 50) * s, Vector2(44, 100) * s), Color(0.75, 0.85, 0.85, 0.8))
		_text(_obj + Vector2(-20, 5) * s, "СПИРТ", 11, INK)
		_pour(_obj, _hold_target(), Color(0.7, 0.85, 0.9))
	else:
		# Rolled up: the roll grows as the strip gets shorter.
		var c := _turn_center()
		var k := _p if _step == 2 else 1.0
		var strip_len := cloth.size.x * (1.0 - k)
		_outline_rect(Rect2(c + Vector2(0, -14 * s), Vector2(strip_len, 28 * s)), Color(0.95, 0.94, 0.9))
		var rr := (16.0 + 26.0 * k) * s
		draw_circle(c, rr, Color(0.96, 0.95, 0.9))
		for n in 5:
			draw_arc(c, rr * (0.3 + n * 0.16), 0.0, TAU, 24, INK_SOFT, 1.0)
		draw_arc(c, rr, 0.0, TAU, 32, INK, 2.0 * s)


func _dashes(a: Vector2, b: Vector2, col: Color) -> void:
	var n := 18
	for i in n:
		if i % 2 == 0:
			draw_line(a.lerp(b, float(i) / n), a.lerp(b, float(i + 1) / n), col, 2.0 * _s())


func _scissors(at: Vector2) -> void:
	var s := _s()
	draw_arc(at + Vector2(-14, 12) * s, 7.0 * s, 0.0, TAU, 12, INK, 2.5 * s)
	draw_arc(at + Vector2(-14, -12) * s, 7.0 * s, 0.0, TAU, 12, INK, 2.5 * s)
	draw_line(at + Vector2(-8, 8) * s, at + Vector2(18, -4) * s, INK, 2.5 * s)
	draw_line(at + Vector2(-8, -8) * s, at + Vector2(18, 4) * s, INK, 2.5 * s)


func _draw_syringe() -> void:
	var s := _s()
	# The ampoule, stood up on the left.
	var amp := _w(0.18, 0.5)
	var body := Rect2(amp + Vector2(-16, -30) * s, Vector2(32, 90) * s)
	var liquid := 0.0 if _step >= 2 or (_step == 1 and _p > 0.95) else 1.0 - (_p if _step == 1 else 0.0)
	_outline_rect(body, Color(0.8, 0.9, 0.95, 0.5))
	draw_rect(Rect2(body.position + Vector2(0, body.size.y * (1.0 - 0.8 * liquid)), Vector2(body.size.x, body.size.y * 0.8 * liquid)), Color(0.85, 0.7, 0.2, 0.7))
	if _step <= 0:
		_outline_rect(Rect2(amp + Vector2(-6, -80) * s, Vector2(12, 50) * s), Color(0.8, 0.9, 0.95, 0.5))
		draw_line(_click_target() + Vector2(-16, 0) * s, _click_target() + Vector2(16, 0) * s, Color(0.7, 0.1, 0.1), 2.0 * s)
	# The syringe lying across, the needle into the ampoule from step 2.
	var a := _w(0.28, 0.5)
	var b := _w(0.62, 0.5)
	var barrel := Rect2(a + Vector2(0, -16) * s, Vector2(b.x - a.x, 32 * s))
	_outline_rect(barrel, Color(0.92, 0.95, 0.98, 0.6))
	for k in 8:
		var x := barrel.position.x + barrel.size.x * (0.1 + k * 0.1)
		draw_line(Vector2(x, barrel.position.y), Vector2(x, barrel.position.y + (10 if k % 2 == 0 else 6) * s), INK, 1.0)
	var drawn := 1.0 if _step >= 2 else (_p if _step == 1 else 0.0)
	if drawn > 0.0:
		draw_rect(Rect2(barrel.position + Vector2(2 * s, 4 * s), Vector2((barrel.size.x - 4 * s) * drawn, barrel.size.y - 8 * s)), Color(0.85, 0.7, 0.2, 0.75))
	# Needle.
	if _step >= 1:
		draw_line(a, amp + Vector2(0, 20) * s, INK, 2.0 * s)
	else:
		draw_line(a, a - Vector2(70, 0) * s, INK, 2.0 * s)
	# Plunger.
	var l: Array = _pull_line()
	var ph: Vector2 = (l[0] as Vector2).lerp(l[1], drawn)
	draw_line(b, ph, INK, 5.0 * s)
	_outline_rect(Rect2(ph + Vector2(-4, -22) * s, Vector2(8, 44) * s), Color(0.9, 0.9, 0.9))
	if _step == 2:
		# Bubbles, fewer with each tap.
		for k in 3 - _clicks:
			draw_arc(barrel.position + Vector2(barrel.size.x * (0.2 + k * 0.2), 10 * s), 5.0 * s, 0.0, TAU, 10, INK, 1.5)
		draw_arc(_click_target(), 30.0 * s, 0.0, TAU, 24, Color(0.7, 0.1, 0.1, 0.5), 1.5 * s)


func _draw_pills() -> void:
	var s := _s()
	var c := _turn_center()
	# Mortar and pestle.
	var bowl := PackedVector2Array()
	for i in 13:
		var a := PI * i / 12.0
		bowl.append(c + Vector2(cos(a) * 90.0, sin(a) * 60.0) * s)
	draw_colored_polygon(bowl, Color(0.8, 0.8, 0.78))
	draw_polyline(bowl, INK, 2.0 * s)
	draw_line(c + Vector2(-95, 0) * s, c + Vector2(95, 0) * s, INK, 2.0 * s)
	var ground := 1.0 if _step > 0 else (_p if _step == 0 else 0.0)
	var dye := 1.0 if _step > 1 else (_p if _step == 1 else 0.0)
	draw_rect(Rect2(c + Vector2(-70, 6) * s, Vector2(140, 26) * s), Color(0.96, 0.96, 0.95).lerp(Color(0.95, 0.4, 0.75), dye * 0.8))
	if _step < 1:
		var rng := RandomNumberGenerator.new()
		rng.seed = 3
		for k in int(12 * (1.0 - ground)):
			draw_rect(Rect2(c + Vector2(rng.randf_range(-60, 50), rng.randf_range(0, 18)) * s, Vector2(12, 8) * s), Color(1, 1, 1))
	var pa := fposmod(_turns * TAU, TAU) if _step == 0 else 0.6
	var pestle := c + Vector2(cos(pa) * 40.0, 10.0 + sin(pa) * 10.0) * s
	draw_line(pestle, pestle + Vector2(40, -110) * s, Color(0.55, 0.4, 0.25), 12.0 * s)
	if _step == 1:
		_outline_rect(Rect2(_obj - Vector2(14, 26) * s, Vector2(28, 52) * s), Color(0.95, 0.4, 0.75, 0.85))
		_pour(_obj, _hold_target(), Color(0.95, 0.3, 0.7))
	# The mould: five little cups.
	var m := _click_target()
	for i in 5:
		var p := m + Vector2((i - 2) * 36, 0) * s
		draw_arc(p, 13.0 * s, 0.0, TAU, 16, INK, 2.0 * s)
		if _step == 2 and i < _clicks:
			draw_circle(p, 11.0 * s, Color(0.95, 0.4, 0.75))
	if _step == 2:
		draw_rect(Rect2(m - Vector2(100, 24) * s, Vector2(200, 48) * s), Color(0.7, 0.1, 0.1, 0.4), false, 1.5 * s)


func _draw_joint() -> void:
	var s := _s()
	# The grinder, seen from above, top left.
	var g := _w(0.3, 0.35)
	draw_circle(g, 56.0 * s, Color(0.55, 0.58, 0.6))
	draw_arc(g, 56.0 * s, 0.0, TAU, 32, INK, 2.0 * s)
	var ga := _turns * TAU if _step == 0 else 0.0
	for k in 6:
		var a := ga + TAU * k / 6.0
		draw_line(g, g + Vector2(cos(a), sin(a)) * 46.0 * s, INK_SOFT, 2.0)
	# The paper, and the herb on it.
	var paper := Rect2(_w(0.2, 0.62) - Vector2(0, 18 * s), Vector2(_w(0.8, 0.0).x - _w(0.2, 0.0).x, 36 * s))
	var rolled := 1.0 if _step > 2 else (_p if _step == 2 else 0.0)
	var h := paper.size.y * lerpf(1.0, 0.45, rolled)
	var pr := Rect2(Vector2(paper.position.x, paper.get_center().y - h * 0.5), Vector2(paper.size.x, h))
	_outline_rect(pr, Color(0.98, 0.97, 0.93))
	var herb := 1.0 if _step > 1 else (_p if _step == 1 else 0.0)
	if herb > 0.0:
		draw_rect(Rect2(pr.position + Vector2(pr.size.x * 0.1, pr.size.y * 0.3), Vector2(pr.size.x * 0.8 * herb, pr.size.y * 0.4)), Color(0.35, 0.45, 0.18))
	# The strip of gum along the edge.
	draw_line(pr.position + Vector2(4, 3) * s, Vector2(pr.end.x - 4 * s, pr.position.y + 3 * s), Color(0.8, 0.65, 0.3), 3.0 * s)
	if _step == 1:
		draw_circle(_obj, 16.0 * s, Color(0.35, 0.45, 0.18))
		draw_arc(_obj, 16.0 * s, 0.0, TAU, 16, INK, 1.5 * s)
		_pour(_obj, _hold_target(), Color(0.35, 0.45, 0.18))
	if _step == 2:
		for sx in [-1.0, 1.0]:
			draw_line(pr.get_center() + Vector2(sx * 60 * s, -30 * s), pr.get_center() + Vector2(sx * 100 * s, -30 * s), Color(0.7, 0.1, 0.1, 0.6), 2.0 * s)
	if _step == 3:
		draw_arc(_click_target(), 34.0 * s, 0.0, TAU, 24, Color(0.7, 0.1, 0.1, 0.5), 1.5 * s)
