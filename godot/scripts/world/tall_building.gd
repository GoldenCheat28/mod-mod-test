extends RefCounted
## Three-storey abandoned buildings one can go into and up: a concrete or
## brick shell with rows of windows (frames, sills, some boarded up, some
## with a pane left), a front door and a back door, a switchback staircase
## with landings in one corner running up through all three floors,
## balconies with rusted railings on the front, a flat roof behind a
## parapet. Inside: partition walls with doorways, furniture people left
## (beds, wardrobes, sofas, shelves, tables and chairs), bare bulbs with a
## switch by the stairs, and what years of nobody leave - newspapers,
## bottles whole and broken, rubble, puddles, graffiti, grime; on the top
## floor part of the floor has fallen through.
##
## Two of them: "event" (building B) with the hall where the roulette
## evening is held (a round table for five and the judge's place, a bar,
## benches for onlookers), tables for three upstairs; "flats" (building V):
## three floors of flats, a kitchen table for three in each.
##
## Game tables are recorded in the map builder's `game_tables`
## (roulette_game.gd plays at them): {"center", "seats": [{pos, yaw}],
## "judge" (a floor point or INF), "kind": "event"/"small", "seat_h"}.

const Mat = preload("res://scripts/world/materials.gd")
const Tex = preload("res://scripts/world/textures.gd")
const Geo = preload("res://scripts/world/geo.gd")
const Furn = preload("res://scripts/world/furniture.gd")

const H := 3.2            # floor to floor
const SLAB := 0.25
const T := 0.3            # outer wall thickness
const TREAD := 0.28
const STEPS := 9          # per flight (two flights a storey)


## `spec`: x0, x1, z0 (front, facing -z), z1 (back), kind ("event"/"flats"),
## stair ("east"/"west"), seed, brick (bool).
static func build(mb: Node3D, spec: Dictionary) -> void:
	var c := _ctx(mb, spec)
	_shell(c)
	_stairs(c)
	if spec["kind"] == "event":
		_event_interior(c)
	else:
		_flats_interior(c)
	_dress(c)
	_lights(c)


static func _ctx(mb: Node3D, spec: Dictionary) -> Dictionary:
	var rng := RandomNumberGenerator.new()
	rng.seed = int(spec.get("seed", 1))
	var x0: float = spec["x0"]
	var x1: float = spec["x1"]
	var z0: float = spec["z0"]
	var z1: float = spec["z1"]
	var f0 := 0.15
	var floors := [f0, f0 + H, f0 + 2.0 * H]
	var east: bool = spec.get("stair", "east") == "east"
	# The stair bay: in a back corner, against the side wall.
	var bw := 2.8
	var bay_x0 := (x1 - T - bw) if east else (x0 + T)
	var bay_x1 := bay_x0 + bw
	var sz1 := z1 - T
	var sz0 := sz1 - (TREAD * STEPS + 1.3)
	# Flight A (up from the floor) against the side wall, flight B (down from
	# the landing to the next floor) on the inner side.
	var a_x0 := bay_x0 + bw * 0.5 if east else bay_x0
	var b_x0 := bay_x0 if east else bay_x0 + bw * 0.5
	return {
		"mb": mb, "geo": mb.geo, "rng": rng, "kind": spec["kind"],
		"x0": x0, "x1": x1, "z0": z0, "z1": z1, "floors": floors, "roof": f0 + 3.0 * H,
		"east": east, "bay_x0": bay_x0, "bay_x1": bay_x1, "sz0": sz0, "sz1": sz1,
		"a_x0": a_x0, "b_x0": b_x0, "half": bw * 0.5,
		"wall": Mat.concrete("brick") if spec.get("brick", false) else Mat.concrete("wall"),
		"floor": Mat.concrete("floor"), "dark": Mat.concrete("dark"),
		"wood": Mat.wood("furn_wood", Color(0.32, 0.21, 0.13), 0.75),
		"frame": Mat.wood("window_frame", Color(0.22, 0.2, 0.17), 0.85),
		"balcony_x": [x0 + 1.4, x0 + 4.6],
		"holes": {},
	}


# --- The shell ----------------------------------------------------------------------------------

## Window openings along a wall of `length`: [offset, width, sill, top], kept
## clear of `avoid` ([from, to] offsets).
static func _windows(length: float, avoid: Array, every := 2.6, w := 1.25) -> Array:
	var out := []
	var at := 1.1
	while at + w < length - 0.6:
		var clear := true
		for a in avoid:
			if at + w > float(a[0]) - 0.3 and at < float(a[1]) + 0.3:
				clear = false
		if clear:
			out.append([at, w, 0.9, 2.3])
		at += every
	return out


static func _shell(c: Dictionary) -> void:
	var geo = c["geo"]
	var x0: float = c["x0"]
	var x1: float = c["x1"]
	var z0: float = c["z0"]
	var z1: float = c["z1"]
	var w := x1 - x0
	var d := z1 - z0
	var wall: Material = c["wall"]
	var floors: Array = c["floors"]
	var bx: Array = c["balcony_x"]
	var bay := [float(c["bay_x0"]) - x0, float(c["bay_x1"]) - x0]
	var bay_z := [float(c["sz0"]) - z0, d]
	# Ground slab.
	geo.block(Vector3(x0, -0.2, z0), Vector3(x1, floors[0], z1), c["floor"])
	for k in 3:
		var fy: float = floors[k]
		var wh := H - SLAB
		# Front: the door on the ground floor, a balcony door above.
		var front := []
		if k == 0:
			front.append([w * 0.36, 1.8, 0.0, 2.5])
		else:
			front.append([float(bx[0]) - x0 + 1.1, 1.0, 0.0, 2.25])
		var avoid_f := []
		for o in front:
			avoid_f.append([o[0], float(o[0]) + float(o[1])])
		front.append_array(_windows(w, avoid_f))
		geo.wall(Vector3(x0, fy, z0 + T * 0.5), w, true, wh, T, wall, front)
		# Back: no windows behind the stairs; the back door on the ground floor.
		var back := []
		var avoid_b := [bay]
		if k == 0:
			var bd := w * 0.5 - 0.6
			back.append([bd, 1.2, 0.0, 2.2])
			avoid_b.append([bd, bd + 1.2])
		back.append_array(_windows(w, avoid_b))
		geo.wall(Vector3(x0, fy, z1 - T * 0.5), w, true, wh, T, wall, back)
		# Sides.
		var side_open := _windows(d - T * 2.0, [])
		var side_stair := _windows(d - T * 2.0, [[float(bay_z[0]) - T, d]])
		geo.wall(Vector3(x0 + T * 0.5, fy, z0 + T), d - T * 2.0, false, wh, T, wall, side_stair if not c["east"] else side_open)
		geo.wall(Vector3(x1 - T * 0.5, fy, z0 + T), d - T * 2.0, false, wh, T, wall, side_stair if c["east"] else side_open)
		# Frames, sills and the odd board or pane in every window.
		_dress_windows(c, fy, front, x0, z0 + T * 0.5, true, Vector3(0, 0, -1), k)
		_dress_windows(c, fy, back, x0, z1 - T * 0.5, true, Vector3(0, 0, 1), k)
		_dress_windows(c, fy, side_stair if not c["east"] else side_open, z0 + T, x0 + T * 0.5, false, Vector3(-1, 0, 0), k)
		_dress_windows(c, fy, side_stair if c["east"] else side_open, z0 + T, x1 - T * 0.5, false, Vector3(1, 0, 0), k)
		# A band along the front at each floor.
		geo.box(Vector3((x0 + x1) * 0.5, fy - 0.1, z0 - 0.04), Vector3(w + 0.1, 0.18, 0.1), c["dark"], Vector3.ZERO, false)
		# The floor above (the roof over the top one).
		var top := fy + H
		var holes := []
		if k < 2:
			# Over the stairs (flight B comes up through it).
			holes.append(Rect2(float(c["bay_x0"]), float(c["sz0"]), float(c["bay_x1"]) - float(c["bay_x0"]), float(c["sz1"]) - float(c["sz0"])))
		geo.slab(Vector2(x0, z0), Vector2(x1, z1), top - SLAB, top, c["floor"], holes)
		# Balconies on the upper floors.
		if k > 0:
			_balcony(c, fy)
	# Parapet round the roof, and the cornice.
	var roof: float = c["roof"]
	var dark: Material = c["dark"]
	geo.block(Vector3(x0, roof, z0), Vector3(x1, roof + 0.8, z0 + 0.25), dark)
	geo.block(Vector3(x0, roof, z1 - 0.25), Vector3(x1, roof + 0.8, z1), dark)
	geo.block(Vector3(x0, roof, z0 + 0.25), Vector3(x0 + 0.25, roof + 0.8, z1 - 0.25), dark)
	geo.block(Vector3(x1 - 0.25, roof, z0 + 0.25), Vector3(x1, roof + 0.8, z1 - 0.25), dark)
	geo.box(Vector3((x0 + x1) * 0.5, roof + 0.82, (z0 + z1) * 0.5), Vector3(w + 0.16, 0.06, d + 0.16), dark, Vector3.ZERO, false)
	# Rebar out of the parapet, a vent box, a rusted aerial.
	var rng: RandomNumberGenerator = c["rng"]
	for i in 8:
		c["mb"]._rebar(Vector3(rng.randf_range(x0 + 0.5, x1 - 0.5), roof + 0.8, z0 + 0.12), Vector3(rng.randf_range(-0.3, 0.3), 1, rng.randf_range(-0.2, 0.3)), rng.randf_range(0.2, 0.6))
	geo.box(Vector3(x0 + w * 0.7, roof + 0.5, z0 + d * 0.6), Vector3(1.2, 1.0, 0.9), dark)
	geo.box(Vector3(x0 + 1.2, roof + 1.4, z1 - 1.0), Vector3(0.05, 2.8, 0.05), Mat.rust(), Vector3(0.1, 0, 0.05), false)
	geo.box(Vector3(x0 + 1.2, roof + 2.4, z1 - 1.0), Vector3(1.2, 0.03, 0.03), Mat.rust(), Vector3.ZERO, false)


## Frames and sills in the openings of a wall (`start` along it, `plane` the
## wall's centre line across), `out` the way the wall faces.
static func _dress_windows(c: Dictionary, fy: float, openings: Array, start: float, plane: float, along_x: bool, out: Vector3, floor_i: int) -> void:
	var geo = c["geo"]
	var rng: RandomNumberGenerator = c["rng"]
	var frame: Material = c["frame"]
	for o in openings:
		var ow: float = o[1]
		var ob: float = o[2]
		var ot: float = o[3]
		if ob < 0.1:
			continue                  # a door
		var mid: float = start + float(o[0]) + ow * 0.5
		var p := Vector3(mid, fy, plane) if along_x else Vector3(plane, fy, mid)
		var across := Vector3.RIGHT if along_x else Vector3.BACK
		# Sill sticking out a little, the frame round the hole.
		geo.box(p + Vector3(0, ob - 0.04, 0) + out * 0.12, Vector3(ow + 0.2, 0.06, 0.3) if along_x else Vector3(0.3, 0.06, ow + 0.2), c["dark"], Vector3.ZERO, false)
		var fz := out * 0.02
		geo.box(p + Vector3(0, ot - 0.03, 0) + fz, _span(along_x, ow, 0.06, 0.08), frame, Vector3.ZERO, false)
		geo.box(p + Vector3(0, ob + 0.03, 0) + fz, _span(along_x, ow, 0.06, 0.08), frame, Vector3.ZERO, false)
		for s in [-1.0, 1.0]:
			geo.box(p + across * (ow * 0.5 - 0.03) * s + Vector3(0, (ob + ot) * 0.5, 0) + fz, _span(along_x, 0.06, ot - ob, 0.08), frame, Vector3.ZERO, false)
		geo.box(p + Vector3(0, (ob + ot) * 0.5, 0) + fz, _span(along_x, 0.04, ot - ob, 0.06), frame, Vector3.ZERO, false)
		var r := rng.randf()
		if floor_i == 0 and r < 0.45:
			# Boarded up (a gap left between the planks).
			for i in 4:
				var yy := ob + 0.2 + i * 0.36
				if yy > ot - 0.1:
					break
				var tilt := rng.randf_range(-0.12, 0.12)
				geo.box(p + Vector3(0, yy, 0) + out * 0.17, _span(along_x, ow + 0.2, 0.2, 0.025), c["wood"], Vector3(0, 0, tilt) if along_x else Vector3(tilt, 0, 0), false)
		elif r < 0.3:
			# A pane or two left in, dirty.
			geo.box(p + Vector3(0, ob + (ot - ob) * 0.3, 0) + fz, _span(along_x, ow * 0.45, (ot - ob) * 0.5, 0.006), Mat.glass(Color(0.5, 0.55, 0.5)), Vector3.ZERO, false)


static func _span(along_x: bool, w: float, h: float, d: float) -> Vector3:
	return Vector3(w, h, d) if along_x else Vector3(d, h, w)


static func _balcony(c: Dictionary, fy: float) -> void:
	var geo = c["geo"]
	var mb: Node3D = c["mb"]
	var bx: Array = c["balcony_x"]
	var z0: float = c["z0"]
	var bx0: float = bx[0]
	var bx1: float = bx[1]
	var depth := 1.25
	geo.block(Vector3(bx0, fy - 0.2, z0 - depth), Vector3(bx1, fy, z0 + 0.02), c["floor"])
	# Railing: posts, a top rail and a mid rail (rusted), some bars gone.
	var rust := Mat.rust()
	var rng: RandomNumberGenerator = c["rng"]
	var x := bx0 + 0.05
	while x < bx1:
		if rng.randf() > 0.12:
			mb._rod(Vector3(x, fy, z0 - depth + 0.05), Vector3.UP, 1.0, rust)
		x += 0.16
	for z in [z0 - depth + 0.05]:
		mb._rod(Vector3(bx0, fy + 1.0, z), Vector3.RIGHT, bx1 - bx0, rust)
		mb._rod(Vector3(bx0, fy + 0.5, z), Vector3.RIGHT, bx1 - bx0, rust)
	for sxx in [bx0 + 0.05, bx1 - 0.05]:
		mb._rod(Vector3(sxx, fy + 1.0, z0 - depth + 0.05), Vector3.BACK, depth, rust)
		var zz := z0 - depth + 0.05
		while zz < z0:
			mb._rod(Vector3(sxx, fy, zz), Vector3.UP, 1.0, rust)
			zz += 0.16
	geo.add_collision_box(Transform3D(Basis(), Vector3((bx0 + bx1) * 0.5, fy + 0.55, z0 - depth + 0.05)), Vector3(bx1 - bx0, 1.1, 0.05))
	for sxx in [bx0 + 0.05, bx1 - 0.05]:
		geo.add_collision_box(Transform3D(Basis(), Vector3(sxx, fy + 0.55, z0 - depth * 0.5)), Vector3(0.05, 1.1, depth))
	# A dead plant pot and a chair left out on it.
	geo.box(Vector3(bx1 - 0.35, fy + 0.15, z0 - 0.35), Vector3(0.3, 0.3, 0.3), Mat.standard("pot", Color(0.45, 0.22, 0.14), 0.9))
	Furn._chair(mb, geo, Vector3(bx0 + 0.6, fy, z0 - 0.55), PI, c["wood"], Vector3(bx0 + 0.6, fy + 1.2, z0 - 5.0))


# --- Stairs ---------------------------------------------------------------------------------------

## One flight: each step a slab of its own (thin under its tread, not a solid
## block down to the floor), so there is head room under the flight above.
static func _flight(geo, base: Vector3, dir: Vector3, width: float, rise: float, steps: int, mat: Material) -> void:
	var sh := rise / steps
	var thick := sh + 0.16
	for i in steps:
		var top := base.y + sh * (i + 1)
		var centre := base + dir * (TREAD * (i + 0.5))
		centre.y = top - thick * 0.5
		var size := Vector3(TREAD + 0.02, thick, width) if absf(dir.x) > 0.5 else Vector3(width, thick, TREAD + 0.02)
		geo.box(centre, size, mat)
	# Walking collision: a ramp resting on the step noses (as geo.stairs), so
	# feet and the player's capsule go up smoothly, not catching on each edge.
	var p0 := base - dir * TREAD
	var p1 := base + dir * TREAD * (steps - 1) + Vector3.UP * rise
	var u := (p1 - p0).normalized()
	var side := Vector3.UP.cross(dir).normalized()
	var n := u.cross(side).normalized()
	if n.y < 0.0:
		side = -side
		n = -n
	var t := 0.3
	geo.add_collision_box(Transform3D(Basis(side, n, u), (p0 + p1) * 0.5 + n * (0.01 - t * 0.5)), Vector3(width, t, p0.distance_to(p1)))


static func _stairs(c: Dictionary) -> void:
	var geo = c["geo"]
	var mb: Node3D = c["mb"]
	var floors: Array = c["floors"]
	var half: float = c["half"]
	var sz0: float = c["sz0"]
	var sz1: float = c["sz1"]
	var a_x0: float = c["a_x0"]
	var b_x0: float = c["b_x0"]
	var run := TREAD * STEPS
	var land_z := sz0 + run
	var mat: Material = c["floor"]
	for k in 2:
		var fy: float = floors[k]
		# Up the side wall, the landing across the back, back down the inner side.
		_flight(geo, Vector3(a_x0 + half * 0.5, fy, sz0), Vector3(0, 0, 1), half, H * 0.5, STEPS, mat)
		geo.block(Vector3(float(c["bay_x0"]), fy + H * 0.5 - 0.2, land_z), Vector3(float(c["bay_x1"]), fy + H * 0.5, sz1), mat)
		_flight(geo, Vector3(b_x0 + half * 0.5, fy + H * 0.5, land_z), Vector3(0, 0, -1), half, H * 0.5, STEPS, mat)
		# The rail between the flights (a low wall), rusted pipe on top.
		var mid_x: float = a_x0 if c["east"] else b_x0
		geo.block(Vector3(mid_x - 0.04, fy, sz0 + 0.3), Vector3(mid_x + 0.04, fy + H * 0.5 + 0.9, land_z - 0.05), c["dark"])
	for k in 3:
		var fy: float = floors[k]
		# The stairwell's wall on the room side (the way in is at its front).
		var wx: float = float(c["bay_x0"]) - 0.08 if c["east"] else float(c["bay_x1"]) + 0.08
		geo.block(Vector3(wx - 0.08, fy, sz0), Vector3(wx + 0.08, fy + H - SLAB, sz1), c["wall"])
		if k == 2:
			# Across the top of flight A, where the floor stops (no flight on up): a rail.
			geo.block(Vector3(a_x0, fy, sz0 - 0.04), Vector3(a_x0 + half, fy + 1.0, sz0 + 0.04), c["dark"])
	# Rebar and chipped edges along the stairwell.
	for k in range(1, 3):
		mb._rebar(Vector3(a_x0 + 0.2, floors[k] - 0.1, sz0), Vector3(0.1, -1, 0.3), 0.4)


# --- Inside -------------------------------------------------------------------------------------

## A partition along z at x, from z_a to z_b, with a doorway at `door_z`.
static func _partition_z(c: Dictionary, x: float, z_a: float, z_b: float, fy: float, door_z: float) -> void:
	c["geo"].wall(Vector3(x, fy, z_a), z_b - z_a, false, H - SLAB, 0.16, c["wall"], [[door_z - z_a, 1.2, 0.0, 2.15]])


static func _partition_x(c: Dictionary, z: float, x_a: float, x_b: float, fy: float, door_x: float) -> void:
	c["geo"].wall(Vector3(x_a, fy, z), x_b - x_a, true, H - SLAB, 0.16, c["wall"], [[door_x - x_a, 1.2, 0.0, 2.15]])


## A table for a game (round for the event, square for three), its chairs
## facing it, recorded for roulette_game.gd.
static func _game_table(c: Dictionary, centre: Vector3, n: int, kind: String, judge := false) -> void:
	var geo = c["geo"]
	var mb: Node3D = c["mb"]
	var wood: Material = c["wood"]
	var r := 0.72 if kind == "event" else 0.5
	var top := CylinderMesh.new()
	top.top_radius = r
	top.bottom_radius = r
	top.height = 0.045
	top.radial_segments = 28
	var green := Mat.wood("baize", Color(0.1, 0.24, 0.13), 0.95)       # (shows the blood)
	geo.add_mesh(top, Transform3D(Basis(), centre + Vector3(0, 0.75, 0)), wood)
	var cloth := CylinderMesh.new()
	cloth.top_radius = r - 0.06
	cloth.bottom_radius = r - 0.06
	cloth.height = 0.004
	cloth.radial_segments = 28
	if kind == "event":
		geo.add_mesh(cloth, Transform3D(Basis(), centre + Vector3(0, 0.775, 0)), green)
	var leg := CylinderMesh.new()
	leg.top_radius = 0.06
	leg.bottom_radius = 0.09
	leg.height = 0.73
	geo.add_mesh(leg, Transform3D(Basis(), centre + Vector3(0, 0.365, 0)), wood)
	var foot := CylinderMesh.new()
	foot.top_radius = 0.3
	foot.bottom_radius = 0.34
	foot.height = 0.04
	geo.add_mesh(foot, Transform3D(Basis(), centre + Vector3(0, 0.02, 0)), wood)
	geo.add_collision_box(Transform3D(Basis(), centre + Vector3(0, 0.75, 0)), Vector3(r * 1.5, 0.05, r * 1.5))
	geo.add_collision_box(Transform3D(Basis(), centre + Vector3(0, 0.37, 0)), Vector3(0.18, 0.74, 0.18))
	var seats := []
	var gap := 1 if judge else 0
	var slots := n + gap
	var table_i: int = mb.game_tables.size()
	for i in n:
		var a := TAU * float(i + gap) / slots + PI * 0.5
		var at := centre + Vector3(cos(a), 0, sin(a)) * (r + 0.55)
		var yaw := atan2(-cos(a), -sin(a))
		_game_chair(c, at, yaw, table_i, i)
		seats.append({"pos": at, "yaw": yaw})
	var judge_at := Vector3.INF
	if judge:
		var a := PI * 0.5
		judge_at = centre + Vector3(cos(a), 0, sin(a)) * (r + 0.75)
	mb.game_tables.append({"center": centre, "seats": seats, "judge": judge_at, "kind": kind, "seat_h": 0.47, "radius": r})


## A chair at a game table: F on it sits down to play (roulette_game.gd).
static func _game_chair(c: Dictionary, at: Vector3, yaw: float, table_i: int, seat_i: int) -> void:
	var geo = c["geo"]
	var wood: Material = c["wood"]
	var b := Basis(Vector3.UP, yaw)
	var r := Vector3(0, yaw, 0)
	geo.box(at + Vector3(0, 0.45, 0), Vector3(0.42, 0.04, 0.42), wood, r, false)
	for lx in [-1.0, 1.0]:
		for lz in [-1.0, 1.0]:
			var h := 0.45 if lz > 0 else 0.95
			geo.box(at + b * Vector3(0.18 * lx, h * 0.5, 0.18 * lz), Vector3(0.035, h, 0.035), wood, r, false)
	geo.box(at + b * Vector3(0, 0.88, -0.18), Vector3(0.42, 0.08, 0.03), wood, r, false)
	for lx in [-0.07, 0.07]:
		geo.box(at + b * Vector3(lx, 0.67, -0.18), Vector3(0.05, 0.36, 0.02), wood, r, false)
	var sb := StaticBody3D.new()
	sb.collision_layer = Game.LAYER_WORLD
	sb.collision_mask = 0
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(0.44, 0.47, 0.44)          # (up to the top of the seat: blood lands on it)
	cs.shape = bs
	sb.add_child(cs)
	sb.set_meta("game_seat", {"table": table_i, "seat": seat_i})
	sb.set_meta("surface", "wood")
	c["mb"].nav_region.add_child(sb)
	sb.global_transform = Transform3D(b, at + Vector3(0, 0.235, 0))


static func _event_interior(c: Dictionary) -> void:
	var geo = c["geo"]
	var mb: Node3D = c["mb"]
	var floors: Array = c["floors"]
	var x0: float = c["x0"]
	var x1: float = c["x1"]
	var z0: float = c["z0"]
	var z1: float = c["z1"]
	var wood: Material = c["wood"]
	var dark_wood := Mat.wood("furn_dark", Color(0.2, 0.13, 0.08), 0.8)
	var f0: float = floors[0]
	# --- Ground floor: the hall. The round table in the middle, the judge's
	# place at its head; a bar along the west wall; benches for onlookers.
	var hall_x := (x0 + float(c["bay_x0"])) * 0.5
	var centre := Vector3(hall_x, f0, (z0 + z1) * 0.5 + 0.3)
	_game_table(c, centre, 5, "event", true)
	mb.event_hall = {"center": centre, "door": Vector3(x0 + (x1 - x0) * 0.36 + 0.9, f0, z0 - 0.8),
			"bounds": [x0 + T, float(c["bay_x0"]) - 0.2, z0 + T, z1 - T]}
	_bar(c, dark_wood, wood)
	# Benches along the back and the east wall for the ones who come to watch.
	for i in 2:
		var bz := z1 - 1.2
		var bxx := hall_x - 2.4 + i * 3.2
		Furn._sofa(mb, geo, Vector3(bxx, f0, bz), PI, Mat.standard("sofa_brown", Color(0.28, 0.18, 0.12), 0.95), centre + Vector3(0, 1.0, 0))
	Furn._rug(mb, centre + Vector3(0, 0.004, 0), Vector2(4.2, 4.2), Color(0.35, 0.08, 0.07))
	# Crates in the corner by the bar.
	geo.box(Vector3(x0 + T + 0.6, f0 + 0.3, z0 + T + 0.5), Vector3(0.9, 0.6, 0.6), dark_wood)
	geo.box(Vector3(x0 + T + 0.6, f0 + 0.85, z0 + T + 0.5), Vector3(0.7, 0.5, 0.5), wood, Vector3(0, 0.3, 0))
	# The way down to the cellar (where the cleaners come up from), and the
	# dumpster out the back.
	_cellar(c, Vector3(float(c["bay_x0"]) - 1.0, f0, z0 + T))
	var bin_at := Vector3((x0 + x1) * 0.5 + 2.2, 0.0, z1 + 1.9)
	mb._dumpster(bin_at, 0.0)
	mb.event_hall["dumpster"] = Vector3(bin_at.x, mb._gy(bin_at.x, bin_at.z), bin_at.z)
	mb.event_hall["back_door"] = Vector3((x0 + x1) * 0.5, f0, z1 + 0.6)
	# --- First floor: a room with a table for three, a sofa and a bed-room.
	var f1: float = floors[1]
	var part_x := x0 + (float(c["bay_x0"]) - x0) * 0.55
	_partition_z(c, part_x, z0 + T, z1 - T, f1, z0 + 2.2)
	_game_table(c, Vector3((x0 + part_x) * 0.5, f1, z0 + (z1 - z0) * 0.55), 3, "small")
	Furn._sofa(mb, geo, Vector3((x0 + part_x) * 0.5, f1, z1 - 1.0), PI, Mat.standard("sofa_green", Color(0.2, 0.25, 0.18), 0.95), Vector3.INF)
	Furn._wardrobe(geo, Vector3(x0 + T + 0.3, f1, z1 - 2.6), PI * 0.5, dark_wood)
	Furn._shelf(geo, Vector3(x0 + T + 0.17, f1, z0 + 3.6), PI * 0.5, dark_wood)
	Furn._rug(mb, Vector3((x0 + part_x) * 0.5, f1 + 0.004, z0 + (z1 - z0) * 0.55), Vector2(2.6, 2.2), Color(0.2, 0.2, 0.35))
	var metal := Mat.standard("bed_metal", Color(0.3, 0.32, 0.33), 0.45, 0.7)
	var cloth := Mat.standard("mattress_old", Color(0.6, 0.56, 0.47), 0.95)
	Furn._bed(mb, geo, Vector3(part_x + 2.1, f1, z0 + 1.2), PI * 0.5, metal, cloth, Mat.standard("blanket", Color(0.35, 0.18, 0.15), 0.95))
	Furn._chair(mb, geo, Vector3(part_x + 1.4, f1, z0 + 4.6), -PI * 0.5, wood, Vector3.INF)
	# --- Top floor: squatters. Mattresses, a table for three on crates, the
	# floor fallen through in the west corner.
	var f2: float = floors[2]
	_game_table(c, Vector3(part_x + 1.4, f2, z0 + 3.0), 3, "small")
	Furn._mattress(mb, geo, Vector3(x0 + 2.2, f2, z0 + 1.6), 0.1, cloth, Mat.standard("blanket2", Color(0.2, 0.26, 0.33), 0.95))
	Furn._mattress(mb, geo, Vector3(x0 + 4.4, f2, z0 + 1.9), -0.2, cloth, Mat.standard("blanket", Color(0.35, 0.18, 0.15), 0.95))
	Furn._crate_table(geo, Vector3(x0 + 5.5, f2, z1 - 2.0), dark_wood)


## The bar along the west wall of the hall: a panelled counter with a
## brass foot rail and a top that overhangs, shelves of bottles on the wall
## behind, the bartender's place between them (in at the far end), and
## tall stools along the front. Recorded in event_hall["bar"].
static func _bar(c: Dictionary, dark_wood: Material, wood: Material) -> void:
	var geo = c["geo"]
	var mb: Node3D = c["mb"]
	var x0: float = c["x0"]
	var z0: float = c["z0"]
	var z1: float = c["z1"]
	var f0: float = c["floors"][0]
	var rng: RandomNumberGenerator = c["rng"]
	var brass := Mat.standard("brass_rail", Color(0.7, 0.55, 0.25), 0.3, 0.9)
	var cz0 := z0 + 2.6
	var cz1 := z1 - 3.2
	var cx0 := x0 + T + 1.05              # the counter's back face
	var cx1 := cx0 + 0.6                  # its front, to the room
	# Counter: the body, a darker plinth, panels on the front, the top.
	geo.block(Vector3(cx0, f0, cz0), Vector3(cx1, f0 + 1.02, cz1), dark_wood)
	geo.block(Vector3(cx1, f0, cz0), Vector3(cx1 + 0.03, f0 + 0.12, cz1), c["dark"])
	var n_pan := int((cz1 - cz0) / 0.8)
	for i in n_pan:
		var pz := cz0 + (i + 0.5) * (cz1 - cz0) / n_pan
		geo.box(Vector3(cx1 + 0.012, f0 + 0.58, pz), Vector3(0.02, 0.6, (cz1 - cz0) / n_pan - 0.12), wood, Vector3.ZERO, false)
	geo.block(Vector3(cx0 - 0.05, f0 + 1.02, cz0 - 0.05), Vector3(cx1 + 0.12, f0 + 1.07, cz1 + 0.05), wood)
	# The foot rail on its brackets.
	var rail := CylinderMesh.new()
	rail.top_radius = 0.022
	rail.bottom_radius = 0.022
	rail.height = cz1 - cz0
	geo.add_mesh(rail, Transform3D(Basis(Vector3.RIGHT, PI * 0.5), Vector3(cx1 + 0.16, f0 + 0.22, (cz0 + cz1) * 0.5)), brass)
	for i in 4:
		var bz := lerpf(cz0 + 0.2, cz1 - 0.2, float(i) / 3.0)
		geo.box(Vector3(cx1 + 0.09, f0 + 0.22, bz), Vector3(0.14, 0.02, 0.02), brass, Vector3.ZERO, false)
	# The shelves on the wall behind, bottles on them (all kinds), a mirror.
	var wall_x := x0 + T
	var glass_cols := [Color(0.15, 0.35, 0.12), Color(0.35, 0.2, 0.06), Color(0.7, 0.75, 0.72), Color(0.4, 0.08, 0.06), Color(0.55, 0.45, 0.2)]
	geo.box(Vector3(wall_x + 0.02, f0 + 1.75, (cz0 + cz1) * 0.5), Vector3(0.02, 0.7, cz1 - cz0 - 0.6), Mat.glass(Color(0.35, 0.37, 0.38)), Vector3.ZERO, false)
	for k in 3:
		var sy := f0 + 1.05 + k * 0.42
		geo.block(Vector3(wall_x, sy - 0.03, cz0 + 0.1), Vector3(wall_x + 0.3, sy, cz1 - 0.1), dark_wood)
		var bz := cz0 + 0.2
		while bz < cz1 - 0.2:
			var gc: Color = glass_cols[rng.randi() % glass_cols.size()]
			var h := rng.randf_range(0.2, 0.32)
			var bm := CylinderMesh.new()
			bm.top_radius = 0.032
			bm.bottom_radius = 0.034
			bm.height = h * 0.7
			bm.radial_segments = 10
			var nm := CylinderMesh.new()
			nm.top_radius = 0.011
			nm.bottom_radius = 0.03
			nm.height = h * 0.3
			nm.radial_segments = 8
			var bx := wall_x + 0.15 + rng.randf_range(-0.05, 0.05)
			geo.add_mesh(bm, Transform3D(Basis(), Vector3(bx, sy + h * 0.35, bz)), Mat.glass(gc))
			geo.add_mesh(nm, Transform3D(Basis(), Vector3(bx, sy + h * 0.85, bz)), Mat.glass(gc))
			bz += rng.randf_range(0.09, 0.16)
	# Stools along the front: a round seat on a post, a ring for the feet.
	var stools := []
	var n_st := 5
	for i in n_st:
		var sz := lerpf(cz0 + 0.45, cz1 - 0.45, float(i) / (n_st - 1))
		var sp := Vector3(cx1 + 0.55, f0, sz)
		var seat := CylinderMesh.new()
		seat.top_radius = 0.19
		seat.bottom_radius = 0.17
		seat.height = 0.06
		geo.add_mesh(seat, Transform3D(Basis(), sp + Vector3(0, 0.74, 0)), Mat.standard("stool_top", Color(0.15, 0.08, 0.06), 0.6))
		var post := CylinderMesh.new()
		post.top_radius = 0.03
		post.bottom_radius = 0.03
		post.height = 0.72
		geo.add_mesh(post, Transform3D(Basis(), sp + Vector3(0, 0.36, 0)), brass)
		var ring := TorusMesh.new()
		ring.inner_radius = 0.15
		ring.outer_radius = 0.17
		geo.add_mesh(ring, Transform3D(Basis(), sp + Vector3(0, 0.3, 0)), brass)
		var foot := CylinderMesh.new()
		foot.top_radius = 0.12
		foot.bottom_radius = 0.2
		foot.height = 0.03
		geo.add_mesh(foot, Transform3D(Basis(), sp + Vector3(0, 0.015, 0)), c["dark"])
		stools.append({"pos": sp, "seat_h": 0.77, "glass": Vector3(cx1 - 0.15, f0 + 1.07, sz)})
	mb.event_hall["bar"] = {"stools": stools, "bartender": Vector3(x0 + T + 0.65, f0, (cz0 + cz1) * 0.5),
			"in_at": Vector3(x0 + T + 0.65, f0, cz1 + 0.5), "wall_x": wall_x, "cz0": cz0, "cz1": cz1, "top_y": f0 + 1.07, "cx0": cx0, "cx1": cx1}


## The cellar door in the hall's front corner: a concrete stair head with a
## steel door (the stairs going down, dark, behind it). Locked to the
## player; the cleaners come up through it and go back down.
static func _cellar(c: Dictionary, at: Vector3) -> void:
	var geo = c["geo"]
	var mb: Node3D = c["mb"]
	var conc: Material = c["wall"]
	var dark: Material = c["dark"]
	# The stair head: a box 1.6 x 1.8 against the front wall, door on its west side.
	var bx0 := at.x - 0.8
	var bx1 := at.x + 0.8
	var bz0 := at.z
	var bz1 := at.z + 1.8
	var top := at.y + 2.3
	geo.block(Vector3(bx0 + 0.15, at.y, bz1 - 0.15), Vector3(bx1, top, bz1), conc)          # back
	geo.block(Vector3(bx1 - 0.15, at.y, bz0), Vector3(bx1, top, bz1), conc)                   # east
	geo.block(Vector3(bx0, top - 0.15, bz0), Vector3(bx1, top, bz1), conc)                    # roof
	geo.block(Vector3(bx0, at.y + 2.05, bz0), Vector3(bx0 + 0.15, top, bz1), conc)            # over the door
	geo.block(Vector3(bx0, at.y, bz1 - 0.15), Vector3(bx0 + 0.15, top, bz1), conc)            # jamb
	# Inside: black, steps going down out of sight.
	var black := Mat.standard("cellar_dark", Color(0.01, 0.01, 0.012), 1.0)
	geo.box(Vector3(at.x + 0.05, at.y + 0.004, (bz0 + bz1) * 0.5), Vector3(1.3, 0.008, 1.45), black, Vector3.ZERO, false)
	for k in 4:
		geo.box(Vector3(at.x + 0.3 - k * 0.0, at.y - 0.09 - k * 0.18, bz0 + 0.3 + k * 0.28), Vector3(0.9, 0.04, 0.28), dark, Vector3.ZERO, false)
	# (the doorway is closed to the player by an invisible wall; the door leaf swings)
	geo.add_collision_box(Transform3D(Basis(), Vector3(bx0 + 0.075, at.y + 1.0, (bz0 + bz1 - 0.15) * 0.5)), Vector3(0.15, 2.0, bz1 - bz0 - 0.15))
	var hinge := Node3D.new()
	hinge.name = "CellarDoor"
	mb.add_child(hinge)
	hinge.position = Vector3(bx0 + 0.03, at.y, bz0 + 0.05)
	var steel := Mat.standard("cellar_door", Color(0.22, 0.24, 0.23), 0.6, 0.6)
	var leaf := MeshInstance3D.new()
	var lm := BoxMesh.new()
	lm.size = Vector3(0.05, 2.0, bz1 - bz0 - 0.22)
	leaf.mesh = lm
	leaf.material_override = steel
	leaf.position = Vector3(0, 1.0, lm.size.z * 0.5)
	hinge.add_child(leaf)
	var handle := MeshInstance3D.new()
	var hm := BoxMesh.new()
	hm.size = Vector3(0.06, 0.03, 0.14)
	handle.mesh = hm
	handle.material_override = Mat.rust()
	handle.position = Vector3(-0.05, 1.0, lm.size.z - 0.12)
	hinge.add_child(handle)
	var plate := Label3D.new()
	plate.text = "ПОСТОРОННИМ ВХОД ВОСПРЕЩЁН"
	plate.font_size = 22
	plate.modulate = Color(0.75, 0.1, 0.08)
	plate.position = Vector3(-0.04, 1.6, lm.size.z * 0.5)
	plate.rotation = Vector3(0, -PI * 0.5, 0)
	hinge.add_child(plate)
	mb.event_hall["cellar"] = {"door": hinge, "out": Vector3(bx0 - 0.7, at.y, (bz0 + bz1) * 0.5),
			"in": Vector3(at.x, at.y, (bz0 + bz1) * 0.5)}


static func _flats_interior(c: Dictionary) -> void:
	var geo = c["geo"]
	var mb: Node3D = c["mb"]
	var floors: Array = c["floors"]
	var x0: float = c["x0"]
	var x1: float = c["x1"]
	var z0: float = c["z0"]
	var z1: float = c["z1"]
	var wood: Material = c["wood"]
	var dark_wood := Mat.wood("furn_dark", Color(0.2, 0.13, 0.08), 0.8)
	var metal := Mat.standard("bed_metal", Color(0.3, 0.32, 0.33), 0.45, 0.7)
	var cloth := Mat.standard("mattress_old", Color(0.6, 0.56, 0.47), 0.95)
	var covers := [Mat.standard("blanket", Color(0.35, 0.18, 0.15), 0.95), Mat.standard("blanket2", Color(0.2, 0.26, 0.33), 0.95)]
	var east: bool = c["east"]
	# The rooms beside the stairs: a corridor along the stair wall, a kitchen
	# at the front and a room at the back on the far side.
	var room_x0 := x0 + T if east else float(c["bay_x1"]) + 0.2
	var room_x1 := float(c["bay_x0"]) - 0.2 if east else x1 - T
	var mid_z := (z0 + z1) * 0.5
	for k in 3:
		var fy: float = floors[k]
		_partition_x(c, mid_z, room_x0, room_x1, fy, (room_x0 + room_x1) * 0.5 - 0.6)
		# Kitchen (front): table for three, a stove and a sink unit, shelf.
		var kc := Vector3((room_x0 + room_x1) * 0.5 + 0.8, fy, z0 + 1.95)
		_game_table(c, kc, 3, "small")
		geo.box(Vector3(room_x1 - 0.35, fy + 0.45, z0 + T + 0.35), Vector3(0.6, 0.9, 0.6), Mat.standard("stove", Color(0.8, 0.8, 0.76), 0.5, 0.2))
		geo.box(Vector3(room_x1 - 1.0, fy + 0.45, z0 + T + 0.35), Vector3(0.6, 0.9, 0.6), dark_wood)
		Furn._shelf(geo, Vector3(room_x0 + 0.17, fy, z0 + 1.6), PI * 0.5 if east else -PI * 0.5, dark_wood)
		# Room (back): bed, wardrobe, sofa, rug.
		Furn._bed(mb, geo, Vector3(room_x0 + 0.7, fy, z1 - 1.6), 0.0, metal, cloth, covers[k % 2])
		Furn._wardrobe(geo, Vector3(room_x1 - 0.3, fy, mid_z + 1.2), -PI * 0.5, dark_wood)
		Furn._sofa(mb, geo, Vector3((room_x0 + room_x1) * 0.5 + 1.8, fy, z1 - 1.0), PI, Mat.standard("sofa_green", Color(0.2, 0.25, 0.18), 0.95), Vector3.INF)
		Furn._rug(mb, Vector3((room_x0 + room_x1) * 0.5, fy + 0.004, z1 - 2.2), Vector2(2.2, 1.6), [Color(0.45, 0.14, 0.1), Color(0.25, 0.2, 0.35), Color(0.3, 0.28, 0.12)][k])
	var Door = load("res://scripts/world/door.gd")
	for k in 3:
		var fy: float = floors[k]
		Door.spawn(mb, Vector3((room_x0 + room_x1) * 0.5 - 0.6 + 0.03, fy + 0.015, mid_z), Vector3.RIGHT, 1.14, 2.1, geo._body)


# --- What is left lying about ---------------------------------------------------------------------

static func _dress(c: Dictionary) -> void:
	var mb: Node3D = c["mb"]
	var geo = c["geo"]
	var rng: RandomNumberGenerator = c["rng"]
	var floors: Array = c["floors"]
	var x0: float = c["x0"]
	var x1: float = c["x1"]
	var z0: float = c["z0"]
	var z1: float = c["z1"]
	var paper_mats: Array = []
	for i in 4:
		paper_mats.append(Mat.decal_material_textured("paper_%d" % i, Tex.newspaper(i + 3)))
	var sheet := PlaneMesh.new()
	sheet.size = Vector2(0.38, 0.3)
	var body := CylinderMesh.new()
	body.top_radius = 0.034
	body.bottom_radius = 0.034
	body.height = 0.17
	var neck := CylinderMesh.new()
	neck.top_radius = 0.012
	neck.bottom_radius = 0.03
	neck.height = 0.08
	var glass_cols := [Color(0.15, 0.35, 0.12), Color(0.35, 0.2, 0.06), Color(0.7, 0.75, 0.72)]
	var rubble := Mat.concrete("rubble")
	for k in 3:
		var fy: float = floors[k]
		# Newspapers blown into the corners.
		for i in 10:
			var p := Vector3(rng.randf_range(x0 + 0.6, x1 - 0.6), fy + 0.006 + i * 0.0005, rng.randf_range(z0 + 0.6, z1 - 0.6))
			var mi := MeshInstance3D.new()
			mi.mesh = sheet
			mi.material_override = paper_mats[rng.randi() % paper_mats.size()]
			mi.transform = Transform3D(Basis.from_euler(Vector3(rng.randf_range(-0.04, 0.04), rng.randf() * TAU, 0.0)), p)
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			mb.add_child(mi)
		# Bottles, whole (they roll, they break) and broken.
		for i in 5:
			var gc: Color = glass_cols[rng.randi() % glass_cols.size()]
			var rb: RigidBody3D = preload("res://scripts/world/bottle.gd").make(Mat.glass(gc), gc, body, neck)
			var standing := rng.randf() < 0.4
			rb.position = Vector3(rng.randf_range(x0 + 0.8, x1 - 0.8), fy + (0.1 if standing else 0.05), rng.randf_range(z0 + 0.8, z1 - 0.8))
			rb.rotation = Vector3(0 if standing else PI * 0.5, rng.randf() * TAU, 0)
			mb.add_child(rb)
		for i in 14:
			var shard := BoxMesh.new()
			shard.size = Vector3(rng.randf_range(0.01, 0.04), 0.002, rng.randf_range(0.01, 0.05))
			geo.add_mesh(shard, Transform3D(Basis(Vector3.UP, rng.randf() * TAU), Vector3(rng.randf_range(x0 + 0.5, x1 - 0.5), fy + 0.003, rng.randf_range(z0 + 0.5, z1 - 0.5))),
					Mat.glass(glass_cols[i % glass_cols.size()]))
		# Bits of plaster and concrete fallen off along the walls.
		for i in 12:
			var along := rng.randf()
			var p := Vector3(lerpf(x0 + 0.45, x1 - 0.45, along), fy, z0 + 0.45) if i % 2 == 0 else Vector3(x0 + 0.45, fy, lerpf(z0 + 0.45, z1 - 0.45, along))
			var sz := rng.randf_range(0.04, 0.12)
			geo.add_mesh(Geo.rock_mesh(sz, rng.randi()), Transform3D(Basis(Vector3.UP, rng.randf() * TAU), p + Vector3(0, sz * 0.3, 0)), rubble)
		# A puddle where the rain gets in.
		var pz := z0 + 0.9 if k > 0 else z1 - 1.2
		var plane := PlaneMesh.new()
		plane.size = Vector2(1, 1)
		var pm := MeshInstance3D.new()
		pm.mesh = plane
		var mat: ShaderMaterial = Mat.water().duplicate()
		mat.set_shader_parameter("seed", float(k) * 0.53 + rng.randf())
		mat.set_shader_parameter("clarity", 0.75)
		mat.set_shader_parameter("fill", 0.8)
		mb.indoor_puddles.append([mat, 1.6])
		pm.material_override = mat
		var pp := Vector3(rng.randf_range(x0 + 1.5, x1 - 3.0), fy + 0.004, pz)
		pm.transform = Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(1.6, 1, 1.1)), pp)
		pm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mb.add_child(pm)
		Game.water_spots.append([pp, 0.6])
		# Graffiti on the inside walls and grime at their foot.
		for i in 2:
			var on_back := i == 0
			var gp := Vector3(rng.randf_range(x0 + 2.0, x1 - 3.5), fy + rng.randf_range(1.2, 1.8), z1 - T - 0.005) if on_back \
					else Vector3(x0 + T + 0.005, fy + rng.randf_range(1.2, 1.8), rng.randf_range(z0 + 2.0, z1 - 2.0))
			var nrm := Vector3(0, 0, -1) if on_back else Vector3(1, 0, 0)
			var dcl := Decal.new()
			dcl.texture_albedo = Tex.graffiti(200 + int(rng.randi() % 60))
			var w := rng.randf_range(1.4, 2.4)
			dcl.size = Vector3(w, 0.3, w * 0.5)
			var right := Vector3.UP.cross(nrm).normalized()
			dcl.basis = Basis(right, nrm, right.cross(nrm))
			dcl.position = gp
			dcl.albedo_mix = 0.85
			dcl.cull_mask = 1
			dcl.upper_fade = 0.0
			dcl.lower_fade = 0.0
			mb.add_child(dcl)
		# Dirt splashed up the foot of the back wall.
		mb._grime_decal("base", Vector3((x0 + x1) * 0.5, fy + 0.45, z1 - T - 0.01), Vector3(0, 0.6, -1), x1 - x0 - 1.0, 0.9, k, 0.7)
	# Graffiti on the outside, low on the front.
	for i in 2:
		var dcl := Decal.new()
		dcl.texture_albedo = Tex.graffiti(260 + i + int(rng.randi() % 9))
		var w := rng.randf_range(2.0, 3.2)
		dcl.size = Vector3(w, 0.3, w * 0.5)
		var nrm := Vector3(0, 0, -1)
		var right := Vector3.UP.cross(nrm).normalized()
		dcl.basis = Basis(right, nrm, right.cross(nrm))
		dcl.position = Vector3(lerpf(x0 + 2.0, x1 - 2.0, 0.2 + 0.6 * i), 1.3, z0 - 0.005)
		dcl.albedo_mix = 0.9
		dcl.cull_mask = 1
		dcl.upper_fade = 0.0
		dcl.lower_fade = 0.0
		mb.add_child(dcl)


static func _lights(c: Dictionary) -> void:
	var LS = load("res://scripts/world/light_switch.gd")
	var mb: Node3D = c["mb"]
	var floors: Array = c["floors"]
	var x0: float = c["x0"]
	var x1: float = c["x1"]
	var z0: float = c["z0"]
	var z1: float = c["z1"]
	for k in 3:
		var fy: float = floors[k]
		var ceil := fy + H - SLAB
		var bulbs := [Vector3(x0 + (x1 - x0) * 0.3, ceil, (z0 + z1) * 0.5), Vector3(x0 + (x1 - x0) * 0.62, ceil, z0 + (z1 - z0) * 0.3)]
		if k == 0 and c["kind"] == "event":
			# Over the table: the hall's lamp.
			var hall: Dictionary = mb.event_hall
			bulbs = [(hall["center"] as Vector3) + Vector3(0, H - SLAB, 0), Vector3(x0 + 1.5, ceil, (z0 + z1) * 0.5)]
		# The switch by the stairwell's opening.
		var sx: float = float(c["bay_x0"]) - 0.17 if c["east"] else float(c["bay_x1"]) + 0.17
		LS.build(mb, Vector3(sx, fy + 1.35, float(c["sz0"]) + 0.6), Vector3.LEFT if c["east"] else Vector3.RIGHT, bulbs, k == 2)
