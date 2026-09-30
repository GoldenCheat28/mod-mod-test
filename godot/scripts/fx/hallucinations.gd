extends Node3D
## Things that are not there. Runs only while Game.high > 0; the stronger the
## high, the more often something happens. Figures are ordinary lit, shadow
## casting geometry so they look like the rest of the world, and they are
## gone the moment they are looked at directly or approached.

const Sfx = preload("res://scripts/audio/sfx.gd")

var _clock := 0.0
var _next := 8.0
var _figures: Array = []      # {node, kind, born, life, vel}
var _sun: DirectionalLight3D
var _sun_base := Vector3.ZERO
var _slow := 0.0
var _mats: Array[StandardMaterial3D] = []


func _ready() -> void:
	_sun = get_parent().get_node_or_null("Sun")
	if _sun:
		_sun_base = _sun.rotation_degrees


func _process(delta: float) -> void:
	_clock += delta
	var h := Game.high
	RenderingServer.global_shader_parameter_set(&"hallu", h)
	Game.hallu_jolt = move_toward(Game.hallu_jolt, 0.0, delta * 2.0)
	# Light shifts: the sun drifts, so shadows crawl.
	if _sun:
		_sun.rotation_degrees = _sun_base + Vector3(sin(_clock * 0.23) * 5.0, sin(_clock * 0.17) * 9.0, 0.0) * h
	# Time drags now and then.
	_slow = maxf(_slow - delta, 0.0)
	Game.time_mod = move_toward(Game.time_mod, 0.7 if _slow > 0.0 else 1.0, delta * 0.8)
	_update_figures(delta)
	if h < 0.12 or Game.player == null:
		return
	_next -= delta * (0.4 + h * 1.4)
	if _next <= 0.0:
		_next = randf_range(5.0, 12.0)
		_event(h)


func _event(h: float) -> void:
	var roll := randf()
	if roll < 0.24:
		_watcher()
	elif roll < 0.4:
		_behind()
	elif roll < 0.52:
		_passer()
	elif roll < 0.62 and h > 0.4:
		_lying()
	elif roll < 0.74:
		_whisper()
	elif roll < 0.82:
		_far_sound()
	elif roll < 0.9:
		Game.stare_until = Game.clock + randf_range(4.0, 7.0)
	else:
		_slow = randf_range(3.0, 6.0)


# --- Figures ----------------------------------------------------------------------

func _mat(c: Color, rough := 0.85) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_DEPTH_PRE_PASS
	_mats.append(m)
	return m


func _cap(parent: Node3D, r: float, hgt: float, m: Material, pos: Vector3, rot := Vector3.ZERO) -> void:
	var cm := CapsuleMesh.new()
	cm.radius = r
	cm.height = hgt
	var mi := MeshInstance3D.new()
	mi.mesh = cm
	mi.material_override = m
	mi.position = pos
	mi.rotation = rot
	parent.add_child(mi)


## A person-shaped figure (feet at the origin, facing -Z).
func _figure() -> Node3D:
	var f := Node3D.new()
	var coat := _mat([Color(0.08, 0.08, 0.09), Color(0.2, 0.18, 0.15), Color(0.12, 0.14, 0.18)][randi() % 3])
	var pants := _mat(Color(0.07, 0.07, 0.08))
	var skin := _mat([Color(0.8, 0.65, 0.55), Color(0.5, 0.36, 0.27)][randi() % 2], 0.6)
	for sx in [-1.0, 1.0]:
		_cap(f, 0.075, 0.9, pants, Vector3(0.1 * sx, 0.46, 0))
		_cap(f, 0.055, 0.62, coat, Vector3(0.24 * sx, 1.17, 0.02), Vector3(0, 0, 0.08 * sx))
	_cap(f, 0.16, 0.66, coat, Vector3(0, 1.22, 0), Vector3(0, 0, PI * 0.5))
	_cap(f, 0.15, 0.6, coat, Vector3(0, 1.2, 0))
	var head := SphereMesh.new()
	head.radius = 0.1
	head.height = 0.23
	var hm := MeshInstance3D.new()
	hm.mesh = head
	hm.material_override = skin
	hm.position = Vector3(0, 1.66, 0)
	f.add_child(hm)
	add_child(f)
	return f


func _ground(at: Vector3) -> Vector3:
	var q := PhysicsRayQueryParameters3D.create(at + Vector3.UP * 3.0, at + Vector3.DOWN * 6.0, Game.LAYER_WORLD)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	return hit.position if not hit.is_empty() else Vector3.INF


func _view() -> Array:
	var cam: Camera3D = Game.player.cam
	var fwd := -cam.global_basis.z
	fwd.y = 0.0
	return [cam.global_position, fwd.normalized()]


func _spawn(kind: String, pos: Vector3, face: Vector3, life: float, vel := Vector3.ZERO, lying := false) -> void:
	var g := _ground(pos)
	if g == Vector3.INF:
		return
	var f := _figure()
	f.global_position = g
	var fl := Vector3(face.x, 0, face.z)
	if fl.length() > 0.01:
		f.look_at(g + fl.normalized(), Vector3.UP)
	if lying:
		f.rotate_object_local(Vector3.RIGHT, -PI * 0.5)
		f.global_position = g + Vector3.UP * 0.12
	_figures.append({"node": f, "kind": kind, "born": _clock, "life": life, "vel": vel})


## Standing some way off to the side, watching.
func _watcher() -> void:
	var v := _view()
	var side := 1.0 if randf() < 0.5 else -1.0
	var dir: Vector3 = (v[1] as Vector3).rotated(Vector3.UP, deg_to_rad(randf_range(38.0, 65.0)) * side)
	var at: Vector3 = v[0] + dir * randf_range(12.0, 24.0)
	_spawn("watcher", at, (v[0] as Vector3) - at, randf_range(9.0, 16.0))


## Right behind the player, with footsteps closing in.
func _behind() -> void:
	var v := _view()
	var back: Vector3 = -(v[1] as Vector3)
	var at: Vector3 = v[0] + back * randf_range(2.5, 4.0)
	_spawn("behind", at, (v[0] as Vector3) - at, 9.0)
	for i in 5:
		var d: float = 7.0 - i * 1.2
		var p: Vector3 = v[0] + back * d + Vector3.DOWN * 1.5
		get_tree().create_timer(0.45 * i).timeout.connect(func():
			Game.play_3d(Sfx.get_stream(&"step"), p, -10.0 + i, 0.06, 3.0))


## Someone walking across, far off.
func _passer() -> void:
	var v := _view()
	var fwd: Vector3 = v[1]
	var right := fwd.cross(Vector3.UP)
	var side := 1.0 if randf() < 0.5 else -1.0
	var at: Vector3 = v[0] + fwd * randf_range(14.0, 22.0) - right * side * 7.0
	_spawn("passer", at, right * side, 7.0, right * side * 1.3)


## A body lying ahead that is not there when you get close.
func _lying() -> void:
	var v := _view()
	var at: Vector3 = v[0] + (v[1] as Vector3).rotated(Vector3.UP, randf_range(-0.4, 0.4)) * randf_range(9.0, 14.0)
	_spawn("lying", at, Vector3(randf_range(-1, 1), 0, randf_range(-1, 1)), 30.0, Vector3.ZERO, true)


func _whisper() -> void:
	var cam: Camera3D = Game.player.cam
	var side := cam.global_basis.x * (1.0 if randf() < 0.5 else -1.0)
	var p := AudioStreamPlayer3D.new()
	p.stream = Sfx.get_stream(&"exhale")
	p.bus = &"World"
	p.pitch_scale = randf_range(0.55, 0.75)
	p.volume_db = -8.0
	p.unit_size = 1.0
	add_child(p)
	p.global_position = cam.global_position + side * 0.45 - cam.global_basis.z * 0.1
	p.finished.connect(p.queue_free)
	p.play()
	Game.hallu_jolt = 0.4


func _far_sound() -> void:
	var v := _view()
	var dir: Vector3 = (v[1] as Vector3).rotated(Vector3.UP, randf() * TAU)
	var pos: Vector3 = v[0] + dir * randf_range(40.0, 80.0)
	var s: StringName = [&"pistol_shot", &"shotgun_shot", &"metal_hit"][randi() % 3]
	Game.play_3d(Sfx.get_stream(s), pos, -6.0, 0.1, 25.0)


func _update_figures(delta: float) -> void:
	if Game.player == null:
		return
	var cam: Camera3D = Game.player.cam
	var i := 0
	while i < _figures.size():
		var f: Dictionary = _figures[i]
		var n: Node3D = f["node"]
		n.global_position += (f["vel"] as Vector3) * delta
		var to := n.global_position + Vector3.UP * 1.2 - cam.global_position
		var ang := rad_to_deg((-cam.global_basis.z).angle_to(to))
		var gone: bool = _clock - float(f["born"]) > float(f["life"]) or Game.high < 0.05
		match f["kind"]:
			"watcher":
				gone = gone or ang < 12.0 or to.length() < 8.0
			"behind":
				gone = gone or ang < 75.0
			"lying":
				gone = gone or to.length() < 5.0
			"passer":
				gone = gone or ang < 6.0
		if gone:
			if ang < 40.0:
				Game.hallu_jolt = 0.6
			n.queue_free()
			_figures.remove_at(i)
			continue
		i += 1
