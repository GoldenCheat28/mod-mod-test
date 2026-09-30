extends Node3D
## The air smoke goes into (see smoke_field.gd): smoke let out anywhere joins
## the box of air already there, or a new one is made for it; boxes that have
## cleared are dropped. Also keeps the light and the breeze the smoke sees.

const SmokeField = preload("res://scripts/fx/smoke_field.gd")
const MAX_FIELDS := 10

var sun_dir := Vector3(0.5, 0.8, 0.3)
var sun_col := Vector3(1.0, 0.96, 0.9)
var ambient := Vector3(0.55, 0.58, 0.62)
var wind := Vector3(0.12, 0.0, 0.05)
var _fields: Array = []


## Lets out smoke (see SmokeField.add).
func add(pos: Vector3, amount: float, radius: float, vel := Vector3.ZERO) -> void:
	var f := _field_at(pos)
	if f:
		f.add(pos, amount, radius, vel)


func _field_at(pos: Vector3) -> Node:
	for f in _fields:
		if is_instance_valid(f) and f.contains(pos):
			return f
	if _fields.size() >= MAX_FIELDS:
		# The emptiest goes.
		var least: Node = _fields[0]
		for f in _fields:
			if f.total < least.total:
				least = f
		_fields.erase(least)
		least.queue_free()
	var f := SmokeField.new()
	f.air = self
	add_child(f)
	# Smoke goes up: most of the box is above where it comes out.
	f.global_position = pos + Vector3.UP * (SmokeField.size().y * 0.5 - 0.5)
	_fields.append(f)
	return f


func _process(delta: float) -> void:
	# The light: from the sun and sky as they are now (weather changes them).
	var main = Game.main
	if main and main.weather and main.weather.sun:
		var sun: DirectionalLight3D = main.weather.sun
		sun_dir = sun.global_basis.z.normalized()
		var e := sun.light_energy * (1.0 if sun.visible else 0.0)
		sun_col = Vector3(sun.light_color.r, sun.light_color.g, sun.light_color.b) * e * 0.8
		var amb: float = main.weather.env.ambient_light_energy
		ambient = Vector3(0.5, 0.53, 0.58) * amb * (1.0 - 0.3 * main.weather.storm)
		# A breeze that picks up with bad weather and wanders.
		var t := Game.clock
		wind = Vector3(sin(t * 0.05), 0.0, cos(t * 0.037)).normalized() * (0.1 + 0.5 * main.weather.storm)
	for f in _fields.duplicate():
		if not is_instance_valid(f):
			_fields.erase(f)
		elif f.is_clear():
			_fields.erase(f)
			f.queue_free()
