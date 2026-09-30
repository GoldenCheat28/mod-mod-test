extends Node
## Solid, destructible head. The head is a volume: a density grid (8 mm cells)
## with a material per cell - skin on the outside, the skull under it, brain
## inside the skull, muscle in the face and jaw. It is drawn as a surface
## extracted from that volume (surface nets), so wherever material is removed
## the cut shows what was inside.
##
## Bullets carve a channel through the volume with a small entry and a torn
## exit crater. A shotgun blast breaks the exit side into pieces along random
## fracture lines: pieces thrown hard come off as closed soft bodies with
## internal pressure (they keep their volume and wobble like jelly), weak ones
## stay pinned where they were attached and hang. Anything no longer connected
## to the neck falls off too. The remaining head ripples briefly where it was
## hit. All volume work runs on a worker thread; the result is applied a frame
## or two later, so shots do not stall the game.

const Geo = preload("res://scripts/world/geo.gd")
const Tex = preload("res://scripts/world/textures.gd")

enum { AIR, SKIN, BONE, BRAIN, MUSCLE }

const CELL := 0.008
const MAX_CHUNKS := 12
const CHUNK_BAKE_TIME := 9.0
const TISSUE_DENSITY := 1050.0      # kg/m^3
const CORNERS := [Vector3(0, 0, 0), Vector3(1, 0, 0), Vector3(0, 1, 0), Vector3(1, 1, 0),
		Vector3(0, 0, 1), Vector3(1, 0, 1), Vector3(0, 1, 1), Vector3(1, 1, 1)]
const EDGES := [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]

var bot
var head: RigidBody3D
var active := false
var main_mesh: MeshInstance3D
var _mat: ShaderMaterial
var _chunk_mat: ShaderMaterial      # same look, no jelly deformation (chunks are in world space)

# Volume (head-local). Point (x, y, z) is at _origin + Vector3(x, y, z) * _h.
var _n := Vector3i.ZERO
var _h := CELL
var _origin := Vector3.ZERO
var _dens := PackedFloat32Array()   # < 0 inside
var _mtl := PackedByteArray()
var _skin := PackedColorArray()     # surface colour (skin, hair, eyes, lips) per point

var _busy := false
var _queue: Array = []              # [local point, local dir, weapon]
var _chunks: Array = []             # [SoftBody3D, birth, point mass]
var _pending: Array = []            # [SoftBody3D, Vector3 velocity, point mass]
var _time := 0.0
var _drip_t := 0.0
# Jelly springs: overall swell, squash/stretch (per axis, volume preserving)
# and the temporary cavity along the last bullet path.
var _swell := Vector2.ZERO           # (position, velocity)
var _squash := Vector3.ZERO
var _squash_v := Vector3.ZERO
var _cavity := Vector2.ZERO
var _jelly := false
var _spawned := 0
var _need_build := false

static var _bone_mat: StandardMaterial3D
static var _shader: Shader


static func materials() -> Array[Material]:
	if _shader == null:
		_shader = load("res://shaders/voxel_flesh.gdshader")
		_bone_mat = StandardMaterial3D.new()
		_bone_mat.albedo_color = Color(0.86, 0.8, 0.7)
		_bone_mat.roughness = 0.6
	var m := ShaderMaterial.new()
	m.shader = _shader
	m.set_shader_parameter("tex_noise", Tex.detail())
	return [m, _bone_mat]


func setup(b) -> void:
	bot = b
	head = b.head
	_mat = materials()[0]
	_chunk_mat = materials()[0]
	_mat.set_shader_parameter("face_on", true)
	_mat.set_shader_parameter("head_scale", b.scale_factor)
	var s: float = b.scale_factor
	_h = CELL * s
	var lo := Vector3(-0.12, -0.155, -0.14) * s
	var hi := Vector3(0.12, 0.15, 0.135) * s
	_origin = lo
	_n = Vector3i(ceili((hi.x - lo.x) / _h) + 1, ceili((hi.y - lo.y) / _h) + 1, ceili((hi.z - lo.z) / _h) + 1)


## Replace the head's look with the (undamaged) volume now.
func build() -> void:
	active = true
	_need_build = true


func hit(point: Vector3, dir: Vector3, weapon: String) -> void:
	active = true
	var inv := head.global_transform.affine_inverse()
	var p := inv * point
	var d := (inv.basis * dir).normalized()
	_queue.append([p, d, weapon])
	# The pressure wave: the head balloons out and then wobbles like jelly.
	# A pistol makes it visible, a shotgun (several pellets at once) a lot more.
	var k := 0.55 if weapon in ["shotgun", "frag"] else (1.3 if weapon == "akm" else 1.0)
	_swell.y += 2.4 * k
	_cavity.y += 0.6 * k
	var m := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1))
	m -= Vector3.ONE * (m.x + m.y + m.z) / 3.0
	_squash_v += m * 1.8 * k
	var ex := _exit(_dens, p, d) if not _dens.is_empty() else p + d * 0.18
	_mat.set_shader_parameter("path_a", p)
	_mat.set_shader_parameter("path_b", ex)
	_jelly = true


## Chainsaw: the blade moved from a0..b0 to a1..b1 (world) in its own plane.
## Exactly the strip it passed through is cut away (a kerf the width of the
## chain), so the cut goes where the saw went and as far as it went. Where
## the kerf goes all the way through, the part no longer joined to the neck
## comes off (see _detached) as a solid piece showing the inside.
func sweep(a0: Vector3, b0: Vector3, a1: Vector3, b1: Vector3, normal: Vector3) -> void:
	active = true
	var inv := head.global_transform.affine_inverse()
	_queue.append(["sweep", inv * a0, inv * b0, inv * a1, inv * b1, (inv.basis * normal).normalized()])


func _carve_sweep(dens: PackedFloat32Array, a0: Vector3, b0: Vector3, a1: Vector3, b1: Vector3, n: Vector3) -> void:
	var k := 0.006      # a little wider than a voxel, so the kerf is never broken
	var lo := a0.min(b0).min(a1).min(b1) - Vector3.ONE * (k + _h)
	var hi := a0.max(b0).max(a1).max(b1) + Vector3.ONE * (k + _h)
	var glo := _grid(lo).clamp(Vector3i.ZERO, _n - Vector3i.ONE)
	var ghi := (_grid(hi) + Vector3i.ONE).clamp(Vector3i.ZERO, _n)
	for z in range(glo.z, ghi.z):
		for y in range(glo.y, ghi.y):
			for x in range(glo.x, ghi.x):
				var p := _origin + Vector3(x, y, z) * _h
				var d := (p - a1).dot(n)
				if absf(d) > k:
					continue
				var q := p - n * d
				# Inside the swept strip, or on the bar where it is now.
				if not (_in_tri(q, a0, b0, b1, n) or _in_tri(q, a0, b1, a1, n) 						or _seg_dist(q, a1, b1) < k):
					continue
				var i := x + _n.x * (y + _n.y * z)
				dens[i] = maxf(dens[i], k - absf(d) + _h * 0.1)


static func _in_tri(p: Vector3, a: Vector3, b: Vector3, c: Vector3, n: Vector3) -> bool:
	if absf((b - a).cross(c - a).dot(n)) < 1e-7:
		return false     # the bar has not moved: nothing swept
	var s1 := (b - a).cross(p - a).dot(n)
	var s2 := (c - b).cross(p - b).dot(n)
	var s3 := (a - c).cross(p - c).dot(n)
	return (s1 >= 0.0 and s2 >= 0.0 and s3 >= 0.0) or (s1 <= 0.0 and s2 <= 0.0 and s3 <= 0.0)


static func _seg_dist(p: Vector3, a: Vector3, b: Vector3) -> float:
	var ab := b - a
	var t := clampf((p - a).dot(ab) / maxf(ab.length_squared(), 1e-9), 0.0, 1.0)
	return p.distance_to(a + ab * t)


func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["voxel_head._physics_process"] = Game.prof.get("voxel_head._physics_process", 0) + __d
	Game.prof["max voxel_head._physics_process"] = maxi(Game.prof.get("max voxel_head._physics_process", 0), __d)


func _physics_process_real(delta: float) -> void:
	_time += delta
	for p in _pending:
		var sb: SoftBody3D = p[0]
		if is_instance_valid(sb):
			var imp: Vector3 = p[1] * p[2]
			for i in (sb.mesh as ArrayMesh).surface_get_array_len(0):
				sb.apply_impulse(i, imp)
	_pending.clear()
	if active and not _busy and (not _queue.is_empty() or _need_build):
		_busy = true
		_need_build = false
		var hits := _queue
		_queue = []
		_task_id = WorkerThreadPool.add_task(_job.bind(_dens, _mtl, _skin, hits, randi()), false, "head damage")
	_update_chunks(delta)
	if _jelly:
		_update_jelly(delta)


## Damped springs, a few substeps per frame for stability.
func _update_jelly(delta: float) -> void:
	var steps := 4
	var dt := delta / steps
	for s in steps:
		# Swell: ~5.5 Hz, lightly damped - one big balloon then a few wobbles.
		_swell.y += (-1200.0 * _swell.x - 2.0 * 0.2 * 34.6 * _swell.y) * dt
		_swell.x += _swell.y * dt
		_squash_v += (-800.0 * _squash - 2.0 * 0.14 * 28.3 * _squash_v) * dt
		_squash += _squash_v * dt
		_cavity.y += (-2500.0 * _cavity.x - 2.0 * 0.3 * 50.0 * _cavity.y) * dt
		_cavity.x += _cavity.y * dt
	_mat.set_shader_parameter("swell", _swell.x)
	_mat.set_shader_parameter("squash", _squash)
	_mat.set_shader_parameter("cavity", maxf(_cavity.x, -0.002))
	if absf(_swell.x) + absf(_swell.y) * 0.03 + _squash.length() + _squash_v.length() * 0.03 + absf(_cavity.x) < 1e-4:
		_jelly = false
		_mat.set_shader_parameter("swell", 0.0)
		_mat.set_shader_parameter("squash", Vector3.ZERO)
		_mat.set_shader_parameter("cavity", 0.0)


# --- Volume setup (worker thread) ---------------------------------------------------

## Head-local surface point in unit direction u: skull ellipsoid, jaw, nose, ears.
func _shape(u: Vector3) -> Vector3:
	var s: float = bot.scale_factor
	var p := Vector3(u.x * 0.093, u.y * 0.115, u.z * 0.106)
	var jaw := smoothstep(-0.25, -0.85, u.y) * smoothstep(0.4, -0.5, u.z)
	p += Vector3(-p.x * 0.18 * jaw, -0.022 * jaw, -0.012 * jaw)
	var nose := exp(-pow(u.distance_to(Vector3(0, -0.12, -0.99).normalized()) / 0.2, 2.0))
	var ear := 0.0
	for sx in [-1.0, 1.0]:
		ear = maxf(ear, exp(-pow(u.distance_to(Vector3(sx, 0.02, 0.12).normalized()) / 0.17, 2.0)))
	p += u * (nose * 0.016 + ear * 0.011)
	return p * s


var _task_id := -1


## Taken out of the world (the body carried off and gone): the damage being
## worked out on another thread is let finish first - it uses this head.
func _exit_tree() -> void:
	if _task_id >= 0 and not WorkerThreadPool.is_task_completed(_task_id):
		WorkerThreadPool.wait_for_task_completion(_task_id)
	_task_id = -1


func _surface_colour(u: Vector3) -> Color:
	if not is_instance_valid(bot):
		return Color.BLACK
	var skin: Color = bot.skin_color
	var hair: Color = bot._hair.albedo_color
	var c := skin
	if bot._has_hair:
		var hairline := u.y > 0.2 - 0.25 * clampf(u.z, 0.0, 1.0) and not (u.z < -0.55 and u.y < 0.62)
		if hairline or (u.z > 0.45 and u.y > -0.25):
			c = hair
	# (eyes, brows and mouth are drawn by the shader, so they can move)
	return c.srgb_to_linear()


func _build_volume() -> Array:
	var count := _n.x * _n.y * _n.z
	var dens := PackedFloat32Array()
	var mtl := PackedByteArray()
	var skin := PackedColorArray()
	dens.resize(count)
	mtl.resize(count)
	skin.resize(count)
	if not is_instance_valid(bot):
		return [dens, mtl, skin]           # (the body was taken away meanwhile)
	var s: float = bot.scale_factor
	var i := 0
	for z in _n.z:
		for y in _n.y:
			for x in _n.x:
				var p := _origin + Vector3(x, y, z) * _h
				var r := p.length()
				var u := p / r if r > 1e-5 else Vector3.UP
				var d := r - _shape(u).length()
				dens[i] = clampf(d, -3.0 * _h, 3.0 * _h)
				var depth := -d
				if depth <= 0.0:
					mtl[i] = AIR
				elif depth < 1.6 * _h:
					mtl[i] = SKIN
				elif p.y > -0.035 * s or p.z > 0.03 * s:
					# Cranium: skull, then brain.
					mtl[i] = BONE if depth < 2.9 * _h else BRAIN
				else:
					# Face and jaw: muscle with the jaw bone in it.
					mtl[i] = BONE if depth > 2.6 * _h and depth < 3.6 * _h else MUSCLE
				skin[i] = _surface_colour(u)
				i += 1
	return [dens, mtl, skin]


# --- Damage (worker thread) -----------------------------------------------------------

func _job(dens: PackedFloat32Array, mtl: PackedByteArray, skin: PackedColorArray, hits: Array, seed_value: int) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var noise := FastNoiseLite.new()
	noise.seed = seed_value
	noise.frequency = 60.0
	if not is_instance_valid(bot):
		return                             # (the body was taken away meanwhile)
	var first := dens.is_empty()
	if first:
		var vol := _build_volume()
		dens = vol[0]
		mtl = vol[1]
		skin = vol[2]
	var pellets: Array = []
	var wob := Vector3.ZERO
	var strength := 0.0
	var dust: Array = []
	var sawn := false
	var saw_cut := Plane()
	for h in hits:
		if h[0] is String and h[0] == "sweep":
			_carve_sweep(dens, h[1], h[2], h[3], h[4], h[5])
			sawn = true
			saw_cut = Plane(h[5], h[3])
			continue
		var p: Vector3 = h[0]
		var d: Vector3 = h[1]
		var shotgun: bool = h[2] == "shotgun"
		var ex := _exit(dens, p, d)
		wob = ex
		if shotgun:
			pellets.append([p, d, ex])
			_carve_capsule(dens, p - d * 0.01, ex + d * 0.01, 0.0065)
			_carve_sphere(dens, p, 0.009, noise, 0.3)
			strength = maxf(strength, 0.006)
		else:
			# 9 mm: narrow channel, small entry, torn exit crater.
			_carve_capsule(dens, p - d * 0.01, ex + d * 0.01, 0.005)
			_carve_sphere(dens, p, 0.007, noise, 0.3)
			_carve_sphere(dens, ex, 0.02, noise, 0.45)
			dust.append(ex)
			strength = maxf(strength, 0.004)

	var orig := dens.duplicate()
	var pieces: Array = []   # [PackedInt32Array points, velocity, pinned]
	if pellets.size() >= 2:
		pieces = _blast(dens, pellets, rng, noise, dust)
	# Whatever is no longer connected to the neck falls off.
	pieces.append_array(_detached(dens, rng, pellets, saw_cut if sawn else Plane()))

	var main := _nets(dens, mtl, skin, Vector3i.ZERO, _n - Vector3i.ONE)
	var chunks: Array = []
	for pc in pieces:
		var pts: PackedInt32Array = pc[0]
		if pts.size() < 25:
			continue
		var cd := PackedFloat32Array()
		cd.resize(dens.size())
		cd.fill(_h)
		var lo := _n
		var hi := Vector3i.ZERO
		for i in pts:
			cd[i] = minf(orig[i], -_h * 0.2)
			var g := _coords(i)
			lo = Vector3i(mini(lo.x, g.x), mini(lo.y, g.y), mini(lo.z, g.z))
			hi = Vector3i(maxi(hi.x, g.x), maxi(hi.y, g.y), maxi(hi.z, g.z))
		lo = (lo - Vector3i.ONE).clamp(Vector3i.ZERO, _n - Vector3i.ONE)
		hi = (hi + Vector3i.ONE).clamp(Vector3i.ZERO, _n - Vector3i.ONE)
		var mesh := _nets(cd, mtl, skin, lo, hi)
		if (mesh[3] as PackedInt32Array).size() < 36:
			continue
		chunks.append({"mesh": mesh, "vel": pc[1], "pinned": pc[2] and not sawn, "rigid": sawn,
				"mass": pts.size() * pow(_h, 3.0) * TISSUE_DENSITY})
	_apply.call_deferred({"dens": dens, "mtl": mtl, "skin": skin, "main": main, "chunks": chunks,
			"wob": wob, "strength": strength, "dust": dust, "first": first})


## Exit point of a straight path through the volume.
func _exit(dens: PackedFloat32Array, p: Vector3, d: Vector3) -> Vector3:
	var last := p
	var t := 0.0
	while t < 0.4:
		var q := p + d * t
		if _sample(dens, q) < 0.0:
			last = q
		t += _h * 0.5
	return last


func _blast(dens: PackedFloat32Array, pellets: Array, rng: RandomNumberGenerator, noise: FastNoiseLite, dust: Array) -> Array:
	var ex := Vector3.ZERO
	var d := Vector3.ZERO
	for pl in pellets:
		ex += pl[2]
		d += pl[1]
	ex /= pellets.size()
	d = d.normalized()
	var s: float = bot.scale_factor
	var radius := (0.045 + 0.011 * pellets.size()) * s
	var centre := ex - d * radius * 0.35
	dust.append(centre)
	var seeds: Array[Vector3] = []
	var vel: Array[Vector3] = []
	var pinned: Array[bool] = []
	for k in rng.randi_range(4, 6):
		var sd := centre + Vector3(rng.randf_range(-1, 1), rng.randf_range(-1, 1), rng.randf_range(-1, 1)) * radius * 0.8
		seeds.append(sd)
		var weak := rng.randf() < 0.3
		pinned.append(weak)
		var out := sd.normalized()
		vel.append(Vector3.ZERO if weak else d * rng.randf_range(3.0, 7.0) + out * rng.randf_range(1.0, 3.0))
	var groups: Array = []
	for k in seeds.size():
		groups.append(PackedInt32Array())
	var lo := _grid(centre - Vector3.ONE * radius * 1.3)
	var hi := _grid(centre + Vector3.ONE * radius * 1.3) + Vector3i.ONE
	for z in range(lo.z, hi.z):
		for y in range(lo.y, hi.y):
			for x in range(lo.x, hi.x):
				var i := x + _n.x * (y + _n.y * z)
				if dens[i] >= 0.0:
					continue
				var p := _origin + Vector3(x, y, z) * _h
				var dc := p.distance_to(centre)
				if dc > radius * (1.0 + 0.3 * noise.get_noise_3dv(p)):
					continue
				if dc < radius * 0.28:
					dens[i] = _h        # pulverised
					continue
				var d1 := INF
				var d2 := INF
				var k1 := 0
				for k in seeds.size():
					var dd := p.distance_to(seeds[k])
					if dd < d1:
						d2 = d1
						d1 = dd
						k1 = k
					elif dd < d2:
						d2 = dd
				if d2 - d1 < _h * 1.3:
					dens[i] = _h        # fracture line
					continue
				dens[i] = _h            # leaves the head as part of piece k1
				var arr: PackedInt32Array = groups[k1]
				arr.append(i)
				groups[k1] = arr
	var out: Array = []
	for k in seeds.size():
		out.append([groups[k], vel[k], pinned[k]])
	return out


## Pieces of the head no longer connected to the neck (flood fill from it).
## After a saw cut the neck itself may be split: only its cells on one side of
## the blade count, so a head sawn right through loses the other half.
func _detached(dens: PackedFloat32Array, rng: RandomNumberGenerator, pellets: Array, cut := Plane()) -> Array:
	var count := dens.size()
	var seen := PackedByteArray()
	seen.resize(count)
	var stack := PackedInt32Array()
	var s: float = bot.scale_factor
	# The neck joins the head low and slightly back of centre.
	var neck := Vector3(0, -0.085, 0.01) * s
	var has_cut := cut.normal != Vector3.ZERO
	var keep := 1.0 if not has_cut or cut.distance_to(neck) >= 0.0 else -1.0
	for i in count:
		var p := _origin + Vector3(_coords(i)) * _h
		if dens[i] < 0.0 and p.distance_to(neck) < 0.04 * s:
			if has_cut and cut.distance_to(p) * keep < 0.0:
				continue
			seen[i] = 1
			stack.append(i)
	_flood(dens, seen, stack, 1)
	var dir := Vector3.ZERO
	for pl in pellets:
		dir += pl[1]
	var out: Array = []
	for i in count:
		if dens[i] < 0.0 and seen[i] == 0:
			seen[i] = 2
			var comp := _flood(dens, seen, PackedInt32Array([i]), 2)
			for j in comp:
				dens[j] = _h
			var v := dir.normalized() * rng.randf_range(1.0, 3.0) + Vector3(rng.randf_range(-1, 1), rng.randf(), rng.randf_range(-1, 1))
			out.append([comp, v, false])
	return out


## 6-connected flood fill over solid points; marks `mark` and returns them.
func _flood(dens: PackedFloat32Array, seen: PackedByteArray, stack: PackedInt32Array, mark: int) -> PackedInt32Array:
	var got := PackedInt32Array()
	var nx := _n.x
	var nxy := _n.x * _n.y
	var steps := [1, -1, nx, -nx, nxy, -nxy]
	while not stack.is_empty():
		var i := stack[stack.size() - 1]
		stack.resize(stack.size() - 1)
		got.append(i)
		for st in steps:
			var j: int = i + st
			if j >= 0 and j < dens.size() and seen[j] == 0 and dens[j] < 0.0:
				seen[j] = mark
				stack.append(j)
	return got


func _carve_capsule(dens: PackedFloat32Array, a: Vector3, b: Vector3, r: float) -> void:
	var lo := _grid(Vector3(minf(a.x, b.x), minf(a.y, b.y), minf(a.z, b.z)) - Vector3.ONE * (r + _h))
	var hi := _grid(Vector3(maxf(a.x, b.x), maxf(a.y, b.y), maxf(a.z, b.z)) + Vector3.ONE * (r + _h)) + Vector3i.ONE
	var ab := b - a
	var len2 := maxf(ab.length_squared(), 1e-9)
	for z in range(lo.z, hi.z):
		for y in range(lo.y, hi.y):
			for x in range(lo.x, hi.x):
				var p := _origin + Vector3(x, y, z) * _h
				var t := clampf((p - a).dot(ab) / len2, 0.0, 1.0)
				var dist := p.distance_to(a + ab * t)
				var i := x + _n.x * (y + _n.y * z)
				dens[i] = maxf(dens[i], r - dist)


func _carve_sphere(dens: PackedFloat32Array, c: Vector3, r: float, noise: FastNoiseLite, rough: float) -> void:
	var reach := r * (1.0 + rough) + _h
	var lo := _grid(c - Vector3.ONE * reach)
	var hi := _grid(c + Vector3.ONE * reach) + Vector3i.ONE
	for z in range(lo.z, hi.z):
		for y in range(lo.y, hi.y):
			for x in range(lo.x, hi.x):
				var p := _origin + Vector3(x, y, z) * _h
				var rr := r * (1.0 + rough * noise.get_noise_3dv(p))
				var i := x + _n.x * (y + _n.y * z)
				dens[i] = maxf(dens[i], rr - p.distance_to(c))


func _grid(p: Vector3) -> Vector3i:
	var g := Vector3i(floori((p.x - _origin.x) / _h), floori((p.y - _origin.y) / _h), floori((p.z - _origin.z) / _h))
	return g.clamp(Vector3i.ZERO, _n - Vector3i.ONE)


func _coords(i: int) -> Vector3i:
	var x := i % _n.x
	var y := (i / _n.x) % _n.y
	return Vector3i(x, y, i / (_n.x * _n.y))


## Trilinear density at a head-local point (outside the grid counts as air).
func _sample(dens: PackedFloat32Array, p: Vector3) -> float:
	var f := (p - _origin) / _h
	var g := Vector3i(floori(f.x), floori(f.y), floori(f.z))
	if g.x < 0 or g.y < 0 or g.z < 0 or g.x >= _n.x - 1 or g.y >= _n.y - 1 or g.z >= _n.z - 1:
		return _h
	var t := f - Vector3(g)
	var i := g.x + _n.x * (g.y + _n.y * g.z)
	var nx := _n.x
	var nxy := _n.x * _n.y
	var c00 := lerpf(dens[i], dens[i + 1], t.x)
	var c10 := lerpf(dens[i + nx], dens[i + nx + 1], t.x)
	var c01 := lerpf(dens[i + nxy], dens[i + nxy + 1], t.x)
	var c11 := lerpf(dens[i + nxy + nx], dens[i + nxy + nx + 1], t.x)
	return lerpf(lerpf(c00, c10, t.y), lerpf(c01, c11, t.y), t.z)


# --- Surface extraction (surface nets) -----------------------------------------------------

## Mesh of the solid part of `dens` over cells lo..hi (inclusive of their far
## corners). Returns [vertices, normals, colours, indices], head-local.
## Colour comes from the most-inside corner of each cell: skin where the
## surface is the original outside, the inner material where it was cut.
func _nets(dens: PackedFloat32Array, mtl: PackedByteArray, skin: PackedColorArray, lo: Vector3i, hi: Vector3i) -> Array:
	var nx := _n.x
	var nxy := _n.x * _n.y
	var cell := PackedInt32Array()
	cell.resize(dens.size())
	cell.fill(-1)
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var dd := PackedFloat32Array()
	dd.resize(8)
	var offs := PackedInt32Array([0, 1, nx, nx + 1, nxy, nxy + 1, nxy + nx, nxy + nx + 1])
	var interior := {
		BONE: Color(0.5, 0.42, 0.3, 1.0),
		BRAIN: Color(0.5, 0.24, 0.22, 1.0),
		MUSCLE: Color(0.24, 0.02, 0.014, 1.0),
	}
	for z in range(lo.z, hi.z):
		for y in range(lo.y, hi.y):
			for x in range(lo.x, hi.x):
				var i0 := x + nx * (y + _n.y * z)
				var inside := 0
				var best := -1
				for k in 8:
					var v := dens[i0 + offs[k]]
					dd[k] = v
					if v < 0.0:
						inside += 1
						# The inside corner nearest the surface decides what shows.
						if best < 0 or v > dd[best]:
							best = k
				if inside == 0 or inside == 8:
					continue
				var sum := Vector3.ZERO
				var cnt := 0
				for e in EDGES:
					var a: int = e[0]
					var b: int = e[1]
					if (dd[a] < 0.0) != (dd[b] < 0.0):
						var t := dd[a] / (dd[a] - dd[b])
						sum += (CORNERS[a] as Vector3).lerp(CORNERS[b], t)
						cnt += 1
				cell[i0] = verts.size()
				verts.append(_origin + (Vector3(x, y, z) + sum / cnt) * _h)
				var g := Vector3(dd[1] - dd[0] + dd[3] - dd[2] + dd[5] - dd[4] + dd[7] - dd[6],
						dd[2] - dd[0] + dd[3] - dd[1] + dd[6] - dd[4] + dd[7] - dd[5],
						dd[4] - dd[0] + dd[5] - dd[1] + dd[6] - dd[2] + dd[7] - dd[3])
				norms.append(g.normalized() if g.length() > 1e-9 else Vector3.UP)
				var src := i0 + offs[best]
				var m: int = mtl[src]
				if m == SKIN or m == AIR:
					var c := skin[src]
					c.a = 0.0
					cols.append(c)
				else:
					cols.append(interior[m])
	# One quad per grid edge that crosses the surface.
	var idx := PackedInt32Array()
	for z in range(lo.z, hi.z + 1):
		for y in range(lo.y, hi.y + 1):
			for x in range(lo.x, hi.x + 1):
				var i := x + nx * (y + _n.y * z)
				var inside_a := dens[i] < 0.0
				if x < hi.x and y > lo.y and z > lo.z and inside_a != (dens[i + 1] < 0.0):
					_quad(idx, verts, norms, cell[i - nx - nxy], cell[i - nxy], cell[i], cell[i - nx])
				if y < hi.y and x > lo.x and z > lo.z and inside_a != (dens[i + nx] < 0.0):
					_quad(idx, verts, norms, cell[i - 1 - nxy], cell[i - nxy], cell[i], cell[i - 1])
				if z < hi.z and x > lo.x and y > lo.y and inside_a != (dens[i + nxy] < 0.0):
					_quad(idx, verts, norms, cell[i - 1 - nx], cell[i - nx], cell[i], cell[i - 1])
	return [verts, norms, cols, idx]


func _quad(idx: PackedInt32Array, verts: PackedVector3Array, norms: PackedVector3Array, a: int, b: int, c: int, d: int) -> void:
	if a < 0 or b < 0 or c < 0 or d < 0:
		return
	_tri(idx, verts, norms, a, b, c)
	_tri(idx, verts, norms, a, c, d)


## Adds a triangle wound clockwise as seen from outside (Godot's front face).
func _tri(idx: PackedInt32Array, verts: PackedVector3Array, norms: PackedVector3Array, a: int, b: int, c: int) -> void:
	var fn := (verts[b] - verts[a]).cross(verts[c] - verts[a])
	if fn.dot(norms[a] + norms[b] + norms[c]) > 0.0:
		idx.append_array([a, c, b])
	else:
		idx.append_array([a, b, c])


# --- Applying results (main thread) --------------------------------------------------------

func _apply(r: Dictionary) -> void:
	_busy = false
	if not is_instance_valid(head):
		return
	_dens = r["dens"]
	_mtl = r["mtl"]
	_skin = r["skin"]
	var main: Array = r["main"]
	if main_mesh == null:
		main_mesh = MeshInstance3D.new()
		main_mesh.layers = 2
		head.add_child(main_mesh)
		for mi in bot._head_meshes:
			mi.visible = false
	main_mesh.mesh = _array_mesh(main[0], main[1], main[2], main[3])
	var xf := head.global_transform
	for c in r["chunks"]:
		if c.get("rigid", false):
			_spawn_rigid(c, xf)
			continue
		if _spawned >= MAX_CHUNKS:
			break
		_spawn_chunk(c, xf)
	for p in r["dust"]:
		for k in 4:
			if Game.blood:
				Game.blood.spawn_drop(xf * (p as Vector3), head.linear_velocity + Vector3(randf_range(-1, 1), randf_range(0, 2), randf_range(-1, 1)), 0.6)
	if (r["chunks"] as Array).size() > 0:
		# Pieces off the head: the brain lies open and pours.
		if Game.blood:
			var wob: Vector3 = xf * (r["wob"] as Vector3)
			var out := wob - head.global_position
			out = out.normalized() if out.length() > 0.01 else head.global_basis.y
			Game.blood.open_jet(bot, head, wob, out, 100.0, true)
		for k in randi_range(3, 6):
			_bone_shard(xf * (r["wob"] as Vector3), xf.basis * Vector3(randf_range(-2, 2), randf_range(1, 3), randf_range(-2, 2)))


func _array_mesh(verts: PackedVector3Array, norms: PackedVector3Array, cols: PackedColorArray, idx: PackedInt32Array, mat: Material = null) -> ArrayMesh:
	var am := ArrayMesh.new()
	if idx.is_empty():
		return am
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_COLOR] = cols
	arrays[Mesh.ARRAY_INDEX] = idx
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	am.surface_set_material(0, mat if mat else _mat)
	return am


## A piece that left the head: a closed soft body with internal pressure, so
## it keeps its volume and wobbles. Weak pieces stay pinned where they still
## touch the head and hang from it.
func _spawn_chunk(c: Dictionary, xf: Transform3D) -> void:
	var mesh: Array = c["mesh"]
	var verts: PackedVector3Array = (mesh[0] as PackedVector3Array).duplicate()
	var norms: PackedVector3Array = (mesh[1] as PackedVector3Array).duplicate()
	var local := verts.duplicate()
	for i in verts.size():
		verts[i] = xf * verts[i]
		norms[i] = xf.basis * norms[i]
	var sb := SoftBody3D.new()
	sb.top_level = true
	sb.mesh = _array_mesh(verts, norms, mesh[2], mesh[3], _chunk_mat)
	sb.layers = 2
	sb.simulation_precision = 6
	sb.total_mass = maxf(c["mass"], 0.02)
	sb.linear_stiffness = 0.5
	sb.pressure_coefficient = 0.4
	sb.damping_coefficient = 0.02
	sb.collision_layer = Game.LAYER_DEBRIS
	sb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS
	sb.ray_pickable = false
	add_child(sb)
	sb.global_transform = Transform3D.IDENTITY
	for p in bot.parts:
		sb.add_collision_exception_with(p)
	var point_mass: float = sb.total_mass / maxf(verts.size(), 1.0)
	if c["pinned"]:
		# Hang from the head where the piece still touches it.
		var path := sb.get_path_to(head)
		var any := false
		for i in local.size():
			if _sample(_dens, local[i]) < _h * 1.2:
				sb.set_point_pinned(i, true, path)
				any = true
		if not any:
			sb.set_point_pinned(0, true, path)
	else:
		_pending.append([sb, xf.basis * (c["vel"] as Vector3) + head.linear_velocity, point_mass])
	_chunks.append([sb, _time, point_mass])
	_spawned += 1


## A piece sawn off: it keeps its shape (a solid body with the cut face
## showing skin, skull and brain in section).
func _spawn_rigid(c: Dictionary, xf: Transform3D) -> void:
	var mesh: Array = c["mesh"]
	var verts: PackedVector3Array = mesh[0]
	if verts.size() < 12:
		return
	var rb := RigidBody3D.new()
	rb.collision_layer = Game.LAYER_DEBRIS
	rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
	rb.mass = maxf(c["mass"], 0.1)
	rb.angular_damp = 0.4
	var mi := MeshInstance3D.new()
	mi.mesh = _array_mesh(verts, mesh[1], mesh[2], mesh[3], _chunk_mat)
	mi.layers = 2
	rb.add_child(mi)
	var cs := CollisionShape3D.new()
	var hull := ConvexPolygonShape3D.new()
	var pts := PackedVector3Array()
	var step := maxi(verts.size() / 60, 1)
	for i in range(0, verts.size(), step):
		pts.append(verts[i])
	hull.points = pts
	cs.shape = hull
	rb.add_child(cs)
	get_tree().current_scene.add_child(rb)
	rb.global_transform = xf
	rb.linear_velocity = head.linear_velocity + xf.basis * (c["vel"] as Vector3) * 0.2
	for p in bot.parts:
		rb.add_collision_exception_with(p)
	if rb.mass > 0.4 and bot.alive:
		bot._die("headshot")
	if Game.blood:
		for k in 6:
			Game.blood.spawn_drop(rb.global_position, rb.linear_velocity + Vector3(randf_range(-1, 1), randf(), randf_range(-1, 1)), 1.2)
	get_tree().create_timer(180.0).timeout.connect(rb.queue_free)


func _bone_shard(at: Vector3, vel: Vector3) -> void:
	var rb := RigidBody3D.new()
	rb.collision_layer = Game.LAYER_DEBRIS
	rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
	rb.mass = 0.015
	rb.continuous_cd = true
	var size := randf_range(0.01, 0.022)
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
	rb.angular_velocity = Vector3(randf_range(-25, 25), randf_range(-25, 25), randf_range(-25, 25))
	get_tree().create_timer(40.0).timeout.connect(rb.queue_free)


func _update_chunks(delta: float) -> void:
	_drip_t += delta
	var drip := _drip_t > 0.25
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
		if drip and age < 6.0 and Game.blood:
			var n := (sb.mesh as ArrayMesh).surface_get_array_len(0)
			var p := sb.get_point_transform(randi() % n)
			Game.blood.spawn_drop(p + Vector3.DOWN * 0.004, Vector3.ZERO, 0.25, Game.blood._no_ex, 0.0, true)
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
	baked.surface_set_material(0, _chunk_mat)
	var mi := MeshInstance3D.new()
	mi.mesh = baked
	mi.layers = 2
	get_tree().current_scene.add_child(mi)
	sb.queue_free()
