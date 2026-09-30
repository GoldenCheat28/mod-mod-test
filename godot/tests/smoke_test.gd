extends Node
## Dev test: a smoker (a bot) blowing smoke out, close up, a few frames.
var t := -3.0
var out := "user://"
var _b: Node3D
var _view: Camera3D
var _n := 0
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
func _process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.bots.is_empty() or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _b == null:
		for b in Game.bots:
			if b.ai and b.ai.act and b.ai.act.smokes and b.ai.act.arrived:
				_b = b
		if _b == null:
			return
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
		p.global_position = Vector3(30, 0.1, 30)
		_b.ai.act._next_drag = 0.0
		print("smoker found t=", t)
	var h: Vector3 = _b.head.global_position
	var f: Vector3 = -_b.head.global_basis.z
	var side := f.cross(Vector3.UP).normalized()
	_view.global_position = h + side * 1.1 + f * 0.5 + Vector3.UP * 0.05
	_view.look_at(h + f * 0.5)
	var act = _b.ai.act
	if act._exhale > 0.0 and _n < 3 and fmod(t, 0.5) < delta:
		get_viewport().get_texture().get_image().save_png("%s/smk_%d.png" % [out, _n])
		_n += 1
	if _n >= 3 or t > 60.0:
		get_tree().quit()
