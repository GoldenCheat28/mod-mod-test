extends RigidBody3D
## An old wooden door on a hinge. It is a normal physics body: grab the handle
## (E) and pull or push it, shoulder it open, shoot through it (bullets leave
## holes and carry on, the hit shoves it). Swings both ways, up to ~95 degrees.
## Enough hits (or a blast) tear it off the hinges or break it into pieces.

const Mat = preload("res://scripts/world/materials.gd")

const THICK := 0.045
const Sfx = preload("res://scripts/audio/sfx.gd")

var hp := 14.0
var _joint: HingeJoint3D
var _size := Vector2.ONE
var _paint: Material
var _level: PhysicsBody3D
var _creak: AudioStreamPlayer3D
var _creak_k := 0.0
# The leaf's outline in its own plane (x across from the hinge, y up): a
# rectangle until it is sawn (then what is left of it).
var _poly := PackedVector2Array()
var _kerf: Array = []            # the saw's way through it so far (points in that plane)
var _kerf_edge := false          # the saw came in from an edge (so it can come out at another)
var _kerf_len := 0.0
var _marks: Array = []           # the dark line of the kerf on both faces
var _sawn := false


## hinge: bottom of the hinge edge; across: horizontal direction from the
## hinge to the handle edge; level_body: the level's static body (the door
## does not rub against the frame it sits in).
static func spawn(parent: Node, hinge: Vector3, across: Vector3, width: float, height: float, level_body: PhysicsBody3D) -> RigidBody3D:
	var d = load("res://scripts/world/door.gd").new()
	parent.add_child(d)
	d.build(hinge, across.normalized(), width, height, level_body)
	return d


func build(hinge: Vector3, across: Vector3, width: float, height: float, level_body: PhysicsBody3D) -> void:
	collision_layer = Game.LAYER_PROPS
	collision_mask = Game.LAYER_PROPS | Game.LAYER_BOTS | Game.LAYER_PLAYER | Game.LAYER_DEBRIS
	mass = 22.0
	angular_damp = 2.5
	linear_damp = 1.0
	can_sleep = true
	set_meta("surface", "wood")
	add_to_group(&"blastable")
	var pm := PhysicsMaterial.new()
	pm.friction = 0.7
	physics_material_override = pm
	# Local frame: X = across the door (hinge at x = 0), Y = up, Z = thickness.
	var b := Basis(across, Vector3.UP, across.cross(Vector3.UP))
	global_transform = Transform3D(b, hinge)
	_size = Vector2(width, height)
	_poly = PackedVector2Array([Vector2.ZERO, Vector2(width, 0), Vector2(width, height), Vector2(0, height)])
	add_to_group(&"door")
	var paint := Mat.standard("door_paint", Color(0.3, 0.33, 0.28), 0.8, 0.0, 0.6)
	_paint = paint
	var edge := Mat.standard("door_wood", Color(0.28, 0.2, 0.13), 0.85, 0.0, 0.8)
	var metal := Mat.standard("door_metal", Color(0.45, 0.43, 0.4), 0.45, 0.8, 0.3)
	_box(Vector3(width, height, THICK), Vector3(width * 0.5, height * 0.5, 0), paint)
	# Frame of the door leaf and two sunken panels on each face.
	for z in [-1.0, 1.0]:
		for py in [0.28, 0.7]:
			_box(Vector3(width * 0.62, height * 0.32, 0.006), Vector3(width * 0.5, height * py, z * (THICK * 0.5 + 0.002)), edge)
		# Lever handle and its plate.
		_box(Vector3(0.035, 0.16, 0.008), Vector3(width - 0.07, 0.98, z * (THICK * 0.5 + 0.004)), metal)
		_box(Vector3(0.11, 0.018, 0.018), Vector3(width - 0.1, 1.0, z * (THICK * 0.5 + 0.04)), metal)
		_box(Vector3(0.016, 0.016, 0.035), Vector3(width - 0.05, 1.0, z * (THICK * 0.5 + 0.022)), metal)
	var cs := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(width, height, THICK)
	cs.shape = shape
	cs.position = Vector3(width * 0.5, height * 0.5, 0)
	add_child(cs)
	if level_body:
		add_collision_exception_with(level_body)
		_level = level_body

	var j := HingeJoint3D.new()
	_joint = j
	# The hinge axis is the joint's local Z: stand it up.
	j.transform = Transform3D(Basis(Vector3.RIGHT, -PI * 0.5), hinge)
	get_parent().add_child(j)
	j.global_transform = Transform3D(Basis(Vector3.RIGHT, -PI * 0.5), hinge)
	j.set_flag(HingeJoint3D.FLAG_USE_LIMIT, true)
	j.set_param(HingeJoint3D.PARAM_LIMIT_LOWER, -1.65)
	j.set_param(HingeJoint3D.PARAM_LIMIT_UPPER, 1.65)
	j.node_a = j.get_path_to(self)
	# The hinges creak as it swings (see _physics_process).
	_creak = AudioStreamPlayer3D.new()
	_creak.stream = Game._once(Sfx.get_stream(&"door_creak"))
	_creak.bus = &"World"
	_creak.unit_size = 4.0
	_creak.volume_db = -60.0
	add_child(_creak)
	Net.register_prop(self)
	# Left ajar by whoever was here last.
	angular_velocity = Vector3.UP * randf_range(-0.6, 0.6)


## The hinges creak while it swings: once through, not looping - begun
## when it starts to move, as loud and high as it is swung fast, fading in
## and out smoothly; stopped when it stops.
func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["door._physics_process"] = Game.prof.get("door._physics_process", 0) + __d
	Game.prof["max door._physics_process"] = maxi(Game.prof.get("max door._physics_process", 0), __d)


func _physics_process_real(delta: float) -> void:
	if _creak == null:
		return
	var w := absf(angular_velocity.y)
	var want := clampf((w - 0.2) / 1.6, 0.0, 1.0)
	_creak_k = move_toward(_creak_k, want, delta * (4.0 if want > _creak_k else 2.5))
	if _creak_k > 0.03:
		if not _creak.playing and want > 0.05:
			# From somewhere in the recording, so it is not the same squeak
			# every time.
			_creak.play(randf_range(0.0, 0.6))
		_creak.volume_db = linear_to_db(maxf(_creak_k, 0.001)) - 4.0
		_creak.pitch_scale = 0.85 + 0.3 * _creak_k
	elif _creak.playing:
		_creak.stop()


func _box(size: Vector3, pos: Vector3, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	var m := BoxMesh.new()
	m.size = size
	mi.mesh = m
	mi.material_override = mat
	mi.position = pos
	add_child(mi)



## A bullet or pellet hit (amount: ~1 for a pistol round).
func damage(amount: float, point: Vector3, dir: Vector3) -> void:
	if hp <= 0.0:
		return
	hp -= amount
	if hp <= 0.0:
		_shatter(point, dir, amount)
	elif hp < 5.0 and is_instance_valid(_joint) and randf() < 0.25 * amount:
		# The hinges give: the door hangs free and falls.
		_joint.queue_free()
		_joint = null
		# Loose now: it lands on the floor like anything else.
		collision_mask |= Game.LAYER_WORLD
		if _level:
			remove_collision_exception_with(_level)
		apply_impulse(dir * 20.0, point - global_position)
		Game.play_3d(Sfx.get_stream(&"metal_hit"), global_position + Vector3.UP * 1.0, -8.0, 0.1, 4.0)


func center_local() -> Vector3:
	return Vector3(_size.x * 0.5, _size.y * 0.5, 0.0)


## Pressure wave from an explosion at `origin` (strength ~ impulse in N s at 1 m).
func blast(origin: Vector3, strength: float) -> void:
	var to := global_position + global_basis.x * _size.x * 0.5 + Vector3.UP * _size.y * 0.5
	var d := maxf(origin.distance_to(to), 0.5)
	var k := strength / (d * d)
	apply_impulse((to - origin).normalized() * k, to - global_position)
	damage(k * 0.4, to, (to - origin).normalized())


## Breaks up like wood does: long splinters along the grain (the door's
## height), small ones where it was hit, big slabs further away. Each shard is
## a convex slice of the door with raw wood on its broken edges, thrown on in
## the direction of the hit (harder the closer to it).
func _shatter(point: Vector3, dir: Vector3, force: float) -> void:
	var parent := get_parent()
	var hit_local := to_local(point)
	var hit2 := Vector2(clampf(hit_local.x, 0.0, _size.x), clampf(hit_local.y, 0.0, _size.y))
	# Seeds: crowded round the hit, sparse elsewhere.
	var seeds: Array[Vector2] = []
	for i in 7:
		seeds.append(hit2 + Vector2(randf_range(-0.12, 0.12), randf_range(-0.35, 0.35)))
	for i in 9:
		seeds.append(Vector2(randf_range(0.0, _size.x), randf_range(0.0, _size.y)))
	# Wood splits along the grain: distances across the door count triple, so
	# cells come out long and narrow, running up and down.
	var stretch := Vector2(3.0, 1.0)
	var rect := _poly
	var raw := Mat.standard("door_raw_wood", Color(0.62, 0.5, 0.34), 0.9, 0.0, 0.8).duplicate() as StandardMaterial3D
	raw.cull_mode = BaseMaterial3D.CULL_DISABLED
	var paint := (_paint as StandardMaterial3D).duplicate() as StandardMaterial3D
	paint.cull_mode = BaseMaterial3D.CULL_DISABLED
	for i in seeds.size():
		var poly := rect
		var a := seeds[i] * stretch
		for j in seeds.size():
			if i == j:
				continue
			var b := seeds[j] * stretch
			# Keep the side of the bisector closer to seed i (in stretched space).
			poly = _clip(poly, (a + b) * 0.5, (b - a).normalized(), stretch)
			if poly.size() < 3:
				break
		if poly.size() < 3:
			continue
		var centre := Vector2.ZERO
		for v in poly:
			centre += v
		centre /= poly.size()
		_spawn_shard(parent, poly, centre, paint, raw, point, dir, force)
	Game.play_3d(Sfx.get_stream(&"impact"), point, 3.0, 0.1, 6.0)
	Game.play_3d(Sfx.get_stream(&"impact"), point + Vector3.UP * 0.5, 0.0, 0.2, 6.0)
	if is_instance_valid(_joint):
		_joint.queue_free()
	queue_free()


## Sutherland-Hodgman: keeps the part of `poly` where (p*stretch - o).n <= 0.
func _clip(poly: PackedVector2Array, o: Vector2, n: Vector2, stretch: Vector2) -> PackedVector2Array:
	var out := PackedVector2Array()
	var cnt := poly.size()
	for k in cnt:
		var p0 := poly[k]
		var p1 := poly[(k + 1) % cnt]
		var d0 := (p0 * stretch - o).dot(n)
		var d1 := (p1 * stretch - o).dot(n)
		if d0 <= 0.0:
			out.append(p0)
		if (d0 <= 0.0) != (d1 <= 0.0):
			out.append(p0.lerp(p1, d0 / (d0 - d1)))
	return out


func _spawn_shard(parent: Node, poly: PackedVector2Array, centre: Vector2, paint: Material, raw: Material, point: Vector3, dir: Vector3, force: float) -> RigidBody3D:
	var h := THICK * 0.5
	# Mesh in the shard's own frame (origin at the centre of the cell).
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var pts := PackedVector3Array()
	var cnt := poly.size()
	for v in poly:
		pts.append(Vector3(v.x - centre.x, v.y - centre.y, h))
		pts.append(Vector3(v.x - centre.x, v.y - centre.y, -h))
	# Painted faces.
	var faces := ArrayMesh.new()
	for side in [1.0, -1.0]:
		var f := SurfaceTool.new()
		f.begin(Mesh.PRIMITIVE_TRIANGLES)
		f.set_normal(Vector3(0, 0, side))
		for k in range(1, cnt - 1):
			var ids := [0, k, k + 1] if side > 0.0 else [0, k + 1, k]
			for id in ids:
				var v := poly[id] - centre
				f.set_uv(poly[id])
				f.add_vertex(Vector3(v.x, v.y, h * side))
		f.commit(faces)
	faces.surface_set_material(0, paint)
	faces.surface_set_material(1, paint)
	# Broken edges: raw, splintered wood.
	for k in cnt:
		var a := poly[k] - centre
		var b := poly[(k + 1) % cnt] - centre
		var n := Vector3(b.y - a.y, a.x - b.x, 0).normalized()
		st.set_normal(n)
		for v in [Vector3(a.x, a.y, h), Vector3(b.x, b.y, h), Vector3(b.x, b.y, -h), Vector3(a.x, a.y, h), Vector3(b.x, b.y, -h), Vector3(a.x, a.y, -h)]:
			st.add_vertex(v)
	st.commit(faces)
	faces.surface_set_material(2, raw)
	var rb := RigidBody3D.new()
	rb.collision_layer = Game.LAYER_DEBRIS
	rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
	var area := 0.0
	for k in range(1, cnt - 1):
		area += absf((poly[k] - poly[0]).cross(poly[k + 1] - poly[0])) * 0.5
	rb.mass = maxf(22.0 * area / (_size.x * _size.y), 0.15)
	rb.set_meta("surface", "wood")
	var mi := MeshInstance3D.new()
	mi.mesh = faces
	rb.add_child(mi)
	var cs := CollisionShape3D.new()
	var hull := ConvexPolygonShape3D.new()
	hull.points = pts
	cs.shape = hull
	rb.add_child(cs)
	parent.add_child(rb)
	rb.global_transform = Transform3D(global_basis, global_transform * Vector3(centre.x, centre.y, 0))
	var near := 1.0 / (1.0 + rb.global_position.distance_to(point) * 3.0)
	rb.linear_velocity = linear_velocity + dir * (1.0 + 7.0 * near * minf(force, 4.0)) 			+ Vector3(randf_range(-0.5, 0.5), randf_range(-0.2, 0.8), randf_range(-0.5, 0.5))
	rb.angular_velocity = Vector3(randf_range(-5, 5), randf_range(-5, 5), randf_range(-5, 5)) * (0.4 + near)
	parent.get_tree().create_timer(120.0).timeout.connect(rb.queue_free)
	return rb


# --- Sawing it (the chainsaw: player.gd) ------------------------------------------------

## The running chain bar from `a` to `b` (world): where it goes through the
## leaf it cuts a kerf; a kerf from one edge to another parts it there - the
## piece on the hinges stays, the other falls. Returns whether it is in the
## wood (the saw is slowed and throws sawdust).
func saw(a: Vector3, b: Vector3, _delta: float) -> bool:
	if hp <= 0.0:
		return false
	var la := to_local(a)
	var lb := to_local(b)
	var h := THICK * 0.5 + 0.01
	var p3 := Vector3.INF
	if (la.z > 0.0) != (lb.z > 0.0):
		p3 = la.lerp(lb, la.z / (la.z - lb.z))
	elif absf(lb.z) < h:
		p3 = lb                              # (the nose in the wood)
	elif absf(la.z) < h:
		p3 = la
	if p3 == Vector3.INF:
		_kerf_end()
		return false
	var p := Vector2(p3.x, p3.y)
	var inside := Geometry2D.is_point_in_polygon(p, _poly)
	var edge_d := _edge_dist(p)
	if not inside:
		# Out through an edge: if it came in through another, it is through.
		var through := _kerf_edge and _kerf_len > 0.08 and edge_d < 0.12 and not _kerf.is_empty()
		if through and (_kerf[0] as Vector2).distance_to(p) > 0.08:
			_part(_kerf[0], p)
		_kerf_end()
		return false
	if _kerf.is_empty():
		_kerf_edge = edge_d < 0.05
		_kerf.append(p)
		return true
	var last: Vector2 = _kerf[_kerf.size() - 1]
	if last.distance_to(p) > 0.012:
		_kerf.append(p)
		_kerf_len += last.distance_to(p)
		_mark(last, p)
		# (sawdust out of both sides)
		if Game.fx and randf() < 0.5:
			var d: GPUParticles3D = Game.fx._dust[Game.fx._dust_i]
			Game.fx._dust_i = (Game.fx._dust_i + 1) % Game.fx._dust.size()
			var side := 1.0 if randf() < 0.5 else -1.0
			Game.fx._place(d, to_global(Vector3(p.x, p.y, side * THICK * 0.5)), global_basis.z * side)
			d.restart()
		# Reached an edge from the far side: through.
		if _kerf_edge and edge_d < 0.012 and _kerf_len > 0.1 and (_kerf[0] as Vector2).distance_to(p) > 0.1:
			_part(_kerf[0], p)
			_kerf_end()
	return true


func _kerf_end() -> void:
	_kerf.clear()
	_kerf_len = 0.0
	_kerf_edge = false


func _edge_dist(p: Vector2) -> float:
	var best := INF
	for k in _poly.size():
		var q := Geometry2D.get_closest_point_to_segment(p, _poly[k], _poly[(k + 1) % _poly.size()])
		best = minf(best, q.distance_to(p))
	return best


## The black line of the kerf, on both faces.
func _mark(from: Vector2, to: Vector2) -> void:
	var dark := Mat.standard("door_kerf", Color(0.03, 0.025, 0.02), 1.0, 0.0, 0.0)
	var d := to - from
	for side in [1.0, -1.0]:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(d.length() + 0.006, 0.007, 0.002)
		mi.mesh = bm
		mi.material_override = dark
		mi.position = Vector3((from.x + to.x) * 0.5, (from.y + to.y) * 0.5, side * (THICK * 0.5 + 0.0012))
		mi.rotation.z = atan2(d.y, d.x)
		add_child(mi)
		_marks.append(mi)


## Parted along the line through `s` and `e`: this keeps the side with the
## hinges on it, the rest comes away and falls.
func _part(s: Vector2, e: Vector2) -> void:
	var dir := (e - s).normalized()
	var n := Vector2(-dir.y, dir.x)
	var o := (s + e) * 0.5
	var keep := _clip(_poly, o, n, Vector2.ONE)
	var off := _clip(_poly, o, -n, Vector2.ONE)
	var hinge_mid := Vector2(0.01, _size.y * 0.5)
	if Geometry2D.is_point_in_polygon(hinge_mid, off):
		var t := keep
		keep = off
		off = t
	if keep.size() < 3 or off.size() < 3:
		return
	var raw := Mat.standard("door_raw_wood", Color(0.62, 0.5, 0.34), 0.9, 0.0, 0.8).duplicate() as StandardMaterial3D
	raw.cull_mode = BaseMaterial3D.CULL_DISABLED
	var paint := (_paint as StandardMaterial3D).duplicate() as StandardMaterial3D
	paint.cull_mode = BaseMaterial3D.CULL_DISABLED
	# The piece that comes away: its own body, dropping.
	var c := Vector2.ZERO
	for v in off:
		c += v
	c /= off.size()
	var piece := _spawn_shard(get_parent(), off, c, paint, raw, to_global(Vector3(c.x, c.y, 0)), Vector3.DOWN, 0.1)
	# (it sits right in the frame and against the rest of the door: let it
	# clear them, tipping out to one side as it goes)
	piece.add_collision_exception_with(self)
	if _level:
		piece.add_collision_exception_with(_level)
		var lvl := _level
		get_tree().create_timer(0.7).timeout.connect(func():
			if is_instance_valid(piece) and is_instance_valid(lvl):
				piece.remove_collision_exception_with(lvl))
	var out := global_basis.z * (1.0 if randf() < 0.5 else -1.0)
	piece.linear_velocity = out * 0.9 + Vector3.DOWN * 0.3
	piece.angular_velocity = global_basis.x.cross(out) * 1.5
	Game.play_3d(Sfx.get_stream(&"impact"), to_global(Vector3(c.x, c.y, 0)), -2.0, 0.1, 4.0)
	# What stays: the leaf rebuilt to its new outline, the hardware that is
	# still on it kept.
	var area_before := _area(_poly)
	_poly = keep
	for ch in get_children():
		if ch is MeshInstance3D:
			var mi := ch as MeshInstance3D
			var drop := ch in _marks or mi.has_meta("slab")
			if mi.mesh is BoxMesh and not drop:
				var bs: Vector3 = (mi.mesh as BoxMesh).size
				if absf(bs.z - THICK) < 1e-4:
					drop = true                      # the old whole leaf
				for cx in [-0.5, 0.5]:
					for cy in [-0.5, 0.5]:
						if not Geometry2D.is_point_in_polygon(Vector2(mi.position.x + bs.x * cx, mi.position.y + bs.y * cy), keep):
							drop = true
			if drop:
				ch.queue_free()
		elif ch is CollisionShape3D:
			ch.queue_free()
	_sawn = true
	_marks.clear()
	var slab := MeshInstance3D.new()
	slab.mesh = _slab_mesh(keep, paint, raw)
	slab.set_meta("slab", true)
	add_child(slab)
	var pts := PackedVector3Array()
	for v in keep:
		pts.append(Vector3(v.x, v.y, THICK * 0.5))
		pts.append(Vector3(v.x, v.y, -THICK * 0.5))
	var cs := CollisionShape3D.new()
	var hull := ConvexPolygonShape3D.new()
	hull.points = pts
	cs.shape = hull
	add_child(cs)
	mass = maxf(mass * _area(keep) / maxf(area_before, 0.01), 2.0)
	sleeping = false


static func _area(poly: PackedVector2Array) -> float:
	var a := 0.0
	for k in range(1, poly.size() - 1):
		a += absf((poly[k] - poly[0]).cross(poly[k + 1] - poly[0])) * 0.5
	return a


## A flat slab of the leaf in its own frame: painted faces, raw sawn edges.
func _slab_mesh(poly: PackedVector2Array, paint: Material, raw: Material) -> ArrayMesh:
	var h := THICK * 0.5
	var mesh := ArrayMesh.new()
	var cnt := poly.size()
	for side in [1.0, -1.0]:
		var f := SurfaceTool.new()
		f.begin(Mesh.PRIMITIVE_TRIANGLES)
		f.set_normal(Vector3(0, 0, side))
		for k in range(1, cnt - 1):
			var ids := [0, k, k + 1] if side > 0.0 else [0, k + 1, k]
			for id in ids:
				f.set_uv(poly[id])
				f.add_vertex(Vector3(poly[id].x, poly[id].y, h * side))
		f.commit(mesh)
		mesh.surface_set_material(mesh.get_surface_count() - 1, paint)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in cnt:
		var a := poly[k]
		var b := poly[(k + 1) % cnt]
		st.set_normal(Vector3(b.y - a.y, a.x - b.x, 0).normalized())
		for v in [Vector3(a.x, a.y, h), Vector3(b.x, b.y, h), Vector3(b.x, b.y, -h), Vector3(a.x, a.y, h), Vector3(b.x, b.y, -h), Vector3(a.x, a.y, -h)]:
			st.add_vertex(v)
	st.commit(mesh)
	mesh.surface_set_material(mesh.get_surface_count() - 1, raw)
	return mesh
