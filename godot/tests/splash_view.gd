extends Node3D
## Dev view: the splash sprite's frames (camera on a splash, a picture each 0.04 s).
var out := "/tmp"
var t := 0.0
var _sp: Node3D
var _n := 0
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.5, 0.52, 0.55)
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var cam := Camera3D.new()
	add_child(cam)
	cam.position = Vector3(0, 0, 1.4)
	cam.make_current()
	_sp = load("res://scripts/fx/blood_splash.gd").new()
	add_child(_sp)
func _process(delta: float) -> void:
	t += delta
	if t > 0.5 and _n == 0:
		_sp.splash(Vector3.ZERO, Vector3.RIGHT, 1.0, 0.32)
		_n = 1
		t = 0.5
	if _n > 0 and t > 0.5 + _n * 0.045:
		get_viewport().get_texture().get_image().save_png("%s/splash_%d.png" % [out, _n])
		_n += 1
		if _n > 7:
			get_tree().quit()
