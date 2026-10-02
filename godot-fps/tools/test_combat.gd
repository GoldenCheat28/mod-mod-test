extends Node
# Отладочная сцена: ставит игрока перед врагом и стреляет. Запуск: godot --path . res://tools/test_combat.tscn
func _ready() -> void:
	var main: Node = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await get_tree().create_timer(0.5).timeout
	var player: Node3D = get_tree().get_first_node_in_group("player")
	var enemies := get_tree().get_nodes_in_group("enemies")
	var e: Node3D = enemies[3]
	player.global_position = e.global_position + Vector3(0, 0, 7)
	player.look_at(e.global_position + Vector3(0, 1.3, 0))
	player.rotation.x = 0
	for en in enemies:
		if en != e:
			en.queue_free()
	e.set_physics_process(false)
	await get_tree().create_timer(0.3).timeout
	var cam: Camera3D = player.get_node("Head/Camera3D")
	var head: Node3D = player.get_node("Head")
	head.look_at(e.global_position + Vector3(0, 1.3, 0))
	for i in 7:
		e.take_damage(25.0, e.global_position + Vector3(0, 1.3, 0), Vector3(0, 0, 1), Vector3(0, 0, -1))
		await get_tree().create_timer(0.12).timeout
	await get_tree().create_timer(2.5).timeout
	get_tree().quit()
