extends Node
## Dev test: blood streams (blood.open_jet). One bot loses a forearm, one a
## thigh, one is shot through the head; side view.
## Usage: godot --path . res://tests/jet_test.tscn --write-movie out.avi --fixed-fps 30

var t := -3.0
var _done := {}
var _view: Camera3D
var _b: Array = []


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 11.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 3 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 0.0):
		p.global_position = Vector3(20, 0.1, 30)
		Game.main.activities.spots.clear()
		for i in 3:
			var b: Node3D = Game.bots[i]
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			var at := Vector3(-6.0 + i * 1.6, 0.0, 12.0)
			var off: Vector3 = at - b.position_ground()
			for part in b.parts:
				part.global_position += off
				part.linear_velocity = Vector3.ZERO
				part.reset_physics_interpolation()
			b.facing = Vector3.BACK if OS.get_environment("CLOTH") != "" else Vector3.RIGHT
			b.posture = b.Posture.STAND
			_b.append(b)
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
	if _b.is_empty():
		return
	for b in _b:
		b.move_velocity = Vector3.ZERO
	if t < 1.0 or (OS.get_environment("CLOTH") != "" and t < 3.5):
		var c: Vector3 = _b[1].position_ground()
		_view.global_position = c + Vector3(0.0, 1.1, 2.6)
		_view.look_at(c + Vector3(0, 0.8, 0))
		if _once("where", 0.5):
			for b in _b:
				print("bot at ", b.position_ground())
	if OS.get_environment("CLOTH") != "":
		for b in _b:
			b.move_velocity = Vector3.ZERO
		if t > 1.0 and t < 1.6 and int(t * 5) != int((t - delta) * 5):
			for b in _b:
				var ch: RigidBody3D = b.chest
				b.tear(ch, ch.global_position + Vector3(randf_range(-0.08, 0.08), randf_range(-0.05, 0.1), 0.12), 0.025, Vector3.FORWARD)
				var ab: RigidBody3D = b.parts[b.part_index["thigh_l"]]
				b.tear(ab, ab.global_position + Vector3(0, 0, 0.07), 0.03, Vector3.FORWARD)
		if t > 2.0 and t < 2.05:
			_b[2].blast(_b[2].chest.global_position + Vector3(0.3, 0, 1.0), 1.0, 1.0)
		if t > 3.5 and not has_meta("shot"):
			set_meta("shot", 1)
			_view.global_position = _b[1].chest.global_position + Vector3(0, 0.1, 1.3)
			_view.look_at(_b[1].chest.global_position + Vector3(0, -0.2, 0))
		if t > 4.0 and not has_meta("shot2"):
			set_meta("shot2", 1)
			get_viewport().get_texture().get_image().save_png(OS.get_environment("OUT") + "/cloth.png")
			get_tree().quit()
		return
	if OS.get_environment("GIBS") != "":
		if t > 1.0 and t < 2.5 and int(t * 5) != int((t - delta) * 5):
			for b in _b:
				var ch: RigidBody3D = b.chest if randf() < 0.6 else b.parts[b.part_index["abdomen"]]
				b.receive_hit(ch, ch.global_position + Vector3(-0.15, randf_range(-0.05, 0.05), 0.0), Vector3.RIGHT, 3.0, "akm")
		return
	if OS.get_environment("SHOT_AT") != "" and _once("jetshot", float(OS.get_environment("SHOT_AT"))):
		get_viewport().get_texture().get_image().save_png(OS.get_environment("OUT") + "/jet_%s.png" % OS.get_environment("HOUR"))
		get_tree().quit()
	if _once("cut", 1.0):
		_b[0].sever("forearm_r", Vector3.RIGHT, 0.5)
		_b[1].sever("thigh_l", Vector3.LEFT, 0.5)
		var h: RigidBody3D = _b[2].head
		_b[2].receive_hit(h, h.global_position + Vector3(-0.1, 0.02, 0), Vector3.RIGHT, 4.0, "akm")


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
