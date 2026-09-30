extends RigidBody3D
## Something thrown out of the bag, lying in the world as a physical thing
## (its own model), to be picked up again (F). Guns go out as pickup.gd
## instead, so the bots can take them.

const Icons = preload("res://scripts/ui/item_icons.gd")
const Items = preload("res://scripts/game/items.gd")

var id := ""
var count := 1
var kind := ""                   # (as pickup.gd: what a bot takes it for)
var model: Node3D
var claimed_by: Node = null
## Things a bot can pick up and use: weapons and grenades.
const ARMS := ["revolver", "machete", "chainsaw", "grenade"]


static func spawn(parent: Node, item_id: String, n: int, xf: Transform3D, vel: Vector3) -> RigidBody3D:
	var d = load("res://scripts/game/item_drop.gd").new()
	d.id = item_id
	d.count = n
	parent.add_child(d)
	d.global_transform = xf
	d.linear_velocity = vel
	d.angular_velocity = Vector3(randf_range(-3, 3), randf_range(-3, 3), randf_range(-3, 3))
	return d


func _ready() -> void:
	collision_layer = Game.LAYER_PROPS
	collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
	mass = maxf(float(Items.def(id)["weight"]), 0.05)
	continuous_cd = true
	var maker = Icons.new()
	var mdl: Node3D = maker._model(id)
	maker.free()
	if mdl is RigidBody3D:
		# (the machete is a body of its own: just its looks)
		var looks := Node3D.new()
		for c in mdl.get_children():
			if c is MeshInstance3D:
				c.get_parent().remove_child(c)
				looks.add_child(c)
		mdl.free()
		mdl = looks
	add_child(mdl)
	model = mdl
	kind = id
	if id in ARMS:
		Game.pickups.append(self)
	var box := AABB()
	var first := true
	for m in mdl.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh:
			var b := mi.transform * mi.get_aabb()
			var p := mi.get_parent()
			while p != mdl and p is Node3D:
				b = (p as Node3D).transform * b
				p = p.get_parent()
			# (and the model's own turn: the mop lies along its handle)
			b = mdl.transform * b
			box = b if first else box.merge(b)
			first = false
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = box.size.max(Vector3.ONE * 0.02)
	cs.shape = bs
	cs.position = box.get_center()
	add_child(cs)
	set_meta("item", id)
	Net.register_prop(self)


## A bot picking it up: the model goes to him, this goes.
func take() -> Node3D:
	Game.pickups.erase(self)
	Net.prop_taken(self)
	remove_child(model)
	queue_free()
	return model


func _exit_tree() -> void:
	Game.pickups.erase(self)
	Net.unregister_prop(self)
