extends Node
## Процедурные звуки-заглушки: генерируются при запуске, файлы не нужны.
## Потом замени на настоящие записи: просто положи AudioStream в словарь _streams.

const RATE := 22050
const POOL_SIZE := 24

var _streams := {}          # имя -> Array[AudioStreamWAV] (несколько вариантов)
var _pool: Array[AudioStreamPlayer3D] = []
var _pool_next := 0
var _ui_player: AudioStreamPlayer


func _ready() -> void:
	_streams["shot"] = [_wav(_gunshot()), _wav(_gunshot()), _wav(_gunshot())]
	_streams["dry"] = [_wav(_click(2600.0, 0.03))]
	_streams["mag_out"] = [_wav(_click(1400.0, 0.06))]
	_streams["mag_in"] = [_wav(_click(1900.0, 0.05))]
	_streams["bolt"] = [_wav(_click(3200.0, 0.08))]
	_streams["shell"] = [_wav(_tink(1.0)), _wav(_tink(1.12)), _wav(_tink(0.9))]
	_streams["impact"] = [_wav(_impact(0.5)), _wav(_impact(0.6))]
	_streams["impact_metal"] = [_wav(_tink(0.55)), _wav(_tink(0.62))]
	_streams["flesh"] = [_wav(_flesh()), _wav(_flesh())]
	_streams["thud"] = [_wav(_impact(0.12)), _wav(_impact(0.15))]
	_streams["step"] = [_wav(_impact(0.08)), _wav(_impact(0.1))]

	for i in POOL_SIZE:
		var p := AudioStreamPlayer3D.new()
		p.unit_size = 6.0
		p.max_db = 3.0
		p.attenuation_filter_cutoff_hz = 9000.0
		add_child(p)
		_pool.append(p)
	_ui_player = AudioStreamPlayer.new()
	add_child(_ui_player)


## Звук в точке мира.
func play_3d(sound: String, pos: Vector3, volume_db := 0.0, pitch_var := 0.06) -> void:
	if not _streams.has(sound):
		return
	var p := _pool[_pool_next]
	_pool_next = (_pool_next + 1) % POOL_SIZE
	p.stream = _streams[sound].pick_random()
	p.volume_db = volume_db
	p.pitch_scale = 1.0 + randf_range(-pitch_var, pitch_var)
	p.global_position = pos
	p.play()


## Звук «у игрока в голове» (свой выстрел, перезарядка).
func play(sound: String, volume_db := 0.0, pitch_var := 0.05) -> void:
	if not _streams.has(sound):
		return
	# Отдельный плеер на каждый вызов, чтобы очередь выстрелов не обрезала хвост.
	var p := AudioStreamPlayer.new()
	p.stream = _streams[sound].pick_random()
	p.volume_db = volume_db
	p.pitch_scale = 1.0 + randf_range(-pitch_var, pitch_var)
	add_child(p)
	p.play()
	p.finished.connect(p.queue_free)


# --- генераторы ---------------------------------------------------------------

func _wav(samples: PackedFloat32Array) -> AudioStreamWAV:
	var peak := 0.0001
	for s in samples:
		peak = maxf(peak, absf(s))
	var data := PackedByteArray()
	data.resize(samples.size() * 2)
	for i in samples.size():
		data.encode_s16(i * 2, int(samples[i] / peak * 0.9 * 32767.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.stereo = false
	w.data = data
	return w


func _buf(seconds: float) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(int(RATE * seconds))
	return out


func _gunshot() -> PackedFloat32Array:
	var out := _buf(0.7)
	var lp := 0.0
	var lp2 := 0.0
	var phase := 0.0
	for i in out.size():
		var t := float(i) / RATE
		var n := randf_range(-1.0, 1.0)
		lp += (n - lp) * 0.45
		lp2 += (n - lp2) * 0.05
		phase += TAU * (48.0 + 110.0 * exp(-t * 35.0)) / RATE
		var crack := n * exp(-t * 120.0)
		var body := lp * exp(-t * 26.0)
		var thump := sin(phase) * exp(-t * 16.0)
		var tail := lp2 * exp(-t * 4.5) * 3.0   # «эхо» помещения
		out[i] = crack * 0.7 + body * 0.9 + thump * 0.9 + tail * 0.45
	return out


func _click(freq: float, seconds: float) -> PackedFloat32Array:
	var out := _buf(seconds)
	for i in out.size():
		var t := float(i) / RATE
		out[i] = randf_range(-1.0, 1.0) * exp(-t * 500.0) + sin(TAU * freq * t) * exp(-t * 180.0) * 0.6 \
			+ sin(TAU * freq * 1.7 * t) * exp(-t * 260.0) * 0.3
	return out


func _tink(pitch: float) -> PackedFloat32Array:
	var out := _buf(0.35)
	var freqs := [2900.0, 4350.0, 6100.0, 7600.0]
	var decays := [14.0, 20.0, 30.0, 45.0]
	for i in out.size():
		var t := float(i) / RATE
		var s := randf_range(-1.0, 1.0) * exp(-t * 900.0) * 0.4
		for k in freqs.size():
			s += sin(TAU * freqs[k] * pitch * t) * exp(-t * decays[k]) / (k + 1.0)
		out[i] = s
	return out


func _impact(cutoff: float) -> PackedFloat32Array:
	var out := _buf(0.25)
	var lp := 0.0
	for i in out.size():
		var t := float(i) / RATE
		var n := randf_range(-1.0, 1.0)
		lp += (n - lp) * cutoff
		out[i] = lp * exp(-t * 35.0) + n * exp(-t * 300.0) * 0.5
	return out


func _flesh() -> PackedFloat32Array:
	var out := _buf(0.22)
	var lp := 0.0
	for i in out.size():
		var t := float(i) / RATE
		var n := randf_range(-1.0, 1.0)
		lp += (n - lp) * 0.07
		out[i] = lp * exp(-t * 22.0) * 3.0 + sin(TAU * 85.0 * t) * exp(-t * 30.0) * 0.6
	return out
