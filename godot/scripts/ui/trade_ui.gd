extends Control
## Trading with someone (from talking to him, dialog_ui.gd), laid out as in
## a looting game: the player's bag on the left, what he will part with on
## the right, and the deal between them - what the player gives (top) and
## what he takes (bottom). Things are dragged from grid to grid; each shows
## what it is worth to him. Below, what the deal comes to - who pays whom -
## and the buttons: make the deal, give it him for nothing, or close (all
## that is on the table goes back where it came from).

const Items = preload("res://scripts/game/items.gd")
const Icons = preload("res://scripts/ui/item_icons.gd")
const Inventory = preload("res://scripts/game/inventory.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")
const CELL := 46.0

var player: Node3D
var bot: Node3D
var inv: RefCounted                   # the player's bag
var is_open := false
var _his: RefCounted                  # what he will part with
var _give: RefCounted                 # on the table: from the player
var _take: RefCounted                 # on the table: from him
var _grids: Array = []                # [[inventory, origin, title]]
var _drag := {}                       # {it, from}
var _drag_grab := Vector2.ZERO
var _say := ""
var _font: Font
var _buttons: Array = []              # [[Rect2, action, label]]


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	_font = ThemeDB.fallback_font


func _persona():
	return bot.ai._persona() if bot and bot.ai else null


func open(b: Node3D) -> void:
	bot = b
	is_open = true
	visible = true
	_give = Inventory.new(5, 3)
	_take = Inventory.new(5, 3)
	_his = Inventory.new(6, 6)
	var p = _persona()
	if p:
		for id in p.has:
			_his.add(id, 1)
	_say = "Ну, показывай, что есть."
	_drag = {}
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if bot.ai:
		bot.ai.player_talk = player
	queue_redraw()


func close() -> void:
	if not is_open:
		return
	# What was on the table goes back.
	for it in _give.items.duplicate():
		inv.add(it["id"], int(it["count"]))
	is_open = false
	visible = false
	_drag = {}
	if bot and is_instance_valid(bot) and bot.ai and bot.ai.player_talk == player:
		bot.ai.player_talk = null
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _process(_delta: float) -> void:
	if is_open:
		if not is_instance_valid(bot) or not bot.alive or bot.global_position.distance_to(player.global_position) > 4.0:
			close()
			return
		queue_redraw()


# --- What things are worth ------------------------------------------------------------------

func _base(id: String) -> int:
	return load("res://scripts/ui/dialog_ui.gd")._base_price(id)


## What he gives for one of `id` (0: he does not want it).
func _buy_price(id: String) -> int:
	var jobs: Node = Game.main.get_node_or_null("Jobs") if Game.main else null
	if jobs and jobs.trade_price(id) > 0:
		return jobs.trade_price(id)
	var p = _persona()
	var want: int = p.wants_price(id)
	if want > 0:
		return int(want * lerpf(0.85, 1.05, p.trust))
	return int(_base(id) * 0.35) if p.trust > 0.4 else 0


## What he asks for one of his.
func _sell_price(id: String) -> int:
	return int(_base(id) * lerpf(1.4, 1.1, _persona().trust))


func _value(grid: RefCounted, buying: bool) -> int:
	var v := 0
	for it in grid.items:
		v += (_buy_price(it["id"]) if buying else _sell_price(it["id"])) * int(it["count"])
	return v


# --- Input ---------------------------------------------------------------------------------------

func _grid_at(p: Vector2) -> Array:
	for g in _grids:
		var r := Rect2(g[1], Vector2((g[0] as RefCounted).width, (g[0] as RefCounted).height) * CELL)
		if r.has_point(p):
			return g
	return []


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		for b in _buttons:
			if (b[0] as Rect2).has_point(event.position):
				_act(b[1])
				accept_event()
				return
		var g := _grid_at(event.position)
		if not g.is_empty():
			var gi: RefCounted = g[0]
			var cell: Vector2 = ((event.position - (g[1] as Vector2)) / CELL).floor()
			var it: Dictionary = gi.at(Vector2i(int(cell.x), int(cell.y)))
			if not it.is_empty() and it["id"] != "money":
				_drag = {"it": it, "from": gi}
				_drag_grab = (event.position - (g[1] as Vector2)) / CELL - Vector2(it["pos"])
		accept_event()
	elif event is InputEventMouseButton and not event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if not _drag.is_empty():
			_drop(event.position)
			_drag = {}
		accept_event()
	elif event is InputEventMouseMotion:
		accept_event()


func _unhandled_key_input(event: InputEvent) -> void:
	if is_open and event.pressed and ((event as InputEventKey).physical_keycode == KEY_ESCAPE or (event as InputEventKey).physical_keycode == KEY_F):
		close()
		get_viewport().set_input_as_handled()


## Dropped somewhere: onto another grid it may go to (the player's things
## between the bag and "gives", his between his and "takes").
func _drop(p: Vector2) -> void:
	var g := _grid_at(p)
	if g.is_empty():
		return
	var to: RefCounted = g[0]
	var from: RefCounted = _drag["from"]
	var it: Dictionary = _drag["it"]
	var mine := [inv, _give]
	var his := [_his, _take]
	if not ((from in mine and to in mine) or (from in his and to in his)):
		_say = "Это не моё." if from in mine else "Руки убрал."
		return
	var cell: Vector2 = ((p - (g[1] as Vector2)) / CELL - _drag_grab + Vector2(0.5, 0.5)).floor()
	var at := Vector2i(int(cell.x), int(cell.y))
	if to == from:
		to.move(it, at, it["rot"])
		return
	var size: Vector2i = Items.size_of(it["id"], it["rot"])
	from.remove(it)
	if to.fits(size, at):
		to.items.append({"id": it["id"], "pos": at, "rot": it["rot"], "count": it["count"]})
	else:
		var left: int = to.add(it["id"], int(it["count"]))
		if left > 0:
			from.add(it["id"], left)
	if to == _give and _buy_price(it["id"]) <= 0:
		_say = "%s мне без надобности." % Items.def(it["id"])["name"]
	elif to == _give:
		_say = "За %s дам %d." % [Items.def(it["id"])["name"].to_lower(), _buy_price(it["id"])]


func _act(what: String) -> void:
	var p = _persona()
	match what:
		"deal":
			if _give.items.is_empty() and _take.items.is_empty():
				_say = "Так что меняем-то?"
				return
			for it in _give.items:
				if _buy_price(it["id"]) <= 0:
					_say = "Убери %s - не возьму." % Items.def(it["id"])["name"].to_lower()
					return
			var balance := _value(_give, true) - _value(_take, false)
			if balance > 0 and balance > p.money:
				_say = "У меня столько нет. Есть %d." % p.money
				return
			if balance < 0 and inv.count("money") < -balance:
				_say = "Доплатить надо %d. У тебя нет." % -balance
				return
			# Done: his things into the bag (what fits), money changes hands.
			for it in _take.items:
				var left: int = inv.add(it["id"], int(it["count"]))
				if left > 0:
					_say = "Не влезет к тебе. Освободи место."
					inv.take(it["id"], int(it["count"]) - left)
					return
			var jobs: Node = Game.main.get_node_or_null("Jobs") if Game.main else null
			for it in _give.items:
				for w in p.wants.duplicate():
					if w[0] == it["id"]:
						p.wants.erase(w)
				if jobs:
					for k in int(it["count"]):
						jobs.on_sold(it["id"])
				player._after_losing(it["id"])
			for it in _take.items:
				p.has.erase(it["id"])
			if balance > 0:
				inv.add("money", balance)
				p.money -= balance
			elif balance < 0:
				inv.take("money", -balance)
				p.money += -balance
			_give = Inventory.new(5, 3)
			_take = Inventory.new(5, 3)
			p.trust = clampf(p.trust + 0.05, 0.0, 1.0)
			_say = "Приятно иметь дело." if balance >= 0 else "По рукам."
			Game.play_3d(Sfx.get_stream(&"item_pickup"), bot.chest.global_position, -8.0)
		"gift":
			if _give.items.is_empty():
				_say = "Так что даришь?"
				return
			var wanted := false
			for it in _give.items:
				for w in p.wants.duplicate():
					if w[0] == it["id"]:
						p.wants.erase(w)
						wanted = true
				player._after_losing(it["id"])
			_give = Inventory.new(5, 3)
			p.trust = clampf(p.trust + (0.25 if wanted else 0.1), 0.0, 1.0)
			_say = "О, спасибо! Как раз то, что надо." if wanted else "Ну... спасибо."
		"close":
			close()


# --- Drawing -------------------------------------------------------------------------------------

func _draw() -> void:
	if not is_open or inv == null or _persona() == null:
		return
	var p = _persona()
	var vs := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vs), Color(0, 0, 0, 0.6))
	var bag_w: float = inv.width * CELL
	var mid_w := 5 * CELL
	var his_w := 6 * CELL
	var total: float = bag_w + mid_w + his_w + 2 * 60.0
	var x0 := floorf((vs.x - total) * 0.5)
	var y0 := floorf(vs.y * 0.5 - 220.0)
	var bag_o := Vector2(x0, y0)
	var give_o := Vector2(x0 + bag_w + 60.0, y0)
	var take_o := Vector2(give_o.x, y0 + 3 * CELL + 62.0)
	var his_o := Vector2(give_o.x + mid_w + 60.0, y0)
	_grids = [[inv, bag_o, "ТВОЙ РЮКЗАК"], [_give, give_o, "ТЫ ОТДАЁШЬ"], [_take, take_o, "ТЫ БЕРЁШЬ"], [_his, his_o, p.name.to_upper()]]
	var panel := Rect2(Vector2(x0 - 20, y0 - 70), Vector2(total + 40, maxf(inv.height, 6) * CELL + 210))
	draw_rect(panel, Color(0.08, 0.085, 0.085, 0.96))
	draw_rect(panel, Color(0.35, 0.37, 0.36), false, 1.0)
	for g in _grids:
		_draw_grid(g[0], g[1], g[2], g[0] == _give, g[0] == _his or g[0] == _take)
	draw_string(_font, Vector2(his_o.x, y0 + 6 * CELL + 22), "У него денег: %d ₽" % p.money, HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color(0.75, 0.75, 0.7))
	draw_string(_font, Vector2(bag_o.x, y0 + inv.height * CELL + 22), "У тебя: %d ₽" % inv.count("money"), HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color(0.75, 0.75, 0.7))
	# The sum.
	var give_v := _value(_give, true)
	var take_v := _value(_take, false)
	var bal := give_v - take_v
	var sy := take_o.y + 3 * CELL + 26
	draw_string(_font, Vector2(give_o.x, sy), "Отдаёшь на %d ₽, берёшь на %d ₽" % [give_v, take_v], HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color(0.85, 0.85, 0.8))
	var line := "Он доплатит тебе %d ₽" % bal if bal > 0 else ("Ты доплатишь %d ₽" % -bal if bal < 0 else "Без доплаты")
	draw_string(_font, Vector2(give_o.x, sy + 22), line, HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color(0.95, 0.85, 0.4) if bal != 0 else Color(0.8, 0.8, 0.75))
	# His word.
	draw_string(_font, Vector2(x0, y0 - 40), "%s: «%s»" % [p.name, _say], HORIZONTAL_ALIGNMENT_LEFT, total, 18, Color(0.92, 0.9, 0.82))
	# Buttons.
	_buttons.clear()
	var by := sy + 44
	var labels := [["deal", "СДЕЛКА"], ["gift", "ОТДАТЬ ДАРОМ"], ["close", "ЗАКРЫТЬ"]]
	var bx := give_o.x
	var mp := get_local_mouse_position()
	for l in labels:
		var w := _font.get_string_size(l[1], HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x + 24
		var r := Rect2(Vector2(bx, by), Vector2(w, 32))
		draw_rect(r, Color(0.3, 0.12, 0.1) if r.has_point(mp) else Color(0.16, 0.17, 0.17))
		draw_rect(r, Color(0.5, 0.48, 0.44), false, 1.0)
		draw_string(_font, r.position + Vector2(12, 22), l[1], HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color(0.95, 0.93, 0.88))
		_buttons.append([r, l[0], l[1]])
		bx += w + 10
	draw_string(_font, Vector2(x0, panel.end.y - 12), "Перетаскивай вещи мышью: из рюкзака на стол - отдать, из его вещей на стол - взять.   Esc / F - закрыть",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.6, 0.6, 0.58))
	# The thing being dragged.
	if not _drag.is_empty():
		_draw_item(_drag["it"], mp - _drag_grab * CELL, 0.85, -1)


func _draw_grid(g: RefCounted, o: Vector2, title: String, prices_buy: bool, prices_sell: bool) -> void:
	draw_string(_font, o + Vector2(0, -10), title, HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Color(0.85, 0.85, 0.8))
	for y in g.height:
		for x in g.width:
			var r := Rect2(o + Vector2(x, y) * CELL, Vector2(CELL, CELL))
			draw_rect(r.grow(-1), Color(0.15, 0.16, 0.16))
			draw_rect(r.grow(-1), Color(0.25, 0.26, 0.25), false, 1.0)
	for it in g.items:
		if not _drag.is_empty() and _drag["it"] == it:
			continue
		var price := -1
		if prices_buy or g == inv:
			price = _buy_price(it["id"])
		elif prices_sell:
			price = _sell_price(it["id"])
		_draw_item(it, o + Vector2(it["pos"]) * CELL, 1.0, price)


func _draw_item(it: Dictionary, top_left: Vector2, alpha: float, price: int) -> void:
	var s: Vector2i = Items.size_of(it["id"], it["rot"])
	var r := Rect2(top_left, Vector2(s) * CELL).grow(-2)
	draw_rect(r, Color(0.22, 0.24, 0.23, 0.95 * alpha))
	draw_rect(r, Color(0.45, 0.47, 0.44, alpha), false, 1.0)
	var tex: Texture2D = Icons.get_icon(it["id"])
	if tex:
		var pic := r.grow(-3)
		var ts := tex.get_size()
		var k := minf(pic.size.x / ts.x, pic.size.y / ts.y)
		var sz := ts * k
		if it["rot"]:
			var c := pic.get_center()
			draw_set_transform(c, PI * 0.5, Vector2.ONE)
			var w := Vector2(pic.size.y, pic.size.x)
			draw_texture_rect(tex, Rect2(-w * 0.5, w), false, Color(1, 1, 1, alpha))
			draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		else:
			draw_texture_rect(tex, Rect2(pic.get_center() - sz * 0.5, sz), false, Color(1, 1, 1, alpha))
	var d := Items.def(it["id"])
	var nm: String = d.get("short", d["name"])
	draw_rect(Rect2(r.position, Vector2(r.size.x, 13)), Color(0.05, 0.05, 0.05, 0.7 * alpha))
	draw_string(_font, r.position + Vector2(2, 10), nm, HORIZONTAL_ALIGNMENT_LEFT, r.size.x - 4, 10, Color(0.9, 0.9, 0.85, alpha))
	if int(it["count"]) > 1:
		draw_string(_font, r.end - Vector2(16, 3), str(it["count"]), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 0.8, alpha))
	if price >= 0 and it["id"] != "money":
		var txt := ("%d ₽" % price) if price > 0 else "не нужно"
		var col := Color(0.5, 0.95, 0.5, alpha) if price > 0 else Color(0.9, 0.45, 0.4, alpha)
		draw_rect(Rect2(Vector2(r.position.x, r.end.y - 13), Vector2(r.size.x, 13)), Color(0, 0, 0, 0.65 * alpha))
		draw_string(_font, Vector2(r.position.x + 2, r.end.y - 3), txt, HORIZONTAL_ALIGNMENT_LEFT, r.size.x - 4, 10, col)
