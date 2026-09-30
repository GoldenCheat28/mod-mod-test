extends Node
## Bot brain. Perceives the player (sight, aim, gunshots, near misses,
## other bots getting hurt), keeps a fear level shaped by personality, and
## picks behaviour: wander, idle, nervous watching, surrender, flee to
## cover, hide, or crawl away when downed. Drives the humanoid body by
## setting its move velocity, facing, look target and posture.

enum S { WANDER, IDLE, NERVOUS, SURRENDER, FLEE, HIDE, DOWNED, DEAD, PLAY_DEAD, FETCH, ARMED, TALK, CUFFED, ACTIVITY, ANGRY, BRAWL }

## Mirrors humanoid.gd Posture.
enum Posture { STAND, CROUCH, HANDS_UP, COVER_HEAD, AIM, KNEEL, SQUAT, SIT }

const Sfx = preload("res://scripts/audio/sfx.gd")
const Pickup = preload("res://scripts/weapons/pickup.gd")
const Chatter = preload("res://scripts/bots/chatter.gd")
const BotActivity = preload("res://scripts/bots/bot_activity.gd")
const ItemDrop = preload("res://scripts/game/item_drop.gd")
const Grenade = preload("res://scripts/weapons/grenade.gd")
const MELEE := ["machete", "chainsaw"]

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

# Personality: some play dead when things turn violent, some head upstairs.
var _feigner := false
var _climber := false
var _feign_for := 20.0
# Guns.
var _pickup: Node = null
## Voice and small talk.
var talk: Node
var _want_fire := false
var _unstick_t := 0.0
var _fire_t := 0.0
var _burst := 0
## Handcuffed: kneeling on command, walked around by whoever holds them.
var kneel := false
var roulette: Node = null
## Watching someone else's game of roulette (roulette.gd): stands where he is
## put, looks on, worried but going nowhere.
var spectate: Node = null
var watch_spot := Vector3.INF
var act: RefCounted = null
var _swing_t := -1.0               # time into a blade swing, or -1
var _swing_hit := false
var _swing_cd := 0.0
var _grind := 0.0         # something to be getting on with (bot_activity.gd)          # a game of Russian roulette with the player (roulette.gd)
var escort: Node3D = null
## Who this bot is shooting at: the player or another bot (null = nobody).
var foe: Node3D = null
## Some people with a gun in their hand start trouble on their own after a
## while (a hothead); anyone armed shoots back at whoever shot them.
var _hothead := false
var _aggro_in := 60.0
# Sprayed with paint (or otherwise asking for it): swears at the player for a
# few seconds (ANGRY), then goes for them with his fists (BRAWL).
const SWEARS := ["reply_rude", "go_away", "tease_rude", "tease_rude2", "man_go_away"]
var _swear_at := 0.0
var _punch_t := -1.0
var _punch_cd := 0.0
var _punch_hand := "r"
var _punch_hit := false


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
	_feigner = rng.randf() < 0.3
	_climber = rng.randf() < 0.45
	_hothead = rng.randf() < 0.45
	_aggro_in = rng.randf_range(20.0, 90.0)
	talk = Chatter.new()
	talk.name = "Talk"
	add_child(talk)
	talk.setup(self, rng)


func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["bot_ai._physics_process"] = Game.prof.get("bot_ai._physics_process", 0) + __d
	Game.prof["max bot_ai._physics_process"] = maxi(Game.prof.get("max bot_ai._physics_process", 0), __d)


func _physics_process_real(delta: float) -> void:
	if body == null or body.parts.is_empty():
		return
	if body.weapon and (not body.alive or not body.conscious or body.fallen or body.cuffed):
		_drop_weapon()
	if not body.alive:
		if state != S.DEAD:
			if state == S.ACTIVITY:
				_end_activity()
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
	if act and state == S.ACTIVITY and roulette == null and spectate == null:
		act.tick(delta)
	_wave_tick(delta)
	_bump_cd = maxf(_bump_cd - delta, 0.0)
	if player_talk:
		body.look_target = player_talk.cam.global_position
		body.has_look_target = true
	if roulette != null:
		if roulette.has_method("stance_for"):
			roulette.stance_for(body, delta)       # (a game round a table: roulette_game.gd)
		else:
			roulette._bot_stance()
	if spectate != null:
		spectate._spectator_tick(self, delta)
	talk.tick(delta)
	if body.weapon and _target_is_bot():
		body.look_target = foe.eye_position()
		body.has_look_target = true
	if body.weapon:
		if _melee():
			_melee_tick(delta)
			_hold_melee()
		else:
			_hold_gun()
	elif state == S.BRAWL or state == S.ANGRY:
		_fists(delta)
	if state == S.ARMED and _want_fire and body.weapon:
		_fire_t -= delta
		if _fire_t <= 0.0 and _on_target():
			_bot_fire()
			match body.weapon_kind:
				"pistol":
					_fire_t = rng.randf_range(0.6, 1.3)
				"akm":
					# Short bursts: a few rounds, then a pause to steady the aim.
					_burst += 1
					_fire_t = 0.11 if _burst < rng.randi_range(3, 5) else rng.randf_range(0.7, 1.4)
					if _fire_t > 0.2:
						_burst = 0
				_:
					_fire_t = rng.randf_range(1.3, 2.1)


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
	# Empty hands are not a threat; neither is someone who never fired.
	var armed: bool = p.is_armed()
	var threatening := armed or Game.player_fired
	_aimed = _sees and armed and ang < tolerance and _player_dist < 40.0
	if _aimed:
		_aimed_t += dt
		_not_aimed_t = 0.0
	else:
		_aimed_t = 0.0
		_not_aimed_t += dt

	# Hidden from the player's eye?
	_hidden = not _line_clear(peye, eye)

	# Fear dynamics.
	if _sees and threatening:
		var close := clampf(1.0 - _player_dist / 16.0, 0.0, 1.0)
		fear += dt * (0.015 + 0.13 * close * close) * nervousness
	if not threatening:
		fear -= dt * 0.06
	if _aimed:
		fear += dt * 0.55 * (1.25 - bravery) * nervousness
	if not _sees:
		fear -= dt * 0.03
	elif _player_dist > 25.0:
		fear -= dt * 0.01
	fear = clampf(fear, 0.0, 1.5)
	if (state == S.ANGRY or state == S.BRAWL) and _hurt_recent <= 0.0:
		fear = minf(fear, 0.5)      # too angry to be scared of a gun he has not felt
	if spectate != null:
		fear = minf(fear, 0.35)     # uneasy, but he came to see it


func _on_gunshot(origin: Vector3, loudness: float) -> void:
	if not body.alive or spectate != null:
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
	if state == S.CUFFED:
		return
	# Where it came from: the player's place only if he saw him; otherwise
	# roughly back along the hit.
	if Game.player and _could_see(Game.player):
		_threat = Game.player.global_position
	else:
		_threat = body.position_ground() - Vector3(_dir.x, 0.0, _dir.z).normalized() * 12.0
	_threat_known = true
	if state == S.PLAY_DEAD:
		if rng.randf() < 0.5:
			return        # grits it out and keeps still
		body.feign = false
	if state == S.ARMED:
		return
	if state != S.DOWNED:
		if _feigner and Game.player_fired and rng.randf() < 0.4:
			_enter(S.PLAY_DEAD)
		else:
			_enter(S.FLEE)


# --- Decisions ---------------------------------------------------------------------

func _enter(s: S) -> void:
	if s == state and s != S.FLEE:
		return
	if state == S.ACTIVITY and s != S.ACTIVITY:
		_end_activity()
	if (state == S.ANGRY or state == S.BRAWL) and s != S.ANGRY and s != S.BRAWL:
		body.hand_goal["r"] = Vector3.INF
		body.hand_goal["l"] = Vector3.INF
		_punch_t = -1.0
	state = s
	_state_t = 0.0
	_replan_t = 0.0
	_path = PackedVector3Array()
	_path_i = 0
	_face_player = false
	body.posture = Posture.STAND
	body.feign = s == S.PLAY_DEAD
	_want_fire = false
	match s:
		S.WANDER:
			_goto(_wander_target())
		S.FLEE:
			_goto(_pick_cover())
		S.NERVOUS:
			pass
		S.PLAY_DEAD:
			body.move_velocity = Vector3.ZERO
			_feign_for = rng.randf_range(15.0, 40.0)
		S.FETCH:
			if is_instance_valid(_pickup):
				_goto(_closest_nav((_pickup as Node3D).global_position))
				_speed = rng.randf_range(3.6, 4.4) if fear > 0.42 else 1.5
		S.ARMED:
			_fire_t = rng.randf_range(0.5, 1.0)   # reaction time


func _decide() -> void:
	if spectate != null:
		# Going to his place round the game, then standing there.
		body.posture = Posture.STAND
		if talk.busy():
			talk.end()
		var me: Vector3 = body.position_ground()
		if watch_spot != Vector3.INF and Vector2(me.x - watch_spot.x, me.z - watch_spot.z).length() > 0.6:
			if _path.is_empty() or _path_i >= _path.size():
				_goto(watch_spot)
				_speed = 1.5
		else:
			_path = PackedVector3Array()
		return
	if roulette != null:
		# Playing: he stays where he is (roulette.gd turns him and his hands),
		# sat at the table if that is where it is.
		_path = PackedVector3Array()
		body.posture = Posture.SIT if roulette.at_table and body.seat != Vector3.INF else Posture.STAND
		if talk.busy():
			talk.end()
		return
	if body.cuffed:
		if state != S.CUFFED:
			_enter(S.CUFFED)
			if talk.busy():
				talk.end()
		body.posture = Posture.KNEEL if kneel and escort == null else Posture.STAND
		return
	if state == S.PLAY_DEAD:
		# Stays down until the shooter is gone for a while, then runs.
		if (_state_t > _feign_for and not _sees and _player_dist > 18.0) or (_player_dist > 35.0 and _state_t > 8.0):
			body.feign = false
			_enter(S.FLEE)
		return
	if body.fallen or not body.conscious:
		if state != S.DOWNED:
			_enter(S.DOWNED)
		return
	if state == S.DOWNED:
		_enter(S.FLEE if fear > 0.5 else S.WANDER)
		return
	if state == S.TALK:
		if fear > 0.15:
			talk.end()
			_enter(S.NERVOUS)
		elif not talk.busy():
			_enter(S.IDLE)
		return
	if state == S.ANGRY or state == S.BRAWL:
		_angry()
		return
	if body.weapon:
		if state != S.ARMED:
			_enter(S.ARMED)
		_armed()
		return
	if state == S.FETCH:
		_fetch()
		return
	if _social():
		return
	var gun := _visible_gun()
	if gun and (fear > 0.42 or state in [S.WANDER, S.IDLE, S.NERVOUS, S.ACTIVITY]):
		_pickup = gun
		gun.claimed_by = body
		_enter(S.FETCH)
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
			elif state == S.IDLE and _state_t > 1.5 and rng.randf() < 0.3 + 0.6 * _bad_weather() and _try_activity():
				pass
			elif state == S.IDLE and _state_t > rng.randf_range(2.0, 6.0):
				_enter(S.WANDER)
		S.ACTIVITY:
			if fear > 0.42:
				_panic_choice()
			elif fear > 0.15:
				_enter(S.NERVOUS)
			elif act == null or act.done:
				_enter(S.WANDER)
			elif not act.arrived and _path.is_empty() and _state_t > 1.0:
				_goto(_closest_nav(act.slot["pos"]))
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


## Goes off to do something (activities.gd): returns whether there was anything.
func _try_activity() -> bool:
	var acts = Game.main.get("activities") if Game.main else null
	if acts == null or body.weapon or body.cuffed:
		return false
	var slot: Dictionary = acts.join(body)
	if slot.is_empty():
		return false
	_enter(S.ACTIVITY)
	act = BotActivity.new(self, slot)
	_goto(_closest_nav(slot["pos"]))
	_speed = rng.randf_range(1.1, 1.4)
	return true


func _bad_weather() -> float:
	return preload("res://scripts/bots/activities.gd").bad_weather()


func _end_activity() -> void:
	if act:
		act.stop()
		var acts = Game.main.get("activities") if Game.main else null
		if acts:
			acts.release(act.slot)
		act = null


func _panic_choice() -> void:
	var can_run: bool = body.mobility() > 0.35
	if _feigner and Game.player_fired and not _hidden and rng.randf() < 0.45:
		_enter(S.PLAY_DEAD)
	elif _aimed and bravery < 0.55 and _player_dist < 18.0 and fear < 0.95 and _hurt_recent <= 0.0:
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
		var want := me + Vector3(cos(a) * r, 0, sin(a) * r)
		want.x = clampf(want.x, -32.0, 32.0)
		want.z = clampf(want.z, -32.0, 32.0)
		var p := _closest_nav(want)
		if absf(p.y - me.y) < 4.0 and p.distance_to(me) > rmin * 0.5 and (i >= 4 or _clear_of_walls(p, 0.9)):
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
	for i in 22:
		var a := rng.randf() * TAU
		var r := rng.randf_range(6.0, 30.0)
		var cw := me + Vector3(cos(a) * r, 0, sin(a) * r)
		cw.x = clampf(cw.x, -32.5, 32.5)
		cw.z = clampf(cw.z, -32.5, 32.5)
		var cand := _closest_nav(cw)
		var score := (cand.distance_to(threat) - me.distance_to(threat)) * 0.5
		if not _line_clear(threat_eye, cand + Vector3.UP * 1.0):
			score += 12.0
		elif not _line_clear(threat_eye, cand + Vector3.UP * 0.6):
			score += 7.0      # low cover: a barricade to crouch behind
		var dir := cand - me
		dir.y = 0.0
		if dir.length() > 0.5 and dir.normalized().dot(to_threat) > 0.4:
			score -= 14.0
		if _climber:
			score += clampf(cand.y - me.y, 0.0, 7.0) * 2.2   # upstairs, away from the street
		else:
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
	if moving and state not in [S.SURRENDER, S.HIDE, S.DOWNED, S.PLAY_DEAD] and not (state == S.ARMED and _want_fire):
		var wp := _path[_path_i]
		var flat := Vector3(wp.x - me.x, 0, wp.z - me.z)
		if flat.length() < 0.55:
			_path_i += 1
		else:
			var speed := _speed * lerpf(0.35, 1.0, body.mobility())
			vel = flat.normalized() * speed
			# A door in the way: reach for the handle and push it open,
			# slowing down to go through, instead of walking into it.
			if _door_open(delta, flat.normalized()):
				vel *= 0.55
		# Stuck detection.
		_stuck_t += delta
		if _stuck_t > 2.0:
			if me.distance_to(_stuck_pos) < 0.4:
				_unstick_t = 0.7
				if state == S.FLEE:
					_goto(_pick_cover())
				elif state == S.WANDER:
					_goto(_wander_target())
				else:
					_goto(_random_nearby(3.0, 10.0))
			_stuck_t = 0.0
			_stuck_pos = me
	# (just stuck: a step back from whatever he walked into)
	if _unstick_t > 0.0:
		_unstick_t -= delta
		vel = -Vector3(body.facing.x, 0, body.facing.z).normalized() * 1.0

	# Cuffed: stands still, or walks in front of whoever is holding them.
	if state == S.CUFFED:
		vel = Vector3.ZERO
		if escort and is_instance_valid(escort):
			var fwd: Vector3 = -Basis(Vector3.UP, escort.yaw).z
			var spot: Vector3 = escort.global_position + fwd * 1.0
			var to := spot - me
			to.y = 0.0
			vel = to.normalized() * clampf(to.length() * 3.0, 0.0, 3.5) if to.length() > 0.12 else Vector3.ZERO
			body.facing = (body.facing as Vector3).slerp(fwd, minf(delta * 6.0, 1.0)).normalized()
		body.move_velocity = body.move_velocity.lerp(vel, minf(delta * 8.0, 1.0))
		return
	# Personal space from other bots (not while standing about together).
	var settled: bool = state == S.ACTIVITY and act != null and act.arrived
	for other in Game.bots:
		if settled:
			break
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
	if Game.stare_until > Game.clock and body.alive:
		body.look_target = Game.player.cam.global_position
		body.has_look_target = true


# --- Guns ---------------------------------------------------------------------------

## Nearest free gun this bot can see, or null.
func _visible_gun() -> Node:
	if body.mobility() < 0.35:
		return null
	var eye: Vector3 = body.eye_position()
	var best: Node = null
	var best_d := 22.0
	for g in Game.pickups:
		if not is_instance_valid(g) or (g.claimed_by != null and g.claimed_by != body):
			continue
		var p: Vector3 = (g as Node3D).global_position
		var d := eye.distance_to(p)
		if d < best_d and _line_clear(eye, p + Vector3.UP * 0.05):
			best = g
			best_d = d
	return best


func _fetch() -> void:
	if not is_instance_valid(_pickup) or _pickup.claimed_by != body:
		_pickup = null
		_enter(S.FLEE if fear > 0.42 else S.WANDER)
		return
	var p: Vector3 = (_pickup as Node3D).global_position
	var me: Vector3 = body.position_ground()
	if Vector2(p.x - me.x, p.z - me.z).length() < 0.9 and absf(p.y - me.y) < 1.2:
		# Pick it up: the gun goes into the right hand.
		var item: String = _pickup.kind
		var kind: String = "pistol" if item == "revolver" else item
		var model: Node3D = _pickup.take()
		_pickup = null
		var hand: RigidBody3D = body.parts[body.part_index["hand_r"]]
		# The gun is carried by the body and placed each tick (see _hold_gun);
		# the arms reach for its grip.
		body.add_child(model)
		model.global_transform = hand.global_transform
		model.reset_physics_interpolation()
		body.weapon = model
		body.weapon_kind = kind
		body.weapon_item = item
		Game.play_3d(Sfx.get_stream(&"slide_back"), hand.global_position, -12.0, 0.05, 3.0)
		_enter(S.ARMED)
	elif _path.is_empty() or _path_i >= _path.size():
		_goto(_closest_nav(p))


## Armed: turns on the nearest real danger to him - whoever shot at him or
## hurt him, whoever is pointing a gun at him, whoever fired close by just
## now (the player, another player, or another man) - and shoots when he
## can see them. Out of sight, he runs to where he last saw them and looks
## round there for a while before giving it up.
func _armed() -> void:
	var danger: bool = _aimed or _hurt_recent > 0.0 or fear > 0.6
	if not _target_valid():
		foe = null
		_last_seen = Vector3.INF
	var best := _best_threat()
	if best != null:
		danger = true
		# Onto someone else only for one he can see (and clearly nearer, or
		# the one he has is out of sight).
		if foe == null:
			foe = best
		elif best != foe and _can_see(best) and (not _can_see(foe) or _dist_to(best) < _dist_to(foe) * 0.7):
			foe = best
			_last_seen = Vector3.INF
	# Trouble on its own: a hothead with a gun picks somebody after a while.
	if foe == null and _hothead:
		_aggro_in -= 0.12
		if _aggro_in <= 0.0:
			_aggro_in = rng.randf_range(40.0, 140.0)
			foe = _pick_victim()
			if foe == null:
				_aggro_in = rng.randf_range(3.0, 7.0)      # nobody around: look again soon
			else:
				talk.say("man_go_away" if _is_player_like(foe) else "go_away")
				_fire_t = rng.randf_range(1.0, 1.8)    # says it, then raises the gun
	if _melee():
		_armed_melee(danger)
		return
	var visible := foe != null and _can_see(foe)
	if visible:
		_last_seen = _target_ground()
		_unseen_since = -1.0
		_searches = 0
	if foe and visible and body.mobility() > 0.2:
		_want_fire = true
		_face_player = true
		_threat = _target_ground()
		_threat_known = true
		body.posture = Posture.AIM
		_path = PackedVector3Array()
		return
	_want_fire = false
	_face_player = false
	body.posture = Posture.STAND
	var idle := _path.is_empty() or _path_i >= _path.size()
	if foe and not visible:
		if _unseen_since < 0.0:
			_unseen_since = Game.clock
		if _last_seen == Vector3.INF:
			_last_seen = _target_ground()          # (heard where he is)
		var me: Vector3 = body.position_ground()
		if Game.clock - _unseen_since > 18.0:
			# Lost him.
			foe = null
			_last_seen = Vector3.INF
			_searches = 0
		elif idle:
			if _searches == 0 and Vector2(me.x - _last_seen.x, me.z - _last_seen.z).length() > 1.5:
				_goto(_closest_nav(_last_seen))
				_speed = rng.randf_range(3.0, 3.6)     # after them, at a run
				_searches = 1 if Vector2(me.x - _last_seen.x, me.z - _last_seen.z).length() < 3.0 else 0
			else:
				# Where did he go? Round the corners nearby.
				_searches += 1
				var a := rng.randf() * TAU
				_goto(_closest_nav(_last_seen + Vector3(cos(a), 0.0, sin(a)) * rng.randf_range(2.0, 7.0)))
				_speed = rng.randf_range(1.6, 2.2)
			_threat = _last_seen
			_threat_known = true
	elif fear > 0.6 and not _hidden and idle:
		_goto(_pick_cover())
	elif idle and rng.randf() < 0.04:
		_goto(_random_nearby(3.0, 8.0))


var _attackers := {}              # who shot at him or hurt him -> Game.clock of it
var _last_seen := Vector3.INF
var _unseen_since := -1.0
var _searches := 0


func _is_player_like(n: Object) -> bool:
	return n != null and is_instance_valid(n) and (n == Game.player or n.has_method("aim_point"))


func _dist_to(n: Node3D) -> float:
	if n == null or not is_instance_valid(n):
		return INF
	var p: Vector3 = Game.player.global_position if n == Game.player else n.position_ground()
	return p.distance_to(body.position_ground())


## The most pressing danger he knows of, or null: nearest first, those out
## of sight counted as twice as far.
func _best_threat() -> Node3D:
	var me: Vector3 = body.position_ground()
	var best: Node3D = null
	var best_score := INF
	var cands: Array = []
	# The player: aiming at him, lately shot at him or near him, or hurt him.
	var p = Game.player
	if p and not p._dead and _sees and _player_dist < 45.0:
		# (only if he saw him fire it: seeing him a while after proves nothing)
		var shot_near: bool = Game.clock - Game.player_shot_t < 1.5 and Game.player_shot_pos.distance_to(me) < 18.0
		if _aimed or shot_near or Game.clock - float(_attackers.get(p, -99.0)) < 30.0:
			cands.append(p)
	# Other players (their puppets here) and other men who went for him, or
	# are pointing a gun at him right now.
	for n in _attackers:
		if is_instance_valid(n) and Game.clock - float(_attackers[n]) < 30.0 and not n in cands:
			if n == p and p._dead:
				continue
			cands.append(n)
	for b in Game.bots:
		if b != body and is_instance_valid(b) and b.alive and b.weapon and b.ai and b.ai.foe == body:
			cands.append(b)
	for pup in Net.puppets.values():
		if is_instance_valid(pup) and not pup.down and Game.clock - pup.shot_t < 12.0 and pup.shot_pos.distance_to(me) < 18.0:
			cands.append(pup)
	for c in cands:
		if c == p:
			pass
		elif c.has_method("aim_point"):
			if c.down:
				continue
		elif not c.alive or c.fallen:
			continue
		var score := _dist_to(c) * (1.0 if _can_see(c) else 2.0)
		if score < best_score:
			best_score = score
			best = c
	return best


func _target_is_bot() -> bool:
	return foe != null and is_instance_valid(foe) and foe != Game.player


func _target_valid() -> bool:
	if foe == null or not is_instance_valid(foe):
		return false
	if foe == Game.player:
		return not Game.player._dead
	if foe.has_method("aim_point"):
		return not foe.down
	return foe.alive and not foe.fallen or (foe.alive and _hurt_recent > 0.0)


func _target_ground() -> Vector3:
	return Game.player.global_position if foe == Game.player else foe.position_ground()


## Where to put the bullets: the player's chest, or another person's chest.
func _aim_point() -> Vector3:
	if foe == null or not is_instance_valid(foe) or foe == Game.player:
		return Game.player.cam.global_position + Vector3.DOWN * 0.35
	if foe.has_method("aim_point"):
		return foe.aim_point()
	return foe.chest.global_position + Vector3.UP * 0.05


func _can_see(n: Node3D) -> bool:
	if n == null or not is_instance_valid(n):
		return false
	var eye: Vector3 = body.eye_position()
	var at: Vector3
	if n == Game.player:
		at = Game.player.cam.global_position + Vector3.DOWN * 0.35
	elif n.has_method("aim_point"):
		at = n.aim_point()
	else:
		at = n.chest.global_position + Vector3.UP * 0.05
	return eye.distance_to(at) < 40.0 and _line_clear(eye, at)


## Someone to pick on: a person it can see nearby, or the player.
func _pick_victim() -> Node3D:
	var options: Array[Node3D] = []
	for b in Game.bots:
		if b == body or not is_instance_valid(b) or not b.alive:
			continue
		var d: float = b.position_ground().distance_to(body.position_ground())
		if d < 25.0 and _line_clear(body.eye_position(), b.eye_position()):
			options.append(b)
	for pup in Net.puppets.values():
		if is_instance_valid(pup) and not pup.down and pup.position_ground().distance_to(body.position_ground()) < 25.0 \
				and _line_clear(body.eye_position(), pup.aim_point()):
			options.append(pup)
	if _sees and _player_dist < 25.0 and (options.is_empty() or rng.randf() < 0.35):
		return Game.player
	return options[rng.randi() % options.size()] if not options.is_empty() else null


## Shot at by another bot: remember who, and shoot back if armed.
## Whether he could have seen `who` just now: in front of him (or right by
## him) with nothing solid between.
func _could_see(who: Node3D) -> bool:
	if not is_instance_valid(who):
		return false
	var eye: Vector3 = body.eye_position()
	var at: Vector3 = who.cam.global_position if who == Game.player else (who.eye_position() if who.has_method("eye_position") else who.global_position)
	var to := at - eye
	if to.length() < 2.5:
		return true
	var face: Vector3 = body.facing
	var flat := Vector3(to.x, 0.0, to.z).normalized()
	if face.dot(flat) < -0.2:
		return false            # (behind him)
	return _line_clear(eye, at)


func on_attacked(attacker: Node3D) -> void:
	if not is_instance_valid(attacker) or not body.alive:
		return
	if not _could_see(attacker):
		# Shot at from where he could not see: frightened, and off away from
		# where it came from - but with no idea who it was.
		fear = maxf(fear, 0.8)
		_threat = body.position_ground() + (attacker.global_position - body.position_ground()).normalized() * 12.0 				+ Vector3(rng.randf_range(-6, 6), 0.0, rng.randf_range(-6, 6))
		_threat_known = true
		return
	_attackers[attacker] = Game.clock
	fear = maxf(fear, 0.7)
	_threat = Game.player.global_position if attacker == Game.player else attacker.position_ground()
	_threat_known = true
	if body.weapon:
		foe = attacker


## The gun is actually pointing at the player (the body has turned to face them).
func _on_target() -> bool:
	var gun: Node3D = body.weapon
	var to: Vector3 = _aim_point() - gun.global_position
	return (-gun.global_basis.z).dot(to.normalized()) > 0.93


func _bot_fire() -> void:
	var gun: Node3D = body.weapon
	var muzzle_node := gun.get_node_or_null("Muzzle") as Node3D
	var muzzle := muzzle_node.global_position if muzzle_node else gun.global_position
	var target_pt: Vector3 = _aim_point()
	var aim := (target_pt - muzzle).normalized()
	var shotgun: bool = body.weapon_kind == "shotgun"
	var akm: bool = body.weapon_kind == "akm"
	# Scared, hurt people shooting at range miss a lot.
	var range_m := muzzle.distance_to(target_pt)
	var spread := deg_to_rad(1.5 + range_m * 0.15 + fear * 3.0 + (1.0 - body.mobility()) * 4.0)
	var ex: Array[RID] = body._ray_exclude
	var space := _space()
	var dirs_out: Array = []
	for i in (9 if shotgun else 1):
		var d := (aim + Vector3(rng.randf_range(-1, 1), rng.randf_range(-1, 1), rng.randf_range(-1, 1)) * tan(spread + (0.05 if shotgun else 0.0))).normalized()
		var q := PhysicsRayQueryParameters3D.create(muzzle, muzzle + d * 200.0,
				Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_PLAYER)
		q.exclude = ex
		var hit := space.intersect_ray(q)
		var body_hit := {}
		if not hit.is_empty() and hit.collider == Game.player:
			# The movement capsule only says it came close: check the body itself.
			body_hit = Game.player.hitbox_test(muzzle, d)
			if body_hit.is_empty():
				var ex2 := ex.duplicate()
				ex2.append(Game.player.get_rid())
				q.exclude = ex2
				hit = space.intersect_ray(q)
		var end := muzzle + d * 200.0
		dirs_out.append(d)
		if not hit.is_empty():
			end = hit.position
			var col: Object = hit.collider
			if col.has_meta("remote_player"):
				# Another player: their game feels it.
				Net.hit_remote(int(col.get_meta("remote_player")), hit.position, d, body.weapon_kind, col)
			elif col == Game.player:
				end = body_hit["point"]
				Game.player.hurt(body_hit["point"], d, body.weapon_kind, body_hit["region"])
			elif col.has_meta("humanoid"):
				var victim = col.get_meta("humanoid")
				victim.receive_hit(col, hit.position, d, 3.0 if shotgun else (9.0 if akm else 6.0), body.weapon_kind)
				if victim.ai:
					victim.ai.on_attacked(body)
			else:
				if col.has_method("damage"):
					col.damage(0.35 if shotgun else (1.6 if akm else 1.0), hit.position, d)
				var surface: String = col.get_meta("surface", "concrete") if col is Node else "concrete"
				Game.fx.impact(hit.position, hit.normal, col, surface)
		Game.bullet_passed.emit(muzzle, end)
	Game.play_3d(Sfx.get_stream(&"shotgun_shot" if shotgun else (&"akm_shot" if akm else &"pistol_shot")), muzzle, 0.0 if akm else 2.0, 0.06, 18.0)
	Game.fx.muzzle_smoke(muzzle, aim, 1.0 if shotgun else 0.55)
	Game.gunshot.emit(muzzle, 1.6 if shotgun else (1.9 if akm else 1.0))
	Net.bot_shot(muzzle, dirs_out, body.weapon_kind)
	# Recoil on the arm.
	var hand: RigidBody3D = body.parts[body.part_index["hand_r"]]
	hand.apply_impulse(-aim * (3.0 if shotgun else 1.2) + Vector3.UP * 1.0)


# --- Fists -----------------------------------------------------------------------------

## Paint in his face (the player's spray can): he does not like it one bit.
func sprayed() -> void:
	if not body.alive or not body.conscious or body.fallen or body.cuffed or roulette != null or spectate != null \
			or process_mode == Node.PROCESS_MODE_DISABLED:
		return
	body.angry_until = Game.clock + 15.0
	if state in [S.ANGRY, S.BRAWL, S.DOWNED, S.PLAY_DEAD, S.SURRENDER, S.CUFFED]:
		return
	if body.weapon:
		foe = Game.player            # armed: that settles it
		return
	if talk.busy():
		talk.end()
	_enter(S.ANGRY)
	_swear_at = 0.0


## ANGRY: stands his ground facing the player and swears at him; after three
## seconds of it he goes for him. BRAWL: runs at him, and up close punches -
## left, right - until the player is down or far off, or he gets hurt badly.
func _angry() -> void:
	var p: Node3D = Game.player
	if p == null or p._dead or body.mobility() < 0.3:
		_enter(S.WANDER)
		return
	_threat = p.global_position
	_threat_known = true
	_face_player = true
	body.angry_until = Game.clock + 5.0
	body.posture = Posture.STAND
	if state == S.ANGRY:
		_path = PackedVector3Array()
		if Game.clock >= _swear_at and not talk.speaking():
			var dur: float = talk.say(SWEARS[rng.randi() % SWEARS.size()])
			_swear_at = Game.clock + maxf(dur, 0.8) + rng.randf_range(0.1, 0.4)
		if _state_t > 3.0:
			_enter(S.BRAWL)
		return
	var me: Vector3 = body.position_ground()
	var d := Vector2(_threat.x - me.x, _threat.z - me.z).length()
	if _player_dist > 25.0 or _state_t > 45.0 or fear > 1.2:
		_enter(S.WANDER if fear < 0.6 else S.FLEE)
		return
	if d > 0.7:
		if _path.is_empty() or _path_i >= _path.size() or _state_t - _replan_t > 0.4:
			_replan_t = _state_t
			_goto(_closest_nav(_threat))
			_speed = rng.randf_range(3.6, 4.2)
	else:
		_path = PackedVector3Array()
		if _punch_t < 0.0 and _punch_cd <= 0.0:
			_punch_t = 0.0
			_punch_hit = false
			_punch_hand = "l" if _punch_hand == "r" else "r"
			if rng.randf() < 0.25 and not talk.speaking():
				talk.say(SWEARS[rng.randi() % SWEARS.size()])


## The fists up in front of the face, and the punch itself: back, out fast
## at the player's head or body, back again.
func _fists(delta: float) -> void:
	var p: Node3D = Game.player
	if p == null:
		return
	var cb: Basis = body.chest.global_basis.orthonormalized()
	var s: float = body.scale_factor
	var chest: Vector3 = body.chest.global_position
	var fwd := Vector3(body.facing.x, 0, body.facing.z).normalized()
	var guard := {}
	for side in ["r", "l"]:
		var sx := 1.0 if side == "r" else -1.0
		guard[side] = chest + cb.x * 0.14 * sx * s + Vector3.UP * 0.3 * s + fwd * 0.28 * s
	_punch_cd = maxf(_punch_cd - delta, 0.0)
	if state == S.ANGRY:
		# Waving a fist while he shouts.
		var shake := sin(_state_t * 9.0) * 0.06
		body.hand_goal["r"] = (guard["r"] as Vector3) + Vector3.UP * (0.12 + shake) + fwd * 0.1
		body.hand_goal["l"] = Vector3.INF
		return
	body.hand_goal["r"] = guard["r"]
	body.hand_goal["l"] = guard["l"]
	if _punch_t < 0.0:
		return
	_punch_t += delta
	var t := _punch_t
	var aim: Vector3 = p.cam.global_position + Vector3.DOWN * (0.05 if _punch_hand == "r" else 0.45)
	var h: String = _punch_hand
	var back: Vector3 = (guard[h] as Vector3) - fwd * 0.08 + Vector3.UP * 0.03
	if t < 0.14:
		body.hand_goal[h] = (guard[h] as Vector3).lerp(back, smoothstep(0.0, 0.14, t))
	elif t < 0.24:
		body.hand_goal[h] = back.lerp(aim, smoothstep(0.14, 0.24, t))
		if not _punch_hit and t > 0.2:
			_punch_hit = true
			var hand: RigidBody3D = body.parts[body.part_index["hand_" + h]]
			if hand.global_position.distance_to(aim) < 0.75 or chest.distance_to(aim) < 1.1:
				var dir: Vector3 = (aim - chest).normalized()
				p.punched(aim, dir, "head" if h == "r" else "chest")
	elif t < 0.5:
		body.hand_goal[h] = aim.lerp(guard[h], smoothstep(0.24, 0.5, t))
	else:
		_punch_t = -1.0
		_punch_cd = rng.randf_range(0.15, 0.5)


# --- Blades and grenades ------------------------------------------------------------

## Whether what he has is for close in (a machete, a chainsaw) or a grenade,
## not a gun.
func _melee() -> bool:
	return body.weapon_kind in MELEE or body.weapon_kind == "grenade"


## Armed with a blade: goes for them at a run and, close enough, hacks at
## them. With a grenade: throws it at them from a distance, then runs.
func _armed_melee(danger: bool) -> void:
	_want_fire = false
	body.posture = Posture.STAND
	var visible := foe != null and _can_see(foe)
	if foe == null:
		_face_player = false
		if (_path.is_empty() or _path_i >= _path.size()) and rng.randf() < 0.04:
			_goto(_random_nearby(3.0, 8.0))
		return
	var me: Vector3 = body.position_ground()
	var at: Vector3 = _target_ground()
	var dist := Vector2(at.x - me.x, at.z - me.z).length()
	_threat = at
	_threat_known = true
	_face_player = true
	if body.weapon_kind == "grenade":
		if visible and dist > 5.0 and dist < 25.0:
			_throw_grenade(at)
		elif _path.is_empty() or _path_i >= _path.size():
			_goto(_closest_nav(at))
		return
	if dist > 1.1:
		# After them.
		if _path.is_empty() or _path_i >= _path.size() or _state_t - _replan_t > 0.5:
			_replan_t = _state_t
			_goto(_closest_nav(at))
			_speed = rng.randf_range(3.4, 4.0)
	else:
		_path = PackedVector3Array()
		if _swing_t < 0.0 and _swing_cd <= 0.0:
			_swing_t = 0.0
			_swing_hit = false


## The swing (called every physics step).
func _melee_tick(delta: float) -> void:
	_swing_cd = maxf(_swing_cd - delta, 0.0)
	if body.weapon_kind == "chainsaw" and body.weapon.has_method("animate"):
		body.weapon.running = _swing_t >= 0.0 or foe != null
		body.weapon.animate(delta, _swing_t >= 0.0)
	if _swing_t < 0.0:
		return
	_swing_t += delta
	var saw: bool = body.weapon_kind == "chainsaw"
	if saw:
		# The chain chews for as long as it is against them.
		_grind -= delta
		if _grind <= 0.0:
			_grind = 0.2
			_strike(0.15)
		if _swing_t > 0.9:
			_swing_t = -1.0
			_swing_cd = rng.randf_range(0.0, 0.3)
		return
	if not _swing_hit and _swing_t > 0.42:
		_swing_hit = true
		_strike(0.2)
	if _swing_t > 0.75:
		_swing_t = -1.0
		_swing_cd = rng.randf_range(0.3, 0.9)


## Where the blade is now (the tip), and whether it catches them.
func _strike(chance_sever: float) -> void:
	if foe == null or not is_instance_valid(foe):
		return
	var w: Node3D = body.weapon
	var tip: Vector3 = w.global_transform * Vector3(0.0, 0.0, -0.5)
	var dir: Vector3 = (tip - body.chest.global_position).normalized()
	if foe.has_method("aim_point"):
		# Another player: their game feels the blade.
		if tip.distance_to(foe.aim_point()) < 0.85:
			Net.hit_remote(foe.peer, foe.aim_point(), dir, "machete")
			Game.play_3d(Sfx.get_stream(&"flesh"), tip, -2.0, 0.15, 3.0)
		return
	if foe == Game.player:
		var p = Game.player
		var chest: Vector3 = p.global_position + Vector3.UP * 1.15
		if tip.distance_to(chest) > 0.85:
			return
		var r := rng.randf()
		var region := "head" if r < 0.15 else ("chest" if r < 0.65 else ("belly" if r < 0.85 else "leg"))
		p.hurt(chest + (tip - chest) * 0.3, dir, "machete", region)
		Game.play_3d(Sfx.get_stream(&"flesh"), tip, -2.0, 0.15, 3.0)
		return
	# Another man: the part of him the blade is nearest.
	var best: RigidBody3D = null
	var best_d := 0.45
	for part in foe.parts:
		if part.has_meta("severed"):
			continue
		var d: float = part.global_position.distance_to(tip)
		if d < best_d:
			best = part
			best_d = d
	if best == null:
		return
	foe.receive_hit(best, tip, dir, 4.0, "machete")
	if foe.ai:
		foe.ai.on_attacked(body)
	var pname: String = best.get_meta("part")
	var limb := pname.begins_with("upper_arm") or pname.begins_with("forearm") or pname.begins_with("hand") \
			or pname.begins_with("thigh") or pname.begins_with("shin") or pname.begins_with("foot")
	if limb and rng.randf() < chance_sever:
		# The cut goes across the limb, in the plane of the swing.
		var along: Vector3 = best.global_basis.y
		foe.saw_slice(best, best.global_position, along)


func _throw_grenade(at: Vector3) -> void:
	var hand: RigidBody3D = body.parts[body.part_index["hand_r"]]
	var from: Vector3 = hand.global_position + Vector3.UP * 0.1
	var t := clampf(from.distance_to(at) / 11.0, 0.6, 2.2)
	var vel := (at - from) / t + Vector3.UP * 0.5 * 9.8 * t
	Grenade.throw(body.get_parent(), Transform3D(Basis(), from), vel, Vector3(rng.randf_range(-8, 8), rng.randf_range(-4, 4), rng.randf_range(-8, 8)), 3.2)
	var model: Node3D = body.weapon
	body.weapon = null
	body.weapon_kind = ""
	body.weapon_item = ""
	body.hand_goal = {"r": Vector3.INF, "l": Vector3.INF}
	if is_instance_valid(model):
		model.queue_free()
	_enter(S.FLEE)


## A blade (or grenade) held the way people hold one: the machete low by the
## side, point forward, then up over the shoulder and down across in a swing;
## the chainsaw at the hip in both hands, pushed forward into them; a grenade
## in the hand at the side.
func _hold_melee() -> void:
	var w: Node3D = body.weapon
	var s: float = body.scale_factor
	var cb: Basis = body.chest.global_basis.orthonormalized()
	var shoulder: Vector3 = body.chest.global_transform * (Vector3(0.22, 0.07, 0.0) * s)
	var fwd := Vector3(body.facing.x, 0, body.facing.z).normalized()
	var right := cb.x
	match body.weapon_kind:
		"machete":
			var rest_p := shoulder + Vector3.DOWN * 0.45 * s + fwd * 0.15
			var rest_d := (fwd * 0.8 + Vector3.DOWN * 0.6).normalized()
			var up_p := shoulder + Vector3.UP * 0.22 * s + fwd * 0.02 - right * 0.04
			var up_d := (Vector3.UP * 0.8 - fwd * 0.5).normalized()
			var hit_p := shoulder + fwd * 0.45 * s + Vector3.DOWN * 0.22 * s - right * 0.12
			var hit_d := (fwd * 0.6 + Vector3.DOWN * 0.8 - right * 0.2).normalized()
			var p := rest_p
			var d := rest_d
			if _swing_t >= 0.0:
				var t := _swing_t
				if t < 0.35:
					var k := smoothstep(0.0, 0.35, t)
					p = rest_p.lerp(up_p, k)
					d = rest_d.slerp(up_d, k)
				elif t < 0.5:
					var k := smoothstep(0.35, 0.5, t)
					p = up_p.lerp(hit_p, k)
					d = up_d.slerp(hit_d, k)
				else:
					var k := smoothstep(0.5, 0.75, t)
					p = hit_p.lerp(rest_p, k)
					d = hit_d.slerp(rest_d, k)
			var b := Basis.looking_at(d, fwd if absf(d.dot(Vector3.UP)) > 0.95 else Vector3.UP)
			w.global_transform = Transform3D(b, p)
			body.hand_goal["r"] = w.global_transform * Vector3(0.0, 0.0, 0.02)
			body.hand_goal["l"] = Vector3.INF
		"chainsaw":
			var push := 0.0
			if _swing_t >= 0.0:
				push = sin(minf(_swing_t / 0.9, 1.0) * PI)
			var p := shoulder + Vector3.DOWN * 0.42 * s + fwd * (0.18 + 0.25 * push) - right * 0.12 + Vector3.UP * 0.15 * push
			var d := (fwd + Vector3.DOWN * (0.25 - 0.3 * push)).normalized()
			w.global_transform = Transform3D(Basis.looking_at(d, Vector3.UP), p)
			if w.has_method("grip_right"):
				body.hand_goal["r"] = w.grip_right()
				body.hand_goal["l"] = w.grip_left()
		_:
			w.global_transform = Transform3D(Basis.looking_at(fwd, Vector3.UP), shoulder + Vector3.DOWN * 0.5 * s + fwd * 0.08)
			body.hand_goal["r"] = w.global_position
			body.hand_goal["l"] = Vector3.INF


func _drop_weapon() -> void:
	var model: Node3D = body.weapon
	body.weapon = null
	body.hand_goal = {"r": Vector3.INF, "l": Vector3.INF}
	_want_fire = false
	if not is_instance_valid(model):
		return
	var xf := model.global_transform
	var hand: RigidBody3D = body.parts[body.part_index["hand_r"]]
	model.get_parent().remove_child(model)
	var item: String = body.weapon_item if body.weapon_item != "" else body.weapon_kind
	if item in ["pistol", "shotgun", "akm"]:
		var pk = Pickup.spawn(body.get_parent(), item, xf, hand.linear_velocity, model)
		if Net.active and Net.is_host and Net.in_game:
			Net._drop_new.rpc(int(pk.get_meta("net_pid")), true, item, 1, xf, hand.linear_velocity)
	else:
		model.queue_free()
		Net.spawn_drop(body.get_parent(), false, item, 1, xf, hand.linear_velocity)
	body.weapon_kind = ""
	body.weapon_item = ""
	_swing_t = -1.0

## Holds the gun the way a person does and puts the hands on it. Aiming: a
## pistol out in front at eye level in both hands, a shotgun with the butt in
## the shoulder, both pointed at the target. Otherwise carried at low ready,
## muzzle down in front. The arms reach for the grip (and the forend or the
## support hand's spot) with IK, so the hands stay on the gun.
func _hold_gun() -> void:
	var gun: Node3D = body.weapon
	var chest: RigidBody3D = body.chest
	var cb := chest.global_basis.orthonormalized()
	var s: float = body.scale_factor
	var shoulder: Vector3 = chest.global_transform * (Vector3(0.22, 0.07, 0.0) * s)
	var fwd := Vector3(body.facing.x, 0, body.facing.z).normalized()
	var akm: bool = body.weapon_kind == "akm"
	var shotgun: bool = body.weapon_kind == "shotgun" or akm   # long guns: butt in the shoulder
	var aiming: bool = _want_fire and Game.player != null
	var dir: Vector3
	if aiming:
		dir = (_aim_point() + Vector3.UP * 0.05 - shoulder).normalized()
		# Arms only swing so far: the gun comes round with the chest.
		var chest_fwd := -cb.z
		var off := chest_fwd.angle_to(dir)
		if off > 0.9:
			var axis := chest_fwd.cross(dir)
			dir = chest_fwd.rotated(axis.normalized(), 0.9) if axis.length() > 1e-4 else chest_fwd
	else:
		dir = (fwd * 0.55 + Vector3.DOWN * 0.8).normalized() if not shotgun else (fwd * 0.8 + Vector3.DOWN * 0.45 - cb.x * 0.25).normalized()
	var up := Vector3.UP if absf(dir.y) < 0.95 else fwd
	var b := Basis.looking_at(dir, up)
	var origin: Vector3
	if shotgun:
		# Butt pad (z 0.375, y -0.03 in the model) in the shoulder pocket.
		var pocket := shoulder - cb.x * 0.05 * s + (Vector3.ZERO if aiming else fwd * 0.12 + Vector3.DOWN * 0.25)
		origin = pocket - b * (Vector3(0, -0.05, 0.35) if akm else Vector3(0, -0.03, 0.375))
	elif aiming:
		# Arms out, the gun in front of the chest's centre line at eye level.
		origin = shoulder - cb.x * 0.14 * s + dir * 0.5 * s + Vector3.UP * 0.05
	else:
		origin = shoulder + Vector3.DOWN * 0.38 * s + fwd * 0.22 + cb.x * 0.02
	gun.global_transform = Transform3D(b, origin)
	var xf := gun.global_transform
	body.hand_goal["r"] = xf * (Vector3(0, -0.06, 0.04) if akm else (Vector3(0, -0.035, 0.07) if shotgun else Vector3(0, -0.058, 0.03)))
	if shotgun:
		var pump := gun.get_node_or_null("Pump") as Node3D
		body.hand_goal["l"] = xf * Vector3(0, -0.02, -0.32) if akm else (pump.global_transform if pump else xf) * Vector3(0, -0.015, -0.3)
	elif aiming:
		body.hand_goal["l"] = xf * Vector3(-0.03, -0.065, 0.02)
	else:
		body.hand_goal["l"] = Vector3.INF


# --- Doors ---------------------------------------------------------------------------------

var _door: RigidBody3D = null
var _door_t := 0.0
var _door_check := 0.0


func _door_open(delta: float, dir: Vector3) -> bool:
	_door_check -= delta
	if _door_check <= 0.0:
		_door_check = 0.15
		var from: Vector3 = body.chest.global_position + Vector3.DOWN * 0.3
		var q := PhysicsRayQueryParameters3D.create(from, from + dir * 1.1, Game.LAYER_PROPS)
		q.exclude = body._ray_exclude
		var hit := body.get_world_3d().direct_space_state.intersect_ray(q)
		if not hit.is_empty() and hit.collider is RigidBody3D and hit.collider.has_method("center_local"):
			_door = hit.collider
			_door_t = 1.0
	if _door == null or not is_instance_valid(_door):
		_door = null
		return false
	_door_t -= delta
	if _door_t <= 0.0:
		_door = null
		body.hand_goal["r"] = Vector3.INF
		return false
	# The handle on this side of it.
	var dxf := _door.global_transform
	var side := signf((body.chest.global_position - dxf.origin).dot(dxf.basis.z))
	var handle: Vector3 = dxf * Vector3(_door._size.x - 0.1, 1.0, side * 0.07)
	if body.arm_health["r"] > 0.3 and body.chest.global_position.distance_to(handle) < 0.9:
		body.hand_goal["r"] = handle
	# The push: across the door, away from him.
	var push := -dxf.basis.z * side
	_door.apply_force(push * 140.0, handle - _door.global_position)
	_door.sleeping = false
	return true


# --- Gestures seen --------------------------------------------------------------------------------

var _wave_t := -1.0
var _wave_to: Node3D = null


## A player waved (hello) or showed him the finger. `direct`: at him.
func gesture_seen(kind: String, who: Node3D, direct := true) -> void:
	if not body.alive or not body.conscious or body.fallen or body.cuffed or roulette != null:
		return
	if who == null:
		who = Game.player
	match kind:
		"wave":
			if not direct or fear > 0.5 or state in [S.FLEE, S.HIDE, S.ARMED, S.ANGRY, S.BRAWL, S.SURRENDER]:
				return
			# Says hello back and waves (a surly one mutters something).
			if talk._rude and rng.randf() < 0.5:
				talk.say("reply_rude")
			else:
				talk.say("greet" if rng.randf() < 0.6 else "reply_fine")
				_wave_t = 1.4
				_wave_to = who
		"fuck":
			body.angry_until = Game.clock + (14.0 if direct else 5.0)
			if not direct:
				return
			if body.weapon:
				# Armed: a hothead takes it as a threat; another just tells him.
				if _hothead or rng.randf() < 0.35:
					_attackers[who] = Game.clock
				elif not talk.speaking():
					talk.say("man_go_away")
				return
			if fear > 0.6:
				_enter(S.FLEE)
				return
			if who == Game.player and state not in [S.ANGRY, S.BRAWL, S.TALK] and rng.randf() < 0.7:
				if talk.busy():
					talk.end()
				_enter(S.ANGRY)
				_swear_at = 0.0
			elif not talk.speaking():
				talk.say(SWEARS[rng.randi() % SWEARS.size()])


## The wave back: the hand up by the head, to and fro, turned to them.
func _wave_tick(delta: float) -> void:
	if _wave_t <= 0.0:
		return
	_wave_t -= delta
	body.wave = 1.0 if _wave_t > 0.0 and body.weapon == null else 0.0
	if body.wave <= 0.0:
		return
	if _wave_to and is_instance_valid(_wave_to):
		var at: Vector3 = _wave_to.cam.global_position if _wave_to == Game.player else _wave_to.eye_position()
		body.look_target = at
		body.has_look_target = true
		var to: Vector3 = at - body.position_ground()
		to.y = 0.0
		if to.length() > 0.3 and state in [S.IDLE, S.WANDER, S.ACTIVITY, S.TALK]:
			body.facing = (body.facing as Vector3).slerp(to.normalized(), minf(delta * 4.0, 1.0)).normalized()


# --- The player and him: talking, following, coming up, bumping -------------------------------------

var player_talk: Node3D = null      # talking with the player (dialog_ui.gd): he stands and listens
var _follow: Node3D = null
var _follow_until := -1.0
var _approach := ""                 # coming up to the player to: "smoke", "job", "roulette"
var _approach_at := -1.0
var _bump_cd := 0.0
static var _last_approach := -999.0

## Places worth walking to, across the whole yard (a man going somewhere).
const PLACES := [Vector3(0.3, 0.15, -6.2), Vector3(-11.0, 0.15, -6.6), Vector3(17.5, 0.0, 12.0), Vector3(-18.0, 0.0, -1.2),
		Vector3(-6.0, 0.15, -6.8), Vector3(25.0, 0.0, -18.5), Vector3(-27.0, 0.0, -27.0), Vector3(-22.0, 0.0, 12.0),
		Vector3(-25.0, 0.9, 20.0), Vector3(2.0, 0.0, 3.0), Vector3(27.5, 0.0, -14.5), Vector3(10.0, 0.0, 22.0),
		Vector3(-10.0, 0.0, 26.0), Vector3(20.0, 0.0, 0.0), Vector3(5.0, 0.15, -12.0)]


## Something asked of him in a talk (dialog_ui.gd; from a client via net.gd).
func dialog_act(args: Array, who: Node3D) -> void:
	if who == null:
		who = Game.player
	match String(args[0]):
		"follow":
			_follow = who
			_follow_until = Game.clock + 60.0
			player_talk = null
		"angry_short":
			body.angry_until = Game.clock + 8.0


## The social part of deciding (called first thing in _decide): returns
## true when it has settled what he does now.
func _social() -> bool:
	if player_talk and is_instance_valid(player_talk):
		# Stands, turned to the player, and listens.
		if talk.busy():
			talk.end()
		_path = PackedVector3Array()
		body.posture = Posture.STAND
		_threat = player_talk.global_position
		_threat_known = true
		_face_player = true
		return true
	_face_player = false if state in [S.WANDER, S.IDLE] else _face_player
	if _follow and is_instance_valid(_follow) and Game.clock < _follow_until and fear < 0.5:
		var at: Vector3 = _follow.global_position if _follow == Game.player else _follow.position_ground()
		var me: Vector3 = body.position_ground()
		var d := Vector2(at.x - me.x, at.z - me.z).length()
		if d > 2.2 and (_path.is_empty() or _path_i >= _path.size() or rng.randf() < 0.15):
			_goto(_closest_nav(at))
			_speed = 3.2 if d > 6.0 else 1.5
		elif d <= 1.6:
			_path = PackedVector3Array()
		if state != S.WANDER:
			_enter(S.WANDER)
		return true
	elif _follow:
		if Game.clock >= _follow_until and not talk.speaking():
			talk.say("reply_fine")
		_follow = null
	# Coming up to the player of his own accord.
	var p = Game.player
	if _approach != "":
		if p == null or p._dead or fear > 0.3 or state not in [S.WANDER, S.IDLE] or Game.clock - _approach_at > 25.0:
			_approach = ""
			return false
		var me: Vector3 = body.position_ground()
		var d := Vector2(p.global_position.x - me.x, p.global_position.z - me.z).length()
		if d > 1.9:
			if _path.is_empty() or _path_i >= _path.size() or rng.randf() < 0.2:
				_goto(_closest_nav(p.global_position))
				_speed = 1.6
			return true
		_path = PackedVector3Array()
		var what := _approach
		_approach = ""
		if p.has_method("open_dialog") and not p.is_busy():
			var pe = _persona()
			match what:
				"smoke":
					p.open_dialog(body, "Слышь, братан... есть закурить?", "main")
				"job":
					var w: Array = pe.wants[0]
					p.open_dialog(body, "Эй. Дело есть. Найди мне %s - заплачу %d. Идёт?" % [pe.item_name(w[0]), int(w[1] * 0.9)], "main")
				"roulette":
					p.open_dialog(body, "Эй, ты. Сыграем в рулетку? Или зассал?", "roulette")
		return true
	if state in [S.WANDER, S.IDLE] and p and not p._dead and _sees and _player_dist < 14.0 and fear < 0.1 \
			and body.weapon == null and Game.clock - _last_approach > 75.0 and rng.randf() < 0.004 \
			and not Net.active:
		var pe = _persona()
		var r := rng.randf()
		if (_hothead and r < 0.5) or r < 0.15:
			_approach = "roulette"
		elif not pe.wants.is_empty() and r < 0.75:
			_approach = "job"
		else:
			_approach = "smoke"
		_approach_at = Game.clock
		_last_approach = Game.clock
		return true
	return false


func _persona():
	if not body.has_meta("persona"):
		body.set_meta("persona", load("res://scripts/bots/persona.gd").make(body.bot_seed, talk._rude))
	return body.get_meta("persona")


## The player walked into him.
func bumped(by: Node3D) -> void:
	if _bump_cd > 0.0 or not body.alive or not body.conscious or body.fallen or state not in [S.WANDER, S.IDLE, S.ACTIVITY, S.TALK]:
		return
	_bump_cd = 4.0
	body.angry_until = maxf(body.angry_until, Game.clock + 3.0)
	_threat = by.global_position
	_threat_known = true
	if not talk.speaking() and (talk._rude or rng.randf() < 0.5):
		talk.say("go_away" if talk._rude else "reply_rude")


## A place to walk to: often somewhere across the yard, else nearby; never
## hard against a wall or out by the outer wall.
func _wander_target() -> Vector3:
	if rng.randf() < 0.4:
		var pl: Vector3 = PLACES[rng.randi() % PLACES.size()]
		return _closest_nav(pl + Vector3(rng.randf_range(-2.5, 2.5), 0, rng.randf_range(-2.5, 2.5)))
	return _random_nearby(4.0, 14.0)


func _clear_of_walls(p: Vector3, r: float) -> bool:
	var from := p + Vector3.UP * 0.9
	for k in 6:
		var d := Vector3(cos(TAU * k / 6.0), 0.0, sin(TAU * k / 6.0))
		var q := PhysicsRayQueryParameters3D.create(from, from + d * r, Game.LAYER_WORLD)
		if not _space().intersect_ray(q).is_empty():
			return false
	return true


## `hours` went by unseen (the player slept): the upset has passed, wounds
## have done what they would, and he is off somewhere else - at something
## to do, or just about the place.
func time_passes(hours: float) -> void:
	if not body.alive or body.cuffed or roulette != null or spectate != null or process_mode == Node.PROCESS_MODE_DISABLED \
			or body.has_meta("puppet") or body.has_meta("trader"):
		return
	# A bad bleed does not wait for morning.
	if body.bleed_rate > 20.0 and hours > 1.0:
		body._die("bleed_out")
		return
	body.bleed_rate = 0.0
	body.blood = minf(body.blood + hours * 150.0, body.BLOOD_MAX)
	body.pain = 0.0
	body.shock = 0.0
	fear = 0.0
	foe = null
	_attackers.clear()
	_follow = null
	_approach = ""
	player_talk = null
	body.angry_until = -1.0
	if talk.busy():
		talk.end()
	_end_activity()
	body.wake()
	if body.fallen or not body.conscious:
		return                          # (still down: he lies where he was)
	var to := Vector3.INF
	var going_to_do := false
	var acts = Game.main.get("activities") if Game.main else null
	if acts and body.weapon == null and rng.randf() < 0.55:
		var slot: Dictionary = acts.join(body)
		if not slot.is_empty():
			act = BotActivity.new(self, slot)
			to = slot["pos"]
			going_to_do = true
	if to == Vector3.INF:
		var nav := _nav_map()
		for k in 10:
			var p := NavigationServer3D.map_get_random_point(nav, 1, true)
			if p.y < 4.0 and absf(p.x) < 32.0 and absf(p.z) < 32.0 and _clear_of_walls(p, 0.7):
				to = p
				break
	if to == Vector3.INF:
		return
	var off: Vector3 = to - body.position_ground()
	for part in body.parts:
		part.global_position += off + Vector3.UP * 0.03
		part.linear_velocity = Vector3.ZERO
		part.angular_velocity = Vector3.ZERO
		part.reset_physics_interpolation()
	if body.weapon and is_instance_valid(body.weapon):
		body.weapon.global_position += off
	body.facing = Vector3(cos(rng.randf() * TAU), 0, sin(rng.randf() * TAU)).normalized()
	_path = PackedVector3Array()
	if going_to_do:
		_enter(S.ACTIVITY)
	else:
		_enter(S.WANDER)
