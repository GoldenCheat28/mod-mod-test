extends RefCounted
## Parts cut out in profile and given a thickness, the way gun parts (and
## plenty of other things) really are shaped: a side-view outline in the
## (z, y) plane, extruded to +-half along x, with its faces and edges lit
## flat. Makes silhouettes that read as the real thing where a stack of
## boxes reads as a toy.


static func extrude(outline: PackedVector2Array, half: float, mat: Material, bevel := 0.0008) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = extrude_mesh(outline, half, bevel)
	mi.material_override = mat
	return mi


static func extrude_mesh(outline: PackedVector2Array, half: float, bevel := 0.0008) -> ArrayMesh:
	var pts := outline
	# Counter-clockwise seen from +x.
	var area := 0.0
	for i in pts.size():
		var a := pts[i]
		var b := pts[(i + 1) % pts.size()]
		area += a.x * b.y - b.x * a.y
	if area < 0.0:
		pts = pts.duplicate()
		pts.reverse()
	var tris := Geometry2D.triangulate_polygon(pts)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	# The two flat sides, a little smaller than the edge band (a small bevel
	# catches the light along the edges).
	var inner := _inset(pts, bevel)
	for side in [1.0, -1.0]:
		var n := Vector3(side, 0, 0)
		for i in range(0, tris.size(), 3):
			var v0 := Vector3(half * side, inner[tris[i]].y, inner[tris[i]].x)
			var v1 := Vector3(half * side, inner[tris[i + 1]].y, inner[tris[i + 1]].x)
			var v2 := Vector3(half * side, inner[tris[i + 2]].y, inner[tris[i + 2]].x)
			# Godot's front faces wind clockwise: the cross of the edges points in.
			var verts := [v0, v1, v2] if (v1 - v0).cross(v2 - v0).dot(n) < 0.0 else [v0, v2, v1]
			for v in verts:
				st.set_normal(n)
				st.add_vertex(v)
	# Round the outline: the bevel and the edge faces.
	for i in pts.size():
		var j := (i + 1) % pts.size()
		var a := pts[i]
		var b := pts[j]
		var ai: Vector2 = inner[i]
		var bi: Vector2 = inner[j]
		var e := (b - a).normalized()
		# Outward: away from the inside of the outline (checked, not assumed).
		var n2 := Vector2(e.y, -e.x)
		var mid := (a + b) * 0.5
		if Geometry2D.is_point_in_polygon(mid + n2 * 0.0005, pts):
			n2 = -n2
		var out := Vector3(0, n2.y, n2.x)
		# Edge band (straight across the thickness, less the bevel).
		_quad(st, Vector3(half - bevel, a.y, a.x), Vector3(half - bevel, b.y, b.x),
				Vector3(-half + bevel, b.y, b.x), Vector3(-half + bevel, a.y, a.x), out)
		for side in [1.0, -1.0]:
			var bn := (out + Vector3(side, 0, 0)).normalized()
			if side > 0.0:
				_quad(st, Vector3(half, ai.y, ai.x), Vector3(half, bi.y, bi.x), Vector3(half - bevel, b.y, b.x), Vector3(half - bevel, a.y, a.x), bn)
			else:
				_quad(st, Vector3(-half + bevel, a.y, a.x), Vector3(-half + bevel, b.y, b.x), Vector3(-half, bi.y, bi.x), Vector3(-half, ai.y, ai.x), bn)
	return st.commit()


static func _quad(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, d: Vector3, n: Vector3) -> void:
	# Wound so the normal given faces out.
	var face := (b - a).cross(c - a)
	var verts := [a, b, c, a, c, d] if face.dot(n) < 0.0 else [a, c, b, a, d, c]
	for v in verts:
		st.set_normal(n)
		st.add_vertex(v)


## The outline pulled in by `d` (for the bevel).
static func _inset(pts: PackedVector2Array, d: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	var n := pts.size()
	for i in n:
		var p := pts[i]
		var a := (p - pts[(i - 1 + n) % n]).normalized()
		var b := (pts[(i + 1) % n] - p).normalized()
		var na := Vector2(-a.y, a.x)
		var nb := Vector2(-b.y, b.x)
		var m := (na + nb)
		m = m.normalized() if m.length() > 1e-4 else na
		out.append(p + m * d)
	return out


# --- Lofted solids ------------------------------------------------------------------------

## A closed ring of points: a rectangle `w` x `h` with corners rounded by
## `r` (each corner split in `seg` steps), centred on (cx, cy). Every ring
## made with the same `seg` has the same number of points, so rings of
## different sizes can be lofted into one another. `r_top` rounds the two
## upper corners differently (a rounded top over a flat bottom).
static func rrect(w: float, h: float, r: float, seg := 4, cx := 0.0, cy := 0.0, r_top := -1.0) -> PackedVector2Array:
	var pts := PackedVector2Array()
	var rt := r if r_top < 0.0 else r_top
	var hw := w * 0.5
	var hh := h * 0.5
	# corners: bottom-right, top-right, top-left, bottom-left (counter-clockwise)
	var corners := [[Vector2(hw, -hh), minf(r, minf(hw, hh)), -PI * 0.5],
			[Vector2(hw, hh), minf(rt, minf(hw, hh)), 0.0],
			[Vector2(-hw, hh), minf(rt, minf(hw, hh)), PI * 0.5],
			[Vector2(-hw, -hh), minf(r, minf(hw, hh)), PI]]
	for c in corners:
		var p: Vector2 = c[0]
		var cr: float = c[1]
		var a0: float = c[2]
		var centre := p - Vector2(signf(p.x), signf(p.y)) * cr
		for k in seg + 1:
			var a := a0 + PI * 0.5 * float(k) / seg
			pts.append(centre + Vector2(cos(a), sin(a)) * cr + Vector2(cx, cy))
	return pts


## A smooth solid through `sections`: each is [Transform3D, ring], the ring's
## points in the transform's local x/y plane (all rings the same size). The
## sides are shaded smooth; the two ends are capped flat.
static func loft(sections: Array, mat: Material, cap_start := true, cap_end := true) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = loft_mesh(sections, cap_start, cap_end)
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


static func loft_mesh(sections: Array, cap_start := true, cap_end := true) -> ArrayMesh:
	var rings: Array = []
	var centres: Array = []
	for s in sections:
		var xf: Transform3D = s[0]
		var ring: PackedVector2Array = s[1]
		var pts := PackedVector3Array()
		var c := Vector3.ZERO
		for p in ring:
			var v := xf * Vector3(p.x, p.y, 0.0)
			pts.append(v)
			c += v
		rings.append(pts)
		centres.append(c / ring.size())
	var n: int = (rings[0] as PackedVector3Array).size()
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in rings.size() - 1:
		var ra: PackedVector3Array = rings[i]
		var rb: PackedVector3Array = rings[i + 1]
		var mid: Vector3 = (centres[i] + centres[i + 1]) * 0.5
		for k in n:
			var k2 := (k + 1) % n
			var a := ra[k]
			var b := ra[k2]
			var c := rb[k2]
			var d := rb[k]
			var out := ((a + b + c + d) * 0.25 - mid)
			_tri_out(st, a, b, c, out)
			_tri_out(st, a, c, d, out)
	st.index()
	st.generate_normals()
	var mesh := st.commit()
	# Flat caps, a surface of their own so the sides stay smooth.
	var cap := SurfaceTool.new()
	cap.begin(Mesh.PRIMITIVE_TRIANGLES)
	var any_cap := false
	for which in [0, rings.size() - 1]:
		if (which == 0 and not cap_start) or (which != 0 and not cap_end):
			continue
		any_cap = true
		var ring2: PackedVector2Array = sections[which][1]
		var ring3: PackedVector3Array = rings[which]
		var other: Vector3 = centres[1] if which == 0 else centres[rings.size() - 2]
		var nrm: Vector3 = ((centres[which] as Vector3) - other).normalized()
		var tris := Geometry2D.triangulate_polygon(ring2)
		if tris.is_empty():
			var r2 := ring2.duplicate()
			r2.reverse()
			tris = Geometry2D.triangulate_polygon(r2)
			for t in tris.size():
				tris[t] = ring2.size() - 1 - tris[t]
		for t in range(0, tris.size(), 3):
			var a := ring3[tris[t]]
			var b := ring3[tris[t + 1]]
			var c := ring3[tris[t + 2]]
			var verts := [a, b, c] if (b - a).cross(c - a).dot(nrm) < 0.0 else [a, c, b]
			for v in verts:
				cap.set_normal(nrm)
				cap.add_vertex(v)
	if any_cap:
		cap.commit(mesh)
	return mesh


## One triangle wound so its front faces `out` (Godot: clockwise from the front).
static func _tri_out(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, out: Vector3) -> void:
	if (b - a).cross(c - a).dot(out) < 0.0:
		st.add_vertex(a)
		st.add_vertex(b)
		st.add_vertex(c)
	else:
		st.add_vertex(a)
		st.add_vertex(c)
		st.add_vertex(b)


## Sections along a path in the gun's side (y, z) plane: at each point the
## ring stands square to the path, its x across the gun, its y up for a path
## running forward (-z) and forward for one running down. `rings` is one ring
## for all points or one per point.
static func sweep(path: Array, rings: Variant, mat: Material, cap_start := true, cap_end := true) -> MeshInstance3D:
	var sections: Array = []
	for i in path.size():
		var p: Vector3 = path[i]
		var prev: Vector3 = path[maxi(i - 1, 0)]
		var nxt: Vector3 = path[mini(i + 1, path.size() - 1)]
		var t := (nxt - prev).normalized()
		# (x across the gun; y "up" as seen travelling along the path - up for a
		# path running forward, forward for one running down)
		var x := Vector3.RIGHT
		var y := x.cross(t).normalized()
		var z := x.cross(y).normalized()
		var ring: PackedVector2Array = rings[i] if rings is Array else rings
		sections.append([Transform3D(Basis(x, y, z), p), ring])
	return loft(sections, mat, cap_start, cap_end)
