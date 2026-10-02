class_name Mats

static var _cache: Dictionary = {}

static func _tex(base: Color, line: Color, noise: float) -> ImageTexture:
	var img := Image.create(64, 64, false, Image.FORMAT_RGB8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for y in 64:
		for x in 64:
			var n := rng.randf_range(-noise, noise)
			var c := Color(base.r + n, base.g + n, base.b + n)
			if x < 2 or y < 2:
				c = line
			img.set_pixel(x, y, c)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

# Минималистичный материал: цвет + лёгкий шум + тонкая линия панели, triplanar (без UV).
static func get_mat(key: String, color: Color, rough: float = 0.85, metal: float = 0.0, tex_scale: float = 0.5) -> StandardMaterial3D:
	if _cache.has(key):
		return _cache[key]
	var m := StandardMaterial3D.new()
	m.albedo_texture = _tex(color, color.darkened(0.35), 0.04)
	m.roughness = rough
	m.metallic = metal
	m.uv1_triplanar = true
	m.uv1_scale = Vector3(tex_scale, tex_scale, tex_scale)
	_cache[key] = m
	return m

static func emissive(key: String, color: Color, energy: float = 2.0) -> StandardMaterial3D:
	if _cache.has(key):
		return _cache[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	_cache[key] = m
	return m
