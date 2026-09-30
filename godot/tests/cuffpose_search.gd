extends Node
## Dev tool: searches arm angles (upper arm x/y/z, forearm x) that put both
## hands together behind the lower back, using the bot's own FK.
var t := 0.0
func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())
func _physics_process(delta: float) -> void:
	t += delta
	if t < 2.0 or Game.bots.is_empty():
		return
	var b = Game.bots[0]
	var n: int = b.parts.size()
	var base := []
	for i in n:
		base.append(Vector3.ZERO)
	var ih: int = b.part_index["hand_r"]
	var il: int = b.part_index["hand_l"]
	var best := INF
	var best_v := []
	var root := Transform3D.IDENTITY
	var pel: Vector3 = b._fk(root, base)[0].origin
	var goal_r := pel + Vector3(0.0, 0.02, 0.2)      # behind (+z is back)
	for ux in range(-10, 3):
		for uy in range(-12, 13):
			for uz in range(-6, 7):
				for fx in range(0, 13):
					var ang := base.duplicate()
					var u := Vector3(ux * 0.1, uy * 0.1, uz * 0.1)
					var f := Vector3(fx * 0.2, 0, 0)
					ang[b.part_index["upper_arm_r"]] = u
					ang[b.part_index["forearm_r"]] = f
					ang[b.part_index["upper_arm_l"]] = Vector3(u.x, -u.y, -u.z)
					ang[b.part_index["forearm_l"]] = f
					var x: Array = b._fk(root, ang)
					var hr: Vector3 = x[ih].origin
					var hl: Vector3 = x[il].origin
					var cost := absf(hr.distance_to(hl) - 0.07) * 3.0 + absf(hr.z - goal_r.z) + absf(hr.y - goal_r.y) + maxf(0.0, 0.05 - hr.x) * 0.0
					if cost < best:
						best = cost
						best_v = [u, f, hr, hl, hr.distance_to(hl)]
	print("BEST ", best, " ", best_v)
	get_tree().quit()
