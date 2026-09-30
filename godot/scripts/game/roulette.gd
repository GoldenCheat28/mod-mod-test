extends Node
## Russian roulette between the player and a bot. One round goes into the
## revolver (the cylinder swings out, the cartridge goes in, it shuts and is
## spun), then chance picks who goes first. On the player's turn the gun goes
## to their temple and LMB pulls the trigger; on the bot's he raises it to his
## own head, hesitates, and pulls. Each pull turns the cylinder one chamber
## on, so the odds shorten. Whoever it fires for loses.
## Meanwhile the bot stands where he is and watches the player; if the player
## walks off (more than LEAVE_DIST from him) the game is over and he leaves.

const Revolver = preload("res://scripts/weapons/revolver.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")

const LEAVE_DIST := 4.0

var player: Node3D
var bot: Node3D
var gun: Node3D
var state := ""
var _t := 0.0
var _wait := 0.0                 # how long the bot hesitates this turn
var _spin_v := 0.0
var _beat := 0.0
var _from := Transform3D()       # the gun's pose when a move began
var _label: Label
var _msg_t := 0.0
var _over := false
var _bars: Array = []
var _bar_k := 0.0
var _push := 0.0                 # the camera pushing in on him (his turn)
var _shake := 0.0
var at_table := false            # sat across the table (the abandoned building)
var _table := {}
var _fade: ColorRect
var _crowd: Label
var _crowd_t := 0.0
var _spectators: Array = []      # bot_ai of the ones watching
var _bets := {}                  # ai -> "player" / "bot": who he says will lose

const BETS := [["Ставлю сотку, что он не жилец.", "bot"], ["Спорим, первым ляжешь ты?", "player"],
		["Пятьсот на тебя, не подведи.", "bot"], ["Он сейчас обделается, отвечаю.", "player"],
		["Ну давай, жми уже.", ""], ["Вы ебанутые оба...", ""]]
const GASPS := ["Твою мать!", "Ни хрена себе...", "Я же говорил!", "Пиздец...", "Охренеть."]
const JEERS := ["Ссыкло!", "Сел играть - играй!", "Тьфу, слабак.", "Куда пошёл, сука?"]

## Offers `b` a game (the node must already be in the tree), or says why
## he will not play. Returns whether it started.
func start(p: Node3D, b: Node3D, table := false) -> bool:
	player = p
	bot = b
	at_table = table and Game.main and Game.main.map and not Game.main.map.roulette_table.is_empty()
	if at_table:
		_table = (Game.main.map.roulette_table as Dictionary).duplicate()
	if b == null:
		_say("Подойди к боту и посмотри на него", 2.5)
		_finish(2.6)
		return false
	if b.has_meta("puppet"):
		# (the people live in the host's game; the game with them is played there)
		_say("В сетевой игре рулетку пока играет только хост", 2.5)
		_finish(2.6)
		return false
	if not b.alive or not b.conscious or b.fallen or b.cuffed or b.ai.roulette != null:
		_say("Он сейчас не в состоянии играть", 2.5)
		_finish(2.6)
		return false
	if b.weapon:
		_say("Он с оружием - не до игр", 2.5)
		_finish(2.6)
		return false
	_begin()
	return true


func _init() -> void:
	# The bars on 3, under the player's HUD (4); what is said on top of them.
	var bars_ui := CanvasLayer.new()
	bars_ui.layer = 3
	add_child(bars_ui)
	var ui := CanvasLayer.new()
	ui.layer = 4
	add_child(ui)
	_label = Label.new()
	_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_label.position = Vector2(-400, 90)
	_label.size = Vector2(800, 60)
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.add_theme_font_size_override("font_size", 30)
	_label.add_theme_color_override("font_outline_color", Color.BLACK)
	_label.add_theme_constant_override("outline_size", 8)
	_label.modulate.a = 0.0
	ui.add_child(_label)
	# What the onlookers say, under it.
	_crowd = Label.new()
	_crowd.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_crowd.position = Vector2(-400, 150)
	_crowd.size = Vector2(800, 40)
	_crowd.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_crowd.add_theme_font_size_override("font_size", 22)
	_crowd.add_theme_color_override("font_color", Color(0.85, 0.85, 0.8))
	_crowd.add_theme_color_override("font_outline_color", Color.BLACK)
	_crowd.add_theme_constant_override("outline_size", 6)
	_crowd.modulate.a = 0.0
	ui.add_child(_crowd)
	# Black, for sitting down at the table.
	_fade = ColorRect.new()
	_fade.color = Color.BLACK
	_fade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fade.modulate.a = 0.0
	ui.add_child(_fade)
	for k in 2:
		var bar := ColorRect.new()
		bar.color = Color.BLACK
		bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
		bar.set_anchors_preset(Control.PRESET_TOP_WIDE if k == 0 else Control.PRESET_BOTTOM_WIDE)
		bars_ui.add_child(bar)
		_bars.append(bar)


func _begin() -> void:
	# Whatever he was doing (painting, smoking, walking, talking) he leaves off.
	var ai = bot.ai
	if ai.act:
		ai._end_activity()
	if ai.talk and ai.talk.busy():
		ai.talk.end()
	ai._path = PackedVector3Array()
	ai._enter(ai.S.IDLE)
	bot.hand_goal["r"] = Vector3.INF
	bot.hand_goal["l"] = Vector3.INF
	bot.move_velocity = Vector3.ZERO
	bot.ai.roulette = self
	player.roulette = self
	player._switch_to("hands")
	gun = Revolver.new()
	player.get_parent().add_child(gun)
	gun.global_transform = _player_pose("front")
	gun.loaded = randi() % Revolver.CHAMBERS
	gun.chamber = gun.loaded
	_gather_spectators()
	if at_table:
		gun.visible = false
		_say("Он согласен. Идёте за стол...", 2.5)
		_go("seat")
		return
	_say("Он согласен. Заряжаешь один патрон...", 3.0)
	_go("load")


func _say(text: String, time: float) -> void:
	_label.text = text
	_msg_t = time


func _go(s: String) -> void:
	state = s
	_t = 0.0
	_flags.clear()


func _finish(delay := 0.0) -> void:
	_over = true
	if is_instance_valid(player):
		player.cine_fov = 0.0
		player.cine_busy = false
	if is_instance_valid(player) and player.seat_at != Vector3.INF and not player._dead:
		# Up from the table after a moment (the shot still ringing).
		var pl = player
		get_tree().create_timer(minf(delay, 1.5)).timeout.connect(func():
			if is_instance_valid(pl) and pl.seat_at != Vector3.INF and pl._seat_rise_t < 0.0:
				pl.rise_from_seat())
	if is_instance_valid(bot):
		bot.seat = Vector3.INF
	# The onlookers go back to what they were doing, after a bit.
	var watchers := _spectators.duplicate()
	_spectators.clear()
	get_tree().create_timer(6.0).timeout.connect(func():
		for ai in watchers:
			if is_instance_valid(ai) and ai.spectate == self:
				ai.spectate = null
				ai.watch_spot = Vector3.INF
				ai._enter(ai.S.WANDER))
	if is_instance_valid(bot) and bot.ai and bot.ai.roulette == self:
		bot.ai.roulette = null
		bot.hand_goal["r"] = Vector3.INF
		bot.hand_goal["l"] = Vector3.INF
	if is_instance_valid(player) and player.roulette == self:
		player.roulette = null
	get_tree().create_timer(maxf(delay, 0.1)).timeout.connect(queue_free)


func _process(delta: float) -> void:
	_msg_t -= delta
	_label.modulate.a = clampf(_msg_t * 2.0, 0.0, 1.0)
	_cinema(delta)
	_crowd_t -= delta
	_crowd.modulate.a = clampf(_crowd_t * 2.0, 0.0, 1.0)


func _physics_process(delta: float) -> void:
	if _over:
		return
	_t += delta
	# Called off: he is gone, down, or the player walked away or died.
	if not is_instance_valid(bot) or not bot.alive or bot.fallen or not bot.conscious:
		_say("Игра прервана", 2.0)
		_drop_gun()
		_finish(2.2)
		return
	if not is_instance_valid(player) or player._dead:
		_finish(2.0)
		return
	var flat: Vector3 = player.global_position - bot.position_ground()
	flat.y = 0.0
	if flat.length() > LEAVE_DIST and not at_table:
		_walked_out()
		return
	if flat.length() > LEAVE_DIST:
		_say("Ты ушёл - он тоже уходит", 2.5)
		if gun and gun.is_inside_tree():
			gun.queue_free()
		var ai = bot.ai
		_finish(2.6)
		ai._enter(ai.S.WANDER)
		return
	_bot_stance()
	match state:
		"seat":
			_sit_down(delta)
			return
		"load":
			_load(delta)
		"pick":
			gun.global_transform = _player_pose("front")
			if _t > 1.6:
				_go("p_raise" if _player_first else "to_bot")
		"p_raise":
			_move(_player_pose("front"), _player_pose("temple"), 0.7)
			if _t > 0.7:
				_say("ЛКМ - нажать на спуск", 30.0)
				_go("p_wait")
		"p_wait":
			gun.global_transform = _player_pose("temple")
			_heartbeat(delta, 0.75)
			if Game.is_mouse_captured() and Input.is_action_just_pressed("fire"):
				_msg_t = 0.0
				_go("p_pull")
		"p_pull":
			gun.global_transform = _player_pose("temple")
			if _once(0.0, "cock"):
				Game.play_3d(Sfx.get_stream(&"rev_cock"), gun.global_position, -6.0, 0.05, 1.0)
			gun.hammer = clampf(_t / 0.3, 0.0, 1.0)
			if _t > 0.3:
				gun.hammer = 0.0
				if gun.fire():
					_bang_player()
				else:
					_click()
					_go("p_lower")
		"p_lower":
			_move(_player_pose("temple"), _player_pose("front"), 0.6, 0.5)
			if _t > 1.1:
				_go("to_bot")
		"to_bot":
			_move(_player_pose("front"), _bot_pose("hold"), 0.9)
			if _t > 0.9:
				_go("b_raise")
		"b_raise":
			_move(_bot_pose("hold"), _bot_pose("temple"), 0.9, 0.3)
			_in_his_hand(smoothstep(0.3, 1.0, _t))
			if _t > 1.2:
				_wait = randf_range(1.2, 3.2)
				_go("b_wait")
		"b_wait":
			gun.global_transform = _bot_pose("temple")
			_in_his_hand(1.0)
			if _t > _wait:
				_go("b_pull")
		"b_pull":
			gun.global_transform = _bot_pose("temple")
			_in_his_hand(1.0)
			if _once(0.0, "cock"):
				Game.play_3d(Sfx.get_stream(&"rev_cock"), gun.global_position, -6.0, 0.05, 1.0)
			gun.hammer = clampf(_t / 0.35, 0.0, 1.0)
			if _t > 0.35:
				gun.hammer = 0.0
				if gun.fire():
					_bang_bot()
				else:
					_click()
					_go("b_lower")
		"b_lower":
			_move(_bot_pose("temple"), _bot_pose("hold"), 0.7, 0.5)
			_in_his_hand(1.0 - smoothstep(0.0, 0.6, _t))
			if _t > 1.2:
				_go("to_player")
		"to_player":
			_move(_bot_pose("hold"), _player_pose("front"), 0.9)
			if _t > 0.9:
				_say("Твоя очередь", 1.5)
				_go("p_raise")
	if gun != null and is_instance_valid(gun) and (state.begins_with("b_") or (state == "to_bot" and _t > 0.45)):
		bot.hand_goal["r"] = _ideal_grip if _ideal_grip != Vector3.INF and state.begins_with("b_") else gun.grip()


var _player_first := false


## Loading: the cylinder swings out, the left hand puts the round in, it is
## snapped shut and spun with a sweep of the hand.
func _load(delta: float) -> void:
	gun.global_transform = _player_pose("front")
	var t := _t
	gun.open = clampf(t / 0.5, 0.0, 1.0) if t < 1.6 else clampf(1.0 - (t - 1.6) / 0.25, 0.0, 1.0)
	gun.round_in = clampf((t - 0.5) / 0.9, 0.0, 1.0)
	if _once(0.05, "open"):
		Game.play_3d(Sfx.get_stream(&"rev_cyl_open"), gun.global_position, -6.0, 0.05, 1.0)
	if _once(1.35, "in"):
		Game.play_3d(Sfx.get_stream(&"rev_round_in"), gun.global_position, -5.0, 0.05, 1.0)
	if _once(1.75, "shut"):
		Game.play_3d(Sfx.get_stream(&"rev_cyl_close"), gun.global_position, -5.0, 0.05, 1.0)
		_spin_v = randf_range(22.0, 30.0)
	if t > 1.9:
		if _once(1.9, "spin"):
			Game.play_3d(Sfx.get_stream(&"rev_spin"), gun.global_position, -4.0, 0.05, 1.0)
		gun.spin += _spin_v * delta
		_spin_v = maxf(_spin_v - 22.0 * delta, 0.0)
		if _spin_v <= 0.0:
			# Settles on a chamber: nobody knows which.
			var steps := int(round(gun.spin / (TAU / Revolver.CHAMBERS)))
			gun.chamber = (gun.chamber + steps) % Revolver.CHAMBERS
			gun.spin = 0.0
			_player_first = randf() < 0.5
			_say("Первым стреляет: " + ("ты" if _player_first else "он"), 1.8)
			_go("pick")


var _flags := {}


func _once(at: float, key: String) -> bool:
	var k := state + key
	if _t < at or _flags.has(k):
		return false
	_flags[k] = true
	return true


## The gun's pose moving between two, over `time` (after `delay`).
func _move(a: Transform3D, b: Transform3D, time: float, delay := 0.0) -> void:
	var k := smoothstep(0.0, 1.0, clampf((_t - delay) / time, 0.0, 1.0))
	var xf := a.interpolate_with(b, k)
	# An arc, not a straight line, handing it over.
	xf.origin += Vector3.UP * 0.12 * sin(PI * k) * (1.0 if a.origin.distance_to(b.origin) > 0.4 else 0.0)
	gun.global_transform = xf


## In the player's hands: held out in front (the cylinder turned to be seen,
## for loading), or up to the right temple, the muzzle pressed to the head,
## the elbow out - just in sight at the edge of the view.
func _player_pose(which: String) -> Transform3D:
	var cam: Camera3D = player.cam
	var cx := cam.global_transform
	if which == "temple":
		var b := Basis.looking_at(Vector3(-1.0, -0.05, -0.12).normalized(), Vector3.UP)
		var local := Transform3D(b, Vector3(0.0, 0.0, 0.0))
		local.origin = Vector3(0.105, 0.0, -0.085) - b * Revolver.MUZZLE
		if Game.bodycam:
			# (the head is up above the chest camera, and back from it)
			local.origin += Vector3(0.0, 0.3, 0.17)
		var shake := Vector3(randf_range(-1, 1), randf_range(-1, 1), 0.0) * 0.0012
		local.origin += shake
		return cx * local
	var fb := Basis.looking_at(Vector3(-0.35, 0.05, -1.0).normalized(), Vector3.UP) * Basis(Vector3(0, 0, 1), -0.5)
	return cx * Transform3D(fb, Vector3(0.06, -0.2, -0.36) + (Vector3(0.0, 0.16, -0.06) if Game.bodycam else Vector3.ZERO))


## In the bot's right hand: down by his side, or at his own temple (and the
## hand not quite steady).
func _bot_pose(which: String) -> Transform3D:
	var s: float = bot.scale_factor
	var cb: Basis = bot.chest.global_basis.orthonormalized()
	var fwd := Vector3(bot.facing.x, 0.0, bot.facing.z).normalized()
	if which == "temple":
		var hb: Basis = bot.head.global_basis.orthonormalized()
		var temple: Vector3 = bot.head.global_transform * (Vector3(0.095, 0.015, 0.0) * s)
		var dir := -hb.x
		var b := Basis.looking_at(dir, hb.y)
		var shake := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * (0.002 if state == "b_wait" else 0.0)
		return Transform3D(b, temple - b * Revolver.MUZZLE + shake)
	var shoulder: Vector3 = bot.chest.global_transform * (Vector3(0.22, 0.07, 0.0) * s)
	var dir2 := (fwd * 0.55 + Vector3.DOWN * 0.8).normalized()
	return Transform3D(Basis.looking_at(dir2, Vector3.UP), shoulder + Vector3.DOWN * 0.36 * s + fwd * 0.2 + cb.x * 0.02)


## The gun where his hand really is (the arm does what it can), the muzzle
## turned on his temple from there - never hanging in the air by itself.
var _ideal_grip := Vector3.INF


func _in_his_hand(w: float) -> void:
	# (where the grip should be: what the arm reaches for)
	_ideal_grip = gun.grip()
	if w <= 0.0:
		return
	var hand: RigidBody3D = bot.parts[bot.part_index["hand_r"]]
	var hp := hand.global_position
	var temple: Vector3 = bot.head.global_transform * (Vector3(0.095, 0.015, 0.0) * bot.scale_factor)
	var dir := temple - hp
	if dir.length() < 0.05:
		return
	var hb: Basis = bot.head.global_basis.orthonormalized()
	var b := Basis.looking_at(dir.normalized(), hb.y)
	var grip_local := Vector3(0.0, -0.01, 0.012)
	var in_hand := Transform3D(b, hp - b * grip_local)
	gun.global_transform = gun.global_transform.interpolate_with(in_hand, clampf(w, 0.0, 1.0))


## He stands his ground, turned to the player, watching him; the free hand
## hangs.
func _bot_stance() -> void:
	bot.move_velocity = Vector3.ZERO
	# At the table he sits, whatever else wants him up.
	if at_table and _table.has("done") and not _over:
		bot.seat = (_table["bot"] as Vector3) + Vector3.UP * float(_table["seat_h"])
		bot.posture = bot.Posture.SIT
	var to: Vector3 = player.global_position - bot.position_ground()
	to.y = 0.0
	if to.length() > 0.1:
		bot.facing = to.normalized()
	bot.look_target = player.cam.global_position
	bot.has_look_target = true
	bot.hand_goal["l"] = Vector3.INF
	if not (state.begins_with("b_") or (state == "to_bot" and _t > 0.45)):
		bot.hand_goal["r"] = Vector3.INF


## Where the player's hands are while it is theirs.
func player_hand() -> Vector3:
	if _over or gun == null or not is_instance_valid(gun):
		return Vector3.INF
	if state in ["load", "pick", "p_raise", "p_wait", "p_pull", "p_lower"] or state == "to_bot" and _t < 0.45 \
			or state == "to_player" and _t > 0.45:
		return gun.grip()
	return Vector3.INF


func player_left_hand() -> Vector3:
	if not _over and state == "load" and _t > 0.3 and _t < 2.4 and gun:
		return gun.round_hand()
	return Vector3.INF


func _heartbeat(delta: float, every: float) -> void:
	_beat -= delta
	if _beat <= 0.0:
		_beat = every
		Game.play_3d(Sfx.get_stream(&"heartbeat"), player.cam.global_position, -10.0, 0.0, 1.0)


func _click() -> void:
	Game.play_3d(Sfx.get_stream(&"rev_dry"), gun.muzzle(), -1.0, 0.05, 1.0)
	_say("Щелчок.", 1.2)


## The player's round: point blank to the head.
func _bang_player() -> void:
	var m: Vector3 = gun.muzzle()
	Game.play_3d(Sfx.get_stream(&"rev_shot"), m, 4.0, 0.05, 1.0)
	_say("Ты проиграл", 4.0)
	var dir: Vector3 = -gun.global_basis.z
	_drop_gun()
	player.hurt(m + dir * 0.05, dir, "pistol", "head")
	if Game.blood:
		var me: Array[RID] = [player.get_rid()]
		Game.blood.exit_splatter(m + dir * 0.25, dir, 1.0, me)
	if player.vitals.alive:
		player.vitals._die()
	_crowd_react("player")
	_finish(4.2)


## His round.
func _bang_bot() -> void:
	var m: Vector3 = gun.muzzle()
	var dir: Vector3 = -gun.global_basis.z
	Game.play_3d(Sfx.get_stream(&"rev_shot"), m, 4.0, 0.05, 1.0)
	_bang_moment()
	bot.receive_hit(bot.head, m + dir * 0.01, dir, 6.0, "pistol")
	if bot.alive:
		bot._die("headshot")
	# Sitting at the table he slumps forward onto it, not off the chair to
	# the side: the blow from the side taken off the top of him, and he
	# goes over forward, head and arms on the table.
	if _table.has("center"):
		var toward: Vector3 = (_table["center"] as Vector3) - bot.position_ground()
		toward.y = 0.0
		toward = toward.normalized()
		for pn in ["head", "chest", "abdomen", "upper_arm_r", "upper_arm_l", "forearm_r", "forearm_l", "hand_r", "hand_l"]:
			if bot.part_index.has(pn):
				var part: RigidBody3D = bot.parts[bot.part_index[pn]]
				var up_k := 1.0 if pn in ["head", "chest"] else 0.7
				part.linear_velocity = toward * 1.8 * up_k + Vector3.DOWN * 0.4
				part.angular_velocity = Vector3.ZERO
		var pel: RigidBody3D = bot.pelvis
		pel.linear_velocity = Vector3.ZERO
	_say("Ты победил", 4.0)
	_drop_gun()
	_crowd_react("bot")
	_finish(4.2)


## Out of the hand: it falls where it is and stays, a thing on the ground.
func _drop_gun() -> void:
	if gun == null or not is_instance_valid(gun):
		return
	var rb := RigidBody3D.new()
	rb.collision_layer = Game.LAYER_DEBRIS
	rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
	rb.mass = 1.0
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(0.03, 0.1, 0.2)
	cs.shape = bs
	cs.position = Vector3(0, 0.0, -0.08)
	rb.add_child(cs)
	var xf: Transform3D = gun.global_transform
	gun.get_parent().add_child(rb)
	rb.global_transform = xf
	gun.reparent(rb, true)
	rb.linear_velocity = Vector3(randf_range(-0.5, 0.5), 0.5, randf_range(-0.5, 0.5))
	rb.angular_velocity = Vector3(randf_range(-4, 4), randf_range(-4, 4), randf_range(-4, 4))
	gun = null
	if is_instance_valid(bot):
		bot.hand_goal["r"] = Vector3.INF


# --- At the table -----------------------------------------------------------------------

## Sitting down at the table, played out: the player is walked to the chair
## (the view gliding there, turning to the table, sinking onto the seat);
## he walks round to his and sits; black bars close in on the screen.
func _sit_down(delta: float) -> void:
	var c: Vector3 = _table["center"]
	var ps: Vector3 = _table["player"]
	var bs: Vector3 = _table["bot"]
	var p_stand := ps + Vector3(ps.x - c.x, 0.0, ps.z - c.z).normalized() * 0.55
	var b_stand := bs + Vector3(bs.x - c.x, 0.0, bs.z - c.z).normalized() * 0.55
	if not _table.has("walk"):
		_table["walk"] = true
		_table["from"] = player.global_position
		_table["from_yaw"] = player.yaw
		var d: float = (player.global_position - p_stand).length()
		_table["walk_t"] = clampf(d / 1.8, 1.2, 6.0)
		player.cine_busy = true
		player.seat_at = player.global_position
		player.seat_eye = player.EYE_HEIGHT
		player._seat_stand = p_stand
		gun.visible = false
	var wt: float = _table["walk_t"]
	var to_table := c - ps
	var sit_yaw := atan2(-to_table.x, -to_table.z)
	# 1) the walk to the chair (the view turned where it goes, then to the table)
	if _t < wt:
		var k := smoothstep(0.0, 1.0, _t / wt)
		var from: Vector3 = _table["from"]
		var at := from.lerp(p_stand, k)
		var step := sin(_t * 9.0) * 0.025 * (1.0 - absf(k * 2.0 - 1.0))     # the walk's gentle bob
		player.seat_at = at
		player.seat_eye = player.EYE_HEIGHT + step
		var go := p_stand - from
		var go_yaw := atan2(-go.x, -go.z) if go.length() > 0.2 else sit_yaw
		player.yaw = lerp_angle(player.yaw, lerp_angle(go_yaw, sit_yaw, smoothstep(0.6, 1.0, k)), minf(delta * 4.0, 1.0))
		player.pitch = lerpf(player.pitch, -0.08, minf(delta * 3.0, 1.0))
	else:
		# 2) turned to the table, down onto the seat (a little drop at the end)
		var k := clampf((_t - wt) / 1.1, 0.0, 1.0)
		var e := smoothstep(0.0, 1.0, k)
		player.seat_at = p_stand.lerp(ps, smoothstep(0.0, 0.7, k))
		player.seat_eye = lerpf(player.EYE_HEIGHT, 1.18, e) - sin(k * PI) * 0.04
		player.yaw = lerp_angle(player.yaw, sit_yaw, minf(delta * 5.0, 1.0))
		player.pitch = lerpf(player.pitch, -0.25, minf(delta * 3.0, 1.0))
	# His walk round to the front of his chair (a path round the table and
	# the chairs), then down onto it - the held pose takes him the last bit.
	if not _table.has("bot_sat"):
		var me: Vector3 = bot.position_ground()
		if not _table.has("bot_path"):
			var nav: RID = bot.get_world_3d().navigation_map
			_table["bot_path"] = NavigationServer3D.map_get_path(nav, NavigationServer3D.map_get_closest_point(nav, me),
					NavigationServer3D.map_get_closest_point(nav, b_stand), true)
			_table["bot_i"] = 0
		var path: PackedVector3Array = _table["bot_path"]
		var i: int = _table["bot_i"]
		while i < path.size() and Vector2(path[i].x - me.x, path[i].z - me.z).length() < 0.3:
			i += 1
		_table["bot_i"] = i
		var goal: Vector3 = path[i] if i < path.size() else b_stand
		var to := Vector3(goal.x - me.x, 0.0, goal.z - me.z)
		var left := Vector3(b_stand.x - me.x, 0.0, b_stand.z - me.z).length()
		if left < 0.3 or (i >= path.size() and to.length() < 0.3):
			_table["bot_sat"] = true
		else:
			bot.move_velocity = to.normalized() * clampf(left * 2.0, 0.6, 1.6)
			bot.facing = (bot.facing as Vector3).slerp(to.normalized(), minf(delta * 6.0, 1.0)).normalized()
		# (too far off, or stuck: he is simply there)
		if _t > wt + 5.0:
			var off: Vector3 = (bs + (c - bs).normalized() * 0.1) - bot.position_ground()
			for part in bot.parts:
				part.global_position += Vector3(off.x, off.y + 0.05, off.z)
				part.linear_velocity = Vector3.ZERO
				part.reset_physics_interpolation()
			_table["bot_sat"] = true
	if _table.has("bot_sat") and not _table.has("done"):
		_table["done"] = true
		bot.facing = Vector3(c.x - bs.x, 0.0, c.z - bs.z).normalized()
		bot.seat = bs + Vector3.UP * float(_table["seat_h"])
		Game.play_3d(Sfx.get_stream(&"body_fall"), bs + Vector3.UP * 0.4, -20.0, 0.1, 2.0)
	if _t > wt + 1.2 and _table.has("done") and not _table.has("seated"):
		_table["seated"] = true
		player.seat_at = ps
		player.seat_eye = 1.18
		player.cine_busy = false
		Game.play_3d(Sfx.get_stream(&"body_fall"), ps + Vector3.UP * 0.4, -18.0, 0.1, 2.0)
		gun.visible = true
		gun.global_transform = _player_pose("front")
	if _table.has("seated") and _t > wt + 2.0:
		_say("Заряжаешь один патрон...", 2.5)
		_go("load")


## The player got up from the table (or walked off): an insult after him,
## the man furious, the onlookers jeering.
func _walked_out() -> void:
	_say("Ты встал и ушёл. Его это взбесило.", 3.0)
	if is_instance_valid(bot):
		bot.angry_until = Game.clock + 30.0
		bot.seat = Vector3.INF
		if bot.ai and bot.ai.talk:
			bot.ai.talk.say("go_away")
	for ai in _spectators:
		if is_instance_valid(ai) and ai.body.alive:
			ai.body.angry_until = Game.clock + 15.0
	_crowd_say(JEERS[randi() % JEERS.size()], 2.5)
	_drop_gun()
	var ai = bot.ai if is_instance_valid(bot) else null
	_finish(3.0)
	if ai:
		ai._enter(ai.S.WANDER)


## Called by the player when they stand up from the table.
func player_stood_up() -> void:
	if not _over:
		_walked_out()


# --- Onlookers ------------------------------------------------------------------------

## Anyone near enough to have seen it, or heard what is going on, comes over
## to watch: a ring round the two of them (or the table), off the line of fire.
func _gather_spectators() -> void:
	var centre: Vector3 = _table["center"] if at_table else (player.global_position + bot.position_ground()) * 0.5
	var cands: Array = []
	for b in Game.bots:
		if b == bot or not is_instance_valid(b) or not b.alive or not b.conscious or b.fallen or b.cuffed:
			continue
		var ai = b.ai
		if ai == null or ai.roulette != null or ai.spectate != null or ai.process_mode == Node.PROCESS_MODE_DISABLED:
			continue
		if ai.state in [ai.S.FLEE, ai.S.HIDE, ai.S.ARMED, ai.S.SURRENDER, ai.S.DOWNED, ai.S.CUFFED] or b.weapon:
			continue
		var d: float = b.position_ground().distance_to(centre)
		var saw: bool = d < 22.0 and ai._line_clear(b.eye_position(), player.cam.global_position)
		if saw or d < 12.0:
			cands.append([d, ai])
	cands.sort_custom(func(a, c): return a[0] < c[0])
	var n := mini(cands.size(), 6)
	var axis: Vector3 = (bot.position_ground() - player.global_position)
	axis.y = 0.0
	axis = axis.normalized() if axis.length() > 0.1 else Vector3.FORWARD
	var side := axis.cross(Vector3.UP)
	var nav: RID = player.get_world_3d().navigation_map
	for i in n:
		var ai = cands[i][1]
		# Spread over the two sides, clear of either end of the table.
		var sgn := 1.0 if i % 2 == 0 else -1.0
		var along := (float(i / 2) - 1.0) * 0.9
		var spot: Vector3 = centre + side * sgn * randf_range(2.0, 2.6) + axis * along
		spot = NavigationServer3D.map_get_closest_point(nav, spot)
		ai.spectate = self
		ai.watch_spot = spot
		if ai.act:
			ai._end_activity()
		ai._enter(ai.S.IDLE)
		_spectators.append(ai)
		if randf() < 0.55:
			var bet: Array = BETS[randi() % BETS.size()]
			_bets[ai] = bet[1]
			get_tree().create_timer(randf_range(3.0, 9.0)).timeout.connect(func():
				if not _over and is_instance_valid(ai):
					_crowd_say(bet[0], 2.5))


## Each onlooker every frame: turned to the game, eyes on whoever has the gun
## to his head, worried.
func _spectator_tick(ai, _delta: float) -> void:
	var b = ai.body
	var centre: Vector3 = _table["center"] if at_table else (player.global_position + bot.position_ground()) * 0.5
	var me: Vector3 = b.position_ground()
	var to := Vector3(centre.x - me.x, 0.0, centre.z - me.z)
	if to.length() > 0.1 and ai.watch_spot != Vector3.INF and me.distance_to(ai.watch_spot) < 1.0:
		b.facing = (b.facing as Vector3).slerp(to.normalized(), 0.1).normalized()
		b.move_velocity = Vector3.ZERO
	var look: Vector3 = gun.global_position if gun and is_instance_valid(gun) else centre + Vector3.UP * 1.2
	if state.begins_with("b_") and is_instance_valid(bot):
		look = bot.head.global_position
	elif state.begins_with("p_") and is_instance_valid(player):
		look = player.cam.global_position
	b.look_target = look
	b.has_look_target = true
	ai.fear = maxf(ai.fear, 0.2)


## The shot: each of them jumps (not all at once), and gasps.
func _crowd_react(loser: String) -> void:
	var said := false
	for ai in _spectators:
		if not is_instance_valid(ai):
			continue
		var delay := randf_range(0.05, 0.6)
		var speak := not said and randf() < 0.6
		said = said or speak
		var won: bool = _bets.get(ai, "") == loser
		get_tree().create_timer(delay).timeout.connect(func():
			if not is_instance_valid(ai) or not ai.body.alive:
				return
			ai.body._flinch = 1.0
			ai.body._stagger = 0.3
			ai.fear = 0.9
			if speak:
				_crowd_say("Я же говорил!" if won else GASPS[randi() % GASPS.size()], 2.5))


func _crowd_say(text: String, time: float) -> void:
	_crowd.text = text
	_crowd_t = time


# --- The look of it --------------------------------------------------------------------------------

func _cinema(delta: float) -> void:
	var p = player
	var ok: bool = not _over and is_instance_valid(p) and state != ""
	# Black bars, top and bottom, while it is on.
	_bar_k = move_toward(_bar_k, 1.0 if ok else 0.0, delta * 1.5)
	var vs := get_viewport().get_visible_rect().size
	var h := vs.y * 0.11 * smoothstep(0.0, 1.0, _bar_k)
	if _bars.size() == 2:
		_bars[0].position = Vector2(0, 0)
		_bars[0].size = Vector2(vs.x, h)
		_bars[1].position = Vector2(0, vs.y - h)
		_bars[1].size = Vector2(vs.x, h)
	# The words go just under the top bar, never behind it.
	_label.position.y = maxf(90.0, h + 18.0)
	_crowd.position.y = _label.position.y + 60.0
	if not is_instance_valid(p):
		return
	# His turn: the view drawn slowly to his face, tighter and tighter while
	# he waits with it at his head; out again after.
	var want := 0.0
	if ok and is_instance_valid(bot) and state in ["b_raise", "b_wait", "b_pull"]:
		want = 1.0
	elif ok and state in ["p_wait", "p_pull"]:
		want = 0.35                 # (one's own: a little tunnel)
	_push = move_toward(_push, want, delta * (0.35 if want > _push else 0.9))
	var e := smoothstep(0.0, 1.0, _push)
	if is_instance_valid(bot) and state.begins_with("b_") and not _over:
		var eye: Vector3 = p.cam.global_position
		var face: Vector3 = bot.head.global_position
		var look := Transform3D(Basis.looking_at(face - eye, Vector3.UP), eye)
		look.origin = eye.lerp(face, 0.12 * e)
		p.cine_xf = look
		p.cine_k = e * 0.85
	else:
		p.cine_k = move_toward(p.cine_k, 0.0, delta * 1.2)
	p.cine_fov = -22.0 * e
	# The shot: a jolt, and the moment drawn out.
	if _shake > 0.0:
		_shake = maxf(_shake - delta * 2.5, 0.0)
		p.cine_fov += randf_range(-1.0, 1.0) * 3.0 * _shake


func _bang_moment() -> void:
	_shake = 1.0
	if is_instance_valid(player):
		player.shake(1.2)
	Game.time_mod = 0.3
	get_tree().create_timer(0.9, true, false, true).timeout.connect(func(): Game.time_mod = 1.0)
