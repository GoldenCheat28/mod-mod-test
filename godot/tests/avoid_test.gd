extends Node
## Dev test: two people walking straight at each other (and then one at a
## man standing still): how close they come, whether anyone falls.
## AVOID_OFF=1 for the old behaviour.
var t := 0.0
var a: Node3D
var b: Node3D
var c: Node3D
var _min_ab := 99.0
var _min_ac := 99.0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(_delta: float) -> void:
	if a == null:
		return
	var ab: float = Vector2(a.pelvis.global_position.x - b.pelvis.global_position.x, a.pelvis.global_position.z - b.pelvis.global_position.z).length()
	_min_ab = minf(_min_ab, ab)
	var cc: float = Vector2(c.pelvis.global_position.x - b.pelvis.global_position.x, c.pelvis.global_position.z - b.pelvis.global_position.z).length()
	if t > 9.0:
		_min_ac = minf(_min_ac, cc)
	# Walk on: a east to west, b west to east (then b on at c, standing).
	var goal_a := Vector3(-8, 0, 4)
	var goal_b := Vector3(8, 0, 4) if t < 9.0 else Vector3(-8, 0, 4.0)
	for pair in [[a, goal_a], [b, goal_b]]:
		var w: Node3D = pair[0]
		var g: Vector3 = pair[1]
		var to := Vector3(g.x - w.position_ground().x, 0, g.z - w.position_ground().z)
		w.move_velocity = to.normalized() * 1.3 if to.length() > 0.5 else Vector3.ZERO
		if to.length() > 0.5:
			w.facing = to.normalized()


func _process(delta: float) -> void:
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if a == null:
		Game.player.global_position = Vector3(0, 0.3, -10)
		var bots: Array = Game.bots.filter(func(x): return x.ai != null and not x.has_meta("judge") and not x.has_meta("guard") and not x.has_meta("bartender") and not x.has_meta("foreman"))
		a = bots[0]
		b = bots[1]
		c = bots[2]
		for pair in [[a, Vector3(6, 0, 4)], [b, Vector3(-6, 0, 4)], [c, Vector3(-1, 0, 4)]]:
			var w: Node3D = pair[0]
			w.ai.process_mode = Node.PROCESS_MODE_DISABLED
			var off: Vector3 = (pair[1] as Vector3) - w.position_ground()
			for part in w.parts:
				part.global_position += off
				part.linear_velocity = Vector3.ZERO
				part.reset_physics_interpolation()
			w.move_velocity = Vector3.ZERO
		c.global_position = c.global_position
		t = 0.0
		# (c out of the way for the first pass)
		var offc: Vector3 = Vector3(-1, 0, 9) - c.position_ground()
		for part in c.parts:
			part.global_position += offc
		return
	if t > 8.5 and t < 8.6:
		var offc: Vector3 = Vector3(1, 0, 4) - c.position_ground()
		for part in c.parts:
			part.global_position += offc
			part.linear_velocity = Vector3.ZERO
	if t > 18.0:
		print("head-on: closest %.2f m, fallen a=%s b=%s; past a standing man: closest %.2f m, fallen b=%s c=%s"
				% [_min_ab, a.fallen, b.fallen, _min_ac, b.fallen, c.fallen])
		get_tree().quit()
