extends Node
## Dev test: the radial menu with the gesture icons; a wave at a man in front
## (he answers and waves), then the finger (he gets angry).
var t := -3.0
var out := "user://"
var _done := {}
var _b: Node3D
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
func _shot(n: String) -> void:
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, n])
func _physics_process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if not _done.has("setup"):
		_done["setup"] = true
		_b = Game.bots[0]
		for i in range(1, Game.bots.size()):
			Game.bots[i].ai.process_mode = Node.PROCESS_MODE_DISABLED
		var off: Vector3 = Vector3(3, 0, 1) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		if _b.ai.act:
			_b.ai._end_activity()
		_b.ai._enter(_b.ai.S.IDLE)
		_b.facing = Vector3.BACK
		p.global_position = Vector3(3, 0.1, 4)
		p.yaw = 0.0
		p.pitch = 0.05
		p._switch_to("hands")
	if _b.ai.state == _b.ai.S.IDLE:
		_b.ai._state_t = 0.0          # (stays put, does not wander off to something to do)
	if t > 1.0 and not _done.has("menu"):
		_done["menu"] = true
		p._radial.open(["Сигарета", "Косяк", "Пистолет", "Дробовик", "АКМ", "Манекен", "Граната", "Бомба", "Бинт",
				"Наручники", "Бензопила", "Мачете", "Рулетка", "Баллончик", "Привет", "Фак"] as Array[String], {14: "wave", 15: "fuck"})
	if t > 1.6 and not _done.has("menu_shot"):
		_done["menu_shot"] = true
		_shot("g_menu")
		p._radial.close()
	if t > 2.5 and not _done.has("wave"):
		_done["wave"] = true
		p._start_gesture("wave")
	if t > 3.3 and not _done.has("wave_shot"):
		_done["wave_shot"] = true
		_shot("g_wave")
		print("after wave: state=%s speaking=%s wave_t=%.2f" % [_b.ai.S.keys()[_b.ai.state], _b.ai.talk.speaking(), _b.ai._wave_t])
	if t > 6.0 and not _done.has("fuck"):
		_done["fuck"] = true
		p._start_gesture("fuck")
	if t > 6.8 and not _done.has("fuck_shot"):
		_done["fuck_shot"] = true
		_shot("g_fuck")
	if t > 7.5 and not _done.has("res"):
		_done["res"] = true
		print("after fuck: state=%s angry_until-clock=%.1f" % [_b.ai.S.keys()[_b.ai.state], _b.angry_until - Game.clock])
		get_tree().quit()
