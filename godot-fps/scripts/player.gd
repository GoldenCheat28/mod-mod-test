extends CharacterBody3D

signal health_changed(hp: float)

@export var speed := 6.0
@export var sprint_speed := 9.5
@export var jump_velocity := 5.0
@export var mouse_sens := 0.0022
@export var base_fov := 85.0

var hp := 100.0
var gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")
var look_rel := Vector2.ZERO      # движение мыши за кадр — для инерции оружия
var bob_t := 0.0
var roll := 0.0
var trauma := 0.0
var shake_t := 0.0
var was_on_floor := true
var last_vy := 0.0
var noise := FastNoiseLite.new()
@onready var head: Node3D = $Head
@onready var cam: Camera3D = $Head/Camera3D

func _ready() -> void:
	collision_layer = Game.LAYER_PLAYER
	collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BODY
	Game.player = self
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	noise.frequency = 1.0
	cam.fov = base_fov

func _input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		return
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		rotate_y(-e.relative.x * mouse_sens)
		head.rotate_x(-e.relative.y * mouse_sens)
		head.rotation.x = clampf(head.rotation.x, -1.5, 1.5)
		look_rel += e.relative
	if e.is_action_pressed("ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED else Input.MOUSE_MODE_CAPTURED

func add_trauma(a: float) -> void:
	trauma = minf(1.0, trauma + a)

func take_damage(amount: float, _point := Vector3.ZERO, _normal := Vector3.UP, _dir := Vector3.ZERO) -> void:
	hp -= amount
	add_trauma(0.6)
	health_changed.emit(hp)
	if hp <= 0.0:
		get_tree().reload_current_scene()

func _physics_process(delta: float) -> void:
	last_vy = velocity.y
	if not is_on_floor():
		velocity.y -= gravity * delta
	elif Input.is_action_just_pressed("jump"):
		velocity.y = jump_velocity
	var dir := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var wish := (transform.basis * Vector3(dir.x, 0, dir.y)).normalized()
	var s := sprint_speed if Input.is_action_pressed("sprint") else speed
	var accel := 12.0 if is_on_floor() else 3.0
	velocity.x = lerpf(velocity.x, wish.x * s, accel * delta)
	velocity.z = lerpf(velocity.z, wish.z * s, accel * delta)
	move_and_slide()
	if is_on_floor() and not was_on_floor:
		dip_v = last_vy * 0.35   # приземление: камера пружинит вниз
		add_trauma(clampf(-last_vy * 0.01, 0.0, 0.2))
	was_on_floor = is_on_floor()
	for i in get_slide_collision_count():
		var col := get_slide_collision(i)
		var rb := col.get_collider() as RigidBody3D
		if rb:
			rb.apply_central_impulse(-col.get_normal() * 2.0)

# Динамика камеры: плавное покачивание, лёгкий крен, пружинная просадка при приземлении, мягкая тряска. FOV не меняется.
var bob_amp := 0.0
var dip := 0.0
var dip_v := 0.0

func _process(delta: float) -> void:
	var spd := Vector2(velocity.x, velocity.z).length()
	var grounded := is_on_floor()
	var sprinting := Input.is_action_pressed("sprint") and spd > speed * 1.1
	bob_amp = lerpf(bob_amp, clampf(spd / speed, 0.0, 1.4) if grounded else 0.0, delta * 7.0)
	if grounded:
		bob_t += delta * spd * (1.1 if sprinting else 1.35)
	# гладкое покачивание (синус, а не |sin|: без изломов)
	var bob := Vector3(sin(bob_t * 0.5) * 0.014, (cos(bob_t) - 1.0) * 0.011, 0.0) * bob_amp
	var lateral := velocity.dot(global_transform.basis.x)
	roll = lerpf(roll, -lateral / sprint_speed * 0.022, delta * 6.0)
	# пружина приземления
	dip_v += (-dip * 160.0 - dip_v * 16.0) * delta
	dip += dip_v * delta
	trauma = maxf(0.0, trauma - delta * 1.8)
	shake_t += delta * 11.0
	var sh := trauma * trauma
	var shake := Vector3(noise.get_noise_2d(shake_t, 0.0), noise.get_noise_2d(shake_t, 50.0), noise.get_noise_2d(shake_t, 100.0)) * sh
	cam.fov = base_fov
	cam.position = bob + Vector3(0, dip, 0) + shake * 0.015
	cam.rotation = Vector3(shake.x * 0.03, shake.y * 0.03, roll + shake.z * 0.04 + sin(bob_t * 0.5) * 0.0025 * bob_amp)
