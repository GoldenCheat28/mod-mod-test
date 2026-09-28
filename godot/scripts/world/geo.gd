extends RefCounted
## Level geometry builder. Static pieces are merged into one mesh per
## material and one compound StaticBody3D, which keeps draw calls and
## physics broadphase cheap.

var _tools := {}        # Material -> SurfaceTool
var _body: StaticBody3D
var _root: Node3D


func _init(root: Node3D) -> void:
	_root = root
	_body = StaticBody3D.new()
	_body.name = "LevelCollision"
	_body.collision_layer = Game.LAYER_WORLD
	_body.collision_mask = 0
	_root.add_child(_body)


func _tool(mat: Material) -> SurfaceTool:
	if not _tools.has(mat):
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		_tools[mat] = st
	return _tools[mat]


## Adds a mesh (visual only) with a transform.
func add_mesh(mesh: Mesh, xf: Transform3D, mat: Material) -> void:
	for s in mesh.get_surface_count():
		_tool(mat).append_from(mesh, s, xf)


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
	var m := BoxMesh.new()
	m.size = size
	add_mesh(m, xf, mat)
	if collide:
		add_collision_box(xf, size)


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


## Irregular rock/rubble mesh: a displaced low-poly sphere.
static func rock_mesh(radius: float, seed_value: int, squash := 0.6) -> ArrayMesh:
	var sphere := SphereMesh.new()
	sphere.radius = radius
	sphere.height = radius * 2.0
	sphere.radial_segments = 8
	sphere.rings = 5
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
	return st.commit()


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
	for mat in _tools:
		var st: SurfaceTool = _tools[mat]
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = mat
		_root.add_child(mi)
	_tools.clear()
