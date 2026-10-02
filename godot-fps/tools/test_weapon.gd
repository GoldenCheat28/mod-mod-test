extends Node
# Отладка оружия: серия выстрелов и перезарядка (кадры пишутся в --write-movie).
func _ready() -> void:
	get_window().size = Vector2i(960, 540)
	var main: Node = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await get_tree().create_timer(0.4).timeout
	var player: Node3D = get_tree().get_first_node_in_group("player")
	for e in get_tree().get_nodes_in_group("enemies"):
		e.queue_free()
	player.global_position = Vector3(0, 0.1, 16)
	player.rotation = Vector3.ZERO
	player.set_physics_process(false)
	var w = player.get_node("Head/Camera3D/Weapon")
	await get_tree().create_timer(0.3).timeout
	for i in 3:
		w._shoot()
		await get_tree().create_timer(0.1).timeout
	await get_tree().create_timer(0.6).timeout
	w._reload()
	await get_tree().create_timer(2.6).timeout
	get_tree().quit()
