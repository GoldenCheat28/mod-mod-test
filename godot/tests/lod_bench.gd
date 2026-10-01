extends Node
## Dev test: the cost of a crowd under control - twenty people walking in
## circles in the open, nothing else going on (no games, no sleeping), the
## camera among them (LOD_CAM=near) or away and turned from them (far).
## Prints the body scripts' time and the physics frame (median).

var t := 0.0
var _phase := 0
var _samples: Array[float] = []
var _bots: Array = []


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


var _tilt: Array[float] = []
var _speed_err: Array[float] = []


func _physics_process(_delta: float) -> void:
	if _phase == 2:
		_samples.append(Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0)
		for b in _bots:
			if b.fallen:
				continue
			var up: Vector3 = b.chest.global_basis.y
			_tilt.append(rad_to_deg(up.angle_to(Vector3.UP)))
			var v: Vector3 = b.pelvis.linear_velocity
			_speed_err.append(Vector2(v.x - b.move_velocity.x, v.z - b.move_velocity.z).length())


func _process(delta: float) -> void:
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if _phase == 0 and t > 1.0:
		for n in ["TableGames", "Jobs", "CrowdLOD"]:
			var x := Game.main.get_node_or_null(n)
			if x:
				x.process_mode = Node.PROCESS_MODE_DISABLED
		var nav: RID = Game.player.get_world_3d().navigation_map
		var centre := Vector3(0, 0, 8)
		while Game.bots.size() < 20:
			Game.main.spawn_bot(NavigationServer3D.map_get_closest_point(nav, centre), 0.0, 500 + Game.bots.size())
		var i := 0
		for b in Game.bots:
			b.process_mode = Node.PROCESS_MODE_INHERIT
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			var at := NavigationServer3D.map_get_closest_point(nav, centre + Vector3((i % 5) * 2.2 - 4.4, 0, (i / 5) * 2.2 - 3.3))
			var off: Vector3 = at - b.position_ground()
			for part in b.parts:
				part.global_position += off
				part.linear_velocity = Vector3.ZERO
			_bots.append(b)
			i += 1
		var p = Game.player
		if OS.get_environment("LOD_CAM") == "far":
			p.global_position = centre + Vector3(0, 0.2, 30)
			p.yaw = 0.0          # looking away (-Z is towards them: +Z behind)
			p.yaw = PI
		else:
			p.global_position = centre + Vector3(0, 0.2, 7)
			p.yaw = 0.0
		_phase = 1
		t = 0.0
	elif _phase >= 1:
		# Walking slowly round in circles.
		var k := 0
		for b in _bots:
			var a: float = t * 0.5 + k
			b.move_velocity = Vector3(cos(a), 0, sin(a)) * 1.1
			b.facing = Vector3(cos(a), 0, sin(a))
			k += 1
		if _phase == 1 and t > 3.0:
			_phase = 2
			Game.prof.clear()
			_samples.clear()
		elif _phase == 2 and t > 13.0:
			var s := _samples.duplicate()
			s.sort()
			var fallen := 0
			for b in _bots:
				fallen += int(b.fallen)
			print("LOD %s %s: body scripts %.2f ms/step, physics median %.2f ms, fallen %d of %d" % [
					OS.get_environment("LOD_CAM"), "off" if OS.get_environment("LOD_OFF") == "1" else "on",
					float(Game.prof.get("humanoid._physics_process", 0)) / s.size() / 1000.0, s[s.size() / 2], fallen, _bots.size()])
			_tilt.sort()
			_speed_err.sort()
			var mt := 0.0
			for x in _tilt:
				mt += x
			print("   chest tilt: mean %.2f deg, p95 %.2f deg; walk speed error median %.3f m/s, p95 %.3f" % [mt / _tilt.size(),
					_tilt[int(_tilt.size() * 0.95)], _speed_err[_speed_err.size() / 2], _speed_err[int(_speed_err.size() * 0.95)]])
			get_tree().quit()
