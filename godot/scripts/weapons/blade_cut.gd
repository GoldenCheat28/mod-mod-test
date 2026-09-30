extends RefCounted
## A blade in flesh, shared by the chainsaw and the machete. The blade is a
## straight bar (root a .. tip b) in its own plane, `half` deep either side of
## that line; it cuts on both sides (the chain) or on one edge only.
##
## When the blade first meets a part, the plane it is in becomes that part's
## cut: its section in the plane is measured and the stretch of it already cut
## is followed across the section. Then, like a real blade in a kerf:
## - the kerf walls hold it: moving the blade across its plane drags the part
##   (and the man it belongs to) with it;
## - the uncut flesh ahead stops it: pressing on, the edge cuts as far as the
##   weapon allows (see `limit`), and what it cannot cut it pushes;
## - back along the kerf it slides out freely, the way it went in;
## - along the bar it drags by friction (little with the chain running);
## - the hold has a strength: yanked harder than that, the blade tears out.
## When the cut has gone right across the section the part is cut through
## there (`on_through`); the head (a voxel volume) is carved along the way.

const Slicer = preload("res://scripts/fx/slicer.gd")

const K := 1400.0          # stiffness of the hold, per kg of the part (N/m)
const C := 37.0            # its damping, per kg (N s/m)

var cuts := {}             # body instance id -> cut state
var half := 0.035          # blade depth either side of its line
var edge := Vector3.ZERO   # world direction of the one cutting edge, or zero: both sides cut
var strength := 900.0      # most the hold can take (N) before the blade tears out
var grip := 0.3            # friction along the bar, 0..1
var wrench := 0.05         # how far (m) the part must be torn sideways off the blade to come free
var drift := 0.0           # how fast the kerf follows a blade wandering sideways (1/s)
var cutting := true        # the edge cuts at all (the chain running; the machete does)
## Called as limit.call(cut, want_m, dt) -> metres it may cut into that part now.
var limit: Callable
## Called as on_through.call(body, point, normal) when a part is cut right across.
var on_through: Callable

var reaction := Vector3.ZERO   # force the flesh put on the blade, last step (world)
var hold := 0.0                # how hard the blade is held, 0..1, last step
var in_flesh: Array = []       # [body, point, normal] for each part it is in, last step
var smooth := 0.5               # how much of each step's blade speed is taken (0..1)
var _a := Vector3.INF
var _b := Vector3.INF
var _va := Vector3.ZERO
var _vb := Vector3.ZERO


func clear() -> void:
	cuts.clear()
	_va = Vector3.ZERO
	_vb = Vector3.ZERO
	_a = Vector3.INF
	_b = Vector3.INF
	reaction = Vector3.ZERO
	hold = 0.0
	in_flesh.clear()


## One physics step: the blade is now at a..b in the plane with normal
## `plane_n`. Fast blades are followed in small steps so nothing is jumped.
func step(space: PhysicsDirectSpaceState3D, a: Vector3, b: Vector3, plane_n: Vector3, delta: float) -> void:
	if _a == Vector3.INF:
		_a = a
		_b = b
	var moved := maxf(_a.distance_to(a), _b.distance_to(b))
	var n_sub := clampi(ceili(moved / 0.012), 1, 16)
	# The blade's speed, smoothed: a chainsaw's shaking is not the blade
	# moving, and would come out as jolts in the hold.
	_va = _va.lerp((a - _a) / delta, smooth)
	_vb = _vb.lerp((b - _b) / delta, smooth)
	var va := _va
	var vb := _vb
	reaction = Vector3.ZERO
	hold = 0.0
	in_flesh.clear()
	var seen := {}
	for i in n_sub:
		var k := float(i + 1) / n_sub
		var sa := _a.lerp(a, k)
		var sb := _b.lerp(b, k)
		if cutting or not cuts.is_empty():
			_touch(space, sa, sb, plane_n)
		for id in cuts.keys():
			var st: Dictionary = cuts[id]
			if not is_instance_valid(st["body"]):
				cuts.erase(id)
				continue
			var r := _update(st, sa, sb, va, vb, plane_n, delta / n_sub)
			if r < 0:
				cuts.erase(id)
			elif r > 0 and not seen.has(id):
				seen[id] = true
				in_flesh.append([st["body"], st["point"], st["normal"]])
	# Each small step pushed for its share of the time.
	reaction /= n_sub
	_a = a
	_b = b


## New cuts where the blade has met a part: along its cutting line and both
## its edges, from each end (a ray stops at the first thing it meets).
func _touch(space: PhysicsDirectSpaceState3D, a: Vector3, b: Vector3, plane_n: Vector3) -> void:
	var across := plane_n.cross(b - a).normalized() * half
	for off in [Vector3.ZERO, across, -across]:
		for ends in [[a, b], [b, a]]:
			var q := PhysicsRayQueryParameters3D.create(ends[0] + off, ends[1] + off, Game.LAYER_BOTS)
			var hit := space.intersect_ray(q)
			if hit.is_empty() or not (hit.collider as Node).has_meta("humanoid"):
				continue
			var body := hit.collider as RigidBody3D
			var id := body.get_instance_id()
			if cuts.has(id):
				continue
			var st := _start(body, a, b, plane_n)
			if not st.is_empty():
				cuts[id] = st


## A new cut: the blade's plane in the part's own space (n), the axis across
## the section (w), how far the section reaches along it and the stretch
## already open: from the side the blade came in on to its far edge.
func _start(body: RigidBody3D, a: Vector3, b: Vector3, plane_n: Vector3) -> Dictionary:
	if body.has_meta("humanoid"):
		body.get_meta("humanoid").wake()
	var inv := body.global_transform.affine_inverse()
	var n := (inv.basis * plane_n).normalized()
	var la := inv * a
	var lb := inv * b
	var d := lb - la
	d = (d - n * d.dot(n)).normalized()
	var w := n.cross(d).normalized()
	var h = body.get_meta("humanoid")
	var head: bool = body == h.head and h.soft_head != null and not body.has_meta("piece")
	var c: Vector3
	var lo: float
	var hi: float
	if head:
		# A ball, near enough: the section is the circle the plane cuts.
		var r := 0.11 * float(h.scale_factor)
		var off := la.dot(n)
		if absf(off) > r * 0.95:
			return {}
		c = n * off
		var rr := sqrt(r * r - off * off)
		lo = -rr
		hi = rr
	else:
		var plane := Plane(n, la)
		var ring := PackedVector3Array()
		for ch in body.get_children():
			var mi := ch as MeshInstance3D
			if mi == null or not mi.visible or mi.mesh == null:
				continue
			var r := Slicer.slice(mi.mesh, mi.transform.affine_inverse() * plane, null)
			for p in r["ring"]:
				ring.append(mi.transform * p)
		if ring.size() < 3:
			return {}
		c = Vector3.ZERO
		for p in ring:
			c += p
		c /= ring.size()
		lo = INF
		hi = -INF
		for p in ring:
			lo = minf(lo, (p - c).dot(w))
			hi = maxf(hi, (p - c).dot(w))
	var s := _offset(la, lb, c, w)
	# Open already: everything from the blade's near side outwards.
	var open_lo := lo
	var open_hi := hi
	if s >= 0.0:
		open_lo = clampf(s - half, lo, hi)
	else:
		open_hi = clampf(s + half, lo, hi)
	return {"body": body, "head": head, "n": n, "o": c, "w": w, "min": lo, "max": hi,
			"lo": open_lo, "hi": open_hi, "kind": String(body.get_meta("part")).trim_suffix("_r").trim_suffix("_l"),
			"carve_lo": open_lo, "carve_hi": open_hi, "carve_t": 0.0, "point": a, "normal": plane_n}


## How far the bar line lies from the centre of the section, across it.
static func _offset(la: Vector3, lb: Vector3, c: Vector3, w: Vector3) -> float:
	var ab := lb - la
	var t := clampf((c - la).dot(ab) / maxf(ab.length_squared(), 1e-9), 0.0, 1.0)
	return (la + ab * t - c).dot(w)


## One small step of one cut. Returns 1 while the blade is in the part, 0 when
## it is out of it (the cut so far kept), -1 when the cut is over.
func _update(st: Dictionary, a: Vector3, b: Vector3, va: Vector3, vb: Vector3, plane_n: Vector3, dt: float) -> int:
	var body: RigidBody3D = st["body"]
	var xf := body.global_transform
	var inv := xf.affine_inverse()
	var la := inv * a
	var lb := inv * b
	var n: Vector3 = st["n"]
	var o: Vector3 = st["o"]
	var w: Vector3 = st["w"]
	var ab := lb - la
	var t := (o - la).dot(ab) / maxf(ab.length_squared(), 1e-9)
	var q := la + ab * clampf(t, 0.0, 1.0)
	if q.distance_to(o) > 0.6:
		return -1                     # taken well away
	if absf((inv.basis * plane_n).normalized().dot(n)) < 0.7:
		return -1                     # wrenched round out of the kerf: a fresh cut next time
	if t < -0.05 or t > 1.05:
		st.erase("tb")
		return 0                      # the part is past the end of the blade
	var s := (q - o).dot(w)
	var lo: float = st["min"]
	var hi: float = st["max"]
	if s - half > hi or s + half < lo:
		return 0                      # out of it, on one side or the other
	var dq := (q - o).dot(n)
	if drift > 0.0:
		o += n * dq * minf(drift * dt, 1.0)
		st["o"] = o
		dq = (q - o).dot(n)
	# Pressing into flesh not yet cut, on either side of the blade.
	var ww := (xf.basis * w).normalized()
	var pen_hi := minf(s + half, hi) - float(st["hi"])
	var pen_lo := float(st["lo"]) - maxf(s - half, lo)
	if pen_hi > 0.0 and cutting and _edge_ok(ww):
		var g: float = limit.call(st, pen_hi, dt)
		st["hi"] = float(st["hi"]) + g
		pen_hi -= g
	if pen_lo > 0.0 and cutting and _edge_ok(-ww):
		var g: float = limit.call(st, pen_lo, dt)
		st["lo"] = float(st["lo"]) - g
		pen_lo -= g
	var qw := xf * q
	st["point"] = qw
	st["normal"] = (xf.basis * n).normalized()
	if st["head"]:
		_carve_head(st, body, la, lb, s, dt)
	if float(st["lo"]) <= lo + 0.001 and float(st["hi"]) >= hi - 0.001:
		# Right across: cut through.
		if st["head"]:
			_carve_head(st, body, la, lb, s, 1.0)
		elif on_through.is_valid():
			on_through.call(body, xf * o, (xf.basis * n).normalized())
		return -1
	# The hold.
	var mass := body.mass
	var k := K * mass
	var c := C * mass
	var nw: Vector3 = st["normal"]
	var dw := (xf.basis * ab).normalized()
	var r := qw - body.global_position
	var v_body := body.linear_velocity + body.angular_velocity.cross(r)
	var v_blade := va.lerp(vb, clampf(t, 0.0, 1.0))
	var rv := v_body - v_blade
	var f := nw * (k * dq - c * rv.dot(nw))
	if pen_hi > 0.0 or pen_lo > 0.0:
		f += ww * (k * (maxf(pen_hi, 0.0) - maxf(pen_lo, 0.0)) - c * rv.dot(ww))
	# Along the bar: it sticks where it is until pulled harder than the
	# friction the kerf walls give (more the harder they press), then slides.
	var length := ab.length()
	if not st.has("tb"):
		st["tb"] = t
	var e := (t - float(st["tb"])) * length
	var fd := -(k * e + c * rv.dot(dw))
	var fric := grip * 0.9 * f.length() + grip * 40.0
	if absf(fd) > fric:
		fd = signf(fd) * fric
		st["tb"] = t - signf(e) * fric / k / maxf(length, 0.01) if absf(e) * k > fric else float(st["tb"])
	f += dw * fd
	var fl := f.length()
	if fl > strength:
		if absf(dq) > wrench:
			return -1                 # wrenched out sideways
		f *= strength / fl
	body.apply_impulse(f * dt, r)
	# Keep the part turned with the blade (the kerf will not let it twist).
	var pn := plane_n if plane_n.dot(nw) >= 0.0 else -plane_n
	# As strong as the blade's bite: how deep it is in, times what it can take.
	var tq := nw.cross(pn) * (k * 0.05) - (body.angular_velocity - nw * body.angular_velocity.dot(nw)) * (c * 0.03)
	var bite := clampf(float(st["hi"]) - float(st["lo"]), 0.02, 0.15)
	tq = tq.limit_length(strength * bite)
	body.apply_torque_impulse(tq * dt)
	reaction -= f
	hold = maxf(hold, clampf(fl / strength, 0.0, 1.0))
	return 1


func _edge_ok(dir: Vector3) -> bool:
	return edge == Vector3.ZERO or dir.dot(edge) > 0.3


## The head is carved as the cut opens: the strip between where the open
## stretch reached before and where it reaches now, a few times a second.
func _carve_head(st: Dictionary, body: RigidBody3D, la: Vector3, lb: Vector3, s: float, dt: float) -> void:
	st["carve_t"] = float(st["carve_t"]) + dt
	if float(st["carve_t"]) < 0.05:
		return
	st["carve_t"] = 0.0
	var h = body.get_meta("humanoid")
	var n: Vector3 = st["n"]
	var o: Vector3 = st["o"]
	var w: Vector3 = st["w"]
	# The bar laid into the plane, then moved across it to each open edge.
	var pa := la - n * (la - o).dot(n)
	var pb := lb - n * (lb - o).dot(n)
	var xf := body.global_transform
	var nw := (xf.basis * n).normalized()
	for side in [["carve_hi", "hi"], ["carve_lo", "lo"]]:
		var from: float = st[side[0]]
		var to: float = st[side[1]]
		if absf(to - from) < 0.001:
			continue
		var d0 := w * (from - s)
		var d1 := w * (to - s)
		h.soft_head.sweep(xf * (pa + d0), xf * (pb + d0), xf * (pa + d1), xf * (pb + d1), nw)
		st[side[0]] = to
