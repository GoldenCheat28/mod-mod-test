extends Node
## Dev test: the furnished rooms (screenshots), sitting on a chair, and
## sleeping on a bed (the hour before and after).
## Usage: godot --path . res://tests/furniture_shots.tscn -- <out_dir>   (BODYCAM=1 for the time lapse)

const Furniture = preload("res://scripts/world/furniture.gd")
var out := "user://"
var t := 0.0
var _done := {}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	if OS.get_environment("BODYCAM") != "":
		Game.bodycam = true
	add_child(load("res://scenes/main.tscn").instantiate())


func _shot(n: String) -> void:
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, n])
	print("saved ", n)


func _once(k: String, at: float) -> bool:
	if t < at or _done.has(k):
		return false
	_done[k] = true
	return true


func _process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.main == null or Game.main.day_night == null:
		return
	if _once("win", 0.2):
		get_window().size = Vector2i(1600, 900)
	if t < 5.0:
		p.global_position = Vector3(4.2, 3.45, -15.0)
		p.yaw = PI + 0.5
		p.pitch = -0.25
	if _once("room", 5.0):
		_shot("furn_flat")
	if t > 5.0 and t < 6.5:
		p.global_position = Vector3(-6.0, 3.45, -15.5)
		p.yaw = PI * 0.25
		p.pitch = -0.3
	if _once("west", 6.5):
		_shot("furn_west")
		var s: Dictionary = Furniture.seats[0]
		var sb := StaticBody3D.new()
		sb.set_meta("seat", s)
		p._sit_on(sb, s["pos"])
		sb.free()
	if _once("sit", 7.5):
		_shot("furn_sitting")
		print("RESULT seated=", p.seat_at != Vector3.INF, " hour_before=", Game.main.day_night.hour)
		p.seat_at = Vector3.INF
		p._sleep_on(Furniture.beds[0])
	if _once("sleeping", 9.0):
		_shot("furn_sleep")
	if _once("after", 12.0):
		print("RESULT hour_after=", Game.main.day_night.hour, " sleeping=", not p._sleep.is_empty(), " ragdoll=", p._ragdoll != null)
		_shot("furn_after")
	if t > 13.0:
		get_tree().quit()
