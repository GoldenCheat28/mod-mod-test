extends Node
## Two guards at the event table, in suits and dark glasses, hands folded,
## watching. When someone at the table dies, one of them goes over, takes
## him under the arms and drags him off to the wall - and leaves him there
## (carrying the dead away is the cleaners' job, cleanup_crew.gd). Then back
## to his place. To them (bot_ai.roulette) this is what they do.

var at_table := false
var hall := {}
var guards: Array = []           # {who, post, corpse, stage, t, path, pi, goal}
var _queue: Array = []           # the dead waiting to be moved


func setup(event_hall: Dictionary) -> void:
	hall = event_hall


func _posts() -> Array:
	var c: Vector3 = hall["center"]
	return [c + Vector3(-2.3, 0, 1.6), c + Vector3(2.3, 0, 1.6)]


## Where the dead are put: along the wall, side by side.
func _pile(i: int) -> Vector3:
	var b: Array = hall["bounds"]
	return Vector3(float(b[1]) - 0.7, float((hall["center"] as Vector3).y), float(b[2]) + 2.6 + (i % 4) * 0.9)


func ensure() -> void:
	for g in guards.duplicate():
		var b: Node3D = g["who"] if is_instance_valid(g["who"]) else null
		if b == null or not b.alive:
			guards.erase(g)
	var posts := _posts()
	while guards.size() < 2 and Game.main:
		var i := guards.size()
		var taken := false
		for g in guards:
			taken = taken or int(g["i"]) == i
		if taken:
			i = 1 - i
		var nav: RID = Game.main.get_world_3d().navigation_map
		var at := NavigationServer3D.map_get_closest_point(nav, posts[i])
		var b: Node3D = Game.main.spawn_bot(at + Vector3.UP * 0.02, 0.0, -1, "guard")
		if b.ai == null:
			return
		b.ai.roulette = self
		b.ai._persona().name = "Охранник"
		guards.append({"who": b, "i": i, "corpse": null, "stage": "", "t": 0.0, "path": PackedVector3Array(), "pi": 0, "goal": Vector3.INF})


var _piled := 0


## Someone died at the table: he is to be moved off it.
func body_down(b: Node3D) -> void:
	if is_instance_valid(b) and not _queue.has(b):
		_queue.append(b)
		b.set_meta("guard_wait", Game.clock + 3.5)


func _walk(g: Dictionary, goal: Vector3, delta: float, speed: float, face := Vector3.INF) -> bool:
	var b: Node3D = g["who"]
	var me: Vector3 = b.position_ground()
	if (g["goal"] as Vector3).distance_to(goal) > 0.3:
		g["goal"] = goal
		var nav: RID = b.get_world_3d().navigation_map
		var path := NavigationServer3D.map_get_path(nav, NavigationServer3D.map_get_closest_point(nav, me),
				NavigationServer3D.map_get_closest_point(nav, goal), true)
		g["path"] = path if not path.is_empty() else PackedVector3Array([goal])
		g["pi"] = 0
		g["walk_t"] = 0.0
	var path: PackedVector3Array = g["path"]
	var i: int = g["pi"]
	while i < path.size() and Vector2(path[i].x - me.x, path[i].z - me.z).length() < 0.35:
		i += 1
	g["pi"] = i
	g["walk_t"] = float(g.get("walk_t", 0.0)) + delta
	var left := Vector2(goal.x - me.x, goal.z - me.z).length()
	if left < 0.35 or (i >= path.size() and left < 0.7) or float(g["walk_t"]) > 25.0:
		b.move_velocity = Vector3.ZERO
		return true
	var to_p: Vector3 = (path[i] if i < path.size() else goal) - me
	to_p.y = 0.0
	b.move_velocity = to_p.normalized() * speed
	var look := to_p.normalized() if face == Vector3.INF else Vector3(face.x - me.x, 0.0, face.z - me.z).normalized()
	if look.length() > 0.1:
		b.facing = (b.facing as Vector3).slerp(look, minf(delta * 6.0, 1.0)).normalized()
	return false


func stance_for(b: Node3D, delta: float) -> void:
	var g := {}
	for x in guards:
		if x["who"] == b:
			g = x
	if g.is_empty():
		return
	b.seat = Vector3.INF
	b.posture = b.Posture.STAND
	var c: Vector3 = hall["center"]
	var cv = g["corpse"]
	var corpse: Node3D = cv if cv != null and is_instance_valid(cv) else null
	if corpse == null:
		g["corpse"] = null
		# Someone to move (the other one not already on him)?
		for d in _queue.duplicate():
			if not is_instance_valid(d):
				_queue.erase(d)
				continue
			if Game.clock < float(d.get_meta("guard_wait", 0.0)):
				continue
			var other := false
			for x in guards:
				other = other or x["corpse"] == d
			if not other:
				g["corpse"] = d
				g["stage"] = "to"
				g["t"] = 0.0
				_queue.erase(d)
				corpse = d
				break
	if corpse == null:
		# At his place: still, hands folded in front, watching the table.
		var post: Vector3 = _posts()[int(g["i"])]
		if _walk(g, post, delta, 1.2):
			var me: Vector3 = b.position_ground()
			var to := Vector3(c.x - me.x, 0.0, c.z - me.z)
			if to.length() > 0.1:
				b.facing = (b.facing as Vector3).slerp(to.normalized(), minf(delta * 3.0, 1.0)).normalized()
			var fwd := Vector3(b.facing.x, 0.0, b.facing.z).normalized()
			var hands: Vector3 = me + fwd * 0.22 + Vector3.UP * 0.95
			b.hand_goal["r"] = hands + fwd.cross(Vector3.UP) * 0.03
			b.hand_goal["l"] = hands - fwd.cross(Vector3.UP) * 0.03
			var p = Game.player
			b.look_target = p.cam.global_position if p and p.global_position.distance_to(me) < 5.0 else c + Vector3.UP * 1.0
			b.has_look_target = true
		else:
			b.hand_goal["r"] = Vector3.INF
			b.hand_goal["l"] = Vector3.INF
		return
	g["t"] = float(g["t"]) + delta
	var chest: RigidBody3D = corpse.chest
	var cp := chest.global_position
	match g["stage"]:
		"to":
			b.hand_goal["r"] = Vector3.INF
			b.hand_goal["l"] = Vector3.INF
			# Round behind his chair, at his back.
			var out := Vector3(cp.x - c.x, 0.0, cp.z - c.z)
			out = out.normalized() if out.length() > 0.05 else Vector3(1, 0, 0)
			var spot := Vector3(cp.x, c.y, cp.z) + out * 0.7
			if _walk(g, spot, delta, 1.5) or float(g["t"]) > 20.0:
				corpse.wake()
				g["stage"] = "drag"
				g["t"] = 0.0
				g["pile"] = _pile(_piled)
				_piled += 1
		"drag":
			var pile: Vector3 = g["pile"]
			var arrived := _walk(g, pile, delta, 0.9, cp)
			var fwd := Vector3(b.facing.x, 0.0, b.facing.z).normalized()
			var side := fwd.cross(Vector3.UP)
			# (low and steady: dragged along the floor, not thrown about)
			var grip: Vector3 = b.position_ground() + fwd * 0.45 + Vector3.UP * 0.3
			var v := ((grip - cp) * 3.0).limit_length(1.6)
			v.y = clampf(v.y, -1.0, 0.35)
			chest.linear_velocity = v
			b.hand_goal["r"] = cp - side * 0.13
			b.hand_goal["l"] = cp + side * 0.13
			b.look_target = cp
			b.has_look_target = true
			if arrived or float(g["t"]) > 30.0:
				# Put down, and left.
				b.hand_goal["r"] = Vector3.INF
				b.hand_goal["l"] = Vector3.INF
				g["corpse"] = null
				g["stage"] = ""
