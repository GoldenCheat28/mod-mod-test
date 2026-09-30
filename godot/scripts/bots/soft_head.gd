extends Node
## Tearable soft head. The rigid head (capsule + meshes) is what the ragdoll
## simulates; when the head is first hit, its look is replaced by a soft body
## shell shaped like the head. Points away from any damage stay pinned to the
## skull (the rigid head), so the head keeps its shape; points around a wound
## are released and behave like heavy, wet tissue: they sag, swing and wobble.
##
## Damage follows the bullet: holes along each bullet path, a bigger torn exit
## wound with its edges thrown outwards, and for a shotgun blast the area
## around the exit is torn along random lines into pieces. Pieces still
## connected by some tissue hang as flaps; pieces cut loose fly off as separate
## soft bodies (and eventually settle into static meshes). Torn edges and the
## inside of the shell show raw tissue, and bone fragments are thrown out.

const Geo = preload("res://scripts/world/geo.gd")
const Tex = preload("res://scripts/world/textures.gd")

const SUBDIV := 3                 # 642 points, 1280 triangles
const FLESH_MASS := 3.0           # kg of soft tissue on the whole shell
const MAX_CHUNKS := 12
const CHUNK_BAKE_TIME := 8.0      # s until a loose piece becomes a static mesh

var bot
var head: RigidBody3D
var active := false
var main: SoftBody3D

# Main piece (index = soft body point index).
var _pos := PackedVector3Array()     # world positions (snapshot)
var _col := PackedColorArray()       # rgb skin/hair (linear), a = exposed tissue
var _pin := PackedByteArray()        # 1 = held by the skull
var _faces := PackedInt32Array()
var _point_mass := 0.0

var _hits: Array = []                # [point, dir, weapon]
var _chunks: Array = []              # [SoftBody3D, birth, tissue point ids]
var _pending: Array = []             # [SoftBody3D, {point index: velocity change}]
var _time := 0.0
var _drip_t := 0.0

static var _mat: ShaderMaterial
static var _bone_mat: StandardMaterial3D
static var _ico: Array = []


func setup(b) -> void:
	bot = b
	head = b.head


func hit(point: Vector3, dir: Vector3, weapon: String) -> void:
	if not active:
		_activate()
	if main == null:
		return
	_hits.append([point, dir.normalized(), weapon])


# --- Shape --------------------------------------------------------------------------

static func _icosphere(subdiv: int) -> Array:
	var t := (1.0 + sqrt(5.0)) * 0.5
	var v := PackedVector3Array([
		Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0),
		Vector3(0, -1, t), Vector3(0, 1, t), Vector3(0, -1, -t), Vector3(0, 1, -t),
		Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)])
	for i in v.size():
		v[i] = v[i].normalized()
	var f := PackedInt32Array([0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2,
		10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1])
	for s in subdiv:
		var mid := {}
		var nf := PackedInt32Array()
		for k in range(0, f.size(), 3):
			var a := f[k]
			var b := f[k + 1]
			var c := f[k + 2]
			var ab := _mid(v, mid, a, b)
			var bc := _mid(v, mid, b, c)
			var ca := _mid(v, mid, c, a)
			nf.append_array([a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca])
		f = nf
	# Godot's front faces wind clockwise; the table above is counter-clockwise.
	for k in range(0, f.size(), 3):
		var tmp := f[k + 1]
		f[k + 1] = f[k + 2]
		f[k + 2] = tmp
	return [v, f]


static func _mid(v: PackedVector3Array, cache: Dictionary, a: int, b: int) -> int:
	var key := Vector2i(mini(a, b), maxi(a, b))
	if cache.has(key):
		return cache[key]
	v.append(((v[a] + v[b]) * 0.5).normalized())
	cache[key] = v.size() - 1
	return v.size() - 1


## Head-local point for a unit direction: skull ellipsoid, jaw, nose and ears.
func _shape(u: Vector3) -> Vector3:
	var s: float = bot.scale_factor
	var p := Vector3(u.x * 0.093, u.y * 0.115, u.z * 0.106)
	# Jaw: the lower front narrows and comes down/forward.
	var jaw := smoothstep(-0.25, -0.85, u.y) * smoothstep(0.4, -0.5, u.z)
	p += Vector3(-p.x * 0.18 * jaw, -0.022 * jaw, -0.012 * jaw)
	# Nose and ears as smooth bumps along the surface normal.
	var nose := exp(-pow(u.distance_to(Vector3(0, -0.12, -0.99).normalized()) / 0.2, 2.0))
	var ear := 0.0
	for sx in [-1.0, 1.0]:
		ear = maxf(ear, exp(-pow(u.distance_to(Vector3(sx, 0.02, 0.12).normalized()) / 0.17, 2.0)))
	p += u * (nose * 0.016 + ear * 0.011)
	return (p + Vector3(0, 0.01, 0)) * s


func _colour(u: Vector3) -> Color:
	var skin: Color = bot.skin_color
	var c := skin
	if bot._has_hair:
		var hairline := u.y > 0.2 - 0.25 * clampf(u.z, 0.0, 1.0) and not (u.z < -0.55 and u.y < 0.62)
		if hairline or (u.z > 0.45 and u.y > -0.25):
			c = bot._hair.albedo_color
	for sx in [-1.0, 1.0]:
		var eye := Vector3(0.36 * sx, 0.26, -0.9).normalized()
		if u.distance_to(eye) < 0.13:
			c = Color(0.03, 0.02, 0.02)
		elif u.distance_to(eye + Vector3(0, 0.17, 0.02)) < 0.1:
			c = skin.lerp(bot._hair.albedo_color, 0.6)   # brow
	if u.distance_to(Vector3(0, -0.52, -0.85).normalized()) < 0.12:
		c = skin.lerp(Color(0.55, 0.22, 0.2), 0.5)      # lips
	c = c.srgb_to_linear()
	c.a = 0.0
	return c


## Materials used on the first hit, created up front so they can be prewarmed.
static func materials() -> Array[Material]:
	if _mat == null:
		_mat = ShaderMaterial.new()
		_mat.shader = load("res://shaders/flesh.gdshader")
		_mat.set_shader_parameter("tex_noise", Tex.detail())
		_bone_mat = StandardMaterial3D.new()
		_bone_mat.albedo_color = Color(0.86, 0.8, 0.7)
		_bone_mat.roughness = 0.6
	return [_mat, _bone_mat]

# --- Activation / rebuilding -------------------------------------------------------------

func _activate() -> void:
	active = true
	if _ico.is_empty():
		_ico = _icosphere(SUBDIV)
	materials()
	# Two shells in one soft body: skin outside, and a tissue layer (muscle,
	# brain) inside it, so a torn head is full, not hollow. Both tear together.
	var units: PackedVector3Array = _ico[0]
	var tris: PackedInt32Array = _ico[1]
	var n := units.size()
	_faces = tris.duplicate()
	for k in tris:
		_faces.append(k + n)
	var xf := head.global_transform
	var centre: Vector3 = Vector3(0, 0.005, -0.005) * bot.scale_factor
	_pos.resize(n * 2)
	_col.resize(n * 2)
	_pin.resize(n * 2)
	for i in n:
		var outer := _shape(units[i])
		_pos[i] = xf * outer
		_col[i] = _colour(units[i])
		_pos[i + n] = xf * (centre + (outer - centre) * 0.72)
		_col[i + n] = Color(0.3, 0.02, 0.015, 1.0)
		_pin[i] = 1
		_pin[i + n] = 1
	_point_mass = FLESH_MASS / (n * 2)
	for mi in bot._head_meshes:
		mi.visible = false
	main = _make_soft(_pos, _faces, _col, _pin)


func _make_soft(pos: PackedVector3Array, faces: PackedInt32Array, cols: PackedColorArray, pins: PackedByteArray) -> SoftBody3D:
	var normals := PackedVector3Array()
	normals.resize(pos.size())
	for k in range(0, faces.size(), 3):
		var fn := (pos[faces[k + 2]] - pos[faces[k]]).cross(pos[faces[k + 1]] - pos[faces[k]])
		for j in 3:
			normals[faces[k + j]] += fn
	for i in normals.size():
		normals[i] = normals[i].normalized() if normals[i].length() > 1e-9 else Vector3.UP
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = pos
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = cols
	arrays[Mesh.ARRAY_INDEX] = faces
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	am.surface_set_material(0, _mat)
	var sb := SoftBody3D.new()
	sb.top_level = true
	sb.mesh = am
	sb.layers = 2
	sb.simulation_precision = 8
	sb.total_mass = maxf(_point_mass * pos.size(), 0.05)
	sb.linear_stiffness = 0.9   # dense, springy tissue rather than cloth
	sb.pressure_coefficient = 0.0
	sb.damping_coefficient = 0.03
	sb.collision_layer = Game.LAYER_DEBRIS
	sb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS
	sb.ray_pickable = false
	add_child(sb)
	sb.global_transform = Transform3D.IDENTITY
	for p in bot.parts:
		sb.add_collision_exception_with(p)
	if not pins.is_empty():
		var path := sb.get_path_to(head)
		for i in pins.size():
			if pins[i] == 1:
				sb.set_point_pinned(i, true, path)
	return sb


# --- Damage ---------------------------------------------------------------------------

func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["soft_head._physics_process"] = Game.prof.get("soft_head._physics_process", 0) + __d
	Game.prof["max soft_head._physics_process"] = maxi(Game.prof.get("max soft_head._physics_process", 0), __d)


func _physics_process_real(delta: float) -> void:
	_time += delta
	for p in _pending:
		var sb: SoftBody3D = p[0]
		if is_instance_valid(sb):
			var kicks: Dictionary = p[1]
			var m := _point_mass
			for i in kicks:
				sb.apply_impulse(i, kicks[i] * m)
	_pending.clear()
	if not _hits.is_empty():
		_tear()
		_hits.clear()
	_update_chunks(delta)


func _tear() -> void:
	var n := _pos.size()
	for i in n:
		_pos[i] = main.get_point_transform(i)
	var face_n := _faces.size() / 3
	var dead := PackedByteArray()
	dead.resize(face_n)
	var loose := PackedByteArray()
	loose.resize(n)
	var tissue := PackedFloat32Array()
	tissue.resize(n)
	var kick := {}
	var cent := PackedVector3Array()
	cent.resize(face_n)
	for f in face_n:
		cent[f] = (_pos[_faces[f * 3]] + _pos[_faces[f * 3 + 1]] + _pos[_faces[f * 3 + 2]]) / 3.0
	var head_c := head.global_position
	var pellets: Array = []

	for h in _hits:
		var p: Vector3 = h[0]
		var d: Vector3 = h[1]
		var shotgun: bool = h[2] == "shotgun"
		var ex := _exit_point(p, d)
		if shotgun:
			pellets.append([p, d, ex])
		# Hole along the whole path, small entry, torn exit.
		var r_hole := 0.014 if shotgun else 0.011
		var r_exit := 0.02 if shotgun else 0.03
		for f in face_n:
			if dead[f] == 0 and (_dist_seg(cent[f], p, ex) < r_hole or cent[f].distance_to(ex) < r_exit):
				dead[f] = 1
		for i in n:
			var de := _pos[i].distance_to(ex)
			var di := _pos[i].distance_to(p)
			var exit_r := 0.075 if shotgun else 0.045
			if de < exit_r:
				# Exit wound edges are thrown out and hang loose.
				loose[i] = 1
				var k := 1.0 - de / exit_r
				var out := (_pos[i] - head_c).normalized()
				kick[i] = kick.get(i, Vector3.ZERO) + (d * 2.2 + out * 1.4) * k * (1.0 if shotgun else 0.5)
				if de < 0.02:
					tissue[i] = maxf(tissue[i], 1.0)
			if di < 0.035:
				loose[i] = 1
				if di < 0.013:
					tissue[i] = maxf(tissue[i], 1.0)

	if pellets.size() >= 2:
		_blast(pellets, dead, loose, kick, tissue, cent)

	_split(dead, loose, kick, tissue)


## Shotgun: the exit side is torn along random lines into pieces, each thrown
## with its own velocity, so some fly off and some stay hanging.
func _blast(pellets: Array, dead: PackedByteArray, loose: PackedByteArray, kick: Dictionary,
		tissue: PackedFloat32Array, cent: PackedVector3Array) -> void:
	var entry := Vector3.ZERO
	var d := Vector3.ZERO
	for pl in pellets:
		entry += pl[0]
		d += pl[1]
	entry /= pellets.size()
	d = d.normalized()
	var head_c := head.global_position
	var centre := head_c + d * 0.045 + (entry - head_c) * 0.2
	# Buckshot at close range: the more pellets, the bigger the part of the head that goes.
	var radius := 0.06 + pellets.size() * 0.012
	# Pieces: random seeds inside the blast, each with its own motion.
	var seeds: Array[Vector3] = []
	var vel: Array[Vector3] = []
	var strong: Array[bool] = []
	for s in randi_range(4, 6):
		seeds.append(centre + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * radius)
		var out := (seeds[s] - head_c).normalized()
		var strength := randf_range(0.35, 1.0)
		strong.append(strength > 0.5)
		vel.append((d * randf_range(3.0, 7.0) + out * randf_range(1.0, 3.0)) * strength)
	var n := _pos.size()
	var near_seed := PackedInt32Array()
	near_seed.resize(n)
	for i in n:
		var dc := _pos[i].distance_to(centre)
		if dc > radius + 0.03:
			continue
		loose[i] = 1
		var best := 0
		for s in seeds.size():
			if _pos[i].distance_squared_to(seeds[s]) < _pos[i].distance_squared_to(seeds[best]):
				best = s
		near_seed[i] = best
		var k := clampf(1.0 - dc / (radius + 0.03), 0.0, 1.0)
		kick[i] = kick.get(i, Vector3.ZERO) + vel[best] * (0.4 + 0.6 * k) + _rand_v(0.4)
		tissue[i] = maxf(tissue[i], k * 0.6)
	# Tear lines: triangles lying between two pieces are ripped out.
	for f in cent.size():
		var c := cent[f]
		if c.distance_to(centre) > radius + 0.004:
			continue
		var d1 := INF
		var d2 := INF
		var nearest := 0
		for s in seeds.size():
			var dd := c.distance_to(seeds[s])
			if dd < d1:
				d2 = d1
				d1 = dd
				nearest = s
			elif dd < d2:
				d2 = dd
		var dc := c.distance_to(centre)
		# Rip lines between pieces; the rim is torn through where the piece is
		# thrown hard (it comes off) and left attached where it is not (a flap).
		if d2 - d1 < 0.016 or (dc > radius - 0.018 and strong[nearest]) or (dc < radius * 0.3 and randf() < 0.6):
			dead[f] = 1
	# Skull fragments.
	for i in randi_range(3, 7):
		_bone_shard(centre + _rand_v(radius * 0.5), vel[randi() % vel.size()] + _rand_v(1.5))


func _split(dead: PackedByteArray, loose: PackedByteArray, kick: Dictionary, tissue: PackedFloat32Array) -> void:
	var n := _pos.size()
	var face_n := _faces.size() / 3
	# Raw tissue along every torn edge.
	for f in face_n:
		if dead[f] == 1:
			for j in 3:
				tissue[_faces[f * 3 + j]] = maxf(tissue[_faces[f * 3 + j]], 1.0)
	# Connected pieces (union-find over the surviving triangles).
	var parent := PackedInt32Array()
	parent.resize(n)
	for i in n:
		parent[i] = i
	for f in face_n:
		if dead[f] == 0:
			var a := _find(parent, _faces[f * 3])
			for j in range(1, 3):
				var b := _find(parent, _faces[f * 3 + j])
				if a != b:
					parent[b] = a
	var pinned_root := {}
	for i in n:
		if _pin[i] == 1 and loose[i] == 0:
			pinned_root[_find(parent, i)] = true
	var groups := {}   # root -> face list
	for f in face_n:
		if dead[f] == 0:
			var r := _find(parent, _faces[f * 3])
			# Packed arrays are values: read, append, store back.
			var fl: PackedInt32Array = groups.get(r, PackedInt32Array())
			fl.append(f)
			groups[r] = fl

	var keep := PackedInt32Array()
	for r in groups:
		var fl: PackedInt32Array = groups[r]
		if pinned_root.has(r):
			keep.append_array(fl)
		elif fl.size() >= 8 and _chunks.size() < MAX_CHUNKS:
			_spawn_chunk(fl, kick, tissue)
		else:
			# Shreds too small to simulate: they go as blood and mist.
			var c := _pos[_faces[fl[0] * 3]]
			if Game.blood:
				Game.blood.spawn_drop(c, (kick.get(_faces[fl[0] * 3], Vector3.ZERO) as Vector3), 0.4 * fl.size())

	# Rebuild the attached part.
	var remap := {}
	var pos := PackedVector3Array()
	var cols := PackedColorArray()
	var pins := PackedByteArray()
	var faces := PackedInt32Array()
	var main_kick := {}
	for f in keep:
		for j in 3:
			var i := _faces[f * 3 + j]
			if not remap.has(i):
				remap[i] = pos.size()
				pos.append(_pos[i])
				var c := _col[i]
				c.a = clampf(maxf(c.a, tissue[i]), 0.0, 1.0)
				cols.append(c)
				pins.append(1 if _pin[i] == 1 and loose[i] == 0 else 0)
				if kick.has(i):
					main_kick[remap[i]] = kick[i] * 0.5
			faces.append(remap[i])
	var old := main
	_pos = pos
	_col = cols
	_pin = pins
	_faces = faces
	main = _make_soft(_pos, _faces, _col, _pin) if not faces.is_empty() else null
	if main and not main_kick.is_empty():
		_pending.append([main, main_kick])
	if is_instance_valid(old):
		old.queue_free()


func _spawn_chunk(fl: PackedInt32Array, kick: Dictionary, tissue: PackedFloat32Array) -> void:
	var remap := {}
	var pos := PackedVector3Array()
	var cols := PackedColorArray()
	var faces := PackedInt32Array()
	var k := {}
	var meat := PackedInt32Array()
	for f in fl:
		for j in 3:
			var i := _faces[f * 3 + j]
			if not remap.has(i):
				remap[i] = pos.size()
				pos.append(_pos[i])
				var c := _col[i]
				c.a = clampf(maxf(c.a, tissue[i]), 0.0, 1.0)
				cols.append(c)
				if c.a > 0.5:
					meat.append(remap[i])
				k[remap[i]] = kick.get(i, Vector3.ZERO)
			faces.append(remap[i])
	var sb := _make_soft(pos, faces, cols, PackedByteArray())
	sb.linear_stiffness = 0.75
	_pending.append([sb, k])
	_chunks.append([sb, _time, meat])


func _bone_shard(at: Vector3, vel: Vector3) -> void:
	var rb := RigidBody3D.new()
	rb.collision_layer = Game.LAYER_DEBRIS
	rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
	rb.mass = 0.015
	rb.continuous_cd = true
	var size := randf_range(0.012, 0.028)
	var mi := MeshInstance3D.new()
	mi.mesh = Geo.rock_mesh(size, randi(), 0.35)
	mi.material_override = _bone_mat
	rb.add_child(mi)
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(size * 1.6, size * 0.7, size * 1.6)
	cs.shape = box
	rb.add_child(cs)
	get_tree().current_scene.add_child(rb)
	rb.global_position = at
	rb.linear_velocity = vel
	rb.angular_velocity = _rand_v(25.0)
	get_tree().create_timer(40.0).timeout.connect(rb.queue_free)


func _update_chunks(delta: float) -> void:
	_drip_t += delta
	var drip := _drip_t > 0.2
	if drip:
		_drip_t = 0.0
	var i := 0
	while i < _chunks.size():
		var sb: SoftBody3D = _chunks[i][0]
		var age: float = _time - _chunks[i][1]
		if not is_instance_valid(sb):
			_chunks.remove_at(i)
			continue
		if age > CHUNK_BAKE_TIME:
			_bake(sb)
			_chunks.remove_at(i)
			continue
		var meat: PackedInt32Array = _chunks[i][2]
		if drip and age < 6.0 and not meat.is_empty() and Game.blood:
			# Torn tissue keeps dripping for a while.
			var p := sb.get_point_transform(meat[randi() % meat.size()])
			Game.blood.spawn_drop(p + Vector3.DOWN * 0.005, Vector3.ZERO, 0.25, Game.blood._no_ex, 0.0, true)
		i += 1


## A settled piece becomes a plain mesh: no more simulation cost.
func _bake(sb: SoftBody3D) -> void:
	var am := sb.mesh as ArrayMesh
	var arrays := am.surface_get_arrays(0)
	var pos: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	for i in pos.size():
		pos[i] = sb.get_point_transform(i)
	arrays[Mesh.ARRAY_VERTEX] = pos
	var baked := ArrayMesh.new()
	baked.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	baked.surface_set_material(0, _mat)
	var mi := MeshInstance3D.new()
	mi.mesh = baked
	mi.layers = 2
	get_tree().current_scene.add_child(mi)
	sb.queue_free()


# --- Helpers -----------------------------------------------------------------------------

## Where the bullet leaves the head: the farthest shell point near its line.
func _exit_point(p: Vector3, d: Vector3) -> Vector3:
	var best := 0.0
	for q in _pos:
		var t := (q - p).dot(d)
		if t > best and (q - (p + d * t)).length() < 0.02:
			best = t
	return p + d * (best if best > 0.03 else 0.15)


static func _dist_seg(c: Vector3, a: Vector3, b: Vector3) -> float:
	var ab := b - a
	var t := clampf((c - a).dot(ab) / maxf(ab.length_squared(), 1e-8), 0.0, 1.0)
	return c.distance_to(a + ab * t)


static func _find(parent: PackedInt32Array, i: int) -> int:
	while parent[i] != i:
		parent[i] = parent[parent[i]]
		i = parent[i]
	return i


static func _rand_v(r: float) -> Vector3:
	return Vector3(randf_range(-r, r), randf_range(-r, r), randf_range(-r, r))
