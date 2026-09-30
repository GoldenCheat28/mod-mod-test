extends Node
## Dev test: a grenade going off among bots at 1, 2, 3.5 and 6 m; prints who
## lives and what was torn off.
## Usage: godot --headless --path . res://tests/nade_dmg_test.tscn

const Explosion = preload("res://scripts/weapons/explosion.gd")
var t := 0.0
var _placed := false
var _boom := false


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.bots.size() < 4:
		return
	var ds := [1.0, 2.0, 3.5, 6.0]
	if not _placed:
		_placed = true
		p.global_position = Vector3(0, 0.1, 30)
		for i in 4:
			var b = Game.bots[i]
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			b.move_velocity = Vector3.ZERO
			var off: Vector3 = Vector3(ds[i] * cos(i * 1.6), 0.0, 4.0 + ds[i] * sin(i * 1.6)) - b.position_ground()
			for part in b.parts:
				part.global_position += off
				part.linear_velocity = Vector3.ZERO
				part.reset_physics_interpolation()
	if t > 2.0 and not _boom:
		_boom = true
		Explosion.explode(get_tree(), Vector3(0, 0.05, 4.0), 1.0)
	if t > 4.0:
		for i in 4:
			var b = Game.bots[i]
			var sev := []
			for part in b.parts:
				if part.has_meta("severed"):
					sev.append(part.get_meta("part"))
			print("RESULT d=%.1f alive=%s fallen=%s bleed=%.0f severed=%s" % [ds[i], b.alive, b.fallen, b.bleed_rate, sev])
		get_tree().quit()
