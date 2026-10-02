extends CharacterBody3D
# ИИ: патруль -> погоня -> поиск. Навигация по navmesh, зрение (конус + луч), слух (выстрелы),
# реакция, стрельба с промахами, стрейф, ближний бой, оповещение союзников.
# Анимации: добавь AnimationPlayer с клипами "idle", "run", "die" — скрипт запустит их сам.

enum S { PATROL, CHASE, SEARCH, DEAD }

@export var health := 100.0
@export var walk_speed := 2.2
@export var run_speed := 4.4
@export var sight_range := 35.0
@export var fov_deg := 110.0
@export var shoot_range := 20.0
@export var shot_damage := 5.0
@export var melee_damage := 10.0

var state := S.PATROL
var target: Node3D
var agent: NavigationAgent3D
var last_known := Vector3.ZERO
var react := 0.0
var shoot_cd := 1.0
var melee_cd := 0.0
var search_t := 0.0
var strafe_dir := 1.0
var strafe_t := 0.0
var repath := 0.0
var patrol_wait := 1.0
var has_patrol_target := false
var rig: Dictionary
var walk_phase := 0.0
var last_hit_point := Vector3.ZERO
var last_shot_dir := Vector3.FORWARD
var gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")

func _ready() -> void:
	add_to_group("enemies")
	target = get_tree().get_first_node_in_group("player")
	rig = Humanoid.build(self)
	agent = NavigationAgent3D.new()
	agent.path_desired_distance = 0.6
	agent.target_desired_distance = 1.0
	agent.radius = 0.5
	agent.height = 1.8
	add_child(agent)

# ---------- восприятие ----------
func _can_see() -> bool:
	if target == null:
		return false
	var eye := global_position + Vector3(0, 1.6, 0)
	var tp := target.global_position + Vector3(0, 1.4, 0)
	var to := tp - eye
	var d := to.length()
	if d > sight_range:
		return false
	var fwd := -global_transform.basis.z
	if d > 4.0 and fwd.angle_to(to) > deg_to_rad(fov_deg * 0.5):
		return false
	var q := PhysicsRayQueryParameters3D.create(eye, tp, 1, [get_rid()])
	var r: Dictionary = get_world_3d().direct_space_state.intersect_ray(q)
	return not r.is_empty() and r.collider == target

func hear(pos: Vector3, radius: float) -> void:
	if state == S.DEAD or state == S.CHASE:
		return
	if global_position.distance_to(pos) <= radius:
		last_known = pos
		state = S.SEARCH
		search_t = 8.0
		agent.target_position = pos

func take_damage(amount: float, point := Vector3.ZERO, normal := Vector3.UP, shot_dir := Vector3.ZERO) -> void:
	if state == S.DEAD:
		return
	if Blood.instance:
		Blood.instance.splash(point, normal, shot_dir)
	last_hit_point = point
	last_shot_dir = shot_dir if shot_dir != Vector3.ZERO else -normal
	if point.y - global_position.y > 1.55:
		amount *= 2.0   # хэдшот
	health -= amount
	if health <= 0.0:
		_die()
		return
	if state != S.CHASE and target:
		state = S.CHASE
		last_known = target.global_position
		react = 0.2
	get_tree().call_group("enemies", "hear", global_position, 15.0)

func _die() -> void:
	state = S.DEAD
	$CollisionShape3D.set_deferred("disabled", true)
	if Blood.instance:
		Blood.instance.pool(global_position)
	var imp := last_shot_dir.normalized() * 9.0 + Vector3(0, 1.5, 0)
	Humanoid.ragdoll(rig, get_tree().current_scene, velocity, imp, last_hit_point)
	queue_free()

func _play(anim: String) -> void:
	var ap := get_node_or_null("AnimationPlayer") as AnimationPlayer
	if ap and ap.has_animation(anim) and ap.current_animation != anim:
		ap.play(anim)

# ---------- движение ----------
func _face(dir: Vector3, delta: float) -> void:
	if dir.length() > 0.01:
		rotation.y = lerp_angle(rotation.y, atan2(-dir.x, -dir.z), 10.0 * delta)

func _move_to(p: Vector3, spd: float, delta: float) -> void:
	repath -= delta
	if repath <= 0.0:
		agent.target_position = p
		repath = 0.25
	var dir := Vector3.ZERO
	if NavigationServer3D.map_get_iteration_id(agent.get_navigation_map()) != 0 and agent.get_current_navigation_path().size() > 1:
		dir = agent.get_next_path_position() - global_position
	else:
		dir = p - global_position   # navmesh нет — идём напрямую
	dir.y = 0
	if dir.length() > 0.1:
		dir = dir.normalized()
		velocity.x = dir.x * spd
		velocity.z = dir.z * spd
		_face(dir, delta)
	else:
		velocity.x = 0.0
		velocity.z = 0.0

func _stop() -> void:
	velocity.x = move_toward(velocity.x, 0.0, 20.0 * get_physics_process_delta_time())
	velocity.z = move_toward(velocity.z, 0.0, 20.0 * get_physics_process_delta_time())

func _physics_process(delta: float) -> void:
	if state == S.DEAD or target == null:
		return
	if not is_on_floor():
		velocity.y -= gravity * delta
	melee_cd -= delta
	var sees := _can_see()
	if sees:
		last_known = target.global_position
		if state != S.CHASE:
			state = S.CHASE
			react = 0.4
			get_tree().call_group("enemies", "hear", global_position, 12.0)
	elif state == S.CHASE:
		state = S.SEARCH
		search_t = 6.0
	match state:
		S.PATROL:
			_patrol(delta)
		S.CHASE:
			_chase(delta, sees)
		S.SEARCH:
			_search(delta)
	move_and_slide()
	var spd := Vector2(velocity.x, velocity.z).length()
	walk_phase += spd * delta * 2.4
	Humanoid.animate(rig, walk_phase, clampf(spd / 4.0, 0.0, 1.0))

func _patrol(delta: float) -> void:
	_play("run" if velocity.length() > 0.5 else "idle")
	if patrol_wait > 0.0:
		patrol_wait -= delta
		_stop()
		return
	if not has_patrol_target or agent.is_navigation_finished():
		var map := agent.get_navigation_map()
		var p := NavigationServer3D.map_get_random_point(map, 1, true)
		if p == Vector3.ZERO:
			p = global_position + Vector3(randf_range(-8, 8), 0, randf_range(-8, 8))
		agent.target_position = p
		has_patrol_target = true
		patrol_wait = randf_range(1.0, 3.0) if agent.is_navigation_finished() else 0.0
		return
	_move_to(agent.target_position, walk_speed, delta)

func _search(delta: float) -> void:
	_play("run")
	search_t -= delta
	if global_position.distance_to(last_known) > 1.8:
		_move_to(last_known, run_speed * 0.8, delta)
	else:
		_stop()
		rotation.y += delta * 1.6   # осматривается
	if search_t <= 0.0:
		state = S.PATROL
		has_patrol_target = false
		patrol_wait = 1.0

func _chase(delta: float, sees: bool) -> void:
	var to := target.global_position - global_position
	to.y = 0
	var dist := to.length()
	_face(to, delta)
	if react > 0.0:
		react -= delta
		_stop()
		return
	if sees and dist < 1.6:
		_stop()
		if melee_cd <= 0.0:
			melee_cd = 0.8
			target.take_damage(melee_damage)
	elif sees and dist < shoot_range:
		_play("run")
		strafe_t -= delta
		if strafe_t <= 0.0:
			strafe_dir = 1.0 if randf() < 0.5 else -1.0
			strafe_t = randf_range(0.8, 2.0)
		var fwd := to.normalized()
		var side := Vector3(fwd.z, 0, -fwd.x) * strafe_dir
		var move := side * walk_speed
		if dist > 10.0:
			move += fwd * walk_speed
		elif dist < 5.0:
			move -= fwd * walk_speed
		velocity.x = move.x
		velocity.z = move.z
		shoot_cd -= delta
		if shoot_cd <= 0.0:
			_fire(dist)
	else:
		_play("run")
		_move_to(last_known, run_speed, delta)

func _fire(dist: float) -> void:
	shoot_cd = randf_range(0.7, 1.3)
	var from := global_position + Vector3(0, 1.4, 0) + (-global_transform.basis.z) * 0.6
	var tp := target.global_position + Vector3(0, 1.2, 0)
	var hit := randf() < clampf(0.75 - dist * 0.025, 0.2, 0.7)
	if hit:
		target.take_damage(shot_damage)
	else:
		tp += Vector3(randf_range(-1.2, 1.2), randf_range(-0.6, 0.8), randf_range(-1.2, 1.2))
	_tracer(from, tp)

func _tracer(a: Vector3, b: Vector3) -> void:
	var m := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.02, 0.02, a.distance_to(b))
	m.mesh = bm
	m.material_override = Mats.emissive("tracer", Color(1.0, 0.8, 0.3), 5.0)
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	get_tree().current_scene.add_child(m)
	m.global_position = (a + b) * 0.5
	m.look_at(b, Vector3.UP)
	get_tree().create_timer(0.05).timeout.connect(m.queue_free)
