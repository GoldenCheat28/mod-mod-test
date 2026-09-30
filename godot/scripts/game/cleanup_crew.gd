extends Node
## After the event: the cleaners come up out of the cellar (tall_building.gd
## _cellar) - two to carry the dead out, two with mops for the floor, two with
## rags for the walls and the table. The dead are dragged under the arms out
## the back door and heaved into the dumpster; the blood is wiped off
## (blood.gd wipe). Done, they go back down the cellar stairs and are gone.
## To them (bot_ai.roulette) this is what they are doing.

const Sfx = preload("res://scripts/audio/sfx.gd")

const ROLES := ["drag", "drag", "mop", "mop", "wash", "wash"]
const SHIFT := 320.0             # nobody stays up here longer than this

var at_table := false
var hall := {}
var workers: Array = []          # {who, role, state, t, goal, path, pi, jobs, job, corpse, prop, ...}
var _spawn_i := 0
var _spawn_t := 0.0
var _door_k := 0.0
var _door_want := 0.0
var _claimed := {}               # corpse -> worker
var _done := false


func setup(event_hall: Dictionary) -> void:
	hall = event_hall


func _physics_process(delta: float) -> void:
	if hall.is_empty() or Game.main == null:
		return
	var cellar: Dictionary = hall["cellar"]
	# Up they come, one after another.
	_spawn_t -= delta
	if _spawn_i < ROLES.size() and _spawn_t <= 0.0:
		_spawn_t = 1.3
		_door_want = 1.0
		_spawn(ROLES[_spawn_i])
		_spawn_i += 1
	# The door: open while someone is going through it.
	var near := false
	for w in workers:
		var b: Node3D = w["who"]
		if is_instance_valid(b) and b.position_ground().distance_to(cellar["out"]) < 1.4:
			near = true
	_door_want = 1.0 if near or _spawn_i < ROLES.size() else 0.0
	var was := _door_k
	_door_k = move_toward(_door_k, _door_want, delta * 1.6)
	if (was == 0.0 and _door_k > 0.0) or (was > 0.0 and _door_k == 0.0):
		Game.play_3d(Sfx.get_stream(&"door_creak"), cellar["out"], -8.0, 0.1, 2.0)
	var door: Node3D = cellar["door"]
	if is_instance_valid(door):
		door.rotation.y = -1.45 * smoothstep(0.0, 1.0, _door_k)
	# Gone when all of them are.
	for w in workers.duplicate():
		if not is_instance_valid(w["who"]) or not (w["who"] as Node3D).alive:
			_drop_corpse(w)
			if is_instance_valid(w.get("prop")):
				(w["prop"] as Node3D).queue_free()
			workers.erase(w)
	if _spawn_i >= ROLES.size() and workers.is_empty() and _door_k <= 0.0 and not _done:
		_done = true
		queue_free()


func _spawn(role: String) -> void:
	var cellar: Dictionary = hall["cellar"]
	var at: Vector3 = cellar["out"]
	var b: Node3D = Game.main.spawn_bot(at + Vector3(randf_range(-0.2, 0.2), 0.02, randf_range(-0.3, 0.3)), -PI * 0.5, -1, "cleaner")
	if b.ai == null:
		return
	b.ai.roulette = self
	var w := {"who": b, "role": role, "state": "work", "t": 0.0, "goal": Vector3.INF, "path": PackedVector3Array(), "pi": 0,
			"jobs": [], "job": -1, "job_t": 0.0, "corpse": null, "prop": null, "wipe_t": 0.0, "walk_t": 0.0}
	if role == "mop":
		w["prop"] = _mop()
		w["jobs"] = _floor_jobs(workers.filter(func(x): return x["role"] == "mop").size())
	elif role == "wash":
		w["prop"] = _rag()
		w["jobs"] = _wall_jobs(workers.filter(func(x): return x["role"] == "wash").size())
	workers.append(w)


# --- Walking -----------------------------------------------------------------------------

## Along a path to `goal`; true once there. `face` (if not INF) is where he
## looks while he goes (walking backwards, dragging).
func _walk(w: Dictionary, goal: Vector3, delta: float, speed: float, face := Vector3.INF) -> bool:
	var b: Node3D = w["who"]
	var me: Vector3 = b.position_ground()
	if (w["goal"] as Vector3).distance_to(goal) > 0.3:
		w["goal"] = goal
		var nav: RID = b.get_world_3d().navigation_map
		var path := NavigationServer3D.map_get_path(nav, NavigationServer3D.map_get_closest_point(nav, me),
				NavigationServer3D.map_get_closest_point(nav, goal), true)
		w["path"] = path if not path.is_empty() else PackedVector3Array([goal])
		w["pi"] = 0
		w["walk_t"] = 0.0
	var path: PackedVector3Array = w["path"]
	var i: int = w["pi"]
	while i < path.size() and Vector2(path[i].x - me.x, path[i].z - me.z).length() < 0.35:
		i += 1
	w["pi"] = i
	w["walk_t"] = float(w["walk_t"]) + delta
	var left := Vector2(goal.x - me.x, goal.z - me.z).length()
	if left < 0.4 or (i >= path.size() and left < 0.8) or float(w["walk_t"]) > 30.0:
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
	var w := {}
	for x in workers:
		if x["who"] == b:
			w = x
	if w.is_empty():
		return
	b.seat = Vector3.INF
	b.posture = b.Posture.STAND
	b.has_look_target = false
	w["t"] = float(w["t"]) + delta
	if float(w["t"]) > SHIFT and w["state"] != "home":
		_drop_corpse(w)
		w["state"] = "home"
	if w["state"] == "home":
		b.hand_goal["r"] = Vector3.INF
		b.hand_goal["l"] = Vector3.INF
		_carry_prop(w, delta, false)
		var cellar: Dictionary = hall["cellar"]
		if _walk(w, cellar["out"], delta, 1.3):
			# Down the stairs and out of the world.
			if is_instance_valid(w.get("prop")):
				(w["prop"] as Node3D).queue_free()
			Game.bots.erase(b)
			workers.erase(w)
			b.queue_free()
		return
	match w["role"]:
		"drag":
			_drag(w, delta)
		"mop", "wash":
			_scrub(w, delta)


# --- Carrying out the dead --------------------------------------------------------------

func _find_corpse(w: Dictionary) -> Node3D:
	var b: Node3D = w["who"]
	var bounds: Array = hall["bounds"]
	var best: Node3D = null
	var bd := INF
	for c in Game.bots:
		if not is_instance_valid(c) or c.alive or _claimed.has(c) or c.has_meta("binned"):
			continue
		var p: Vector3 = c.position_ground()
		if p.x < float(bounds[0]) - 0.5 or p.x > float(bounds[1]) + 0.5 or p.z < float(bounds[2]) - 0.5 or p.z > float(bounds[3]) + 0.5 or p.y > 2.5:
			continue
		var d := p.distance_to(b.position_ground())
		if d < bd:
			bd = d
			best = c
	return best


func _drag(w: Dictionary, delta: float) -> void:
	var b: Node3D = w["who"]
	var cv = w["corpse"]
	var corpse: Node3D = null
	if cv != null and is_instance_valid(cv):
		corpse = cv
	elif cv != null:
		w["corpse"] = null            # (gone meanwhile)
	if corpse == null:
		corpse = _find_corpse(w)
		if corpse == null:
			w["state"] = "home"
			return
		w["corpse"] = corpse
		_claimed[corpse] = w
		w["stage"] = "to"
		w["stage_t"] = 0.0
	var chest: RigidBody3D = corpse.chest
	var cp := chest.global_position
	var stage: String = w.get("stage", "to")
	w["stage_t"] = float(w.get("stage_t", 0.0)) + delta
	var bin_at: Vector3 = hall["dumpster"]
	var dump := bin_at + Vector3(1.55, 0, 0)
	match stage:
		"to":
			# Round to his head end.
			b.hand_goal["r"] = Vector3.INF
			b.hand_goal["l"] = Vector3.INF
			var head: Vector3 = corpse.head.global_position
			var away := Vector3(head.x - cp.x, 0.0, head.z - cp.z)
			away = away.normalized() if away.length() > 0.05 else Vector3(1, 0, 0)
			var spot := Vector3(cp.x, b.position_ground().y, cp.z) + away * 0.75
			if _walk(w, spot, delta, 1.4) or float(w["stage_t"]) > 25.0:
				w["stage"] = "grab"
				w["stage_t"] = 0.0
				corpse.wake()
		"grab":
			b.move_velocity = Vector3.ZERO
			_hold_corpse(w, corpse, delta, 0.25)
			if float(w["stage_t"]) > 0.8:
				w["stage"] = "drag"
				w["stage_t"] = 0.0
		"drag":
			# Backwards to the dumpster, pulling him along the floor.
			_walk(w, dump, delta, 1.05, cp)
			_hold_corpse(w, corpse, delta, 0.3)
			var me: Vector3 = b.position_ground()
			if Vector2(dump.x - me.x, dump.z - me.z).length() < 0.6 or float(w["stage_t"]) > 60.0:
				w["stage"] = "heave"
				w["stage_t"] = 0.0
		"heave":
			# Up and over the side.
			b.move_velocity = Vector3.ZERO
			var k := clampf(float(w["stage_t"]) / 1.4, 0.0, 1.0)
			var over := bin_at + Vector3(0, 1.6, 0)
			var from: Vector3 = b.position_ground() + (b.facing as Vector3) * 0.5 + Vector3.UP * 0.6
			var tgt: Vector3 = from.lerp(over, smoothstep(0.0, 1.0, k))
			for part in [chest, corpse.pelvis]:
				var rb := part as RigidBody3D
				var want: Vector3 = tgt + (Vector3.DOWN * 0.35 if rb == corpse.pelvis else Vector3.ZERO)
				rb.linear_velocity = ((want - rb.global_position) * 5.0).limit_length(3.5)
			b.hand_goal["r"] = cp + Vector3(0, 0, 0.12)
			b.hand_goal["l"] = cp - Vector3(0, 0, 0.12)
			if k >= 1.0:
				Game.play_3d(Sfx.get_stream(&"body_fall"), bin_at + Vector3.UP * 0.5, -4.0, 0.1, 3.0)
				corpse.set_meta("binned", true)
				var gone: Node3D = corpse
				get_tree().create_timer(4.0).timeout.connect(func():
					if is_instance_valid(gone):
						Game.bots.erase(gone)
						gone.queue_free())
				_claimed.erase(corpse)
				w["corpse"] = null
				b.hand_goal["r"] = Vector3.INF
				b.hand_goal["l"] = Vector3.INF


## His hands under the dead man's arms, the chest pulled along to them.
func _hold_corpse(w: Dictionary, corpse: Node3D, _delta: float, lift: float) -> void:
	var b: Node3D = w["who"]
	var chest: RigidBody3D = corpse.chest
	var fwd := Vector3(b.facing.x, 0.0, b.facing.z).normalized()
	var side := fwd.cross(Vector3.UP)
	var grip: Vector3 = b.position_ground() + fwd * 0.5 + Vector3.UP * lift
	# (low and steady: dragged along the floor, not thrown about)
	var v := ((grip - chest.global_position) * 3.0).limit_length(1.6)
	v.y = clampf(v.y, -1.0, 0.35)
	chest.linear_velocity = v
	b.hand_goal["r"] = chest.global_position - side * 0.13
	b.hand_goal["l"] = chest.global_position + side * 0.13
	b.look_target = chest.global_position
	b.has_look_target = true


func _drop_corpse(w: Dictionary) -> void:
	var c = w.get("corpse")
	if c != null:
		_claimed.erase(c)
	w["corpse"] = null


# --- Mops and rags --------------------------------------------------------------------------

## The floor round the table: the pools first (nearest first), then a
## sweep round the table for the rest. Two mops split it between them.
func _floor_jobs(which: int) -> Array:
	var c: Vector3 = hall["center"]
	var jobs: Array = []
	if Game.blood:
		for pool in Game.blood._pools:
			var p: Vector3 = pool.pos
			if p.distance_to(c) < 6.0 and absf(p.y - c.y) < 0.5 and pool.vol > 0.3:
				jobs.append({"at": p, "n": Vector3.UP, "r": maxf(pool.r, 0.3)})
	for k in 10:
		var a := TAU * float(k) / 10.0 + (0.3 if which == 1 else 0.0)
		var rr := 1.9 if k % 2 == 0 else 2.6
		jobs.append({"at": c + Vector3(cos(a), 0, sin(a)) * rr + Vector3.UP * 0.005, "n": Vector3.UP, "r": 0.45})
	var mine: Array = []
	for i in jobs.size():
		if i % 2 == which:
			mine.append(jobs[i])
	return mine


## The walls near the table and the table top itself.
func _wall_jobs(which: int) -> Array:
	var c: Vector3 = hall["center"]
	var bounds: Array = hall["bounds"]
	var jobs: Array = []
	if which == 0:
		for k in 5:
			var a := TAU * float(k) / 5.0
			jobs.append({"at": c + Vector3(cos(a) * 0.4, 0.78, sin(a) * 0.4), "n": Vector3.UP, "r": 0.35, "table": true})
	var zs := [float(bounds[2]) + 0.01, float(bounds[3]) - 0.01]
	for dx in [-3.0, -1.5, 0.0, 1.5, 3.0]:
		var x := clampf(c.x + dx, float(bounds[0]) + 1.5, float(bounds[1]) - 0.5)
		var z: float = zs[which]
		jobs.append({"at": Vector3(x, c.y + 1.35, z), "n": Vector3(0, 0, 1) if which == 0 else Vector3(0, 0, -1), "r": 0.45})
		jobs.append({"at": Vector3(x, c.y + 0.7, z), "n": Vector3(0, 0, 1) if which == 0 else Vector3(0, 0, -1), "r": 0.45})
	return jobs


func _scrub(w: Dictionary, delta: float) -> void:
	var b: Node3D = w["who"]
	var jobs: Array = w["jobs"]
	var j: int = w["job"]
	if j < 0 or j >= jobs.size():
		j += 1
		if j >= jobs.size():
			w["state"] = "home"
			return
		w["job"] = j
		w["job_t"] = 0.0
		w["arrived"] = false
	var job: Dictionary = jobs[j]
	var at: Vector3 = job["at"]
	var n: Vector3 = job["n"]
	var c: Vector3 = hall["center"]
	# Where he stands: back off the wall, or out from the table, or at the spot.
	var stand: Vector3
	if job.get("table", false):
		var out := Vector3(at.x - c.x, 0.0, at.z - c.z).normalized()
		stand = Vector3(c.x, c.y, c.z) + out * (float(Game.main.map.game_tables[0]["radius"]) + 0.3) + Vector3(out.z, 0, -out.x) * 0.3
	elif n.y > 0.5:
		var out2 := Vector3(at.x - c.x, 0.0, at.z - c.z)
		out2 = out2.normalized() if out2.length() > 0.1 else Vector3(1, 0, 0)
		stand = Vector3(at.x, c.y, at.z) + out2 * 0.75
	else:
		stand = Vector3(at.x, c.y, at.z) + n * 0.65
	if not w.get("arrived", false):
		_carry_prop(w, delta, false)
		b.hand_goal["r"] = Vector3.INF
		b.hand_goal["l"] = Vector3.INF
		if _walk(w, stand, delta, 1.3):
			w["arrived"] = true
			w["job_t"] = 0.0
		return
	b.move_velocity = Vector3.ZERO
	var me: Vector3 = b.position_ground()
	var face := Vector3(at.x - me.x, 0.0, at.z - me.z)
	if face.length() > 0.05:
		b.facing = (b.facing as Vector3).slerp(face.normalized(), minf(delta * 5.0, 1.0)).normalized()
	w["job_t"] = float(w["job_t"]) + delta
	var t: float = w["job_t"]
	# The stroke: back and forth across the spot (a figure of eight on a wall).
	var along := Vector3(face.z, 0.0, -face.x).normalized() if face.length() > 0.05 else Vector3.RIGHT
	var up := Vector3.UP if n.y < 0.5 else (face.normalized() if face.length() > 0.05 else Vector3.FORWARD)
	var r: float = job["r"]
	var head := at + along * sin(t * 3.2) * r * 0.8 + up * sin(t * 6.4) * r * 0.35
	w["head"] = head
	_carry_prop(w, delta, true)
	b.look_target = at
	b.has_look_target = true
	w["wipe_t"] = float(w["wipe_t"]) - delta
	if w["wipe_t"] <= 0.0 and Game.blood:
		w["wipe_t"] = 0.12
		Game.blood.wipe(head, n, 0.28, 0.3)
	if t > 4.5:
		w["job"] = j + 1
		w["job_t"] = 0.0
		w["arrived"] = false
		if int(w["job"]) >= jobs.size():
			w["state"] = "home"


## The mop (handle from the hands down to the head on the floor) or the rag
## (in the right hand, pressed on the spot).
func _carry_prop(w: Dictionary, _delta: float, working: bool) -> void:
	var prop: Node3D = w.get("prop")
	if prop == null or not is_instance_valid(prop):
		return
	var b: Node3D = w["who"]
	var me: Vector3 = b.position_ground()
	var fwd := Vector3(b.facing.x, 0.0, b.facing.z).normalized()
	var side := fwd.cross(Vector3.UP)
	if w["role"] == "mop":
		var head: Vector3 = w["head"] if working and w.has("head") else me + fwd * 0.45 - side * 0.25
		head.y = me.y + 0.03
		var top := me + fwd * 0.28 - side * 0.18 + Vector3.UP * 1.05
		var axis := top - head
		var y := axis.normalized()
		var x := y.cross(Vector3.UP if absf(y.y) < 0.95 else Vector3.RIGHT).normalized()
		prop.global_transform = Transform3D(Basis(x, y, x.cross(y)), head)
		b.hand_goal["r"] = head.lerp(top, 0.95)
		b.hand_goal["l"] = head.lerp(top, 0.6)
	else:
		var at: Vector3 = w["head"] if working and w.has("head") else me + fwd * 0.3 - side * 0.3 + Vector3.UP * 0.85
		prop.global_position = at
		b.hand_goal["r"] = at if working else Vector3.INF
		b.hand_goal["l"] = Vector3.INF


func _mop() -> Node3D:
	var root := Node3D.new()
	var handle := MeshInstance3D.new()
	var hm := CylinderMesh.new()
	hm.top_radius = 0.013
	hm.bottom_radius = 0.013
	hm.height = 1.3
	handle.mesh = hm
	var wood := StandardMaterial3D.new()
	wood.albedo_color = Color(0.45, 0.35, 0.22)
	handle.material_override = wood
	handle.position = Vector3(0, 0.65, 0)
	root.add_child(handle)
	var strands := MeshInstance3D.new()
	var sm := CylinderMesh.new()
	sm.top_radius = 0.05
	sm.bottom_radius = 0.13
	sm.height = 0.14
	strands.mesh = sm
	var grey := StandardMaterial3D.new()
	grey.albedo_color = Color(0.55, 0.5, 0.45)
	grey.roughness = 1.0
	strands.material_override = grey
	strands.position = Vector3(0, 0.05, 0)
	root.add_child(strands)
	Game.main.add_child(root)
	return root


func _rag() -> Node3D:
	var rag := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.14, 0.03, 0.1)
	rag.mesh = bm
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.75, 0.62, 0.2)
	m.roughness = 1.0
	rag.material_override = m
	Game.main.add_child(rag)
	return rag
