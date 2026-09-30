extends RefCounted
## Cuts a mesh in two along a plane. Every triangle is kept, dropped or
## clipped (new vertices interpolate position, normal and UV on the cut
## edge), and the edge points where the plane goes through the surface are
## collected so the opening can be closed with a cap.

## Returns {"pos": ArrayMesh or null, "neg": ArrayMesh or null,
## "ring": PackedVector3Array (points round the cut, unordered),
## "pos_pts"/"neg_pts": PackedVector3Array (vertices on each side, for hulls)}.
## All in the mesh's own space. `plane` is in the same space; "pos" is the
## side the normal points to.
static func slice(mesh: Mesh, plane: Plane, material: Material) -> Dictionary:
	var out := {"pos": null, "neg": null, "ring": PackedVector3Array(), "pos_pts": PackedVector3Array(), "neg_pts": PackedVector3Array()}
	# The look it had: an override passed in, else the mesh's own.
	if material == null:
		if mesh is PrimitiveMesh:
			material = (mesh as PrimitiveMesh).material
		elif mesh.get_surface_count() > 0:
			material = mesh.surface_get_material(0)
	var pos_st := SurfaceTool.new()
	var neg_st := SurfaceTool.new()
	pos_st.begin(Mesh.PRIMITIVE_TRIANGLES)
	neg_st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n_pos := 0
	var n_neg := 0
	# Packed arrays are values: collect locally, store at the end.
	var ring := PackedVector3Array()
	var pos_pts := PackedVector3Array()
	var neg_pts := PackedVector3Array()
	# Built-in shapes (capsules, spheres) hand over their arrays directly.
	var surfaces := []
	if mesh is PrimitiveMesh:
		surfaces.append((mesh as PrimitiveMesh).get_mesh_arrays())
	else:
		for s in mesh.get_surface_count():
			surfaces.append(mesh.surface_get_arrays(s))
	for arr in surfaces:
		if arr.is_empty() or arr[Mesh.ARRAY_VERTEX] == null:
			continue
		var v: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var nrm: PackedVector3Array = arr[Mesh.ARRAY_NORMAL] if arr[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
		var uv: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV] if arr[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
		var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX] if arr[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
		if idx.is_empty():
			idx.resize(v.size())
			for i in v.size():
				idx[i] = i
		var has_n := nrm.size() == v.size()
		var has_uv := uv.size() == v.size()
		for t in range(0, idx.size() - 2, 3):
			var tri := []
			for k in 3:
				var i := idx[t + k]
				tri.append([v[i], nrm[i] if has_n else Vector3.UP, uv[i] if has_uv else Vector2.ZERO, plane.distance_to(v[i])])
			var p_poly := _clip(tri, 1.0, ring)
			var n_poly := _clip(tri, -1.0, PackedVector3Array())
			n_pos += _emit(pos_st, p_poly)
			n_neg += _emit(neg_st, n_poly)
			for c in p_poly:
				pos_pts.append(c[0])
			for c in n_poly:
				neg_pts.append(c[0])
	out["ring"] = ring
	out["pos_pts"] = pos_pts
	out["neg_pts"] = neg_pts
	if n_pos > 0:
		out["pos"] = pos_st.commit()
		(out["pos"] as ArrayMesh).surface_set_material(0, material)
	if n_neg > 0:
		out["neg"] = neg_st.commit()
		(out["neg"] as ArrayMesh).surface_set_material(0, material)
	return out


## Keeps the part of the triangle on `side` (+1 / -1) of the plane. Corners are
## [position, normal, uv, distance]. Cut-edge points go into `ring`.
static func _clip(tri: Array, side: float, ring: PackedVector3Array) -> Array:
	var poly := []
	for k in 3:
		var a: Array = tri[k]
		var b: Array = tri[(k + 1) % 3]
		var da: float = a[3] * side
		var db: float = b[3] * side
		if da >= 0.0:
			poly.append(a)
		if (da >= 0.0) != (db >= 0.0):
			var t := da / (da - db)
			var c := [(a[0] as Vector3).lerp(b[0], t), (a[1] as Vector3).lerp(b[1], t).normalized(),
					(a[2] as Vector2).lerp(b[2], t), 0.0]
			poly.append(c)
			ring.append(c[0])
	return poly


static func _emit(st: SurfaceTool, poly: Array) -> int:
	if poly.size() < 3:
		return 0
	for k in range(1, poly.size() - 1):
		for c in [poly[0], poly[k], poly[k + 1]]:
			st.set_normal(c[1])
			st.set_uv(c[2])
			st.add_vertex(c[0])
	return poly.size() - 2


## Closes a cut: the points round the opening, sorted by angle round their
## centre, filled with a rim (skin/fat) and a torn, uneven surface of flesh.
## `facing` is the cap's outward normal. Returns [ArrayMesh, centre].
static func cap(ring: PackedVector3Array, facing: Vector3, rim_mat: Material, flesh_mat: Material, rng: RandomNumberGenerator) -> Array:
	if ring.size() < 3:
		return [null, Vector3.ZERO]
	var c := Vector3.ZERO
	for p in ring:
		c += p
	c /= ring.size()
	var n := facing.normalized()
	var u := n.cross(Vector3.UP)
	u = u.normalized() if u.length() > 0.05 else n.cross(Vector3.RIGHT).normalized()
	var w := n.cross(u)
	# Sort and drop near-duplicates (each edge point is found by two triangles).
	var pts := Array(ring)
	pts.sort_custom(func(a, b): return atan2((a - c).dot(w), (a - c).dot(u)) < atan2((b - c).dot(w), (b - c).dot(u)))
	var loop := PackedVector3Array()
	for p in pts:
		if loop.is_empty() or (p as Vector3).distance_to(loop[loop.size() - 1]) > 0.0015:
			loop.append(p)
	if loop.size() > 2 and loop[0].distance_to(loop[loop.size() - 1]) < 0.0015:
		loop.remove_at(loop.size() - 1)
	if loop.size() < 3:
		return [null, c]
	var rim := SurfaceTool.new()
	rim.begin(Mesh.PRIMITIVE_TRIANGLES)
	var flesh := SurfaceTool.new()
	flesh.begin(Mesh.PRIMITIVE_TRIANGLES)
	var inner := PackedVector3Array()
	for p in loop:
		# A little torn: the inner edge wavers, the flesh is not flat.
		inner.append(c + (p - c) * rng.randf_range(0.8, 0.9) + n * rng.randf_range(-0.003, 0.002))
	var centre := c + n * rng.randf_range(-0.006, 0.004)
	var m := loop.size()
	for k in m:
		var k2 := (k + 1) % m
		for v in [loop[k], loop[k2], inner[k2], loop[k], inner[k2], inner[k]]:
			rim.set_normal(n)
			rim.add_vertex(v)
		for v in [centre, inner[k], inner[k2]]:
			flesh.set_normal(n)
			flesh.add_vertex(v)
	var am := rim.commit()
	am.surface_set_material(0, rim_mat)
	flesh.commit(am)
	am.surface_set_material(1, flesh_mat)
	return [am, c]


## Convex hull points: every vertex would be slow to build, so thin them out.
static func hull_points(pts: PackedVector3Array, max_count := 48) -> PackedVector3Array:
	if pts.size() <= max_count:
		return pts
	var out := PackedVector3Array()
	var step := float(pts.size()) / max_count
	var f := 0.0
	while int(f) < pts.size():
		out.append(pts[int(f)])
		f += step
	return out
