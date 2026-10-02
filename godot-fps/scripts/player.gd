extends CharacterBody3D

@export var speed := 6.0
@export var sprint_speed := 9.5
@export var jump_velocity := 5.0
@export var mouse_sens := 0.0022
@export var damage := 25.0
@export var fire_rate := 0.12

var gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")
var cooldown := 0.0
@onready var head: Node3D = $Head
@onready var cam: Camera3D = $Head/Camera3D
@onready var ray: RayCast3D = $Head/Camera3D/RayCast3D

func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		rotate_y(-e.relative.x * mouse_sens)
		head.rotate_x(-e.relative.y * mouse_sens)
		head.rotation.x = clamp(head.rotation.x, -1.5, 1.5)
	if e.is_action_pressed("ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED else Input.MOUSE_MODE_CAPTURED

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= gravity * delta
	elif Input.is_action_just_pressed("jump"):
		velocity.y = jump_velocity
	var dir := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var wish := (transform.basis * Vector3(dir.x, 0, dir.y)).normalized()
	var s := sprint_speed if Input.is_action_pressed("sprint") else speed
	var accel := 12.0 if is_on_floor() else 3.0
	velocity.x = lerp(velocity.x, wish.x * s, accel * delta)
	velocity.z = lerp(velocity.z, wish.z * s, accel * delta)
	move_and_slide()
	cooldown -= delta
	if Input.is_action_pressed("shoot") and cooldown <= 0.0:
		cooldown = fire_rate
		_shoot()

func _shoot() -> void:
	ray.force_raycast_update()
	if ray.is_colliding():
		var c := ray.get_collider()
		if c and c.has_method("take_damage"):
			c.take_damage(damage)
