class_name Arena
extends Node3D
# Тестовая арена 40x40: пол, потолок, стены, укрытия, колонны, ящики, бочки, мусор, лампы.
# Заменяется твоей картой через map_scene в main.gd.

const HALF := 20.0
const H := 4.0

var _rng := RandomNumberGenerator.new()

func _ready() -> void:
	_rng.seed = 42
	_shell()
	_walls()
	_props()
	_lights()

func _static_box(pos: Vector3, size: Vector3, mat: Material, blood_collider: bool = true) -> void:
	var b := StaticBody3D.new()
	var m := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	m.mesh = bm
	m.material_override = mat
	var c := CollisionShape3D.new()
	var s := BoxShape3D.new()
	s.size = size
	c.shape = s
	b.add_child(m)
	b.add_child(c)
	b.position = pos
	add_child(b)
	if blood_collider:
		var pc := GPUParticlesCollisionBox3D.new()
		pc.size = size
		pc.position = pos
		add_child(pc)

func _shell() -> void:
	var floor_mat := Mats.get_mat("floor", Color(0.32, 0.33, 0.35), 0.9, 0.0, 0.5)
	var wall_mat := Mats.get_mat("wall", Color(0.55, 0.56, 0.52), 0.95, 0.0, 0.4)
	var ceil_mat := Mats.get_mat("ceil", Color(0.4, 0.4, 0.42), 0.95, 0.0, 0.4)
	_static_box(Vector3(0, -0.5, 0), Vector3(HALF * 2, 1, HALF * 2), floor_mat, false)  # частицы: пол из main
	_static_box(Vector3(0, H + 0.25, 0), Vector3(HALF * 2 + 1, 0.5, HALF * 2 + 1), ceil_mat)
	_static_box(Vector3(0, H / 2, -HALF - 0.25), Vector3(HALF * 2 + 1, H, 0.5), wall_mat)
	_static_box(Vector3(0, H / 2, HALF + 0.25), Vector3(HALF * 2 + 1, H, 0.5), wall_mat)
	_static_box(Vector3(-HALF - 0.25, H / 2, 0), Vector3(0.5, H, HALF * 2), wall_mat)
	_static_box(Vector3(HALF + 0.25, H / 2, 0), Vector3(0.5, H, HALF * 2), wall_mat)

func _walls() -> void:
	var wall_mat := Mats.get_mat("wall", Color(0.55, 0.56, 0.52), 0.95, 0.0, 0.4)
	var cover_mat := Mats.get_mat("cover", Color(0.45, 0.38, 0.3), 0.9, 0.0, 0.5)
	# внутренние стены с проёмами
	_static_box(Vector3(-8, H / 2, -6), Vector3(8, H, 0.4), wall_mat)
	_static_box(Vector3(8, H / 2, -6), Vector3(8, H, 0.4), wall_mat)
	_static_box(Vector3(-10, H / 2, 6), Vector3(0.4, H, 12), wall_mat)
	_static_box(Vector3(10, H / 2, 6), Vector3(0.4, H, 12), wall_mat)
	# низкие укрытия
	_static_box(Vector3(0, 0.6, 4), Vector3(6, 1.2, 0.5), cover_mat)
	_static_box(Vector3(-14, 0.6, -4), Vector3(0.5, 1.2, 6), cover_mat)
	_static_box(Vector3(14, 0.6, -3), Vector3(0.5, 1.2, 6), cover_mat)
	# колонны
	var pillar_mat := Mats.get_mat("pillar", Color(0.5, 0.5, 0.5), 0.9, 0.0, 0.5)
	for p in [Vector3(-6, 2, -12), Vector3(6, 2, -12), Vector3(-14, 2, 9), Vector3(14, 2, 9), Vector3(0, 2, -1)]:
		_static_box(p, Vector3(1, H, 1), pillar_mat)

func _rigid(shape: Shape3D, mesh: Mesh, mat: Material, pos: Vector3, mass: float, rot_y: float = 0.0) -> void:
	var r := RigidBody3D.new()
	r.mass = mass
	var c := CollisionShape3D.new()
	c.shape = shape
	var m := MeshInstance3D.new()
	m.mesh = mesh
	m.material_override = mat
	r.add_child(c)
	r.add_child(m)
	r.position = pos
	r.rotation.y = rot_y
	add_child(r)

func _crate(pos: Vector3, size: float = 1.0) -> void:
	var bm := BoxMesh.new()
	bm.size = Vector3.ONE * size
	var bs := BoxShape3D.new()
	bs.size = bm.size
	_rigid(bs, bm, Mats.get_mat("crate", Color(0.55, 0.4, 0.22), 0.8, 0.0, 1.0), pos, 15.0 * size, _rng.randf_range(-0.3, 0.3))

func _barrel(pos: Vector3, key: String, col: Color) -> void:
	var cm := CylinderMesh.new()
	cm.top_radius = 0.35
	cm.bottom_radius = 0.35
	cm.height = 1.0
	cm.radial_segments = 12
	var cs := CylinderShape3D.new()
	cs.radius = 0.35
	cs.height = 1.0
	_rigid(cs, cm, Mats.get_mat(key, col, 0.45, 0.6, 1.5), pos, 25.0)

func _props() -> void:
	# ящики: кучки и пирамидки
	for base in [Vector3(-16, 0, 14), Vector3(15, 0, 15), Vector3(-4, 0, 16), Vector3(16, 0, -17), Vector3(-17, 0, 2)]:
		_crate(base + Vector3(0, 0.5, 0))
		_crate(base + Vector3(1.1, 0.5, 0.2))
		_crate(base + Vector3(0.5, 1.5, 0.1))
	_crate(Vector3(5, 0.5, 8), 1.0)
	_crate(Vector3(-5, 0.4, 9), 0.8)
	# бочки
	var cols := [Color(0.7, 0.15, 0.1), Color(0.15, 0.3, 0.6), Color(0.3, 0.5, 0.2)]
	var i := 0
	for p in [Vector3(-18, 0.5, 6), Vector3(-17, 0.5, 7), Vector3(18, 0.5, 4), Vector3(12, 0.5, -1), Vector3(-12, 0.5, 12), Vector3(3, 0.5, 12), Vector3(19, 0.5, -8)]:
		_barrel(p, "barrel%d" % (i % 3), cols[i % 3])
		i += 1
	# мусор: мешки и банки
	var bag := BoxMesh.new()
	bag.size = Vector3(0.45, 0.25, 0.35)
	var bag_shape := BoxShape3D.new()
	bag_shape.size = bag.size
	var can := CylinderMesh.new()
	can.top_radius = 0.05
	can.bottom_radius = 0.05
	can.height = 0.12
	can.radial_segments = 8
	var can_shape := CylinderShape3D.new()
	can_shape.radius = 0.05
	can_shape.height = 0.12
	var trash_mat := Mats.get_mat("trash", Color(0.12, 0.13, 0.12), 0.7, 0.0, 2.0)
	var can_mat := Mats.get_mat("can", Color(0.6, 0.6, 0.65), 0.3, 0.8, 4.0)
	for n in 22:
		var pos := Vector3(_rng.randf_range(-18, 18), 0.2, _rng.randf_range(-18, 18))
		if Vector2(pos.x, pos.z).distance_to(Vector2(0, 10)) < 3.0:
			continue
		_rigid(bag_shape, bag, trash_mat, pos, 1.5, _rng.randf() * TAU)
	for n in 28:
		var pos := Vector3(_rng.randf_range(-18, 18), 0.1, _rng.randf_range(-18, 18))
		if Vector2(pos.x, pos.z).distance_to(Vector2(0, 10)) < 3.0:
			continue
		_rigid(can_shape, can, can_mat, pos, 0.2, _rng.randf() * TAU)

func _lights() -> void:
	var panel_mat := Mats.emissive("panel", Color(1.0, 0.95, 0.85), 3.0)
	var idx := 0
	for x in [-12.0, 0.0, 12.0]:
		for z in [-12.0, 0.0, 12.0]:
			var m := MeshInstance3D.new()
			var b := BoxMesh.new()
			b.size = Vector3(2.0, 0.05, 0.6)
			m.mesh = b
			m.material_override = panel_mat
			m.position = Vector3(x, H - 0.03, z)
			m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(m)
			var l := OmniLight3D.new()
			l.position = Vector3(x, H - 0.6, z)
			l.omni_range = 11.0
			l.light_energy = 1.4
			l.light_color = Color(1.0, 0.93, 0.82)
			l.shadow_enabled = (idx % 4 == 0)
			add_child(l)
			idx += 1
