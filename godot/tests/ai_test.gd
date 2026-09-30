extends Node
## Dev test: runs the main scene headless, logs bot behaviour, fires shots.

var t := 0.0
var next_log := 2.0
var shots := [12.0, 13.0, 20.0, 20.8, 21.6]
const NAMES := ["WANDER", "IDLE", "NERVOUS", "SURRENDER", "FLEE", "HIDE", "DOWNED", "DEAD"]


func _ready() -> void:
	var main: Node = load("res://scenes/main.tscn").instantiate()
	add_child(main)


func _physics_process(delta: float) -> void:
	t += delta
	if t > next_log and Game.bots.size() > 0:
		next_log += 3.0
		var s := "t=%.0f " % t
		for b in Game.bots:
			var ai = b.ai
			s += "| %s %s f%.2f %s " % [b.name, NAMES[ai.state], ai.fear, "fallen" if b.fallen else "%.1fm/s" % Vector2(b.pelvis.linear_velocity.x, b.pelvis.linear_velocity.z).length()]
		print(s)
	if shots.size() > 0 and t > shots[0] and Game.player:
		shots.pop_front()
		# Aim at the nearest living bot's chest and fire.
		var p = Game.player
		var best = null
		for b in Game.bots:
			if b.alive and (best == null or b.chest.global_position.distance_to(p.cam.global_position) < best.chest.global_position.distance_to(p.cam.global_position)):
				best = b
		if best:
			var target: Vector3 = best.chest.global_position if shots.size() > 2 else best.head.global_position
			p.cam.look_at(target)
			p.current._cooldown = 0.0
			p.current.try_fire(p.cam, [p.get_rid()] as Array[RID])
			print("SHOT at ", best.name, " alive_after=", best.alive, " bleed=", best.bleed_rate)
	if t > 32.0:
		get_tree().quit()
