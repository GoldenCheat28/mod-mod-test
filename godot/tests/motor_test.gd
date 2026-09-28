extends Node3D
## Dev test: Generic6DOF angular motors under Jolt (support + sign).

var parent: RigidBody3D
var child: RigidBody3D
var j: Generic6DOFJoint3D
var t := 0.0
var axis := 0


func _ready() -> void:
	axis = int(OS.get_environment("AXIS"))
	parent = _body(Vector3(0, 2, 0))
	parent.freeze = true
	child = _body(Vector3(0, 1.5, 0))
	j = Generic6DOFJoint3D.new()
	j.position = Vector3(0, 1.75, 0)
	add_child(j)
	j.node_a = j.get_path_to(parent)
	j.node_b = j.get_path_to(child)
	for a in 3:
		_setp(a, Generic6DOFJoint3D.PARAM_ANGULAR_LOWER_LIMIT, -1.5)
		_setp(a, Generic6DOFJoint3D.PARAM_ANGULAR_UPPER_LIMIT, 1.5)
	var fl := [j.set_flag_x, j.set_flag_y, j.set_flag_z]
	fl[axis].call(Generic6DOFJoint3D.FLAG_ENABLE_MOTOR, true)
	_setp(axis, Generic6DOFJoint3D.PARAM_ANGULAR_MOTOR_TARGET_VELOCITY, 1.0)
	_setp(axis, Generic6DOFJoint3D.PARAM_ANGULAR_MOTOR_FORCE_LIMIT, 50.0)
	PhysicsServer3D.area_set_param(get_world_3d().space, PhysicsServer3D.AREA_PARAM_GRAVITY, 0.0)


func _setp(a: int, p: int, v: float) -> void:
	match a:
		0: j.set_param_x(p, v)
		1: j.set_param_y(p, v)
		2: j.set_param_z(p, v)


func _body(p: Vector3) -> RigidBody3D:
	var b := RigidBody3D.new()
	var cs := CollisionShape3D.new()
	var s := BoxShape3D.new()
	s.size = Vector3(0.1, 0.5, 0.1)
	cs.shape = s
	b.add_child(cs)
	b.position = p
	b.can_sleep = false
	add_child(b)
	return b


func _physics_process(delta: float) -> void:
	t += delta
	if fmod(t, 0.25) < delta:
		var rel := (parent.global_basis.inverse() * child.global_basis).get_euler()
		print("t=%.2f rel=%s w=%s" % [t, rel, child.angular_velocity])
	if t > 1.0:
		get_tree().quit()
