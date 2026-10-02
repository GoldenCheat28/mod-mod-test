class_name Weapon
extends Node3D
## Оружие-«брусок» от первого лица: стрельба лучом, отдача на пружинах, покачивание,
## прицеливание, перезарядка и все мелкие эффекты выстрела.

signal ammo_changed(ammo: int, mag_size: int)
signal hit_confirmed(killed: bool, headshot: bool)

const HIT_MASK := 1 | 4 | 8 | 16   # world, bot, props, ragdoll

@export_group("Стрельба")
@export var fire_rate := 650.0          # выстрелов в минуту
@export var mag_size := 30
@export var damage := 34.0
@export var impulse := 9.0              # толчок пули, Н·с (реальная ~7)
@export var max_range := 400.0
@export var reload_time := 2.0
@export var tracer_every := 3

@export_group("Разброс, градусы")
@export var hip_spread := 1.6
@export var ads_spread := 0.12
@export var move_spread := 2.0
@export var air_spread := 4.0
@export var bloom_per_shot := 0.3

@export_group("Отдача")
@export var recoil_pitch := 0.75        # градусы вверх за выстрел
@export var recoil_yaw := 0.3

@export_group("Положение")
@export var hip_position := Vector3(0.17, -0.19, -0.42)
@export var ads_position := Vector3(0.0, -0.068, -0.26)

var ammo := 30
var reloading := false
var holstered := false                  # руки заняты предметом
var aim_t := 0.0                        # 0 = от бедра, 1 = прицел
var current_spread := 0.0

var _player: Node
var _cooldown := 0.0
var _shots := 0
var _bloom := 0.0
var _need_release := false

# Пружины отдачи.
var _kick_pos := Vector3.ZERO
var _kick_pos_v := Vector3.ZERO
var _kick_rot := Vector3.ZERO
var _kick_rot_v := Vector3.ZERO
var _sway := Vector2.ZERO
var _sway_target := Vector2.ZERO
var _bob_t := 0.0
var _holster_t := 0.0
var _sprint_t := 0.0
var _retract_t := 0.0
var _reload_pose := 0.0

var _flash_root: Node3D
var _flash_mat: ShaderMaterial
var _flash_side_mat: ShaderMaterial
var _flash_light: OmniLight3D
var _flash_timer := 0.0
var _flash_frames := 0

@onready var _model: Node3D = $Model
@onready var _muzzle: Marker3D = $Model/Muzzle
@onready var _eject: Marker3D = $Model/Eject
@onready var _mag: MeshInstance3D = $Model/Mag
@onready var _mag_rest: Transform3D = $Model/Mag.transform


func _ready() -> void:
	_player = get_parent()
	while _player and not _player is CharacterBody3D:
		_player = _player.get_parent()
	ammo = mag_size
	position = hip_position
	_build_flash()
	ammo_changed.emit.call_deferred(ammo, mag_size)


func _physics_process(delta: float) -> void:
	_cooldown = maxf(_cooldown - delta, 0.0)
	_bloom = maxf(_bloom - delta * 4.0, 0.0)

	var captured := Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
	var pressed := captured and Input.is_action_pressed("shoot")
	if holstered:
		_need_release = true
	elif _need_release and not pressed:
		_need_release = false

	if pressed and not _need_release and not holstered and not reloading:
		if ammo > 0:
			if _cooldown <= 0.0 and _retract_t < 0.6:
				_fire()
		elif Input.is_action_just_pressed("shoot"):
			Sfx.play("dry", -6.0)
			reload()
	if not pressed:
		_shots = 0

	if Input.is_action_just_pressed("reload"):
		reload()


func _process(delta: float) -> void:
	var sprinting: bool = _player.is_sprinting() if _player else false
	var aiming := captured_and_pressed("aim") and not sprinting and not reloading and not holstered
	aim_t = move_toward(aim_t, 1.0 if aiming else 0.0, delta * 7.0)
	_holster_t = move_toward(_holster_t, 1.0 if holstered else 0.0, delta * 5.0)
	_sprint_t = lerpf(_sprint_t, 1.0 if sprinting and not holstered else 0.0, 1.0 - exp(-8.0 * delta))
	_update_retract(delta)
	_update_spread()

	# Пружины отдачи. Мелкими шагами, чтобы не «взрывались» при просадке FPS.
	var t := delta
	while t > 0.0:
		var h := minf(t, 1.0 / 240.0)
		_kick_pos_v += (-_kick_pos * 220.0 - _kick_pos_v * 20.0) * h
		_kick_pos += _kick_pos_v * h
		_kick_rot_v += (-_kick_rot * 160.0 - _kick_rot_v * 16.0) * h
		_kick_rot += _kick_rot_v * h
		t -= h

	# Инерция от мыши.
	_sway_target = _sway_target.lerp(Vector2.ZERO, 1.0 - exp(-10.0 * delta))
	_sway = _sway.lerp(_sway_target, 1.0 - exp(-14.0 * delta))

	# Покачивание при ходьбе.
	var bob := Vector3.ZERO
	if _player:
		var v: Vector3 = _player.velocity
		var hs := Vector2(v.x, v.z).length()
		if _player.is_on_floor() and hs > 0.3:
			_bob_t += delta * hs * 1.8
		var amt := clampf(hs / 5.0, 0.0, 1.5) * (1.0 - aim_t * 0.85)
		bob = Vector3(cos(_bob_t) * 0.008, -absf(sin(_bob_t)) * 0.01, 0.0) * amt

	var ease_aim := aim_t * aim_t * (3.0 - 2.0 * aim_t)
	var pos := hip_position.lerp(ads_position, ease_aim) + bob + _kick_pos * (1.0 - ease_aim * 0.6)
	pos += Vector3(-0.04, -0.06, 0.02) * _sprint_t
	pos += Vector3(0.0, -0.28, 0.08) * _holster_t
	pos += Vector3(0.0, -0.02, 0.12) * _retract_t
	pos += Vector3(0.0, -0.03, 0.0) * _reload_pose
	position = pos

	var sway_k := 1.0 - ease_aim * 0.7
	rotation = Vector3(
		_kick_rot.x + _sway.y * sway_k - 0.35 * _sprint_t - 0.7 * _holster_t - 0.25 * _retract_t - 0.25 * _reload_pose,
		_kick_rot.y + _sway.x * sway_k + 0.55 * _sprint_t + 0.5 * _retract_t,
		_kick_rot.z + _sway.x * 0.5 * sway_k + 0.25 * _sprint_t + 0.55 * _reload_pose)

	# Вспышка живёт 1–2 кадра.
	# Вспышка живёт ~30 мс, но минимум один отрисованный кадр.
	if _flash_root.visible:
		_flash_timer -= delta
		_flash_frames -= 1
		if _flash_timer <= 0.0 and _flash_frames < 0:
			_flash_root.visible = false
	_flash_light.light_energy = move_toward(_flash_light.light_energy, 0.0, delta * 60.0)


func captured_and_pressed(action: String) -> bool:
	return Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and Input.is_action_pressed(action)


func add_sway(mouse_rel: Vector2) -> void:
	_sway_target += mouse_rel * 0.0007
	_sway_target = _sway_target.clamp(Vector2(-0.08, -0.08), Vector2(0.08, 0.08))


## Толчок оружия при приземлении/прыжке.
func land(strength: float) -> void:
	_kick_pos_v += Vector3(0.0, -strength * 0.9, 0.0)
	_kick_rot_v += Vector3(-strength * 3.0, 0.0, randf_range(-1.0, 1.0) * strength)


func reload() -> void:
	if reloading or ammo == mag_size or holstered:
		return
	reloading = true
	var tw := create_tween()
	tw.tween_property(self, "_reload_pose", 1.0, 0.25).set_trans(Tween.TRANS_SINE)
	tw.tween_callback(func() -> void: Sfx.play("mag_out", -4.0))
	tw.tween_property(_mag, "position", _mag_rest.origin + Vector3(0.0, -0.25, 0.05), 0.2) \
		.set_ease(Tween.EASE_IN)
	tw.tween_interval(reload_time * 0.3)
	tw.tween_property(_mag, "position", _mag_rest.origin, 0.25).set_ease(Tween.EASE_OUT)
	tw.tween_callback(func() -> void:
		Sfx.play("mag_in", -4.0)
		_kick_pos_v += Vector3(0.0, 0.25, 0.0))
	tw.tween_interval(reload_time * 0.15)
	tw.tween_callback(func() -> void:
		Sfx.play("bolt", -6.0)
		_kick_pos_v += Vector3(0.0, 0.0, 0.3)
		_kick_rot_v += Vector3(0.0, 0.0, -2.0))
	tw.tween_property(self, "_reload_pose", 0.0, 0.3).set_trans(Tween.TRANS_SINE)
	tw.tween_callback(func() -> void:
		ammo = mag_size
		reloading = false
		ammo_changed.emit(ammo, mag_size))


# --- выстрел ------------------------------------------------------------------

func _fire() -> void:
	ammo -= 1
	_cooldown += 60.0 / fire_rate
	_shots += 1
	ammo_changed.emit(ammo, mag_size)

	var cam: Camera3D = _player.camera
	var cb := cam.global_basis
	var spread := deg_to_rad(current_spread) * sqrt(randf())
	var ang := randf() * TAU
	var dir := (-cb.z + (cb.x * cos(ang) + cb.y * sin(ang)) * tan(spread)).normalized()
	var end := _trace(cam.global_position, dir)

	_bloom = minf(_bloom + bloom_per_shot, 3.0)
	_muzzle_effects()
	if tracer_every > 0 and _shots % tracer_every == 1:
		FX.tracer(_muzzle.global_position, end)
	FX.eject_shell(_eject.global_position, _model.global_basis, _player.velocity)
	Sfx.play("shot", -2.0, 0.07)

	# Отдача: оружие назад и вверх, камера вверх (частично возвращается сама).
	var ads_k := 1.0 - aim_t * 0.45
	_kick_pos_v += Vector3(randf_range(-0.02, 0.02), 0.03, 0.55) * ads_k
	_kick_rot_v += Vector3(randf_range(0.8, 1.3), randf_range(-0.4, 0.4), randf_range(-0.8, 0.8)) * ads_k
	var climb := 1.0 + minf(_shots, 8) * 0.05
	_player.add_recoil(deg_to_rad(recoil_pitch * climb * ads_k),
		deg_to_rad(randf_range(-recoil_yaw, recoil_yaw * 1.4) * ads_k))


## Пускает луч, обрабатывает попадание и возвращает конечную точку (для трассера).
func _trace(origin: Vector3, dir: Vector3) -> Vector3:
	var space: PhysicsDirectSpaceState3D = _player.get_world_3d().direct_space_state
	var exclude: Array[RID] = [_player.get_rid()]
	for attempt in 4:
		var q := PhysicsRayQueryParameters3D.create(origin, origin + dir * max_range, HIT_MASK, exclude)
		var r := space.intersect_ray(q)
		if r.is_empty():
			return origin + dir * max_range
		var col: Object = r.collider
		var pos: Vector3 = r.position
		var n: Vector3 = r.normal

		if col is Bot:
			var h: Dictionary = col.trace_parts(origin, dir)
			if h.is_empty():
				exclude.append(col.get_rid())     # прошла мимо тела внутри капсулы бота
				continue
			var res: Dictionary = col.take_hit(h.part, h.position, h.normal, dir, damage, impulse * 3.0)
			if not res.is_empty():
				hit_confirmed.emit(res.killed, res.part == "head")
			return h.position
		elif col is RigidBody3D and col.is_in_group("flesh"):
			FX.blood_hit(pos, n, dir, col)
			col.apply_impulse(dir * impulse * 2.0, pos - col.global_position)
			hit_confirmed.emit(false, false)
		elif col is RigidBody3D:
			FX.impact(pos, n, dir, col, col.surface if col is Prop else "concrete")
			col.apply_impulse(dir * impulse, pos - col.global_position)
		else:
			FX.impact(pos, n, dir, col as Node, "concrete")
		return pos
	return origin + dir * max_range


func _update_spread() -> void:
	var s := lerpf(hip_spread, ads_spread, aim_t)
	if _player:
		var v: Vector3 = _player.velocity
		s += clampf(Vector2(v.x, v.z).length() / 6.0, 0.0, 1.0) * move_spread * (1.0 - aim_t * 0.7)
		if not _player.is_on_floor():
			s += air_spread
	current_spread = s + _bloom * (1.0 - aim_t * 0.6)


## Если упёрлись в стену, ствол отводится в сторону, а не проходит сквозь неё.
func _update_retract(delta: float) -> void:
	var target := 0.0
	if _player:
		var cam: Camera3D = _player.camera
		var from := cam.global_position
		var q := PhysicsRayQueryParameters3D.create(from, from - cam.global_basis.z * 0.8, 1 | 8, [_player.get_rid()])
		var r: Dictionary = _player.get_world_3d().direct_space_state.intersect_ray(q)
		if not r.is_empty():
			target = 1.0 - from.distance_to(r.position) / 0.8
	_retract_t = lerpf(_retract_t, target, 1.0 - exp(-12.0 * delta))


# --- вспышка ------------------------------------------------------------------

func _build_flash() -> void:
	var shader: Shader = load("res://shaders/muzzle_flash.gdshader")
	_flash_mat = ShaderMaterial.new()
	_flash_mat.shader = shader
	_flash_side_mat = ShaderMaterial.new()
	_flash_side_mat.shader = shader
	_flash_side_mat.set_shader_parameter("intensity", 0.8)

	_flash_root = Node3D.new()
	_flash_root.visible = false
	_muzzle.add_child(_flash_root)

	var front := MeshInstance3D.new()      # «звезда», видна при взгляде вдоль ствола
	var fq := QuadMesh.new()
	fq.size = Vector2(0.15, 0.15)
	fq.material = _flash_mat
	front.mesh = fq
	_flash_root.add_child(front)

	for i in 2:                            # два языка пламени крестом
		var side := MeshInstance3D.new()
		var sq := QuadMesh.new()
		sq.size = Vector2(0.26, 0.09)
		sq.material = _flash_side_mat
		side.mesh = sq
		side.transform = Transform3D(Basis(Vector3.FORWARD, PI * 0.5 * i) * Basis(Vector3.UP, PI * 0.5),
			Vector3(0, 0, -0.12))
		_flash_root.add_child(side)

	for mi: MeshInstance3D in _flash_root.get_children():
		mi.layers = 4
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

	_flash_light = OmniLight3D.new()
	_flash_light.light_color = Color(1.0, 0.68, 0.38)
	_flash_light.omni_range = 6.0
	_flash_light.light_energy = 0.0
	_flash_light.shadow_enabled = false
	_muzzle.add_child(_flash_light)
	_flash_light.position = Vector3(0, 0, -0.05)


func _muzzle_effects() -> void:
	_flash_mat.set_shader_parameter("seed", randf())
	_flash_side_mat.set_shader_parameter("seed", randf())
	_flash_root.visible = true
	_flash_root.rotation.z = randf() * TAU
	_flash_root.scale = Vector3.ONE * randf_range(0.75, 1.2)
	_flash_timer = 0.03
	_flash_frames = 1
	_flash_light.light_energy = randf_range(2.0, 3.0)
	FX.muzzle_smoke(_muzzle.global_position, -_muzzle.global_basis.z)
