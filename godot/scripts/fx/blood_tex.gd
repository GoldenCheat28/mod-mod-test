extends RefCounted
## Procedural blood decal textures. Each shape is first built as a thickness
## field; albedo (colour + coverage), a normal map (so the film reads as a
## raised, wet layer) and the wet/dry ORM maps are baked from it. Cached.

const WET := Color(0.48, 0.022, 0.016)
const THICK := Color(0.24, 0.006, 0.006)
const CLOT := Color(0.05, 0.0, 0.0)

static var _cache := {}


## [albedo, normal, paint mask] textures for a shape kind ("splat", "drop", "pool",
## "smear", "wound") and variant index.
static func get_pair(kind: String, variant: int) -> Array:
	var key := "%s_%d" % [kind, variant]
	if _cache.has(key):
		return _cache[key]
	var size := 96 if kind in ["drop", "wound", "streak", "brush"] else 192
	var h := PackedFloat32Array()
	h.resize(size * size)
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(key)
	var n := FastNoiseLite.new()
	n.seed = rng.randi()
	match kind:
		"splat":
			_splat(h, size, rng, n)
		"drop":
			_drop(h, size, rng, n)
		"streak":
			_streak(h, size, n)
		"brush":
			_brush(h, size, n)
		"print":
			_print(h, size, n, variant == 1)
		"pool":
			_pool(h, size, rng, n)
		"smear":
			_smear(h, size, n)
		"wound":
			_wound(h, size, rng, n)
	var pair := _bake(h, size, 2.2 if kind == "pool" else 3.0)
	_cache[key] = pair
	return pair


static func orm(wet: bool) -> ImageTexture:
	var key := "orm_wet" if wet else "orm_dry"
	if _cache.has(key):
		return _cache[key]
	var img := Image.create(4, 4, false, Image.FORMAT_RGB8)
	img.fill(Color(1.0, 0.07, 0.0) if wet else Color(1.0, 0.62, 0.0))
	var t := ImageTexture.create_from_image(img)
	_cache[key] = t
	return t


# --- Shapes (coordinates are normalised to -1..1) ----------------------------------

static func _px(size: int, u: float) -> int:
	return int((u * 0.5 + 0.5) * (size - 1))


## Dome-shaped bump, merged with max().
static func _bump(h: PackedFloat32Array, size: int, c: Vector2, r: float, amp: float) -> void:
	var x0 := maxi(_px(size, c.x - r), 0)
	var x1 := mini(_px(size, c.x + r) + 1, size - 1)
	var y0 := maxi(_px(size, c.y - r), 0)
	var y1 := mini(_px(size, c.y + r) + 1, size - 1)
	var inv := 2.0 / (size - 1)
	for y in range(y0, y1 + 1):
		var py := y * inv - 1.0
		for x in range(x0, x1 + 1):
			var d := Vector2(x * inv - 1.0 - c.x, py - c.y).length() / r
			if d < 1.0:
				var v := amp * sqrt(1.0 - d * d)
				var i := y * size + x
				if v > h[i]:
					h[i] = v


## Lobed blob: radius varies with angle, flat-ish top, soft edge.
static func _blob(h: PackedFloat32Array, size: int, n: FastNoiseLite, r0: float, lobes: float, freq: float, amp: float) -> void:
	var inv := 2.0 / (size - 1)
	for y in size:
		var py := y * inv - 1.0
		for x in size:
			var px := x * inv - 1.0
			var d := sqrt(px * px + py * py)
			if d > r0 * (1.0 + lobes * 1.6):
				continue
			var a := atan2(py, px)
			var r := r0 * (1.0 + lobes * n.get_noise_2d(cos(a) * freq * 40.0, sin(a) * freq * 40.0) * 2.0)
			var edge := (r - d) / maxf(r, 0.001)
			if edge > 0.0:
				var v := amp * pow(clampf(edge * 3.5, 0.0, 1.0), 0.55)
				var i := y * size + x
				h[i] = maxf(h[i], v)


static func _splat(h: PackedFloat32Array, size: int, rng: RandomNumberGenerator, n: FastNoiseLite) -> void:
	var r0 := rng.randf_range(0.3, 0.42)
	_blob(h, size, n, r0, 0.22, 1.6, 0.85)
	# Radial spines ending in a bead, as thrown from the impact.
	for s in rng.randi_range(6, 13):
		var a := rng.randf() * TAU
		var dir := Vector2(cos(a), sin(a))
		var length := rng.randf_range(0.12, 0.5)
		var w := rng.randf_range(0.03, 0.06)
		var steps := int(length / 0.02) + 2
		for k in steps:
			var t := float(k) / steps
			var c := dir * (r0 * 0.8 + length * t)
			_bump(h, size, c, w * (1.0 - t * 0.75), 0.6)
		_bump(h, size, dir * (r0 * 0.8 + length + 0.02), w * 0.8, 0.7)
	# Loose satellite droplets.
	for s in rng.randi_range(12, 30):
		var a := rng.randf() * TAU
		var d := rng.randf_range(r0 + 0.05, 0.93)
		var r := rng.randf_range(0.008, 0.035) * (1.2 - d * 0.5)
		_bump(h, size, Vector2(cos(a), sin(a)) * d, r, 0.7)


## Round spot with a scalloped edge and a few tiny satellites.
static func _drop(h: PackedFloat32Array, size: int, rng: RandomNumberGenerator, n: FastNoiseLite) -> void:
	_blob(h, size, n, 0.7, 0.09, 4.0, 0.75)
	for s in rng.randi_range(0, 4):
		var a := rng.randf() * TAU
		_bump(h, size, Vector2(cos(a), sin(a)) * rng.randf_range(0.8, 0.92), rng.randf_range(0.04, 0.07), 0.6)


## Run of blood along +V: slightly meandering band, tapered at both ends.
static func _streak(h: PackedFloat32Array, size: int, n: FastNoiseLite) -> void:
	var inv := 2.0 / (size - 1)
	for y in size:
		var py := y * inv - 1.0
		var centre := n.get_noise_2d(0.0, py * 60.0) * 0.18
		var half := (0.55 + n.get_noise_2d(50.0, py * 90.0) * 0.18) * smoothstep(1.0, 0.8, absf(py))
		for x in size:
			var px := x * inv - 1.0
			var e := half - absf(px - centre)
			if e > 0.0:
				h[y * size + x] = 0.7 * pow(clampf(e * 6.0, 0.0, 1.0), 0.5)


## Shoe sole print along +V (toe at -V), mirrored for the left foot.
static func _print(h: PackedFloat32Array, size: int, n: FastNoiseLite, left: bool) -> void:
	var inv := 2.0 / (size - 1)
	for y in size:
		var py := y * inv - 1.0
		for x in size:
			var px := (x * inv - 1.0) * (-1.0 if left else 1.0)
			# Forefoot (slightly turned in) and heel.
			var fore := pow((px - 0.08 + py * 0.08) / 0.62, 2.0) + pow((py + 0.3) / 0.62, 2.0)
			var heel := pow(px / 0.5, 2.0) + pow((py - 0.62) / 0.32, 2.0)
			var inside := minf(fore, heel)
			if inside < 1.0:
				var tread := 0.5 + 0.5 * sin(py * 38.0 + n.get_noise_2d(x * 3.0, y * 3.0) * 4.0)
				var blotch := n.get_noise_2d(x * 2.0, y * 2.0) * 0.5 + 0.5
				h[y * size + x] = 0.35 * smoothstep(1.0, 0.8, inside) * smoothstep(0.25, 0.6, tread * 0.6 + blotch * 0.7)


## Round drag-brush dab whose fibres run along +V, so a dense row of dabs
## reads as one continuous streaky smear.
static func _brush(h: PackedFloat32Array, size: int, n: FastNoiseLite) -> void:
	var inv := 2.0 / (size - 1)
	for y in size:
		var py := y * inv - 1.0
		for x in size:
			var px := x * inv - 1.0
			var r := sqrt(px * px + py * py)
			if r >= 1.0:
				continue
			var fibre := n.get_noise_2d(px * 240.0, 7.0) * 0.5 + 0.5
			h[y * size + x] = 0.6 * smoothstep(1.0, 0.55, r) * smoothstep(0.25, 0.7, fibre)


static func _pool(h: PackedFloat32Array, size: int, rng: RandomNumberGenerator, n: FastNoiseLite) -> void:
	# Irregular spread: a main body plus a few merged lobes of different size.
	_blob(h, size, n, 0.55, 0.2, 1.3, 1.0)
	for s in rng.randi_range(3, 5):
		var a := rng.randf() * TAU
		var d := rng.randf_range(0.3, 0.5)
		_bump(h, size, Vector2(cos(a), sin(a)) * d, rng.randf_range(0.2, 0.36), 1.0)
	for s in rng.randi_range(4, 10):
		var a := rng.randf() * TAU
		var d := rng.randf_range(0.78, 0.93)
		_bump(h, size, Vector2(cos(a), sin(a)) * d, rng.randf_range(0.015, 0.04), 0.8)


## Drag streaks along +V: many fibres, heavy at the start, running out.
static func _smear(h: PackedFloat32Array, size: int, n: FastNoiseLite) -> void:
	var inv := 2.0 / (size - 1)
	for y in size:
		var py := y * inv - 1.0
		for x in size:
			var px := x * inv - 1.0
			var env := 1.0 - pow(absf(px) / 0.8, 2.0) - pow(absf(py) / 0.95, 6.0)
			if env <= 0.0:
				continue
			# FastNoiseLite's default frequency is 0.01, hence the large multipliers.
			var fibre := n.get_noise_2d(px * 260.0, py * 25.0) * 0.5 + 0.5
			var run_out := smoothstep(0.95, -0.7, py + n.get_noise_2d(px * 120.0, 300.0) * 0.5)
			var v := smoothstep(0.3, 0.8, fibre * 0.55 + env * 0.55 + run_out * 0.3) * run_out * 0.5
			h[y * size + x] = v


static func _wound(h: PackedFloat32Array, size: int, rng: RandomNumberGenerator, n: FastNoiseLite) -> void:
	_blob(h, size, n, 0.55, 0.2, 2.0, 0.55)
	for s in 10:
		var a := rng.randf() * TAU
		_bump(h, size, Vector2(cos(a), sin(a)) * rng.randf_range(0.55, 0.9), rng.randf_range(0.03, 0.07), 0.5)
	# Torn entry hole: very high values bake to near-black clotted colour.
	_blob(h, size, n, 0.2, 0.25, 3.0, 1.5)


# --- Baking ------------------------------------------------------------------------

static func _bake(h: PackedFloat32Array, size: int, normal_strength: float) -> Array:
	var alb := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var mask := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var nrm := Image.create(size, size, false, Image.FORMAT_RGB8)
	for y in size:
		for x in size:
			var v := h[y * size + x]
			var a := smoothstep(0.02, 0.1, v)
			var c := WET.lerp(THICK, smoothstep(0.1, 0.95, v))
			if v > 1.0:
				c = c.lerp(CLOT, smoothstep(1.0, 1.4, v))
			# Slightly darker rim where the film dries first.
			var rim := smoothstep(0.02, 0.07, v) * (1.0 - smoothstep(0.07, 0.22, v))
			c = c.darkened(rim * 0.25)
			c.a = a
			alb.set_pixel(x, y, c)
			# Paint mask: R = film thickness, A = coverage.
			mask.set_pixel(x, y, Color(clampf(v / 1.2, 0.0, 1.0), 0.0, 0.0, smoothstep(0.01, 0.09, v)))
			var hl := minf(h[y * size + maxi(x - 1, 0)], 1.0)
			var hr := minf(h[y * size + mini(x + 1, size - 1)], 1.0)
			var hu := minf(h[maxi(y - 1, 0) * size + x], 1.0)
			var hd := minf(h[mini(y + 1, size - 1) * size + x], 1.0)
			var nv := Vector3((hl - hr) * normal_strength, (hd - hu) * normal_strength, 1.0).normalized()
			nrm.set_pixel(x, y, Color(nv.x * 0.5 + 0.5, nv.y * 0.5 + 0.5, nv.z * 0.5 + 0.5))
	alb.generate_mipmaps()
	nrm.generate_mipmaps()
	mask.generate_mipmaps()
	return [ImageTexture.create_from_image(alb), ImageTexture.create_from_image(nrm), ImageTexture.create_from_image(mask)]
