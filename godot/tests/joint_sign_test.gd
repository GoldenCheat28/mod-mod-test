extends Node3D
## Dev test: which rotation sign a Generic6DOF angular limit allows (Jolt).

var parent: RigidBody3D
var child: RigidBody3D
var t := 0.0
var phase := 0
var axis := 1


func _ready() -> void:
	parent = _body(Vector3(0, 2, 0))
	parent.freeze = true
	child = _body(Vector3(0, 1.5, 0))
	var j := Generic6DOFJoint3D.new()
	j.position = Vector3(0, 1.75, 0)
	add_child(j)
	j.node_a = j.get_path_to(parent)
	j.node_b = j.get_path_to(child)
	axis = int(OS.get_environment("AXIS"))
	# Allow rotation about `axis` only in [0, 1.2]; lock the others.
	for a in 3:
		var hi := 1.2 if a == axis else 0.0
		match a:
			0:
				j.set_flag_x(Generic6DOFJoint3D.FLAG_ENABLE_ANGULAR_LIMIT, true)
				j.set_param_x(Generic6DOFJoint3D.PARAM_ANGULAR_LOWER_LIMIT, 0.0)
				j.set_param_x(Generic6DOFJoint3D.PARAM_ANGULAR_UPPER_LIMIT, hi)
			1:
				j.set_flag_y(Generic6DOFJoint3D.FLAG_ENABLE_ANGULAR_LIMIT, true)
				j.set_param_y(Generic6DOFJoint3D.PARAM_ANGULAR_LOWER_LIMIT, 0.0)
				j.set_param_y(Generic6DOFJoint3D.PARAM_ANGULAR_UPPER_LIMIT, hi)
			2:
				j.set_flag_z(Generic6DOFJoint3D.FLAG_ENABLE_ANGULAR_LIMIT, true)
				j.set_param_z(Generic6DOFJoint3D.PARAM_ANGULAR_LOWER_LIMIT, 0.0)
				j.set_param_z(Generic6DOFJoint3D.PARAM_ANGULAR_UPPER_LIMIT, hi)
	PhysicsServer3D.area_set_param(get_world_3d().space, PhysicsServer3D.AREA_PARAM_GRAVITY, 0.0)


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
	var sign := 1.0 if t < 1.5 else -1.0
	var tv := Vector3.ZERO
	tv[axis] = sign * 3.0
	child.apply_torque(tv)
	if fmod(t, 0.5) < delta:
		var rel := (parent.global_basis.inverse() * child.global_basis).get_euler()
		print("t=%.2f torque_sign=%+d rel=%s" % [t, int(sign), rel])
	if t > 3.0:
		get_tree().quit()
