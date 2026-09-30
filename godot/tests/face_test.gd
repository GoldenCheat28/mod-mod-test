extends Node
## Dev test: three faces - calm, angry, afraid (humanoid._update_face).
## Usage: godot --path . res://tests/face_test.tscn -- <out_dir>

var t := -3.0
var _done := {}
var _b: Array = []
var _view: Camera3D
var out := "user://"


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 4.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 6 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 0.0):
		p.global_position = Vector3(20, 0.1, 30)
		for i in 6:
			var b: Node3D = Game.bots[i]
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			var off: Vector3 = Vector3(-6.0 + i * 0.5, 0, 12.0) - b.position_ground()
			for part in b.parts:
				part.global_position += off
				part.linear_velocity = Vector3.ZERO
				part.reset_physics_interpolation()
			b.facing = Vector3.BACK
			_b.append(b)
		_view = Camera3D.new()
		_view.fov = 30.0
		add_child(_view)
		_view.make_current()
	if _b.is_empty():
		return
	for b in _b:
		b.move_velocity = Vector3.ZERO
		b.ai.fear = 0.0
		b.look_target = _view.global_position
		b.has_look_target = true
	_b[1].angry_until = Game.clock + 1.0
	_b[2].ai.fear = 1.0
	_b[3].pain = 1.2
	_b[4].sad_until = Game.clock + 1.0
	_b[5].blood = _b[5].BLOOD_MAX * 0.7
	_b[5].bleed_rate = 0.0
	var c: Vector3 = (_b[0].head.global_position + _b[4].head.global_position) * 0.5 + Vector3(0.25, 0, 0)
	_view.global_position = c + Vector3(0, 0.05, 2.9)
	_view.look_at(c)


func _process(_d: float) -> void:
	if t > 3.0 and not _done.has("shot"):
		_done["shot"] = true
		get_viewport().get_texture().get_image().save_png(out + "/faces.png")


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
