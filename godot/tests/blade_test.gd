extends Node
## Dev test: a bare blade (blade_cut.gd) on a scripted path, no player: flat,
## from the front halfway into a thigh, then stopped (no cutting), lifted,
## carried sideways along the bar, and drawn back out the way it came.
## Log of where the man goes.
## Usage: godot --path . res://tests/blade_test.tscn --write-movie out.avi --fixed-fps 30

const BladeCut = preload("res://scripts/weapons/blade_cut.gd")

var t := -3.0
var _done := {}
var _b: Node3D
var _cut: BladeCut
var _c0 := Vector3.ZERO
var _view: Camera3D
var _mesh: MeshInstance3D


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 10.0:
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
		p.global_position = Vector3(3, 0.1, 9)
		_cut = BladeCut.new()
		_cut.half = 0.035
		_cut.strength = 900.0
		_cut.limit = func(st: Dictionary, want: float, dt: float) -> float:
			return minf(want, 0.14 * dt)
		_cut.on_through = func(body: RigidBody3D, point: Vector3, normal: Vector3) -> void:
			print("THROUGH ", body.get_meta("part"))
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
		_mesh = MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.44, 0.008, 0.07)
		_mesh.mesh = bm
		add_child(_mesh)
	if _b == null or t < 0.5:
		return
	var th: RigidBody3D = _b.parts[_b.part_index["thigh_r"]]
	if t < 1.0:
		_c0 = th.global_position
	# The blade: flat, lying along x across the right thigh only, its middle
	# at `c`; in from the front (+z).
	var c := _c0 + Vector3(0, 0, 0.16)
	if t > 1.0:
		c.z -= 0.16 * clampf((t - 1.0) / 1.8, 0.0, 1.0)                 # halfway in
	if t > 3.5:
		c += Vector3.UP * 0.35 * clampf((t - 3.5) / 1.5, 0.0, 1.0)      # lifted
	if t > 5.5:
		c.x -= 0.4 * clampf((t - 5.5) / 1.5, 0.0, 1.0)                 # along the bar
	if t > 7.5:
		c.z += 0.3 * clampf((t - 7.5) / 1.0, 0.0, 1.0)                 # back out
	var a := c + Vector3(0.1, 0, 0)
	var b := c + Vector3(-0.34, 0, 0)
	_cut.cutting = t < 3.2
	_cut.grip = 0.15 if _cut.cutting else 1.0
	_cut.step(get_viewport().world_3d.direct_space_state, a, b, Vector3.UP, delta)
	_mesh.global_position = a.lerp(b, 0.5)
	_view.global_position = _b.pelvis.global_position + Vector3(1.4, 0.2, 1.4)
	_view.look_at(_b.pelvis.global_position + Vector3(0, -0.2, 0))
	if int(t * 2) != int((t - delta) * 2):
		var st := ""
		for k in _cut.cuts:
			var s: Dictionary = _cut.cuts[k]
			st += "%s[%.3f..%.3f of %.3f..%.3f] " % [s["kind"], s["lo"], s["hi"], s["min"], s["max"]]
		print("t=%.1f in=%d hold=%.2f thigh=%s pelvis=%s blade=%s %s" % [t, _cut.in_flesh.size(), _cut.hold, th.global_position, _b.pelvis.global_position, c, st])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
