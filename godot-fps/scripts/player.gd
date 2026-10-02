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
var land_dip := 0.0
var trauma := 0.0
var shake_t := 0.0
var was_on_floor := true
var last_vy := 0.0
var noise := FastNoiseLite.new()
@onready var head: Node3D = $Head
@onready var cam: Camera3D = $Head/Camera3D

func _ready() -> void:
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
		land_dip = clampf(-last_vy * 0.025, 0.0, 0.3)   # приземление: камера «проседает»
		add_trauma(clampf(-last_vy * 0.02, 0.0, 0.35))
	was_on_floor = is_on_floor()
	for i in get_slide_collision_count():
		var col := get_slide_collision(i)
		var rb := col.get_collider() as RigidBody3D
		if rb:
			rb.apply_central_impulse(-col.get_normal() * 2.0)

# Динамика камеры: покачивание, крен в стороны, FOV на скорости, просадка при приземлении, тряска
func _process(delta: float) -> void:
	var hv := Vector2(velocity.x, velocity.z)
	var spd := hv.length()
	var sprinting := Input.is_action_pressed("sprint") and spd > speed * 1.1
	var grounded := is_on_floor()
	if grounded:
		bob_t += delta * spd * (1.25 if sprinting else 1.55)
	var amp := clampf(spd / speed, 0.0, 1.5) if grounded else 0.0
	var bob := Vector3(sin(bob_t * 0.5) * 0.022, absf(sin(bob_t * 0.5)) * 0.045 - 0.02, 0.0) * amp
	# крен от бокового движения и поворота
	var lateral := velocity.dot(global_transform.basis.x)
	roll = lerpf(roll, -lateral / sprint_speed * 0.045, delta * 8.0)
	land_dip = lerpf(land_dip, 0.0, delta * 9.0)
	# FOV
	var fov_t := base_fov + (9.0 if sprinting else 0.0) + clampf(spd, 0.0, 10.0) * 0.5
	cam.fov = lerpf(cam.fov, fov_t, delta * 7.0)
	# тряска (trauma^2, шум)
	trauma = maxf(0.0, trauma - delta * 1.6)
	shake_t += delta * 38.0
	var sh := trauma * trauma
	var shake := Vector3(noise.get_noise_2d(shake_t, 0.0), noise.get_noise_2d(shake_t, 50.0), noise.get_noise_2d(shake_t, 100.0)) * sh
	cam.position = bob + Vector3(0, -land_dip, 0) + shake * 0.03
	cam.rotation = Vector3(shake.x * 0.05, shake.y * 0.05, roll + shake.z * 0.07 + sin(bob_t * 0.5) * 0.004 * amp)
