extends Control
## HUD: прицел, рука при подборе, патроны, подсказки.
## Свои иконки руки подставь в hand_open / hand_closed (инспектор узла HUD).
## Если у тебя одна иконка, оставь hand_closed пустым: рука будет просто «сжиматься».

@export var hand_open: Texture2D
@export var hand_closed: Texture2D
@export var hand_size := 56.0

var _player: Player
var _holding := false
var _hand_tween: Tween

@onready var _crosshair: Control = $Crosshair
@onready var _hand: TextureRect = $Hand
@onready var _hint: Label = $Hint
@onready var _ammo: Label = $Ammo
@onready var _help: Label = $Help
@onready var _fps: Label = $Fps


func _ready() -> void:
	_hand.visible = false
	_hint.visible = false
	_hand.texture = hand_open
	var half := hand_size * 0.5
	_hand.offset_left = -half
	_hand.offset_top = -half
	_hand.offset_right = half
	_hand.offset_bottom = half
	_hand.pivot_offset = Vector2(half, half)
	_connect.call_deferred()


func _connect() -> void:
	_player = get_tree().get_first_node_in_group("player") as Player
	if _player == null:
		return
	_player.grabber.hover_changed.connect(_on_hover)
	_player.grabber.grab_changed.connect(_on_grab)
	_player.weapon.ammo_changed.connect(_on_ammo)
	_player.weapon.hit_confirmed.connect(_crosshair.hit)
	_on_ammo(_player.weapon.ammo, _player.weapon.mag_size)


func _process(_delta: float) -> void:
	_fps.text = "%d FPS" % Engine.get_frames_per_second()
	if _player:
		_crosshair.spread_deg = _player.weapon.current_spread
		_crosshair.fov_deg = _player.camera.fov
		var show_cross := not _holding and not _player.grabber.hovering and _player.weapon.aim_t < 0.7
		_crosshair.visible = show_cross
		if _player.weapon.reloading:
			_ammo.text = "перезарядка…"


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_help"):
		_help.visible = not _help.visible


func _on_hover(can_grab: bool) -> void:
	if _holding:
		return
	_hand.visible = can_grab
	_hint.visible = can_grab
	_hand.texture = hand_open
	_animate_hand(1.0, 0.9)


func _on_grab(holding: bool) -> void:
	_holding = holding
	_hint.visible = false
	if holding:
		_hand.visible = true
		_hand.texture = hand_closed if hand_closed else hand_open
		_animate_hand(0.8 if hand_closed == null else 0.9, 1.0)   # «зажимается»
	else:
		_hand.texture = hand_open
		_animate_hand(1.0, 0.9)
		_hand.visible = _player.grabber.hovering


func _animate_hand(scale_to: float, alpha: float) -> void:
	if _hand_tween:
		_hand_tween.kill()
	_hand_tween = create_tween().set_parallel()
	_hand_tween.tween_property(_hand, "scale", Vector2.ONE * scale_to, 0.12) \
		.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_hand_tween.tween_property(_hand, "modulate:a", alpha, 0.12)


func _on_ammo(ammo: int, mag: int) -> void:
	_ammo.text = "%d / %d" % [ammo, mag]
	_ammo.modulate = Color(1, 0.35, 0.3) if ammo <= mag / 5 else Color.WHITE
