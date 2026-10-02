class_name Bot
extends CharacterBody3D
## Простой бот из капсул: бродит, вздрагивает от попаданий, при смерти превращается в регдолл.

signal died(bot: Bot)

@export var max_health := 100.0
@export var walk_speed := 1.3
@export var wander_radius := 6.0
@export var body_color := Color(0.72, 0.72, 0.7)
@export var head_color := Color(0.85, 0.66, 0.52)

var health := 100.0
var dead := false
var home := Vector3.ZERO

var _target := Vector3.ZERO
var _idle := 0.0
var _stuck := 0.0
var _phase := 0.0
var _flinch := Vector3.ZERO      # отклонение корпуса от попадания
var _head_flinch := Vector3.ZERO
var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")

var pivots := {}                 # имя части -> Node3D (сустав)
var meshes := {}                 # имя части -> MeshInstance3D
var _parts := {}                 # имя части -> описание из BodyDef


func _ready() -> void:
	add_to_group("bot")
	collision_layer = 4                    # bot
	collision_mask = 1 | 2 | 8 | 16        # world, player, props, ragdoll
	health = max_health
	home = global_position
	_build_visual()
	_pick_target()


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= _gravity * delta

	var to := _target - global_position
	to.y = 0.0
	var want := Vector3.ZERO
	if _idle > 0.0:
		_idle -= delta
	elif to.length() < 0.4:
		_idle = randf_range(1.0, 3.5)
		_pick_target()
	else:
		var dir := to.normalized()
		want = dir * walk_speed
		rotation.y = lerp_angle(rotation.y, atan2(-dir.x, -dir.z), 1.0 - exp(-5.0 * delta))

	var k := 1.0 - exp(-6.0 * delta)
	velocity.x = lerpf(velocity.x, want.x, k)
	velocity.z = lerpf(velocity.z, want.z, k)
	move_and_slide()

	# Застрял — выбираем другую точку.
	if want != Vector3.ZERO and Vector2(velocity.x, velocity.z).length() < 0.2:
		_stuck += delta
		if _stuck > 1.0:
			_stuck = 0.0
			_pick_target()
	else:
		_stuck = 0.0

	_animate(delta)


## Точная проверка луча по капсулам частей тела.
## Возвращает {part, position, normal} или {} если пуля прошла мимо (например, между ног).
func trace_parts(from: Vector3, dir: Vector3) -> Dictionary:
	var best_t := INF
	var result := {}
	for part: Dictionary in BodyDef.PARTS:
		var seg := _segment_world(part)
		var t := _ray_capsule(from, dir, seg[0], seg[1], part.r)
		if t > 0.0 and t < best_t:
			best_t = t
			var p := from + dir * t
			var n := (p - Geometry3D.get_closest_point_to_segment(p, seg[0], seg[1])).normalized()
			result = {"part": part.name, "position": p, "normal": n}
	return result


## Попадание пули в часть тела. Возвращает {part, killed}.
func take_hit(part_name: String, pos: Vector3, normal: Vector3, dir: Vector3, damage: float, impulse: float) -> Dictionary:
	if dead:
		return {}
	var part: Dictionary = _parts[part_name]
	health -= damage * part.dmg
	FX.blood_hit(pos, normal, dir, meshes[part_name])

	# Вздрагивание: корпус отклоняется по направлению пули.
	var ld := global_basis.inverse() * dir.normalized()
	if part_name == "head":
		_head_flinch += Vector3(ld.z * 0.6, randf_range(-0.3, 0.3), -ld.x * 0.6)
	else:
		_flinch += Vector3(ld.z * 0.3, randf_range(-0.15, 0.15), -ld.x * 0.3)
	var push := dir.normalized() * 0.6
	velocity.x += push.x
	velocity.z += push.z
	_idle = 0.6

	var result := {"part": part_name, "killed": false}
	if health <= 0.0:
		result.killed = true
		_die(part_name, dir.normalized() * impulse, pos)
	return result


func _die(part_name: String, impulse: Vector3, hit_pos: Vector3) -> void:
	dead = true
	var ragdoll := Ragdoll.new()
	get_parent().add_child(ragdoll)
	ragdoll.build_from(self)
	ragdoll.apply_hit(part_name, impulse, hit_pos)
	died.emit(self)
	queue_free()


func _pick_target() -> void:
	var a := randf() * TAU
	var r := randf_range(1.5, wander_radius)
	_target = home + Vector3(cos(a) * r, 0.0, sin(a) * r)


# --- внешний вид ---------------------------------------------------------------

func _build_visual() -> void:
	var visual := Node3D.new()
	visual.name = "Visual"
	add_child(visual)

	var body_mat := StandardMaterial3D.new()
	body_mat.albedo_color = body_color
	body_mat.roughness = 0.8
	var head_mat := StandardMaterial3D.new()
	head_mat.albedo_color = head_color
	head_mat.roughness = 0.6

	for part: Dictionary in BodyDef.PARTS:
		_parts[part.name] = part
		var pivot := Node3D.new()
		pivot.name = part.name
		var parent_node: Node3D = visual
		var parent_pivot := Vector3.ZERO
		if part.parent != "":
			parent_node = pivots[part.parent]
			parent_pivot = _parts[part.parent].pivot
		parent_node.add_child(pivot)
		pivot.position = part.pivot - parent_pivot
		pivot.set_meta("rest_position", pivot.position)

		var mi := MeshInstance3D.new()
		mi.name = "Mesh"
		mi.mesh = BodyDef.capsule_mesh(part, head_mat if part.name == "head" else body_mat)
		mi.layers = 2                       # слой рендера «characters» (на нём рисуются раны)
		mi.position = BodyDef.center(part) - part.pivot
		pivot.add_child(mi)
		pivots[part.name] = pivot
		meshes[part.name] = mi

	# «Визор», чтобы было видно, куда бот смотрит.
	var visor := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.16, 0.05, 0.04)
	var visor_mat := StandardMaterial3D.new()
	visor_mat.albedo_color = Color(0.05, 0.05, 0.06)
	visor_mat.roughness = 0.15
	box.material = visor_mat
	visor.mesh = box
	visor.layers = 2
	visor.position = Vector3(0, 0.02, -0.09)
	meshes.head.add_child(visor)


func _animate(delta: float) -> void:
	var speed := Vector2(velocity.x, velocity.z).length()
	var amt := clampf(speed / maxf(walk_speed, 0.01), 0.0, 1.0)
	_phase += delta * speed * 5.0
	var s := sin(_phase)

	pivots.thigh_l.rotation.x = s * 0.5 * amt
	pivots.thigh_r.rotation.x = -s * 0.5 * amt
	pivots.shin_l.rotation.x = -maxf(0.0, sin(_phase + 1.3)) * 0.9 * amt
	pivots.shin_r.rotation.x = -maxf(0.0, sin(_phase + PI + 1.3)) * 0.9 * amt
	pivots.upper_arm_l.rotation.x = -s * 0.35 * amt
	pivots.upper_arm_r.rotation.x = s * 0.35 * amt
	pivots.lower_arm_l.rotation.x = 0.15 + maxf(0.0, -s) * 0.3 * amt
	pivots.lower_arm_r.rotation.x = 0.15 + maxf(0.0, s) * 0.3 * amt
	var pelvis: Node3D = pivots.pelvis
	pelvis.position.y = pelvis.get_meta("rest_position").y - absf(cos(_phase)) * 0.025 * amt

	var k := 1.0 - exp(-7.0 * delta)
	_flinch = _flinch.lerp(Vector3.ZERO, k)
	_head_flinch = _head_flinch.lerp(Vector3.ZERO, k)
	pivots.chest.rotation = _flinch + Vector3(-0.04 * amt, 0, 0)
	pivots.head.rotation = _head_flinch


func _segment_world(part: Dictionary) -> Array:
	var mi: MeshInstance3D = meshes[part.name]
	var half: float = (part.b - part.a).length() * 0.5
	return [mi.global_transform * Vector3(0, half, 0), mi.global_transform * Vector3(0, -half, 0)]


## Пересечение луча с капсулой (формула Иниго Килеса). -1 если мимо.
static func _ray_capsule(ro: Vector3, rd: Vector3, pa: Vector3, pb: Vector3, r: float) -> float:
	var ba := pb - pa
	var oa := ro - pa
	var baba := ba.dot(ba)
	var bard := ba.dot(rd)
	var baoa := ba.dot(oa)
	var rdoa := rd.dot(oa)
	var oaoa := oa.dot(oa)
	var a := baba - bard * bard
	var b := baba * rdoa - baoa * bard
	var c := baba * oaoa - baoa * baoa - r * r * baba
	var h := b * b - a * c
	if h >= 0.0:
		if a > 0.000001:
			var t := (-b - sqrt(h)) / a
			var y := baoa + t * bard
			if y > 0.0 and y < baba:
				return t
		# Полусферы на концах.
		var y0 := baoa + ((-b - sqrt(h)) / a if a > 0.000001 else 0.0) * bard
		var oc := oa if y0 <= 0.0 else ro - pb
		var b2 := rd.dot(oc)
		var c2 := oc.dot(oc) - r * r
		var h2 := b2 * b2 - c2
		if h2 > 0.0:
			return -b2 - sqrt(h2)
	return -1.0
