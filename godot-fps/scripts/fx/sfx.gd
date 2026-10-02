class_name Sfx
# Синтезированные звуки (без внешних файлов): выстрел, щелчки, магазин, затвор.

static var _cache: Dictionary = {}

static func _wav(samples: PackedFloat32Array, rate: int = 22050) -> AudioStreamWAV:
	var bytes := PackedByteArray()
	bytes.resize(samples.size() * 2)
	for i in samples.size():
		var v := int(clampf(samples[i], -1.0, 1.0) * 32000.0)
		bytes[i * 2] = v & 0xff
		bytes[i * 2 + 1] = (v >> 8) & 0xff
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = rate
	w.stereo = false
	w.data = bytes
	return w

static func get_sound(name: String) -> AudioStreamWAV:
	if _cache.has(name):
		return _cache[name]
	var rng := RandomNumberGenerator.new()
	rng.seed = name.hash()
	var rate := 22050
	var out := PackedFloat32Array()
	match name:
		"shot":
			var n := int(rate * 0.45)
			out.resize(n)
			var lp := 0.0
			for i in n:
				var t := float(i) / rate
				var noise := rng.randf_range(-1.0, 1.0)
				lp += (noise - lp) * 0.35                       # сглаженный шум — «хлопок»
				var crack := noise * exp(-t * 90.0) * 0.8        # резкий щелчок в начале
				var body := lp * exp(-t * 14.0) * 0.9
				var thump := sin(TAU * (60.0 - t * 80.0) * t) * exp(-t * 22.0) * 0.9
				out[i] = (crack + body + thump) * 0.8
		"enemy_shot":
			var n2 := int(rate * 0.4)
			out.resize(n2)
			var lp2 := 0.0
			for i in n2:
				var t2 := float(i) / rate
				var noise2 := rng.randf_range(-1.0, 1.0)
				lp2 += (noise2 - lp2) * 0.25
				out[i] = (noise2 * exp(-t2 * 110.0) * 0.6 + lp2 * exp(-t2 * 16.0) * 0.9 + sin(TAU * 50.0 * t2) * exp(-t2 * 25.0) * 0.7) * 0.7
		"mag_out", "mag_in", "bolt_back", "bolt_fwd", "dry":
			var dur := 0.09
			var freq := 1400.0
			var amp := 0.5
			match name:
				"mag_out":
					dur = 0.12; freq = 900.0; amp = 0.55
				"mag_in":
					dur = 0.1; freq = 1100.0; amp = 0.7
				"bolt_back":
					dur = 0.14; freq = 700.0; amp = 0.6
				"bolt_fwd":
					dur = 0.1; freq = 1500.0; amp = 0.75
				"dry":
					dur = 0.05; freq = 2200.0; amp = 0.4
			var n3 := int(rate * dur)
			out.resize(n3)
			for i in n3:
				var t3 := float(i) / rate
				var env := exp(-t3 * (40.0 if name != "bolt_back" else 22.0))
				out[i] = (rng.randf_range(-1.0, 1.0) * 0.6 + sin(TAU * freq * t3) * 0.7 + sin(TAU * freq * 2.7 * t3) * 0.3) * env * amp
	var w := _wav(out, rate)
	_cache[name] = w
	return w

# Одноразовый звук в точке мира.
static func play_at(parent: Node, name: String, pos: Vector3, volume_db: float = 0.0) -> void:
	var p := AudioStreamPlayer3D.new()
	p.stream = get_sound(name)
	p.volume_db = volume_db
	p.pitch_scale = randf_range(0.93, 1.07)
	p.max_distance = 80.0
	parent.add_child(p)
	p.global_position = pos
	p.finished.connect(p.queue_free)
	p.play()
