extends RefCounted
## What one bot does at its place in an activity (activities.gd): gets there,
## turns the right way, stands or squats, and then gets on with it - talking
## and listening (looking at whoever is talking, hands going when it is him),
## spraying a tag stroke by stroke, or just leaning there - and, if he
## smokes, a cigarette in his fingers: now and then up to the mouth for a
## drag, the tip glowing, then the smoke breathed out into the air
## (smoke_field.gd) and the thin thread off the tip in between.

const Sfx = preload("res://scripts/audio/sfx.gd")
## What the one holding forth in a group says (situations, chatter.gd), and
## what the others put in.
const LINES := ["story", "story", "answer_life", "money_work", "thinking", "bar_drunk", "tease"]
const LISTEN := ["react_story", "react_story", "react_story", "make_peace", "greet_reply"]

const CigTex = preload("res://scripts/player/cig_tex.gd")

var ai: Node
var body: Node3D
var slot: Dictionary
var spot: Dictionary
var kind := ""
var smokes := false
var done := false
var arrived := false
var _t := 0.0
var _length := 120.0
var _cig: Node3D
var _ember_mat: StandardMaterial3D
var _can: Node3D
var _drag_t := -1.0              # time into a drag, or -1
var _next_drag := 3.0
var _smoke_say := -1.0            # a word after the smoke is out, in this long
var _exhale := -1.0              # time left breathing out
var _look_t := 0.0
var _look := Vector3.ZERO
var _spray_sound := 0.0
var _gesture := 0.0


func _init(a: Node, s: Dictionary) -> void:
	ai = a
	body = a.body
	slot = s
	spot = s["spot"]
	kind = spot["kind"]
	var rng: RandomNumberGenerator = ai.rng
	_length = rng.randf_range(60.0, 200.0)
	var chance: float = {"chat": 0.4, "squat": 0.6, "graffiti": 0.5, "smoke": 1.0, "bench": 0.75, "chair": 0.6, "tv": 0.4}[kind]
	smokes = rng.randf() < chance and not slot.get("painter", false)
	_next_drag = rng.randf_range(2.0, 8.0)


func painter() -> bool:
	return slot.get("painter", false)


## Every frame while doing it (after the AI has moved and turned him).
func tick(delta: float) -> void:
	if done:
		return
	var me: Vector3 = body.position_ground()
	var pos: Vector3 = slot["pos"]
	if not arrived:
		var same_floor := absf(me.y - pos.y) < 0.7
		if same_floor and (Vector2(me.x - pos.x, me.z - pos.z).length() < 0.45 or (ai._path.is_empty() and me.distance_to(pos) < 1.2)):
			arrived = true
			ai._path = PackedVector3Array()
			_props(true)
		return
	_t += delta
	if _t > _length and not (painter() and int(spot["coat"]) < (spot["colors"] as Array).size()):
		done = true
		return
	# Where he is to be, turned to face his way.
	body.move_velocity = Vector3.ZERO
	var face: Vector3 = (slot["face"] as Vector3) - me
	face.y = 0.0
	if face.length() > 0.05:
		body.facing = (body.facing as Vector3).slerp(face.normalized(), minf(delta * 3.0, 1.0)).normalized()
	if kind in ["bench", "chair", "tv"]:
		# Sat on the bench or the chair (the pose is held still, see humanoid.seat).
		body.seat = slot["seat"]
		body.posture = body.Posture.SIT
	else:
		body.posture = body.Posture.SQUAT if kind == "squat" else body.Posture.STAND
	body.hand_goal["r"] = Vector3.INF
	body.hand_goal["l"] = Vector3.INF
	match kind:
		"chat", "squat", "bench":
			_talk(delta)
		"graffiti":
			if painter():
				_paint(delta)
			else:
				_watch(delta)
		"tv":
			# Eyes on the set, now and then a glance away.
			_look_t -= delta
			if _look_t <= 0.0:
				_look_t = ai.rng.randf_range(3.0, 9.0)
				_look = spot["tv"] if ai.rng.randf() < 0.8 else body.eye_position() + body.facing * 3.0 + Vector3(ai.rng.randf_range(-2, 2), -0.5, 0)
			body.look_target = _look
			body.has_look_target = true
		_:
			_idle_look(delta)
	if smokes:
		_smoke(delta)


func stop() -> void:
	_props(false)
	if is_instance_valid(body):
		body.seat = Vector3.INF
		body.hand_goal["r"] = Vector3.INF
		body.hand_goal["l"] = Vector3.INF
		body.posture = body.Posture.STAND
	if spot.get("speaker") == body:
		spot["speaker"] = null


# --- Talking ------------------------------------------------------------------------

## One of them talks at a time (a few seconds each, sometimes out loud with a
## line); the others look at him.
func _talk(delta: float) -> void:
	var now := Game.clock
	var sp = spot.get("speaker")
	if sp == null or not is_instance_valid(sp) or not sp.alive or now > float(spot["speak_until"]):
		var members: Array = []
		for sl in spot["slots"]:
			var b = sl["bot"]
			if b and is_instance_valid(b) and b.ai and b.ai.act and b.ai.act.arrived:
				members.append(b)
		if members.is_empty():
			return
		sp = members[ai.rng.randi() % members.size()]
		spot["speaker"] = sp
		spot["speak_until"] = now + ai.rng.randf_range(3.0, 8.0)
		if sp == body and members.size() > 1 and ai.rng.randf() < 0.3 and not ai.talk.speaking():
			ai.talk.say(LINES[ai.rng.randi() % LINES.size()])
		elif sp != body and ai.rng.randf() < 0.12 and not ai.talk.speaking():
			ai.talk.say(LISTEN[ai.rng.randi() % LISTEN.size()])
	if sp == body:
		# Talking: looking round at them, hands going.
		_look_t -= delta
		if _look_t <= 0.0:
			_look_t = ai.rng.randf_range(1.0, 2.5)
			var others: Array = []
			for sl in spot["slots"]:
				if sl["bot"] and sl["bot"] != body and is_instance_valid(sl["bot"]):
					others.append(sl["bot"])
			_look = (others[ai.rng.randi() % others.size()].eye_position()) if not others.is_empty() else spot["center"] + Vector3.UP * 1.5
		body.look_target = _look
		_gesture += delta
		if _drag_t < 0.0 and kind == "chat":
			var cb: Basis = body.chest.global_basis.orthonormalized()
			var front: Vector3 = body.chest.global_position - cb.z * 0.32 + Vector3.DOWN * 0.12
			var sway := Vector3(sin(_gesture * 3.1), 0.6 * sin(_gesture * 4.3 + 1.0), 0.0) * 0.07
			body.hand_goal["l"] = front - cb.x * 0.12 + cb * sway
			if not smokes:
				body.hand_goal["r"] = front + cb.x * 0.14 + cb * Vector3(-sway.y, sway.x, 0.0)
	else:
		body.look_target = sp.eye_position()
	body.has_look_target = true


# --- Spraying -----------------------------------------------------------------------

## Along the tag's strokes, a coat of the colour and then the outline, the can
## a hand's width off the wall, hissing while it sprays.
func _paint(delta: float) -> void:
	var g = spot["graffiti"]
	var n: Vector3 = spot["normal"]
	# The can upright in the fist, the nozzle on top turned to the wall.
	if _can and is_instance_valid(_can):
		var hand: RigidBody3D = body.parts[body.part_index["hand_r"]]
		_can.global_transform = Transform3D(Basis.looking_at(-n, Vector3.UP), hand.global_position + Vector3.DOWN * 0.03)
	var tag: Array = spot["tag"]
	var coat: int = spot["coat"]
	if coat >= (spot["colors"] as Array).size():
		# Done: stands back a bit and looks at it.
		body.look_target = g.global_position
		body.has_look_target = true
		if _t > 4.0:
			_length = minf(_length, _t + 6.0)
		return
	var stroke: PackedVector2Array = tag[int(spot["stroke"])][0]
	var i: int = spot["point"]
	var cur: Vector2 = spot.get("xy", stroke[0])
	var goal: Vector2 = stroke[mini(i, stroke.size() - 1)]
	var spraying := i > 0
	var speed := 0.45 if spraying else 0.8
	var step := goal - cur
	var move := speed * delta
	if step.length() <= move:
		cur = goal
		spot["point"] = i + 1
		if i + 1 >= stroke.size():
			# Next stroke (moving there without spraying), or the next coat.
			spot["point"] = 0
			spot["stroke"] = int(spot["stroke"]) + 1
			if int(spot["stroke"]) >= tag.size():
				spot["stroke"] = 0
				spot["coat"] = coat + 1
	else:
		cur += step.normalized() * move
	spot["xy"] = cur
	var colors: Array = spot["colors"]
	# (the shine only along the start of each line, as a highlight)
	var shine_skip: bool = coat == 3 and i > maxi(stroke.size() / 3, 1)
	if spraying and not shine_skip:
		var style: Array = g.COATS[mini(coat, g.COATS.size() - 1)]
		g.spray(cur + (style[0] as Vector2), colors[coat], style[1], style[2])
		_spray_sound -= delta
		if _spray_sound <= 0.0:
			_spray_sound = 0.32
			Game.play_3d(Sfx.get_stream(&"spray"), g.wall_point(cur), -30.0, 0.1, 1.5, 6.0)
	var at: Vector3 = g.wall_point(cur)
	body.hand_goal["r"] = at + n * 0.2 + Vector3.DOWN * 0.05
	# Following the can with his eyes, the other hand at his side.
	body.look_target = at
	body.has_look_target = true


## Stands back watching the wall (and whoever is at it).
func _watch(delta: float) -> void:
	_look_t -= delta
	if _look_t <= 0.0:
		_look_t = ai.rng.randf_range(1.5, 4.0)
		var g = spot["graffiti"]
		_look = g.global_position if ai.rng.randf() < 0.7 else body.eye_position() + Vector3(ai.rng.randf_range(-4, 4), 0, ai.rng.randf_range(-4, 4))
	body.look_target = _look
	body.has_look_target = true


func _idle_look(delta: float) -> void:
	_look_t -= delta
	if _look_t <= 0.0:
		_look_t = ai.rng.randf_range(2.0, 5.0)
		var f: Vector3 = body.facing
		_look = body.eye_position() + f * 6.0 + f.cross(Vector3.UP) * ai.rng.randf_range(-5.0, 5.0) + Vector3.UP * ai.rng.randf_range(-1.2, 0.5)
	body.look_target = _look
	body.has_look_target = true


# --- Smoking ------------------------------------------------------------------------

## The cigarette: a drag every so often (up to the lips, the tip flaring),
## then breathed out; a thin thread off the tip the rest of the time.
func _smoke(delta: float) -> void:
	if _cig == null:
		return
	var mouth: Vector3 = body.head.global_transform * (Vector3(0.0, -0.05, -0.11) * body.scale_factor)
	var tip: Vector3 = _cig.global_transform * Vector3(0.04, 0.0, 0.0)
	var glow := 0.25
	if _drag_t >= 0.0:
		_drag_t += delta
		var up := smoothstep(0.0, 0.6, _drag_t) * (1.0 - smoothstep(1.9, 2.5, _drag_t))
		if up > 0.02 and body.arm_health["r"] > 0.3:
			var rest: Vector3 = body.chest.global_transform * Vector3(0.2, -0.35, -0.12)
			# The hand goes where it puts the filter end on the lips.
			var hand: RigidBody3D = body.parts[body.part_index["hand_r"]]
			var filter: Vector3 = _cig.global_transform * Vector3(-0.035, 0.0, 0.0)
			var at_mouth := mouth + (hand.global_position - filter)
			body.hand_goal["r"] = rest.lerp(at_mouth, up)
		if _drag_t > 0.7 and _drag_t < 1.8:
			glow = 1.0
		if _drag_t > 2.7:
			_drag_t = -1.0
			_exhale = ai.rng.randf_range(1.2, 1.8)
			_next_drag = ai.rng.randf_range(6.0, 16.0)
			if ai.rng.randf() < 0.3:
				_smoke_say = 2.2
	else:
		_next_drag -= delta
		if _smoke_say > 0.0:
			_smoke_say -= delta
			if _smoke_say <= 0.0 and ai.talk and not ai.talk.speaking() and not ai.talk.busy():
				ai.talk.say("smoke")
		if _next_drag <= 0.0 and _exhale < 0.0:
			_drag_t = 0.0
	if _exhale > 0.0 and Game.smoke:
		_exhale -= delta
		var f: Vector3 = -body.head.global_basis.z
		_wisps().jet(mouth + f * 0.04, (f + Vector3.DOWN * 0.15).normalized(), clampf(_exhale / 1.5, 0.0, 1.0))
		_wisps().thread(tip, false)
	else:
		_wisps().jet(Vector3.ZERO, Vector3.FORWARD, 0.0)
		_wisps().thread(tip, _drag_t < 0.0)
	_ember_mat.emission_energy_multiplier = lerpf(_ember_mat.emission_energy_multiplier, 1.5 + glow * 8.0, minf(delta * 6.0, 1.0))


# --- Things in the hand ---------------------------------------------------------------

func _props(on: bool) -> void:
	for n in [_cig, _can]:
		if n and is_instance_valid(n):
			n.queue_free()
	_cig = null
	_can = null
	if _wisp and is_instance_valid(_wisp):
		_wisp.queue_free()
		_wisp = null
	if not on or not is_instance_valid(body):
		return
	var hand: RigidBody3D = body.parts[body.part_index["hand_r"]]
	if smokes:
		_cig = Node3D.new()
		var paper := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.0045
		cm.bottom_radius = 0.0045
		cm.height = 0.07
		paper.mesh = cm
		paper.material_override = CigTex.paper_mat()
		paper.rotation = Vector3(0, 0, PI * 0.5)
		paper.position = Vector3(0.005, 0, 0)
		_cig.add_child(paper)
		var fi := MeshInstance3D.new()
		var fm := CylinderMesh.new()
		fm.top_radius = 0.0046
		fm.bottom_radius = 0.0046
		fm.height = 0.022
		fi.mesh = fm
		fi.material_override = CigTex.filter_mat()
		fi.rotation = Vector3(0, 0, PI * 0.5)
		fi.position = Vector3(-0.041, 0, 0)
		_cig.add_child(fi)
		var ember := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.005
		sm.height = 0.008
		ember.mesh = sm
		_ember_mat = CigTex.ember_mat()
		_ember_mat.emission_energy_multiplier = 2.0
		ember.material_override = _ember_mat
		ember.position = Vector3(0.036, 0, 0)
		_cig.add_child(ember)
		hand.add_child(_cig)
		# Between the fingers, sticking out to the side.
		_cig.position = Vector3(-0.02, -0.075, -0.03) * body.scale_factor
	if painter():
		_can = Node3D.new()
		var can := MeshInstance3D.new()
		var cy := CylinderMesh.new()
		cy.top_radius = 0.033
		cy.bottom_radius = 0.033
		cy.height = 0.2
		can.mesh = cy
		var paint := StandardMaterial3D.new()
		paint.albedo_color = (spot["colors"] as Array)[0]
		paint.metallic = 0.5
		paint.roughness = 0.4
		can.material_override = paint
		_can.add_child(can)
		var cap := MeshInstance3D.new()
		var cc := CylinderMesh.new()
		cc.top_radius = 0.012
		cc.bottom_radius = 0.015
		cc.height = 0.02
		cap.mesh = cc
		var white := StandardMaterial3D.new()
		white.albedo_color = Color(0.9, 0.9, 0.9)
		cap.material_override = white
		cap.position = Vector3(0, 0.11, 0)
		_can.add_child(cap)
		var nozzle := MeshInstance3D.new()
		var nb := BoxMesh.new()
		nb.size = Vector3(0.014, 0.014, 0.016)
		nozzle.mesh = nb
		var black := StandardMaterial3D.new()
		black.albedo_color = Color(0.05, 0.05, 0.05)
		nozzle.material_override = black
		nozzle.position = Vector3(0, 0.125, -0.01)
		_can.add_child(nozzle)
		hand.add_child(_can)
		_can.position = Vector3(0.0, -0.1, -0.02) * body.scale_factor


var _wisp: Node3D


func _wisps() -> Node3D:
	if _wisp == null or not is_instance_valid(_wisp):
		_wisp = load("res://scripts/fx/smoke_wisps.gd").new()
		_wisp.top_level = true
		body.add_child(_wisp)
	return _wisp
