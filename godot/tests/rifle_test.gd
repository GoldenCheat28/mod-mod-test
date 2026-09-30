extends Node
## Dev test: the scoped rifle - aimed through the scope at a man far off,
## fired; how long the bullet takes and where it lands.

var t := -3.0
var _done := {}
var b: Node3D
var _fired_at := 0.0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())
	Game.bot_hurt.connect(func(bot, point):
		if _fired_at > 0.0:
			print("hit after %.3f s at %s (aimed at %s)" % [Time.get_ticks_msec() / 1000.0 - _fired_at, point, b.chest.global_position if b else Vector3.ZERO]))


func _physics_process(delta: float) -> void:
	t += delta
	if t > 12.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null or Game.bots.is_empty():
		return
	if b == null:
		Game.main.activities.spots.clear()
		b = Game.bots[0]
		for o in Game.bots:
			o.ai.process_mode = Node.PROCESS_MODE_DISABLED
		var at := Vector3(40.0, 0.0, 12.0)
		var off: Vector3 = at - b.position_ground()
		for part in b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
		b.facing = Vector3(1, 0, 1).normalized()
		p.global_position = Vector3(-18.0, 0.2, 12.0)
		p.inventory.take("akm")
		p.inventory.take("shotgun")
		print("rifle added: ", p.inventory.add("rifle", 1))
		p._last_switch = -10.0
		p._switch_to("rifle")
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	b.move_velocity = Vector3.ZERO
	if t > 1.0:
		var to: Vector3 = b.chest.global_position - p.cam.global_position
		p.yaw = atan2(-to.x, -to.z)
		p.pitch = atan2(to.y, Vector2(to.x, to.z).length())
	if t > 2.0 and not _done.has("rmb"):
		_done["rmb"] = true
		var ev := InputEventMouseButton.new()
		ev.button_index = MOUSE_BUTTON_RIGHT
		ev.pressed = true
		Input.parse_input_event(ev)
	if t > 4.0 and not _done.has("s1"):
		_done["s1"] = true
		get_viewport().get_texture().get_image().save_png("user://rifle_scope.png")
		var q := PhysicsRayQueryParameters3D.create(p.cam.global_position, b.chest.global_position, Game.LAYER_WORLD | Game.LAYER_PROPS)
		print("aim ", p.current.aim, " kind ", p.current.kind, " dist ", p.cam.global_position.distance_to(b.chest.global_position), " blocked ", not p.get_world_3d().direct_space_state.intersect_ray(q).is_empty())
	if t > 4.3 and not _done.has("fire"):
		_done["fire"] = true
		_fired_at = Time.get_ticks_msec() / 1000.0
		var ex: Array[RID] = [p.get_rid()]
		p.current.try_fire(p.cam, ex)
	if t > 5.0 and not _done.has("s2"):
		_done["s2"] = true
		get_viewport().get_texture().get_image().save_png("user://rifle_after.png")
	if t > 5.5 and not _done.has("rel"):
		_done["rel"] = true
		var ev2 := InputEventMouseButton.new()
		ev2.button_index = MOUSE_BUTTON_RIGHT
		ev2.pressed = false
		Input.parse_input_event(ev2)
		p.current.try_reload()
	for f in [6.1, 6.6, 7.0]:
		if t > f and not _done.has(f):
			_done[f] = true
			get_viewport().get_texture().get_image().save_png("user://rifle_rl_%s.png" % f)
	if t > 8.0 and not _done.has("s3"):
		_done["s3"] = true
		get_viewport().get_texture().get_image().save_png("user://rifle_hip.png")
