extends Node
## Dev test: what the people cost to draw - draw calls, objects and
## primitives in view with them and with them hidden, from a few spots.

var t := 0.0
var _phase := 0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if _phase == 0 and t > 3.0:
		var tg := Game.main.get_node_or_null("TableGames")
		# Look at the crowd: the camera put among them.
		var c := Vector3.ZERO
		var n := 0
		for b in Game.bots:
			c += b.pelvis.global_position
			n += 1
		c /= maxf(n, 1)
		var cam := get_viewport().get_camera_3d()
		Game.player.global_position = c + Vector3(6, 0, 6)
		cam.look_at(c)
		_phase = 1
		t = 0.0
	elif _phase == 1 and t > 1.0:
		_report("with people (%d)" % Game.bots.size())
		for b in Game.bots:
			b.visible = false
		_phase = 2
		t = 0.0
	elif _phase == 2 and t > 1.0:
		_report("people hidden")
		var meshes := 0
		var shadow := 0
		var b0: Node3D = Game.bots[0]
		for m in b0.find_children("*", "GeometryInstance3D", true, false):
			meshes += 1
			if (m as GeometryInstance3D).cast_shadow != GeometryInstance3D.SHADOW_CASTING_SETTING_OFF:
				shadow += 1
		print("one person: %d mesh nodes, %d casting shadows" % [meshes, shadow])
		get_tree().quit()


func _report(what: String) -> void:
	print("DRAW %s: draw calls %d, objects %d, primitives %d, fps %d" % [what,
			Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
			Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
			Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME), Engine.get_frames_per_second()])
