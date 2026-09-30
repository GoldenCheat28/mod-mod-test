extends RefCounted
## Procedural first-person weapon models. Moving parts are separate named
## nodes (Slide, Mag, Pump, HandShell) so weapon.gd can animate them.
## Forward is -Z, origin is roughly at the trigger.

const Tex = preload("res://scripts/world/textures.gd")
const Shape = preload("res://scripts/weapons/shape.gd")

static var _mats := {}


static func _mat(key: String) -> StandardMaterial3D:
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	match key:
		"polymer":
			m.albedo_color = Color(0.07, 0.07, 0.075)
			m.roughness = 0.62
			m.normal_enabled = true
			m.normal_texture = Tex.noise("stipple", 0.25, 2, 128, true, 3.0)
			m.normal_scale = 0.5
			m.uv1_triplanar = true
			m.uv1_scale = Vector3.ONE * 18.0
		"steel":
			m.albedo_color = Color(0.1, 0.1, 0.105)
			m.metallic = 0.85
			m.roughness = 0.38
			m.normal_enabled = true
			m.normal_texture = Tex.detail_normal()
			m.normal_scale = 0.15
			m.uv1_triplanar = true
			m.uv1_scale = Vector3.ONE * 6.0
		"steel_worn":
			m.albedo_color = Color(0.2, 0.2, 0.21)
			m.metallic = 0.9
			m.roughness = 0.3
		"bore":
			m.albedo_color = Color(0.01, 0.01, 0.01)
			m.roughness = 0.9
		"brass":
			m.albedo_color = Color(0.78, 0.58, 0.25)
			m.metallic = 1.0
			m.roughness = 0.3
		"shell":
			m.albedo_color = Color(0.55, 0.06, 0.05)
			m.roughness = 0.5
		"wood":
			var g := Gradient.new()
			g.set_color(0, Color(0.18, 0.09, 0.04))
			g.set_color(1, Color(0.38, 0.2, 0.09))
			var n := FastNoiseLite.new()
			n.frequency = 0.02
			n.noise_type = FastNoiseLite.TYPE_SIMPLEX
			var t := NoiseTexture2D.new()
			t.noise = n
			t.color_ramp = g
			t.seamless = true
			m.albedo_texture = t
			m.uv1_triplanar = true
			m.uv1_scale = Vector3(2.0, 2.0, 40.0)
			m.roughness = 0.55
		"rubber":
			m.albedo_color = Color(0.03, 0.03, 0.03)
			m.roughness = 0.95
		"bakelite":
			m.albedo_color = Color(0.36, 0.12, 0.05)
			m.roughness = 0.45
		"akm_wood":
			var g2 := Gradient.new()
			g2.set_color(0, Color(0.26, 0.1, 0.04))
			g2.set_color(1, Color(0.45, 0.2, 0.08))
			var n2 := FastNoiseLite.new()
			n2.frequency = 0.02
			var t2 := NoiseTexture2D.new()
			t2.noise = n2
			t2.color_ramp = g2
			t2.seamless = true
			m.albedo_texture = t2
			m.uv1_triplanar = true
			m.uv1_scale = Vector3(2.0, 2.0, 40.0)
			m.roughness = 0.4
		"sight":
			m.albedo_color = Color(0.9, 0.9, 0.85)
			m.emission_enabled = true
			m.emission = Color(0.5, 0.5, 0.45)
	_mats[key] = m
	return m


static func _box(parent: Node3D, size: Vector3, pos: Vector3, mat: String, rot := Vector3.ZERO, name := "") -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var m := BoxMesh.new()
	m.size = size
	mi.mesh = m
	mi.position = pos
	mi.rotation = rot
	mi.material_override = _mat(mat)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if name != "":
		mi.name = name
	parent.add_child(mi)
	return mi


## Cylinder along Z.
static func _cyl(parent: Node3D, radius: float, length: float, pos: Vector3, mat: String, segments := 16, name := "") -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var m := CylinderMesh.new()
	m.top_radius = radius
	m.bottom_radius = radius
	m.height = length
	m.radial_segments = segments
	m.rings = 1
	mi.mesh = m
	mi.position = pos
	mi.rotation = Vector3(PI * 0.5, 0, 0)
	mi.material_override = _mat(mat)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if name != "":
		mi.name = name
	parent.add_child(mi)
	return mi


## A part cut out in side profile (points are (z, y)) and given its
## thickness (+-half across).
static func _ext(parent: Node3D, pts: Array, half: float, mat: String, name := "") -> MeshInstance3D:
	var outline := PackedVector2Array()
	for p in pts:
		outline.append(p)
	var mi := Shape.extrude(outline, half, _mat(mat), minf(half * 0.12, 0.0015))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if name != "":
		mi.name = name
	parent.add_child(mi)
	return mi


static func _node(parent: Node3D, name: String, pos := Vector3.ZERO) -> Node3D:
	var n := Node3D.new()
	n.name = name
	n.position = pos
	parent.add_child(n)
	return n


static func pistol() -> Node3D:
	var root := Node3D.new()
	root.name = "Pistol"
	# Frame and grip in one piece: the dust cover in front, the beavertail
	# over the web of the hand, the raked grip with its finger swell.
	_ext(root, [Vector2(-0.142, 0.013), Vector2(0.022, 0.013), Vector2(0.042, 0.008), Vector2(0.05, -0.004),
			Vector2(0.047, -0.012), Vector2(0.058, -0.055), Vector2(0.066, -0.1), Vector2(0.062, -0.108),
			Vector2(0.024, -0.108), Vector2(0.018, -0.1), Vector2(0.008, -0.06), Vector2(0.004, -0.045),
			Vector2(0.007, -0.035), Vector2(0.002, -0.025), Vector2(-0.004, -0.015), Vector2(-0.03, -0.013),
			Vector2(-0.142, -0.013), Vector2(-0.146, 0.0)], 0.0135, "polymer")
	for i in 3:
		_box(root, Vector3(0.026, 0.003, 0.004), Vector3(0, -0.0135, -0.1 - i * 0.012), "polymer")
	var grip_rot := Vector3(-0.3, 0, 0)
	# Stippled grip panels.
	for sx in [-1.0, 1.0]:
		var panel := _ext(root, [Vector2(0.014, -0.03), Vector2(0.046, -0.03), Vector2(0.056, -0.09), Vector2(0.026, -0.098),
				Vector2(0.014, -0.06)], 0.0008, "rubber")
		panel.position.x = 0.0138 * sx
	# Trigger guard.
	_ext(root, [Vector2(-0.002, -0.012), Vector2(-0.008, -0.035), Vector2(-0.052, -0.036), Vector2(-0.062, -0.024),
			Vector2(-0.063, -0.012), Vector2(-0.058, -0.012), Vector2(-0.057, -0.022), Vector2(-0.05, -0.031),
			Vector2(-0.012, -0.03), Vector2(-0.007, -0.012)], 0.0055, "polymer")
	_box(root, Vector3(0.006, 0.022, 0.006), Vector3(0, -0.022, -0.026), "steel", Vector3(0.25, 0, 0), "Trigger")
	# Barrel (static; the slide moves over it).
	_cyl(root, 0.0068, 0.03, Vector3(0, 0.03, -0.155), "steel_worn", 12)
	_cyl(root, 0.0048, 0.031, Vector3(0, 0.03, -0.155), "bore", 10)
	# Slide.
	var slide := _node(root, "Slide")
	# The slide: squared sides, the top rounded off, the muzzle end sloped.
	_ext(slide, [Vector2(-0.16, 0.015), Vector2(0.026, 0.015), Vector2(0.026, 0.041), Vector2(0.021, 0.047),
			Vector2(-0.15, 0.047), Vector2(-0.16, 0.041)], 0.0125, "steel")
	_box(slide, Vector3(0.01, 0.018, 0.035), Vector3(0.0126, 0.037, -0.05), "bore")      # ejection port
	_box(slide, Vector3(0.012, 0.012, 0.03), Vector3(0.0112, 0.038, -0.05), "brass")     # barrel hood
	for i in 6:
		for side in [-1.0, 1.0]:
			_box(slide, Vector3(0.001, 0.022, 0.002), Vector3(side * 0.0128, 0.03, 0.012 - i * 0.005), "bore")
	# Sights: a front post with a white dot, seen through the notch of the rear sight.
	_box(slide, Vector3(0.0035, 0.009, 0.006), Vector3(0, 0.052, -0.152), "steel")                # front post
	_box(slide, Vector3(0.0022, 0.0022, 0.001), Vector3(0, 0.0545, -0.1554), "sight")
	for sx in [-1.0, 1.0]:
		_box(slide, Vector3(0.0065, 0.009, 0.007), Vector3(sx * 0.0065, 0.052, 0.018), "steel")    # rear sight, either side of the notch
		_box(slide, Vector3(0.0016, 0.0016, 0.001), Vector3(sx * 0.0058, 0.0535, 0.0145), "sight")
	_box(slide, Vector3(0.0066, 0.004, 0.007), Vector3(0, 0.0495, 0.018), "steel")                # notch floor
	# Magazine: travels along the grip axis.
	var mag := _node(root, "Mag", Vector3(0, -0.058, 0.03))
	mag.rotation = grip_rot
	_box(mag, Vector3(0.022, 0.1, 0.032), Vector3(0, 0.0, 0.0), "steel")
	_box(mag, Vector3(0.028, 0.012, 0.046), Vector3(0, -0.056, 0.002), "polymer")
	_box(mag, Vector3(0.008, 0.004, 0.012), Vector3(0, 0.051, -0.006), "brass")
	# Markers.
	_node(root, "Muzzle", Vector3(0, 0.03, -0.172))
	_node(root, "Eject", Vector3(0.018, 0.04, -0.05))
	return root


static func shotgun() -> Node3D:
	var root := Node3D.new()
	root.name = "Shotgun"
	# Receiver, rounded off at the back where it meets the stock.
	_ext(root, [Vector2(-0.16, -0.019), Vector2(0.036, -0.019), Vector2(0.045, 0.0), Vector2(0.044, 0.03),
			Vector2(0.036, 0.043), Vector2(-0.16, 0.043)], 0.017, "steel")
	_box(root, Vector3(0.028, 0.008, 0.19), Vector3(0, 0.046, -0.06), "steel")
	_box(root, Vector3(0.006, 0.026, 0.06), Vector3(0.0172, 0.02, -0.08), "bore")                # ejection port
	_box(root, Vector3(0.022, 0.006, 0.07), Vector3(0, -0.02, -0.08), "bore")                    # loading port
	# Trigger group and its guard.
	_box(root, Vector3(0.026, 0.02, 0.09), Vector3(0, -0.026, -0.01), "polymer")
	_ext(root, [Vector2(0.03, -0.018), Vector2(0.028, -0.05), Vector2(0.0, -0.062), Vector2(-0.035, -0.058),
			Vector2(-0.04, -0.018), Vector2(-0.034, -0.018), Vector2(-0.03, -0.052), Vector2(0.0, -0.056),
			Vector2(0.022, -0.046), Vector2(0.024, -0.018)], 0.006, "polymer")
	_box(root, Vector3(0.006, 0.024, 0.006), Vector3(0, -0.044, 0.004), "steel", Vector3(0.2, 0, 0))
	# Barrel, magazine tube, bead.
	_cyl(root, 0.0125, 0.5, Vector3(0, 0.03, -0.41), "steel", 18)
	_cyl(root, 0.0085, 0.502, Vector3(0, 0.03, -0.41), "bore", 12)
	_cyl(root, 0.011, 0.43, Vector3(0, 0.0, -0.37), "steel", 14)
	_cyl(root, 0.0125, 0.02, Vector3(0, 0.0, -0.585), "steel_worn", 14)
	_box(root, Vector3(0.01, 0.006, 0.02), Vector3(0, 0.017, -0.58), "steel")                    # barrel clamp
	var bead := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.0025
	s.height = 0.005
	bead.mesh = s
	bead.material_override = _mat("sight")
	bead.position = Vector3(0, 0.058, -0.652)
	root.add_child(bead)
	# Ramp the bead sits on, so it stands clear above the receiver when aiming.
	_box(root, Vector3(0.006, 0.013, 0.02), Vector3(0, 0.049, -0.65), "steel")
	# Pump forend (wood) with grooves.
	var pump := _node(root, "Pump")
	_cyl(pump, 0.022, 0.2, Vector3(0, 0.006, -0.3), "wood", 16)
	for i in 8:
		var ring := MeshInstance3D.new()
		var t := TorusMesh.new()
		t.inner_radius = 0.0215
		t.outer_radius = 0.0232
		t.rings = 16
		t.ring_segments = 4
		ring.mesh = t
		ring.material_override = _mat("bore")
		ring.position = Vector3(0, 0.006, -0.235 - i * 0.017)
		ring.rotation = Vector3(PI * 0.5, 0, 0)
		pump.add_child(ring)
	_box(pump, Vector3(0.006, 0.006, 0.18), Vector3(0.012, 0.014, -0.17), "steel")              # action bar
	# Stock: the wrist the hand wraps round, the comb under the cheek, the
	# heel and toe, and the rubber recoil pad.
	_ext(root, [Vector2(0.04, 0.03), Vector2(0.12, 0.02), Vector2(0.37, 0.03), Vector2(0.375, -0.1), Vector2(0.35, -0.105),
			Vector2(0.16, -0.05), Vector2(0.1, -0.058), Vector2(0.075, -0.05), Vector2(0.05, -0.022), Vector2(0.04, -0.012)], 0.0165, "wood")
	_ext(root, [Vector2(0.37, 0.032), Vector2(0.39, 0.034), Vector2(0.395, -0.1), Vector2(0.375, -0.106)], 0.018, "rubber")
	# Shell shown in the hand while loading.
	var hand_shell := _node(root, "HandShell", Vector3(0, -0.06, -0.08))
	var hull := MeshInstance3D.new()
	var hm := CylinderMesh.new()
	hm.top_radius = 0.0105
	hm.bottom_radius = 0.0105
	hm.height = 0.05
	hull.mesh = hm
	hull.material_override = _mat("shell")
	hull.rotation.x = PI * 0.5
	hull.position.z = -0.01
	hand_shell.add_child(hull)
	_cyl(hand_shell, 0.011, 0.016, Vector3(0, 0, 0.023), "brass", 12)
	hand_shell.visible = false
	_node(root, "Muzzle", Vector3(0, 0.03, -0.665))
	_node(root, "Eject", Vector3(0.022, 0.025, -0.08))
	return root


## AKM: stamped receiver, wooden stock and handguards, curved magazine, the
## charging handle on the right (moves as "Slide"), front post in its ears and
## the notched rear sight on the trunnion.
static func akm() -> Node3D:
	var root := Node3D.new()
	root.name = "AKM"
	# Receiver and dust cover.
	_box(root, Vector3(0.036, 0.05, 0.3), Vector3(0, 0.018, -0.08), "steel")
	# The dust cover, rounded over the top, with the rear bump of its catch.
	_ext(root, [Vector2(-0.19, 0.042), Vector2(0.07, 0.042), Vector2(0.078, 0.047), Vector2(0.071, 0.056),
			Vector2(-0.186, 0.057), Vector2(-0.19, 0.052)], 0.017, "steel")
	_box(root, Vector3(0.037, 0.006, 0.06), Vector3(0, 0.013, -0.07), "bore")                   # ejection port / selector slot
	_box(root, Vector3(0.004, 0.02, 0.07), Vector3(0.0195, 0.02, -0.02), "steel_worn")           # selector lever
	# Grip, trigger guard, trigger.
	_ext(root, [Vector2(0.018, -0.007), Vector2(0.05, -0.007), Vector2(0.075, -0.09), Vector2(0.078, -0.11),
			Vector2(0.058, -0.115), Vector2(0.04, -0.1), Vector2(0.022, -0.03)], 0.0145, "bakelite")
	_box(root, Vector3(0.012, 0.005, 0.06), Vector3(0, -0.032, -0.02), "steel")
	_box(root, Vector3(0.006, 0.022, 0.006), Vector3(0, -0.018, -0.01), "steel", Vector3(0.25, 0, 0), "Trigger")
	# Stock with butt plate.
	# The stock drops from the line of the bore to the butt, narrow at the
	# wrist behind the grip; the steel butt plate on its end.
	_ext(root, [Vector2(0.07, 0.036), Vector2(0.36, 0.004), Vector2(0.365, -0.11), Vector2(0.34, -0.118),
			Vector2(0.15, -0.06), Vector2(0.1, -0.04), Vector2(0.07, -0.012)], 0.0165, "akm_wood")
	_ext(root, [Vector2(0.36, 0.006), Vector2(0.372, 0.006), Vector2(0.377, -0.112), Vector2(0.365, -0.12)], 0.018, "steel_worn")
	# Handguards, gas tube, barrel, muzzle brake.
	# Lower handguard with its finger swells, the upper over the gas tube.
	_ext(root, [Vector2(-0.23, -0.017), Vector2(-0.3, -0.022), Vector2(-0.36, -0.018), Vector2(-0.43, -0.012),
			Vector2(-0.435, 0.02), Vector2(-0.23, 0.022)], 0.023, "akm_wood")
	_ext(root, [Vector2(-0.24, 0.031), Vector2(-0.4, 0.033), Vector2(-0.405, 0.05), Vector2(-0.25, 0.055)], 0.018, "akm_wood")
	_cyl(root, 0.009, 0.24, Vector3(0, 0.022, -0.52), "steel", 14)
	_cyl(root, 0.0062, 0.242, Vector3(0, 0.022, -0.52), "bore", 10)
	_cyl(root, 0.013, 0.045, Vector3(0, 0.022, -0.655), "steel_worn", 14)
	_box(root, Vector3(0.012, 0.016, 0.03), Vector3(0, 0.035, -0.435), "steel")               # gas block
	# Front sight: post between two ears.
	_ext(root, [Vector2(-0.59, 0.03), Vector2(-0.612, 0.03), Vector2(-0.612, 0.058), Vector2(-0.606, 0.064),
			Vector2(-0.594, 0.064), Vector2(-0.59, 0.045)], 0.007, "steel")
	_box(root, Vector3(0.003, 0.014, 0.003), Vector3(0, 0.063, -0.6), "steel")
	for sx in [-1.0, 1.0]:
		_box(root, Vector3(0.003, 0.018, 0.012), Vector3(sx * 0.0075, 0.062, -0.6), "steel")
	# Rear sight block with the notch.
	_box(root, Vector3(0.024, 0.012, 0.03), Vector3(0, 0.054, -0.215), "steel")
	for sx in [-1.0, 1.0]:
		_box(root, Vector3(0.008, 0.009, 0.006), Vector3(sx * 0.0065, 0.064, -0.205), "steel")
	# Magazine: curves forward, travels along its seat.
	var mag := _node(root, "Mag", Vector3(0, -0.012, -0.13))
	mag.rotation = Vector3(0.12, 0, 0)
	# The curved "banana" magazine, one piece.
	_ext(mag, [Vector2(0.028, 0.005), Vector2(0.026, -0.06), Vector2(0.012, -0.12), Vector2(-0.012, -0.176),
			Vector2(-0.08, -0.16), Vector2(-0.052, -0.11), Vector2(-0.034, -0.055), Vector2(-0.028, 0.005)], 0.0125, "bakelite")
	_box(mag, Vector3(0.008, 0.004, 0.02), Vector3(0, 0.006, 0.0), "brass")
	# Charging handle.
	var slide := _node(root, "Slide")
	_box(slide, Vector3(0.008, 0.01, 0.1), Vector3(0.019, 0.03, -0.06), "steel_worn")
	_cyl(slide, 0.006, 0.02, Vector3(0.028, 0.03, -0.1), "steel_worn", 10)
	_node(root, "Muzzle", Vector3(0, 0.022, -0.68))
	_node(root, "Eject", Vector3(0.022, 0.03, -0.07))
	return root


static func _colmat(key: String, c: Color, rough: float, metal := 0.0) -> StandardMaterial3D:
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	_mats[key] = m
	return m


## The newer arms are made in arms_models.gd.
static func sawnoff() -> Node3D:
	return load("res://scripts/weapons/arms_models.gd").sawnoff()


static func crossbow() -> Node3D:
	return load("res://scripts/weapons/arms_models.gd").crossbow()


static func nailgun() -> Node3D:
	return load("res://scripts/weapons/arms_models.gd").nailgun()


static func flaregun() -> Node3D:
	return load("res://scripts/weapons/arms_models.gd").flaregun()


static func rifle() -> Node3D:
	return load("res://scripts/weapons/arms_models.gd").rifle()
