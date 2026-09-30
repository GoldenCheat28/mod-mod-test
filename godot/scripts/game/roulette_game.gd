extends Node
## Russian roulette round a table for three or five (tall_building.gd's
## game tables): bots among themselves, or with the player in one of the
## chairs. Everyone walks to his chair and sits; one round goes into the
## revolver, the cylinder is spun, and it goes round the table from hand to
## hand - each puts it to his own temple and pulls. Whoever it fires for is
## out (he goes down on the table); a fresh round goes in and it goes on
## until one is left. He takes the money on the table: stacks of 100, which
## the player picks up one by one (F), and a bot gathers up himself.
## At the event table a judge stands by and says what happens, all of it.
##
## Made and run by table_games.gd; to the bots playing (bot_ai.roulette) and
## to the player (player.roulette) it is what roulette.gd is.

const Revolver = preload("res://scripts/weapons/revolver.gd")
const Roulette = preload("res://scripts/game/roulette.gd")
const ItemDrop = preload("res://scripts/game/item_drop.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")

const GATHER_TIME := 70.0        # to get to the chairs; whoever is not there by then is left out
const HEAR_DIST := 16.0          # the judge's words (and the bars) reach the player this near
const STACK := 100               # roubles in a stack

var table := {}
var table_i := -1
var prize := 0
var judge: Node3D = null
var at_table := true             # (as roulette.gd: they sit)
var state := "gather"
var gun: Node3D
var player: Node3D = null        # the player, while one of them
var over := false

## Everyone in it: {who, player, seat, sat, out, path, pi, name}
var seats_taken: Array = []
var _turn := -1                  # index in seats_taken of whoever has the gun
var _t := 0.0
var _flags := {}
var _wait := 0.0
var _spin_v := 0.0
var _from := Transform3D()
var _stacks: Array = []
var _winner := {}
var _manager: Node

var _label: Label
var _msg_t := 0.0
var _bars: Array = []
var _bar_k := 0.0
var _beat := 0.0


func setup(manager: Node, t_i: int, money: int, the_judge: Node3D) -> void:
	_manager = manager
	table_i = t_i
	table = Game.main.map.game_tables[t_i]
	prize = money
	judge = the_judge
	if judge and judge.ai:
		judge.ai.roulette = self


func _ready() -> void:
	var bars_ui := CanvasLayer.new()
	bars_ui.layer = 3
	add_child(bars_ui)
	var ui := CanvasLayer.new()
	ui.layer = 4
	add_child(ui)
	_label = Label.new()
	_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_label.position = Vector2(-450, 90)
	_label.size = Vector2(900, 60)
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_label.add_theme_font_size_override("font_size", 26)
	_label.add_theme_color_override("font_color", Color(0.95, 0.9, 0.78))
	_label.add_theme_color_override("font_outline_color", Color.BLACK)
	_label.add_theme_constant_override("outline_size", 8)
	_label.modulate.a = 0.0
	ui.add_child(_label)
	for k in 2:
		var bar := ColorRect.new()
		bar.color = Color.BLACK
		bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
		bars_ui.add_child(bar)
		_bars.append(bar)


# --- Who plays --------------------------------------------------------------------------

func free_seat() -> int:
	for i in (table["seats"] as Array).size():
		if _in_seat(i).is_empty():
			return i
	return -1


func _in_seat(i: int) -> Dictionary:
	for p in seats_taken:
		if int(p["seat"]) == i:
			return p
	return {}


func add_bot(b: Node3D, seat: int) -> void:
	var ai = b.ai
	if ai.act:
		ai._end_activity()
	if ai.talk and ai.talk.busy():
		ai.talk.end()
	ai._path = PackedVector3Array()
	ai._enter(ai.S.IDLE)
	ai.roulette = self
	b.hand_goal["r"] = Vector3.INF
	b.hand_goal["l"] = Vector3.INF
	var nm: String = ai._persona().name
	# (two of the same name at one table: the second is told apart)
	for p in seats_taken:
		if p["name"] == nm:
			nm += " " + ["Второй", "Мелкий", "Длинный", "Лысый"][seats_taken.size() % 4]
	seats_taken.append({"who": b, "player": false, "seat": seat, "sat": false, "out": false,
			"path": PackedVector3Array(), "pi": 0, "name": nm})


## The player takes chair `seat` (F on it): into the game if it has not
## begun (a bot on his way to that chair goes off again).
func add_player(p: Node3D, seat: int) -> bool:
	if state != "gather" or over:
		p._notify("Игра уже идёт")
		return false
	var there := _in_seat(seat)
	if not there.is_empty():
		if there["player"] or there["sat"]:
			p._notify("Место занято")
			return false
		_release_bot(there["who"])
		seats_taken.erase(there)
	player = p
	p.roulette = self
	p._switch_to("hands")
	seats_taken.append({"who": p, "player": true, "seat": seat, "sat": false, "out": false, "name": "ты"})
	var s := _seat(seat)
	var stand := _stand_point(seat)
	p.cine_busy = true
	p.seat_at = p.global_position
	p.seat_eye = p.EYE_HEIGHT
	p._seat_stand = stand
	_flags["p_from"] = p.global_position
	_flags["p_t"] = 0.0
	_judge_say(["Садись. Правила простые: один патрон, крутишь, жмёшь.",
			"Ещё один смелый. Садись, раз пришёл.", "О, новенький. Место твоё."].pick_random(), 3.0)
	if s.is_empty():
		return false
	return true


func _seat(i: int) -> Dictionary:
	var arr: Array = table["seats"]
	return arr[i] if i >= 0 and i < arr.size() else {}


func _stand_point(i: int) -> Vector3:
	var at: Vector3 = _seat(i)["pos"]
	var c: Vector3 = table["center"]
	var out := Vector3(at.x - c.x, 0.0, at.z - c.z).normalized()
	return at + out * 0.5


func _alive_in() -> Array:
	var r: Array = []
	for p in seats_taken:
		if not p["out"]:
			r.append(p)
	return r


# --- The judge ------------------------------------------------------------------------

func _judge_say(text: String, time := 3.0) -> void:
	var who := "Судья: " if judge and is_instance_valid(judge) and judge.alive else ""
	_label.text = who + text
	_msg_t = time
	if judge and is_instance_valid(judge) and judge.alive and judge.ai and judge.ai.talk:
		# (his mouth moving, if he has something to say it with)
		judge.set_meta("speaking_until", Game.clock + time)


func _hears() -> bool:
	var p = Game.player
	if p == null or not is_instance_valid(p):
		return false
	if player != null:
		return true
	return p.global_position.distance_to(table["center"]) < HEAR_DIST


# --- The run of it --------------------------------------------------------------------

func _process(delta: float) -> void:
	_msg_t -= delta
	_label.modulate.a = clampf(_msg_t * 2.0, 0.0, 1.0) * (1.0 if _hears() else 0.0)
	var vs := get_viewport().get_visible_rect().size
	var on: bool = player != null and not over and state != "gather"
	_bar_k = move_toward(_bar_k, 1.0 if on else 0.0, delta * 1.5)
	var h := vs.y * 0.1 * smoothstep(0.0, 1.0, _bar_k)
	if _bars.size() == 2:
		_bars[0].position = Vector2.ZERO
		_bars[0].size = Vector2(vs.x, h)
		_bars[1].position = Vector2(0, vs.y - h)
		_bars[1].size = Vector2(vs.x, h)
	_label.position.y = maxf(90.0, h + 18.0)


func _physics_process(delta: float) -> void:
	_t += delta
	if over:
		return
	if player != null:
		_player_seat(delta)
	# Anyone of them hurt (not by the game), gone down or off: it is off.
	for p in seats_taken:
		if p["out"] or p["player"] or state == "collect":
			continue
		var b: Node3D = p["who"]
		# (slipping on his chair is not leaving the game: he is sat back on it)
		if not is_instance_valid(b) or not b.alive or not b.conscious or (b.fallen and not p["sat"]) or b.cuffed:
			if state == "gather":
				seats_taken.erase(p)
				if is_instance_valid(b):
					_release_bot(b)
				if _manager and _manager.has_method("refill") and _is_event():
					_manager.refill(self)
				return
			if OS.is_debug_build():
				print("roulette_game: %s off (valid=%s alive=%s conscious=%s fallen=%s cuffed=%s) in %s" % [p["name"], is_instance_valid(b),
						is_instance_valid(b) and b.alive, is_instance_valid(b) and b.conscious, is_instance_valid(b) and b.fallen,
						is_instance_valid(b) and b.cuffed, state])
			_abort("Стрельба не по правилам. Игра окончена, все по домам.")
			return
	if player != null and (not is_instance_valid(player) or player._dead) and state != "win" and state != "collect":
		for p in seats_taken:
			if p["player"] and not p["out"]:
				_abort("Игрок выбыл. Расходимся.")
				return
	match state:
		"gather":
			_gather()
		"load":
			_load(delta)
		"raise":
			_move(_hold_pose(_cur()), _temple_pose(_cur()), 0.9, 0.2)
			_in_hand(_cur(), smoothstep(0.2, 0.9, _t))
			if _t > 1.2:
				if _cur()["player"]:
					_judge_say("ЛКМ - нажать на спуск", 30.0)
				_wait = randf_range(1.2, 3.4)
				_go("wait")
		"wait":
			gun.global_transform = _temple_pose(_cur())
			_in_hand(_cur(), 1.0)
			if _cur()["player"]:
				_heartbeat(delta)
				if Game.is_mouse_captured() and Input.is_action_just_pressed("fire"):
					_msg_t = 0.0
					_go("pull")
			elif _t > _wait:
				_go("pull")
		"pull":
			gun.global_transform = _temple_pose(_cur())
			_in_hand(_cur(), 1.0)
			if _once("cock"):
				Game.play_3d(Sfx.get_stream(&"rev_cock"), gun.global_position, -6.0, 0.05, 1.0)
			gun.hammer = clampf(_t / 0.35, 0.0, 1.0)
			if _t > 0.35:
				gun.hammer = 0.0
				if gun.fire():
					_bang()
				else:
					Game.play_3d(Sfx.get_stream(&"rev_dry"), gun.muzzle(), -1.0, 0.05, 1.0)
					var who: String = _cur()["name"]
					_judge_say(["Щелчок. %s живёт." % who, "Пусто. Повезло тебе, %s." % who, "Щелчок! Передаём дальше.",
							"Осечки нет - просто пусто. Следующий.", "Живой. Дальше по кругу."].pick_random()
							if not _cur()["player"] else ["Щелчок. Живой, поздравляю.", "Пусто. Руки-то трясутся?"].pick_random(), 2.2)
					_go("lower")
		"lower":
			_move(_temple_pose(_cur()), _hold_pose(_cur()), 0.7, 0.4)
			_in_hand(_cur(), 1.0 - smoothstep(0.4, 1.0, _t))
			if _t > 1.2:
				_from = gun.global_transform
				_turn = _next(_turn)
				_go("pass")
		"pass":
			_move(_from, _hold_pose(_cur()), 1.0)
			_in_hand(_cur(), smoothstep(0.5, 1.0, _t))
			if _once("say"):
				_announce_turn()
			if _t > 1.1:
				_go("raise")
		"after":
			# (the gun lies where it fell, on the table: the judge picks it up
			# and puts a fresh round in)
			if _t > 2.6:
				if _alive_in().size() <= 1:
					_win()
				else:
					_turn = _next(_turn)
					_new_gun()
					_judge_say(["Новый патрон. Крутим барабан.", "Один выбыл. Заряжаю заново.",
							"Уберите руки со стола. Заряжаю."].pick_random(), 2.5)
					_go("load")
		"collect":
			_collect(delta)
	if gun and is_instance_valid(gun) and state in ["raise", "wait", "pull", "lower", "pass"] and not _cur()["player"]:
		(_cur()["who"] as Node3D).hand_goal["r"] = gun.grip()


func _go(s: String) -> void:
	state = s
	_t = 0.0
	_flags.clear()


func _once(key: String, at := 0.0) -> bool:
	var k := state + key
	if _t < at or _flags.has(k):
		return false
	_flags[k] = true
	return true


func _cur() -> Dictionary:
	return seats_taken[_turn] if _turn >= 0 and _turn < seats_taken.size() else {}


## The next one round the table still in it (by the chairs' order).
func _next(from: int) -> int:
	var n := seats_taken.size()
	var here: int = int(seats_taken[from]["seat"]) if from >= 0 else -1
	var best := -1
	var best_d := 99
	var slots: int = (table["seats"] as Array).size()
	for i in n:
		var p: Dictionary = seats_taken[i]
		if p["out"]:
			continue
		var d := (int(p["seat"]) - here + slots) % slots
		if d == 0:
			d = slots
		if d < best_d:
			best_d = d
			best = i
	return best


func _announce_turn() -> void:
	var c := _cur()
	if c["player"]:
		_judge_say(["Твоя очередь.", "Револьвер у тебя. Не тяни.", "Ну, твой ход, герой."].pick_random(), 2.0)
	else:
		_judge_say(["%s, твой ход." % c["name"], "Ход: %s." % c["name"],
				"%s берёт револьвер." % c["name"], "Стреляет %s. Не торопись." % c["name"]].pick_random(), 2.2)


# --- Gathering ----------------------------------------------------------------------------

func _is_event() -> bool:
	return table.get("kind", "") == "event"


## The judge there and standing at his place (at the event), or no judge
## needed (a small table).
func _judge_ready() -> bool:
	if not _is_event():
		return true
	if judge == null or not is_instance_valid(judge) or not judge.alive or not judge.conscious or judge.fallen:
		return false
	var spot: Vector3 = table["judge"]
	var me: Vector3 = judge.position_ground()
	return Vector2(spot.x - me.x, spot.z - me.z).length() < 0.6


## At the event: every chair taken (five, exactly) and the judge at his
## place - not before. A small table: two or more, sat.
func _gather() -> void:
	var need: int = (table["seats"] as Array).size() if _is_event() else 2
	var all_sat := seats_taken.size() >= need
	for p in seats_taken:
		all_sat = all_sat and p["sat"]
	if _once("hello"):
		_judge_say("Собираемся за столом. Нужно %d игроков. Приз - %d ₽. Свободный стул - F." % [need, prize] if _is_event()
				else "Садимся. На кону %d ₽." % prize, 4.0)
	if _is_event() and (judge == null or not is_instance_valid(judge) or not judge.alive):
		_abort("Судьи нет - игры не будет.")
		return
	if all_sat and _judge_ready() and _t > 2.0:
		_judge_say(["Все пятеро на местах. Начинаем.", "Все сели. Правила: один патрон, по кругу, до последнего.",
				"Двери закрыты. Играем."].pick_random() if _is_event() else "Все сели. Начинаем.", 3.0)
		_turn = randi() % seats_taken.size()
		_new_gun()
		_go("load")
		return
	if all_sat and not _judge_ready() and _once("wait_judge", 3.0):
		_judge_say("Ждём судью.", 2.0)
	if _is_event() and seats_taken.size() < need and _manager and _manager.has_method("refill") and _once("refill%d" % int(_t / 5.0)):
		_manager.refill(self)
	if _t > GATHER_TIME:
		# Those not there by now are out of it (at the event, others come instead).
		for p in seats_taken.duplicate():
			if not p["sat"] and not p["player"]:
				_release_bot(p["who"])
				seats_taken.erase(p)
		if _is_event():
			if _manager and _manager.has_method("refill"):
				_manager.refill(self)
			_judge_say("Кто не успел - тот не играет. Ищем ещё людей.", 3.0)
			_t = 3.0
			for k in _flags.keys():
				if str(k).begins_with("gatherrefill"):
					_flags.erase(k)
		elif seats_taken.size() < 2:
			_abort("Не набралось игроков. В другой раз.")
		elif _once("late"):
			_t = GATHER_TIME - 2.5


## Walking him to his chair (and down onto it): from bot_ai, every frame.
func stance_for(b: Node3D, delta: float) -> void:
	if b == judge:
		_judge_stance(b, delta)
		return
	var p := {}
	for x in seats_taken:
		if x["who"] == b:
			p = x
	if p.is_empty():
		return
	var c: Vector3 = table["center"]
	var seat: int = p["seat"]
	var at: Vector3 = _seat(seat)["pos"]
	var me: Vector3 = b.position_ground()
	if p["out"]:
		return
	if not p["sat"]:
		var stand := _stand_point(seat)
		var path: PackedVector3Array = p["path"]
		if path.is_empty():
			var nav: RID = b.get_world_3d().navigation_map
			path = NavigationServer3D.map_get_path(nav, NavigationServer3D.map_get_closest_point(nav, me),
					NavigationServer3D.map_get_closest_point(nav, stand), true)
			if path.is_empty():
				path = PackedVector3Array([stand])
			p["path"] = path
			p["pi"] = 0
		var i: int = p["pi"]
		while i < path.size() and Vector2(path[i].x - me.x, path[i].z - me.z).length() < 0.35:
			i += 1
		p["pi"] = i
		var goal: Vector3 = path[i] if i < path.size() else stand
		var to := Vector3(goal.x - me.x, 0.0, goal.z - me.z)
		var left := Vector3(stand.x - me.x, 0.0, stand.z - me.z).length()
		if left < 0.3 or (i >= path.size() and to.length() < 0.3):
			p["sat"] = true
			b.move_velocity = Vector3.ZERO
			Game.play_3d(Sfx.get_stream(&"body_fall"), at + Vector3.UP * 0.4, -20.0, 0.1, 2.0)
			if state == "gather" and _once("sat" + str(seat)):
				_judge_say(["%s сел за стол." % p["name"], "%s на месте." % p["name"], "%s занял стул." % p["name"]].pick_random(), 2.0)
		else:
			# (stuck somewhere on the way for a while: a new path from where he is)
			var last: Vector3 = p.get("last_pos", me)
			if me.distance_to(last) > 0.5:
				p["last_pos"] = me
				p["stuck_t"] = 0.0
			else:
				p["stuck_t"] = float(p.get("stuck_t", 0.0)) + delta
				if float(p["stuck_t"]) > 3.0:
					p["stuck_t"] = 0.0
					p["path"] = PackedVector3Array()
					b.move_velocity = -to.normalized() * 0.8 + to.normalized().cross(Vector3.UP) * 0.8
					return
			var path_left := left
			if i < path.size():
				path_left = Vector2(path[path.size() - 1].x - me.x, path[path.size() - 1].z - me.z).length()
			var sp := 2.3 if path_left > 8.0 else clampf(left * 2.0, 0.7, 1.5)
			b.move_velocity = to.normalized() * sp
			b.facing = (b.facing as Vector3).slerp(to.normalized(), minf(delta * 6.0, 1.0)).normalized()
			b.posture = b.Posture.STAND
			b.seat = Vector3.INF
			return
	# Sat, turned to the table, watching whoever has the gun.
	b.move_velocity = Vector3.ZERO
	b.seat = at + Vector3.UP * float(table["seat_h"])
	b.posture = b.Posture.SIT
	b.facing = Vector3(c.x - at.x, 0.0, c.z - at.z).normalized()
	var cur := _cur()
	if not cur.is_empty() and cur["who"] != b and is_instance_valid(cur["who"]):
		b.look_target = _head_of(cur)
	else:
		b.look_target = c + Vector3.UP * 0.8
	b.has_look_target = true
	b.hand_goal["l"] = Vector3.INF
	if cur.is_empty() or cur["who"] != b or not state in ["raise", "wait", "pull", "lower", "pass"]:
		b.hand_goal["r"] = Vector3.INF


func _judge_stance(b: Node3D, delta: float) -> void:
	var spot: Vector3 = table["judge"]
	var c: Vector3 = table["center"]
	var me: Vector3 = b.position_ground()
	var to := Vector3(spot.x - me.x, 0.0, spot.z - me.z)
	b.seat = Vector3.INF
	b.posture = b.Posture.STAND
	if to.length() > 0.35:
		b.move_velocity = to.normalized() * 1.2
		b.facing = (b.facing as Vector3).slerp(to.normalized(), minf(delta * 6.0, 1.0)).normalized()
	else:
		b.move_velocity = Vector3.ZERO
		b.facing = Vector3(c.x - me.x, 0.0, c.z - me.z).normalized()
	var cur := _cur()
	b.look_target = _head_of(cur) if not cur.is_empty() and is_instance_valid(cur["who"]) else c + Vector3.UP * 0.8
	b.has_look_target = true
	b.hand_goal["r"] = Vector3.INF
	b.hand_goal["l"] = Vector3.INF


func _head_of(p: Dictionary) -> Vector3:
	var w: Node3D = p["who"]
	if p["player"]:
		return w.cam.global_position
	return w.head.global_position


## The player walked to the chair (the view gliding there) and down onto it.
func _player_seat(delta: float) -> void:
	var me := {}
	for x in seats_taken:
		if x["player"]:
			me = x
	if me.is_empty() or me["sat"] or not is_instance_valid(player):
		return
	var seat: int = me["seat"]
	var at: Vector3 = _seat(seat)["pos"]
	var stand := _stand_point(seat)
	var c: Vector3 = table["center"]
	_flags["p_t"] = float(_flags.get("p_t", 0.0)) + delta
	var t: float = _flags["p_t"]
	var from: Vector3 = _flags.get("p_from", player.global_position)
	var to_table := c - at
	var sit_yaw := atan2(-to_table.x, -to_table.z)
	player.yaw = lerp_angle(player.yaw, sit_yaw, minf(delta * 4.0, 1.0))
	player.pitch = lerpf(player.pitch, -0.2, minf(delta * 3.0, 1.0))
	if t < 1.0:
		player.seat_at = from.lerp(stand, smoothstep(0.0, 1.0, t))
	else:
		var k := clampf(t - 1.0, 0.0, 1.0)
		player.seat_at = stand.lerp(Vector3(at.x, at.y, at.z), smoothstep(0.0, 0.7, k))
		player.seat_eye = lerpf(player.EYE_HEIGHT, 1.18, smoothstep(0.0, 1.0, k))
		if k >= 1.0:
			me["sat"] = true
			player.cine_busy = false
			Game.play_3d(Sfx.get_stream(&"body_fall"), at + Vector3.UP * 0.4, -18.0, 0.1, 2.0)


# --- The gun ------------------------------------------------------------------------------

func _new_gun() -> void:
	if gun and is_instance_valid(gun):
		gun.queue_free()
	gun = Revolver.new()
	Game.main.add_child(gun)
	gun.global_transform = _hold_pose(_cur())
	gun.loaded = randi() % Revolver.CHAMBERS
	gun.chamber = gun.loaded


## Loading in the hand of whoever goes first: cylinder out, the round in,
## shut, spun.
func _load(delta: float) -> void:
	gun.global_transform = _hold_pose(_cur())
	var t := _t
	gun.open = clampf(t / 0.5, 0.0, 1.0) if t < 1.6 else clampf(1.0 - (t - 1.6) / 0.25, 0.0, 1.0)
	gun.round_in = clampf((t - 0.5) / 0.9, 0.0, 1.0)
	if _once("open", 0.05):
		Game.play_3d(Sfx.get_stream(&"rev_cyl_open"), gun.global_position, -6.0, 0.05, 1.0)
	if _once("in", 1.35):
		Game.play_3d(Sfx.get_stream(&"rev_round_in"), gun.global_position, -5.0, 0.05, 1.0)
	if _once("shut", 1.75):
		Game.play_3d(Sfx.get_stream(&"rev_cyl_close"), gun.global_position, -5.0, 0.05, 1.0)
		_spin_v = randf_range(22.0, 30.0)
		_judge_say(["Барабан закрыт. Крутим.", "Один патрон из шести. Крутим."].pick_random(), 2.0)
	if t > 1.9:
		if _once("spin", 1.9):
			Game.play_3d(Sfx.get_stream(&"rev_spin"), gun.global_position, -4.0, 0.05, 1.0)
		gun.spin += _spin_v * delta
		_spin_v = maxf(_spin_v - 22.0 * delta, 0.0)
		if _spin_v <= 0.0:
			var steps := int(round(gun.spin / (TAU / Revolver.CHAMBERS)))
			gun.chamber = (gun.chamber + steps) % Revolver.CHAMBERS
			gun.spin = 0.0
			_announce_turn()
			_go("raise")


func _move(a: Transform3D, b: Transform3D, time: float, delay := 0.0) -> void:
	var k := smoothstep(0.0, 1.0, clampf((_t - delay) / time, 0.0, 1.0))
	var xf := a.interpolate_with(b, k)
	xf.origin += Vector3.UP * 0.12 * sin(PI * k) * (1.0 if a.origin.distance_to(b.origin) > 0.4 else 0.0)
	gun.global_transform = xf


func _hold_pose(p: Dictionary) -> Transform3D:
	if p.is_empty():
		return Transform3D(Basis(), (table["center"] as Vector3) + Vector3.UP * 0.8)
	if p["player"]:
		var cx: Transform3D = player.cam.global_transform
		var fb := Basis.looking_at(Vector3(-0.35, 0.05, -1.0).normalized(), Vector3.UP) * Basis(Vector3(0, 0, 1), -0.5)
		return cx * Transform3D(fb, Vector3(0.06, -0.2, -0.36) + (Vector3(0.0, 0.16, -0.06) if Game.bodycam else Vector3.ZERO))
	var b: Node3D = p["who"]
	var s: float = b.scale_factor
	var cb: Basis = b.chest.global_basis.orthonormalized()
	var fwd := Vector3(b.facing.x, 0.0, b.facing.z).normalized()
	var shoulder: Vector3 = b.chest.global_transform * (Vector3(0.22, 0.07, 0.0) * s)
	var dir2 := (fwd * 0.9 + Vector3.DOWN * 0.45).normalized()
	return Transform3D(Basis.looking_at(dir2, Vector3.UP), shoulder + Vector3.DOWN * 0.3 * s + fwd * 0.3 + cb.x * 0.02)


func _temple_pose(p: Dictionary) -> Transform3D:
	if p["player"]:
		var cx: Transform3D = player.cam.global_transform
		var b := Basis.looking_at(Vector3(-1.0, -0.05, -0.12).normalized(), Vector3.UP)
		var local := Transform3D(b, Vector3(0.105, 0.0, -0.085) - b * Revolver.MUZZLE)
		if Game.bodycam:
			local.origin += Vector3(0.0, 0.3, 0.17)
		local.origin += Vector3(randf_range(-1, 1), randf_range(-1, 1), 0.0) * 0.0012
		return cx * local
	var bot: Node3D = p["who"]
	var s: float = bot.scale_factor
	var hb: Basis = bot.head.global_basis.orthonormalized()
	var temple: Vector3 = bot.head.global_transform * (Vector3(0.095, 0.015, 0.0) * s)
	var bb := Basis.looking_at(-hb.x, hb.y)
	var shake := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * (0.002 if state == "wait" else 0.0)
	return Transform3D(bb, temple - bb * Revolver.MUZZLE + shake)


## The gun where his hand really is, the muzzle turned on his temple.
func _in_hand(p: Dictionary, w: float) -> void:
	if p.is_empty() or p["player"] or w <= 0.0:
		return
	var bot: Node3D = p["who"]
	var hand: RigidBody3D = bot.parts[bot.part_index["hand_r"]]
	var hp := hand.global_position
	var temple: Vector3 = bot.head.global_transform * (Vector3(0.095, 0.015, 0.0) * bot.scale_factor)
	var dir := temple - hp
	if dir.length() < 0.05:
		return
	var hb: Basis = bot.head.global_basis.orthonormalized()
	var b := Basis.looking_at(dir.normalized(), hb.y)
	var in_hand := Transform3D(b, hp - b * Vector3(0.0, -0.01, 0.012))
	gun.global_transform = gun.global_transform.interpolate_with(in_hand, clampf(w, 0.0, 1.0))


## Where the player's hands are while it is theirs (player.gd).
func player_hand() -> Vector3:
	if over or gun == null or not is_instance_valid(gun):
		return Vector3.INF
	var c := _cur()
	if not c.is_empty() and c["player"] and state in ["load", "raise", "wait", "pull", "lower"] \
			or state == "pass" and _t > 0.5 and c["player"]:
		return gun.grip()
	return Vector3.INF


func player_left_hand() -> Vector3:
	var c := _cur()
	if not over and state == "load" and not c.is_empty() and c["player"] and _t > 0.3 and _t < 2.4 and gun:
		return gun.round_hand()
	return Vector3.INF


func _heartbeat(delta: float) -> void:
	_beat -= delta
	if _beat <= 0.0:
		_beat = 0.75
		Game.play_3d(Sfx.get_stream(&"heartbeat"), player.cam.global_position, -10.0, 0.0, 1.0)


# --- The shot -----------------------------------------------------------------------------

func _bang() -> void:
	var c := _cur()
	var m: Vector3 = gun.muzzle()
	var dir: Vector3 = -gun.global_basis.z
	Game.play_3d(Sfx.get_stream(&"rev_shot"), m, 4.0, 0.05, 1.0)
	c["out"] = true
	_drop_gun()
	if c["player"]:
		var p: Node3D = c["who"]
		p.hurt(m + dir * 0.05, dir, "pistol", "head")
		if Game.blood:
			var me: Array[RID] = [p.get_rid()]
			Game.blood.exit_splatter(m + dir * 0.25, dir, 1.0, me)
		if p.vitals.alive:
			p.vitals._die()
		p.roulette = null
		player = null
	else:
		var b: Node3D = c["who"]
		b.hand_goal["r"] = Vector3.INF
		Roulette.slump_on_table(b, dir, table["center"], m)
		if b.ai:
			b.ai.roulette = null
		if _hears() and Game.player:
			Game.player.shake(0.5 if player == null else 1.2)
	var left := _alive_in().size()
	_judge_say(["Выстрел. %s выбывает." % c["name"], "Всё. %s отыгрался." % c["name"], "Минус один. Осталось %d." % left,
			"Бах. Уберите его со стола потом."].pick_random() if not c["player"] else "Выстрел. Ты проиграл.", 3.5)
	# The others at the table jump.
	for p in seats_taken:
		if not p["out"] and not p["player"] and is_instance_valid(p["who"]):
			var b2: Node3D = p["who"]
			b2._flinch = 1.0
			if b2.ai:
				b2.ai.fear = 0.9
	_go("after")


func _drop_gun() -> void:
	if gun == null or not is_instance_valid(gun):
		return
	gun.queue_free()
	gun = null


# --- The winner ---------------------------------------------------------------------------

func _win() -> void:
	var alive := _alive_in()
	if alive.is_empty():
		_finish()
		return
	_winner = alive[0]
	_spawn_money()
	if _winner["player"]:
		_judge_say("Победитель - ты. %d ₽ на столе, забирай - F на каждую пачку." % prize, 6.0)
		var p: Node3D = _winner["who"]
		p.roulette = null
		if p.seat_at != Vector3.INF:
			p.rise_from_seat()
		player = null
		_finish(false)
		return
	_judge_say("Победитель - %s. Забирает %d ₽." % [_winner["name"], prize], 4.0)
	_go("collect")


## The money on the table, by the judge's place (clear of the fallen): stacks
## of 100 in rows, two high.
func _spawn_money() -> void:
	var c: Vector3 = table["center"]
	var r: float = table["radius"]
	var j: Vector3 = table["judge"]
	var toward := Vector3(0, 0, 1)
	if j != Vector3.INF:
		toward = Vector3(j.x - c.x, 0.0, j.z - c.z).normalized()
	elif (table["seats"] as Array).size() > 0:
		# (between the first two chairs)
		var s0: Vector3 = _seat(0)["pos"]
		toward = -Vector3(s0.x - c.x, 0.0, s0.z - c.z).normalized()
	var side := toward.cross(Vector3.UP)
	var n := prize / STACK
	var cols := 5
	var rows := 3
	var base := c + toward * (r * 0.5) + Vector3.UP * 0.8
	var yaw := atan2(side.x, side.z)
	for i in n:
		var layer := i / (cols * rows)
		var k := i % (cols * rows)
		var cx := float(k % cols) - (cols - 1) * 0.5
		var rz := float(k / cols) - (rows - 1) * 0.5
		var at := base + side * cx * 0.085 * (r / 0.72) + toward * rz * 0.15 * (r / 0.72) + Vector3.UP * (0.02 + layer * 0.025)
		var d: RigidBody3D = ItemDrop.spawn(Game.main, "money", STACK, Transform3D(Basis(Vector3.UP, yaw), at), Vector3.ZERO)
		d.freeze = true
		d.angular_velocity = Vector3.ZERO
		_stacks.append(d)


## A bot won: up from his chair, round to the money, and he takes it stack by
## stack into his pockets.
func _collect(delta: float) -> void:
	var b: Node3D = _winner["who"]
	if not is_instance_valid(b) or not b.alive:
		_finish()
		return
	_stacks = _stacks.filter(func(s): return is_instance_valid(s) and not s.is_queued_for_deletion())
	if _stacks.is_empty() or _t > 40.0:
		if _once("done"):
			_judge_say(["%s забрал всё. На сегодня всё, господа." % _winner["name"], "Касса пуста. До следующей игры."].pick_random(), 3.0)
			var pe = b.ai._persona()
			pe.money += prize
		if _t > 1.0 or _stacks.is_empty():
			_finish()
		return
	_winner["sat"] = false
	var s: RigidBody3D = _stacks[_stacks.size() - 1]
	var sp: Vector3 = s.global_position
	var c: Vector3 = table["center"]
	var out := Vector3(sp.x - c.x, 0.0, sp.z - c.z).normalized()
	var stand := c + out * (float(table["radius"]) + 0.22)
	var me: Vector3 = b.position_ground()
	var to := Vector3(stand.x - me.x, 0.0, stand.z - me.z)
	b.seat = Vector3.INF
	b.posture = b.Posture.STAND
	if to.length() > 0.3:
		b.move_velocity = to.normalized() * 1.0
		b.facing = (b.facing as Vector3).slerp(to.normalized(), minf(delta * 5.0, 1.0)).normalized()
		_flags["grab_t"] = 0.0
		return
	b.move_velocity = Vector3.ZERO
	b.facing = -out
	b.hand_goal["r"] = sp
	b.look_target = sp
	b.has_look_target = true
	_flags["grab_t"] = float(_flags.get("grab_t", 0.0)) + delta
	var hand: RigidBody3D = b.parts[b.part_index["hand_r"]]
	if float(_flags["grab_t"]) > 0.35 and (hand.global_position.distance_to(sp) < 0.2 or float(_flags["grab_t"]) > 1.2):
		Game.play_3d(Sfx.get_stream(&"item_pickup"), sp, -8.0, 0.05, 2.0)
		s.queue_free()
		_stacks.pop_back()
		_flags["grab_t"] = 0.0
		if _stacks.size() % 10 == 0 and _stacks.size() > 0:
			_judge_say("%s считает деньги. Осталось %d ₽." % [_winner["name"], _stacks.size() * STACK], 2.0)


# --- The end --------------------------------------------------------------------------------

## Called by the player when they get up from the chair.
func player_stood_up() -> void:
	if over:
		return
	for p in seats_taken.duplicate():
		if p["player"]:
			if state == "gather":
				seats_taken.erase(p)
				_judge_say("Передумал? Стул свободен.", 2.5)
			else:
				p["out"] = true
				if _cur() == p:
					_drop_gun()
					_new_gun_after_leave()
				_judge_say(["Струсил и сбежал. Минус один.", "Встал из-за стола - выбыл. Трус."].pick_random(), 3.0)
				for x in seats_taken:
					if not x["player"] and is_instance_valid(x["who"]):
						(x["who"] as Node3D).angry_until = Game.clock + 20.0
	if is_instance_valid(player):
		player.roulette = null
	player = null


func _new_gun_after_leave() -> void:
	_go("after")


func _abort(text: String) -> void:
	_judge_say(text, 3.0)
	_finish()


func _release_bot(b: Node3D) -> void:
	if not is_instance_valid(b):
		return
	b.seat = Vector3.INF
	b.hand_goal["r"] = Vector3.INF
	b.hand_goal["l"] = Vector3.INF
	if b.ai and b.ai.roulette == self:
		b.ai.roulette = null
		if b.alive:
			b.ai._enter(b.ai.S.WANDER)


func _finish(release_player := true) -> void:
	if over:
		return
	over = true
	_drop_gun()
	for p in seats_taken:
		if p["player"]:
			continue
		_release_bot(p["who"])
	if judge and is_instance_valid(judge) and judge.ai and judge.ai.roulette == self:
		judge.ai.roulette = _manager if _manager and _manager.has_method("stance_for") else null
	if release_player and player and is_instance_valid(player):
		player.roulette = null
		if player.seat_at != Vector3.INF and not player._dead:
			player.rise_from_seat()
	player = null
	if _manager and _manager.has_method("game_over"):
		_manager.game_over(self)
	get_tree().create_timer(4.0).timeout.connect(queue_free)
