extends RigidBody3D
## A Molotov cocktail: a bottle of petrol with a rag stuffed in its neck,
## the rag lit as it is thrown. It turns over in the air, the rag burning;
## whatever it hits hard enough it breaks on - the glass flies, the petrol
## splashes out and goes up (fire.gd), and whoever is in it burns. A soft
## landing on grass may not break it: it lies there, the rag still burning,
## until it does, or goes out.

const Sfx = preload("res://scripts/audio/sfx.gd")
const Fire = preload("res://scripts/fx/fire.gd")

var _flames: GPUParticles3D
var _light: OmniLight3D
var _broken := false
var _t := 0.0
var echo := false


## The bottle: green glass, the petrol in it, the rag hanging from its neck.
static func model(_lit := false) -> Node3D:
	return load("res://scripts/weapons/arms_models.gd").molotov()


static func throw(parent: Node, xf: Transform3D, vel: Vector3, spin: Vector3, is_echo := false) -> RigidBody3D:
	var m = load("res://scripts/weapons/molotov.gd").new()
	m.echo = is_echo
	parent.add_child(m)
	m.global_transform = xf
	m.linear_velocity = vel
	m.angular_velocity = spin
	return m


func _ready() -> void:
	collision_layer = Game.LAYER_DEBRIS
	collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS | Game.LAYER_BOTS
	mass = 0.9
	continuous_cd = true
	contact_monitor = true
	max_contacts_reported = 3
	var mdl := model(true)
	add_child(mdl)
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.037
	cap.height = 0.3
	cs.shape = cap
	cs.position = Vector3(0, 0.15, 0)
	add_child(cs)
	var tip: Node3D = mdl.get_node("RagTip")
	_flames = Fire.flames_on(tip, 0.45, 16)
	_light = OmniLight3D.new()
	_light.light_color = Color(1.0, 0.55, 0.2)
	_light.light_energy = 1.6
	_light.omni_range = 4.0
	tip.add_child(_light)
	body_entered.connect(_on_hit)


func _on_hit(b: Node) -> void:
	if _broken:
		return
	var v := linear_velocity.length()
	# Hard enough, or against anything but soft ground.
	if v > 3.5 or (b is RigidBody3D and v > 1.5) or b.has_meta("humanoid"):
		_break()
	else:
		Game.play_3d(Sfx.get_stream(&"casing"), global_position, -8.0, 0.2, 1.5)


func _physics_process(delta: float) -> void:
	_t += delta
	_light.light_energy = 1.6 * Fire.flicker(_t, 1.3)
	# Lying there unbroken, the rag burns down; then it goes out.
	if _t > 14.0 and not _broken:
		_flames.emitting = false
		_light.visible = false
		set_physics_process(false)


func _break() -> void:
	_broken = true
	var at := global_position + Vector3.UP * 0.05
	Game.play_3d(Sfx.get_stream(&"impact"), at, 2.0, 0.1, 2.5)
	Game.play_3d(Sfx.get_stream(&"casing"), at, 0.0, 0.3, 3.0)
	# Glass flying.
	for i in 8:
		var shard := RigidBody3D.new()
		shard.collision_layer = Game.LAYER_DEBRIS
		shard.collision_mask = Game.LAYER_WORLD
		shard.mass = 0.02
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(randf_range(0.01, 0.03), 0.003, randf_range(0.01, 0.03))
		mi.mesh = bm
		var g := StandardMaterial3D.new()
		g.albedo_color = Color(0.25, 0.5, 0.25, 0.6)
		g.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		g.roughness = 0.05
		mi.material_override = g
		shard.add_child(mi)
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = bm.size
		cs.shape = bs
		shard.add_child(cs)
		get_parent().add_child(shard)
		shard.global_position = at
		shard.linear_velocity = Vector3(randf_range(-3, 3), randf_range(1, 3), randf_range(-3, 3))
		shard.angular_velocity = Vector3(randf_range(-20, 20), randf_range(-20, 20), randf_range(-20, 20))
		shard.get_tree().create_timer(20.0).timeout.connect(shard.queue_free)
	# The petrol goes up where it lands: on the ground under it.
	var q := PhysicsRayQueryParameters3D.create(at + Vector3.UP * 0.3, at + Vector3.DOWN * 3.0, Game.LAYER_WORLD | Game.LAYER_PROPS)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	var ground: Vector3 = hit.position if not hit.is_empty() else at
	Fire.spawn(get_parent(), ground + Vector3.UP * 0.02, 1.5, 11.0)
	# Anyone it burst on is soaked in it.
	if not echo:
		for b in Game.bots:
			if is_instance_valid(b) and b.alive and b.has_method("ignite") and b.chest.global_position.distance_to(at) < 1.1:
				b.ignite(10.0)
	Game.gunshot.emit(at, 0.5)
	queue_free()
