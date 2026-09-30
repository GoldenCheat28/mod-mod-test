extends RigidBody3D
## Thrown fragmentation grenade (F1-style): rolls and bounces as a physics
## object and goes off when its fuse runs out.

const Explosion = preload("res://scripts/weapons/explosion.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")

var fuse := 3.5
var _clink := 0.0


## The grenade body: a ribbed, dark-olive egg with the fuse on top (+Y).
static func model() -> Node3D:
	var root := Node3D.new()
	var body := StandardMaterial3D.new()
	body.albedo_color = Color(0.2, 0.24, 0.14)
	body.roughness = 0.7
	body.normal_enabled = true
	body.normal_texture = preload("res://scripts/world/textures.gd").detail_normal()
	body.normal_scale = 1.2
	body.uv1_triplanar = true
	body.uv1_scale = Vector3.ONE * 30.0
	var metal := StandardMaterial3D.new()
	metal.albedo_color = Color(0.5, 0.5, 0.48)
	metal.metallic = 0.8
	metal.roughness = 0.4
	var egg := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.028
	s.height = 0.07
	s.radial_segments = 14
	s.rings = 8
	egg.mesh = s
	egg.material_override = body
	root.add_child(egg)
	# Segment grooves.
	for i in 4:
		var ring := MeshInstance3D.new()
		var t := TorusMesh.new()
		t.inner_radius = 0.0265
		t.outer_radius = 0.0295
		t.rings = 14
		t.ring_segments = 4
		ring.mesh = t
		ring.material_override = body
		ring.position.y = -0.021 + i * 0.014
		ring.scale = Vector3.ONE * (1.0 - absf(i - 1.5) * 0.12)
		root.add_child(ring)
	var fz := MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = 0.008
	c.bottom_radius = 0.009
	c.height = 0.022
	fz.mesh = c
	fz.material_override = metal
	fz.position.y = 0.043
	root.add_child(fz)
	var lever := MeshInstance3D.new()
	var lb := BoxMesh.new()
	lb.size = Vector3(0.008, 0.06, 0.003)
	lever.mesh = lb
	lever.material_override = metal
	lever.name = "Lever"
	lever.position = Vector3(0.0, 0.028, 0.028)
	lever.rotation.x = -0.25
	root.add_child(lever)
	for m in root.get_children():
		(m as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	return root


static func throw(parent: Node, xf: Transform3D, vel: Vector3, spin: Vector3, fuse_left := 3.5) -> RigidBody3D:
	var g = load("res://scripts/weapons/grenade.gd").new()
	g.fuse = fuse_left
	parent.add_child(g)
	g.global_transform = xf
	g.linear_velocity = vel
	g.angular_velocity = spin
	return g


func _ready() -> void:
	collision_layer = Game.LAYER_DEBRIS
	collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS | Game.LAYER_BOTS
	mass = 0.6
	continuous_cd = true
	angular_damp = 0.6
	contact_monitor = true
	max_contacts_reported = 2
	var pm := PhysicsMaterial.new()
	pm.bounce = 0.3
	pm.friction = 0.6
	physics_material_override = pm
	var m := model()
	var lever := m.get_node_or_null("Lever")
	if lever:
		lever.queue_free()    # the spoon flew off when it was thrown
	add_child(m)
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = 0.03
	cs.shape = sh
	add_child(cs)
	body_entered.connect(_on_hit)


func _on_hit(_b: Node) -> void:
	if _clink <= 0.0 and linear_velocity.length() > 1.0:
		_clink = 0.15
		Game.play_3d(Sfx.get_stream(&"casing"), global_position, -6.0, 0.2, 3.0)


func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["grenade._physics_process"] = Game.prof.get("grenade._physics_process", 0) + __d
	Game.prof["max grenade._physics_process"] = maxi(Game.prof.get("max grenade._physics_process", 0), __d)


func _physics_process_real(delta: float) -> void:
	_clink -= delta
	fuse -= delta
	if fuse <= 0.0:
		var ex: Array[RID] = [get_rid()]
		Explosion.explode(get_tree(), global_position + Vector3.UP * 0.05, 1.0, 1.0, ex)
		queue_free()
