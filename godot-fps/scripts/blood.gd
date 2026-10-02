class_name Blood
extends Node3D
# Кровь: шейдер на квадах (shaders/blood.gdshader) + GPU-частицы для полёта капель.
# Шейдер сам рисует форму, подтёки, растекание, размытие и высыхание по возрасту пятна.
# Здесь — «физика попадания»: баллистика капель, скорость и угол удара -> параметры шейдера.

static var instance: Blood

const PARTICLE_POOL := 10
const QUAD_POOL := 160
const GRAV := Vector3(0, -9.8, 0)

var _drops: Array[GPUParticles3D] = []
var _mist: Array[GPUParticles3D] = []
var _pi := 0
var _quads: Array[MeshInstance3D] = []
var _qi := 0
var _mat: ShaderMaterial
var time_offset := 0.0   # только для отладки: «состарить» кровь

func _ready() -> void:
	instance = self
	_mat = ShaderMaterial.new()
	_mat.shader = load("res://shaders/blood.gdshader")
	var qm := QuadMesh.new()
	qm.size = Vector2.ONE
	for i in QUAD_POOL:
		var m := MeshInstance3D.new()
		m.mesh = qm
		m.material_override = _mat
		m.visible = false
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		m.visibility_range_end = 45.0
		add_child(m)
		_quads.append(m)
	_build_particles()

func _process(_d: float) -> void:
	RenderingServer.global_shader_parameter_set("blood_time", _now())

func _now() -> float:
	return Time.get_ticks_msec() / 1000.0 + time_offset

# ---------- частицы ----------
func _build_particles() -> void:
	var aabb := AABB(Vector3(-8, -8, -8), Vector3(16, 16, 16))
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3.UP
	pm.spread = 35.0
	pm.initial_velocity_min = 3.0
	pm.initial_velocity_max = 8.0
	pm.gravity = GRAV
	pm.scale_min = 0.5
	pm.scale_max = 1.5
	pm.particle_flag_align_y = true
	pm.collision_mode = ParticleProcessMaterial.COLLISION_HIDE_ON_CONTACT
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.007
	cyl.bottom_radius = 0.007
	cyl.height = 0.07
	cyl.radial_segments = 4
	cyl.rings = 1
	var dmat := StandardMaterial3D.new()
	dmat.albedo_color = Color(0.33, 0.0, 0.015)
	dmat.roughness = 0.1
	cyl.material = dmat
	var pm2 := ParticleProcessMaterial.new()
	pm2.direction = Vector3.UP
	pm2.spread = 55.0
	pm2.initial_velocity_min = 1.0
	pm2.initial_velocity_max = 6.0
	pm2.gravity = Vector3(0, -6.0, 0)
	pm2.damping_min = 2.0
	pm2.damping_max = 4.0
	pm2.scale_min = 0.5
	pm2.scale_max = 1.3
	var sph := SphereMesh.new()
	sph.radius = 0.01
	sph.height = 0.02
	sph.radial_segments = 4
	sph.rings = 2
	var mmat := StandardMaterial3D.new()
	mmat.albedo_color = Color(0.5, 0.0, 0.03)
	sph.material = mmat
	for i in PARTICLE_POOL:
		_drops.append(_particles(pm, cyl, 18, 1.4, aabb))
		_mist.append(_particles(pm2, sph, 45, 0.5, aabb))

func _particles(pm: ParticleProcessMaterial, mesh: Mesh, amount: int, life: float, aabb: AABB) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.process_material = pm
	p.draw_pass_1 = mesh
	p.amount = amount
	p.lifetime = life
	p.one_shot = true
	p.explosiveness = 0.95
	p.local_coords = false
	p.emitting = false
	p.custom_aabb = aabb
	add_child(p)
	return p

func _aim(node: Node3D, pos: Vector3, up: Vector3) -> void:
	var u := up.normalized()
	var ref := Vector3.RIGHT if absf(u.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD
	var x := u.cross(ref).normalized()
	node.global_transform = Transform3D(Basis(x, u, x.cross(u)), pos)

# ---------- публичный API ----------
# Попадание в тело: брызги назад (входное) и вперёд по линии выстрела (выходное).
func splash(pos: Vector3, normal: Vector3, shot_dir: Vector3 = Vector3.ZERO) -> void:
	var fwd := shot_dir.normalized() if shot_dir != Vector3.ZERO else -normal
	_aim(_drops[_pi], pos, normal)
	_drops[_pi].restart()
	_drops[_pi].emitting = true
	_aim(_mist[_pi], pos, fwd)
	_mist[_pi].restart()
	_mist[_pi].emitting = true
	_pi = (_pi + 1) % PARTICLE_POOL
	var space := get_world_3d().direct_space_state
	# выходное отверстие: быстрый широкий веер на поверхности за целью
	var exit := space.intersect_ray(PhysicsRayQueryParameters3D.create(pos + fwd * 0.4, pos + fwd * 7.0, 1))
	if exit and exit.collider is StaticBody3D:
		_spot(exit.position, exit.normal, fwd * 14.0, randf_range(0.16, 0.26))
	for i in 9:
		var v: Vector3
		if i < 4:   # назад / в стороны: медленнее
			v = normal * randf_range(1.5, 4.5) + _rnd() * 1.6
		else:       # вперёд: быстрее
			v = fwd * randf_range(4.0, 11.0) + _rnd() * 2.0
		_ballistic(space, pos, v)

func _rnd() -> Vector3:
	return Vector3(randf_range(-1, 1), randf_range(-0.6, 1.2), randf_range(-1, 1))

# Полёт капли по параболе; пятно рисуется там, где она упала, с её скоростью и углом удара.
func _ballistic(space: PhysicsDirectSpaceState3D, from: Vector3, vel: Vector3) -> void:
	var p := from
	var v := vel
	var dt := 0.07
	for step in 14:
		var np := p + v * dt + GRAV * (0.5 * dt * dt)
		var nv := v + GRAV * dt
		var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(p, np, 1))
		if hit:
			if hit.collider is StaticBody3D:
				var sp := nv.length()
				_spot(hit.position, hit.normal, nv, randf_range(0.03, 0.09) * (0.7 + sp / 9.0))
			return
		p = np
		v = nv

func bullet_hole(pos: Vector3, normal: Vector3) -> void:
	_place(pos, normal, 3, 0.07, 1.0, 0.0, Vector3.ZERO, 0.0, 0.0)

func pool(pos: Vector3) -> void:
	var space := get_world_3d().direct_space_state
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(pos + Vector3(0, 0.5, 0), pos + Vector3(0, -2.0, 0), 1))
	if hit and hit.collider is StaticBody3D:
		# R_n=0.1 растёт на 0.3 (в долях половины стороны квада 3.4 м)
		_place(hit.position, hit.normal, 2, 0.1 * 1.7, 1.0, 0.0, Vector3.ZERO, 0.0, 0.3)

# Пятно от капли: параметры шейдера из скорости и угла удара.
func _spot(pos: Vector3, n: Vector3, vel: Vector3, radius_m: float) -> void:
	var speed := vel.length()
	var vn := vel.normalized() if speed > 0.01 else Vector3.ZERO
	var tang := vn - n * vn.dot(n)                  # проекция скорости на поверхность
	var oblique := clampf(tang.length(), 0.0, 1.0)  # 0 — удар в упор, 1 — скользящий
	var stretch := 1.0 + oblique * oblique * 3.5 * clampf(speed / 5.0, 0.3, 1.0)
	var spike := clampf((speed - 4.0) / 9.0, 0.0, 1.0) * (1.0 - 0.4 * oblique)
	var kind := 1 if absf(n.y) > 0.7 else 0
	if kind == 1:
		spike *= 0.45   # на полу капли округлее
	_place(pos, n, kind, radius_m, stretch, spike, tang, 90.0 + randf() * 60.0, 0.0)

func _place(pos: Vector3, n: Vector3, kind: int, radius_m: float, stretch: float, spike: float, tang: Vector3, dry: float, growth: float) -> void:
	var up := n.normalized()
	# базис: y — мировая «верх» вдоль стены (для стекания), на полу/потолке случайный поворот
	var yb: Vector3
	if absf(up.y) > 0.9:
		yb = (Vector3.FORWARD - up * up.dot(Vector3.FORWARD)).normalized().rotated(up, randf() * TAU)
	else:
		yb = (Vector3.UP - up * up.dot(Vector3.UP)).normalized()
	var xb := yb.cross(up).normalized()
	var r_n := 0.3 - 0.1 * spike
	if kind == 2 or kind == 3:
		r_n = 0.1
	var side := radius_m * 2.0 / r_n
	if kind == 2:
		side = 3.4
	elif kind == 3:
		side = radius_m * 2.0
	var g := Vector3.DOWN - up * up.dot(Vector3.DOWN)
	var guv := Vector2.ZERO
	if kind == 0 and g.length() > 0.3:
		g = g.normalized()
		guv = Vector2(g.dot(xb), g.dot(yb))
	var duv := Vector2(1, 0)
	if tang.length() > 0.001:
		duv = Vector2(tang.dot(xb), tang.dot(yb)).normalized()
	var q := _quads[_qi]
	var off := 0.012 + (_qi % 20) * 0.0004
	_qi = (_qi + 1) % QUAD_POOL
	q.global_transform = Transform3D(Basis(xb * side, yb * side, up), pos + up * off)
	q.set_instance_shader_parameter("t0", _now())
	q.set_instance_shader_parameter("shape", Vector4(randf() * 50.0, r_n, stretch, spike))
	q.set_instance_shader_parameter("flow", Vector4(duv.x, duv.y, guv.x, guv.y))
	q.set_instance_shader_parameter("misc", Vector4(kind, dry, 0.3 if guv != Vector2.ZERO else 0.0, growth))
	q.visible = true
