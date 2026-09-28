extends CharacterBody3D
## First-person player: movement with stair step-up, dynamic camera motion
## (bob, strafe/turn roll, landing dip, recoil kick) and weapon handling.

const Weapon = preload("res://scripts/weapons/weapon.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")

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
			Game.play_3d(Sfx.get_stream(&"step"), global_position, -16.0 + _sprint * 5.0, 0.15, 2.0)
	_bob_amount = move_toward(_bob_amount, clampf(speed / SPRINT_SPEED, 0.0, 1.0) if is_on_floor() else 0.0, delta * 4.0)

	if Game.is_mouse_captured() and Input.is_action_just_pressed("fire"):
		current.try_fire(cam, [get_rid()])


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
