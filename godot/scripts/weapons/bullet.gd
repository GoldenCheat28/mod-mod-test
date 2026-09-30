extends Node
## A bullet in flight: it leaves the muzzle at the gun's speed, drops, and
## slows in the air - a pistol round a few metres a hundred metres out, a
## rifle round hardly at all, buckshot quickly - and reaches far things a
## moment after the shot. Each physics tick it covers its bit of the arc,
## and what it meets on the way is worked out by the gun that fired it
## (weapon.gd _trace_seg: what it hits, what it goes through).

var weapon: Node3D
var pos := Vector3.ZERO
var vel := Vector3.ZERO
var power := 0.3                 # what it can still get through (m of concrete)
var start_power := 0.3
var drag := 0.1                  # speed lost per second, as a fraction
var exclude: Array[RID] = []
var _life := 3.0


func _physics_process(delta: float) -> void:
	step(get_viewport().world_3d.direct_space_state, delta)


func step(space: PhysicsDirectSpaceState3D, dt: float) -> void:
	if not is_instance_valid(weapon):
		queue_free()
		return
	var v0 := vel
	vel += Vector3.DOWN * 9.8 * dt
	vel *= maxf(1.0 - drag * dt, 0.0)
	var d := (v0 + vel) * 0.5 * dt
	var l := d.length()
	if l < 1e-4:
		queue_free()
		return
	var r: Dictionary = weapon._trace_seg(space, pos, d / l, l, exclude, power, start_power)
	Game.bullet_passed.emit(pos, r["pos"])
	pos = r["pos"]
	power = r["power"]
	_life -= dt
	if r["done"] or _life <= 0.0 or vel.length() < 50.0 or pos.y < -50.0:
		queue_free()
