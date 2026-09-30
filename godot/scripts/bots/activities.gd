extends Node3D
## Things for the people here to do, so they are not just walking about:
## places on the map where someone can go and spend a few minutes, alone or
## with others.
##  - "chat": a few stand in a loose ring and talk (one talks, the others
##    look at him; now and then someone smokes);
##  - "squat": the same, down on their heels;
##  - "graffiti": a wall someone sprays a tag on (the paint stays), perhaps
##    with a mate standing behind smoking;
##  - "smoke": a wall to lean on with a cigarette, alone.
## A calm bot asks for something to do (join) and is given a place in one,
## preferring ones where people already are; it lets go (release) when done
## or scared. What it then does there is bot_activity.gd.

const Graffiti = preload("res://scripts/world/graffiti.gd")

var spots: Array = []            # {kind, center, slots: [{pos, face, bot}], graffiti?, wall?...}
var rng := RandomNumberGenerator.new()
var _built := false


func _ready() -> void:
	rng.randomize()


func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["activities._physics_process"] = Game.prof.get("activities._physics_process", 0) + __d
	Game.prof["max activities._physics_process"] = maxi(Game.prof.get("max activities._physics_process", 0), __d)


func _physics_process_real(_delta: float) -> void:
	# (in a game with others the host's people do things; a client's are puppets)
	if Net.active and Net.in_game and not Net.is_host:
		return
	if not _built and Game.main and Game.main.map:
		var map_rid := get_world_3d().navigation_map
		# The walkable ground is baked in the background: wait till it answers.
		if NavigationServer3D.map_get_iteration_id(map_rid) > 0 				and NavigationServer3D.map_get_closest_point(map_rid, Vector3(3.0, 0.0, 3.0)) != Vector3.ZERO:
			_built = true
			_build(map_rid)


## Finds the places: walls (for spraying and leaning) and open ground (for
## standing or squatting about).
func _build(nav: RID) -> void:
	var space := get_world_3d().direct_space_state
	# Benches: two places each, sat facing the way the bench faces.
	for bench in preload("res://scripts/world/street_env.gd").benches:
		var at: Vector3 = bench[0]
		var b := Basis(Vector3.UP, float(bench[1]))
		var fwd := b * Vector3(0, 0, 1)
		var slots: Array = []
		for dx in [-0.45, 0.45]:
			var seat: Vector3 = at + b * Vector3(dx, 0.48, -0.06)
			var stand := Vector3(seat.x, at.y, seat.z) + fwd * 0.45
			slots.append({"pos": stand, "face": stand + fwd * 3.0, "bot": null, "seat": seat})
		spots.append({"kind": "bench", "center": at + fwd * 0.4, "slots": slots, "speaker": null, "speak_until": 0.0})
	# Chairs and the sofa in the abandoned building (furniture.gd): sat on,
	# one to a seat, watching the television where there is one.
	for seat in preload("res://scripts/world/furniture.gd").seats:
		var look: Vector3 = seat["look"]
		var face: Vector3 = look if look != Vector3.INF else (seat["pos"] as Vector3) + Basis(Vector3.UP, float(seat["yaw"])) * Vector3(0, 0, 3)
		spots.append({"kind": "tv" if look != Vector3.INF else "chair", "center": seat["pos"], "tv": look,
				"slots": [{"pos": seat["stand"], "face": face, "bot": null, "seat": seat["seat"], "sit_at": seat["pos"]}],
				"speaker": null, "speak_until": 0.0, "indoor": true})
	var walls := 0
	var leans := 0
	var open := 0
	for attempt in 400:
		if walls >= 4 and leans >= 3 and open >= 7:
			break
		# Anywhere on the walkable ground (the map is about 110 m across).
		var guess := Vector3(rng.randf_range(-55.0, 55.0), 0.0, rng.randf_range(-55.0, 55.0))
		var p := NavigationServer3D.map_get_closest_point(nav, guess)
		if p.distance_to(Vector3(guess.x, p.y, guess.z)) > 3.0 or _near_spot(p, 6.0):
			continue
		var wall := _wall_near(space, p)
		if not wall.is_empty() and (walls < 4 or leans < 3):
			var n: Vector3 = wall["normal"]
			var hit: Vector3 = wall["point"]
			if walls < 4:
				_add_graffiti(hit, n)
				walls += 1
			else:
				var stand := Vector3(hit.x, p.y, hit.z) + n * 0.3
				spots.append({"kind": "smoke", "center": stand, "normal": n, "slots": [{"pos": stand, "face": stand + n, "bot": null}]})
				leans += 1
			continue
		if open < 7 and _clear_around(space, p, 1.6):
			var kind := "squat" if rng.randf() < 0.4 else "chat"
			var r := 0.55 if kind == "squat" else 0.65
			var count := rng.randi_range(2, 4)
			var slots: Array = []
			var a0 := rng.randf() * TAU
			for i in count:
				var a := a0 + TAU * i / count + rng.randf_range(-0.2, 0.2)
				var sp := p + Vector3(cos(a), 0.0, sin(a)) * r
				slots.append({"pos": sp, "face": p, "bot": null})
			spots.append({"kind": kind, "center": p, "slots": slots, "speaker": null, "speak_until": 0.0,
					"indoor": _under_roof(space, p)})
			open += 1
	# And a couple of places to stand about out of the weather, inside.
	for c in [Vector3(-3.0, 0.15, -14.0), Vector3(4.0, 0.15, -17.5), Vector3(-5.0, 3.4, -17.0), Vector3(-12.8, 0.1, -12.0)]:
		var p2 := NavigationServer3D.map_get_closest_point(nav, c)
		if p2.distance_to(c) > 1.5:
			continue
		var slots2: Array = []
		for i in 3:
			var a := TAU * i / 3.0
			slots2.append({"pos": p2 + Vector3(cos(a), 0.0, sin(a)) * 0.65, "face": p2, "bot": null})
		spots.append({"kind": "chat", "center": p2, "slots": slots2, "speaker": null, "speak_until": 0.0, "indoor": true})


func _under_roof(space: PhysicsDirectSpaceState3D, p: Vector3) -> bool:
	var q := PhysicsRayQueryParameters3D.create(p + Vector3.UP * 2.2, p + Vector3.UP * 12.0, Game.LAYER_WORLD)
	return not space.intersect_ray(q).is_empty()


## Rain, or night (worst: both): out there is no place to be.
static func bad_weather() -> float:
	var m = Game.main
	if m == null:
		return 0.0
	var rain: float = m.weather.rain_amount() if m.weather else 0.0
	var night: float = m.day_night.night if m.day_night else 0.0
	return clampf(rain * 0.7 + night * 0.4 + rain * night * 0.6, 0.0, 1.0)


func _near_spot(p: Vector3, d: float) -> bool:
	for s in spots:
		if (s["center"] as Vector3).distance_to(p) < d:
			return true
	return false


## A flat, upright wall close by, wide enough to use.
func _wall_near(space: PhysicsDirectSpaceState3D, p: Vector3) -> Dictionary:
	for k in 8:
		var dir := Vector3(cos(TAU * k / 8.0), 0.0, sin(TAU * k / 8.0))
		var from := p + Vector3.UP * 1.3
		var q := PhysicsRayQueryParameters3D.create(from, from + dir * 2.0, Game.LAYER_WORLD)
		var hit := space.intersect_ray(q)
		if hit.is_empty() or absf((hit.normal as Vector3).y) > 0.15:
			continue
		var n: Vector3 = hit.normal
		var along := Vector3.UP.cross(n).normalized()
		# Wide and tall enough: the same wall 0.9 m either side and up and down.
		var ok := true
		for off in [along * 0.9, -along * 0.9, Vector3.UP * 0.5, Vector3.DOWN * 0.5]:
			var f2: Vector3 = from + off
			var q2 := PhysicsRayQueryParameters3D.create(f2, f2 - n * 2.5, Game.LAYER_WORLD)
			var h2 := space.intersect_ray(q2)
			if h2.is_empty() or (h2.normal as Vector3).dot(n) < 0.97 or absf((h2.position - hit.position).dot(n)) > 0.05:
				ok = false
				break
		if ok:
			return {"point": hit.position, "normal": n}
	return {}


func _clear_around(space: PhysicsDirectSpaceState3D, p: Vector3, r: float) -> bool:
	for k in 8:
		var dir := Vector3(cos(TAU * k / 8.0), 0.0, sin(TAU * k / 8.0))
		var from := p + Vector3.UP * 0.8
		var q := PhysicsRayQueryParameters3D.create(from, from + dir * r, Game.LAYER_WORLD | Game.LAYER_PROPS)
		if not space.intersect_ray(q).is_empty():
			return false
	return true


func _add_graffiti(hit: Vector3, n: Vector3) -> void:
	var g := Graffiti.new()
	add_child(g)
	var middle := Vector3(hit.x, 0.0, hit.z) + Vector3.UP * (_ground_y(hit) + 1.35)
	g.setup(middle + n * 0.02, n, Vector2(1.6, 1.0))
	var stand := Vector3(hit.x, _ground_y(hit), hit.z) + n * 0.55
	var watch := stand + n * 1.3 + Vector3.UP.cross(n).normalized() * 0.6
	spots.append({"kind": "graffiti", "center": stand, "graffiti": g, "normal": n,
			"tag": Graffiti.make_tag(rng, 1.35, 0.5), "stroke": 0, "point": 0, "coat": 0,
			"colors": _tag_colors(),
			"slots": [{"pos": stand, "face": stand - n, "bot": null, "painter": true},
					{"pos": watch, "face": middle, "bot": null}]})


func _ground_y(p: Vector3) -> float:
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(p + Vector3.UP * 0.5, p + Vector3.DOWN * 3.0, Game.LAYER_WORLD)
	var hit := space.intersect_ray(q)
	return hit.position.y if not hit.is_empty() else p.y


func _tag_colors() -> Array:
	var fills := [Color(0.85, 0.1, 0.1), Color(0.1, 0.35, 0.85), Color(0.95, 0.75, 0.1), Color(0.2, 0.7, 0.3),
			Color(0.9, 0.9, 0.9), Color(0.6, 0.2, 0.7), Color(0.95, 0.45, 0.1)]
	var f: Color = fills[rng.randi() % fills.size()]
	var outline := Color(0.05, 0.05, 0.06) if f.v > 0.55 or rng.randf() < 0.5 else Color(0.95, 0.95, 0.95)
	var shadow := Color(0.02, 0.02, 0.03) if outline.v > 0.5 else f.darkened(0.6)
	# [shadow, outline, fill, shine] (Graffiti.COATS)
	return [shadow, outline, f, Color(1.0, 1.0, 0.97)]


## Something to do for `bot`, or {}: a place in an activity (the slot), with
## the activity itself as slot["spot"]. Where people already are is liked
## better; far away is not.
func join(bot: Node3D) -> Dictionary:
	var me: Vector3 = bot.position_ground()
	var best: Dictionary = {}
	var best_score := -INF
	var bad := bad_weather()
	for s in spots:
		var free: Array = []
		var taken := 0
		for sl in s["slots"]:
			if sl["bot"] == null or not is_instance_valid(sl["bot"]) or not sl["bot"].alive:
				sl["bot"] = null
				free.append(sl)
			else:
				taken += 1
		if free.is_empty():
			continue
		var d := me.distance_to(s["center"])
		if d > (70.0 if s.get("indoor", false) and bad > 0.3 else 45.0):
			continue
		var score := -d * 0.08 + taken * 1.5 + rng.randf() * 1.5
		# In the rain at night nearly everyone goes in under a roof.
		if s.get("indoor", false):
			score += bad * 9.0
		else:
			score -= bad * 5.0
		# The graffiti wall: the painter's place first.
		var slot: Dictionary = free[0]
		for sl in free:
			if sl.get("painter", false):
				slot = sl
		if score > best_score:
			best_score = score
			best = slot
			best["spot"] = s
	if not best.is_empty():
		best["bot"] = bot
	return best


func release(slot: Dictionary) -> void:
	if not slot.is_empty():
		slot["bot"] = null
