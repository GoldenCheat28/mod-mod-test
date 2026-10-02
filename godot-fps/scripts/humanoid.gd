class_name Humanoid
# Процедурный человечек: тело из частей на шарнирах (анимация шага) и регдолл из RigidBody3D + ConeTwistJoint3D.
# Заменить на свою модель можно позже (Skeleton3D + PhysicalBone3D) — враг этого не заметит.

const MAX_RAGDOLLS := 8
static var _ragdolls: Array[Node3D] = []

static func _part(parent: Node3D, name: String, mesh: Mesh, pos: Vector3, mat: Material) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.name = name
	m.mesh = mesh
	m.position = pos
	m.material_override = mat
	parent.add_child(m)
	return m

static func _caps(r: float, h: float) -> CapsuleMesh:
	var c := CapsuleMesh.new()
	c.radius = r
	c.height = h
	c.radial_segments = 10
	c.rings = 4
	return c

static func _box(x: float, y: float, z: float) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = Vector3(x, y, z)
	return b

static func _pivot(parent: Node3D, name: String, pos: Vector3) -> Node3D:
	var n := Node3D.new()
	n.name = name
	n.position = pos
	parent.add_child(n)
	return n

# Строит модель под root. Возвращает rig: части, суставы и узлы для анимации.
static func build(root: Node3D) -> Dictionary:
	var shirt := Mats.get_mat("h_shirt", Color(0.30, 0.34, 0.27), 0.9, 0.0, 2.0)
	var pants := Mats.get_mat("h_pants", Color(0.16, 0.17, 0.21), 0.9, 0.0, 2.0)
	var skin := Mats.get_mat("h_skin", Color(0.72, 0.56, 0.46), 0.7, 0.0, 2.0)
	var vest := Mats.get_mat("h_vest", Color(0.12, 0.13, 0.12), 0.8, 0.0, 2.0)
	var model := Node3D.new()
	model.name = "Model"
	root.add_child(model)
	var parts: Array = []   # {node, shape}
	var joints: Array = []  # {a, b, pivot(Node3D), swing, twist}
	var pelvis := _part(model, "pelvis", _box(0.34, 0.2, 0.2), Vector3(0, 0.95, 0), pants)
	var torso := _part(model, "torso", _box(0.42, 0.52, 0.24), Vector3(0, 1.32, 0), shirt)
	_part(torso, "vest", _box(0.44, 0.34, 0.27), Vector3(0, 0.02, 0), vest)
	var neck := _pivot(model, "neck", Vector3(0, 1.6, 0))
	var head := _part(neck, "head", _sphere(0.14), Vector3(0, 0.14, 0), skin)
	var spine := _pivot(model, "spine", Vector3(0, 1.12, 0))
	parts.append({"node": pelvis, "shape": _bshape(0.34, 0.2, 0.2)})
	parts.append({"node": torso, "shape": _bshape(0.42, 0.52, 0.24)})
	parts.append({"node": head, "shape": _sshape(0.14)})
	joints.append({"a": pelvis, "b": torso, "pivot": spine, "swing": 25.0, "twist": 20.0})
	joints.append({"a": torso, "b": head, "pivot": neck, "swing": 35.0, "twist": 30.0})
	var anim := {}
	for side in [-1, 1]:
		var tag := "l" if side < 0 else "r"
		# рука
		var sh := _pivot(model, "shoulder_" + tag, Vector3(0.27 * side, 1.52, 0))
		var up_arm := _part(sh, "arm_up_" + tag, _caps(0.055, 0.3), Vector3(0, -0.15, 0), shirt)
		var el := _pivot(sh, "elbow_" + tag, Vector3(0, -0.3, 0))
		var fore := _part(el, "arm_lo_" + tag, _caps(0.05, 0.28), Vector3(0, -0.14, 0), skin)
		parts.append({"node": up_arm, "shape": _cshape(0.055, 0.3)})
		parts.append({"node": fore, "shape": _cshape(0.05, 0.28)})
		joints.append({"a": torso, "b": up_arm, "pivot": sh, "swing": 80.0, "twist": 40.0})
		joints.append({"a": up_arm, "b": fore, "pivot": el, "swing": 70.0, "twist": 10.0})
		# нога
		var hip := _pivot(model, "hip_" + tag, Vector3(0.1 * side, 0.9, 0))
		var thigh := _part(hip, "leg_up_" + tag, _caps(0.08, 0.44), Vector3(0, -0.22, 0), pants)
		var knee := _pivot(hip, "knee_" + tag, Vector3(0, -0.44, 0))
		var shin := _part(knee, "leg_lo_" + tag, _caps(0.065, 0.42), Vector3(0, -0.21, 0), pants)
		parts.append({"node": thigh, "shape": _cshape(0.08, 0.44)})
		parts.append({"node": shin, "shape": _cshape(0.065, 0.42)})
		joints.append({"a": pelvis, "b": thigh, "pivot": hip, "swing": 55.0, "twist": 25.0})
		joints.append({"a": thigh, "b": shin, "pivot": knee, "swing": 65.0, "twist": 8.0})
		anim["shoulder_" + tag] = sh
		anim["hip_" + tag] = hip
		anim["knee_" + tag] = knee
		anim["elbow_" + tag] = el
	# оружие в правой руке
	var gun := _part(anim["elbow_r"], "gun", _box(0.07, 0.1, 0.6), Vector3(0.0, -0.28, -0.2), Mats.get_mat("gun_dark", Color(0.12, 0.12, 0.14), 0.4, 0.8, 4.0))
	# поза «целится»: руки вперёд
	anim["shoulder_r"].rotation.x = -1.4
	anim["shoulder_l"].rotation.x = -1.2
	anim["shoulder_l"].rotation.z = -0.25
	anim["elbow_r"].rotation.x = -0.1
	anim["elbow_l"].rotation.x = -0.5
	return {"model": model, "parts": parts, "joints": joints, "anim": anim, "gun": gun}

static func _sphere(r: float) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = r
	s.height = r * 2.0
	s.radial_segments = 12
	s.rings = 6
	return s

static func _bshape(x: float, y: float, z: float) -> BoxShape3D:
	var b := BoxShape3D.new()
	b.size = Vector3(x, y, z)
	return b

static func _sshape(r: float) -> SphereShape3D:
	var s := SphereShape3D.new()
	s.radius = r
	return s

static func _cshape(r: float, h: float) -> CapsuleShape3D:
	var c := CapsuleShape3D.new()
	c.radius = r
	c.height = h
	return c

# Анимация шага: phase — накопленная фаза, amount 0..1 — интенсивность (скорость).
static func animate(rig: Dictionary, phase: float, amount: float) -> void:
	var a: Dictionary = rig["anim"]
	var sw := sin(phase) * 0.8 * amount
	a["hip_l"].rotation.x = sw
	a["hip_r"].rotation.x = -sw
	a["knee_l"].rotation.x = maxf(0.0, -sin(phase)) * 0.9 * amount
	a["knee_r"].rotation.x = maxf(0.0, sin(phase)) * 0.9 * amount
	a["shoulder_r"].rotation.x = -1.4 + sin(phase * 2.0) * 0.03 * amount
	var m: Node3D = rig["model"]
	m.position.y = absf(sin(phase)) * 0.04 * amount

# Превращает живую модель в регдолл. Возвращает корень регдолла (добавлен в сцену).
static func ragdoll(rig: Dictionary, scene_root: Node, velocity: Vector3, impulse: Vector3, hit_point: Vector3) -> Node3D:
	var root := Node3D.new()
	root.name = "Ragdoll"
	scene_root.add_child(root)
	var bodies: Dictionary = {}   # MeshInstance3D -> RigidBody3D
	for p in rig["parts"]:
		var mi: MeshInstance3D = p["node"]
		var rb := RigidBody3D.new()
		rb.collision_layer = 4      # слой 3: не мешает игроку и ботам
		rb.collision_mask = 1       # сталкивается с миром
		rb.mass = 6.0 if mi.name == "torso" else 3.0
		rb.linear_damp = 0.4
		rb.angular_damp = 1.5
		rb.can_sleep = true
		root.add_child(rb)
		rb.global_transform = mi.global_transform
		var vis := mi.duplicate() as MeshInstance3D
		for c in vis.get_children():     # без вложенных частей (они отдельные тела)
			if c.name != "vest" and c.name != "gun":
				c.queue_free()
		vis.transform = Transform3D.IDENTITY
		rb.add_child(vis)
		var cs := CollisionShape3D.new()
		cs.shape = p["shape"]
		rb.add_child(cs)
		rb.linear_velocity = velocity
		bodies[mi] = rb
	for j in rig["joints"]:
		var jt := ConeTwistJoint3D.new()
		root.add_child(jt)
		var pv: Node3D = j["pivot"]
		# ось закрутки — вдоль конечности (Y вниз)
		var base := Basis(Vector3(0, -1, 0), Vector3(1, 0, 0), Vector3(0, 0, 1))
		jt.global_transform = Transform3D(pv.global_transform.basis.orthonormalized() * base, pv.global_position)
		jt.node_a = jt.get_path_to(bodies[j["a"]])
		jt.node_b = jt.get_path_to(bodies[j["b"]])
		jt.set_param(ConeTwistJoint3D.PARAM_SWING_SPAN, deg_to_rad(j["swing"]))
		jt.set_param(ConeTwistJoint3D.PARAM_TWIST_SPAN, deg_to_rad(j["twist"]))
	# удар от выстрела: ближайшая к точке попадания часть получает импульс
	var best: RigidBody3D = null
	var bd := 1e9
	for rb in bodies.values():
		var d := (rb as RigidBody3D).global_position.distance_to(hit_point)
		if d < bd:
			bd = d
			best = rb
	if best:
		best.apply_impulse(impulse, hit_point - best.global_position)
	_ragdolls.append(root)
	while _ragdolls.size() > MAX_RAGDOLLS:
		var old: Node3D = _ragdolls.pop_front()
		if is_instance_valid(old):
			old.queue_free()
	return root
