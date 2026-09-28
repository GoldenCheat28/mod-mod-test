extends Node
## Dev test: blood on the dock stairs (a body on the steps plus a steady pour
## on the top step), then a body dragged by the player's grab through its own
## pool, then the player walking out of the pool (footprints).
## Usage: godot --path . res://tests/stairs_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}
var _next_log := 1.0
var _drag_bot
var _pour_t := 0.0

# [time, player pos, look-at target, name]
var views := [
	[10.0, Vector3(10.2, 0.1, -7.0), Vector3(13.3, 0.5, -8.2), "stairs_4s"],
	[17.0, Vector3(14.4, 1.25, -8.0), Vector3(14.4, 1.2, -9.75), "pour_top"],
	[19.5, Vector3(10.2, 0.1, -7.0), Vector3(13.3, 0.5, -8.2), "stairs_13s"],
	[20.5, Vector3(13.5, 0.1, -3.6), Vector3(13.5, 0.5, -8.0), "stairs_front"],
	[38.5, Vector3(2.0, 0.1, 10.5), Vector3(2.0, 0.0, 5.5), "drag"],
	[43.0, Vector3(2.0, 0.1, 12.0), Vector3(2.0, 0.0, 7.0), "footprints"],
]


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 44.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 2:
		return
	var stair_bot = Game.bots[0]
	if _once("place", 4.0):
		for b in [Game.bots[0], Game.bots[1]]:
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			b.move_velocity = Vector3.ZERO
			b.facing = Vector3.BACK
		_teleport(stair_bot, Vector3(13.2, 2.0, -8.1))
	if _once("stair_shot", 6.0):
		_shoot(Vector3(13.4, 0.1, -4.2), stair_bot.head.global_position + Vector3(0, 0.03, 0))
	# Steady pour on the top step (as if from a wound above).
	if t > 6.0 and t < 16.0:
		_pour_t += delta
		if _pour_t > 0.2:
			_pour_t = 0.0
			var top := _ground(Vector3(14.4, 2.0, -9.75))
			Game.blood._add_pool(top, Vector3.UP, 6.0)

	_drag_bot = Game.bots[1]
	if _once("dump", 18.0) or _once("dump2", 33.0):
		for pool in Game.blood._pools:
			if pool.vol > 5.0:
				print("POOL pos=%s vol=%.0f r=%.2f cap=%.2f shown=%.2f" % [pool.pos, pool.vol, pool.r, pool.cap, pool.shown])
	if _once("place2", 21.0):
		_teleport(_drag_bot, Vector3(2.0, 1.0, 5.0))
	if _once("drag_shot", 22.5):
		_shoot(Vector3(2.0, 0.1, 8.2), _drag_bot.head.global_position + Vector3(0, 0.03, 0))
	if t > 33.0 and t < 34.2:
		var c: Vector3 = _drag_bot.chest.global_position
		_aim(Vector3(c.x, _ground(c).y + 0.05, c.z + 1.3), c)
	if _once("grab", 34.2):
		Input.action_press("grab")
	if _once("pull", 34.4):
		Input.action_press("move_back")
	if _once("let_go", 37.0):
		Input.action_release("move_back")
		Input.action_release("grab")
		print("dragged, held=", p._held)
	if _once("walk", 39.0):
		var c: Vector3 = _drag_bot.chest.global_position
		p.global_position = Vector3(2.0, _ground(Vector3(2, 1, 5.2)).y + 0.05, 5.2)
		p.yaw = PI   # face +Z
		p.pitch = 0.0
		Input.action_press("move_forward")
	if _once("stop", 41.5):
		Input.action_release("move_forward")

	for v in views:
		if t > v[0] - 1.0 and t < v[0] and not (t > 33.0 and t < 42.0 and v[3] == "drag" and t < 38.0):
			_aim(v[1], v[2])
	if t > _next_log:
		_next_log += 2.0
		var bl = Game.blood
		print("t=%.0f fps=%d drops=%d runs=%d body_runs=%d pools=%d world_decals=%d" % [
			t, Engine.get_frames_per_second(), bl._drops.size(), bl._runs.size(), bl._body_runs.size(),
			bl._pools.size(), bl._world.decals.size()])


func _process(_delta: float) -> void:
	for v in views:
		if t > v[0] and not _done.has(v[3]):
			_done[v[3]] = true
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, v[3]])
			print("saved ", v[3])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true


func _shoot(from: Vector3, target: Vector3) -> void:
	var p = Game.player
	p.global_position = _ground(from) + Vector3(0, 0.05, 0)
	p.velocity = Vector3.ZERO
	var eye: Vector3 = p.global_position + Vector3(0, 1.62, 0)
	p.cam.global_transform = Transform3D(Basis.looking_at((target - eye).normalized()), eye)
	p.current._cooldown = 0.0
	var ex: Array[RID] = [p.get_rid()]
	p.current.try_fire(p.cam, ex)


func _aim(pos: Vector3, target: Vector3) -> void:
	var p = Game.player
	p.global_position = pos
	p.velocity = Vector3.ZERO
	var dir := (target - (pos + Vector3(0, 1.62, 0))).normalized()
	p.yaw = atan2(-dir.x, -dir.z)
	p.pitch = asin(dir.y)


func _ground(at: Vector3) -> Vector3:
	var q := PhysicsRayQueryParameters3D.create(at + Vector3.UP * 2.0, at + Vector3.DOWN * 3.0, Game.LAYER_WORLD)
	var hit: Dictionary = get_viewport().world_3d.direct_space_state.intersect_ray(q)
	return hit.position if not hit.is_empty() else at


func _teleport(b, near: Vector3) -> void:
	var ground := _ground(near)
	var off: Vector3 = ground - b.position_ground()
	for part in b.parts:
		part.global_position += off
		part.linear_velocity = Vector3.ZERO
		part.angular_velocity = Vector3.ZERO
		part.reset_physics_interpolation()
