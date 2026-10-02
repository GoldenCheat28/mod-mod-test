extends Node
# Отладка крови на полу: тонкая струя падает в одну точку (как в pool_test из системы крови).
func _ready() -> void:
	get_window().size = Vector2i(960, 540)
	var main: Node = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await get_tree().create_timer(0.4).timeout
	var player: Node3D = get_tree().get_first_node_in_group("player")
	for e in get_tree().get_nodes_in_group("enemies"):
		e.queue_free()
	player.global_position = Vector3(30, 0.1, 25)
	var at := Vector3(0, 0, 10)
	var cam := Camera3D.new()
	add_child(cam)
	cam.make_current()
	cam.global_position = at + Vector3(0.1, 1.0, 1.2)
	cam.look_at(at)
	var t := 0.0
	while t < 4.0:
		Game.blood.spawn_drop(at + Vector3(randf_range(-0.01, 0.01), 0.6, randf_range(-0.01, 0.01)), Vector3(0, -0.5, 0), 25.0 * 0.033, [] as Array[RID], 0.0, true)
		await get_tree().create_timer(0.033).timeout
		t += 0.033
	await get_tree().create_timer(1.0).timeout
	print("cells=", Game.blood._splat_grid.size(), " pools=", Game.blood._pools.size())
	get_tree().quit()
