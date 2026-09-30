extends RefCounted
## Level geometry builder. Static pieces are merged into one mesh per
## material per patch of ground (CHUNK m square) and one compound
## StaticBody3D: few draw calls, and what is out of view (or out of a
## shadow's reach) is still culled patch by patch - a bigger map does not
## mean drawing all of it all the time.

const CHUNK := 24.0

var _tools := {}        # [Material, patch] -> {v, n, t, uv, i}: the merged vertex arrays
var _body: StaticBody3D
var _root: Node3D


func _init(root: Node3D) -> void:
	_root = root
	_body = StaticBody3D.new()
	_body.name = "LevelCollision"
	_body.collision_layer = Game.LAYER_WORLD
	_body.collision_mask = 0
	_root.add_child(_body)


func _tool(mat: Material, at := Vector3.ZERO) -> Dictionary:
	var key := [mat, Vector2i(floori(at.x / CHUNK), floori(at.z / CHUNK))]
	if not _tools.has(key):
		_tools[key] = {"v": PackedVector3Array(), "n": PackedVector3Array(), "t": PackedFloat32Array(),
				"uv": PackedVector2Array(), "i": PackedInt32Array(), "mat": mat}
	return _tools[key]


## A mesh's vertex arrays, read on the CPU side: a primitive makes them
## there; our own meshes keep theirs (meta "arrays"). (Asking the mesh itself
## - surface_get_arrays, SurfaceTool.append_from - reads them back from the
## graphics card, which with thousands of pieces made loading take minutes.)
static func arrays_of(mesh: Mesh, surface := 0) -> Array:
	if mesh is PrimitiveMesh:
		return (mesh as PrimitiveMesh).get_mesh_arrays()
	if mesh.has_meta("arrays"):
		return mesh.get_meta("arrays")
	return mesh.surface_get_arrays(surface)


## Adds a mesh (visual only) with a transform.
func add_mesh(mesh: Mesh, xf: Transform3D, mat: Material) -> void:
	var surfaces := 1 if mesh is PrimitiveMesh or mesh.has_meta("arrays") else mesh.get_surface_count()
	for s in surfaces:
		_append(_tool(mat, xf.origin), arrays_of(mesh, s), xf)


func _append(acc: Dictionary, arr: Array, xf: Transform3D) -> void:
	# (packed arrays in a dictionary are values: each is taken out, added to
	# and put back)
	var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var n := verts.size()
	var v_all: PackedVector3Array = acc["v"]
	var base := v_all.size()
	v_all.append_array(xf * verts)
	acc["v"] = v_all
	var nb := xf.basis.orthonormalized()
	var n_all: PackedVector3Array = acc["n"]
	var norms = arr[Mesh.ARRAY_NORMAL]
	if norms is PackedVector3Array and (norms as PackedVector3Array).size() == n:
		n_all.append_array(Transform3D(nb, Vector3.ZERO) * (norms as PackedVector3Array))
	else:
		var up := PackedVector3Array()
		up.resize(n)
		up.fill(Vector3.UP)
		n_all.append_array(up)
	acc["n"] = n_all
	var tn := PackedFloat32Array()
	tn.resize(n * 4)
	var tans = arr[Mesh.ARRAY_TANGENT]
	if tans is PackedFloat32Array and (tans as PackedFloat32Array).size() == n * 4:
		var ta: PackedFloat32Array = tans
		for k in n:
			var tv := nb * Vector3(ta[k * 4], ta[k * 4 + 1], ta[k * 4 + 2])
			tn[k * 4] = tv.x
			tn[k * 4 + 1] = tv.y
			tn[k * 4 + 2] = tv.z
			tn[k * 4 + 3] = ta[k * 4 + 3]
	else:
		for k in n:
			tn[k * 4] = 1.0
			tn[k * 4 + 3] = 1.0
	var t_all: PackedFloat32Array = acc["t"]
	t_all.append_array(tn)
	acc["t"] = t_all
	var uv_all: PackedVector2Array = acc["uv"]
	var uvs = arr[Mesh.ARRAY_TEX_UV]
	if uvs is PackedVector2Array and (uvs as PackedVector2Array).size() == n:
		uv_all.append_array(uvs)
	else:
		var z := PackedVector2Array()
		z.resize(n)
		uv_all.append_array(z)
	acc["uv"] = uv_all
	var idx = arr[Mesh.ARRAY_INDEX]
	var out: PackedInt32Array = acc["i"]
	var start := out.size()
	if idx is PackedInt32Array and (idx as PackedInt32Array).size() > 0:
		var ia: PackedInt32Array = idx
		out.resize(start + ia.size())
		for k in ia.size():
			out[start + k] = ia[k] + base
	else:
		out.resize(start + n)
		for k in n:
			out[start + k] = base + k
	acc["i"] = out


func add_collision_box(xf: Transform3D, size: Vector3) -> void:
	var cs := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	cs.shape = shape
	cs.transform = xf
	_body.add_child(cs)


## Solid box with collision. `pos` is the box centre.
func box(pos: Vector3, size: Vector3, mat: Material, rot := Vector3.ZERO, collide := true) -> void:
	var xf := Transform3D(Basis.from_euler(rot), pos)
	if rot == Vector3.ZERO:
		# Drawn at commit(), after faces lying on top of each other are sorted out.
		_boxes.append([pos, size, mat])
	else:
		var m := BoxMesh.new()
		m.size = size
		add_mesh(m, xf, mat)
	if collide:
		add_collision_box(xf, size)


var _boxes: Array = []          # [centre, size, material] of the axis-aligned boxes


## Two boxes with a face in the same plane, turned the same way and
## overlapping, flicker (neither is in front). Each such face of the smaller
## box is pulled in a few millimetres, so the bigger one's face wins cleanly.
func _unfight() -> void:
	const INSET := 0.003
	var planes := {}
	for i in _boxes.size():
		var b: Array = _boxes[i]
		var c: Vector3 = b[0]
		var h: Vector3 = (b[1] as Vector3) * 0.5
		for axis in 3:
			for sgn in [-1, 1]:
				var coord: float = c[axis] + h[axis] * sgn
				var key := "%d%d_%d" % [axis, sgn, roundi(coord * 400.0)]
				if not planes.has(key):
					planes[key] = []
				planes[key].append(i)
	var shrink := {}           # box -> [[axis, sign], ...]
	for key in planes:
		var list: Array = planes[key]
		if list.size() < 2:
			continue
		var axis := int(key.substr(0, 1))
		var sgn := -1 if key.substr(1, 2) == "-1" else 1
		for a in list.size():
			for b in range(a + 1, list.size()):
				var ia: int = list[a]
				var ib: int = list[b]
				if _faces_overlap(_boxes[ia], _boxes[ib], axis):
					var va: float = (_boxes[ia][1] as Vector3).x * (_boxes[ia][1] as Vector3).y * (_boxes[ia][1] as Vector3).z
					var vb: float = (_boxes[ib][1] as Vector3).x * (_boxes[ib][1] as Vector3).y * (_boxes[ib][1] as Vector3).z
					var small := ia if va <= vb else ib
					if not shrink.has(small):
						shrink[small] = []
					shrink[small].append([axis, sgn])
	for i in shrink:
		var b: Array = _boxes[i]
		var c: Vector3 = b[0]
		var sz: Vector3 = b[1]
		for f in shrink[i]:
			var axis: int = f[0]
			if sz[axis] <= INSET * 3.0:
				continue
			sz[axis] -= INSET
			c[axis] -= float(f[1]) * INSET * 0.5
		b[0] = c
		b[1] = sz


static func _faces_overlap(a: Array, b: Array, axis: int) -> bool:
	for k in 3:
		if k == axis:
			continue
		var ca: float = (a[0] as Vector3)[k]
		var ha: float = (a[1] as Vector3)[k] * 0.5
		var cb: float = (b[0] as Vector3)[k]
		var hb: float = (b[1] as Vector3)[k] * 0.5
		if ca + ha <= cb - hb + 0.001 or cb + hb <= ca - ha + 0.001:
			return false
	return true


## Box described by its min corner and max corner (axis aligned).
func block(a: Vector3, b: Vector3, mat: Material, collide := true) -> void:
	var lo := Vector3(minf(a.x, b.x), minf(a.y, b.y), minf(a.z, b.z))
	var hi := Vector3(maxf(a.x, b.x), maxf(a.y, b.y), maxf(a.z, b.z))
	box((lo + hi) * 0.5, hi - lo, mat, Vector3.ZERO, collide)


## Wall along X or Z with rectangular openings.
## openings: Array of [offset_along, width, bottom, top] relative to the wall start.
func wall(start: Vector3, length: float, along_x: bool, height: float, thick: float, mat: Material, openings := []) -> void:
	var sorted := openings.duplicate()
	sorted.sort_custom(func(a, b): return a[0] < b[0])
	var cursor := 0.0
	for o in sorted:
		var o0: float = o[0]
		var ow: float = o[1]
		var ob: float = o[2]
		var ot: float = o[3]
		if o0 > cursor:
			_wall_piece(start, along_x, cursor, o0, 0.0, height, thick, mat)
		if ob > 0.0:
			_wall_piece(start, along_x, o0, o0 + ow, 0.0, ob, thick, mat)
		if ot < height:
			_wall_piece(start, along_x, o0, o0 + ow, ot, height, thick, mat)
		cursor = o0 + ow
	if cursor < length:
		_wall_piece(start, along_x, cursor, length, 0.0, height, thick, mat)


func _wall_piece(start: Vector3, along_x: bool, a: float, b: float, y0: float, y1: float, thick: float, mat: Material) -> void:
	if b - a < 0.01 or y1 - y0 < 0.01:
		return
	if along_x:
		block(start + Vector3(a, y0, -thick * 0.5), start + Vector3(b, y1, thick * 0.5), mat)
	else:
		block(start + Vector3(-thick * 0.5, y0, a), start + Vector3(thick * 0.5, y1, b), mat)


## Straight stair run. dir is a unit horizontal axis vector.
func stairs(base: Vector3, dir: Vector3, width: float, rise: float, steps: int, tread: float, mat: Material) -> void:
	var step_h := rise / steps
	for i in steps:
		var h := step_h * (i + 1)
		var centre := base + dir * (tread * (i + 0.5)) + Vector3.UP * (h * 0.5)
		var size := Vector3.ZERO
		if absf(dir.x) > 0.5:
			size = Vector3(tread, h, width)
		else:
			size = Vector3(width, h, tread)
		box(centre, size, mat)
	# Walking collision: a ramp resting on the step noses, so feet (and the
	# player capsule) go up smoothly instead of catching on every edge.
	var p0 := base - dir * tread
	var p1 := base + dir * tread * (steps - 1) + Vector3.UP * rise
	var u := (p1 - p0).normalized()
	var side := Vector3.UP.cross(dir).normalized()
	var n := u.cross(side).normalized()
	var t := 0.3
	var length := p0.distance_to(p1)
	var xf := Transform3D(Basis(side, n, u), (p0 + p1) * 0.5 + n * (0.01 - t * 0.5))
	add_collision_box(xf, Vector3(width, t, length))


## Irregular rock/rubble mesh: a displaced low-poly sphere.
static func rock_mesh(radius: float, seed_value: int, squash := 0.6, segments := 8, rings := 5) -> ArrayMesh:
	var sphere := SphereMesh.new()
	sphere.radius = radius
	sphere.height = radius * 2.0
	sphere.radial_segments = segments
	sphere.rings = rings
	var arrays := sphere.get_mesh_arrays()
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var n := FastNoiseLite.new()
	n.seed = seed_value
	n.frequency = 2.2 / radius
	var moved := {}
	for i in verts.size():
		var v := verts[i]
		var key := v.snapped(Vector3.ONE * 0.0001)
		if not moved.has(key):
			var d := 1.0 + n.get_noise_3dv(v) * 0.45
			var nv := v * d
			nv.y *= squash
			# Flatten facets a bit for a broken-concrete look.
			nv = nv.snapped(Vector3.ONE * radius * 0.18)
			moved[key] = nv
		verts[i] = moved[key]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	for i in idx:
		st.add_vertex(verts[i])
	st.generate_normals()
	var arr := st.commit_to_arrays()
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	m.set_meta("arrays", arr)
	return m


## A collision shape for a rock made by rock_mesh (from its own points,
## without reading the mesh back from the graphics card).
static func rock_shape(mesh: ArrayMesh) -> ConvexPolygonShape3D:
	var s := ConvexPolygonShape3D.new()
	s.points = (arrays_of(mesh)[Mesh.ARRAY_VERTEX] as PackedVector3Array)
	return s


## Horizontal slab from `lo` to `hi` (x/z) with rectangular holes.
## holes: Array of Rect2 in x/z (position = min corner).
func slab(lo: Vector2, hi: Vector2, y0: float, y1: float, mat: Material, holes: Array = []) -> void:
	var xs := [lo.x, hi.x]
	var zs := [lo.y, hi.y]
	for h in holes:
		var r: Rect2 = h
		xs.append_array([r.position.x, r.end.x])
		zs.append_array([r.position.y, r.end.y])
	xs.sort()
	zs.sort()
	for i in xs.size() - 1:
		for j in zs.size() - 1:
			var ax: float = xs[i]
			var bx: float = xs[i + 1]
			var az: float = zs[j]
			var bz: float = zs[j + 1]
			if bx - ax < 0.01 or bz - az < 0.01:
				continue
			var c := Vector2((ax + bx) * 0.5, (az + bz) * 0.5)
			var inside := false
			for h in holes:
				if (h as Rect2).has_point(c):
					inside = true
			if not inside:
				block(Vector3(ax, y0, az), Vector3(bx, y1, bz), mat)


func commit() -> void:
	_unfight()
	for b in _boxes:
		var m := BoxMesh.new()
		m.size = b[1]
		add_mesh(m, Transform3D(Basis(), b[0]), b[2])
	_boxes.clear()
	for key in _tools:
		var acc: Dictionary = _tools[key]
		var mat: Material = acc["mat"]
		if (acc["v"] as PackedVector3Array).is_empty():
			continue
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = acc["v"]
		arrays[Mesh.ARRAY_NORMAL] = acc["n"]
		arrays[Mesh.ARRAY_TANGENT] = acc["t"]
		arrays[Mesh.ARRAY_TEX_UV] = acc["uv"]
		arrays[Mesh.ARRAY_INDEX] = acc["i"]
		var am := ArrayMesh.new()
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		var mi := MeshInstance3D.new()
		mi.mesh = am
		mi.material_override = mat
		_root.add_child(mi)
	_tools.clear()
