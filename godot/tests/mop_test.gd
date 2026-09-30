extends Node
## Dev test: blood on the floor, the table and a chair; mopped wet (it comes
## up), then with a dry mop (it smears). Screenshots.
## Usage: godot --path . res://tests/mop_test.tscn -- <out_dir>
var t := -3.0
var out := "user://"
var _done := {}
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
func _shot(n: String) -> void:
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, n])
func _physics_process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.main.weather == null or Game.blood == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if not _done.has("setup"):
		_done["setup"] = true
		p.global_position = Vector3(4.2, 0.2, -8.9)
		p.yaw = 0.0
		p.pitch = -0.75
		p.inventory.add("mop", 1)
		p._switch_to("mop")
		for k in 5:
			Game.blood._add_pool(Vector3(3.9 + k * 0.15, 0.15, -10.1 + (k % 2) * 0.12), Vector3.UP, 180.0)
		# Blood splashed over the table and a chair.
		var none: Array[RID] = []
		Game.blood._spray(Vector3(7.0, 1.4, -11.0), Vector3.DOWN, 40.0, 1.0, 2.5, 40, 60.0, none)
		Game.blood._spray(Vector3(7.9, 1.2, -11.0), Vector3.DOWN, 30.0, 1.0, 2.0, 25, 30.0, none)
	if t < 12.0:
		p.pitch = -0.75
	else:
		p.pitch = -0.45
	if t > 2.0 and not _done.has("a"):
		_done["a"] = true
		_shot("mop_a_before")
	if t > 2.0 and t < 7.0:
		Input.action_press("fire")
		p._fire_blocked = false
	if t > 7.0 and not _done.has("b"):
		_done["b"] = true
		Input.action_release("fire")
		_shot("mop_b_wet")
		print("water=%.2f dirt=%.2f" % [p._mop_water, p._mop_dirt])
		for k in 4:
			Game.blood._add_pool(Vector3(4.0 + k * 0.2, 0.15, -10.0), Vector3.UP, 150.0)
		p._mop_water = 0.0
	if t > 8.0 and t < 12.0:
		Input.action_press("fire")
		p._fire_blocked = false
	if t > 12.0 and not _done.has("c"):
		_done["c"] = true
		Input.action_release("fire")
		_shot("mop_c_dry")
		p.global_position = Vector3(6.0, 0.2, -9.2)
		p.yaw = -0.51
		p.pitch = -0.45
	if t > 13.0 and not _done.has("d"):
		_done["d"] = true
		p._switch_to("hands")
	if t > 14.0 and not _done.has("e"):
		_done["e"] = true
		_shot("mop_d_table")
		get_tree().quit()
