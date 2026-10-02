class_name Grabber
extends Node
## Подбор предметов: ДЕРЖИ [E] — предмет в руках, отпустил — упал.
## ЛКМ с предметом — бросок, колесо мыши — ближе/дальше.
## Предметы держатся физически (скоростью), поэтому упираются в стены и тяжёлые отстают.
## Части регдолла держатся за точку захвата — тело можно тащить за руку или ногу.

signal hover_changed(can_grab: bool)
signal grab_changed(holding: bool)

@export var reach := 2.6
@export var max_mass := 60.0
@export var min_distance := 0.9
@export var hold_stiffness := 16.0       # насколько резко предмет тянется к руке
@export var max_hold_speed := 10.0
@export var throw_speed := 9.0
@export var break_distance := 1.5        # застрял дальше этого...
@export var break_time := 0.3            # ...дольше этого — выпадает из рук

var held: RigidBody3D
var hovering := false

var _player: Player
var _grab_local := Vector3.ZERO          # точка захвата в координатах предмета
var _rot_offset := Basis.IDENTITY        # поворот предмета относительно взгляда игрока
var _distance := 1.6
var _point_mode := false                 # true для регдоллов: держим за точку, не за центр
var _saved_angular_damp := 0.0
var _stuck_time := 0.0


func _ready() -> void:
	_player = get_parent() as Player


func _unhandled_input(event: InputEvent) -> void:
	if held and event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_distance = minf(_distance + 0.15, reach)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_distance = maxf(_distance - 0.15, min_distance)


func _physics_process(delta: float) -> void:
	var cam := _player.camera
	var from := cam.global_position
	var fwd := -cam.global_basis.z

	if held and not is_instance_valid(held):
		_clear()

	if held == null:
		var target := _look_target(from, fwd)
		_set_hover(target != null)
		if target and Input.is_action_just_pressed("interact"):
			_grab(target, from, fwd)
		return

	if not Input.is_action_pressed("interact"):
		_release(Vector3.ZERO)
		return
	if Input.is_action_just_pressed("shoot"):
		var throw := throw_speed * clampf(1.0 - held.mass / (max_mass * 1.2), 0.15, 1.0)
		_release(fwd * throw)
		return

	var target_pos := from + fwd * _distance
	var grab_world := held.global_transform * _grab_local
	var err := target_pos - grab_world
	_stuck_time = _stuck_time + delta if err.length() > break_distance else 0.0
	if _stuck_time > break_time:
		_release(Vector3.ZERO)
		return

	# Тяжёлые предметы тянутся медленнее.
	var heavy := clampf(held.mass / max_mass, 0.0, 1.0)
	var desired_v := (err * hold_stiffness * lerpf(1.0, 0.35, heavy)).limit_length(max_hold_speed)
	desired_v += _player.velocity * 0.9

	if _point_mode:
		var r := grab_world - held.global_position
		var point_v := held.linear_velocity + held.angular_velocity.cross(r)
		var dv := desired_v - point_v
		held.apply_impulse(dv * held.mass * 0.5, r)
	else:
		held.linear_velocity = held.linear_velocity.lerp(desired_v, lerpf(0.6, 0.2, heavy))
		# Предмет поворачивается вместе с игроком.
		var target_basis := Basis(Vector3.UP, _player.rotation.y) * _rot_offset
		var q := (target_basis * held.global_basis.orthonormalized().inverse()).get_rotation_quaternion()
		var angle := q.get_angle()
		if angle > PI:
			angle -= TAU
		var axis := q.get_axis() if absf(angle) > 0.001 else Vector3.ZERO
		held.angular_velocity = held.angular_velocity.lerp(axis * angle * 12.0, lerpf(0.5, 0.15, heavy))


## Множитель скорости игрока: с тяжёлым предметом идёшь медленнее.
func speed_factor() -> float:
	if held == null:
		return 1.0
	return lerpf(1.0, 0.45, clampf(held.mass / max_mass, 0.0, 1.0))


func _look_target(from: Vector3, fwd: Vector3) -> RigidBody3D:
	var q := PhysicsRayQueryParameters3D.create(from, from + fwd * reach, 1 | 8 | 16, [_player.get_rid()])
	var r := _player.get_world_3d().direct_space_state.intersect_ray(q)
	if r.is_empty():
		return null
	var body := r.collider as RigidBody3D
	if body and body.is_in_group("pickable") and body.mass <= max_mass:
		return body
	return null


func _grab(body: RigidBody3D, from: Vector3, fwd: Vector3) -> void:
	held = body
	_stuck_time = 0.0
	_point_mode = body.is_in_group("ragdoll")
	var q := PhysicsRayQueryParameters3D.create(from, from + fwd * reach, 1 | 8 | 16, [_player.get_rid()])
	var r := _player.get_world_3d().direct_space_state.intersect_ray(q)
	var hit_pos: Vector3 = r.position if not r.is_empty() else body.global_position
	if _point_mode:
		_grab_local = body.global_transform.affine_inverse() * hit_pos
		_distance = clampf(from.distance_to(hit_pos), min_distance, reach)
	else:
		_grab_local = Vector3.ZERO
		_distance = clampf(from.distance_to(body.global_position), min_distance + 0.3, reach)
	_rot_offset = Basis(Vector3.UP, -_player.rotation.y) * body.global_basis.orthonormalized()
	_saved_angular_damp = body.angular_damp
	body.angular_damp = 3.0 if _point_mode else 6.0
	body.sleeping = false
	body.add_collision_exception_with(_player)   # не встанешь на то, что держишь
	_player.weapon.holstered = true
	_set_hover(false)
	grab_changed.emit(true)


func _release(velocity: Vector3) -> void:
	if is_instance_valid(held):
		held.angular_damp = _saved_angular_damp
		held.linear_velocity = held.linear_velocity.limit_length(5.0)
		if velocity != Vector3.ZERO:
			if _point_mode:
				held.apply_central_impulse(velocity * held.mass * 0.6)
			else:
				held.linear_velocity = velocity + _player.velocity * 0.5
				held.angular_velocity += Vector3(randf_range(-2, 2), randf_range(-2, 2), randf_range(-2, 2))
		var body := held
		# Исключение столкновений снимаем чуть позже, чтобы предмет не «выстрелил» из игрока.
		get_tree().create_timer(0.3).timeout.connect(func() -> void:
			if is_instance_valid(body) and is_instance_valid(_player):
				body.remove_collision_exception_with(_player))
	_clear()


func _clear() -> void:
	held = null
	_player.weapon.holstered = false
	grab_changed.emit(false)


func _set_hover(value: bool) -> void:
	if value != hovering:
		hovering = value
		hover_changed.emit(value)
