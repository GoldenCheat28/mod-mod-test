extends Node
## People far off and out of sight are not worked out at all: each is a
## few dozen jointed bodies with muscles and a mind of its own, and the
## physics of all of them, all the time, is most of what a frame costs. One
## more than SLEEP_DIST away and not in view is taken out of the world
## (still drawn where he stood, not moved, not thinking) until the player
## comes nearer or turns to look his way - then he goes on from there.
## Whoever is busy with something that matters (a game at a table, walking
## to one, working here) is never put to sleep.

const SLEEP_DIST := 35.0
const WAKE_DIST := 30.0
const SEEN_DIST := 60.0          # further than this, even in view he may sleep

var _t := 0.0
var asleep := {}


func _physics_process(delta: float) -> void:
	_t -= delta
	if _t > 0.0:
		return
	_t = 0.4
	var p = Game.player
	var cam := get_viewport().get_camera_3d()
	if p == null or cam == null:
		return
	var eye: Vector3 = cam.global_position
	for b in Game.bots:
		if not is_instance_valid(b) or not b.alive or b.ai == null or b.player_owner != null:
			continue
		var at: Vector3 = b.global_position if b.parts.is_empty() else b.pelvis.global_position
		var d := at.distance_to(eye)
		var seen := d < SEEN_DIST and cam.is_position_in_frustum(at)
		var busy: bool = (b.ai.roulette != null and not b.ai.roulette.get("lod_ok")) or b.ai.spectate != null or b.ai.player_talk != null or b.fallen \
				or b.burning > 0.0 or b.cuffed or b.weapon != null
		if asleep.has(b):
			if d < WAKE_DIST or seen or busy:
				_wake(b)
		elif d > SLEEP_DIST and not seen and not busy and b.pelvis.linear_velocity.length() < 3.0:
			_sleep(b)


func _sleep(b: Node3D) -> void:
	asleep[b] = true
	b.process_mode = Node.PROCESS_MODE_DISABLED


func _wake(b: Node3D) -> void:
	asleep.erase(b)
	b.process_mode = Node.PROCESS_MODE_INHERIT
	for part in b.parts:
		part.linear_velocity = Vector3.ZERO
		part.angular_velocity = Vector3.ZERO


## Wake everyone (a loud shot, a blast: they all react).
func wake_all() -> void:
	for b in asleep.keys():
		if is_instance_valid(b):
			_wake(b)
	asleep.clear()
