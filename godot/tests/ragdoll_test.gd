extends Node3D
## Dev test: joint sign conventions and standing stability (run headless).

const Humanoid = preload("res://scripts/bots/humanoid.gd")

var a: Node3D
var b: Node3D
var t := 0.0


func _ready() -> void:
	var sb := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(60, 1, 60)
	cs.shape = box
	sb.add_child(cs)
	sb.position.y = -0.5
	add_child(sb)
	Game.player = null
	# a: joint test (brain off); b: normal standing bot.
	a = Humanoid.new()
	a.bot_seed = 1
	add_child(a)
	a.spawn(Vector3(0, 0.01, 0), 0.0)
	a.get_node("AI").process_mode = Node.PROCESS_MODE_DISABLED
	a.set_physics_process(false)
	b = Humanoid.new()
	b.bot_seed = 2
	add_child(b)
	b.spawn(Vector3(5, 0.01, 0), 0.0)
	b.get_node("AI").process_mode = Node.PROCESS_MODE_DISABLED


func _rel(bot: Node3D, child: String) -> Vector3:
	var c: RigidBody3D = bot.parts[bot.part_index[child]]
	var p: RigidBody3D = bot.parts[bot._parent[bot.part_index[child]]]
	return (p.global_basis.orthonormalized().inverse() * c.global_basis.orthonormalized()).get_euler()


func _physics_process(delta: float) -> void:
	t += delta
	# Test targets on bot a.
	for i in a._target.size():
		a._target[i] = Vector3.ZERO
	a._target[a.part_index["shin_r"]] = Vector3(-1.4, 0, 0)
	a._target[a.part_index["thigh_r"]] = Vector3(1.0, 0, 0)
	a._target[a.part_index["thigh_l"]] = Vector3(0.0, 0, -0.6)
	a._target[a.part_index["forearm_r"]] = Vector3(1.5, 0, 0)
	a._target[a.part_index["upper_arm_r"]] = Vector3(0, 0, 1.2)
	a._target[a.part_index["head"]] = Vector3(0.4, 0.6, 0)
	a._apply_muscles()
	if is_equal_approx(fmod(t, 1.0), 0.0) or fmod(t, 1.0) < delta:
		print("t=%.1f  A knee_r=%s hip_r=%s hip_l=%s elbow_r=%s shoulder_r=%s neck=%s" % [t,
			_rel(a, "shin_r"), _rel(a, "thigh_r"), _rel(a, "thigh_l"), _rel(a, "forearm_r"), _rel(a, "upper_arm_r"), _rel(a, "head")])
		print("      B pelvis_y=%.3f fallen=%s support=%.2f up=%.2f maxw=%s" % [b.pelvis.global_position.y, b.fallen, b.support,
			b.pelvis.global_basis.y.y, _maxw(b)])
	if t > 6.0 and t < 6.0 + delta * 1.5:
		b.move_velocity = Vector3(0, 0, -1.3)
		b.facing = Vector3(0, 0, -1)
		print("-- B starts walking")
	if t > 12.0 and t < 12.0 + delta * 1.5:
		b.move_velocity = Vector3(3.8, 0, 0)
		b.facing = Vector3(1, 0, 0)
		print("-- B runs +X")
	if t > 16.0 and t < 16.0 + delta * 1.5:
		b.move_velocity = Vector3.ZERO
		b.posture = 1
		print("-- B crouch")
	if t > 19.0 and t < 19.0 + delta * 1.5:
		b.posture = 2
		print("-- B hands up")
	if t > 21.0 and t < 21.0 + delta * 1.5:
		b.posture = 0
		b.receive_hit(b.head, b.head.global_position + Vector3(0, 0.05, 0), Vector3(1, 0, 0), 20.0, "pistol")
		print("-- B headshot")
	if t > 26.0:
		get_tree().quit()


func _maxw(bot: Node3D) -> String:
	var m := 0.0
	var n := ""
	for p in bot.parts:
		if p.angular_velocity.length() > m:
			m = p.angular_velocity.length()
			n = p.name
	return "%.1f(%s)" % [m, n]
