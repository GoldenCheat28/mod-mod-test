extends Node3D
## First-person smoking: a cigarette or a joint. The hands bring it to the
## mouth, the other hand lights it with a lighter (flame and its light), the
## tip glows and smoulders (thin smoke rising from it), each drag makes the
## ember flare and burns the paper down, and the smoke is breathed out. After
## the last drag the butt is flicked away hard and keeps smouldering where it
## lands. A joint looks different and makes the player high (Game.high).
## Lives under the camera; poses are camera-space.

const Sfx = preload("res://scripts/audio/sfx.gd")
const Smoke = preload("res://scripts/fx/smoke.gd")
const Tex = preload("res://scripts/world/textures.gd")
const CigTex = preload("res://scripts/player/cig_tex.gd")

signal finished

enum S { OFF, WAIT, RAISE, LIGHT, IDLE, DRAG, THROW }

const CIG_AT := Vector3(0.0, 0.05, 0.045)   # filter end, in the hand's frame

# Right hand poses, built from where the filter is, where the cigarette points
# and where the fingers point (camera space).
var HIDDEN_R: Transform3D
var MOUTH: Transform3D
var IDLE: Transform3D
var WINDUP: Transform3D
var FLING: Transform3D
var VIA: Transform3D
var LIGHTP: Transform3D
## How far down the eyes look while lighting up (player.gd adds it to the
## view): one looks at the tip to light it.
var look_down := 0.0
var HIDDEN_L := Transform3D(Basis(), Vector3(-0.18, -0.45, -0.25))

var player
var kind := "cigarette"
var state := S.OFF
var _t := 0.0
var _drags_left := 0
var _drags_total := 1
var _next_drag := 0.0
var _burn := 0.0
var _glow := 0.0
var _lit := false
var _flame_on := false
var _exhale_at := -1.0
var _exhale_len := 1.4
var _breath_stop := -1.0
var _clock := 0.0
var _r_from: Transform3D
var _drag_now := false
var _light_snd: AudioStreamPlayer3D

var _rhand: Node3D
var _lhand: Node3D
var _cig: Node3D
var _paper: MeshInstance3D
var _char: MeshInstance3D
var _ember: MeshInstance3D
var _ember_light: OmniLight3D
var _flame: MeshInstance3D
var _flame_light: OmniLight3D
var _tip_smoke: GPUParticles3D
var _breath: GPUParticles3D
var _paper_len := 0.062
var _paper_start := 0.022
var _ember_mat: StandardMaterial3D


func setup(p) -> void:
	player = p
	# At the mouth only the cigarette and the edge of the hand show, coming
	# up from below; resting, it is held low on the right, pointing ahead.
	# (every pose has the fingers up and the cigarette pointing ahead, so the
	# hand only travels and tips between them - it never rolls over)
	MOUTH = _hold(Vector3(0.0, -0.08, -0.05), Vector3(0.08, -0.2, -1.0), Vector3(0.85, 0.45, 0.2))
	# Resting: hand low on the right, the cigarette between the fingers
	# pointing ahead and a little up.
	IDLE = _hold(Vector3(0.13, -0.2, -0.3), Vector3(0.12, 0.3, -1.0), Vector3(0.6, 0.8, 0.15))
	HIDDEN_R = IDLE.translated(Vector3(0.03, -0.3, 0.05))
	WINDUP = _hold(Vector3(0.18, -0.1, -0.2), Vector3(0.0, 0.5, -1.0), Vector3(0.0, 1.0, 0.5))
	FLING = _hold(Vector3(0.1, -0.12, -0.5), Vector3(0.0, 0.1, -1.0), Vector3(0.0, 1.0, 0.1))
	# Lit held out in front, low, where the eyes can see the lighter at the tip.
	LIGHTP = _hold(Vector3(0.04, -0.15, -0.27), Vector3(0.05, 0.12, -1.0), Vector3(0.6, 0.8, 0.15))
	# On the way up to the mouth and back it passes here (an arc, not a line).
	VIA = _hold(Vector3(0.08, -0.16, -0.18), Vector3(0.1, 0.05, -1.0), Vector3(0.75, 0.6, 0.2))
	_r_from = HIDDEN_R
	_build_hands()
	_build_smoke()
	visible = false


func busy() -> bool:
	return state != S.OFF


func start(what: String) -> void:
	if busy():
		return
	kind = what
	_build_cig()
	state = S.WAIT
	_t = 0.0


## Take a drag now (fire button) if just holding it.
func drag_now() -> void:
	if state == S.IDLE:
		_drag_now = true


## Flick it away early (e.g. to pick up a gun).
func throw_now() -> void:
	if state in [S.IDLE, S.DRAG, S.LIGHT]:
		_enter(S.THROW)


# --- Building ---------------------------------------------------------------------

func _mat(c: Color, rough := 0.8) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m


func _cap(parent: Node3D, r: float, h: float, mat: Material, pos: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var cm := CapsuleMesh.new()
	cm.radius = r
	cm.height = h
	cm.radial_segments = 10
	cm.rings = 3
	var mi := MeshInstance3D.new()
	mi.mesh = cm
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi


func _box(parent: Node3D, size: Vector3, mat: Material, pos: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var bm := BoxMesh.new()
	bm.size = size
	var mi := MeshInstance3D.new()
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi


## Right hand: palm towards the face, index and middle fingers straight up with
## the cigarette pinched between them near the knuckles (filter on the palm
## side, burning end out past the back of the hand), ring and little finger
## curled, thumb out to the side. Hand frame: +X thumb side, +Y fingers, +Z palm.
func _build_hands() -> void:
	var skin := _mat(Color(0.84, 0.66, 0.54), 0.6)
	skin.subsurf_scatter_enabled = true
	skin.subsurf_scatter_strength = 0.3
	skin.distance_fade_mode = BaseMaterial3D.DISTANCE_FADE_PIXEL_DITHER
	skin.distance_fade_min_distance = 0.04
	skin.distance_fade_max_distance = 0.09
	_rhand = Node3D.new()
	add_child(_rhand)
	# Blocky, like the rest of the body: a flat block of a palm, two straight
	# fingers holding the cigarette, the other two folded, the thumb, and the
	# jacket sleeve over the wrist.
	_box(_rhand, Vector3(0.075, 0.075, 0.03), skin, Vector3(-0.012, -0.02, 0.0))
	_box(_rhand, Vector3(0.017, 0.07, 0.018), skin, Vector3(0.0138, 0.05, 0.004), Vector3(0.12, 0, -0.04))
	_box(_rhand, Vector3(0.017, 0.076, 0.018), skin, Vector3(-0.0138, 0.052, 0.004), Vector3(0.12, 0, 0.04))
	_box(_rhand, Vector3(0.034, 0.028, 0.03), skin, Vector3(-0.045, 0.024, 0.012))
	_box(_rhand, Vector3(0.018, 0.05, 0.02), skin, Vector3(0.042, -0.012, 0.014), Vector3(0.45, 0, -0.75))
	_box(_rhand, Vector3(0.055, 0.05, 0.035), skin, Vector3(-0.01, -0.07, 0.0))
	var sleeve := _mat(Color(0.12, 0.13, 0.15), 0.9)
	sleeve.distance_fade_mode = BaseMaterial3D.DISTANCE_FADE_PIXEL_DITHER
	sleeve.distance_fade_min_distance = 0.04
	sleeve.distance_fade_max_distance = 0.09
	_box(_rhand, Vector3(0.085, 0.24, 0.075), sleeve, Vector3(-0.01, -0.21, 0.0))

	_lhand = Node3D.new()
	add_child(_lhand)
	# Lighter: origin is the top of the lighter, the flame sits above it.
	var body := _mat(Color(0.6, 0.05, 0.04), 0.35)
	var metal := _mat(Color(0.6, 0.6, 0.62), 0.3)
	metal.metallic = 1.0
	_box(_lhand, Vector3(0.024, 0.056, 0.012), body, Vector3(0, -0.035, 0))
	_box(_lhand, Vector3(0.024, 0.012, 0.012), metal, Vector3(0, -0.004, 0))
	_box(_lhand, Vector3(0.07, 0.06, 0.024), skin, Vector3(-0.012, -0.05, 0.02))
	for i in 3:
		_cap(_lhand, 0.0085, 0.045, skin, Vector3(0.0, -0.028 - i * 0.017, -0.01), Vector3(0, 0, PI * 0.5))
	_cap(_lhand, 0.0095, 0.045, skin, Vector3(0.006, 0.0, 0.012), Vector3(0.3, 0, 0.3))
	_cap(_lhand, 0.03, 0.26, _mat(Color(0.15, 0.15, 0.17), 0.95), Vector3(-0.02, -0.2, 0.05), Vector3(0.1, 0, 0.2))
	var fm := StandardMaterial3D.new()
	fm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	fm.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	var g := Gradient.new()
	g.set_color(0, Color(0.4, 0.6, 1.0, 0.9))
	g.add_point(0.35, Color(1.0, 0.75, 0.35, 0.95))
	g.set_color(1, Color(1.0, 0.4, 0.05, 0.0))
	var gt := GradientTexture2D.new()
	gt.gradient = g
	gt.fill = GradientTexture2D.FILL_RADIAL
	gt.fill_from = Vector2(0.5, 0.85)
	gt.fill_to = Vector2(0.5, 0.05)
	fm.albedo_texture = gt
	var q := QuadMesh.new()
	q.size = Vector2(0.018, 0.04)
	_flame = MeshInstance3D.new()
	_flame.mesh = q
	_flame.material_override = fm
	_flame.position = Vector3(0, 0.022, 0)
	_flame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_lhand.add_child(_flame)
	_flame_light = OmniLight3D.new()
	_flame_light.light_color = Color(1.0, 0.68, 0.35)
	_flame_light.omni_range = 1.6
	_flame_light.light_energy = 0.0
	_flame_light.shadow_enabled = false
	_flame_light.position = Vector3(0, 0.03, 0)
	_lhand.add_child(_flame_light)
	_flame.visible = false
	_set_pose(_rhand, HIDDEN_R)
	_set_pose(_lhand, HIDDEN_L)


func _build_cig() -> void:
	if _cig:
		_cig.queue_free()
	_cig = Node3D.new()
	_rhand.add_child(_cig)
	# Filter end at the origin, burning end towards -Z.
	_cig.position = CIG_AT
	var joint := kind == "joint"
	var paper_mat: StandardMaterial3D = CigTex.joint_mat() if joint else CigTex.paper_mat()
	var along := Vector3(PI * 0.5, 0, 0)
	if joint:
		# Rolled paper crutch, then a cone that widens to a twisted tip.
		var crutch := CylinderMesh.new()
		crutch.top_radius = 0.005
		crutch.bottom_radius = 0.005
		crutch.height = 0.018
		crutch.radial_segments = 10
		var ci := MeshInstance3D.new()
		ci.mesh = crutch
		ci.material_override = CigTex.joint_mat()
		ci.rotation = along
		ci.position = Vector3(0, 0, -0.008)
		_cig.add_child(ci)
		_paper_start = 0.018
		_paper_len = 0.085
		var cone := CylinderMesh.new()
		cone.top_radius = 0.0053
		cone.bottom_radius = 0.008
		cone.height = 1.0
		cone.radial_segments = 12
		_paper = MeshInstance3D.new()
		_paper.mesh = cone
		_paper.material_override = paper_mat
		_cig.add_child(_paper)
	else:
		var filt := CylinderMesh.new()
		filt.top_radius = 0.0046
		filt.bottom_radius = 0.0046
		filt.height = 0.026
		filt.radial_segments = 12
		var fi := MeshInstance3D.new()
		fi.mesh = filt
		fi.material_override = CigTex.filter_mat()
		fi.rotation = along
		fi.position = Vector3(0, 0, -0.013)
		_cig.add_child(fi)
		_paper_start = 0.026
		_paper_len = 0.072
		var pm := CylinderMesh.new()
		pm.top_radius = 0.0046
		pm.bottom_radius = 0.0046
		pm.height = 1.0
		pm.radial_segments = 12
		_paper = MeshInstance3D.new()
		_paper.mesh = pm
		_paper.material_override = paper_mat
		_cig.add_child(_paper)
	for c in _cig.get_children():
		(c as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_ember_mat = CigTex.ember_mat()
	# The charred ring where the paper meets the ember.
	var ch := CylinderMesh.new()
	ch.top_radius = 0.0048 if not joint else 0.0055
	ch.bottom_radius = ch.top_radius
	ch.height = 0.004
	ch.radial_segments = 12
	_char = MeshInstance3D.new()
	_char.mesh = ch
	_char.material_override = CigTex.char_mat()
	_char.rotation = along
	_char.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_char.visible = false
	_cig.add_child(_char)
	var sm := SphereMesh.new()
	sm.radius = 0.0056 if joint else 0.0047
	sm.height = sm.radius * 1.6
	_ember = MeshInstance3D.new()
	_ember.mesh = sm
	_ember.material_override = _ember_mat
	_ember.rotation = along
	_ember.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_cig.add_child(_ember)
	_ember_light = OmniLight3D.new()
	_ember_light.light_color = Color(1.0, 0.4, 0.12)
	_ember_light.omni_range = 0.45
	_ember_light.light_energy = 0.0
	_ember.add_child(_ember_light)
	if _tip_smoke.get_parent():
		_tip_smoke.get_parent().remove_child(_tip_smoke)
	_ember.add_child(_tip_smoke)
	_tip_smoke.position = Vector3.ZERO
	_burn = 0.0
	_lit = false
	_glow = 0.0
	_drags_total = 7 if joint else 6
	_drags_left = _drags_total
	_place_paper()


## Paper shortens as it burns; the ember sits at the burning end.
func _place_paper() -> void:
	var l := _paper_len * (1.0 - 0.8 * _burn)
	_paper.scale = Vector3(1, l, 1)
	_paper.rotation = Vector3(PI * 0.5, 0, 0)
	_paper.position = Vector3(0, 0, -(_paper_start + l * 0.5))
	_ember.position = Vector3(0, 0, -(_paper_start + l))
	if _char:
		_char.position = Vector3(0, 0, -(_paper_start + l) + 0.0015)
		_char.visible = _lit


func _build_smoke() -> void:
	# Thin smoke rising off the smouldering tip.
	_tip_smoke = GPUParticles3D.new()
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 8.0
	pm.initial_velocity_min = 0.03
	pm.initial_velocity_max = 0.08
	pm.gravity = Vector3(0.03, 0.22, 0.0)
	pm.damping_min = 0.2
	pm.damping_max = 0.5
	pm.turbulence_enabled = true
	pm.turbulence_noise_strength = 0.7
	pm.turbulence_noise_scale = 0.9
	pm.turbulence_noise_speed = Vector3(0, 0.3, 0)
	pm.turbulence_influence_min = 0.05
	pm.turbulence_influence_max = 0.14
	pm.angle_max = 360.0
	pm.scale_min = 0.5
	pm.scale_max = 0.9
	pm.scale_curve = _curve([[0.0, 0.25], [1.0, 3.5]])
	pm.color_ramp = _ramp([[0.0, 0.0], [0.1, 0.5], [0.6, 0.22], [1.0, 0.0]])
	_tip_smoke.process_material = pm
	_tip_smoke.draw_pass_1 = Smoke.quad("cig", 0.035, Color(0.78, 0.8, 0.86), 0.7)
	_tip_smoke.amount = 60
	_tip_smoke.lifetime = 4.5
	_tip_smoke.local_coords = false
	_tip_smoke.emitting = false
	_tip_smoke.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_tip_smoke.visibility_aabb = AABB(Vector3(-2, -1, -2), Vector3(4, 4, 4))

	# Breath: a slow plume blown out from the mouth.
	_breath = GPUParticles3D.new()
	var bm := ParticleProcessMaterial.new()
	# Few, large, dense puffs that roll out and spread, not a spray of specks.
	bm.direction = Vector3(0, -0.2, -1)
	bm.spread = 10.0
	bm.initial_velocity_min = 0.35
	bm.initial_velocity_max = 0.7
	bm.damping_min = 0.25
	bm.damping_max = 0.5
	bm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	bm.emission_sphere_radius = 0.015
	bm.gravity = Vector3(0, 0.1, 0)
	bm.turbulence_enabled = true
	bm.turbulence_noise_strength = 1.0
	bm.turbulence_noise_scale = 1.2
	bm.turbulence_influence_min = 0.04
	bm.turbulence_influence_max = 0.12
	bm.angle_max = 360.0
	bm.scale_min = 0.8
	bm.scale_max = 1.2
	bm.scale_curve = _curve([[0.0, 0.5], [0.3, 1.6], [1.0, 3.8]])
	bm.color_ramp = _ramp([[0.0, 0.0], [0.05, 1.0], [0.4, 0.6], [1.0, 0.0]])
	_breath.process_material = bm
	_breath.draw_pass_1 = Smoke.quad("breath", 0.2, Color(0.86, 0.87, 0.9), 1.0)
	_breath.amount = 26
	_breath.lifetime = 3.8
	_breath.local_coords = false
	_breath.emitting = false
	_breath.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_breath.visibility_aabb = AABB(Vector3(-3, -2, -3), Vector3(6, 5, 6))
	_breath.position = Vector3(0, -0.07, -0.05)
	add_child(_breath)


func _curve(points: Array) -> CurveTexture:
	var c := Curve.new()
	c.max_value = 4.0
	for p in points:
		c.add_point(Vector2(p[0], p[1]))
	var t := CurveTexture.new()
	t.curve = c
	return t


func _ramp(points: Array) -> GradientTexture1D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array()
	g.colors = PackedColorArray()
	for p in points:
		g.add_point(p[0], Color(1, 1, 1, p[1]))
	var t := GradientTexture1D.new()
	t.gradient = g
	return t


# --- Animation ----------------------------------------------------------------------

## Hand transform that puts the filter at ilter, the cigarette along dir`n## and the fingers roughly towards ingers.
func _hold(filter: Vector3, dir: Vector3, fingers: Vector3) -> Transform3D:
	var b := Basis.looking_at(dir.normalized(), fingers.normalized())
	return Transform3D(b, filter - b * CIG_AT)


## The right hand from one pose to another by way of VIA (a curve, so it
## comes up from below to the lips rather than sliding across).
func _arc(a: Transform3D, b: Transform3D, k: float) -> void:
	var u := smoothstep(0.0, 1.0, clampf(k, 0.0, 1.0))
	var ab := a.interpolate_with(b, u)
	var p1 := a.interpolate_with(VIA, u)
	var p2 := VIA.interpolate_with(b, u)
	var curve := p1.interpolate_with(p2, u)
	_rhand.transform = Transform3D(ab.basis.orthonormalized(), curve.origin)


func _set_pose(n: Node3D, pose: Transform3D) -> void:
	n.transform = pose


func _blend(n: Node3D, a: Transform3D, b: Transform3D, k: float) -> void:
	n.transform = a.interpolate_with(b, smoothstep(0.0, 1.0, clampf(k, 0.0, 1.0)))


## Left hand pose that puts the flame just under the burning end.
func _lighter_pose() -> Transform3D:
	var tip := LIGHTP * (CIG_AT + Vector3(0, 0, -(_paper_start + _paper_len)))
	return Transform3D(Basis(Vector3.FORWARD, 0.08), tip + Vector3(0.0, -0.034, 0.0))


func _enter(s: S) -> void:
	state = s
	_t = 0.0
	_r_from = _rhand.transform


func _exhale(length: float) -> void:
	_exhale_at = _clock + 0.05
	_exhale_len = length


func _process(delta: float) -> void:
	_clock += delta
	if state != S.OFF:
		_t += delta
	match state:
		S.WAIT:
			if player.current == null:
				visible = true
				_enter(S.RAISE)
		S.RAISE:
			_blend(_rhand, HIDDEN_R, LIGHTP, _t / 0.6)
			_blend(_lhand, HIDDEN_L, _lighter_pose(), (_t - 0.25) / 0.55)
			if _t > 0.85:
				_enter(S.LIGHT)
		S.LIGHT:
			# The flame to the tip, held out in front; then up to the lips for
			# the first drag, down again, and the smoke out.
			if _t < 1.25:
				_set_pose(_rhand, LIGHTP)
			elif _t < 1.6:
				_rhand.transform = LIGHTP.interpolate_with(MOUTH, smoothstep(1.25, 1.6, _t))
			elif _t < 2.4:
				_set_pose(_rhand, MOUTH)
				_glow = move_toward(_glow, 1.0, delta * 2.5)
			else:
				_arc(MOUTH, IDLE, (_t - 2.4) / 0.6)
			if _t > 0.1 and not _flame_on:
				_flame_on = true
				# The strike and the flame only: the recording goes on into the
				# paper crackling as it is puffed alight, which would sound over
				# the first drag - it is faded out as the hand goes to the mouth.
				_light_snd = AudioStreamPlayer3D.new()
				_light_snd.stream = Sfx.get_stream(&"cig_light")
				_light_snd.bus = &"World"
				_light_snd.volume_db = -8.0
				_light_snd.unit_size = 1.0
				add_child(_light_snd)
				_light_snd.play()
			if _light_snd and is_instance_valid(_light_snd) and _t > 1.0:
				_light_snd.volume_db -= delta * 60.0
				if _light_snd.volume_db < -45.0:
					_light_snd.queue_free()
					_light_snd = null
			if _t > 0.75 and not _lit:
				_lit = true
			if _lit and _t < 1.25:
				_glow = move_toward(_glow, 0.8, delta * 3.0)
			if _t > 1.15:
				_flame_on = false
				_blend(_lhand, _lighter_pose(), HIDDEN_L, (_t - 1.15) / 0.45)
			else:
				_set_pose(_lhand, _lighter_pose())
			if _t > 1.6 and _t - delta <= 1.6:
				Game.play_3d(Sfx.get_stream(&"cig_drag"), global_position, -6.0, 0.04, 1.0, 3.0)
			if _t > 2.7 and _t - delta <= 2.7:
				_exhale(1.8)
				_took_drag()
			if _t > 3.1:
				_next_drag = randf_range(6.0, 9.0)
				_enter(S.IDLE)
		S.IDLE:
			var sway := Vector3(sin(_clock * 0.9) * 0.004, sin(_clock * 1.3) * 0.003, 0.0)
			_blend(_rhand, _r_from, IDLE, _t / 0.3)
			_rhand.position += sway
			_next_drag -= delta
			if _drags_left <= 0 or _burn >= 1.0:
				_enter(S.THROW)
			elif _next_drag <= 0.0 or _drag_now:
				_drag_now = false
				_enter(S.DRAG)
		S.DRAG:
			if _t < 0.5:
				_arc(_r_from, MOUTH, _t / 0.5)
			elif _t < 2.3:
				_set_pose(_rhand, MOUTH)
				_glow = move_toward(_glow, 1.0, delta * 2.5)
				_burn = minf(_burn + delta / 1.8 / _drags_total, 1.0)
				_place_paper()
			else:
				_arc(MOUTH, IDLE, (_t - 2.3) / 0.6)
			if _t > 0.45 and _t - delta <= 0.45:
				Game.play_3d(Sfx.get_stream(&"cig_drag"), global_position, -6.0, 0.04, 1.0, 3.0)
			# Out, once the cigarette is away from the lips.
			if _t > 2.6 and _t - delta <= 2.6:
				_exhale(1.8)
				_took_drag()
			if _t > 2.95:
				_next_drag = randf_range(6.0, 10.0)
				_enter(S.IDLE)
		S.THROW:
			if _t < 0.35:
				_blend(_rhand, _r_from, WINDUP, _t / 0.35)
			elif _t < 0.47:
				_blend(_rhand, WINDUP, FLING, (_t - 0.35) / 0.12)
			else:
				_blend(_rhand, FLING, HIDDEN_R, (_t - 0.47) / 0.45)
			if _t > 0.43 and _cig and _cig.visible:
				_fling()
			if _t > 0.95:
				state = S.OFF
				visible = false
				finished.emit()

	# Ember: bright on a drag, dull red when left alone, flickering.
	if _lit and _cig and _cig.visible:
		var idle_glow := 0.22 + 0.06 * sin(_clock * 7.0) * sin(_clock * 2.3)
		_glow = move_toward(_glow, idle_glow, delta * (0.8 if _glow > idle_glow else 3.0))
		_ember_mat.emission_energy_multiplier = 1.0 + _glow * 9.0
		_ember_light.light_energy = 0.03 + _glow * 0.22
		# A thin thread off the smouldering tip, into the air (smoke_field.gd).
		var smoulder: bool = state == S.IDLE or (state == S.DRAG and (_t < 0.4 or _t > 2.4))
		_wisps().thread(_ember.global_position, smoulder)
	elif _cig:
		_wisps().thread(Vector3.ZERO, false)
		_ember_mat.emission_energy_multiplier = 0.0
		_ember_light.light_energy = 0.0
		_tip_smoke.emitting = false
	_flame.visible = _flame_on
	_flame_light.light_energy = (1.3 + 0.35 * sin(_clock * 37.0) * sin(_clock * 23.0)) if _flame_on else 0.0
	# Eyes down on the tip while lighting it.
	var want_look := 0.15 if state == S.LIGHT and _t < 1.3 else 0.0
	look_down = move_toward(look_down, want_look, delta * 1.6)
	# The hands hang in camera space: with the eyes turned down on them they
	# are turned back up by as much, so they stay at the mouth and come into view.
	if look_down > 0.001:
		var up := Transform3D(Basis(Vector3.RIGHT, look_down), Vector3.ZERO)
		_rhand.transform = up * _rhand.transform
		_lhand.transform = up * _lhand.transform
	_flame.scale = Vector3.ONE * (1.0 + 0.12 * sin(_clock * 31.0))

	# Breathing smoke out.
	if _exhale_at >= 0.0 and _clock >= _exhale_at:
		_exhale_at = -1.0
		_breath_stop = _clock + _exhale_len
		Game.play_3d(Sfx.get_stream(&"cig_exhale"), global_position, -4.0, 0.05, 1.0, 3.0)
	if _breath_stop >= 0.0 and _clock >= _breath_stop:
		_breath_stop = -1.0
		_wisps().jet(Vector3.ZERO, Vector3.FORWARD, 0.0)
	elif _breath_stop >= 0.0 and Game.smoke:
		# Blown out of the mouth: strongest at first, trailing off.
		# Blown out through pursed lips: a narrow jet straight ahead, fast at
		# first and slowing as the breath runs out.
		var left := (_breath_stop - _clock) / maxf(_exhale_len, 0.1)
		var mouth: Vector3 = _breath.global_position
		var fwd: Vector3 = -player.cam.global_basis.z
		_wisps().jet(mouth + fwd * 0.04, (fwd + Vector3.DOWN * 0.1).normalized(), clampf(left, 0.0, 1.0))


func _took_drag() -> void:
	_drags_left -= 1
	if kind == "joint":
		Game.get_high(0.2)


## The butt leaves the hand as a physics object, still smouldering.
func _fling() -> void:
	var rb := RigidBody3D.new()
	rb.collision_layer = Game.LAYER_DEBRIS
	rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
	rb.mass = 0.002
	rb.continuous_cd = true
	rb.angular_damp = 1.0
	var xf := _cig.global_transform
	var copy := _cig.duplicate() as Node3D
	copy.transform = Transform3D.IDENTITY
	rb.add_child(copy)
	var cs := CollisionShape3D.new()
	var shape := CapsuleShape3D.new()
	shape.radius = 0.0048
	shape.height = _paper_start + _paper_len * (1.0 - 0.8 * _burn)
	cs.shape = shape
	cs.rotation = Vector3(PI * 0.5, 0, 0)
	cs.position = Vector3(0, 0, -shape.height * 0.5)
	rb.add_child(cs)
	get_tree().current_scene.add_child(rb)
	rb.global_transform = xf
	var cam: Camera3D = player.cam
	rb.linear_velocity = player.velocity - cam.global_basis.z * randf_range(8.0, 11.0) + cam.global_basis.y * 1.6
	rb.angular_velocity = Vector3(randf_range(-30, 30), randf_range(-10, 10), randf_range(-30, 30))
	# Keep it glowing and smoking for a while, then let it go out.
	var ember: MeshInstance3D = null
	for c in copy.get_children():
		if c is MeshInstance3D and (c as MeshInstance3D).material_override is StandardMaterial3D \
				and ((c as MeshInstance3D).material_override as StandardMaterial3D).emission_enabled:
			ember = c
	if ember:
		var em := (ember.material_override as StandardMaterial3D).duplicate() as StandardMaterial3D
		ember.material_override = em
		var tw := rb.create_tween()
		tw.tween_property(em, "emission_energy_multiplier", 0.0, 12.0)
		for c in ember.get_children():
			if c is OmniLight3D:
				tw.parallel().tween_property(c, "light_energy", 0.0, 10.0)
			elif c is GPUParticles3D:
				(c as GPUParticles3D).emitting = true
				get_tree().create_timer(9.0).timeout.connect(func(): if is_instance_valid(c): c.emitting = false)
	get_tree().create_timer(60.0).timeout.connect(rb.queue_free)
	_cig.visible = false
	_tip_smoke.emitting = false


var _wisp: Node3D


func _wisps() -> Node3D:
	if _wisp == null or not is_instance_valid(_wisp):
		_wisp = load("res://scripts/fx/smoke_wisps.gd").new()
		_wisp.top_level = true
		add_child(_wisp)
	return _wisp
