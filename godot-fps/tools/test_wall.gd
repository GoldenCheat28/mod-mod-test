extends Node
# Отладка крови на стене: разные скорости/углы удара и возраст пятен.
func _ready() -> void:
	var main: Node = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await get_tree().create_timer(0.3).timeout
	var player: Node3D = get_tree().get_first_node_in_group("player")
	for e in get_tree().get_nodes_in_group("enemies"):
		e.queue_free()
	player.global_position = Vector3(0, 0.1, -25.5)
	player.rotation = Vector3.ZERO
	var head: Node3D = player.get_node("Head")
	head.rotation.x = 0.0
	player.set_physics_process(false)
	player.set_process(false)
	var b := Blood.instance
	var z := -29.99
	var n := Vector3(0, 0, 1)
	b._spot(Vector3(-4.5, 1.8, z), n, Vector3(0, 0, -3), 0.09)        # медленная капля в упор
	b._spot(Vector3(-2.2, 1.8, z), n, Vector3(0, 0, -14), 0.10)       # быстрое попадание в упор
	b._spot(Vector3(0.0, 1.8, z), n, Vector3(5, 0, -2), 0.10)         # под углом (скользящий)
	b._spot(Vector3(2.2, 1.8, z), n, Vector3(0, -6, -3), 0.10)        # вниз под углом
	b._spot(Vector3(4.5, 1.8, z), n, Vector3(2, 0, -14), 0.2)         # выходное отверстие (крупное, быстрое)
	await get_tree().create_timer(0.2).timeout
	b.time_offset = 3.0
	await get_tree().create_timer(0.2).timeout
	b.time_offset = 15.0
	await get_tree().create_timer(0.2).timeout
	b.time_offset = 70.0
	await get_tree().create_timer(0.2).timeout
	b.time_offset = 400.0
	await get_tree().create_timer(0.3).timeout
	get_tree().quit()
