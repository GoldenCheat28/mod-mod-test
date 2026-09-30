extends Node3D
## Dev tool: a model on a plain background, side and three-quarter views.
## Usage: MODEL=revolver|pistol|akm|shotgun|machete|chainsaw|grenade|bomb godot --path . res://tests/model_view.tscn -- <out_dir>
var t := 0.0
var out := "user://"
var _cam: Camera3D
var _m: Node3D
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	sky.sky_material = ProceduralSkyMaterial.new()
	env.sky = sky
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.background_color = Color(0.55, 0.57, 0.6)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.5, 0.5)
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, -30, 0)
	sun.light_energy = 1.4
	add_child(sun)
	var kind := OS.get_environment("MODEL")
	var icons = load("res://scripts/ui/item_icons.gd").new()
	_m = icons._model(kind)
	icons.free()
	if _m is RigidBody3D:
		(_m as RigidBody3D).freeze = true
	add_child(_m)
	_cam = Camera3D.new()
	add_child(_cam)
	_cam.make_current()
func _process(delta: float) -> void:
	t += delta
	var box := AABB()
	var first := true
	for c in _m.find_children("*", "MeshInstance3D", true, false):
		var mi := c as MeshInstance3D
		var b: AABB = mi.global_transform * mi.get_aabb()
		box = b if first else box.merge(b)
		first = false
	var centre := box.get_center()
	var r := box.size.length() * 0.75
	if t < 0.5:
		_cam.global_position = centre + Vector3(r * 1.2, 0.0, 0.0)
	else:
		_cam.global_position = centre + Vector3(r * 0.8, r * 0.45, r * 0.8)
	_cam.look_at(centre)
	if t > 0.4 and t < 0.45 + delta:
		get_viewport().get_texture().get_image().save_png(out + "/m_side.png")
	if t > 1.0:
		get_viewport().get_texture().get_image().save_png(out + "/m_34.png")
		get_tree().quit()
