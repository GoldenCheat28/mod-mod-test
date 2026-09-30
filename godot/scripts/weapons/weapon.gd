extends Node3D
## First-person weapon: firing, hitscan ballistics, moving parts, reloads,
## casings, muzzle flash/smoke and procedural viewmodel motion.

const Models = preload("res://scripts/weapons/weapon_models.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")
const Tex = preload("res://scripts/world/textures.gd")
const Smoke = preload("res://scripts/fx/smoke.gd")
const Revolver = preload("res://scripts/weapons/revolver.gd")
const Projectile = preload("res://scripts/weapons/projectile.gd")
## Guns that are loaded by hand, shot by shot (no magazine, slide or pump):
## the sawn-off, the crossbow, the nail gun, the flare pistol.
const SPECIAL := ["sawnoff", "crossbow", "nailgun", "flaregun", "rifle"]
## ...and what those fire, if not bullets.
const FIRES := {"crossbow": "bolt", "nailgun": "nail", "flaregun": "flare"}

signal fired(kick: float)

enum State { IDLE, CYCLING, RELOADING, HOLSTERED }

var kind := "pistol"
var net_echo := false            # tracing someone else's shot here (net.gd): no hits on players
var net_shooter: Node3D = null   # (and who fired it, for the person it hits)
## Keeps firing while the trigger is held (AKM).
var automatic := false
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
var _sway_v := Vector3.ZERO
var _breath := 0.0
var _action_pose_pos := Vector3.ZERO
var _action_pose_rot := Vector3.ZERO
var _wall_push := 0.0
## Held with Alt: where the hands have moved the gun to (camera space, on top
## of the normal hold) and how it is turned. The player keeps it within reach.
var free_pos := Vector3.ZERO
var free_rot := Vector3.ZERO
## Aiming down the sights (right mouse): 0 = hip, 1 = sights on the eye line.
var aim_target := 0.0
var aim := 0.0
var aim_pos := Vector3.ZERO
var _body_push := Vector3.ZERO   # camera space: moves the gun out of the chest
# Reload hand work: where spare magazines/shells are (world, on the belt), where
# the left hand normally holds the gun, and whether the gun was empty.
var pocket := Vector3.ZERO
var _support := Vector3.INF
var _reload_empty := false
## Revolver loaded for Russian roulette (R held): the one chamber with a
## round in it, -1 when loaded normally. Nobody knows which it is.
var roulette_round := -1
var _roulette_load := false     # the reload in progress is the one-round one
var _spin_v := 0.0

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
		aim_pos = Vector3(0.0, -0.0572, -0.27)   # front post level with the rear notch, on the eye line
		capacity = 12
		mag = 12
		fire_interval = 0.11
		pellets = 1
		spread_deg = 0.3
		impulse = 6.0     # real 9 mm momentum is ~3 N s; a little extra for feel
		kick = 1.0
		loudness = 1.0
	elif kind == "akm":
		model = Models.akm()
		hip_pos = Vector3(0.12, -0.15, -0.3)
		aim_pos = Vector3(0.0, -0.069, -0.25)    # front post in the rear notch, stock in the shoulder
		capacity = 30
		mag = 30
		fire_interval = 0.1       # ~600 rounds a minute
		pellets = 1
		spread_deg = 0.45
		impulse = 9.0
		kick = 1.5
		loudness = 1.9
		automatic = true
	elif kind == "revolver":
		# Six in the cylinder, double action: every pull turns the next one up
		# and drops the hammer on it; the empties stay in until reloading.
		var rv := Revolver.new()
		rv.rounds = 6
		model = rv
		var muzzle := Node3D.new()
		muzzle.name = "Muzzle"
		muzzle.position = Revolver.MUZZLE
		rv.add_child(muzzle)
		var ej := Node3D.new()
		ej.name = "Eject"
		ej.position = Revolver.CYL_AXIS + Vector3(-0.03, 0.0, 0.03)
		ej.rotation = Vector3(0, 0, PI)
		rv.add_child(ej)
		var hs := MeshInstance3D.new()
		hs.name = "HandShell"
		var cm := CylinderMesh.new()
		cm.top_radius = 0.0045
		cm.bottom_radius = 0.0048
		cm.height = 0.038
		hs.mesh = cm
		var brass := StandardMaterial3D.new()
		brass.albedo_color = Color(0.78, 0.6, 0.25)
		brass.metallic = 0.9
		brass.roughness = 0.3
		hs.material_override = brass
		hs.rotation = Vector3(PI * 0.5, 0, 0)
		hs.visible = false
		rv.add_child(hs)
		hip_pos = Vector3(0.13, -0.13, -0.3)
		aim_pos = Vector3(0.0, -0.05, -0.27)     # front sight in the top strap's groove
		capacity = 5              # + the one under the hammer: six
		mag = 5
		fire_interval = 0.32
		pellets = 1
		spread_deg = 0.35
		impulse = 8.0
		kick = 1.9
		loudness = 1.4
	elif kind == "sawnoff":
		model = Models.sawnoff()
		hip_pos = Vector3(0.13, -0.13, -0.26)
		aim_pos = Vector3(0.0, -0.058, -0.2)
		capacity = 2
		mag = 2
		fire_interval = 0.18
		pellets = 12
		spread_deg = 6.5            # (a sawn-off barrel: no choke left)
		impulse = 3.5
		kick = 3.6
		loudness = 2.3
	elif kind == "rifle":
		model = Models.rifle()
		hip_pos = Vector3(0.12, -0.15, -0.34)
		aim_pos = Vector3(0.0, -0.058, -0.17)     # the eye behind the scope's eyepiece
		capacity = 1
		mag = 1
		fire_interval = 0.5
		pellets = 1
		spread_deg = 0.03
		impulse = 12.0
		kick = 2.2
		loudness = 2.0
	elif kind == "crossbow":
		model = Models.crossbow()
		hip_pos = Vector3(0.13, -0.17, -0.36)
		aim_pos = Vector3(0.0, -0.07, -0.14)      # the eye at the scope
		capacity = 1
		mag = 1
		fire_interval = 0.4
		pellets = 1
		spread_deg = 0.15
		impulse = 5.0
		kick = 0.7
		loudness = 0.15
	elif kind == "nailgun":
		model = Models.nailgun()
		hip_pos = Vector3(0.13, -0.12, -0.3)
		aim_pos = Vector3(0.0, -0.04, -0.28)
		capacity = 30
		mag = 30
		fire_interval = 0.16
		pellets = 1
		spread_deg = 1.2
		impulse = 1.5
		kick = 0.5
		loudness = 0.35
	elif kind == "flaregun":
		model = Models.flaregun()
		hip_pos = Vector3(0.13, -0.13, -0.3)
		aim_pos = Vector3(0.0, -0.05, -0.27)
		capacity = 1
		mag = 1
		fire_interval = 0.5
		pellets = 1
		spread_deg = 0.6
		impulse = 2.0
		kick = 1.4
		loudness = 0.8
	else:
		model = Models.shotgun()
		hip_pos = Vector3(0.13, -0.14, -0.28)
		aim_pos = Vector3(0.0, -0.058, -0.2)     # bead over the receiver, stock under the cheek
		capacity = 6
		mag = 6
		fire_interval = 0.3
		pellets = 9
		spread_deg = 2.8
		impulse = 3.0
		kick = 2.6
		loudness = 1.6
	add_child(model)
	_slide = model.get_node_or_null("Slide")
	_mag_node = model.get_node_or_null("Mag")
	if _mag_node:
		_mag_rest = _mag_node.transform
	_pump = model.get_node_or_null("Pump")
	_hand_shell = model.get_node_or_null("HandShell")
	_muzzle = model.find_child("Muzzle", true, false)
	_eject = model.find_child("Eject", true, false)
	if kind == "rifle":
		_build_scope()
	if kind == "crossbow":
		_cock(1.0)
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
	var size: float = {"pistol": 0.07, "akm": 0.11}.get(kind, 0.13)
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
	_wisp.amount = 14
	_wisp.lifetime = 1.6
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
	_wisp.draw_pass_1 = Smoke.quad("wisp", 0.06, Color(0.85, 0.85, 0.87), 0.8)
	_wisp.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_wisp.visibility_aabb = AABB(Vector3(-2, -1, -2), Vector3(4, 4, 4))
	_muzzle.add_child(_wisp)


# --- Public controls ----------------------------------------------------------------

func raise() -> void:
	visible = true
	_equip_target = 1.0
	if state == State.HOLSTERED:
		state = State.IDLE
	Game.play_3d(Sfx.get_stream(&"weapon_draw"), global_position, -8.0, 0.05, 2.0)


func lower() -> void:
	if _equip_target > 0.0 and visible:
		Game.play_3d(Sfx.get_stream(&"weapon_holster"), global_position, -9.0, 0.05, 2.0)
	_equip_target = 0.0
	_reload_interrupt = true


func is_ready() -> bool:
	return _equip > 0.98


## Grip point on the magazine (its own frame) where the fingers hold it.
func _mag_grip() -> Vector3:
	return Vector3(0, -0.05, 0.0) if kind == "pistol" else Vector3(0, -0.1, -0.02)


## Where the left hand is during a reload (world), or INF when it just holds
## the gun as usual. Pistol/AKM: off the gun, down to the belt for a fresh
## magazine, up into the magazine well, push it home, and on an empty gun a
## pull on the slide/charging handle. Shotgun: a shell from the belt for
## every one loaded.
func reload_hand(support: Vector3) -> Vector3:
	_support = support
	if state != State.RELOADING or pocket == Vector3.ZERO or support == Vector3.INF:
		return Vector3.INF
	var t := _action_t
	if kind == "shotgun" or kind == "revolver":
		if _reload_step != 1 or not _hand_shell:
			return Vector3.INF
		var k := t / 0.55
		var port := model.global_transform * (Vector3(0, -0.1, -0.08) if kind == "shotgun" else _cyl_mouth())
		if k < 0.3:
			return pocket.lerp(port, smoothstep(0.0, 0.3, k))
		if k < 0.75:
			return _hand_shell.global_position
		return port.lerp(pocket, smoothstep(0.75, 1.0, k))
	if not _mag_node:
		return Vector3.INF
	var well := model.global_transform * (_mag_rest * _mag_grip())
	var rack := Vector3.INF
	if _slide:
		rack = _slide.global_transform * (Vector3(0, 0.045, 0.015) if kind == "pistol" else Vector3(0.03, 0.03, -0.1))
	if t < 0.22:
		return support.lerp(well, smoothstep(0.05, 0.22, t))            # thumb the release / grab the old one
	if t < 0.5:
		return well.lerp(pocket, smoothstep(0.25, 0.5, t))
	if t < 0.6:
		return pocket
	if t < 1.1:
		return pocket.lerp(well, smoothstep(0.6, 0.88, t))
	if _reload_empty and rack != Vector3.INF:
		if t < 1.2:
			return well.lerp(rack, smoothstep(1.1, 1.2, t))
		if t < 1.55:
			return rack
		return rack.lerp(support, smoothstep(1.55, 1.8, t))
	return well.lerp(support, smoothstep(1.1, 1.4, t))


func is_free() -> bool:
	return (free_pos.length() > 0.01 or free_rot.length() > 0.02) and aim < 0.5


func is_holstered() -> bool:
	return _equip < 0.02 and _equip_target == 0.0


func total_ammo() -> int:
	if roulette_round >= 0:
		return 1
	if kind in SPECIAL:
		return mag
	return mag + (1 if chambered else 0)


func try_fire(cam: Camera3D, exclude: Array[RID]) -> void:
	if not is_ready():
		return
	if state == State.RELOADING:
		_reload_interrupt = true
		return
	if state != State.IDLE or _cooldown > 0.0:
		return
	if roulette_round >= 0:
		# One round somewhere in the cylinder: each pull turns the next
		# chamber up under the hammer - a click, or the shot.
		_turn_cylinder()
		Game.play_3d(Sfx.get_stream(&"rev_cock"), global_position, -10.0, 0.05, 2.0)
		if (model as Revolver).chamber == roulette_round:
			roulette_round = -1
			mag = 0
			chambered = true
			_fire(cam, exclude, false)
			chambered = false
		else:
			Game.play_3d(Sfx.get_stream(&"rev_dry"), global_position, -3.0, 0.05, 2.0)
			_cooldown = 0.35
		return
	if not chambered or needs_pump:
		if kind == "revolver":
			Game.play_3d(Sfx.get_stream(&"rev_cock"), global_position, -10.0, 0.05, 2.0)
			Game.play_3d(Sfx.get_stream(&"rev_dry"), global_position, -3.0, 0.05, 2.0)
			_turn_cylinder()
		else:
			Game.play_3d(Sfx.get_stream(&"dry_fire"), global_position, -6.0, 0.05, 2.0)
		_cooldown = 0.25
		if kind == "shotgun" and needs_pump:
			_start_pump()
		return
	_fire(cam, exclude)


func try_reload() -> void:
	if state != State.IDLE or not is_ready():
		return
	if kind == "revolver" and roulette_round >= 0:
		roulette_round = -1        # a normal reload after a roulette one: all six again
		mag = 0
		chambered = false
	if mag >= capacity and (kind != "revolver" or chambered):
		if kind == "shotgun" and not chambered:
			_start_pump()
		return
	state = State.RELOADING
	_action_t = 0.0
	_reload_step = 0
	_reload_interrupt = false
	_reload_empty = _slide_locked
	_roulette_load = false


## Revolver, R held: out with everything, one round in, shut it and spin -
## Russian roulette with whoever the gun is pointed at (oneself too).
func roulette_reload() -> void:
	if kind != "revolver" or state != State.IDLE or not is_ready():
		return
	state = State.RELOADING
	_action_t = 0.0
	_reload_step = 0
	_reload_interrupt = false
	_roulette_load = true
	mag = 0
	chambered = false
	roulette_round = -1


# --- Firing ---------------------------------------------------------------------------

func _fire(cam: Camera3D, exclude: Array[RID], turn := true) -> void:
	_cooldown = fire_interval
	chambered = false
	var origin := cam.global_position
	var fwd := -cam.global_basis.z
	var ref := cam.global_basis
	var space := get_world_3d().direct_space_state
	if is_free():
		# Moved off the line of sight: the bullet goes where the barrel points,
		# from the muzzle (unless the muzzle is through a wall).
		fwd = -_muzzle.global_basis.z
		ref = _muzzle.global_basis
		var q := PhysicsRayQueryParameters3D.create(origin, _muzzle.global_position, Game.LAYER_WORLD | Game.LAYER_PROPS)
		q.exclude = exclude
		var block := space.intersect_ray(q)
		origin = _muzzle.global_position if block.is_empty() else (block.position as Vector3) - (_muzzle.global_position - origin).normalized() * 0.02
	var shooter := cam.get_parent()
	for i in pellets:
		var dir := _spread(fwd, ref, spread_deg * lerpf(1.0, 0.5, aim))
		# The gun turned on its owner (Alt): the shooter's own body is in the way.
		if is_free() and shooter and shooter.has_method("hitbox_test"):
			var self_hit: Dictionary = shooter.hitbox_test(origin, dir)
			if not self_hit.is_empty():
				var hp: Vector3 = self_hit["point"]
				var wq := PhysicsRayQueryParameters3D.create(origin, hp, Game.LAYER_WORLD | Game.LAYER_PROPS)
				if space.intersect_ray(wq).is_empty():
					shooter.hurt(hp, dir, kind, self_hit["region"])
					if Game.blood:
						var none: Array[RID] = [shooter.get_rid()]
						# Out through the far side of him, onto what is behind.
						Game.blood.exit_splatter(hp + dir * 0.2, dir, 1.0 if self_hit["region"] == "head" else 0.45, none)
					continue
		if FIRES.has(kind):
			# Out of the muzzle, at what the eye is on.
			var aimq := PhysicsRayQueryParameters3D.create(origin, origin + dir * 150.0, Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS)
			aimq.exclude = exclude
			var ah := space.intersect_ray(aimq)
			var tgt: Vector3 = ah.position if not ah.is_empty() else origin + dir * 150.0
			var m0: Vector3 = _muzzle.global_position
			Projectile.fire(get_tree().current_scene, FIRES[kind], m0, (tgt - m0).normalized(), SPEED[kind], exclude)
		else:
			_trace(space, origin, dir, exclude)

	# Sound, flash, smoke.
	var shot: StringName = {"pistol": &"pistol_shot", "revolver": &"rev_shot", "akm": &"akm_shot", "rifle": &"rifle_shot",
			"crossbow": &"mop_swish", "nailgun": &"casing", "flaregun": &"shell_drop"}.get(kind, &"shotgun_shot")
	var p := AudioStreamPlayer.new()
	p.stream = Sfx.get_stream(shot)
	p.bus = &"World"
	p.volume_db = {"pistol": -2.0, "revolver": 0.0, "akm": -3.0, "rifle": 2.0, "sawnoff": 4.0, "crossbow": -4.0, "nailgun": -2.0, "flaregun": -2.0}.get(kind, 0.0)
	p.pitch_scale = randf_range(0.97, 1.03) * {"rifle": 1.0, "sawnoff": 0.82, "crossbow": 0.5, "nailgun": 0.6, "flaregun": 0.7}.get(kind, 1.0)
	if kind == "crossbow":
		_cock(0.0)
		Game.play_3d(Sfx.get_stream(&"key_press"), global_position, -6.0, 0.05, 0.4)
	elif kind == "flaregun":
		Game.play_3d(Sfx.get_stream(&"lighter"), global_position, 2.0, 0.05, 0.8)
	add_child(p)
	p.finished.connect(p.queue_free)
	p.play()
	Game.player_fired = true
	Game.player_shot_t = Game.clock
	Game.player_shot_pos = origin
	Game.gunshot.emit(origin, loudness)
	if shooter == Game.player:
		var net = get_node_or_null("/root/Net")
		if net:
			net.local_shot(origin, fwd, kind)

	_flash_t = 0.0 if not kind in ["crossbow", "nailgun"] else 1.0
	_flash_mesh.visible = not kind in ["crossbow", "nailgun"]
	_flash_mesh.rotation.z = randf() * TAU
	_flash_mesh.scale = Vector3.ONE * randf_range(0.8, 1.25)
	if not kind in ["crossbow", "nailgun"]:
		Game.fx.muzzle_smoke(_muzzle.global_position, -_muzzle.global_basis.z, {"pistol": 0.55, "akm": 0.45, "sawnoff": 1.6}.get(kind, 1.0))
	_heat = minf(_heat + {"pistol": 0.3, "akm": 0.18}.get(kind, 0.7), 1.5)

	# Recoil impulse on the viewmodel springs.
	var vm: float = {"pistol": 1.0, "revolver": 1.4, "akm": 0.8, "rifle": 1.3, "sawnoff": 2.4, "crossbow": 0.5, "nailgun": 0.4, "flaregun": 1.1}.get(kind, 1.5)
	_rec_pos_v += Vector3(randf_range(-0.06, 0.06), 0.15, 0.9) * vm
	_rec_rot_v += Vector3(randf_range(120.0, 150.0), randf_range(-25.0, 25.0), randf_range(-35.0, 35.0)) * vm
	fired.emit(kick)

	if kind in SPECIAL:
		mag -= 1
		chambered = mag > 0
	elif kind == "revolver":
		if turn:
			_turn_cylinder()
		if mag > 0:
			mag -= 1
			chambered = true
	elif kind != "shotgun":
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


## How hard each material is to get through, relative to concrete.
const RESISTANCE := {"concrete": 1.0, "flesh": 0.3, "glass": 0.08, "metal": 6.0, "wood": 0.25}


## One bullet or pellet. It can pass through what it hits if it has the energy:
## the thickness is measured by finding the far side, each material costs
## energy per metre, and the bullet carries on weaker from the exit hole.
## How fast each leaves the muzzle (m/s), and how quickly the air slows it.
const MUZZLE_V := {"pistol": 360.0, "revolver": 400.0, "akm": 715.0, "shotgun": 400.0, "sawnoff": 380.0, "rifle": 850.0}
const DRAG := {"pistol": 0.14, "revolver": 0.12, "akm": 0.07, "shotgun": 0.9, "sawnoff": 1.0, "rifle": 0.04}
const START_POWER := {"pistol": 0.34, "revolver": 0.45, "akm": 0.6, "sawnoff": 0.14, "rifle": 0.9}


## One bullet or pellet, fired: it flies (bullet.gd), dropping and slowing,
## and what it meets on the way is worked out a stretch at a time below.
func _trace(space: PhysicsDirectSpaceState3D, origin: Vector3, dir: Vector3, exclude: Array[RID]) -> void:
	var sp: float = START_POWER.get(kind, 0.12)   # metres of concrete it can cross
	var b = load("res://scripts/weapons/bullet.gd").new()
	b.weapon = self
	b.pos = origin
	b.vel = dir * float(MUZZLE_V.get(kind, 400.0))
	b.power = sp
	b.start_power = sp
	b.drag = float(DRAG.get(kind, 0.2))
	b.exclude = exclude
	get_tree().current_scene.add_child(b)
	# (the first stretch at once: point blank is point blank)
	b.step(space, get_physics_process_delta_time())


## A stretch of a bullet's flight, `length` from `origin` along `dir`, with
## `power` left: what it hits there, and whether it gets through. Returns
## where it got to, what power is left, and whether it has stopped.
func _trace_seg(space: PhysicsDirectSpaceState3D, origin: Vector3, dir: Vector3, length: float, exclude: Array[RID],
		power: float, start_power: float) -> Dictionary:
	var from := origin
	var left := length
	for pass_i in 5:
		var q := PhysicsRayQueryParameters3D.create(from, from + dir * left,
				Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS)
		q.exclude = exclude
		var hit := space.intersect_ray(q)
		if hit.is_empty():
			return {"pos": from + dir * left, "power": power, "done": false}
		var energy := power / start_power
		var col: Object = hit.collider
		var surface := "concrete"
		if col.has_meta("remote_player") and net_echo:
			surface = "flesh"
		elif col.has_meta("remote_player"):
			# Another player (their puppet here): the hit is theirs to feel.
			var net = Engine.get_main_loop().root.get_node_or_null("Net")
			if net:
				net.hit_remote(int(col.get_meta("remote_player")), hit.position, dir, kind, col as Node)
			surface = "flesh"
			if Game.blood:
				var none: Array[RID] = []
				Game.blood._spray(hit.position, dir, 25.0, 2.0, 6.0, 8, 5.0, none)
		elif col.has_meta("humanoid"):
			var victim = col.get_meta("humanoid")
			victim.receive_hit(col, hit.position, dir, impulse * energy * (2.5 if kind in ["shotgun", "sawnoff"] else 1.0), kind)
			# Buckshot at close range stops a man: the whole of him is thrown
			# back (a running man is stopped in his tracks and knocked down).
			if kind in ["shotgun", "sawnoff"] and victim.has_method("knockback"):
				victim.knockback(dir, 0.55 * energy)
			if victim.ai and not victim.has_meta("puppet"):
				if net_shooter:
					victim.ai.on_attacked(net_shooter)
				elif not net_echo and Game.player:
					victim.ai.on_attacked(Game.player)
			surface = "flesh"
		else:
			if col is RigidBody3D:
				(col as RigidBody3D).apply_impulse(dir * impulse * 0.5 * energy, hit.position - (col as RigidBody3D).global_position)
			if col.has_method("damage"):
				col.damage({"pistol": 1.0, "akm": 1.6}.get(kind, 0.35) * energy, hit.position, dir)
			surface = col.get_meta("surface", "concrete") if col is Node else "concrete"
			Game.fx.impact(hit.position, hit.normal, col, surface)
		# Can it get through?
		var resist: float = RESISTANCE.get(surface, 1.0)
		var reach := power / resist + 0.01
		if col is RigidBody3D and surface == "metal":
			reach = 0.02    # a drum is a thin sheet, not solid steel
		var exit := _far_side(space, hit, dir, reach)
		if exit.is_empty():
			return {"pos": hit.position, "power": 0.0, "done": true}
		var thickness: float = (exit.position - hit.position).dot(dir)
		power -= (0.003 if reach == 0.02 else thickness) * resist
		if power <= 0.0:
			return {"pos": hit.position, "power": 0.0, "done": true}
		if surface != "flesh":
			# Exit hole and a spray of dust or splinters on the far side.
			Game.fx.impact(exit.position, exit.normal, col, surface)
		left -= ((exit.position as Vector3) - from).dot(dir) + 0.004
		from = exit.position + dir * 0.004
		if left <= 0.0:
			return {"pos": from, "power": power, "done": false}
	return {"pos": from, "power": power, "done": true}


## The surface where a bullet entering at `hit` comes out, if within `reach`:
## cast back from beyond it towards the entry and accept only the same object
## (and for the level, the same collision shape).
func _far_side(space: PhysicsDirectSpaceState3D, hit: Dictionary, dir: Vector3, reach: float) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(hit.position + dir * reach, hit.position + dir * 0.001,
			Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS)
	var back := space.intersect_ray(q)
	if back.is_empty() or back.collider != hit.collider:
		return {}
	if back.collider is StaticBody3D and back.get("shape", -1) != hit.get("shape", -2):
		return {}
	return back

func _eject_casing() -> void:
	var b := _eject.global_basis
	var cam_vel := Vector3.ZERO
	if Game.player:
		cam_vel = Game.player.velocity
	var vel := cam_vel + b.x * randf_range(1.6, 2.6) + b.y * randf_range(1.0, 1.8) + b.z * randf_range(0.2, 0.8)
	var spin := Vector3(randf_range(-20, 20), randf_range(-40, 40), randf_range(-20, 20))
	var xf := Transform3D(b * Basis(Vector3.RIGHT, PI * 0.5) * Basis(Vector3.FORWARD, randf_range(-0.3, 0.3)), _eject.global_position)
	Game.fx.eject_casing({"pistol": "pistol", "revolver": "pistol", "akm": "rifle"}.get(kind, "shell"), xf, vel, spin)


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
		_mag_node.transform = _mag_rest.translated_local(Vector3(0, -(0.12 if kind == "pistol" else 0.2) * k, 0))
		if k >= 1.0:
			_reload_step = 2
			var box := Vector3(0.028, 0.11, 0.046) if kind == "pistol" else Vector3(0.026, 0.2, 0.07)
			Game.fx.drop_copy(_mag_node, box, _mag_node.global_transform,
					Game.player.velocity + Vector3.DOWN * 1.5, Vector3(randf_range(-3, 3), 0, randf_range(-3, 3)), 0.09)
			_mag_node.visible = false
	if _reload_step == 2 and t > 0.5:
		_reload_step = 3
		_mag_node.visible = true
	if _reload_step == 3:
		var k := smoothstep(0.55, 1.0, t)
		_mag_node.transform = _mag_rest.translated_local(Vector3(0, -0.3 * (1.0 - k) - 0.02 * (1.0 - smoothstep(1.0, 1.08, t)), 0))
		if t < 0.88 and pocket != Vector3.ZERO:
			# Still in the left hand on its way up from the belt.
			var hand := reload_hand(_support)
			if hand != Vector3.INF:
				var seat := _mag_node.global_transform
				_mag_node.global_transform = Transform3D(seat.basis, hand - seat.basis * _mag_grip())
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
			if kind == "revolver":
				(model as Revolver).open = k
				if not has_meta("opened"):
					set_meta("opened", true)
					Game.play_3d(Sfx.get_stream(&"rev_cyl_open"), global_position, -6.0, 0.05, 2.0)
			if t >= 0.3:
				_reload_step = 1
				_action_t = 0.0
				if kind == "revolver":
					remove_meta("opened")
					# The empties tipped out of the open cylinder (for roulette
					# everything comes out, live rounds too).
					var out := 6 if _roulette_load else 6 - total_ammo()
					for i in out:
						_eject_casing()
					if out > 0:
						Game.play_3d(Sfx.get_stream(&"rev_dump"), global_position, -6.0, 0.05, 2.0)
		1:
			# One shell per 0.55 s.
			var k := t / 0.55
			_hand_shell.visible = k < 0.8
			var push := smoothstep(0.35, 0.7, k)
			if kind == "revolver":
				var mouth := _cyl_mouth()
				_hand_shell.position = (mouth + Vector3(-0.02, -0.07, 0.06)).lerp(mouth + Vector3(0, 0, 0.012), push)
			else:
				_hand_shell.position = Vector3(0, -0.13 + push * 0.1, -0.08 + push * 0.02)
			if k < 0.3 and pocket != Vector3.ZERO:
				# Taken from the belt: in the fingers on the way to the port.
				var port := _hand_shell.global_position
				_hand_shell.global_position = pocket.lerp(port, smoothstep(0.0, 0.3, k))
			_action_pose_rot.x = 0.1 + sin(k * PI) * 0.04
			if k >= 0.72 and not _hand_shell.has_meta("loaded"):
				_hand_shell.set_meta("loaded", true)
				if _roulette_load:
					roulette_round = randi() % Revolver.CHAMBERS
				elif kind == "revolver" and not chambered:
					chambered = true
				else:
					mag = mini(mag + 1, capacity)
				Game.play_3d(Sfx.get_stream(&"rev_round_in" if kind == "revolver" else &"shotgun_shell_in"), global_position, -5.0, 0.08, 2.0)
				_rec_pos_v += Vector3(0, 0.12, 0)
			if k >= 1.0:
				_hand_shell.remove_meta("loaded")
				_action_t = 0.0
				if mag >= capacity or _reload_interrupt or _roulette_load:
					_hand_shell.visible = false
					_reload_step = 2 if not chambered and kind == "shotgun" else 3
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
			if kind == "revolver":
				(model as Revolver).open = k
				if t >= 0.22 and not has_meta("shut"):
					set_meta("shut", true)
					Game.play_3d(Sfx.get_stream(&"rev_cyl_close"), global_position, -5.0, 0.05, 2.0)
			if t >= 0.3:
				if has_meta("shut"):
					remove_meta("shut")
				if _roulette_load:
					# Spun with a sweep of the hand; it settles where it settles.
					_reload_step = 4
					_action_t = 0.0
					_spin_v = randf_range(22.0, 30.0)
					Game.play_3d(Sfx.get_stream(&"rev_spin"), global_position, -4.0, 0.05, 2.0)
					return
				state = State.IDLE
				_action_pose_rot = Vector3.ZERO
				_action_pose_pos = Vector3.ZERO
		4:
			# The cylinder spinning down (roulette), the gun tipped to watch it.
			var rv := model as Revolver
			_action_pose_rot = _action_pose_rot.lerp(Vector3(0.05, 0.1, -0.35), minf(delta * 10.0, 1.0))
			rv.spin += _spin_v * delta
			_spin_v = maxf(_spin_v - 22.0 * delta, 0.0)
			if _spin_v <= 0.0:
				var steps := int(round(rv.spin / (TAU / Revolver.CHAMBERS)))
				rv.chamber = (rv.chamber + steps) % Revolver.CHAMBERS
				rv.spin = 0.0
				_roulette_load = false
				state = State.IDLE
				_action_pose_rot = Vector3.ZERO
				_action_pose_pos = Vector3.ZERO


## Switching away mid-action finishes it instantly so parts are not left displaced.
func _abort_actions() -> void:
	for pm in _props:
		if is_instance_valid(pm):
			pm.queue_free()
	_props.clear()
	if has_meta("racked"):
		remove_meta("racked")
	if state == State.RELOADING:
		if kind == "revolver":
			(model as Revolver).open = 0.0
			(model as Revolver).spin = 0.0
			if _roulette_load and roulette_round < 0:
				roulette_round = randi() % Revolver.CHAMBERS
			_roulette_load = false
			for m in ["opened", "shut"]:
				if has_meta(m):
					remove_meta(m)
			if _hand_shell:
				_hand_shell.visible = false
				_hand_shell.remove_meta("loaded")
		elif kind != "shotgun":
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
	if kind == "rifle":
		_scope_tick()
	if kind == "revolver":
		var rv := model as Revolver
		if roulette_round >= 0 or _roulette_load:
			rv.rounds = -1
			rv.loaded = roulette_round
			rv.round_in = 1.0
		else:
			rv.rounds = total_ammo()
		rv.hammer = move_toward(rv.hammer, 0.0, delta * 8.0)
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
			if kind in SPECIAL:
				_update_hand_reload(delta)
			elif kind != "shotgun" and kind != "revolver":
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
	_flash_light.light_energy = maxf(0.0, 1.0 - _flash_t / 0.05) * {"shotgun": 4.0, "akm": 3.2}.get(kind, 2.5)
	if _flash_t > 0.035:
		_flash_mesh.visible = false
	_heat = maxf(_heat - delta * 0.18, 0.0)
	_wisp.emitting = _heat > 0.08 and _flash_t > 0.3
	_wisp.amount_ratio = clampf(_heat, 0.0, 1.0)

	# Springs.
	var k: float = {"pistol": 240.0, "akm": 200.0}.get(kind, 150.0)
	var d: float = {"pistol": 20.0, "akm": 18.0}.get(kind, 15.0)
	_rec_pos_v += (-_rec_pos * k - _rec_pos_v * d) * delta
	_rec_pos += _rec_pos_v * delta
	_rec_rot_v += (-_rec_rot * k - _rec_rot_v * d) * delta
	_rec_rot += _rec_rot_v * delta

	var look: Vector2 = ctx.get("look_delta", Vector2.ZERO)
	# The hands hold it, not the eyes: turning, it trails behind on the arms
	# and swings a little past when the turn stops (a damped spring, heavier
	# guns lag more).
	var heavy: float = {"pistol": 0.7, "akm": 1.25, "shotgun": 1.15}.get(kind, 1.0)
	var target_sway := Vector3(clampf(-look.y * 0.0032, -0.14, 0.14), clampf(-look.x * 0.0032, -0.14, 0.14), clampf(-look.x * 0.002, -0.09, 0.09)) * heavy
	var ks := 110.0 / heavy
	_sway_v += ((target_sway - _sway) * ks - _sway_v * 2.0 * sqrt(ks) * 0.65) * delta
	_sway += _sway_v * delta
	_sway_pos = _sway_pos.lerp(Vector3(-_sway.y * 0.2, _sway.x * 0.2, 0), minf(delta * 9.0, 1.0))

	# Keep the gun out of walls.
	var cam: Camera3D = ctx.get("cam")
	if cam:
		var q := PhysicsRayQueryParameters3D.create(cam.global_position, cam.global_position - cam.global_basis.z * 0.75, Game.LAYER_WORLD | Game.LAYER_PROPS)
		var hit := get_world_3d().direct_space_state.intersect_ray(q)
		var push := 0.0
		if not hit.is_empty():
			push = clampf(1.0 - cam.global_position.distance_to(hit.position) / 0.75, 0.0, 1.0)
		_wall_push = lerpf(_wall_push, push, minf(delta * 10.0, 1.0))

	var busy := state == State.RELOADING or _equip < 0.9
	aim = move_toward(aim, 0.0 if busy else aim_target, delta * 5.5)
	var ak := smoothstep(0.0, 1.0, aim)
	var steady := 1.0 - 0.75 * ak      # sway and bob are held down while aiming
	var bob: Vector2 = ctx.get("bob", Vector2.ZERO) * steady
	var sprint: float = ctx.get("sprint", 0.0)
	var air: float = ctx.get("air", 0.0)
	var lowered := 1.0 - smoothstep(0.0, 1.0, _equip)

	var pos := hip_pos.lerp(aim_pos, ak)
	if Game.bodycam:
		# The camera is on the chest, below and in front of the eyes: the
		# gun is held up in front of the face - higher and further out from
		# it; aimed, out at arm's length along the top of the picture.
		pos += Vector3(0.0, 0.14, -0.1).lerp(Vector3(0.0, 0.2, -0.2), ak)
	# The shoulders turn only part of the way with the eyes: looking down the
	# gun comes up into the view and looking up it drops, as held by arms.
	if cam:
		var pitch := cam.global_basis.get_euler().x
		pos += Vector3(0.0, -pitch * 0.045, pitch * 0.02) * (1.0 - ak)
	# Breathing, held still when aiming.
	_breath += delta
	pos += Vector3(sin(_breath * 0.9) * 0.0025, sin(_breath * 1.8) * 0.003, 0.0) * steady
	pos += Vector3(bob.x * 0.6, bob.y * 0.8, 0)
	pos += _sway_pos * steady
	pos += Vector3(-0.03, -0.05, 0.03) * sprint
	pos += Vector3(0, clampf(-air * 0.006, -0.03, 0.03), 0)
	pos += Vector3(0, 0, 0.12) * _wall_push
	pos += Vector3(0, -0.25, 0.05) * lowered
	pos += _action_pose_pos
	pos += free_pos * (1.0 - lowered) * (1.0 - ak)
	pos += Vector3(_rec_pos.x * 0.3, _rec_pos.y * 0.3, _rec_pos.z)
	var rot := _sway * steady
	if cam:
		rot.x += cam.global_basis.get_euler().x * -0.08 * (1.0 - ak)
	rot += Vector3(-0.2, 0.55, 0.2) * sprint
	rot += Vector3(0.55, 0.3, 0) * _wall_push
	rot += Vector3(-0.9, 0.3, 0.2) * lowered
	rot += _action_pose_rot
	rot += Vector3(deg_to_rad(_rec_rot.x), deg_to_rad(_rec_rot.y), deg_to_rad(_rec_rot.z))
	rot.z += bob.x * 0.8
	# Looking down the chest comes up under the gun: the hands keep it in
	# front of the body instead of pushing through it.
	var want_push := Vector3.ZERO
	if cam and ctx.has("chest_a"):
		var cxf := cam.global_transform
		var wp := cxf * pos
		var a: Vector3 = ctx["chest_a"]
		var ab: Vector3 = ctx["chest_b"] - a
		var c := a + ab * clampf((wp - a).dot(ab) / maxf(ab.length_squared(), 1e-4), 0.0, 1.0)
		var off := wp - c
		var fwd_flat := -cxf.basis.z
		fwd_flat.y = 0.0
		fwd_flat = fwd_flat.normalized() if fwd_flat.length() > 0.05 else Vector3.FORWARD
		var clear := 0.3
		if off.length() < clear:
			var out_dir := off.normalized() if off.length() > 0.02 else fwd_flat
			out_dir = (out_dir + fwd_flat * 0.6).normalized()
			want_push = cxf.basis.inverse() * (c + out_dir * clear - wp)
	_body_push = _body_push.lerp(want_push, minf(delta * 14.0, 1.0))
	pos += _body_push
	var free_b := Basis.from_euler(free_rot * (1.0 - lowered)).get_rotation_quaternion().slerp(Quaternion.IDENTITY, ak)
	transform = Transform3D(Basis(free_b) * Basis.from_euler(rot), pos)


# --- Revolver ----------------------------------------------------------------------------

## The next chamber turned up under the hammer (as the trigger does).
func _turn_cylinder() -> void:
	var rv := model as Revolver
	rv.chamber = (rv.chamber + 1) % Revolver.CHAMBERS
	rv.hammer = 1.0


## The back of the chamber being loaded (model space), the cylinder open.
func _cyl_mouth() -> Vector3:
	var rv := model as Revolver
	return rv.to_local(rv._cyl.global_transform * Vector3(0, 0.011, 0.02))


const SPEED := {"crossbow": 75.0, "nailgun": 85.0, "flaregun": 34.0}


## Someone's shot drawn here (net.gd): a bullet traced, or what they fired
## sent flying (doing no harm here: it is theirs).
func shoot_along(space: PhysicsDirectSpaceState3D, origin: Vector3, dir: Vector3, ex: Array[RID]) -> void:
	if FIRES.has(kind):
		Projectile.fire(get_tree().current_scene, FIRES[kind], origin + dir * 0.4, dir, SPEED[kind], ex, true)
	else:
		_trace(space, origin, dir, ex)


## The crossbow's string: 1 drawn back to the nut (cocked), 0 loosed.
func _cock(k: float) -> void:
	var bolt := model.get_node_or_null("Bolt") as Node3D
	if bolt:
		bolt.visible = k > 0.99 and mag > 0
	load("res://scripts/weapons/arms_models.gd").crossbow_string(model, k)


## Loading the hand-loaded ones: the sawn-off broken open, both empties out,
## two shells in, snapped shut; the crossbow's string cranked back and a
## bolt laid on; a new strip of nails pushed in; the flare gun broken open
## and a cartridge in.
func _update_hand_reload(delta: float) -> void:
	var t := _action_t
	_action_t += delta
	var dur: float = {"sawnoff": 1.7, "crossbow": 2.3, "nailgun": 1.5, "flaregun": 1.4, "rifle": 1.7}[kind]
	var up := smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(dur - 0.3, dur, t))
	_action_pose_rot = Vector3(0.35, 0.25, 0.35) * up
	_action_pose_pos = Vector3(-0.02, 0.04, 0.03) * up
	var barrels := model.get_node_or_null("Barrels") as Node3D
	if barrels:
		# Broken open: the barrels drop on the hinge, then shut.
		barrels.rotation.x = -0.75 * smoothstep(0.2, 0.45, t) * (1.0 - smoothstep(dur - 0.45, dur - 0.3, t))
	if _reload_step == 0 and t > 0.45:
		_reload_step = 1
		Game.play_3d(Sfx.get_stream(&"slide_back" if kind != "crossbow" else &"pump_back"), global_position, -6.0, 0.05, 2.0)
		if kind == "sawnoff":
			for i in 2:
				Game.fx.eject_casing("shell", _eject.global_transform, Game.player.velocity + Vector3.UP * 1.2 + global_basis.z * 0.8,
						Vector3(randf_range(-6, 6), 0, randf_range(-6, 6)))
	if kind == "crossbow":
		_cock(smoothstep(0.4, 1.5, t))
	_reload_props(t, dur)
	if _reload_step == 1 and t > dur * 0.6:
		_reload_step = 2
		Game.play_3d(Sfx.get_stream(&"shotgun_shell_in" if kind in ["sawnoff", "flaregun"] else &"mag_in"), global_position, -5.0, 0.05, 2.0)
	if _reload_step == 2 and t > dur - 0.3:
		_reload_step = 3
		Game.play_3d(Sfx.get_stream(&"slide_forward"), global_position, -5.0, 0.05, 2.0)
		mag = capacity
		chambered = true
		if kind == "crossbow":
			_cock(1.0)
	if t > dur:
		state = State.IDLE
		_action_pose_rot = Vector3.ZERO
		_action_pose_pos = Vector3.ZERO


var _props: Array = []            # what the hand is putting in, while reloading


## Something the hand puts in: a shell, a flare cartridge, a strip of nails.
func _prop_mesh(what: String) -> Node3D:
	var n := Node3D.new()
	var AM = load("res://scripts/weapons/arms_models.gd")
	match what:
		"shell":
			var hull := MeshInstance3D.new()
			var cm := CylinderMesh.new()
			cm.top_radius = 0.0115
			cm.bottom_radius = 0.0115
			cm.height = 0.052
			hull.mesh = cm
			hull.material_override = AM.mat("red")
			hull.rotation = Vector3(PI * 0.5, 0, 0)
			hull.position = Vector3(0, 0, -0.026)
			n.add_child(hull)
			var head := MeshInstance3D.new()
			var hm := CylinderMesh.new()
			hm.top_radius = 0.0125
			hm.bottom_radius = 0.0125
			hm.height = 0.014
			head.mesh = hm
			head.material_override = AM.mat("brass")
			head.rotation = Vector3(PI * 0.5, 0, 0)
			head.position = Vector3(0, 0, 0.004)
			n.add_child(head)
		"round":
			var cs := MeshInstance3D.new()
			var cm3 := CylinderMesh.new()
			cm3.top_radius = 0.0045
			cm3.bottom_radius = 0.006
			cm3.height = 0.05
			cs.mesh = cm3
			cs.material_override = AM.mat("brass")
			cs.rotation = Vector3(PI * 0.5, 0, 0)
			n.add_child(cs)
			var bl := MeshInstance3D.new()
			var bm3 := CylinderMesh.new()
			bm3.top_radius = 0.0
			bm3.bottom_radius = 0.0042
			bm3.height = 0.018
			bl.mesh = bm3
			var cu := StandardMaterial3D.new()
			cu.albedo_color = Color(0.7, 0.4, 0.25)
			cu.metallic = 0.9
			cu.roughness = 0.35
			bl.material_override = cu
			bl.rotation = Vector3(-PI * 0.5, 0, 0)
			bl.position = Vector3(0, 0, -0.034)
			n.add_child(bl)
		"flare":
			var hull2 := MeshInstance3D.new()
			var cm2 := CylinderMesh.new()
			cm2.top_radius = 0.014
			cm2.bottom_radius = 0.014
			cm2.height = 0.06
			hull2.mesh = cm2
			var m := StandardMaterial3D.new()
			m.albedo_color = Color(0.85, 0.12, 0.08)
			m.roughness = 0.5
			hull2.material_override = m
			hull2.rotation = Vector3(PI * 0.5, 0, 0)
			hull2.position = Vector3(0, 0, -0.03)
			n.add_child(hull2)
			var rim := MeshInstance3D.new()
			var rm := CylinderMesh.new()
			rm.top_radius = 0.016
			rm.bottom_radius = 0.016
			rm.height = 0.004
			rim.mesh = rm
			rim.material_override = AM.mat("brass")
			rim.rotation = Vector3(PI * 0.5, 0, 0)
			n.add_child(rim)
		"strip":
			for i in 12:
				var nail := MeshInstance3D.new()
				var nm := CylinderMesh.new()
				nm.top_radius = 0.0015
				nm.bottom_radius = 0.0015
				nm.height = 0.06
				nail.mesh = nm
				nail.material_override = AM.mat("steel_bright")
				nail.position = Vector3(0, -0.02, -0.08 + i * 0.015)
				n.add_child(nail)
				var hd := MeshInstance3D.new()
				var hdm := CylinderMesh.new()
				hdm.top_radius = 0.0038
				hdm.bottom_radius = 0.0038
				hdm.height = 0.002
				hd.mesh = hdm
				hd.material_override = AM.mat("steel_bright")
				hd.position = Vector3(0, 0.011, -0.08 + i * 0.015)
				n.add_child(hd)
	for c in n.get_children():
		(c as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return n


## Puts things in with the hand as the reload goes: each prop comes up from
## low down (the belt, the pocket) and slides home where it goes.
func _reload_props(t: float, dur: float) -> void:
	# [what, parent node, from (local), to (local), start, end]
	var plan: Array = []
	var barrels := model.get_node_or_null("Barrels") as Node3D
	match kind:
		"rifle":
			# The bolt: up, back (the empty flies out), the round in, forward, down.
			var bh := model.get_node_or_null("BoltHandle") as Node3D
			if bh:
				var up := smoothstep(0.25, 0.45, t) * (1.0 - smoothstep(1.3, 1.45, t))
				var back := smoothstep(0.45, 0.65, t) * (1.0 - smoothstep(1.1, 1.3, t))
				bh.rotation.z = up * 1.2
				bh.position.z = 0.01 + back * 0.07
				if t > 0.6 and not has_meta("ejected"):
					set_meta("ejected", true)
					Game.fx.eject_casing("rifle", _eject.global_transform, Game.player.velocity + global_basis.x * 1.2 + Vector3.UP * 1.0,
							Vector3(randf_range(-9, 9), 0, randf_range(-9, 9)))
					Game.play_3d(Sfx.get_stream(&"slide_back"), global_position, -6.0, 0.05, 2.0)
				if t > 1.3 and not has_meta("bolt_home"):
					set_meta("bolt_home", true)
					Game.play_3d(Sfx.get_stream(&"slide_forward"), global_position, -6.0, 0.05, 2.0)
				if t > dur - 0.05:
					remove_meta("ejected")
					remove_meta("bolt_home")
			plan = [["round", model, Vector3(0.07, -0.13, 0.08), Vector3(0.0, 0.021, -0.03), 0.65, 1.05]]
		"sawnoff":
			if barrels:
				plan = [["shell", barrels, Vector3(0.06, -0.14, 0.12), Vector3(0.0132, 0.034, -0.002), 0.55, 0.85],
						["shell", barrels, Vector3(0.06, -0.14, 0.12), Vector3(-0.0132, 0.034, -0.002), 0.85, 1.15]]
		"flaregun":
			if barrels:
				plan = [["flare", barrels, Vector3(0.06, -0.14, 0.1), Vector3(0, 0.006, -0.002), 0.5, 0.95]]
		"nailgun":
			var mag := model.get_node_or_null("Mag") as Node3D
			if mag:
				plan = [["strip", mag, Vector3(0.0, -0.12, 0.06), Vector3(0.0, 0.0, 0.0), 0.35, 0.95]]
		"crossbow":
			# The bolt itself: laid on the rail from the side, then pushed back.
			var bolt := model.get_node_or_null("Bolt") as Node3D
			if bolt:
				if t < 1.5:
					bolt.visible = false
				else:
					bolt.visible = true
					var k := smoothstep(1.5, 1.85, t)
					var k2 := smoothstep(1.85, 2.05, t)
					bolt.position = Vector3(0.14, -0.08, -0.3).lerp(Vector3(0, 0.036, -0.24), k).lerp(Vector3(0, 0.036, -0.2), k2)
			return
	while _props.size() < plan.size():
		var pl: Array = plan[_props.size()]
		var pm := _prop_mesh(pl[0])
		(pl[1] as Node3D).add_child(pm)
		pm.visible = false
		_props.append(pm)
	for i in plan.size():
		var pl2: Array = plan[i]
		var pm2: Node3D = _props[i]
		var t0: float = pl2[4]
		var t1: float = pl2[5]
		if t < t0:
			pm2.visible = false
			continue
		pm2.visible = true
		var k3 := smoothstep(t0, t1, t)
		# Up and over first, then pushed straight in.
		var from: Vector3 = pl2[2]
		var to: Vector3 = pl2[3]
		var over := to + Vector3(0, 0.0, 0.07)
		pm2.position = from.lerp(over, smoothstep(0.0, 0.7, k3)).lerp(to, smoothstep(0.7, 1.0, k3))
	if t > dur - 0.05:
		# Home: they are part of the gun now.
		for pm3 in _props:
			if is_instance_valid(pm3):
				pm3.queue_free()
		_props.clear()


# --- The rifle's scope ---------------------------------------------------------------------------

var _scope_vp: SubViewport
var _scope_cam: Camera3D
var _scope_lens: MeshInstance3D
var _scope_mat: ShaderMaterial


## A real scope: a camera at its objective looking along it (a narrow field:
## four times), what it sees drawn into the eyepiece with the reticle.
func _build_scope() -> void:
	_scope_vp = SubViewport.new()
	_scope_vp.size = Vector2i(512, 512)
	_scope_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	_scope_vp.msaa_3d = Viewport.MSAA_2X
	add_child(_scope_vp)
	_scope_cam = Camera3D.new()
	_scope_cam.fov = 5.0
	_scope_cam.near = 0.05
	_scope_cam.far = 900.0
	_scope_vp.add_child(_scope_cam)
	_scope_cam.current = true
	var eye := model.find_child("ScopeEye", true, false) as Node3D
	_scope_mat = ShaderMaterial.new()
	_scope_mat.shader = load("res://shaders/scope_lens.gdshader")
	_scope_mat.set_shader_parameter("view_tex", _scope_vp.get_texture())
	_scope_lens = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.031, 0.031)
	_scope_lens.mesh = q
	_scope_lens.material_override = _scope_mat
	_scope_lens.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	eye.add_child(_scope_lens)


## Each frame the rifle is out: the scope's camera where the scope points,
## rendering only while one is looking through it.
func _scope_tick() -> void:
	if _scope_vp == null:
		return
	var looking := visible and aim > 0.4 and state != State.RELOADING
	_scope_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if looking else SubViewport.UPDATE_DISABLED
	_scope_mat.set_shader_parameter("active", clampf((aim - 0.4) / 0.4, 0.0, 1.0) if looking else 0.0)
	if not looking:
		return
	var front := model.find_child("ScopeFront", true, false) as Node3D
	_scope_cam.global_transform = front.global_transform
	# Where the eye is off the scope's line (the dark crescent).
	var cam := get_viewport().get_camera_3d()
	if cam:
		var lens_xf := _scope_lens.global_transform
		var rel := lens_xf.affine_inverse() * cam.global_position
		_scope_mat.set_shader_parameter("eye_off", Vector2(rel.x, -rel.y) / 0.01)
