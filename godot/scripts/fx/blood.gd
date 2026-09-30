extends Node3D
## Blood.
##  - Droplets: CPU ballistic points (gravity + air drag) swept with ray casts
##    and drawn as velocity-stretched beads in a single MultiMesh.
##  - Impacts leave splat decals sized by volume and speed and stretched by
##    the impact angle.
##  - Runs: blood on a slope or wall flows downhill as a thin film. It follows
##    the surface, turns corners, draws a growing streak (using up its volume),
##    stops when it runs dry, hangs from ceilings, drips off edges and collects
##    in pools on flat ground.
##  - Pools grow and spread with the volume that reaches them
##    (area = volume / film thickness).
##  - Bodies: wounds ooze or spurt with the pulse, blood runs over the body
##    parts under gravity, soaks the clothes and drips off the lowest point.
##    Moving bodies smear what they carry or lie in.
##  - Everything dries: colour goes to dark brown and the wet gloss disappears.

const BT = preload("res://scripts/fx/blood_tex.gd")
const BloodCanvas = preload("res://scripts/fx/blood_canvas.gd")
const Tex = preload("res://scripts/world/textures.gd")

const MAX_DROPS := 560
const MAX_RUNS := 160
const MAX_BODY_RUNS := 70
const MAX_POOLS := 160
const MAX_WORLD_DECALS := 800
const MAX_BODY_DECALS := 320
const GRAVITY := 9.81
const FILM := 1.4e-3            # pool film thickness on hard ground, m (blood is thick)
const DEPOSIT_WALL := 3.0       # ml left behind per metre by a 12 mm run on hard surfaces
const DEPOSIT_CLOTH := 2.5      # ml the clothes take up per metre of a run (the rest runs on)
## Share of the lost blood that actually comes out of the wound: a torso wound
## bleeds mostly inside; an arterial one spurts out.
const EXTERNAL := 0.3
const EXTERNAL_ARTERIAL := 0.65
const DRY_TIME := 140.0
const DRY_COLOR := Color(0.42, 0.3, 0.27)
const MASK_WORLD := 1
const MASK_BOTS := 2
const SPARE := 3


class Drop:
	var pos: Vector3
	var vel: Vector3
	var vol: float
	var age := 0.0
	var drip := false          # slow drip (pools), as opposed to thrown spray (splats)
	var ignore: Array[RID] = []
	var ignore_t := 0.0
	var streak := 0.003        # drawn stretched along its speed (a jet: into a line)


## A live streak: one decal that grows behind the moving front, plus a bead
## decal at the front. A new segment starts when the path bends.
class Streak:
	var seg := -1              # decal index of the current segment
	var head := -1             # decal index of the moving bead
	var start: Vector3         # segment start (world or shape space)
	var dir: Vector3


class Run:
	var pos: Vector3
	var n: Vector3
	var dir: Vector3
	var vol: float
	var width: float
	var age := 0.0
	var hang := -1.0
	var wobble := 5.0
	var v := 0.0              # m/s along the surface (it keeps some of it round a bend)
	var s := Streak.new()


class BodyRun:
	var bot
	var part: RigidBody3D
	var cs: CollisionShape3D
	var p: Vector3            # position in shape space
	var dir := Vector3.ZERO   # shape space
	var vol: float
	var width: float
	var age := 0.0
	var s := Streak.new()
	var push := Vector3.ZERO  # shape space: carried along by the bullet's sideways momentum
	var last_paint := Vector3.INF
	var push_k := 0.0         # how strongly (fades as it runs)


## An open vessel bed: a severed limb's stump or a smashed head. While the
## heart beats, blood leaves it as a stream under pressure, surging with
## every beat; when the heart stops the pressure falls away over a few
## seconds and what is left runs out by gravity.
class Jet:
	var bot
	var part: RigidBody3D
	var p: Vector3             # part space
	var dir: Vector3           # part space, out of the wound
	var flow: float            # ml/s at full pressure
	var head := false
	var beat := 0.0
	var acc := 0.0
	var drain := 0.0
	var age := 0.0
	var gush := 0.0            # ml that pours out at once (a body cut open)
	var spread := 0.02         # how wide the opening is (m)


class Pool:
	var pos: Vector3
	var n: Vector3
	var vol: float
	var r: float
	var shown := 0.0
	var along: Vector3
	var variant: int
	var birth: float
	var cap := 0.8          # radius it can spread to before reaching an edge
	var edge_dir := Vector3.ZERO
	var spill := 0.0
	# Tongues of the spreading edge: [direction (world, in the surface), reach
	# as a fraction of the pool radius, speed factor, wander phase].
	var lobes: Array = []
	var downhill := Vector3.ZERO


class DecalSet:
	var max_n: int
	var mask: int
	var decals: Array[Decal] = []
	var birth := PackedFloat32Array()
	var prio := PackedFloat32Array()  # area; small old decals are recycled first
	var live := PackedByteArray()   # in use by a moving streak, do not recycle
	var next := 0
	var last := -1
	var dry_cursor := 0


var _drops: Array[Drop] = []
var _runs: Array[Run] = []
var _body_runs: Array[BodyRun] = []
var _pools: Array[Pool] = []
var _world := DecalSet.new()
var _body := DecalSet.new()
var _bleeders: Array = []
var _jets: Array[Jet] = []
var _soak := {}          # part instance id -> ml soaked into clothes/skin
var _soak_stamp := {}    # part instance id -> time of last underside stamp
var _dead_since := {}    # bot -> time
var _time := 0.0
var _tick := 0
var _smear_t := 0.0
var _since_sim := 0.0
var _splat_grid := {}   # Vector3i cell -> world decal index of the last splat there
var _keep: Array[Decal] = []
var _feet := {}         # foot id -> [soak ml, last print position]

var _q := PhysicsRayQueryParameters3D.new()
var _no_ex: Array[RID] = []
var _mm: MultiMesh
var _buf := PackedFloat32Array()
var _mist: Array[GPUParticles3D] = []
var _mist_i := 0
var _orm_wet: Texture2D
var _orm_dry: Texture2D
var _canvas: BloodCanvas


## The clock the blood shaders age blood by (their `blood_time`).
func clock() -> float:
	return _canvas.time if _canvas else 0.0


func _ready() -> void:
	_world.max_n = MAX_WORLD_DECALS
	_world.mask = MASK_WORLD
	_body.max_n = MAX_BODY_DECALS
	_body.mask = MASK_BOTS
	_orm_wet = BT.orm(true)
	_canvas = BloodCanvas.new()
	_canvas.name = "Canvas"
	add_child(_canvas)
	_orm_dry = BT.orm(false)
	# Warm the texture cache now rather than on the first shot.
	for v in SPARE:
		BT.get_pair("splat", v)
		BT.get_pair("pool", v)
		BT.get_pair("smear", v)
		BT.get_pair("drop", v)
	BT.get_pair("streak", 0)
	BT.get_pair("print", 0)
	BT.get_pair("print", 1)
	BT.get_pair("wound", 0)
	_q.hit_back_faces = false
	_build_drop_mesh()
	_build_mist()
	_prewarm()


# --- Public API --------------------------------------------------------------------

## A bullet hit a body part. kind: "head", "neck", "torso", "limb".
## rate is the bleed rate (ml/s) this wound added.
func on_hit(bot, part: RigidBody3D, point: Vector3, dir: Vector3, weapon: String, kind: String,
		rate: float, arterial: bool) -> void:
	var pellet := weapon == "shotgun" or weapon == "frag"
	var cs := _shape_of(part)
	var sxf := part.global_transform * cs.transform
	var entry_n: Vector3 = (sxf.basis * (_shape_project(cs.shape, sxf.affine_inverse() * point)[1] as Vector3)).normalized()
	var ws := 0.07 if pellet else 0.1
	# A shot at an angle drags the blood sideways across the skin/cloth: the
	# wound smears out along the bullet's path and the first gush runs that way.
	var slide := dir - entry_n * dir.dot(entry_n)
	var graze := clampf(slide.length(), 0.0, 1.0)
	var slide_n := slide.normalized() if graze > 0.05 else Vector3.ZERO
	_body_stamp(part, point, entry_n, dir, ws, ws * (1.0 + graze * 1.2), "wound", 0)
	# Then the stain spreads out from it through the clothes over the next
	# seconds (the more it bleeds, the wider).
	if bot.has_method("bloom_blood"):
		var spread := clampf(0.07 + rate * 0.004, 0.07, 0.16) * (0.7 if pellet else 1.0)
		bot.bloom_blood(part, point, spread, 2.2 + rate * 0.03, 0.8)
	if graze > 0.3:
		var l := (0.06 + 0.16 * graze) * (0.6 if pellet else 1.0)
		_body_stamp(part, point + slide_n * l * 0.5, entry_n, slide_n, ws * 0.45, l, "streak", 0)

	# Where the bullet leaves the part (through-and-through).
	var exit := _exit_point(bot, part, point, dir)
	var has_exit := exit != Vector3.INF
	if has_exit:
		var ex_n: Vector3 = (sxf.basis * (_shape_project(cs.shape, sxf.affine_inverse() * exit)[1] as Vector3)).normalized()
		var es := 0.09 if pellet else 0.14
		_body_stamp(part, exit, ex_n, dir, es, es, "splat", randi() % SPARE)
		if bot.has_method("bloom_blood"):
			bot.bloom_blood(part, exit, es * 1.3, 3.0, 0.8)

	var count := 14
	var total := 5.0
	match kind:
		"head":
			count = 22 if pellet else 70
			total = 18.0 if pellet else 70.0
		"neck":
			count = 16 if pellet else 36
			total = 12.0 if pellet else 35.0
		"torso":
			count = 12 if pellet else 30
			total = 9.0 if pellet else 28.0
		_:
			count = 7 if pellet else 16
			total = 4.0 if pellet else 12.0
	var origin := exit if has_exit else point
	var ignore: Array[RID] = bot._ray_exclude
	# Forward spray out of the exit wound.
	_spray(origin + dir * 0.02, dir, 24.0, 3.0, 11.0, count, total, ignore)
	# Back spatter out of the entry wound.
	var back: Vector3 = (-dir * 0.6 + entry_n * 0.8).normalized()
	_spray(point + entry_n * 0.02, back, 45.0, 0.8, 3.5, int(count * 0.35), total * 0.2, ignore)
	_mist_burst(origin, dir, 1.0 if kind == "head" and not pellet else 0.55)
	# Through the head: it is blown out of the far side, onto whatever is behind.
	if kind == "head" and not pellet:
		exit_splatter(origin + dir * 0.03, dir, 1.0, ignore)

	# Register the wound for bleeding.
	if not bot.has_meta("wounds"):
		bot.set_meta("wounds", [])
	var wounds: Array = bot.get_meta("wounds")
	var push_s := sxf.basis.inverse() * slide_n
	# A wrecked head pours: scalp, face and the vessels at the base of the
	# skull empty out, far more than a body wound shows on the outside.
	var gush := 0.0
	if kind == "head":
		gush = 220.0 if pellet else 480.0
	elif kind == "neck":
		gush = 120.0
	wounds.append({"part": part, "cs": cs, "p": sxf.affine_inverse() * point, "w": maxf(rate, 2.0),
			"arterial": arterial, "acc": 0.0, "pulse": randf(), "push": push_s, "graze": graze,
			"kind": kind, "gush": gush})
	if graze > 0.3:
		# The first gush, thrown along the direction the bullet was going.
		var br := _start_body_run(bot, part, point, (1.5 + 3.5 * graze) * (0.5 if pellet else 1.0))
		if br:
			br.push = push_s
			br.push_k = graze * 1.4
			br.dir = push_s
	if has_exit:
		wounds.append({"part": part, "cs": cs, "p": sxf.affine_inverse() * exit, "w": maxf(rate, 2.0) * 0.8,
				"arterial": false, "acc": 0.0, "pulse": 0.0})
	if not _bleeders.has(bot):
		_bleeders.append(bot)


## A stump or a smashed head: a stream of blood out of `at` along `out`.
## `flow` is how much comes out a second at full pressure (ml/s).
func open_jet(bot, part: RigidBody3D, at: Vector3, out: Vector3, flow: float, head := false, gush := 0.0, spread := 0.02) -> void:
	if not is_instance_valid(part):
		return
	var n := 0
	for j in _jets:
		if j.part == part:
			n += 1
	if n >= 3:
		return
	var jet := Jet.new()
	jet.bot = bot
	jet.part = part
	jet.p = part.to_local(at)
	jet.dir = (part.global_basis.inverse() * out).normalized()
	jet.flow = flow
	jet.head = head
	jet.beat = randf()
	jet.gush = gush
	jet.spread = spread
	_jets.append(jet)


## Heart still going (a shot to the head kills the brain, not the heart: it
## keeps pumping a while), its rate, and how full the vessels still are.
func _pressure(jet: Jet) -> float:
	var bot = jet.bot
	var p := 1.0
	if not bot.alive:
		var since: float = _time - float(_dead_since.get(bot, _time))
		# After a headshot the heart runs on for a while; otherwise it stops.
		p = exp(-since / (7.0 if jet.head else 2.2))
	# Emptying out: a man bleeds out in under a minute from this.
	p *= exp(-jet.age / (45.0 if jet.head else 35.0))
	return p


func _update_jets(dt: float) -> void:
	var i := 0
	while i < _jets.size():
		var jet := _jets[i]
		if not is_instance_valid(jet.part) or jet.age > 90.0:
			_jets.remove_at(i)
			continue
		jet.age += dt
		if not jet.bot.alive and not _dead_since.has(jet.bot):
			_dead_since[jet.bot] = _time
		var pr := _pressure(jet)
		var xf := jet.part.global_transform
		var at := xf * jet.p
		var out := (xf.basis * jet.dir).normalized()
		var ignore: Array[RID] = jet.bot._ray_exclude
		if pr > 0.08:
			# The heartbeat: a sharp surge, then the stream sags until the next.
			var rate := 1.25 + 0.4 * (1.0 - pr)
			jet.beat += dt * rate
			var ph := fmod(jet.beat, 1.0)
			var surge := exp(-ph * 6.0)
			var push := pr * (0.45 + 0.55 * surge)
			var speed := lerpf(0.8, 5.2, push)
			var vol := jet.flow * push * dt
			# A few drops a step, spread along this step's length of stream,
			# drawn stretched so they join into one line.
			var n := 2
			var v0: Vector3 = jet.part.linear_velocity
			for k in n:
				var d := _cone(out, deg_to_rad(3.0 + 5.0 * (1.0 - push)))
				var sp := speed * randf_range(0.92, 1.05)
				var pos := at + d * (0.01 + sp * dt * float(k) / n)
				spawn_drop(pos, v0 + d * sp, vol / n, ignore, 0.15, false, 0.014)
		# A body opened right across: what the trunk holds (a lot) pours out
		# of the whole cut face in the first seconds, a sheet of it.
		if jet.gush > 0.0:
			var g := minf(jet.gush, dt * (60.0 + jet.gush * 0.45))
			jet.gush -= g
			var side := out.cross(Vector3.UP)
			side = side.normalized() if side.length() > 0.05 else Vector3.RIGHT
			var side2 := out.cross(side).normalized()
			var v1: Vector3 = jet.part.linear_velocity
			for k in 2:
				var off := (side * randf_range(-1.0, 1.0) + side2 * randf_range(-1.0, 1.0)) * jet.spread
				spawn_drop(at + off + out * 0.02, v1 + out * randf_range(0.3, 1.2) + Vector3.DOWN * 0.3, g / 2.0, ignore, 0.2, true, 0.008)
		# Whatever the pressure, some runs out by gravity from the lowest
		# edge of the wound.
		jet.drain += jet.flow * dt * (0.12 + 0.25 * (1.0 - pr)) * exp(-jet.age / 60.0)
		if jet.drain >= 1.2:
			var low := at + Vector3(randf_range(-0.02, 0.02), -0.02, randf_range(-0.02, 0.02))
			_drip(low, jet.part.linear_velocity, jet.drain, ignore)
			jet.drain = 0.0
		if jet.gush <= 0.0 and pr <= 0.08 and jet.age > 30.0 and jet.flow * exp(-jet.age / 60.0) < 0.5:
			_jets.remove_at(i)
			continue
		i += 1


# --- Droplets ----------------------------------------------------------------------

func _spray(origin: Vector3, dir: Vector3, cone_deg: float, v_min: float, v_max: float, count: int, total: float, ignore: Array[RID]) -> void:
	# Fewer, somewhat bigger drops carry the same blood (flat sprites, see
	# _build_drop_mesh): as much on the walls for a fraction of the cost.
	count = int(ceil(count * 0.45))
	if count <= 0:
		return
	var weights := PackedFloat32Array()
	var sum := 0.0
	for i in count:
		var w := pow(randf(), 3.0) + 0.02   # many fine droplets, a few heavy ones
		weights.append(w)
		sum += w
	for i in count:
		var d := _cone(dir, deg_to_rad(cone_deg))
		var vol := total * weights[i] / sum
		# Heavy drops keep more of the bullet's speed.
		var sp := randf_range(v_min, v_max) * lerpf(0.7, 1.0, clampf(vol, 0.0, 1.0))
		spawn_drop(origin + _jitter(0.015), d * sp, vol, ignore, 0.12)


func spawn_drop(pos: Vector3, vel: Vector3, vol: float, ignore: Array[RID] = [], ignore_t := 0.0, drip := false, streak := 0.003) -> void:
	if vol < 0.005:
		return
	var d: Drop
	if _drops.size() >= MAX_DROPS:
		d = _drops[randi() % _drops.size()]
	else:
		d = Drop.new()
		_drops.append(d)
	d.pos = pos
	d.vel = vel
	d.vol = minf(vol, 12.0)
	d.age = 0.0
	d.drip = drip
	d.ignore = ignore
	d.ignore_t = ignore_t
	d.streak = streak


## Blood leaving a body. If the ground is right there (a body lying on it) it
## goes straight into the pool instead of spawning a drop that could start
## below the surface and fall through the world.
func _drip(pos: Vector3, vel: Vector3, vol: float, ignore: Array[RID]) -> void:
	_q.collision_mask = Game.LAYER_WORLD
	_q.exclude = _no_ex
	_q.from = pos + Vector3.UP * 0.12
	_q.to = pos + Vector3.DOWN * 0.1
	var hit := get_world_3d().direct_space_state.intersect_ray(_q)
	if not hit.is_empty() and hit.normal.y > 0.8:
		_add_pool(hit.position, hit.normal, vol)
		return
	spawn_drop(pos, vel, vol, ignore, 0.1, true)


func _cone(dir: Vector3, angle: float) -> Vector3:
	var d := dir.normalized()
	var helper := Vector3.UP if absf(d.y) < 0.95 else Vector3.RIGHT
	var x := d.cross(helper).normalized()
	var y := d.cross(x)
	var a := randf() * TAU
	var r := sqrt(randf()) * tan(angle)
	return (d + (x * cos(a) + y * sin(a)) * r).normalized()


func _jitter(r: float) -> Vector3:
	return Vector3(randf_range(-r, r), randf_range(-r, r), randf_range(-r, r))


func _update_drops(dt: float) -> void:
	var space := get_world_3d().direct_space_state
	_q.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS
	var i := 0
	while i < _drops.size():
		var d := _drops[i]
		d.age += dt
		d.ignore_t -= dt
		# Drag: small droplets slow down much faster (mist hangs, beads fly).
		var radius := 0.0062 * pow(d.vol, 1.0 / 3.0)
		var drag := 0.0025 / maxf(radius, 0.0008)
		d.vel += Vector3.DOWN * GRAVITY * dt
		d.vel *= maxf(1.0 - drag * d.vel.length() * dt * 0.1, 0.5)
		var to := d.pos + d.vel * dt
		_q.from = d.pos
		_q.to = to
		_q.exclude = d.ignore if d.ignore_t > 0.0 else _no_ex
		var hit := space.intersect_ray(_q)
		if not hit.is_empty():
			_drop_land(d, hit)
			_q.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS
			_drops.remove_at(i)
			continue
		d.pos = to
		if d.age > 6.0 or d.pos.y < -30.0:
			_drops.remove_at(i)
			continue
		i += 1


func _drop_land(d: Drop, hit: Dictionary) -> void:
	var col: Object = hit.collider
	var p: Vector3 = hit.position
	var n: Vector3 = hit.normal
	var speed := d.vel.length()
	if col is RigidBody3D and (col as Node).has_meta("humanoid"):
		var part := col as RigidBody3D
		var bot = part.get_meta("humanoid")
		var w := clampf(0.014 + 0.03 * sqrt(d.vol), 0.014, 0.08)
		_body_stamp(part, p, n, d.vel, w, w, "drop" if w < 0.035 else "splat", randi() % SPARE)
		_add_soak(part, d.vol * 0.5)
		if d.vol > 0.25:
			_start_body_run(bot, part, p, d.vol * 0.5)
		return

	var parent: Node = self
	if col is RigidBody3D:
		parent = col as Node

	if n.y > 0.8 and parent == self:
		var pool := _pool_at(p, 1.0)
		if pool:
			# Landing in an existing pool just feeds it.
			_feed_pool(pool, d.vol)
			return
		if (d.drip and d.vol > 0.15) or d.vol > 2.5:
			# Drips collect where they fall: the pool itself is the stain.
			_add_pool(p, n, d.vol)
			return

	var vn := absf(d.vel.dot(n))
	var vt := d.vel - n * d.vel.dot(n)
	var size := 0.012 + 0.05 * sqrt(d.vol)
	size *= 1.0 + clampf(speed - 2.0, 0.0, 10.0) * 0.07
	var elong := 1.0 + clampf(vt.length() / maxf(vn, 0.6), 0.0, 3.0) * 0.55
	var kind := "drop" if size < 0.035 or speed < 3.0 else "splat"
	_world_stamp(parent, p, n, vt if vt.length() > 0.2 else _any_tangent(n), size, size * elong, kind, randi() % SPARE)
	if parent != self:
		return
	if n.y < -0.6:
		if d.vol > 0.3:
			_start_run(p, n, d.vol * 0.6)
	elif n.y <= 0.8 and d.vol > 0.2:
		_start_run(p, n, d.vol * 0.75)


func _any_tangent(n: Vector3) -> Vector3:
	var helper := Vector3.FORWARD if absf(n.dot(Vector3.FORWARD)) < 0.9 else Vector3.RIGHT
	return n.cross(helper).rotated(n, randf() * TAU)


# --- Runs on world surfaces -----------------------------------------------------------

func _start_run(pos: Vector3, n: Vector3, vol: float) -> void:
	if _runs.size() >= MAX_RUNS:
		return
	var r := Run.new()
	r.pos = pos
	r.n = n
	var g := Vector3.DOWN - n * n.dot(Vector3.DOWN)
	r.dir = g.normalized() if g.length() > 0.01 else _any_tangent(n)
	r.vol = vol
	r.width = clampf(0.006 + 0.006 * sqrt(vol), 0.006, 0.022)
	r.s.start = pos
	r.s.dir = r.dir
	r.wobble = randf_range(3.0, 9.0)
	_runs.append(r)


func _update_runs(dt: float) -> void:
	var i := 0
	while i < _runs.size():
		if _step_run(_runs[i], dt):
			i += 1
		else:
			var r := _runs[i]
			# The drop at the end of the run: a small bead where it stopped.
			_world_stamp(self, r.pos, r.n, r.dir, r.width * 1.5, r.width * 1.9, "drop", 1)
			_runs.remove_at(i)


func _step_run(r: Run, dt: float) -> bool:
	r.age += dt
	if r.n.y < -0.6:
		# Under a ceiling or overhang: gather into a hanging drop, then fall.
		if r.hang < 0.0:
			r.hang = randf_range(0.5, 3.0)
		r.hang -= dt
		if r.hang <= 0.0:
			spawn_drop(r.pos + r.n * 0.006, Vector3.ZERO, r.vol, _no_ex, 0.0, true)
			return false
		return true
	var g := Vector3.DOWN - r.n * r.n.dot(Vector3.DOWN)
	var slope := g.length()
	if r.vol < 0.06:
		return false
	# Film flow: the steeper, the faster (and the more blood behind it, the
	# faster); stick-slip makes it creep and surge instead of sliding at a
	# constant speed. It gathers speed and loses it gradually: coming down a
	# wall onto the floor it runs on out across it before it stops.
	var surge := 0.35 + 0.65 * pow(sin(r.age * r.wobble) * 0.5 + 0.5, 2.0)
	var target := (0.01 + 0.34 * pow(slope, 1.5) * clampf(r.vol / 1.5, 0.15, 2.0)) * surge
	r.v = move_toward(r.v, target, dt * (0.6 if target > r.v else 0.9))
	if slope < 0.3 and r.v < 0.012:
		_add_pool(r.pos, r.n, r.vol)
		return false
	if slope > 0.05:
		g /= slope
		var wander := r.n.cross(g) * randf_range(-0.6, 0.6)
		# (on the flat it goes on the way it was going; on a slope it turns downhill)
		r.dir = (r.dir + (g + wander) * dt * 5.0 * clampf(slope * 1.5, 0.0, 1.0)).normalized()
	else:
		g = r.dir
	r.dir = r.dir - r.n * r.n.dot(r.dir)
	r.dir = r.dir.normalized() if r.dir.length() > 1e-3 else g
	var speed := r.v
	var step := r.dir * speed * dt
	var space := get_world_3d().direct_space_state
	var lift := r.n * 0.004

	# Something ahead (an inside corner): continue on that surface.
	_q.collision_mask = Game.LAYER_WORLD
	_q.exclude = _no_ex
	_q.from = r.pos + lift
	_q.to = r.pos + lift + step * 1.5
	var hit := space.intersect_ray(_q)
	if not hit.is_empty():
		r.pos = hit.position
		r.n = hit.normal
		return true

	# Follow the surface below the new position.
	var np := r.pos + step
	_q.from = np + r.n * 0.03
	_q.to = np - r.n * 0.05
	hit = space.intersect_ray(_q)
	if hit.is_empty():
		# Ran over an edge. A thin, slow film clings and goes on round it
		# onto the face below (the nose of a step, the edge of a table);
		# a fast or heavy one leaves the edge and falls.
		var clings := speed < 0.25 and r.vol < 3.0 and randf() > speed * 2.5
		if clings:
			_q.from = np - r.n * 0.012 + r.dir * 0.01
			_q.to = np - r.n * 0.012 - r.dir * 0.05
			var round := space.intersect_ray(_q)
			if not round.is_empty() and (round.normal as Vector3).dot(r.n) < 0.5:
				_world_stamp(self, r.pos, r.n, r.dir, r.width, r.width * 1.4, "drop", 0, 1.0, 0.5)
				var nn2: Vector3 = round.normal
				r.pos = round.position
				# (down the new face: what was forward is now downwards)
				var d2 := r.dir - nn2 * nn2.dot(r.dir)
				var g2 := Vector3.DOWN - nn2 * nn2.dot(Vector3.DOWN)
				r.dir = (d2 * 0.3 + g2).normalized() if (d2 * 0.3 + g2).length() > 1e-3 else r.dir
				r.n = nn2
				r.v *= 0.5
				return true
		spawn_drop(np + r.dir * 0.004, r.dir * speed + g * 0.1, r.vol, _no_ex, 0.0, true)
		return false
	var nn: Vector3 = hit.normal
	var bent := nn.dot(r.n) < 0.92 or r.dir.dot(r.s.dir) < 0.97
	r.pos = hit.position
	r.n = nn
	r.vol -= step.length() * DEPOSIT_WALL * (r.width / 0.012)
	# Paint the film where the front has been: dabs every step make one
	# continuous trail rather than separate stamps.
	_world_stamp(self, r.pos - step * 0.5, r.n, r.dir, r.width, r.width + step.length(), "drop", 0, 1.0, 0.45)
	return true


# --- Streak decals (shared by world and body runs) ------------------------------------

func _new_segment(ds: DecalSet, s: Streak, at: Vector3, dir: Vector3) -> void:
	if s.seg >= 0:
		ds.live[s.seg] = 0
	s.seg = -1
	s.start = at
	s.dir = dir


func _end_streak(ds: DecalSet, s: Streak) -> void:
	if s.seg >= 0:
		ds.live[s.seg] = 0
	if s.head >= 0:
		ds.live[s.head] = 0
	s.seg = -1
	s.head = -1


## Updates the streak's growing segment decal (start -> front) and its bead.
## `front` and `start` are world positions.
func _draw_streak(ds: DecalSet, parent: Node, s: Streak, front: Vector3, n: Vector3, width: float, start_w := Vector3.INF) -> void:
	var a := s.start if start_w == Vector3.INF else start_w
	var d := front - a
	var l := d.length()
	if l > 0.004:
		if s.seg < 0 or not is_instance_valid(ds.decals[s.seg]) or ds.decals[s.seg].get_parent() != parent:
			s.seg = _alloc(ds, parent, width * 0.1)
			ds.live[s.seg] = 1
			_dress(ds.decals[s.seg], "streak", 0)
		var dcl := ds.decals[s.seg]
		dcl.global_transform = Transform3D(_decal_basis(n, d / l), (a + front) * 0.5)
		dcl.size = Vector3(width, 0.06, l + width * 0.6)
		ds.birth[s.seg] = _time
		ds.prio[s.seg] = width * l
	if s.head < 0 or not is_instance_valid(ds.decals[s.head]) or ds.decals[s.head].get_parent() != parent:
		s.head = _alloc(ds, parent, width * width)
		ds.live[s.head] = 1
		_dress(ds.decals[s.head], "drop", randi() % SPARE)
	var h := ds.decals[s.head]
	h.global_transform = Transform3D(_decal_basis(n, d if l > 0.001 else _any_tangent(n)), front)
	h.size = Vector3(width * 1.5, 0.06, width * 1.8)
	ds.birth[s.head] = _time


# --- Pools -----------------------------------------------------------------------------

func _pool_radius(vol: float) -> float:
	return clampf(sqrt(vol * 1e-6 / (PI * FILM)), 0.015, 0.8)


## The pool this point is in or just beside (within its current size).
func _pool_near(p: Vector3) -> Pool:
	var best: Pool = null
	var best_d := INF
	for q in _pools:
		var d := Vector2(q.pos.x - p.x, q.pos.z - p.z).length()
		if absf(q.pos.y - p.y) < 0.1 and d < maxf(q.shown, q.r) * 1.05 + 0.06 and d < best_d:
			best = q
			best_d = d
	return best


func _pool_at(p: Vector3, reach: float) -> Pool:
	for pool in _pools:
		if absf(pool.pos.y - p.y) < 0.06 and Vector2(pool.pos.x - p.x, pool.pos.z - p.z).length() < pool.r * reach + 0.04:
			return pool
	return null


func _add_pool(p: Vector3, n: Vector3, vol: float) -> void:
	# Joins a pool only if it lands in (or right at the edge of) it; blood
	# dripping somewhere else starts its own pool there.
	var pool := _pool_near(p)
	if pool:
		if pool.r >= 0.79:
			# Full: the overflow spreads out at the edge as a new lobe.
			var out := Vector3(p.x - pool.pos.x, 0, p.z - pool.pos.z)
			if out.length() < 0.01:
				out = Vector3(randf_range(-1, 1), 0, randf_range(-1, 1))
			var at := pool.pos + out.normalized() * pool.r * 0.85
			_q.collision_mask = Game.LAYER_WORLD
			_q.exclude = _no_ex
			_q.from = at + Vector3.UP * 0.2
			_q.to = at + Vector3.DOWN * 0.3
			var hit := get_world_3d().direct_space_state.intersect_ray(_q)
			if hit.is_empty() or hit.normal.y < 0.8:
				return
			p = hit.position
			n = hit.normal
			pool = _pool_at(p, 0.6)
			if pool == null or pool.r >= 0.79:
				_new_pool(p, n, vol)
				return
		_feed_pool(pool, vol)
		return
	_new_pool(p, n, vol)


## Adds volume; once the pool reaches an edge (a step nose, a kerb) the rest
## spills over it and runs down the side to collect below.
func _feed_pool(pool: Pool, vol: float) -> void:
	pool.vol += vol
	pool.birth = _time
	var cap_vol := PI * pool.cap * pool.cap * FILM * 1e6
	if pool.vol > cap_vol:
		pool.spill += pool.vol - cap_vol
		pool.vol = cap_vol
		if pool.spill > 0.8:
			_spill(pool, pool.spill)
			pool.spill = 0.0
	pool.r = _pool_radius(pool.vol)


func _spill(pool: Pool, vol: float) -> void:
	var d := pool.edge_dir.rotated(Vector3.UP, randf_range(-0.35, 0.35))
	var lip := pool.pos + d * pool.cap
	# Find the face below the lip (the riser) and run down it.
	_q.collision_mask = Game.LAYER_WORLD
	_q.exclude = _no_ex
	_q.from = lip + d * 0.05 + Vector3.DOWN * 0.03
	_q.to = lip - d * 0.06 + Vector3.DOWN * 0.03
	var hit := get_world_3d().direct_space_state.intersect_ray(_q)
	if not hit.is_empty() and absf(hit.normal.y) < 0.5:
		_world_stamp(self, lip + Vector3.DOWN * 0.005, Vector3.UP, d, 0.04, 0.06, "drop", 0)
		_start_run(hit.position, hit.normal, vol)
	else:
		spawn_drop(lip + d * 0.01, d * 0.15, vol, _no_ex, 0.0, true)


## Distance to the nearest drop-off (a step nose, a kerb, a ledge) around p,
## up to 0.8 m, and its direction. Walls and steps up only bound the pool, they
## are not something it can spill over; cracks a few cm wide are ignored.
func _find_edge(p: Vector3) -> Array:
	var best := 0.8
	var best_dir := Vector3.FORWARD
	for i in 8:
		var d := Vector3.FORWARD.rotated(Vector3.UP, i * TAU / 8.0)
		var rad := 0.04
		while rad < best:
			var h := _surface_height(p + d * rad, p.y)
			if h > p.y + 0.035:
				break   # wall or step up
			if h < p.y - 0.035 and _surface_height(p + d * (rad + 0.06), p.y) < p.y - 0.035:
				best = rad
				best_dir = d
				break
			rad += 0.04
	return [best, best_dir]


## Height of the walkable surface at `at` (x/z), searched around height y;
## -INF when there is nothing below.
func _surface_height(at: Vector3, y: float) -> float:
	_q.collision_mask = Game.LAYER_WORLD
	_q.exclude = _no_ex
	_q.from = Vector3(at.x, y + 0.45, at.z)
	_q.to = Vector3(at.x, y - 0.25, at.z)
	var hit := get_world_3d().direct_space_state.intersect_ray(_q)
	if hit.is_empty():
		return -INF
	if hit.normal.y < 0.8:
		return INF
	return hit.position.y


func _new_pool(p: Vector3, n: Vector3, vol: float) -> void:
	var pool: Pool
	if _pools.size() >= MAX_POOLS:
		# Out of pools: feed the nearest one if it is close, otherwise reuse
		# the smallest (never wipe out a big pool).
		var nearest: Pool = null
		var smallest: Pool = _pools[0]
		for q in _pools:
			if nearest == null or q.pos.distance_to(p) < nearest.pos.distance_to(p):
				nearest = q
			if q.vol < smallest.vol:
				smallest = q
		if nearest.pos.distance_to(p) < maxf(nearest.r, 0.05):
			_feed_pool(nearest, vol)
			return
		# Recycle the smallest pool's slot: its stain stays painted on the
		# ground, only the bookkeeping is reused.
		pool = smallest
	else:
		pool = Pool.new()
		_pools.append(pool)
	pool.pos = p
	pool.n = n
	var edge := _find_edge(p)
	pool.cap = maxf(edge[0] * 1.1, 0.02)
	pool.edge_dir = edge[1]
	pool.spill = 0.0
	pool.vol = 0.0
	_feed_pool(pool, vol)
	pool.shown = pool.r * 0.15
	pool.birth = _time
	pool.along = _any_tangent(n)
	pool.variant = randi() % SPARE
	# Blood does not grow as one circle: a few tongues creep out at their own
	# pace (faster downhill) and the body fills in behind them.
	var g := Vector3.DOWN - n * n.dot(Vector3.DOWN)
	# (only a real slope: the ground's own little unevenness is not one)
	pool.downhill = g.normalized() * clampf((g.length() - 0.04) * 8.0, 0.0, 1.0) if g.length() > 1e-4 else Vector3.ZERO
	pool.lobes.clear()
	var count := randi_range(5, 8)
	var t := pool.along
	var b := n.cross(t)
	for i in count:
		var a := (float(i) + randf_range(-0.35, 0.35)) / count * TAU
		var dir := (t * cos(a) + b * sin(a)).normalized()
		var sp := randf_range(0.55, 1.25) * (1.0 + 1.4 * maxf(dir.dot(pool.downhill), 0.0))
		pool.lobes.append([dir, 0.1, sp, randf() * TAU])


func _update_pools(delta: float) -> void:
	for pool in _pools:
		# Nothing more coming into it (the body moved away, the bleeding
		# stopped): it stays the size it has spread to - thick blood does not
		# keep creeping once it is no longer being fed.
		if _time - pool.birth > 1.5 and pool.shown < pool.r:
			pool.r = maxf(pool.shown, 0.015)
			pool.vol = PI * pool.r * pool.r * FILM * 1e6
		var growing := pool.shown < pool.r
		if growing:
			# Spreads out over several seconds, creeping at the end (thick
			# blood slows down as the film thins).
			pool.shown = minf(pool.r, pool.shown + (pool.r - pool.shown) * delta * 0.4 + delta * 0.002)
		# Repaint while it spreads or is being fed (keeps it wet); the shader
		# dries it from the last time it was painted.
		if growing or _time - pool.birth < 0.3:
			var s := pool.shown * 2.7
			_canvas.dab(pool.pos, pool.n, pool.along, s, s, "pool", pool.variant, 1.0, 1.0)
			_splat_grid[_cell(pool.pos)] = 1
			_grow_lobes(pool, delta)


## Moves the tongues of a spreading pool outwards and paints them: soft round
## dabs along each tongue, so the outline grows unevenly and smoothly, with
## longer runs downhill.
func _grow_lobes(pool: Pool, delta: float) -> void:
	var r := maxf(pool.shown, 0.02)
	for lb in pool.lobes:
		var dir: Vector3 = lb[0]
		lb[3] = float(lb[3]) + delta * 0.7
		# Tongues wander a little sideways as they go.
		dir = dir.rotated(pool.n, sin(float(lb[3])) * delta * 0.25).normalized()
		lb[0] = dir
		var down := maxf(dir.dot(pool.downhill), 0.0)
		var max_reach := 0.7 + 0.25 * float(lb[2]) + 0.6 * down
		lb[1] = minf(float(lb[1]) + delta * 0.3 * float(lb[2]) * (1.0 - float(lb[1]) / max_reach), max_reach)
		var reach: float = lb[1] * r
		# A tongue is a broad lobe of the pool, not a thin line running
		# out of it (a narrow dab repainted as it moved drew one).
		var size := r * (0.85 - 0.2 * float(lb[1]) / max_reach)
		var tip := pool.pos + dir * reach * 0.55
		_canvas.dab(tip, pool.n, dir, size, size * (1.0 + down * 0.35), "pool", (pool.variant + 1) % SPARE, 0.8, 1.0)


# --- Bodies ------------------------------------------------------------------------------

func _shape_of(part: RigidBody3D) -> CollisionShape3D:
	for c in part.get_children():
		if c is CollisionShape3D:
			return c
	return null


## Nearest surface point and outward normal on a part's collision shape, in shape space.
func _shape_project(shape: Shape3D, p: Vector3) -> Array:
	if shape is CapsuleShape3D:
		var cap := shape as CapsuleShape3D
		var half := cap.height * 0.5 - cap.radius
		var c := Vector3(0, clampf(p.y, -half, half), 0)
		var d := p - c
		var n := d.normalized() if d.length() > 1e-5 else Vector3.BACK
		return [c + n * cap.radius, n]
	if shape is ConvexPolygonShape3D:
		# A cut piece: treated as the box round it.
		var pts := (shape as ConvexPolygonShape3D).points
		if pts.is_empty():
			return [p, Vector3.UP]
		var box := AABB(pts[0], Vector3.ZERO)
		for v in pts:
			box = box.expand(v)
		var ctr := box.get_center()
		var r := _box_project(box.size * 0.5, p - ctr)
		return [(r[0] as Vector3) + ctr, r[1]]
	return _box_project((shape as BoxShape3D).size * 0.5, p)


func _box_project(e: Vector3, p: Vector3) -> Array:
	e = e.max(Vector3.ONE * 0.001)
	var q := p.clamp(-e, e)
	var rel := Vector3(absf(q.x) / e.x, absf(q.y) / e.y, absf(q.z) / e.z)
	var axis := 0
	if rel.y > rel.x and rel.y >= rel.z:
		axis = 1
	elif rel.z > rel.x and rel.z > rel.y:
		axis = 2
	var n := Vector3.ZERO
	n[axis] = signf(q[axis]) if q[axis] != 0.0 else 1.0
	q[axis] = e[axis] * n[axis]
	return [q, n]


func _exit_point(bot, part: RigidBody3D, point: Vector3, dir: Vector3) -> Vector3:
	var ex: Array[RID] = []
	for rid in bot._ray_exclude:
		if rid != part.get_rid():
			ex.append(rid)
	_q.collision_mask = Game.LAYER_BOTS
	_q.exclude = ex
	_q.from = point + dir * 0.5
	_q.to = point + dir * 0.005
	var hit := get_world_3d().direct_space_state.intersect_ray(_q)
	if hit.is_empty() or hit.collider != part:
		return Vector3.INF
	return hit.position


func _add_soak(part: RigidBody3D, ml: float) -> void:
	var id := part.get_instance_id()
	_soak[id] = minf(float(_soak.get(id, 0.0)) + ml, 40.0)


func _start_body_run(bot, part: RigidBody3D, world_p: Vector3, vol: float) -> BodyRun:
	if _body_runs.size() >= MAX_BODY_RUNS:
		# Too much going on: send it straight down instead.
		_drip(world_p + Vector3.DOWN * 0.02, part.linear_velocity, vol, bot._ray_exclude)
		return null
	var cs := _shape_of(part)
	if cs == null:
		return null
	var br := BodyRun.new()
	br.bot = bot
	br.part = part
	br.cs = cs
	br.p = (part.global_transform * cs.transform).affine_inverse() * world_p
	br.p = _shape_project(cs.shape, br.p)[0]
	br.s.start = br.p
	br.vol = vol
	br.width = clampf(0.018 + 0.01 * sqrt(vol), 0.018, 0.05)
	_body_runs.append(br)
	return br


func _update_body_runs(dt: float) -> void:
	var i := 0
	while i < _body_runs.size():
		if _step_body_run(_body_runs[i], dt):
			i += 1
		else:
			_end_streak(_body, _body_runs[i].s)
			_body_runs.remove_at(i)


func _step_body_run(br: BodyRun, dt: float) -> bool:
	br.age += dt
	if not is_instance_valid(br.part) or br.age > 25.0:
		return false
	var xf := br.part.global_transform * br.cs.transform
	var proj := _shape_project(br.cs.shape, br.p)
	var surf: Vector3 = proj[0]
	var n: Vector3 = proj[1]
	var n_w := (xf.basis * n).normalized()
	var pos_w := xf * surf

	if n_w.y < -0.55:
		# Lowest point of this part: flow onto the part below, or drip off.
		_q.collision_mask = Game.LAYER_BOTS
		var ex: Array[RID] = [br.part.get_rid()]
		_q.exclude = ex
		_q.from = pos_w + n_w * 0.004
		_q.to = pos_w + Vector3.DOWN * 0.07
		var hit := get_world_3d().direct_space_state.intersect_ray(_q)
		if not hit.is_empty() and hit.collider is RigidBody3D and (hit.collider as Node).get_meta("humanoid", null) == br.bot:
			_end_streak(_body, br.s)
			br.part = hit.collider
			br.cs = _shape_of(br.part)
			var nxf := br.part.global_transform * br.cs.transform
			br.p = _shape_project(br.cs.shape, nxf.affine_inverse() * hit.position)[0]
			br.s.start = br.p
			return true
		_drip(pos_w + Vector3.DOWN * 0.008, br.part.linear_velocity, br.vol, br.bot._ray_exclude)
		return false

	var g_s := (xf.basis.inverse() * Vector3.DOWN)
	var g_t := g_s - n * n.dot(g_s)
	var slope := g_t.length()
	br.push_k = maxf(br.push_k - dt * 0.6, 0.0)
	var p_t := br.push - n * n.dot(br.push)
	var pushing := br.push_k > 0.05 and p_t.length() > 0.1
	if slope < 0.2 and not pushing:
		# On top of a lying body: it just soaks in.
		br.vol -= dt * 1.5
		_add_soak(br.part, dt * 1.5)
		return br.vol > 0.0
	g_t = g_t / slope if slope > 1e-4 else Vector3.ZERO
	var want := g_t
	if pushing:
		var pk := clampf(br.push_k, 0.0, 0.9)
		want = (g_t * slope * (1.0 - pk) + p_t.normalized() * pk).normalized()
		slope = maxf(slope, br.push_k * 0.8)
	var speed := 0.02 + 0.1 * slope * clampf(br.vol / 2.0, 0.2, 2.0) + br.push_k * 0.12
	var old_dir := br.dir
	br.dir = (br.dir * 0.7 + want * 0.3 + n.cross(want) * randf_range(-0.08, 0.08)).normalized()
	br.p = surf + br.dir * speed * dt
	var used := speed * dt * DEPOSIT_CLOTH * (br.width / 0.012)
	br.vol -= used
	_add_soak(br.part, used)
	if br.vol < 0.05:
		return false
	# Painted into the body's own blood as it goes (a dab each centimetre).
	# (kept in part space, so a whole step's way is filled in unbroken)
	var here := br.part.to_local(pos_w)
	if br.bot and br.bot.has_method("paint_blood"):
		var from: Vector3 = here if br.last_paint == Vector3.INF else br.last_paint
		var gap := from.distance_to(here)
		if br.last_paint == Vector3.INF or gap > 0.008:
			var amount := clampf(0.4 + br.vol * 0.12, 0.4, 0.9)
			var steps := clampi(int(gap / 0.008), 1, 12)
			for k in steps:
				var q := from.lerp(here, float(k + 1) / steps)
				br.bot.paint_blood(br.part, br.part.to_global(q), br.width * 0.5, amount)
			br.last_paint = here
	return true


func _update_bleeding(dt: float) -> void:
	var i := 0
	while i < _bleeders.size():
		var bot = _bleeders[i]
		var wounds: Array = bot.get_meta("wounds", [])
		var rate: float = bot.bleed_rate
		if not bot.alive:
			if not _dead_since.has(bot):
				_dead_since[bot] = _time
			# The heart has stopped: what is left drains out by gravity, and only
			# from the body and head: a limb wound stops soon after death.
			var core := false
			for w in wounds:
				if w.get("kind", "") in ["torso", "neck", "head"]:
					core = true
			rate = (maxf(rate, 14.0) if core else rate) * exp(-(_time - float(_dead_since[bot])) / (20.0 if core else 6.0))
		if rate < 0.3 or wounds.is_empty():
			_bleeders.remove_at(i)
			continue
		var total_w := 0.0
		for w in wounds:
			total_w += w["w"]
		for w in wounds:
			var part: RigidBody3D = w["part"]
			var cs: CollisionShape3D = w["cs"]
			var ext: float = EXTERNAL_ARTERIAL if w["arterial"] else EXTERNAL
			if w.get("kind", "") in ["head", "neck"]:
				ext = 1.0
			var r: float = rate * w["w"] / total_w * ext
			var gush: float = w.get("gush", 0.0)
			if gush > 0.0:
				# Pours out over the first several seconds, tapering off.
				var g := minf(gush, dt * (8.0 + gush * 0.35))
				w["gush"] = gush - g
				r += g / dt
			var xf := part.global_transform * cs.transform
			var proj := _shape_project(cs.shape, w["p"])
			var pos_w := xf * (proj[0] as Vector3)
			var n_w := (xf.basis * (proj[1] as Vector3)).normalized()
			if w["arterial"] and bot.alive:
				# Arterial: spurts with every heartbeat.
				var was: float = w["pulse"]
				w["pulse"] = was + dt * 1.7
				if int(w["pulse"]) != int(was):
					var jet := (n_w + Vector3.UP * 0.25).normalized()
					_spray(pos_w + n_w * 0.01, jet, 10.0, 1.2, 3.2, 6, r / 1.7 * 0.7, bot._ray_exclude)
				r *= 0.3
			if w.get("kind", "") in ["head", "neck"] and (not bot.alive or float(w.get("gush", 0.0)) > 0.0):
				# Pours straight off the head onto the ground below it.
				w["pour"] = float(w.get("pour", 0.0)) + r * dt
				if w["pour"] >= 1.5:
					var low := part.global_position + Vector3.DOWN * 0.1 + Vector3(randf_range(-0.03, 0.03), 0, randf_range(-0.03, 0.03))
					_drip(low, part.linear_velocity, w["pour"], bot._ray_exclude)
					w["pour"] = 0.0
				continue
			w["acc"] = float(w["acc"]) + r * dt
			var threshold := clampf(r * 0.3, 0.4, 3.0)
			if w["acc"] >= threshold:
				# One stream per wound: while it is still running, keep feeding it.
				var run: BodyRun = w.get("run")
				if run != null and run.vol > 0.0 and _body_runs.has(run):
					run.vol += w["acc"]
				else:
					w["run"] = _start_body_run(bot, part, pos_w, w["acc"])
				w["acc"] = 0.0
		i += 1


## Bodies that move while bloody (or lie in blood) smear it on the ground and
## pick more up from the pools they lie in; bloody feet leave prints.
func _update_smears() -> void:
	var space := get_world_3d().direct_space_state
	for k in Game.bots.size():
		var bot = Game.bots[k]
		var lying: bool = bot.fallen or not bot.alive
		for part: RigidBody3D in bot.parts:
			var pname: String = part.get_meta("part")
			var is_foot := pname.begins_with("foot")
			if not lying and not is_foot:
				continue
			var id := part.get_instance_id()
			var soak: float = _soak.get(id, 0.0)
			var pool := _pool_at(part.global_position, 1.0)
			var in_blood := pool != null or _splat_grid.has(_cell(part.global_position + Vector3.DOWN * 0.08))
			if soak < 0.2 and not in_blood:
				continue
			var cs := _shape_of(part)
			var radius := 0.05
			if cs.shape is CapsuleShape3D:
				radius = (cs.shape as CapsuleShape3D).radius
			_q.collision_mask = Game.LAYER_WORLD
			_q.exclude = _no_ex
			_q.from = part.global_position
			_q.to = part.global_position + Vector3.DOWN * (radius + 0.1)
			var hit := space.intersect_ray(_q)
			if hit.is_empty() or hit.normal.y < 0.6:
				continue
			if in_blood:
				_add_soak(part, 3.0 if pool else 0.8)
				soak = _soak[id]
				var last: float = _soak_stamp.get(id, -10.0)
				if lying and _time - last > 1.2:
					_soak_stamp[id] = _time
					var under := part.global_position + Vector3.DOWN * radius * 0.9
					_body_stamp(part, under, Vector3.DOWN, _any_tangent(Vector3.UP), radius * 1.8, radius * 2.4, "smear", randi() % SPARE)
			if is_foot and not lying:
				_bot_footprint(part, hit.position, hit.normal, soak)
				continue
			var v := part.linear_velocity
			v.y = 0.0
			var sp := v.length()
			if sp < 0.15:
				continue
			# Drag mark: one continuous brush stroke from where the part was
			# to where it is now.
			var w := radius * 1.8
			var here: Vector3 = hit.position
			var prev: Vector3 = _feet.get(-id, Vector3.INF)
			if prev == Vector3.INF or prev.distance_to(here) > 0.8:
				prev = here - v / sp * 0.05
			_feet[-id] = here
			var seg := here - prev
			var seg_len := seg.length()
			if seg_len < 0.005:
				continue
			# A thin film: it wipes on streaky and see-through, heavier where the
			# clothes are soaked.
			var alpha := clampf(soak / 14.0, 0.06, 0.22)
			var dabs := int(seg_len / (w * 0.5)) + 1
			for s in dabs:
				var q := prev.lerp(here, (s + 1.0) / dabs)
				_world_stamp(self, q, hit.normal, seg / seg_len, w, w * 1.3, "brush", randi() % SPARE, clampf(soak / 600.0, 0.004, 0.025), alpha)
			_soak[id] = soak - minf(0.08 * dabs, soak)


func _bot_footprint(foot: RigidBody3D, ground: Vector3, n: Vector3, soak: float) -> void:
	if soak < 0.3 or foot.linear_velocity.length() > 0.5:
		return
	var id := foot.get_instance_id()
	var last: Vector3 = _feet.get(id, Vector3.INF)
	if last != Vector3.INF and last.distance_to(ground) < 0.3:
		return
	_feet[id] = ground
	var fwd := -foot.global_basis.z
	_print(ground, n, fwd, soak, foot.get_meta("part") == "foot_l")
	_soak[id] = soak - minf(0.7, soak)


## Player step: blood on the soles is picked up in pools and printed after.
func footstep(pos: Vector3, fwd: Vector3, who: Node) -> void:
	var id := who.get_instance_id()
	var soak: float = _soak.get(id, 0.0)
	if is_pool(pos):
		soak = minf(soak + 5.0, 9.0)
	elif _splat_grid.has(_cell(pos)):
		soak = minf(soak + 0.8, 9.0)
	if soak >= 0.3:
		_q.collision_mask = Game.LAYER_WORLD
		_q.exclude = _no_ex
		_q.from = pos + Vector3.UP * 0.3
		_q.to = pos + Vector3.DOWN * 0.3
		var hit := get_world_3d().direct_space_state.intersect_ray(_q)
		if not hit.is_empty() and hit.normal.y > 0.6 and not is_pool(pos):
			_step_left = not _step_left
			_print(hit.position, hit.normal, fwd, soak, _step_left)
		soak -= 0.8
	_soak[id] = maxf(soak, 0.0)


var _step_left := false


func _print(p: Vector3, n: Vector3, fwd: Vector3, soak: float, left: bool) -> void:
	_world_stamp(self, p, n, fwd, 0.1, 0.27, "print", 1 if left else 0, 0.5, clampf(soak / 4.0, 0.3, 1.0))


func is_pool(p: Vector3) -> bool:
	return _pool_at(p, 0.85) != null

# --- Decals --------------------------------------------------------------------------------

func _setup_decal(d: Decal, mask: int) -> void:
	d.cull_mask = mask
	d.upper_fade = 0.15
	d.lower_fade = 0.15
	d.normal_fade = 0.35
	d.albedo_mix = 1.0
	d.distance_fade_enabled = true
	d.distance_fade_begin = 30.0
	d.distance_fade_length = 10.0
	d.texture_orm = _orm_wet
	# Decals are placed from physics code; interpolating them would smear
	# a recycled decal across the map for one frame.
	d.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF


func _dress(d: Decal, kind: String, variant: int) -> void:
	var pair := BT.get_pair(kind, variant)
	d.texture_albedo = pair[0]
	d.texture_normal = pair[1]
	d.texture_orm = _orm_wet
	d.modulate = Color.WHITE


## Basis whose Y is the surface normal and Z follows `along`.
func _decal_basis(n: Vector3, along: Vector3) -> Basis:
	var y := n.normalized()
	var z := along - y * y.dot(along)
	if z.length() < 1e-4:
		z = _any_tangent(y)
	z = z.normalized()
	return Basis(y.cross(z), y, z)


## Returns the index of a free decal parented to `parent`. When the set is
## full it recycles the least important of the next few candidates: small
## and old goes first, big splats and pools stay; decals held by moving
## streaks are never taken.
func _alloc(ds: DecalSet, parent: Node, prio := 0.0) -> int:
	var i := -1
	if ds.decals.size() < ds.max_n:
		var nd := Decal.new()
		_setup_decal(nd, ds.mask)
		parent.add_child(nd)
		ds.decals.append(nd)
		ds.birth.append(_time)
		ds.prio.append(prio)
		ds.live.append(0)
		ds.last = ds.decals.size() - 1
		return ds.last
	var best := INF
	for tries in 24:
		var k := (ds.next + tries) % ds.max_n
		if ds.live[k] != 0:
			continue
		var score := ds.prio[k] / (1.0 + (_time - ds.birth[k]) / 60.0)
		if score < best:
			best = score
			i = k
	ds.next = (ds.next + 24) % ds.max_n
	if i < 0:
		i = ds.next
	var d := ds.decals[i]
	if not is_instance_valid(d):
		d = Decal.new()
		_setup_decal(d, ds.mask)
		ds.decals[i] = d
	if d.get_parent() != parent:
		if d.get_parent():
			d.get_parent().remove_child(d)
		parent.add_child(d)
	ds.birth[i] = _time
	ds.prio[i] = prio
	ds.live[i] = 0
	ds.last = i
	return i


func _cell(p: Vector3) -> Vector3i:
	return Vector3i(floori(p.x / 0.06), floori(p.y / 0.06), floori(p.z / 0.06))


func _stamp(ds: DecalSet, parent: Node, p: Vector3, n: Vector3, along: Vector3, w: float, l: float, kind: String, variant: int, depth: float) -> void:
	var d := ds.decals[_alloc(ds, parent, w * l)]
	_dress(d, kind, variant)
	d.global_transform = Transform3D(_decal_basis(n, along), p)
	d.size = Vector3(w, depth, l)


## Blood on the level is painted into the world maps; props (moving bodies)
## and faces the maps cannot hold (slanted, overhanging) get a decal instead.
func _world_stamp(parent: Node, p: Vector3, n: Vector3, along: Vector3, w: float, l: float, kind: String, variant: int,
		thick := 1.0, alpha := 1.0) -> void:
	if parent == self and _canvas.dab(p, n, along, w, l, kind, variant, thick, alpha):
		_splat_grid[_cell(p)] = 1
		return
	_stamp(_world, parent, p, n, along, w, l, kind, variant, clampf(maxf(w, l) * 0.6, 0.05, 0.2))
	_world.decals[_world.last].modulate.a = alpha


func _body_stamp(part: RigidBody3D, p: Vector3, n: Vector3, along: Vector3, w: float, l: float, kind: String, variant: int) -> void:
	var h = part.get_meta("humanoid", null)
	if h != null and h.has_method("paint_blood"):
		var amount := {"wound": 0.9, "splat": 0.75, "streak": 0.6, "drop": 0.5, "smear": 0.45}.get(kind, 0.6) as float
		if kind == "streak" or l > w * 1.4:
			# Long: a line of dabs along it.
			var a := along - n * n.dot(along)
			a = a.normalized() if a.length() > 1e-3 else Vector3.DOWN
			var steps := maxi(int(l / 0.02), 2)
			for k in steps:
				h.paint_blood(part, p + a * (float(k) / (steps - 1) - 0.5) * l, w * 0.5, amount)
		else:
			h.paint_blood(part, p, maxf(w, l) * 0.5, amount)
		# (the wound itself: the hole is flesh_wounds.gd's, the stain round it
		# the body's own blood - no flat printed ring on top)
		return
	_stamp(_body, part, p, n, along, w, l, kind, variant, 0.06)


func _update_drying(ds: DecalSet, budget: int) -> void:
	var count := ds.decals.size()
	if count == 0:
		return
	for k in mini(budget, count):
		var i := ds.dry_cursor
		ds.dry_cursor = (ds.dry_cursor + 1) % count
		var d := ds.decals[i]
		if not is_instance_valid(d):
			continue
		var k_dry := clampf((_time - ds.birth[i]) / DRY_TIME, 0.0, 1.0)
		var alpha := d.modulate.a
		d.modulate = Color.WHITE.lerp(DRY_COLOR, pow(k_dry, 0.7))
		d.modulate.a = alpha
		if k_dry > 0.6 and d.texture_orm != _orm_dry:
			d.texture_orm = _orm_dry


## Builds the decal atlas and compiles the particle/drop shaders at load
## time instead of on the first shot. The hidden decals keep every blood
## texture referenced so the atlas is never repacked mid-game.
func _prewarm() -> void:
	var kinds := [["streak", 0], ["wound", 0], ["print", 0], ["print", 1]]
	for v in SPARE:
		for k in ["splat", "pool", "smear", "drop", "brush"]:
			kinds.append([k, v])
	for i in kinds.size():
		var d := Decal.new()
		_setup_decal(d, 0)
		d.visible = false
		add_child(d)
		_dress(d, kinds[i][0], kinds[i][1])
		if i == 0:
			d.texture_orm = _orm_dry
		_keep.append(d)
	var below := Vector3(0, -500, 0)
	for m in _mist:
		m.global_position = below
		m.restart()
	spawn_drop(below, Vector3.ZERO, 1.0)


# --- Mist -----------------------------------------------------------------------------------

func _build_mist() -> void:
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 0, -1)
	pm.spread = 22.0
	pm.initial_velocity_min = 0.6
	pm.initial_velocity_max = 4.5
	pm.damping_min = 5.0
	pm.damping_max = 9.0
	pm.gravity = Vector3(0, -1.2, 0)
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = 0.03
	pm.angle_max = 360.0
	pm.scale_min = 0.5
	pm.scale_max = 1.3
	var c := Curve.new()
	c.max_value = 4.0
	c.add_point(Vector2(0, 0.4))
	c.add_point(Vector2(1, 2.6))
	var ct := CurveTexture.new()
	ct.curve = c
	pm.scale_curve = ct
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 0.55))
	g.set_color(1, Color(1, 1, 1, 0.0))
	var gt := GradientTexture1D.new()
	gt.gradient = g
	pm.color_ramp = gt
	var q := QuadMesh.new()
	q.size = Vector2(0.1, 0.1)
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = Tex.smoke_puff()
	m.albedo_color = Color(0.4, 0.02, 0.02)
	m.roughness = 0.6
	q.material = m
	for i in 8:
		var p := GPUParticles3D.new()
		p.one_shot = true
		p.emitting = false
		p.amount = 26
		p.lifetime = 0.9
		p.explosiveness = 0.95
		p.local_coords = false
		p.process_material = pm
		p.draw_pass_1 = q
		p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		p.visibility_aabb = AABB(Vector3(-3, -3, -3), Vector3(6, 6, 6))
		add_child(p)
		_mist.append(p)


## What a bullet blows out of the far side of a head (a shot to the head,
## a gun put to one's own): not a few drops but a fan of blood and matter
## thrown hard enough to reach the wall behind. Where it lands it lands in
## the shape of the burst - a heavy splash where the middle of it hit, with
## spikes of it thrown out round that, fine spatter in a cone about it, drops
## elongated the way they were going - and the heavy middle runs down the
## wall. It arrives as it would: the far bits a moment after the near ones.
func exit_splatter(origin: Vector3, dir: Vector3, strength := 1.0, ignore: Array[RID] = []) -> void:
	# (a head blown through is a lot, and hard)
	strength *= 3.0
	var space := get_world_3d().direct_space_state
	var d := dir.normalized()
	var helper := Vector3.UP if absf(d.y) < 0.95 else Vector3.RIGHT
	var fwd := Basis.looking_at(d, helper)
	var mask := Game.LAYER_WORLD | Game.LAYER_PROPS
	var speed := 20.0
	# The flying part of it, seen going.
	_spray(origin, d, 30.0, 8.0, 24.0, int(80 * strength), 65.0 * strength, ignore)
	_spray(origin, d, 55.0, 2.0, 7.0, int(24 * strength), 12.0 * strength, ignore)
	_mist_burst(origin, d, clampf(strength * 1.2, 0.3, 1.0))
	# A jet that follows the bullet out: a few more waves of it over a tenth of
	# a second, tighter and a little slower each time, so a stream of blood
	# is seen going after the round, and a second cloud further along it.
	for k in 5:
		var wave := k + 1
		get_tree().create_timer(0.022 * wave).timeout.connect(func():
			_spray(origin + d * 0.02, d, 16.0 - wave * 1.6, 5.0, 17.0 - wave * 1.5, int(26 * strength / wave), 16.0 * strength / wave, ignore))
	get_tree().create_timer(0.05).timeout.connect(func():
		_mist_burst(origin + d * 0.45, d, clampf(strength * 0.8, 0.3, 1.0)))
	if Game.gibs:
		Game.gibs.burst(origin, d, int(5 * strength), 7.5, 0.6)
	# The middle of it.
	var q := PhysicsRayQueryParameters3D.create(origin, origin + d * 8.0, mask)
	q.exclude = ignore
	var hit := space.intersect_ray(q)
	if not hit.is_empty():
		var p: Vector3 = hit.position
		var n: Vector3 = hit.normal
		var dist := origin.distance_to(p)
		var spread := clampf(0.18 + dist * 0.12, 0.2, 0.6) * sqrt(strength) * 0.85
		get_tree().create_timer(dist / speed).timeout.connect(func():
			_splash_at(p, n, d, spread, strength))
	# The spatter round it: many rays in a cone, each a drop where it hits.
	var n_rays := int(75 * strength)
	for i in n_rays:
		var a := randf() * TAU
		var r := pow(randf(), 0.7) * deg_to_rad(32.0)
		var rd := (fwd * Vector3(cos(a) * sin(r), sin(a) * sin(r), -cos(r))).normalized()
		var rq := PhysicsRayQueryParameters3D.create(origin, origin + rd * 9.0, mask)
		rq.exclude = ignore
		var h := space.intersect_ray(rq)
		if h.is_empty():
			continue
		var hp: Vector3 = h.position
		var hn: Vector3 = h.normal
		var dist2 := origin.distance_to(hp)
		# Size: bigger near the middle and close; elongated as it came in slant.
		var w := randf_range(0.006, 0.02) * (1.3 - r / deg_to_rad(32.0) * 0.6) * (1.0 + 0.5 / maxf(dist2, 0.5))
		var slant := 1.0 + clampf(1.0 - absf(rd.dot(hn)), 0.0, 1.0) * 3.0
		var along := rd - hn * rd.dot(hn)
		along = along.normalized() if along.length() > 1e-3 else _any_tangent(hn)
		var kind := "drop" if w < 0.013 else "splat"
		get_tree().create_timer(dist2 / (speed * randf_range(0.7, 1.1))).timeout.connect(func():
			_world_stamp(self, hp + hn * 0.002, hn, along, w, w * slant, kind, randi() % SPARE, 1.0, 1.0))


## The heavy middle of a burst on the wall: a splash, spikes of it thrown out
## round it, and blood starting to run down from it.
func _splash_at(p: Vector3, n: Vector3, d: Vector3, size: float, strength: float) -> void:
	var t1 := d - n * d.dot(n)
	t1 = t1.normalized() if t1.length() > 1e-3 else _any_tangent(n)
	var t2 := n.cross(t1).normalized()
	_world_stamp(self, p + n * 0.002, n, t1, size * 0.8, size * 0.8, "splat", randi() % SPARE, 1.0, 1.0)
	_world_stamp(self, p + n * 0.002 + t1 * size * 0.15, n, t1, size * 0.5, size * 0.7, "splat", randi() % SPARE, 1.0, 1.0)
	# Spikes: thrown outwards from the middle, longest the way it was going.
	for k in int(12 * strength) + 4:
		var a := randf() * TAU
		var dirk := (t1 * cos(a) + t2 * sin(a)).normalized()
		var bias := 1.0 + maxf(dirk.dot(t1), 0.0) * 1.5
		var l := randf_range(0.08, 0.22) * bias * size / 0.3
		var at := p + dirk * (size * 0.3 + l * 0.5) + n * 0.002
		_world_stamp(self, at, n, dirk, randf_range(0.01, 0.025), l, "streak", randi() % SPARE, 0.8, 1.0)
		# (a bead at the end of the spike)
		_world_stamp(self, p + dirk * (size * 0.3 + l) + n * 0.002, n, dirk, 0.012, 0.018, "drop", randi() % SPARE, 1.0, 1.0)
	# It runs down (on a wall; on the floor it just lies).
	if absf(n.y) < 0.7:
		for k in randi_range(5, 9):
			_start_run(p + t2 * randf_range(-size, size) * 0.4 + Vector3.DOWN * size * randf_range(0.0, 0.3), n, randf_range(1.5, 4.5) * strength)
	elif n.y > 0.7:
		_add_pool(p, n, 25.0 * strength)


func _mist_burst(pos: Vector3, dir: Vector3, strength: float) -> void:
	var p := _mist[_mist_i]
	_mist_i = (_mist_i + 1) % _mist.size()
	var d := dir.normalized()
	var helper := Vector3.UP if absf(d.y) < 0.95 else Vector3.RIGHT
	p.global_transform = Transform3D(Basis.looking_at(d, helper), pos)
	p.amount_ratio = clampf(strength, 0.1, 1.0)
	p.restart()


# --- Droplet rendering ------------------------------------------------------------------------

## Drops are flat: a quad per drop turned to face the eye about its line of
## flight and stretched along it (a short exposure), a round dark bead with a
## wet highlight drawn in it. Two triangles instead of a sphere.
const DROP_SHADER := """
shader_type spatial;
render_mode cull_disabled, shadows_disabled, depth_draw_opaque, skip_vertex_transform, specular_schlick_ggx;

void vertex() {
	vec3 centre = MODEL_MATRIX[3].xyz;
	vec3 axis_v = MODEL_MATRIX[1].xyz;
	float len = length(axis_v);
	float r = length(MODEL_MATRIX[0].xyz);
	vec3 axis = axis_v / max(len, 1e-5);
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	vec3 to_eye = normalize(cam - centre);
	vec3 side = cross(axis, to_eye);
	side = length(side) > 1e-3 ? normalize(side) : normalize(INV_VIEW_MATRIX[0].xyz);
	vec3 w = centre + side * VERTEX.x * 2.0 * r + axis * VERTEX.y * 2.0 * max(len, r);
	VERTEX = (VIEW_MATRIX * vec4(w, 1.0)).xyz;
}

void fragment() {
	vec2 d = UV * 2.0 - 1.0;
	float q = dot(d, d);
	if (q > 1.0) {
		discard;
	}
	// Lit like anything else (in the dark it is dark): a round wet bead -
	// the normal bulges towards the eye - glossy, so the light that is
	// there glints off it.
	ALBEDO = vec3(0.14, 0.006, 0.005) * (1.0 - 0.4 * q);
	NORMAL = normalize(vec3(d.x, -d.y, sqrt(max(1.0 - q, 0.0)) + 0.3));
	ROUGHNESS = 0.12;
	SPECULAR = 0.6;
}
"""


func _build_drop_mesh() -> void:
	var s := QuadMesh.new()
	s.size = Vector2(1.0, 1.0)
	var m := ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = DROP_SHADER
	m.shader = sh
	s.material = m
	_mm = MultiMesh.new()
	_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mm.mesh = s
	_mm.instance_count = MAX_DROPS
	_mm.visible_instance_count = 0
	_mm.custom_aabb = AABB(Vector3(-500, -100, -500), Vector3(1000, 300, 1000))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = _mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(mmi)
	_buf.resize(MAX_DROPS * 12)


func _draw_drops(extra: float) -> void:
	var n := mini(_drops.size(), MAX_DROPS)
	for i in n:
		var d := _drops[i]
		var p := d.pos + d.vel * extra
		var r := 0.0062 * pow(d.vol, 1.0 / 3.0)
		var sp := d.vel.length()
		var y := d.vel / sp if sp > 0.01 else Vector3.UP
		var x := y.cross(Vector3.UP if absf(y.y) < 0.95 else Vector3.RIGHT).normalized()
		var z := x.cross(y)
		# Stretch along the velocity like a short camera exposure.
		var stretch := r + sp * d.streak
		x *= r
		z *= r
		y *= stretch
		var o := i * 12
		_buf[o] = x.x
		_buf[o + 1] = y.x
		_buf[o + 2] = z.x
		_buf[o + 3] = p.x
		_buf[o + 4] = x.y
		_buf[o + 5] = y.y
		_buf[o + 6] = z.y
		_buf[o + 7] = p.y
		_buf[o + 8] = x.z
		_buf[o + 9] = y.z
		_buf[o + 10] = z.z
		_buf[o + 11] = p.z
	if n > 0 or _mm.visible_instance_count > 0:
		_mm.buffer = _buf
	_mm.visible_instance_count = n


# --- Main loop ---------------------------------------------------------------------------------

func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["blood._physics_process"] = Game.prof.get("blood._physics_process", 0) + __d
	Game.prof["max blood._physics_process"] = maxi(Game.prof.get("max blood._physics_process", 0), __d)


func _physics_process_real(delta: float) -> void:
	_time += delta
	_canvas.time = _time
	# Everything runs at 60 Hz, split across physics ticks.
	_tick += 1
	var dt := delta * 2.0
	if _tick % 2 == 0:
		_update_drops(dt)
		_since_sim = 0.0
	else:
		_update_runs(dt)
		_update_body_runs(dt)
		_update_bleeding(dt)
		_update_jets(dt)
	_smear_t += delta
	if _smear_t > 0.1:
		_smear_t = 0.0
		_update_smears()


func _process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["blood._process"] = Game.prof.get("blood._process", 0) + __d
	Game.prof["max blood._process"] = maxi(Game.prof.get("max blood._process", 0), __d)


func _process_real(delta: float) -> void:
	_since_sim += delta
	_draw_drops(_since_sim)
	_update_pools(delta)
	_update_drying(_world, 40)
	_update_drying(_body, 24)


# --- Mopping (mop.gd) ----------------------------------------------------------------

## A wet mop wiping at p (on a floor, normal n): the blood there fades by
## `amount`; returns how much blood (ml) it took up.
func wipe(p: Vector3, n: Vector3, r: float, amount: float) -> float:
	_canvas.erase(p, n, r, amount)
	var took := 0.0
	for pool in _pools:
		if pool.pos.distance_to(p) < pool.r + r:
			var t: float = pool.vol * amount * 0.5
			pool.vol -= t
			took += t
			# It stops growing back: what is shown is what is left.
			pool.r = minf(pool.r, pool.shown)
	return took


## A dry or dirty mop drags blood along: thin streaks behind it.
func smear(p: Vector3, n: Vector3, along: Vector3, w: float, l: float, thick := 0.15, alpha := 0.35) -> void:
	_canvas.dab(p, n, along, w, l, "smear", randi() % SPARE, thick, alpha)


## Whether there is (known) blood lying near p.
func blood_near(p: Vector3, r: float) -> bool:
	for pool in _pools:
		if pool.vol > 1.0 and pool.pos.distance_to(p) < pool.r + r:
			return true
	return false
