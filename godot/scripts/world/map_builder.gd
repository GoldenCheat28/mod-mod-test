extends Node3D
## Builds the whole level procedurally: an uneven asphalt street, an
## abandoned two-storey concrete building with a collapsed wall, an annex,
## a loading dock with stairs, and scattered props/debris.
##
## Static geometry goes under the NavigationRegion3D so it can be baked.

const Geo = preload("res://scripts/world/geo.gd")
const Mat = preload("res://scripts/world/materials.gd")
const Tex = preload("res://scripts/world/textures.gd")

const GROUND_HALF := 60
const T := 0.3            # wall thickness
const F1 := 0.15          # ground floor level
const F2 := 3.4           # first floor level
const ROOF := 6.65        # roof level

var nav_region: NavigationRegion3D
var geo: Geo
var rng := RandomNumberGenerator.new()
var _h1 := FastNoiseLite.new()
var _h2 := FastNoiseLite.new()


func build() -> void:
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
	_ground()
	_building()
	_annex()
	_dock()
	_street()
	_perimeter()
	_rubble()
	geo.commit()

	_barrels()
	_bottles_and_trash()
	_puddles()
	_graffiti()


func bake_navigation() -> void:
	nav_region.bake_navigation_mesh(false)


func ground_height(x: float, z: float) -> float:
	return _h1.get_noise_2d(x, z) * 0.035 + _h2.get_noise_2d(x, z) * 0.008


# --- Ground -----------------------------------------------------------------

func _ground() -> void:
	# Visual mesh at 0.5 m resolution.
	var res := 0.5
	var count := int(GROUND_HALF * 2 / res) + 1
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	verts.resize(count * count)
	normals.resize(count * count)
	uvs.resize(count * count)
	for zi in count:
		for xi in count:
			var x := -GROUND_HALF + xi * res
			var z := -GROUND_HALF + zi * res
			var i := zi * count + xi
			verts[i] = Vector3(x, ground_height(x, z), z)
			var dx := ground_height(x + 0.1, z) - ground_height(x - 0.1, z)
			var dz := ground_height(x, z + 0.1) - ground_height(x, z - 0.1)
			normals[i] = Vector3(-dx / 0.2, 1.0, -dz / 0.2).normalized()
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
			along += w + brng.randf_range(0.5, 3.0)


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
				cs.shape = mesh.create_convex_shape()
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
		cs.shape = mesh.create_convex_shape()
		rb.add_child(cs)
		rb.position = centre + Vector3(rng.randf_range(-1.5, 1.5), 0.6 + i * 0.05, rng.randf_range(-1.5, 1.5))
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
			var rb := RigidBody3D.new()
			rb.name = "Bottle"
			rb.collision_layer = Game.LAYER_PROPS
			rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_PLAYER | Game.LAYER_DEBRIS
			rb.mass = 0.35
			rb.set_meta("surface", "glass")
			var mat := Mat.glass(glass_cols[rng.randi() % glass_cols.size()])
			var b := MeshInstance3D.new()
			b.mesh = body
			b.material_override = mat
			rb.add_child(b)
			var n := MeshInstance3D.new()
			n.mesh = neck
			n.position.y = 0.125
			n.material_override = mat
			rb.add_child(n)
			var cs := CollisionShape3D.new()
			var sh := CylinderShape3D.new()
			sh.radius = 0.034
			sh.height = 0.25
			cs.shape = sh
			cs.position.y = 0.04
			rb.add_child(cs)
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
		mi.material_override = mat
		var size: float = s[1]
		mi.transform = Transform3D(Basis.from_euler(Vector3(0, rng.randf() * TAU, 0)).scaled(Vector3(size, 1, size * rng.randf_range(0.6, 1.0))),
				s[0] + Vector3(0, 0.004, 0))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
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
