extends Node
## Dev test: a bot cuffed (set_cuffed), standing then kneeling; pictures from
## behind and the side, and the distance between the wrists logged.
## CUFF=x,y,z|fx sets the arm pose to try.
## Usage: godot --path . res://tests/cuff_test.tscn -- <out_dir>

var out := "user://"
var t := -3.0
var _done := {}
var _b: Node3D
var _cam: Camera3D


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 9.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null:
		return
	if _once("setup", 0.0):
		_b = Game.bots[0]
		var off: Vector3 = Vector3(-12, 0, 3.5) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		var env := OS.get_environment("CUFF")
		if env != "":
			var v := env.split(",")
			_b.CUFF_UPPER = Vector3(float(v[0]), float(v[1]), float(v[2]))
			_b.CUFF_FORE = Vector3(float(v[3]), 0, 0)
		_b.set_cuffed(true)
		p.global_position = Vector3(-6, 0.1, 9)
		_cam = Camera3D.new()
		add_child(_cam)
		_cam.make_current()
	if _b == null:
		return
	if _once("kneel", 5.0):
		_b.ai.kneel = true
	var c: Vector3 = _b.pelvis.global_position
	var back: Vector3 = _b.pelvis.global_basis.z
	back.y = 0.0
	back = back.normalized()
	var side := back.cross(Vector3.UP)
	var view := back * 1.5 + side * 0.6 if fmod(t, 2.0) < 1.0 else side * 1.6 + back * 0.3
	_cam.global_position = c + view + Vector3.UP * 0.3
	_cam.look_at(c + Vector3.UP * 0.05)
	if OS.get_environment("CLOSE") != "":
		var hm: Vector3 = (_b.parts[_b.part_index["hand_r"]].global_position + _b.parts[_b.part_index["hand_l"]].global_position) * 0.5
		_cam.global_position = hm - back * 0.4 + side * 0.15 + Vector3.UP * 0.1
		_cam.look_at(hm)
		if _b._chain and int(t * 2) != int((t - delta) * 2):
			print("chain vis=", _b._chain.visible, " inside=", _b._chain.is_inside_tree(), " n=", _b._chain.multimesh.instance_count, " p0=", _b._chain_p[0] if _b._chain_p.size() > 0 else Vector3.ZERO, " hm=", hm)
	if int(t * 2) != int((t - delta) * 2) and t > 1.0:
		var hr: Vector3 = _b.parts[_b.part_index["hand_r"]].global_position
		var hl: Vector3 = _b.parts[_b.part_index["hand_l"]].global_position
		print("t=%.1f wrists=%.3f hands_behind=%.2f fallen=%s" % [t, hr.distance_to(hl), ((hr + hl) * 0.5 - c).dot(back), _b.fallen])


func _process(_d: float) -> void:
	for s in [[3.5, "stand_back"], [4.5, "stand_side"], [7.5, "kneel_back"], [8.5, "kneel_side"]]:
		if t >= s[0] and not _done.has(s[1]):
			_done[s[1]] = true
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, s[1]])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
