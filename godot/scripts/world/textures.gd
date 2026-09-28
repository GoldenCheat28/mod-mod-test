extends RefCounted
## Procedural textures: noise maps for shaders plus a few painted images
## (graffiti, newspaper, smoke puff, bullet hole). Everything is cached.

static var _cache := {}


static func noise(key: String, frequency: float, octaves := 5, size := 512, as_normal := false, bump := 4.0,
		noise_type := FastNoiseLite.TYPE_SIMPLEX_SMOOTH, cellular_return := -1) -> NoiseTexture2D:
	var cache_key := "%s_%s" % [key, as_normal]
	if _cache.has(cache_key):
		return _cache[cache_key]
	var n := FastNoiseLite.new()
	n.seed = hash(key) & 0xffff
	n.noise_type = noise_type
	n.frequency = frequency
	n.fractal_octaves = octaves
	if cellular_return >= 0:
		n.fractal_type = FastNoiseLite.FRACTAL_NONE
		n.cellular_return_type = cellular_return
		n.cellular_distance_function = FastNoiseLite.DISTANCE_EUCLIDEAN
	var t := NoiseTexture2D.new()
	t.width = size
	t.height = size
	t.seamless = true
	t.noise = n
	t.as_normal_map = as_normal
	t.bump_strength = bump
	t.generate_mipmaps = true
	_cache[cache_key] = t
	return t


static func detail() -> NoiseTexture2D:
	return noise("detail", 0.02, 5)


static func large() -> NoiseTexture2D:
	return noise("large", 0.008, 4)


static func detail_normal() -> NoiseTexture2D:
	return noise("detail", 0.02, 5, 512, true, 5.0)


static func cells() -> NoiseTexture2D:
	return noise("cells", 0.012, 1, 512, false, 1.0, FastNoiseLite.TYPE_CELLULAR, FastNoiseLite.RETURN_DISTANCE2_SUB)


static func fabric_normal() -> NoiseTexture2D:
	return noise("fabric", 0.09, 2, 256, true, 2.5)


static func smoke_puff() -> ImageTexture:
	if _cache.has("smoke"):
		return _cache["smoke"]
	var size := 128
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var n := FastNoiseLite.new()
	n.frequency = 0.045
	n.fractal_octaves = 4
	for y in size:
		for x in size:
			var d := Vector2(x - size * 0.5, y - size * 0.5).length() / (size * 0.5)
			var fall := clampf(1.0 - d, 0.0, 1.0)
			fall = fall * fall * (3.0 - 2.0 * fall)
			var v := clampf(n.get_noise_2d(x, y) * 0.6 + 0.6, 0.0, 1.0)
			img.set_pixel(x, y, Color(1, 1, 1, clampf(fall * v * 1.2, 0.0, 1.0)))
	img.generate_mipmaps()
	var tex := ImageTexture.create_from_image(img)
	_cache["smoke"] = tex
	return tex


static func bullet_hole() -> ImageTexture:
	if _cache.has("hole"):
		return _cache["hole"]
	var size := 64
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	for y in size:
		for x in size:
			var p := Vector2(x - size * 0.5, y - size * 0.5) / (size * 0.5)
			var a := atan2(p.y, p.x)
			var r := p.length() * (1.0 + 0.25 * sin(a * 7.0) * sin(a * 3.0))
			var c := Color(0, 0, 0, 0)
			if r < 0.22:
				c = Color(0.02, 0.02, 0.02, 1.0)
			elif r < 0.7:
				var k := (r - 0.22) / 0.48
				c = Color(0.35, 0.33, 0.3, (1.0 - k) * 0.75)
			img.set_pixel(x, y, c)
	img.generate_mipmaps()
	var tex := ImageTexture.create_from_image(img)
	_cache["hole"] = tex
	return tex


## Faded spray-paint tag. Each seed gives a different piece.
static func graffiti(seed_value: int) -> ImageTexture:
	var key := "graffiti_%d" % seed_value
	if _cache.has(key):
		return _cache[key]
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var w := 256
	var h := 128
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var palette := [Color(0.75, 0.12, 0.1), Color(0.1, 0.3, 0.7), Color(0.9, 0.85, 0.8),
			Color(0.1, 0.1, 0.1), Color(0.2, 0.6, 0.25), Color(0.9, 0.55, 0.1), Color(0.55, 0.2, 0.6)]
	var fill: Color = palette[rng.randi() % palette.size()]
	var outline: Color = palette[rng.randi() % palette.size()]
	var letters := rng.randi_range(3, 6)
	var x0 := 20.0
	var step := (w - 40.0) / letters
	# Letters are chunky random strokes, first a thick fill then a thin outline.
	for pass_i in 2:
		var col: Color = fill if pass_i == 0 else outline
		var radius := 8.5 if pass_i == 0 else 2.5
		var lrng := RandomNumberGenerator.new()
		lrng.seed = seed_value * 31
		for l in letters:
			var cx := x0 + step * (l + 0.5)
			var pts: Array[Vector2] = []
			for k in lrng.randi_range(3, 5):
				pts.append(Vector2(cx + lrng.randf_range(-step * 0.4, step * 0.4), lrng.randf_range(25.0, h - 25.0)))
			for k in pts.size() - 1:
				_spray_line(img, pts[k], pts[k + 1], radius, col, rng)
	# Drips.
	for d in rng.randi_range(3, 9):
		var sx := rng.randf_range(25.0, w - 25.0)
		var sy := rng.randf_range(50.0, 90.0)
		_spray_line(img, Vector2(sx, sy), Vector2(sx + rng.randf_range(-1, 1), sy + rng.randf_range(10, 35)), 1.3, fill, rng)
	# Age: erode with noise.
	var n := FastNoiseLite.new()
	n.seed = seed_value
	n.frequency = 0.06
	for y in h:
		for x in w:
			var c := img.get_pixel(x, y)
			if c.a <= 0.0:
				continue
			var wear := clampf(n.get_noise_2d(x, y) * 1.4 + 0.55, 0.0, 1.0)
			c.a *= wear * rng.randf_range(0.75, 1.0)
			c = c.lerp(Color(0.6, 0.58, 0.55, c.a), 0.25)
			img.set_pixel(x, y, c)
	img.generate_mipmaps()
	var tex := ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex


static func _spray_line(img: Image, a: Vector2, b: Vector2, radius: float, col: Color, rng: RandomNumberGenerator) -> void:
	var steps := int(a.distance_to(b) / maxf(radius * 0.6, 1.0)) + 1
	for i in steps + 1:
		var p := a.lerp(b, float(i) / steps)
		var r := int(radius + 2)
		for y in range(int(p.y) - r, int(p.y) + r + 1):
			if y < 0 or y >= img.get_height():
				continue
			for x in range(int(p.x) - r, int(p.x) + r + 1):
				if x < 0 or x >= img.get_width():
					continue
				var d := Vector2(x, y).distance_to(p)
				if d > radius + 2.0:
					continue
				var k := clampf(1.0 - (d - radius) / 2.0, 0.0, 1.0)
				if d > radius and rng.randf() > 0.3:
					continue
				var dst := img.get_pixel(x, y)
				var alpha := maxf(dst.a, k * 0.95)
				img.set_pixel(x, y, Color(col.r, col.g, col.b, alpha))


static func newspaper(seed_value: int) -> ImageTexture:
	var key := "paper_%d" % seed_value
	if _cache.has(key):
		return _cache[key]
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var w := 128
	var h := 160
	var img := Image.create(w, h, false, Image.FORMAT_RGB8)
	var paper := Color(0.72, 0.69, 0.6).darkened(rng.randf_range(0.0, 0.35))
	img.fill(paper)
	img.fill_rect(Rect2i(8, 8, w - 16, 16), paper.darkened(0.7))
	var y := 32
	while y < h - 8:
		var cols := 2 if rng.randf() < 0.7 else 1
		var cw := int((w - 16 - (cols - 1) * 6) / float(cols))
		for c in cols:
			var seg := rng.randi_range(int(cw * 0.5), cw)
			img.fill_rect(Rect2i(8 + c * (cw + 6), y, seg, 2), paper.darkened(0.45))
		y += 5
		if rng.randf() < 0.08:
			img.fill_rect(Rect2i(8, y, rng.randi_range(30, w - 16), 26), paper.darkened(0.3))
			y += 30
	# Dirt stains.
	for s in 6:
		var cx := rng.randi_range(0, w)
		var cy := rng.randi_range(0, h)
		var r := rng.randi_range(6, 20)
		for yy in range(cy - r, cy + r):
			for xx in range(cx - r, cx + r):
				if xx >= 0 and xx < w and yy >= 0 and yy < h and Vector2(xx - cx, yy - cy).length() < r:
					img.set_pixel(xx, yy, img.get_pixel(xx, yy).darkened(0.2))
	img.generate_mipmaps()
	var tex := ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex
