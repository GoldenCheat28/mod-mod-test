extends CharacterBody3D
## First-person player: movement with stair step-up, dynamic camera motion
## (bob, strafe/turn roll, landing dip, recoil kick) and weapon handling.

const Weapon = preload("res://scripts/weapons/weapon.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")
const HandIcon = preload("res://scripts/ui/hand_icon.gd")
const PostFx = preload("res://scripts/fx/post_fx.gd")
const Smoking = preload("res://scripts/player/smoking.gd")
const RadialMenu = preload("res://scripts/ui/radial_menu.gd")
const Vitals = preload("res://scripts/player/vitals.gd")
const PlayerBody = preload("res://scripts/player/player_body.gd")
const Humanoid = preload("res://scripts/bots/humanoid.gd")
const Flashlight = preload("res://scripts/player/flashlight.gd")
const Grenade = preload("res://scripts/weapons/grenade.gd")
const Bomb = preload("res://scripts/weapons/bomb.gd")
const Chainsaw = preload("res://scripts/weapons/chainsaw.gd")
const BladeCut = preload("res://scripts/weapons/blade_cut.gd")
const Machete = preload("res://scripts/weapons/machete.gd")
const Roulette = preload("res://scripts/game/roulette.gd")
const Inventory = preload("res://scripts/game/inventory.gd")
const Items = preload("res://scripts/game/items.gd")
const InventoryUI = preload("res://scripts/ui/inventory_ui.gd")
const ItemIcons = preload("res://scripts/ui/item_icons.gd")
const Graffiti = preload("res://scripts/world/graffiti.gd")
const CraftUI = preload("res://scripts/ui/craft_ui.gd")
const PipeBomb = preload("res://scripts/weapons/pipe_bomb.gd")
const Mop = preload("res://scripts/player/mop.gd")
const ItemDrop = preload("res://scripts/game/item_drop.gd")
const BodycamHud = preload("res://scripts/ui/bodycam_hud.gd")
const CraftBench = preload("res://scripts/game/craft_bench.gd")
const Molotov = preload("res://scripts/weapons/molotov.gd")
const Fire = preload("res://scripts/fx/fire.gd")
const FleshWounds = preload("res://scripts/fx/flesh_wounds.gd")
## What each thing taken in hand is, as a thing in the bag.
const HELD_ITEM := {"pistol": "pistol", "shotgun": "shotgun", "akm": "akm", "grenade": "grenade", "bomb": "bomb",
		"cuffs": "cuffs", "chainsaw": "chainsaw", "machete": "machete", "spraycan": "spraycan", "revolver": "revolver",
		"pipe_bomb": "pipe_bomb", "mop": "mop", "sponge": "sponge", "molotov": "molotov",
		"sawnoff": "sawnoff", "crossbow": "crossbow", "flaregun": "flaregun", "rifle": "rifle"}
const MACHETE_CHARGE := 0.55         # s of holding for the hardest blow
const MACHETE_REST := -0.12           # swing angles round the shoulder (rad): held,
const MACHETE_UP := 2.3              # raised over the head,
const MACHETE_END := -1.25           # and where a blow ends
const MACHETE_MIN_SPEED := 3.5       # m/s of the edge below which it does not cut
## What it takes to chop through each part, J per metre of the cut.
const MACHETE_HARD := {"hand": 350.0, "foot": 450.0, "forearm": 600.0, "shin": 800.0, "upper_arm": 800.0,
		"thigh": 1100.0, "abdomen": 500.0, "chest": 1600.0, "pelvis": 2000.0, "head": 1500.0}
## How fast the chain eats through each part (m/s): the blade can be moved
## no faster than this through it; the cut is done when the blade has gone
## right through and out the other side.
const BAR_HALF := 0.035              # half the depth of the bar with its chain
const FEED_RATE := {"hand": 0.3, "foot": 0.26, "forearm": 0.22, "shin": 0.18, "upper_arm": 0.18, "thigh": 0.14,
		"head": 0.1, "abdomen": 0.16, "pelvis": 0.1, "chest": 0.1}

const WALK_SPEED := 3.0
const SPRINT_SPEED := 5.8
const GROUND_ACCEL := 10.0
const AIR_ACCEL := 1.5
const JUMP_VELOCITY := 4.3
const GRAVITY := 9.81
const MOUSE_SENS := 0.0022
const EYE_HEIGHT := 1.62
const CROUCH_EYE := 1.05
const STAND_H := 1.76
const CROUCH_H := 1.2
const STEP_HEIGHT := 0.36
const BASE_FOV := 78.0
const GRAB_REACH := 2.4
const GRAB_MAX_FORCE := 950.0      # N: a person can drag a body, not throw it
const GRAB_MAX_MASS := 90.0
const ARM_REACH := 0.56            # shoulder to grip, arms nearly straight
const FREE_MOVE_SENS := 0.00055
const FREE_ROT_SENS := 0.004
# How far the ragdoll can look around (neck plus eyes): yaw, pitch down, pitch up.
const RAG_LOOK_YAW := 1.25
const RAG_LOOK_DOWN := 0.95
const RAG_LOOK_UP := 0.75

var cam: Camera3D
var yaw := 0.0
var pitch := 0.0
var weapons := {}
var current: Node3D                # null = empty hands
var _pending := ""

var _look_delta := Vector2.ZERO
var _bob_phase := 0.0
var _bob_amount := 0.0
var _sprint := 0.0
var _was_on_floor := true
var _prev_vy := 0.0
var _cam_y := 0.0
var _land := 0.0
var _land_v := 0.0
var _kick := 0.0
var _kick_v := 0.0
var _kick_roll := 0.0
var _kick_roll_v := 0.0
var _turn_roll := 0.0
var _strafe_roll := 0.0
var _time := 0.0

# Body, health, ragdoll, death.
var vitals: Node
var _body: Node3D
var _shape: CollisionShape3D
var _ragdoll: Node3D = null
var _weapon_before := ""
var _dead := false
var _dead_t := 0.0
var _black := 0.0
var _rag_look := Vector2.ZERO      # yaw, pitch relative to the ragdoll's head
var _rising := false               # the ragdoll is getting up on its own muscles
var _crouch := 0.0                 # 0 standing .. 1 crouched
var _cap: CapsuleShape3D
var _flash: Node3D
var _last_alt := -10.0
var _last_switch := -10.0
var _blast_until := -1.0
var _r_down := -1.0                # when R went down (revolver: held = roulette load)
const SWITCH_DELAY := 0.55
# Climbing over something: from/to feet positions, ledge point, height, timing.
var _climb := {}
var _climb_view := Vector2.ZERO    # pitch, roll added to the camera while climbing
# Grenade / bomb in the right hand (weapons put away): "", "grenade", "bomb".
var _item := ""
var _item_model: Node3D
var _item_kind := ""
var _item_cool := 0.0              # after a throw/placement, the next one comes up
var _throw_t := -1.0               # throw animation time, -1 = none
var _throw_soft := false
# Left hand pressing a key on a bomb: {bomb, key, t, done}.
var _press := {}
var _look_bomb: Node = null
var _look_key := -1
# Camera handover between the view and the ragdoll's eyes: blends from where
# the camera was, so switching never shows as a jump.
var _bandage_t := -1.0            # bandaging, -1 = not
var _bandage_w := {}               # the wound being seen to (vitals.wounds)
var _escort: Node3D = null         # cuffed bot being walked in front
var _saw: BladeCut                 # the chainsaw's cuts in progress (see _saw_tick)
var inventory: RefCounted          # the bag (inventory.gd)
var _inv_ui: Control
var _craft_ui: Control
var bench: Node3D = null            # making something with the hands (craft_bench.gd)
var _shop_ui: Control
var _dialog_ui: Control
var _note: Label                   # a short message on screen
var _note_t := 0.0
var roulette: Node = null          # a game of Russian roulette going on (roulette.gd)
var _free_holds := {}              # item -> FreeHold: a saw or blade moved/turned in the hands (Alt)
var _mach_cut: BladeCut             # the machete's cuts in progress
var _mach_charge := 0.0            # the blow being raised, 0..1
var _mach_swing := -1.0            # time into a blow, or -1
var _mach_from := 0.0
var _mach_power := 0.0
var _mach_theta := MACHETE_REST
var _mach_mid := 0.0               # the arm in over the middle of the head, 0..1
var _mach_new := false
var _mach_energy := 0.0            # what the swing has to cut with, this step (J)
var _mach_used := 0.0
var _saw_push := 0.0               # the saw pushed forward while revving, 0..1
var _saw_drag := 0.0               # how hard a blade is held in someone: the view turns heavily
var _saw_spray := 0.0
var _saw_roll := 0.0               # blade tilt (mouse wheel): vertical .. flat
var _radial_bot: Node3D = null     # cuffed bot the radial menu is about
const BANDAGE_TIME := 4.6
var _air_t := 0.0                  # time falling
var _rag_vy := 0.0                 # ragdoll pelvis vertical speed last tick
var _cam_from := Transform3D()
var _cam_blend := 0.0
var _cam_blend_time := 0.3
var _rise_t := 0.0
# Body cam (Game.bodycam): the HUD, the static, the chest camera's shake.
var _bc_hud: Control
var _static := 0.0
var _static_target := 0.0
var _bc_rot := Vector3.ZERO        # pitch, yaw, roll kicked by each step
var _bc_rot_v := Vector3.ZERO
var _bc_pos := Vector3.ZERO
var _bc_pos_v := Vector3.ZERO

# Grabbing.
var _hand: Control
var _post: CanvasLayer
var hearing: Node                  # the ears: stunned by bangs (hearing.gd)
var _smoking: Node3D
var _radial: Control
var _after_smoke := ""
var _prev_view := Vector2.ZERO
var _held: RigidBody3D
var _held_local := Vector3.ZERO
var _held_dist := 1.5
var _aim_body: RigidBody3D

# Wet footsteps: looping puddle recordings faded in while moving through water.
var _splash_walk: AudioStreamPlayer
var _splash_run: AudioStreamPlayer
var _wet := 0.0
var _step_side := 1.0


func _ready() -> void:
	collision_layer = Game.LAYER_PLAYER
	collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS
	floor_max_angle = deg_to_rad(46.0)
	floor_snap_length = 0.4
	floor_constant_speed = true
	# Only the level itself carries the player along: a body, a barrel or a
	# door moving under the feet is not a lift - stepping off a ragdoll's
	# flailing arm must not hand its speed on (it could fling one sky-high).
	platform_floor_layers = Game.LAYER_WORLD
	platform_wall_layers = 0
	platform_on_leave = CharacterBody3D.PLATFORM_ON_LEAVE_DO_NOTHING
	max_slides = 4
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = STAND_H
	_cap = cap
	cs.shape = cap
	cs.position.y = 0.88
	add_child(cs)
	_shape = cs
	vitals = Vitals.new()
	vitals.player = self
	add_child(vitals)
	vitals.died.connect(_on_died)
	vitals.passed_out.connect(_go_ragdoll)
	vitals.came_to.connect(func(): get_tree().create_timer(1.5).timeout.connect(_get_up))
	_body = PlayerBody.new()
	add_child(_body)
	_body.setup()

	cam = Camera3D.new()
	cam.name = "Camera"
	cam.top_level = true
	cam.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	cam.fov = BASE_FOV
	cam.near = 0.02
	cam.far = 400.0
	add_child(cam)
	cam.make_current()

	for k in ["pistol", "shotgun", "akm", "revolver", "sawnoff", "crossbow", "flaregun", "rifle"]:
		var w := Weapon.new()
		w.name = k.capitalize()
		cam.add_child(w)
		w.setup(k)
		w.fired.connect(_on_fired)
		weapons[k] = w
	current = weapons["pistol"]
	current.raise()

	var post := PostFx.new()
	post.layer = 1
	add_child(post)
	_post = post
	hearing = preload("res://scripts/player/hearing.gd").new()
	hearing.player = self
	add_child(hearing)
	var ui := CanvasLayer.new()
	ui.layer = 2
	add_child(ui)
	_hand = HandIcon.new()
	ui.add_child(_hand)
	_radial = RadialMenu.new()
	ui.add_child(_radial)
	if Game.bodycam:
		# Faces blacked out, as released footage is - under the lens effect
		# (layer 0, below post_fx on 1), so the squares bend with the picture.
		var censor_layer := CanvasLayer.new()
		censor_layer.layer = 0
		add_child(censor_layer)
		censor_layer.add_child(preload("res://scripts/ui/face_censor.gd").new())
		# The feed comes up out of the static.
		_bc_hud = BodycamHud.new()
		ui.add_child(_bc_hud)
		_bc_hud.connected()
		_static = 1.0
		_static_target = 0.0
	# The bag, and what is in it to start with.
	inventory = Inventory.new(12, 9)
	for pair in [["akm", 1], ["pistol", 1], ["shotgun", 1], ["chainsaw", 1], ["machete", 1], ["grenade", 3],
			["bomb", 1], ["bandage", 3], ["cuffs", 1], ["cigarettes", 20], ["joint", 2], ["spraycan", 1], ["revolver", 1], ["sponge", 1],
			["money", 600], ["sawnoff", 1], ["crossbow", 1], ["flaregun", 1], ["molotov", 3], ["rifle", 1]]:
		inventory.add(pair[0], pair[1])
	ui.add_child(ItemIcons.new())
	_inv_ui = InventoryUI.new()
	_inv_ui.inv = inventory
	ui.add_child(_inv_ui)
	_inv_ui.use_item.connect(_use_item)
	_craft_ui = CraftUI.new()
	_craft_ui.inv = inventory
	ui.add_child(_craft_ui)
	_craft_ui.crafted.connect(_on_crafted)
	_shop_ui = preload("res://scripts/ui/shop_ui.gd").new()
	_shop_ui.inv = inventory
	ui.add_child(_shop_ui)
	_dialog_ui = preload("res://scripts/ui/dialog_ui.gd").new()
	_dialog_ui.inv = inventory
	_dialog_ui.player = self
	ui.add_child(_dialog_ui)
	_inv_ui.drop_item.connect(_drop_item)
	_note = Label.new()
	_note.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_note.position = Vector2(-300, -140)
	_note.size = Vector2(600, 40)
	_note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_note.add_theme_font_size_override("font_size", 22)
	_note.add_theme_color_override("font_outline_color", Color.BLACK)
	_note.add_theme_constant_override("outline_size", 6)
	_note.modulate.a = 0.0
	ui.add_child(_note)
	_flash = Flashlight.new()
	add_child(_flash)
	_flash.setup(cam)
	_smoking = Smoking.new()
	cam.add_child(_smoking)
	_smoking.setup(self)
	_smoking.finished.connect(_on_smoke_done)
	_splash_walk = _loop_player(&"puddle_walk")
	_splash_run = _loop_player(&"puddle_run")
	yaw = PI
	_cam_y = global_position.y
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
	if _dead or not vitals.conscious:
		return
	if bench != null:
		return
	if event.is_action_pressed("craft") and roulette == null and not _inv_ui.is_open:
		_craft_ui.toggle()
		return
	if _craft_ui.is_open or _shop_ui.is_open or _dialog_ui.is_open:
		return
	if event.is_action_pressed("inventory") and roulette == null:
		_inv_ui.toggle()
		return
	if _inv_ui.is_open:
		return                     # the bag is open: nothing else
	if event.is_action_pressed("pickup"):
		_pick_up()
		return
	if event.is_action_pressed("ragdoll"):
		if _ragdoll:
			_get_up()
		else:
			_go_ragdoll()
		return
	if _ragdoll:
		# A full ragdoll: the view is wherever the limp head points - the
		# mouse does not turn it.
		return
	if event.is_action_pressed("free_aim") and not event.is_echo():
		# Alt twice quickly: the gun goes back to the normal hold.
		if Game.clock - _last_alt < 0.3:
			for w in weapons.values():
				w.free_pos = Vector3.ZERO
				w.free_rot = Vector3.ZERO
			for f in _free_holds.values():
				f.free_pos = Vector3.ZERO
				f.free_rot = Vector3.ZERO
			_notify("Руки в обычное положение")
		_last_alt = Game.clock
	if _item_kind == "chainsaw" and not Input.is_action_pressed("free_aim") and event is InputEventMouseButton and event.pressed 			and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
		_saw_roll = clampf(_saw_roll + (0.2 if event.button_index == MOUSE_BUTTON_WHEEL_UP else -0.2), -PI * 0.5, PI * 0.5)
		return
	if event.is_action_pressed("flashlight"):
		_flash.toggle()
		return
	if (current or _item_kind in FREE_ITEMS) and Input.is_action_pressed("free_aim") and _free_input(event):
		return
	if event is InputEventMouseMotion and _radial.is_open:
		_radial.feed(event.screen_relative)
		return
	if event.is_action_pressed("radial"):
		# Looking at someone in cuffs: what to do with them.
		_radial_bot = _look_humanoid(2.6)
		if _radial_bot and _radial_bot.cuffed:
			var walking := _escort == _radial_bot
			_radial.open(["Встать" if _radial_bot.ai.kneel else "На колени", "Снять наручники",
					"Отпустить" if walking else "Вести"] as Array[String])
			return
		_radial_bot = null
		_radial.open(["Сигарета", "Косяк", "Пистолет", "Дробовик", "АКМ", "Манекен", "Граната", "Бомба", "Бинт",
				"Наручники", "Бензопила", "Мачете", "Рулетка", "Баллончик", "Привет", "Фак"] as Array[String],
				{14: "wave", 15: "fuck"})
		return
	# Clicking on "Рулетка" (instead of just letting go on it): where to play.
	if _radial.is_open and _radial_mode == "" and _radial_bot == null and event is InputEventMouseButton and event.pressed \
			and event.button_index == MOUSE_BUTTON_LEFT and _radial.selected() == 12:
		_radial_mode = "roulette"
		_radial.open(["Стреляться здесь", "Пойти за стол"] as Array[String])
		get_viewport().set_input_as_handled()
		return
	if event.is_action_released("radial") and _radial_mode == "roulette":
		_radial_mode = ""
		var pick: int = _radial.close()
		if pick >= 0 and roulette == null:
			var r := Roulette.new()
			get_parent().add_child(r)
			r.start(self, _roulette_partner(), pick == 1)
		return
	if event.is_action_released("radial") and _radial_bot:
		var pick: int = _radial.close()
		var b := _radial_bot
		_radial_bot = null
		if not is_instance_valid(b):
			return
		match pick:
			0:
				b.ai.kneel = not b.ai.kneel
				Net.bot_call(b, "net_set", ["kneel", b.ai.kneel])
				if b.ai.kneel and _escort == b:
					_set_escort(null)
			1:
				if _escort == b:
					_set_escort(null)
				if not Net.bot_call(b, "net_ai", ["uncuff"]):
					b.set_cuffed(false)
					b.ai.kneel = false
					b.ai._enter(b.ai.S.FLEE)
				Game.play_3d(Sfx.get_stream(&"key_press"), b.chest.global_position, -8.0, 0.1, 2.0)
			2:
				_set_escort(null if _escort == b else b)
		return
	if event.is_action_released("radial"):
		var pick: int = _radial.close()
		if pick >= 2 and pick <= 4:
			var g: String = ["pistol", "shotgun", "akm"][pick - 2]
			if inventory.take(g):
				_after_losing(g)
				_drop_gun(g)
			else:
				_notify("Нет в рюкзаке: " + Items.def(g)["name"])
		elif pick == 5:
			_spawn_bot(true)
		elif pick == 6 or pick == 7:
			_switch_to("grenade" if pick == 6 else "bomb")
		elif pick == 8 and _bandage_t < 0.0 and not _smoking.busy():
			_start_bandage()
		elif pick == 12:
			if roulette == null:
				var r := Roulette.new()
				get_parent().add_child(r)
				r.start(self, _roulette_partner())
		elif pick == 14 or pick == 15:
			_start_gesture("wave" if pick == 14 else "fuck")
		elif pick == 13:
			_switch_to("spraycan")
		elif pick >= 9 and pick <= 11:
			_switch_to(["cuffs", "chainsaw", "machete"][pick - 9])
		elif pick >= 0 and pick <= 1 and not _smoking.busy():
			_start_smoke("cigarette" if pick == 0 else "joint")
		return
	if event is InputEventMouseMotion and Game.is_mouse_captured() and _sponge_on:
		_sponge_rub(event.screen_relative)
		return
	if event is InputEventMouseMotion and Game.is_mouse_captured():
		var rel: Vector2 = event.screen_relative * (lerpf(1.0, 0.7, current.aim) if current else 1.0)
		rel *= lerpf(1.0, 0.15, _saw_drag)
		yaw -= rel.x * MOUSE_SENS * Game.mouse_sens
		pitch = clampf(pitch - rel.y * MOUSE_SENS * Game.mouse_sens, deg_to_rad(-88), deg_to_rad(88))
		_look_delta += rel
	elif event.is_action_pressed("weapon_pistol"):
		_switch_to("pistol")
	elif event.is_action_pressed("weapon_hands"):
		_switch_to("hands")
	elif event.is_action_pressed("weapon_shotgun"):
		_switch_to("shotgun")
	elif event.is_action_pressed("weapon_akm"):
		_switch_to("akm")
	elif event.is_action_pressed("weapon_grenade"):
		_switch_to("grenade")
	elif event.is_action_pressed("weapon_bomb"):
		_switch_to("bomb")
	elif event.is_action_pressed("reload") and current and not event.is_echo():
		if current.kind == "revolver":
			_r_down = Game.clock       # tap: reload; held: one round and a spin (_process)
		else:
			current.try_reload()
	elif event.is_action_released("reload") and _r_down >= 0.0:
		_r_down = -1.0
		if current and current.kind == "revolver":
			current.try_reload()
	elif event.is_action_pressed("spawn_bot"):
		_spawn_bot()
	elif event.is_action_pressed("drop"):
		_drop_held()


## Alt held: the mouse moves the gun in the hands instead of turning the view
## (up/down/left/right, wheel = closer/further); with the right button also
## held it turns the gun instead (wheel = roll). Alt + middle button puts it
## back. The gun stays where it was left when Alt is let go.
func _free_input(event: InputEvent) -> bool:
	# A gun keeps its own offsets; a chainsaw or machete in hand has one each here.
	var w = current if current else _item_free(_item_kind)
	var turning := Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT)
	if event is InputEventMouseMotion:
		var rel: Vector2 = event.screen_relative
		if turning:
			w.free_rot.y -= rel.x * FREE_ROT_SENS
			w.free_rot.x -= rel.y * FREE_ROT_SENS
		else:
			w.free_pos.x += rel.x * FREE_MOVE_SENS
			w.free_pos.y -= rel.y * FREE_MOVE_SENS
		_clamp_free()
		return true
	if event is InputEventMouseButton and event.pressed:
		match event.button_index:
			MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN:
				var s := -1.0 if event.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0
				if turning:
					w.free_rot.z += s * 0.08
				else:
					w.free_pos.z += s * 0.02
				_clamp_free()
				return true
			MOUSE_BUTTON_MIDDLE:
				w.free_pos = Vector3.ZERO
				w.free_rot = Vector3.ZERO
				_clamp_free()
				return true
			MOUSE_BUTTON_RIGHT:
				return true
	return false


## Keeps a freely moved gun where real arms can hold it: within reach of the
## shoulders and out of the chest and the head.
func _clamp_free() -> void:
	if current == null:
		# A saw or blade held in the hands: turned any way, moved within reach.
		if _item_kind in FREE_ITEMS:
			var f: FreeHold = _item_free(_item_kind)
			f.free_rot = Vector3(wrapf(f.free_rot.x, -PI, PI), wrapf(f.free_rot.y, -PI, PI), wrapf(f.free_rot.z, -PI, PI))
			f.free_pos = f.free_pos.limit_length(0.3)
		return
	var w := current
	# Turning is not limited: the gun can be spun any way in the hands.
	w.free_rot = Vector3(wrapf(w.free_rot.x, -PI, PI), wrapf(w.free_rot.y, -PI, PI), wrapf(w.free_rot.z, -PI, PI))
	if _body.shoulder_r == Vector3.ZERO:
		return
	var cam_xf := cam.global_transform
	var p: Vector3 = cam_xf * (w.hip_pos + w.free_pos)
	# Reach: the right hand holds the grip.
	var sh: Vector3 = _body.shoulder_r
	var d := p - sh
	if d.length() > ARM_REACH:
		p = sh + d.normalized() * ARM_REACH
	# Not inside the chest...
	var a: Vector3 = _body.chest_a
	var ab: Vector3 = _body.chest_b - a
	var c := a + ab * clampf((p - a).dot(ab) / maxf(ab.length_squared(), 1e-4), 0.0, 1.0)
	var off := p - c
	if off.length() < 0.26:
		p = c + (off.normalized() if off.length() > 1e-3 else -cam.global_basis.z) * 0.26
	# ...nor the head.
	var head := cam_xf * Vector3(0, 0.02, 0.06)
	var hoff := p - head
	if hoff.length() < 0.17:
		p = head + (hoff.normalized() if hoff.length() > 1e-3 else -cam.global_basis.z) * 0.17
	w.free_pos = cam_xf.affine_inverse() * p - w.hip_pos


func _switch_to(k: String) -> void:
	if HELD_ITEM.has(k) and inventory and not inventory.has(HELD_ITEM[k]):
		_notify("Нет в рюкзаке: " + Items.def(HELD_ITEM[k])["name"])
		return
	# Not every frame: putting one thing away and getting another takes a moment.
	if Game.clock - _last_switch < SWITCH_DELAY and k != "hands":
		return
	_last_switch = Game.clock
	if _saw:
		_saw.clear()
	if _impaled:
		_unimpale()
	if _mach_cut:
		_mach_cut.clear()
	_saw_drag = 0.0
	if k != "hands":
		_bandage_t = -1.0          # stops bandaging to take something else
	# A grenade or the bomb: the guns go away, the right hand takes it.
	if k in ["grenade", "bomb", "cuffs", "chainsaw", "machete", "spraycan", "pipe_bomb", "mop", "sponge", "molotov"]:
		_item = k
		k = "hands"
	elif k != "hands" or _item != "":
		_item = ""
	if _smoking and _smoking.busy() and k != "hands":
		# Finish with the cigarette first: flick it away, then draw.
		_after_smoke = k
		_smoking.throw_now()
		return
	var target: Node3D = weapons.get(k)   # null for empty hands
	if target == current and _pending == "":
		return
	_pending = k
	if current:
		current.lower()


func is_armed() -> bool:
	return current != null


## G: a new person walks in where the player is looking. With `dummy` (radial
## menu "Манекен"): a person with no mind of their own who just stands there.
func _spawn_bot(dummy := false) -> void:
	var from := cam.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_basis.z * 40.0, Game.LAYER_WORLD | Game.LAYER_PROPS)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	var at: Vector3 = hit.position if not hit.is_empty() else from - cam.global_basis.z * 6.0
	var nav := get_world_3d().navigation_map
	var p := NavigationServer3D.map_get_closest_point(nav, at)
	if p.distance_to(at) > 3.0 or p.distance_to(global_position) < 1.2:
		return
	if Game.main:
		var bot: Node3D = Game.main.spawn_bot(p, atan2(p.x - global_position.x, p.z - global_position.z))   # face the player
		if dummy and bot.ai:
			bot.ai.process_mode = Node.PROCESS_MODE_DISABLED
			bot.move_velocity = Vector3.ZERO


func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["player._physics_process"] = Game.prof.get("player._physics_process", 0) + __d
	Game.prof["max player._physics_process"] = maxi(Game.prof.get("max player._physics_process", 0), __d)


func _physics_process_real(delta: float) -> void:
	if _ragdoll:
		# The body is the ragdoll now; the controller just follows it.
		global_position = _ragdoll.position_ground()
		velocity = Vector3.ZERO
		# The ragdoll hitting the ground hard hurts too.
		# _rag_vy keeps the fastest fall since the last stop; once the body has
		# stopped, that speed is the impact.
		var vy: float = _ragdoll.pelvis.linear_velocity.y
		_rag_vy = minf(_rag_vy, vy)
		if vy > -1.5:
			if _rag_vy < -7.5:
				vitals.fall(-_rag_vy)
			_rag_vy = 0.0
		if _rising and (_dead or not vitals.conscious):
			# Passed out or died on the way up: limp again.
			_rising = false
			if not _dead:
				_ragdoll.feign = true
		if _rising:
			_rise_t += delta
			if not _ragdoll.fallen or _rise_t > 9.0:
				_finish_get_up()
		return
	if not _climb.is_empty():
		_update_climb(delta)
		return
	if _seated(delta):
		return
	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	if _bandaging_leg():
		input = Vector2.ZERO          # down seeing to a leg: not going anywhere
	var yaw_basis := Basis(Vector3.UP, yaw)
	var wish := yaw_basis * Vector3(input.x, 0, input.y)
	var on_floor := is_on_floor()
	_update_crouch(delta)

	# Jump at something climbable (or keep jump held while in the air next to a
	# ledge): climb over it instead.
	if Game.is_mouse_captured() and vitals.leg > 0.4 and ((Input.is_action_just_pressed("jump") and on_floor) \
			or (not on_floor and Input.is_action_pressed("jump") and velocity.y < 2.0)):
		if _try_climb(input.y < -0.3, on_floor):
			return

	var sprinting := Input.is_action_pressed("sprint") and input.y < -0.3 and on_floor and _crouch < 0.2
	_sprint = move_toward(_sprint, 1.0 if sprinting else 0.0, delta * 4.0)
	var target_speed: float = lerpf(WALK_SPEED, SPRINT_SPEED, _sprint) * vitals.mobility() * lerpf(1.0, 0.45, _crouch)

	var hv := Vector3(velocity.x, 0, velocity.z)
	var accel := GROUND_ACCEL if on_floor else AIR_ACCEL
	hv = hv.lerp(wish * target_speed, 1.0 - exp(-accel * delta))

	var vy := velocity.y
	if not on_floor:
		vy -= GRAVITY * delta * (1.0 if vy > 0.0 else 1.3)
	elif Input.is_action_just_pressed("jump") and vitals.leg > 0.4 and _crouch < 0.5:
		vy = JUMP_VELOCITY
		_land_v += 0.6
		_kick_v -= 0.6
	velocity = Vector3(hv.x, vy, hv.z)

	var pre_pos := global_position
	_prev_vy = velocity.y
	# (a jump or a blast is as fast as the player ever goes up; being popped
	# out of an overlap is not a reason to go faster)
	if Game.clock > _blast_until:
		velocity.y = minf(velocity.y, JUMP_VELOCITY + 0.5)
		var hvel := Vector2(velocity.x, velocity.z).limit_length(SPRINT_SPEED * 2.5)
		velocity = Vector3(hvel.x, velocity.y, hvel.y)
	move_and_slide()
	if global_position.distance_to(pre_pos) > 1.5 and Game.clock > _blast_until:
		global_position = pre_pos       # thrown out of something: stays where he was
	if on_floor and is_on_wall() and hv.length() > 0.2:
		_try_step_up(hv * delta, pre_pos)

	_push_bodies()

	var landed := is_on_floor() and not _was_on_floor
	if landed and _prev_vy < -2.0:
		var impact := -_prev_vy
		_land_v -= impact * 0.35
		_kick_v += impact * 0.25
		vitals.fall(impact)
		if impact > 9.5 and not _ragdoll:
			_go_ragdoll()         # can't keep the feet: goes down in a heap
	# A long fall: arms and legs flail, the body tumbles.
	if not is_on_floor() and velocity.y < -2.0:
		_air_t += delta
		if _air_t > 0.9 and velocity.y < -8.0 and not _ragdoll:
			_go_ragdoll()
	else:
		_air_t = 0.0
	_was_on_floor = is_on_floor()

	# Footsteps follow the bob phase: one step every PI.
	var speed := Vector2(velocity.x, velocity.z).length()
	if is_on_floor() and speed > 0.3:
		var stride := lerpf(1.35, 1.9, _sprint)
		var prev := int(_bob_phase / PI)
		_bob_phase += speed / stride * PI * delta
		if int(_bob_phase / PI) != prev:
			_step_side = -_step_side
			if Game.bodycam:
				# The foot coming down jolts the chest: down, and a little to
				# that side.
				var hard := lerpf(1.0, 2.0, _sprint)
				_bc_pos_v += Vector3(_step_side * randf_range(0.03, 0.06), -randf_range(0.18, 0.26), 0.0) * hard * 0.4
			if _wet < 0.3:
				Game.play_3d(Sfx.get_stream(&"step"), global_position, -9.0 + _sprint * 3.0, 0.07, 2.0)
			if Game.blood:
				var fwd := -Basis(Vector3.UP, yaw).z
				Game.blood.footstep(global_position + Basis(Vector3.UP, yaw).x * 0.11 * _step_side, fwd, self)
	_bob_amount = move_toward(_bob_amount, clampf(speed / SPRINT_SPEED, 0.0, 1.0) if is_on_floor() else 0.0, delta * 4.0)

	_update_grab(delta)
	_update_wet(delta, speed)

	if roulette != null:
		return                     # the revolver is all there is (roulette.gd)
	if current == null and _smoking.busy() and Game.is_mouse_captured() and _fire_just():
		_smoking.drag_now()
	# Looking at a bomb's keypad: the left hand presses what the dot is on.
	_update_bomb_look()
	if _look_bomb and _press.is_empty() and Game.is_mouse_captured() and _fire_just() and _look_key >= 0:
		_press = {"bomb": _look_bomb, "key": _look_key, "t": 0.0, "done": false}
		return
	_update_item(delta)
	_update_cuffing(delta)
	_gesture_tick(delta)
	var trigger: bool = _fire_just() or (current != null and current.automatic and _fire_held())
	if current and Game.is_mouse_captured() and trigger and _held == null:
		var exclude: Array[RID] = [get_rid()]
		current.try_fire(cam, exclude)


func _try_step_up(motion: Vector3, _pre: Vector3) -> void:
	var xf := global_transform
	var up := Vector3.UP * STEP_HEIGHT
	if test_move(xf, up):
		return
	var fwd := motion.normalized() * maxf(motion.length(), 0.1)
	var raised := xf.translated(up)
	if test_move(raised, fwd):
		return
	var ahead := raised.translated(fwd)
	var col := KinematicCollision3D.new()
	if test_move(ahead, -up, col) and col.get_normal().y > 0.7:
		global_position = ahead.origin + col.get_travel()
		apply_floor_snap()


func _push_bodies() -> void:
	for i in get_slide_collision_count():
		var c := get_slide_collision(i)
		var rb := c.get_collider() as RigidBody3D
		if rb == null:
			continue
		var push := -c.get_normal()
		push.y = 0.0
		var strength := clampf(velocity.length() * 0.6, 0.0, 3.0) * minf(rb.mass, 20.0) * 0.05
		if not Net.push(rb, push * strength, c.get_position()):
			rb.apply_impulse(push * strength, c.get_position() - rb.global_position)
		if rb.has_meta("humanoid") and velocity.length() > 2.2:
			var bh = rb.get_meta("humanoid")
			if bh.ai and not bh.has_meta("puppet"):
				bh.ai.bumped(self)


func _on_fired(kick: float) -> void:
	_kick_v += kick * 3.2
	_kick_roll_v += randf_range(-1.0, 1.0) * kick * 2.5
	pitch = clampf(pitch + deg_to_rad(0.35 * kick), deg_to_rad(-88), deg_to_rad(88))
	yaw += deg_to_rad(randf_range(-0.12, 0.12) * kick)


func _process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["player._process"] = Game.prof.get("player._process", 0) + __d
	Game.prof["max player._process"] = maxi(Game.prof.get("max player._process", 0), __d)


func _process_real(delta: float) -> void:
	_time += delta
	# (a menu open blocks the fire button until it has been let go outside it)
	if not Game.is_mouse_captured() or _inv_ui.is_open or _radial.is_open or _craft_ui.is_open or _shop_ui.is_open or _dialog_ui.is_open or bench != null:
		_fire_blocked = true
	elif not Input.is_action_pressed("fire"):
		_fire_blocked = false
	_process_note(delta)
	_update_sleep(delta)
	if _r_down >= 0.0 and Game.clock - _r_down > 0.45:
		_r_down = -1.0
		if current and current.kind == "revolver":
			current.roulette_reload()
			_notify("Один патрон, барабан крутанул. Удачи.")
	if _bandage_t >= 0.0 and current == null and _pending == "":
		_bandage_t += delta
		_body.bandage = maxf(_body.bandage, clampf((_bandage_t - 0.6) / (BANDAGE_TIME - 1.2), 0.0, 1.0))
		if _bandage_t >= BANDAGE_TIME:
			_bandage_t = -1.0
			vitals.bandage(_bandage_w)
			_bandage_w = {}
			_body.bandage = 0.0
	# Weapon switching once the current gun is lowered.
	if _pending != "" and (current == null or current.is_holstered()):
		current = weapons.get(_pending)
		_pending = ""
		if current:
			current.raise()

	# Springs for landing dip, recoil kick and roll.
	_land_v += (-_land * 90.0 - _land_v * 11.0) * delta
	_land += _land_v * delta
	_kick_v += (-_kick * 160.0 - _kick_v * 16.0) * delta
	_kick += _kick_v * delta
	_kick_roll_v += (-_kick_roll * 140.0 - _kick_roll_v * 14.0) * delta
	_kick_roll += _kick_roll_v * delta

	var local_v := Basis(Vector3.UP, yaw).inverse() * velocity
	_strafe_roll = lerpf(_strafe_roll, clampf(-local_v.x * 0.006, -0.03, 0.03), minf(delta * 6.0, 1.0))
	_turn_roll = lerpf(_turn_roll, clampf(-_look_delta.x * 0.0009, -0.05, 0.05), minf(delta * 8.0, 1.0))

	var amp := _bob_amount * lerpf(1.0, 1.7, _sprint)
	var bob := Vector2(cos(_bob_phase) * 0.018 * amp, -absf(sin(_bob_phase)) * 0.028 * amp)
	var breathe := sin(_time * 1.6) * 0.004

	var base := get_global_transform_interpolated().origin
	if not _climb.is_empty():
		_cam_y = base.y              # the climb's path is smooth already: no lag to catch up
	elif absf(base.y - _cam_y) > 0.7:
		_cam_y = base.y
	else:
		_cam_y = lerpf(_cam_y, base.y, 1.0 - exp(-delta * 22.0))

	var cam_pitch := pitch + _kick * 0.05 + breathe + clampf(velocity.y * -0.004, -0.03, 0.03) + _climb_view.x - float(_smoking.look_down)
	# Seeing to a leg: the eyes go down to it for the while.
	if _bandaging_leg():
		var look := smoothstep(0.0, 0.6, _bandage_t) * (1.0 - smoothstep(BANDAGE_TIME - 0.5, BANDAGE_TIME, _bandage_t))
		cam_pitch = lerpf(cam_pitch, -1.05, look)
	var cam_roll := _strafe_roll + _turn_roll + _kick_roll * 0.03 + bob.x * 0.5 + _climb_view.y
	# High: the view drifts and sways slowly.
	cam_pitch += sin(_time * 0.37) * 0.018 * Game.high
	cam_roll += sin(_time * 0.51) * 0.035 * Game.high
	var view_yaw := yaw
	var eye_off := Vector3.ZERO
	if Game.bodycam and not _ragdoll:
		# A camera clipped to the chest (after Unrecord): it is the body that
		# turns it, and the body comes round a moment after the eyes and a
		# little past; every step rocks the chest from side to side and jolts
		# it; the clip itself shivers. Lower than the eyes and in front of the
		# chest.
		var w := TAU * 3.0
		var zeta := 0.6
		var want_p := cam_pitch * 0.85
		# (it turns with the body at once: no lag, no swinging past)
		_bc_rot = Vector3(want_p, yaw, 0.0)
		_bc_rot_v = Vector3.ZERO
		# Footfall jolts (kicked in _physics_process), damped fast.
		_bc_pos_v += (-_bc_pos * 300.0 - _bc_pos_v * 22.0) * delta
		_bc_pos += _bc_pos_v * delta
		# (kept gentle: the chest rocks, it does not swing)
		var sway := _bob_amount * lerpf(1.0, 1.8, _sprint) * 0.35
		var side := sin(_bob_phase)              # left step, right step
		var bounce := absf(cos(_bob_phase))
		var n1 := sin(_time * 5.3) * sin(_time * 3.1 + 1.0)
		var n2 := sin(_time * 4.1 + 2.0) * sin(_time * 6.7)
		view_yaw = _bc_rot.y + side * 0.018 * sway + n2 * 0.002
		cam_pitch = _bc_rot.x - (bounce - 0.64) * 0.03 * sway + _bc_pos.y * 0.25 + n1 * 0.002
		cam_roll = cam_roll * 0.5 + side * 0.04 * sway + _bc_pos.x * 0.3 + n2 * 0.003
		eye_off = Basis(Vector3.UP, view_yaw) * Vector3(side * 0.02 * sway, -0.3 + _bc_pos.y * 0.04, -0.17)
	else:
		_bc_rot = Vector3(cam_pitch, yaw, 0.0)
		_bc_rot_v = Vector3.ZERO
	var b := Basis.from_euler(Vector3(cam_pitch, view_yaw, cam_roll))
	var right := Basis(Vector3.UP, yaw).x
	var eye := Vector3(base.x, _cam_y + eye_height() + bob.y + _land * 0.08, base.z) + right * bob.x + eye_off
	cam.global_transform = Transform3D(b, eye)
	if _ragdoll:
		# Seeing through the ragdoll's eyes as it falls and tumbles. The neck
		# does most of the looking around (physically, see humanoid.head_look),
		# the eyes the rest.
		if not vitals.conscious or _dead:
			_rag_look = _rag_look.lerp(Vector2.ZERO, minf(delta * 1.5, 1.0))
		_ragdoll.head_look = _rag_look * 0.75
		var hx: Transform3D = _ragdoll.head.get_global_transform_interpolated()
		var eyes := Basis.from_euler(Vector3(_rag_look.y * 0.25, _rag_look.x * 0.25, 0.0))
		cam.global_transform = Transform3D(hx.basis.orthonormalized() * eyes, hx * Vector3(0, 0.03, -0.09))
	else:
		_update_body()
	if _hand:
		_hand.set_dot(not _ragdoll and not _dead and not _inv_ui.is_open and not _craft_ui.is_open and not _radial.is_open
				and roulette == null and (current == null or current.aim < 0.5))
	# Right mouse: aim down the sights (not while Alt has the gun in free hands).
	var aiming: bool = current != null and Game.is_mouse_captured() and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT) 			and not Input.is_action_pressed("free_aim") and _sprint < 0.3 and not _radial.is_open
	for w in weapons.values():
		w.aim_target = 1.0 if aiming and w == current else 0.0
	var aim_k: float = current.aim if current else 0.0
	if _cam_blend > 0.0:
		_cam_blend = maxf(_cam_blend - delta / _cam_blend_time, 0.0)
		var k := smoothstep(0.0, 1.0, 1.0 - _cam_blend)
		var target := cam.global_transform
		var q := _cam_from.basis.get_rotation_quaternion().slerp(target.basis.get_rotation_quaternion(), k)
		cam.global_transform = Transform3D(Basis(q), _cam_from.origin.lerp(target.origin, k))
	var fov0 := 94.0 if Game.bodycam else BASE_FOV      # (a body camera sees wide)
	cam.fov = lerpf(cam.fov, fov0 + _sprint * 5.0 - aim_k * (8.0 if Game.bodycam else 16.0) + cine_fov, minf(delta * 10.0, 1.0))
	if cine_k > 0.001 and not _ragdoll:
		var own := cam.global_transform
		var q := own.basis.get_rotation_quaternion().slerp(cine_xf.basis.get_rotation_quaternion(), cine_k)
		cam.global_transform = Transform3D(Basis(q), own.origin.lerp(cine_xf.origin, cine_k))
	var view := Vector2(yaw + _turn_roll, cam_pitch)
	if _post:
		var vp := get_viewport().get_visible_rect().size
		_post.set_motion(view.x - _prev_view.x, view.y - _prev_view.y, cam.fov, vp.x / maxf(vp.y, 1.0))
	_prev_view = view
	if _post:
		_post.set_high(Game.high, _time, Game.hallu_jolt)
		_hurt = move_toward(_hurt, 0.0, delta * 0.8)
		_daze = maxf(_daze - delta * 0.35, 0.0)
		_post.set_hurt(_hurt)
		if _static != _static_target:
			# (the feed is there or it is not: no fading in and out)
			_static = _static_target
			_post.set_static(_static)
		if _dead:
			_dead_t += delta
			_black = 1.0 if _dead_t >= 0.06 and not Game.bodycam else _black
			if _dead_t > 4.0:
				Game.reset()
				get_tree().reload_current_scene()
		else:
			# (passing out: gone in a moment, coming to: slowly)
			_black = move_toward(_black, 0.0 if vitals.conscious else 0.93, delta * (0.7 if vitals.conscious else 4.0))
		_post.set_vitals(clampf((vitals.loss() - 0.08) / 0.35, 0.0, 1.0), _black)

	if current and current.is_free():
		_clamp_free()
	for w in weapons.values():
		if w.visible:
			w.update(delta, {
				"look_delta": _look_delta,
				"bob": bob,
				"sprint": _sprint,
				"air": velocity.y if not is_on_floor() else _land * 3.0,
				"cam": cam,
				"chest_a": _body.chest_a,
				"chest_b": _body.chest_b,
			})
	_look_delta = Vector2.ZERO


func _loop_player(sound: StringName) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	var s := Sfx.get_stream(sound)
	if s is AudioStreamOggVorbis:
		(s as AudioStreamOggVorbis).loop = true
	p.stream = s
	p.bus = &"World"
	p.volume_linear = 0.0
	add_child(p)
	return p


# --- Grabbing ------------------------------------------------------------------

func _grab_ray() -> Dictionary:
	var from := cam.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_basis.z * GRAB_REACH,
			Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_DEBRIS)
	var ex: Array[RID] = [get_rid()]
	q.exclude = ex
	return get_world_3d().direct_space_state.intersect_ray(q)


func _grabbable(body: Object) -> bool:
	if not body is RigidBody3D or (body as RigidBody3D).mass > GRAB_MAX_MASS:
		return false
	# (a body held still - squatting - is let go as soon as it is taken hold of)
	return not (body as RigidBody3D).freeze or (body as Node).has_meta("humanoid") or (body as Node).has_meta("net_held")


## Hold E: the grabbed point is pulled towards a spot in front of the camera by
## a force-limited spring, so light things follow the hand and heavy things
## (a body) get dragged. Release E to let go.
func _update_grab(delta: float) -> void:
	_aim_body = null
	if Input.is_action_just_pressed("grab") and _held == null:
		if _escort:
			_set_escort(null)
			return
		var h := _look_humanoid(2.4)
		# A cuffed man on his feet is led; one lying down is dragged like
		# anyone else.
		if h and h.cuffed and h.alive and not h.fallen:
			_set_escort(h)
			return
	if _escort and not is_instance_valid(_escort):
		_escort = null
	if _held == null:
		var hit := _grab_ray()
		if not hit.is_empty() and _grabbable(hit.collider):
			_aim_body = hit.collider
			if Input.is_action_just_pressed("grab"):
				_held = _aim_body
				if _held.has_meta("humanoid"):
					_held.get_meta("humanoid").wake()
				_held_local = _held.to_local(hit.position)
				_held_dist = clampf(cam.global_position.distance_to(hit.position), 0.7, GRAB_REACH)
				_held.sleeping = false
	elif not Input.is_action_pressed("grab") or not is_instance_valid(_held):
		_held = null
	else:
		var target := cam.global_position - cam.global_basis.z * _held_dist
		var point := _held.to_global(_held_local)
		var offset := point - _held.global_position
		var point_vel := _held.linear_velocity + _held.angular_velocity.cross(offset)
		var err := target - point
		if err.length() > 1.6:
			_held = null   # snagged on something, the grip slips
		else:
			var m := minf(_held.mass, 20.0)
			var f := (err * 260.0 - (point_vel - velocity) * 26.0) * m
			f += Vector3.UP * _held.mass * 9.81 * clampf(1.0 - _held.mass / GRAB_MAX_MASS, 0.0, 1.0)
			if not Net.push(_held, f.limit_length(GRAB_MAX_FORCE) * delta, point):
				_held.apply_force(f.limit_length(GRAB_MAX_FORCE), offset)
			_held.angular_velocity *= 1.0 - minf(delta * 3.0, 0.5)
	if _hand:
		_hand.set_mode(HandIcon.Mode.CLOSED if _held else (HandIcon.Mode.OPEN if _aim_body else HandIcon.Mode.HIDDEN))


# --- Wet footsteps ------------------------------------------------------------------

func _update_wet(delta: float, speed: float) -> void:
	var on_water := false
	if is_on_floor():
		var p := global_position
		for spot in Game.water_spots:
			var c: Vector3 = spot[0]
			if absf(c.y - p.y) < 0.35 and Vector2(c.x - p.x, c.z - p.z).length() < spot[1]:
				on_water = true
				break
		if not on_water and Game.blood and Game.blood.is_pool(p):
			on_water = true
	_wet = move_toward(_wet, 1.0 if on_water else 0.0, delta * 5.0)
	var moving := clampf(speed / WALK_SPEED, 0.0, 1.0) if is_on_floor() else 0.0
	_fade_loop(_splash_walk, _wet * moving * (1.0 - _sprint) * 0.8, delta)
	_fade_loop(_splash_run, _wet * moving * _sprint * 0.8, delta)


## Smoothly fades a looping recording in and out, pausing it when silent.
func _fade_loop(p: AudioStreamPlayer, target: float, delta: float) -> void:
	if p.stream == null:
		return
	p.volume_linear = move_toward(p.volume_linear, target, delta * 2.5)
	if p.volume_linear > 0.001:
		if not p.playing and not p.stream_paused:
			p.play(randf() * 20.0)
		p.stream_paused = false
	else:
		p.stream_paused = true

func _on_smoke_done() -> void:
	if _after_smoke != "":
		var k := _after_smoke
		_after_smoke = ""
		_switch_to(k)

## Puts a real, physical gun into the world in front of the player (anyone can
## pick it up).
func _drop_gun(what: String) -> void:
	var from := cam.global_position
	var fwd := -cam.global_basis.z
	var q := PhysicsRayQueryParameters3D.create(from, from + fwd * 1.3, Game.LAYER_WORLD | Game.LAYER_PROPS)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	var at: Vector3 = (hit.position - fwd * 0.25) if not hit.is_empty() else from + fwd * 1.1
	var xf := Transform3D(Basis(Vector3.UP, yaw + randf_range(-0.5, 0.5)), at + Vector3.DOWN * 0.3)
	Net.spawn_drop(get_parent(), true, what, 1, xf, velocity + fwd * 1.5 + Vector3.UP * 0.5)


var _hurt := 0.0


## Where a bullet along origin + dir * t really hits the body, if at all. The
## movement capsule is wider than a person, so bullets that reach it are
## checked against the actual volumes: the head (where the camera is), the
## neck, the torso (turned and leaning like the drawn body) and the legs.
## Returns {} for a miss, else {"point", "region"}.
func hitbox_test(origin: Vector3, dir: Vector3) -> Dictionary:
	var eye := cam.global_transform
	var feet := global_position
	var fwd := -Basis(Vector3.UP, yaw).z
	var best_t := INF
	var best := ""
	var shapes := [
		["head", eye * Vector3(0, 0.02, 0.06), eye * Vector3(0, 0.05, 0.06), 0.105],
		["head", eye * Vector3(0, -0.1, 0.07), eye * Vector3(0, -0.18, 0.08), 0.06],
		["chest", _body.chest_a.lerp(_body.chest_b, 0.45) if _body.chest_a != Vector3.ZERO else feet + Vector3.UP * 1.15, _body.chest_b if _body.chest_b != Vector3.ZERO else feet + Vector3.UP * 1.4, 0.19],
		["belly", feet + Vector3.UP * 0.82 + fwd * -0.08, _body.chest_a.lerp(_body.chest_b, 0.45) if _body.chest_a != Vector3.ZERO else feet + Vector3.UP * 1.15, 0.17],
		["leg", feet + Vector3.UP * 0.08, feet + Vector3.UP * 0.8, 0.17],
	]
	for sh in shapes:
		var t := _ray_capsule(origin, dir, sh[1], sh[2], sh[3])
		if t < best_t:
			best_t = t
			best = sh[0]
	if best == "":
		return {}
	return {"point": origin + dir * best_t, "region": best}


## Distance along the ray to a capsule a-b of radius r (INF for a miss).
func _ray_capsule(o: Vector3, d: Vector3, a: Vector3, b: Vector3, r: float) -> float:
	var best := INF
	# Sample the segment finely; the capsule is short compared to a bullet path.
	for i in 9:
		var c := a.lerp(b, i / 8.0)
		var oc := o - c
		var bq := oc.dot(d)
		var cq := oc.length_squared() - r * r
		var disc := bq * bq - cq
		if disc >= 0.0:
			var t := -bq - sqrt(disc)
			if t > 0.0 and t < best:
				best = t
	return best


## Shakes the view (explosions nearby).
func shake(amount: float) -> void:
	_kick_v += amount * 2.5
	_kick_roll_v += randf_range(-1.0, 1.0) * amount * 5.0
	_hurt = minf(_hurt + amount * 0.1, 1.0)


## Caught in a blast `d` metres away: wounds, knocked off the feet up close,
## killed right next to it.
func blast(origin: Vector3, power: float, d: float) -> void:
	var k := power / maxf(d * d, 0.25)
	if k < 0.05:
		return
	var dir := (global_position + Vector3.UP - origin).normalized()
	shake(minf(k * 4.0, 3.0))
	for i in int(clampf(k * 3.0, 0.0, 6.0)):
		vitals.hurt(global_position + Vector3.UP * randf_range(0.3, 1.5), dir, "frag", ["chest", "belly", "leg", "leg"][randi() % 4])
	if k > 0.7:
		vitals._die()
		return
	if k > 0.3 and not _ragdoll:
		_go_ragdoll()
		if _ragdoll:
			for part in _ragdoll.parts:
				part.apply_central_impulse((dir * minf(k * 30.0, 60.0) + Vector3.UP * minf(k * 10.0, 20.0)) * part.mass / 5.0)
	else:
		velocity += dir * minf(k * 6.0, 8.0)
		_blast_until = Game.clock + 1.2


## A fist: the head snaps back, it hurts, the view swims; enough of them to
## the head in a short while and the player goes down.
var _daze := 0.0


func punched(point: Vector3, dir: Vector3, region: String) -> void:
	if _dead:
		return
	vitals.pain = minf(vitals.pain + (0.25 if region == "head" else 0.15), 2.0)
	_hurt = minf(_hurt + 0.35, 1.0)
	_kick_v += 3.0 if region == "head" else 1.5
	_kick_roll_v += randf_range(-1.0, 1.0) * 7.0
	yaw += randf_range(-0.06, 0.06)
	velocity += Vector3(dir.x, 0.0, dir.z).normalized() * 1.8
	Game.play_3d(Sfx.get_stream(&"impact"), point, -2.0, 0.15, 2.0)
	if region == "head":
		_daze += 1.0
		if _daze > 5.0 and not _ragdoll:
			_daze = 0.0
			_notify("Вырубили...")
			_go_ragdoll()
			get_tree().create_timer(4.0).timeout.connect(_get_up)


## Hit by a bot's bullet: a hard jolt, pain sound and red at the edges.
## Standing in fire: it hurts, and it burns.
func burn(dt: float) -> void:
	vitals.pain = minf(vitals.pain + dt * 0.8, 2.0)
	vitals.blood = maxf(vitals.blood - dt * 60.0, 0.0)
	_hurt = minf(_hurt + dt * 1.5, 1.0)
	if randf() < dt * 2.0:
		Game.play_3d(Sfx.get_stream(&"flesh"), global_position + Vector3.UP * 1.0, -10.0, 0.2, 2.0)


func hurt(point: Vector3, dir: Vector3, weapon := "pistol", region := "") -> void:
	vitals.hurt(point, dir, weapon, region)
	_hurt = minf(_hurt + 0.7, 1.0)
	_kick_v += 4.0
	_kick_roll_v += randf_range(-1.0, 1.0) * 6.0
	yaw += randf_range(-0.03, 0.03)
	velocity += dir * 1.5
	Game.play_3d(Sfx.get_stream(&"flesh"), global_position + Vector3.UP * 1.3, -2.0, 0.1, 2.0)

# --- Body, ragdoll, death ------------------------------------------------------------

func _update_body() -> void:
	var hands := [Vector3.INF, Vector3.INF]
	var dirs := [Vector3.ZERO, Vector3.ZERO]
	if current and current.visible and current.model:
		var m: Node3D = current.model
		if current.kind == "pistol" or current.kind == "revolver":
			hands[0] = m.global_transform * Vector3(0.0, -0.06, 0.035)
			hands[1] = m.global_transform * Vector3(-0.03, -0.07, 0.025)
		elif current.kind == "akm":
			hands[0] = m.global_transform * Vector3(0.0, -0.06, 0.04)
			hands[1] = m.global_transform * Vector3(0.0, -0.02, -0.32)
		else:
			hands[0] = m.global_transform * Vector3(0.0, -0.035, 0.07)
			var pump := m.get_node_or_null("Pump") as Node3D
			hands[1] = (pump.global_transform if pump else m.global_transform) * Vector3(0.0, -0.014, -0.3)
		dirs[0] = -m.global_basis.y
		dirs[1] = -m.global_basis.y
		# Reloading: the left hand goes to the belt and back (see weapon.reload_hand).
		current.pocket = get_global_transform_interpolated() * Vector3.ZERO + Basis(Vector3.UP, yaw) * Vector3(-0.17, 0.98, -0.1)
		var rh: Vector3 = current.reload_hand(hands[1])
		if rh != Vector3.INF:
			hands[1] = rh
			dirs[1] = Vector3.ZERO
	var smoking_hand: bool = _smoking.busy() and _smoking.visible
	if smoking_hand and current == null:
		# The smoking hand is drawn by smoking.gd; the sleeve ends at its wrist.
		var rh: Transform3D = _smoking._rhand.global_transform
		hands[0] = rh * Vector3(-0.01, -0.12, 0.0)
		dirs[0] = rh.basis.y
	if _flash.visible:
		hands[1] = _flash.grip()
		dirs[1] = -_flash.global_basis.y
	if not _press.is_empty():
		# Left hand out to the key and back.
		var pt: Vector3 = _press["point"] if _press.has("point") else Vector3.INF
		if pt != Vector3.INF:
			var rest := cam.global_transform * Vector3(-0.2, -0.45, -0.2)
			var w: float = smoothstep(0.0, 0.16, _press["t"]) * (1.0 - smoothstep(0.26, 0.45, _press["t"]))
			hands[1] = rest.lerp(pt, w)
			dirs[1] = (pt - cam.global_position).normalized()
	if _item_model and _item_model.visible and current == null and not smoking_hand:
		if _item_kind == "chainsaw" or _item_kind == "mop":
			hands[0] = _item_model.grip_right()
			hands[1] = _item_model.grip_left()
		elif _item_kind == "machete":
			hands[0] = _item_model.grip()
		else:
			hands[0] = _item_model.global_transform * Vector3(0.0, -0.02, 0.03)
	if roulette != null:
		var rh: Vector3 = roulette.player_hand()
		if rh != Vector3.INF:
			hands[0] = rh
			dirs[0] = Vector3.ZERO
		var lh: Vector3 = roulette.player_left_hand()
		if lh != Vector3.INF:
			hands[1] = lh
			dirs[1] = Vector3.ZERO
	_gesture_arm(hands, dirs)
	_body.bandage_hand = Vector3.INF
	_body.wounds = vitals.wounds
	if _bandage_t >= 0.0 and current == null and _body.pts.has("wrist_l"):
		var t := _bandage_t
		var cx := cam.global_transform
		var up_k := smoothstep(0.0, 0.5, t) * (1.0 - smoothstep(BANDAGE_TIME - 0.4, BANDAGE_TIME, t))
		var ang := t * TAU * 1.7
		var wd: Dictionary = _bandage_w
		var seg: String = wd.get("seg", "")
		var along := clampf((t - 0.6) / (BANDAGE_TIME - 1.2), 0.0, 1.0)
		if seg in ["thigh", "shin", "upper_arm", "forearm"] and _body.LIMB.has(seg):
			# Round the hurt limb, over the wound, a few turns up and down it.
			var l: Array = _body.LIMB[seg]
			var sd: String = wd["side"]
			var a: Vector3 = _body.pts[l[0] + sd]
			var b: Vector3 = _body.pts[l[1] + sd]
			var tc: float = wd["t"]
			var t0 := clampf(tc - 0.14, 0.02, 0.8)
			var centre := a.lerp(b, t0 + 0.28 * along)
			var axis := (b - a).normalized()
			var u := axis.cross(Vector3.UP)
			u = u.normalized() if u.length() > 0.01 else axis.cross(Vector3.FORWARD).normalized()
			var v := axis.cross(u)
			var r: float = float(l[2]) + 0.05
			var round_r := centre + (u * cos(ang) + v * sin(ang)) * r
			var round_l := centre + (u * cos(ang + PI) + v * sin(ang + PI)) * r
			var rest_r := cx * Vector3(0.2, -0.45, -0.2)
			var rest_l := cx * Vector3(-0.2, -0.45, -0.2)
			if seg in ["thigh", "shin"]:
				# Both hands down at the leg, passing the roll round it.
				hands[0] = rest_r.lerp(round_r, up_k)
				hands[1] = rest_l.lerp(round_l, up_k)
				dirs[0] = axis
				dirs[1] = axis
			else:
				# The hurt arm held up in front, the other hand winds.
				var held := 0 if sd == "r" else 1
				var free := 1 - held
				hands[held] = (rest_r if held == 0 else rest_l).lerp(cx * Vector3(0.05 * (1.0 if held == 0 else -1.0), -0.2, -0.38), up_k)
				dirs[held] = cx.basis.x
				hands[free] = (rest_r if free == 0 else rest_l).lerp(round_r, up_k)
				dirs[free] = axis
			_body.bandage_on = [l[0] + sd, l[1] + sd, t0, 0.28]
			if t > 0.6 and t < BANDAGE_TIME - 0.5:
				_body.bandage_hand = hands[0] if seg in ["thigh", "shin"] or sd == "l" else hands[1]
		elif seg == "torso":
			# A pad pressed on and taped: both hands on it.
			var f: Array = _body.wound_frame(wd)
			if not f.is_empty():
				var p: Vector3 = f[0]
				var n: Vector3 = f[1]
				hands[0] = (cx * Vector3(0.2, -0.45, -0.2)).lerp(p + n * 0.05 + Vector3(sin(ang) * 0.03, cos(ang) * 0.03, 0.0), up_k)
				hands[1] = (cx * Vector3(-0.2, -0.45, -0.2)).lerp(p + n * 0.05 + Vector3(-0.05, 0.02, 0.0), up_k)
			_body.bandage_on = []
		else:
			# Nothing in particular: the left forearm, as a first aid wrap.
			var rest_l := cx * Vector3(-0.2, -0.45, -0.2)
			hands[1] = rest_l.lerp(cx * Vector3(0.0, -0.2, -0.38), up_k)
			dirs[1] = cx.basis.x
			var w: Vector3 = _body.pts["wrist_l"]
			var e: Vector3 = _body.pts["elbow_l"]
			var axis := (e - w).normalized()
			var u := axis.cross(Vector3.UP)
			u = u.normalized() if u.length() > 0.01 else axis.cross(Vector3.FORWARD).normalized()
			var v := axis.cross(u)
			var centre := w.lerp(e, 0.08 + 0.78 * along)
			var round_pt := centre + (u * cos(ang) + v * sin(ang)) * 0.085
			hands[0] = (cx * Vector3(0.2, -0.45, -0.2)).lerp(round_pt, up_k)
			dirs[0] = axis
			_body.bandage_on = ["wrist_l", "elbow_l", 0.05, 0.8]
			if t > 0.6 and t < BANDAGE_TIME - 0.5:
				_body.bandage_hand = hands[0]
	else:
		_body.bandage_on = []
	# Blood running out of the wounds drips off onto the ground.
	_drip_wounds()
	var feet_t: Array = []
	if not _climb.is_empty():
		# Hands on the ledge while pulling up, legs stepping and tucking over.
		var limbs := _climb_limbs()
		for i in 2:
			if limbs[0][i] != Vector3.INF:
				hands[i] = limbs[0][i]
				dirs[i] = Vector3.ZERO
		feet_t = limbs[1]
	if _held:
		hands[1 if hands[0] != Vector3.INF else 0] = _held.to_global(_held_local)
	# The body hangs from the head: placed under the camera, so it moves as one
	# piece with the view (jumps, landing dips) and the neck keeps its length.
	var origin := get_global_transform_interpolated().origin
	origin.y = clampf(cam.global_position.y - eye_height(), origin.y - 0.3, origin.y + 0.3)
	var root := Transform3D(Basis(Vector3.UP, yaw), origin)
	var flat := Vector3(velocity.x, 0, velocity.z)
	var stride := clampf(flat.length() / WALK_SPEED, 0.0, 1.4) if is_on_floor() else 0.3
	var move_dir := flat.normalized() if flat.length() > 0.1 else Vector3.ZERO
	_body.update(root, _bob_phase, stride, move_dir, hands, dirs,
			cam.global_transform, get_process_delta_time(), smoking_hand and current == null, _crouch, feet_t)
	_net_body = [root, _bob_phase, stride, move_dir, hands, dirs, cam.global_transform, _crouch]


## How the body stands this frame, for the other players (net.gd, remote_player.gd):
## the numbers the first-person body is drawn from, or lying down, where each
## part of the ragdoll is.
var _net_body: Array = []


func net_state() -> PackedFloat32Array:
	var out := PackedFloat32Array()
	if _net_body.is_empty():
		return out
	var root: Transform3D = _net_body[0]
	var hands: Array = _net_body[4]
	var dirs: Array = _net_body[5]
	var view: Transform3D = _net_body[6]
	var md: Vector3 = _net_body[3]
	var q := view.basis.get_rotation_quaternion()
	var wk := 0
	if current:
		wk = ["", "pistol", "shotgun", "akm", "revolver", "sawnoff", "crossbow", "nailgun", "flaregun", "rifle"].find(current.kind)
	out.append_array([root.origin.x, root.origin.y, root.origin.z, yaw, _net_body[1], _net_body[2], md.x, md.y, md.z])
	for v in [hands[0], hands[1], dirs[0], dirs[1]]:
		var vv: Vector3 = v
		out.append_array([vv.x, vv.y, vv.z])
	out.append_array([q.x, q.y, q.z, q.w, view.origin.x, view.origin.y, view.origin.z, _net_body[7], float(maxi(wk, 0))])
	out.append(1.0 if _ragdoll else 0.0)
	if _ragdoll:
		out.append(float(_ragdoll.parts.size()))
		for p in _ragdoll.parts:
			var xf: Transform3D = p.global_transform
			var pq := xf.basis.get_rotation_quaternion()
			out.append_array([xf.origin.x, xf.origin.y, xf.origin.z, pq.x, pq.y, pq.z, pq.w])
	return out


## Q (or passing out, or dying): the body goes limp as a full physical ragdoll
## and the view follows its head.
func _go_ragdoll() -> void:
	if _ragdoll:
		return
	_start_cam_blend(0.25)
	var h := Humanoid.new()
	h.name = "PlayerRagdoll"
	h.bot_seed = 4242
	get_parent().add_child(h)
	h.spawn(global_position, yaw, self)
	h.feign = true
	# Falls from the pose the body is in right now, moving as it was moving.
	if not _body.pts.is_empty():
		h.match_pose(_body.pts, velocity)
	else:
		for part in h.parts:
			part.linear_velocity = velocity
	_rag_look = Vector2.ZERO
	_rising = false
	_rag_vy = velocity.y
	_air_t = 0.0
	_ragdoll = h
	_shape.disabled = true
	_body.visible = false
	_hand.set_mode(0)
	_weapon_before = current.kind if current else ""
	if _smoking.busy():
		_smoking.throw_now()
	for w in weapons.values():
		w.visible = false
		w.state = 3
	current = null
	_held = null


## Getting up the way the bots do: roll over, knees, one knee, stand (see
## humanoid._pose_getup), seen through the body's own eyes. Control comes back
## once it is standing.
func _get_up() -> void:
	if not _ragdoll or _dead or not vitals.conscious or _rising:
		return
	_rising = true
	_rise_t = 0.0
	var r := _ragdoll
	r.feign = false
	r._held.clear()
	r.move_velocity = Vector3.ZERO
	var f: Vector3 = -r.chest.global_basis.z
	f.y = 0.0
	r.facing = f.normalized() if f.length() > 0.1 else -Basis(Vector3.UP, yaw).z
	r.fallen = true
	r._getup_delay = 0.0
	r._fallen_time = 10.0


func _finish_get_up() -> void:
	_rising = false
	_start_cam_blend(0.45)
	var r := _ragdoll
	# Stand on whatever floor is under the body (never below it).
	var from: Vector3 = r.pelvis.global_position + Vector3.UP * 0.4
	var q := PhysicsRayQueryParameters3D.create(from, from + Vector3.DOWN * 3.0, Game.LAYER_WORLD | Game.LAYER_PROPS)
	q.exclude = r._ray_exclude
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	var ground_y: float = hit.position.y if not hit.is_empty() else r.position_ground().y
	global_position = Vector3(from.x, ground_y + 0.03, from.z)
	var fwd: Vector3 = -r.chest.global_basis.z
	fwd.y = 0.0
	if fwd.length() > 0.1:
		yaw = atan2(-fwd.x, -fwd.z)
	pitch = 0.0
	_cam_y = global_position.y
	_ragdoll.queue_free()
	_ragdoll = null
	_shape.disabled = false
	_body.visible = true
	velocity = Vector3.ZERO
	if _weapon_before != "":
		_pending = _weapon_before
	_weapon_before = ""


func _on_died() -> void:
	_dead = true
	_dead_t = 0.0
	# Gone almost at once: the last sound (the shot) just heard, then black
	# and silence.
	get_tree().create_timer(0.06, true, false, true).timeout.connect(_lights_out)
	_go_ragdoll()
	if _ragdoll:
		_ragdoll.feign = false
		_ragdoll._die("bleed_out")


# --- Crouching -------------------------------------------------------------------------

func eye_height() -> float:
	if not _sleep.is_empty():
		return 0.7                  # lying on the bed
	if seat_at != Vector3.INF:
		return seat_eye             # sat on a chair (or on the way down / up)
	return lerpf(EYE_HEIGHT, CROUCH_EYE, _crouch)


## Sat on a chair (at the roulette table): held there; moving gets up.
var seat_at := Vector3.INF
var seat_eye := 1.18               # eye height while sat (moved while sitting down / getting up)
var cine_busy := false             # a scripted move (sitting down, getting up): no getting up by hand
## The camera steered for a moment (roulette.gd): blended over the player's
## own view by cine_k, its field of view changed by cine_fov.
var cine_xf := Transform3D()
var cine_k := 0.0
var cine_fov := 0.0
var _seat_rise_t := -1.0
var _rise_from := Vector3.ZERO
var _rise_to := Vector3.ZERO
var _rise_yaw := 0.0
var _seat_stand := Vector3.INF     # where one gets up to (in front of the chair)


## F on a chair or the sofa: sit down on it, facing the way it faces (on the
## sofa, on the place nearest where one looked).
func _sit_on(n: Node, at: Vector3) -> void:
	var info: Dictionary = n.get_meta("seat")
	if n.has_meta("seats"):
		var best := INF
		for s in n.get_meta("seats"):
			var d: float = (s["pos"] as Vector3).distance_to(at)
			if d < best:
				best = d
				info = s
	if info.is_empty():
		return
	for b in Game.bots:
		if is_instance_valid(b) and b.seat != Vector3.INF and (b.seat as Vector3).distance_to(info["seat"]) < 0.3:
			_notify("Занято")
			return
	_start_cam_blend(0.35)
	seat_at = info["pos"]
	_seat_stand = info["stand"]
	var f := Basis(Vector3.UP, float(info["yaw"])) * Vector3(0, 0, 1)
	yaw = atan2(-f.x, -f.z)
	pitch = -0.05
	global_position = seat_at
	_cam_y = global_position.y
	Game.play_3d(Sfx.get_stream(&"body_fall"), global_position + Vector3.UP * 0.4, -18.0, 0.1, 2.0)


# --- Sleeping ------------------------------------------------------------------------------

## F on a bed: sleep the rest of the day (to evening) or the night (to the
## morning). Normally the eyes close, three seconds go by, they open on the
## new time. With the body cam there are no eyes: the body lies down on the
## bed, limp and quiet, and the camera goes on filming - five seconds of time
## lapse, everything (people, the light, the physics) many times faster.
var _sleep := {}
const SLEEP_FAST := 9.0
var _lids: CanvasLayer


func _sleep_on(info: Dictionary) -> void:
	if not _sleep.is_empty() or _ragdoll or _dead or roulette != null:
		return
	var dn = Game.main.day_night if Game.main else null
	var hour: float = dn.hour if dn else 12.0
	var night: bool = dn != null and dn.night > 0.4
	var to := 7.5 if night else 21.5
	var skip := fposmod(to - hour, 24.0)
	if skip < 1.0:
		skip += 12.0
	_switch_to("hands")
	_sleep = {"t": 0.0, "info": info, "cam": Game.bodycam, "skip": skip, "done": 0.0}
	if Game.bodycam:
		# Lie down on it: the body goes limp onto the mattress, on its back.
		global_position = info["lie"]
		_go_ragdoll()
		if _ragdoll:
			_lay_out(_ragdoll, info)
	else:
		seat_at = info["lie"] + Vector3.DOWN * 0.6
		_seat_stand = (info["at"] as Vector3) + Basis(Vector3.UP, float(info["yaw"])) * Vector3(0.8, 0.0, 0.0)
		global_position = seat_at
		var toward_head: Vector3 = (info["head"] as Vector3) - (info["lie"] as Vector3)
		yaw = atan2(toward_head.x, toward_head.z)
		pitch = 1.2                       # lying on the back, looking up
		_cam_y = global_position.y
		_lids = _eyelids()
		add_child(_lids)
	_notify("Спать..." if not Game.bodycam else "Таймлапс: %d ч" % int(skip))


## The ragdoll turned from standing to lying on its back along the bed, the
## head on the pillow, and dropped onto it from just above.
func _lay_out(r: Node3D, info: Dictionary) -> void:
	var lie: Vector3 = info["lie"]
	var head: Vector3 = info["head"]
	var along := Vector3(head.x - lie.x, 0.0, head.z - lie.z).normalized()
	var side := along.cross(Vector3.UP).normalized()
	# Standing up (the body's up) becomes along the bed; its front faces up
	# (its back, +Z, down onto the mattress).
	var lying := Basis(-side, along, Vector3.DOWN)
	var standing: Basis = r.pelvis.global_basis.orthonormalized()
	var turn := lying * standing.inverse()
	var pivot: Vector3 = r.pelvis.global_position
	for part in r.parts:
		var xf: Transform3D = part.global_transform
		var off := turn * (xf.origin - pivot)
		part.global_transform = Transform3D(turn * xf.basis, lie + Vector3.UP * 0.12 + off - along * 0.1)
		part.linear_velocity = Vector3.ZERO
		part.angular_velocity = Vector3.ZERO
		part.reset_physics_interpolation()
	r.feign = true


func _update_sleep(delta: float) -> void:
	if _sleep.is_empty():
		return
	var real_dt := delta / maxf(Engine.time_scale, 0.01)
	var t: float = float(_sleep["t"]) + real_dt
	_sleep["t"] = t
	var dn = Game.main.day_night if Game.main else null
	var skip: float = _sleep["skip"]
	if _sleep["cam"]:
		# 0.6 s settling on the bed, then five seconds of time lapse.
		var lapse := t > 0.6 and t < 5.6
		Game.fast = SLEEP_FAST if lapse else 1.0
		if lapse and not _sleep.has("passed"):
			_sleep["passed"] = true
			_hours_pass(skip)
		Engine.max_physics_steps_per_frame = 16 if lapse else [2, 3, 6][Game.quality]
		if _bc_hud:
			_bc_hud.timelapse = lapse
		if lapse and dn:
			# The day turns round far faster than even the sped-up world: the
			# clock is pushed on so the whole stretch goes by in the five seconds.
			var want := skip * clampf((t - 0.6) / 5.0, 0.0, 1.0)
			var step := want - float(_sleep["done"])
			_sleep["done"] = want
			dn.hour = fposmod(dn.hour + step - real_dt * SLEEP_FAST * 24.0 / (dn.DAY_MINUTES * 60.0), 24.0)
		if t > 6.2:
			Game.fast = 1.0
			var info: Dictionary = _sleep["info"]
			_sleep = {}
			if _bc_hud:
				_bc_hud.timelapse = false
			_get_up()
			# Off a soft mattress the body cannot always push itself up: if it
			# has not stood up in a moment, up it is, beside the bed (the view
			# was left staring at the ceiling - the night sky upstairs).
			get_tree().create_timer(2.5).timeout.connect(func():
				if _ragdoll and (_rising or _ragdoll.fallen) and not _dead:
					_finish_get_up()
					var side: Vector3 = (info["at"] as Vector3) + Basis(Vector3.UP, float(info["yaw"])) * Vector3(0.8, 0.0, 0.0)
					global_position = Vector3(side.x, global_position.y, side.z)
					pitch = 0.0)
		return
	# Eyes closing, closed a while (the time goes by), opening.
	var k := smoothstep(0.0, 0.9, t) * (1.0 - smoothstep(3.0, 3.9, t))
	if _lids:
		_lids.set_meta("k", k)
		for c in _lids.get_children():
			var top: bool = c.get_meta("top")
			var vs := get_viewport().get_visible_rect().size
			c.position.y = (-vs.y * 0.55 + vs.y * 0.55 * k) if top else (vs.y - vs.y * 0.55 * k)
			c.size = Vector2(vs.x, vs.y * 0.55)
	# (while the eyes are shut the world runs on fast)
	Game.fast = SLEEP_FAST if t > 0.9 and t < 3.0 else 1.0
	if t > 1.5 and float(_sleep["done"]) == 0.0 and dn:
		_sleep["done"] = 1.0
		dn.hour = fposmod(dn.hour + skip, 24.0)
		vitals.pain = maxf(vitals.pain - 0.5, 0.0)
		_hours_pass(skip)
	if t > 4.0:
		_sleep = {}
		Game.fast = 1.0
		if _lids:
			_lids.queue_free()
			_lids = null
		pitch = 0.0


func _eyelids() -> CanvasLayer:
	var layer := CanvasLayer.new()
	layer.layer = 5
	for top in [true, false]:
		var r := ColorRect.new()
		r.color = Color(0.0, 0.0, 0.0)
		r.mouse_filter = Control.MOUSE_FILTER_IGNORE
		r.set_meta("top", top)
		var vs := get_viewport().get_visible_rect().size
		r.size = Vector2(vs.x, vs.y * 0.55)
		r.position = Vector2(0, -vs.y * 0.55 if top else vs.y)
		layer.add_child(r)
	return layer


func _seated(delta: float) -> bool:
	if seat_at == Vector3.INF:
		return false
	# Getting up (rise_from_seat): up off the chair and a step back, smoothly.
	if _seat_rise_t >= 0.0:
		_seat_rise_t += delta
		var k := smoothstep(0.0, 1.0, _seat_rise_t / 1.3)
		seat_eye = lerpf(1.18, EYE_HEIGHT, smoothstep(0.0, 0.7, _seat_rise_t / 1.3))
		global_position = _rise_from.lerp(_rise_to, smoothstep(0.25, 1.0, _seat_rise_t / 1.3))
		yaw = lerp_angle(yaw, _rise_yaw, minf(delta * 3.0, 1.0))
		pitch = lerpf(pitch, 0.0, minf(delta * 3.0, 1.0))
		velocity = Vector3.ZERO
		_cam_y = global_position.y
		if k >= 1.0:
			_seat_rise_t = -1.0
			seat_at = Vector3.INF
			cine_busy = false
			seat_eye = 1.18
			_crouch = 0.0
			return false
		return true
	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	if Game.is_mouse_captured() and not cine_busy and (input.length() > 0.5 or Input.is_action_just_pressed("jump")) and _sleep.is_empty():
		if roulette and roulette.at_table:
			rise_from_seat()
			roulette.player_stood_up()
			return true
		seat_at = Vector3.INF
		if _seat_stand != Vector3.INF:
			global_position = _seat_stand
			_seat_stand = Vector3.INF
			_cam_y = global_position.y
		if roulette:
			roulette.player_stood_up()
		return false
	global_position = seat_at
	velocity = Vector3.ZERO
	if not cine_busy:
		_crouch = move_toward(_crouch, 1.0, delta * 4.0)      # legs bent under the table
	return true


## Ctrl held: go down (shorter capsule, slower). Standing back up waits for
## headroom.
func _update_crouch(delta: float) -> void:
	var want := 1.0 if (Input.is_action_pressed("crouch") and Game.is_mouse_captured()) or _bandaging_leg() else 0.0
	if want < _crouch:
		var up := Vector3.UP * (STAND_H - _cap.height + 0.02)
		if test_move(global_transform, up):
			want = _crouch          # something above: stay down
	_crouch = move_toward(_crouch, want, delta * 5.0)
	var h := lerpf(STAND_H, CROUCH_H, _crouch)
	if absf(_cap.height - h) > 0.001:
		_cap.height = h
		_shape.position.y = h * 0.5


# --- Climbing ------------------------------------------------------------------------

## Looks at what is in front and picks a move:
##  - "on": climb up onto something with room on top (a step up, a platform,
##    a ledge you pull yourself onto);
##  - "vault": over something thin (a low wall, a barrier) or through an
##    opening (a window): up onto the sill, across it crouched, down the far
##    side.
## Low things are only taken when walking at them.
func _try_climb(moving_forward: bool, on_floor: bool) -> bool:
	var fwd := -Basis(Vector3.UP, yaw).z
	var space := get_world_3d().direct_space_state
	var feet := global_position
	var mask := Game.LAYER_WORLD | Game.LAYER_PROPS
	var me: Array[RID] = [get_rid()]
	# Scan up the wall in front: where it starts being blocked and the first
	# clear height above that (the top of a wall, or the sill of a window).
	var wall_d := INF
	var clear_y := -1.0
	var y := 0.3
	while y <= 2.45:
		var q := PhysicsRayQueryParameters3D.create(feet + Vector3.UP * y, feet + Vector3.UP * y + fwd * 1.15, mask)
		q.exclude = me
		var hit := space.intersect_ray(q)
		var blocked := not hit.is_empty() and (hit.normal as Vector3).y < 0.5
		if blocked:
			wall_d = minf(wall_d, Vector2(hit.position.x - feet.x, hit.position.z - feet.z).length())
		elif wall_d < INF:
			clear_y = y
			break
		y += 0.1
	if wall_d == INF or clear_y < 0.0:
		return false
	# The top surface (wall top or sill), just past the wall face.
	var probe := feet + fwd * (wall_d + 0.12)
	var dq := PhysicsRayQueryParameters3D.create(probe + Vector3.UP * (clear_y + 0.05), probe + Vector3.UP * 0.2, mask)
	dq.exclude = me
	var top := space.intersect_ray(dq)
	if top.is_empty() or (top.normal as Vector3).y < 0.7:
		return false
	var top_y: float = top.position.y
	var h := top_y - feet.y
	if h < 0.35 or h > 2.3:
		return false
	if h < 0.95 and not (moving_forward and on_floor):
		return false
	if h > 2.1 and on_floor:
		return false          # too high to reach from the ground: jump and grab it
	# Headroom over the top (a window lintel).
	var uq := PhysicsRayQueryParameters3D.create(Vector3(probe.x, top_y + 0.05, probe.z), Vector3(probe.x, top_y + 2.5, probe.z), mask)
	uq.exclude = me
	var up_hit := space.intersect_ray(uq)
	var room: float = (up_hit.position.y - top_y) if not up_hit.is_empty() else 9.0
	if room < 0.7:
		return false
	# How thick is it: walk along the top until it drops away.
	var far_d := -1.0
	var land := Vector3.INF
	var d := wall_d + 0.2
	while d <= wall_d + 1.3:
		var p := feet + fwd * d
		var lq := PhysicsRayQueryParameters3D.create(Vector3(p.x, top_y + 0.3, p.z), Vector3(p.x, top_y - 4.0, p.z), mask)
		lq.exclude = me
		var lh := space.intersect_ray(lq)
		if lh.is_empty() or lh.position.y < top_y - 0.25:
			far_d = d
			if not lh.is_empty():
				land = lh.position
			break
		d += 0.1
	var edge: Vector3 = Vector3(probe.x, top_y, probe.z) - fwd * 0.1
	var pts: Array = []
	var times: Array = []
	var kind := ""
	var crouch_during := 0.0
	var on_top: Vector3 = Vector3(probe.x, top_y + 0.02, probe.z) + fwd * 0.2
	var can_stand := room > 1.9 and _fits(on_top, STAND_H)
	if far_d > 0.0 and (far_d - wall_d < 0.75 or not can_stand):
		# Vault over / through: up to the top, across it, down the other side.
		kind = "vault"
		crouch_during = 1.0 if room < 1.9 else 0.5
		var over := feet + fwd * (far_d + 0.15)
		over.y = top_y + 0.04
		var up := Vector3(feet.x, top_y + 0.04, feet.z) + fwd * maxf(wall_d - 0.25, 0.0)
		pts = [feet, up, over]
		times = [0.3 + 0.25 * h, 0.45]
		if land != Vector3.INF and top_y - land.y < 1.4:
			var down := land + fwd * 0.35 + Vector3.UP * 0.02
			if _fits(down, CROUCH_H):
				pts.append(down)
				times.append(0.25 + 0.2 * (top_y - land.y))
	else:
		if not _fits(on_top, CROUCH_H):
			return false
		kind = "small" if h < 0.95 else ("medium" if h < 1.55 else "large")
		crouch_during = 0.0 if can_stand else 1.0
		var hang := Vector3(feet.x, top_y - (0.55 if kind == "medium" else 1.05), feet.z) + fwd * maxf(wall_d - 0.3, 0.0)
		var knee := Vector3(probe.x, top_y + 0.03, probe.z) - fwd * 0.05
		match kind:
			"small":
				pts = [feet, knee + Vector3.UP * 0.05 - fwd * 0.1, on_top]
				times = [0.28, 0.3]
			"medium":
				pts = [feet, hang, knee, on_top]
				times = [0.3, 0.35, 0.3]
			_:
				pts = [feet, hang, knee, on_top]
				times = [0.45, 0.55, 0.35]
	# Running at it, it goes quicker and the run carries on past it.
	var v_in := maxf(Vector3(velocity.x, 0.0, velocity.z).dot(fwd), 0.0)
	var quick := 1.0 - clampf(v_in / 6.0, 0.0, 1.0) * (0.4 if kind in ["vault", "small"] else 0.15)
	for i in times.size():
		times[i] = float(times[i]) * quick
	var total := 0.0
	for t in times:
		total += t
	_climb = {"pts": pts, "times": times, "t": 0.0, "dur": total, "kind": kind, "ledge": edge,
			"crouch": crouch_during, "end_crouch": not can_stand, "h": h, "weapon": current.kind if current else "",
			"v_in": v_in}
	_shape.disabled = true
	velocity = Vector3.ZERO
	if kind in ["vault", "medium", "large"]:
		Game.play_3d(Sfx.get_stream(&"window_vault"), feet + Vector3.UP * 0.8, -4.0, 0.06, 2.0)
	if kind != "small" and current and not _smoking.busy():
		current.lower()      # both hands on the ledge
	return true


func _fits(feet: Vector3, height: float) -> bool:
	var shape := CapsuleShape3D.new()
	shape.radius = 0.3
	shape.height = height
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = shape
	q.transform = Transform3D(Basis(), feet + Vector3.UP * (height * 0.5 + 0.03))
	q.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS
	var me: Array[RID] = [get_rid()]
	q.exclude = me
	return get_world_3d().direct_space_state.intersect_shape(q, 1).is_empty()


## Where along the path (segment index and 0..1 within it) at path time t.
func _climb_seg_at(t: float) -> Vector2:
	var times: Array = _climb["times"]
	for i in times.size():
		if t <= times[i] or i == times.size() - 1:
			return Vector2(i, clampf(t / maxf(times[i], 0.001), 0.0, 1.0))
		t -= times[i]
	return Vector2(times.size() - 1, 1.0)


## Moves the body along the climb path: one smooth curve through the key
## points (no stops at them), eased in and out as a whole; the view dips and
## rolls with the effort, the body tucks down under a lintel.
func _update_climb(delta: float) -> void:
	var c := _climb
	c["t"] = float(c["t"]) + delta
	var k: float = clampf(c["t"] / c["dur"], 0.0, 1.0)
	# Ease the whole move, not each leg of it.
	var eased := k * k * (3.0 - 2.0 * k) * 0.6 + k * 0.4
	var seg := _climb_seg_at(eased * float(c["dur"]))
	var i := int(seg.x)
	var pts: Array = c["pts"]
	var p0: Vector3 = pts[maxi(i - 1, 0)]
	var p1: Vector3 = pts[i]
	var p2: Vector3 = pts[i + 1]
	var p3: Vector3 = pts[mini(i + 2, pts.size() - 1)]
	var s := seg.y
	var pos := _catmull(p0, p1, p2, p3, s)
	if absf(p2.y - p1.y) < 0.1:
		pos.y = lerpf(p1.y, p2.y, s)       # across a sill: no bulge up into the lintel
	elif p2.y < p1.y:
		# Dropping down: falls, speeding up.
		pos.y = lerpf(p1.y, p2.y, s * s)
	else:
		# Rising: height comes a little ahead of the forward move, so the body
		# clears the edge before it goes over it.
		pos.y = maxf(pos.y, lerpf(p1.y, p2.y, smoothstep(0.0, 0.75, s)))
	global_position = pos
	velocity = Vector3.ZERO
	var effort := sin(k * PI)
	match c["kind"]:
		"small":
			_climb_view = Vector2(-0.08 * effort, 0.03 * effort)
		"vault":
			_climb_view = Vector2(-0.18 * effort, 0.1 * sin(k * TAU))
		"medium":
			_climb_view = Vector2(-0.25 * effort, 0.06 * sin(k * TAU))
		_:
			_climb_view = Vector2(-0.4 * effort, 0.09 * sin(k * TAU))
	_crouch = move_toward(_crouch, float(c["crouch"]) * smoothstep(0.0, 0.25, k) * (1.0 - smoothstep(0.85, 1.0, k) * (0.0 if c["end_crouch"] else 1.0)), delta * 6.0)
	_bob_phase += delta * 3.0
	if k >= 1.0:
		_climb = {}
		_climb_view = Vector2.ZERO
		_shape.disabled = false
		if c["end_crouch"]:
			_crouch = maxf(_crouch, 0.9)
		var hgt := lerpf(STAND_H, CROUCH_H, _crouch)
		_cap.height = hgt
		_shape.position.y = hgt * 0.5
		var fwd := -Basis(Vector3.UP, yaw).z
		# Ended on a sill over a drop: jump down from it.
		velocity = fwd * (2.2 if pts.size() == 3 and c["kind"] == "vault" else 1.2)
		# The speed brought into it is kept (most of it over a low obstacle,
		# some after hauling up onto something high).
		var keep: float = float(c.get("v_in", 0.0)) * (0.9 if c["kind"] in ["vault", "small"] else 0.45)
		if keep > velocity.length():
			velocity = fwd * keep
		_cam_y = global_position.y
		# Leaving the path the body keeps moving the same way.
		if c["weapon"] != "" and current and current.is_holstered():
			current.raise()


## Hand and foot targets while climbing, for the body: [hands, feet].
## Feet are [point, weight] per side (weight 0 = normal walking legs).
func _climb_limbs() -> Array:
	var c := _climb
	var k: float = clampf(c["t"] / c["dur"], 0.0, 1.0)
	var side := Basis(Vector3.UP, yaw).x
	var fwd := -Basis(Vector3.UP, yaw).z
	var ledge: Vector3 = c["ledge"]
	var hands: Array = [Vector3.INF, Vector3.INF]
	var feet: Array = [[Vector3.ZERO, 0.0], [Vector3.ZERO, 0.0]]
	var kind: String = c["kind"]
	if kind != "small" and k < (0.8 if kind != "vault" else 0.7):
		hands = [ledge + side * 0.22 + fwd * 0.05, ledge - side * 0.22 + fwd * 0.05]
	var here := global_position
	match kind:
		"small":
			# Right foot up onto it, then the left follows.
			feet[0] = [ledge + side * 0.1 + fwd * 0.15, smoothstep(0.05, 0.35, k) * (1.0 - smoothstep(0.6, 0.9, k))]
			feet[1] = [ledge - side * 0.1 + fwd * 0.2, smoothstep(0.35, 0.6, k) * (1.0 - smoothstep(0.8, 1.0, k))]
		"vault":
			# Legs tucked up and swung over, then put down.
			var tuck := here + Vector3.UP * 0.35 + fwd * 0.35
			var w := smoothstep(0.15, 0.4, k) * (1.0 - smoothstep(0.75, 0.95, k))
			feet[0] = [tuck + side * 0.12, w]
			feet[1] = [tuck - side * 0.05 - fwd * 0.1, w * 0.9]
		_:
			# Hanging: feet against the wall; then a knee up onto the edge,
			# the other leg follows and both stand.
			var wall := ledge - fwd * 0.12 + Vector3.DOWN * (0.9 if kind == "large" else 0.5)
			var hang_w := smoothstep(0.0, 0.2, k) * (1.0 - smoothstep(0.4, 0.55, k))
			var knee_w := smoothstep(0.4, 0.6, k) * (1.0 - smoothstep(0.85, 1.0, k))
			feet[0] = [wall.lerp(ledge + side * 0.12 + fwd * 0.1, smoothstep(0.4, 0.6, k)) + side * 0.12, maxf(hang_w, knee_w)]
			feet[1] = [(wall - side * 0.12).lerp(ledge - side * 0.1 + fwd * 0.15, smoothstep(0.6, 0.8, k)), maxf(hang_w, smoothstep(0.6, 0.8, k) * (1.0 - smoothstep(0.9, 1.0, k)))]
	return [hands, feet]



func _start_cam_blend(time: float) -> void:
	_cam_from = cam.global_transform
	_cam_blend = 1.0
	_cam_blend_time = time



func _catmull(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: float) -> Vector3:
	var t2 := t * t
	var t3 := t2 * t
	return 0.5 * ((2.0 * p1) + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t3)



# --- Grenade and bomb -----------------------------------------------------------------

## Grenade / bomb in hand: LMB throws the grenade overhand (RMB lobs it
## underhand) or puts the bomb down on the surface looked at.
func _update_item(delta: float) -> void:
	_item_cool = maxf(_item_cool - delta, 0.0)
	var want := _item if current == null and _pending == "" and not _smoking.busy() else ""
	if want != _item_kind:
		if _item_model:
			_item_model.queue_free()
			_item_model = null
		_item_kind = want
		if want != "":
			match want:
				"grenade":
					_item_model = Grenade.model()
				"molotov":
					_item_model = Molotov.model()
					_item_model.scale = Vector3.ONE * 0.85
				"bomb":
					_item_model = Bomb.model(false)
					_item_model.scale = Vector3.ONE * 0.8
				"cuffs":
					_item_model = cuffs_model()
				"machete":
					_item_model = Machete.new()
				"spraycan":
					_item_model = spraycan_model()
				"sponge":
					_item_model = sponge_model()
				"pipe_bomb":
					_item_model = PipeBomb.model()
					_item_model.scale = Vector3.ONE * 0.8
				"mop":
					_item_model = Mop.new()
				_:
					_item_model = Chainsaw.new()
			if want == "mop":
				# Its head is on the floor, out in the world.
				get_parent().add_child(_item_model)
				_item_model.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
			elif want == "machete":
				# A body of its own in the world, not stuck to the view.
				get_parent().add_child(_item_model)
				_mach_new = true
				_mach_swing = -1.0
				_mach_charge = 0.0
				_mach_theta = MACHETE_REST
			else:
				cam.add_child(_item_model)
	if _item_model == null:
		return
	if _item_kind == "machete":
		_machete_tick(delta)
		return
	if _item_kind == "mop":
		_mop_tick(delta)
		return
	# Hold pose, the throw swing, and hidden until the next one is in hand.
	var hold := Vector3(0.14, -0.17, -0.34) if _item_kind == "grenade" else Vector3(0.1, -0.22, -0.4)
	var rot := Vector3(0.3, -0.4, 0.2) if _item_kind == "grenade" else Vector3(0.5, 0.0, 0.0)
	if _item_kind == "molotov":
		hold = Vector3(0.15, -0.26, -0.34)
		rot = Vector3(0.25, -0.2, 0.25)
	var sawing := false
	if _item_kind == "cuffs":
		hold = Vector3(0.14, -0.2, -0.36)
		rot = Vector3(0.2, 0.3, 0.0)
	elif _item_kind == "sponge":
		var r := _sponge_tick(delta)
		hold = r[0]
		rot = r[1]
	elif _item_kind == "spraycan":
		var spraying := Game.is_mouse_captured() and _fire_held() and _held == null
		# Held up and out at the wall, the nozzle forward, pushed in a touch
		# while the finger is on it.
		hold = Vector3(0.16, -0.16, -0.36) + (Vector3(-0.02, 0.02, -0.05) if spraying else Vector3.ZERO)
		rot = Vector3(-0.1, 0.0, 0.0)
		_spray_tick(delta, spraying)
	elif _item_kind == "chainsaw":
		var saw = _item_model
		saw.running = Game.is_mouse_captured() and _fire_held() and _held == null
		sawing = _saw_tick(delta, saw.running) and saw.running
		# Pushed forward while it revs - but not jerked about while it is
		# stuck in someone.
		if _saw_drag <= 0.0:
			_saw_push = move_toward(_saw_push, 1.0 if saw.running else 0.0, delta * 4.0)
		hold = Vector3(0.19, -0.37, -0.28) + Vector3(0, 0.03, -0.1) * _saw_push
		rot = Vector3(0.28, 0.14, _saw_roll)      # nose up a little, so the bar is in sight
		hold += saw.animate(delta, sawing)
		# Moved and turned in the hands (Alt).
		var fh: FreeHold = _item_free("chainsaw")
		hold += fh.free_pos
		rot = (Basis.from_euler(fh.free_rot) * Basis.from_euler(rot)).get_euler()
	if _throw_t >= 0.0:
		_throw_t += delta
		var k := _throw_t
		if _throw_soft:
			hold += Vector3(0.0, -0.12, 0.05) * smoothstep(0.0, 0.15, k) + Vector3(-0.02, 0.18, -0.25) * smoothstep(0.15, 0.3, k)
		else:
			hold += Vector3(0.05, 0.12, 0.18) * smoothstep(0.0, 0.18, k) + Vector3(-0.08, -0.05, -0.45) * smoothstep(0.18, 0.3, k)
			rot += Vector3(-1.2, 0.0, 0.0) * smoothstep(0.18, 0.3, k)
		if k >= 0.26 and _item_model.visible:
			_release_grenade()
		if k > 0.45:
			_throw_t = -1.0
	_item_model.visible = _item_cool <= 0.0 and (_throw_t < 0.26)
	if Game.bodycam:
		hold += Vector3(0.0, 0.12, -0.08)      # (held in front of the chest, the camera below the eyes)
	_item_model.position = _item_model.position.lerp(hold + Vector3(0, -0.3, 0) * (_item_cool / 0.7), minf(delta * 18.0, 1.0))
	_item_model.rotation = rot
	if not Game.is_mouse_captured() or _item_cool > 0.0 or _throw_t >= 0.0 or _held:
		return
	if _item_kind == "cuffs" and _fire_just():
		_try_cuff()
	elif _item_kind == "grenade" or _item_kind == "molotov":
		if _fire_just() or Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT) and not Input.is_action_pressed("free_aim"):
			_throw_soft = not _fire_just()
			_throw_t = 0.0
			if _item_kind == "molotov":
				# The rag lit with the lighter as the arm goes back.
				Game.play_3d(Sfx.get_stream(&"lighter"), cam.global_position, -4.0, 0.05, 1.0)
				var tip: Node3D = _item_model.get_node_or_null("RagTip")
				if tip:
					Fire.flames_on(tip, 0.35, 12)
			else:
				Game.play_3d(Sfx.get_stream(&"pin"), cam.global_position, -10.0, 0.05, 1.0)
	elif _item_kind == "pipe_bomb" and _fire_just():
		_place_pipe_bomb()
	elif _item_kind == "bomb" and _fire_just():
		var from := cam.global_position
		var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_basis.z * 2.2, Game.LAYER_WORLD | Game.LAYER_PROPS)
		var me: Array[RID] = [get_rid()]
		q.exclude = me
		var hit := get_world_3d().direct_space_state.intersect_ray(q)
		if not hit.is_empty() and not (hit.collider as Node).has_method("press"):
			var at: Vector3 = hit.position
			var n: Vector3 = hit.normal
			Bomb.place(get_parent(), at, n, from)
			Game.play_3d(Sfx.get_stream(&"mag_in"), hit.position, -8.0, 0.1, 2.0)
			_item_cool = 0.7
			inventory.take("bomb")
			if not inventory.has("bomb"):
				_item = ""


func _release_grenade() -> void:
	var fwd := -cam.global_basis.z
	var at := _item_model.global_transform
	var vel := velocity + (fwd * 5.5 + Vector3.UP * 2.5 if _throw_soft else fwd * 14.0 + Vector3.UP * 2.5)
	if _item_kind == "molotov":
		Molotov.throw(get_parent(), at, vel * 0.85, Vector3(randf_range(-6, 6), randf_range(-2, 2), randf_range(-6, 6)))
		_item_cool = 0.7
		inventory.take("molotov")
		if not inventory.has("molotov"):
			_item = ""
		return
	Grenade.throw(get_parent(), at, vel, Vector3(randf_range(-8, 8), randf_range(-4, 4), randf_range(-8, 8)))
	_item_cool = 0.7
	inventory.take("grenade")
	if not inventory.has("grenade"):
		_item = ""


## Which key of a bomb the centre of the screen is on (shows the dot), and
## the press itself: the finger lands on the key a moment after the click.
func _update_bomb_look() -> void:
	_look_bomb = null
	_look_key = -1
	var from := cam.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_basis.z * 2.2, Game.LAYER_WORLD | Game.LAYER_PROPS)
	var me: Array[RID] = [get_rid()]
	q.exclude = me
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if not hit.is_empty() and (hit.collider as Node).has_method("press"):
		_look_bomb = hit.collider
		_look_key = _look_bomb.key_at(hit.position)
	if not _press.is_empty():
		var b: Node = _press["bomb"]
		if not is_instance_valid(b):
			_press = {}
		else:
			_press["point"] = b.key_world(_press["key"])
			_press["t"] = float(_press["t"]) + get_physics_process_delta_time()
			if not _press["done"] and _press["t"] >= 0.16:
				_press["done"] = true
				b.press(_press["key"])
			if _press["t"] > 0.5:
				_press = {}
	if _hand and _held == null and _aim_body == null:
		_hand.set_mode(HandIcon.Mode.DOT if _look_bomb else HandIcon.Mode.HIDDEN)



# --- Handcuffs -----------------------------------------------------------------------

## The person under the centre of the screen within `reach`, or null.
## Who to offer a game of roulette: the bot looked at, or the nearest one
## close by, facing him.
func _roulette_partner() -> Node3D:
	var b := _look_humanoid(3.5)
	if b:
		return b
	var best: Node3D = null
	var best_d := 3.0
	for bot in Game.bots:
		if is_instance_valid(bot) and bot.alive and bot.ai:
			var d: float = bot.position_ground().distance_to(global_position)
			if d < best_d:
				best = bot
				best_d = d
	return best


# --- The bag ---------------------------------------------------------------------------

func _notify(text: String) -> void:
	_note.text = text
	_note_t = 2.2


func _process_note(delta: float) -> void:
	_note_t -= delta
	_note.modulate.a = clampf(_note_t * 2.0, 0.0, 1.0)


func _start_bandage() -> void:
	if not inventory.take("bandage"):
		_notify("Нет бинтов")
		return
	_switch_to("hands")
	_bandage_t = 0.0
	_bandage_w = vitals.bandage_target()
	Game.play_3d(Sfx.get_stream(&"bandage"), global_position + Vector3.UP * 1.0, -6.0, 0.03, 1.5)


## Seeing to a leg: down on his haunches, looking at it, both hands round it.
func _bandaging_leg() -> bool:
	return _bandage_t >= 0.0 and not _bandage_w.is_empty() and _bandage_w["seg"] in ["thigh", "shin"]


func _start_smoke(what: String) -> void:
	var id := "cigarettes" if what == "cigarette" else "joint"
	if not inventory.take(id):
		_notify("Нет в рюкзаке: " + Items.def(id)["name"])
		return
	_switch_to("hands")
	_smoking.start(what)


## Double click / "take in hand" / "use" on something in the bag.
func _use_item(it: Dictionary) -> void:
	var id: String = it["id"]
	match Items.def(id)["kind"]:
		"weapon", "throwable", "placeable", "restraint":
			_switch_to(id)
			_inv_ui.toggle()
		"medical":
			if id == "syringe":
				# In the thigh, through the trousers: the pain goes, the
				# bleeding slows for a while, the head swims a little.
				inventory.take("syringe")
				vitals.pain = 0.0
				vitals.bleed *= 0.5
				for w in vitals.wounds:
					w["rate"] = float(w["rate"]) * 0.6
				Game.get_high(0.12)
				Game.play_3d(Sfx.get_stream(&"key_press"), global_position + Vector3.UP * 0.8, -10.0)
				_notify("Укол обезболивающего")
			elif _bandage_t < 0.0 and not _smoking.busy():
				_inv_ui.toggle()
				_start_bandage()
		"drug":
			inventory.take(id)
			Game.get_high(0.55)
			_notify("Закинулся таблеткой. Скоро накроет...")
		"part":
			_notify("Это для крафта (C)")
		"money":
			_notify("Денег: %d ₽" % inventory.count("money"))
		"food":
			inventory.remove(it)
			if _item_kind == "mop":
				_mop_water = 1.0
				_notify("Полил швабру водой")
				return
			_notify("Выпил воды")
			vitals.pain = maxf(vitals.pain - 0.1, 0.0)
		"smoking":
			if not _smoking.busy():
				_inv_ui.toggle()
				_start_smoke("cigarette" if id == "cigarettes" else "joint")


## Thrown out of the bag: onto the ground in front, as a thing that can be
## picked up again (guns as guns the bots can take too).
func _drop_item(it: Dictionary) -> void:
	var id: String = it["id"]
	var n: int = it["count"]
	inventory.remove(it)
	_after_losing(id)
	if id in ["pistol", "shotgun", "akm"]:
		_drop_gun(id)
		return
	var fwd := -cam.global_basis.z
	var xf := Transform3D(Basis(Vector3.UP, yaw + randf_range(-0.5, 0.5)), cam.global_position + fwd * 0.6 + Vector3.DOWN * 0.3)
	Net.spawn_drop(get_parent(), false, id, n, xf, velocity + fwd * 1.2 + Vector3.UP * 0.4)


## If what was in hand is gone from the bag, the hand is empty.
func _after_losing(id: String) -> void:
	if inventory.has(id):
		return
	if current and current.kind == id:
		_switch_to("hands")
	if _item == id:
		_item = ""


## F: picks up the thing looked at into the bag, if there is room.
func _pick_up() -> void:
	var trader := _look_humanoid(3.2)
	if trader and trader.has_meta("trader") and trader.alive and not _shop_ui.is_open:
		_shop_ui.open()
		return
	# Someone to talk to.
	if trader and not trader.has_meta("trader") and trader.alive and trader.conscious and not trader.fallen \
			and trader.ai and trader.global_position.distance_to(global_position) < 3.0 and roulette == null:
		var st = trader.ai.state
		if trader.has_meta("puppet") or not st in [trader.ai.S.FLEE, trader.ai.S.ARMED, trader.ai.S.ANGRY, trader.ai.S.BRAWL,
				trader.ai.S.HIDE, trader.ai.S.PLAY_DEAD, trader.ai.S.SURRENDER]:
			open_dialog(trader)
			return
	var from := cam.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_basis.z * 2.4, Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS)
	var me: Array[RID] = [get_rid()]
	q.exclude = me
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty():
		return
	var n: Node = hit.collider
	if n.has_meta("switch"):
		n.use()
		return
	if n.has_meta("tv"):
		n.get_meta("tv").toggle()
		return
	if n.has_meta("seat") and roulette == null:
		_sit_on(n, hit.position)
		return
	if n.has_meta("bed") and roulette == null:
		_sleep_on(n.get_meta("bed"))
		return
	var id := ""
	var count := 1
	if n.has_meta("item"):
		id = n.get_meta("item")
		count = n.count
	elif n.get("kind") != null and n.has_method("take") and n.kind in ["pistol", "shotgun", "akm"]:
		id = n.kind
		if n.claimed_by != null:
			n.claimed_by = null
	if id == "":
		return
	if inventory.find_room(id) == null and not inventory.has(id):
		_notify("Нет места в рюкзаке")
		return
	var at: Vector3 = hit.position
	# (in a game with others the host says whether it is still there)
	Net.take(n, func(thing: Node) -> void:
		var left: int = inventory.add(id, count)
		if left == count:
			_notify("Нет места в рюкзаке")
			return
		if left > 0 and not Net.active:
			thing.count = left
			_notify("Не всё поместилось")
		elif is_instance_valid(thing) and not thing.is_queued_for_deletion():
			if thing.has_method("take") and Net.active:
				thing.take()
			else:
				thing.queue_free()
		Game.play_3d(Sfx.get_stream(&"item_pickup"), at, -6.0, 0.05, 2.0))


func _look_humanoid(reach: float) -> Node3D:
	var from := cam.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_basis.z * reach, Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS)
	var me: Array[RID] = [get_rid()]
	q.exclude = me
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty() or not (hit.collider as Node).has_meta("humanoid"):
		return null
	var h = (hit.collider as Node).get_meta("humanoid")
	return h if h.ai else null


func _set_escort(b: Node3D) -> void:
	if _escort and is_instance_valid(_escort):
		_escort.ai.escort = null
	_escort = b
	if b:
		b.ai.escort = self
		b.ai.kneel = false


## Cuffs in hand: LMB on someone within reach puts them on.
func _try_cuff() -> void:
	var h := _look_humanoid(2.2)
	if h == null or h.cuffed or h.cuff_prep or not h.alive or not _cuffing.is_empty():
		return
	# His arms go behind his back; then the cuffs go on, one wrist and the
	# other (see _update_cuffing).
	h.wake()
	h.cuff_prep = true
	h.ai.kneel = false
	Net.bot_call(h, "net_set", ["cuff_prep", true])
	_cuffing = {"bot": h, "t": 0.0, "clicks": 0}


var _cuffing := {}


## Putting the cuffs on: the hand with them reaches for his wrists behind
## his back, snaps one ring shut and then the other.
func _update_cuffing(delta: float) -> void:
	if _cuffing.is_empty():
		return
	var h = _cuffing["bot"]
	var t: float = float(_cuffing["t"]) + delta
	_cuffing["t"] = t
	if not is_instance_valid(h) or not h.alive or h.fallen or global_position.distance_to(h.pelvis.global_position) > 2.6 \
			or _item_kind != "cuffs":
		if is_instance_valid(h):
			h.cuff_prep = false
		_cuffing = {}
		return
	h.move_velocity = Vector3.ZERO
	var hr: Vector3 = h.parts[h.part_index["hand_r"]].global_position
	var hl: Vector3 = h.parts[h.part_index["hand_l"]].global_position
	var wrists := (hr + hl) * 0.5
	if _item_model:
		var k := smoothstep(0.1, 0.6, t) * (1.0 - smoothstep(1.5, 1.8, t))
		var rest := cam.global_transform * Vector3(0.14, -0.2, -0.36)
		_item_model.global_position = rest.lerp(wrists + Vector3.UP * 0.02, k)
	var clicks: int = _cuffing["clicks"]
	if clicks == 0 and t > 0.8:
		_cuffing["clicks"] = 1
		Game.play_3d(Sfx.get_stream(&"key_press"), hr, -4.0, 0.05, 2.0)
	elif clicks == 1 and t > 1.2:
		_cuffing["clicks"] = 2
		Game.play_3d(Sfx.get_stream(&"key_press"), hl, -4.0, 0.08, 2.0)
		h.set_cuffed(true)
		Net.bot_call(h, "set_cuffed", [true])
		Game.play_3d(Sfx.get_stream(&"slide_back"), wrists, -10.0, 0.1, 2.0)
	if t > 1.8:
		_cuffing = {}
		_item_cool = 0.3


static func cuffs_model() -> Node3D:
	var root := Node3D.new()
	var steel := StandardMaterial3D.new()
	steel.albedo_color = Color(0.62, 0.62, 0.64)
	steel.metallic = 0.9
	steel.roughness = 0.3
	for x in [-0.045, 0.045]:
		var ring := MeshInstance3D.new()
		var t := TorusMesh.new()
		t.inner_radius = 0.03
		t.outer_radius = 0.04
		t.rings = 16
		t.ring_segments = 6
		ring.mesh = t
		ring.material_override = steel
		ring.position = Vector3(x, 0, 0)
		ring.rotation = Vector3(PI * 0.5, 0, 0.3 * signf(x))
		root.add_child(ring)
	var chain := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.03, 0.008, 0.008)
	chain.mesh = bm
	chain.material_override = steel
	root.add_child(chain)
	return root



# --- Chainsaw -------------------------------------------------------------------------

## The chainsaw against people (see blade_cut.gd): with the chain running
## the bar cuts where it is pushed, no faster than the chain eats each part
## (FEED_RATE); stuck in someone it holds them - lift, drag or turn the saw and
## they come with it - and slides back out the way it went in. With the chain
## stopped it grips harder and cuts nothing. Returns whether it is in someone.
func _saw_tick(delta: float, running: bool) -> bool:
	var saw = _item_model
	if _saw == null:
		_saw = BladeCut.new()
		_saw.half = BAR_HALF
		# Deep in someone the bar is held fast: a jerk of the saw drags
		# him along with it rather than pulling it out.
		_saw.strength = 1800.0
		_saw.wrench = 0.14
		_saw.smooth = 0.15
		_saw.limit = func(st: Dictionary, want: float, dt: float) -> float:
			return minf(want, float(FEED_RATE.get(st["kind"], 0.15)) * dt)
		_saw.on_through = func(body: RigidBody3D, point: Vector3, normal: Vector3) -> void:
			var sh = body.get_meta("humanoid")
			if not Net.bot_call(sh, "net_slice", [sh.parts.find(body), point, normal]):
				sh.saw_slice(body, point, normal)
	var a: Vector3 = saw.bar_root()
	var b: Vector3 = saw.bar_nose()
	# Right button with the bar in someone's body: run him onto it - he hangs
	# there on the bar, held fast, and comes wherever the saw goes.
	var rmb: bool = Game.is_mouse_captured() and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT) and not Input.is_action_pressed("free_aim")
	if _impaled == null and rmb:
		for f in _saw.in_flesh:
			var part: RigidBody3D = f[0]
			if String(part.get_meta("part", "")) in ["chest", "abdomen", "pelvis"] and not part.has_meta("severed"):
				_impale(part, saw)
				break
	if _impaled != null:
		if not rmb or not is_instance_valid(_impaled):
			_unimpale()
		else:
			_hold_impaled(saw, delta)
			if running:
				_saw_effects(_impaled, a.lerp(b, 0.55), saw.global_basis.x, a, b, saw.global_basis.y, delta)
			_saw_drag = 0.35
			return true
	_saw.cutting = running
	_saw.grip = 0.3 if running else 1.6
	_saw.drift = 1.0 if running else 0.0
	_saw.step(get_world_3d().direct_space_state, a, b, saw.global_basis.x, delta)
	_saw_drag = _saw.hold
	# Doors: the chain goes through the wood (door.gd cuts its kerf).
	var in_wood := false
	if running:
		for d in get_tree().get_nodes_in_group(&"door"):
			if is_instance_valid(d) and d.global_position.distance_to(a) < 3.5 and d.saw(a, b, delta):
				in_wood = true
		if in_wood:
			_saw_drag = maxf(_saw_drag, 0.2)
			_kick_roll_v += randf_range(-1.0, 1.0) * 0.8
	if running:
		for f in _saw.in_flesh:
			_saw_effects(f[0], f[1], f[2], a, b, saw.global_basis.y, delta)
		# The kerf so far shows, raw, however far it has gone (and meat
		# hangs out of a deep one) - a few times a second, not every step.
		_saw_gash_t -= delta
		if _saw_gash_t <= 0.0:
			_saw_gash_t = 0.15
			for id in _saw.cuts:
				var st: Dictionary = _saw.cuts[id]
				if is_instance_valid(st["body"]) and not st["head"]:
					FleshWounds.cut(st["body"], st)
	return not _saw.in_flesh.is_empty() or in_wood


var _impaled: RigidBody3D = null
var _impale_rel := Transform3D()      # the part in the saw's frame, as it went on
var _saw_gash_t := 0.0


func _impale(part: RigidBody3D, saw: Node3D) -> void:
	_impaled = part
	_saw.clear()
	var h = part.get_meta("humanoid")
	h.wake()
	# Pushed on well up the bar.
	var mid: Vector3 = (saw.bar_root() as Vector3).lerp(saw.bar_nose(), 0.5)
	var xf := part.global_transform
	xf.origin = xf.origin.lerp(mid, 0.6)
	_impale_rel = saw.global_transform.affine_inverse() * xf
	for p in h.parts:
		add_collision_exception_with(p)      # hanging off the saw, not shoving the player about
	if h.alive:
		h._fall()
		h.pain = 1.5
		h.shock += 0.15
		h.bleed_rate += 30.0
		if h.ai:
			h.ai.on_hurt(part.global_position, -cam.global_basis.z)
	Game.play_3d(Sfx.get_stream(&"flesh"), part.global_position, 0.0, 0.1, 3.0)
	if Game.blood:
		Game.blood.open_jet(h, part, part.global_position, -cam.global_basis.z, 35.0)


func _unimpale() -> void:
	if is_instance_valid(_impaled):
		var h = _impaled.get_meta("humanoid")
		for p in h.parts:
			if is_instance_valid(p):
				remove_collision_exception_with(p)
		_impaled.linear_velocity = velocity * 0.8
	_impaled = null


## Held on the bar: that part goes exactly where the saw takes it (its speed
## set to get it there this step), the rest of him hanging from it.
func _hold_impaled(saw: Node3D, delta: float) -> void:
	var want: Transform3D = saw.global_transform * _impale_rel
	var p := _impaled
	var dv := (want.origin - p.global_position) / maxf(delta, 1e-4)
	p.linear_velocity = dv.limit_length(25.0)
	var q := (want.basis.orthonormalized() * p.global_basis.orthonormalized().inverse()).get_rotation_quaternion()
	var ang := q.get_angle()
	if ang > PI:
		ang -= TAU
	p.angular_velocity = (q.get_axis() * ang / maxf(delta, 1e-4) * 0.5).limit_length(30.0) if ang > 0.001 else Vector3.ZERO
	var h = p.get_meta("humanoid")
	if h.alive and h.blood < 2600.0:
		h._die("bleed_out")


## Blood and bits thrown off the chain, the gash along the blade, the body
## jerking and hurting.
func _saw_effects(part: RigidBody3D, point: Vector3, normal: Vector3, a: Vector3, b: Vector3, up: Vector3, delta: float) -> void:
	var h = part.get_meta("humanoid")
	var along := (b - a).normalized()
	_saw_spray -= delta
	if _saw_spray <= 0.0 and Game.blood:
		_saw_spray = 0.05
		var side := normal * signf(randf() - 0.5)
		var out := (side + up * 0.8 - along * 0.3).normalized()
		Game.blood._spray(point + up * 0.03, out, 35.0, 1.5, 5.0, 5, 2.5, h._ray_exclude)
		# The blood on him where the saw has been: a stain each few centimetres
		# of the cut (not one every step - those used each other up and the
		# marks of a cut not finished went again).
		var last: Vector3 = part.get_meta("saw_stamp", Vector3.INF)
		var lp := part.to_local(point)
		if part != h.head and (last == Vector3.INF or last.distance_to(lp) > 0.025):
			part.set_meta("saw_stamp", lp)
			Game.blood._body_stamp(part, point, (point - part.global_position).normalized(), along, 0.02, 0.06, "wound", 0)
	part.apply_central_impulse(along * randf_range(-1.0, 1.0) * delta * 1.8)
	if h.alive:
		h.bleed_rate += delta * 5.0
		h.pain = minf(h.pain + delta * 2.0, 1.5)
		h.shock += delta * 0.06
		h._flinch = 1.0
		if h.ai and randf() < delta * 2.0:
			h.ai.on_hurt(part.global_position, along)
	_kick_roll_v += randf_range(-1.0, 1.0) * 0.6


# --- Machete --------------------------------------------------------------------------

## Held LMB: the machete comes up, smoothly, over the middle of the head (the
## longer it is held, up to MACHETE_CHARGE, the harder the blow); let go and
## it comes down fast. The hand only pulls it (machete.gd): walls stop it,
## wood keeps it. In people it cuts with what the swing has: each part costs
## so much to go through (MACHETE_HARD, J per metre), and a blow that runs out
## on the way leaves the blade stuck in them - then it holds them as the
## chainsaw does, and comes out back the way it went in.
var _mach_stab := -1.0              # a thrust in progress (s), -1 = none
var _mach_stab_hit := false
var _rmb_was := false


func _machete_tick(delta: float) -> void:
	var m = _item_model
	var held := Game.is_mouse_captured() and _fire_held() and _held == null
	# Right button: a straight thrust, point first, no swing needed; held
	# down, the blade stays in whatever it went into.
	var rmb: bool = Game.is_mouse_captured() and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT) 			and not Input.is_action_pressed("free_aim") and not (_inv_ui.is_open or _radial.is_open)
	if rmb and not _rmb_was and _mach_swing < 0.0 and _mach_charge <= 0.0 and _mach_stab < 0.0:
		_mach_stab = 0.0
		_mach_stab_hit = false
	_rmb_was = rmb
	if _mach_stab >= 0.0:
		_machete_stab(delta, m, rmb)
		return
	if _mach_swing < 0.0:
		if held:
			_mach_charge = minf(_mach_charge + delta / MACHETE_CHARGE, 1.0)
		elif _mach_charge > 0.0:
			# Down it comes: the whole arm and shoulder behind it - the view
			# goes with it, and the air hisses past the blade.
			_mach_swing = 0.0
			_mach_from = _mach_theta
			_mach_power = _mach_charge
			_kick_v -= 1.5 + 3.5 * _mach_charge
			_kick_roll_v += 1.5 + 2.5 * _mach_charge
			Game.play_3d(Sfx.get_stream(&"mop_swish"), cam.global_position, lerpf(-12.0, -3.0, _mach_charge), 0.08, lerpf(0.75, 0.6, _mach_charge))
			# Just a flick of the button: a short, hard chop from the wrist,
			# no wind-up.
			if _mach_charge < 0.3:
				_mach_from = maxf(_mach_theta, 0.85)
				_mach_power = 0.7
			_mach_charge = 0.0
		var want := lerpf(MACHETE_REST, MACHETE_UP, smoothstep(0.0, 1.0, _mach_charge))
		# (it is heavy: it comes up slower than a hand alone would, and the
		# view leans back with the weight up over the shoulder)
		_mach_theta = move_toward(_mach_theta, want, delta * 3.2)
		if held:
			_kick_roll_v -= delta * 3.0 * _mach_charge
	else:
		_mach_swing += delta
		var dur := lerpf(0.4, 0.22, _mach_power)
		var u := _mach_swing / dur
		if u < 1.0:
			_mach_theta = lerpf(_mach_from, MACHETE_END, u * u)       # faster and faster
		else:
			var k := clampf((_mach_swing - dur) / 0.6, 0.0, 1.0)
			_mach_theta = lerpf(MACHETE_END, MACHETE_REST, smoothstep(0.0, 1.0, k))
			if k >= 1.0:
				_mach_swing = -1.0
	# Where the hand wants it: swung round the shoulder, which comes in over
	# the middle for a blow.
	var mid_k := clampf(maxf(_mach_charge * 2.0, 1.0 if _mach_swing >= 0.0 else 0.0), 0.0, 1.0)
	_mach_mid = move_toward(_mach_mid, mid_k, delta * 4.0)
	var shoulder := Vector3(0.2, -0.22, 0.02).lerp(Vector3(0.03, -0.16, 0.0), _mach_mid)
	var turn := Basis(Vector3.UP, 0.22 * (1.0 - _mach_mid))
	# The elbow bends to bring it up close past the head, and straightens
	# as it comes down, so the blow reaches out.
	var reach := lerpf(0.38, 0.13, smoothstep(0.0, 1.0, _mach_charge))
	if _mach_swing >= 0.0:
		var dur := lerpf(0.4, 0.22, _mach_power)
		var u := clampf(_mach_swing / dur, 0.0, 1.0)
		reach = lerpf(lerpf(0.38, 0.13, _mach_power), 0.46, sqrt(u))
		if _mach_swing > dur:
			reach = lerpf(0.46, 0.38, clampf((_mach_swing - dur) / 0.6, 0.0, 1.0))
	var grip_xf := cam.global_transform * Transform3D(turn * Basis(Vector3.RIGHT, _mach_theta), shoulder) \
			* Transform3D(Basis(), Vector3(0.0, 0.0, -reach))
	# Moved and turned in the hand (Alt): turned about the grip, moved in the
	# view's own directions.
	var fh: FreeHold = _item_free("machete")
	var cb := cam.global_basis
	grip_xf.basis = cb * Basis.from_euler(fh.free_rot) * cb.inverse() * grip_xf.basis
	grip_xf.origin += cb * fh.free_pos
	m.target = grip_xf
	# The arm puts its weight behind a blow; just holding, it is gentle.
	m.hand_force = Machete.HAND_FORCE if _mach_swing >= 0.0 or _mach_charge > 0.0 else 160.0
	if not m.struck.is_connected(_machete_struck):
		m.struck.connect(_machete_struck)
	if _mach_new:
		_mach_new = false
		m.global_transform = m.target
	# The blade against people.
	if _mach_cut == null:
		_mach_cut = BladeCut.new()
		_mach_cut.half = Machete.HALF
		_mach_cut.strength = 520.0
		_mach_cut.grip = 0.8
		_mach_cut.limit = func(st: Dictionary, want: float, _dt: float) -> float:
			var cost: float = MACHETE_HARD.get(st["kind"], 1000.0)
			var g := clampf((_mach_energy - _mach_used) / cost, 0.0, want)
			_mach_used += g * cost
			return g
		_mach_cut.on_through = func(body: RigidBody3D, point: Vector3, normal: Vector3) -> void:
			var sh2 = body.get_meta("humanoid")
			if not Net.bot_call(sh2, "net_slice", [sh2.parts.find(body), point, normal]):
				sh2.saw_slice(body, point, normal)
	var a: Vector3 = m.blade_root()
	var b: Vector3 = m.blade_tip()
	var edge: Vector3 = m.edge_dir()
	var v: float = m.velocity_at(a.lerp(b, 0.6)).dot(edge)
	# Only a real chop cuts; the energy of this much of the swing.
	_mach_energy = 0.5 * Machete.ARM_MASS * (v * v - MACHETE_MIN_SPEED * MACHETE_MIN_SPEED) if v > MACHETE_MIN_SPEED else 0.0
	_mach_used = 0.0
	_mach_cut.edge = edge
	_mach_cut.cutting = not m.stuck
	var before := {}
	for f in _mach_cut.in_flesh:
		before[f[0]] = true
	_mach_cut.step(get_world_3d().direct_space_state, a, b, m.global_basis.x, delta)
	if _mach_used > 0.0 and v > 0.0:
		# What the cut took out of the swing.
		var v2 := sqrt(maxf(v * v - 2.0 * _mach_used / Machete.ARM_MASS, 0.0))
		m.linear_velocity -= edge * (v - v2)
	m.drive(delta, _mach_cut.reaction)
	_saw_drag = _mach_cut.hold
	for f in _mach_cut.in_flesh:
		_machete_effects(f[0], f[1], edge, (b - a).normalized(), v, not before.has(f[0]), delta)


## The blade brought up short on a wall, a post, a car: it rings, and the
## jolt goes back up the arm.
func _machete_struck(speed: float) -> void:
	if _item_model == null:
		return
	Game.play_3d(Sfx.get_stream(&"metal_hit"), _item_model.blade_tip(), clampf(-16.0 + speed, -14.0, -3.0), 0.15, 1.6)
	_kick_v += clampf(speed * 0.45, 1.0, 6.0)
	_kick_roll_v += randf_range(-1.0, 1.0) * clampf(speed * 0.8, 2.0, 8.0)
	if Game.fx and speed > 6.0:
		# (steel on stone: a few sparks and a puff of grit)
		var sp: GPUParticles3D = Game.fx._sparks[Game.fx._spark_i]
		Game.fx._place(sp, _item_model.blade_tip(), -_item_model.edge_dir())
		sp.restart()
		Game.fx._spark_i = (Game.fx._spark_i + 1) % Game.fx._sparks.size()


## A blow landing (blood, the man hurt by how hard it was) and the blade
## working in the wound.
func _machete_effects(part: RigidBody3D, point: Vector3, edge: Vector3, along: Vector3, v: float, landed: bool, delta: float) -> void:
	var h = part.get_meta("humanoid")
	if landed and v > 2.0:
		Game.play_3d(Sfx.get_stream(&"flesh"), point, -4.0, 0.15, 3.0)
		if Game.blood:
			Game.blood.on_hit(h, part, point, edge, "shotgun", "limb", clampf(v * 3.0, 4.0, 55.0), true)
		if h.alive:
			h.bleed_rate += v * 1.5
			h.pain = minf(h.pain + v * 0.08, 1.5)
			h.shock += v * 0.04
			h._flinch = 1.0
			if h.ai:
				h.ai.on_hurt(point, edge)
		# The blow stops dead in him: it comes back up the arm.
		_kick_v += clampf(v * 0.5, 1.0, 5.0)
		_kick_roll_v += randf_range(-1.0, 1.0) * clampf(v * 0.6, 2.0, 6.0)
	if _mach_used > 0.0 and Game.blood and part != h.head:
		Game.blood._body_stamp(part, point, (point - part.global_position).normalized(), along, 0.012, 0.05, "wound", 0)
	if h.alive:
		h.bleed_rate += delta * 1.5


# --- Holding a saw or blade differently (Alt) --------------------------------------------

## Things held in the hands (not guns) that can be moved and turned with Alt
## like a gun can.
const FREE_ITEMS := ["chainsaw", "machete"]


class FreeHold:
	extends RefCounted
	var free_pos := Vector3.ZERO
	var free_rot := Vector3.ZERO


func _item_free(kind: String) -> FreeHold:
	if not _free_holds.has(kind):
		_free_holds[kind] = FreeHold.new()
	return _free_holds[kind]


## Death: the screen goes black and every sound stops, there and then.
## With the body cam on, the feed is lost instead: static and its hiss.
func _lights_out() -> void:
	if Game.bodycam:
		_static_target = 1.0
		if _bc_hud:
			_bc_hud.disconnected()
		AudioServer.set_bus_mute(AudioServer.get_bus_index("World"), true)
		var hiss := AudioStreamPlayer.new()
		hiss.stream = _static_noise()
		hiss.volume_db = -14.0
		add_child(hiss)
		hiss.play()
		return
	var layer := CanvasLayer.new()
	layer.layer = 128
	var black := ColorRect.new()
	black.color = Color.BLACK
	black.mouse_filter = Control.MOUSE_FILTER_IGNORE
	black.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	layer.add_child(black)
	add_child(layer)
	AudioServer.set_bus_mute(AudioServer.get_bus_index("Master"), true)


## A second of white noise, looping: the sound of a lost video feed.
static func _static_noise() -> AudioStreamWAV:
	var rate := 22050
	var data := PackedByteArray()
	data.resize(rate * 2)
	var lp := 0.0
	for i in rate:
		var w := randf_range(-1.0, 1.0)
		lp = lp * 0.35 + w * 0.65
		data.encode_s16(i * 2, int(clampf(lp, -1.0, 1.0) * 14000.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = rate
	wav.data = data
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_end = rate
	return wav


# --- Spray can ----------------------------------------------------------------------

const SPRAY_COLOR := Color(0.2, 0.78, 0.24)
const SPRAY_REACH := 3.0
var _spray_snd := 0.0
var _spray_last := Vector3.INF
var _spray_n := 0


## Paint where the can points, on whatever is there (walls, ground, cars,
## boxes): a round puff, bigger and softer the further off the can is. A
## sweep between frames is filled in so a fast stroke is still one line.
func _spray_tick(delta: float, on: bool) -> void:
	if not on:
		_spray_last = Vector3.INF
		return
	var from := cam.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_basis.z * SPRAY_REACH, Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS)
	var me: Array[RID] = [get_rid()]
	q.exclude = me
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if not hit.is_empty() and (hit.collider as Node).has_meta("humanoid"):
		# Someone got in the way (or was aimed at): paint all over his clothes.
		_spray_person(hit.collider, hit.position, hit.normal, from.distance_to(hit.position))
		_spray_last = Vector3.INF
		_spray_snd -= delta
		if _spray_snd <= 0.0:
			_spray_snd = 0.32
			Game.play_3d(Sfx.get_stream(&"spray"), _item_model.global_position if _item_model else from, -30.0, 0.1, 1.0, 4.0)
		return
	_spray_snd -= delta
	if _spray_snd <= 0.0:
		_spray_snd = 0.32
		Game.play_3d(Sfx.get_stream(&"spray"), _item_model.global_position if _item_model else from, -30.0, 0.1, 1.0, 4.0)
	if hit.is_empty():
		_spray_last = Vector3.INF
		return
	var p: Vector3 = hit.position
	var n: Vector3 = hit.normal
	var dist := from.distance_to(p)
	var radius := clampf(0.012 + dist * 0.018, 0.015, 0.05)
	var steps := 1
	if _spray_last != Vector3.INF and _spray_last.distance_to(p) < 0.4:
		steps = clampi(int(_spray_last.distance_to(p) / (radius * 0.6)), 1, 12)
	for i in steps:
		var at := p if steps == 1 else _spray_last.lerp(p, float(i + 1) / steps)
		var g = Graffiti.find(at, n)
		if g == null:
			g = Graffiti.new()
			get_parent().add_child(g)
			g.setup(at + n * 0.01, n, Vector2(1.6, 1.6))
		g.spray(g.wall_xy(at), SPRAY_COLOR, radius, 0.8)
		_spray_n += 1
	_spray_last = p


## Paint on a person: a soft green spot on the part hit (a decal that moves
## with it, only on people), and he takes it badly (bot_ai.sprayed).
static var _paint_tex: GradientTexture2D


func _spray_person(part: RigidBody3D, p: Vector3, n: Vector3, dist: float) -> void:
	var h = part.get_meta("humanoid")
	if h == null:
		return
	if h.ai:
		if not Net.bot_call(h, "net_ai", ["sprayed"]):
			h.ai.sprayed()
	if _paint_tex == null:
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 0.95))
		g.add_point(0.55, Color(1, 1, 1, 0.7))
		g.set_color(1, Color(1, 1, 1, 0.0))
		_paint_tex = GradientTexture2D.new()
		_paint_tex.gradient = g
		_paint_tex.fill = GradientTexture2D.FILL_RADIAL
		_paint_tex.fill_from = Vector2(0.5, 0.5)
		_paint_tex.fill_to = Vector2(0.5, 0.0)
		_paint_tex.width = 64
		_paint_tex.height = 64
	var spots: Array = h.get_meta("paint", [])
	var d: Decal
	if spots.size() >= 40:
		d = spots.pop_front()
		if not is_instance_valid(d):
			return
		d.get_parent().remove_child(d)
	else:
		d = Decal.new()
		d.texture_albedo = _paint_tex
		d.modulate = SPRAY_COLOR
		d.cull_mask = 2              # people only, not the wall behind him
		d.upper_fade = 0.2
		d.lower_fade = 0.2
	var r := clampf(0.03 + dist * 0.025, 0.035, 0.09)
	d.size = Vector3(r * 2.0, 0.25, r * 2.0)
	part.add_child(d)
	var nn := n.normalized()
	var helper := Vector3.UP if absf(nn.y) < 0.95 else Vector3.RIGHT
	var x := nn.cross(helper).normalized()
	d.global_transform = Transform3D(Basis(x, nn, x.cross(nn)), p)
	spots.append(d)
	h.set_meta("paint", spots)


## A can of green spray paint: the can, its shoulder, the nozzle.
static func spraycan_model() -> Node3D:
	var root := Node3D.new()
	var body := StandardMaterial3D.new()
	body.albedo_color = Color(0.1, 0.5, 0.15)
	body.metallic = 0.4
	body.roughness = 0.35
	var metal := StandardMaterial3D.new()
	metal.albedo_color = Color(0.75, 0.75, 0.72)
	metal.metallic = 0.9
	metal.roughness = 0.3
	var black := StandardMaterial3D.new()
	black.albedo_color = Color(0.05, 0.05, 0.05)
	var can := CylinderMesh.new()
	can.top_radius = 0.033
	can.bottom_radius = 0.033
	can.height = 0.19
	var shoulder := CylinderMesh.new()
	shoulder.top_radius = 0.014
	shoulder.bottom_radius = 0.033
	shoulder.height = 0.03
	var nozzle := BoxMesh.new()
	nozzle.size = Vector3(0.016, 0.016, 0.018)
	for m in [[can, body, Vector3.ZERO], [shoulder, metal, Vector3(0, 0.11, 0)], [nozzle, black, Vector3(0, 0.132, -0.012)]]:
		var mi := MeshInstance3D.new()
		mi.mesh = m[0]
		mi.material_override = m[1]
		mi.position = m[2]
		root.add_child(mi)
	# Upright in the hand, the nozzle on top pointing ahead at the wall.
	var holder := Node3D.new()
	holder.add_child(root)
	root.position = Vector3(0, -0.06, 0)
	root.rotation = Vector3(-0.15, 0, 0)
	return holder


## Drips from each open wound (the clothes hold some first), falling from
## where it is on the body.
func _drip_wounds() -> void:
	if Game.blood == null or _ragdoll:
		return
	var dt := get_process_delta_time()
	for w in vitals.wounds:
		var rate: float = w["rate"]
		if rate < 0.2 or float(w["soak"]) < 20.0:
			continue
		w["drip"] = float(w["drip"]) + rate * dt * 0.5
		if w["drip"] < 1.2:
			continue
		var f: Array = _body.wound_frame(w)
		if f.is_empty():
			continue
		var at: Vector3 = (f[0] as Vector3) + (f[2] as Vector3) * 0.04 + (f[1] as Vector3) * 0.02
		var me: Array[RID] = [get_rid()]
		Game.blood.spawn_drop(at, velocity + Vector3.DOWN * 0.2, w["drip"], me, 0.2, true)
		w["drip"] = 0.0


## G: lets go of what is in the hands - it drops in front, to be picked up
## again (by anyone).
func _drop_held() -> void:
	var id := ""
	if current and current.kind in HELD_ITEM:
		id = HELD_ITEM[current.kind]
	elif _item != "":
		id = _item
	if id == "" or not inventory.has(id):
		return
	for it in inventory.items:
		if it["id"] == id:
			if int(it["count"]) > 1:
				inventory.take(id)
				_after_losing(id)
				var fwd := -cam.global_basis.z
				var xf := Transform3D(Basis(Vector3.UP, yaw), cam.global_position + fwd * 0.6 + Vector3.DOWN * 0.3)
				Net.spawn_drop(get_parent(), false, id, 1, xf, velocity + fwd * 1.2 + Vector3.UP * 0.4)
			else:
				_drop_item(it)
			return


# --- The fire button ------------------------------------------------------------------

## A press of the left button that began in a menu (the bag, a double click
## that closed it) does not count here until it is let go.
var _fire_blocked := false
var _radial_mode := ""


func _fire_held() -> bool:
	if not Input.is_action_pressed("fire"):
		return false
	if not Game.is_mouse_captured() or (_inv_ui and _inv_ui.is_open) or (_radial and _radial.is_open):
		_fire_blocked = true
	return not _fire_blocked


func _fire_just() -> bool:
	return Input.is_action_just_pressed("fire") and _fire_held()


## The thrust: out along the line of sight fast, point first; what the point
## meets is run through (and the blade stays in while the button is held),
## then back.
func _machete_stab(delta: float, m, rmb: bool) -> void:
	var t := _mach_stab
	const OUT := 0.11
	var reach: float
	if t < OUT:
		reach = lerpf(0.2, 0.7, smoothstep(0.0, 1.0, t / OUT))
		_mach_stab += delta
	elif rmb or t < OUT + 0.12:
		reach = 0.7
		_mach_stab = maxf(_mach_stab + (0.0 if rmb else delta), OUT + 0.001)
	else:
		var k := clampf((t - OUT - 0.12) / 0.3, 0.0, 1.0)
		reach = lerpf(0.7, 0.3, smoothstep(0.0, 1.0, k))
		_mach_stab += delta
		if k >= 1.0:
			_mach_stab = -1.0
	_mach_theta = move_toward(_mach_theta, 0.02, delta * 14.0)
	_mach_mid = move_toward(_mach_mid, 1.0, delta * 10.0)
	var shoulder := Vector3(0.08, -0.2, 0.0)
	m.target = cam.global_transform * Transform3D(Basis(Vector3.RIGHT, _mach_theta), shoulder) * Transform3D(Basis(), Vector3(0, 0, -reach))
	m.hand_force = Machete.HAND_FORCE * 1.6
	m.drive(delta, Vector3.ZERO)
	# The point going in.
	if not _mach_stab_hit and t < OUT + 0.05:
		var a: Vector3 = m.blade_root()
		var b: Vector3 = m.blade_tip()
		var fwd := (b - a).normalized()
		var q := PhysicsRayQueryParameters3D.create(a, b + fwd * 0.05, Game.LAYER_BOTS)
		var hit := get_world_3d().direct_space_state.intersect_ray(q)
		if not hit.is_empty() and (hit.collider as Node).has_meta("humanoid"):
			_mach_stab_hit = true
			var part: RigidBody3D = hit.collider
			var h = part.get_meta("humanoid")
			h.receive_hit(part, hit.position, fwd, 6.0, "machete")
			Net.bot_call(h, "net_hit", [h.parts.find(part), hit.position, fwd, 6.0, "machete"])
			if Game.blood:
				Game.blood.open_jet(h, part, hit.position, -fwd, 18.0)
			Game.play_3d(Sfx.get_stream(&"flesh"), hit.position, -2.0, 0.1, 3.0)
			m._stick(part, 0.0)
			_kick_v -= 1.5


# --- Made things ---------------------------------------------------------------------------

## Something made at the crafting screen goes into the bag (with its timer).
## Down to the floor (or the table in front) to make `r` with the hands:
## craft_bench.gd. The notebook closes; what it takes is used up at the end.
func start_bench(r: Dictionary) -> bool:
	if bench != null:
		return false
	var b := CraftBench.new()
	get_parent().add_child(b)
	if not b.begin(self, r):
		b.queue_free()
		_notify("Негде разложиться: нужен пол или стол перед тобой")
		return false
	bench = b
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	# Both hands are needed: whatever was held is put away (and taken
	# back out after).
	var before: String = _item if _item != "" else (String(current.kind) if current else "")
	_last_switch = -10.0
	_switch_to("hands")
	b.done.connect(func(rec: Dictionary, extra: Dictionary):
		for id in rec["needs"]:
			inventory.take(id, int(rec["needs"][id]))
		for k in int(rec.get("count", 1)):
			_on_crafted(rec["id"], extra)
		_notify("Готово: " + String(rec["name"])))
	b.tree_exited.connect(func():
		bench = null
		cine_k = 0.0
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		if before != "":
			_last_switch = -10.0
			_switch_to(before))
	return true


func _on_crafted(id: String, extra: Dictionary) -> void:
	inventory.add(id, 1)
	for it in inventory.items:
		if it["id"] == id and not it.has("fuse"):
			for k in extra:
				it[k] = extra[k]
	Game.play_3d(Sfx.get_stream(&"key_press"), global_position, -8.0)


## The home-made bomb put down where one is looking; the clock starts.
func _place_pipe_bomb() -> void:
	var from := cam.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_basis.z * 2.2, Game.LAYER_WORLD | Game.LAYER_PROPS)
	var me: Array[RID] = [get_rid()]
	q.exclude = me
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty():
		return
	var fuse := 30.0
	for it in inventory.items:
		if it["id"] == "pipe_bomb":
			fuse = float(it.get("fuse", 30.0))
			break
	PipeBomb.place(get_parent(), hit.position, hit.normal, from, fuse)
	inventory.take("pipe_bomb")
	_notify("Таймер: %d с" % int(fuse))
	_after_losing("pipe_bomb")
	_item_cool = 0.7


# --- The mop ----------------------------------------------------------------------------------

var _mop_water := 1.0              # how wet the strings are (they dry out)
var _mop_dirt := 0.0               # how much blood they have taken up
var _mop_phase := 0.0
var _mop_head := Vector3.INF
var _mop_smear_t := 0.0
var _mop_splash_t := 0.0


## Held down, the left button mops: the head goes to and fro on the floor
## where one is looking. Wet, it takes the blood up (the strings go red);
## dry, or full of blood, it only drags it round into streaks. The water
## dries off by itself; the bucket (or a bottle of water) wets it again.
func _mop_tick(delta: float) -> void:
	var m = _item_model
	_mop_water = maxf(_mop_water - delta * 0.004, 0.0)
	var working: bool = _fire_held() and _held == null
	# Where the floor is, a little ahead of the feet, where one is looking.
	var fwd := -cam.global_basis.z
	var flat := Vector3(fwd.x, 0.0, fwd.z)
	flat = flat.normalized() if flat.length() > 0.05 else -Basis(Vector3.UP, yaw).z
	# (the spot on the floor one looks at, within reach of the arms)
	var look_down := maxf(-cam.global_basis.get_euler().x, 0.25)
	var dist := clampf((cam.global_position.y - global_position.y) / tan(look_down), 0.7, 1.15)
	var side := flat.cross(Vector3.UP)
	if working:
		_mop_phase += delta * TAU * 1.5
	var sweep := sin(_mop_phase) * (0.42 if working else 0.0)
	var want := global_position + flat * dist + side * sweep + Vector3.UP * 0.6
	var q := PhysicsRayQueryParameters3D.create(want, want + Vector3.DOWN * 1.8, Game.LAYER_WORLD | Game.LAYER_PROPS)
	var me: Array[RID] = [get_rid()]
	q.exclude = me
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	var head: Vector3 = hit.position if not hit.is_empty() else global_position + flat * dist
	var n: Vector3 = hit.normal if not hit.is_empty() else Vector3.UP
	var prev := _mop_head if _mop_head != Vector3.INF else head
	_mop_head = prev.lerp(head, minf(delta * 14.0, 1.0))
	# The handle comes up past the right hip, so it is seen slanting across
	# the view and not end-on.
	var top := cam.global_position + Vector3.DOWN * 0.7 + flat * 0.2 - side * 0.32
	m.pose(_mop_head, top)
	m.show_state(_mop_water, _mop_dirt)
	# The bucket: dunk it (click with the head in it) - clean and wet again.
	var bucket: Vector3 = Game.main.map.bucket_pos if Game.main and Game.main.map and "bucket_pos" in Game.main.map else Vector3.INF
	if bucket != Vector3.INF and _fire_just() and Vector2(_mop_head.x - bucket.x, _mop_head.z - bucket.z).length() < 0.6:
		# The blood in the strings goes into the water.
		var map = Game.main.map
		map.bucket_dirt = minf(map.bucket_dirt + _mop_dirt * 0.25, 1.0)
		if map.bucket_water:
			map.bucket_water.albedo_color = Color(0.1, 0.11, 0.11, 0.9).lerp(Color(0.22, 0.03, 0.02, 0.95), map.bucket_dirt)
		_mop_water = 1.0
		_mop_dirt = map.bucket_dirt * 0.3      # dirty water leaves the mop a little dirty too
		Game.play_3d(Sfx.get_stream(&"mop_dunk"), bucket, -2.0, 0.1, 2.0)
		_notify("Швабра чистая и мокрая")
		return
	if not working or Game.blood == null or n.y < 0.6:
		return
	# In (or over) the bucket it is not mopping the floor.
	if bucket != Vector3.INF and Vector2(_mop_head.x - bucket.x, _mop_head.z - bucket.z).length() < 0.35:
		return
	var moved := _mop_head - prev
	var speed := moved.length() / maxf(delta, 1e-4)
	if speed < 0.15:
		return
	var dir := moved.normalized()
	if _mop_water > 0.15 and _mop_dirt < 0.85:
		# Wet: the blood comes up into the strings.
		var took: float = Game.blood.wipe(_mop_head, n, 0.3, clampf(speed * delta * 6.0, 0.0, 0.6) * maxf(_mop_water, 0.4))
		_clean_at(_mop_head, n, 0.22, clampf(speed * delta * 1.5, 0.0, 0.25) * _mop_water)
		_blood_cleaned += took
		if _blood_cleaned >= 150.0:
			_blood_cleaned -= 150.0
			_paid(4, "кровь")
		_mop_dirt = minf(_mop_dirt + took * 0.003 + speed * delta * 0.0012, 1.0)
		_mop_water = maxf(_mop_water - speed * delta * 0.007, 0.0)
		_mop_splash_t -= delta
		if _mop_splash_t <= 0.0:
			_mop_splash_t = 0.45
			Game.play_3d(Sfx.get_stream(&"mop_swish"), _mop_head, -12.0, 0.15, 1.5)
		if _mop_dirt > 0.5:
			# Getting full: some of it goes back down as pink streaks.
			_mop_streak(n, dir, 0.08, 0.15 * _mop_dirt)
	else:
		# Dry (or saturated): it only pushes the blood round - streaks.
		if Game.blood.blood_near(_mop_head, 0.35) or _mop_dirt > 0.1:
			Game.blood.wipe(_mop_head, n, 0.14, 0.04)
			_mop_streak(n, dir, 0.25, 0.4)
			_mop_dirt = maxf(_mop_dirt - delta * 0.02, 0.0)


func _mop_streak(n: Vector3, dir: Vector3, thick: float, alpha: float) -> void:
	_mop_smear_t -= get_physics_process_delta_time()
	if _mop_smear_t > 0.0:
		return
	_mop_smear_t = 0.08
	Game.blood.smear(_mop_head - dir * 0.12, n, dir, randf_range(0.12, 0.22), randf_range(0.25, 0.45), thick, alpha)


# --- Gestures (Tab: "Привет", "Фак") ----------------------------------------------------------------

var _gesture := ""
var _gesture_t := 0.0
var _gesture_left := false
var _gesture_hand: Node3D


const GESTURE_TIME := 1.7


## Up goes the hand, at whoever one is looking at; the people there see it
## (bot_ai.gesture_seen).
func _start_gesture(kind: String) -> void:
	if _gesture != "" or _ragdoll or _dead:
		return
	_gesture = kind
	_gesture_t = 0.0
	# (the right hand if it is free, else the left)
	_gesture_left = current != null or _item != "" or _smoking.busy()
	if _gesture_hand:
		_gesture_hand.queue_free()
	_gesture_hand = _gesture_model(kind, _gesture_left)
	cam.add_child(_gesture_hand)
	_gesture_hand.visible = false
	# Who sees it: the one looked at (straight at him, not too far), and
	# anyone near enough who is looking this way.
	var fwd := -cam.global_basis.z
	var best: Node3D = null
	var best_a := deg_to_rad(20.0)
	var near: Node3D = null
	var near_d := 6.0
	var space := get_world_3d().direct_space_state
	for b in Game.bots:
		if not is_instance_valid(b) or not b.alive or not b.conscious:
			continue
		var to: Vector3 = b.head.global_position - cam.global_position
		var d: float = to.length()
		if d > 22.0:
			continue
		var q := PhysicsRayQueryParameters3D.create(cam.global_position, b.head.global_position, Game.LAYER_WORLD)
		if not space.intersect_ray(q).is_empty():
			continue
		var a := fwd.angle_to(to / d)
		if a < best_a:
			best_a = a
			best = b
		if a < deg_to_rad(50.0) and d < near_d:
			near_d = d
			near = b
	if best == null:
		best = near
	for b in Game.bots:
		if not is_instance_valid(b) or not b.alive or not b.conscious or b.ai == null:
			continue
		var d: float = b.head.global_position.distance_to(cam.global_position)
		var direct := b == best
		if not direct and d > 10.0:
			continue
		# (it reaches them a moment later: after the hand is up)
		get_tree().create_timer(0.35).timeout.connect(func():
			if is_instance_valid(b) and not Net.bot_call(b, "net_ai", ["gesture", [kind, direct]]):
				b.ai.gesture_seen(kind, self, direct))


func _gesture_tick(delta: float) -> void:
	if _gesture == "":
		return
	_gesture_t += delta
	var t := _gesture_t
	var up := smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(GESTURE_TIME - 0.3, GESTURE_TIME, t))
	var sx := -1.0 if _gesture_left else 1.0
	var low := Vector3(0.25 * sx, -0.55, -0.25)
	var high := Vector3(0.1 * sx, -0.06, -0.42)
	var pos := low.lerp(high, up)
	var rot := Vector3(0.1, 0.0, 0.0)
	if _gesture == "wave":
		rot.z = sin(t * 11.0) * 0.4 * up
		pos.x += sin(t * 11.0) * 0.03 * up
	else:
		pos += Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * 0.002 * up
		rot.y = PI                       # the back of the hand to them
	_gesture_hand.visible = up > 0.02
	_gesture_hand.position = pos
	_gesture_hand.rotation = rot
	if t >= GESTURE_TIME:
		_gesture = ""
		_gesture_hand.queue_free()
		_gesture_hand = null


## The arm of the body reaches for the gesturing hand.
func _gesture_arm(hands: Array, dirs: Array) -> void:
	if _gesture == "" or _gesture_hand == null or not _gesture_hand.visible:
		return
	var i := 1 if _gesture_left else 0
	hands[i] = _gesture_hand.global_transform * Vector3(0, -0.08, 0.0)
	dirs[i] = _gesture_hand.global_basis.y
	if _body and _body._ball.has("hand_" + ("l" if _gesture_left else "r")):
		_body._ball["hand_" + ("l" if _gesture_left else "r")].visible = false


## A hand held up: an open palm (a wave), or a fist with the middle finger
## up; blocky, like the rest of the body, the sleeve behind the wrist.
static func _gesture_model(kind: String, left: bool) -> Node3D:
	var root := Node3D.new()
	var skin := StandardMaterial3D.new()
	skin.albedo_color = Color(0.84, 0.66, 0.54)
	skin.roughness = 0.6
	var sleeve := StandardMaterial3D.new()
	sleeve.albedo_color = Color(0.12, 0.13, 0.15)
	sleeve.roughness = 0.9
	var add := func(size: Vector3, pos: Vector3, mat: Material, rot := Vector3.ZERO) -> void:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = size
		mi.mesh = bm
		mi.material_override = mat
		mi.position = pos
		mi.rotation = rot
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(mi)
	add.call(Vector3(0.078, 0.08, 0.03), Vector3(0, 0, 0), skin)
	add.call(Vector3(0.09, 0.2, 0.08), Vector3(0, -0.15, 0.01), sleeve)
	var s := -1.0 if left else 1.0
	for f in 4:
		var x := (-0.029 + f * 0.0195) * s
		if kind == "wave":
			var h: float = [0.06, 0.072, 0.068, 0.052][f]
			add.call(Vector3(0.016, h, 0.018), Vector3(x, 0.04 + h * 0.5, 0), skin, Vector3(0, 0, (f - 1.5) * -0.08 * s))
		elif f == 1:
			add.call(Vector3(0.016, 0.075, 0.018), Vector3(x, 0.077, 0), skin)
		else:
			add.call(Vector3(0.016, 0.03, 0.028), Vector3(x, 0.045, 0.012), skin)
	if kind == "wave":
		add.call(Vector3(0.045, 0.018, 0.018), Vector3(0.055 * s, 0.0, 0.0), skin, Vector3(0, 0, 0.5 * s))
	else:
		add.call(Vector3(0.035, 0.018, 0.02), Vector3(0.03 * s, 0.005, 0.014), skin)
	return root


# --- Talking with people (dialog_ui.gd) ---------------------------------------------------------------

func open_dialog(b: Node3D, line := "", page := "main") -> void:
	if is_busy():
		return
	_dialog_ui.open(b, line, page)


## In the middle of something that a talk should not break into.
func is_busy() -> bool:
	return _dialog_ui.is_open or _inv_ui.is_open or _craft_ui.is_open or _shop_ui.is_open or _radial.is_open or bench != null \
			or roulette != null or _ragdoll != null or _dead


# --- The sponge, and being paid for cleaning up -------------------------------------------------------------

var _sponge_on := false            # held against a surface (LMB): the mouse rubs
var _sponge_at := Vector3.INF      # where on the surface (world)
var _sponge_n := Vector3.UP
var _sponge_off := Vector2.ZERO    # moved about on the surface from where it was put (m)
var _sponge_dirt := 0.0            # 0..1: how filthy it has got
var _sponge_scrubbed := 0.0        # distance rubbed this frame (m)
var _blood_cleaned := 0.0


## Held down (LMB) on a wall or a floor within reach: the view holds still
## and the mouse moves the sponge over it, to and fro. Paint, dirt and blood
## come off where it rubs (the faster, the more); a dirty sponge does less -
## rinse it in the bucket (LMB with it over the bucket).
func _sponge_tick(delta: float) -> Array:
	var hold := Vector3(0.18, -0.22, -0.38)
	var rot := Vector3(0.3, 0.0, 0.0)
	var pressing: bool = _fire_held() and _held == null
	if not pressing:
		_sponge_on = false
		_sponge_at = Vector3.INF
		return [hold, rot]
	if not _sponge_on:
		var from := cam.global_position
		var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_basis.z * 1.15, Game.LAYER_WORLD | Game.LAYER_PROPS)
		var me: Array[RID] = [get_rid()]
		q.exclude = me
		var hit := get_world_3d().direct_space_state.intersect_ray(q)
		if hit.is_empty():
			return [hold, rot]
		# The bucket: rinse it.
		var bucket: Vector3 = Game.main.map.bucket_pos if Game.main and Game.main.map and "bucket_pos" in Game.main.map else Vector3.INF
		if bucket != Vector3.INF and (hit.position as Vector3).distance_to(bucket + Vector3.UP * 0.2) < 0.45:
			_sponge_dirt = 0.0
			Game.play_3d(Sfx.get_stream(&"mop_dunk"), bucket, -6.0, 0.1, 2.0)
			_notify("Губка чистая")
			_item_cool = 0.6
			return [hold, rot]
		_sponge_on = true
		_sponge_at = hit.position
		_sponge_n = hit.normal
		_sponge_off = Vector2.ZERO
	# The sponge where it is on the surface, flat against it.
	var n := _sponge_n
	var x := Vector3.UP.cross(n)
	x = x.normalized() if x.length() > 0.1 else cam.global_basis.x
	var y := n.cross(x)
	var at := _sponge_at + x * _sponge_off.x + y * _sponge_off.y + n * 0.03
	if at.distance_to(cam.global_position) > 1.3:
		_sponge_on = false
		return [hold, rot]
	var local := cam.global_transform.affine_inverse() * at
	var lb := cam.global_basis.inverse() * Basis(x, n, -y)
	# Scrub, by how far it went this frame.
	var rubbed := _sponge_scrubbed
	_sponge_scrubbed = 0.0
	if rubbed > 0.0005:
		var amount := clampf(rubbed * 6.0, 0.0, 0.5) * lerpf(1.0, 0.25, _sponge_dirt)
		var took := _clean_at(at - n * 0.03, n, 0.09, amount)
		if Game.blood:
			Game.blood.wipe(at - n * 0.03, n, 0.1, amount * 0.6)
		_sponge_dirt = minf(_sponge_dirt + took * 0.00002 + rubbed * 0.004, 1.0)
		_scrub_snd -= delta
		if _scrub_snd <= 0.0:
			_scrub_snd = 0.25
			Game.play_3d(Sfx.get_stream(&"mop_swish"), at, -18.0, 0.2, 1.2)
	if _item_model and _item_model.has_method("show_dirt"):
		_item_model.show_dirt(_sponge_dirt)
	return [local, lb.get_euler()]


var _scrub_snd := 0.0


func _sponge_rub(rel: Vector2) -> void:
	var d := rel * 0.0012 * Game.mouse_sens
	var before := _sponge_off
	_sponge_off = (_sponge_off + Vector2(d.x, -d.y)).limit_length(0.6)
	_sponge_scrubbed += (_sponge_off - before).length()


## Takes dirt / paint off whatever patch is at `p` on the surface facing `n`;
## a patch cleaned (nearly) off pays. Returns how much came off.
func _clean_at(p: Vector3, n: Vector3, radius: float, amount: float) -> float:
	var g = Graffiti.find(p, n, 0.0)
	if g == null or g._gone:
		return 0.0
	var before: float = g.left_fraction() if g._total >= 0.0 else 1.0
	var left: float = g.scrub(g.wall_xy(p), radius, amount)
	if left < 0.25:
		g.finish()
		_paid(g.reward, {"soot": "копоть", "mud": "грязь", "grime": "подтёки", "rust": "ржавчина", "mud_floor": "грязь",
				"prints": "следы", "oil": "масло"}.get(g.dirt_kind, "граффити"))
	return maxf(before - left, 0.0) * 1000.0


func _paid(n: int, what: String) -> void:
	inventory.add("money", n)
	_notify("Отмыл: %s  +%d ₽" % [what, n])
	Game.play_3d(Sfx.get_stream(&"item_pickup"), global_position, -10.0, 0.05, 1.0)


## A kitchen sponge: yellow foam, the green scouring side on top.
static func sponge_model() -> Node3D:
	var root := Node3D.new()
	root.set_script(load("res://scripts/player/sponge.gd"))
	return root


## Up off the chair: the eyes rise, a step back from it, turned away.
func rise_from_seat() -> void:
	if seat_at == Vector3.INF or _seat_rise_t >= 0.0:
		return
	cine_busy = true
	_seat_rise_t = 0.0
	_rise_from = seat_at
	_rise_to = _seat_stand if _seat_stand != Vector3.INF else seat_at - Basis(Vector3.UP, yaw).z * -0.6
	_seat_stand = Vector3.INF
	var back := _rise_to - _rise_from
	back.y = 0.0
	_rise_yaw = atan2(back.x, back.z) if back.length() > 0.05 else yaw


## Hours went by while one slept: everyone free has been living his life -
## he is somewhere else now, doing something else.
func _hours_pass(hours: float) -> void:
	if Net.active and not Net.is_host:
		return                         # (the host's people: they go on there)
	for b in Game.bots:
		if is_instance_valid(b) and b.ai:
			b.ai.time_passes(hours)
