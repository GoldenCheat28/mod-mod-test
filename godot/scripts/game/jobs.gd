extends Node
## Work on the side, from the foreman (Бригадир) who stands near the start
## (F on him): one job at a time, its aim and which way it is shown at the
## top left.
## - Курьер: a package to be picked up somewhere and brought to a man
##   elsewhere, before the time runs out.
## - Изготовитель: something to be made (craft_bench.gd RECIPES) and
##   brought to him.
## - Торговец: goods of his to sell to people in the street (dialog_ui.gd:
##   they buy at his price); he pays a cut when it is all gone.
## - Киллер: a man to be killed - his name, what he wears and roughly where
##   he was last seen; paid when he is dead.

const Items = preload("res://scripts/game/items.gd")
const ItemDrop = preload("res://scripts/game/item_drop.gd")
const Bench = preload("res://scripts/ui/craft_ui.gd")        # (its RECIPES)
const Trader = preload("res://scripts/game/trader.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")

const SPOT := Vector3(4.2, 0.0, 13.5)      # where the foreman stands (near the start)
const GOODS := "cigarettes"
const GOODS_N := 5
const GOODS_PRICE := 80

var at_table := false
var lod_ok := true
var foreman: Node3D = null
var job := {}                      # the one going: {kind, stage, ...}
var _label: Label
var _hint_t := 0.0
var _hint := ""
var _msg := ""
var _msg_t := 0.0


func _ready() -> void:
	var ui := CanvasLayer.new()
	ui.layer = 4
	add_child(ui)
	_label = Label.new()
	_label.position = Vector2(24, 60)
	_label.size = Vector2(700, 120)
	_label.add_theme_font_size_override("font_size", 19)
	_label.add_theme_color_override("font_color", Color(0.92, 0.88, 0.75))
	_label.add_theme_color_override("font_outline_color", Color.BLACK)
	_label.add_theme_constant_override("outline_size", 6)
	ui.add_child(_label)
	if Net.active and not Net.is_host:
		return
	# The foreman, there from the start.
	var nav: RID = Game.main.get_world_3d().navigation_map
	var at := NavigationServer3D.map_get_closest_point(nav, SPOT)
	foreman = Game.main.spawn_bot(at + Vector3.UP * 0.02, PI, -1, "jacket")
	foreman.set_meta("foreman", true)
	if foreman.ai:
		foreman.ai.roulette = self
		foreman.ai._persona().name = "Бригадир"
	var tag := Label3D.new()
	tag.text = "Бригадир"
	tag.font_size = 40
	tag.pixel_size = 0.004
	tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	tag.modulate = Color(0.95, 0.9, 0.7, 0.8)
	tag.outline_size = 8
	tag.visibility_range_end = 9.0
	tag.position = Vector3(0, 0.32, 0)
	foreman.head.add_child(tag)


# --- The foreman ------------------------------------------------------------------------

## Stands at his place; turns to the player when he comes close.
func stance_for(b: Node3D, delta: float) -> void:
	b.seat = Vector3.INF
	b.posture = b.Posture.STAND
	b.hand_goal["r"] = Vector3.INF
	b.hand_goal["l"] = Vector3.INF
	var me: Vector3 = b.position_ground()
	if b == foreman:
		var nav: RID = b.get_world_3d().navigation_map
		var home := NavigationServer3D.map_get_closest_point(nav, SPOT)
		var to := Vector3(home.x - me.x, 0.0, home.z - me.z)
		if to.length() > 0.5:
			b.move_velocity = to.normalized() * 1.1
			b.facing = (b.facing as Vector3).slerp(to.normalized(), minf(delta * 5.0, 1.0)).normalized()
			return
	b.move_velocity = Vector3.ZERO
	var p = Game.player
	if p and p.global_position.distance_to(me) < 6.0:
		var f := Vector3(p.global_position.x - me.x, 0.0, p.global_position.z - me.z)
		if f.length() > 0.1:
			b.facing = (b.facing as Vector3).slerp(f.normalized(), minf(delta * 4.0, 1.0)).normalized()
		b.look_target = p.cam.global_position
		b.has_look_target = true


## What one can say to him (dialog_ui.gd): [[text, Callable -> his answer], ...]
func foreman_options() -> Array:
	var opts: Array = []
	if job.is_empty():
		opts.append(["Работа курьером", func(): return _take("courier")])
		opts.append(["Работа: изготовить на заказ", func(): return _take("craft")])
		opts.append(["Работа: торговать", func(): return _take("trade")])
		opts.append(["Работа: убрать человека", func(): return _take("kill")])
	else:
		if _can_hand_in():
			opts.append(["Сдать работу", func(): return _hand_in()])
		opts.append(["Что мне делать?", func(): return _remind()])
		opts.append(["Отказаться от работы", func(): return _give_up("Ну и вали. Другого найду.")])
	return opts


func _take(kind: String) -> String:
	var p = Game.player
	match kind:
		"courier":
			var nav: RID = p.get_world_3d().navigation_map
			var pick := Vector3.INF
			for i in 30:
				var q := NavigationServer3D.map_get_random_point(nav, 1, true)
				var d := q.distance_to(foreman.global_position)
				if q.y < 1.0 and d > 20.0 and d < 55.0:
					pick = q
					break
			var to := _someone(pick if pick != Vector3.INF else foreman.global_position, 18.0)
			if pick == Vector3.INF or to == null:
				return "Сейчас ничего нет. Зайди попозже."
			var pkg: RigidBody3D = ItemDrop.spawn(Game.main, "package", 1, Transform3D(Basis(Vector3.UP, randf() * TAU), pick + Vector3.UP * 0.2), Vector3.ZERO)
			_hold(to)
			to.set_meta("job_recipient", true)
			var reward := 200 + int(pick.distance_to(to.global_position) * 4.0)
			job = {"kind": "courier", "stage": "pickup", "pkg": pkg, "at": pick, "to": to, "reward": reward, "time": 240.0,
					"name": to.ai._persona().name}
			return "Забери посылку - она лежит %s. Получатель - %s, он ждёт. Четыре минуты. Заплачу %d." % [_where(pick), job["name"], reward]
		"craft":
			var picks: Array = []
			for r in Bench.RECIPES:
				picks.append(r)
			var r: Dictionary = picks.pick_random()
			var n: int = int(r["count"]) * (1 if int(r["count"]) > 1 else randi_range(1, 2))
			var cost := 0
			for need in (r["needs"] as Dictionary).keys():
				cost += _price(need) * int(r["needs"][need])
			var reward := int(float(cost) * float(n) / float(r["count"]) * 1.6) + 150
			job = {"kind": "craft", "stage": "make", "id": r["id"], "n": n, "reward": reward, "name": r["name"]}
			return "Нужно: %s, %d шт. Чертёж у тебя в блокноте (C). Материал - у торговца в гаражах. Принесёшь - %d." % [r["name"], n, reward]
		"trade":
			var inv = p.inventory
			if inv.find_room(GOODS) == null and not inv.has(GOODS):
				return "Рюкзак у тебя забит. Освободи место."
			inv.add(GOODS, GOODS_N)
			job = {"kind": "trade", "stage": "sell", "sold": 0, "reward": 200}
			return "Вот %d пачек сигарет. Продай людям по %d - деньги твои. Как всё уйдёт - приходи, накину 200." % [GOODS_N, GOODS_PRICE]
		"kill":
			var t := _someone(foreman.global_position, 25.0)
			if t == null:
				return "Сейчас никого. Позже."
			t.set_meta("contract", true)
			var reward := 900 + randi_range(0, 6) * 50
			job = {"kind": "kill", "stage": "hunt", "who": t, "reward": reward, "name": t.ai._persona().name, "look": _looks(t), "seen": t.global_position, "seen_t": 0.0}
			return "Есть один. %s, %s. Последний раз видели %s. Сделаешь - %d. И без лишних глаз." % [job["name"], job["look"], _where(t.global_position), reward]
	return ""


func _remind() -> String:
	match job.get("kind", ""):
		"courier":
			return "Посылка - %s, получатель - %s. Время идёт." % [_where(job["at"]), job["name"]] if job["stage"] == "pickup" \
					else "Неси посылку. Получатель - %s, он %s." % [job["name"], _where((job["to"] as Node3D).global_position)]
		"craft":
			return "Жду %s, %d шт." % [job["name"], job["n"]]
		"trade":
			return "Продал %d из %d. Работай." % [job["sold"], GOODS_N]
		"kill":
			return "%s, %s. Видели %s." % [job["name"], job["look"], _where(job["seen"])]
	return ""


func _can_hand_in() -> bool:
	match job.get("kind", ""):
		"craft":
			return Game.player.inventory.count(job["id"]) >= int(job["n"])
		"trade":
			return int(job["sold"]) >= GOODS_N
		"kill":
			return job["stage"] == "paid_on_return"
	return false


func _hand_in() -> String:
	var inv = Game.player.inventory
	var reward: int = job["reward"]
	match job["kind"]:
		"craft":
			for i in int(job["n"]):
				inv.take(job["id"], 1)
			Game.player._after_losing(job["id"])
	inv.add("money", reward)
	Game.play_3d(Sfx.get_stream(&"item_pickup"), foreman.chest.global_position, -8.0)
	var kind: String = job["kind"]
	_end()
	return {"craft": "Нормально сделано. Держи %d.", "trade": "Всё продал? Молодец. %d сверху.",
			"kill": "Слышал уже. Чисто сработал. %d, как договаривались."}[kind] % reward


func _give_up(line: String) -> String:
	_fail("")
	return line


# --- Going on ----------------------------------------------------------------------------

func _process(delta: float) -> void:
	_msg_t -= delta
	if job.is_empty():
		_label.text = _msg if _msg_t > 0.0 else ""
		return
	var p = Game.player
	if p == null:
		return
	_hint_t -= delta
	var line := ""
	match job["kind"]:
		"courier":
			job["time"] = float(job["time"]) - delta
			var to: Node3D = job["to"]
			if not is_instance_valid(to) or not to.alive:
				_fail("Получатель мёртв. Работа сорвана.")
				return
			if float(job["time"]) <= 0.0:
				_fail("Не успел. Работа провалена.")
				return
			if job["stage"] == "pickup" and p.inventory.has("package"):
				job["stage"] = "deliver"
			if job["stage"] == "deliver" and not p.inventory.has("package"):
				var pkg = job["pkg"]
				if pkg == null or not is_instance_valid(pkg):
					job["stage"] = "pickup"
					var dropped := _find_package()
					if dropped:
						job["pkg"] = dropped
						job["at"] = dropped.global_position
			var tl := "%d:%02d" % [int(job["time"]) / 60, int(job["time"]) % 60]
			if job["stage"] == "pickup":
				var pk = job["pkg"]
				var at: Vector3 = pk.global_position if pk != null and is_instance_valid(pk) else job["at"]
				line = "Курьер (%s): забери посылку - %s" % [tl, _dir(at)]
			else:
				line = "Курьер (%s): отнеси посылку (получатель: %s) - %s  [F - отдать]" % [tl, job["name"], _dir(to.global_position)]
		"craft":
			line = "Заказ: %s - %d/%d. Сдать бригадиру - %s" % [job["name"], mini(p.inventory.count(job["id"]), job["n"]), job["n"],
					_dir(foreman.global_position) if is_instance_valid(foreman) else "?"]
		"trade":
			if int(job["sold"]) >= GOODS_N:
				line = "Торговля: всё продано. Вернись к бригадиру - %s" % _dir(foreman.global_position)
			else:
				line = "Торговля: продай сигареты людям по %d ₽ - %d/%d" % [GOODS_PRICE, job["sold"], GOODS_N]
				if not p.inventory.has(GOODS):
					_fail("Товара больше нет. Работа сорвана.")
					return
		"kill":
			var t: Node3D = job["who"]
			if job["stage"] == "hunt":
				if not is_instance_valid(t) or not t.alive:
					job["stage"] = "paid_on_return"
				else:
					# Word of where he is, now and then (not every second).
					job["seen_t"] = float(job["seen_t"]) - delta
					if float(job["seen_t"]) <= 0.0:
						job["seen_t"] = 20.0
						job["seen"] = t.global_position
					line = "Заказ: %s (%s). Видели %s" % [job["name"], job["look"], _dir(job["seen"], true)]
			if job["stage"] == "paid_on_return":
				line = "Заказ выполнен. За деньгами к бригадиру - %s" % _dir(foreman.global_position)
	_label.text = line + ("\n" + _msg if _msg_t > 0.0 else "")


## The trader's goods sold to someone (dialog_ui.gd).
func on_sold(id: String) -> void:
	if job.get("kind", "") == "trade" and id == GOODS:
		job["sold"] = int(job["sold"]) + 1
		if int(job["sold"]) >= GOODS_N:
			_say("Всё продано - к бригадиру за процентом.")


## What a man pays for the trader's goods (dialog_ui.gd): -1 if it is not the job.
func trade_price(id: String) -> int:
	return GOODS_PRICE if job.get("kind", "") == "trade" and id == GOODS else -1


func is_recipient(b: Node3D) -> bool:
	return job.get("kind", "") == "courier" and job.get("to") == b


## The package handed over (dialog_ui.gd).
func deliver(b: Node3D) -> String:
	if not is_recipient(b) or not Game.player.inventory.take("package", 1):
		return "Где посылка?"
	var reward: int = job["reward"]
	Game.player.inventory.add("money", reward)
	Game.play_3d(Sfx.get_stream(&"item_pickup"), b.chest.global_position, -8.0)
	_end()
	return "Наконец-то. Держи %d." % reward


func _end() -> void:
	var to = job.get("to")
	if to != null and is_instance_valid(to):
		to.remove_meta("job_recipient")
		_release(to)
	var who = job.get("who")
	if who != null and is_instance_valid(who) and who.has_meta("contract"):
		who.remove_meta("contract")
	job = {}


func _fail(why: String) -> void:
	var pkg = job.get("pkg")
	if pkg != null and is_instance_valid(pkg):
		pkg.queue_free()
	if job.get("kind", "") == "courier" and Game.player.inventory.has("package"):
		Game.player.inventory.take("package", 1)
	_end()
	if why != "":
		_say(why)


func _say(text: String) -> void:
	_msg = text
	_msg_t = 5.0


# --- Helpers ------------------------------------------------------------------------------

## Someone about (free, not one of the staff) at least `min_d` from `from`.
func _someone(from: Vector3, min_d: float) -> Node3D:
	var cands: Array = []
	for b in Game.bots:
		if not is_instance_valid(b) or not b.alive or b.ai == null or b == foreman:
			continue
		if b.has_meta("judge") or b.has_meta("guard") or b.has_meta("bartender") or b.has_meta("cleaner") or b.has_meta("trader") \
				or b.has_meta("puppet") or b.has_meta("contract") or b.has_meta("job_recipient"):
			continue
		if b.ai.roulette != null or b.cuffed or b.weapon:
			continue
		if b.global_position.distance_to(from) >= min_d:
			cands.append(b)
	return cands.pick_random() if not cands.is_empty() else null


## Keeps the recipient where he is (waiting for his package).
func _hold(b: Node3D) -> void:
	var ai = b.ai
	if ai.act:
		ai._end_activity()
	ai._path = PackedVector3Array()
	ai._enter(ai.S.IDLE)
	ai.roulette = self


func _release(b: Node3D) -> void:
	if b.ai and b.ai.roulette == self:
		b.ai.roulette = null
		if b.alive:
			b.ai._enter(b.ai.S.WANDER)


func _find_package() -> Node3D:
	for n in get_tree().get_nodes_in_group(&"item_drops"):
		if n.get("id") == "package":
			return n
	for n in Game.main.get_children():
		if n.get("id") == "package" and n is RigidBody3D:
			return n
	return null


func _price(id: String) -> int:
	for g in Trader.GOODS:
		if g[0] == id:
			return int(g[1])
	return 30


func _looks(b: Node3D) -> String:
	return {"suit": "в костюме", "hoodie": "в худи", "tracksuit": "в спортивном костюме", "jacket": "в куртке",
			"casual": "в футболке"}.get(b.outfit, "")


## Where a place is, said as one would say it: which part of the area.
func _where(p: Vector3) -> String:
	var parts := []
	if p.z < -15.0:
		parts.append("на севере, у заброшки и гаражей")
	elif p.z > 15.0:
		parts.append("на юге, у трёхэтажек")
	else:
		parts.append("посередине, на улице")
	if p.x < -12.0:
		parts.append("с запада")
	elif p.x > 12.0:
		parts.append("с востока")
	return " ".join(parts)


## Which way and how far, from the player's eyes: ahead/right/left/behind.
func _dir(to: Vector3, rough := false) -> String:
	var cam: Camera3D = Game.player.cam
	var d: Vector3 = to - cam.global_position
	var flat := Vector3(d.x, 0.0, d.z)
	var dist := flat.length()
	if dist < 2.0:
		return "здесь"
	var fwd := -cam.global_basis.z
	fwd.y = 0.0
	var a := rad_to_deg(fwd.normalized().signed_angle_to(flat.normalized(), Vector3.UP))
	var way := "впереди" if absf(a) < 30.0 else ("сзади" if absf(a) > 140.0 else ("слева" if a > 0.0 else "справа"))
	var m := int(round(dist / 10.0) * 10.0) if rough else int(dist)
	var up := ""
	if d.y > 2.5:
		up = ", выше"
	elif d.y < -2.5:
		up = ", ниже"
	return "%s, %s%d м%s" % [way, "~" if rough else "", m, up]


## A package: a box in brown paper, tied round with tape.
static func package_model() -> Node3D:
	var root := Node3D.new()
	var box := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.28, 0.16, 0.2)
	box.mesh = bm
	var paper := StandardMaterial3D.new()
	paper.albedo_color = Color(0.55, 0.42, 0.28)
	paper.roughness = 0.95
	box.material_override = paper
	root.add_child(box)
	var tape := StandardMaterial3D.new()
	tape.albedo_color = Color(0.75, 0.7, 0.55)
	tape.roughness = 0.4
	for k in 2:
		var t := MeshInstance3D.new()
		var tm := BoxMesh.new()
		tm.size = Vector3(0.285, 0.165, 0.04) if k == 0 else Vector3(0.05, 0.165, 0.205)
		t.mesh = tm
		t.material_override = tape
		root.add_child(t)
	return root
