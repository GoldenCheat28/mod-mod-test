extends Node
## The bar in the hall of building B (tall_building.gd _bar): a bartender
## behind the counter, and people on the stools having a drink - the winner
## after a game of roulette, and now and then someone off the street. The
## bartender goes along to whoever has sat down, pours, and puts the glass in
## front of him; he drinks it slowly, a sip now and then, and goes.
## To the people here (bot_ai.roulette) this is what keeps them at it.

const Sfx = preload("res://scripts/audio/sfx.gd")

const STAY := Vector2(35.0, 60.0)

var at_table := false            # (bot_ai: they sit by the seat they are given)
var lod_ok := true               # (the staff may be put to sleep far off: crowd_lod.gd)
var info := {}
var bartender: Node3D = null
var patrons: Array = []          # {who, stool, sat, served, glass, t, stay, sip_t, sip}
var _serve: Dictionary = {}      # the patron the bartender is serving
var _serve_t := 0.0
var _wipe_t := 0.0


func setup(bar_info: Dictionary) -> void:
	info = bar_info


func ensure_bartender() -> void:
	if bartender and is_instance_valid(bartender) and bartender.alive:
		return
	if info.is_empty() or Game.main == null:
		return
	var at: Vector3 = info["bartender"]
	bartender = Game.main.spawn_bot(at + Vector3.UP * 0.02, PI * 0.5, -1, "bartender")
	if bartender.ai:
		bartender.ai.roulette = self
		bartender.ai._persona().name = "Бармен"


func free_stool() -> int:
	var stools: Array = info.get("stools", [])
	for i in stools.size():
		var taken := false
		for p in patrons:
			taken = taken or int(p["stool"]) == i
		if not taken:
			return i
	return -1


## Sends `b` to the bar for a drink (if there is a stool free).
func visit(b: Node3D) -> bool:
	var i := free_stool()
	if i < 0 or b == null or not is_instance_valid(b) or not b.alive or b.ai == null or b.ai.roulette != null:
		return false
	var ai = b.ai
	if ai.act:
		ai._end_activity()
	ai._path = PackedVector3Array()
	ai._enter(ai.S.IDLE)
	ai.roulette = self
	patrons.append({"who": b, "stool": i, "sat": false, "served": false, "glass": null, "t": 0.0,
			"stay": randf_range(STAY.x, STAY.y), "sip_t": randf_range(3.0, 6.0), "sip": 0.0, "path": PackedVector3Array(), "pi": 0})
	return true


func _stool(i: int) -> Dictionary:
	return (info["stools"] as Array)[i]


func _stand(i: int) -> Vector3:
	return (_stool(i)["pos"] as Vector3) + Vector3(0.55, 0, 0)


func stance_for(b: Node3D, delta: float) -> void:
	if b == bartender:
		_bartender(b, delta)
		return
	var p := {}
	for x in patrons:
		if x["who"] == b:
			p = x
	if p.is_empty():
		return
	var st := _stool(p["stool"])
	var me: Vector3 = b.position_ground()
	if not p["sat"]:
		var stand := _stand(p["stool"])
		var path: PackedVector3Array = p["path"]
		if path.is_empty():
			var nav: RID = b.get_world_3d().navigation_map
			path = NavigationServer3D.map_get_path(nav, NavigationServer3D.map_get_closest_point(nav, me),
					NavigationServer3D.map_get_closest_point(nav, stand), true)
			if path.is_empty():
				path = PackedVector3Array([stand])
			p["path"] = path
		var i: int = p["pi"]
		while i < path.size() and Vector2(path[i].x - me.x, path[i].z - me.z).length() < 0.35:
			i += 1
		p["pi"] = i
		var goal: Vector3 = path[i] if i < path.size() else stand
		var to := Vector3(goal.x - me.x, 0.0, goal.z - me.z)
		p["t"] = float(p["t"]) + delta
		if Vector2(stand.x - me.x, stand.z - me.z).length() < 0.35 or float(p["t"]) > 40.0:
			p["sat"] = true
			p["t"] = 0.0
		else:
			b.move_velocity = to.normalized() * 1.3
			b.facing = (b.facing as Vector3).slerp(to.normalized(), minf(delta * 6.0, 1.0)).normalized()
			b.posture = b.Posture.STAND
			b.seat = Vector3.INF
			return
	# On the stool, turned to the counter.
	b.move_velocity = Vector3.ZERO
	b.seat = (st["pos"] as Vector3) + Vector3.UP * float(st["seat_h"])
	b.posture = b.Posture.SIT
	b.facing = Vector3(-1, 0, 0)
	p["t"] = float(p["t"]) + delta
	var glass_at: Vector3 = st["glass"]
	b.hand_goal["l"] = Vector3.INF
	var g: Node3D = p["glass"]
	if g and is_instance_valid(g):
		# A sip now and then: the glass up to the mouth and down again.
		p["sip_t"] = float(p["sip_t"]) - delta
		if float(p["sip_t"]) <= 0.0:
			p["sip"] = float(p["sip"]) + delta
			var k := sin(clampf(float(p["sip"]) / 2.4, 0.0, 1.0) * PI)
			var mouth: Vector3 = b.head.global_position + Vector3(-0.1, -0.07, 0)
			var hold := glass_at.lerp(mouth, smoothstep(0.0, 0.6, k))
			g.global_position = g.global_position.lerp(hold, minf(delta * 10.0, 1.0))
			g.rotation.z = -0.9 * smoothstep(0.6, 1.0, k)
			b.hand_goal["r"] = g.global_position + Vector3(0.03, -0.02, 0)
			b.look_target = mouth + Vector3(-0.5, 0.1, 0)
			if float(p["sip"]) >= 2.4:
				p["sip"] = 0.0
				p["sip_t"] = randf_range(5.0, 10.0)
				g.global_position = glass_at
				g.rotation = Vector3.ZERO
		else:
			b.hand_goal["r"] = Vector3.INF
			b.look_target = bartender.head.global_position if bartender and is_instance_valid(bartender) else glass_at
	else:
		b.hand_goal["r"] = Vector3.INF
		b.look_target = bartender.head.global_position if bartender and is_instance_valid(bartender) else glass_at
	b.has_look_target = true
	if float(p["t"]) > float(p["stay"]):
		_leave(p)


func _leave(p: Dictionary) -> void:
	patrons.erase(p)
	var g: Node3D = p["glass"]
	if g and is_instance_valid(g):
		g.queue_free()
	var b: Node3D = p["who"]
	if _serve == p:
		_serve = {}
	if is_instance_valid(b):
		b.seat = Vector3.INF
		b.hand_goal["r"] = Vector3.INF
		if b.ai and b.ai.roulette == self:
			b.ai.roulette = null
			if b.alive:
				b.ai._enter(b.ai.S.WANDER)


## Behind the counter: along to whoever is waiting, a glass poured and put
## in front of him; the rest of the time a cloth over the counter.
func _bartender(b: Node3D, delta: float) -> void:
	var home: Vector3 = info["bartender"]
	var me: Vector3 = b.position_ground()
	var want_z := home.z
	b.seat = Vector3.INF
	b.posture = b.Posture.STAND
	b.hand_goal["l"] = Vector3.INF
	if _serve.is_empty() or not patrons.has(_serve):
		_serve = {}
		for p in patrons:
			if p["sat"] and not p["served"]:
				_serve = p
				_serve_t = 0.0
				break
	var top_y: float = info["top_y"]
	var reach_x: float = float(info["cx0"]) + 0.2
	if not _serve.is_empty():
		var st := _stool(_serve["stool"])
		want_z = (st["pos"] as Vector3).z
		var there := absf(me.z - want_z) < 0.25
		if there:
			_serve_t += delta
			var glass_at: Vector3 = st["glass"]
			b.hand_goal["r"] = glass_at + Vector3(0, 0.08, 0)
			b.look_target = (_serve["who"] as Node3D).head.global_position
			if _serve_t > 1.2 and not _serve["served"]:
				_serve["served"] = true
				_serve["glass"] = _glass(glass_at)
				Game.play_3d(Sfx.get_stream(&"item_pickup"), glass_at, -12.0, 0.1, 2.0)
			if _serve_t > 2.0:
				_serve = {}
		else:
			b.hand_goal["r"] = Vector3.INF
			b.look_target = Vector3(me.x + 1.0, top_y + 0.5, want_z)
	else:
		# Wiping the counter in slow circles, looking up at the room.
		_wipe_t += delta
		b.hand_goal["r"] = Vector3(reach_x + 0.08 * cos(_wipe_t * 2.2), top_y + 0.03, me.z + 0.12 * sin(_wipe_t * 2.2))
		var p = Game.player
		b.look_target = p.cam.global_position if p and p.global_position.distance_to(me) < 7.0 else Vector3(me.x + 2.0, top_y + 0.6, me.z)
	b.has_look_target = true
	var dz := want_z - me.z
	var dx: float = home.x - me.x
	if absf(dz) > 0.15 or absf(dx) > 0.2:
		b.move_velocity = Vector3(clampf(dx * 2.0, -0.6, 0.6), 0.0, clampf(dz * 2.0, -1.0, 1.0))
	else:
		b.move_velocity = Vector3.ZERO
	b.facing = Vector3(1, 0, 0)


## A glass of something on the counter.
func _glass(at: Vector3) -> Node3D:
	var root := Node3D.new()
	var cup := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.036
	cm.bottom_radius = 0.03
	cm.height = 0.1
	cup.mesh = cm
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.8, 0.85, 0.85, 0.3)
	gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	gm.roughness = 0.05
	cup.material_override = gm
	cup.position = Vector3(0, 0.05, 0)
	root.add_child(cup)
	var drink := MeshInstance3D.new()
	var dm := CylinderMesh.new()
	dm.top_radius = 0.031
	dm.bottom_radius = 0.028
	dm.height = 0.06
	drink.mesh = dm
	var lm := StandardMaterial3D.new()
	lm.albedo_color = Color(0.55, 0.3, 0.08, 0.85)
	lm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	drink.material_override = lm
	drink.position = Vector3(0, 0.035, 0)
	root.add_child(drink)
	Game.main.add_child(root)
	root.global_position = at
	return root
