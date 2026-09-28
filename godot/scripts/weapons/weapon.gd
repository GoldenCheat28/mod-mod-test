extends Node3D
## First-person weapon: firing, hitscan ballistics, moving parts, reloads,
## casings, muzzle flash/smoke and procedural viewmodel motion.

const Models = preload("res://scripts/weapons/weapon_models.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")
const Tex = preload("res://scripts/world/textures.gd")

signal fired(kick: float)

enum State { IDLE, CYCLING, RELOADING, HOLSTERED }

var kind := "pistol"
var model: Node3D
var state := State.HOLSTERED

# Ammo.
var capacity := 12
var mag := 12
var chambered := true
var needs_pump := false

# Tuning (set in setup()).
var hip_pos := Vector3.ZERO
var fire_interval := 0.1
var pellets := 1
var spread_deg := 0.35
var impulse := 18.0
var kick := 1.0
var loudness := 1.0

var _cooldown := 0.0
var _action_t := 0.0          # time inside the current action (cycling/reload)
var _reload_step := 0
var _reload_interrupt := false
var _slide_t := 1.0
var _slide_locked := false
var _pump_t := -1.0
var _equip := 0.0             # 0 = holstered, 1 = raised
var _equip_target := 0.0
var _heat := 0.0
var _flash_t := 1.0

# Viewmodel motion springs (position + rotation).
var _rec_pos := Vector3.ZERO
var _rec_pos_v := Vector3.ZERO
var _rec_rot := Vector3.ZERO
var _rec_rot_v := Vector3.ZERO
var _sway := Vector3.ZERO
var _sway_pos := Vector3.ZERO
var _action_pose_pos := Vector3.ZERO
var _action_pose_rot := Vector3.ZERO
var _wall_push := 0.0

var _slide: Node3D
var _mag_node: Node3D
var _mag_rest: Transform3D
var _pump: Node3D
var _hand_shell: Node3D
var _muzzle: Node3D
var _eject: Node3D
var _flash_light: OmniLight3D
var _flash_mesh: Node3D
var _wisp: GPUParticles3D


func setup(weapon_kind: String) -> void:
	kind = weapon_kind
	if kind == "pistol":
		model = Models.pistol()
		hip_pos = Vector3(0.14, -0.13, -0.3)
		capacity = 12
		mag = 12
		fire_interval = 0.11
		pellets = 1
		spread_deg = 0.3
		impulse = 20.0
		kick = 1.0
		loudness = 1.0
	else:
		model = Models.shotgun()
		hip_pos = Vector3(0.13, -0.14, -0.28)
		capacity = 6
		mag = 6
		fire_interval = 0.3
		pellets = 9
		spread_deg = 2.8
		impulse = 11.0
		kick = 2.6
		loudness = 1.6
	add_child(model)
	_slide = model.get_node_or_null("Slide")
	_mag_node = model.get_node_or_null("Mag")
	if _mag_node:
		_mag_rest = _mag_node.transform
	_pump = model.get_node_or_null("Pump")
	_hand_shell = model.get_node_or_null("HandShell")
	_muzzle = model.get_node("Muzzle")
	_eject = model.get_node("Eject")
	_build_flash()
	_build_wisp()
	position = hip_pos
	visible = false


func _build_flash() -> void:
	_flash_light = OmniLight3D.new()
	_flash_light.light_color = Color(1.0, 0.72, 0.4)
	_flash_light.omni_range = 6.0
	_flash_light.light_energy = 0.0
	_flash_light.shadow_enabled = false
	_muzzle.add_child(_flash_light)

	var grad := Gradient.new()
	grad.set_color(0, Color(1.0, 0.95, 0.8, 1.0))
	grad.set_color(1, Color(1.0, 0.45, 0.1, 0.0))
	var tex := GradientTexture2D.new()
	tex.gradient = grad
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(0.5, 0.0)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.albedo_texture = tex
	mat.albedo_color = Color(1.4, 1.1, 0.8)
	_flash_mesh = Node3D.new()
	_muzzle.add_child(_flash_mesh)
	var size := 0.07 if kind == "pistol" else 0.13
	# Front-facing star plus two long side petals.
	for i in 3:
		var q := QuadMesh.new()
		var mi := MeshInstance3D.new()
		mi.mesh = q
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		if i == 0:
			q.size = Vector2(size, size)
		else:
			q.size = Vector2(size * 0.8, size * 2.4)
			mi.rotation = Vector3(PI * 0.5, 0, 0) if i == 1 else Vector3(PI * 0.5, 0, PI * 0.5)
			mi.position.z = -size * 0.9
		_flash_mesh.add_child(mi)
	_flash_mesh.visible = false


func _build_wisp() -> void:
	_wisp = GPUParticles3D.new()
	_wisp.amount = 28
	_wisp.lifetime = 2.2
	_wisp.local_coords = false
	_wisp.emitting = false
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 10.0
	pm.initial_velocity_min = 0.03
	pm.initial_velocity_max = 0.12
	pm.gravity = Vector3(0, 0.18, 0)
	pm.turbulence_enabled = true
	pm.turbulence_noise_strength = 0.6
	pm.turbulence_noise_scale = 1.2
	pm.turbulence_influence_min = 0.05
	pm.turbulence_influence_max = 0.1
	pm.scale_min = 0.6
	pm.scale_max = 1.0
	var c := Curve.new()
	c.max_value = 4.0
	c.add_point(Vector2(0, 0.3))
	c.add_point(Vector2(1, 2.5))
	var ct := CurveTexture.new()
	ct.curve = c
	pm.scale_curve = ct
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 0.14))
	g.set_color(1, Color(1, 1, 1, 0.0))
	var gt := GradientTexture1D.new()
	gt.gradient = g
	pm.color_ramp = gt
	_wisp.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.06, 0.06)
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = Tex.smoke_puff()
	m.albedo_color = Color(0.85, 0.85, 0.85)
	q.material = m
	_wisp.draw_pass_1 = q
	_wisp.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_wisp.visibility_aabb = AABB(Vector3(-2, -1, -2), Vector3(4, 4, 4))
	_muzzle.add_child(_wisp)


# --- Public controls ----------------------------------------------------------------

func raise() -> void:
	visible = true
	_equip_target = 1.0
	if state == State.HOLSTERED:
		state = State.IDLE
	Game.play_3d(Sfx.get_stream(&"slide_forward"), global_position, -14.0, 0.1, 2.0)


func lower() -> void:
	_equip_target = 0.0
	_reload_interrupt = true


func is_ready() -> bool:
	return _equip > 0.98


func is_holstered() -> bool:
	return _equip < 0.02 and _equip_target == 0.0


func total_ammo() -> int:
	return mag + (1 if chambered else 0)


func try_fire(cam: Camera3D, exclude: Array[RID]) -> void:
	if not is_ready():
		return
	if state == State.RELOADING:
		_reload_interrupt = true
		return
	if state != State.IDLE or _cooldown > 0.0:
		return
	if not chambered or needs_pump:
		Game.play_3d(Sfx.get_stream(&"dry_fire"), global_position, -6.0, 0.05, 2.0)
		_cooldown = 0.25
		if kind == "shotgun" and needs_pump:
			_start_pump()
		return
	_fire(cam, exclude)


func try_reload() -> void:
	if state != State.IDLE or not is_ready():
		return
	if mag >= capacity:
		if kind == "shotgun" and not chambered:
			_start_pump()
		return
	state = State.RELOADING
	_action_t = 0.0
	_reload_step = 0
	_reload_interrupt = false


# --- Firing ---------------------------------------------------------------------------

func _fire(cam: Camera3D, exclude: Array[RID]) -> void:
	_cooldown = fire_interval
	chambered = false
	var origin := cam.global_position
	var fwd := -cam.global_basis.z
	var space := get_world_3d().direct_space_state
	for i in pellets:
		var dir := _spread(fwd, cam.global_basis, spread_deg)
		_trace(space, origin, dir, exclude)

	# Sound, flash, smoke.
	var shot := &"pistol_shot" if kind == "pistol" else &"shotgun_shot"
	var p := AudioStreamPlayer.new()
	p.stream = Sfx.get_stream(shot)
	p.bus = &"World"
	p.volume_db = -2.0 if kind == "pistol" else 0.0
	p.pitch_scale = randf_range(0.95, 1.05)
	add_child(p)
	p.finished.connect(p.queue_free)
	p.play()
	Game.gunshot.emit(origin, loudness)

	_flash_t = 0.0
	_flash_mesh.visible = true
	_flash_mesh.rotation.z = randf() * TAU
	_flash_mesh.scale = Vector3.ONE * randf_range(0.8, 1.25)
	Game.fx.muzzle_smoke(_muzzle.global_position, -_muzzle.global_basis.z, 0.55 if kind == "pistol" else 1.0)
	_heat = minf(_heat + (0.3 if kind == "pistol" else 0.7), 1.5)

	# Recoil impulse on the viewmodel springs.
	var vm := 1.0 if kind == "pistol" else 1.5
	_rec_pos_v += Vector3(randf_range(-0.06, 0.06), 0.15, 0.9) * vm
	_rec_rot_v += Vector3(randf_range(120.0, 150.0), randf_range(-25.0, 25.0), randf_range(-35.0, 35.0)) * vm
	fired.emit(kick)

	if kind == "pistol":
		_slide_t = 0.0
		_eject_casing()
		if mag > 0:
			mag -= 1
			chambered = true
		else:
			_slide_locked = true
	else:
		needs_pump = true
		state = State.CYCLING
		_action_t = 0.0
		_pump_t = -0.2   # short delay before the pump stroke


func _spread(fwd: Vector3, basis_ref: Basis, deg: float) -> Vector3:
	var a := randf() * TAU
	var r := sqrt(randf()) * deg_to_rad(deg)
	var off := basis_ref.x * cos(a) * r + basis_ref.y * sin(a) * r
	return (fwd + off).normalized()


func _trace(space: PhysicsDirectSpaceState3D, origin: Vector3, dir: Vector3, exclude: Array[RID]) -> void:
	var q := PhysicsRayQueryParameters3D.create(origin, origin + dir * 250.0,
			Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS)
	q.exclude = exclude
	var hit := space.intersect_ray(q)
	var end := origin + dir * 250.0
	if not hit.is_empty():
		end = hit.position
		var col: Object = hit.collider
		if col.has_meta("humanoid"):
			var bot = col.get_meta("humanoid")
			bot.receive_hit(col, hit.position, dir, impulse, kind)
		else:
			if col is RigidBody3D:
				(col as RigidBody3D).apply_impulse(dir * impulse * 0.5, hit.position - (col as RigidBody3D).global_position)
			var surface: String = col.get_meta("surface", "concrete") if col is Node else "concrete"
			Game.fx.impact(hit.position, hit.normal, col, surface)
	Game.bullet_passed.emit(origin, end)


func _eject_casing() -> void:
	var b := _eject.global_basis
	var cam_vel := Vector3.ZERO
	if Game.player:
		cam_vel = Game.player.velocity
	var vel := cam_vel + b.x * randf_range(1.6, 2.6) + b.y * randf_range(1.0, 1.8) + b.z * randf_range(0.2, 0.8)
	var spin := Vector3(randf_range(-20, 20), randf_range(-40, 40), randf_range(-20, 20))
	var xf := Transform3D(b * Basis(Vector3.RIGHT, PI * 0.5) * Basis(Vector3.FORWARD, randf_range(-0.3, 0.3)), _eject.global_position)
	Game.fx.eject_casing("pistol" if kind == "pistol" else "shell", xf, vel, spin)


# --- Pump / reload state machines -----------------------------------------------------------

func _start_pump() -> void:
	state = State.CYCLING
	_pump_t = 0.0
	_action_t = 0.0


func _update_pump(delta: float) -> void:
	# Stroke: 0-0.14 back, 0.14-0.3 forward.
	var was := _pump_t
	_pump_t += delta
	# The recording clicks back at 0.05 s and forward at 0.25 s; start it so the
	# clicks land on the stroke ends (0.12 and 0.32).
	if was < 0.07 and _pump_t >= 0.07:
		Game.play_3d(Sfx.get_stream(&"pump_back"), global_position, -4.0, 0.03, 2.0)
	if was < 0.12 and _pump_t >= 0.12:
		if needs_pump:
			_eject_casing()
			needs_pump = false
	if was < 0.3 and _pump_t >= 0.3:
		if not chambered and mag > 0:
			mag -= 1
			chambered = true
	var k := 0.0
	if _pump_t > 0.0:
		k = clampf(_pump_t / 0.12, 0.0, 1.0) if _pump_t < 0.12 else clampf(1.0 - (_pump_t - 0.12) / 0.2, 0.0, 1.0)
	if _pump:
		_pump.position.z = smoothstep(0.0, 1.0, k) * 0.085
	_action_pose_rot.z = lerpf(_action_pose_rot.z, k * 0.12, 0.5)
	_action_pose_pos.z = lerpf(_action_pose_pos.z, k * 0.02, 0.5)
	if _pump_t >= 0.38:
		_pump_t = -1.0
		state = State.IDLE


func _update_pistol_reload(delta: float) -> void:
	var t := _action_t
	_action_t += delta
	var empty := _slide_locked
	# Keyframes: tilt, drop mag, bring new mag, seat, (slide release), return.
	var tilt := smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(1.5 if empty else 1.2, 1.85 if empty else 1.5, t))
	_action_pose_rot = Vector3(0.25, 0.35, 0.55) * tilt
	_action_pose_pos = Vector3(-0.03, 0.03, 0.02) * tilt
	if _reload_step == 0 and t > 0.28:
		_reload_step = 1
		Game.play_3d(Sfx.get_stream(&"mag_out"), global_position, -6.0, 0.05, 2.0)
	if _reload_step == 1:
		var k := clampf((t - 0.28) / 0.1, 0.0, 1.0)
		_mag_node.transform = _mag_rest.translated_local(Vector3(0, -0.12 * k, 0))
		if k >= 1.0:
			_reload_step = 2
			var box := Vector3(0.028, 0.11, 0.046)
			Game.fx.drop_copy(_mag_node, box, _mag_node.global_transform,
					Game.player.velocity + Vector3.DOWN * 1.5, Vector3(randf_range(-3, 3), 0, randf_range(-3, 3)), 0.09)
			_mag_node.visible = false
	if _reload_step == 2 and t > 0.55:
		_reload_step = 3
		_mag_node.visible = true
	if _reload_step == 3:
		var k := smoothstep(0.55, 1.0, t)
		_mag_node.transform = _mag_rest.translated_local(Vector3(0, -0.3 * (1.0 - k) - 0.02 * (1.0 - smoothstep(1.0, 1.08, t)), 0))
		if t > 1.08:
			_mag_node.transform = _mag_rest
			_reload_step = 4
			mag = capacity
			Game.play_3d(Sfx.get_stream(&"mag_in"), global_position, -4.0, 0.05, 2.0)
			_rec_pos_v += Vector3(0, 0.2, 0)
			_rec_rot_v += Vector3(-40.0, 0, 0)
	if _reload_step == 4:
		if empty and t > 1.2 and not has_meta("racked"):
			# Grab the slide and pull it back before letting it fly.
			set_meta("racked", true)
			Game.play_3d(Sfx.get_stream(&"slide_back"), global_position, -5.0, 0.03, 2.0)
			_rec_rot_v += Vector3(-15.0, 0, 20.0)
		if empty and t > 1.5:
			remove_meta("racked")
			_reload_step = 5
			_slide_locked = false
			_slide_t = 0.05
			mag -= 1
			chambered = true
			Game.play_3d(Sfx.get_stream(&"slide_forward"), global_position, -4.0, 0.05, 2.0)
			_rec_rot_v += Vector3(25.0, 0, -30.0)
		elif not empty:
			_reload_step = 5
	if _reload_step == 5 and t > (1.9 if empty else 1.55):
		state = State.IDLE
		_action_pose_rot = Vector3.ZERO
		_action_pose_pos = Vector3.ZERO


func _update_shotgun_reload(delta: float) -> void:
	var t := _action_t
	_action_t += delta
	# step 0: tilt in (0.3s); step 1: shell loop; step 2: pump if needed; step 3: tilt out.
	match _reload_step:
		0:
			var k := smoothstep(0.0, 0.3, t)
			_action_pose_rot = Vector3(0.1, 0.15, -0.6) * k
			_action_pose_pos = Vector3(-0.02, 0.04, 0.03) * k
			if t >= 0.3:
				_reload_step = 1
				_action_t = 0.0
		1:
			# One shell per 0.55 s.
			var k := t / 0.55
			_hand_shell.visible = k < 0.8
			var push := smoothstep(0.35, 0.7, k)
			_hand_shell.position = Vector3(0, -0.13 + push * 0.1, -0.08 + push * 0.02)
			_action_pose_rot.x = 0.1 + sin(k * PI) * 0.04
			if k >= 0.72 and not _hand_shell.has_meta("loaded"):
				_hand_shell.set_meta("loaded", true)
				mag = mini(mag + 1, capacity)
				Game.play_3d(Sfx.get_stream(&"shell_insert"), global_position, -5.0, 0.08, 2.0)
				_rec_pos_v += Vector3(0, 0.12, 0)
			if k >= 1.0:
				_hand_shell.remove_meta("loaded")
				_action_t = 0.0
				if mag >= capacity or _reload_interrupt:
					_hand_shell.visible = false
					_reload_step = 2 if not chambered else 3
		2:
			_start_pump()
			state = State.RELOADING
			_reload_step = 20
		20:
			_update_pump(delta)
			state = State.RELOADING
			if _pump_t < 0.0:
				_reload_step = 3
				_action_t = 0.0
		3:
			var k := 1.0 - smoothstep(0.0, 0.3, t)
			_action_pose_rot = Vector3(0.1, 0.15, -0.6) * k
			_action_pose_pos = Vector3(-0.02, 0.04, 0.03) * k
			if t >= 0.3:
				state = State.IDLE
				_action_pose_rot = Vector3.ZERO
				_action_pose_pos = Vector3.ZERO


## Switching away mid-action finishes it instantly so parts are not left displaced.
func _abort_actions() -> void:
	if has_meta("racked"):
		remove_meta("racked")
	if state == State.RELOADING:
		if kind == "pistol":
			if _reload_step >= 1:
				mag = capacity
				if _slide_locked:
					_slide_locked = false
					mag -= 1
					chambered = true
		elif _hand_shell:
			_hand_shell.visible = false
			_hand_shell.remove_meta("loaded")
	if _mag_node:
		_mag_node.transform = _mag_rest
		_mag_node.visible = true
	if _pump:
		_pump.position.z = 0.0
	if _pump_t >= -0.2 and _pump_t != -1.0:
		needs_pump = false
		if not chambered and mag > 0:
			mag -= 1
			chambered = true
	_pump_t = -1.0
	_action_pose_pos = Vector3.ZERO
	_action_pose_rot = Vector3.ZERO


# --- Per-frame update ------------------------------------------------------------------------

## ctx: look_delta (Vector2), bob (Vector2 offsets), sprint (0..1), air (float), cam (Camera3D)
func update(delta: float, ctx: Dictionary) -> void:
	_cooldown = maxf(_cooldown - delta, 0.0)
	_equip = move_toward(_equip, _equip_target, delta / (0.3 if _equip_target > 0.5 else 0.22))
	if _equip <= 0.0 and _equip_target == 0.0 and state != State.HOLSTERED:
		_abort_actions()
		visible = false
		state = State.HOLSTERED

	match state:
		State.CYCLING:
			if _pump_t < 0.0 and _pump_t > -1.0:
				_pump_t += delta
				if _pump_t >= 0.0:
					_pump_t = 0.0
			else:
				_update_pump(delta)
		State.RELOADING:
			if kind == "pistol":
				_update_pistol_reload(delta)
			else:
				_update_shotgun_reload(delta)
		_:
			_action_pose_rot = _action_pose_rot.lerp(Vector3.ZERO, minf(delta * 10.0, 1.0))
			_action_pose_pos = _action_pose_pos.lerp(Vector3.ZERO, minf(delta * 10.0, 1.0))

	# Slide cycle: fast back, slightly slower forward, or held back when locked.
	if _slide:
		_slide_t += delta
		var back := 0.0
		if _slide_locked:
			back = 1.0 if _slide_t > 0.03 else _slide_t / 0.03
		elif _slide_t < 0.03:
			back = _slide_t / 0.03
		elif _slide_t < 0.08:
			back = 1.0 - (_slide_t - 0.03) / 0.05
		_slide.position.z = back * 0.042

	# Flash and heat.
	_flash_t += delta
	_flash_light.light_energy = maxf(0.0, 1.0 - _flash_t / 0.05) * (4.0 if kind == "shotgun" else 2.5)
	if _flash_t > 0.035:
		_flash_mesh.visible = false
	_heat = maxf(_heat - delta * 0.18, 0.0)
	_wisp.emitting = _heat > 0.08 and _flash_t > 0.3
	_wisp.amount_ratio = clampf(_heat, 0.0, 1.0)

	# Springs.
	var k := 240.0 if kind == "pistol" else 150.0
	var d := 20.0 if kind == "pistol" else 15.0
	_rec_pos_v += (-_rec_pos * k - _rec_pos_v * d) * delta
	_rec_pos += _rec_pos_v * delta
	_rec_rot_v += (-_rec_rot * k - _rec_rot_v * d) * delta
	_rec_rot += _rec_rot_v * delta

	var look: Vector2 = ctx.get("look_delta", Vector2.ZERO)
	var target_sway := Vector3(clampf(-look.y * 0.0018, -0.08, 0.08), clampf(-look.x * 0.0018, -0.08, 0.08), clampf(-look.x * 0.0012, -0.06, 0.06))
	_sway = _sway.lerp(target_sway, minf(delta * 9.0, 1.0))
	_sway_pos = _sway_pos.lerp(Vector3(-target_sway.y * 0.12, target_sway.x * 0.12, 0), minf(delta * 7.0, 1.0))

	# Keep the gun out of walls.
	var cam: Camera3D = ctx.get("cam")
	if cam:
		var q := PhysicsRayQueryParameters3D.create(cam.global_position, cam.global_position - cam.global_basis.z * 0.75, Game.LAYER_WORLD | Game.LAYER_PROPS)
		var hit := get_world_3d().direct_space_state.intersect_ray(q)
		var push := 0.0
		if not hit.is_empty():
			push = clampf(1.0 - cam.global_position.distance_to(hit.position) / 0.75, 0.0, 1.0)
		_wall_push = lerpf(_wall_push, push, minf(delta * 10.0, 1.0))

	var bob: Vector2 = ctx.get("bob", Vector2.ZERO)
	var sprint: float = ctx.get("sprint", 0.0)
	var air: float = ctx.get("air", 0.0)
	var lowered := 1.0 - smoothstep(0.0, 1.0, _equip)

	var pos := hip_pos
	pos += Vector3(bob.x * 0.6, bob.y * 0.8, 0)
	pos += _sway_pos
	pos += Vector3(-0.03, -0.05, 0.03) * sprint
	pos += Vector3(0, clampf(-air * 0.006, -0.03, 0.03), 0)
	pos += Vector3(0, 0, 0.12) * _wall_push
	pos += Vector3(0, -0.25, 0.05) * lowered
	pos += _action_pose_pos
	pos += Vector3(_rec_pos.x * 0.3, _rec_pos.y * 0.3, _rec_pos.z)
	var rot := _sway
	rot += Vector3(-0.2, 0.55, 0.2) * sprint
	rot += Vector3(0.55, 0.3, 0) * _wall_push
	rot += Vector3(-0.9, 0.3, 0.2) * lowered
	rot += _action_pose_rot
	rot += Vector3(deg_to_rad(_rec_rot.x), deg_to_rad(_rec_rot.y), deg_to_rad(_rec_rot.z))
	rot.z += bob.x * 0.8
	transform = Transform3D(Basis.from_euler(rot), pos)
