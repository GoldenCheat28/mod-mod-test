extends RefCounted
## The newer arms, modelled with more care than boxes: silhouettes cut out
## in profile and bevelled (shape.gd), turned parts (barrels, bottles) lathed
## round, and every surface textured - blued steel worn bright at the edges
## and scratched, walnut with its grain, moulded plastic with a fine grain and
## scuffs, rubber grips stippled, a painted tool body chipped and grimy.
## Gun frame: barrel along -Z, top +Y, the hand at the origin.

const Shape = preload("res://scripts/weapons/shape.gd")
const Tex = preload("res://scripts/world/textures.gd")

static var _mats := {}


# --- Materials --------------------------------------------------------------------------------

static func _noise_tex(key: String, freq: float, c0: Color, c1: Color, octaves := 4, size := 256) -> NoiseTexture2D:
	var cache := "tex_" + key
	if _mats.has(cache):
		return _mats[cache]
	var n := FastNoiseLite.new()
	n.seed = hash(key)
	n.frequency = freq
	n.fractal_octaves = octaves
	var g := Gradient.new()
	g.set_color(0, c0)
	g.set_color(1, c1)
	var t := NoiseTexture2D.new()
	t.noise = n
	t.color_ramp = g
	t.seamless = true
	t.width = size
	t.height = size
	_mats[cache] = t
	return t


static func mat(key: String) -> StandardMaterial3D:
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.uv1_triplanar = true
	match key:
		"blued":
			# Blued steel: near black with a blue-grey sheen, worn in patches.
			m.albedo_texture = _noise_tex("blued", 0.03, Color(0.06, 0.065, 0.075), Color(0.2, 0.21, 0.23))
			m.metallic = 0.85
			m.roughness = 0.4
			m.normal_enabled = true
			m.normal_texture = Tex.noise("scratch", 0.09, 3, 256, true, 1.5)
			m.normal_scale = 0.35
			m.uv1_scale = Vector3.ONE * 14.0
		"steel_bright":
			m.albedo_texture = _noise_tex("bright", 0.05, Color(0.5, 0.5, 0.5), Color(0.72, 0.72, 0.73))
			m.metallic = 0.9
			m.roughness = 0.3
			m.normal_enabled = true
			m.normal_texture = Tex.noise("scratch", 0.09, 3, 256, true, 1.5)
			m.normal_scale = 0.3
			m.uv1_scale = Vector3.ONE * 18.0
		"walnut":
			# Long grain: noise stretched hard along the length (z).
			m.albedo_texture = _noise_tex("walnut", 0.03, Color(0.16, 0.075, 0.03), Color(0.42, 0.22, 0.1), 5)
			m.roughness = 0.5
			m.normal_enabled = true
			m.normal_texture = Tex.noise("woodgrain", 0.05, 3, 256, true, 1.2)
			m.normal_scale = 0.4
			m.uv1_scale = Vector3(3.0, 3.0, 40.0)
		"polymer_black":
			m.albedo_texture = _noise_tex("poly", 0.2, Color(0.04, 0.04, 0.045), Color(0.1, 0.1, 0.11))
			m.roughness = 0.7
			m.normal_enabled = true
			m.normal_texture = Tex.noise("stipple", 0.25, 2, 128, true, 3.0)
			m.normal_scale = 0.4
			m.uv1_scale = Vector3.ONE * 20.0
		"rubber":
			m.albedo_color = Color(0.035, 0.035, 0.035)
			m.roughness = 0.95
			m.normal_enabled = true
			m.normal_texture = Tex.noise("stipple", 0.25, 2, 128, true, 3.0)
			m.normal_scale = 1.0
			m.uv1_scale = Vector3.ONE * 40.0
		"alu":
			m.albedo_texture = _noise_tex("alu", 0.1, Color(0.35, 0.36, 0.38), Color(0.55, 0.56, 0.58))
			m.metallic = 0.8
			m.roughness = 0.45
			m.uv1_scale = Vector3.ONE * 10.0
		"tool_yellow":
			# A painted tool body: yellow, grimy in the corners, chipped.
			m.albedo_texture = _noise_tex("tooly", 0.2, Color(0.8, 0.58, 0.07), Color(0.95, 0.72, 0.12))
			m.roughness = 0.5
			m.normal_enabled = true
			m.normal_texture = Tex.noise("chips", 0.12, 3, 256, true, 1.0)
			m.normal_scale = 0.3
			m.uv1_scale = Vector3.ONE * 8.0
		"orange":
			m.albedo_texture = _noise_tex("orange", 0.15, Color(0.8, 0.26, 0.03), Color(1.0, 0.42, 0.08))
			m.roughness = 0.55
			m.normal_enabled = true
			m.normal_texture = Tex.noise("stipple", 0.25, 2, 128, true, 3.0)
			m.normal_scale = 0.15
			m.uv1_scale = Vector3.ONE * 16.0
		"bore":
			m.albedo_color = Color(0.01, 0.01, 0.01)
			m.roughness = 0.9
		"brass":
			m.albedo_color = Color(0.78, 0.6, 0.28)
			m.metallic = 1.0
			m.roughness = 0.3
		"red":
			m.albedo_color = Color(0.7, 0.05, 0.04)
			m.roughness = 0.5
		"string":
			m.albedo_color = Color(0.08, 0.08, 0.07)
			m.roughness = 0.8
	_mats[key] = m
	return m


# --- Building blocks --------------------------------------------------------------------------

static func ext(parent: Node3D, pts: Array, half: float, key: String, x := 0.0, name := "") -> MeshInstance3D:
	var outline := PackedVector2Array()
	for p in pts:
		outline.append(p)
	var mi := Shape.extrude(outline, half, mat(key), minf(half * 0.25, 0.002))
	mi.position.x = x
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if name != "":
		mi.name = name
	parent.add_child(mi)
	return mi


static func cyl(parent: Node3D, r: float, length: float, pos: Vector3, key: String, r2 := -1.0, seg := 20) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var m := CylinderMesh.new()
	m.top_radius = r
	m.bottom_radius = r if r2 < 0.0 else r2
	m.height = length
	m.radial_segments = seg
	m.rings = 1
	mi.mesh = m
	mi.position = pos
	mi.rotation = Vector3(PI * 0.5, 0, 0)
	mi.material_override = mat(key)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi


static func box(parent: Node3D, size: Vector3, pos: Vector3, key: String, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var m := BoxMesh.new()
	m.size = size
	mi.mesh = m
	mi.position = pos
	mi.rotation = rot
	mi.material_override = mat(key)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi


static func node(parent: Node3D, name: String, pos := Vector3.ZERO) -> Node3D:
	var n := Node3D.new()
	n.name = name
	n.position = pos
	parent.add_child(n)
	return n


## A turned part: the profile [(radius, height), ...] from the bottom up,
## spun round Y.
static func lathe(profile: Array, seg := 28, cap_bottom := true) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in profile.size() - 1:
		var a: Vector2 = profile[i]
		var b: Vector2 = profile[i + 1]
		for k in seg:
			var t0 := TAU * k / seg
			var t1 := TAU * (k + 1) / seg
			var p00 := Vector3(cos(t0) * a.x, a.y, sin(t0) * a.x)
			var p01 := Vector3(cos(t1) * a.x, a.y, sin(t1) * a.x)
			var p10 := Vector3(cos(t0) * b.x, b.y, sin(t0) * b.x)
			var p11 := Vector3(cos(t1) * b.x, b.y, sin(t1) * b.x)
			st.set_uv(Vector2(float(k) / seg, a.y))
			st.add_vertex(p00)
			st.set_uv(Vector2(float(k) / seg, b.y))
			st.add_vertex(p10)
			st.set_uv(Vector2(float(k + 1) / seg, b.y))
			st.add_vertex(p11)
			st.set_uv(Vector2(float(k) / seg, a.y))
			st.add_vertex(p00)
			st.set_uv(Vector2(float(k + 1) / seg, b.y))
			st.add_vertex(p11)
			st.set_uv(Vector2(float(k + 1) / seg, a.y))
			st.add_vertex(p01)
	if cap_bottom:
		var bot: Vector2 = profile[0]
		for k in seg:
			var t0 := TAU * k / seg
			var t1 := TAU * (k + 1) / seg
			st.add_vertex(Vector3(0, bot.y, 0))
			st.add_vertex(Vector3(cos(t1) * bot.x, bot.y, sin(t1) * bot.x))
			st.add_vertex(Vector3(cos(t0) * bot.x, bot.y, sin(t0) * bot.x))
	st.generate_normals()
	return st.commit()


# --- Sawn-off -----------------------------------------------------------------------------------

## A sawn-off side-by-side: the barrels cut down to a hand's span, the stock
## sawn off behind the grip and rounded by use, two hammers, two triggers.
static func sawnoff() -> Node3D:
	var root := Node3D.new()
	root.name = "Sawnoff"
	# The action (receiver): a rounded box, the fences at its front.
	ext(root, [Vector2(0.075, 0.004), Vector2(0.075, 0.03), Vector2(0.06, 0.042), Vector2(-0.01, 0.042),
			Vector2(-0.02, 0.036), Vector2(-0.02, -0.012), Vector2(0.0, -0.022), Vector2(0.055, -0.022)], 0.02, "blued")
	# Side plates, a lighter steel, engraved look (bright steel, worn).
	for sx in [-1.0, 1.0]:
		ext(root, [Vector2(0.065, 0.0), Vector2(0.065, 0.028), Vector2(0.005, 0.03), Vector2(-0.008, 0.012), Vector2(0.01, -0.016),
				Vector2(0.05, -0.016)], 0.0008, "steel_bright", 0.0205 * sx)
	# The grip: sawn stock, a pistol grip curving down, the cut end rounded.
	ext(root, [Vector2(0.07, 0.03), Vector2(0.1, 0.02), Vector2(0.14, -0.02), Vector2(0.16, -0.075), Vector2(0.155, -0.1),
			Vector2(0.12, -0.108), Vector2(0.1, -0.09), Vector2(0.09, -0.055), Vector2(0.07, -0.025), Vector2(0.06, -0.018)], 0.017, "walnut")
	# Trigger guard (a loop) and the two triggers.
	ext(root, [Vector2(0.05, -0.02), Vector2(0.052, -0.04), Vector2(0.04, -0.052), Vector2(0.0, -0.052), Vector2(-0.012, -0.04),
			Vector2(-0.01, -0.02), Vector2(-0.004, -0.02), Vector2(-0.004, -0.036), Vector2(0.004, -0.045), Vector2(0.036, -0.045),
			Vector2(0.044, -0.036), Vector2(0.044, -0.02)], 0.004, "blued")
	for i in 2:
		ext(root, [Vector2(0.008 + i * 0.016, -0.022), Vector2(0.012 + i * 0.016, -0.04), Vector2(0.016 + i * 0.016, -0.04),
				Vector2(0.014 + i * 0.016, -0.022)], 0.0025, "steel_bright")
	# Hammers, cocked back.
	for sx in [-1.0, 1.0]:
		ext(root, [Vector2(0.058, 0.038), Vector2(0.07, 0.07), Vector2(0.085, 0.074), Vector2(0.084, 0.066), Vector2(0.074, 0.062),
				Vector2(0.068, 0.038)], 0.0035, "blued", 0.012 * sx)
	box(root, Vector3(0.008, 0.006, 0.03), Vector3(0, 0.046, 0.045), "blued")      # top lever
	cyl(root, 0.006, 0.042, Vector3(0, -0.012, -0.018), "steel_bright").rotation = Vector3(0, 0, PI * 0.5)   # hinge pin
	# The barrels (they hinge down at the pin to load).
	var b := node(root, "Barrels", Vector3(0, -0.012, -0.018))
	for sx in [-1.0, 1.0]:
		cyl(b, 0.0128, 0.28, Vector3(0.0132 * sx, 0.034, -0.142), "blued", -1.0, 24)
		cyl(b, 0.0094, 0.282, Vector3(0.0132 * sx, 0.034, -0.142), "bore", -1.0, 16)
		# (the sawn end: bright steel where the hacksaw went through)
		var ring := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 0.0094
		tm.outer_radius = 0.0129
		tm.rings = 20
		tm.ring_segments = 4
		ring.mesh = tm
		ring.material_override = mat("steel_bright")
		ring.rotation = Vector3(PI * 0.5, 0, 0)
		ring.position = Vector3(0.0132 * sx, 0.034, -0.2825)
		b.add_child(ring)
	ext(b, [Vector2(-0.0, 0.047), Vector2(-0.28, 0.047), Vector2(-0.28, 0.05), Vector2(0.0, 0.05)], 0.004, "blued")      # rib
	ext(b, [Vector2(-0.0, 0.021), Vector2(-0.28, 0.021), Vector2(-0.28, 0.025), Vector2(0.0, 0.025)], 0.004, "blued")    # lower rib
	# The forend under them: walnut, rounded tip.
	ext(b, [Vector2(-0.01, 0.024), Vector2(-0.01, 0.01), Vector2(-0.02, 0.0), Vector2(-0.14, 0.0), Vector2(-0.155, 0.01),
			Vector2(-0.16, 0.022)], 0.019, "walnut")
	cyl(b, 0.0022, 0.004, Vector3(0, 0.052, -0.27), "brass")       # bead
	node(b, "Muzzle", Vector3(0.0132, 0.034, -0.285))
	node(root, "Eject", Vector3(0.0, 0.03, -0.02))
	return root


# --- Crossbow ---------------------------------------------------------------------------------

## A hunting crossbow: a stock with a pistol grip, an aluminium rail, the
## riser with a stirrup at the front, split limbs with cams at their tips;
## open sights - it is for close.
static func crossbow() -> Node3D:
	var root := Node3D.new()
	root.name = "Crossbow"
	# Stock: the butt, a raised comb, a pistol grip.
	ext(root, [Vector2(0.24, 0.035), Vector2(0.24, -0.035), Vector2(0.2, -0.035), Vector2(0.13, -0.02), Vector2(0.06, -0.03),
			Vector2(0.075, -0.1), Vector2(0.045, -0.105), Vector2(0.02, -0.03), Vector2(0.005, -0.012), Vector2(-0.05, -0.012),
			Vector2(-0.05, 0.022), Vector2(0.04, 0.022), Vector2(0.1, 0.042), Vector2(0.18, 0.045)], 0.017, "polymer_black")
	# Forend and rail.
	ext(root, [Vector2(-0.05, 0.02), Vector2(-0.33, 0.02), Vector2(-0.34, 0.0), Vector2(-0.33, -0.02), Vector2(-0.12, -0.02),
			Vector2(-0.05, -0.012)], 0.016, "polymer_black")
	for sx in [-1.0, 1.0]:
		box(root, Vector3(0.005, 0.006, 0.34), Vector3(0.006 * sx, 0.024, -0.2), "alu")
	# Trigger and guard.
	ext(root, [Vector2(0.03, -0.012), Vector2(0.032, -0.03), Vector2(0.02, -0.042), Vector2(-0.015, -0.042), Vector2(-0.02, -0.03),
			Vector2(-0.018, -0.012), Vector2(-0.012, -0.012), Vector2(-0.012, -0.034), Vector2(0.018, -0.036), Vector2(0.024, -0.012)], 0.004, "polymer_black")
	ext(root, [Vector2(0.0, -0.012), Vector2(0.006, -0.03), Vector2(0.01, -0.03), Vector2(0.006, -0.012)], 0.0025, "blued")
	# Riser and stirrup.
	ext(root, [Vector2(-0.33, 0.035), Vector2(-0.4, 0.035), Vector2(-0.41, 0.0), Vector2(-0.4, -0.03), Vector2(-0.33, -0.03)], 0.028, "alu")
	var stir := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.045
	tm.outer_radius = 0.052
	stir.mesh = tm
	stir.material_override = mat("polymer_black")
	stir.position = Vector3(0, -0.005, -0.45)
	stir.scale = Vector3(1.0, 1.0, 0.8)
	stir.rotation = Vector3(0.0, 0, 0)
	root.add_child(stir)
	# The limbs: each side two thin blades sweeping out and back from the riser.
	for sx in [-1.0, 1.0]:
		for dy in [-0.009, 0.009]:
			var prev := Vector3(0.028 * sx, dy, -0.37)
			for k in 4:
				var u := float(k + 1) / 4.0
				var pt := Vector3(sx * (0.028 + 0.26 * u), dy * (1.0 + u), -0.37 + 0.09 * u * u)
				var seg := MeshInstance3D.new()
				var bm := BoxMesh.new()
				var d := pt - prev
				bm.size = Vector3(0.022, 0.004, d.length() + 0.004)
				seg.mesh = bm
				seg.material_override = mat("polymer_black")
				seg.position = (prev + pt) * 0.5
				seg.basis = Basis.looking_at(d.normalized(), Vector3.UP)
				root.add_child(seg)
				prev = pt
		# The cam at the tip.
		var cam := cyl(root, 0.014, 0.012, Vector3(sx * 0.29, 0.0, -0.28), "alu", -1.0, 16)
		cam.rotation = Vector3(0, 0, 0)
	# The string and its bolt (set by crossbow_string / the weapon).
	var string := node(root, "String", Vector3(0, 0.03, 0))
	for i in 2:
		var s := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.0015
		cm.bottom_radius = 0.0015
		cm.height = 1.0
		cm.radial_segments = 6
		s.mesh = cm
		s.material_override = mat("string")
		s.name = "S%d" % i
		string.add_child(s)
	var bolt := node(root, "Bolt", Vector3(0, 0.036, -0.2))
	bolt.add_child(bolt_model())
	node(root, "Muzzle", Vector3(0, 0.036, -0.42))
	node(root, "Eject", Vector3(0, 0.03, -0.05))
	crossbow_string(root, 1.0)
	return root


## The string, drawn back (k = 1: cocked, on the nut) or loosed (0).
static func crossbow_string(model: Node3D, k: float) -> void:
	var st := model.get_node_or_null("String") as Node3D
	if st == null:
		return
	var nut := Vector3(0, 0.0, lerpf(-0.33, -0.06, k))
	for i in 2:
		var sx := 1.0 if i == 0 else -1.0
		var tip := Vector3(0.29 * sx, -0.03, -0.28 + 0.03 * (1.0 - k))
		var s := st.get_node("S%d" % i) as MeshInstance3D
		var d := nut - tip
		var y := d.normalized()
		var x := y.cross(Vector3.UP).normalized()
		s.transform = Transform3D(Basis(x, y * d.length(), x.cross(y)), (tip + nut) * 0.5)


## A crossbow bolt: carbon shaft, a steel point, three proper vanes swept
## back along it (each in a plane through the shaft), a nock.
static func bolt_model() -> Node3D:
	var root := Node3D.new()
	var shaft := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.0042
	cm.bottom_radius = 0.0042
	cm.height = 0.36
	cm.radial_segments = 10
	shaft.mesh = cm
	shaft.material_override = mat("polymer_black")
	shaft.rotation = Vector3(PI * 0.5, 0, 0)
	root.add_child(shaft)
	# The point: a three-bladed broadhead.
	var tip := MeshInstance3D.new()
	var tmh := CylinderMesh.new()
	tmh.top_radius = 0.0
	tmh.bottom_radius = 0.0055
	tmh.height = 0.028
	tmh.radial_segments = 3
	tip.mesh = tmh
	tip.material_override = mat("steel_bright")
	tip.rotation = Vector3(-PI * 0.5, 0, 0)
	tip.position = Vector3(0, 0, -0.194)
	root.add_child(tip)
	var ferrule := MeshInstance3D.new()
	var fm := CylinderMesh.new()
	fm.top_radius = 0.0048
	fm.bottom_radius = 0.0048
	fm.height = 0.014
	ferrule.mesh = fm
	ferrule.material_override = mat("steel_bright")
	ferrule.rotation = Vector3(PI * 0.5, 0, 0)
	ferrule.position = Vector3(0, 0, -0.173)
	root.add_child(ferrule)
	# Vanes: in (z, r) - a low swept shield shape.
	var vane := StandardMaterial3D.new()
	vane.albedo_color = Color(0.85, 0.2, 0.08)
	vane.roughness = 0.5
	vane.cull_mode = BaseMaterial3D.CULL_DISABLED
	var prof := [Vector2(0.17, 0.004), Vector2(0.12, 0.004), Vector2(0.128, 0.011), Vector2(0.145, 0.0145), Vector2(0.165, 0.0135)]
	for k in 3:
		var a := TAU * k / 3.0 + 0.3
		var rdir := Vector3(cos(a), sin(a), 0.0)
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		st.set_normal(Vector3(-sin(a), cos(a), 0))
		for i in range(1, prof.size() - 1):
			for p in [prof[0], prof[i], prof[i + 1]]:
				st.add_vertex(rdir * p.y + Vector3(0, 0, p.x))
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = vane if k > 0 else _cock_vane()
		root.add_child(mi)
	var nock := MeshInstance3D.new()
	var nm := CylinderMesh.new()
	nm.top_radius = 0.0045
	nm.bottom_radius = 0.004
	nm.height = 0.012
	nock.mesh = nm
	nock.material_override = mat("red")
	nock.rotation = Vector3(PI * 0.5, 0, 0)
	nock.position = Vector3(0, 0, 0.184)
	root.add_child(nock)
	return root


static func _cock_vane() -> StandardMaterial3D:
	if _mats.has("cockvane"):
		return _mats["cockvane"]
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.92, 0.9, 0.85)
	m.roughness = 0.5
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mats["cockvane"] = m
	return m


# --- Light rifle -------------------------------------------------------------------------------

## A bolt-action sniper rifle: a walnut stock with a raised cheek comb and
## a full pistol grip, the round receiver with a rail on top, a heavy barrel
## tapering to a muzzle brake, a detachable box magazine, the bolt with its
## bent handle and knob, and a scope turned in one piece (ocular, tube,
## turrets, objective bell) on two rings - the scope a real one (weapon.gd
## draws what it sees into its eyepiece). Smooth lofted parts, each running
## into the next.
static func rifle() -> Node3D:
	var root := Node3D.new()
	root.name = "Rifle"
	var R := Shape.rrect
	# Stock: butt, comb, wrist, the action's bed and the long forend.
	var stock := []
	for sec in [[0.372, 0.042, 0.135, -0.034], [0.3, 0.04, 0.125, -0.03], [0.22, 0.037, 0.1, -0.02],
			[0.15, 0.034, 0.072, -0.012], [0.1, 0.032, 0.05, -0.01], [0.06, 0.036, 0.046, -0.006],
			[-0.18, 0.04, 0.046, -0.006], [-0.26, 0.042, 0.04, -0.004], [-0.4, 0.038, 0.032, -0.001], [-0.422, 0.03, 0.026, 0.0]]:
		stock.append([Transform3D(Basis.IDENTITY, Vector3(0, 0, sec[0])), R.call(sec[1], sec[2], 0.013, 5, 0.0, sec[3])])
	var st := Shape.loft(stock, mat("walnut"))
	root.add_child(st)
	# Pistol grip, raked back under the wrist.
	root.add_child(Shape.sweep([Vector3(0, -0.018, 0.068), Vector3(0, -0.045, 0.078), Vector3(0, -0.075, 0.09), Vector3(0, -0.098, 0.1)],
			[R.call(0.03, 0.036, 0.01, 4), R.call(0.031, 0.038, 0.011, 4), R.call(0.031, 0.038, 0.011, 4), R.call(0.028, 0.034, 0.01, 4)],
			mat("walnut")))
	# Rubber recoil pad on the butt.
	root.add_child(Shape.loft([[Transform3D(Basis.IDENTITY, Vector3(0, 0, 0.37)), R.call(0.043, 0.137, 0.014, 5, 0.0, -0.034)],
			[Transform3D(Basis.IDENTITY, Vector3(0, 0, 0.388)), R.call(0.041, 0.133, 0.014, 5, 0.0, -0.034)]], mat("rubber")))
	# Receiver with its rail, the bolt shroud at the back, the ejection port.
	cyl(root, 0.0145, 0.235, Vector3(0, 0.02, -0.055), "blued", -1.0, 24)
	cyl(root, 0.009, 0.03, Vector3(0, 0.02, 0.075), "blued", 0.0125, 20)
	box(root, Vector3(0.021, 0.006, 0.2), Vector3(0, 0.0355, -0.055), "blued")
	for i in 9:
		box(root, Vector3(0.022, 0.0025, 0.004), Vector3(0, 0.0385, -0.145 + i * 0.022), "blued")
	box(root, Vector3(0.004, 0.012, 0.05), Vector3(0.0132, 0.024, -0.03), "bore")
	# Heavy barrel, tapering; the muzzle brake with its side ports.
	cyl(root, 0.0125, 0.47, Vector3(0, 0.02, -0.405), "blued", 0.0095, 24)
	cyl(root, 0.0135, 0.05, Vector3(0, 0.02, -0.665), "blued", -1.0, 20)
	for i in 3:
		box(root, Vector3(0.0275, 0.006, 0.007), Vector3(0, 0.02, -0.648 - i * 0.012), "bore")
	cyl(root, 0.0048, 0.052, Vector3(0, 0.02, -0.665), "bore", -1.0, 10)
	# Detachable box magazine in front of the guard.
	root.add_child(Shape.loft([[Transform3D(Basis.IDENTITY, Vector3(0, 0, -0.028)), R.call(0.026, 0.05, 0.004, 3, 0.0, -0.03)],
			[Transform3D(Basis.IDENTITY, Vector3(0, 0, -0.105)), R.call(0.026, 0.05, 0.004, 3, 0.0, -0.03)]], mat("polymer_black")))
	# Trigger guard and trigger.
	root.add_child(Shape.sweep([Vector3(0, -0.01, -0.016), Vector3(0, -0.03, -0.01), Vector3(0, -0.042, 0.01),
			Vector3(0, -0.042, 0.038), Vector3(0, -0.03, 0.055), Vector3(0, -0.016, 0.062)], R.call(0.011, 0.004, 0.0015, 3), mat("blued")))
	ext(root, [Vector2(0.026, -0.01), Vector2(0.03, -0.022), Vector2(0.036, -0.032), Vector2(0.04, -0.03),
			Vector2(0.035, -0.02), Vector2(0.032, -0.01)], 0.003, "steel_bright", 0.0, "Trigger")
	# The bolt: lifts and draws back to load (weapon.gd); its handle bent down
	# to the right with a round knob.
	var bolt := node(root, "BoltHandle", Vector3(0, 0.02, 0.01))
	cyl(bolt, 0.0088, 0.075, Vector3(0, 0, 0.005), "steel_bright", -1.0, 16)
	# (square to its own line, which runs out to the right and down)
	var across := Basis(Vector3.UP, PI * 0.5).rotated(Vector3.FORWARD, 0.35)
	var arm_mesh := MeshInstance3D.new()
	arm_mesh.name = "Arm"
	arm_mesh.mesh = Shape.loft_mesh([[Transform3D(across, Vector3(0.002, 0.0, 0.022)), R.call(0.007, 0.007, 0.0034, 3)],
			[Transform3D(across, Vector3(0.042, -0.015, 0.024)), R.call(0.006, 0.006, 0.003, 3)]])
	arm_mesh.material_override = mat("steel_bright")
	bolt.add_child(arm_mesh)
	var knob := MeshInstance3D.new()
	var km := SphereMesh.new()
	km.radius = 0.0095
	km.height = 0.019
	knob.mesh = km
	knob.material_override = mat("blued")
	knob.position = Vector3(0.048, -0.019, 0.025)
	bolt.add_child(knob)
	# The scope, turned in one piece from the eyepiece forward.
	var sc := node(root, "Scope", Vector3(0, 0.058, 0))
	var tube := MeshInstance3D.new()
	tube.mesh = lathe([Vector2(0.0165, 0.006), Vector2(0.0195, 0.0), Vector2(0.0195, 0.045), Vector2(0.0175, 0.056),
			Vector2(0.0127, 0.076), Vector2(0.0127, 0.212), Vector2(0.016, 0.232), Vector2(0.0235, 0.284),
			Vector2(0.0235, 0.326), Vector2(0.0215, 0.33)], 32, false)
	tube.material_override = mat("blued")
	tube.rotation = Vector3(-PI * 0.5, 0, 0)
	tube.position = Vector3(0, 0, 0.098)
	tube.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sc.add_child(tube)
	cyl(sc, 0.0212, 0.002, Vector3(0, 0, -0.231), "bore", -1.0, 28)               # the objective's glass
	# Turrets: elevation on top, windage at the side, each with its cap.
	var tur := cyl(sc, 0.0095, 0.02, Vector3(0, 0.018, -0.06), "blued", -1.0, 18)
	tur.rotation = Vector3.ZERO
	var tur2 := cyl(sc, 0.0095, 0.02, Vector3(0.018, 0, -0.06), "blued", -1.0, 18)
	tur2.rotation = Vector3(0, 0, PI * 0.5)
	var cap := cyl(sc, 0.0105, 0.006, Vector3(0, 0.03, -0.06), "steel_bright", -1.0, 18)
	cap.rotation = Vector3.ZERO
	# Two rings round the tube, clamped to the rail.
	for z in [-0.125, 0.012]:
		var ring := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 0.0125
		tm.outer_radius = 0.0172
		tm.rings = 24
		tm.ring_segments = 8
		ring.mesh = tm
		ring.material_override = mat("blued")
		ring.rotation = Vector3(PI * 0.5, 0, 0)
		ring.scale = Vector3(1.0, 2.2, 1.0)
		ring.position = Vector3(0, 0, z)
		ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		sc.add_child(ring)
		box(root, Vector3(0.022, 0.012, 0.016), Vector3(0, 0.043, z), "blued")
	node(sc, "ScopeFront", Vector3(0, 0, -0.232))
	node(sc, "ScopeEye", Vector3(0, 0, 0.098))
	node(root, "Muzzle", Vector3(0, 0.02, -0.69))
	node(root, "Eject", Vector3(0.016, 0.03, -0.03))
	for c in root.find_children("*", "GeometryInstance3D", true, false):
		(c as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return root


# --- Nail gun -----------------------------------------------------------------------------------

## A framing nailer, turned to fire forward: the yellow body is the drive
## cylinder (along the barrel), its black end cap at the back with vents, a
## steel nose with the safety tip at the front, the rubber handle down and
## back with the air fitting at its end, and the magazine of nails running
## from the nose back to the foot of the handle.
static func nailgun() -> Node3D:
	var root := Node3D.new()
	root.name = "Nailgun"
	var body := MeshInstance3D.new()
	body.mesh = lathe([Vector2(0.03, 0.0), Vector2(0.038, 0.01), Vector2(0.04, 0.04), Vector2(0.04, 0.15), Vector2(0.034, 0.18),
			Vector2(0.024, 0.2)], 28)
	body.material_override = mat("tool_yellow")
	body.rotation = Vector3(-PI * 0.5, 0, 0)       # (its length along -Z)
	body.position = Vector3(0, 0.045, 0.03)
	root.add_child(body)
	# Black bands moulded round it.
	for i in 2:
		var band := cyl(root, 0.0412, 0.008, Vector3(0, 0.045, -0.04 - i * 0.05), "polymer_black", -1.0, 28)
		(band.mesh as CylinderMesh).cap_top = false
		(band.mesh as CylinderMesh).cap_bottom = false
	# End cap with its vents.
	var capm := MeshInstance3D.new()
	capm.mesh = lathe([Vector2(0.041, 0.0), Vector2(0.042, 0.02), Vector2(0.036, 0.035), Vector2(0.0, 0.037)], 28)
	capm.material_override = mat("polymer_black")
	capm.rotation = Vector3(PI * 0.5, 0, 0)
	capm.position = Vector3(0, 0.045, 0.03)
	root.add_child(capm)
	for k in 6:
		var a := TAU * k / 6.0
		box(root, Vector3(0.004, 0.012, 0.002), Vector3(cos(a) * 0.022, 0.045 + sin(a) * 0.022, 0.0665), "bore", Vector3(0, 0, a + PI * 0.5))
	# The nose: steel, stepped, the safety tip standing proud below.
	cyl(root, 0.018, 0.03, Vector3(0, 0.035, -0.185), "steel_bright", 0.024, 20)
	cyl(root, 0.009, 0.03, Vector3(0, 0.03, -0.215), "steel_bright", 0.013, 16)
	box(root, Vector3(0.01, 0.028, 0.008), Vector3(0, 0.012, -0.226), "blued")
	# Handle: rubber, down and back from under the cap, the fitting at its end.
	ext(root, [Vector2(0.06, 0.012), Vector2(0.03, 0.012), Vector2(0.035, -0.02), Vector2(0.075, -0.1), Vector2(0.11, -0.115),
			Vector2(0.12, -0.1), Vector2(0.095, -0.06), Vector2(0.075, 0.0)], 0.018, "rubber")
	var fit := cyl(root, 0.0075, 0.035, Vector3(0, -0.125, 0.125), "brass", -1.0, 12)
	fit.rotation = Vector3(PI * 0.5 - 0.6, 0, 0)
	# Trigger and its guard.
	ext(root, [Vector2(0.02, 0.005), Vector2(0.026, -0.03), Vector2(0.034, -0.03), Vector2(0.03, 0.005)], 0.006, "polymer_black", 0.0, "Trigger")
	ext(root, [Vector2(-0.01, 0.006), Vector2(-0.015, -0.045), Vector2(0.06, -0.075), Vector2(0.064, -0.068), Vector2(-0.006, -0.038), Vector2(-0.003, 0.006)], 0.004, "polymer_black")
	# The magazine: from the nose back to the foot of the handle, nails in it.
	var mag := node(root, "Mag", Vector3(0, -0.02, -0.08))
	mag.rotation = Vector3(-0.42, 0, 0)
	ext(mag, [Vector2(-0.13, 0.012), Vector2(0.13, 0.012), Vector2(0.13, -0.014), Vector2(-0.13, -0.014)], 0.01, "blued")
	for i in 16:
		var n := cyl(mag, 0.0038, 0.002, Vector3(0, 0.0135, -0.115 + i * 0.015), "steel_bright", -1.0, 8)
		n.rotation = Vector3.ZERO
	box(mag, Vector3(0.022, 0.02, 0.016), Vector3(0, 0.0, 0.125), "red")
	node(root, "Muzzle", Vector3(0, 0.03, -0.232))
	node(root, "Eject", Vector3(0, -0.02, -0.12))
	return root


# --- Flare pistol --------------------------------------------------------------------------------

## A flare pistol: moulded orange, a fat short barrel that tips down on a
## hinge to load, the hammer, a big trigger guard for gloved hands.
static func flaregun() -> Node3D:
	var root := Node3D.new()
	root.name = "Flaregun"
	# Frame and grip in one moulding.
	ext(root, [Vector2(0.045, 0.035), Vector2(0.03, 0.045), Vector2(-0.03, 0.045), Vector2(-0.035, 0.02), Vector2(-0.03, 0.002),
			Vector2(0.0, 0.002), Vector2(0.02, -0.02), Vector2(0.04, -0.09), Vector2(0.06, -0.1), Vector2(0.082, -0.095),
			Vector2(0.08, -0.07), Vector2(0.06, -0.02), Vector2(0.058, 0.02)], 0.015, "orange")
	# Grip panels, rubber, stippled.
	for sx in [-1.0, 1.0]:
		ext(root, [Vector2(0.03, -0.02), Vector2(0.056, -0.02), Vector2(0.074, -0.085), Vector2(0.05, -0.09)], 0.0012, "rubber", 0.0158 * sx)
	# Trigger guard, wide.
	ext(root, [Vector2(0.018, -0.012), Vector2(0.02, -0.035), Vector2(0.005, -0.05), Vector2(-0.03, -0.048), Vector2(-0.034, -0.03),
			Vector2(-0.03, 0.002), Vector2(-0.025, 0.002), Vector2(-0.028, -0.028), Vector2(-0.024, -0.042), Vector2(0.002, -0.044),
			Vector2(0.013, -0.032), Vector2(0.012, -0.012)], 0.005, "orange")
	ext(root, [Vector2(-0.004, 0.0), Vector2(0.0, -0.028), Vector2(0.006, -0.028), Vector2(0.004, 0.0)], 0.003, "blued", 0.0, "Trigger")
	# Hammer.
	ext(root, [Vector2(0.03, 0.04), Vector2(0.05, 0.066), Vector2(0.058, 0.062), Vector2(0.045, 0.04)], 0.004, "blued")
	cyl(root, 0.005, 0.034, Vector3(0, 0.02, -0.03), "blued").rotation = Vector3(0, 0, PI * 0.5)   # hinge
	# The barrel: on the hinge, a ring at the muzzle, ribbed.
	var b := node(root, "Barrels", Vector3(0, 0.02, -0.03))
	cyl(b, 0.019, 0.15, Vector3(0, 0.006, -0.075), "orange", -1.0, 24)
	cyl(b, 0.0145, 0.152, Vector3(0, 0.006, -0.075), "bore", -1.0, 16)
	cyl(b, 0.021, 0.012, Vector3(0, 0.006, -0.146), "orange", -1.0, 24)
	for i in 4:
		cyl(b, 0.0198, 0.004, Vector3(0, 0.006, -0.02 - i * 0.012), "orange", -1.0, 24)
	node(b, "Muzzle", Vector3(0, 0.006, -0.152))
	node(root, "Eject", Vector3(0, 0.03, -0.02))
	return root


# --- Molotov ----------------------------------------------------------------------------------

## A Molotov: a real bottle (turned: body, shoulders, a long neck, the lip),
## a torn paper label, the petrol in it, and a rag stuffed in the neck -
## twisted in, tied round with string, a stained tail of it hanging.
static func molotov() -> Node3D:
	var root := Node3D.new()
	var glass := StandardMaterial3D.new()
	glass.albedo_color = Color(0.2, 0.42, 0.18, 0.42)
	glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glass.roughness = 0.04
	glass.metallic_specular = 0.9
	glass.rim_enabled = true
	glass.rim = 0.4
	glass.rim_tint = 0.3
	glass.cull_mode = BaseMaterial3D.CULL_DISABLED
	var body := MeshInstance3D.new()
	body.mesh = lathe([Vector2(0.03, 0.0), Vector2(0.0335, 0.004), Vector2(0.0345, 0.012), Vector2(0.0345, 0.14),
			Vector2(0.033, 0.155), Vector2(0.026, 0.175), Vector2(0.016, 0.195), Vector2(0.0125, 0.215),
			Vector2(0.012, 0.262), Vector2(0.0145, 0.265), Vector2(0.0145, 0.272), Vector2(0.012, 0.275)])
	body.material_override = glass
	root.add_child(body)
	# The petrol: amber, most of the way up the body.
	var fuel := StandardMaterial3D.new()
	fuel.albedo_color = Color(0.75, 0.55, 0.15, 0.55)
	fuel.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fuel.roughness = 0.05
	var liq := MeshInstance3D.new()
	liq.mesh = lathe([Vector2(0.029, 0.004), Vector2(0.032, 0.012), Vector2(0.032, 0.11), Vector2(0.0, 0.11)], 24)
	liq.material_override = fuel
	root.add_child(liq)
	# The label: a paper band, torn at one edge, faded print on it.
	var label := MeshInstance3D.new()
	label.mesh = lathe([Vector2(0.0352, 0.04), Vector2(0.0352, 0.1)], 28, false)
	var lm := StandardMaterial3D.new()
	lm.albedo_texture = _label_tex()
	lm.roughness = 0.9
	lm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	lm.alpha_scissor_threshold = 0.5
	lm.cull_mode = BaseMaterial3D.CULL_DISABLED
	label.material_override = lm
	root.add_child(label)
	# The rag: twisted into the neck, a knot of it on top, string round it.
	var rag := StandardMaterial3D.new()
	rag.albedo_texture = _noise_tex("rag", 0.08, Color(0.45, 0.4, 0.32), Color(0.78, 0.74, 0.66), 4, 128)
	rag.roughness = 0.95
	rag.normal_enabled = true
	rag.normal_texture = Tex.noise("weave", 0.4, 2, 128, true, 2.0)
	rag.normal_scale = 0.6
	rag.uv1_triplanar = true
	rag.uv1_scale = Vector3.ONE * 20.0
	rag.cull_mode = BaseMaterial3D.CULL_DISABLED
	var plug := MeshInstance3D.new()
	plug.mesh = lathe([Vector2(0.009, 0.24), Vector2(0.013, 0.272), Vector2(0.02, 0.285), Vector2(0.018, 0.298),
			Vector2(0.011, 0.308), Vector2(0.004, 0.312)], 10)
	plug.material_override = rag
	plug.rotation.y = 0.4
	plug.set_meta("rag", true)
	root.add_child(plug)
	var twine := MeshInstance3D.new()
	var tt := TorusMesh.new()
	tt.inner_radius = 0.0148
	tt.outer_radius = 0.0162
	twine.mesh = tt
	var tw := StandardMaterial3D.new()
	tw.albedo_color = Color(0.5, 0.4, 0.25)
	tw.roughness = 0.9
	twine.material_override = tw
	twine.position = Vector3(0, 0.252, 0)
	twine.set_meta("rag", true)
	root.add_child(twine)
	# The tail of it hanging down the neck, in a few bent pieces.
	var prev := Vector3(0.014, 0.265, 0.0)
	for k in 4:
		var nxt := prev + Vector3(0.006 - k * 0.001, -0.018, 0.002 * (k % 2))
		var seg := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.022 - k * 0.003, 0.002, (nxt - prev).length() + 0.002)
		seg.mesh = bm
		seg.material_override = rag
		seg.position = (prev + nxt) * 0.5
		seg.basis = Basis.looking_at((nxt - prev).normalized(), Vector3.RIGHT)
		seg.set_meta("rag", true)
		root.add_child(seg)
		prev = nxt
	var tip := Node3D.new()
	tip.name = "RagTip"
	tip.position = Vector3(0, 0.3, 0)
	root.add_child(tip)
	return root


## A faded, torn beer label: cream paper, a red band, grey lettering bars.
static func _label_tex() -> ImageTexture:
	if _mats.has("labeltex"):
		return _mats["labeltex"]
	var w := 128
	var h := 48
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	var n := FastNoiseLite.new()
	n.frequency = 0.08
	for y in h:
		for x in w:
			var u := float(x) / w
			var v := float(y) / h
			var c := Color(0.86, 0.8, 0.64)
			if v > 0.38 and v < 0.62:
				c = Color(0.62, 0.12, 0.1)
			if v > 0.44 and v < 0.56 and u > 0.12 and u < 0.42 and int(x / 4) % 3 != 0:
				c = Color(0.92, 0.88, 0.75)
			if (v > 0.72 and v < 0.78) and u > 0.1 and u < 0.35:
				c = Color(0.35, 0.32, 0.3)
			c = c.darkened(0.12 * (n.get_noise_2d(x, y) * 0.5 + 0.5))
			# Torn away over part of it.
			var torn := u > 0.62 and v < 0.5 + 0.25 * n.get_noise_2d(x * 3.0, 0.0) + (u - 0.62) * 1.5
			c.a = 0.0 if torn else 1.0
			img.set_pixel(x, y, c)
	img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	_mats["labeltex"] = t
	return t
