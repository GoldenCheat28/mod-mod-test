extends Node
## Dev test: soft head damage. Pistol to the head (front), shotgun to the face,
## shotgun from the side; close-up screenshots over time and perf counters.
## Usage: godot --path . res://tests/head_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}
var _next_log := 1.0
var _cam: Camera3D

# [time, bot index, camera offset in the head's own frame (-Z = face), name]
var views := [
	[7.84, 1, Vector3(0.9, 0.2, 0.9), "blast_0.04s"],
	[8.1, 1, Vector3(0.9, 0.3, 0.9), "blast_0.3s"],
	[8.6, 1, Vector3(0.6, 0.35, 0.6), "blast_0.8s"],
	[10.8, 0, Vector3(0.25, 0.55, -0.25), "pistol_top"],
	[11.8, 1, Vector3(0.3, 0.5, -0.3), "shotgun_top1"],
	[12.3, 1, Vector3(-0.3, 0.5, 0.3), "shotgun_top2"],
	[12.8, 2, Vector3(0.3, 0.5, 0.3), "side_top1"],
	[13.3, 2, Vector3(-0.3, 0.5, -0.3), "side_top2"],
	[14.0, 1, Vector3(0.0, 1.8, -1.2), "overview"],
]


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
	_cam = Camera3D.new()
	_cam.fov = 70.0
	_cam.near = 0.02
	add_child(_cam)


func _physics_process(delta: float) -> void:
	t += delta
	if t > 14.5:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 3:
		return
	if _once("place", 4.0):
		var xs := [-2.0, 0.0, 2.5]
		for i in 3:
			var b = Game.bots[i]
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			b.move_velocity = Vector3.ZERO
			b.facing = Vector3.FORWARD
			_teleport(b, Vector3(xs[i], 0.0, 0.0))
	if _once("pistol", 6.0):
		_shoot(Vector3(-2.0, 0.0, -3.5), Game.bots[0].head.global_position)
	if _once("switch", 6.5):
		p._switch_to("shotgun")
	if _once("blast", 7.8):
		_shoot(Vector3(0.0, 0.0, -3.0), Game.bots[1].head.global_position)
	if _once("side", 9.2):
		p.current._cooldown = 0.0
		p.current.needs_pump = false
		p.current.chambered = true
		p.current.state = 0
		_shoot(Vector3(5.0, 0.0, 0.0), Game.bots[2].head.global_position)
	for v in views:
		if t > v[0] - 0.6 and t < v[0] and not (t > 7.7 and t < 7.8) and not (t > 9.1 and t < 9.2):
			var hb: RigidBody3D = Game.bots[v[1]].head
			var h := hb.global_position
			var eye: Vector3 = h + (v[2] as Vector3)
			var up := Vector3.UP if absf((h - eye).normalized().y) < 0.95 else Vector3.FORWARD
			_cam.global_transform = Transform3D(Basis.looking_at((h - eye).normalized(), up), eye)
			_cam.make_current()
	if t > _next_log:
		_next_log += 1.0
		var chunks := 0
		for b in Game.bots:
			if b.soft_head:
				chunks += b.soft_head._chunks.size()
		for b in Game.bots.slice(0, 3):
			var sh = b.soft_head
			print("  ", b.name, " alive=", b.alive, " soft=", sh != null, " mesh_tris=", ((sh.main_mesh.mesh as ArrayMesh).surface_get_array_index_len(0) / 3 if sh and sh.main_mesh and sh.main_mesh.mesh.get_surface_count() > 0 else 0), " chunks=", sh._chunks.size() if sh else 0)
		print("t=%.0f fps=%d phys=%.1fms chunks=%d" % [t, Engine.get_frames_per_second(),
				Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0, chunks])


func _process(_delta: float) -> void:
	for v in views:
		if t > v[0] and not _done.has(v[3]):
			_done[v[3]] = true
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, v[3]])
			print("saved ", v[3])
			Game.player.cam.make_current()


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
	var q := PhysicsRayQueryParameters3D.create(eye, eye + (target - eye).normalized() * 10.0, Game.LAYER_WORLD | Game.LAYER_BOTS | Game.LAYER_PROPS)
	q.exclude = ex
	var hit: Dictionary = get_viewport().world_3d.direct_space_state.intersect_ray(q)
	print("SHOT ", p.current.kind, " state=", p.current.state, " ready=", p.current.is_ready(), " aim hits ", hit.get("collider"), " ", (hit.collider.get_meta("part", "") if hit.has("collider") else ""))
	p.current.try_fire(p.cam, ex)


func _aim(pos: Vector3, target: Vector3) -> void:
	var p = Game.player
	p.global_position = pos
	p.velocity = Vector3.ZERO
	var dir := (target - (pos + Vector3(0, 1.62, 0))).normalized()
	p.yaw = atan2(-dir.x, -dir.z)
	p.pitch = asin(clampf(dir.y, -1.0, 1.0))


func _ground(at: Vector3) -> Vector3:
	var q := PhysicsRayQueryParameters3D.create(at + Vector3.UP * 2.0, at + Vector3.DOWN * 3.0, Game.LAYER_WORLD)
	var hit: Dictionary = get_viewport().world_3d.direct_space_state.intersect_ray(q)
	return hit.position if not hit.is_empty() else at


func _teleport(b, near: Vector3) -> void:
	var off: Vector3 = _ground(near) - b.position_ground()
	for part in b.parts:
		part.global_position += off
		part.linear_velocity = Vector3.ZERO
		part.angular_velocity = Vector3.ZERO
		part.reset_physics_interpolation()
