extends Node
## Dev test: the bag. Opened (screenshot), things moved and turned
## (screenshot), the bomb thrown out onto the ground and picked up again (F),
## the pistol thrown out and then asked for (it should say it is not there).
## Usage: godot --path . res://tests/inventory_test.tscn -- <out_dir>

var out := "user://"
var t := -3.0
var _done := {}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 14.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	var inv = p.inventory
	if _once("pose", 0.0):
		p.global_position = Vector3(0, 0.1, 6)
		p.yaw = 0.0
		p.pitch = -0.1
	if _once("open", 1.0):
		p._inv_ui.toggle()
		print("items: ", inv.items.map(func(it): return "%s@%s%s x%d" % [it["id"], it["pos"], " R" if it["rot"] else "", it["count"]]))
		print("weight: %.2f" % inv.weight())
	if _once("move", 4.0):
		var gren: Dictionary = {}
		var mach: Dictionary = {}
		for it in inv.items:
			if it["id"] == "grenade" and gren.is_empty():
				gren = it
			if it["id"] == "machete":
				mach = it
		var room = inv.find_room("machete")
		print("move machete turned: ", inv.move(mach, Vector2i(9, 0), true) if inv.fits(Vector2i(1, 3), Vector2i(9, 0), mach) else "no room at 9,0")
		print("move grenade onto AKM (should fail): ", inv.move(gren, Vector2i(0, 0), false))
	if _once("drop", 6.0):
		for it in inv.items:
			if it["id"] == "bomb":
				p._drop_item(it)
				break
		print("bomb after drop: ", inv.count("bomb"))
		p._inv_ui.toggle()
	if t > 6.2 and t < 8.5:
		# Look at where the bomb came to rest.
		for n in p.get_parent().get_children():
			if n.has_meta("item"):
				var d: Vector3 = (n as Node3D).global_position - p.cam.global_position
				p.yaw = atan2(-d.x, -d.z)
				p.pitch = atan2(d.y, Vector2(d.x, d.z).length())
	if _once("pickup", 8.0):
		var q := PhysicsRayQueryParameters3D.create(p.cam.global_position, p.cam.global_position - p.cam.global_basis.z * 2.4, Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS)
		var hit := p.get_world_3d().direct_space_state.intersect_ray(q)
		print("looking at: ", hit.collider.get_meta("item") if not hit.is_empty() and hit.collider.has_meta("item") else hit.get("collider"))
		p._pick_up()
		print("bomb after pickup: ", inv.count("bomb"))
	if _once("nopistol", 9.5):
		p.pitch = -0.1
		for it in inv.items:
			if it["id"] == "pistol":
				p._drop_item(it)
				break
		print("pistol in bag: ", inv.has("pistol"), " current: ", p.current)
	if _once("ask", 11.0):
		p._switch_to("pistol")
		print("note: ", p._note.text)


func _process(_d: float) -> void:
	_snap(3.5, "inv_open")
	_snap(5.0, "inv_moved")
	_snap(7.5, "dropped")
	_snap(11.3, "no_pistol")


func _snap(at: float, name_: String) -> void:
	if t >= at and not _done.has(name_):
		_done[name_] = true
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name_])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
