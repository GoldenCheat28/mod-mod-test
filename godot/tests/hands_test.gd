extends Node
## Dev test: how far each hand's wrist ends up from where it should hold the
## gun (IK reach), per weapon, with and without the body cam. Optional pictures.
## Usage: godot --path . res://tests/hands_test.tscn [-- <out_dir>]

const KINDS := ["pistol", "shotgun", "akm", "revolver", "sawnoff", "rifle"]
var t := 0.0
var idx := 0
var phase := 0
var out := ""


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	var p = Game.player
	if p == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if idx >= KINDS.size() * 2:
		get_tree().quit()
		return
	var k: String = KINDS[idx % KINDS.size()]
	Game.bodycam = idx >= KINDS.size()
	if phase == 0:
		p.global_position = Vector3(0, 0.3, 10)
		p.pitch = 0.0
		p._last_switch = -99.0
		if p.inventory and p.HELD_ITEM.has(k):
			p.inventory.add(p.HELD_ITEM[k], 1)
		p._switch_to(k)
		phase = 1
		t = 0.0
	elif phase == 1 and t > 1.6:
		var b = p._body
		var w = p.current
		var msg := "%s bodycam=%s " % [k, Game.bodycam]
		if w and w.kind == k:
			for side in ["r", "l"]:
				var sh: Vector3 = b.pts["shoulder_" + side]
				var wr: Vector3 = b.pts["wrist_" + side]
				var tg: Vector3 = b.pts["target_" + side]
				msg += "%s: reach=%.3f gap=%.3f " % [side, sh.distance_to(wr), wr.distance_to(tg)]
			msg += "eye_y=%.2f shoulder_l_y=%.2f" % [p.cam.global_position.y - p.global_position.y, b.pts["shoulder_l"].y - p.global_position.y]
		else:
			msg += "(not equipped: %s)" % (w.kind if w else "none")
		print(msg)
		if out != "":
			get_viewport().get_texture().get_image().save_png("%s/%s_%d.png" % [out, k, int(Game.bodycam)])
		idx += 1
		phase = 0
