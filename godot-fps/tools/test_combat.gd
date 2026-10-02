extends Node
# Отладка боя: игрок стреляет настоящим лучом по врагу (проверяет попадания по частям, кровь, регдолл).
# Запуск: godot --path . res://tools/test_combat.tscn
func _ready() -> void:
	get_window().size = Vector2i(960, 540)
	var main: Node = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await get_tree().create_timer(0.5).timeout
	var player: Node3D = get_tree().get_first_node_in_group("player")
	var enemies := get_tree().get_nodes_in_group("enemies")
	var e: Node3D = enemies[3]
	for en in enemies:
		if en != e:
			en.queue_free()
	e.set_physics_process(false)
	player.global_position = e.global_position + Vector3(0, 0, 4.5)
	player.rotation = Vector3.ZERO
	var head: Node3D = player.get_node("Head")
	head.look_at(e.global_position + Vector3(0, 1.3, 0))
	await get_tree().create_timer(0.3).timeout
	var cam: Camera3D = player.get_node("Head/Camera3D")
	for i in 12:
		if not is_instance_valid(e) or not e.alive:
			break
		var aim := e.global_position + Vector3(randf_range(-0.15, 0.15), randf_range(0.5, 1.6), 0)
		var from := cam.global_position
		var q := PhysicsRayQueryParameters3D.create(from, from + (aim - from).normalized() * 30.0, 7)
		var r := get_viewport().world_3d.direct_space_state.intersect_ray(q)
		if r.is_empty():
			print("shot ", i, ": miss")
		else:
			var c: Object = r.collider
			print("shot ", i, ": ", (c as Node).name, " hp=", e.health)
			if c is RigidBody3D and c.has_meta("humanoid"):
				c.get_meta("humanoid").receive_hit(c, r.position, (aim - from).normalized(), 25.0, "rifle")
		await get_tree().create_timer(0.35).timeout
	await get_tree().create_timer(6.0).timeout
	print("done alive=", e.alive, " splat_cells=", Game.blood._splat_grid.size(), " pools=", Game.blood._pools.size(), " drops=", Game.blood._drops.size(), " bleeders=", Game.blood._bleeders.size(), " body_runs=", Game.blood._body_runs.size(), " world_decals=", Game.blood._world.decals.size())
	get_tree().quit()
