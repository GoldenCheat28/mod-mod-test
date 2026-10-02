extends Node
# Отладка ИИ без рендера: печатает состояния ботов и здоровье игрока.
func _ready() -> void:
	var main: Node = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	var player: Node3D = get_tree().get_first_node_in_group("player")
	for t in 8:
		await get_tree().create_timer(3.0).timeout
		var s := ""
		for e in get_tree().get_nodes_in_group("enemies"):
			s += "%s:%d " % ["PCSD"[e.state], int(e.global_position.distance_to(player.global_position))]
		print("t=%d hp=%d  %s" % [(t + 1) * 3, player.hp, s])
	get_tree().quit()
