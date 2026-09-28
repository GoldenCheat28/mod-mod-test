extends RefCounted
## Procedurally synthesized sound effects (no audio files needed).
## Streams are generated once and cached; most sounds have a few variants.

const RATE := 44100

## Recorded sounds (res://assets/sounds/<name>.ogg). A sound listed here with
## no files is intentionally silent (covered by another recording).
const FILES := {
	&"pistol_shot": ["pistol_shot"],
	&"shotgun_shot": ["shotgun_shot"],
	&"body_fall": ["body_fall"],
	&"metal_hit": ["barrel_hit_1", "barrel_hit_2"],
	&"casing": ["casing_1", "casing_2"],
	&"shell_drop": ["shell_drop"],
	&"pump_back": ["pump"],          # one recording holds the whole back-forward stroke
	&"pump_forward": [],
	&"slide_forward": ["slide_forward"],
	&"slide_back": ["slide_back"],
	&"mag_out": ["mag_out"],
	&"mag_in": ["mag_in"],
	&"mag_drop": ["mag_drop"],
	&"flesh": ["flesh"],
	&"step": ["steps/step_01", "steps/step_02", "steps/step_03", "steps/step_04", "steps/step_05",
			"steps/step_06", "steps/step_07", "steps/step_08", "steps/step_09", "steps/step_10"],
	&"puddle_walk": ["puddle_walk"],
	&"puddle_run": ["puddle_run"],
}

static var _cache := {}


## Loads/synthesizes everything up front so the first shot does not hitch.
static func prewarm() -> void:
	for s in FILES.keys() + [&"dry_fire", &"shell_insert", &"land", &"impact"]:
		get_stream(s)


static func get_stream(sound: StringName) -> AudioStream:
	if FILES.has(sound):
		if not _cache.has(sound):
			var list: Array[AudioStream] = []
			for f in FILES[sound]:
				list.append(load("res://assets/sounds/%s.ogg" % f))
			_cache[sound] = list
		var files: Array = _cache[sound]
		return files[randi() % files.size()] if not files.is_empty() else null
	if not _cache.has(sound):
		var variants: Array[AudioStreamWAV] = []
		for v in _variant_count(sound):
			seed(hash(String(sound)) + v * 7919)
			variants.append(_to_wav(_synth(sound)))
		randomize()
		_cache[sound] = variants
	var list: Array = _cache[sound]
	return list[randi() % list.size()]


static func _variant_count(sound: StringName) -> int:
	match sound:
		&"pistol_shot", &"shotgun_shot", &"casing", &"step", &"impact", &"flesh":
			return 3
	return 1


static func _synth(sound: StringName) -> PackedFloat32Array:
	match sound:
		&"pistol_shot":
			return _gunshot(1.4, 0.005, 0.045, 95.0, 0.07, 0.42, 1.0)
		&"shotgun_shot":
			return _gunshot(1.9, 0.008, 0.08, 62.0, 0.12, 0.7, 1.35)
		&"dry_fire":
			return _clicks([[0.0, 1.0, 2600.0]], 0.12)
		&"slide_back":
			return _mech([[0.0, 0.8, 2100.0], [0.07, 0.6, 3300.0]], 0.02, 0.07, 0.25)
		&"slide_forward":
			return _mech([[0.0, 1.0, 1900.0], [0.012, 0.7, 3100.0]], 0.0, 0.0, 0.2)
		&"mag_out":
			return _mech([[0.0, 0.7, 2400.0], [0.05, 0.4, 1500.0]], 0.01, 0.06, 0.3)
		&"mag_in":
			return _mech([[0.0, 0.5, 1300.0], [0.035, 1.0, 1700.0], [0.045, 0.6, 3600.0]], 0.0, 0.035, 0.28)
		&"mag_drop":
			return _clicks([[0.0, 0.8, 900.0], [0.09, 0.4, 1200.0]], 0.35)
		&"pump_back":
			return _mech([[0.0, 0.6, 1700.0], [0.1, 0.9, 1250.0]], 0.01, 0.1, 0.35)
		&"pump_forward":
			return _mech([[0.0, 0.4, 1400.0], [0.08, 1.0, 1900.0]], 0.0, 0.08, 0.3)
		&"shell_insert":
			return _mech([[0.0, 0.5, 900.0], [0.05, 0.8, 1600.0]], 0.0, 0.05, 0.25)
		&"casing":
			return _ring([4100.0, 6650.0, 9150.0, 12100.0], 0.09, 0.35)
		&"shell_drop":
			return _clicks([[0.0, 0.6, 700.0], [0.07, 0.3, 850.0]], 0.25)
		&"step":
			return _thud(0.07, 0.22, 0.35)
		&"land":
			return _thud(0.14, 0.12, 0.6)
		&"impact":
			return _thud(0.05, 0.5, 0.25)
		&"flesh":
			return _flesh()
		&"body_fall":
			return _thud(0.25, 0.08, 0.7)
		&"metal_hit":
			return _ring([820.0, 1310.0, 2240.0, 3390.0], 0.35, 0.9)
	return PackedFloat32Array([0.0])


static func _to_wav(s: PackedFloat32Array) -> AudioStreamWAV:
	var peak := 0.0001
	for x in s:
		peak = maxf(peak, absf(x))
	var gain := 0.95 / peak
	var bytes := PackedByteArray()
	bytes.resize(s.size() * 2)
	for i in s.size():
		bytes.encode_s16(i * 2, int(clampf(s[i] * gain, -1.0, 1.0) * 32767.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.stereo = false
	w.data = bytes
	return w


## Crack + body + low thump + long filtered tail with two slap-back echoes.
static func _gunshot(length: float, crack_t: float, body_t: float, thump_hz: float, thump_t: float, tail_t: float, weight: float) -> PackedFloat32Array:
	var n := int(length * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	var lp1 := 0.0
	var lp2 := 0.0
	var phase := 0.0
	for i in n:
		var t := float(i) / RATE
		var noise := randf() * 2.0 - 1.0
		lp1 += (noise - lp1) * 0.18
		lp2 += (noise - lp2) * 0.035
		var f := thump_hz * (1.0 + 1.5 * exp(-t / 0.01))
		phase += TAU * f / RATE
		var v := noise * exp(-t / crack_t) * 1.2
		v += lp1 * exp(-t / body_t) * 2.2 * weight
		v += sin(phase) * exp(-t / thump_t) * 0.9 * weight
		v += lp2 * exp(-t / tail_t) * 1.6
		s[i] = v
	# Slap-back echoes off distant buildings.
	for echo in [[0.11, 0.22], [0.29, 0.12]]:
		var off := int(echo[0] * RATE)
		for i in range(n - 1, off, -1):
			s[i] += s[i - off] * echo[1] * 0.5
	return s


## Short metallic clicks: each entry is [time, gain, freq].
static func _clicks(events: Array, length: float) -> PackedFloat32Array:
	var n := int(length * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	for e in events:
		var start := int(e[0] * RATE)
		for i in range(start, n):
			var t := float(i - start) / RATE
			var env := exp(-t / 0.006)
			if env < 0.001:
				break
			var v := sin(TAU * e[2] * t) + 0.6 * sin(TAU * e[2] * 1.73 * t)
			v += (randf() * 2.0 - 1.0) * exp(-t / 0.0015) * 1.5
			s[i] += v * env * e[1]
	return s


## Clicks plus a filtered scrape between scrape_from and scrape_to.
static func _mech(events: Array, scrape_from: float, scrape_to: float, length: float) -> PackedFloat32Array:
	var s := _clicks(events, length)
	if scrape_to > scrape_from:
		var a := int(scrape_from * RATE)
		var b := int(scrape_to * RATE)
		var hp := 0.0
		var prev := 0.0
		for i in range(a, mini(b, s.size())):
			var noise := randf() * 2.0 - 1.0
			hp = 0.8 * (hp + noise - prev)
			prev = noise
			var k := float(i - a) / float(b - a)
			s[i] += hp * sin(k * PI) * 0.25
	return s


static func _ring(freqs: Array, decay: float, length: float) -> PackedFloat32Array:
	var n := int(length * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	var detune := randf_range(0.93, 1.07)
	for i in n:
		var t := float(i) / RATE
		var v := 0.0
		for k in freqs.size():
			v += sin(TAU * freqs[k] * detune * t) * exp(-t / (decay / (1.0 + k * 0.6))) / (1.0 + k * 0.4)
		v += (randf() * 2.0 - 1.0) * exp(-t / 0.002)
		s[i] = v
	return s


## Low filtered noise burst with a little high "grit".
static func _thud(decay: float, grit: float, length: float) -> PackedFloat32Array:
	var n := int(length * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	var lp := 0.0
	for i in n:
		var t := float(i) / RATE
		var noise := randf() * 2.0 - 1.0
		lp += (noise - lp) * 0.06
		s[i] = lp * exp(-t / decay) * 3.0 + noise * grit * exp(-t / (decay * 0.3))
	return s


static func _flesh() -> PackedFloat32Array:
	var n := int(0.3 * RATE)
	var s := PackedFloat32Array()
	s.resize(n)
	var lp := 0.0
	var lp2 := 0.0
	for i in n:
		var t := float(i) / RATE
		var noise := randf() * 2.0 - 1.0
		lp += (noise - lp) * 0.12
		lp2 += (lp - lp2) * 0.3
		s[i] = lp2 * exp(-t / 0.05) * 3.0 + sin(TAU * 70.0 * t) * exp(-t / 0.04) * 0.6 + noise * exp(-t / 0.004) * 0.4
	return s
