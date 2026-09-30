extends Node
## Dev test: the player's spray can - a wavy line on a wall and on the road.
## Usage: godot --path . res://tests/spray_test.tscn -- <out_dir>

var t := -3.0
var _done := {}
var out := "user://"
var _wall := Vector3.ZERO


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 7.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 0.0):
		# A wall: look along -X from the start until something is hit.
		p.global_position = Vector3(3.0, 0.1, -1.5)
		p._switch_to("spraycan")
		# Walk up to the wall ahead (stop 0.9 m short).
		var fwd := -Basis(Vector3.UP, 0.15).z
		var from: Vector3 = p.global_position + Vector3.UP * 1.5
		var hit := {}
		if not hit.is_empty():
			p.global_position = (hit.position as Vector3) - fwd * 0.9
			p.global_position.y = 0.1
			print("wall at ", hit.position)
	if t > 1.0 and t < 4.5:
		p._spray_tick(delta, true)
		var k := (t - 1.0) / 3.5
		p.yaw = 0.15 + sin(k * TAU * 1.5) * 0.35
		p.pitch = -0.75 - k * 0.2
		if int(t * 2) != int((t - delta) * 2):
			print("spraying fps=", Engine.get_frames_per_second())
	elif t >= 4.5:
		p._spray_tick(delta, false)
		p.yaw = 0.15
		p.pitch = -0.8


func _process(_d: float) -> void:
	if t > 5.5 and not _done.has("shot"):
		_done["shot"] = true
		get_viewport().get_texture().get_image().save_png(out + "/spray.png")
		print("perf fps=", Engine.get_frames_per_second(), " puffs=", Game.player._spray_n, " decals=", load("res://scripts/world/graffiti.gd").all.size())


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
