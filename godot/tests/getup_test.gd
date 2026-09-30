extends Node
## Dev test: a walking bot shot in the thigh stumbles; one knocked down gets up
## in stages. Logs state, frames of the get-up.

var out := "user://"
var t := 0.0
var _done := {}
var _cam: Camera3D
var b


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
	_cam = Camera3D.new()
	add_child(_cam)


func _physics_process(delta: float) -> void:
	t += delta
	if t > 20.0:
		get_tree().quit()
	if Game.bots.is_empty():
		return
	b = Game.bots[0]
	if _once("setup", 3.0):
		b.ai.process_mode = Node.PROCESS_MODE_DISABLED
		b.move_velocity = Vector3(0, 0, -1.3)
		b.facing = Vector3.FORWARD
		var off: Vector3 = Vector3(0, 0, 3) - b.position_ground()
		for part in b.parts:
			part.global_position += off
	if _once("leg", 5.0):
		var th = b.parts[b.part_index["thigh_r"]]
		b.receive_hit(th, th.global_position, Vector3.LEFT, 6.0, "pistol")
		b.leg_health["r"] = 0.2
	if _once("knock", 8.0):
		b.move_velocity = Vector3.ZERO
		b._fall()
		b.leg_health["r"] = 1.0
		b.leg_health["l"] = 1.0
		b.pelvis.apply_central_impulse(Vector3(0, 0, 60))
	var s := "%.1f fallen=%s getup=%.2f stumble=%.2f h=%.2f" % [t, b.fallen, b._getup, b._stumble, b.pelvis.global_position.y]
	if int(t * 4.0) != int((t - delta) * 4.0):
		print(s)
	var h: Vector3 = b.pelvis.global_position
	_cam.global_transform = Transform3D(Basis.looking_at(Vector3(-1, -0.25, 0).normalized() * -1.0), h + Vector3(-3.0, 0.8, 0))
	_cam.make_current()


func _process(_d: float) -> void:
	for k in [5.5, 6.2, 11.0, 12.0, 13.0, 14.0]:
		var name_ := "gu_%.1f" % k
		if t >= k and not _done.has(name_):
			_done[name_] = true
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name_])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true