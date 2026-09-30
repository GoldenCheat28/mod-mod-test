extends Node
## Dev test: a bot walks in through the front door (door.gd) - does he push
## it open by the handle? Video from inside.
## Usage: godot --path . res://tests/door_test.tscn --write-movie out.avi --fixed-fps 30
var t := -3.0
var _b: Node3D
var _view: Camera3D
func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())
func _physics_process(delta: float) -> void:
	t += delta
	if t > 12.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.is_empty() or Game.main.weather == null:
		return
	if _b == null and t > 0.5:
		_b = Game.bots[0]
		var off: Vector3 = Vector3(-6.0, 0.15, -6.2) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		p.global_position = Vector3(20, 0.1, 30)
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
		_view.global_position = Vector3(-4.2, 1.7, -12.0)
		_view.look_at(Vector3(-6.0, 1.0, -8.2))
	if _b and t > 1.0 and t < 1.1:
		_b.ai._enter(_b.ai.S.WANDER)
		_b.ai._goto(Vector3(-6.0, 0.15, -12.0))
		_b.ai._speed = 1.3
	if _b and int(t * 4) != int((t - delta) * 4):
		for d in get_tree().root.find_children("*", "RigidBody3D", true, false):
			if d.has_method("center_local") and d.global_position.distance_to(Vector3(-6.7, 0.2, -8.15)) < 1.0:
				print("t=%.2f w=%.2f creak=%s vol=%.1f" % [t, absf(d.angular_velocity.y), d._creak.playing, d._creak.volume_db])
	if t > 6.0 and not has_meta("boom"):
		set_meta("boom", 1)
		var none: Array[RID] = []
		load("res://scripts/weapons/explosion.gd").explode(get_tree(), Vector3(-3.0, 0.2, -5.0), 1.0, 1.0, none)
