extends RefCounted
## Wounds you can see into, cheap: a few small meshes stuck to the body part
## (they move with it for nothing), a handful per person at most.
##  - bullet holes: a dark puncture going in, ringed with raw red; where it
##    comes out a wider torn crater with bits of meat standing out of it;
##  - a saw or blade cut not (yet) right through: the kerf, a raw red gash
##    as long as the cut has gone, and - once it is deep - lumps of meat
##    hanging out of it (they sag the way the part hangs).

const MAX_PER_BODY := 48
const Tex = preload("res://scripts/world/textures.gd")

static var _dark: StandardMaterial3D
static var _raw: StandardMaterial3D
static var _meat: StandardMaterial3D
static var _disc: SphereMesh
static var _lump: SphereMesh


static func _mats() -> void:
	if _dark:
		return
	# Dark, wet, matt-ish: flesh in a hole is almost black-red, never pink,
	# and it does not shine like plastic.
	_dark = StandardMaterial3D.new()
	_dark.albedo_color = Color(0.025, 0.0, 0.0)
	_dark.roughness = 0.5
	_dark.metallic_specular = 0.3
	_raw = StandardMaterial3D.new()
	_raw.albedo_color = Color(0.2, 0.012, 0.01)
	_raw.roughness = 0.42
	_raw.metallic_specular = 0.35
	_meat = StandardMaterial3D.new()
	_meat.albedo_color = Color(0.26, 0.03, 0.025)
	_meat.roughness = 0.5
	_meat.metallic_specular = 0.3
	_meat.normal_enabled = true
	_meat.normal_texture = Tex.noise("wound_flesh", 0.35, 3, 64, true, 2.0)
	_disc = SphereMesh.new()
	_disc.radius = 1.0
	_disc.height = 2.0
	_disc.radial_segments = 10
	_disc.rings = 4
	_lump = SphereMesh.new()
	_lump.radius = 1.0
	_lump.height = 2.0
	_lump.radial_segments = 6
	_lump.rings = 3


static func _add(part: RigidBody3D, mesh: Mesh, mat: Material, xf: Transform3D) -> MeshInstance3D:
	var h = part.get_meta("humanoid") if part.has_meta("humanoid") else null
	if h:
		var n: int = h.get_meta("wound_meshes", 0)
		if n >= MAX_PER_BODY:
			return null
		h.set_meta("wound_meshes", n + 1)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.layers = 2
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	part.add_child(mi)
	mi.global_transform = xf
	return mi


## A basis whose Z is `n` (a flattened sphere along Z makes a disc on the skin).
static func _facing(n: Vector3) -> Basis:
	var z := n.normalized()
	var x := z.cross(Vector3.UP if absf(z.y) < 0.9 else Vector3.RIGHT).normalized()
	return Basis(x, z.cross(x), z)


## A bullet went in at `at` (heading `dir`), out at `exit` (INF if it stayed in).
## Nothing stands up off the body: the edges are flat, torn and uneven, the
## middle a dark hole going in.
static func bullet(part: RigidBody3D, at: Vector3, dir: Vector3, exit: Vector3, big: bool) -> void:
	_mats()
	var n := -dir.normalized()
	var r := 0.008 if not big else 0.011
	# Going in: small; a torn ragged rim round a dark hole.
	var b := _facing(n).rotated(n, randf() * TAU)
	_rim(part, b, at, n, r * 1.5, 3)
	_add(part, _disc, _dark, Transform3D(b.scaled(Vector3(r * 0.8, r * 0.7, r * 0.3)), at + n * 0.003))
	if exit == Vector3.INF:
		return
	# Coming out: wider and torn outwards - flaps of it lying back flat.
	var ne := dir.normalized()
	var be := _facing(ne).rotated(ne, randf() * TAU)
	var re := r * (2.4 if big else 2.0)
	_rim(part, be, exit, ne, re, 5)
	_add(part, _disc, _dark, Transform3D(be.scaled(Vector3(re * 0.55, re * 0.45, re * 0.3)), exit + ne * 0.004))


## Ragged torn edge: a few flat, uneven dark-red scraps round the hole.
static func _rim(part: RigidBody3D, b: Basis, at: Vector3, n: Vector3, r: float, count: int) -> void:
	for k in count:
		var a := TAU * k / count + randf_range(-0.4, 0.4)
		var off := (b.x * cos(a) + b.y * sin(a)) * r * randf_range(0.3, 0.6)
		var s := r * randf_range(0.55, 0.9)
		var bb := b.rotated(n, a + randf_range(-0.5, 0.5))
		_add(part, _disc, _meat if k % 2 == 0 else _raw,
				Transform3D(bb.scaled(Vector3(s * randf_range(1.0, 1.6), s * randf_range(0.5, 0.8), s * 0.18)), at + off + n * 0.002))


## The cut so far in `part` (blade_cut.gd's state for it): the gash is laid
## (or lengthened) along the stretch opened, lumps hung out once it is deep.
static func cut(part: RigidBody3D, st: Dictionary) -> void:
	_mats()
	var lo: float = st["lo"]
	var hi: float = st["hi"]
	var mn: float = st["min"]
	var mx: float = st["max"]
	var span := mx - mn
	if span <= 0.001:
		return
	var open_k := (hi - lo) / span
	if open_k < 0.12:
		return
	var n: Vector3 = st["n"]
	var o: Vector3 = st["o"]
	var w: Vector3 = st["w"]
	var d := n.cross(w).normalized()
	# In the part's own space: the gash across the opened stretch.
	var centre := o + w * (lo + hi) * 0.5
	var basis := Basis(w * (hi - lo), d * span * 0.95, n * 0.02)
	var gash: MeshInstance3D = st.get("gash")
	if gash == null or not is_instance_valid(gash):
		var box := BoxMesh.new()
		box.size = Vector3.ONE
		gash = _add(part, box, _raw, part.global_transform * Transform3D(basis, centre))
		if gash == null:
			return
		st["gash"] = gash
		# The dark line of the kerf itself down its middle.
		var core := MeshInstance3D.new()
		var cb := BoxMesh.new()
		cb.size = Vector3(1.0, 1.0, 1.4)
		core.mesh = cb
		core.material_override = _dark
		core.layers = 2
		core.scale = Vector3(0.96, 0.9, 1.0)
		gash.add_child(core)
	else:
		gash.transform = Transform3D(basis, centre)
	# Deep in: meat hangs out of it, at the open edges, sagging downwards.
	var hung: int = st.get("hung", 0)
	var want := 0 if open_k < 0.35 else (2 if open_k < 0.65 else 4)
	while hung < want:
		var at_w: float = lerpf(lo, hi, randf())
		var side := 1.0 if hung % 2 == 0 else -1.0
		var p := o + w * at_w + n * side * 0.015 + d * randf_range(-0.4, 0.4) * span
		var down := (part.global_basis.inverse() * Vector3.DOWN).normalized()
		var s := randf_range(0.012, 0.022)
		var lb := Basis.looking_at(down, n if absf(n.dot(down)) < 0.9 else w)
		var m := _add(part, _lump, _meat, part.global_transform * Transform3D(lb.scaled(Vector3(s, s * 0.8, s * 2.4)), p + down * s * 1.6 + n * side * 0.01))
		if m == null:
			break
		hung += 1
	st["hung"] = hung
