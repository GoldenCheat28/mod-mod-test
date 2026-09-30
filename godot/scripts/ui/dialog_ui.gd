extends Control
## Talking with someone (F on a man; or he comes up and starts it). For now
## it is text: what he says at the top, what you can say or do below - click
## or press the number. Talk, ask him things, offer him something for a price
## you name (he may buy, haggle or send you off), give him something, ask him
## a favour, or play a round of roulette with him. What he thinks of you
## (persona.trust) moves with what you do.

const Items = preload("res://scripts/game/items.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")
const Persona = preload("res://scripts/bots/persona.gd")

var inv: RefCounted
var player: Node3D
var bot: Node3D
var is_open := false
var _font: Font
var _say := ""                   # his line
var _opts: Array = []            # [[text, Callable], ...]
var _hover := -1
var _page := "main"
var _pick := ""                  # item being offered
var _price := 0
var _opened_by_him := false


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	_font = ThemeDB.fallback_font


func _persona():
	if not bot.has_meta("persona"):
		bot.set_meta("persona", Persona.make(bot.bot_seed, bot.ai.talk._rude if bot.ai and bot.ai.talk else false))
	return bot.get_meta("persona")


## Opens a talk with `b`. `line`: what he says first (he came up to you), and
## `page` which options to show first.
func open(b: Node3D, line := "", page := "main") -> void:
	bot = b
	is_open = true
	visible = true
	_opened_by_him = line != ""
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_hold_him(true)
	var p = _persona()
	if line == "":
		if not p.met:
			line = "Ну? Чего надо?" if p.rude else "Здорово. Я %s. Чего хотел?" % p.name
		elif p.trust > 0.6:
			line = "О, это ты. Ну как ты?"
		else:
			line = "Опять ты. Чего?" if p.trust < 0.2 else "Слушаю."
	p.met = true
	_say = line
	_show(page)


func close() -> void:
	if not is_open:
		return
	is_open = false
	visible = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	_hold_him(false)


func _hold_him(on: bool) -> void:
	if bot == null or not is_instance_valid(bot) or bot.ai == null:
		return
	if bot.has_meta("puppet"):
		return
	bot.ai.player_talk = player if on else null


func _process(_d: float) -> void:
	if not is_open:
		return
	# Walked off, or he is in no state to talk.
	if bot == null or not is_instance_valid(bot) or not bot.alive or not bot.conscious or bot.fallen \
			or player.global_position.distance_to(bot.position_ground()) > 4.5:
		close()


# --- Pages ------------------------------------------------------------------------------------------

func _show(page: String) -> void:
	_page = page
	_hover = -1
	var p = _persona()
	_opts = []
	match page:
		"main":
			_opts.append(["Поговорить", func(): _talk()])
			_opts.append(["Спросить...", func(): _show("ask")])
			_opts.append(["Предложить вещь (продать)", func(): _show("sell_pick")])
			_opts.append(["Отдать вещь", func(): _show("give_pick")])
			_opts.append(["Попросить об одолжении...", func(): _show("favour")])
			_opts.append(["Сыграем в рулетку?", func(): _roulette_ask()])
			_opts.append(["Пока", func(): _bye()])
		"ask":
			_opts.append(["Что тут вообще происходит?", func(): _answer_place()])
			_opts.append(["Где достать ствол или что-нибудь такое?", func(): _answer_goods()])
			_opts.append(["Кого тут стоит опасаться?", func(): _answer_danger()])
			_opts.append(["Тебе самому что-нибудь нужно?", func(): _answer_needs()])
			_opts.append(["Назад", func(): _show("main")])
		"favour":
			_opts.append(["Дай закурить", func(): _favour_smoke()])
			_opts.append(["Одолжи денег", func(): _favour_money()])
			_opts.append(["Пойдём со мной", func(): _favour_follow()])
			_opts.append(["Назад", func(): _show("main")])
		"sell_pick", "give_pick":
			var seen := {}
			for it in inv.items:
				var id: String = it["id"]
				if id == "money" or seen.has(id):
					continue
				seen[id] = true
				var nm: String = Items.def(id)["name"]
				var want: int = p.wants_price(id)
				var label := nm + ("   (ему нужно)" if want > 0 and page == "sell_pick" and p.trust > 0.15 else "")
				if page == "sell_pick":
					_opts.append([label, func(): _pick_item(id)])
				else:
					_opts.append([label, func(): _give(id)])
				if _opts.size() >= 9:
					break
			_opts.append(["Назад", func(): _show("main")])
		"sell_price":
			_opts.append(["Цена: %d ₽      [+50]" % _price, func(): _price_by(50)])
			_opts.append(["[+10]", func(): _price_by(10)])
			_opts.append(["[-10]", func(): _price_by(-10)])
			_opts.append(["[-50]", func(): _price_by(-50)])
			_opts.append(["Предложить за %d ₽" % _price, func(): _offer()])
			_opts.append(["Назад", func(): _show("sell_pick")])
		"roulette":
			_opts.append(["Стреляемся здесь", func(): _roulette_go(false)])
			_opts.append(["Пойдём за стол", func(): _roulette_go(true)])
			_opts.append(["Нет, не буду", func(): _roulette_no()])
	queue_redraw()


# --- Talk -------------------------------------------------------------------------------------------

func _talk() -> void:
	var p = _persona()
	var lines_ok := ["Да так, живу помаленьку.", "Нормально. Холодно только.", "Сижу, никого не трогаю.",
			"Жизнь такая... то одно, то другое.", "Слышал, опять кого-то тут подрезали.", "Скучно тут, делать нечего."]
	var lines_bad := ["Тебе какое дело?", "Отвали, не до тебя.", "Чего пристал?"]
	if p.rude and p.trust < 0.3:
		_say = lines_bad[randi() % lines_bad.size()]
		_mood(-0.02)
	else:
		_say = lines_ok[randi() % lines_ok.size()]
		_mood(0.05)
	_show("main")


func _answer_place() -> void:
	var l := ["Заброшка это. Раньше тут склад был, потом всё растащили.", "Тут все свои. Ну, почти все.",
			"Ночью тут лучше не шастать - фонари через раз горят."]
	_say = l[randi() % l.size()]
	_show("ask")


func _answer_goods() -> void:
	var p = _persona()
	if p.trust >= 0.35:
		_say = "Есть один барыга... За складом, в подворотне. Через арку и за угол. Только не говори, что от меня."
		_mood(0.02)
	elif p.trust >= 0.2:
		_say = "Может, и знаю. Но с чего бы мне тебе говорить?"
	else:
		_say = "Ты мент, что ли? Не знаю я ничего."
		_mood(-0.03)
	_show("ask")


func _answer_danger() -> void:
	var worst: Node3D = null
	for b in Game.bots:
		if b != bot and is_instance_valid(b) and b.alive and (b.weapon or (b.ai and b.ai._hothead)):
			worst = b
			break
	if worst:
		var wp = worst.get_meta("persona") if worst.has_meta("persona") else Persona.make(worst.bot_seed, false)
		if not worst.has_meta("persona"):
			worst.set_meta("persona", wp)
		_say = "%s. %s" % [wp.name, "С пушкой ходит, псих." if worst.weapon else "Заводится с полоборота."]
	else:
		_say = "Да вроде спокойно пока. Тьфу-тьфу."
	_show("ask")


func _answer_needs() -> void:
	var p = _persona()
	if p.wants.is_empty() or p.trust < 0.15:
		_say = "Ничего мне от тебя не нужно."
	else:
		var w: Array = p.wants[0]
		_say = "Мне бы %s. Дам %d, если найдёшь." % [p.item_name(w[0]), int(w[1] * 0.85)]
		if p.wants.size() > 1:
			_say += " Ещё %s не помешает." % p.item_name(p.wants[1][0])
	_show("ask")


# --- Trading ----------------------------------------------------------------------------------------

func _pick_item(id: String) -> void:
	_pick = id
	var p = _persona()
	var want: int = p.wants_price(id)
	_price = int(p.offered.get(id, want if want > 0 else 50))
	_say = "Ну, и сколько ты за %s хочешь?" % p.item_name(id)
	_show("sell_price")


func _price_by(d: int) -> void:
	_price = maxi(_price + d, 0)
	_show("sell_price")


## He thinks it over: wanted, and not too dear - he buys; a bit much - he
## names his own price once; too much, or not wanted - no (or he takes it
## cheap if he likes you).
func _offer() -> void:
	var p = _persona()
	var want: int = p.wants_price(_pick)
	var worth: int = want if want > 0 else (int(_base_price(_pick) * 0.35) if p.trust > 0.5 else 0)
	var limit := int(worth * lerpf(0.9, 1.15, p.trust))
	var cash: int = p.money
	if worth <= 0:
		_say = "Не, мне это не нужно."
		_show("sell_pick")
		return
	if _price <= limit and _price <= cash:
		_sell(_price)
		return
	var counter := mini(limit, cash)
	if p.offered.has(_pick) and _price >= int(p.offered[_pick]) or counter <= 0:
		_say = "Я же сказал - нет. Не такая уж это вещь." if counter > 0 else "У меня столько нет."
		_mood(-0.04)
		_show("sell_pick")
		return
	p.offered[_pick] = _price
	_say = "Дорого. %d дам, больше нет." % counter
	_opts = [["Идёт, за %d" % counter, func(): _sell(counter)], ["Нет", func(): _show("sell_price")]]
	queue_redraw()


func _sell(price: int) -> void:
	var p = _persona()
	if not inv.take(_pick, 1):
		_say = "И где оно?"
		_show("main")
		return
	inv.add("money", price)
	p.money -= price
	for w in p.wants:
		if w[0] == _pick:
			p.wants.erase(w)
			break
	_mood(0.08)
	_say = "Держи %d. Приятно иметь дело." % price
	Game.play_3d(Sfx.get_stream(&"item_pickup"), bot.chest.global_position, -8.0)
	player._after_losing(_pick)
	_show("main")


func _give(id: String) -> void:
	var p = _persona()
	if not inv.take(id, 1):
		_show("main")
		return
	player._after_losing(id)
	var wanted: bool = p.wants_price(id) > 0
	_mood(0.25 if wanted else 0.1)
	_say = ("О, спасибо! Как раз то, что надо. Я не забуду." if wanted else "Ну... спасибо, наверное.")
	for w in p.wants:
		if w[0] == id:
			p.wants.erase(w)
			break
	_show("main")


static func _base_price(id: String) -> int:
	for g in load("res://scripts/game/trader.gd").GOODS:
		if g[0] == id:
			return int(g[1])
	for w in Persona.WANTS:
		if w[0] == id:
			return int(w[1])
	return 30


# --- Favours ----------------------------------------------------------------------------------------

func _favour_smoke() -> void:
	var p = _persona()
	p.favours += 1
	if "cigarettes" in p.has and p.trust >= 0.2:
		inv.add("cigarettes", 1)
		_say = "На, держи. Последняя почти."
		_mood(-0.02)
	elif "cigarettes" in p.has:
		_say = "Самому мало."
	else:
		_say = "Не курю. Бросил."
	_show("favour")


func _favour_money() -> void:
	var p = _persona()
	p.favours += 1
	if p.trust >= 0.65 and p.money > 40 and p.favours < 3:
		var n := mini(randi_range(20, 60), p.money / 2)
		inv.add("money", n)
		p.money -= n
		_say = "Держи %d. Вернёшь, как сможешь." % n
		_mood(-0.1)
	elif p.trust >= 0.35:
		_say = "Самому бы кто одолжил."
	else:
		_say = "Ты кто такой вообще, чтоб я тебе деньги давал?"
		_mood(-0.05)
	_show("favour")


func _favour_follow() -> void:
	var p = _persona()
	p.favours += 1
	if p.trust >= 0.45:
		_say = "Ладно, пошли. Только недолго."
		_do("follow")
		close()
		return
	_say = "Ещё чего. Никуда я с тобой не пойду."
	_show("favour")


# --- Roulette ---------------------------------------------------------------------------------------

func _roulette_ask() -> void:
	var p = _persona()
	var ok: bool = (bot.ai and bot.ai._hothead) or p.trust > 0.55 or randf() < 0.25
	if not ok:
		_say = "Ты больной? Не буду я в эту херню играть."
		_show("main")
		return
	_say = "А давай. Где?"
	_show("roulette")


func _roulette_go(table: bool) -> void:
	close()
	if player.roulette == null:
		var r = load("res://scripts/game/roulette.gd").new()
		player.get_parent().add_child(r)
		r.start(player, bot, table)


func _roulette_no() -> void:
	var p = _persona()
	if _opened_by_him:
		_say = "Ссыкло. Так и знал." if p.rude or randf() < 0.5 else "Ну и зря. Как хочешь."
		_mood(-0.08)
		_do("angry_short")
	else:
		_say = "Ну и не надо."
	_show("main")


# --- Misc -------------------------------------------------------------------------------------------

func _bye() -> void:
	close()


func _mood(d: float) -> void:
	var p = _persona()
	p.trust = clampf(p.trust + d, 0.0, 1.0)


## Something for his mind to do (on the host for a client, net.gd).
func _do(what: String) -> void:
	if not Net.bot_call(bot, "net_ai", ["dialog", [what]]):
		if bot.ai:
			bot.ai.dialog_act([what], player)


# --- Input and drawing -------------------------------------------------------------------------------

func _s() -> float:
	return clampf(get_viewport_rect().size.y / 1080.0, 0.55, 2.0)


func _panel() -> Rect2:
	var vs := get_viewport_rect().size
	var s := _s()
	var w := minf(vs.x * 0.62, 900.0 * s)
	var h := (150.0 + 44.0 * _opts.size()) * s
	return Rect2(Vector2((vs.x - w) * 0.5, vs.y - h - 50.0 * s), Vector2(w, h))


func _row(i: int) -> Rect2:
	var p := _panel()
	var s := _s()
	return Rect2(p.position + Vector2(24.0 * s, 120.0 * s + i * 44.0 * s), Vector2(p.size.x - 48.0 * s, 38.0 * s))


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		_hover = -1
		for i in _opts.size():
			if _row(i).has_point(event.position):
				_hover = i
		queue_redraw()
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT and _hover >= 0:
		_choose(_hover)
	accept_event()


func _unhandled_key_input(event: InputEvent) -> void:
	if not is_open or not event.pressed:
		return
	var k := (event as InputEventKey).physical_keycode
	if k >= KEY_1 and k <= KEY_9:
		_choose(k - KEY_1)
		get_viewport().set_input_as_handled()
	elif k == KEY_ESCAPE:
		close()
		get_viewport().set_input_as_handled()


func _choose(i: int) -> void:
	if i < 0 or i >= _opts.size():
		return
	Game.play_3d(Sfx.get_stream(&"key_press"), player.global_position, -18.0, 0.1, 1.0)
	(_opts[i][1] as Callable).call()
	queue_redraw()


func _draw() -> void:
	if not is_open or bot == null or not is_instance_valid(bot):
		return
	var s := _s()
	var p := _panel()
	draw_rect(p, Color(0.04, 0.04, 0.045, 0.9))
	draw_rect(p, Color(0.4, 0.33, 0.25), false, 1.0)
	var pe = _persona()
	var mood := "доверяет" if pe.trust > 0.6 else ("нормально" if pe.trust > 0.3 else ("насторожен" if pe.trust > 0.12 else "враждебен"))
	draw_string(_font, p.position + Vector2(24, 38) * s, pe.name, HORIZONTAL_ALIGNMENT_LEFT, -1, int(24 * s), Color(0.95, 0.85, 0.6))
	draw_string(_font, p.position + Vector2(p.size.x / s - 260, 38) * s, "(%s)   ₽ %d" % [mood, inv.count("money")],
			HORIZONTAL_ALIGNMENT_LEFT, -1, int(17 * s), Color(0.65, 0.7, 0.6))
	draw_multiline_string(_font, p.position + Vector2(24, 76) * s, "— " + _say, HORIZONTAL_ALIGNMENT_LEFT, p.size.x - 48.0 * s,
			int(21 * s), 2, Color(0.92, 0.92, 0.88))
	for i in _opts.size():
		var r := _row(i)
		if i == _hover:
			draw_rect(r, Color(0.3, 0.22, 0.14, 0.9))
		draw_string(_font, r.position + Vector2(10, 27) * s, "%d. %s" % [i + 1, _opts[i][0]], HORIZONTAL_ALIGNMENT_LEFT,
				r.size.x - 20.0 * s, int(19 * s), Color(1, 1, 1, 0.95 if i == _hover else 0.8))
