extends Node
## Dev test: blood let out from just inside the game table's top (a wound
## pressed against it): it must end up on the table, not on the floor below.
var t := 0.0
var _done := false


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	var c: Vector3 = Game.main.map.event_hall["center"]
	var top := c.y + 0.775
	if t > 1.0 and not _done:
		_done = true
		for i in 60:
			var p := Vector3(c.x + randf_range(-0.3, 0.3), top - randf_range(0.005, 0.03), c.z + randf_range(-0.3, 0.3))
			Game.blood.spawn_drop(p, Vector3(randf_range(-0.5, 0.5), randf_range(-2.0, -0.5), randf_range(-0.5, 0.5)), 0.4)
	if t > 4.0:
		var on_table: int = Game.blood.spots_in(Vector3(c.x - 0.8, top - 0.06, c.z - 0.8), Vector3(c.x + 0.8, top + 0.06, c.z + 0.8)).size()
		var on_floor: int = Game.blood.spots_in(Vector3(c.x - 1.5, c.y - 0.1, c.z - 1.5), Vector3(c.x + 1.5, c.y + 0.1, c.z + 1.5)).size()
		print("blood cells on the table top: %d, on the floor under it: %d" % [on_table, on_floor])
		get_tree().quit()
