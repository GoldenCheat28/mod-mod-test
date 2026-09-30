extends Node
## Dev test: a bot sprayed with paint swears for 3 s, then comes at the
## player with his fists. Prints his state and the player's pain over time.
## Usage: godot --headless --path . res://tests/brawl_test.tscn

var t := 0.0
var _b: Node3D
var _last := -1


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.bots.size() < 2:
		return
	if _b == null:
		_b = Game.bots[0]
		p.global_position = Vector3(0, 0.1, 3)
		p.yaw = 0.0
		var off: Vector3 = Vector3(0, 0, 0.5) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
	if t > 3.0 and t < 3.05:
		_b.ai.sprayed()
	if int(t * 2.0) != _last:
		_last = int(t * 2.0)
		if t > 2.5:
			print("RESULT t=%.1f state=%s dist=%.2f pain=%.2f daze=%.2f ragdoll=%s" % [t, _b.ai.S.keys()[_b.ai.state],
					_b.position_ground().distance_to(p.global_position), p.vitals.pain, p._daze, p._ragdoll != null])
	if t > 3.0 and t < 12.0 and p.velocity.length() < 0.01:
		p.velocity = Vector3.ZERO
	if t > 12.0:
		get_tree().quit()
