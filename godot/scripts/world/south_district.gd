extends RefCounted
## The south of the map, past the three-storey buildings (z 38..92): a
## street of its own with a bus stop and a kiosk, and a courtyard between
## two five-storey panel blocks - entrances with their canopies and
## benches, balconies, windows (some lit at night: emissive, no lights), a
## playground, washing lines, the bins, a row of garages, parked cars,
## trees, lamp posts.
## All of it static and merged by the level builder (geo.gd), patch by
## patch, so what is out of view is not drawn; the few loose things are
## rigid bodies asleep until touched.

const Mat = preload("res://scripts/world/materials.gd")
const StreetEnv = preload("res://scripts/world/street_env.gd")

const Z0 := 38.0
const Z1 := 92.0
const STOREY := 2.8
const FLOORS := 5


static func build(mb: Node3D) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 505
	var geo = mb.geo
	# The street across the south, with kerbs and a pavement on the far side.
	var kerb := Mat.concrete("dark")
	var pave := Mat.concrete("floor")
	for sz in [44.5, 52.5]:
		geo.block(Vector3(-35.5, mb._gy(0, sz) - 0.05, sz - 0.15), Vector3(35.5, mb._gy(0, sz) + 0.13, sz + 0.15), kerb)
	geo.block(Vector3(-35.5, mb._gy(0, 53.5) - 0.05, 52.65), Vector3(35.5, mb._gy(0, 53.5) + 0.1, 55.0), pave)
	_blocks(mb, rng)
	_yard(mb, rng)
	_street_things(mb, rng)
	mb._garages(Vector3(20.0, 0.0, 57.0), 5)
	for c in [[Vector3(-26.0, 0.0, 49.5), 1.57, 0], [Vector3(14.0, 0.0, 47.5), -1.6, 1], [Vector3(-8.0, 0.0, 58.6), 0.1, 2],
			[Vector3(27.0, 0.0, 72.0), 3.0, 1]]:
		mb._car(c[0], c[1], c[2])
	for p in [Vector3(-33.0, 0, 56.5), Vector3(33.0, 0, 76.0), Vector3(-2.0, 0, 90.0)]:
		mb._dead_tree(p)
	for p in [Vector3(-34.0, 0, 70.0), Vector3(-12.0, 0, 56.0), Vector3(4.0, 0, 62.0), Vector3(34.0, 0, 55.0), Vector3(-30.0, 0, 88.0)]:
		mb._dead_tree(p)
	mb._power_line([Vector3(-34.0, 0, 42.0), Vector3(-12.0, 0, 42.0), Vector3(10.0, 0, 42.0), Vector3(33.0, 0, 42.0)])


# --- The panel blocks ---------------------------------------------------------------------

static func _blocks(mb: Node3D, rng: RandomNumberGenerator) -> void:
	_panel_block(mb, rng, -32.0, -6.0, 62.0, 74.0)
	_panel_block(mb, rng, 4.0, 32.0, 78.0, 90.0)


## A five-storey panel block (x0..x1 along, z0..z1 deep), the entrances on
## its north side (towards the yard): a shell with windows on both long
## sides, panel seams, a band at each floor, balconies, the roof parapet,
## and at each entrance a canopy, a steel door, steps and a bench.
static func _panel_block(mb: Node3D, rng: RandomNumberGenerator, x0: float, x1: float, z0: float, z1: float) -> void:
	var geo = mb.geo
	var panel := Mat.concrete("wall")
	var dark := Mat.concrete("dark")
	var glass := Mat.standard("panel_glass", Color(0.06, 0.07, 0.08), 0.12, 0.4)
	var lit := _lit_window()
	var frame := Mat.standard("panel_frame", Color(0.75, 0.74, 0.7), 0.6)
	var y0: float = mb._gy((x0 + x1) * 0.5, (z0 + z1) * 0.5)
	var top := y0 + FLOORS * STOREY
	geo.block(Vector3(x0, y0 - 0.3, z0), Vector3(x1, top, z1), panel)
	geo.block(Vector3(x0 - 0.1, top, z0 - 0.1), Vector3(x1 + 0.1, top + 0.6, z1 + 0.1), dark)
	var w := x1 - x0
	var cols := int(w / 2.6)
	var step := w / cols
	var entrances := [x0 + w * 0.25, x0 + w * 0.75]
	for f in FLOORS:
		var fy := y0 + f * STOREY
		# A band between the floors and the seams between the panels.
		for z in [z0 - 0.04, z1 + 0.04]:
			geo.box(Vector3((x0 + x1) * 0.5, fy + STOREY, z), Vector3(w, 0.08, 0.06), dark, Vector3.ZERO, false)
		for c in cols + 1:
			for z in [z0 - 0.02, z1 + 0.02]:
				geo.box(Vector3(x0 + c * step, fy + STOREY * 0.5, z), Vector3(0.04, STOREY, 0.03), dark, Vector3.ZERO, false)
		for c in cols:
			var cx := x0 + (c + 0.5) * step
			for side in [-1.0, 1.0]:
				var z: float = z0 if side < 0.0 else z1
				var n := Vector3(0, 0, side)
				var on_entrance := false
				for ex in entrances:
					on_entrance = on_entrance or absf(cx - float(ex)) < step * 0.5
				if side < 0.0 and on_entrance:
					# The staircase windows over the entrance: small, between floors.
					if f > 0:
						geo.box(Vector3(cx, fy + 0.2, z + n.z * 0.03), Vector3(0.9, 0.6, 0.04), glass, Vector3.ZERO, false)
					continue
				var is_lit := rng.randf() < 0.14
				geo.box(Vector3(cx, fy + 1.45, z + n.z * 0.03), Vector3(1.3, 1.35, 0.04), lit if is_lit else glass, Vector3.ZERO, false)
				geo.box(Vector3(cx, fy + 1.45, z + n.z * 0.045), Vector3(0.05, 1.35, 0.03), frame, Vector3.ZERO, false)
				geo.box(Vector3(cx, fy + 0.74, z + n.z * 0.08), Vector3(1.45, 0.05, 0.14), dark, Vector3.ZERO, false)
				# Balconies on the yard side, every other column, from the first floor up.
				if side < 0.0 and f > 0 and c % 2 == 1:
					_balcony(geo, Vector3(cx, fy, z), rng, dark, panel)
	# Entrances.
	for ex in entrances:
		_entrance(mb, Vector3(float(ex), y0, z0), rng)
	# A couple of air conditioners and satellite dishes.
	for k in 4:
		var ax := rng.randf_range(x0 + 1.0, x1 - 1.0)
		var af := rng.randi_range(1, FLOORS - 1)
		geo.box(Vector3(ax, y0 + af * STOREY + 2.1, z1 + 0.25), Vector3(0.8, 0.5, 0.35), Mat.standard("aircon", Color(0.8, 0.8, 0.78), 0.6), Vector3.ZERO, false)


static func _balcony(geo, at: Vector3, rng: RandomNumberGenerator, dark: Material, panel: Material) -> void:
	var slab_y := at.y + 0.05
	geo.box(Vector3(at.x, slab_y, at.z - 0.55), Vector3(2.2, 0.14, 1.1), panel)
	# The front: glazed in on some (old frames), a concrete screen on others.
	if rng.randf() < 0.4:
		geo.box(Vector3(at.x, slab_y + 1.3, at.z - 1.08), Vector3(2.2, 1.1, 0.04), Mat.standard("balcony_glaze", Color(0.2, 0.22, 0.24), 0.2, 0.3), Vector3.ZERO, false)
		geo.box(Vector3(at.x, slab_y + 0.45, at.z - 1.08), Vector3(2.2, 0.8, 0.06), panel, Vector3.ZERO, false)
	else:
		geo.box(Vector3(at.x, slab_y + 0.5, at.z - 1.08), Vector3(2.2, 0.9, 0.06), panel, Vector3.ZERO, false)
		geo.box(Vector3(at.x, slab_y + 0.98, at.z - 1.08), Vector3(2.24, 0.05, 0.1), dark, Vector3.ZERO, false)
	for sx in [-1.0, 1.0]:
		geo.box(Vector3(at.x + sx * 1.08, slab_y + 0.5, at.z - 0.55), Vector3(0.05, 0.9, 1.1), panel, Vector3.ZERO, false)
	# Washing hung out on some.
	if rng.randf() < 0.3:
		var col: Color = [Color(0.8, 0.8, 0.75), Color(0.5, 0.2, 0.2), Color(0.25, 0.3, 0.5)][rng.randi() % 3]
		geo.box(Vector3(at.x + rng.randf_range(-0.5, 0.5), slab_y + 1.0, at.z - 1.13), Vector3(0.5, 0.45, 0.02), Mat.standard("washing_%d" % (rng.randi() % 3), col, 0.95), Vector3.ZERO, false)


## An entrance: steps, the canopy on two posts, a steel door (shut, locked),
## the number over it, a lamp, a bench to one side and a bin.
static func _entrance(mb: Node3D, at: Vector3, rng: RandomNumberGenerator) -> void:
	var geo = mb.geo
	var dark := Mat.concrete("dark")
	var door := Mat.standard("entrance_door", Color(0.22, 0.26, 0.24), 0.55, 0.5)
	geo.block(Vector3(at.x - 1.3, at.y - 0.1, at.z - 1.4), Vector3(at.x + 1.3, at.y + 0.18, at.z), Mat.concrete("floor"))
	geo.block(Vector3(at.x - 1.5, at.y + 2.6, at.z - 1.8), Vector3(at.x + 1.5, at.y + 2.75, at.z), dark)
	for sx in [-1.0, 1.0]:
		geo.box(Vector3(at.x + sx * 1.35, at.y + 1.3, at.z - 1.6), Vector3(0.1, 2.6, 0.1), Mat.rust(), Vector3.ZERO)
	geo.box(Vector3(at.x, at.y + 1.2, at.z - 0.03), Vector3(1.1, 2.1, 0.08), door, Vector3.ZERO, false)
	geo.box(Vector3(at.x + 0.38, at.y + 1.15, at.z - 0.09), Vector3(0.12, 0.2, 0.04), Mat.standard("intercom", Color(0.6, 0.6, 0.58), 0.4, 0.4), Vector3.ZERO, false)
	var num := Label3D.new()
	num.text = str(rng.randi_range(1, 4))
	num.font_size = 64
	num.pixel_size = 0.004
	num.modulate = Color(0.9, 0.9, 0.85)
	num.position = Vector3(at.x, at.y + 2.35, at.z - 0.05)
	num.rotation = Vector3(0, PI, 0)
	num.visibility_range_end = 30.0
	mb.add_child(num)
	StreetEnv._bench(geo, Vector3(at.x - 2.6, at.y, at.z - 1.2), 0.0, Mat.wood("bench_wood", Color(0.3, 0.22, 0.14), 0.8), Mat.rust())
	StreetEnv._bin(mb, Vector3(at.x + 2.0, at.y, at.z - 1.0))


static func _lit_window() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.2, 0.16, 0.1)
	m.emission_enabled = true
	m.emission = Color(1.0, 0.75, 0.45)
	m.emission_energy_multiplier = 1.4
	m.roughness = 0.3
	return m


# --- The yard -----------------------------------------------------------------------------

static func _yard(mb: Node3D, rng: RandomNumberGenerator) -> void:
	var geo = mb.geo
	var steel := Mat.standard("play_steel", Color(0.35, 0.45, 0.55), 0.5, 0.6)
	var red := Mat.standard("play_red", Color(0.6, 0.15, 0.12), 0.6, 0.3)
	var wood := Mat.wood("play_wood", Color(0.4, 0.3, 0.18), 0.85)
	var c := Vector3(-14.0, mb._gy(-14.0, 57.0), 57.0)
	# Swings: an A-frame each end, the bar, two seats on their chains.
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			geo.box(c + Vector3(sx * 1.6, 1.1, sz * 0.5), Vector3(0.07, 2.3, 0.07), steel, Vector3(sz * 0.22, 0, 0))
	geo.box(c + Vector3(0, 2.2, 0), Vector3(3.3, 0.08, 0.08), steel, Vector3.ZERO, false)
	for sx in [-0.7, 0.7]:
		for k in [-1.0, 1.0]:
			geo.box(c + Vector3(sx + k * 0.2, 1.45, 0), Vector3(0.02, 1.5, 0.02), steel, Vector3.ZERO, false)
		geo.box(c + Vector3(sx, 0.68, 0), Vector3(0.5, 0.05, 0.22), wood, Vector3.ZERO, false)
	# Slide: ladder up to a platform, the chute down.
	var s := c + Vector3(5.0, 0, 1.0)
	geo.box(s + Vector3(0, 0.8, 0), Vector3(0.8, 0.06, 0.8), red)
	for sx in [-0.38, 0.38]:
		for sz in [-0.38, 0.38]:
			geo.box(s + Vector3(sx, 0.4, sz), Vector3(0.06, 0.8, 0.06), steel)
	for k in 5:
		geo.box(s + Vector3(0, 0.15 + k * 0.16, 0.55 + k * 0.02), Vector3(0.6, 0.03, 0.06), steel, Vector3.ZERO, false)
	geo.box(s + Vector3(0, 0.45, -1.0), Vector3(0.55, 0.04, 1.6), steel, Vector3(-0.55, 0, 0))
	# Sandpit: a wooden frame, the sand in it.
	var p := c + Vector3(-5.5, 0, 0.5)
	for sx in [-1.0, 1.0]:
		geo.box(p + Vector3(sx * 1.0, 0.15, 0), Vector3(0.1, 0.3, 2.1), wood)
		geo.box(p + Vector3(0, 0.15, sx * 1.0), Vector3(2.1, 0.3, 0.1), wood)
	geo.box(p + Vector3(0, 0.05, 0), Vector3(1.9, 0.1, 1.9), Mat.standard("sand", Color(0.62, 0.55, 0.4), 1.0), Vector3.ZERO, false)
	# Benches round it, washing-line poles, a carpet-beating frame.
	for b in [[c + Vector3(-2.0, 0, 3.5), PI], [c + Vector3(2.5, 0, 3.5), PI], [c + Vector3(9.0, 0, -2.5), -PI * 0.5]]:
		StreetEnv._bench(geo, b[0], b[1], Mat.wood("bench_wood", Color(0.3, 0.22, 0.14), 0.8), Mat.rust())
	var lines := Vector3(4.0, mb._gy(4.0, 68.0), 68.0)
	for sx in [-3.0, 3.0]:
		geo.box(lines + Vector3(sx, 1.1, 0), Vector3(0.07, 2.2, 0.07), Mat.rust())
		geo.box(lines + Vector3(sx, 2.1, 0), Vector3(0.07, 0.07, 1.0), Mat.rust(), Vector3.ZERO, false)
	for k in 3:
		geo.box(lines + Vector3(0, 2.1, -0.4 + k * 0.4), Vector3(6.0, 0.012, 0.012), Mat.standard("wire", Color(0.2, 0.2, 0.2), 0.6), Vector3.ZERO, false)
	for k in 4:
		var col: Color = [Color(0.85, 0.85, 0.8), Color(0.55, 0.25, 0.2), Color(0.3, 0.35, 0.55), Color(0.6, 0.55, 0.3)][k]
		geo.box(lines + Vector3(-2.0 + k * 1.3, 1.75, -0.4 + (k % 3) * 0.4), Vector3(0.7, 0.65, 0.02), Mat.standard("sheet_%d" % k, col, 0.95), Vector3.ZERO, false)
	# The bins, in their fenced corner.
	var bins := Vector3(-2.0, mb._gy(-2.0, 75.0), 75.0)
	mb._dumpster(bins, 0.0)
	mb._dumpster(bins + Vector3(2.3, 0, 0), 0.0)
	for sx in [-1.5, 3.8]:
		geo.box(bins + Vector3(sx, 0.75, 0), Vector3(0.1, 1.5, 1.6), Mat.concrete("brick"))
	geo.box(bins + Vector3(1.15, 0.75, 0.8), Vector3(5.4, 1.5, 0.1), Mat.concrete("brick"))
	for k in 5:
		StreetEnv._bag(mb, bins + Vector3(rng.randf_range(-1.0, 3.5), 0.1, rng.randf_range(-1.6, -0.9)), rng)


# --- Along the street ------------------------------------------------------------------------

static func _street_things(mb: Node3D, rng: RandomNumberGenerator) -> void:
	var geo = mb.geo
	var dark := Mat.concrete("dark")
	# Bus stop: the shelter (roof, back panel, glass sides), a bench, the sign.
	var bs := Vector3(12.0, mb._gy(12.0, 54.2), 54.2)
	geo.block(bs + Vector3(-2.0, 2.4, -0.8), bs + Vector3(2.0, 2.5, 0.8), dark)
	geo.box(bs + Vector3(0, 1.3, 0.75), Vector3(4.0, 2.2, 0.06), Mat.standard("stop_panel", Color(0.35, 0.4, 0.45), 0.5, 0.3))
	for sx in [-1.95, 1.95]:
		geo.box(bs + Vector3(sx, 1.2, 0.0), Vector3(0.06, 2.4, 1.5), Mat.glass(Color(0.3, 0.35, 0.36)))
	StreetEnv._bench(geo, bs + Vector3(0, 0, 0.35), PI, Mat.wood("bench_wood", Color(0.3, 0.22, 0.14), 0.8), Mat.rust())
	geo.box(bs + Vector3(2.8, 1.4, -0.4), Vector3(0.07, 2.8, 0.07), Mat.rust())
	geo.box(bs + Vector3(2.8, 2.6, -0.4), Vector3(0.5, 0.5, 0.04), Mat.standard("bus_sign", Color(0.9, 0.85, 0.3), 0.5), Vector3.ZERO, false)
	# The kiosk: a box with a shuttered window, a sign on top, crates by it.
	var k := Vector3(-3.0, mb._gy(-3.0, 55.5), 55.5)
	geo.block(k + Vector3(-1.5, 0, -1.1), k + Vector3(1.5, 2.5, 1.1), Mat.standard("kiosk", Color(0.55, 0.52, 0.45), 0.7, 0.2))
	geo.box(k + Vector3(0, 1.35, -1.12), Vector3(1.6, 0.9, 0.04), Mat.standard("kiosk_shutter", Color(0.5, 0.52, 0.5), 0.5, 0.6), Vector3.ZERO, false)
	for i in 8:
		geo.box(k + Vector3(0, 0.95 + i * 0.11, -1.15), Vector3(1.6, 0.012, 0.02), dark, Vector3.ZERO, false)
	geo.box(k + Vector3(0, 2.85, -0.9), Vector3(2.8, 0.55, 0.12), Mat.standard("kiosk_sign", Color(0.7, 0.12, 0.1), 0.5), Vector3.ZERO, false)
	var word := Label3D.new()
	word.text = "ПРОДУКТЫ 24"
	word.font_size = 72
	word.pixel_size = 0.005
	word.modulate = Color(0.95, 0.9, 0.8)
	word.position = k + Vector3(0, 2.85, -0.97)
	word.rotation = Vector3(0, PI, 0)
	word.visibility_range_end = 40.0
	mb.add_child(word)
	for i in 3:
		StreetEnv._crate(mb, k + Vector3(1.9 + (i % 2) * 0.5, 0.2 + (i / 2) * 0.4, -0.6 + (i % 2) * 0.3), Color(0.45, 0.35, 0.22), rng)
	# Lamp posts along the pavement.
	for x in [-24.0, 0.0, 24.0]:
		mb._street_lamp(Vector3(x, mb._gy(x, 53.4), 53.4), x == 0.0)
