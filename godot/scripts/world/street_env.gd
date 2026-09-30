extends RefCounted
## The street as a street: things put where they would really be, not just
## scattered about.
##
## The asphalt itself (surface): shallow ruts worn by wheels along both lanes,
## a few small potholes with broken edges, gentle settled dips and a little
## heave where old roots are under it - a few centimetres at most, and the
## low places collect the rain (the asphalt shader puts water below a level).
##
## By the street: a bus stop by the kerb with a bench and a bin, where the
## zebra crossing goes over to the gap in the far wall; a bench and bin by the
## building, a hydrant on the corner; storm drains along the kerb, manholes
## down the middle of the road and a patch being dug up with cones round it;
## bollards along the kerb (one knocked over); signs at the crossing and the
## end of the road; worn road paint (the centre line, the zebra).
## On the building: air-conditioning units and rain pipes. By the power line:
## an electrical cabinet. By the dumpsters: bin bags, an old sofa and a
## mattress, a shopping cart; by the warehouse: pallets and a cable drum; by
## the ruined kiosk: plastic crates.

const Mat = preload("res://scripts/world/materials.gd")

const F1 := 0.15                 # the sidewalk level
const STREET_Z := Vector2(-5.25, 6.9)   # the road: from the kerb to the far wall
const LANES := [-3.5, -1.8, 1.8, 3.5]  # where the wheels run
const CENTRE_Z := 0.9
const CROSSING_X := 4.0           # the zebra: kerb to the gap in the far wall (2..6)
const TREES := [Vector3(28.0, 0, 24.0), Vector3(-27.0, 0, -14.0), Vector3(4.0, 0, 30.0), Vector3(-6.0, 0, 29.0)]

static var _holes: Array = []    # [centre (x, z), radius, depth, jag phase]
static var _dips: Array = []     # [centre, radius, depth]


static func _init_surface() -> void:
	if not _holes.is_empty():
		return
	var rng := RandomNumberGenerator.new()
	rng.seed = 4242
	# Potholes: mostly in the road where the wheels go, a couple elsewhere.
	for i in 16:
		var x := rng.randf_range(-27.0, 25.0)
		var z: float = LANES[rng.randi() % LANES.size()] + rng.randf_range(-0.5, 0.5) if i < 12 \
				else rng.randf_range(STREET_Z.x + 0.4, STREET_Z.y - 0.6)
		_holes.append([Vector2(x, z), rng.randf_range(0.18, 0.42), rng.randf_range(0.02, 0.04), rng.randf() * TAU])
	for p in [Vector2(-18.0, -2.0), Vector2(20.5, -19.5), Vector2(-24.0, 12.0)]:
		_holes.append([p, rng.randf_range(0.2, 0.35), 0.025, rng.randf() * TAU])
	# Where the ground has settled.
	for i in 8:
		_dips.append([Vector2(rng.randf_range(-30.0, 30.0), rng.randf_range(-30.0, 30.0)), rng.randf_range(1.5, 3.0), rng.randf_range(0.01, 0.02)])


## How much the asphalt is off flat at (x, z) (added to the ground's height).
static func surface(x: float, z: float) -> float:
	_init_surface()
	var h := 0.0
	# Ruts along the road, fading out at its ends.
	if z > STREET_Z.x and z < STREET_Z.y and x > -32.0 and x < 30.0:
		var along := smoothstep(-32.0, -26.0, x) * (1.0 - smoothstep(24.0, 30.0, x))
		for c in LANES:
			var u: float = (z - c) / 0.33
			h -= 0.009 * exp(-u * u) * along
	# Potholes: a flat-bottomed dish with a broken, uneven rim.
	for hole in _holes:
		var c: Vector2 = hole[0]
		var d := Vector2(x - c.x, z - c.y)
		var r: float = hole[1]
		if d.length_squared() > r * r * 3.0:
			continue
		var jag := 1.0 + 0.18 * sin(atan2(d.y, d.x) * 5.0 + hole[3]) + 0.08 * sin(atan2(d.y, d.x) * 11.0)
		var rr := r * jag
		h -= float(hole[2]) * (1.0 - smoothstep(rr * 0.65, rr * 1.05, d.length()))
	for dip in _dips:
		var q := Vector2(x, z).distance_squared_to(dip[0]) / (float(dip[1]) * float(dip[1]))
		if q < 6.0:
			h -= float(dip[2]) * exp(-q)
	# Roots lifting the asphalt round the old trees.
	for t in TREES:
		var q := Vector2(x - t.x, z - t.z).length()
		if q < 2.5:
			h += 0.022 * exp(-pow(q / 1.1, 2.0))
	return h


# --- Solid, part of the level ---------------------------------------------------------

## Everything fixed in place, merged into the level geometry (before commit).
static func build_static(mb: Node3D) -> void:
	benches.clear()
	var geo = mb.geo
	var metal := Mat.standard("street_metal", Color(0.22, 0.24, 0.24), 0.55, 0.6)
	var paint_green := Mat.standard("bin_green", Color(0.12, 0.22, 0.14), 0.6, 0.3)
	var wood: Material = Mat.wood("bench", Color(0.36, 0.24, 0.14), 0.85)
	var iron := Mat.standard("cast_iron", Color(0.08, 0.08, 0.08), 0.7, 0.7)
	var concrete: Material = Mat.concrete("dark")

	# Bus stop by the kerb, a little along from the crossing.
	var bs := Vector3(0.3, F1, -6.9)
	for dx in [-1.5, 1.5]:
		for dz in [-0.7, 0.55]:
			geo.box(bs + Vector3(dx, 1.2, dz), Vector3(0.07, 2.4, 0.07), metal)
	geo.box(bs + Vector3(0, 2.45, -0.05), Vector3(3.3, 0.08, 1.6), metal, Vector3(0.06, 0, 0))
	var glass: Material = Mat.glass(Color(0.6, 0.7, 0.75, 0.25))
	geo.box(bs + Vector3(0, 1.3, -0.7), Vector3(3.0, 1.9, 0.02), glass)
	geo.box(bs + Vector3(-1.5, 1.3, -0.08), Vector3(0.02, 1.9, 1.1), glass)
	_bench(geo, bs + Vector3(0.1, 0, -0.35), 0.0, wood, metal)
	# The timetable on its pole.
	geo.box(bs + Vector3(2.1, 1.1, 0.6), Vector3(0.06, 2.2, 0.06), metal)
	geo.box(bs + Vector3(2.1, 1.9, 0.6), Vector3(0.5, 0.6, 0.03), Mat.standard("sign_white", Color(0.85, 0.85, 0.8), 0.7))

	# A bench by the building (people wait here or sit out), facing the road.
	_bench(geo, Vector3(-11.0, F1, -7.3), 0.0, wood, concrete)

	# Hydrant on the corner of the sidewalk.
	var red := Mat.standard("hydrant", Color(0.55, 0.08, 0.06), 0.55, 0.2)
	var hy := Vector3(-16.3, F1, -5.9)
	geo.box(hy + Vector3(0, 0.35, 0), Vector3(0.22, 0.7, 0.22), red)
	geo.box(hy + Vector3(0, 0.75, 0), Vector3(0.16, 0.1, 0.16), red)
	geo.box(hy + Vector3(0, 0.45, 0), Vector3(0.42, 0.08, 0.08), red, Vector3.ZERO, false)

	# Storm drains along the kerb, on the road side.
	for x in [-14.0, -4.0, 7.0, 18.0]:
		var gy: float = mb.ground_height(x, -4.95)
		geo.box(Vector3(x, gy - 0.005, -4.95), Vector3(0.9, 0.02, 0.4), iron, Vector3.ZERO, false)
		for k in 6:
			geo.box(Vector3(x - 0.35 + k * 0.14, gy + 0.008, -4.95), Vector3(0.04, 0.01, 0.34), Mat.standard("grate_dark", Color(0.02, 0.02, 0.02), 0.9), Vector3.ZERO, false)

	# Bollards along the kerb, not at the bus stop or the crossing; one of
	# them knocked over.
	var x := -16.0
	var n := 0
	while x < 11.0:
		if not (x > -1.6 and x < 2.2) and absf(x - CROSSING_X) > 1.8:
			if n == 5:
				geo.box(Vector3(x + 0.3, 0.1, -5.1), Vector3(0.14, 0.14, 0.9), metal, Vector3(0, 0.4, 0))
			else:
				geo.box(Vector3(x, F1 + 0.45, -5.5), Vector3(0.14, 0.9, 0.14), metal)
			n += 1
		x += 2.0

	# Signs: pedestrian crossing on both sides; no entry at the far end.
	for s in [[Vector3(CROSSING_X + 1.4, F1, -5.55), PI], [Vector3(CROSSING_X + 1.4, mb.ground_height(5.4, 6.4), 6.4), 0.0]]:
		var base: Vector3 = s[0]
		geo.box(base + Vector3(0, 1.25, 0), Vector3(0.06, 2.5, 0.06), metal)
		geo.box(base + Vector3(0, 2.3, 0.04), Vector3(0.6, 0.6, 0.02), Mat.standard("sign_blue", Color(0.08, 0.25, 0.6), 0.5), Vector3(0, s[1], 0))
		geo.box(base + Vector3(0, 2.25, 0.055), Vector3(0.36, 0.3, 0.01), Mat.standard("sign_white", Color(0.85, 0.85, 0.8), 0.7), Vector3(0, s[1], 0), false)
	var end := Vector3(-29.0, mb.ground_height(-29.0, -4.6), -4.6)
	geo.box(end + Vector3(0, 1.2, 0), Vector3(0.06, 2.4, 0.06), metal, Vector3(0, 0, 0.12))
	geo.box(end + Vector3(0.12, 2.25, 0.04), Vector3(0.6, 0.6, 0.02), Mat.standard("sign_red", Color(0.6, 0.06, 0.05), 0.5), Vector3(0, 0, 0.12))

	# On the building front: air-conditioning boxes and rain pipes.
	for ac in [Vector3(-3.8, 4.6, -7.85), Vector3(5.6, 4.9, -7.85)]:
		geo.box(ac, Vector3(0.8, 0.55, 0.3), Mat.standard("ac_unit", Color(0.78, 0.78, 0.74), 0.6, 0.2))
		geo.box(ac + Vector3(0.12, 0, 0.16), Vector3(0.4, 0.4, 0.02), Mat.standard("grate_dark", Color(0.02, 0.02, 0.02), 0.9), Vector3.ZERO, false)
		for k in 2:
			geo.box(ac + Vector3(-0.5 - k * 0.12, -0.2, 0.05), Vector3(0.1, 0.1, 0.08), metal, Vector3.ZERO, false)
	for px in [9.55, 0.3]:
		geo.box(Vector3(px, 3.35, -7.9), Vector3(0.1, 6.5, 0.1), Mat.rust(), Vector3.ZERO, false)
		geo.box(Vector3(px + 0.12, 0.2, -7.75), Vector3(0.25, 0.08, 0.3), Mat.rust(), Vector3.ZERO, false)

	# Electrical cabinet at the foot of the power line.
	var cab := Vector3(-30.2, mb.ground_height(-30.2, -8.8), -8.8)
	geo.box(cab + Vector3(0, 0.7, 0), Vector3(0.8, 1.4, 0.4), Mat.standard("cabinet", Color(0.45, 0.47, 0.44), 0.6, 0.3))
	geo.box(cab + Vector3(0, 1.1, 0.205), Vector3(0.18, 0.16, 0.01), Mat.standard("warn_yellow", Color(0.85, 0.7, 0.05), 0.6), Vector3.ZERO, false)
	geo.box(cab + Vector3(0, 0.05, 0), Vector3(0.9, 0.1, 0.5), concrete)

	# Pallets waiting by the warehouse doorway.
	var pw := Mat.standard("pallet_wood", Color(0.46, 0.36, 0.24), 0.9)
	for i in 4:
		mb._pallet(Vector3(18.8, 0.0 + i * 0.145, -18.6), 0.1 * i, pw)
	for i in 2:
		mb._pallet(Vector3(18.5, 0.0 + i * 0.145, -20.3), 0.35, pw)


## Benches there are, [where, yaw] (for people to sit on: activities.gd).
static var benches: Array = []


static func _bench(geo, at: Vector3, yaw: float, wood: Material, legs: Material) -> void:
	var b := Basis(Vector3.UP, yaw)
	benches.append([at, yaw])
	for dx in [-0.9, 0.9]:
		geo.box(at + b * Vector3(dx, 0.14, 0), Vector3(0.08, 0.6, 0.42), legs, Vector3(0, yaw, 0))
	for k in 3:
		geo.box(at + b * Vector3(0, 0.46, -0.13 + k * 0.13), Vector3(2.0, 0.04, 0.1), wood, Vector3(0, yaw, 0))
	for k in 2:
		geo.box(at + b * Vector3(0, 0.62 + k * 0.14, -0.22), Vector3(2.0, 0.1, 0.03), wood, Vector3(0.2, yaw, 0))


# --- Loose things, and the paint on the road ----------------------------------------------

## Things that can be knocked about (after the level is built), and road paint.
static func build_loose(mb: Node3D) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 777
	# The dug-up patch round a manhole in the road, cones round it, and the
	# manhole covers down the middle.
	var iron := Mat.standard("cast_iron", Color(0.09, 0.09, 0.085), 0.65, 0.7)
	for mx in [-19.0, -7.5, 11.0]:
		var gy: float = mb.ground_height(mx, CENTRE_Z)
		var cover := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.33
		cm.bottom_radius = 0.33
		cm.height = 0.02
		cover.mesh = cm
		cover.material_override = iron
		cover.position = Vector3(mx, gy - 0.006, CENTRE_Z)
		mb.add_child(cover)
		var ring := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 0.33
		tm.outer_radius = 0.37
		ring.mesh = tm
		ring.material_override = iron
		ring.scale = Vector3(1, 0.1, 1)
		ring.position = cover.position + Vector3.UP * 0.004
		mb.add_child(ring)
	var works := Vector3(11.0, 0.0, CENTRE_Z)
	_decal(mb, works + Vector3(0, 0.1, 0), Vector2(2.6, 1.8), _patch_tex(), Color(0.55, 0.55, 0.55, 0.9), 0.0)
	for k in 4:
		var a := TAU * k / 4.0 + 0.4
		_cone(mb, works + Vector3(cos(a) * 1.3, 0.0, sin(a) * 1.0), rng)
	_cone(mb, works + Vector3(2.4, 0.0, -0.6), rng)

	# Road paint: the centre line (dashed) and the zebra, both worn.
	var worn := _worn_tex(rng)
	var x := -27.0
	while x < 23.0:
		if absf(x - CROSSING_X) > 2.5:
			_decal(mb, Vector3(x, mb.ground_height(x, CENTRE_Z) + 0.1, CENTRE_Z), Vector2(2.5, 0.13), worn, Color(0.85, 0.83, 0.75, 0.55), 0.0)
		x += 6.0
	var z := STREET_Z.x + 0.6
	while z < STREET_Z.y - 0.5:
		_decal(mb, Vector3(CROSSING_X, mb.ground_height(CROSSING_X, z) + 0.1, z), Vector2(3.0, 0.5), worn, Color(0.88, 0.86, 0.8, 0.6), 0.0)
		z += 1.0

	# Bins: at the bus stop, by the bench, by the kiosk.
	for p in [Vector3(3.0, F1, -5.9), Vector3(-9.5, F1, -7.4), Vector3(15.3, 0.0, 12.6)]:
		_bin(mb, p)
	# Bin bags round the dumpsters (and one left by a bin).
	for c in [Vector3(-18.0, 0, -3.2), Vector3(19.5, 0, -21.5)]:
		for k in rng.randi_range(3, 5):
			_bag(mb, c + Vector3(rng.randf_range(-1.6, 1.6), 0.3, rng.randf_range(0.9, 1.5) * (1 if k % 2 == 0 else -1)), rng)
	_bag(mb, Vector3(-9.0, F1 + 0.3, -7.0), rng)
	# ...and inside them, heaped up.
	for c in [Vector3(-18.0, 0, -3.2), Vector3(19.5, 0, -21.5)]:
		for k in 2:
			_bag(mb, c + Vector3(-0.45 + k * 0.9, 0.55, 0.0), rng)
	# Things to make something with, lying about where they would be.
	var ItemDrop = load("res://scripts/game/item_drop.gd")
	for pl in [["pipe", Vector3(-7.0, 0.45, -18.5)], ["powder", Vector3(-17.3, 0.4, -4.4)], ["clock", Vector3(-3.0, 3.6, -10.5)],
			["wires", Vector3(8.6, 0.4, -9.4)], ["tape", Vector3(17.6, 0.3, 16.4)], ["water", Vector3(-9.2, 0.45, -6.9)],
			["boards", Vector3(-20.8, 0.3, 9.6)], ["screws", Vector3(14.9, 0.3, 13.2)], ["scrap", Vector3(19.0, 0.3, -19.4)],
			["tape", Vector3(-26.0, 0.3, -18.0)], ["wires", Vector3(26.0, 0.3, -12.0)],
			# In the abandoned building: what the people living there left.
			["cloth", Vector3(8.6, 4.1, -16.2)], ["cloth", Vector3(-7.8, 3.7, -19.6)], ["alcohol", Vector3(3.3, 4.25, -9.5)],
			["empty_syringe", Vector3(-5.6, 3.7, -19.8)], ["ampoule", Vector3(9.4, 3.5, -12.3)],
			["sugar", Vector3(-7.5, 0.75, -10.6)], ["chalk", Vector3(-3.5, 4.25, -10.9)], ["dye", Vector3(2.3, 3.95, -15.4)],
			["herb", Vector3(-6.4, 3.55, -19.0)], ["rolling_paper", Vector3(-3.3, 4.25, -10.6)], ["money", Vector3(6.0, 4.1, -16.6)]]:
		ItemDrop.spawn(mb, pl[0], 150 if pl[0] == "money" else (3 if pl[0] == "wires" else 1), Transform3D(Basis(Vector3.UP, rng.randf() * TAU), pl[1]), Vector3.ZERO)
	# Dumped by the first dumpster: an old sofa and a mattress.
	_sofa(mb, Vector3(-20.6, 0.0, -1.6), 0.5)
	_mattress(mb, Vector3(-19.4, 0.0, -4.6), -0.3)
	# Plastic crates by the ruined kiosk.
	for c in [[Vector3(14.6, 0.0, 15.2), Color(0.7, 0.12, 0.1)], [Vector3(14.7, 0.31, 15.25), Color(0.1, 0.25, 0.6)], [Vector3(14.9, 0.0, 16.0), Color(0.15, 0.45, 0.2)]]:
		_crate(mb, c[0], c[1], rng)
	# A cable drum by the warehouse.
	_drum(mb, Vector3(22.8, 0.0, -18.3))


static func _decal(mb: Node3D, pos: Vector3, size: Vector2, tex: Texture2D, color: Color, yaw: float) -> void:
	var d := Decal.new()
	d.texture_albedo = tex
	d.modulate = color
	d.size = Vector3(size.x, 0.4, size.y)
	d.position = pos
	d.rotation = Vector3(0, yaw, 0)
	d.upper_fade = 0.1
	d.lower_fade = 0.1
	d.cull_mask = 1
	mb.add_child(d)


## Paint that has been driven over for years: patchy, missing in places.
static func _worn_tex(rng: RandomNumberGenerator) -> ImageTexture:
	var n := FastNoiseLite.new()
	n.seed = rng.randi()
	n.frequency = 0.03
	var fine := FastNoiseLite.new()
	fine.seed = rng.randi()
	fine.frequency = 0.35
	var img := Image.create(256, 64, false, Image.FORMAT_RGBA8)
	for y in 64:
		for x in 256:
			# Mostly still there; a few bald patches where the wheels go, and
			# the paint chipped finely all over.
			var v := n.get_noise_2d(x, y * 2.0) * 0.5 + 0.5
			var chip := fine.get_noise_2d(x, y) * 0.5 + 0.5
			var edge := minf(minf(x, 255 - x), minf(y, 63 - y)) / 3.0
			var a := smoothstep(0.22, 0.34, v) * (0.75 + 0.25 * smoothstep(0.25, 0.6, chip)) * clampf(edge, 0.0, 1.0)
			img.set_pixel(x, y, Color(1, 1, 1, a))
	return ImageTexture.create_from_image(img)


## A newer, darker square of asphalt over a dug-up patch.
static func _patch_tex() -> ImageTexture:
	var n := FastNoiseLite.new()
	n.seed = 31
	n.frequency = 0.05
	var img := Image.create(128, 96, false, Image.FORMAT_RGBA8)
	for y in 96:
		for x in 128:
			var edge := minf(minf(x, 127 - x), minf(y, 95 - y))
			var ragged := edge + n.get_noise_2d(x, y) * 6.0
			var a := clampf(ragged / 3.0, 0.0, 1.0) * 0.85
			var g := 0.1 + 0.03 * n.get_noise_2d(x * 3.0, y * 3.0)
			img.set_pixel(x, y, Color(g, g, g * 1.02, a))
	return ImageTexture.create_from_image(img)


static func _body(mb: Node3D, mass: float, surface: String) -> RigidBody3D:
	var rb := RigidBody3D.new()
	rb.collision_layer = Game.LAYER_PROPS
	rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_PLAYER | Game.LAYER_DEBRIS
	rb.mass = mass
	rb.set_meta("surface", surface)
	mb.add_child(rb)
	return rb


static func _part(rb: Node3D, mesh: Mesh, mat: Material, pos := Vector3.ZERO, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	rb.add_child(mi)
	return mi


static func _shape(rb: Node3D, shape: Shape3D, pos := Vector3.ZERO, rot := Vector3.ZERO) -> void:
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.position = pos
	cs.rotation = rot
	rb.add_child(cs)


static func _boxm(size: Vector3) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = size
	return b


static func _boxs(size: Vector3) -> BoxShape3D:
	var b := BoxShape3D.new()
	b.size = size
	return b


static func _cone(mb: Node3D, at: Vector3, rng: RandomNumberGenerator) -> void:
	var rb := _body(mb, 1.2, "plastic")
	var orange := Mat.standard("cone", Color(0.9, 0.32, 0.05), 0.6)
	var cm := CylinderMesh.new()
	cm.top_radius = 0.03
	cm.bottom_radius = 0.16
	cm.height = 0.62
	_part(rb, cm, orange, Vector3(0, 0.33, 0))
	var band := CylinderMesh.new()
	band.top_radius = 0.085
	band.bottom_radius = 0.11
	band.height = 0.1
	_part(rb, band, Mat.standard("reflect", Color(0.9, 0.9, 0.88), 0.4), Vector3(0, 0.36, 0))
	_part(rb, _boxm(Vector3(0.38, 0.03, 0.38)), orange, Vector3(0, 0.015, 0))
	_shape(rb, _boxs(Vector3(0.38, 0.03, 0.38)), Vector3(0, 0.015, 0))
	var cs := CylinderShape3D.new()
	cs.radius = 0.1
	cs.height = 0.6
	_shape(rb, cs, Vector3(0, 0.33, 0))
	rb.position = at + Vector3(0, 0.02, 0)
	rb.rotation.y = rng.randf() * TAU


static func _bin(mb: Node3D, at: Vector3) -> void:
	# A street bin like a small drum: a steel can with rolled hoops round it,
	# and a low round black lid.
	var rb := _body(mb, 11.0, "metal")
	var can := CylinderMesh.new()
	can.top_radius = 0.26
	can.bottom_radius = 0.26
	can.height = 0.8
	can.radial_segments = 20
	var body_mat := Mat.standard("bin_drum", Color(0.2, 0.25, 0.22), 0.55, 0.45)
	_part(rb, can, body_mat, Vector3(0, 0.4, 0))
	for y in [0.2, 0.6]:
		var hoop := CylinderMesh.new()
		hoop.top_radius = 0.268
		hoop.bottom_radius = 0.268
		hoop.height = 0.03
		hoop.radial_segments = 20
		_part(rb, hoop, body_mat, Vector3(0, y, 0))
	var lid := CylinderMesh.new()
	lid.top_radius = 0.27
	lid.bottom_radius = 0.285
	lid.height = 0.06
	lid.radial_segments = 20
	var black := Mat.standard("bin_lid", Color(0.04, 0.04, 0.045), 0.45, 0.2)
	_part(rb, lid, black, Vector3(0, 0.83, 0))
	var knob := CylinderMesh.new()
	knob.top_radius = 0.05
	knob.bottom_radius = 0.06
	knob.height = 0.03
	_part(rb, knob, black, Vector3(0, 0.875, 0))
	var cs := CylinderShape3D.new()
	cs.radius = 0.27
	cs.height = 0.86
	_shape(rb, cs, Vector3(0, 0.43, 0))
	rb.position = at


static func _bag(mb: Node3D, at: Vector3, rng: RandomNumberGenerator) -> void:
	var rb := _body(mb, 4.0, "cloth")
	var plastic := Mat.standard("binbag", Color(0.025, 0.025, 0.03), 0.22, 0.05)
	plastic.cull_mode = BaseMaterial3D.CULL_DISABLED
	_part(rb, bag_mesh(rng.randi() % 4), plastic)
	var sh := CapsuleShape3D.new()
	sh.radius = 0.24
	sh.height = 0.5
	_shape(rb, sh, Vector3(0, 0.02, 0), Vector3(0, 0, PI * 0.5))
	rb.position = at + Vector3.UP * 0.05
	rb.rotation = Vector3(0, rng.randf() * TAU, 0)
	rb.angular_damp = 2.0
	rb.linear_damp = 0.5
	rb.continuous_cd = true      # soft and light, but not through a floor


static var _bag_meshes := {}


## A full bin bag: a soft sack slumped on the ground (flat underneath, wider
## at the bottom), bulging where the rubbish inside pushes out, pulled in at
## the top into a twisted neck with the tied ears sticking up.
static func bag_mesh(variant: int) -> ArrayMesh:
	if _bag_meshes.has(variant):
		return _bag_meshes[variant]
	var rng := RandomNumberGenerator.new()
	rng.seed = 7919 * (variant + 1)
	var bumps: Array = []
	for i in 9:
		bumps.append([Vector3(rng.randf_range(-1, 1), rng.randf_range(-0.6, 0.8), rng.randf_range(-1, 1)).normalized(), rng.randf_range(0.03, 0.07)])
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	const RINGS := 14
	const SEG := 20
	var pts := []
	for r in RINGS + 1:
		var v := float(r) / RINGS               # 0 bottom .. 1 top of the sack
		var row := []
		for k in SEG:
			var a := TAU * k / SEG
			var u := Vector3(cos(a), 0.0, sin(a))
			# Profile: a flat base, fat low down, narrowing to the neck.
			var rad := 0.3 * sin(clampf(v, 0.0, 1.0) * PI * 0.92 + 0.12) * (1.0 - 0.35 * v)
			var y := -0.2 + 0.46 * v
			if v < 0.12:
				y = -0.2 + 0.03 * (v / 0.12)
			var p := u * rad + Vector3(0, y, 0)
			# Lumps where things inside press on it, and fine wrinkles.
			var dir := p.normalized()
			for b in bumps:
				p += dir * float(b[1]) * maxf(0.0, dir.dot(b[0]) - 0.6) * 2.5
			p += dir * 0.008 * sin(a * 11.0 + v * 17.0) * sin(v * 23.0 + a * 3.0)
			row.append(p)
		pts.append(row)
	for r in RINGS:
		for k in SEG:
			var k2 := (k + 1) % SEG
			var a0: Vector3 = pts[r][k]
			var b0: Vector3 = pts[r][k2]
			var a1: Vector3 = pts[r + 1][k]
			var b1: Vector3 = pts[r + 1][k2]
			for tri in [[a0, a1, b1], [a0, b1, b0]]:
				var t0: Vector3 = tri[0]
				var t1: Vector3 = tri[1]
				var t2: Vector3 = tri[2]
				# Facing out of the sack (front faces wind with the cross inwards).
				var out := ((t0 + t1 + t2) / 3.0 - Vector3(0, 0.03, 0)).normalized()
				var n := (t1 - t0).cross(t2 - t0).normalized()
				var verts := [t0, t1, t2] if n.dot(out) < 0.0 else [t0, t2, t1]
				for q in verts:
					st.set_normal(out if n.length() < 0.5 else (n if n.dot(out) > 0.0 else -n))
					st.add_vertex(q)
	# The bottom.
	var c0 := Vector3(0, -0.2, 0)
	for k in SEG:
		var k2 := (k + 1) % SEG
		var bq: Array = [c0, pts[0][k], pts[0][k2]]
		if ((bq[1] as Vector3) - c0).cross((bq[2] as Vector3) - c0).dot(Vector3.DOWN) > 0.0:
			bq = [c0, pts[0][k2], pts[0][k]]
		for q in bq:
			st.set_normal(Vector3.DOWN)
			st.add_vertex(q)
	# The twisted neck and the two tied ears.
	var top: Vector3 = Vector3(0, 0.26, 0)
	var neck := [[top, Vector3(0, 0.33, 0), 0.028], [Vector3(0, 0.33, 0), Vector3(0.07, 0.4, 0.02), 0.012],
			[Vector3(0, 0.33, 0), Vector3(-0.06, 0.38, -0.03), 0.012]]
	for nk in neck:
		var a: Vector3 = nk[0]
		var b: Vector3 = nk[1]
		var r0: float = nk[2]
		var ax := (b - a).normalized()
		var sx := ax.cross(Vector3.FORWARD if absf(ax.z) < 0.9 else Vector3.RIGHT).normalized()
		var sz := ax.cross(sx)
		for k in 6:
			var a1 := TAU * k / 6.0
			var a2 := TAU * (k + 1) / 6.0
			var d1 := sx * cos(a1) + sz * sin(a1)
			var d2 := sx * cos(a2) + sz * sin(a2)
			for q in [[a + d1 * r0, d1], [b + d2 * r0 * 0.6, d2], [b + d1 * r0 * 0.6, d1], [a + d1 * r0, d1], [a + d2 * r0, d2], [b + d2 * r0 * 0.6, d2]]:
				st.set_normal(q[1])
				st.add_vertex(q[0])
	var m := st.commit()
	_bag_meshes[variant] = m
	return m


static func _sofa(mb: Node3D, at: Vector3, yaw: float) -> void:
	var rb := _body(mb, 38.0, "cloth")
	var cloth := Mat.standard("sofa", Color(0.3, 0.2, 0.12), 0.95)
	var parts := [[Vector3(1.8, 0.4, 0.8), Vector3(0, 0.2, 0)], [Vector3(1.8, 0.45, 0.2), Vector3(0, 0.55, -0.3)],
			[Vector3(0.2, 0.3, 0.8), Vector3(-0.8, 0.5, 0)], [Vector3(0.2, 0.3, 0.8), Vector3(0.8, 0.5, 0)]]
	for p in parts:
		_part(rb, _boxm(p[0]), cloth, p[1])
		_shape(rb, _boxs(p[0]), p[1])
	# A torn cushion.
	_part(rb, _boxm(Vector3(0.75, 0.12, 0.6)), Mat.standard("sofa_torn", Color(0.55, 0.5, 0.4), 0.95), Vector3(0.45, 0.46, 0.05), Vector3(0.15, 0.2, 0))
	rb.position = at
	rb.rotation.y = yaw


static func _mattress(mb: Node3D, at: Vector3, yaw: float) -> void:
	var rb := _body(mb, 14.0, "cloth")
	var size := Vector3(1.9, 0.18, 0.9)
	_part(rb, _boxm(size), Mat.standard("mattress", Color(0.62, 0.58, 0.48), 0.95))
	_part(rb, _boxm(Vector3(0.6, 0.01, 0.4)), Mat.standard("stain", Color(0.4, 0.33, 0.2), 0.95), Vector3(0.3, 0.095, 0.1))
	_shape(rb, _boxs(size))
	rb.position = at + Vector3(0, 0.12, 0)
	rb.rotation = Vector3(0, yaw, 0.05)


static func _cart(mb: Node3D, at: Vector3, yaw: float) -> void:
	var rb := _body(mb, 12.0, "metal")
	var wire := Mat.standard("chrome", Color(0.6, 0.62, 0.62), 0.35, 0.9)
	# The basket as a frame of bars, the handle, legs and wheels.
	var w := 0.55
	var l := 0.85
	var h := 0.45
	var y0 := 0.5
	for p in [[Vector3(l, 0.02, 0.02), Vector3(0, y0, -w * 0.5)], [Vector3(l, 0.02, 0.02), Vector3(0, y0, w * 0.5)],
			[Vector3(l, 0.02, 0.02), Vector3(0, y0 + h, -w * 0.5)], [Vector3(l, 0.02, 0.02), Vector3(0, y0 + h, w * 0.5)],
			[Vector3(0.02, 0.02, w), Vector3(-l * 0.5, y0 + h, 0)], [Vector3(0.02, 0.02, w), Vector3(l * 0.5, y0 + h, 0)],
			[Vector3(0.02, 0.02, w), Vector3(-l * 0.5, y0, 0)], [Vector3(0.02, 0.02, w), Vector3(l * 0.5, y0, 0)],
			[Vector3(0.03, 0.03, w + 0.05), Vector3(-l * 0.5 - 0.12, y0 + h + 0.1, 0)]]:
		_part(rb, _boxm(p[0]), wire, p[1])
	for k in 6:
		_part(rb, _boxm(Vector3(0.01, h, 0.01)), wire, Vector3(-l * 0.5 + (k + 0.5) * l / 6.0, y0 + h * 0.5, -w * 0.5))
		_part(rb, _boxm(Vector3(0.01, h, 0.01)), wire, Vector3(-l * 0.5 + (k + 0.5) * l / 6.0, y0 + h * 0.5, w * 0.5))
	for dx in [-0.35, 0.35]:
		for dz in [-0.22, 0.22]:
			_part(rb, _boxm(Vector3(0.02, y0, 0.02)), wire, Vector3(dx, y0 * 0.5, dz))
			var wh := CylinderMesh.new()
			wh.top_radius = 0.05
			wh.bottom_radius = 0.05
			wh.height = 0.03
			_part(rb, wh, Mat.standard("rubber", Color(0.05, 0.05, 0.05), 0.9), Vector3(dx, 0.05, dz), Vector3(PI * 0.5, 0, 0))
	_shape(rb, _boxs(Vector3(l, h, w)), Vector3(0, y0 + h * 0.5, 0))
	_shape(rb, _boxs(Vector3(0.8, 0.1, 0.5)), Vector3(0, 0.05, 0))
	rb.position = at
	rb.rotation.y = yaw


static func _crate(mb: Node3D, at: Vector3, color: Color, rng: RandomNumberGenerator) -> void:
	var rb := _body(mb, 1.5, "plastic")
	var m := Mat.standard("crate_%s" % color.to_html(), color, 0.6)
	var size := Vector3(0.5, 0.3, 0.35)
	for p in [[Vector3(size.x, 0.02, size.z), Vector3(0, -0.14, 0)], [Vector3(size.x, size.y, 0.02), Vector3(0, 0, -0.165)],
			[Vector3(size.x, size.y, 0.02), Vector3(0, 0, 0.165)], [Vector3(0.02, size.y, size.z), Vector3(-0.24, 0, 0)],
			[Vector3(0.02, size.y, size.z), Vector3(0.24, 0, 0)]]:
		_part(rb, _boxm(p[0]), m, p[1])
	_shape(rb, _boxs(size))
	rb.position = at + Vector3(0, 0.16, 0)
	rb.rotation.y = rng.randf_range(-0.4, 0.4)


static func _drum(mb: Node3D, at: Vector3) -> void:
	var rb := _body(mb, 55.0, "wood")
	var wood := Mat.standard("drum_wood", Color(0.5, 0.38, 0.24), 0.9)
	for y in [0.03, 0.67]:
		var f := CylinderMesh.new()
		f.top_radius = 0.5
		f.bottom_radius = 0.5
		f.height = 0.06
		_part(rb, f, wood, Vector3(0, y, 0))
	var core := CylinderMesh.new()
	core.top_radius = 0.33
	core.bottom_radius = 0.33
	core.height = 0.6
	_part(rb, core, Mat.standard("cable", Color(0.06, 0.06, 0.06), 0.6), Vector3(0, 0.35, 0))
	var cs := CylinderShape3D.new()
	cs.radius = 0.5
	cs.height = 0.7
	_shape(rb, cs, Vector3(0, 0.35, 0))
	rb.position = at
