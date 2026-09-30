extends Node3D
## Something fired that flies, rather than a bullet that is there at once:
## a crossbow bolt, a nail from a nail gun, a signal flare. It is stepped
## along its arc every physics tick (a ray from where it was to where it is
## now), so it drops with distance and can be seen going.
##  - bolt: goes deep; stays in whatever it hits - a person, a wall, a door -
##    and if there is a wall just behind the person, pins them to it;
##  - nail: the same, smaller, and often;
##  - flare: burns red, bright, trailing smoke; sets alight whoever it hits
##    and burns on where it lands for half a minute.

const Sfx = preload("res://scripts/audio/sfx.gd")
const FleshWounds = preload("res://scripts/fx/flesh_wounds.gd")

var kind := "bolt"
var vel := Vector3.ZERO
var gravity := 9.8
var echo := false                  # (someone else's, drawn here: no harm done by it)
var exclude: Array[RID] = []
var _life := 6.0
var _stuck := false
var _light: OmniLight3D
var _trail: GPUParticles3D
var _burn_t := 0.0


static func fire(parent: Node, what: String, at: Vector3, dir: Vector3, speed: float, ex: Array[RID], is_echo := false) -> Node3D:
	var p = load("res://scripts/weapons/projectile.gd").new()
	p.kind = what
	p.vel = dir * speed
	p.exclude = ex
	p.echo = is_echo
	p.gravity = {"bolt": 4.0, "nail": 2.0, "flare": 6.5}.get(what, 9.8)
	parent.add_child(p)
	p.global_position = at
	p._face()
	return p


static func bolt_model() -> Node3D:
	return load("res://scripts/weapons/arms_models.gd").bolt_model()


static func nail_model() -> Node3D:
	var root := Node3D.new()
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.0015
	cm.bottom_radius = 0.0015
	cm.height = 0.075
	mi.mesh = cm
	var steel := StandardMaterial3D.new()
	steel.albedo_color = Color(0.62, 0.62, 0.64)
	steel.metallic = 0.9
	steel.roughness = 0.35
	mi.material_override = steel
	mi.rotation = Vector3(PI * 0.5, 0, 0)
	root.add_child(mi)
	var head := MeshInstance3D.new()
	var hm := CylinderMesh.new()
	hm.top_radius = 0.004
	hm.bottom_radius = 0.004
	hm.height = 0.0015
	head.mesh = hm
	head.material_override = steel
	head.rotation = Vector3(PI * 0.5, 0, 0)
	head.position = Vector3(0, 0, 0.0375)
	root.add_child(head)
	return root


func _ready() -> void:
	match kind:
		"bolt":
			add_child(bolt_model())
		"nail":
			add_child(nail_model())
		"flare":
			var mi := MeshInstance3D.new()
			var sm := SphereMesh.new()
			sm.radius = 0.02
			sm.height = 0.04
			mi.mesh = sm
			var m := StandardMaterial3D.new()
			m.albedo_color = Color(1, 0.3, 0.2)
			m.emission_enabled = true
			m.emission = Color(1.0, 0.15, 0.08)
			m.emission_energy_multiplier = 16.0
			mi.material_override = m
			add_child(mi)
			_light = OmniLight3D.new()
			_light.light_color = Color(1.0, 0.18, 0.1)
			_light.light_energy = 6.0
			_light.omni_range = 14.0
			_light.shadow_enabled = Game.quality >= 1
			add_child(_light)
			_trail = _smoke_trail()
			add_child(_trail)
			_life = 32.0


## Red smoke streaming off the flare.
func _smoke_trail() -> GPUParticles3D:
	var p := GPUParticles3D.new()
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3.UP
	pm.spread = 30.0
	pm.initial_velocity_min = 0.2
	pm.initial_velocity_max = 0.6
	pm.gravity = Vector3(0, 0.5, 0)
	pm.scale_min = 0.4
	pm.scale_max = 1.4
	var cg := Gradient.new()
	cg.set_color(0, Color(1.0, 0.35, 0.3, 0.7))
	cg.set_color(1, Color(0.6, 0.45, 0.45, 0.0))
	var cgt := GradientTexture1D.new()
	cgt.gradient = cg
	pm.color_ramp = cgt
	p.process_material = pm
	var mat := StandardMaterial3D.new()
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = load("res://scripts/fx/fire.gd").puff_tex()
	var q := QuadMesh.new()
	q.size = Vector2(0.4, 0.4)
	q.material = mat
	p.draw_pass_1 = q
	p.amount = 60
	p.lifetime = 2.5
	p.local_coords = false
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-10, -3, -10), Vector3(20, 12, 20))
	return p


func _face() -> void:
	if vel.length() > 0.01:
		var f := vel.normalized()
		global_basis = Basis.looking_at(f, Vector3.UP if absf(f.y) < 0.99 else Vector3.RIGHT)


func _physics_process(delta: float) -> void:
	_life -= delta
	if _life <= 0.0:
		queue_free()
		return
	if kind == "flare" and _light:
		_light.light_energy = 6.0 * load("res://scripts/fx/fire.gd").flicker(_life * 1.7, 2.0) * clampf(_life / 4.0, 0.0, 1.0)
	if _stuck:
		if kind == "flare":
			_burn_t -= delta
			if _burn_t <= 0.0:
				_burn_t = 0.3
				_scorch_near()
		return
	var from := global_position
	vel += Vector3.DOWN * gravity * delta
	var to := from + vel * delta
	var q := PhysicsRayQueryParameters3D.create(from, to, Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS)
	q.exclude = exclude
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty():
		global_position = to
		_face()
		return
	_hit(hit)


func _hit(hit: Dictionary) -> void:
	var col: Node = hit.collider
	var p: Vector3 = hit.position
	var dir := vel.normalized()
	var speed := vel.length()
	var n: Vector3 = hit.normal
	if kind == "flare":
		# Off anything hard it glances and drops; into a person it sets him alight.
		if col.has_meta("humanoid") and not echo:
			var h = col.get_meta("humanoid")
			h.ignite(10.0)
			h.receive_hit(col, p, dir, 3.0, "flare")
		if speed > 8.0 and not col.has_meta("humanoid"):
			vel = vel.bounce(n) * 0.3
			global_position = p + n * 0.02
			Game.play_3d(Sfx.get_stream(&"casing"), p, -6.0, 0.2, 2.0)
			return
		_stuck = true
		global_position = p + n * 0.02
		Game.play_3d(Sfx.get_stream(&"lighter"), p, 0.0, 0.1, 3.0)
		return
	# Bolts and nails: in they go and stay.
	var deep := 0.12 if kind == "bolt" else 0.03
	if col.has_meta("humanoid"):
		var h2 = col.get_meta("humanoid")
		if not echo:
			h2.receive_hit(col, p, dir, 6.0 if kind == "bolt" else 1.5, "crossbow" if kind == "bolt" else "nail")
		_stick_in(col as Node3D, p + dir * deep)
		# Pinned: a wall just behind him and the point went through into it.
		var reach := 0.45 if kind == "bolt" else 0.12
		var wq := PhysicsRayQueryParameters3D.create(p + dir * 0.02, p + dir * reach, Game.LAYER_WORLD)
		var wall := get_world_3d().direct_space_state.intersect_ray(wq)
		if not wall.is_empty() and not echo and col is RigidBody3D:
			_pin(col as RigidBody3D, wall.collider, wall.position)
			Game.play_3d(Sfx.get_stream(&"impact"), wall.position, -4.0, 0.1, 3.0)
		return
	if col.has_meta("remote_player") and not echo:
		var net = get_node_or_null("/root/Net")
		if net:
			net.hit_remote(int(col.get_meta("remote_player")), p, dir, "crossbow" if kind == "bolt" else "nail", col)
		_stick_in(col as Node3D, p + dir * deep)
		return
	if col is RigidBody3D:
		(col as RigidBody3D).apply_impulse(dir * speed * (0.03 if kind == "bolt" else 0.006), p - (col as RigidBody3D).global_position)
	if col.has_method("damage") and not echo:
		col.damage(0.5 if kind == "bolt" else 0.15, p, dir)
	Game.play_3d(Sfx.get_stream(&"impact"), p, -8.0 if kind == "bolt" else -14.0, 0.2, 3.0)
	_stick_in(col as Node3D, p + dir * (deep * 0.4))


func _stick_in(what: Node3D, at: Vector3) -> void:
	_stuck = true
	var xf := global_transform
	xf.origin = at - (-xf.basis.z) * (0.18 if kind == "bolt" else 0.035)
	if what and is_instance_valid(what):
		get_parent().remove_child(self)
		what.add_child(self)
	global_transform = xf
	_life = 90.0


## The person held to the wall where the bolt went through him into it.
func _pin(part: RigidBody3D, wall: Object, at: Vector3) -> void:
	var j := PinJoint3D.new()
	var root := part.get_parent()
	root.add_child(j)
	j.global_position = at
	j.node_a = j.get_path_to(part)
	if wall is PhysicsBody3D:
		j.node_b = j.get_path_to(wall as Node)
	j.set_param(PinJoint3D.PARAM_BIAS, 0.6)
	part.set_meta("pinned", true)


## A flare lying burning: whoever stands on it catches.
func _scorch_near() -> void:
	for b in Game.bots:
		if is_instance_valid(b) and b.alive and b.has_method("ignite") and b.position_ground().distance_to(global_position) < 0.45:
			b.ignite(6.0)
