extends Node3D
# Штурмовая винтовка: собрана из деталей, с руками и анимациями (выстрел: затвор/отдача/вспышка/гильза;
# перезарядка: наклон, снятие магазина, новый магазин, передёргивание). Звуки синтезируются (fx/sfx.gd).

signal ammo_changed(ammo: int, reserve: int)

@export var damage := 22.0
@export var fire_rate := 0.095
@export var mag_size := 30
@export var spread := 0.012

var ammo := 30
var reserve := 120
var cooldown := 0.0
var reloading := false
var kick := 0.0
var sway := Vector2.ZERO
var bob_t := 0.0
var bob_amp := 0.0
var flash_t := 0.0
var bolt_t := 0.0
var sprint_blend := 0.0
# параметры анимации перезарядки (твинятся)
var r_tilt := 0.0
var r_mag := 0.0
var hand_mag := 0.0
var hand_bolt := 0.0
var r_bolt := 0.0

var base_pos := Vector3(0.17, -0.2, -0.38)
const HAND_REST := Vector3(-0.01, -0.07, -0.27)
const HAND_BOLT := Vector3(0.045, 0.045, -0.02)
const MAG_BASE := Vector3(0.0, -0.125, -0.045)
const BOLT_BASE := Vector3(0.036, 0.04, -0.05)

var ray: RayCast3D
var head: Node3D
var player: CharacterBody3D
var flash: OmniLight3D
var flash_mesh: MeshInstance3D
var mag: Node3D
var bolt: Node3D
var hand_l: Node3D
var sfx_players: Array[AudioStreamPlayer] = []
var sfx_i := 0
var casings: Array = []     # {node, vel, life}
var _casing_mesh: CylinderMesh
var _casing_mat: StandardMaterial3D

func _ready() -> void:
	ray = get_parent().get_node("RayCast3D")
	head = get_parent().get_parent()
	player = head.get_parent()
	ammo = mag_size
	position = base_pos
	_build_model()
	for i in 6:
		var a := AudioStreamPlayer.new()
		add_child(a)
		sfx_players.append(a)
	ammo_changed.emit.call_deferred(ammo, reserve)

# ---------- модель ----------
func _box(parent: Node3D, size: Vector3, pos: Vector3, mat: Material, rot := Vector3.ZERO) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	m.mesh = b
	m.position = pos
	m.rotation = rot
	m.material_override = mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(m)
	return m

func _cyl(parent: Node3D, r: float, h: float, pos: Vector3, mat: Material, along_z := true) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = r
	c.bottom_radius = r
	c.height = h
	c.radial_segments = 12
	m.mesh = c
	m.position = pos
	if along_z:
		m.rotation = Vector3(PI / 2.0, 0, 0)
	m.material_override = mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(m)
	return m

func _build_model() -> void:
	var metal := Mats.get_mat("gun_dark", Color(0.2, 0.21, 0.23), 0.4, 0.8, 4.0)
	var steel := Mats.get_mat("gun_grey", Color(0.45, 0.46, 0.48), 0.35, 0.9, 4.0)
	var poly := Mats.get_mat("polymer", Color(0.16, 0.16, 0.17), 0.65, 0.1, 4.0)
	var glove := Mats.get_mat("glove", Color(0.42, 0.34, 0.24), 0.85, 0.0, 3.0)
	var sleeve := Mats.get_mat("sleeve", Color(0.30, 0.35, 0.27), 0.9, 0.0, 3.0)
	# корпус
	_box(self, Vector3(0.052, 0.075, 0.28), Vector3(0, 0, 0), metal)                    # нижняя часть ресивера
	_box(self, Vector3(0.05, 0.03, 0.27), Vector3(0, 0.05, -0.005), steel)               # крышка ресивера
	_box(self, Vector3(0.056, 0.07, 0.2), Vector3(0, -0.002, -0.235), poly)              # цевьё
	_box(self, Vector3(0.05, 0.012, 0.18), Vector3(0, 0.04, -0.24), poly)                # верхняя накладка
	_cyl(self, 0.011, 0.3, Vector3(0, 0.015, -0.46), steel)                              # ствол
	_cyl(self, 0.007, 0.22, Vector3(0, 0.052, -0.36), steel)                             # газовая трубка
	_cyl(self, 0.02, 0.07, Vector3(0, 0.015, -0.62), metal)                              # пламегаситель
	_box(self, Vector3(0.006, 0.03, 0.006), Vector3(0, 0.045, -0.56), metal)             # мушка
	_box(self, Vector3(0.03, 0.025, 0.012), Vector3(0, 0.075, 0.1), metal)               # целик
	_box(self, Vector3(0.05, 0.09, 0.16), Vector3(0, -0.005, 0.2), poly)                 # приклад
	_box(self, Vector3(0.052, 0.1, 0.03), Vector3(0, -0.005, 0.29), glove)               # затыльник
	_box(self, Vector3(0.042, 0.1, 0.045), Vector3(0, -0.095, 0.085), poly, Vector3(0.28, 0, 0))   # рукоять
	_box(self, Vector3(0.012, 0.03, 0.09), Vector3(0, -0.055, 0.025), metal)             # спусковая скоба
	# магазин (отдельный узел для анимации)
	mag = Node3D.new()
	mag.position = MAG_BASE
	add_child(mag)
	_box(mag, Vector3(0.036, 0.15, 0.065), Vector3(0, -0.02, 0), metal, Vector3(0.14, 0, 0))
	_box(mag, Vector3(0.04, 0.012, 0.07), Vector3(0, 0.055, 0), steel)
	# затвор / рукоять взведения
	bolt = Node3D.new()
	bolt.position = BOLT_BASE
	add_child(bolt)
	_box(bolt, Vector3(0.016, 0.018, 0.045), Vector3.ZERO, steel)
	_box(bolt, Vector3(0.026, 0.012, 0.012), Vector3(0.01, 0, 0.012), metal)
	# правая рука на рукояти
	var hand_r := Node3D.new()
	hand_r.position = Vector3(0.0, -0.105, 0.08)
	add_child(hand_r)
	_box(hand_r, Vector3(0.062, 0.07, 0.07), Vector3.ZERO, glove, Vector3(0.28, 0, 0))
	_box(hand_r, Vector3(0.062, 0.062, 0.45), Vector3(0.06, -0.05, 0.3), sleeve, Vector3(-0.18, -0.3, 0.1))
	# левая рука (анимируется)
	hand_l = Node3D.new()
	hand_l.position = HAND_REST
	add_child(hand_l)
	_box(hand_l, Vector3(0.062, 0.062, 0.085), Vector3.ZERO, glove)
	_box(hand_l, Vector3(0.06, 0.06, 0.46), Vector3(-0.09, -0.07, 0.3), sleeve, Vector3(0.2, 0.42, 0.0))
	# дульная вспышка
	flash = OmniLight3D.new()
	flash.light_color = Color(1.0, 0.7, 0.3)
	flash.light_energy = 3.0
	flash.omni_range = 7.0
	flash.position = Vector3(0, 0.015, -0.75)
	flash.visible = false
	add_child(flash)
	flash_mesh = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.3, 0.3)
	flash_mesh.mesh = q
	var fm := StandardMaterial3D.new()
	fm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	fm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	fm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fm.albedo_texture = _star_texture()
	fm.no_depth_test = true
	flash_mesh.material_override = fm
	flash_mesh.position = Vector3(0, 0.015, -0.7)
	flash_mesh.visible = false
	flash_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(flash_mesh)
	# гильзы
	_casing_mesh = CylinderMesh.new()
	_casing_mesh.top_radius = 0.0045
	_casing_mesh.bottom_radius = 0.0045
	_casing_mesh.height = 0.03
	_casing_mesh.radial_segments = 6
	_casing_mat = StandardMaterial3D.new()
	_casing_mat.albedo_color = Color(0.8, 0.6, 0.2)
	_casing_mat.metallic = 0.9
	_casing_mat.roughness = 0.3

func _star_texture() -> ImageTexture:
	var n := 64
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			var v := Vector2(x + 0.5 - n / 2.0, y + 0.5 - n / 2.0) / (n / 2.0)
			var d := v.length()
			var ang := atan2(v.y, v.x)
			var star := pow(absf(cos(ang * 2.5)), 6.0) * 0.9 + 0.35
			var a := clampf(1.0 - d / star, 0.0, 1.0)
			a = a * a * 1.6
			img.set_pixel(x, y, Color(1.0, 0.85 - d * 0.3, 0.45, clampf(a, 0.0, 1.0)))
	return ImageTexture.create_from_image(img)

# ---------- звук ----------
func _sfx(name: String, vol: float = 0.0) -> void:
	var p := sfx_players[sfx_i]
	sfx_i = (sfx_i + 1) % sfx_players.size()
	p.stream = Sfx.get_sound(name)
	p.volume_db = vol
	p.pitch_scale = randf_range(0.96, 1.04)
	p.play()

# ---------- цикл ----------
func _process(delta: float) -> void:
	cooldown -= delta
	var captured := Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
	if captured and not reloading:
		if Input.is_action_just_pressed("reload"):
			_reload()
		elif Input.is_action_pressed("shoot") and cooldown <= 0.0:
			if ammo > 0:
				_shoot()
			elif Input.is_action_just_pressed("shoot"):
				_sfx("dry", -4.0)
				_reload()
	if flash_t > 0.0:
		flash_t -= delta
		if flash_t <= 0.0:
			flash.visible = false
			flash_mesh.visible = false
	_update_casings(delta)
	# ходьба и бег (плавно)
	var speed := Vector2(player.velocity.x, player.velocity.z).length()
	var grounded := player.is_on_floor()
	bob_amp = lerpf(bob_amp, clampf(speed / 6.0, 0.0, 1.5) if grounded else 0.0, delta * 8.0)
	bob_t += delta * speed * 1.4
	var sprinting := Input.is_action_pressed("sprint") and speed > 6.5 and not reloading
	sprint_blend = lerpf(sprint_blend, 1.0 if sprinting else 0.0, delta * 7.0)
	kick = move_toward(kick, 0.0, delta * 9.0)
	bolt_t = move_toward(bolt_t, 0.0, delta * 22.0)
	var look: Vector2 = player.look_rel
	player.look_rel = Vector2.ZERO
	sway = (sway.lerp(Vector2.ZERO, delta * 8.0) + look * 0.0008).limit_length(0.1)
	var bob := Vector3(sin(bob_t * 0.5) * 0.006, (1.0 - cos(bob_t)) * 0.003, 0.0) * bob_amp
	var kz := kick * kick * 0.05
	position = base_pos + bob + Vector3(-sway.x * 0.3 + sprint_blend * 0.06, sway.y * 0.3 - r_tilt * 0.03 - sprint_blend * 0.07, kz)
	rotation = Vector3(kick * 0.09 + r_tilt * 0.35 - sway.y - sprint_blend * 0.2, -sway.x - r_tilt * 0.12 + sprint_blend * 0.55, -r_tilt * 0.45 - sway.x * 0.4 + sprint_blend * 0.1)
	# детали
	var mag_off := Vector3(0, -0.3, 0.02) * r_mag
	mag.position = MAG_BASE + mag_off
	bolt.position = BOLT_BASE + Vector3(0, 0, 0.045 * maxf(bolt_t, r_bolt))
	var grip := mag.position + Vector3(0.0, -0.045, 0.0)
	var hp := HAND_REST.lerp(grip, hand_mag)
	hand_l.position = hp.lerp(HAND_BOLT + bolt.position - BOLT_BASE, hand_bolt)

func _shoot() -> void:
	cooldown = fire_rate
	ammo -= 1
	ammo_changed.emit(ammo, reserve)
	kick = 1.0
	bolt_t = 1.0
	_sfx("shot", 2.0)
	player.add_trauma(0.03)
	head.rotation.x = clampf(head.rotation.x + 0.0042, -1.5, 1.5)
	player.rotate_y(randf_range(-0.0010, 0.0010))
	flash.visible = true
	flash_mesh.visible = true
	flash_mesh.scale = Vector3.ONE * randf_range(0.7, 1.25)
	flash_t = 0.045
	_eject_casing()
	get_tree().call_group("enemies", "hear", player.global_position, 30.0)
	ray.rotation = Vector3(randf_range(-spread, spread), randf_range(-spread, spread), 0.0)
	ray.force_raycast_update()
	if not ray.is_colliding():
		return
	var c := ray.get_collider()
	var p := ray.get_collision_point()
	var n := ray.get_collision_normal()
	var shot_dir := -cam_basis_z()
	if c is RigidBody3D and (c as Node).has_meta("humanoid"):
		var bot = (c as Node).get_meta("humanoid")
		bot.receive_hit(c, p, shot_dir, damage, "rifle")
	elif c is RigidBody3D:
		(c as RigidBody3D).apply_impulse(-n * 3.0, p - (c as RigidBody3D).global_position)
	elif c is StaticBody3D and Game.holes:
		Game.holes.add(p, n)

func _eject_casing() -> void:
	var m := MeshInstance3D.new()
	m.mesh = _casing_mesh
	m.material_override = _casing_mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	get_tree().current_scene.add_child(m)
	var port := global_transform * Vector3(0.04, 0.035, 0.0)
	m.global_position = port
	var b := global_transform.basis
	var vel := b.x * randf_range(1.6, 2.6) + b.y * randf_range(1.0, 2.0) - b.z * randf_range(-0.2, 0.4) + player.velocity * 0.5
	m.rotation = Vector3(randf() * TAU, randf() * TAU, randf() * TAU)
	casings.append({"node": m, "vel": vel, "life": 1.2, "spin": Vector3(randf_range(-12, 12), randf_range(-12, 12), randf_range(-12, 12))})
	if casings.size() > 16:
		var old: Dictionary = casings.pop_front()
		old["node"].queue_free()

func _update_casings(delta: float) -> void:
	var i := casings.size() - 1
	while i >= 0:
		var c: Dictionary = casings[i]
		c["life"] -= delta
		var m: Node3D = c["node"]
		if c["life"] <= 0.0:
			m.queue_free()
			casings.remove_at(i)
		else:
			var v: Vector3 = c["vel"]
			v.y -= 9.8 * delta
			m.global_position += v * delta
			if m.global_position.y < 0.02:
				m.global_position.y = 0.02
				v = Vector3(v.x * 0.3, absf(v.y) * 0.25, v.z * 0.3)
				if absf(v.y) < 0.2:
					v.y = 0.0
					c["spin"] = Vector3.ZERO
			c["vel"] = v
			m.rotation += (c["spin"] as Vector3) * delta
		i -= 1

# ---------- перезарядка ----------
func _reload() -> void:
	if reloading or ammo == mag_size or reserve <= 0:
		return
	reloading = true
	var t := create_tween()
	t.tween_property(self, "r_tilt", 1.0, 0.2).set_trans(Tween.TRANS_SINE)
	t.parallel().tween_property(self, "hand_mag", 1.0, 0.2).set_trans(Tween.TRANS_SINE)
	t.tween_callback(_sfx.bind("mag_out"))
	t.tween_property(self, "r_mag", 1.0, 0.16).set_trans(Tween.TRANS_QUAD)
	t.tween_callback(_drop_mag)
	t.tween_interval(0.35)
	t.tween_callback(func() -> void: mag.visible = true)
	t.tween_property(self, "r_mag", 0.0, 0.26).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	t.tween_callback(_sfx.bind("mag_in"))
	t.tween_property(self, "hand_mag", 0.0, 0.12)
	t.parallel().tween_property(self, "hand_bolt", 1.0, 0.12)
	t.tween_property(self, "r_bolt", 1.0, 0.13)
	t.tween_callback(_sfx.bind("bolt_back"))
	t.tween_property(self, "r_bolt", 0.0, 0.07)
	t.tween_callback(_finish_reload)
	t.tween_callback(_sfx.bind("bolt_fwd"))
	t.tween_property(self, "hand_bolt", 0.0, 0.2)
	t.parallel().tween_property(self, "r_tilt", 0.0, 0.25).set_trans(Tween.TRANS_SINE)
	t.tween_callback(func() -> void: reloading = false)

func _drop_mag() -> void:
	mag.visible = false
	# старый магазин падает на пол
	var m := Node3D.new()
	get_tree().current_scene.add_child(m)
	m.global_transform = mag.global_transform
	for c in mag.get_children():
		m.add_child(c.duplicate())
	var tw := m.create_tween()
	var start := m.global_position
	var vel := global_transform.basis.x * -0.4 + Vector3(0, -0.5, 0)
	tw.tween_method(func(tt: float) -> void:
		m.global_position = Vector3(start.x + vel.x * tt, maxf(0.03, start.y + vel.y * tt - 4.9 * tt * tt), start.z + vel.z * tt)
		m.rotation.z += 0.12, 0.0, 0.7, 0.7)
	tw.tween_callback(m.queue_free)

func _finish_reload() -> void:
	var need := mag_size - ammo
	var take := mini(need, reserve)
	ammo += take
	reserve -= take
	ammo_changed.emit(ammo, reserve)

func cam_basis_z() -> Vector3:
	return get_parent().global_transform.basis.z
