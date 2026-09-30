extends Node
## Dev test: machete blows on a standing man - a light one, a medium one and
## a full one - then a full blow into a door. Log (what was cut, whether it
## stuck) and a video. CAM=side films from the side (else the player's eyes).
## Usage: godot --path . res://tests/machete_test.tscn --write-movie out.avi --fixed-fps 30

var t := -3.0
var _done := {}
var _b: Node3D
var _view: Camera3D
# [start, hold time, yaw offset, pitch]: aimed at the left shoulder, then
# the right forearm... (yaw turns the blow a little to one side)
var blows := [
	[3.0, 0.1, 0.25, -0.55],
	[5.5, 0.3, 0.0, -0.55],
	[8.0, 0.6, -0.3, -0.55],
]


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
		p._switch_to("machete")
		# On his knees, cuffed: he stays put to be hit.
		_b.set_cuffed(true)
		_b.ai.process_mode = Node.PROCESS_MODE_INHERIT
		_b.ai.kneel = true
		if OS.get_environment("CAM") == "side":
			_view = Camera3D.new()
			add_child(_view)
			_view.make_current()
	if _b == null:
		return
	p.velocity = Vector3.ZERO
	if t < 2.0:
		p.global_position = Vector3(0.0, 0.1, 6.2)
	for bl in blows:
		if t > bl[0] - 0.8 and t < bl[0]:
			# Step up to him, wherever he has got to.
			var c: Vector3 = _b.chest.global_position
			p.global_position = p.global_position.lerp(Vector3(c.x, 0.1, c.z + 0.5), 0.3)
		if t > bl[0] - 0.5 and t < bl[0] + 2.0:
			p.yaw = lerp_angle(p.yaw, bl[2], 0.2)
			p.pitch = lerpf(p.pitch, bl[3], 0.2)
		if _once("press%s" % bl[0], bl[0]):
			Input.action_press("fire")
		if _once("release%s" % bl[0], bl[0] + bl[1]):
			Input.action_release("fire")
	if _view:
		_view.global_position = _b.chest.global_position + Vector3(1.3, 0.1, 0.5)
		_view.look_at(_b.chest.global_position + Vector3(0, -0.1, 0.35))
	var m = p._item_model
	if m and p._mach_cut and int(t * 4) != int((t - delta) * 4) and t > 0.5:
		var pieces := 0
		for c in Game.main.get_children():
			if c is RigidBody3D and c.has_meta("piece"):
				pieces += 1
		var st := ""
		for k in p._mach_cut.cuts:
			var s: Dictionary = p._mach_cut.cuts[k]
			st += "%s[%.3f..%.3f/%.3f..%.3f] " % [s["kind"], s["lo"], s["hi"], s["min"], s["max"]]
		print("t=%.2f theta=%.2f v=%.1f in=%d hold=%.2f stuck=%s pieces=%d alive=%s %s" % [t, p._mach_theta,
				m.linear_velocity.length(), p._mach_cut.in_flesh.size(), p._mach_cut.hold, m.stuck, pieces, _b.alive, st])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
