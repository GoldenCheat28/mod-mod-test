extends Node
## The games of roulette round the tables in the three-storey buildings
## (roulette_game.gd), and who plays them:
## - the event: every EVENT_EVERY seconds (counted from the end of the last
##   one) five people are gathered in the hall of building B and sit down at
##   the round table; a judge in a suit stands by and calls every move; the
##   one left alive takes 3000 roubles in stacks of 100. A free chair (F) puts
##   the player in it instead of one of them.
## - now and then two or three bots sit down at one of the small tables and
##   play among themselves;
## - F on a chair at a small table: the player sits down, and the nearest
##   people who are free come over to play.
## To the judge between games (bot_ai.roulette) this is what keeps him at
## his place.

const Game_ = preload("res://scripts/game/roulette_game.gd")
const Bar = preload("res://scripts/game/bar.gd")
const Crew = preload("res://scripts/game/cleanup_crew.gd")
const Guards = preload("res://scripts/game/guards.gd")

const EVENT_EVERY := 90.0
const EVENT_PRIZE := 3000
const SMALL_STAKE := 300         # a head, at the small tables
const MAX_BOTS := 22             # never more people than that about, for the event

var at_table := false            # (bot_ai: the judge stands)
var lod_ok := true               # (the staff may be put to sleep far off: crowd_lod.gd)
var judge: Node3D = null
var event_in := EVENT_EVERY      # seconds to the next event
var _games := {}                 # table index -> roulette_game
var _bot_game_in := 50.0
var bar: Node = null
var crew: Node = null
var guards: Node = null
var _crew_in := -1.0             # seconds to the cleaners coming up (after the event)
var _drink_in := 30.0            # to someone off the street dropping in for a drink


var _loading := false            # (made under the loading screen: straight at their places)
var _cleaners: Array = []       # the cleaners, made at the start and kept down in the cellar


## Everyone who works here is made now, under the loading screen: no one
## appears out of thin air in front of the player later, and there is no
## hitch while six people are put together at once.
func _ready() -> void:
	if Net.active and not Net.is_host:
		return
	var hall: Dictionary = Game.main.map.event_hall if Game.main and Game.main.map else {}
	if hall.is_empty():
		return
	_loading = true
	if hall.has("bar"):
		bar = Bar.new()
		bar.name = "Bar"
		add_child(bar)
		bar.setup(hall["bar"])
		bar.ensure_bartender()
	if hall.has("bounds"):
		guards = Guards.new()
		guards.name = "Guards"
		add_child(guards)
		guards.setup(hall)
		guards.ensure()
	var ti := _event_table()
	if ti >= 0:
		_ensure_judge(_tables()[ti])
	_loading = false
	if hall.has("cellar"):
		for i in 6:
			var b: Node3D = Game.main.spawn_bot((hall["cellar"] as Dictionary)["in"] + Vector3(0, 0.05, 0), 0.0, -1, "cleaner")
			_park(b)
			_cleaners.append(b)


## Down in the cellar: out of the world (not drawn, not worked out).
func _park(b: Node3D) -> void:
	b.visible = false
	b.process_mode = Node.PROCESS_MODE_DISABLED
	Game.bots.erase(b)
	if b.ai:
		b.ai.roulette = null


## A cleaner up from the cellar, standing at `at` (a new one if the ones
## kept are gone - killed, say).
func take_cleaner(at: Vector3) -> Node3D:
	var b: Node3D = null
	while not _cleaners.is_empty() and b == null:
		var c: Node3D = _cleaners.pop_back()
		if is_instance_valid(c) and c.alive:
			b = c
	if b == null:
		return Game.main.spawn_bot(at, -PI * 0.5, -1, "cleaner")
	var off: Vector3 = at + Vector3.UP * 0.02 - b.position_ground()
	for part in b.parts:
		part.global_position += off
		part.linear_velocity = Vector3.ZERO
		part.angular_velocity = Vector3.ZERO
		part.reset_physics_interpolation()
	b.process_mode = Node.PROCESS_MODE_INHERIT
	b.visible = true
	b.move_velocity = Vector3.ZERO
	if not Game.bots.has(b):
		Game.bots.append(b)
	return b


func park_cleaner(b: Node3D) -> void:
	if is_instance_valid(b) and b.alive:
		b.hand_goal["r"] = Vector3.INF
		b.hand_goal["l"] = Vector3.INF
		_park(b)
		_cleaners.append(b)
	elif is_instance_valid(b):
		Game.bots.erase(b)
		b.queue_free()


## Somewhere for a new man to come from: out of the player's sight and not
## close by (the far side of a building, round a corner), toward `near`.
func hidden_spawn(near: Vector3) -> Vector3:
	var p = Game.player
	var nav: RID = get_viewport().world_3d.navigation_map
	var cam := get_viewport().get_camera_3d()
	var space := get_viewport().world_3d.direct_space_state
	for i in 40:
		var a := randf() * TAU
		var r := randf_range(18.0, 40.0)
		var q := NavigationServer3D.map_get_closest_point(nav, near + Vector3(cos(a) * r, 0.0, sin(a) * r))
		if q.y > near.y + 1.0 or q.y < near.y - 1.0:
			continue
		if p and q.distance_to(p.global_position) < 15.0:
			continue
		if cam and cam.is_position_in_frustum(q + Vector3.UP * 1.0):
			var rq := PhysicsRayQueryParameters3D.create(cam.global_position, q + Vector3.UP * 1.0, Game.LAYER_WORLD)
			if space.intersect_ray(rq).is_empty():
				continue                      # (he would be seen appearing)
		return q
	return Vector3.INF


func _tables() -> Array:
	return Game.main.map.game_tables if Game.main and Game.main.map else []


func _event_table() -> int:
	var arr := _tables()
	for i in arr.size():
		if (arr[i] as Dictionary)["kind"] == "event":
			return i
	return -1


func _physics_process(delta: float) -> void:
	if Game.player == null or (Net.active and not Net.is_host):
		return
	var hall: Dictionary = Game.main.map.event_hall if Game.main and Game.main.map else {}
	if bar and (bar.bartender == null or not is_instance_valid(bar.bartender) or not bar.bartender.alive):
		# (a new one only while the player is away: he is not seen appearing)
		if Game.player.global_position.distance_to((hall["bar"] as Dictionary)["bartender"]) > 25.0:
			bar.ensure_bartender()
	if bar:
		_drink_in -= delta
		if _drink_in <= 0.0:
			_drink_in = randf_range(40.0, 75.0)
			var who := _free_bots(hall["center"], 1, 35.0)
			if not who.is_empty():
				bar.visit(who[0])
	# The cleaners, a little after the event is over.
	if _crew_in > 0.0:
		_crew_in -= delta
		if _crew_in <= 0.0 and (crew == null or not is_instance_valid(crew)) and hall.has("cellar"):
			crew = Crew.new()
			crew.name = "CleanupCrew"
			add_child(crew)
			crew.setup(hall)
	var ev := _event_table()
	# (not while the cleaners are still at it)
	if ev >= 0 and not _games.has(ev) and not (crew and is_instance_valid(crew)) and _crew_in <= 0.0:
		event_in -= delta
		if event_in <= 0.0:
			event_in = EVENT_EVERY
			start_event()
	_bot_game_in -= delta
	if _bot_game_in <= 0.0:
		_bot_game_in = randf_range(45.0, 80.0)
		_bots_play()


# --- The event ------------------------------------------------------------------------------

func start_event() -> void:
	var ti := _event_table()
	if ti < 0 or _games.has(ti):
		return
	var t: Dictionary = _tables()[ti]
	_clear_table(t)
	_ensure_judge(t)
	if guards:
		guards.ensure()
	var g = Game_.new()
	g.name = "EventGame"
	add_child(g)
	g.setup(self, ti, EVENT_PRIZE, judge)
	_games[ti] = g
	refill(g)
	if Game.player:
		Game.player._notify("Событие: в трёхэтажке собирают игру в рулетку. Приз %d ₽" % EVENT_PRIZE)


## The judge: a man in a suit at his place by the event table (a new one if
## the last is gone).
func _ensure_judge(t: Dictionary) -> void:
	if judge and is_instance_valid(judge) and judge.alive and judge.conscious and not judge.fallen:
		if judge.ai and judge.ai.roulette == null:
			judge.ai.roulette = self
		return
	var spot: Vector3 = t["judge"]
	if spot == Vector3.INF:
		return
	var nav: RID = get_viewport().world_3d.navigation_map
	var at := NavigationServer3D.map_get_closest_point(nav, spot)
	# (the player about: he comes in from somewhere out of sight)
	if not _loading and Game.player and Game.player.global_position.distance_to(spot) < 25.0 and is_inside_tree() and get_viewport().get_camera_3d():
		var h := hidden_spawn(spot)
		if h != Vector3.INF:
			at = h
	var c: Vector3 = t["center"]
	judge = Game.main.spawn_bot(at, atan2(-(c.x - at.x), -(c.z - at.z)), -1, "judge")
	if judge.ai:
		judge.ai.roulette = self
		if judge.ai.talk:
			judge.ai.talk.set("_rude", false)
		judge.ai._persona().name = "Судья"


## Walks `b` along the navigation to `goal` (the path kept on him); true
## once there.
func nav_walk(b: Node3D, goal: Vector3, delta: float, speed := 1.2) -> bool:
	var me: Vector3 = b.position_ground()
	if Vector2(goal.x - me.x, goal.z - me.z).length() < 0.35:
		b.move_velocity = Vector3.ZERO
		return true
	var path: PackedVector3Array = b.get_meta("nav_path", PackedVector3Array())
	var pg: Vector3 = b.get_meta("nav_goal", Vector3.INF)
	var i: int = b.get_meta("nav_i", 0)
	if pg.distance_to(goal) > 0.3 or path.is_empty():
		var nav: RID = b.get_world_3d().navigation_map
		path = NavigationServer3D.map_get_path(nav, NavigationServer3D.map_get_closest_point(nav, me),
				NavigationServer3D.map_get_closest_point(nav, goal), true)
		if path.is_empty():
			path = PackedVector3Array([goal])
		i = 0
		b.set_meta("nav_path", path)
		b.set_meta("nav_goal", goal)
	while i < path.size() and Vector2(path[i].x - me.x, path[i].z - me.z).length() < 0.35:
		i += 1
	b.set_meta("nav_i", i)
	var to: Vector3 = (path[i] if i < path.size() else goal) - me
	to.y = 0.0
	if to.length() < 0.05:
		b.move_velocity = Vector3.ZERO
		return true
	b.move_velocity = to.normalized() * speed
	b.facing = (b.facing as Vector3).slerp(to.normalized(), minf(delta * 6.0, 1.0)).normalized()
	return false


## Between games the judge keeps his place, turned to the table (and to the
## player, if he comes close).
func stance_for(b: Node3D, delta: float) -> void:
	if b != judge:
		return
	var ti := _event_table()
	if ti < 0:
		return
	var t: Dictionary = _tables()[ti]
	var spot: Vector3 = t["judge"]
	var c: Vector3 = t["center"]
	var me: Vector3 = b.position_ground()
	var to := Vector3(spot.x - me.x, 0.0, spot.z - me.z)
	b.seat = Vector3.INF
	b.posture = b.Posture.STAND
	b.hand_goal["r"] = Vector3.INF
	b.hand_goal["l"] = Vector3.INF
	if to.length() > 0.35:
		nav_walk(b, spot, delta)
		return
	b.move_velocity = Vector3.ZERO
	var p = Game.player
	if p and p.global_position.distance_to(me) < 6.0:
		b.look_target = p.cam.global_position
		b.has_look_target = true
	else:
		b.facing = Vector3(c.x - me.x, 0.0, c.z - me.z).normalized()
		b.has_look_target = false


## The ones shot last time are taken away before the next lot sit down.
func _clear_table(t: Dictionary) -> void:
	var c: Vector3 = t["center"]
	var r: float = float(t["radius"]) + 1.3
	for b in Game.bots.duplicate():
		if is_instance_valid(b) and not b.alive and b.position_ground().distance_to(c) < r:
			Game.bots.erase(b)
			b.queue_free()


# --- Bots among themselves --------------------------------------------------------------------

func _bots_play() -> void:
	var free: Array = []
	var arr := _tables()
	for i in arr.size():
		if (arr[i] as Dictionary)["kind"] != "event" and not _games.has(i):
			free.append(i)
	if free.is_empty():
		return
	var ti: int = free.pick_random()
	var t: Dictionary = arr[ti]
	var n := mini((t["seats"] as Array).size(), randi_range(2, 3))
	var got := _free_bots(t["center"], n, 30.0)
	if got.size() < 2:
		return
	_clear_table(t)
	var g = Game_.new()
	g.name = "TableGame%d" % ti
	add_child(g)
	g.setup(self, ti, SMALL_STAKE * got.size(), null)
	_games[ti] = g
	for i in got.size():
		g.add_bot(got[i], i)


# --- The player -----------------------------------------------------------------------------------

## F on the chair `seat` at table `ti`.
func join(p: Node3D, ti: int, seat: int) -> void:
	if Net.active:
		p._notify("В сетевой игре столы пока недоступны")
		return
	var arr := _tables()
	if ti < 0 or ti >= arr.size():
		return
	var t: Dictionary = arr[ti]
	if _games.has(ti):
		var g = _games[ti]
		g.add_player(p, seat)
		return
	if t["kind"] == "event":
		p._notify("Игра начнётся через %d с. Садись, когда соберут людей." % int(ceil(event_in)))
		return
	var n: int = (t["seats"] as Array).size() - 1
	var got := _free_bots(t["center"], n, 80.0)
	if got.is_empty():
		p._notify("Играть не с кем: рядом никого")
		return
	_clear_table(t)
	var g = Game_.new()
	g.name = "TableGame%d" % ti
	add_child(g)
	g.setup(self, ti, SMALL_STAKE * (got.size() + 1), null)
	_games[ti] = g
	var i := 0
	for b in got:
		if i == seat:
			i += 1
		g.add_bot(b, i)
		i += 1
	g.add_player(p, seat)


## The empty chairs at the event filled: whoever is free about the place,
## and if there is nobody, people come in off the street.
func refill(g: Node) -> void:
	var t: Dictionary = g.table
	var hall: Dictionary = Game.main.map.event_hall
	var nav: RID = get_viewport().world_3d.navigation_map
	while not g.over:
		var seat: int = g.free_seat()
		if seat < 0:
			return
		var got := _free_bots(t["center"], 1, 200.0)
		var b: Node3D = got[0] if not got.is_empty() else null
		if b == null:
			if _alive_bots() >= MAX_BOTS or hall.is_empty():
				return
			var at := hidden_spawn(t["center"])
			if at == Vector3.INF:
				return                        # (nowhere unseen just now: tried again in a moment)
			b = Game.main.spawn_bot(at, randf() * TAU)
		g.add_bot(b, seat)


## Someone died at a table (roulette_game.gd): at the event table the
## guards move him off it.
func body_down(g: Node, b: Node3D) -> void:
	if guards and g.get("table_i") == _event_table():
		guards.body_down(b)


func game_over(g: Node) -> void:
	for k in _games.keys():
		if _games[k] == g:
			_games.erase(k)
			if k == _event_table():
				event_in = EVENT_EVERY
				_crew_in = 6.0
	# The winner (a bot) goes for a drink.
	var won: Dictionary = g.get("_winner")
	if bar and not won.is_empty() and not won.get("player", false):
		var wb: Node3D = won["who"]
		if is_instance_valid(wb) and wb.alive:
			bar.visit.call_deferred(wb)


# --- Who is free ---------------------------------------------------------------------------------

func _free_bots(centre: Vector3, n: int, within: float) -> Array:
	var cands: Array = []
	for b in Game.bots:
		if not is_instance_valid(b) or b == judge or b.has_meta("trader") or b.has_meta("puppet") \
				or b.has_meta("bartender") or b.has_meta("cleaner") or b.has_meta("guard") or float(b.get_meta("late_until", -1.0)) > Game.clock:
			continue
		if not b.alive or not b.conscious or b.fallen or b.cuffed or b.weapon:
			continue
		var ai = b.ai
		if ai == null or ai.roulette != null or ai.spectate != null or ai.process_mode == Node.PROCESS_MODE_DISABLED:
			continue
		if ai.state in [ai.S.FLEE, ai.S.HIDE, ai.S.ARMED, ai.S.SURRENDER, ai.S.DOWNED, ai.S.CUFFED, ai.S.ANGRY, ai.S.BRAWL, ai.S.PLAY_DEAD]:
			continue
		if ai.player_talk != null:
			continue
		var d: float = b.position_ground().distance_to(centre)
		if d < within:
			cands.append([d, b])
	cands.sort_custom(func(a, c): return a[0] < c[0])
	var r: Array = []
	for i in mini(n, cands.size()):
		r.append(cands[i][1])
	return r


func _alive_bots() -> int:
	var n := 0
	for b in Game.bots:
		if is_instance_valid(b) and b.alive:
			n += 1
	return n
