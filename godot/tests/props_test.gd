extends Node
## Dev test: close looks at street props (bench, bin, bags, dumpster).
## Usage: godot --path . res://tests/props_test.tscn -- <out_dir>
var t := -3.0
var out := "user://"
var _done := {}
var _view: Camera3D
const SHOTS := [[3.0, Vector3(14.0, 1.7, -12.0), Vector3(22.0, 2.5, -17.0), "aa_shot"]]
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
func _process(delta: float) -> void:
	t += delta
	if Game.player == null or Game.main == null or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _view == null:
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
		Game.player.global_position = Vector3(20, 0.1, 30)
		for sw in Net._switches:
			sw.set_on(true)
	for s in SHOTS:
		if t > s[0] - 0.6 and t < s[0] + 0.1:
			_view.global_position = s[1]
			_view.look_at(s[2])
		if t >= s[0] and not _done.has(s[3]):
			_done[s[3]] = true
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, s[3]])
	if t > 3.5:
		var vp := get_viewport()
		print("AAFPS ", Engine.get_frames_per_second(), " msaa=", vp.msaa_3d, " taa=", vp.use_taa, " ssaa=", vp.screen_space_aa, " scale=", vp.scaling_3d_scale)
		get_tree().quit()
