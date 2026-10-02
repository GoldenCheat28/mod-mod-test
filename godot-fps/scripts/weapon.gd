extends Node3D
# Автомат: магазин, запас, перезарядка (R), отдача, разброс, дульная вспышка, покачивание.

signal ammo_changed(ammo: int, reserve: int)

@export var damage := 22.0
@export var fire_rate := 0.095
@export var mag_size := 30
@export var spread := 0.012

var ammo := 30
var reserve := 120
var cooldown := 0.0
var reloading := false
var reload_dip := 0.0
var kick := 0.0
var sway := Vector2.ZERO
var bob_t := 0.0
var flash_t := 0.0
var base_pos := Vector3(0.2, -0.22, -0.45)
var ray: RayCast3D
var head: Node3D
var player: CharacterBody3D
var flash: OmniLight3D
var flash_mesh: MeshInstance3D

func _ready() -> void:
	ray = get_parent().get_node("RayCast3D")
	head = get_parent().get_parent()
	player = head.get_parent()
	ammo = mag_size
	position = base_pos
	_build_model()
	ammo_changed.emit.call_deferred(ammo, reserve)

func _box(size: Vector3, pos: Vector3, mat: Material) -> void:
	var m := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	m.mesh = b
	m.position = pos
	m.material_override = mat
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(m)

func _build_model() -> void:
	var dark := Mats.get_mat("gun_dark", Color(0.12, 0.12, 0.14), 0.4, 0.8, 4.0)
	var grey := Mats.get_mat("gun_grey", Color(0.25, 0.26, 0.28), 0.5, 0.6, 4.0)
	_box(Vector3(0.06, 0.09, 0.42), Vector3(0, 0, 0), dark)            # корпус
	_box(Vector3(0.035, 0.035, 0.28), Vector3(0, 0.01, -0.34), grey)   # ствол
	_box(Vector3(0.05, 0.12, 0.07), Vector3(0, -0.1, 0.1), dark)       # рукоять
	_box(Vector3(0.05, 0.14, 0.08), Vector3(0, -0.11, -0.08), grey)    # магазин
	_box(Vector3(0.05, 0.1, 0.16), Vector3(0, -0.01, 0.28), grey)      # приклад
	_box(Vector3(0.02, 0.03, 0.03), Vector3(0, 0.065, -0.2), dark)     # мушка
	flash = OmniLight3D.new()
	flash.light_color = Color(1.0, 0.7, 0.3)
	flash.light_energy = 3.0
	flash.omni_range = 6.0
	flash.position = Vector3(0, 0.01, -0.55)
	flash.visible = false
	add_child(flash)
	flash_mesh = MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.05
	s.height = 0.1
	s.radial_segments = 6
	s.rings = 3
	flash_mesh.mesh = s
	flash_mesh.material_override = Mats.emissive("flash", Color(1.0, 0.8, 0.4), 6.0)
	flash_mesh.position = Vector3(0, 0.01, -0.58)
	flash_mesh.visible = false
	flash_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(flash_mesh)

func _process(delta: float) -> void:
	cooldown -= delta
	var captured := Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
	if captured and not reloading:
		if Input.is_action_just_pressed("reload"):
			_reload()
		elif Input.is_action_pressed("shoot") and cooldown <= 0.0:
			if ammo > 0:
				_shoot()
			else:
				_reload()
	# вспышка
	if flash_t > 0.0:
		flash_t -= delta
		if flash_t <= 0.0:
			flash.visible = false
			flash_mesh.visible = false
	# покачивание, отдача, анимация перезарядки
	var speed := Vector2(player.velocity.x, player.velocity.z).length()
	bob_t += delta * speed * 1.3
	kick = lerpf(kick, 0.0, delta * 14.0)
	var bob := Vector3(sin(bob_t) * 0.006, absf(cos(bob_t)) * 0.006, 0.0) * minf(speed / 6.0, 1.5)
	var look: Vector2 = player.look_rel
	player.look_rel = Vector2.ZERO
	sway = sway.lerp(Vector2.ZERO, delta * 9.0) + look * 0.0009
	sway = sway.limit_length(0.12)
	position = base_pos + bob + Vector3(-sway.x * 0.35, sway.y * 0.35 - reload_dip * 0.18, kick * 0.06)
	rotation = Vector3(kick * 0.12 + reload_dip * 0.5 - sway.y, -sway.x, reload_dip * -0.4 - sway.x * 0.5)

func _shoot() -> void:
	cooldown = fire_rate
	ammo -= 1
	ammo_changed.emit(ammo, reserve)
	kick = 1.0
	player.add_trauma(0.18)
	head.rotation.x = clampf(head.rotation.x + 0.0045, -1.5, 1.5)
	player.rotate_y(randf_range(-0.0012, 0.0012))
	flash.visible = true
	flash_mesh.visible = true
	flash_mesh.scale = Vector3.ONE * randf_range(0.7, 1.3)
	flash_t = 0.04
	get_tree().call_group("enemies", "hear", player.global_position, 30.0)
	ray.rotation = Vector3(randf_range(-spread, spread), randf_range(-spread, spread), 0.0)
	ray.force_raycast_update()
	if not ray.is_colliding():
		return
	var c := ray.get_collider()
	var p := ray.get_collision_point()
	var n := ray.get_collision_normal()
	if c.has_method("take_damage"):
		c.take_damage(damage, p, n, -cam_basis_z())
	elif c is RigidBody3D:
		(c as RigidBody3D).apply_impulse(-n * 3.0, p - (c as RigidBody3D).global_position)
	elif c is StaticBody3D:
		Blood.instance.bullet_hole(p, n)

func _reload() -> void:
	if reloading or ammo == mag_size or reserve <= 0:
		return
	reloading = true
	var t := create_tween()
	t.tween_property(self, "reload_dip", 1.0, 0.3)
	t.tween_interval(0.9)
	t.tween_callback(_finish_reload)
	t.tween_property(self, "reload_dip", 0.0, 0.3)
	t.tween_callback(func() -> void: reloading = false)

func _finish_reload() -> void:
	var need := mag_size - ammo
	var take := mini(need, reserve)
	ammo += take
	reserve -= take
	ammo_changed.emit(ammo, reserve)

func cam_basis_z() -> Vector3:
	return get_parent().global_transform.basis.z
