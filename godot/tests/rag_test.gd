extends Node
## (HEAD=1: just a shot to the head at 1.5 s.)
## Dev test for the ragdoll's reactions: shot in the right arm, then the
## belly (he bends over it), shoved hard from behind (he should catch the
## fall on his hands), then left on the ground hurt (curling, rolling,
## reaching). A side view and a log.
## Usage: godot --path . res://tests/rag_test.tscn --write-movie out.avi --fixed-fps 30

var t := -3.0
var _done := {}
var _b: Node3D
var _view: Camera3D


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 16.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 0.0):
		_b = Game.bots[0]
		_b.ai.process_mode = Node.PROCESS_MODE_DISABLED
		_b.move_velocity = Vector3.ZERO
		_b.facing = Vector3.RIGHT
		var off: Vector3 = Vector3(0, 0, 5) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		p.global_position = Vector3(6, 0.1, 9)
		_view = Camera3D.new()
		_view.fov = 55.0
		add_child(_view)
		_view.make_current()
	if _b == null:
		return
	_b.move_velocity = Vector3.ZERO
	var c: Vector3 = _b.pelvis.global_position
	_view.global_position = _view.global_position.lerp(Vector3(c.x + 0.2, 1.25, c.z - 3.2), 0.1 if t > 0.1 else 1.0)
	_view.look_at(Vector3(c.x + 0.2, 0.75, c.z))
	# Shots come from in front of him (+x), level.
	if OS.get_environment("HEAD") == "1":
		if _once("head", 1.5):
			_shoot("head")
		if int(t * 10) != int((t - delta) * 10) and t > 1.4 and t < 4.0:
			var fa: RigidBody3D = _b.parts[_b.part_index["forearm_r"]]
			print("t=%.1f tone=%.2f forearm_r_up=%.2f pelvis_y=%.2f" % [t, _b.tone, fa.global_basis.y.y, _b.pelvis.global_position.y])
		return
	if _once("arm", 1.5):
		_shoot("upper_arm_r")
	if _once("belly", 4.0):
		_shoot("abdomen")
	if _once("shove", 7.5):
		# A hard shove in the back: forwards and down he goes.
		_b.chest.apply_central_impulse(Vector3.RIGHT * 140.0)
		_b.pelvis.apply_central_impulse(Vector3.RIGHT * 60.0)
		_b.knock_muscle("chest", 0.6)
		_b._stumble = 1.0
		_b._stumble_dir = Vector3.RIGHT
		_b._stagger = 1.0
	if int(t * 4) != int((t - delta) * 4) and t > 1.0:
		var hw := ""
		for i in [_b.part_index["upper_arm_r"], _b.part_index["abdomen"], _b.part_index["chest"]]:
			hw += "%.2f " % _b._hit_weak[i]
		print("t=%.2f fallen=%s ft=%.2f tone=%.2f pain=%.2f clutch=%s hitweak=%s pelvis=%s" % [t, _b.fallen, _b._fallen_time,
				_b.tone, _b.pain, _b.clutch_part, hw, _b.pelvis.global_position])


func _shoot(part: String) -> void:
	var body: RigidBody3D = _b.parts[_b.part_index[part]]
	# SIDE=1: from his side (the camera's side) instead of from in front.
	var dir := Vector3.BACK if OS.get_environment("SIDE") == "1" else Vector3.LEFT
	var at: Vector3 = body.global_position - dir * 0.05
	_b.receive_hit(body, at, dir, 6.0, "pistol")
	Game.play_3d(load("res://scripts/audio/sfx.gd").get_stream(&"pistol_shot"), at + Vector3.RIGHT * 3.0, -4.0, 0.0, 1.0)


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
