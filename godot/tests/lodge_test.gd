extends Node
## Dev test: the chainsaw run half into a thigh (blade flat) and left there,
## chain stopped; the saw is lifted and carried off (the man should come with
## it), then drawn back out the way it went in (he should drop). Log.
## Usage: godot --path . res://tests/lodge_test.tscn --write-movie out.avi --fixed-fps 30

var t := -3.0
var _done := {}
var _b: Node3D
var _anchor := Vector3.ZERO
var _view: Camera3D


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 11.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 0.0):
		_b = Game.bots[0]
		_b.ai.process_mode = Node.PROCESS_MODE_DISABLED
		_b.move_velocity = Vector3.ZERO
		_b.facing = Vector3.BACK
		var off: Vector3 = Vector3(0, 0, 5) - _b.position_ground()
		for part in _b.parts:
			part.global_position += off
			part.linear_velocity = Vector3.ZERO
			part.reset_physics_interpolation()
			part.collision_mask &= ~Game.LAYER_PLAYER
		p.collision_mask &= ~Game.LAYER_BOTS
		p._switch_to("chainsaw")
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
	if _b == null:
		return
	# He does not feel it (so he does not fold up and slide off): this is
	# about the blade holding him.
	_b.pain = 0.0
	_b.shock = 0.0
	_b._flinch = 0.0
	_b.bleed_rate = 0.0
	_b.leg_health["r"] = 1.0
	var th: RigidBody3D = _b.parts[_b.part_index["thigh_r"]]
	var saw = p._item_model
	if saw == null or not saw.has_method("bar_root"):
		return
	var across: Vector3 = saw.global_basis.y
	if t < 1.5:
		_anchor = th.global_position
	# In from above the flat blade's plane... the blade is flat, so "across"
	# is horizontal: in from the front, to the middle of the thigh.
	var goal := _anchor
	if t < 4.0:
		goal += across * lerpf(0.2, 0.0, clampf((t - 1.5) / 2.0, 0.0, 1.0))
	elif t < 7.5:
		# Lifted and carried back.
		var k := clampf((t - 4.5) / 2.5, 0.0, 1.0)
		goal += Vector3.UP * 0.35 * k + Vector3.BACK * 0.6 * k
	else:
		# Drawn back out the way it went in.
		var k := clampf((t - 7.5) / 1.0, 0.0, 1.0)
		goal += Vector3.UP * 0.35 + Vector3.BACK * 0.6 + across * 0.3 * k
	_drive(p, goal, 0.0, -0.9, PI * 0.5)
	_view.global_position = _b.pelvis.global_position + Vector3(1.6, 0.3, 0.9)
	_view.look_at(_b.pelvis.global_position + Vector3(0, -0.1, 0.3))
	if _once("fire", 1.2):
		Input.action_press("fire")
	if _once("stop", 3.8):
		Input.action_release("fire")
	if int(t * 2) != int((t - delta) * 2) and t > 1.0:
		print("t=%.1f cuts=%d hold=%.2f in=%d thigh=%s pelvis_y=%.2f goal=%s" % [t, p._saw.cuts.size() if p._saw else -1,
				p._saw.hold if p._saw else 0.0, p._saw.in_flesh.size() if p._saw else 0, th.global_position, _b.pelvis.global_position.y, goal])


## Moves the player across the ground and tilts the view up or down until
## the middle of the bar is on `goal` (height comes from the tilt: lifting
## the saw is looking up with it).
func _drive(p, goal: Vector3, yaw: float, pitch0: float, roll: float) -> void:
	p.velocity = Vector3.ZERO
	p.yaw = lerp_angle(p.yaw, yaw, 0.2)
	p._saw_roll = roll
	var saw = p._item_model
	var mid: Vector3 = (saw.bar_root() as Vector3).lerp(saw.bar_nose(), 0.6)
	var err := goal - mid
	if t < 1.0:
		p.pitch = pitch0
	p.pitch = clampf(p.pitch + err.y * 0.25, -1.4, 1.2)
	p.global_position += Vector3(err.x, 0.0, err.z) * 0.2


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
