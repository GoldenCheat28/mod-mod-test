extends RefCounted
## The look of a cigarette and a joint, made once and shared (smoking.gd,
## bot_activity.gd): the cork-patterned tipping paper of the filter with its
## thin gold band, the white paper with its seam and faint laid lines and the
## brand ring by the filter, thin rolling paper with the herb showing through,
## the charred ring where it burns and the grey flaking ash of the ember with
## the glow in its cracks.
## Cylinder UVs: u round it, v along it (0 at the mouth end, as they are held).

static var _cache := {}


static func _img(w: int, h: int, f: Callable) -> ImageTexture:
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	for y in h:
		for x in w:
			img.set_pixel(x, y, f.call(float(x) / w, float(y) / h, x, y))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


static func _noise(seed_v: int, freq: float) -> FastNoiseLite:
	var n := FastNoiseLite.new()
	n.seed = seed_v
	n.frequency = freq
	n.fractal_octaves = 3
	return n


## Filter tipping: orange cork pattern (darker speckles and blotches), a
## thin gold band where it meets the paper.
static func filter_mat() -> StandardMaterial3D:
	if _cache.has("filter"):
		return _cache["filter"]
	var n := _noise(11, 0.09)
	var fine := _noise(12, 0.45)
	var tex := _img(128, 96, func(u: float, v: float, x: int, y: int) -> Color:
		var c := Color(0.8, 0.54, 0.29)
		var b := n.get_noise_2d(x, y) * 0.5 + 0.5
		var f := fine.get_noise_2d(x, y) * 0.5 + 0.5
		c = c.lerp(Color(0.62, 0.36, 0.16), smoothstep(0.55, 0.75, b) * 0.6)
		if f > 0.72:
			c = c.lerp(Color(0.45, 0.25, 0.1), 0.6)
		elif f < 0.22:
			c = c.lerp(Color(0.92, 0.72, 0.48), 0.5)
		# (the gold band near the paper end, and the white edge of the paper glued over)
		if v > 0.9 and v < 0.94:
			c = Color(0.78, 0.62, 0.3)
		return c)
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex
	m.roughness = 0.75
	_cache["filter"] = m
	return m


## Cigarette paper: white, a faint glued seam along it, laid lines round it,
## and a thin printed ring by the filter.
static func paper_mat() -> StandardMaterial3D:
	if _cache.has("paper"):
		return _cache["paper"]
	var fib := _noise(21, 0.3)
	var tex := _img(64, 256, func(u: float, v: float, x: int, y: int) -> Color:
		var c := Color(0.94, 0.93, 0.9)
		c = c.darkened(0.03 * (fib.get_noise_2d(x * 2.0, y * 0.5) * 0.5 + 0.5))
		# laid lines: faint bands round it every millimetre or so
		if y % 6 == 0:
			c = c.darkened(0.035)
		# the seam, where the paper overlaps itself
		if absf(u - 0.5) < 0.025:
			c = c.darkened(0.06)
		# the brand ring, a thin grey double line by the filter
		if (v > 0.035 and v < 0.045) or (v > 0.055 and v < 0.062):
			c = Color(0.55, 0.55, 0.57)
		return c)
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex
	m.roughness = 0.9
	m.subsurf_scatter_enabled = true
	m.subsurf_scatter_strength = 0.15
	_cache["paper"] = m
	return m


## Rolling paper round a joint: thin, off-white, the herb and its green-brown
## crumbs showing through it, a wavy glued edge.
static func joint_mat() -> StandardMaterial3D:
	if _cache.has("joint"):
		return _cache["joint"]
	var herb := _noise(31, 0.35)
	var fib := _noise(32, 0.12)
	var tex := _img(96, 192, func(u: float, v: float, x: int, y: int) -> Color:
		var c := Color(0.93, 0.9, 0.8)
		var h := herb.get_noise_2d(x, y) * 0.5 + 0.5
		# (the stuff inside, seen through the paper)
		c = c.lerp(Color(0.52, 0.5, 0.3), smoothstep(0.55, 0.8, h) * 0.45)
		c = c.darkened(0.06 * (fib.get_noise_2d(x, y * 3.0) * 0.5 + 0.5))
		var seam := 0.5 + 0.03 * sin(v * 40.0)
		if absf(u - seam) < 0.02:
			c = c.darkened(0.1)
		return c)
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex
	m.roughness = 0.88
	m.subsurf_scatter_enabled = true
	m.subsurf_scatter_strength = 0.25
	_cache["joint"] = m
	return m


## The black-brown charred ring where the paper is burning.
static func char_mat() -> StandardMaterial3D:
	if _cache.has("char"):
		return _cache["char"]
	var n := _noise(41, 0.4)
	var tex := _img(64, 16, func(u: float, v: float, x: int, y: int) -> Color:
		var k := v + (n.get_noise_2d(x, y) * 0.5) * 0.35
		return Color(0.33, 0.24, 0.16).lerp(Color(0.05, 0.04, 0.035), smoothstep(0.2, 0.8, k)))
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex
	m.roughness = 0.95
	_cache["char"] = m
	return m


## The ember: grey-white flaking ash with the glow showing in the cracks
## (the emission texture: only the cracks light up).
static func ember_mat() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	if not _cache.has("ash_tex"):
		var n := _noise(51, 0.25)
		var cr := _noise(52, 0.12)
		cr.noise_type = FastNoiseLite.TYPE_CELLULAR
		cr.cellular_return_type = FastNoiseLite.RETURN_DISTANCE2_SUB
		_cache["ash_tex"] = _img(64, 64, func(u: float, v: float, x: int, y: int) -> Color:
			var g := 0.35 + 0.35 * (n.get_noise_2d(x, y) * 0.5 + 0.5)
			return Color(g, g * 0.97, g * 0.94))
		_cache["glow_tex"] = _img(64, 64, func(u: float, v: float, x: int, y: int) -> Color:
			var c := 0.3 + 0.7 * (1.0 - smoothstep(0.0, 0.18, cr.get_noise_2d(x, y) * 0.5 + 0.5))
			return Color(c, c, c))
	m.albedo_texture = _cache["ash_tex"]
	m.roughness = 1.0
	m.emission_enabled = true
	m.emission = Color(1.0, 0.32, 0.05)
	m.emission_texture = _cache["glow_tex"]
	m.emission_energy_multiplier = 0.0
	return m
