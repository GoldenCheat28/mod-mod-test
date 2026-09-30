extends Node
## Dev test: jelly response of the head. A standing bot is shot in the head
## (pistol, then a second bot with a shotgun blast); frames are captured at
## short intervals from the side to see the swelling and wobble.

var out := "user://"
var t := 0.0
var _done := {}
var _cam: Camera3D
var _shots := {}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
	_cam = Camera3D.new()
	_cam.fov = 40.0
	_cam.near = 0.02
	add_child(_cam)


func _physics_process(delta: float) -> void:
	t += delta
	if t > 10.0:
		get_tree().quit()
	if Game.bots.size() < 2:
		return
	if _once("place", 3.0):
		for i in 2:
			var b = Game.bots[i]
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			b.move_velocity = Vector3.ZERO
			b.facing = Vector3.FORWARD
			var off: Vector3 = Vector3(i * 3.0, 0, 0) - b.position_ground()
			for part in b.parts:
				part.global_position += off
				part.reset_physics_interpolation()
	if _once("pistol", 5.0):
		_hit(Game.bots[0], "pistol", 1)
	if _once("shotgun", 7.5):
		_hit(Game.bots[1], "shotgun", 4)


func _hit(b, weapon: String, pellets: int) -> void:
	var h: Vector3 = b.head.global_position
	for k in pellets:
		var off := Vector3(randf_range(-0.02, 0.02), randf_range(-0.01, 0.03), 0) if pellets > 1 else Vector3(0.01, 0.02, 0)
		b.receive_hit(b.head, h + off + Vector3(0, 0, -0.1), Vector3.BACK, 11.0, weapon)


func _process(_d: float) -> void:
	if Game.bots.size() < 2:
		return
	# Only the next pending frame drives the camera.
	for bot in 2:
		for k in [0.0, 0.016, 0.04, 0.08, 0.15, 0.3]:
			var name_ := ("pistol_%03d" if bot == 0 else "shotgun_%03d") % int(k * 1000)
			if not _done.has(name_):
				_frame(bot, (5.0 if bot == 0 else 7.5) + k, name_)
				return


func _frame(bot: int, at: float, name_: String) -> void:
	if _done.has(name_):
		return
	var h: Vector3 = Game.bots[bot].head.global_position
	var eye := h + Vector3(0.6, 0.05, 0.0)
	_cam.global_transform = Transform3D(Basis.looking_at((h - eye).normalized()), eye)
	_cam.make_current()
	if t >= at:
		_done[name_] = true
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name_])
		print("saved ", name_)


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true