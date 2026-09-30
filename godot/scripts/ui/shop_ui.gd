extends Control
## The trader's wares (trader.gd): each thing with its picture and price, and
## how much money there is in the bag. Click to buy one (into the bag, if it
## fits). F or Esc closes.

const Items = preload("res://scripts/game/items.gd")
const Icons = preload("res://scripts/ui/item_icons.gd")
const Trader = preload("res://scripts/game/trader.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")

var inv: RefCounted
var is_open := false
var _font: Font
var _hover := -1
var _msg := ""
var _msg_t := 0.0
var _scroll := 0.0


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	_font = ThemeDB.fallback_font


func open() -> void:
	is_open = true
	visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	queue_redraw()


func close() -> void:
	is_open = false
	visible = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _s() -> float:
	return clampf(get_viewport_rect().size.y / 1080.0, 0.55, 2.0)


func _panel() -> Rect2:
	var vs := get_viewport_rect().size
	var w := minf(vs.x * 0.7, 980.0 * _s())
	var h := vs.y * 0.78
	return Rect2((vs - Vector2(w, h)) * 0.5, Vector2(w, h))


func _row(i: int) -> Rect2:
	var p := _panel()
	var s := _s()
	var cols := 2
	var rh := 64.0 * s
	var cw := (p.size.x - 60.0 * s) / cols
	var c := i % cols
	var r := i / cols
	return Rect2(p.position + Vector2(20.0 * s + c * (cw + 20.0 * s), 90.0 * s + r * (rh + 8.0 * s) - _scroll), Vector2(cw, rh))


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		_hover = -1
		for i in Trader.GOODS.size():
			if _row(i).has_point(event.position):
				_hover = i
		queue_redraw()
	elif event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT and _hover >= 0:
			_buy(_hover)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_scroll = minf(_scroll + 40.0, maxf(_row(Trader.GOODS.size() - 1).end.y + _scroll - _panel().end.y + 60.0, 0.0))
		elif event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_scroll = maxf(_scroll - 40.0, 0.0)
		queue_redraw()
	accept_event()


func _unhandled_input(event: InputEvent) -> void:
	if is_open and (event.is_action_pressed("pickup") or event.is_action_pressed("release_mouse")):
		close()
		get_viewport().set_input_as_handled()


func _buy(i: int) -> void:
	var g: Array = Trader.GOODS[i]
	var id: String = g[0]
	var price: int = g[1]
	if inv.count("money") < price:
		_say("Не хватает денег")
		return
	if inv.add(id, 1) > 0:
		_say("Нет места в рюкзаке")
		return
	inv.take("money", price)
	Game.play_3d(Sfx.get_stream(&"item_pickup"), Game.player.global_position, -6.0)
	_say("Куплено: " + String(Items.def(id)["name"]))


func _say(t: String) -> void:
	_msg = t
	_msg_t = 2.0


func _process(delta: float) -> void:
	if is_open:
		_msg_t -= delta
		queue_redraw()


func _draw() -> void:
	if not is_open:
		return
	var s := _s()
	var vs := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, vs), Color(0, 0, 0, 0.6))
	var p := _panel()
	draw_rect(p, Color(0.06, 0.055, 0.05, 0.96))
	draw_rect(p, Color(0.45, 0.32, 0.18), false, 2.0 * s)
	draw_string(_font, p.position + Vector2(24, 44) * s, "ТОРГОВЕЦ", HORIZONTAL_ALIGNMENT_LEFT, -1, int(30 * s), Color(0.9, 0.82, 0.6))
	draw_string(_font, p.position + Vector2(24, 70) * s, "«Чё надо? Только быстро.»", HORIZONTAL_ALIGNMENT_LEFT, -1, int(15 * s), Color(0.65, 0.6, 0.52))
	var money := "Деньги: %d ₽" % inv.count("money")
	var mw := _font.get_string_size(money, HORIZONTAL_ALIGNMENT_LEFT, -1, int(22 * s)).x
	draw_string(_font, Vector2(p.end.x - mw - 24.0 * s, p.position.y + 44.0 * s), money, HORIZONTAL_ALIGNMENT_LEFT, -1, int(22 * s), Color(0.55, 0.85, 0.45))
	for i in Trader.GOODS.size():
		var r := _row(i)
		if r.end.y < p.position.y + 80.0 * s or r.position.y > p.end.y - 30.0 * s:
			continue
		var g: Array = Trader.GOODS[i]
		var id: String = g[0]
		var price: int = g[1]
		var can: bool = inv.count("money") >= price
		draw_rect(r, Color(0.16, 0.14, 0.12) if i == _hover else Color(0.1, 0.095, 0.085))
		draw_rect(r, Color(0.3, 0.25, 0.18), false, 1.0)
		var icon: Texture2D = Icons.get_icon(id)
		var ib := Rect2(r.position + Vector2(8, 6) * s, Vector2(r.size.y - 12.0 * s, r.size.y - 12.0 * s) * Vector2(1.4, 1.0))
		if icon:
			var asp := float(icon.get_width()) / maxf(icon.get_height(), 1.0)
			var h := ib.size.y
			var w := minf(h * asp, ib.size.x)
			draw_texture_rect(icon, Rect2(ib.position + Vector2((ib.size.x - w) * 0.5, (h - w / asp) * 0.5), Vector2(w, w / asp)), false)
		draw_string(_font, r.position + Vector2(ib.size.x + 20.0 * s, 28.0 * s), String(Items.def(id)["name"]), HORIZONTAL_ALIGNMENT_LEFT, r.size.x - ib.size.x - 120.0 * s, int(18 * s), Color(0.92, 0.9, 0.85))
		draw_string(_font, r.position + Vector2(ib.size.x + 20.0 * s, 50.0 * s), "в рюкзаке: %d" % inv.count(id), HORIZONTAL_ALIGNMENT_LEFT, -1, int(13 * s), Color(0.6, 0.58, 0.54))
		var pt := "%d ₽" % price
		var pw := _font.get_string_size(pt, HORIZONTAL_ALIGNMENT_LEFT, -1, int(20 * s)).x
		draw_string(_font, Vector2(r.end.x - pw - 14.0 * s, r.position.y + 38.0 * s), pt, HORIZONTAL_ALIGNMENT_LEFT, -1, int(20 * s),
				Color(0.95, 0.8, 0.35) if can else Color(0.6, 0.3, 0.25))
	if _msg_t > 0.0:
		var w := _font.get_string_size(_msg, HORIZONTAL_ALIGNMENT_LEFT, -1, int(20 * s)).x
		draw_string(_font, Vector2(p.get_center().x - w * 0.5, p.end.y - 16.0 * s), _msg, HORIZONTAL_ALIGNMENT_LEFT, -1, int(20 * s), Color(1, 0.9, 0.6, clampf(_msg_t, 0, 1)))
	draw_string(_font, Vector2(p.position.x + 24.0 * s, p.end.y + 26.0 * s), "ЛКМ - купить   колесо - листать   F - уйти", HORIZONTAL_ALIGNMENT_LEFT, -1, int(15 * s), Color(0.7, 0.68, 0.64))
