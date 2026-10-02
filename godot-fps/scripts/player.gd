extends CharacterBody3D

signal health_changed(hp: float)

@export var speed := 6.0
@export var sprint_speed := 9.5
@export var jump_velocity := 5.0
@export var mouse_sens := 0.0022

var hp := 100.0
var gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")
@onready var head: Node3D = $Head

func _ready() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		return
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		rotate_y(-e.relative.x * mouse_sens)
		head.rotate_x(-e.relative.y * mouse_sens)
		head.rotation.x = clampf(head.rotation.x, -1.5, 1.5)
	if e.is_action_pressed("ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED else Input.MOUSE_MODE_CAPTURED

func take_damage(amount: float, _point := Vector3.ZERO, _normal := Vector3.UP) -> void:
	hp -= amount
	health_changed.emit(hp)
	if hp <= 0.0:
		get_tree().reload_current_scene()

func _physics_process(delta: float) -> void:
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
	# толкаем ящики и бочки
	for i in get_slide_collision_count():
		var col := get_slide_collision(i)
		var rb := col.get_collider() as RigidBody3D
		if rb:
			rb.apply_central_impulse(-col.get_normal() * 2.0)
