extends RefCounted
## What people left behind in the abandoned building - or brought in to live
## there: beds (lie down and sleep the day or the night away), chairs and a
## sofa to sit on (the player: F; the people here sit on them too, see
## activities.gd), an old CRT television that still shows something, tables,
## a wardrobe, shelves, rugs, mattresses on the floor.
##
## The looks go into the level's merged meshes (geo); each thing that can be
## used has a static body of its own with what it is in its meta ("seat",
## "bed"), which is what the player's F looks for.

const Mat = preload("res://scripts/world/materials.gd")
const Tv = preload("res://scripts/world/tv.gd")

const F1 := 0.15
const F2 := 3.4

## Every seat: {"pos": floor point in front of the seat centre, "seat": seat
## surface point, "yaw": facing, "kind": "chair"/"sofa", "look": what one
## sitting there looks at (a TV), or INF}.
static var seats: Array = []
static var beds: Array = []


static func build(mb: Node3D) -> void:
	seats.clear()
	beds.clear()
	var geo = mb.geo
	var wood := Mat.wood("furn_wood", Color(0.32, 0.21, 0.13), 0.75)
	var dark := Mat.wood("furn_dark", Color(0.2, 0.13, 0.08), 0.8)
	var metal := Mat.standard("bed_metal", Color(0.3, 0.32, 0.33), 0.45, 0.7)
	var cloth := Mat.standard("mattress_old", Color(0.6, 0.56, 0.47), 0.95)
	var blanket := Mat.standard("blanket", Color(0.35, 0.18, 0.15), 0.95)
	var blanket2 := Mat.standard("blanket2", Color(0.2, 0.26, 0.33), 0.95)
	var sofa_m := Mat.standard("sofa_green", Color(0.2, 0.25, 0.18), 0.95)
	# --- First floor, east room (x 2..10, z -17.5..-8.3): someone's flat.
	_bed(mb, geo, Vector3(8.6, F2, -16.2), PI * 0.5, metal, cloth, blanket)
	_bed(mb, geo, Vector3(6.0, F2, -16.6), 0.0, metal, cloth, blanket2)
	_wardrobe(geo, Vector3(9.55, F2, -12.3), -PI * 0.5, dark)
	_rug(mb, Vector3(5.8, F2 + 0.005, -11.6), Vector2(2.6, 1.8), Color(0.45, 0.14, 0.1))
	var tv_at := Vector3(5.8, F2, -9.0)
	_tv_stand(geo, tv_at, wood)
	var tv := Tv.new()
	tv.name = "TV"
	mb.add_child(tv)
	tv.global_transform = Transform3D(Basis(Vector3.UP, PI), tv_at + Vector3(0, 0.62, 0))
	var tv_look := tv_at + Vector3(0, 0.85, 0)
	_sofa(mb, geo, Vector3(5.8, F2, -13.3), 0.0, sofa_m, tv_look)
	_chair(mb, geo, Vector3(3.6, F2, -11.2), PI * 0.5 + 0.35, wood, tv_look)
	_table(geo, Vector3(3.4, F2, -9.6), Vector2(0.9, 0.6), wood)
	_chair(mb, geo, Vector3(3.4, F2, -10.3), 0.0, wood, Vector3.INF)
	_shelf(geo, Vector3(2.25, F2, -15.5), PI * 0.5, dark)
	# --- First floor, west: squatters' corner.
	_mattress(mb, geo, Vector3(-7.8, F2, -19.6), 0.1, cloth, blanket2)
	_mattress(mb, geo, Vector3(-5.6, F2, -19.8), -0.15, cloth, blanket)
	_table(geo, Vector3(-3.5, F2, -10.8), Vector2(0.8, 0.8), wood)
	for k in 3:
		var a := TAU * k / 3.0 + 0.4
		var c := Vector3(-3.5, F2, -10.8) + Vector3(cos(a), 0, sin(a)) * 0.75
		_chair(mb, geo, c, atan2(-cos(a), -sin(a)) + PI, wood, Vector3.INF)
	# --- Ground floor, west half: an old sofa and chairs round a crate.
	_sofa(mb, geo, Vector3(-7.5, F1, -9.3), PI, sofa_m, Vector3.INF)
	_crate_table(geo, Vector3(-7.5, F1, -10.6), dark)
	_chair(mb, geo, Vector3(-6.0, F1, -10.8), -PI * 0.5, wood, Vector3.INF)
	_chair(mb, geo, Vector3(-3.0, F1, -19.5), PI * 0.15, wood, Vector3.INF)
	_bed(mb, geo, Vector3(-8.7, F1, -20.3), PI * 0.5, metal, cloth, blanket)


static func _floor_body(mb: Node3D, xf: Transform3D, size: Vector3, meta: String, info: Dictionary) -> StaticBody3D:
	var sb := StaticBody3D.new()
	sb.collision_layer = Game.LAYER_WORLD
	sb.collision_mask = 0
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	sb.add_child(cs)
	sb.set_meta(meta, info)
	sb.set_meta("surface", "wood")
	mb.nav_region.add_child(sb)
	sb.global_transform = xf
	return sb


static func _bed(mb: Node3D, geo, at: Vector3, yaw: float, frame: Material, cloth: Material, cover: Material) -> void:
	var b := Basis(Vector3.UP, yaw)
	var r := Vector3(0, yaw, 0)
	# An iron bedstead: head and foot rails, the frame, the sagging mattress.
	for end in [-1.0, 1.0]:
		var h := 0.95 if end < 0 else 0.7
		for sx in [-1.0, 1.0]:
			geo.box(at + b * Vector3(0.44 * sx, h * 0.5, 0.98 * end), Vector3(0.04, h, 0.04), frame, r, false)
		geo.box(at + b * Vector3(0, h - 0.03, 0.98 * end), Vector3(0.92, 0.035, 0.035), frame, r, false)
		for k in 4:
			geo.box(at + b * Vector3(-0.3 + k * 0.2, h * 0.62, 0.98 * end), Vector3(0.02, h * 0.55, 0.02), frame, r, false)
	for sx in [-1.0, 1.0]:
		geo.box(at + b * Vector3(0.44 * sx, 0.36, 0), Vector3(0.04, 0.05, 1.96), frame, r, false)
	geo.box(at + b * Vector3(0, 0.45, 0), Vector3(0.86, 0.16, 1.9), cloth, r, false)
	# A crumpled blanket and a pillow.
	geo.box(at + b * Vector3(0.02, 0.55, 0.28), Vector3(0.88, 0.05, 1.2), cover, r + Vector3(0.03, 0, 0.04), false)
	geo.box(at + b * Vector3(-0.1, 0.6, 0.4), Vector3(0.5, 0.08, 0.35), cover, r + Vector3(0.2, 0.3, 0.1), false)
	geo.box(at + b * Vector3(0, 0.58, -0.75), Vector3(0.6, 0.1, 0.32), Mat.standard("pillow", Color(0.78, 0.76, 0.7), 0.95), r, false)
	var info := {"at": at, "yaw": yaw, "lie": at + b * Vector3(0, 0.62, 0.05), "head": at + b * Vector3(0, 0.68, -0.72)}
	_floor_body(mb, Transform3D(b, at + Vector3(0, 0.3, 0)), Vector3(0.95, 0.6, 2.0), "bed", info)
	beds.append(info)


static func _mattress(mb: Node3D, geo, at: Vector3, yaw: float, cloth: Material, cover: Material) -> void:
	var b := Basis(Vector3.UP, yaw)
	var r := Vector3(0, yaw, 0)
	geo.box(at + Vector3(0, 0.09, 0), Vector3(0.9, 0.18, 1.9), cloth, r, false)
	geo.box(at + b * Vector3(0.05, 0.2, 0.3), Vector3(0.95, 0.05, 1.1), cover, r + Vector3(0.02, 0.1, 0.03), false)
	var info := {"at": at, "yaw": yaw, "lie": at + b * Vector3(0, 0.26, 0.05), "head": at + b * Vector3(0, 0.3, -0.72)}
	_floor_body(mb, Transform3D(b, at + Vector3(0, 0.09, 0)), Vector3(0.9, 0.18, 1.9), "bed", info)
	beds.append(info)


## A kitchen chair: legs, seat, back. Faces its `yaw` (+Z turned).
static func _chair(mb: Node3D, geo, at: Vector3, yaw: float, wood: Material, look: Vector3) -> void:
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
	var fwd := b * Vector3(0, 0, 1)
	var info := {"pos": at, "seat": at + Vector3(0, 0.47, 0), "yaw": yaw, "kind": "chair", "look": look,
			"stand": at + fwd * 0.5}
	_floor_body(mb, Transform3D(b, at + Vector3(0, 0.3, 0)), Vector3(0.44, 0.6, 0.44), "seat", info)
	seats.append(info)


## An old sofa: three places, facing its `yaw`.
static func _sofa(mb: Node3D, geo, at: Vector3, yaw: float, cloth: Material, look: Vector3) -> void:
	var b := Basis(Vector3.UP, yaw)
	var r := Vector3(0, yaw, 0)
	geo.box(at + Vector3(0, 0.22, 0), Vector3(1.9, 0.36, 0.85), cloth, r, false)
	geo.box(at + b * Vector3(0, 0.62, -0.33), Vector3(1.9, 0.5, 0.2), cloth, r, false)
	for sx in [-1.0, 1.0]:
		geo.box(at + b * Vector3(0.85 * sx, 0.5, 0), Vector3(0.2, 0.3, 0.85), cloth, r, false)
	for k in 3:
		geo.box(at + b * Vector3(-0.55 + k * 0.55, 0.44, 0.05), Vector3(0.52, 0.1, 0.62), cloth, r + Vector3(0.0, 0.0, 0.02 * (k - 1)), false)
	var fwd := b * Vector3(0, 0, 1)
	var sb := _floor_body(mb, Transform3D(b, at + Vector3(0, 0.4, 0)), Vector3(1.9, 0.8, 0.85), "seat", {})
	var infos: Array = []
	for k in 3:
		var p := at + b * Vector3(-0.55 + k * 0.55, 0.0, 0.05)
		var info := {"pos": p, "seat": p + Vector3(0, 0.5, 0), "yaw": yaw, "kind": "sofa", "look": look, "stand": p + fwd * 0.55}
		seats.append(info)
		infos.append(info)
	sb.set_meta("seat", infos[1])
	sb.set_meta("seats", infos)


static func _table(geo, at: Vector3, size: Vector2, wood: Material) -> void:
	geo.box(at + Vector3(0, 0.74, 0), Vector3(size.x, 0.04, size.y), wood)
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			geo.box(at + Vector3((size.x * 0.5 - 0.05) * sx, 0.36, (size.y * 0.5 - 0.05) * sz), Vector3(0.05, 0.72, 0.05), wood, Vector3.ZERO, false)
	# Clutter on it: a bottle, a mug, an ashtray.
	geo.box(at + Vector3(0.15, 0.85, 0.05), Vector3(0.07, 0.18, 0.07), Mat.glass(Color(0.15, 0.35, 0.12)), Vector3.ZERO, false)
	geo.box(at + Vector3(-0.2, 0.8, -0.1), Vector3(0.08, 0.09, 0.08), Mat.standard("mug", Color(0.8, 0.8, 0.75), 0.5), Vector3.ZERO, false)


static func _crate_table(geo, at: Vector3, wood: Material) -> void:
	geo.box(at + Vector3(0, 0.25, 0), Vector3(0.6, 0.5, 0.45), wood)
	geo.box(at + Vector3(0, 0.51, 0), Vector3(0.64, 0.02, 0.5), wood, Vector3.ZERO, false)


static func _wardrobe(geo, at: Vector3, yaw: float, wood: Material) -> void:
	var b := Basis(Vector3.UP, yaw)
	var r := Vector3(0, yaw, 0)
	geo.box(at + Vector3(0, 0.95, 0), Vector3(1.1, 1.9, 0.55) if absf(sin(yaw)) < 0.5 else Vector3(0.55, 1.9, 1.1), wood)
	# Doors: one hanging open.
	geo.box(at + b * Vector3(-0.27, 0.95, 0.285), Vector3(0.52, 1.8, 0.02), wood, r, false)
	geo.box(at + b * Vector3(0.45, 0.95, 0.5), Vector3(0.52, 1.8, 0.02), wood, r + Vector3(0, -1.1, 0), false)
	geo.box(at + b * Vector3(-0.05, 1.0, 0.3), Vector3(0.02, 0.1, 0.02), Mat.standard("knob", Color(0.6, 0.55, 0.4), 0.4, 0.8), r, false)


static func _shelf(geo, at: Vector3, yaw: float, wood: Material) -> void:
	var b := Basis(Vector3.UP, yaw)
	var r := Vector3(0, yaw, 0)
	for sx in [-1.0, 1.0]:
		geo.box(at + b * Vector3(0.55 * sx, 0.8, 0), Vector3(0.03, 1.6, 0.3), wood, r, false)
	for k in 4:
		geo.box(at + b * Vector3(0, 0.1 + k * 0.48, 0), Vector3(1.12, 0.03, 0.3), wood, r, false)
	# Books, jars.
	var rng := RandomNumberGenerator.new()
	rng.seed = 91
	for k in 3:
		for i in rng.randi_range(2, 5):
			var h := rng.randf_range(0.15, 0.26)
			var col := Color(rng.randf_range(0.2, 0.6), rng.randf_range(0.15, 0.4), rng.randf_range(0.1, 0.35))
			geo.box(at + b * Vector3(-0.45 + i * 0.12, 0.13 + k * 0.48 + h * 0.5, 0), Vector3(0.05, h, 0.2), Mat.standard("book_%d" % (i % 4), col, 0.8), r + Vector3(0, 0, rng.randf_range(-0.2, 0.2)), false)
	geo.add_collision_box(Transform3D(b, at + Vector3(0, 0.8, 0)), Vector3(1.14, 1.6, 0.3))


static func _tv_stand(geo, at: Vector3, wood: Material) -> void:
	geo.box(at + Vector3(0, 0.3, 0), Vector3(1.0, 0.6, 0.45), wood)


static func _rug(mb: Node3D, at: Vector3, size: Vector2, col: Color) -> void:
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = size
	mi.mesh = pm
	# (the level's blood shader: blood soaks into it like into the floor)
	var m: Material = Mat.wood("rug_" + col.to_html(false), col, 1.0)
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = at
	mb.add_child(mi)
	# A pattern border.
	var border := MeshInstance3D.new()
	var bp := PlaneMesh.new()
	bp.size = size - Vector2(0.25, 0.25)
	border.mesh = bp
	border.material_override = Mat.wood("rug_" + col.lightened(0.25).to_html(false), col.lightened(0.25), 1.0)
	border.position = at + Vector3(0, 0.002, 0)
	border.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mb.add_child(border)
	var inner := MeshInstance3D.new()
	var ip := PlaneMesh.new()
	ip.size = size - Vector2(0.4, 0.4)
	inner.mesh = ip
	inner.material_override = m
	inner.position = at + Vector3(0, 0.004, 0)
	inner.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mb.add_child(inner)


## The nearest seat to `p` of those not taken, or {}.
static func seat_near(p: Vector3, reach: float) -> Dictionary:
	var best := {}
	var bd := reach
	for s in seats:
		var d := p.distance_to(s["pos"])
		if d < bd:
			bd = d
			best = s
	return best
