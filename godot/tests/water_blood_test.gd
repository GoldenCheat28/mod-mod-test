extends Node
## Dev test: blood spilled into an indoor puddle and onto dry floor next to it.
## Usage: godot --path . res://tests/water_blood_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}
var _none: Array[RID] = []
const SPOT := Vector3(-4, 0.15, -18.5)


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 30.0:
		get_tree().quit()
	var p = Game.player
	if p == null:
		return
	p.global_position = SPOT + Vector3(0, 0, 2.2)
	p.velocity = Vector3.ZERO
	p.yaw = 0.0
	p.pitch = -0.75
	if t > 4.0 and t < 7.0 and Game.blood:
		for i in 3:
			var at := SPOT + Vector3(randf_range(-0.6, 0.6), 1.0, randf_range(-0.3, 0.6))
			Game.blood.spawn_drop(at, Vector3(randf_range(-2, 2), -2.0, randf_range(-2, 2)), randf_range(0.05, 1.2))
		Game.blood.spawn_drop(SPOT + Vector3(0.9, 0.3, 1.1), Vector3.DOWN, 0.6, _none, 0.0, true)


func _process(_d: float) -> void:
	_snap(7.5, "water_fresh")
	_snap(28.0, "water_later")


func _snap(at: float, name_: String) -> void:
	if t >= at and not _done.has(name_):
		_done[name_] = true
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name_])
