extends Node
var t := -3.0
var _done := {}
var a: Node3D
var b: Node3D
var c: Node3D
var steps := 0
func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())
func _place(x: Node3D, at: Vector3) -> void:
	var off: Vector3 = at - x.position_ground()
	for part in x.parts:
		part.global_position += off
		part.linear_velocity = Vector3.ZERO
		part.reset_physics_interpolation()
func _physics_process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.bots.size() < 3 or Game.main.weather == null:
		return
	if not _done.has("setup"):
		_done["setup"] = true
		a = Game.bots[0]; b = Game.bots[1]; c = Game.bots[2]
		for x in [a, b]:
			x.ai.process_mode = Node.PROCESS_MODE_DISABLED
		_place(a, Vector3(0, 0, 4))
		# b: on the ground floor right under the upstairs sofa, told to sit on it.
		_place(b, Vector3(5.8, 0.15, -12.75))
		b.seat = Vector3(5.8, 3.4 + 0.5, -13.3)
		b.posture = b.Posture.SIT
		print("b start y=%.2f" % b.pelvis.global_position.y)
		# c walks across the yard.
		if c.ai.act:
			c.ai._end_activity()
		_place(c, Vector3(-10, 0, 10))
		c.ai._enter(c.ai.S.WANDER)
		c.ai._goto(Vector3(10, 0, 10))
		p.global_position = Vector3(0, 0.1, 12)
	if t > 1.0 and not _done.has("cut"):
		_done["cut"] = true
		var th: RigidBody3D = a.parts[a.part_index["thigh_r"]]
		a.shock += 0.15 + 0.06 * 3.0      # (grabbed by the saw, 3 s of sawing)
		a.bleed_rate += 30.0 + 5.0 * 3.0
		a.saw_slice(th, th.global_position, th.global_basis.y)
	if int(t) != int(t - delta) and t > 1.0:
		print("t=%d A alive=%s conscious=%s blood=%d bleed=%.0f shock=%.2f | B pelvis y=%.2f seat=%s | C steps(phase)=%.1f" % [t, a.alive, a.conscious, a.blood, a.bleed_rate, a.shock,
				b.pelvis.global_position.y, b.seat, c._phase / PI])
	if t > 40.0:
		get_tree().quit()
