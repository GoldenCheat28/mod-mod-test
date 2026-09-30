extends Node
## Dev tool: which part of the level eats the frame - each child of Main in
## turn switched off for a second, the process time measured.
var t := -3.0
var _kids: Array = []
var _i := -1
var _acc := 0.0
var _n := 0
func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())
func _process(delta: float) -> void:
	t += delta
	if Game.player == null or Game.main == null or t < 2.0:
		return
	if _kids.is_empty():
		for c in Game.main.get_children():
			_kids.append(c)
		print("kids: ", _kids.size())
	_acc += Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0
	_n += 1
	if _n >= 20:
		var name := "none" if _i < 0 else str(_kids[_i].name)
		print("off=%s proc=%.1f fps=%d" % [name, _acc / _n, Engine.get_frames_per_second()])
		if _i >= 0 and is_instance_valid(_kids[_i]):
			_kids[_i].process_mode = Node.PROCESS_MODE_INHERIT
		_i += 1
		_acc = 0.0
		_n = 0
		while _i < _kids.size() and not is_instance_valid(_kids[_i]):
			_i += 1
		if _i >= _kids.size():
			get_tree().quit()
			return
		_kids[_i].process_mode = Node.PROCESS_MODE_DISABLED
