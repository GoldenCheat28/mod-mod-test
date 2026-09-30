extends Node3D
## Builds the whole level procedurally: an uneven asphalt street, an
## abandoned two-storey concrete building with a collapsed wall, an annex,
## a loading dock with stairs, and scattered props/debris.
##
## Static geometry goes under the NavigationRegion3D so it can be baked.

const Sfx = preload("res://scripts/audio/sfx.gd")
const Geo = preload("res://scripts/world/geo.gd")
const Mat = preload("res://scripts/world/materials.gd")
const Tex = preload("res://scripts/world/textures.gd")
const StreetEnv = preload("res://scripts/world/street_env.gd")

const GROUND_HALF := 60
const T := 0.3            # wall thickness
const F1 := 0.15          # ground floor level
const F2 := 3.4           # first floor level
const ROOF := 6.65        # roof level

var nav_region: NavigationRegion3D
## The table in the abandoned building where roulette can be played sitting
## down (roulette.gd): its centre, and each side's chair.
var roulette_table := {}
## Tables for a game of roulette for three or five (tall_building.gd,
## roulette_game.gd), and the hall where the evening game is held.
var game_tables: Array = []
var event_hall := {}
var bucket_pos := Vector3.INF     # the mop's bucket (player.gd rinses the mop in it)
var bucket_water: StandardMaterial3D
var bucket_dirt := 0.0            # blood rinsed into it (0..1)
var geo: Geo
var rng := RandomNumberGenerator.new()
var _h1 := FastNoiseLite.new()
var _h2 := FastNoiseLite.new()


func build() -> void:
	for st in steps():
		(st[1] as Callable).call()


## The level in pieces, [what, how], so it can be put together over a few
## frames with a loading screen showing (main.gd).
func steps() -> Array:
	return [
		["Размечаем землю", _begin],
		["Кладём асфальт", _ground],
		["Строим заброшку", func():
			_building()
			_annex()
			_dock()],
		["Улица и заборы", func():
			_street()
			_perimeter()],
		["Мусор и обломки", _rubble],
		["Склад, гаражи, машины", _extras],
		["Трёхэтажки", func():
			game_tables.clear()
			var TB = load("res://scripts/world/tall_building.gd")
			TB.build(self, {"x0": -4.0, "x1": 10.0, "z0": 17.0, "z1": 28.0, "kind": "event", "stair": "east", "seed": 71})
			TB.build(self, {"x0": -21.0, "x1": -9.0, "z0": 26.0, "z1": 35.0, "kind": "flats", "stair": "west", "seed": 72, "brick": true})],
		["Расставляем мебель", func():
			_table_and_chairs(Vector3(7.0, F1, -11.0))
			_bucket(Vector3(9.0, F1, -9.2))
			preload("res://scripts/world/furniture.gd").build(self)],
		["Собираем меши", func(): geo.commit()],
		["Бочки, бутылки, лужи", func():
			_barrels()
			_bottles_and_trash()
			_puddles()],
		["Граффити и грязь", func():
			_graffiti()
			_stains()
			_seams()
			_greenery()],
		["Двери и мелочи", func():
			_doors()
			_lights()
			StreetEnv.build_loose(self)],
	]


func _begin() -> void:
	rng.seed = 1337
	_h1.seed = 11
	_h1.frequency = 0.07
	_h2.seed = 12
	_h2.frequency = 0.45

	nav_region = NavigationRegion3D.new()
	nav_region.name = "Navigation"
	add_child(nav_region)
	var nm := NavigationMesh.new()
	nm.agent_radius = 0.4
	nm.agent_height = 1.8
	nm.agent_max_climb = 0.3
	nm.agent_max_slope = 40.0
	nm.cell_size = 0.2
	nm.cell_height = 0.1
	nm.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	nm.geometry_collision_mask = Game.LAYER_WORLD
	nm.filter_baking_aabb = AABB(Vector3(-36, -1, -36), Vector3(72, 12, 72))
	nav_region.navigation_mesh = nm

	geo = Geo.new(nav_region)


func bake_navigation(threaded := false) -> void:
	nav_region.bake_navigation_mesh(threaded)


func ground_height(x: float, z: float) -> float:
	return _h1.get_noise_2d(x, z) * 0.035 + _h2.get_noise_2d(x, z) * 0.008 + StreetEnv.surface(x, z)


# --- Ground -----------------------------------------------------------------

func _ground() -> void:
	# Visual mesh at 0.25 m resolution (fine enough for potholes and ruts).
	var res := 0.25
	var count := int(GROUND_HALF * 2 / res) + 1
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	verts.resize(count * count)
	normals.resize(count * count)
	uvs.resize(count * count)
	# Heights once per vertex; the normals from the neighbours' heights.
	var hts := PackedFloat32Array()
	hts.resize(count * count)
	for zi in count:
		for xi in count:
			hts[zi * count + xi] = ground_height(-GROUND_HALF + xi * res, -GROUND_HALF + zi * res)
	for zi in count:
		for xi in count:
			var x := -GROUND_HALF + xi * res
			var z := -GROUND_HALF + zi * res
			var i := zi * count + xi
			verts[i] = Vector3(x, hts[i], z)
			var xa := maxi(xi - 1, 0)
			var xb := mini(xi + 1, count - 1)
			var za := maxi(zi - 1, 0)
			var zb := mini(zi + 1, count - 1)
			var dx := (hts[zi * count + xb] - hts[zi * count + xa]) / ((xb - xa) * res)
			var dz := (hts[zb * count + xi] - hts[za * count + xi]) / ((zb - za) * res)
			normals[i] = Vector3(-dx, 1.0, -dz).normalized()
			uvs[i] = Vector2(x, z)
	var idx := PackedInt32Array()
	idx.resize((count - 1) * (count - 1) * 6)
	var k := 0
	for zi in count - 1:
		for xi in count - 1:
			var a := zi * count + xi
			var b := a + 1
			var c := a + count
			var d := c + 1
			idx[k] = a; idx[k + 1] = b; idx[k + 2] = c
			idx[k + 3] = b; idx[k + 4] = d; idx[k + 5] = c
			k += 6
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mi := MeshInstance3D.new()
	mi.name = "Ground"
	mi.mesh = mesh
	mi.material_override = Mat.asphalt()
	nav_region.add_child(mi)

	# Collision: 1 m heightmap.
	var hm := HeightMapShape3D.new()
	var w := GROUND_HALF * 2 + 1
	hm.map_width = w
	hm.map_depth = w
	var data := PackedFloat32Array()
	data.resize(w * w)
	for zi in w:
		for xi in w:
			data[zi * w + xi] = ground_height(xi - GROUND_HALF, zi - GROUND_HALF)
	hm.map_data = data
	var body := StaticBody3D.new()
	body.name = "GroundBody"
	body.collision_layer = Game.LAYER_WORLD
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	cs.shape = hm
	body.add_child(cs)
	nav_region.add_child(body)


# --- Abandoned building -----------------------------------------------------
# Footprint x -10..10, z -22..-8. Ground floor, first floor, flat roof.

func _building() -> void:
	var wall := Mat.concrete("wall")
	var floor_m := Mat.concrete("floor")
	var h1 := F2 - 0.25 - F1        # storey wall height

	# Plinth / ground floor slab.
	geo.block(Vector3(-10, -0.15, -22), Vector3(10, F1, -8), floor_m)

	# --- Ground floor walls ---
	# South (street side): door, windows, wide garage opening.
	geo.wall(Vector3(-10, F1, -8.15), 20.0, true, h1, T, wall, [
		[3.3, 1.4, 0.0, 2.3], [7.3, 1.4, 1.0, 2.3], [11.5, 3.2, 0.0, 2.7], [15.5, 1.5, 1.0, 2.3]])
	# North.
	geo.wall(Vector3(-10, F1, -21.85), 20.0, true, h1, T, wall, [
		[4.0, 1.4, 1.1, 2.3], [13.0, 1.4, 1.1, 2.3]])
	# East: high loading opening at dock level.
	geo.wall(Vector3(9.85, F1, -21.7), 13.4, false, h1, T, wall, [
		[2.2, 2.5, 1.05, 2.9], [8.5, 1.4, 1.1, 2.3]])
	# West: most of the south half has collapsed into the annex.
	geo.wall(Vector3(-9.85, F1, -21.7), 13.4, false, h1, T, wall, [
		[2.0, 1.4, 1.1, 2.3], [7.7, 5.7, 0.0, h1]])
	_broken_wall_x(-9.85, -14.0, -8.3, F1, h1)

	# Interior partition with a doorway and a punched-through hole.
	geo.wall(Vector3(0, F1, -21.7), 13.4, false, h1, 0.2, wall, [
		[5.5, 1.2, 0.0, 2.2], [10.0, 1.6, 0.5, 2.0]])
	# Columns.
	for p in [Vector3(-5, 0, -15), Vector3(5, 0, -13)]:
		geo.block(Vector3(p.x - 0.2, F1, p.z - 0.2), Vector3(p.x + 0.2, F2 - 0.25, p.z + 0.2), wall)

	# Inner steps from the loading opening down to the ground floor.
	geo.stairs(Vector3(7.0, F1, -18.25), Vector3(1, 0, 0), 2.5, 1.05, 6, 0.44, floor_m)
	# Stairs ground -> first floor along the north wall.
	geo.stairs(Vector3(2.5, F1, -21.1), Vector3(1, 0, 0), 1.2, F2 - F1, 18, 0.28, floor_m)

	# --- First floor slab (stair hole + a collapsed hole) ---
	var stair_hole := Rect2(2.3, -21.7, 5.5, 1.4)
	var collapse_hole := Rect2(-7.0, -15.0, 3.0, 3.0)
	geo.slab(Vector2(-10, -22), Vector2(10, -8), F2 - 0.25, F2, floor_m, [stair_hole, collapse_hole])
	_hole_edges(collapse_hole, F2)
	# Guard wall along the stair hole.
	geo.block(Vector3(2.3, F2, -20.36), Vector3(7.0, F2 + 1.0, -20.24), wall)

	# --- First floor walls ---
	var h2 := ROOF - 0.25 - F2
	geo.wall(Vector3(-10, F2, -8.15), 20.0, true, h2, T, wall, [
		[2.0, 1.5, 1.0, 2.4], [6.5, 1.5, 1.0, 2.4], [11.0, 3.0, 0.6, 2.6], [15.5, 1.5, 1.0, 2.4]])
	geo.wall(Vector3(-10, F2, -21.85), 20.0, true, h2, T, wall, [
		[3.0, 1.4, 1.1, 2.4], [11.0, 1.4, 1.1, 2.4], [16.0, 1.4, 1.1, 2.4]])
	# East: door to the external stairs landing.
	geo.wall(Vector3(9.85, F2, -21.7), 13.4, false, h2, T, wall, [
		[5.5, 1.2, 0.0, 2.2], [9.5, 1.4, 1.0, 2.4]])
	# West: broken through onto the annex roof.
	geo.wall(Vector3(-9.85, F2, -21.7), 13.4, false, h2, T, wall, [
		[2.5, 1.4, 1.0, 2.4], [8.7, 3.2, 0.0, 2.7]])
	# Partition with doorway.
	geo.wall(Vector3(2.0, F2, -17.5), 9.2, false, h2, 0.2, wall, [[3.0, 1.1, 0.0, 2.2]])

	# Stairs first floor -> roof, running west.
	geo.stairs(Vector3(-2.5, F2, -21.1), Vector3(-1, 0, 0), 1.2, ROOF - F2, 18, 0.28, floor_m)
	geo.block(Vector3(-7.0, F2, -20.36), Vector3(-2.3, F2 + 1.0, -20.24), wall)

	# --- Roof ---
	var roof_hole := Rect2(-7.8, -21.7, 5.5, 1.4)
	geo.slab(Vector2(-10, -22), Vector2(10, -8), ROOF - 0.25, ROOF, floor_m, [roof_hole])
	# Its outside: pilasters up the corners, a band at each floor, a darker
	# plinth along the bottom - so the edges are not bare box corners.
	var trim := Mat.concrete("dark")
	for c in [Vector2(-10.0, -8.0), Vector2(10.0, -8.0), Vector2(-10.0, -22.0), Vector2(10.0, -22.0)]:
		var sx := signf(c.x)
		var sz := signf(c.y + 15.0)
		geo.block(Vector3(c.x - 0.28 * sx, 0.0, c.y - 0.28 * sz), Vector3(c.x + 0.08 * sx, ROOF + 0.95, c.y + 0.08 * sz), trim)
	for y in [F2 - 0.3, ROOF - 0.3]:
		geo.block(Vector3(-10.0, y, -8.0), Vector3(10.0, y + 0.25, -7.94), trim, false)
		geo.block(Vector3(-10.0, y, -22.06), Vector3(10.0, y + 0.25, -22.0), trim, false)
		geo.block(Vector3(9.94, y, -22.0), Vector3(10.06, y + 0.25, -8.0), trim, false)
	# (broken at the door and the wide opening: nothing across a doorway)
	for seg in [[-10.0, -6.7], [-5.3, 1.5], [4.7, 10.0]]:
		geo.block(Vector3(seg[0], F1, -8.0), Vector3(seg[1], F1 + 0.45, -7.95), trim, false)
	# Parapet with a broken gap on the south side.
	var pm := Mat.concrete("dark")
	geo.block(Vector3(-10, ROOF, -8.25), Vector3(1.0, ROOF + 0.9, -8.0), pm)
	geo.block(Vector3(3.5, ROOF, -8.25), Vector3(10, ROOF + 0.9, -8.0), pm)
	geo.block(Vector3(-10, ROOF, -22), Vector3(10, ROOF + 0.9, -21.75), pm)
	geo.block(Vector3(-10, ROOF, -21.75), Vector3(-9.75, ROOF + 0.9, -8.25), pm)
	geo.block(Vector3(9.75, ROOF, -21.75), Vector3(10, ROOF + 0.9, -8.25), pm)
	geo.block(Vector3(-7.8, ROOF, -20.36), Vector3(-2.3, ROOF + 0.9, -20.24), pm)
	# Rooftop clutter: vent box and a fallen water tank base.
	geo.block(Vector3(4, ROOF, -18), Vector3(5.6, ROOF + 1.1, -16.8), pm)
	geo.block(Vector3(-4, ROOF, -13), Vector3(-1.5, ROOF + 0.35, -11), pm)

	# Rebar sticking out of the roof edge and window lintels.
	for i in 14:
		var x := rng.randf_range(-9.5, 9.5)
		_rebar(Vector3(x, ROOF + 0.85, -8.12), Vector3(rng.randf_range(-0.2, 0.2), 1, rng.randf_range(-0.1, 0.4)), rng.randf_range(0.2, 0.7))


## Jagged remains of a collapsed wall running along Z at x, from z0 to z1.
func _broken_wall_x(x: float, z0: float, z1: float, base: float, full_h: float) -> void:
	var m := Mat.concrete("wall")
	var z := z0
	# Near the standing part the stub is tall and tapers down to rubble.
	while z < z1:
		var seg := rng.randf_range(0.25, 0.6)
		var k := (z - z0) / (z1 - z0)
		var h := lerpf(full_h * 0.9, 0.15, clampf(k * 1.6, 0.0, 1.0)) * rng.randf_range(0.6, 1.0)
		if k > 0.35 and k < 0.8:
			h = rng.randf_range(0.05, 0.25)   # walkable gap
		geo.box(Vector3(x + rng.randf_range(-0.05, 0.05), base + h * 0.5, z + seg * 0.5), Vector3(T, h, seg), m,
				Vector3(rng.randf_range(-0.05, 0.05), 0, rng.randf_range(-0.08, 0.08)))
		# Exposed rebar on top of each chunk.
		if h > 0.3:
			for r in 2:
				_rebar(Vector3(x + rng.randf_range(-0.08, 0.08), base + h, z + seg * 0.5 + rng.randf_range(-0.1, 0.1)),
						Vector3(rng.randf_range(-0.4, 0.4), 1, rng.randf_range(-0.3, 0.3)), rng.randf_range(0.15, 0.6))
		z += seg
	# Horizontal rebar protruding from the broken vertical edge.
	for i in 7:
		var y := base + 0.4 + i * 0.38
		_rebar(Vector3(x, y, z0 + 0.02), Vector3(rng.randf_range(-0.2, 0.2), rng.randf_range(-0.3, 0.1), 1), rng.randf_range(0.2, 0.7))


## Broken concrete lips and dangling rebar around a hole in a slab.
func _hole_edges(r: Rect2, top: float) -> void:
	var m := Mat.concrete("floor")
	for i in 16:
		var edge := i % 4
		var t := rng.randf()
		var p := Vector3.ZERO
		match edge:
			0: p = Vector3(r.position.x + t * r.size.x, top, r.position.y)
			1: p = Vector3(r.position.x + t * r.size.x, top, r.end.y)
			2: p = Vector3(r.position.x, top, r.position.y + t * r.size.y)
			3: p = Vector3(r.end.x, top, r.position.y + t * r.size.y)
		geo.box(p + Vector3(0, -0.12, 0), Vector3(rng.randf_range(0.2, 0.5), 0.2, rng.randf_range(0.2, 0.5)), m,
				Vector3(rng.randf_range(-0.4, 0.4), rng.randf(), rng.randf_range(-0.4, 0.4)), false)
		_rebar(p + Vector3(0, -0.15, 0), Vector3(rng.randf_range(-0.5, 0.5), -1, rng.randf_range(-0.5, 0.5)), rng.randf_range(0.3, 1.2))


func _rebar(from: Vector3, dir: Vector3, length: float) -> void:
	var m := Mat.rust()
	var d := dir.normalized()
	var bend := rng.randf() < 0.5
	var l1 := length * (0.6 if bend else 1.0)
	_rod(from, d, l1, m)
	if bend:
		var d2 := (d + Vector3(rng.randf_range(-0.8, 0.8), rng.randf_range(-0.8, 0.3), rng.randf_range(-0.8, 0.8))).normalized()
		_rod(from + d * l1, d2, length * 0.4, m)


func _rod(from: Vector3, d: Vector3, length: float, m: Material) -> void:
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.007
	cyl.bottom_radius = 0.007
	cyl.height = length
	cyl.radial_segments = 5
	cyl.rings = 1
	var up := Vector3.UP if absf(d.dot(Vector3.UP)) < 0.99 else Vector3.RIGHT
	var x := up.cross(d).normalized()
	var z := x.cross(d).normalized()
	var xf := Transform3D(Basis(x, d, z), from + d * length * 0.5)
	geo.add_mesh(cyl, xf, m)


# --- Annex (garage) west of the building ------------------------------------

func _annex() -> void:
	var wall := Mat.concrete("brick")
	var floor_m := Mat.concrete("floor")
	var h := 3.0
	geo.block(Vector3(-16, -0.15, -16), Vector3(-10, 0.1, -8), floor_m)
	geo.wall(Vector3(-15.85, 0.1, -15.7), 7.4, false, h, T, wall, [[3.0, 1.4, 1.0, 2.2]])
	geo.wall(Vector3(-16, 0.1, -15.85), 6.0, true, h, T, wall, [])
	geo.wall(Vector3(-16, 0.1, -8.15), 6.0, true, h, T, wall, [[1.0, 3.8, 0.0, 2.6]])
	# Roof with a collapsed corner, reachable from the first floor break.
	geo.slab(Vector2(-16, -16), Vector2(-9.7, -8), 3.1, 3.3, floor_m, [Rect2(-16, -11.0, 2.6, 3.0)])
	_hole_edges(Rect2(-16, -11.0, 2.6, 3.0), 3.3)


# --- Loading dock and external stairs ----------------------------------------

func _dock() -> void:
	var c := Mat.concrete("wall")
	var dark := Mat.concrete("dark")
	geo.block(Vector3(10, -0.15, -20), Vector3(16, 1.2, -10), c)
	# Steps from the sidewalk up to the dock.
	geo.stairs(Vector3(13.5, 0.0, -6.2), Vector3(0, 0, -1), 3.0, 1.2, 7, 0.54, c)
	# Rubber bumpers.
	for z in [-18.5, -15.5, -12.5]:
		geo.block(Vector3(16, 0.35, z - 0.2), Vector3(16.18, 0.95, z + 0.2), Mat.standard("rubber", Color(0.05, 0.05, 0.05), 0.9))
	# External stairs dock -> first floor, and landing on columns.
	geo.stairs(Vector3(10.6, 1.2, -11.0), Vector3(0, 0, -1), 1.2, F2 - 1.2, 12, 0.28, c)
	geo.block(Vector3(10.0, F2 - 0.25, -16.6), Vector3(11.6, F2, -14.35), c)
	for z in [-14.5, -16.45]:
		geo.block(Vector3(11.3, 1.2, z - 0.12), Vector3(11.55, F2 - 0.25, z + 0.12), dark)
	# Railing (rusty pipes) with thin collision.
	var rise := F2 - 1.2
	var run := 3.36
	for i in 5:
		var z := -11.0 - i * run / 4.0
		_rod(Vector3(11.18, 1.2 + rise * (i / 4.0), z), Vector3.UP, 0.95, Mat.rust())
	var slope := Vector3(0, rise, -run)
	_rod(Vector3(11.18, 2.15, -11.0), slope.normalized(), slope.length(), Mat.rust())
	for z in [-14.35, -15.5, -16.55]:
		_rod(Vector3(11.55, F2, z), Vector3.UP, 0.95, Mat.rust())
	_rod(Vector3(11.55, F2 + 0.95, -14.35), Vector3(0, 0, -1), 2.2, Mat.rust())
	_rod(Vector3(11.2, F2 + 0.95, -14.35), Vector3(1, 0, 0), 0.35, Mat.rust())
	geo.add_collision_box(Transform3D(Basis.IDENTITY, Vector3(11.58, F2 + 0.5, -15.5)), Vector3(0.05, 1.0, 2.3))
	geo.add_collision_box(Transform3D(Basis.from_euler(Vector3(atan2(rise, run), 0, 0)), Vector3(11.2, 1.2 + rise * 0.5 + 0.5, -11.0 - run * 0.5)),
			Vector3(0.05, 1.0, slope.length()))


# --- Street furniture ---------------------------------------------------------

func _street() -> void:
	var sw := Mat.concrete("sidewalk")
	var dark := Mat.concrete("dark")
	# Sidewalk in front of the building, with a kerb.
	geo.block(Vector3(-17, -0.1, -8), Vector3(17, F1, -5.4), sw)
	geo.block(Vector3(-17, -0.1, -5.4), Vector3(17, F1 - 0.02, -5.25), dark)

	# Low concrete wall with gaps across the street.
	for seg in [[-28.0, -14.0], [-10.0, 2.0], [6.0, 20.0]]:
		geo.block(Vector3(seg[0], 0, 7.0), Vector3(seg[1], 1.0, 7.35), Mat.concrete("wall"))
	# Jersey barriers.
	for p in [Vector3(-6, 0, 2), Vector3(4, 0, 3.5), Vector3(17, 0, -2), Vector3(-22, 0, -3)]:
		var rot := rng.randf_range(-0.5, 0.5)
		geo.box(p + Vector3(0, 0.4, 0), Vector3(2.0, 0.8, 0.6), dark, Vector3(0, rot, 0))
		geo.box(p + Vector3(0, 0.1, 0), Vector3(2.0, 0.2, 0.8), dark, Vector3(0, rot, 0))

	# Rusted shipping container.
	var cont := Mat.standard("container", Color(0.28, 0.12, 0.08), 0.75, 0.4, 1.2)
	geo.box(Vector3(-22, 1.3, 8.5), Vector3(6.06, 2.6, 2.44), cont, Vector3(0, 0.25, 0))
	for i in 12:
		var t := -2.8 + i * 0.5
		var off := Vector3(t, 1.3, 1.23).rotated(Vector3.UP, 0.25)
		geo.box(Vector3(-22, 0, 8.5) + off, Vector3(0.12, 2.5, 0.05), cont, Vector3(0, 0.25, 0), false)

	# Ruined kiosk: roofless brick walls with one side knocked down.
	var brick := Mat.concrete("brick")
	geo.wall(Vector3(16, 0, 14), 4.0, true, 2.4, 0.25, brick, [[1.3, 1.0, 0.0, 2.1]])
	geo.wall(Vector3(16, 0, 18), 4.0, true, 1.1, 0.25, brick, [])
	geo.wall(Vector3(16, 0, 14.1), 3.8, false, 2.4, 0.25, brick, [[1.5, 1.0, 1.0, 1.9]])
	geo.wall(Vector3(20, 0, 14.1), 3.8, false, 0.7, 0.25, brick, [])

	# Raised concrete platform in the south-west with steps.
	var c := Mat.concrete("wall")
	geo.block(Vector3(-32, -0.1, 16), Vector3(-22, 0.9, 26), c)
	geo.stairs(Vector3(-21.99 + 2.4, 0, 21.0), Vector3(-1, 0, 0), 2.4, 0.9, 5, 0.48, c)


func _perimeter() -> void:
	var c := Mat.concrete("dark")
	var brick := Mat.concrete("brick")
	geo.block(Vector3(-36, -0.2, -36.5), Vector3(36, 5.0, -36), c)
	geo.block(Vector3(-36, -0.2, 36), Vector3(36, 3.2, 36.5), c)
	geo.block(Vector3(-36.5, -0.2, -36.5), Vector3(-36, 4.0, 36.5), c)
	geo.block(Vector3(36, -0.2, -36.5), Vector3(36.5, 4.0, 36.5), c)
	# Background buildings beyond the wall (visual only).
	var brng := RandomNumberGenerator.new()
	brng.seed = 99
	for side in 4:
		var along := -34.0
		while along < 34.0:
			var w := brng.randf_range(6.0, 12.0)
			var h := brng.randf_range(7.0, 20.0)
			var d := brng.randf_range(8.0, 14.0)
			var centre := Vector3(along + w * 0.5, h * 0.5 - 0.2, -38.0 - d * 0.5)
			var b := Basis(Vector3.UP, side * PI * 0.5)
			var m := brick if brng.randf() < 0.4 else c
			geo.box(b * centre, Vector3(w, h, d).abs() if side % 2 == 0 else Vector3(d, h, w), m, Vector3.ZERO, false)
			_facade(b, along, w, h, -38.0, brng)
			along += w + brng.randf_range(0.5, 3.0)


## The face of a building in the background (the side towards the yard, at
## local z = `face`, the building from x = along to along + w): rows of
## windows (dark glass, some boarded up or empty), a band at each floor,
## corner pilasters and a cornice along the top, the odd air conditioner -
## so it reads as a block of flats or offices, not a box.
func _facade(b: Basis, along: float, w: float, h: float, face: float, brng: RandomNumberGenerator) -> void:
	var glass := Mat.standard("window_dark", Color(0.05, 0.06, 0.07), 0.15, 0.4)
	var boards := Mat.standard("window_boards", Color(0.3, 0.22, 0.14), 0.9)
	var hole := Mat.standard("window_hole", Color(0.015, 0.015, 0.015), 1.0)
	var trim: Material = Mat.concrete("dark")
	var pale := Mat.concrete("wall")
	var storey := 3.0
	var floors := int((h - 1.0) / storey)
	# Windows, each with a sill under it.
	var cols := maxi(int((w - 1.2) / 2.3), 1)
	var gap := (w - cols * 1.2) / (cols + 1)
	for f in floors:
		var y := 1.4 + f * storey
		if y + 1.5 > h - 0.6:
			break
		for c in cols:
			var x := along + gap + c * (1.2 + gap) + 0.6
			var r := brng.randf()
			var mat: Material = glass if r < 0.75 else (boards if r < 0.88 else hole)
			geo.box(b * Vector3(x, y + 0.75, face + 0.025), _turn(b, Vector3(1.2, 1.5, 0.05)), mat, Vector3.ZERO, false)
			geo.box(b * Vector3(x, y - 0.04, face + 0.06), _turn(b, Vector3(1.35, 0.08, 0.14)), trim, Vector3.ZERO, false)
			if r > 0.93 and y > 3.0:
				# An air conditioner under the window.
				geo.box(b * Vector3(x + 0.3, y - 0.45, face + 0.25), _turn(b, Vector3(0.7, 0.45, 0.45)), pale, Vector3.ZERO, false)
		# The band between floors.
		if f > 0:
			geo.box(b * Vector3(along + w * 0.5, y - 0.35, face + 0.04), _turn(b, Vector3(w, 0.2, 0.08)), trim, Vector3.ZERO, false)
	# Corners and the top.
	for x in [along + 0.2, along + w - 0.2]:
		geo.box(b * Vector3(x, h * 0.5 - 0.2, face + 0.05), _turn(b, Vector3(0.4, h, 0.1)), trim, Vector3.ZERO, false)
	geo.box(b * Vector3(along + w * 0.5, h - 0.35, face + 0.12), _turn(b, Vector3(w + 0.2, 0.3, 0.24)), trim, Vector3.ZERO, false)
	geo.box(b * Vector3(along + w * 0.5, 0.25, face + 0.04), _turn(b, Vector3(w, 0.9, 0.08)), trim, Vector3.ZERO, false)


## A size given along/up/out of a face turned by b (quarter turns only).
static func _turn(b: Basis, size: Vector3) -> Vector3:
	var r := b * size
	return Vector3(absf(r.x), absf(r.y), absf(r.z))


# --- Rubble, debris, rebar ------------------------------------------------------

func _rubble() -> void:
	var m := Mat.concrete("rubble")
	var piles := [
		[Vector3(-11.5, 0.1, -11.0), 2.2, 26],   # collapsed wall
		[Vector3(-5.5, F1, -13.5), 1.5, 14],     # under the first floor hole
		[Vector3(-14.5, 0.1, -9.5), 1.5, 14],    # under the annex roof hole
		[Vector3(7.0, ROOF, -12.0), 0.8, 5],
		[Vector3(18.0, 0.0, 16.0), 1.2, 8],      # kiosk
		[Vector3(-3.0, 0.0, -4.0), 1.0, 5],
	]
	for pile in piles:
		var centre: Vector3 = pile[0]
		var radius: float = pile[1]
		for i in pile[2]:
			var a := rng.randf() * TAU
			var r := sqrt(rng.randf()) * radius
			var size := lerpf(0.35, 0.08, r / radius) * rng.randf_range(0.6, 1.4)
			var p := centre + Vector3(cos(a) * r, size * 0.35, sin(a) * r)
			var mesh := Geo.rock_mesh(size, rng.randi())
			var xf := Transform3D(Basis.from_euler(Vector3(0, rng.randf() * TAU, 0)), p)
			geo.add_mesh(mesh, xf, m)
			if size > 0.22:
				var sb := StaticBody3D.new()
				sb.collision_layer = Game.LAYER_WORLD
				sb.collision_mask = 0
				var cs := CollisionShape3D.new()
				cs.shape = Geo.rock_shape(mesh)
				sb.add_child(cs)
				sb.transform = xf
				nav_region.add_child(sb)
	# Loose concrete chunks that react to bullets and bodies.
	for i in 12:
		var centre: Vector3 = piles[i % 3][0]
		var size := rng.randf_range(0.12, 0.25)
		var mesh := Geo.rock_mesh(size, rng.randi(), 0.7)
		var rb := RigidBody3D.new()
		rb.collision_layer = Game.LAYER_PROPS
		rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_PLAYER
		rb.mass = 2200.0 * size * size * size * 1.5
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = m
		rb.add_child(mi)
		var cs := CollisionShape3D.new()
		cs.shape = Geo.rock_shape(mesh)
		rb.add_child(cs)
		rb.position = centre + Vector3(rng.randf_range(-1.5, 1.5), 0.6 + i * 0.05, rng.randf_range(-1.5, 1.5))
		rb.set_meta("surface", "concrete")
		# Knocked about, it knocks: louder the harder it hits.
		rb.contact_monitor = true
		rb.max_contacts_reported = 2
		rb.body_entered.connect(func(_b):
			var v := rb.linear_velocity.length()
			if v > 0.9 and Time.get_ticks_msec() - int(rb.get_meta("knock", 0)) > 150:
				rb.set_meta("knock", Time.get_ticks_msec())
				Game.play_3d(Sfx.get_stream(&"stone"), rb.global_position, clampf(-22.0 + v * 4.0, -22.0, 0.0), 0.12, 3.0))
		add_child(rb)
	# Scattered small debris across the whole street (visual only).
	for i in 120:
		var p := Vector3(rng.randf_range(-34, 34), 0, rng.randf_range(-34, 34))
		p.y = ground_height(p.x, p.z) + 0.02
		var size := rng.randf_range(0.03, 0.09)
		geo.add_mesh(Geo.rock_mesh(size, rng.randi()), Transform3D(Basis.from_euler(Vector3(0, rng.randf() * TAU, 0)), p), m)


# --- Dynamic props --------------------------------------------------------------

func _barrels() -> void:
	var spots := [
		[Vector3(-8, F1, -18), false], [Vector3(-7.3, F1, -18.4), false], [Vector3(-7.6, F1, -17.5), true],
		[Vector3(12, 1.2, -18.5), false], [Vector3(12.7, 1.2, -18.8), false], [Vector3(14.5, 1.2, -12), true],
		[Vector3(-19, 0, 2), false], [Vector3(-18.3, 0, 2.4), true], [Vector3(8, 0, 1), false],
		[Vector3(22, 0, -6), true], [Vector3(-13, 0.1, -14.8), false], [Vector3(3, F2, -10), false],
		[Vector3(-28, 0.9, 18), false], [Vector3(26, 0, 20), true],
	]
	var cyl_mesh := CylinderMesh.new()
	cyl_mesh.top_radius = 0.29
	cyl_mesh.bottom_radius = 0.29
	cyl_mesh.height = 0.88
	cyl_mesh.radial_segments = 20
	var rib := TorusMesh.new()
	rib.inner_radius = 0.285
	rib.outer_radius = 0.305
	rib.rings = 20
	rib.ring_segments = 4
	for s in spots:
		var p: Vector3 = s[0]
		var lying: bool = s[1]
		var rb := RigidBody3D.new()
		rb.name = "Barrel"
		rb.collision_layer = Game.LAYER_PROPS
		rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_PLAYER | Game.LAYER_DEBRIS
		rb.mass = 19.0
		rb.set_meta("surface", "metal")
		var pm := PhysicsMaterial.new()
		pm.friction = 0.6
		pm.bounce = 0.1
		rb.physics_material_override = pm
		var mi := MeshInstance3D.new()
		mi.mesh = cyl_mesh
		mi.material_override = Mat.barrel(rng.randi() % 4)
		rb.add_child(mi)
		for y in [-0.14, 0.14]:
			var r := MeshInstance3D.new()
			r.mesh = rib
			r.position.y = y
			r.material_override = mi.material_override
			rb.add_child(r)
		var cs := CollisionShape3D.new()
		var shape := CylinderShape3D.new()
		shape.radius = 0.29
		shape.height = 0.88
		cs.shape = shape
		rb.add_child(cs)
		if lying:
			rb.position = p + Vector3(0, 0.3, 0)
			rb.rotation = Vector3(PI * 0.5, rng.randf() * TAU, 0)
		else:
			rb.position = p + Vector3(0, 0.45, 0)
			rb.rotation.y = rng.randf() * TAU
		add_child(rb)


func _bottles_and_trash() -> void:
	var glass_cols := [Color(0.15, 0.35, 0.12), Color(0.35, 0.2, 0.06), Color(0.7, 0.75, 0.72)]
	var body := CylinderMesh.new()
	body.top_radius = 0.034
	body.bottom_radius = 0.034
	body.height = 0.17
	body.radial_segments = 10
	var neck := CylinderMesh.new()
	neck.top_radius = 0.012
	neck.bottom_radius = 0.03
	neck.height = 0.08
	neck.radial_segments = 8
	var areas := [Vector3(-4, F1, -12), Vector3(-12.5, 0.1, -12), Vector3(6, 0, -3), Vector3(-20, 0, 4),
			Vector3(17.5, 0, 16), Vector3(4, F2, -14), Vector3(13, 1.2, -14)]
	for area in areas:
		for i in rng.randi_range(2, 4):
			var gc: Color = glass_cols[rng.randi() % glass_cols.size()]
			var rb: RigidBody3D = preload("res://scripts/world/bottle.gd").make(Mat.glass(gc), gc, body, neck)
			var standing := rng.randf() < 0.4
			rb.position = area + Vector3(rng.randf_range(-1.2, 1.2), 0.1 if standing else 0.05, rng.randf_range(-1.2, 1.2))
			rb.rotation = Vector3(0 if standing else PI * 0.5, rng.randf() * TAU, 0)
			add_child(rb)
		# Broken glass shards (visual).
		for i in 10:
			var shard := BoxMesh.new()
			shard.size = Vector3(rng.randf_range(0.01, 0.04), 0.002, rng.randf_range(0.01, 0.05))
			var p: Vector3 = area + Vector3(rng.randf_range(-1, 1), 0.003, rng.randf_range(-1, 1))
			if area.y < 0.05:
				p.y = ground_height(p.x, p.z) + 0.003
			geo.add_mesh(shard, Transform3D(Basis.from_euler(Vector3(0, rng.randf() * TAU, 0)), p),
					Mat.glass(glass_cols[i % glass_cols.size()]))

	# Newspapers and crumpled paper.
	var paper_mats: Array[StandardMaterial3D] = []
	for i in 4:
		paper_mats.append(Mat.decal_material_textured("paper_%d" % i, Tex.newspaper(i + 3)))
	var sheet := PlaneMesh.new()
	sheet.size = Vector2(0.38, 0.3)
	sheet.subdivide_width = 2
	sheet.subdivide_depth = 2
	var paper_spots := [Vector3(-3, F1, -11), Vector3(-12.5, 0.1, -10.5), Vector3(0, 0, -3), Vector3(10, 0, 0),
			Vector3(-15, 0, 5), Vector3(6, F2, -12), Vector3(-6, F2, -18), Vector3(19, 0, 16)]
	for area in paper_spots:
		for i in rng.randi_range(2, 5):
			var p: Vector3 = area + Vector3(rng.randf_range(-2, 2), 0, rng.randf_range(-2, 2))
			p.y = (ground_height(p.x, p.z) if area.y < 0.05 else area.y) + 0.006 + i * 0.001
			var mi := MeshInstance3D.new()
			mi.mesh = sheet
			mi.material_override = paper_mats[rng.randi() % paper_mats.size()]
			mi.transform = Transform3D(Basis.from_euler(Vector3(rng.randf_range(-0.05, 0.05), rng.randf() * TAU, rng.randf_range(-0.05, 0.05))), p)
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(mi)
		for i in 2:
			var p: Vector3 = area + Vector3(rng.randf_range(-2, 2), 0.04, rng.randf_range(-2, 2))
			geo.add_mesh(Geo.rock_mesh(0.05, rng.randi(), 0.9), Transform3D(Basis.IDENTITY, p), paper_mats[0])


var indoor_puddles: Array = []   # [material, size]: they fill and dry with the weather (weather.gd)


func _puddles() -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(1, 1)
	var spots := [[Vector3(-4, F1, -18.5), 2.6], [Vector3(6, F1, -11), 1.8], [Vector3(-13, 0.1, -12.5), 2.2],
			[Vector3(-5, F2, -10), 1.6], [Vector3(2, ROOF, -15), 3.0], [Vector3(-12.5, 3.3, -14), 1.5]]
	var i := 0
	for s in spots:
		var mi := MeshInstance3D.new()
		mi.mesh = plane
		var mat: ShaderMaterial = Mat.water().duplicate()
		mat.set_shader_parameter("seed", float(i) * 0.37)
		mat.set_shader_parameter("clarity", 0.75)
		mat.set_shader_parameter("fill", 0.8)
		indoor_puddles.append([mat, float(s[1])])
		mi.material_override = mat
		var size: float = s[1]
		mi.transform = Transform3D(Basis.from_euler(Vector3(0, rng.randf() * TAU, 0)).scaled(Vector3(size, 1, size * rng.randf_range(0.6, 1.0))),
				s[0] + Vector3(0, 0.004, 0))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		Game.water_spots.append([s[0] as Vector3, size * 0.4])
		i += 1


func _graffiti() -> void:
	# [position on wall surface, outward normal, width]
	var spots := [
		[Vector3(-8.5, 1.6, -7.99), Vector3(0, 0, 1), 2.6],
		[Vector3(6.5, 1.3, -7.99), Vector3(0, 0, 1), 2.0],
		[Vector3(0.1, 1.5, -12.5), Vector3(1, 0, 0), 2.2],
		[Vector3(-0.1, 1.4, -18.0), Vector3(-1, 0, 0), 2.0],
		[Vector3(10.01, 2.5, -9.5), Vector3(1, 0, 0), 2.4],
		[Vector3(-13, 1.4, -7.99), Vector3(0, 0, 1), 1.8],
		[Vector3(-4, 4.8, -7.99), Vector3(0, 0, 1), 2.2],
		[Vector3(0, 1.4, 7.36), Vector3(0, 0, 1), 3.0],
		[Vector3(-20, 1.2, 7.36), Vector3(0, 0, 1), 2.5],
		[Vector3(0, 2.5, -35.99), Vector3(0, 0, 1), 4.0],
		[Vector3(35.99, 2.0, 5), Vector3(-1, 0, 0), 4.0],
		[Vector3(-3, 4.8, -21.69), Vector3(0, 0, 1), 2.0],
	]
	var i := 0
	for s in spots:
		var d := Decal.new()
		d.texture_albedo = Tex.graffiti(40 + i)
		var nrm: Vector3 = s[1]
		var w: float = s[2]
		d.size = Vector3(w, 0.3, w * 0.5)
		var right := Vector3.UP.cross(nrm).normalized()
		d.basis = Basis(right, nrm, right.cross(nrm))
		d.position = s[0]
		d.albedo_mix = 0.9
		d.cull_mask = 1
		d.upper_fade = 0.0
		d.lower_fade = 0.0
		add_child(d)
		i += 1


# --- Green: grass in the cracks, moss on the walls ------------------------------------------

## Where nobody walks the green comes back: tufts of grass along the foot of
## the walls and the kerbs, patches of it in the broken ground, moss creeping
## up the damp bottoms of the walls and under the windows.
func _greenery() -> void:
	preload("res://scripts/world/greenery.gd").build(self, rng)


# --- Joins between meshes ---------------------------------------------------------

## Dirt over the places where two pieces of the level meet (brick annex against
## the concrete building, walls standing on floors), so the join reads as a
## weathered corner instead of a clean cut between two textures. Decals
## project across both meshes, so the same stain runs over the join.
func _seams() -> void:
	var i := 0
	# Annex against the building: the front, the back and the inside corners.
	_grime_decal("seam", Vector3(-10.0, 1.6, -7.99), Vector3(0, 0, 1), 1.3, 3.2, i); i += 1
	_grime_decal("seam", Vector3(-10.0, 1.6, -16.01), Vector3(0, 0, -1), 1.3, 3.2, i); i += 1
	_grime_decal("seam", Vector3(-10.0, 1.6, -8.3), Vector3(-1, 0, -1), 1.2, 3.2, i, 0.6); i += 1
	_grime_decal("seam", Vector3(-10.0, 1.6, -15.7), Vector3(-1, 0, 1), 1.2, 3.2, i, 0.6); i += 1
	# Annex roof slab meeting the building wall.
	for z in [-14.0, -10.0]:
		_grime_decal("base", Vector3(-10.0, 3.55, z), Vector3(-1, 1, 0), 4.2, 0.9, i, 0.8); i += 1
	# Base of the building and the annex where they stand on the sidewalk.
	var x := -16.0
	while x < 10.0:
		_grime_decal("base", Vector3(x + 2.0, 0.45, -7.99), Vector3(0, 0.6, 1), 4.3, 0.9, i, 0.7); i += 1
		x += 4.0
	# Inside, along the bottom of the walls on both storeys.
	for y in [F1, F2]:
		for seg in [[Vector3(0, 0, 1), -21.7, -9.7, 9.7, true], [Vector3(0, 0, -1), -8.3, -9.7, 9.7, true],
				[Vector3(1, 0, 0), -9.7, -21.7, -8.3, false], [Vector3(-1, 0, 0), 9.7, -21.7, -8.3, false]]:
			var nrm: Vector3 = seg[0]
			var a: float = seg[2]
			while a < seg[3] - 0.5:
				var l := minf(4.5, seg[3] - a)
				var along := a + l * 0.5
				var pos := Vector3(along, y + 0.3, seg[1]) if seg[4] else Vector3(seg[1], y + 0.3, along)
				_grime_decal("base", pos, nrm + Vector3.UP * 0.6, l + 0.3, 0.75, i, 0.75); i += 1
				a += l
	# Annex inside, and the ruined kiosk on the asphalt.
	for seg in [[Vector3(-13.0, 0.35, -8.31), Vector3(0, 0.6, -1), 5.6], [Vector3(-13.0, 0.35, -15.69), Vector3(0, 0.6, 1), 5.6],
			[Vector3(-15.69, 0.35, -12.0), Vector3(1, 0.6, 0), 7.2], [Vector3(18.0, 0.25, 13.86), Vector3(0, 0.6, -1), 4.2],
			[Vector3(18.0, 0.25, 18.13), Vector3(0, 0.6, 1), 4.2], [Vector3(15.86, 0.25, 16.0), Vector3(-1, 0.6, 0), 3.9]]:
		_grime_decal("base", seg[0], seg[1], seg[2], 0.7, i, 0.7); i += 1


## One grime decal on a surface at `pos` facing `nrm` (a tilted normal covers
## a wall and the floor or ceiling next to it), w wide and h tall.
## Dirt to clean (stain.gd): on the walls - inside the building, round the
## yard, in the alley - and on the floors.
func _stains() -> void:
	if OS.get_environment("NO_STAINS") != "":
		return
	var Stain = load("res://scripts/world/stain.gd")
	var space := get_world_3d().direct_space_state
	var placed := 0
	var tries := 0
	while placed < 26 and tries < 900:
		tries += 1
		var p := Vector3(rng.randf_range(-33.0, 33.0), rng.randf_range(0.6, 1.6), rng.randf_range(-33.0, 33.0))
		if rng.randf() < 0.45:
			p = Vector3(rng.randf_range(-9.5, 9.5), rng.randf_range(0.6, 1.6), rng.randf_range(-21.5, -8.5))   # in the building
		var a := rng.randf() * TAU
		var d := Vector3(cos(a), 0, sin(a))
		var q := PhysicsRayQueryParameters3D.create(p, p + d * 4.0, Game.LAYER_WORLD)
		var hit := space.intersect_ray(q)
		if hit.is_empty() or absf((hit.normal as Vector3).y) > 0.15:
			continue
		var n: Vector3 = hit.normal
		var gq := PhysicsRayQueryParameters3D.create((hit.position as Vector3) + n * 0.15, (hit.position as Vector3) + n * 0.15 + Vector3.DOWN * 3.0, Game.LAYER_WORLD)
		var gh := space.intersect_ray(gq)
		if gh.is_empty():
			continue
		var kind: String = Stain.KINDS_WALL[rng.randi() % Stain.KINDS_WALL.size()]
		var ext := Vector2(rng.randf_range(0.8, 1.6), rng.randf_range(0.7, 1.3))
		var foot: float = (gh.position as Vector3).y
		var y := foot + ext.y * 0.5 + (0.02 if kind == "mud" else rng.randf_range(0.1, 0.8))
		var at := Vector3((hit.position as Vector3).x, y, (hit.position as Vector3).z)
		Stain.make(self, at + n * 0.01, n, ext, kind, rng.randi())
		placed += 1
	placed = 0
	tries = 0
	while placed < 16 and tries < 600:
		tries += 1
		var p := Vector3(rng.randf_range(-30.0, 30.0), 8.0, rng.randf_range(-30.0, 30.0))
		if rng.randf() < 0.5:
			p = Vector3(rng.randf_range(-9.0, 9.0), 2.9, rng.randf_range(-21.0, -9.0))
		var q := PhysicsRayQueryParameters3D.create(p, p + Vector3.DOWN * 10.0, Game.LAYER_WORLD)
		var hit := space.intersect_ray(q)
		if hit.is_empty() or (hit.normal as Vector3).y < 0.9:
			continue
		var kind: String = Stain.KINDS_FLOOR[rng.randi() % Stain.KINDS_FLOOR.size()]
		var ext := Vector2(rng.randf_range(0.8, 1.6), rng.randf_range(0.8, 1.6))
		if kind == "prints":
			ext = Vector2(1.8, 0.7)
		Stain.make(self, (hit.position as Vector3) + Vector3.UP * 0.01, Vector3.UP, ext, kind, rng.randi())
		placed += 1


func _grime_decal(kind: String, pos: Vector3, nrm: Vector3, w: float, h: float, variant: int, strength := 0.85) -> void:
	var d := Decal.new()
	d.texture_albedo = Tex.grime(kind, variant % 4)
	var n := nrm.normalized()
	var right := Vector3.UP.cross(n)
	right = right.normalized() if right.length() > 0.01 else Vector3.RIGHT
	d.basis = Basis(right, n, right.cross(n))
	d.position = pos
	d.size = Vector3(w, 0.9, h)
	d.modulate = Color(1, 1, 1, strength)
	d.albedo_mix = 1.0
	d.normal_fade = 0.0
	d.upper_fade = 0.3
	d.lower_fade = 0.3
	d.cull_mask = 1
	add_child(d)


# --- Doors -------------------------------------------------------------------------

## Hinged wooden doors in the doorways (front door, the ground and first floor
## partitions, the first-floor door out to the stair landing).
## Bare bulbs on flexes in the abandoned building, and the switches by the
## ways in that work them (light_switch.gd).
func _lights() -> void:
	var LS = load("res://scripts/world/light_switch.gd")
	var c1 := F2 - 0.25               # ground floor ceiling
	var c2 := ROOF - 0.25             # first floor ceiling
	# By the front door: the west room of the ground floor (one bulb dying).
	LS.build(self, Vector3(-4.8, F1 + 1.35, -8.15 - T * 0.5 - 0.002), Vector3.BACK * -1.0,
			[Vector3(-6.8, c1, -10.3), Vector3(-3.0, c1, -18.5)], true)
	# The east room (where the table is), switch by the partition doorway.
	LS.build(self, Vector3(0.102, F1 + 1.35, -14.7), Vector3.RIGHT,
			[Vector3(7.0, c1, -11.0), Vector3(5.0, c1, -18.0)])
	# Upstairs, by the top of the stairs.
	LS.build(self, Vector3(8.0, F2 + 1.35, -21.85 + T * 0.5 + 0.002), Vector3.BACK,
			[Vector3(5.5, c2, -15.0), Vector3(-5.0, c2, -12.0)])


func _doors() -> void:
	var Door = load("res://scripts/world/door.gd")
	var gap := 0.03
	# [hinge-side jamb, direction across the opening, opening width, height]
	var doors := [
		[Vector3(-6.7, F1, -8.15), Vector3.RIGHT, 1.4, 2.3],
		[Vector3(0.0, F1, -16.2), Vector3.BACK, 1.2, 2.2],
		[Vector3(2.0, F2, -14.5), Vector3.BACK, 1.1, 2.2],
		[Vector3(9.85, F2, -16.2), Vector3.BACK, 1.2, 2.2],
	]
	for d in doors:
		var across: Vector3 = d[1]
		var jamb: Vector3 = d[0]
		Door.spawn(self, jamb + across * gap + Vector3.UP * 0.015, across, d[2] - gap * 2.0, d[3] - 0.04, geo._body)


# --- More of the place: warehouse, garages, wrecks, lamps, poles, fence -----------------

## A galvanised bucket, open at the top, water in it (for the mop): the
## water goes murky and red as bloody mops are rinsed in it.
func _bucket(p: Vector3) -> void:
	var zinc := Mat.standard("bucket_zinc", Color(0.58, 0.6, 0.62), 0.35, 0.75)
	var zinc2: StandardMaterial3D = zinc.duplicate()
	zinc2.cull_mode = BaseMaterial3D.CULL_DISABLED      # the inside of the wall shows
	var pail := MeshInstance3D.new()
	var body := CylinderMesh.new()
	body.top_radius = 0.16
	body.bottom_radius = 0.12
	body.height = 0.3
	body.radial_segments = 20
	body.cap_top = false
	pail.mesh = body
	pail.material_override = zinc2
	pail.position = p + Vector3(0, 0.15, 0)
	add_child(pail)
	# The rolled rim, two hoops pressed round it, the ears and the wire handle.
	var rim := MeshInstance3D.new()
	var rt := TorusMesh.new()
	rt.inner_radius = 0.155
	rt.outer_radius = 0.168
	rt.rings = 24
	rim.mesh = rt
	rim.material_override = zinc
	rim.position = p + Vector3(0, 0.3, 0)
	add_child(rim)
	for y in [0.08, 0.2]:
		var hoop := MeshInstance3D.new()
		var ht := TorusMesh.new()
		var r: float = 0.12 + 0.04 * float(y) / 0.3
		ht.inner_radius = r - 0.002
		ht.outer_radius = r + 0.006
		ht.rings = 24
		hoop.mesh = ht
		hoop.material_override = zinc
		hoop.position = p + Vector3(0, y, 0)
		add_child(hoop)
	# The wire handle: a half hoop from ear to ear, fallen over to one side.
	var tilt := Basis(Vector3.RIGHT, 1.0)
	for i in 10:
		var a0 := PI * i / 10.0
		var a1 := PI * (i + 1) / 10.0
		var p0 := tilt * (Vector3(cos(a0) * 0.165, sin(a0) * 0.165, 0))
		var p1 := tilt * (Vector3(cos(a1) * 0.165, sin(a1) * 0.165, 0))
		var seg := MeshInstance3D.new()
		var sc := CylinderMesh.new()
		sc.top_radius = 0.004
		sc.bottom_radius = 0.004
		sc.height = p0.distance_to(p1) + 0.002
		sc.radial_segments = 6
		seg.mesh = sc
		seg.material_override = zinc
		var y := (p1 - p0).normalized()
		var x := y.cross(Vector3.FORWARD if absf(y.z) < 0.9 else Vector3.RIGHT).normalized()
		seg.transform = Transform3D(Basis(x, y, x.cross(y)), p + Vector3(0, 0.29, 0) + (p0 + p1) * 0.5)
		add_child(seg)
	for sx in [-1.0, 1.0]:
		var ear := MeshInstance3D.new()
		var eb := BoxMesh.new()
		eb.size = Vector3(0.012, 0.03, 0.025)
		ear.mesh = eb
		ear.material_override = zinc
		ear.position = p + Vector3(0.163 * sx, 0.28, 0)
		add_child(ear)
	# The water: dark and still, a mirror on top.
	bucket_water = StandardMaterial3D.new()
	bucket_water.albedo_color = Color(0.1, 0.11, 0.11, 0.9)
	bucket_water.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bucket_water.roughness = 0.03
	bucket_water.metallic_specular = 1.0
	var surf := MeshInstance3D.new()
	var sm := CylinderMesh.new()
	sm.top_radius = 0.148
	sm.bottom_radius = 0.148
	sm.height = 0.004
	sm.radial_segments = 20
	surf.mesh = sm
	surf.material_override = bucket_water
	surf.position = p + Vector3(0, 0.235, 0)
	add_child(surf)
	geo.add_collision_box(Transform3D(Basis(), p + Vector3(0, 0.15, 0)), Vector3(0.28, 0.3, 0.28))
	bucket_pos = p
	# The mop stood by it, leant against the wall, until someone takes it.
	var ItemDrop = load("res://scripts/game/item_drop.gd")
	var lean := deg_to_rad(11.0)
	var up_dir := Vector3(0.0, cos(lean), sin(lean))          # towards the wall (+Z)
	var b := Basis(Vector3.RIGHT, Vector3(0.0, sin(lean), -cos(lean)), up_dir)
	var mop = ItemDrop.spawn(self, "mop", 1, Transform3D(b, Vector3(p.x + 0.55, p.y + 0.03, -8.3 - 0.3)), Vector3.ZERO)
	mop.freeze = true


## An old kitchen table left behind, and two chairs pulled up to it facing
## each other across it.
func _table_and_chairs(c: Vector3) -> void:
	var wood := Mat.wood("table", Color(0.3, 0.2, 0.12), 0.75)
	var dark := Mat.wood("chair", Color(0.22, 0.14, 0.08), 0.8)
	# Table: top, the apron under its edge, four legs.
	geo.box(c + Vector3(0, 0.74, 0), Vector3(1.1, 0.04, 0.75), wood)
	for sx in [-1.0, 1.0]:
		geo.box(c + Vector3(0.5 * sx, 0.66, 0), Vector3(0.03, 0.1, 0.62), wood, Vector3.ZERO, false)
		geo.box(c + Vector3(0, 0.66, 0.33 * sx), Vector3(0.94, 0.1, 0.03), wood, Vector3.ZERO, false)
		for sz in [-1.0, 1.0]:
			geo.box(c + Vector3(0.5 * sx, 0.36, 0.33 * sz), Vector3(0.05, 0.72, 0.05), wood, Vector3.ZERO, false)
	# Chairs either end, facing the table.
	var seats := []
	for sx in [-1.0, 1.0]:
		var ch := c + Vector3(0.9 * sx, 0, 0)
		# (seat and back solid: blood lands on them)
		geo.box(ch + Vector3(0, 0.45, 0), Vector3(0.42, 0.04, 0.42), dark)
		for lx in [-1.0, 1.0]:
			for lz in [-1.0, 1.0]:
				var h := 0.45 if lx != sx else 0.95        # the back legs go on up into the back
				geo.box(ch + Vector3(0.18 * lx, h * 0.5, 0.18 * lz), Vector3(0.035, h, 0.035), dark, Vector3.ZERO, false)
		# The back: a top rail and two slats.
		geo.box(ch + Vector3(0.18 * sx, 0.88, 0), Vector3(0.03, 0.08, 0.42), dark)
		for lz in [-0.07, 0.07]:
			geo.box(ch + Vector3(0.18 * sx, 0.67, lz), Vector3(0.02, 0.36, 0.05), dark)
		# Stretchers between the legs.
		geo.box(ch + Vector3(0, 0.16, 0.18), Vector3(0.36, 0.025, 0.02), dark, Vector3.ZERO, false)
		geo.box(ch + Vector3(0, 0.16, -0.18), Vector3(0.36, 0.025, 0.02), dark, Vector3.ZERO, false)
		seats.append(ch)
	roulette_table = {"center": c, "player": seats[0], "bot": seats[1], "seat_h": 0.47}


## The back alley behind the warehouse (where the trader keeps himself): in
## off the yard through a low archway between the warehouse's corner and the
## outer wall, a dark covered passage, then the strip along the back wall -
## and round the far corner, out of sight of the way in, a dead end.
func _alley() -> void:
	var brick := Mat.concrete("brick")
	var dark := Mat.concrete("dark")
	var y := _gy(34.5, -20.0)
	# The archway: a wall across from the warehouse to the outer wall with a
	# low opening, and a slab over the first few metres (the covered passage).
	geo.block(Vector3(33.0, y, -20.35), Vector3(34.2, y + 4.2, -20.05), brick)
	geo.block(Vector3(35.5, y, -20.35), Vector3(36.0, y + 4.2, -20.05), brick)
	geo.block(Vector3(34.2, y + 2.15, -20.35), Vector3(35.5, y + 4.2, -20.05), brick)
	geo.block(Vector3(33.0, y + 2.6, -24.5), Vector3(36.0, y + 2.85, -20.35), dark)
	# Along the passage: a drainpipe, junk against the wall.
	geo.block(Vector3(35.75, y, -23.0), Vector3(35.9, y + 4.0, -22.85), Mat.rust(), false)
	for z in [-26.5, -28.0]:
		geo.block(Vector3(35.0, y, z - 0.35), Vector3(35.9, y + rng.randf_range(0.5, 0.9), z + 0.35), dark)
	# The dead end: the strip behind the warehouse is walled off to the west.
	geo.block(Vector3(20.6, y, -36.0), Vector3(21.0, y + 3.2, -32.0), brick)
	# A tarpaulin roof over the far corner (it is darker still in there).
	geo.box(Vector3(31.5, y + 2.9, -34.0), Vector3(5.5, 0.04, 4.0), Mat.standard("tarp", Color(0.16, 0.2, 0.16), 0.9), Vector3(0.05, 0, 0.03), false)


func _extras() -> void:
	_warehouse(Vector3(21.0, 0.0, -32.0), Vector3(33.0, 0.0, -20.0))
	_alley()
	_garages(Vector3(-34.0, 0.0, -33.0), 4)
	_car(Vector3(-13.0, 0.0, 22.0), 0.4, 0)
	_car(Vector3(27.0, 0.0, 7.0), -1.2, 1)
	_car(Vector3(-27.0, 0.0, 1.5), 1.65, 2)
	for x in [-15.0, -3.0, 9.0, 21.0]:
		_street_lamp(Vector3(x, F1, -5.6), x == 9.0)
	_power_line([Vector3(-31.0, 0, -22.0), Vector3(-31.0, 0, -8.0), Vector3(-31.0, 0, 6.0), Vector3(-31.0, 0, 30.0)])
	_fence(Vector3(20.0, 0, -16.5), Vector3(34.0, 0, -16.5), [26.0, 29.0])
	_booth(Vector3(30.5, 0, -14.8))
	_dumpster(Vector3(-18.0, 0.0, -3.2), 0.2)
	_dumpster(Vector3(19.5, 0.0, -21.5), -0.1)
	for p in [Vector3(28.0, 0, 24.0), Vector3(-27.0, 0, -14.0), Vector3(4.0, 0, 30.0), Vector3(-6.0, 0, 29.0)]:
		_dead_tree(p)
	for p in [Vector3(22.5, 0, -18.5), Vector3(-21.0, 0, -24.0), Vector3(11.0, 0, 20.0)]:
		_tires(p)
	StreetEnv.build_static(self)


func _gy(x: float, z: float) -> float:
	return ground_height(x, z)


## Corrugated sheet-metal warehouse: big roll-up doorway, a side door, rusted
## holes, skylight gaps in the roof; racks with pallets and crates inside.
func _warehouse(a: Vector3, b: Vector3) -> void:
	var sheet := Mat.standard("sheet_metal", Color(0.36, 0.4, 0.42), 0.55, 0.55, 1.4)
	var rust := Mat.rust()
	var floor_m := Mat.concrete("floor")
	var y0 := maxf(_gy(a.x, a.z), _gy(b.x, b.z)) + 0.05
	var h := 4.6
	geo.block(Vector3(a.x, y0 - 0.3, a.z), Vector3(b.x, y0, b.z), floor_m)
	var w := b.x - a.x
	var d := b.z - a.z
	# South (front): roll-up door (half up), a side door; north: windows high up.
	geo.wall(Vector3(a.x, y0, b.z - 0.1), w, true, h, 0.12, sheet, [[3.0, 4.2, 0.0, 3.6], [9.0, 1.0, 0.0, 2.1]])
	geo.block(Vector3(a.x + 3.0, y0 + 2.6, b.z - 0.2), Vector3(a.x + 7.2, y0 + 3.6, b.z - 0.05), rust)   # the door, stuck half open
	geo.wall(Vector3(a.x, y0, a.z + 0.1), w, true, h, 0.12, sheet, [[2.0, 2.0, 3.0, 3.8], [6.0, 2.0, 3.0, 3.8], [10.0, 1.5, 0.6, 1.4]])
	geo.wall(Vector3(a.x + 0.1, y0, a.z), d, false, h, 0.12, sheet, [[4.0, 1.2, 0.0, 1.0]])   # rusted-through gap at the bottom
	geo.wall(Vector3(b.x - 0.1, y0, a.z), d, false, h, 0.12, sheet, [[7.0, 1.4, 1.2, 2.4]])
	# Roof sheets with gaps where panels are missing, on steel trusses.
	var gaps := [Rect2(a.x + 3.0, a.z + 3.0, 2.0, 1.5), Rect2(a.x + 8.0, a.z + 7.0, 1.5, 2.5)]
	geo.slab(Vector2(a.x, a.z), Vector2(b.x, b.z), y0 + h, y0 + h + 0.08, sheet, gaps)
	var steel := Mat.standard("steel_beam", Color(0.25, 0.24, 0.23), 0.5, 0.7, 0.4)
	var x := a.x + 2.0
	while x < b.x - 1.0:
		geo.box(Vector3(x, y0 + h - 0.2, (a.z + b.z) * 0.5), Vector3(0.12, 0.3, d - 0.3), steel, Vector3.ZERO, false)
		x += 3.0
	# Racks: posts, three shelves, some pallets and crates on them.
	var wood := Mat.standard("pallet_wood", Color(0.5, 0.38, 0.24), 0.9, 0.0, 0.8)
	var crate := Mat.standard("crate_wood", Color(0.42, 0.32, 0.2), 0.85, 0.0, 1.0)
	for r in 3:
		var rz := a.z + 2.5 + r * 3.0
		for px in [a.x + 5.5, a.x + 9.5]:
			geo.block(Vector3(px - 0.06, y0, rz - 0.5), Vector3(px + 0.06, y0 + 3.0, rz - 0.38), steel)
			geo.block(Vector3(px - 0.06, y0, rz + 0.38), Vector3(px + 0.06, y0 + 3.0, rz + 0.5), steel)
		for sy in [0.9, 1.9, 2.9]:
			geo.block(Vector3(a.x + 5.4, y0 + sy, rz - 0.5), Vector3(a.x + 9.6, y0 + sy + 0.06, rz + 0.5), steel)
			if rng.randf() < 0.7:
				var cx := a.x + 5.8 + rng.randf() * 3.0
				geo.block(Vector3(cx, y0 + sy + 0.06, rz - 0.4), Vector3(cx + 0.8, y0 + sy + 0.06 + rng.randf_range(0.3, 0.7), rz + 0.4), crate)
	# Pallets on the floor, some stacked.
	for i in 6:
		var p := Vector3(rng.randf_range(a.x + 1.0, a.x + 4.0), y0, rng.randf_range(a.z + 1.0, b.z - 2.0))
		var n := rng.randi_range(1, 4)
		for k in n:
			_pallet(p + Vector3(0, k * 0.14, 0), rng.randf() * 0.3, wood)
	_warehouse_stock(a, b, y0, steel, wood)


## What is kept in the warehouse: military crates of ammunition and grenades
## stencilled in yellow, sacks of powder, gas bottles, drums, a workbench with
## a vice and tools under a hanging lamp - and, lying about on the shelves
## and the bench, things to make things with (pickable, F).
func _warehouse_stock(a: Vector3, b: Vector3, y0: float, steel: Material, wood: Material) -> void:
	var olive := Mat.standard("mil_olive", Color(0.24, 0.27, 0.16), 0.8)
	var stencil := Mat.standard("mil_stencil", Color(0.8, 0.7, 0.2), 0.8)
	var sack := Mat.standard("sack", Color(0.55, 0.47, 0.32), 0.95)
	var red := Mat.standard("gas_red", Color(0.55, 0.1, 0.08), 0.5, 0.4)
	var tarp := Mat.standard("tarp", Color(0.16, 0.24, 0.3), 0.9)
	# Ammunition crates, stacked against the east wall, one open.
	var cz := a.z + 2.0
	for i in 5:
		for k in (3 if i % 2 == 0 else 2):
			var c := Vector3(b.x - 0.6, y0 + 0.2 + k * 0.4, cz + i * 0.75)
			geo.box(c, Vector3(0.9, 0.38, 0.55), olive)
			geo.box(c + Vector3(-0.451, 0.0, 0.0), Vector3(0.005, 0.12, 0.35), stencil, Vector3.ZERO, false)
			for h in [-0.3, 0.3]:
				geo.box(c + Vector3(h, 0.2, 0), Vector3(0.05, 0.03, 0.2), steel, Vector3.ZERO, false)
	# The open crate on the floor: rounds in clips, a lid leant against it.
	var oc := Vector3(b.x - 2.0, y0, cz + 1.0)
	geo.box(oc + Vector3(0, 0.15, 0), Vector3(0.8, 0.3, 0.5), olive)
	for i in 6:
		geo.box(oc + Vector3(-0.3 + i * 0.12, 0.31, 0), Vector3(0.08, 0.03, 0.4), Mat.standard("brass_rows", Color(0.72, 0.56, 0.24), 0.35, 0.9), Vector3.ZERO, false)
	geo.box(oc + Vector3(0.0, 0.3, -0.35), Vector3(0.82, 0.55, 0.03), olive, Vector3(0.35, 0, 0), false)
	# A grenade crate, the grenades in it for the taking.
	var gc := Vector3(b.x - 2.2, y0, cz + 3.4)
	geo.box(gc + Vector3(0, 0.14, 0), Vector3(0.6, 0.28, 0.4), olive)
	geo.box(gc + Vector3(-0.301, 0.14, 0), Vector3(0.005, 0.1, 0.25), stencil, Vector3.ZERO, false)
	# Powder sacks, gas bottles, drums under a tarp.
	for i in 4:
		var sp := Vector3(a.x + 1.2 + (i % 2) * 0.55, y0 + 0.16 + (i / 2) * 0.28, b.z - 2.6)
		geo.box(sp, Vector3(0.5, 0.26, 0.7), sack, Vector3(0, 0.1 * i, 0), i < 2)
	for i in 3:
		var gp := Vector3(a.x + 3.2 + i * 0.35, y0, b.z - 1.4)
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.13
		cyl.bottom_radius = 0.14
		cyl.height = 1.3
		cyl.radial_segments = 12
		geo.add_mesh(cyl, Transform3D(Basis(), gp + Vector3(0, 0.65, 0)), red)
		geo.add_collision_box(Transform3D(Basis(), gp + Vector3(0, 0.65, 0)), Vector3(0.26, 1.3, 0.26))
	geo.box(Vector3(a.x + 6.8, y0 + 0.55, b.z - 1.6), Vector3(1.6, 1.1, 1.0), tarp, Vector3(0.0, 0.2, 0.05))
	# The workbench: top, legs, a vice, tools hung on a board behind it.
	var wb := Vector3(a.x + 9.6, y0, b.z - 1.0)
	geo.box(wb + Vector3(0, 0.9, 0), Vector3(2.0, 0.06, 0.7), wood)
	for sx in [-0.9, 0.9]:
		for sz in [-0.28, 0.28]:
			geo.box(wb + Vector3(sx, 0.44, sz), Vector3(0.07, 0.88, 0.07), wood, Vector3.ZERO, false)
	geo.box(wb + Vector3(0, 0.3, 0), Vector3(1.8, 0.03, 0.6), wood, Vector3.ZERO, false)
	geo.box(wb + Vector3(0.75, 1.0, -0.2), Vector3(0.2, 0.14, 0.14), steel, Vector3.ZERO, false)
	geo.box(Vector3(wb.x, y0 + 1.6, b.z - 0.18), Vector3(1.8, 0.9, 0.03), wood, Vector3.ZERO, false)
	for i in 6:
		geo.box(Vector3(wb.x - 0.7 + i * 0.28, y0 + 1.55, b.z - 0.21), Vector3(0.03, 0.3 + (i % 3) * 0.08, 0.02), steel, Vector3(0, 0, 0.2 * (i - 3)), false)
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(1.0, 0.8, 0.55)
	lamp.light_energy = 1.2
	lamp.omni_range = 5.0
	lamp.shadow_enabled = true
	lamp.position = wb + Vector3(0, 2.1, 0)
	add_child(lamp)
	geo.box(wb + Vector3(0, 2.2, 0), Vector3(0.3, 0.12, 0.3), steel, Vector3.ZERO, false)
	# What can be picked up here.
	var ItemDrop = load("res://scripts/game/item_drop.gd")
	var loose := [["powder", wb + Vector3(-0.6, 1.05, 0.1)], ["nails", wb + Vector3(-0.2, 1.0, 0.05)], ["tin_can", wb + Vector3(0.2, 1.0, 0.1)],
			["fuse_cord", wb + Vector3(0.45, 1.0, -0.05)], ["wires", wb + Vector3(-0.9, 1.0, -0.1)], ["tape", wb + Vector3(0.8, 1.0, 0.15)],
			["pipe", Vector3(a.x + 7.4, y0 + 1.05, a.z + 2.5)], ["clock", Vector3(a.x + 6.2, y0 + 2.05, a.z + 5.5)],
			["powder", Vector3(a.x + 1.2, y0 + 0.75, b.z - 2.6)], ["grenade", gc + Vector3(-0.12, 0.34, 0)], ["grenade", gc + Vector3(0.12, 0.34, 0)],
			["wires", Vector3(a.x + 8.4, y0 + 1.05, a.z + 8.5)], ["nails", Vector3(a.x + 6.0, y0 + 1.05, a.z + 8.5)]]
	for it in loose:
		var wires_n := 5 if it[0] == "wires" else 1
		ItemDrop.spawn(self, it[0], wires_n, Transform3D(Basis(Vector3.UP, rng.randf() * TAU), it[1]), Vector3.ZERO)


func _pallet(p: Vector3, yaw: float, wood: Material) -> void:
	var b := Basis(Vector3.UP, yaw)
	for i in 5:
		geo.box(p + b * Vector3(-0.5 + i * 0.25, 0.13, 0), Vector3(0.1, 0.022, 1.2), wood, Vector3(0, yaw, 0), false)
	for i in 3:
		geo.box(p + b * Vector3(0, 0.06, -0.55 + i * 0.55), Vector3(1.2, 0.1, 0.1), wood, Vector3(0, yaw, 0), i == 1)


## Row of lock-up garages with steel doors: shut, one hanging open, one gone.
func _garages(corner: Vector3, count: int) -> void:
	var brick := Mat.concrete("brick")
	var roof := Mat.concrete("dark")
	var door := Mat.standard("garage_door", Color(0.3, 0.35, 0.3), 0.6, 0.5, 1.2)
	var y0 := _gy(corner.x, corner.z)
	var gw := 3.0
	var gd := 6.0
	var gh := 2.6
	for i in count:
		var x := corner.x + i * gw
		# Back and side walls, front with a door opening.
		geo.block(Vector3(x, y0, corner.z), Vector3(x + gw, y0 + gh, corner.z + 0.2), brick)
		geo.block(Vector3(x, y0, corner.z), Vector3(x + 0.2, y0 + gh, corner.z + gd), brick)
		geo.block(Vector3(x, y0 + 2.2, corner.z + gd - 0.2), Vector3(x + gw, y0 + gh, corner.z + gd), brick)
		geo.block(Vector3(x, y0 + gh, corner.z), Vector3(x + gw + 0.1, y0 + gh + 0.15, corner.z + gd + 0.3), roof)
		match i % 4:
			0, 2:
				geo.block(Vector3(x + 0.25, y0, corner.z + gd - 0.12), Vector3(x + gw - 0.05, y0 + 2.2, corner.z + gd - 0.06), door)
			1:
				# Swung up and stuck.
				geo.box(Vector3(x + gw * 0.5, y0 + 2.15, corner.z + gd + 0.5), Vector3(gw - 0.3, 0.05, 1.1), door, Vector3(0.15, 0, 0), false)
			_:
				pass   # door gone
	geo.block(Vector3(corner.x + count * gw, y0, corner.z), Vector3(corner.x + count * gw + 0.2, y0 + gh, corner.z + gd), brick)


## An abandoned car, stripped and rusting: the body (sills, wings, bonnet,
## boot, the cabin on its pillars), glass set in its frames (some panes
## smashed out), bumpers, lamps, plates, seats seen inside, wheels on rims.
## Variant 0 has a flat front tyre and sits a touch low on that corner.
func _car(p: Vector3, yaw: float, variant: int) -> void:
	var paint := Mat.standard("car_%d" % variant, [Color(0.35, 0.12, 0.08), Color(0.2, 0.24, 0.26), Color(0.3, 0.28, 0.2)][variant % 3], 0.7, 0.35, 1.2)
	var dark := Mat.standard("car_dark", Color(0.05, 0.05, 0.05), 0.9)
	var chrome := Mat.standard("car_chrome", Color(0.55, 0.56, 0.56), 0.35, 0.8)
	var rust := Mat.rust()
	var glass := Mat.glass(Color(0.2, 0.25, 0.25))
	var lamp := Mat.standard("car_lamp", Color(0.8, 0.8, 0.72), 0.2, 0.2)
	var tail := Mat.standard("car_tail", Color(0.55, 0.05, 0.04), 0.3)
	var seat := Mat.standard("car_seat", Color(0.12, 0.1, 0.09), 0.95)
	var plate := Mat.standard("car_plate", Color(0.85, 0.85, 0.8), 0.6)
	var y0 := _gy(p.x, p.z)
	# Local frame: +Z the front, +X the right side. The missing wheel is the
	# front left one: the car leans down onto that corner.
	var sag := Basis()
	var ride := 0.0
	if variant == 0:
		# (just a little down on the flat front-left tyre: all four still on the ground)
		sag = Basis(Vector3.BACK, -0.025) * Basis(Vector3.RIGHT, 0.012)
		ride = -0.015
	var b := Basis(Vector3.UP, yaw) * sag
	var base := Vector3(p.x, y0 + ride, p.z)
	var put := func(pos: Vector3, size: Vector3, mat: Material, rot := Vector3.ZERO, collide := false) -> void:
		var lb := Basis.from_euler(rot)
		geo.box(base + b * pos, size, mat, (b * lb).get_euler(), collide)
	# Body: the lower tub, sills, the wings and the bonnet and boot lids.
	put.call(Vector3(0, 0.55, 0), Vector3(1.72, 0.46, 4.1), paint, Vector3.ZERO, true)
	put.call(Vector3(0, 0.79, 1.35), Vector3(1.66, 0.04, 1.3), paint, Vector3(-0.05, 0, 0))     # bonnet
	put.call(Vector3(0, 0.8, -1.55), Vector3(1.66, 0.04, 0.85), paint, Vector3(0.04, 0, 0))    # boot lid
	for sx in [-1.0, 1.0]:
		put.call(Vector3(0.87 * sx, 0.36, 0), Vector3(0.04, 0.12, 2.3), dark)                  # sill
		# Wheel arches: dark, cut into the body at each wheel.
		for wz in [-1.3, 1.3]:
			put.call(Vector3(0.861 * sx, 0.45, wz), Vector3(0.02, 0.42, 0.78), dark)
		# Door lines and handles.
		for dz in [0.62, -0.42]:
			put.call(Vector3(0.861 * sx, 0.6, dz), Vector3(0.01, 0.4, 0.01), dark)
			put.call(Vector3(0.866 * sx, 0.68, dz - 0.3), Vector3(0.02, 0.025, 0.12), chrome)
		# Rust eating along the bottom of the doors.
		put.call(Vector3(0.862 * sx, 0.42, 0.1), Vector3(0.01, 0.1, 1.6), rust)
	# The cabin: roof on four pillars, glass in the openings.
	put.call(Vector3(0, 1.3, -0.1), Vector3(1.46, 0.05, 1.5), paint, Vector3.ZERO, true)
	for sx in [-1.0, 1.0]:
		put.call(Vector3(0.7 * sx, 1.05, 0.88), Vector3(0.06, 0.68, 0.06), paint, Vector3(-0.73, 0, 0))   # A pillar
		put.call(Vector3(0.7 * sx, 1.05, -0.08), Vector3(0.06, 0.5, 0.07), paint)                        # B pillar
		put.call(Vector3(0.7 * sx, 1.06, -1.0), Vector3(0.06, 0.58, 0.06), paint, Vector3(0.56, 0, 0))    # C pillar
		# Side windows, flush in the frame; one of them smashed out.
		if not (variant == 1 and sx > 0):
			put.call(Vector3(0.705 * sx, 1.05, 0.38), Vector3(0.01, 0.42, 0.78), glass)
		put.call(Vector3(0.705 * sx, 1.05, -0.52), Vector3(0.01, 0.42, 0.72), glass)
		put.call(Vector3(0.72 * sx, 1.05, 1.02), Vector3(0.14, 0.08, 0.04), paint)                        # mirror
	# Windscreen and rear window, lying back along their pillars.
	put.call(Vector3(0, 1.05, 0.88), Vector3(1.38, 0.66, 0.012), glass, Vector3(-0.73, 0, 0))
	if variant != 2:
		put.call(Vector3(0, 1.06, -1.0), Vector3(1.38, 0.56, 0.012), glass, Vector3(0.56, 0, 0))
	# Inside: seats and the dashboard, dark through the glass.
	for sx in [-0.36, 0.36]:
		put.call(Vector3(sx, 0.85, 0.15), Vector3(0.5, 0.12, 0.5), seat)
		put.call(Vector3(sx, 1.08, -0.1), Vector3(0.5, 0.5, 0.1), seat, Vector3(-0.2, 0, 0))
	put.call(Vector3(0, 0.85, -0.7), Vector3(1.35, 0.14, 0.5), seat)
	put.call(Vector3(0, 0.93, 0.62), Vector3(1.4, 0.16, 0.25), dark)
	# Bumpers, lamps, grille, plates.
	put.call(Vector3(0, 0.38, 2.08), Vector3(1.78, 0.14, 0.12), chrome)
	put.call(Vector3(0, 0.38, -2.08), Vector3(1.78, 0.14, 0.12), chrome)
	put.call(Vector3(0, 0.62, 2.056), Vector3(0.8, 0.14, 0.02), dark)
	for sx in [-1.0, 1.0]:
		put.call(Vector3(0.62 * sx, 0.64, 2.056), Vector3(0.28, 0.14, 0.02), lamp if not (variant == 0 and sx < 0) else dark)
		put.call(Vector3(0.66 * sx, 0.66, -2.056), Vector3(0.24, 0.12, 0.02), tail)
	put.call(Vector3(0, 0.46, 2.15), Vector3(0.52, 0.12, 0.01), plate)
	put.call(Vector3(0, 0.56, -2.056), Vector3(0.52, 0.12, 0.01), plate)
	# Wheels: tyre, rim, hub. The missing one leaves the hub on the ground.
	var tyre := CylinderMesh.new()
	tyre.top_radius = 0.32
	tyre.bottom_radius = 0.32
	tyre.height = 0.21
	tyre.radial_segments = 18
	var rim := CylinderMesh.new()
	rim.top_radius = 0.19
	rim.bottom_radius = 0.19
	rim.height = 0.215
	rim.radial_segments = 12
	for wz in [-1.3, 1.3]:
		for wx in [-0.8, 0.8]:
			var wl := Vector3(wx, 0.32, wz)
			var turn := Basis(Vector3.BACK, PI * 0.5)
			if variant == 0 and wz > 0 and wx < 0:
				# The flat one: the tyre squashed out under the rim, the rim low.
				var flat_at := base + b * Vector3(wx, 0.27, wz)
				flat_at.y = maxf(flat_at.y, y0 + 0.27)
				geo.add_mesh(tyre, Transform3D(b * turn * Basis.from_scale(Vector3(0.84, 1.08, 1.0)), flat_at), dark)
				geo.add_mesh(rim, Transform3D(b * turn, flat_at + b * Vector3(0.004 * signf(wx), 0.02, 0)), chrome)
				continue
			geo.add_mesh(tyre, Transform3D(b * turn, base + b * wl), dark)
			geo.add_mesh(rim, Transform3D(b * turn, base + b * (wl + Vector3(0.004 * signf(wx), 0, 0))), chrome)
	# Glass on the ground where a window went.
	if variant == 1:
		for k in 8:
			var sh := BoxMesh.new()
			sh.size = Vector3(rng.randf_range(0.02, 0.06), 0.004, rng.randf_range(0.02, 0.06))
			var gp := base + b * Vector3(1.1 + rng.randf() * 0.5, 0.0, 0.3 + rng.randf_range(-0.4, 0.4))
			gp.y = _gy(gp.x, gp.z) + 0.004
			geo.add_mesh(sh, Transform3D(Basis(Vector3.UP, rng.randf() * TAU), gp), glass)


func _street_lamp(p: Vector3, bent: bool) -> void:
	var steel := Mat.standard("lamp_steel", Color(0.28, 0.29, 0.3), 0.5, 0.6, 0.4)
	var pole := CylinderMesh.new()
	pole.top_radius = 0.06
	pole.bottom_radius = 0.09
	pole.height = 6.0
	pole.radial_segments = 10
	var lean := 0.12 if bent else 0.0
	var xf := Transform3D(Basis(Vector3.RIGHT, lean), p + Vector3(0, 3.0, sin(lean) * 3.0))
	geo.add_mesh(pole, xf, steel)
	geo.add_collision_box(Transform3D(Basis(), p + Vector3(0, 1.5, 0)), Vector3(0.2, 3.0, 0.2))
	var top := xf * Vector3(0, 3.0, 0)
	geo.box(top + Vector3(0, -0.05, -0.6), Vector3(0.08, 0.08, 1.2), steel, Vector3.ZERO, false)
	geo.box(top + Vector3(0, -0.15, -1.15), Vector3(0.35, 0.12, 0.55), steel, Vector3.ZERO, false)
	# Its light, for the night (day_night.gd switches it on).
	if Game.main and Game.main.get("day_night"):
		Game.main.day_night.add_lamp(top + Vector3(0, -0.15, -1.15), bent, self)


## Wooden power poles with cross-arms and sagging wires between them.
func _power_line(points: Array) -> void:
	var wood := Mat.standard("pole_wood", Color(0.28, 0.22, 0.16), 0.9, 0.0, 0.8)
	var wire := Mat.standard("wire", Color(0.04, 0.04, 0.04), 0.6)
	var tops := []
	for p0 in points:
		var p: Vector3 = p0
		p.y = _gy(p.x, p.z)
		var pole := CylinderMesh.new()
		pole.top_radius = 0.11
		pole.bottom_radius = 0.14
		pole.height = 8.0
		pole.radial_segments = 8
		geo.add_mesh(pole, Transform3D(Basis(), p + Vector3(0, 4.0, 0)), wood)
		geo.add_collision_box(Transform3D(Basis(), p + Vector3(0, 2.0, 0)), Vector3(0.28, 4.0, 0.28))
		geo.box(p + Vector3(0, 7.6, 0), Vector3(1.6, 0.12, 0.12), wood, Vector3.ZERO, false)
		tops.append(p + Vector3(0, 7.66, 0))
	var seg := CylinderMesh.new()
	seg.top_radius = 0.012
	seg.bottom_radius = 0.012
	seg.height = 1.0
	seg.radial_segments = 4
	for i in tops.size() - 1:
		for off in [-0.7, 0.0, 0.7]:
			var a: Vector3 = tops[i] + Vector3(off, 0, 0)
			var b: Vector3 = tops[i + 1] + Vector3(off, 0, 0)
			# Catenary-ish sag in eight straight pieces.
			var prev := a
			for k in range(1, 9):
				var t := k / 8.0
				var q := a.lerp(b, t) + Vector3.DOWN * 1.1 * 4.0 * t * (1.0 - t)
				var d := q - prev
				var y := d.normalized()
				var x := y.cross(Vector3.UP if absf(y.y) < 0.9 else Vector3.RIGHT).normalized()
				geo.add_mesh(seg, Transform3D(Basis(x, y * d.length(), x.cross(y)), (prev + q) * 0.5), wire)
				prev = q


## Chain-link fence (see-through mesh on steel posts) with a gap for a gate.
func _fence(a: Vector3, b: Vector3, gate: Array) -> void:
	var steel := Mat.standard("fence_steel", Color(0.4, 0.41, 0.42), 0.5, 0.7)
	var mesh_mat := _chain_link()
	var y := _gy(a.x, a.z)
	var x := a.x
	while x < b.x - 0.1:
		var nx := minf(x + 2.5, b.x)
		var inside_gate: bool = x >= float(gate[0]) - 0.1 and nx <= float(gate[1]) + 0.1
		geo.box(Vector3(x, y + 1.0, a.z), Vector3(0.06, 2.0, 0.06), steel)
		if not inside_gate:
			geo.box(Vector3((x + nx) * 0.5, y + 1.0, a.z), Vector3(nx - x, 1.9, 0.01), mesh_mat)
			geo.box(Vector3((x + nx) * 0.5, y + 1.98, a.z), Vector3(nx - x, 0.04, 0.04), steel, Vector3.ZERO, false)
		x = nx
	geo.box(Vector3(b.x, y + 1.0, a.z), Vector3(0.06, 2.0, 0.06), steel)


func _chain_link() -> StandardMaterial3D:
	var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
	for py in 32:
		for px in 32:
			var d1 := absf(((px + py) % 16) - 8.0)
			var d2 := absf(((px - py + 32) % 16) - 8.0)
			var on := d1 > 6.8 or d2 > 6.8
			img.set_pixel(px, py, Color(0.45, 0.46, 0.47, 1.0 if on else 0.0))
	img.generate_mipmaps()
	var m := StandardMaterial3D.new()
	m.albedo_texture = ImageTexture.create_from_image(img)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	m.alpha_scissor_threshold = 0.5
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.metallic = 0.6
	m.roughness = 0.5
	m.uv1_triplanar = true
	m.uv1_world_triplanar = true
	m.uv1_scale = Vector3.ONE * 8.0
	return m


func _booth(p: Vector3) -> void:
	var wall := Mat.concrete("wall")
	var y := _gy(p.x, p.z)
	var base := Vector3(p.x, y, p.z)
	geo.wall(base + Vector3(-1.0, 0, -1.0), 2.0, true, 2.4, 0.12, wall, [[0.4, 1.2, 1.0, 1.9]])
	geo.wall(base + Vector3(-1.0, 0, 1.0), 2.0, true, 2.4, 0.12, wall, [[0.5, 0.8, 0.0, 2.0]])
	geo.wall(base + Vector3(-1.0, 0, -1.0), 2.0, false, 2.4, 0.12, wall, [[0.5, 1.0, 1.0, 1.9]])
	geo.wall(base + Vector3(1.0, 0, -1.0), 2.0, false, 2.4, 0.12, wall, [])
	geo.block(base + Vector3(-1.15, 2.4, -1.15), base + Vector3(1.15, 2.55, 1.15), Mat.concrete("dark"))


func _dumpster(p: Vector3, yaw: float) -> void:
	var green := Mat.standard("dumpster", Color(0.16, 0.26, 0.18), 0.7, 0.4, 1.2)
	var y := _gy(p.x, p.z)
	# Hollow: a floor and four walls of steel, dark and grimy inside, the
	# lid flung back over the rear edge.
	var inside := Mat.standard("dumpster_in", Color(0.07, 0.08, 0.07), 0.9, 0.3)
	var b := Basis(Vector3.UP, yaw)
	var o := Vector3(p.x, y, p.z)
	const T := 0.05
	geo.box(o + b * Vector3(0, 0.12, 0), Vector3(1.9, T, 1.1), inside, Vector3(0, yaw, 0))
	geo.box(o + b * Vector3(0, 0.62, 0.55 - T * 0.5), Vector3(1.9, 1.0, T), green, Vector3(0, yaw, 0))
	geo.box(o + b * Vector3(0, 0.62, -0.55 + T * 0.5), Vector3(1.9, 1.0, T), green, Vector3(0, yaw, 0))
	geo.box(o + b * Vector3(0.95 - T * 0.5, 0.62, 0), Vector3(T, 1.0, 1.1 - 2 * T), green, Vector3(0, yaw, 0))
	geo.box(o + b * Vector3(-0.95 + T * 0.5, 0.62, 0), Vector3(T, 1.0, 1.1 - 2 * T), green, Vector3(0, yaw, 0))
	# The inner faces, dark (a thin skin just inside each wall).
	geo.box(o + b * Vector3(0, 0.62, 0.55 - T - 0.004), Vector3(1.85, 0.98, 0.006), inside, Vector3(0, yaw, 0), false)
	geo.box(o + b * Vector3(0, 0.62, -0.55 + T + 0.004), Vector3(1.85, 0.98, 0.006), inside, Vector3(0, yaw, 0), false)
	# Wheels, and the lid thrown back.
	var dark := Mat.standard("rubber", Color(0.05, 0.05, 0.05), 0.9)
	for dx in [-0.75, 0.75]:
		for dz in [-0.4, 0.4]:
			geo.box(o + b * Vector3(dx, 0.05, dz), Vector3(0.1, 0.1, 0.1), dark, Vector3(0, yaw, 0), false)
	geo.box(o + b * Vector3(0, 1.4, 0.72), Vector3(1.9, 0.04, 0.9), green, Vector3(-1.2, yaw, 0), false)


func _dead_tree(p: Vector3) -> void:
	var bark := Mat.standard("bark", Color(0.2, 0.17, 0.14), 0.95, 0.0, 1.5)
	var y := _gy(p.x, p.z)
	var trunk := CylinderMesh.new()
	trunk.top_radius = 0.1
	trunk.bottom_radius = 0.2
	trunk.height = 4.5
	trunk.radial_segments = 8
	geo.add_mesh(trunk, Transform3D(Basis(), Vector3(p.x, y + 2.25, p.z)), bark)
	geo.add_collision_box(Transform3D(Basis(), Vector3(p.x, y + 1.5, p.z)), Vector3(0.35, 3.0, 0.35))
	for i in 5:
		var br := CylinderMesh.new()
		br.top_radius = 0.02
		br.bottom_radius = 0.06
		br.height = rng.randf_range(1.0, 2.0)
		br.radial_segments = 6
		var hgt := rng.randf_range(2.0, 4.2)
		var yaw := rng.randf() * TAU
		var tilt := rng.randf_range(0.6, 1.1)
		var bb := Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, tilt)
		geo.add_mesh(br, Transform3D(bb, Vector3(p.x, y + hgt, p.z) + bb * Vector3(0, br.height * 0.5, 0)), bark)


func _tires(p: Vector3) -> void:
	var rubber := Mat.standard("rubber", Color(0.05, 0.05, 0.05), 0.9)
	var tire := TorusMesh.new()
	tire.inner_radius = 0.2
	tire.outer_radius = 0.34
	tire.rings = 16
	tire.ring_segments = 8
	var y := _gy(p.x, p.z)
	for i in rng.randi_range(3, 6):
		var off := Vector3(rng.randf_range(-0.2, 0.2), 0.08 + i * 0.16, rng.randf_range(-0.2, 0.2)) if i < 4 else Vector3(rng.randf_range(-1.2, 1.2), 0.3, rng.randf_range(-1.2, 1.2))
		var rot := Basis() if i < 4 else Basis(Vector3.RIGHT, PI * 0.5)
		geo.add_mesh(tire, Transform3D(rot, Vector3(p.x, y, p.z) + off), rubber)
	geo.add_collision_box(Transform3D(Basis(), Vector3(p.x, y + 0.35, p.z)), Vector3(0.7, 0.7, 0.7))
