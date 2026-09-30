extends Node
## Dev test: the new arms - sawn-off, crossbow (a man pinned to a wall),
## nail gun, flare gun, a Molotov - each fired at a man standing by a wall.
## Screenshots after each.

var t := -3.0
var _view: Camera3D
var _done := {}
var _b: Array = []
const WALL_AT := Vector3(-9.2, 0.0, -9.0)


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _once(k: String, at: float) -> bool:
	if t < at or _done.has(k):
		return false
	_done[k] = true
	return true


func _snap(n: String) -> void:
	get_viewport().get_texture().get_image().save_png("user://arms_%s.png" % n)
	print("snap ", n)


func _physics_process(delta: float) -> void:
	t += delta
	if t > 30.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 5 or Game.main.weather == null:
		return
	if _once("setup", 0.0):
		Game.main.activities.spots.clear()
		# Five men in a row, backs to the front of the building.
		for i in 5:
			var b: Node3D = Game.bots[i]
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			var at := Vector3(-6.0 + i * 2.2, 0.0, -7.5)
			var off: Vector3 = at - b.position_ground()
			for part in b.parts:
				part.global_position += off
				part.linear_velocity = Vector3.ZERO
				part.reset_physics_interpolation()
			b.facing = Vector3.BACK
			_b.append(b)
		p.global_position = Vector3(-1.6, 0.2, -1.0)
		_view = Camera3D.new()
		add_child(_view)
	if _b.is_empty():
		return
	for b in _b:
		b.move_velocity = Vector3.ZERO
	var order := ["sawnoff", "crossbow", "nailgun", "flaregun"]
	for i in order.size():
		var at := 1.0 + i * 4.0
		var target: Node3D = _b[i]
		if _once("aim%d" % i, at):
			p._last_switch = -10.0
			p._switch_to(order[i])
		if t > at and t < at + 3.0:
			# Aim at his chest.
			var to: Vector3 = target.chest.global_position - p.cam.global_position
			p.yaw = atan2(-to.x, -to.z)
			p.pitch = atan2(to.y, Vector2(to.x, to.z).length())
		if _once("fire%d" % i, at + 1.2) and p.current:
			var ex: Array[RID] = [p.get_rid()]
			p.current.try_fire(p.cam, ex)
		if order[i] == "nailgun" and t > at + 1.3 and t < at + 2.0 and p.current and int(t * 10) % 2 == 0:
			var ex2: Array[RID] = [p.get_rid()]
			p.current.try_fire(p.cam, ex2)
		if _once("snap%d" % i, at + 2.8):
			_snap(order[i])
	# The Molotov.
	if _once("molotov", 17.5):
		var tgt: Vector3 = _b[4].chest.global_position
		var from: Vector3 = tgt + Vector3(0, 1.2, 4.0)
		load("res://scripts/weapons/molotov.gd").throw(Game.main, Transform3D(Basis(), from), (tgt - from).normalized() * 9.0, Vector3(5, 0, 3))
	for s in [[19.5, "molotov"], [23.0, "burning"], [28.0, "after"]]:
		if _once("s" + s[1], s[0]):
			_snap(s[1])
	# The view from the side of the row.
	_view.make_current()
	var focus: Vector3 = _b[mini(int((t - 1.0) / 4.0), 4)].chest.global_position
	if t > 17.0:
		focus = _b[4].chest.global_position
	_view.global_position = focus + Vector3(1.8, 0.4, 2.4)
	_view.look_at(focus)
