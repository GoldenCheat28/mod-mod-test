extends Node
## Bot brain. Perceives the player (sight, aim, gunshots, near misses,
## other bots getting hurt), keeps a fear level shaped by personality, and
## picks behaviour: wander, idle, nervous watching, surrender, flee to
## cover, hide, or crawl away when downed. Drives the humanoid body by
## setting its move velocity, facing, look target and posture.

enum S { WANDER, IDLE, NERVOUS, SURRENDER, FLEE, HIDE, DOWNED, DEAD }

## Mirrors humanoid.gd Posture.
enum Posture { STAND, CROUCH, HANDS_UP, COVER_HEAD }

var body: Node3D
var rng := RandomNumberGenerator.new()
var state := S.WANDER
var fear := 0.0
var bravery := 0.5
var nervousness := 1.0

var _state_t := 0.0
var _think_t := 0.0
var _path := PackedVector3Array()
var _path_i := 0
var _goal := Vector3.ZERO
var _speed := 1.3
var _face_player := false
var _stuck_t := 0.0
var _stuck_pos := Vector3.ZERO

var _sees := false
var _aimed := false
var _aimed_t := 0.0
var _not_aimed_t := 0.0
var _threat := Vector3.ZERO
var _threat_known := false
var _player_dist := 999.0
var _hidden := false
var _look := Vector3.ZERO
var _look_t := 0.0
var _hurt_recent := 0.0
var _replan_t := 0.0


func setup(b: Node3D, seed_value: int) -> void:
	body = b
	rng.seed = seed_value
	bravery = rng.randf_range(0.1, 0.9)
	nervousness = rng.randf_range(0.7, 1.4)
	_speed = rng.randf_range(1.15, 1.45)
	Game.gunshot.connect(_on_gunshot)
	Game.bullet_passed.connect(_on_bullet_passed)
	Game.bot_hurt.connect(_on_bot_hurt)
	_think_t = rng.randf() * 0.2


func _physics_process(delta: float) -> void:
	if body == null or body.parts.is_empty():
		return
	if not body.alive:
		if state != S.DEAD:
			state = S.DEAD
			body.move_velocity = Vector3.ZERO
		return
	_state_t += delta
	_hurt_recent = maxf(_hurt_recent - delta, 0.0)
	_think_t -= delta
	if _think_t <= 0.0:
		var dt := 0.12
		_think_t = dt + rng.randf() * 0.04
		_perceive(dt)
		_decide()
	_steer(delta)


# --- Perception ------------------------------------------------------------------

func _space() -> PhysicsDirectSpaceState3D:
	return body.get_world_3d().direct_space_state


func _line_clear(a: Vector3, b: Vector3) -> bool:
	var q := PhysicsRayQueryParameters3D.create(a, b, Game.LAYER_WORLD)
	return _space().intersect_ray(q).is_empty()


func _perceive(dt: float) -> void:
	var p: Node3D = Game.player
	if p == null:
		return
	var eye: Vector3 = body.eye_position()
	var cam: Camera3D = p.cam
	var peye := cam.global_position
	var to := peye - eye
	_player_dist = to.length()
	_sees = false
	if _player_dist < 45.0:
		var fwd: Vector3 = -body.head.global_basis.z
		var facing_ok := fwd.dot(to / _player_dist) > cos(deg_to_rad(70.0))
		if (facing_ok or _player_dist < 3.0) and _line_clear(eye, peye):
			_sees = true
	if _sees:
		_threat = p.global_position
		_threat_known = true

	# Is the gun pointed at me?
	var aim := -cam.global_basis.z
	var to_me: Vector3 = body.chest.global_position - peye
	var ang := aim.angle_to(to_me)
	var tolerance := atan2(0.5, maxf(to_me.length(), 0.5)) + deg_to_rad(3.0)
	_aimed = _sees and ang < tolerance and _player_dist < 40.0
	if _aimed:
		_aimed_t += dt
		_not_aimed_t = 0.0
	else:
		_aimed_t = 0.0
		_not_aimed_t += dt

	# Hidden from the player's eye?
	_hidden = not _line_clear(peye, eye)

	# Fear dynamics.
	if _sees:
		var close := clampf(1.0 - _player_dist / 16.0, 0.0, 1.0)
		fear += dt * (0.015 + 0.13 * close * close) * nervousness
	if _aimed:
		fear += dt * 0.55 * (1.25 - bravery) * nervousness
	if not _sees:
		fear -= dt * 0.03
	elif _player_dist > 25.0:
		fear -= dt * 0.01
	fear = clampf(fear, 0.0, 1.5)


func _on_gunshot(origin: Vector3, loudness: float) -> void:
	if not body.alive:
		return
	var d: float = origin.distance_to(body.pelvis.global_position)
	var reach := 75.0 * loudness
	if d > reach:
		return
	var k := 1.0 - d / reach
	fear += (0.25 + 0.45 * k) * (1.3 - bravery) * nervousness
	if _sees:
		fear += 0.15
	_threat = origin
	_threat_known = true


func _on_bullet_passed(from: Vector3, to: Vector3) -> void:
	if not body.alive:
		return
	var head: Vector3 = body.head.global_position
	var seg := to - from
	var t := clampf((head - from).dot(seg) / maxf(seg.length_squared(), 0.0001), 0.0, 1.0)
	if head.distance_to(from + seg * t) < 1.6:
		fear += 0.45 * (1.3 - bravery)
		_threat = from
		_threat_known = true


func _on_bot_hurt(other: Node3D, pos: Vector3) -> void:
	if other == body or not body.alive:
		return
	var d: float = pos.distance_to(body.pelvis.global_position)
	if d < 25.0:
		fear += 0.55 * (1.0 - d / 25.0) * nervousness


func on_hurt(_point: Vector3, _dir: Vector3) -> void:
	fear = maxf(fear, 0.8) + 0.3
	_hurt_recent = 3.0
	if Game.player:
		_threat = Game.player.global_position
		_threat_known = true
	if state != S.DOWNED:
		_enter(S.FLEE)


# --- Decisions ---------------------------------------------------------------------

func _enter(s: S) -> void:
	if s == state and s != S.FLEE:
		return
	state = s
	_state_t = 0.0
	_replan_t = 0.0
	_path = PackedVector3Array()
	_path_i = 0
	_face_player = false
	body.posture = Posture.STAND
	match s:
		S.WANDER:
			_goto(_random_nearby(4.0, 14.0))
		S.FLEE:
			_goto(_pick_cover())
		S.NERVOUS:
			pass


func _decide() -> void:
	if body.fallen or not body.conscious:
		if state != S.DOWNED:
			_enter(S.DOWNED)
		return
	if state == S.DOWNED:
		_enter(S.FLEE if fear > 0.5 else S.WANDER)
		return

	match state:
		S.WANDER, S.IDLE:
			if fear > 0.42:
				_panic_choice()
			elif fear > 0.15:
				_enter(S.NERVOUS)
			elif state == S.WANDER and _path.is_empty():
				state = S.IDLE
				_state_t = 0.0
			elif state == S.IDLE and _state_t > rng.randf_range(2.0, 6.0):
				_enter(S.WANDER)
		S.NERVOUS:
			if fear > 0.42:
				_panic_choice()
			elif fear < 0.1:
				_enter(S.WANDER)
			else:
				_nervous_move()
		S.SURRENDER:
			# Runs when the gun is lowered for a moment, or if it gets too scary.
			if fear > 1.05 or _hurt_recent > 0.0:
				_enter(S.FLEE)
			elif _not_aimed_t > 1.2 + bravery * 1.5:
				_enter(S.FLEE)
			elif not _sees and _state_t > 3.0:
				_enter(S.FLEE)
		S.FLEE:
			var arrived := _path.is_empty() or _path_i >= _path.size()
			if arrived:
				if _hidden:
					_enter(S.HIDE)
				else:
					_goto(_pick_cover())
			elif _state_t - _replan_t > 1.5 and not _hidden and _sees:
				# Re-plan periodically when still exposed.
				_replan_t = _state_t
				_goto(_pick_cover())
		S.HIDE:
			if not _hidden and _sees and _player_dist < 25.0:
				_enter(S.FLEE)
			elif fear < 0.3 and _state_t > 6.0:
				_enter(S.WANDER)
			else:
				body.posture = Posture.COVER_HEAD if fear > 0.85 else Posture.CROUCH


func _panic_choice() -> void:
	var can_run: bool = body.mobility() > 0.35
	if _aimed and bravery < 0.55 and _player_dist < 18.0 and fear < 0.95 and _hurt_recent <= 0.0:
		_enter(S.SURRENDER)
		body.posture = Posture.HANDS_UP
	elif can_run:
		_enter(S.FLEE)
	else:
		_enter(S.HIDE)


func _nervous_move() -> void:
	_face_player = _sees
	if _sees and _player_dist < 9.0 and (_path.is_empty() or _path_i >= _path.size()):
		var me: Vector3 = body.position_ground()
		var away := (me - _threat)
		away.y = 0.0
		_goto(_closest_nav(me + away.normalized() * rng.randf_range(3.0, 5.0)))
	elif not _sees and _path.is_empty() and rng.randf() < 0.05:
		_goto(_random_nearby(3.0, 8.0))


# --- Navigation --------------------------------------------------------------------

func _nav_map() -> RID:
	return body.get_world_3d().navigation_map


func _closest_nav(p: Vector3) -> Vector3:
	return NavigationServer3D.map_get_closest_point(_nav_map(), p)


func _random_nearby(rmin: float, rmax: float) -> Vector3:
	var me: Vector3 = body.position_ground()
	for i in 6:
		var a := rng.randf() * TAU
		var r := rng.randf_range(rmin, rmax)
		var p := _closest_nav(me + Vector3(cos(a) * r, 0, sin(a) * r))
		if absf(p.y - me.y) < 4.0 and p.distance_to(me) > rmin * 0.5:
			return p
	return me


func _pick_cover() -> Vector3:
	var me: Vector3 = body.position_ground()
	var threat := _threat if _threat_known else me + Vector3(1, 0, 0)
	var threat_eye := threat + Vector3.UP * 1.6
	var best := me
	var best_score := -INF
	var to_threat := (threat - me)
	to_threat.y = 0.0
	to_threat = to_threat.normalized()
	for i in 14:
		var a := rng.randf() * TAU
		var r := rng.randf_range(6.0, 24.0)
		var cand := _closest_nav(me + Vector3(cos(a) * r, 0, sin(a) * r))
		var score := (cand.distance_to(threat) - me.distance_to(threat)) * 0.5
		if not _line_clear(threat_eye, cand + Vector3.UP * 1.0):
			score += 12.0
		var dir := cand - me
		dir.y = 0.0
		if dir.length() > 0.5 and dir.normalized().dot(to_threat) > 0.4:
			score -= 14.0
		score -= absf(cand.y - me.y) * 0.8
		score += rng.randf() * 3.0
		if score > best_score:
			best_score = score
			best = cand
	_speed = rng.randf_range(3.4, 4.4)
	return best


func _goto(target: Vector3) -> void:
	_goal = target
	var from := _closest_nav(body.position_ground())
	_path = NavigationServer3D.map_get_path(_nav_map(), from, target, true)
	_path_i = 1 if _path.size() > 1 else 0
	_stuck_t = 0.0
	_stuck_pos = body.position_ground()
	if state == S.WANDER:
		_speed = rng.randf_range(1.15, 1.45)
	elif state == S.NERVOUS:
		_speed = 1.3


# --- Steering ----------------------------------------------------------------------------

func _steer(delta: float) -> void:
	var me: Vector3 = body.position_ground()
	var vel := Vector3.ZERO
	var moving := not _path.is_empty() and _path_i < _path.size()
	if moving and state != S.SURRENDER and state != S.HIDE and state != S.DOWNED:
		var wp := _path[_path_i]
		var flat := Vector3(wp.x - me.x, 0, wp.z - me.z)
		if flat.length() < 0.55:
			_path_i += 1
		else:
			var speed := _speed * lerpf(0.35, 1.0, body.mobility())
			vel = flat.normalized() * speed
		# Stuck detection.
		_stuck_t += delta
		if _stuck_t > 2.0:
			if me.distance_to(_stuck_pos) < 0.4:
				if state == S.FLEE:
					_goto(_pick_cover())
				else:
					_goto(_random_nearby(3.0, 10.0))
			_stuck_t = 0.0
			_stuck_pos = me

	# Personal space from other bots.
	for other in Game.bots:
		if other == body or not other.alive:
			continue
		var d: Vector3 = me - other.position_ground()
		d.y = 0.0
		var l := d.length()
		if l < 1.0 and l > 0.01:
			vel += d / l * (1.0 - l) * 1.2

	# Crawling away while downed but conscious.
	if state == S.DOWNED and body.conscious and fear > 0.4 and _threat_known:
		var away := me - _threat
		away.y = 0.0
		body.chest.apply_central_force(away.normalized() * 120.0 * clampf(fear, 0.0, 1.0))

	body.move_velocity = body.move_velocity.lerp(vel, minf(delta * 6.0, 1.0))

	# Facing: travel direction, or the player while backing away/surrendering.
	var face := body.facing as Vector3
	if (_face_player or state == S.SURRENDER) and _threat_known:
		face = _threat - me
	elif vel.length() > 0.3:
		face = vel
	face.y = 0.0
	if face.length() > 0.01:
		body.facing = (body.facing as Vector3).slerp(face.normalized(), minf(delta * 5.0, 1.0)).normalized()

	# Looking.
	_look_t -= delta
	var aware := _threat_known and (fear > 0.12 or _sees)
	if aware and state != S.HIDE:
		body.look_target = Game.player.cam.global_position if _sees else _threat + Vector3.UP * 1.5
		body.has_look_target = true
	elif state == S.HIDE:
		if _look_t <= 0.0:
			_look_t = rng.randf_range(0.8, 2.5)
			_look = (_threat + Vector3.UP * 1.5) if rng.randf() < 0.4 else me + Vector3(rng.randf_range(-3, 3), 0.3, rng.randf_range(-3, 3))
		body.look_target = _look
		body.has_look_target = true
	else:
		if _look_t <= 0.0:
			_look_t = rng.randf_range(1.0, 3.0)
			var f: Vector3 = body.facing
			var side := f.cross(Vector3.UP) * rng.randf_range(-4.0, 4.0)
			_look = body.eye_position() + f * 5.0 + side + Vector3.UP * rng.randf_range(-1.0, 0.8)
		body.look_target = _look
		body.has_look_target = true
