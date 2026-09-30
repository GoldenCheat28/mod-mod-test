extends RigidBody3D
## A gun lying in the world as a physics object. Bots that see it may go and
## pick it up; a bot that goes down drops it again.

const Models = preload("res://scripts/weapons/weapon_models.gd")

var kind := "pistol"
var model: Node3D
var claimed_by: Node = null


static func spawn(parent: Node, what: String, xf: Transform3D, vel: Vector3, existing: Node3D = null) -> RigidBody3D:
	var p = load("res://scripts/weapons/pickup.gd").new()
	p.kind = what
	p.model = existing if existing else {"pistol": Models.pistol, "akm": Models.akm}.get(what, Models.shotgun).call()
	parent.add_child(p)
	p.global_transform = xf
	p.linear_velocity = vel
	p.angular_velocity = Vector3(randf_range(-3, 3), randf_range(-3, 3), randf_range(-3, 3))
	return p


func _ready() -> void:
	collision_layer = Game.LAYER_PROPS
	collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
	mass = {"pistol": 0.9, "akm": 3.6}.get(kind, 3.2)
	continuous_cd = true
	set_meta("surface", "metal")
	if model.get_parent():
		model.get_parent().remove_child(model)
	model.transform = Transform3D.IDENTITY
	add_child(model)
	var box := _bounds(model)
	var cs := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = box.size.max(Vector3.ONE * 0.02)
	cs.shape = shape
	cs.position = box.get_center()
	add_child(cs)
	Game.pickups.append(self)
	Net.register_prop(self)
	var pm := PhysicsMaterial.new()
	pm.friction = 0.8
	pm.bounce = 0.15
	physics_material_override = pm


## Bounding box of all meshes under n, in n's space.
func _bounds(n: Node3D) -> AABB:
	var box := AABB()
	var first := true
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if m.mesh == null:
			continue
		var rel := n.global_transform.affine_inverse() * m.global_transform if n.is_inside_tree() else _relative(n, m)
		var b := rel * m.mesh.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box


func _relative(root: Node3D, n: Node3D) -> Transform3D:
	var xf := Transform3D.IDENTITY
	var cur: Node = n
	while cur and cur != root:
		xf = (cur as Node3D).transform * xf
		cur = cur.get_parent()
	return xf


## Hands the gun model over (it leaves this body) and removes the pickup.
func take() -> Node3D:
	Game.pickups.erase(self)
	Net.prop_taken(self)
	remove_child(model)
	queue_free()
	return model


func _exit_tree() -> void:
	Game.pickups.erase(self)
	Net.unregister_prop(self)
