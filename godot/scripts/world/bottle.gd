extends RigidBody3D
## A glass bottle lying about. Knocked over it rolls and clinks; hit hard -
## thrown against a wall, dropped from a height, kicked, shot, caught in a
## blast - it smashes: a burst of glinting flat shards that skitter over the
## ground and lie there a while, and the crash of breaking glass.

const Sfx = preload("res://scripts/audio/sfx.gd")
const BREAK_SPEED := 4.2          # m/s of impact that breaks it

var color := Color(0.15, 0.35, 0.12)
var _broken := false
var _clink := 0.0
static var _shard_mesh: QuadMesh
static var _shard_pm: ParticleProcessMaterial


static func make(glass_mat: Material, c: Color, body_mesh: Mesh, neck_mesh: Mesh) -> RigidBody3D:
	var rb = load("res://scripts/world/bottle.gd").new()
	rb.name = "Bottle"
	rb.color = c
	var b := MeshInstance3D.new()
	b.mesh = body_mesh
	b.material_override = glass_mat
	rb.add_child(b)
	var n := MeshInstance3D.new()
	n.mesh = neck_mesh
	n.position.y = 0.125
	n.material_override = glass_mat
	rb.add_child(n)
	var cs := CollisionShape3D.new()
	var sh := CylinderShape3D.new()
	sh.radius = 0.034
	sh.height = 0.25
	cs.shape = sh
	cs.position.y = 0.04
	rb.add_child(cs)
	return rb


func _ready() -> void:
	collision_layer = Game.LAYER_PROPS
	collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_PLAYER | Game.LAYER_DEBRIS
	mass = 0.35
	set_meta("surface", "glass")
	contact_monitor = true
	max_contacts_reported = 2
	continuous_cd = true
	body_entered.connect(_on_hit)
	add_to_group(&"blastable")


func _physics_process(delta: float) -> void:
	_clink -= delta
	_last_v = linear_velocity


var _last_v := Vector3.ZERO


func _on_hit(_other: Node) -> void:
	# The speed it had just before the hit (the contact has already slowed it).
	var v := _last_v.length()
	if v > BREAK_SPEED:
		smash(_last_v)
	elif v > 0.8 and _clink <= 0.0:
		_clink = 0.2
		Game.play_3d(Sfx.get_stream(&"casing"), global_position, -14.0 + v * 2.0, 0.25, 2.0)


## Shot (weapon.gd calls damage on what it hits).
func damage(_amount: float, _point: Vector3, dir: Vector3) -> void:
	smash(dir * 6.0)


## An explosion (explosion.gd): anything near enough goes.
func blast(origin: Vector3, _power: float) -> void:
	if origin.distance_to(global_position) < 8.0:
		smash((global_position - origin).normalized() * 8.0)


func center_local() -> Vector3:
	return Vector3(0, 0.05, 0)


func smash(push: Vector3) -> void:
	if _broken:
		return
	_broken = true
	var at := global_position + global_basis.y * 0.04
	_shards(at, push)
	Game.play_3d(Sfx.get_stream(&"glass_break"), at, -2.0, 0.12, 3.0)
	queue_free()


## Flat glinting pieces thrown out, bouncing on the ground and lying there
## for a few seconds before fading.
func _shards(at: Vector3, push: Vector3) -> void:
	if _shard_mesh == null:
		_shard_mesh = QuadMesh.new()
		_shard_mesh.size = Vector2(0.03, 0.03)
		var m := StandardMaterial3D.new()
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.albedo_texture = _shard_tex()
		m.vertex_color_use_as_albedo = true
		m.metallic_specular = 1.0
		m.roughness = 0.05
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		m.billboard_keep_scale = true
		_shard_mesh.material = m
		_shard_pm = ParticleProcessMaterial.new()
		_shard_pm.direction = Vector3.UP
		_shard_pm.spread = 80.0
		_shard_pm.initial_velocity_min = 1.0
		_shard_pm.initial_velocity_max = 3.5
		_shard_pm.gravity = Vector3(0, -9.8, 0)
		_shard_pm.angle_min = 0.0
		_shard_pm.angle_max = 360.0
		_shard_pm.angular_velocity_min = -720.0
		_shard_pm.angular_velocity_max = 720.0
		_shard_pm.scale_min = 0.3
		_shard_pm.scale_max = 1.4
		_shard_pm.collision_mode = ParticleProcessMaterial.COLLISION_RIGID
		_shard_pm.collision_friction = 0.8
		_shard_pm.collision_bounce = 0.25
		_shard_pm.damping_min = 0.5
		_shard_pm.damping_max = 1.5
		var g := Gradient.new()
		g.offsets = PackedFloat32Array([0.0, 0.8, 1.0])
		g.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.9), Color(1, 1, 1, 0)])
		var gt := GradientTexture1D.new()
		gt.gradient = g
		_shard_pm.color_ramp = gt
	var p := GPUParticles3D.new()
	p.process_material = _shard_pm
	p.draw_pass_1 = _shard_mesh
	p.amount = 26
	p.lifetime = 5.0
	p.explosiveness = 1.0
	p.one_shot = true
	p.local_coords = false
	p.collision_base_size = 0.01
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-4, -2, -4), Vector3(8, 5, 8))
	get_parent().add_child(p)
	p.global_position = at
	p.emitting = true
	p.get_tree().create_timer(p.lifetime + 0.5).timeout.connect(p.queue_free)
	# Glass tint for the pieces.
	var ramp := GradientTexture1D.new()
	var g2 := Gradient.new()
	var c := color.lightened(0.35)
	g2.offsets = PackedFloat32Array([0.0, 0.85, 1.0])
	g2.colors = PackedColorArray([Color(c, 0.95), Color(c, 0.85), Color(c, 0.0)])
	ramp.gradient = g2
	var pm: ParticleProcessMaterial = _shard_pm.duplicate()
	pm.color_ramp = ramp
	# (thrown out the way it was hit, a little)
	var sideways := Vector3(push.x, 0.0, push.z).limit_length(1.0)
	pm.direction = (Vector3.UP + sideways * 0.6).normalized()
	p.process_material = pm


## A jagged triangle of glass with a bright edge.
static func _shard_tex() -> ImageTexture:
	var s := 32
	var img := Image.create(s, s, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var a := Vector2(4, 28)
	var b := Vector2(28, 22)
	var c := Vector2(14, 3)
	for y in s:
		for x in s:
			var pt := Vector2(x, y)
			if Geometry2D.point_is_inside_triangle(pt, a, b, c):
				var edge := minf(minf(_seg_d(pt, a, b), _seg_d(pt, b, c)), _seg_d(pt, c, a))
				var v := 0.55 + 0.45 * (1.0 - clampf(edge / 3.0, 0.0, 1.0))
				img.set_pixel(x, y, Color(v, v, v, 0.75 + 0.25 * (1.0 - clampf(edge / 3.0, 0.0, 1.0))))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


static func _seg_d(p: Vector2, a: Vector2, b: Vector2) -> float:
	var ab := b - a
	var t := clampf((p - a).dot(ab) / ab.length_squared(), 0.0, 1.0)
	return p.distance_to(a + ab * t)
