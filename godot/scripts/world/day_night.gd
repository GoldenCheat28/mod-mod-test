extends Node
## Day and night. The sun goes round (a whole day in DAY_MINUTES real
## minutes): warm and low at dusk and dawn, gone at night. Night looks like
## the main menu: black sky, a cold moon, fog thick in the street, the
## sodium street lamps on (their light in the fog), one of them dying.
## Runs after the weather each frame and adjusts what it has set.

const DAY_MINUTES := 24.0          # real minutes in a whole day

var hour := 13.0                   # 0..24
var sun: DirectionalLight3D
var env: Environment
var sky_mat: ShaderMaterial
var night := 0.0                   # 0 day .. 1 full night
var quality := 2                   # graphics level (Game.apply_quality)
var _moon: DirectionalLight3D
var _lamps: Array = []             # [OmniLight3D, bulb material, dying]
var _flick := 0.0
var _dying_k := 1.0
var _sun_basis_yaw := -35.0


func setup(sun_light: DirectionalLight3D, environment: Environment, sky_material: ShaderMaterial) -> void:
	sun = sun_light
	env = environment
	sky_mat = sky_material
	var start := OS.get_environment("HOUR")
	if start != "":
		hour = float(start)
	_moon = DirectionalLight3D.new()
	_moon.name = "Moon"
	_moon.rotation_degrees = Vector3(-38, 140, 0)
	_moon.light_color = Color(0.55, 0.65, 0.85)
	_moon.light_energy = 0.0
	_moon.shadow_enabled = true
	_moon.directional_shadow_max_distance = 40.0
	add_child(_moon)
	env.volumetric_fog_albedo = Color(0.55, 0.58, 0.65)
	env.volumetric_fog_emission = Color(0.01, 0.012, 0.018)
	env.volumetric_fog_length = 48.0


## The street lamps' lights (map_builder.gd makes the lamps).
func add_lamp(head: Vector3, dying: bool, parent: Node) -> void:
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.62, 0.3)
	l.omni_range = 13.0
	l.omni_attenuation = 1.3
	l.light_volumetric_fog_energy = 2.5
	l.shadow_enabled = true
	l.light_energy = 0.0
	l.position = head + Vector3.DOWN * 0.25
	l.add_to_group(&"lamp_light")
	parent.add_child(l)
	# The glowing lens under the head.
	var bulb := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.28, 0.02, 0.45)
	bulb.mesh = bm
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.3, 0.28, 0.25)
	m.emission_enabled = true
	m.emission = Color(1.0, 0.6, 0.28)
	m.emission_energy_multiplier = 0.0
	bulb.material_override = m
	bulb.position = head + Vector3.DOWN * 0.215
	bulb.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(bulb)
	_lamps.append([l, m, dying])


func _process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["day_night._process"] = Game.prof.get("day_night._process", 0) + __d
	Game.prof["max day_night._process"] = maxi(Game.prof.get("max day_night._process", 0), __d)


func _process_real(delta: float) -> void:
	if sun == null:
		return
	hour = fposmod(hour + delta * 24.0 / (DAY_MINUTES * 60.0), 24.0)
	# The sun's height: up at 6, highest at 12, down at 18.
	var a := (hour - 6.0) / 12.0 * PI
	var elev := sin(a)
	var day := smoothstep(-0.08, 0.18, elev)
	night = 1.0 - smoothstep(-0.22, 0.05, elev)
	var dusk := clampf(1.0 - absf(elev) / 0.35, 0.0, 1.0) * (1.0 - night * 0.6)
	# The sun is turned in whole steps, now and then, not a hair every frame:
	# a light that never stops turning makes every shadow edge crawl and
	# shimmer (its shadow map is redrawn a texel off each time).
	var want_rot := Vector3(-clampf(rad_to_deg(asin(clampf(elev, -1.0, 1.0))), 4.0, 80.0), _sun_basis_yaw - (hour - 12.0) * 12.0, 0)
	if sun.rotation_degrees.distance_to(want_rot) > 0.6 or absf(delta) > 0.5:
		sun.rotation_degrees = want_rot
	sun.light_energy *= day
	sun.light_color = Color(1.0, 0.96, 0.9).lerp(Color(1.0, 0.62, 0.38), dusk)
	sun.visible = day > 0.01
	# The moon, cold and faint.
	_moon.light_energy = 0.2 * night
	_moon.visible = night > 0.02
	# Sky: dusk colours, then black.
	var top: Color = sky_mat.get_shader_parameter("top_color")
	var hor: Color = sky_mat.get_shader_parameter("horizon_color")
	top = top.lerp(Color(0.2, 0.18, 0.26), dusk * 0.6).lerp(Color(0.008, 0.01, 0.018), night)
	hor = hor.lerp(Color(0.85, 0.5, 0.32), dusk * 0.7).lerp(Color(0.025, 0.028, 0.04), night)
	sky_mat.set_shader_parameter("top_color", top)
	sky_mat.set_shader_parameter("horizon_color", hor)
	sky_mat.set_shader_parameter("cloud_dark", night)
	# Light and air: dark, foggy and drained of colour at night.
	env.ambient_light_energy = lerpf(env.ambient_light_energy, 0.22, night)
	env.fog_light_color = env.fog_light_color.lerp(Color(0.04, 0.045, 0.06), night)
	# (low graphics: plain distance fog, thicker, instead of the volumetric)
	env.volumetric_fog_enabled = night > 0.25 and quality >= 1
	if quality == 0:
		env.fog_density = lerpf(env.fog_density, 0.035, night)
	env.volumetric_fog_density = 0.045 * smoothstep(0.25, 0.8, night)
	env.adjustment_saturation = lerpf(1.02, 0.7, night)
	env.adjustment_contrast = lerpf(1.04, 1.12, night)
	env.glow_intensity = lerpf(0.25, 0.6, night)
	env.glow_bloom = lerpf(0.02, 0.08, night)
	env.tonemap_exposure *= lerpf(1.0, 1.15, night)
	# The street lamps: on at dusk, one of them failing.
	var on := smoothstep(0.1, 0.5, night + dusk * 0.3)
	# (the dying one: mostly on, dropping out now and then for a moment)
	_flick -= delta
	if _flick <= 0.0:
		_flick = randf_range(0.03, 0.4)
		_dying_k = 1.0 if randf() < 0.75 else randf_range(0.0, 0.3)
	for lamp in _lamps:
		var l: OmniLight3D = lamp[0]
		var k := on * (_dying_k if lamp[2] else 1.0)
		l.light_energy = 5.5 * k
		l.visible = k > 0.01
		l.shadow_enabled = k > 0.5 and quality >= 2
		l.light_volumetric_fog_energy = 2.5 if quality >= 1 else 0.0
		(lamp[1] as StandardMaterial3D).emission_energy_multiplier = 6.0 * k


## "18:40"
func clock_text() -> String:
	return "%02d:%02d" % [int(hour), int(fmod(hour, 1.0) * 60.0)]
