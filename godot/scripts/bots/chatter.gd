extends Node
## Bot small talk. Calm bots now and then walk up to another calm bot and
## start a conversation: a greeting ("Привет, как дела?" - "Нормально." or a
## rude brush-off and "Ну и пошёл нахуй."), or picking on them ("Чё кислый
## такой?" - an insult back - "Услышал тебя, связь." or "Ну и пошёл нахуй.").
## The two stand facing each other and take turns; anything scary ends it.
## Alone they sometimes mutter, react out loud to a gun or a body in the
## distance, and tell off a player who comes and stands in their face.

const VOICE_DIR := "res://assets/sounds/voice/%s.wav"
## The generated voices (tools/voices/generate_voices.py): fifty people, each
## with his own lines for each situation.
const VOICES_DIR := "res://assets/sounds/voices/"
## The first recordings, by the situation they belong to: a bot now and then
## speaks with these where it has them.
const OLD := {
	"greet": "greet", "reply_fine": "greet_reply", "reply_rude": "brush_off", "go_away": "anger",
	"man_go_away": "player_face", "tease": "tease", "tease_rude": "tease_back", "tease_rude2": "tease_back",
	"heard_you": "make_peace", "idle_high": "thinking", "saw_gun": "scared",
}
const ANGRY := ["brush_off", "anger", "tease", "tease_back", "player_face"]
const TALK_DIST := 1.25
const PAUSE := 0.55            # gap between one line ending and the reply

static var _streams := {}
static var _bank: Array = []         # voices.json: [{id, name, clips: {situation: [{file, text}]}}]
static var _bank_loaded := false
static var _last_react := -100.0     # one bot at a time reacts out loud

var ai: Node
var body: Node3D
var partner: Node = null       # the other bot's chatter while in a conversation
var starter := false
var _lines: Array = []          # [[speaker is starter, line], ...]
var _step := 0
var _wait := 0.0
var _approach_t := 0.0
var _next_chat := 0.0
var _next_mutter := 0.0
var _gun_cd := 0.0
var _face_cd := 0.0
var _in_face := 0.0
var _rude := false              # a surly one: tells a player in his face to get lost
var _greeted := false           # has said hello to the player
var _scan_t := 0.0
var _seen_dead := {}
var _voice: AudioStreamPlayer3D
var _pitch := 1.0
var voice: Dictionary = {}       # this one's voice (from the bank)
var _author := false             # speaks with the first recordings where there are any
var _last_clip := ""
var last_text := ""              # what was said last (for subtitles and tests)


func setup(a: Node, rng: RandomNumberGenerator) -> void:
	ai = a
	body = a.body
	_pitch = rng.randf_range(0.97, 1.03)
	var bank := voices()
	if not bank.is_empty():
		voice = bank[rng.randi() % bank.size()]
	_author = bank.is_empty() or rng.randf() < 0.12
	_rude = rng.randf() < 0.25
	_next_chat = rng.randf_range(6.0, 30.0)
	_next_mutter = rng.randf_range(20.0, 60.0)
	_gun_cd = rng.randf_range(3.0, 12.0)
	_voice = AudioStreamPlayer3D.new()
	_voice.bus = &"World"
	_voice.unit_size = 3.0
	_voice.max_distance = 35.0
	_voice.volume_db = -3.0
	body.head.add_child(_voice)


static func voices() -> Array:
	if not _bank_loaded:
		_bank_loaded = true
		var f := FileAccess.open(VOICES_DIR + "voices.json", FileAccess.READ)
		if f:
			var d = JSON.parse_string(f.get_as_text())
			if d is Dictionary:
				_bank = (d as Dictionary).get("voices", [])
	return _bank


## A clip by its name: "v07/greet_03.ogg" (a generated voice) or "greet" (a
## first recording).
static func stream(line: String) -> AudioStream:
	if not _streams.has(line):
		var path: String = (VOICES_DIR + line) if "/" in line else (VOICE_DIR % line)
		_streams[line] = load(path) if ResourceLoader.exists(path) else null
	return _streams[line]


## Which clip this one says for a situation (or an old line name): his own
## voice's, not the same one twice running.
func _clip_for(key: String) -> String:
	var sit: String = OLD.get(key, key)
	if _author:
		for old in OLD:
			if OLD[old] == sit and (old == key or not OLD.has(key)):
				return old
	var clips: Array = (voice.get("clips", {}) as Dictionary).get(sit, [])
	if clips.is_empty():
		for old in OLD:
			if OLD[old] == sit:
				return old
		return ""
	var c: Dictionary = clips[randi() % clips.size()]
	if String(c["file"]) == _last_clip and clips.size() > 1:
		c = clips[(clips.find(c) + 1) % clips.size()]
	last_text = c["text"]
	return c["file"]


func busy() -> bool:
	return partner != null


func speaking() -> bool:
	return _voice.playing


## Says something for a situation (greet, story, anger... - see
## tools/voices/lines.json; the first recordings' names work too); returns
## how long it lasts.
func say(key: String) -> float:
	if not body.alive or not body.conscious:
		return 0.0
	var line := _clip_for(key)
	var s := stream(line) if line != "" else null
	if s == null:
		return 0.0
	_last_clip = line
	_voice.stream = s
	if OLD.get(key, key) in ANGRY:
		body.angry_until = maxf(body.angry_until, Game.clock + s.get_length() + 2.5)
	_voice.pitch_scale = _pitch * randf_range(0.97, 1.03)
	_voice.play()
	Net.bot_said(body, line, _voice.pitch_scale)
	return s.get_length() / _voice.pitch_scale


func stop_talking() -> void:
	if _voice.playing:
		_voice.stop()


func tick(delta: float) -> void:
	_gun_cd -= delta
	_face_cd -= delta
	_next_chat -= delta
	_next_mutter -= delta
	if not body.alive or not body.conscious:
		stop_talking()
		if partner:
			end()
		return
	if partner:
		_converse(delta)
	else:
		_alone(delta)


# --- Conversations ---------------------------------------------------------------

func _calm(c: Node) -> bool:
	if c.ai.process_mode == Node.PROCESS_MODE_DISABLED:
		return false          # a mannequin
	return c.ai.fear < 0.1 and c.ai.state in [c.ai.S.WANDER, c.ai.S.IDLE] and not c.busy() \
			and c.body.alive and c.body.conscious and not c.body.fallen and c.body.weapon == null


func _find_partner() -> Node:
	var me: Vector3 = body.position_ground()
	var best: Node = null
	var best_d := 16.0
	for b in Game.bots:
		if b == body or b.ai == null or not is_instance_valid(b):
			continue
		var c: Node = b.ai.talk
		if c == null or not _calm(c):
			continue
		var d := me.distance_to(b.position_ground())
		if d < best_d and absf(b.position_ground().y - me.y) < 1.5:
			best = c
			best_d = d
	return best


func _start(other: Node) -> void:
	partner = other
	starter = true
	other.partner = self
	other.starter = false
	_step = 0
	_wait = 0.0
	_approach_t = 0.0
	# Who says what, decided up front ([the starter speaks, situation]).
	_lines = _script()
	ai._enter(ai.S.TALK)
	other.ai._enter(ai.S.TALK)
	other.ai.body.move_velocity = Vector3.ZERO


## A conversation, from how it goes.
func _script() -> Array:
	var r := randf()
	var L: Array = []
	if r < 0.3:
		# How's life: hello, how are you, the answer, a word back, bye.
		L = [[true, "greet"], [false, "greet_reply"], [true, "how_are_you"], [false, "answer_life"]]
		if randf() < 0.6:
			L.append([true, "react_story"])
		if randf() < 0.4:
			L.append_array([[false, "how_are_you"], [true, "answer_life"]])
		L.append([true, "bye"])
		if randf() < 0.6:
			L.append([false, "bye"])
	elif r < 0.52:
		# A story, and maybe one back.
		L = [[true, "greet"], [false, "greet_reply"], [true, "story"], [false, "react_story"]]
		if randf() < 0.45:
			L.append_array([[false, "story"], [true, "react_story"]])
		L.append([randf() < 0.5, "bye"])
	elif r < 0.64:
		# Money and work.
		L = [[true, "how_are_you"], [false, "money_work"], [true, "react_story"], [true, "money_work"]]
		if randf() < 0.5:
			L.append([false, "react_story"])
		L.append([false, "bye"])
	elif r < 0.74:
		# A smoke break together.
		L = [[true, "greet"], [false, "smoke"], [true, "smoke"], [false, "thinking"], [true, "react_story"], [true, "bye"]]
	elif r < 0.86:
		# Hello - get lost - and the temper.
		L = [[true, "greet"], [false, "brush_off"], [true, "anger"]]
		if randf() < 0.4:
			L.append([false, "anger"])
	else:
		# Picking on him: he bites back; made up, or not.
		L = [[true, "tease"], [false, "tease_back"]]
		if randf() < 0.55:
			L.append([true, "make_peace"])
			if randf() < 0.5:
				L.append([false, "react_story"])
		else:
			L.append_array([[true, "anger"], [false, "brush_off"]])
	return L


func end() -> void:
	var other := partner
	partner = null
	for c in [self, other]:
		if c == null or not is_instance_valid(c):
			continue
		c.partner = null
		c._next_chat = randf_range(25.0, 70.0)
		if c.ai.state == c.ai.S.TALK:
			c.ai._enter(c.ai.S.IDLE)


func _converse(delta: float) -> void:
	if not is_instance_valid(partner) or partner.partner != self or ai.state != ai.S.TALK \
			or partner.ai.state != ai.S.TALK or ai.fear > 0.15 or partner.ai.fear > 0.15 \
			or partner.body.fallen or body.fallen or not partner.body.alive:
		end()
		return
	# Look at each other.
	var other_eye: Vector3 = partner.body.eye_position()
	body.look_target = other_eye
	body.has_look_target = true
	var to: Vector3 = partner.body.position_ground() - body.position_ground()
	to.y = 0.0
	var dist := to.length()
	if dist > 0.05 and (dist < TALK_DIST + 0.6 or not starter):
		body.facing = (body.facing as Vector3).slerp(to / dist, minf(delta * 4.0, 1.0)).normalized()
	if not starter:
		return
	# The one who started it walks over, then runs the exchange.
	if _step == 0:
		_approach_t += delta
		if dist > TALK_DIST:
			if _approach_t > 14.0:
				end()
			elif ai._path.is_empty() or ai._path_i >= ai._path.size() or fmod(_approach_t, 1.0) < delta:
				ai._goto(ai._closest_nav(partner.body.position_ground() - to / maxf(dist, 0.01) * 0.95))
				ai._speed = 1.3
			return
		ai._path = PackedVector3Array()
		_step = 1
		_wait = 0.3
		return
	_wait -= delta
	if _wait > 0.0:
		return
	var i := _step - 1
	if i >= _lines.size():
		end()
		return
	var who: Node = self if _lines[i][0] else partner
	_wait = who.say(_lines[i][1]) + PAUSE + randf_range(0.0, 0.5)
	_step += 1


# --- On their own -------------------------------------------------------------------

func _alone(delta: float) -> void:
	var calm: bool = ai.fear < 0.1
	# Start a conversation.
	if _next_chat <= 0.0:
		_next_chat = randf_range(8.0, 20.0)
		if _calm(self) and randf() < 0.55:
			var other := _find_partner()
			if other:
				_start(other)
				return
	# Muttering to themselves.
	if _next_mutter <= 0.0:
		_next_mutter = randf_range(35.0, 90.0)
		if calm and ai.state == ai.S.IDLE and not speaking() and randf() < 0.5:
			say(["thinking", "thinking", "money_work", "smoke"].pick_random() if randf() < 0.5 else "thinking")
	# A player walking up: most say hello; only a surly one, and only if he
	# keeps standing right in his face, tells him where to go.
	var p = Game.player
	# (not across the table in a game of roulette: standing there is the point)
	var busy_with_player: bool = p != null and p.roulette != null
	if p and not busy_with_player and ai._sees and ai._player_dist < 2.2 and not p.is_armed() and ai.fear < 0.4:
		_in_face += delta
		if not _greeted and _in_face > 0.8 and not speaking() and _face_cd <= 0.0:
			_greeted = true
			_face_cd = 20.0
			if randf() < 0.7:
				say("greet")
		elif _rude and _in_face > 6.0 and ai._player_dist < 1.5 and _face_cd <= 0.0 and not speaking():
			say("man_go_away")
			_face_cd = 60.0
			_in_face = 0.0
	else:
		_in_face = maxf(_in_face - delta, 0.0)
	# Something that should not be there, seen from a distance.
	_scan_t -= delta
	if _scan_t > 0.0 or _gun_cd > 0.0 or speaking() or ai.fear > 0.6:
		return
	_scan_t = 0.5
	if Game.clock - _last_react < 15.0:
		return
	if p and ai._sees and p.is_armed() and ai._player_dist > 7.0 and ai._player_dist < 40.0:
		_react()
		return
	var eye: Vector3 = body.eye_position()
	for b in Game.bots:
		if b == body or b.alive or _seen_dead.has(b) or not is_instance_valid(b):
			continue
		var at: Vector3 = b.pelvis.global_position
		if eye.distance_to(at) < 25.0 and _facing(at) and ai._line_clear(eye, at + Vector3.UP * 0.2):
			_seen_dead[b] = true
			body.sad_until = Game.clock + 30.0     # the shock of it stays on the face
			_react("saw_body")
			return


func _facing(at: Vector3) -> bool:
	var fwd: Vector3 = -body.head.global_basis.z
	return fwd.dot((at - body.eye_position()).normalized()) > 0.5


## "А ебать, это что там?"
func _react(what := "scared") -> void:
	_last_react = Game.clock
	say(what)
	_gun_cd = 35.0
