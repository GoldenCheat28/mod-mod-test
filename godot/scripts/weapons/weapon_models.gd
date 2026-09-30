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
			# The plum-brown moulded magazine and grip, with a fine grain.
			m.albedo_color = Color(0.3, 0.1, 0.05)
			m.roughness = 0.5
			m.normal_enabled = true
			m.normal_texture = Tex.noise("stipple", 0.25, 2, 128, true, 3.0)
			m.normal_scale = 0.15
			m.uv1_triplanar = true
			m.uv1_scale = Vector3.ONE * 20.0
		"akm_wood":
			var g2 := Gradient.new()
			# Laminated birch stained red-brown and varnished: dark layers
			# and lighter ones, the grain long along the gun.
			g2.set_color(0, Color(0.16, 0.055, 0.025))
			g2.set_color(1, Color(0.36, 0.14, 0.06))
			var n2 := FastNoiseLite.new()
			n2.frequency = 0.02
			var t2 := NoiseTexture2D.new()
			t2.noise = n2
			t2.color_ramp = g2
			t2.seamless = true
			m.albedo_texture = t2
			m.uv1_triplanar = true
			m.uv1_scale = Vector3(2.0, 2.0, 40.0)
			m.roughness = 0.35
			m.normal_enabled = true
			m.normal_texture = Tex.noise("woodgrain", 0.05, 3, 256, true, 1.2)
			m.normal_scale = 0.35
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
## An AKM: the stamped receiver with its rounded dust cover, the laminated
## stock dropping from the line of the bore, the pistol grip, the lower and
## upper handguards round the barrel and gas tube, the gas block, front
## sight and the slant muzzle brake; the curved magazine. Every part is a
## smooth lofted solid and each one runs a few mm into the next, so there is
## no light between them.
static func akm() -> Node3D:
	var root := Node3D.new()
	root.name = "AKM"
	var AM = load("res://scripts/weapons/arms_models.gd")
	var steel: Material = AM.mat("blued")
	var worn: Material = AM.mat("steel_bright")
	var wood := _mat("akm_wood")
	var bake := _mat("bakelite")
	var bore := _mat("bore")
	var R := Shape.rrect
	# Receiver: flat stamped sides, the dust cover rounded over the top; the
	# front trunnion narrows it where the barrel goes in.
	var rec: PackedVector2Array = R.call(0.026, 0.06, 0.002, 4, 0.0, 0.017, 0.012)
	_lz(root, [[0.074, rec], [-0.2, rec], [-0.228, R.call(0.023, 0.046, 0.003, 4, 0.0, 0.021, 0.009)]], steel)
	# The dust cover's seam, the ejection port, rivets, the selector lever.
	_box(root, Vector3(0.0268, 0.0012, 0.268), Vector3(0, 0.031, -0.063), "bore")
	_box(root, Vector3(0.0272, 0.013, 0.062), Vector3(0, 0.035, -0.07), "bore")
	for z in [-0.17, -0.12, 0.02, 0.055]:
		_box(root, Vector3(0.0272, 0.004, 0.004), Vector3(0, -0.004, z), "steel_worn")      # rivet heads, both sides
	AM.ext(root, [Vector2(-0.125, 0.012), Vector2(-0.01, 0.014), Vector2(0.004, 0.006), Vector2(0.0, -0.004),
			Vector2(-0.012, 0.004), Vector2(-0.125, 0.004)], 0.0011, "blued", 0.0142)
	# Trigger guard (one loop from behind the magazine to the grip) and trigger.
	var guard_ring: PackedVector2Array = R.call(0.011, 0.004, 0.0015, 3)
	var guard := Shape.sweep([Vector3(0, -0.01, -0.082), Vector3(0, -0.028, -0.074), Vector3(0, -0.04, -0.052),
			Vector3(0, -0.041, -0.02), Vector3(0, -0.035, 0.006), Vector3(0, -0.012, 0.018)], guard_ring, steel)
	root.add_child(guard)
	AM.ext(root, [Vector2(-0.018, -0.012), Vector2(-0.024, -0.02), Vector2(-0.028, -0.033), Vector2(-0.024, -0.035),
			Vector2(-0.018, -0.026), Vector2(-0.012, -0.013)], 0.003, "steel_bright", 0.0, "Trigger")
	# Pistol grip: rakes back, fuller at the palm swell.
	var grip := Shape.sweep([Vector3(0, -0.006, 0.02), Vector3(0, -0.035, 0.03), Vector3(0, -0.07, 0.044),
			Vector3(0, -0.1, 0.056), Vector3(0, -0.108, 0.059)],
			[R.call(0.026, 0.032, 0.008, 4), R.call(0.028, 0.035, 0.01, 4), R.call(0.029, 0.036, 0.011, 4),
			R.call(0.028, 0.036, 0.01, 4), R.call(0.024, 0.03, 0.009, 4)], bake)
	root.add_child(grip)
	# Stock: from inside the back of the receiver, narrow at the wrist,
	# dropping and deepening to the butt; the steel butt plate on the end.
	_lz(root, [[0.062, R.call(0.025, 0.044, 0.008, 4, 0.0, 0.017)], [0.09, R.call(0.027, 0.048, 0.009, 4, 0.0, 0.012)],
			[0.14, R.call(0.03, 0.058, 0.01, 4, 0.0, 0.0)], [0.22, R.call(0.033, 0.085, 0.011, 4, 0.0, -0.018)],
			[0.3, R.call(0.035, 0.11, 0.012, 4, 0.0, -0.032)], [0.358, R.call(0.036, 0.124, 0.012, 4, 0.0, -0.04)]], wood)
	_lz(root, [[0.356, R.call(0.037, 0.126, 0.012, 4, 0.0, -0.04)], [0.366, R.call(0.036, 0.124, 0.011, 4, 0.0, -0.04)]], steel)
	# Lower handguard: round under the barrel, with the two finger swells.
	var lower := []
	for sec in [[-0.212, 0.036, 0.042, 0.009], [-0.26, 0.042, 0.05, 0.006], [-0.3, 0.039, 0.046, 0.007],
			[-0.35, 0.042, 0.05, 0.006], [-0.4, 0.039, 0.046, 0.008], [-0.438, 0.035, 0.04, 0.011]]:
		lower.append([sec[0], R.call(sec[1], sec[2], 0.014, 5, 0.0, sec[3])])
	_lz(root, lower, wood)
	# Its steel retainer band at the back and ferrule at the front.
	_lz(root, [[-0.207, R.call(0.038, 0.046, 0.013, 5, 0.0, 0.01)], [-0.219, R.call(0.038, 0.046, 0.013, 5, 0.0, 0.01)]], steel)
	_lz(root, [[-0.434, R.call(0.037, 0.043, 0.013, 5, 0.0, 0.011)], [-0.448, R.call(0.034, 0.04, 0.012, 5, 0.0, 0.012)]], steel)
	# Upper handguard over the gas tube (sits down on the lower one).
	var up_ring: PackedVector2Array = R.call(0.029, 0.023, 0.003, 4, 0.0, 0.0395, 0.011)
	_lz(root, [[-0.236, R.call(0.026, 0.02, 0.003, 4, 0.0, 0.038, 0.01)], [-0.25, up_ring], [-0.41, up_ring],
			[-0.426, R.call(0.026, 0.02, 0.003, 4, 0.0, 0.038, 0.01)]], wood)
	_cyl(root, 0.0078, 0.03, Vector3(0, 0.041, -0.437), "steel")                              # gas tube's front
	# Gas block, joining the tube to the barrel.
	_lz(root, [[-0.444, R.call(0.022, 0.038, 0.007, 4, 0.0, 0.031)], [-0.474, R.call(0.022, 0.038, 0.007, 4, 0.0, 0.031)]], steel)
	# Barrel, the cleaning rod under it, the front sight base and ears.
	_cyl(root, 0.0095, 0.45, Vector3(0, 0.022, -0.43), "steel")
	var rod: MeshInstance3D = AM.cyl(root, 0.0028, 0.2, Vector3(0, 0.006, -0.545), "steel_bright")
	rod.name = "CleaningRod"
	_lz(root, [[-0.574, R.call(0.022, 0.03, 0.007, 4, 0.0, 0.026)], [-0.612, R.call(0.022, 0.03, 0.007, 4, 0.0, 0.026)]], steel)
	AM.ext(root, [Vector2(-0.588, 0.035), Vector2(-0.61, 0.035), Vector2(-0.61, 0.06), Vector2(-0.604, 0.066),
			Vector2(-0.594, 0.066), Vector2(-0.588, 0.05)], 0.0065, "blued")
	for sx in [-1.0, 1.0]:
		_box(root, Vector3(0.003, 0.02, 0.014), Vector3(sx * 0.0075, 0.063, -0.6), "steel")
	_box(root, Vector3(0.003, 0.016, 0.003), Vector3(0, 0.063, -0.6), "steel")
	# Slant muzzle brake: longer underneath than on top.
	_cyl(root, 0.0118, 0.05, Vector3(0, 0.022, -0.636), "steel")
	_box(root, Vector3(0.024, 0.008, 0.012), Vector3(0, 0.012, -0.659), "steel", Vector3(-0.35, 0, 0))
	_cyl(root, 0.0056, 0.052, Vector3(0, 0.022, -0.637), "bore", 12)
	# Rear sight: its block on the trunnion, the leaf and the notch.
	_lz(root, [[-0.198, R.call(0.024, 0.018, 0.004, 3, 0.0, 0.05)], [-0.236, R.call(0.022, 0.014, 0.004, 3, 0.0, 0.048)]], steel)
	_box(root, Vector3(0.018, 0.003, 0.05), Vector3(0, 0.059, -0.19), "steel", Vector3(0.05, 0, 0))
	for sx in [-1.0, 1.0]:
		_box(root, Vector3(0.006, 0.006, 0.005), Vector3(sx * 0.005, 0.063, -0.168), "steel")
	# Magazine: the curved box, a lip at the top with a round showing, the
	# floor plate - rides along its seat when changed.
	var mag := _node(root, "Mag", Vector3(0, -0.012, -0.13))
	mag.rotation = Vector3(0.12, 0, 0)
	var mag_path := [Vector3(0, 0.006, 0.0), Vector3(0, -0.03, -0.004), Vector3(0, -0.07, -0.013), Vector3(0, -0.11, -0.026),
			Vector3(0, -0.15, -0.042), Vector3(0, -0.17, -0.051), Vector3(0, -0.178, -0.054)]
	var mag_rings := []
	for i in mag_path.size():
		var k := float(i) / (mag_path.size() - 1)
		var w := 0.025 + (0.004 if i == mag_path.size() - 1 else 0.0)
		mag_rings.append(R.call(w, lerpf(0.056, 0.07, k) + (0.006 if i == mag_path.size() - 1 else 0.0), 0.004, 3))
	mag.add_child(Shape.sweep(mag_path, mag_rings, bake))
	_box(mag, Vector3(0.009, 0.005, 0.022), Vector3(0, 0.008, 0.0), "brass")
	# Charging handle on the bolt carrier.
	var slide := _node(root, "Slide")
	_box(slide, Vector3(0.008, 0.01, 0.1), Vector3(0.017, 0.03, -0.06), "steel_worn")
	var knob: MeshInstance3D = AM.cyl(slide, 0.0062, 0.02, Vector3(0.026, 0.03, -0.1), "steel_bright", -1.0, 12)
	knob.rotation = Vector3(0, 0, PI * 0.5)
	_node(root, "Muzzle", Vector3(0, 0.022, -0.664))
	_node(root, "Eject", Vector3(0.022, 0.035, -0.07))
	for c in root.get_children():
		if c is GeometryInstance3D:
			(c as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return root


## A loft straight along the gun: `secs` is [[z, ring], ...].
static func _lz(parent: Node3D, secs: Array, mat: Material) -> MeshInstance3D:
	var sections := []
	for sec in secs:
		sections.append([Transform3D(Basis.IDENTITY, Vector3(0, 0, sec[0])), sec[1]])
	var mi := Shape.loft(sections, mat)
	parent.add_child(mi)
	return mi


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
