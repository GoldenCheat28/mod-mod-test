extends Node3D
## Cigarette smoke as a person sees it, too fine for the smoke grid (8 cm
## cells): a thread off the burning tip that rises and curls, and the breath
## blown out as a narrow jet that widens and slows, drifts up and thins
## away. Soft little puffs, all in one particle system each; the grid only
## gets a trace of it, for the haze that hangs about after.

var _thread: GPUParticles3D
var _jet: GPUParticles3D
var _mat_thread: ParticleProcessMaterial
var _mat_jet: ParticleProcessMaterial


func _ready() -> void:
	_thread = _make(true)
	_jet = _make(false)
	_mat_thread = _thread.process_material
	_mat_jet = _jet.process_material


func _make(thread: bool) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	var pm := ParticleProcessMaterial.new()
	# Warm: it rises - the thread straight off the tip, the breath once it
	# has lost its push.
	pm.direction = Vector3.UP if thread else Vector3(0, 0, -1)
	pm.gravity = Vector3(0, 0.32 if thread else 0.22, 0)
	pm.spread = 6.0 if thread else 9.0
	pm.initial_velocity_min = 0.12 if thread else 0.7
	pm.initial_velocity_max = 0.2 if thread else 1.0
	pm.damping_min = 0.15 if thread else 1.2
	pm.damping_max = 0.3 if thread else 1.8
	# Curling as it goes: slow eddies that grow with height.
	pm.turbulence_enabled = true
	pm.turbulence_noise_strength = 1.2 if thread else 0.8
	pm.turbulence_noise_scale = 0.35
	pm.turbulence_noise_speed = Vector3(0.05, 0.2, 0.05)
	pm.turbulence_noise_speed_random = 0.5
	pm.turbulence_influence_min = 0.04
	pm.turbulence_influence_max = 0.14 if thread else 0.1
	var infl := Curve.new()
	infl.add_point(Vector2(0.0, 0.1))
	infl.add_point(Vector2(0.5, 0.8))
	infl.add_point(Vector2(1.0, 1.0))
	var it := CurveTexture.new()
	it.curve = infl
	pm.turbulence_influence_over_life = it
	# Thin at the tip / mouth, spreading wide and loose further on.
	var grow := Curve.new()
	grow.add_point(Vector2(0.0, 0.1 if thread else 0.2))
	grow.add_point(Vector2(0.35, 0.45))
	grow.add_point(Vector2(1.0, 1.0))
	var gt := CurveTexture.new()
	gt.curve = grow
	pm.scale_curve = gt
	pm.scale_min = 1.4 if thread else 1.0
	pm.scale_max = 2.4 if thread else 1.8
	pm.angle_min = 0.0
	pm.angle_max = 360.0
	pm.angular_velocity_min = -12.0
	pm.angular_velocity_max = 12.0
	# See-through: a faint veil that thins away to nothing.
	var fade := Gradient.new()
	fade.offsets = PackedFloat32Array([0.0, 0.06, 0.35, 1.0])
	fade.colors = PackedColorArray([Color(1, 1, 1, 0.0), Color(1, 1, 1, 0.3 if thread else 0.22),
			Color(1, 1, 1, 0.12 if thread else 0.1), Color(1, 1, 1, 0.0)])
	var ft := GradientTexture1D.new()
	ft.gradient = fade
	pm.color_ramp = ft
	p.process_material = pm
	var quad := QuadMesh.new()
	quad.size = Vector2.ONE * (0.06 if thread else 0.2)
	var m := StandardMaterial3D.new()
	m.albedo_texture = _puff_tex()
	m.albedo_color = Color(0.8, 0.82, 0.87)
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_VERTEX
	m.roughness = 1.0
	m.proximity_fade_enabled = true
	m.proximity_fade_distance = 0.12
	quad.material = m
	p.draw_pass_1 = quad
	p.amount = 90 if thread else 110
	p.lifetime = 5.0 if thread else 4.0
	p.local_coords = false
	p.emitting = false
	p.visibility_aabb = AABB(Vector3(-3, -1, -3), Vector3(6, 5, 6))
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(p)
	return p


static var _tex: Texture2D


static func _puff_tex() -> Texture2D:
	if _tex:
		return _tex
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 0.7), Color(1, 1, 1, 0.25), Color(1, 1, 1, 0)])
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	t.width = 32
	t.height = 32
	_tex = t
	return _tex


## The thread off the tip: on while it smoulders, from `at`.
func thread(at: Vector3, on: bool) -> void:
	_thread.global_position = at
	_thread.emitting = on


## The breath out: from `at` along `dir`, `strength` 0..1 (strong at first,
## trailing off). Off with strength 0.
func jet(at: Vector3, dir: Vector3, strength: float) -> void:
	_jet.emitting = strength > 0.02
	if not _jet.emitting:
		return
	_jet.global_transform = Transform3D(Basis.looking_at(dir, Vector3.UP), at)
	_mat_jet.initial_velocity_min = lerpf(0.25, 0.8, strength)
	_mat_jet.initial_velocity_max = lerpf(0.4, 1.2, strength)
	_jet.amount_ratio = clampf(0.3 + strength, 0.0, 1.0)
