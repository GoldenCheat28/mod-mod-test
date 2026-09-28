extends RefCounted
## Procedural first-person weapon models. Moving parts are separate named
## nodes (Slide, Mag, Pump, HandShell) so weapon.gd can animate them.
## Forward is -Z, origin is roughly at the trigger.

const Tex = preload("res://scripts/world/textures.gd")

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


static func _node(parent: Node3D, name: String, pos := Vector3.ZERO) -> Node3D:
	var n := Node3D.new()
	n.name = name
	n.position = pos
	parent.add_child(n)
	return n


static func pistol() -> Node3D:
	var root := Node3D.new()
	root.name = "Pistol"
	# Frame and dust-cover rail.
	_box(root, Vector3(0.028, 0.026, 0.165), Vector3(0, 0.0, -0.058), "polymer")
	_box(root, Vector3(0.024, 0.01, 0.05), Vector3(0, -0.015, -0.115), "polymer")
	for i in 3:
		_box(root, Vector3(0.026, 0.004, 0.004), Vector3(0, -0.021, -0.1 - i * 0.012), "polymer")
	# Grip (raked back) with finger grooves and texture panel.
	var grip_rot := Vector3(-0.3, 0, 0)
	_box(root, Vector3(0.03, 0.105, 0.048), Vector3(0, -0.058, 0.03), "polymer", grip_rot)
	_box(root, Vector3(0.032, 0.06, 0.03), Vector3(0, -0.06, 0.036), "polymer", grip_rot)
	_box(root, Vector3(0.026, 0.02, 0.012), Vector3(0, -0.012, 0.047), "polymer", Vector3(0.5, 0, 0))   # beavertail
	# Trigger guard and trigger.
	_box(root, Vector3(0.012, 0.005, 0.05), Vector3(0, -0.037, -0.032), "polymer")
	_box(root, Vector3(0.012, 0.03, 0.006), Vector3(0, -0.023, -0.058), "polymer", Vector3(-0.2, 0, 0))
	_box(root, Vector3(0.006, 0.022, 0.006), Vector3(0, -0.022, -0.026), "steel", Vector3(0.25, 0, 0), "Trigger")
	# Barrel (static; the slide moves over it).
	_cyl(root, 0.0068, 0.03, Vector3(0, 0.03, -0.155), "steel_worn", 12)
	_cyl(root, 0.0048, 0.031, Vector3(0, 0.03, -0.155), "bore", 10)
	# Slide.
	var slide := _node(root, "Slide")
	_box(slide, Vector3(0.025, 0.03, 0.186), Vector3(0, 0.03, -0.067), "steel")
	_box(slide, Vector3(0.02, 0.006, 0.18), Vector3(0, 0.047, -0.067), "steel")          # rounded-ish top
	_box(slide, Vector3(0.01, 0.018, 0.035), Vector3(0.0126, 0.037, -0.05), "bore")      # ejection port
	_box(slide, Vector3(0.012, 0.012, 0.03), Vector3(0.0112, 0.038, -0.05), "brass")     # barrel hood
	for i in 6:
		for side in [-1.0, 1.0]:
			_box(slide, Vector3(0.001, 0.022, 0.002), Vector3(side * 0.0128, 0.03, 0.012 - i * 0.005), "bore")
	_box(slide, Vector3(0.004, 0.007, 0.006), Vector3(0, 0.051, -0.152), "steel")                 # front sight
	_box(slide, Vector3(0.002, 0.002, 0.002), Vector3(0, 0.055, -0.152), "sight")
	_box(slide, Vector3(0.02, 0.007, 0.007), Vector3(0, 0.051, 0.018), "steel")                  # rear sight
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
	# Receiver.
	_box(root, Vector3(0.034, 0.062, 0.2), Vector3(0, 0.012, -0.06), "steel")
	_box(root, Vector3(0.028, 0.008, 0.19), Vector3(0, 0.046, -0.06), "steel")
	_box(root, Vector3(0.006, 0.026, 0.06), Vector3(0.0172, 0.02, -0.08), "bore")                # ejection port
	_box(root, Vector3(0.022, 0.006, 0.07), Vector3(0, -0.02, -0.08), "bore")                    # loading port
	# Trigger group.
	_box(root, Vector3(0.026, 0.02, 0.09), Vector3(0, -0.026, -0.01), "polymer")
	_box(root, Vector3(0.012, 0.005, 0.06), Vector3(0, -0.058, -0.0), "polymer")
	_box(root, Vector3(0.012, 0.03, 0.006), Vector3(0, -0.044, -0.03), "polymer")
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
	bead.position = Vector3(0, 0.045, -0.652)
	root.add_child(bead)
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
	# Stock: wrist, comb, toe and recoil pad.
	_box(root, Vector3(0.032, 0.05, 0.12), Vector3(0, -0.02, 0.09), "wood", Vector3(0.28, 0, 0))
	_box(root, Vector3(0.036, 0.045, 0.24), Vector3(0, 0.0, 0.25), "wood", Vector3(0.06, 0, 0))
	_box(root, Vector3(0.034, 0.08, 0.2), Vector3(0, -0.045, 0.27), "wood", Vector3(0.2, 0, 0))
	_box(root, Vector3(0.038, 0.13, 0.02), Vector3(0, -0.03, 0.375), "rubber", Vector3(0.1, 0, 0))
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
