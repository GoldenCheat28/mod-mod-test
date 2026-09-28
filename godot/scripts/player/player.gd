extends CharacterBody3D
## First-person player: movement with stair step-up, dynamic camera motion
## (bob, strafe/turn roll, landing dip, recoil kick) and weapon handling.

const Weapon = preload("res://scripts/weapons/weapon.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")
const HandIcon = preload("res://scripts/ui/hand_icon.gd")

const WALK_SPEED := 3.0
const SPRINT_SPEED := 5.8
const GROUND_ACCEL := 10.0
const AIR_ACCEL := 1.5
const JUMP_VELOCITY := 4.3
const GRAVITY := 9.81
const MOUSE_SENS := 0.0022
const EYE_HEIGHT := 1.62
const STEP_HEIGHT := 0.36
const BASE_FOV := 78.0
const GRAB_REACH := 2.4
const GRAB_MAX_FORCE := 950.0      # N: a person can drag a body, not throw it
const GRAB_MAX_MASS := 90.0

var cam: Camera3D
var yaw := 0.0
var pitch := 0.0
var weapons := {}
var current: Node3D
var _pending := ""

var _look_delta := Vector2.ZERO
var _bob_phase := 0.0
var _bob_amount := 0.0
var _sprint := 0.0
var _was_on_floor := true
var _prev_vy := 0.0
var _cam_y := 0.0
var _land := 0.0
var _land_v := 0.0
var _kick := 0.0
var _kick_v := 0.0
var _kick_roll := 0.0
var _kick_roll_v := 0.0
var _turn_roll := 0.0
var _strafe_roll := 0.0
var _time := 0.0

# Grabbing.
var _hand: Control
var _held: RigidBody3D
var _held_local := Vector3.ZERO
var _held_dist := 1.5
var _aim_body: RigidBody3D

# Wet footsteps: looping puddle recordings faded in while moving through water.
var _splash_walk: AudioStreamPlayer
var _splash_run: AudioStreamPlayer
var _wet := 0.0
var _step_side := 1.0


func _ready() -> void:
	collision_layer = Game.LAYER_PLAYER
	collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS
	floor_max_angle = deg_to_rad(46.0)
	floor_snap_length = 0.4
	floor_constant_speed = true
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = 1.76
	cs.shape = cap
	cs.position.y = 0.88
	add_child(cs)

	cam = Camera3D.new()
	cam.name = "Camera"
	cam.top_level = true
	cam.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	cam.fov = BASE_FOV
	cam.near = 0.02
	cam.far = 400.0
	add_child(cam)
	cam.make_current()

	for k in ["pistol", "shotgun"]:
		var w := Weapon.new()
		w.name = k.capitalize()
		cam.add_child(w)
		w.setup(k)
		w.fired.connect(_on_fired)
		weapons[k] = w
	current = weapons["pistol"]
	current.raise()

	var ui := CanvasLayer.new()
	add_child(ui)
	_hand = HandIcon.new()
	ui.add_child(_hand)
	_splash_walk = _loop_player(&"puddle_walk")
	_splash_run = _loop_player(&"puddle_run")
	yaw = PI
	_cam_y = global_position.y
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Game.is_mouse_captured():
		var rel: Vector2 = event.screen_relative
		yaw -= rel.x * MOUSE_SENS
		pitch = clampf(pitch - rel.y * MOUSE_SENS, deg_to_rad(-88), deg_to_rad(88))
		_look_delta += rel
	elif event.is_action_pressed("weapon_pistol"):
		_switch_to("pistol")
	elif event.is_action_pressed("weapon_shotgun"):
		_switch_to("shotgun")
	elif event.is_action_pressed("reload"):
		current.try_reload()


func _switch_to(k: String) -> void:
	if weapons[k] == current and _pending == "":
		return
	_pending = k
	current.lower()


func _physics_process(delta: float) -> void:
	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var yaw_basis := Basis(Vector3.UP, yaw)
	var wish := yaw_basis * Vector3(input.x, 0, input.y)
	var on_floor := is_on_floor()

	var sprinting := Input.is_action_pressed("sprint") and input.y < -0.3 and on_floor
	_sprint = move_toward(_sprint, 1.0 if sprinting else 0.0, delta * 4.0)
	var target_speed := lerpf(WALK_SPEED, SPRINT_SPEED, _sprint)

	var hv := Vector3(velocity.x, 0, velocity.z)
	var accel := GROUND_ACCEL if on_floor else AIR_ACCEL
	hv = hv.lerp(wish * target_speed, 1.0 - exp(-accel * delta))

	var vy := velocity.y
	if not on_floor:
		vy -= GRAVITY * delta * (1.0 if vy > 0.0 else 1.3)
	elif Input.is_action_just_pressed("jump"):
		vy = JUMP_VELOCITY
		_land_v += 0.6
		_kick_v -= 0.6
	velocity = Vector3(hv.x, vy, hv.z)

	var pre_pos := global_position
	_prev_vy = velocity.y
	move_and_slide()
	if on_floor and is_on_wall() and hv.length() > 0.2:
		_try_step_up(hv * delta, pre_pos)

	_push_bodies()

	var landed := is_on_floor() and not _was_on_floor
	if landed and _prev_vy < -2.0:
		var impact := -_prev_vy
		_land_v -= impact * 0.35
		_kick_v += impact * 0.25
		Game.play_3d(Sfx.get_stream(&"land"), global_position, -10.0 + minf(impact, 8.0), 0.1, 3.0)
	_was_on_floor = is_on_floor()

	# Footsteps follow the bob phase: one step every PI.
	var speed := Vector2(velocity.x, velocity.z).length()
	if is_on_floor() and speed > 0.3:
		var stride := lerpf(1.35, 1.9, _sprint)
		var prev := int(_bob_phase / PI)
		_bob_phase += speed / stride * PI * delta
		if int(_bob_phase / PI) != prev:
			_step_side = -_step_side
			if _wet < 0.3:
				Game.play_3d(Sfx.get_stream(&"step"), global_position, -9.0 + _sprint * 3.0, 0.07, 2.0)
			if Game.blood:
				var fwd := -Basis(Vector3.UP, yaw).z
				Game.blood.footstep(global_position + Basis(Vector3.UP, yaw).x * 0.11 * _step_side, fwd, self)
	_bob_amount = move_toward(_bob_amount, clampf(speed / SPRINT_SPEED, 0.0, 1.0) if is_on_floor() else 0.0, delta * 4.0)

	_update_grab(delta)
	_update_wet(delta, speed)

	if Game.is_mouse_captured() and Input.is_action_just_pressed("fire") and _held == null:
		var exclude: Array[RID] = [get_rid()]
		current.try_fire(cam, exclude)


func _try_step_up(motion: Vector3, _pre: Vector3) -> void:
	var xf := global_transform
	var up := Vector3.UP * STEP_HEIGHT
	if test_move(xf, up):
		return
	var fwd := motion.normalized() * maxf(motion.length(), 0.1)
	var raised := xf.translated(up)
	if test_move(raised, fwd):
		return
	var ahead := raised.translated(fwd)
	var col := KinematicCollision3D.new()
	if test_move(ahead, -up, col) and col.get_normal().y > 0.7:
		global_position = ahead.origin + col.get_travel()
		apply_floor_snap()


func _push_bodies() -> void:
	for i in get_slide_collision_count():
		var c := get_slide_collision(i)
		var rb := c.get_collider() as RigidBody3D
		if rb == null:
			continue
		var push := -c.get_normal()
		push.y = 0.0
		var strength := clampf(velocity.length() * 0.6, 0.0, 3.0) * minf(rb.mass, 20.0) * 0.05
		rb.apply_impulse(push * strength, c.get_position() - rb.global_position)


func _on_fired(kick: float) -> void:
	_kick_v += kick * 3.2
	_kick_roll_v += randf_range(-1.0, 1.0) * kick * 2.5
	pitch = clampf(pitch + deg_to_rad(0.35 * kick), deg_to_rad(-88), deg_to_rad(88))
	yaw += deg_to_rad(randf_range(-0.12, 0.12) * kick)


func _process(delta: float) -> void:
	_time += delta
	# Weapon switching once the current gun is lowered.
	if _pending != "" and current.is_holstered():
		current = weapons[_pending]
		_pending = ""
		current.raise()

	# Springs for landing dip, recoil kick and roll.
	_land_v += (-_land * 90.0 - _land_v * 11.0) * delta
	_land += _land_v * delta
	_kick_v += (-_kick * 160.0 - _kick_v * 16.0) * delta
	_kick += _kick_v * delta
	_kick_roll_v += (-_kick_roll * 140.0 - _kick_roll_v * 14.0) * delta
	_kick_roll += _kick_roll_v * delta

	var local_v := Basis(Vector3.UP, yaw).inverse() * velocity
	_strafe_roll = lerpf(_strafe_roll, clampf(-local_v.x * 0.006, -0.03, 0.03), minf(delta * 6.0, 1.0))
	_turn_roll = lerpf(_turn_roll, clampf(-_look_delta.x * 0.0009, -0.05, 0.05), minf(delta * 8.0, 1.0))

	var amp := _bob_amount * lerpf(1.0, 1.7, _sprint)
	var bob := Vector2(cos(_bob_phase) * 0.018 * amp, -absf(sin(_bob_phase)) * 0.028 * amp)
	var breathe := sin(_time * 1.6) * 0.004

	var base := get_global_transform_interpolated().origin
	if absf(base.y - _cam_y) > 0.7:
		_cam_y = base.y
	else:
		_cam_y = lerpf(_cam_y, base.y, 1.0 - exp(-delta * 22.0))

	var cam_pitch := pitch + _kick * 0.05 + breathe + clampf(velocity.y * -0.004, -0.03, 0.03)
	var cam_roll := _strafe_roll + _turn_roll + _kick_roll * 0.03 + bob.x * 0.5
	var b := Basis.from_euler(Vector3(cam_pitch, yaw, cam_roll))
	var right := Basis(Vector3.UP, yaw).x
	var eye := Vector3(base.x, _cam_y + EYE_HEIGHT + bob.y + _land * 0.08, base.z) + right * bob.x
	cam.global_transform = Transform3D(b, eye)
	cam.fov = lerpf(cam.fov, BASE_FOV + _sprint * 5.0, minf(delta * 6.0, 1.0))

	for w in weapons.values():
		if w.visible:
			w.update(delta, {
				"look_delta": _look_delta,
				"bob": bob,
				"sprint": _sprint,
				"air": velocity.y if not is_on_floor() else _land * 3.0,
				"cam": cam,
			})
	_look_delta = Vector2.ZERO


func _loop_player(sound: StringName) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	var s := Sfx.get_stream(sound)
	if s is AudioStreamOggVorbis:
		(s as AudioStreamOggVorbis).loop = true
	p.stream = s
	p.bus = &"World"
	p.volume_linear = 0.0
	add_child(p)
	return p


# --- Grabbing ------------------------------------------------------------------

func _grab_ray() -> Dictionary:
	var from := cam.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_basis.z * GRAB_REACH,
			Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_DEBRIS)
	var ex: Array[RID] = [get_rid()]
	q.exclude = ex
	return get_world_3d().direct_space_state.intersect_ray(q)


func _grabbable(body: Object) -> bool:
	return body is RigidBody3D and not (body as RigidBody3D).freeze and (body as RigidBody3D).mass <= GRAB_MAX_MASS


## Hold E: the grabbed point is pulled towards a spot in front of the camera by
## a force-limited spring, so light things follow the hand and heavy things
## (a body) get dragged. Release E to let go.
func _update_grab(delta: float) -> void:
	_aim_body = null
	if _held == null:
		var hit := _grab_ray()
		if not hit.is_empty() and _grabbable(hit.collider):
			_aim_body = hit.collider
			if Input.is_action_just_pressed("grab"):
				_held = _aim_body
				_held_local = _held.to_local(hit.position)
				_held_dist = clampf(cam.global_position.distance_to(hit.position), 0.7, GRAB_REACH)
				_held.sleeping = false
	elif not Input.is_action_pressed("grab") or not is_instance_valid(_held):
		_held = null
	else:
		var target := cam.global_position - cam.global_basis.z * _held_dist
		var point := _held.to_global(_held_local)
		var offset := point - _held.global_position
		var point_vel := _held.linear_velocity + _held.angular_velocity.cross(offset)
		var err := target - point
		if err.length() > 1.6:
			_held = null   # snagged on something, the grip slips
		else:
			var m := minf(_held.mass, 20.0)
			var f := (err * 260.0 - (point_vel - velocity) * 26.0) * m
			f += Vector3.UP * _held.mass * 9.81 * clampf(1.0 - _held.mass / GRAB_MAX_MASS, 0.0, 1.0)
			_held.apply_force(f.limit_length(GRAB_MAX_FORCE), offset)
			_held.angular_velocity *= 1.0 - minf(delta * 3.0, 0.5)
	if _hand:
		_hand.set_mode(HandIcon.Mode.CLOSED if _held else (HandIcon.Mode.OPEN if _aim_body else HandIcon.Mode.HIDDEN))


# --- Wet footsteps ------------------------------------------------------------------

func _update_wet(delta: float, speed: float) -> void:
	var on_water := false
	if is_on_floor():
		var p := global_position
		for spot in Game.water_spots:
			var c: Vector3 = spot[0]
			if absf(c.y - p.y) < 0.35 and Vector2(c.x - p.x, c.z - p.z).length() < spot[1]:
				on_water = true
				break
		if not on_water and Game.blood and Game.blood.is_pool(p):
			on_water = true
	_wet = move_toward(_wet, 1.0 if on_water else 0.0, delta * 5.0)
	var moving := clampf(speed / WALK_SPEED, 0.0, 1.0) if is_on_floor() else 0.0
	_fade_loop(_splash_walk, _wet * moving * (1.0 - _sprint) * 0.8, delta)
	_fade_loop(_splash_run, _wet * moving * _sprint * 0.8, delta)


## Smoothly fades a looping recording in and out, pausing it when silent.
func _fade_loop(p: AudioStreamPlayer, target: float, delta: float) -> void:
	if p.stream == null:
		return
	p.volume_linear = move_toward(p.volume_linear, target, delta * 2.5)
	if p.volume_linear > 0.001:
		if not p.playing and not p.stream_paused:
			p.play(randf() * 20.0)
		p.stream_paused = false
	else:
		p.stream_paused = true