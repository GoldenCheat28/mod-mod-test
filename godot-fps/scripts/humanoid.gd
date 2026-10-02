class_name Humanoid
# Человечек из частей-RigidBody3D (заморожены, пока жив) на шарнирах: анимация шага, попадания по частям,
# кровь на теле (шейдеры одежды/кожи + объём крови), при смерти — регдолл из тех же частей.
# Интерфейс для scripts/fx/blood.gd: у части мета "part", "humanoid", "rest_pos".

const MAX_RAGDOLLS := 8
static var _ragdolls: Array = []   # [{bot, root}]

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

static func _cshape(r: float, h: float) -> CapsuleShape3D:
	var c := CapsuleShape3D.new()
	c.radius = r
	c.height = h
	return c

static func _pivot(parent: Node3D, name: String, pos: Vector3) -> Node3D:
	var n := Node3D.new()
	n.name = name
	n.position = pos
	parent.add_child(n)
	return n

static func _cloth(col: Color) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/cloth.gdshader")
	m.set_shader_parameter("albedo", col)
	m.set_shader_parameter("rough", 0.9)
	return m

static func _skin(col: Color) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/skin_blood.gdshader")
	m.set_shader_parameter("albedo", col)
	return m

# Кусок тела: замороженный RigidBody3D (пули попадают в него), внутри коллизия и меш.
static func _part(parent: Node3D, bot: Node3D, pname: String, mesh: Mesh, shape: Shape3D, pos: Vector3, mat: Material, mass: float) -> RigidBody3D:
	var rb := RigidBody3D.new()
	rb.name = pname
	rb.freeze = true
	rb.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
	rb.collision_layer = Game.LAYER_BOTS
	rb.collision_mask = 0
	rb.mass = mass
	rb.linear_damp = 0.4
	rb.angular_damp = 1.5
	rb.position = pos
	parent.add_child(rb)
	var cs := CollisionShape3D.new()
	cs.shape = shape
	rb.add_child(cs)
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	mi.mesh = mesh
	mi.material_override = mat
	rb.add_child(mi)
	rb.set_meta("part", pname)
	rb.set_meta("humanoid", bot)
	rb.set_meta("rest_pos", bot.to_local(rb.global_position))   # поза покоя (до позы «целится»)
	_rest_uniforms(mi, rb.get_meta("rest_pos"))
	return rb

static func _rest_uniforms(mi: MeshInstance3D, rest: Vector3) -> void:
	mi.set_instance_shader_parameter("rest_x", Vector4(1, 0, 0, rest.x))
	mi.set_instance_shader_parameter("rest_y", Vector4(0, 1, 0, rest.y))
	mi.set_instance_shader_parameter("rest_z", Vector4(0, 0, 1, rest.z))

# Строит модель под bot (его позиция/поворот на момент вызова — нулевой поворот).
static func build(bot: Node3D) -> Dictionary:
	var shirt := _cloth(Color(0.30, 0.34, 0.27))
	var pants := _cloth(Color(0.16, 0.17, 0.21))
	var vest := _cloth(Color(0.12, 0.13, 0.12))
	var skin := _skin(Color(0.72, 0.56, 0.46))
	var model := Node3D.new()
	model.name = "Model"
	bot.add_child(model)
	var parts: Array[RigidBody3D] = []
	var joints: Array = []   # {a, b, pivot, swing, twist}
	var pelvis := _part(model, bot, "pelvis", _box(0.34, 0.2, 0.2), _bshape(0.34, 0.2, 0.2), Vector3(0, 0.95, 0), pants, 4.0)
	var torso := _part(model, bot, "torso", _box(0.42, 0.52, 0.24), _bshape(0.42, 0.52, 0.24), Vector3(0, 1.32, 0), shirt, 8.0)
	var vest_mi := MeshInstance3D.new()
	vest_mi.name = "Vest"
	vest_mi.mesh = _box(0.44, 0.34, 0.27)
	vest_mi.material_override = vest
	vest_mi.position = Vector3(0, 0.02, 0)
	torso.add_child(vest_mi)
	_rest_uniforms(vest_mi, (torso.get_meta("rest_pos") as Vector3) + vest_mi.position)
	var neck := _pivot(model, "neck", Vector3(0, 1.6, 0))
	var head := _part(neck, bot, "head", _sphere(0.14), _cshape(0.13, 0.3), Vector3(0, 0.14, 0), skin, 4.0)
	var spine := _pivot(model, "spine", Vector3(0, 1.12, 0))
	parts.append_array([pelvis, torso, head])
	joints.append({"a": pelvis, "b": torso, "pivot": spine, "swing": 25.0, "twist": 20.0})
	joints.append({"a": torso, "b": head, "pivot": neck, "swing": 35.0, "twist": 30.0})
	var anim := {}
	var forearm_r: RigidBody3D
	for side in [-1, 1]:
		var tag := "l" if side < 0 else "r"
		var sh := _pivot(model, "shoulder_" + tag, Vector3(0.27 * side, 1.52, 0))
		var up_arm := _part(sh, bot, "arm_up_" + tag, _caps(0.055, 0.3), _cshape(0.055, 0.3), Vector3(0, -0.15, 0), shirt, 2.5)
		var el := _pivot(sh, "elbow_" + tag, Vector3(0, -0.3, 0))
		var fore := _part(el, bot, "arm_lo_" + tag, _caps(0.05, 0.28), _cshape(0.05, 0.28), Vector3(0, -0.14, 0), skin, 2.0)
		parts.append_array([up_arm, fore])
		joints.append({"a": torso, "b": up_arm, "pivot": sh, "swing": 80.0, "twist": 40.0})
		joints.append({"a": up_arm, "b": fore, "pivot": el, "swing": 70.0, "twist": 10.0})
		var hip := _pivot(model, "hip_" + tag, Vector3(0.1 * side, 0.9, 0))
		var thigh := _part(hip, bot, "leg_up_" + tag, _caps(0.08, 0.44), _cshape(0.08, 0.44), Vector3(0, -0.22, 0), pants, 5.0)
		var knee := _pivot(hip, "knee_" + tag, Vector3(0, -0.44, 0))
		var shin := _part(knee, bot, "leg_lo_" + tag, _caps(0.065, 0.42), _cshape(0.065, 0.42), Vector3(0, -0.21, 0), pants, 3.0)
		parts.append_array([thigh, shin])
		joints.append({"a": pelvis, "b": thigh, "pivot": hip, "swing": 55.0, "twist": 25.0})
		joints.append({"a": thigh, "b": shin, "pivot": knee, "swing": 65.0, "twist": 8.0})
		anim["shoulder_" + tag] = sh
		anim["hip_" + tag] = hip
		anim["knee_" + tag] = knee
		anim["elbow_" + tag] = el
		if tag == "r":
			forearm_r = fore
	# оружие — на предплечье (падает вместе с рукой)
	var gun := MeshInstance3D.new()
	gun.name = "Gun"
	gun.mesh = _box(0.07, 0.1, 0.6)
	gun.position = Vector3(0.0, -0.14, -0.2)
	gun.material_override = Mats.get_mat("gun_dark", Color(0.12, 0.12, 0.14), 0.4, 0.8, 4.0)
	forearm_r.add_child(gun)
	# поза «целится»
	anim["shoulder_r"].rotation.x = -1.4
	anim["shoulder_l"].rotation.x = -1.2
	anim["shoulder_l"].rotation.z = -0.25
	anim["elbow_r"].rotation.x = -0.1
	anim["elbow_l"].rotation.x = -0.5
	var rids: Array[RID] = []
	for p in parts:
		rids.append(p.get_rid())
	var mats: Array = [shirt, pants, vest, skin]
	return {"model": model, "parts": parts, "joints": joints, "anim": anim, "head": head, "rids": rids, "materials": mats}

# Анимация шага: phase — накопленная фаза, amount 0..1 — скорость.
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

# Превращает живое тело в регдолл: части размораживаются и соединяются суставами.
static func ragdoll(bot: Node3D, rig: Dictionary, scene_root: Node, velocity: Vector3, impulse: Vector3, hit_point: Vector3) -> void:
	var root := Node3D.new()
	root.name = "Ragdoll"
	scene_root.add_child(root)
	# позиции суставов — пока части ещё в позе
	var jdata: Array = []
	for j in rig["joints"]:
		var pv: Node3D = j["pivot"]
		jdata.append([j, pv.global_transform.basis.orthonormalized(), pv.global_position])
	for p in rig["parts"]:
		var rb: RigidBody3D = p
		rb.reparent(root, true)
		rb.freeze = false
		rb.collision_layer = Game.LAYER_BOTS
		rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS
		rb.can_sleep = true
		rb.linear_velocity = velocity
	for jd in jdata:
		var j: Dictionary = jd[0]
		var jt := ConeTwistJoint3D.new()
		root.add_child(jt)
		var base := Basis(Vector3(0, -1, 0), Vector3(1, 0, 0), Vector3(0, 0, 1))   # ось закрутки — вдоль конечности
		jt.global_transform = Transform3D((jd[1] as Basis) * base, jd[2])
		jt.node_a = jt.get_path_to(j["a"])
		jt.node_b = jt.get_path_to(j["b"])
		jt.set_param(ConeTwistJoint3D.PARAM_SWING_SPAN, deg_to_rad(j["swing"]))
		jt.set_param(ConeTwistJoint3D.PARAM_TWIST_SPAN, deg_to_rad(j["twist"]))
	var best: RigidBody3D = null
	var bd := 1e9
	for p in rig["parts"]:
		var d := (p as RigidBody3D).global_position.distance_to(hit_point)
		if d < bd:
			bd = d
			best = p
	if best:
		best.apply_impulse(impulse, hit_point - best.global_position)
	_ragdolls.append({"bot": bot, "root": root})
	while _ragdolls.size() > MAX_RAGDOLLS:
		var old: Dictionary = _ragdolls.pop_front()
		if Game.blood and is_instance_valid(old["bot"]):
			Game.blood.forget(old["bot"])
		Game.bots.erase(old["bot"])
		if is_instance_valid(old["root"]):
			old["root"].queue_free()
		if is_instance_valid(old["bot"]):
			old["bot"].queue_free()
