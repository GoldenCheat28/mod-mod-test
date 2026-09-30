extends Node
## Dev test: the player shot in the leg and the arm - blood soaking the
## clothes, dripping; then the leg bandaged (squatting, looking at it).
## Usage: godot --path . res://tests/wound_test.tscn -- <out_dir>

var t := -3.0
var _done := {}
var out := "user://"


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 17.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("setup", 0.0):
		p.global_position = Vector3(3.0, 0.1, -1.5)
		p.yaw = 1.4
		p._switch_to("hands")
		p.vitals._at_part = "thigh_r"
		p.vitals._wound("leg", false, 1.0)
		p.vitals._at_part = "forearm_l"
		p.vitals._wound("chest", false, 1.0)
		p.vitals._at_part = ""
		p.vitals.wounds[0]["rate"] = 7.0
		p.vitals.wounds[0]["soak"] = 150.0
		p.vitals.wounds[1]["soak"] = 90.0
		p.vitals.wounds[1]["rate"] = 3.0
		p.vitals.bleed = 10.0
		print("wounds: ", p.vitals.wounds)
	if t < 7.0:
		p.pitch = -1.3
	if _once("bandage", 7.0):
		p.inventory.add("bandage", 1)
		p._start_bandage()
		print("target: ", p._bandage_w)
	if int(t) != int(t - delta):
		print("t=%d bleed=%.1f leg=%.2f soak=%s" % [t, p.vitals.bleed, p.vitals.leg, p.vitals.wounds.map(func(w): return int(w["soak"]))])


func _process(_d: float) -> void:
	for s in [[6.5, "wound_look"], [9.5, "wound_bandaging"], [13.0, "wound_after"]]:
		if t >= s[0] and not _done.has(s[1]):
			_done[s[1]] = true
			if s[1] == "wound_after":
				Game.player.pitch = -1.3
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, s[1]])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
