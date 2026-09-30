extends Node3D
## A patch of fire (a Molotov's burst of petrol, a flare burning out): flames
## licking up off it, their light flickering on everything round, smoke going
## up, the crackle of it. Whoever is in it catches fire (humanoid.gd ignite);
## the player in it is burnt. It dies down and goes out; black soot is left.

const Sfx = preload("res://scripts/audio/sfx.gd")

var radius := 1.2
var life := 12.0
var _t := 0.0
var _flames: GPUParticles3D
var _smoke: GPUParticles3D
var _light: OmniLight3D
var _snd: AudioStreamPlayer3D
var _tick := 0.0
var _soot_done := false

static var _flame_mesh: QuadMesh


static func spawn(parent: Node, at: Vector3, r := 1.2, seconds := 12.0) -> Node3D:
	var f = load("res://scripts/fx/fire.gd").new()
	f.radius = r
	f.life = seconds
	parent.add_child(f)
	f.global_position = at
	return f


static var _flame_mat: ShaderMaterial


static func flame_mesh() -> QuadMesh:
	if _flame_mesh:
		return _flame_mesh
	_flame_mat = ShaderMaterial.new()
	_flame_mat.shader = load("res://shaders/flame.gdshader")
	var nt := NoiseTexture2D.new()
	var fn := FastNoiseLite.new()
	fn.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	fn.frequency = 0.022
	fn.fractal_octaves = 3
	nt.noise = fn
	nt.seamless = true
	nt.width = 128
	nt.height = 128
	nt.generate_mipmaps = true
	_flame_mat.set_shader_parameter("noise_tex", nt)
	var q := QuadMesh.new()
	q.size = Vector2(0.55, 0.8)
	q.center_offset = Vector3(0, 0.3, 0)          # (rooted at its base)
	q.material = _flame_mat
	_flame_mesh = q
	return q


## Sparks: tiny glowing bits carried up and about by the heat.
static func embers(parent: Node3D, spread_r: float, amount := 30) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = spread_r
	pm.direction = Vector3.UP
	pm.spread = 25.0
	pm.initial_velocity_min = 1.0
	pm.initial_velocity_max = 2.6
	pm.gravity = Vector3(0, 0.6, 0)
	pm.damping_min = 0.5
	pm.damping_max = 1.2
	pm.turbulence_enabled = true
	pm.turbulence_noise_strength = 2.5
	pm.turbulence_noise_scale = 1.5
	pm.turbulence_influence_min = 0.1
	pm.turbulence_influence_max = 0.3
	pm.scale_min = 0.5
	pm.scale_max = 1.2
	var g := Gradient.new()
	g.set_color(0, Color(1.0, 0.85, 0.4, 1.0))
	g.add_point(0.5, Color(1.0, 0.4, 0.08, 1.0))
	g.set_color(1, Color(0.5, 0.08, 0.0, 0.0))
	var gt := GradientTexture1D.new()
	gt.gradient = g
	pm.color_ramp = gt
	p.process_material = pm
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = puff_tex()
	m.albedo_color = Color(2.5, 2.0, 1.5)
	var q := QuadMesh.new()
	q.size = Vector2(0.018, 0.018)
	q.material = m
	p.draw_pass_1 = q
	p.amount = amount
	p.lifetime = 1.6
	p.randomness = 0.6
	p.local_coords = false
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-4, -1, -4), Vector3(8, 8, 8))
	parent.add_child(p)
	return p


## A tongue of flame: bright yellow-white at its root, orange, then red at
## the ragged tip, clear all round it.
static func _flame_tex() -> ImageTexture:
	var n := 64
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var noise := FastNoiseLite.new()
	noise.frequency = 0.08
	for y in n:
		for x in n:
			var u := (float(x) / (n - 1)) * 2.0 - 1.0
			var v := float(y) / (n - 1)                  # 0 top .. 1 bottom
			# Narrower towards the top; the edge licked by noise.
			var width := 0.25 + 0.55 * pow(v, 0.7)
			var d := absf(u) / width + noise.get_noise_2d(x * 1.5, y) * 0.25
			var shape := (1.0 - smoothstep(0.55, 1.0, d)) * smoothstep(0.0, 0.35, v) * (1.0 - smoothstep(0.85, 1.0, v))
			var heat := clampf(v * 1.1 - absf(u) * 0.4, 0.0, 1.0)
			var c := Color(1.0, 0.25, 0.05).lerp(Color(1.0, 0.62, 0.15), smoothstep(0.2, 0.6, heat)).lerp(Color(1.0, 0.95, 0.75), smoothstep(0.7, 1.0, heat))
			c.a = shape * (0.55 + 0.45 * heat)
			img.set_pixel(x, y, c)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


## A soft round puff, clear at the edge (for smoke).
static func puff_tex() -> ImageTexture:
	var n := 64
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			var d := Vector2(float(x) / (n - 1) - 0.5, float(y) / (n - 1) - 0.5).length() * 2.0
			img.set_pixel(x, y, Color(1, 1, 1, pow(1.0 - smoothstep(0.0, 1.0, d), 1.5)))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


## Flames that ride along on something (a person burning, a lit rag).
static func flames_on(parent: Node3D, size := 1.0, amount := 24) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = 0.07 * size
	pm.direction = Vector3.UP
	pm.spread = 8.0
	pm.initial_velocity_min = 0.05 * size
	pm.initial_velocity_max = 0.2 * size
	pm.gravity = Vector3(0, 0.4, 0)
	pm.angle_min = -180.0
	pm.angle_max = 180.0
	pm.scale_min = 0.55 * size
	pm.scale_max = 0.95 * size
	var sc := Curve.new()
	sc.add_point(Vector2(0, 0.7))
	sc.add_point(Vector2(0.35, 1.0))
	sc.add_point(Vector2(1, 0.4))
	var ct := CurveTexture.new()
	ct.curve = sc
	pm.scale_curve = ct
	p.process_material = pm
	p.draw_pass_1 = flame_mesh()
	p.amount = amount
	p.lifetime = 0.5
	p.randomness = 0.4
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# (they move with what is burning: a man running does not leave his
	# flames hanging in the air behind him)
	p.local_coords = true
	p.visibility_aabb = AABB(Vector3(-2, -1, -2), Vector3(4, 4, 4))
	parent.add_child(p)
	if size > 0.6 and OS.get_environment("NO_EMB") == "":
		embers(p, 0.1 * size, 8)
	return p


var _clumps: Array = []


func _ready() -> void:
	# Not one even sheet: clumps of fire, bigger in the middle, smaller
	# out at the edges where the petrol ran thin.
	var n_clumps := clampi(int(radius * 4.0), 3, 9)
	for i in n_clumps:
		var a := randf() * TAU
		var d := sqrt(randf()) * radius * 0.75 if i > 0 else 0.0
		var big := 1.0 - d / maxf(radius, 0.01) * 0.5
		var c := GPUParticles3D.new()
		var pm := ParticleProcessMaterial.new()
		pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
		pm.emission_sphere_radius = 0.3 * big
		pm.direction = Vector3.UP
		pm.spread = 6.0
		pm.initial_velocity_min = 0.3
		pm.initial_velocity_max = 0.8
		pm.gravity = Vector3(0, 1.4, 0)
		pm.angle_min = -180.0
		pm.angle_max = 180.0
		pm.scale_min = 0.7 * big
		pm.scale_max = 1.3 * big
		var sc := Curve.new()
		sc.add_point(Vector2(0, 0.6))
		sc.add_point(Vector2(0.3, 1.0))
		sc.add_point(Vector2(1, 0.5))
		var ct := CurveTexture.new()
		ct.curve = sc
		pm.scale_curve = ct
		c.process_material = pm
		c.draw_pass_1 = flame_mesh()
		c.amount = int(12 + 10 * big)
		c.lifetime = 0.85
		c.randomness = 0.4
		c.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		c.visibility_aabb = AABB(Vector3(-2, -0.5, -2), Vector3(4, 5, 4))
		c.position = Vector3(cos(a) * d, 0.0, sin(a) * d)
		add_child(c)
		_clumps.append(c)
	_flames = _clumps[0]
	embers(self, radius * 0.5, int(20 * radius))
	# Smoke going up off it: dark, lit by what light there is (the fire's
	# own included), spreading as it rises.
	_smoke = GPUParticles3D.new()
	var sm := ParticleProcessMaterial.new()
	sm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	sm.emission_sphere_radius = radius * 0.4
	sm.direction = Vector3.UP
	sm.spread = 12.0
	sm.initial_velocity_min = 0.7
	sm.initial_velocity_max = 1.2
	sm.gravity = Vector3(0.15, 0.35, 0.0)
	sm.angle_min = -180.0
	sm.angle_max = 180.0
	sm.angular_velocity_min = -20.0
	sm.angular_velocity_max = 20.0
	sm.scale_min = 0.8
	sm.scale_max = 1.4
	var ssc := Curve.new()
	ssc.add_point(Vector2(0, 0.4))
	ssc.add_point(Vector2(1, 2.6))
	var sct := CurveTexture.new()
	sct.curve = ssc
	sm.scale_curve = sct
	var cg := Gradient.new()
	cg.set_color(0, Color(0.12, 0.1, 0.09, 0.0))
	cg.add_point(0.12, Color(0.1, 0.09, 0.085, 0.55))
	cg.add_point(0.6, Color(0.22, 0.21, 0.2, 0.3))
	cg.set_color(1, Color(0.35, 0.35, 0.35, 0.0))
	var cgt := GradientTexture1D.new()
	cgt.gradient = cg
	sm.color_ramp = cgt
	_smoke.process_material = sm
	var smat := StandardMaterial3D.new()
	smat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	smat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	smat.billboard_keep_scale = true
	smat.vertex_color_use_as_albedo = true
	smat.roughness = 1.0
	smat.albedo_texture = puff_tex()
	var sq := QuadMesh.new()
	sq.size = Vector2(0.9, 0.9)
	sq.material = smat
	_smoke.draw_pass_1 = sq
	_smoke.amount = int(18 + 10 * radius)
	_smoke.lifetime = 5.0
	_smoke.position = Vector3.UP * 0.9
	_smoke.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_smoke.visibility_aabb = AABB(Vector3(-5, -1, -5), Vector3(10, 12, 10))
	add_child(_smoke)
	_light = OmniLight3D.new()
	_light.light_color = Color(1.0, 0.52, 0.18)
	_light.omni_range = 5.0 + radius * 2.5
	_light.omni_attenuation = 1.6
	_light.light_energy = 3.0
	_light.shadow_enabled = Game.quality >= 1
	_light.position = Vector3.UP * 0.6
	add_child(_light)
	_snd = AudioStreamPlayer3D.new()
	_snd.stream = _crackle()
	_snd.bus = &"World"
	_snd.unit_size = 3.0
	_snd.volume_db = -6.0
	add_child(_snd)
	_snd.play()
	Game.play_3d(Sfx.get_stream(&"lighter"), global_position, 4.0, 0.1, 8.0)


## The light of a fire: never still, but it breathes and gutters rather than
## blinking (a sum of slow and quick waves, not a new random each frame).
static func flicker(t: float, seed_v := 0.0) -> float:
	return 0.78 + 0.12 * sin(t * 7.1 + seed_v) + 0.07 * sin(t * 13.3 + seed_v * 2.0) + 0.05 * sin(t * 23.9 + seed_v * 3.0)


## The crackle: noise, low-passed, with little pops in it; looping.
static func _crackle() -> AudioStreamWAV:
	var rate := 22050
	var n := rate * 2
	var data := PackedByteArray()
	data.resize(n * 2)
	var lp := 0.0
	var pop := 0.0
	for i in n:
		lp = lp * 0.93 + randf_range(-1.0, 1.0) * 0.07
		if randf() < 0.0012:
			pop = randf_range(0.4, 1.0)
		pop *= 0.992
		var v := lp * 3.5 + randf_range(-1.0, 1.0) * pop * 0.8
		data.encode_s16(i * 2, int(clampf(v, -1.0, 1.0) * 14000.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = rate
	w.data = data
	w.loop_mode = AudioStreamWAV.LOOP_FORWARD
	w.loop_end = n
	return w


func _physics_process(delta: float) -> void:
	_t += delta
	var k := 1.0 - smoothstep(life * 0.6, life, _t)
	for c in _clumps:
		(c as GPUParticles3D).amount_ratio = clampf(k, 0.05, 1.0)
	# (it flares up at first as it catches)
	var catch := smoothstep(0.0, 0.4, _t) * (1.0 + 0.6 * (1.0 - smoothstep(0.4, 1.5, _t)))
	_light.light_energy = 3.2 * flicker(_t) * k * catch
	_snd.volume_db = linear_to_db(maxf(k, 0.001)) - 6.0
	if _t > life:
		for c in _clumps:
			(c as GPUParticles3D).emitting = false
		_smoke.emitting = false
		_light.visible = false
		_snd.stop()
		if _t > life + 4.0:
			queue_free()
		return
	if not _soot_done and _t > 1.0 and not Net.active:
		_soot_done = true
		_soot()
	_tick -= delta
	if _tick > 0.0:
		return
	_tick = 0.25
	var r := radius * (0.6 + 0.4 * k)
	# Anyone standing in it.
	for b in Game.bots:
		if is_instance_valid(b) and b.alive and b.has_method("ignite") and b.position_ground().distance_to(global_position) < r + 0.2 \
				and absf(b.position_ground().y - global_position.y) < 1.2:
			b.ignite(8.0)
	var p = Game.player
	if p and is_instance_valid(p) and p.global_position.distance_to(global_position) < r and p.has_method("burn"):
		p.burn(0.25)


## What it leaves: the ground under it blackened.
func _soot() -> void:
	var stain = load("res://scripts/world/stain.gd")
	var q := PhysicsRayQueryParameters3D.create(global_position + Vector3.UP * 0.5, global_position + Vector3.DOWN * 1.0, Game.LAYER_WORLD)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if not hit.is_empty() and (hit.normal as Vector3).y > 0.8 and Game.main:
		stain.make(Game.main, (hit.position as Vector3) + Vector3.UP * 0.01, Vector3.UP, Vector2(radius * 2.2, radius * 2.2), "oil", randi())
