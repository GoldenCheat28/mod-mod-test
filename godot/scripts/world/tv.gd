extends Node3D
## An old CRT television that is somehow still on: the picture goes from one
## thing to the next - the news (a presenter talking, the ticker running
## under him), a cartoon, a football match, the test card, snow between
## channels - all through the bulging, lined glass of the tube. It lights the
## room with its colours (a light that follows what is on) and mutters.
## Origin at the bottom of the set; the screen faces +Z.

const SCREEN := """
shader_type spatial;
render_mode unshaded, cull_back;

uniform float t = 0.0;
uniform int prog = 0;       // 0 news, 1 cartoon, 2 football, 3 test card, 4 snow
uniform float cut = 0.0;    // flash/roll when the channel changes
uniform float power = 1.0;  // 1 on; switched off the picture collapses to a line, a dot, dark

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float box(vec2 p, vec2 c, vec2 s) {
	vec2 d = abs(p - c) - s;
	return step(max(d.x, d.y), 0.0);
}

float disc(vec2 p, vec2 c, float r) {
	return step(length(p - c), r);
}

vec3 news(vec2 uv) {
	vec3 col = mix(vec3(0.05, 0.12, 0.35), vec3(0.1, 0.25, 0.55), uv.y);
	// A map behind him, lines of a studio.
	col += 0.05 * step(0.97, fract(uv.x * 12.0)) * step(0.3, uv.y);
	// The presenter: shoulders, a head that nods as he talks, a mouth.
	vec2 hc = vec2(0.5, 0.58 + 0.01 * sin(t * 2.3));
	float body = box(uv, vec2(0.5, 0.22), vec2(0.22, 0.2));
	float head = disc(uv, hc, 0.11);
	col = mix(col, vec3(0.12, 0.12, 0.15), body);
	col = mix(col, vec3(0.85, 0.66, 0.52), head);
	col = mix(col, vec3(0.2, 0.12, 0.08), disc(uv, hc + vec2(0.0, 0.07), 0.08) * step(hc.y + 0.05, uv.y));
	float talk = abs(sin(t * 11.0) * sin(t * 3.7));
	col = mix(col, vec3(0.3, 0.05, 0.05), box(uv, hc - vec2(0.0, 0.05), vec2(0.03, 0.004 + 0.012 * talk)));
	col = mix(col, vec3(0.05), disc(uv, hc + vec2(-0.04, 0.02), 0.012) + disc(uv, hc + vec2(0.04, 0.02), 0.012));
	// The ticker: a red band, blocks of "text" running along it.
	float band = step(uv.y, 0.12) * step(0.04, uv.y);
	col = mix(col, vec3(0.7, 0.05, 0.05), band);
	float letters = step(0.45, hash(vec2(floor((uv.x + t * 0.15) * 40.0), 3.0))) * step(0.06, uv.y) * step(uv.y, 0.1);
	col = mix(col, vec3(0.95), letters * band);
	col = mix(col, vec3(0.95), box(uv, vec2(0.12, 0.88), vec2(0.07, 0.035)));
	return col;
}

vec3 cartoon(vec2 uv) {
	vec3 col = mix(vec3(0.95, 0.75, 0.3), vec3(0.4, 0.75, 1.0), step(0.35, uv.y));
	col = mix(col, vec3(0.2, 0.7, 0.25), step(uv.y, 0.35));
	// A cat chasing a mouse across and back, both bouncing.
	float x = fract(t * 0.18);
	float dir = step(0.5, fract(t * 0.09));
	float mx = mix(x, 1.0 - x, dir);
	vec2 m = vec2(mx, 0.4 + abs(sin(t * 7.0)) * 0.06);
	vec2 c = vec2(mx - (dir > 0.5 ? -0.25 : 0.25), 0.44 + abs(sin(t * 5.0)) * 0.08);
	col = mix(col, vec3(0.5, 0.5, 0.55), disc(uv, m, 0.035));
	col = mix(col, vec3(0.3, 0.3, 0.35), disc(uv, c, 0.08) + disc(uv, c + vec2(0.0, 0.1), 0.05));
	col = mix(col, vec3(1.0, 1.0, 0.8), disc(uv, vec2(0.85, 0.85), 0.07));
	return col;
}

vec3 football(vec2 uv) {
	vec3 col = mix(vec3(0.12, 0.45, 0.15), vec3(0.15, 0.52, 0.18), step(0.5, fract(uv.x * 6.0 + t * 0.05)));
	col = mix(col, vec3(0.9), step(abs(uv.x - 0.5 - 0.05 * sin(t * 0.1)), 0.004));
	col = mix(col, vec3(0.9), step(abs(length((uv - vec2(0.5, 0.5)) * vec2(1.0, 1.4)) - 0.18), 0.004));
	// Little players in two colours running about, the ball.
	for (int i = 0; i < 10; i++) {
		float fi = float(i);
		vec2 p = vec2(0.5 + 0.4 * sin(t * (0.3 + fi * 0.07) + fi * 2.1), 0.5 + 0.35 * cos(t * (0.25 + fi * 0.05) + fi));
		col = mix(col, i < 5 ? vec3(0.9, 0.1, 0.1) : vec3(0.95), box(uv, p, vec2(0.012, 0.03)));
	}
	vec2 ball = vec2(0.5 + 0.35 * sin(t * 0.6), 0.5 + 0.3 * sin(t * 0.83));
	col = mix(col, vec3(1.0), disc(uv, ball, 0.012));
	col = mix(col, vec3(0.05), box(uv, vec2(0.13, 0.9), vec2(0.1, 0.035)));
	return col;
}

vec3 test_card(vec2 uv) {
	vec3 bars[7] = vec3[](vec3(0.9), vec3(0.9, 0.9, 0.1), vec3(0.1, 0.9, 0.9), vec3(0.1, 0.9, 0.1), vec3(0.9, 0.1, 0.9), vec3(0.9, 0.1, 0.1), vec3(0.1, 0.1, 0.9));
	vec3 col = bars[clamp(int(uv.x * 7.0), 0, 6)];
	col = mix(col, vec3(0.05), step(uv.y, 0.25));
	col = mix(col, vec3(0.9), step(uv.y, 0.12) * step(0.5, fract(uv.x * 8.0)));
	return col;
}

void fragment() {
	vec2 uv = UV;
	// The bulge of the tube.
	vec2 c = uv - 0.5;
	uv = 0.5 + c * (1.0 + 0.12 * dot(c, c));
	uv.y += cut * 0.3 * sin(t * 40.0);
	float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
	vec3 col;
	if (prog == 0) col = news(vec2(uv.x, 1.0 - uv.y));
	else if (prog == 1) col = cartoon(vec2(uv.x, 1.0 - uv.y));
	else if (prog == 2) col = football(vec2(uv.x, 1.0 - uv.y));
	else if (prog == 3) col = test_card(vec2(uv.x, 1.0 - uv.y));
	else col = vec3(hash(floor(uv * vec2(160.0, 120.0)) + fract(t * 17.0)));
	// Scanlines, a slow roll bar, noise, the edges darker.
	col *= 0.82 + 0.18 * sin(uv.y * 480.0);
	col *= 0.9 + 0.1 * smoothstep(0.0, 0.1, abs(fract(uv.y * 0.5 - t * 0.12) - 0.5));
	col += (hash(uv * 400.0 + t) - 0.5) * 0.08;
	col = mix(col, vec3(1.0), cut * 0.6);
	col *= 1.0 - 0.6 * smoothstep(0.25, 0.5, length(c));
	// Off: squeezed to a bright line, then a dot, then the dark glass.
	float sq = clamp(power * 2.0, 0.0, 1.0);
	float line = 1.0 - smoothstep(sq * 0.5, sq * 0.5 + 0.01, abs(UV.y - 0.5));
	float dot_k = clamp(power * 4.0, 0.0, 1.0);
	float dotm = 1.0 - smoothstep(0.02 + dot_k * 0.5, 0.03 + dot_k * 0.5, abs(UV.x - 0.5));
	vec3 lit = mix(vec3(1.0) * (1.0 - power) * 2.0, col, sq);
	col = power >= 1.0 ? col : lit * line * dotm;
	vec3 glass = vec3(0.02, 0.025, 0.022) + vec3(0.03) * (1.0 - smoothstep(0.0, 0.5, length(c)));
	ALBEDO = max(col * inside * 1.35, glass);
}
"""

var _mat: ShaderMaterial
var _light: OmniLight3D
var _voice: AudioStreamPlayer3D
var _t := 0.0
var _prog := 0
var _next := 6.0
var _cut := 0.0
var on := true
var _power := 1.0
const PROG_LIGHT := [Color(0.55, 0.65, 1.0), Color(0.95, 0.85, 0.65), Color(0.6, 0.85, 0.6), Color(0.9, 0.9, 0.9), Color(0.8, 0.8, 0.85)]


func _ready() -> void:
	var plastic := StandardMaterial3D.new()
	plastic.albedo_color = Color(0.12, 0.11, 0.1)
	plastic.roughness = 0.55
	var wood := StandardMaterial3D.new()
	wood.albedo_color = Color(0.3, 0.19, 0.1)
	wood.roughness = 0.6
	# The cabinet (a wooden-sided set of the old kind), the tube's back, knobs.
	_box(Vector3(0.62, 0.48, 0.45), Vector3(0, 0.24, 0), wood)
	_box(Vector3(0.44, 0.34, 0.25), Vector3(0, 0.25, -0.33), plastic)
	_box(Vector3(0.64, 0.5, 0.02), Vector3(0, 0.24, 0.225), plastic)
	for k in 2:
		var knob := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.02
		cm.bottom_radius = 0.022
		cm.height = 0.02
		knob.mesh = cm
		knob.material_override = plastic
		knob.rotation = Vector3(PI * 0.5, 0, 0)
		knob.position = Vector3(0.25, 0.3 - k * 0.1, 0.24)
		add_child(knob)
	# Rabbit-ear aerial.
	for sx in [-1.0, 1.0]:
		var rod := MeshInstance3D.new()
		var rm := CylinderMesh.new()
		rm.top_radius = 0.003
		rm.bottom_radius = 0.004
		rm.height = 0.5
		rod.mesh = rm
		var steel := StandardMaterial3D.new()
		steel.albedo_color = Color(0.7, 0.7, 0.7)
		steel.metallic = 0.9
		rod.material_override = steel
		rod.rotation = Vector3(0, 0, -0.45 * sx)
		rod.position = Vector3(0.11 * sx, 0.7, -0.05)
		add_child(rod)
	# The screen.
	_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = SCREEN
	_mat.shader = sh
	var scr := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.44, 0.34)
	scr.mesh = q
	scr.material_override = _mat
	scr.position = Vector3(-0.05, 0.26, 0.237)
	scr.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(scr)
	_light = OmniLight3D.new()
	_light.position = Vector3(0, 0.3, 0.6)
	_light.omni_range = 3.6
	_light.omni_attenuation = 1.6
	_light.light_energy = 0.3
	_light.shadow_enabled = false
	add_child(_light)
	_voice = AudioStreamPlayer3D.new()
	_voice.stream = _babble()
	_voice.bus = &"World"
	_voice.unit_size = 1.6
	_voice.max_distance = 14.0
	_voice.volume_db = -14.0
	_voice.position = Vector3(0, 0.3, 0.2)
	add_child(_voice)
	_voice.play(randf() * 5.0)
	# Something to press (F): the set can be switched off and on.
	var body := StaticBody3D.new()
	body.collision_layer = Game.LAYER_PROPS
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(0.64, 0.5, 0.47)
	cs.shape = bs
	cs.position = Vector3(0, 0.25, 0)
	body.add_child(cs)
	body.set_meta("tv", self)
	add_child(body)


## F on it: off (the picture collapses) or on again.
func toggle() -> void:
	on = not on
	Game.play_3d(preload("res://scripts/audio/sfx.gd").get_stream(&"key_press"), global_position + Vector3.UP * 0.3, -6.0, 0.05, 2.0)
	if on:
		_voice.play(randf() * 5.0)
		_cut = 1.0
	else:
		_voice.stop()


func _box(size: Vector3, pos: Vector3, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	add_child(mi)


func _process(delta: float) -> void:
	_t += delta
	_next -= delta
	if _next <= 0.0:
		# Someone left it flicking between channels: snow in between.
		var was := _prog
		_prog = 4 if _prog != 4 and randf() < 0.35 else [0, 1, 2, 3][randi() % 4]
		_next = 1.2 if _prog == 4 else randf_range(7.0, 16.0)
		_cut = 1.0
		if was == _prog:
			_cut = 0.0
	_cut = move_toward(_cut, 0.0, delta * 5.0)
	_power = move_toward(_power, 1.0 if on else 0.0, delta * (4.0 if on else 3.0))
	_mat.set_shader_parameter("power", _power)
	if not on and _power <= 0.0:
		_light.visible = false
		return
	_light.visible = true
	_mat.set_shader_parameter("t", _t)
	_mat.set_shader_parameter("prog", _prog)
	_mat.set_shader_parameter("cut", _cut)
	var flick := 0.75 + 0.25 * sin(_t * 13.0) * sin(_t * 3.1)
	_light.light_color = PROG_LIGHT[_prog]
	_light.light_energy = (0.28 + _cut * 0.5) * flick * _power
	_voice.volume_db = -26.0 if _prog >= 3 else -14.0


## Six seconds of someone talking on the television, made here: noise shaped
## into vowels and syllables (a few formants), words and pauses, through a
## small loudspeaker.
static func _babble() -> AudioStreamWAV:
	var rate := 22050
	var n := rate * 6
	var data := PackedByteArray()
	data.resize(n * 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 17
	var ph := 0.0
	var syl := 0.0
	var f1 := 500.0
	var f2 := 1500.0
	var lp := 0.0
	var word_gap := 0.0
	for i in n:
		var t := float(i) / rate
		syl -= 1.0 / rate
		if syl <= 0.0:
			syl = rng.randf_range(0.08, 0.2)
			f1 = rng.randf_range(300.0, 800.0)
			f2 = rng.randf_range(900.0, 2200.0)
			if rng.randf() < 0.18:
				word_gap = rng.randf_range(0.1, 0.35)
		word_gap -= 1.0 / rate
		var pitch := 120.0 + 25.0 * sin(t * 2.3) + 10.0 * sin(t * 7.1)
		ph += pitch / rate
		var buzz := fmod(ph, 1.0) * 2.0 - 1.0
		var env := 0.0 if word_gap > 0.0 else sin(PI * clampf(1.0 - syl / 0.2, 0.0, 1.0))
		var v := buzz * (sin(TAU * f1 * t) * 0.6 + sin(TAU * f2 * t) * 0.3) * env
		v += rng.randf_range(-1.0, 1.0) * 0.05
		lp += (v - lp) * 0.35
		data.encode_s16(i * 2, int(clampf(lp * 0.6, -1.0, 1.0) * 26000.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = rate
	wav.data = data
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_end = n
	return wav
