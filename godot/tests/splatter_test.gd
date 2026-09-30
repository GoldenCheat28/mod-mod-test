extends Node
## Dev test: a man shot through the head in front of a wall; what is blown
## out onto the wall (blood.gd exit_splatter).

var t := -3.0
var _view: Camera3D
var _done := {}
var b: Node3D


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 9.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null or Game.bots.is_empty():
		return
	if b == null:
		Game.main.activities.spots.clear()
		b = Game.bots[0]
		for o in Game.bots:
			o.ai.process_mode = Node.PROCESS_MODE_DISABLED
		var at := Vector3(-3.0, 0.0, -7.2)
		var off: Vector3 = at - b.position_ground()
		for part in b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		b.facing = Vector3.BACK
		p.global_position = Vector3(3, 0.2, 5)
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
	b.move_velocity = Vector3.ZERO
	var hp: Vector3 = b.head.global_position
	_view.global_position = Vector3(hp.x + 1.3, 1.5, hp.z + 2.2)
	_view.look_at(Vector3(hp.x, 1.2, -8.1))
	if t > 1.0 and not _done.has("shot"):
		_done["shot"] = true
		b.receive_hit(b.head, hp + Vector3(0.02, 0.0, 0.09), Vector3(0.05, 0.02, -1.0).normalized(), 6.0, "pistol")
	for s in [0.9, 1.4, 3.0, 8.5]:
		if t >= s and not _done.has(s):
			_done[s] = true
			get_viewport().get_texture().get_image().save_png("user://splat_%s.png" % s)
