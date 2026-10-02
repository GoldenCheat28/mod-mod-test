extends Node3D
## Возрождает ботов на их местах и спавнит нового перед игроком по [B].

@export var bot_scene: PackedScene = preload("res://scenes/bot.tscn")
@export var respawn_delay := 4.0


func _ready() -> void:
	for child in get_children():
		if child is Bot:
			_track(child, child.transform)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("spawn_bot"):
		_spawn_in_front()


func _track(bot: Bot, xf: Transform3D) -> void:
	var radius := bot.wander_radius
	bot.died.connect(func(_b: Bot) -> void:
		get_tree().create_timer(respawn_delay).timeout.connect(func() -> void:
			var b := _spawn(xf)
			b.wander_radius = radius
			_track(b, xf)))


func _spawn(xf: Transform3D) -> Bot:
	var bot: Bot = bot_scene.instantiate()
	bot.transform = xf                    # до add_child, чтобы _ready запомнил «дом»
	add_child(bot)
	return bot


func _spawn_in_front() -> void:
	var player := get_tree().get_first_node_in_group("player") as Node3D
	if player == null:
		return
	var fwd := -player.global_basis.z
	fwd.y = 0.0
	var pos := player.global_position + fwd.normalized() * 4.0 + Vector3.UP * 3.0
	var q := PhysicsRayQueryParameters3D.create(pos, pos + Vector3.DOWN * 10.0, 1)
	var r := get_world_3d().direct_space_state.intersect_ray(q)
	if not r.is_empty():
		pos = r.position
	var xf := Transform3D(Basis(Vector3.UP, player.rotation.y + PI), pos)
	_spawn(global_transform.affine_inverse() * xf)
