extends Node
## Dev test: a pool of blood forming on the asphalt (a thin stream falling
## onto one spot, then a second one beside it), seen close up.
## Usage: godot --path . res://tests/pool_test.tscn --write-movie out.avi --fixed-fps 30

var t := -3.0
var _done := {}
var _view: Camera3D
var at := Vector3(-4.0, 0.0, 14.0)


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _once(k: String, when: float) -> bool:
	if t < when or _done.has(k):
		return false
	_done[k] = true
	return true


func _physics_process(delta: float) -> void:
	t += delta
	if t > float(OS.get_environment("LEN") if OS.get_environment("LEN") != "" else "40"):
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main.weather == null or Game.blood == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 0.0):
		p.global_position = Vector3(20, 0.1, 30)
		for b in Game.bots:
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			if b.position_ground().distance_to(at) < 5.0:
				for part in b.parts:
					part.global_position += Vector3(0, 0, 8)
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
		_view.global_position = at + Vector3(0.1, 0.55, 0.6)
		_view.look_at(at + Vector3(0.12, 0, -0.05))
	if _view == null:
		return
	# The streams: ~25 ml/s for 10 s, then a second beside it.
	var src := at + Vector3(0, 0.6, 0) if t < 12.0 else at + Vector3(0.35, 0.6, -0.1)
	if (t > 1.0 and t < 11.0) or (t > 16.0 and t < 22.0):
		Game.blood.spawn_drop(src + Vector3(randf_range(-0.01, 0.01), 0, randf_range(-0.01, 0.01)),
				Vector3(0, -0.5, 0), 25.0 * delta, [] as Array[RID], 0.0, true)
	for k in [6.0, 12.0, 24.0, 38.0]:
		if _once("s%s" % k, k):
			get_viewport().get_texture().get_image().save_png("user://pool_%s.png" % k)
			print("snap ", k)
