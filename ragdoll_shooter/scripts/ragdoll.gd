class_name Ragdoll
extends Node3D
## Регдолл из капсул на суставах Generic6DOF (Jolt).
## Собирается из живого бота в его текущей позе: меши (вместе с ранами) переезжают в физические тела.

const MAX_RAGDOLLS := 6
static var _alive: Array[Ragdoll] = []

var bodies := {}        # имя части -> RigidBody3D


func build_from(bot: Bot) -> void:
	name = "Ragdoll"
	var phys_mat := PhysicsMaterial.new()
	phys_mat.friction = 0.9
	phys_mat.bounce = 0.0

	for part: Dictionary in BodyDef.PARTS:
		var mi: MeshInstance3D = bot.meshes[part.name]
		var body := RigidBody3D.new()
		body.name = part.name
		body.mass = part.mass
		body.collision_layer = 16                   # ragdoll
		body.collision_mask = 1 | 2 | 4 | 8 | 16    # world, player, bot, props, ragdoll
		body.physics_material_override = phys_mat
		body.linear_damp = 0.05
		body.angular_damp = 0.9
		body.continuous_cd = part.r < 0.1           # тонкие кости не проваливаются сквозь пол
		body.add_to_group("pickable")
		body.add_to_group("ragdoll")
		body.add_to_group("flesh")
		add_child(body)
		body.global_transform = mi.global_transform

		var cs := CollisionShape3D.new()
		cs.shape = BodyDef.capsule_shape(part)
		body.add_child(cs)

		# Меш вместе с декалями ран переезжает в тело.
		mi.reparent(body, false)
		mi.transform = Transform3D.IDENTITY

		body.linear_velocity = bot.velocity
		if part.name in ["chest", "head", "pelvis"]:
			body.contact_monitor = true
			body.max_contacts_reported = 2
			body.body_entered.connect(_on_body_hit.bind(body))
		bodies[part.name] = body

	for part: Dictionary in BodyDef.PARTS:
		if part.has("joint"):
			_make_joint(bot, part)

	_alive.append(self)
	if _alive.size() > MAX_RAGDOLLS:
		var old: Ragdoll = _alive.pop_front()
		if is_instance_valid(old):
			old.queue_free()


func apply_hit(part_name: String, impulse: Vector3, pos: Vector3) -> void:
	var body: RigidBody3D = bodies.get(part_name)
	if body:
		body.apply_impulse(impulse, pos - body.global_position)


func _exit_tree() -> void:
	_alive.erase(self)


func _make_joint(bot: Bot, part: Dictionary) -> void:
	var joint := Generic6DOFJoint3D.new()
	joint.name = "joint_" + part.name
	add_child(joint)
	# Оси сустава = оси родительской кости, точка = положение сустава.
	var parent_pivot: Node3D = bot.pivots[part.parent]
	var pivot: Node3D = bot.pivots[part.name]
	joint.global_transform = Transform3D(parent_pivot.global_basis.orthonormalized(), pivot.global_position)

	# Пределы из BodyDef заданы от позы покоя, а бот мог быть в середине шага:
	# сдвигаем их на текущий поворот кости. Jolt считает угол с обратным знаком.
	var cur := pivot.rotation
	var lim: Dictionary = part.joint
	_set_axis(joint, "x", lim.x, cur.x)
	_set_axis(joint, "y", lim.y, cur.y)
	_set_axis(joint, "z", lim.z, cur.z)

	joint.node_a = joint.get_path_to(bodies[part.parent])
	joint.node_b = joint.get_path_to(bodies[part.name])


func _set_axis(joint: Generic6DOFJoint3D, axis: String, range_deg: Array, current: float) -> void:
	var lo := deg_to_rad(range_deg[0]) - current
	var hi := deg_to_rad(range_deg[1]) - current
	var lower := -hi
	var upper := -lo
	match axis:
		"x":
			joint.set_param_x(Generic6DOFJoint3D.PARAM_ANGULAR_LOWER_LIMIT, lower)
			joint.set_param_x(Generic6DOFJoint3D.PARAM_ANGULAR_UPPER_LIMIT, upper)
		"y":
			joint.set_param_y(Generic6DOFJoint3D.PARAM_ANGULAR_LOWER_LIMIT, lower)
			joint.set_param_y(Generic6DOFJoint3D.PARAM_ANGULAR_UPPER_LIMIT, upper)
		"z":
			joint.set_param_z(Generic6DOFJoint3D.PARAM_ANGULAR_LOWER_LIMIT, lower)
			joint.set_param_z(Generic6DOFJoint3D.PARAM_ANGULAR_UPPER_LIMIT, upper)


func _on_body_hit(_other: Node, body: RigidBody3D) -> void:
	var speed := body.linear_velocity.length()
	if speed > 1.5:
		Sfx.play_3d("thud", body.global_position, linear_to_db(clampf(speed / 6.0, 0.1, 1.0)), 0.2)
