class_name Player
extends CharacterBody3D
## Игрок-капсула: ходьба, бег, присед, прыжок (с «койот-таймом» и буфером), толкание предметов.

@export_group("Движение")
@export var walk_speed := 4.2
@export var sprint_speed := 6.8
@export var crouch_speed := 2.1
@export var ground_accel := 11.0
@export var air_accel := 2.0
@export var jump_velocity := 4.7
@export var push_strength := 0.9

@export_group("Камера")
@export var mouse_sensitivity := 0.0022
@export var base_fov := 78.0

const STAND_HEIGHT := 1.8
const CROUCH_HEIGHT := 1.15
const EYE_STAND := 1.62
const EYE_CROUCH := 1.0
const COYOTE_TIME := 0.12
const JUMP_BUFFER := 0.15

var crouch_t := 0.0

var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")
var _coyote := 0.0
var _jump_buffer := 0.0
var _recoil := Vector2.ZERO           # x = вверх, y = вбок (радианы), камера сама возвращается
var _land_dip := 0.0
var _land_dip_v := 0.0
var _bob_t := 0.0
var _was_on_floor := true
var _fall_speed := 0.0
var _sprinting := false
var _step_dist := 0.0

@onready var head: Node3D = $Head
@onready var camera: Camera3D = $Head/Camera3D
@onready var weapon: Weapon = $Head/Camera3D/Weapon
@onready var grabber: Grabber = $Grabber
@onready var _shape: CollisionShape3D = $CollisionShape3D
@onready var _capsule: CapsuleShape3D = $CollisionShape3D.shape


func _ready() -> void:
	add_to_group("player")
	collision_layer = 2                    # player
	collision_mask = 1 | 4 | 8 | 16        # world, bot, props, ragdoll
	_capsule = _capsule.duplicate()        # своя копия, чтобы менять высоту при приседе
	_shape.shape = _capsule
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var sens := mouse_sensitivity * lerpf(1.0, 0.55, weapon.aim_t)
		rotate_y(-event.relative.x * sens)
		head.rotation.x = clampf(head.rotation.x - event.relative.y * sens, deg_to_rad(-89), deg_to_rad(89))
		weapon.add_sway(event.relative)
	elif event.is_action_pressed("ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		get_viewport().set_input_as_handled()


func _physics_process(delta: float) -> void:
	var on_floor := is_on_floor()
	_coyote = COYOTE_TIME if on_floor else _coyote - delta
	_jump_buffer = JUMP_BUFFER if Input.is_action_just_pressed("jump") else _jump_buffer - delta

	if not on_floor:
		velocity.y -= _gravity * delta

	var crouching := Input.is_action_pressed("crouch") or (crouch_t > 0.5 and _ceiling_blocked())
	if _jump_buffer > 0.0 and _coyote > 0.0 and crouch_t < 0.5:
		velocity.y = jump_velocity
		_jump_buffer = 0.0
		_coyote = 0.0
		weapon.land(0.15)

	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var dir := (transform.basis * Vector3(input.x, 0.0, input.y)).normalized()
	_sprinting = Input.is_action_pressed("sprint") and input.y < -0.1 and not crouching \
		and weapon.aim_t < 0.3 and on_floor
	var speed := walk_speed
	if crouching:
		speed = crouch_speed
	elif _sprinting:
		speed = sprint_speed
	speed *= lerpf(1.0, 0.6, weapon.aim_t) * grabber.speed_factor()

	var accel := ground_accel if on_floor else air_accel
	var k := 1.0 - exp(-accel * delta)
	velocity.x = lerpf(velocity.x, dir.x * speed, k)
	velocity.z = lerpf(velocity.z, dir.z * speed, k)

	_fall_speed = velocity.y
	move_and_slide()
	_push_bodies()

	# Приземление: камера и оружие «проседают».
	if is_on_floor() and not _was_on_floor and _fall_speed < -2.5:
		var strength := clampf(-_fall_speed / 10.0, 0.0, 1.0)
		_land_dip_v -= strength * 1.4
		weapon.land(strength)
		Sfx.play("step", linear_to_db(0.3 + strength * 0.7) - 6.0)
	_was_on_floor = is_on_floor()

	_update_crouch(delta, crouching)
	_update_camera(delta)
	_footsteps(delta)


func is_sprinting() -> bool:
	return _sprinting


## Вызывается оружием при выстреле. Часть отдачи остаётся (прицел уходит вверх),
## часть камера плавно возвращает сама.
func add_recoil(pitch: float, yaw: float) -> void:
	head.rotation.x = clampf(head.rotation.x + pitch * 0.45, deg_to_rad(-89), deg_to_rad(89))
	rotate_y(yaw * 0.45)
	_recoil += Vector2(pitch * 0.55, yaw * 0.55)


func _update_crouch(delta: float, crouching: bool) -> void:
	crouch_t = move_toward(crouch_t, 1.0 if crouching else 0.0, delta * 6.0)
	var h := lerpf(STAND_HEIGHT, CROUCH_HEIGHT, crouch_t)
	_capsule.height = h
	_shape.position.y = h * 0.5


func _update_camera(delta: float) -> void:
	# Пружина приседания при приземлении.
	_land_dip_v += (-_land_dip * 120.0 - _land_dip_v * 14.0) * delta
	_land_dip += _land_dip_v * delta

	var hs := Vector2(velocity.x, velocity.z).length()
	var bob := Vector2.ZERO
	if is_on_floor() and hs > 0.5:
		_bob_t += delta * hs * 1.8
		var amt := clampf(hs / sprint_speed, 0.0, 1.0) * (1.0 - weapon.aim_t * 0.8)
		bob = Vector2(cos(_bob_t) * 0.025, absf(sin(_bob_t)) * 0.035) * amt

	head.position.y = lerpf(EYE_STAND, EYE_CROUCH, crouch_t) + _land_dip * 0.12 + bob.y
	head.position.x = bob.x

	_recoil = _recoil.lerp(Vector2.ZERO, 1.0 - exp(-7.0 * delta))
	var strafe := Input.get_axis("move_left", "move_right")
	camera.rotation = Vector3(_recoil.x, _recoil.y,
		lerpf(camera.rotation.z, -strafe * 0.018, 1.0 - exp(-6.0 * delta)))

	var fov := base_fov + (6.0 if _sprinting else 0.0) - 22.0 * weapon.aim_t
	camera.fov = lerpf(camera.fov, fov, 1.0 - exp(-10.0 * delta))


func _push_bodies() -> void:
	for i in get_slide_collision_count():
		var c := get_slide_collision(i)
		var body := c.get_collider() as RigidBody3D
		if body == null or body == grabber.held:
			continue
		var n := -c.get_normal()
		n.y = 0.0
		if n.length_squared() < 0.01:
			continue
		var hs := Vector2(velocity.x, velocity.z).length()
		var f := push_strength * clampf(hs, 1.0, 7.0) * clampf(80.0 / maxf(body.mass, 1.0), 0.3, 1.0)
		body.apply_impulse(n.normalized() * f * get_physics_process_delta_time() * 8.0,
			c.get_position() - body.global_position)


func _ceiling_blocked() -> bool:
	var from := global_position + Vector3.UP * 0.5
	var q := PhysicsRayQueryParameters3D.create(from, global_position + Vector3.UP * (STAND_HEIGHT + 0.05),
		1 | 8, [get_rid()])
	return not get_world_3d().direct_space_state.intersect_ray(q).is_empty()


func _footsteps(delta: float) -> void:
	if not is_on_floor():
		return
	var hs := Vector2(velocity.x, velocity.z).length()
	_step_dist += hs * delta
	var stride := 1.6 if _sprinting else 1.25
	if _step_dist > stride:
		_step_dist = 0.0
		var vol := -20.0 if crouch_t > 0.5 else (-10.0 if _sprinting else -14.0)
		Sfx.play_3d("step", global_position, vol, 0.2)
