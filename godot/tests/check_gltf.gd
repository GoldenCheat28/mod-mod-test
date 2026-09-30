extends Node3D
## Dev tool: loads an exported glTF, lists its animations, plays one through
## a few times and renders each from its camera.
## Usage: godot --path . res://tests/check_gltf.tscn -- <file.gltf> <anim> <t1,t2,..> <out_prefix>

var _args: PackedStringArray
var _ap: AnimationPlayer
var _times: Array = []
var _i := 0
var _n := 0
var _scene: Node


func _ready() -> void:
	_args = OS.get_cmdline_user_args()
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	print("load: ", error_string(doc.append_from_file(_args[0], st)))
	_scene = doc.generate_scene(st)
	add_child(_scene)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.35, 0.37, 0.4)
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color(0.7, 0.7, 0.7)
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(-0.6, 0.4, 0)
	add_child(sun)
	_ap = _scene.find_children("*", "AnimationPlayer", true, false)[0]
	print("anims: ", _ap.get_animation_list())
	for t in _args[2].split(","):
		_times.append(float(t))
	var cams := _scene.find_children("*", "Camera3D", true, false)
	if cams.size() > 0:
		(cams[0] as Camera3D).make_current()
	_ap.play(_args[1])
	_ap.pause()


func _process(_d: float) -> void:
	if _i >= _times.size():
		get_tree().quit()
		return
	if _n == 0:
		_ap.seek(_times[_i], true)
	_n += 1
	if _n == 2:
		if OS.get_environment("CLOSEUP") != "":
			var cg: Node3D = _scene.find_child("Cigarette", true, false)
			if cg == null:
				cg = _scene.find_child("Joint", true, false)
			var c := Camera3D.new()
			add_child(c)
			var mid := cg.global_transform * Vector3(0, 0, -0.05)
			c.global_position = mid + cg.global_basis.x * 0.12 + Vector3.UP * 0.03
			c.look_at(mid)
			c.fov = 40.0
			c.near = 0.005
			c.make_current()
	if _n == 6:
		var rh: Node3D = _scene.find_child("RightHand", true, false)
		print("t ", _times[_i], " right hand ", rh.position)
		get_viewport().get_texture().get_image().save_png("%s_%s.png" % [_args[3], _times[_i]])
		_i += 1
		_n = 0
