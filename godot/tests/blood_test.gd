extends Node
## Dev test: lines three bots up in front of the building wall, shoots them
## (pistol chest, pistol head, shotgun head), then saves screenshots over time
## and prints FPS plus blood system counters.
## Usage: godot --path . res://tests/blood_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _next_log := 1.0
var _done := {}
var _bots := []

# [time, player pos, look-at target, name]
var views := [
	[7.9, Vector3(-6.5, 0.1, -4.2), Vector3(-6.8, 1.0, -8.0), "spray"],
	[11.0, Vector3(-6.5, 0.1, -3.4), Vector3(-6.5, 0.6, -8.0), "wall_3s"],
	[13.0, Vector3(-8.2, 0.1, -5.6), Vector3(-9.0, 0.9, -7.4), "bleeding"],
	[22.0, Vector3(-6.0, 0.1, -3.6), Vector3(-6.5, 0.0, -7.4), "pools_14s"],
	[45.0, Vector3(-6.0, 0.1, -3.6), Vector3(-6.5, 0.0, -7.4), "later_37s"],
]


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)


func _physics_process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null:
		return
	if t > 4.0 and not _done.has("place") and Game.bots.size() >= 3:
		_done["place"] = true
		var xs := [-9.0, -7.5, -4.0]
		for i in 3:
			var b = Game.bots[i]
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			b.move_velocity = Vector3.ZERO
			b.facing = Vector3.BACK
			_teleport(b, Vector3(xs[i], 0.0, -7.35))
			_bots.append(b)
	if _bots.size() == 3:
		_shot(6.0, "a", _bots[0], "chest")
		_shot(6.6, "b", _bots[1], "head")
		if t > 6.7 and not _done.has("switch"):
			_done["switch"] = true
			p._switch_to("shotgun")
		_shot(7.6, "c", _bots[2], "head")
	for v in views:
		if t > v[0] - 1.2 and not _done.has(v[3]):
			_aim(v[1], v[2])
	if t > _next_log:
		_next_log += 1.0
		var bl = Game.blood
		print("t=%.0f fps=%d gpu=%.1fms proc=%.1fms phys=%.1fms drops=%d runs=%d body_runs=%d pools=%d world_decals=%d body_decals=%d" % [
			t, Engine.get_frames_per_second(), RenderingServer.viewport_get_measured_render_time_gpu(get_viewport().get_viewport_rid()), Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0, bl._drops.size(), bl._runs.size(), bl._body_runs.size(),
			bl._pools.size(), bl._world.decals.size(), bl._body.decals.size()])
	if t > 47.0:
		get_tree().quit()


func _process(_delta: float) -> void:
	for v in views:
		if t > v[0] and not _done.has(v[3]):
			_done[v[3]] = true
			var img := get_viewport().get_texture().get_image()
			img.save_png("%s/%s.png" % [out, v[3]])
			print("saved ", v[3])


func _shot(at: float, key: String, b, part_name: String) -> void:
	if t < at or _done.has(key):
		return
	_done[key] = true
	var p = Game.player
	var part: RigidBody3D = b.head if part_name == "head" else b.chest
	var target := part.global_position + (Vector3(0, 0.03, 0) if part_name == "head" else Vector3.ZERO)
	var from := Vector3(target.x, 0.1, target.z + 3.5)
	p.global_position = from
	p.velocity = Vector3.ZERO
	var eye: Vector3 = from + Vector3(0, 1.62, 0)
	var dir := (target - eye).normalized()
	p.cam.global_transform = Transform3D(Basis.looking_at(dir), eye)
	p.current._cooldown = 0.0
	var ex: Array[RID] = [p.get_rid()]
	p.current.try_fire(p.cam, ex)
	print("SHOT %s at %s alive_after=%s bleed=%.1f" % [part_name, b.name, b.alive, b.bleed_rate])


func _aim(pos: Vector3, target: Vector3) -> void:
	var p = Game.player
	p.global_position = pos
	p.velocity = Vector3.ZERO
	var dir := (target - (pos + Vector3(0, 1.62, 0))).normalized()
	p.yaw = atan2(-dir.x, -dir.z)
	p.pitch = asin(dir.y)


func _teleport(b, ground: Vector3) -> void:
	var q := PhysicsRayQueryParameters3D.create(ground + Vector3.UP * 2.0, ground + Vector3.DOWN * 2.0, Game.LAYER_WORLD)
	var hit: Dictionary = b.get_world_3d().direct_space_state.intersect_ray(q)
	if not hit.is_empty():
		ground = hit.position
	var off: Vector3 = ground - b.position_ground()
	for part in b.parts:
		part.global_position += off
		part.linear_velocity = Vector3.ZERO
		part.angular_velocity = Vector3.ZERO
		part.reset_physics_interpolation()
