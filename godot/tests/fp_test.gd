extends Node
## Dev test: first-person body, smoking, weapon offset, ragdoll look and the
## abandoned building. Saves screenshots to the given directory.
## Usage: godot --path . res://tests/fp_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 36.0:
		get_tree().quit()
	var p = Game.player
	if p == null:
		return
	if t < 4.4:
		_view(p, Vector3(-2, 0.3, -12), PI * 0.5, 0.0)
	elif t < 5.4:
		_view(p, Vector3(-13, 0.2, -12), -2.46, 0.05)
	elif t < 6.4:
		_view(p, Vector3(-7.5, 0.2, -5.0), 0.7, 0.1)
	elif t < 7.4:
		_view(p, Vector3(0, 0.1, 8), 0.0, -1.2)
	elif t < 8.4:
		_view(p, Vector3(0, 0.1, 8), 1.6, -1.2)
	elif t < 9.4:
		_view(p, Vector3(0, 0.1, 8), 1.6, -0.1)
	if _once("smoke", 9.5):
		p._switch_to("hands")
		p._smoking.start("cigarette")
	if t > 9.5 and t < 16.0:
		_view(p, Vector3(0, 0.1, 8), 1.6, -0.05)
	if _once("pistol", 16.0):
		p._smoking.throw_now()
		p._after_smoke = "pistol"
	if _once("aim_on", 16.8):
		var e := InputEventMouseButton.new()
		e.button_index = MOUSE_BUTTON_RIGHT
		e.pressed = true
		Input.parse_input_event(e)
	if _once("aim_off", 17.8):
		var e := InputEventMouseButton.new()
		e.button_index = MOUSE_BUTTON_RIGHT
		e.pressed = false
		Input.parse_input_event(e)
		print("aim was ", p.current.aim, " fov ", p.cam.fov)
	if _once("free", 18.0):
		p.current.free_pos = Vector3(-0.15, 0.08, 0.1)
		p.current.free_rot = Vector3(0.0, 0.3, 1.2)
	if _once("ragdoll", 20.0):
		p._go_ragdoll()
	if t > 21.0 and t < 24.0:
		p._rag_look += Vector2(delta * 0.8, 0.0)
	if _once("getup", 25.0):
		p._get_up()
	if t > 25.0 and t < 35.0 and p._ragdoll == null and not _done.has("up"):
		_done["up"] = true
		print("UP at t=", t, " pos=", p.global_position)


func _process(_d: float) -> void:
	_snap(4.2, "inside")
	_snap(5.2, "inside2")
	_snap(6.2, "building")
	_snap(7.2, "down_yaw0")
	_snap(8.2, "down_yaw1")
	_snap(10.3, "smoke_raise")
	_snap(11.1, "smoke_light")
	_snap(13.0, "smoke_idle")
	_snap(17.6, "aim")
	_snap(19.0, "pistol")
	_snap(20.6, "ragdoll_fall")
	_snap(23.5, "ragdoll_look")
	_snap(19.5, "free_gun")
	_snap(26.5, "getup1")
	_snap(33.0, "after_getup")


func _view(p, pos: Vector3, yaw: float, pitch: float) -> void:
	p.global_position = pos
	p.velocity = Vector3.ZERO
	p.yaw = yaw
	p.pitch = pitch


func _snap(at: float, name_: String) -> void:
	if t >= at and not _done.has(name_):
		_done[name_] = true
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name_])
		print("saved ", name_)


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
