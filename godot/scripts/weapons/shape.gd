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
