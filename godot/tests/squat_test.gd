extends Node
## Dev test: one bot put down on his heels (Posture.SQUAT) and left there.
## Logs the pelvis height and the feet (do they slide about?), films him.
## Usage: godot --path . res://tests/squat_test.tscn --write-movie out.avi --fixed-fps 30

var t := -3.0
var _done := {}
var _b: Node3D
var _view: Camera3D
var _jit := {}
var _jn := 0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 10.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null:
		return
	if _once("setup", 0.0):
		_b = Game.bots[0]
		_b.ai.process_mode = Node.PROCESS_MODE_DISABLED
		var off: Vector3 = Vector3(0, 0, 5) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		_b.facing = Vector3.RIGHT
		var v := OS.get_environment("SQ").split(",")
		if v.size() == 4:
			_b.SQ_THIGH = float(v[0])
			_b.SQ_SHIN = float(v[1])
			_b.SQ_FOOT = float(v[2])
			_b.SQ_LEAN = float(v[3])
		p.global_position = Vector3(5, 0.1, 9)
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
		_view.global_position = Vector3(0.3, 0.9, 7.3)
		_view.look_at(Vector3(0, 0.45, 5))
	if _b == null:
		return
	_b.move_velocity = Vector3.ZERO
	if t > 1.0:
		_b.posture = _b.Posture.SQUAT
	if t > 3.0 and t < 9.0:
		for part in _b.parts:
			var n: String = part.get_meta("part")
			_jit[n] = _jit.get(n, 0.0) + part.linear_velocity.length() + part.angular_velocity.length() * 0.1
		_jn += 1
	if t > 9.0 and not _done.has("jit"):
		_done["jit"] = true
		var ks: Array = _jit.keys()
		ks.sort_custom(func(a, b): return _jit[a] > _jit[b])
		var tot := 0.0
		for k in ks:
			tot += _jit[k] / _jn
		print("JIT total=%.2f foot=%.2f pelvis=%.2f py=%.3f" % [tot, _jit["foot_r"] / _jn, _jit["pelvis"] / _jn, _b.pelvis.global_position.y])
	if int(t * 5) != int((t - delta) * 5) and t > 0.8:
		var fr: Vector3 = _b.parts[_b.part_index["foot_r"]].global_position
		var fl: Vector3 = _b.parts[_b.part_index["foot_l"]].global_position
		print("t=%.1f pelvis_y=%.3f vel=%.2f foot_r=(%.2f,%.2f,%.2f) foot_l=(%.2f,%.2f,%.2f) support=%.2f fallen=%s" % [t, _b.pelvis.global_position.y,
				_b.pelvis.linear_velocity.length(), fr.x, fr.y, fr.z, fl.x, fl.y, fl.z, _b.support, _b.fallen])


func _process(_d: float) -> void:
	for s in [[3.0, "squat_a"], [6.0, "squat_b"], [9.5, "squat_c"]]:
		if t >= s[0] and not _done.has(s[1]):
			_done[s[1]] = true
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [OS.get_environment("OUT"), s[1]])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
