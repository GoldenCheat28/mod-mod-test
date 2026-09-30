extends Node
## New dirt as time goes on (stain.gd): now and then some turns up of itself
## (soot, grime, rust weeping, an oil spot, mud splashed up a wall after
## rain), and people make it - muddy boot prints where they walk, worse
## when it is wet out, and a greasy patch on the wall where someone keeps
## leaning to smoke. The host decides; everyone else is told (net.gd).

const Stain = preload("res://scripts/world/stain.gd")
const Graffiti = preload("res://scripts/world/graffiti.gd")
const MAX_NEW := 40               # made since the level began (then only as old ones are cleaned)

var rng := RandomNumberGenerator.new()
var _self_t := 0.0
var _bot_t := 0.0
var _made: Array = []


func _ready() -> void:
	rng.randomize()
	_self_t = rng.randf_range(40.0, 90.0) if OS.get_environment("DIRT_FAST") == "" else 1.0


func _physics_process(delta: float) -> void:
	if Game.main == null or (Net.active and not Net.is_host):
		return
	_made = _made.filter(func(s): return is_instance_valid(s) and not s._gone)
	# (time runs faster while one sleeps: so does the dirt)
	var d := delta * maxf(Game.fast, 1.0)
	_self_t -= d
	if _self_t <= 0.0:
		_self_t = rng.randf_range(70.0, 160.0) if OS.get_environment("DIRT_FAST") == "" else 1.0
		if _made.size() < MAX_NEW:
			_on_its_own()
	_bot_t -= d
	if _bot_t <= 0.0:
		_bot_t = 1.0
		if _made.size() < MAX_NEW:
			for b in Game.bots:
				if is_instance_valid(b) and b.alive and b.ai and not b.has_meta("puppet"):
					_from_bot(b)


func _wet() -> float:
	var w = Game.main.get("weather")
	return float(w.wetness) if w else 0.0


## Some dirt turning up of itself on a wall or a floor.
func _on_its_own() -> void:
	var space := get_viewport().world_3d.direct_space_state
	var wet := _wet()
	for attempt in 30:
		var indoor := rng.randf() < 0.45
		var p := Vector3(rng.randf_range(-33.0, 33.0), rng.randf_range(0.6, 1.6), rng.randf_range(-33.0, 33.0))
		if indoor:
			p = Vector3(rng.randf_range(-9.5, 9.5), rng.randf_range(0.6, 1.6), rng.randf_range(-21.5, -8.5))
		if rng.randf() < 0.35:
			# On a floor.
			var q := PhysicsRayQueryParameters3D.create(Vector3(p.x, 2.9 if indoor else 8.0, p.z), Vector3(p.x, -1.0, p.z), Game.LAYER_WORLD)
			var hit := space.intersect_ray(q)
			if hit.is_empty() or (hit.normal as Vector3).y < 0.9 or (hit.position as Vector3).y > 3.2 or Graffiti.find(hit.position, Vector3.UP, 0.0):
				continue
			var kind := "oil" if rng.randf() < 0.5 else "mud_floor"
			var e := rng.randf_range(0.5, 1.1)
			_make((hit.position as Vector3) + Vector3.UP * 0.01, Vector3.UP, Vector2(e, e * rng.randf_range(0.7, 1.2)), kind)
			return
		var a := rng.randf() * TAU
		var q2 := PhysicsRayQueryParameters3D.create(p, p + Vector3(cos(a), 0, sin(a)) * 4.0, Game.LAYER_WORLD)
		var h2 := space.intersect_ray(q2)
		if h2.is_empty() or absf((h2.normal as Vector3).y) > 0.15:
			continue
		var n: Vector3 = h2.normal
		var at: Vector3 = h2.position
		if Graffiti.find(at, n, 0.0):
			continue
		var gq := PhysicsRayQueryParameters3D.create(at + n * 0.15, at + n * 0.15 + Vector3.DOWN * 3.0, Game.LAYER_WORLD)
		var gh := space.intersect_ray(gq)
		if gh.is_empty():
			continue
		# After rain, mud splashed up the foot of the walls outside.
		var kinds := ["soot", "grime", "rust", "mud"]
		var kind: String = "mud" if (wet > 0.3 and not indoor and rng.randf() < 0.6) else kinds[rng.randi() % kinds.size()]
		var ext := Vector2(rng.randf_range(0.6, 1.3), rng.randf_range(0.5, 1.1))
		var foot: float = (gh.position as Vector3).y
		var y := foot + ext.y * 0.5 + (0.02 if kind == "mud" else rng.randf_range(0.1, 0.8))
		_make(Vector3(at.x, y, at.z) + n * 0.01, n, ext, kind)
		return


## What a person leaves behind as he goes about.
func _from_bot(b: Node3D) -> void:
	var ai = b.ai
	var wet := _wet()
	# Muddy prints where he walks: now and then, far more when it is wet.
	var v: Vector3 = b.move_velocity
	if v.length() > 0.6 and not b.fallen and rng.randf() < 0.004 + 0.03 * wet:
		var foot: Vector3 = b.position_ground()
		var q := PhysicsRayQueryParameters3D.create(foot + Vector3.UP * 0.4, foot + Vector3.DOWN * 0.4, Game.LAYER_WORLD)
		var hit := get_viewport().world_3d.direct_space_state.intersect_ray(q)
		if not hit.is_empty() and (hit.normal as Vector3).y > 0.9 and not Graffiti.find(hit.position, Vector3.UP, 0.0):
			_make((hit.position as Vector3) + Vector3.UP * 0.01, Vector3.UP, Vector2(1.4, 0.6), "prints")
	# Leaning on the same wall to smoke, day after day: a greasy patch.
	var act = ai.get("act")
	if act != null and act.kind == "smoke" and act.arrived and rng.randf() < 0.01:
		var spot: Dictionary = act.spot
		if spot.has("normal"):
			var n: Vector3 = spot["normal"]
			var at: Vector3 = b.position_ground() - n * 0.25 + Vector3.UP * 1.1
			var q2 := PhysicsRayQueryParameters3D.create(at + n * 0.4, at - n * 0.5, Game.LAYER_WORLD)
			var h2 := get_viewport().world_3d.direct_space_state.intersect_ray(q2)
			if not h2.is_empty() and not Graffiti.find(h2.position, h2.normal, 0.0):
				_make((h2.position as Vector3) + (h2.normal as Vector3) * 0.01, h2.normal, Vector2(0.6, 0.8), "grime")


func _make(p: Vector3, n: Vector3, ext: Vector2, kind: String) -> void:
	var sd := rng.randi()
	if OS.get_environment("DIRT_FAST") != "":
		print("dirt ", kind, " at ", p)
	_made.append(Stain.make(Game.main, p, n, ext, kind, sd))
	Net.stain_new(p, n, ext, kind, sd)
