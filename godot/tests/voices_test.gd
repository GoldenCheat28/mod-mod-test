extends Node
## Dev test: the voice bank (every voice has every situation, every clip
## loads), then in the game: bots get different voices, and two of them made
## to talk go through a whole conversation - printed line by line.

const Chatter = preload("res://scripts/bots/chatter.gd")

var t := 0.0
var _phase := 0
var _pair: Array = []
var _said := {}


func _ready() -> void:
	var bank := Chatter.voices()
	var cats := {}
	var missing := 0
	var bad := 0
	var clips := 0
	for v in bank:
		for cat in (v["clips"] as Dictionary):
			cats[cat] = true
	for v in bank:
		for cat in cats:
			var list: Array = (v["clips"] as Dictionary).get(cat, [])
			if list.is_empty():
				missing += 1
			for c in list:
				clips += 1
				if Chatter.stream(c["file"]) == null:
					bad += 1
	print("voices: %d, situations: %d, clips: %d, missing: %d, not loading: %d" % [bank.size(), cats.size(), clips, missing, bad])
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if _phase == 0 and t > 2.0:
		_phase = 1
		var ids := {}
		for b in Game.bots:
			if b.ai and b.ai.talk:
				ids[(b.ai.talk.voice as Dictionary).get("id", "?")] = true
		print("bots: %d, different voices among them: %d" % [Game.bots.size(), ids.size()])
		# Two calm ones, put side by side and set talking (a few times over).
		for b in Game.bots:
			if b.ai and b.ai.talk and b.ai.roulette == null and b.ai.process_mode != Node.PROCESS_MODE_DISABLED and not (b.ai.get("lod_ok") == true):
				_pair.append(b)
			if _pair.size() == 2:
				break
		if _pair.size() < 2:
			print("no pair")
			get_tree().quit()
			return
		_pair[1].global_position = _pair[0].global_position + Vector3(1.1, 0, 0)
		_go()
	elif _phase >= 1 and _phase <= 4:
		for b in _pair:
			# (kept out of the game's crowd round the table, for the test)
			b.ai.spectate = null
			b.ai.watch_spot = Vector3.INF
			b.ai.fear = 0.0
		for b in _pair:
			var c = b.ai.talk
			var key: String = c._last_clip + str(c.get_instance_id())
			if c._last_clip != "" and not _said.has(key):
				_said[key] = true
				print("  %s [%s]: %s" % [b.ai._persona().name, (c.voice as Dictionary).get("id"), c.last_text])
		if not _pair[0].ai.talk.busy() and not _pair[0].ai.talk.speaking() and t > 4.0:
			_phase += 1
			_said.clear()
			if _phase <= 4:
				_go()
			else:
				print("done")
				get_tree().quit()
	if t > 200.0:
		print("timeout")
		get_tree().quit()


func _go() -> void:
	var a = _pair[0].ai.talk
	var b = _pair[1].ai.talk
	for x in _pair:
		x.ai.spectate = null
		x.ai.watch_spot = Vector3.INF
		x.ai._enter(x.ai.S.IDLE)
	a.end()
	a._last_clip = ""
	b._last_clip = ""
	a._start(b)
	print("conversation %d: %s" % [_phase, str(a._lines.map(func(l): return l[1]))])
