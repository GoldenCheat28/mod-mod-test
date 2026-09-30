extends Node
## Dev test: picking up a thing off the ground - the hand out to it, the
## thing in the hand, put away in the bag. Logs and (with an out dir) frames.
## Usage: godot --path . res://tests/pickup_test.tscn [-- <out_dir>]

var out := ""
var t := -1.0
var _item: Node3D
var _before := 0
var _frames := [0.2, 0.4, 0.6, 0.85]


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	var p = Game.player
	if p == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	if not has_meta("spawned"):
		set_meta("spawned", true)
		p.global_position = Vector3(0, 0.3, 10)
		p.yaw = 0.0
		var at: Vector3 = Vector3(0.1, 0.1, 9.05)
		_item = load("res://scripts/game/item_drop.gd").spawn(Game.main, "bandage", 1, Transform3D(Basis(), at), Vector3.ZERO)
		_before = p.inventory.count("bandage") if p.inventory.has_method("count") else 0
		t = -1.0
		return
	t += delta
	if t < 0.0 and is_instance_valid(_item):
		var to: Vector3 = _item.global_position - p.cam.global_position
		p.pitch = atan2(to.y, Vector2(to.x, to.z).length())
		p.yaw = atan2(-to.x, -to.z)
		return
	if not has_meta("picked"):
		set_meta("picked", true)
		var from: Vector3 = p.cam.global_position
		var q := PhysicsRayQueryParameters3D.create(from, from - p.cam.global_basis.z * 2.4, Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS)
		q.exclude = [p.get_rid()]
		var hit: Dictionary = p.get_world_3d().direct_space_state.intersect_ray(q)
		print("cam=", from, " item=", _item.global_position, " hit=", hit.get("collider"), " pitch=", p.pitch, " cam_fwd=", -p.cam.global_basis.z)
		p._pick_up()
		print("pickup started: anim=", not p._pickup.is_empty())
		return
	if not p._pickup.is_empty():
		var m: Node3D = p._pickup["model"]
		var w: Vector3 = p._body.pts.get("wrist_l", Vector3.ZERO)
		var hand: Vector3 = p._pickup_hand()
		print("t=%.2f model=%s hand_target=%s wrist_gap=%.3f" % [p._pickup["t"], m.global_position, hand, w.distance_to(hand)])
		if out != "" and _frames.size() > 0 and float(p._pickup["t"]) > _frames[0]:
			get_viewport().get_texture().get_image().save_png("%s/pick_%.2f.png" % [out, _frames.pop_front()])
	elif t > 2.0:
		var after: int = p.inventory.count("bandage") if p.inventory.has_method("count") else -1
		print("done: in bag before=%d after=%d item_gone=%s" % [_before, after, not is_instance_valid(_item)])
		get_tree().quit()
