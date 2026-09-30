extends Node
## The player's ears. A gunshot close by (or one's own, from anything loud)
## and above all a blast stun them: the world goes dull and far away (a
## low-pass on the World bus, and quieter), a high ringing comes up and
## slowly fades, and the edges of the view close in. Shot after shot it
## builds up; a few quiet seconds and it wears off. The shots themselves
## are still seen - only the hearing goes.

const RING_HZ := 3650.0

var deaf := 0.0                  # 0..1: how stunned the ears are now
var ring := 0.0                  # 0..1: the ringing
var _lp: AudioEffectLowPassFilter
var _lp_idx := -1
var _bus := -1
var _ringer: AudioStreamPlayer
var _hold := 0.0                 # seconds before it starts to wear off
# The body cam: no ringing and no dulling - its microphone does not hear
# like ears do. A shot overloads it instead: boomed out, the bass pushed up
# and clipping, then the automatic gain pumps it down for a moment.
var boom := 0.0                  # 0..1: how overloaded the microphone is
var _thump: AudioStreamPlayer
var player: Node3D


func _ready() -> void:
	_bus = AudioServer.get_bus_index("World")
	if _bus >= 0:
		_lp = AudioEffectLowPassFilter.new()
		_lp.cutoff_hz = 20000.0
		_lp.resonance = 0.5
		AudioServer.add_bus_effect(_bus, _lp)
		_lp_idx = AudioServer.get_bus_effect_count(_bus) - 1
	# The ringing: a thin tone, wavering a little.
	var rate := 22050
	var n := rate * 2
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in n:
		var t := float(i) / rate
		var v := sin(TAU * RING_HZ * t) * (0.85 + 0.15 * sin(TAU * 3.0 * t)) + 0.2 * sin(TAU * RING_HZ * 1.5 * t)
		data.encode_s16(i * 2, int(v * 9000.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = rate
	wav.data = data
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_end = n
	_ringer = AudioStreamPlayer.new()
	_ringer.stream = wav
	_ringer.bus = &"Master"
	_ringer.volume_db = -80.0
	add_child(_ringer)
	Game.gunshot.connect(_on_bang)
	# The low thud under a shot that the little microphone clips on.
	var tn := int(rate * 0.45)
	var td := PackedByteArray()
	td.resize(tn * 2)
	for i in tn:
		var t := float(i) / rate
		var env := exp(-t * 9.0) * minf(t * 400.0, 1.0)
		var f := lerpf(90.0, 42.0, minf(t * 4.0, 1.0))
		var v := clampf(sin(TAU * f * t) * env * 1.8, -1.0, 1.0)
		td.encode_s16(i * 2, int(v * 30000.0))
	var tw := AudioStreamWAV.new()
	tw.format = AudioStreamWAV.FORMAT_16_BITS
	tw.mix_rate = rate
	tw.data = td
	_thump = AudioStreamPlayer.new()
	_thump.stream = tw
	_thump.bus = &"World"
	add_child(_thump)


func _exit_tree() -> void:
	# (the filter stays on the bus between levels otherwise)
	if _bus >= 0 and _lp_idx >= 0 and _lp_idx < AudioServer.get_bus_effect_count(_bus) \
			and AudioServer.get_bus_effect(_bus, _lp_idx) == _lp:
		AudioServer.remove_bus_effect(_bus, _lp_idx)


## Something loud went off at `origin` (its loudness: a pistol 1, an AKM
## ~1.9, a shotgun ~1.6, a blast 3 x its power).
func _on_bang(origin: Vector3, loudness: float) -> void:
	if player == null or not is_instance_valid(player):
		return
	var ear: Vector3 = player.cam.global_position
	var d := maxf(origin.distance_to(ear), 0.5)
	# A gun: a pistol by the ear takes ~5 %, a shotgun ~13 %, an AKM ~18 %
	# (a burst of it and one is deaf); fired a few metres off, much less. A
	# blast: all at once close by, still a lot a dozen metres off.
	var k: float
	if loudness < 2.5:
		k = 0.05 * loudness * loudness / maxf(d, 1.0) ** 2
	else:
		k = 0.3 * loudness / maxf(d / 3.0, 1.0) ** 2
	if k < 0.01:
		return
	var add := clampf(k, 0.0, 0.6)
	if Game.bodycam:
		boom = clampf(boom + add * 4.0, 0.0, 1.0)
		_thump.volume_db = linear_to_db(clampf(add * 4.0, 0.15, 1.0)) + 2.0
		_thump.pitch_scale = randf_range(0.9, 1.1)
		_thump.play()
		return
	deaf = clampf(deaf + add, 0.0, 1.0)
	ring = clampf(ring + add * 1.3, 0.0, 1.0)
	_hold = maxf(_hold, 0.6 + add * 3.0)


func _process(delta: float) -> void:
	if OS.get_environment("NO_HEAR") != "":
		return
	_mic(delta)
	if Game.bodycam:
		deaf = 0.0
		ring = 0.0
	_hold -= delta
	if _hold <= 0.0:
		deaf = move_toward(deaf, 0.0, delta * 0.11)
		ring = move_toward(ring, 0.0, delta * 0.08)
	if _lp:
		# (at nothing it is off: no cost, no colouring)
		_lp.cutoff_hz = lerpf(20000.0, 380.0, pow(deaf, 0.6))
	if _bus >= 0:
		AudioServer.set_bus_volume_db(_bus, -14.0 * deaf)
	if ring > 0.01:
		if not _ringer.playing:
			_ringer.play()
		_ringer.volume_db = linear_to_db(ring * 0.16)
	elif _ringer.playing:
		_ringer.stop()
	if player and is_instance_valid(player) and player._post:
		player._post.set_deaf(deaf)


## The body cam's microphone after a shot: the bass shelf and the overdrive
## pushed up with `boom`, then the level ducked a moment as its gain control
## catches up.
func _mic(delta: float) -> void:
	boom = move_toward(boom, 0.0, delta * 1.6)
	var bus := AudioServer.get_bus_index("CamMic")
	if bus < 0 or not Game.bodycam:
		return
	for i in AudioServer.get_bus_effect_count(bus):
		var fx := AudioServer.get_bus_effect(bus, i)
		if fx is AudioEffectEQ6:
			(fx as AudioEffectEQ6).set_band_gain_db(0, 16.0 * boom)     # 32 Hz
			(fx as AudioEffectEQ6).set_band_gain_db(1, 12.0 * boom)     # 100 Hz
			(fx as AudioEffectEQ6).set_band_gain_db(2, 5.0 * boom)
		elif fx is AudioEffectDistortion:
			(fx as AudioEffectDistortion).drive = 0.35 + 0.55 * boom
			(fx as AudioEffectDistortion).pre_gain = 2.0 + 10.0 * boom
		elif fx is AudioEffectHighPassFilter:
			# (the low cut opens up: the thud comes through)
			(fx as AudioEffectHighPassFilter).cutoff_hz = lerpf(320.0, 40.0, boom)
	# Pumped down right after, then back.
	var duck := smoothstep(0.1, 0.6, boom) * (1.0 - smoothstep(0.75, 1.0, boom))
	AudioServer.set_bus_volume_db(bus, -7.0 * duck)
