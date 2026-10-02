class_name Mats

static var _cache: Dictionary = {}

# ---------- простые материалы (оружие, враги) ----------
static func _flat_tex(base: Color, line: Color, noise: float) -> ImageTexture:
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

static func get_mat(key: String, color: Color, rough: float = 0.85, metal: float = 0.0, tex_scale: float = 0.5) -> StandardMaterial3D:
	if _cache.has(key):
		return _cache[key]
	var m := StandardMaterial3D.new()
	m.albedo_texture = _flat_tex(color, color.darkened(0.35), 0.04)
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

# ---------- процедурные PBR-материалы (albedo + normal + roughness) ----------
# key -> [тип, цвет, размер_текстуры, тайл_в_метрах, roughness, metallic, triplanar]
const DEFS := {
	"concrete":     ["concrete", Color(0.55, 0.55, 0.53), 256, 3.0, 0.92, 0.0, true],
	"concrete_wall":["concrete", Color(0.58, 0.57, 0.54), 256, 3.0, 0.95, 0.0, true],
	"brick":        ["brick",    Color(0.50, 0.22, 0.16), 256, 2.0, 0.9,  0.0, true],
	"plaster":      ["plaster",  Color(0.74, 0.72, 0.65), 128, 3.0, 0.95, 0.0, true],
	"roof":         ["concrete", Color(0.32, 0.32, 0.33), 128, 4.0, 0.95, 0.0, true],
	"tile":         ["tile",     Color(0.62, 0.64, 0.62), 128, 1.6, 0.35, 0.0, true],
	"metal_floor":  ["diamond",  Color(0.40, 0.42, 0.44), 128, 1.6, 0.45, 0.7, true],
	"steel":        ["steel",    Color(0.22, 0.25, 0.28), 128, 1.5, 0.45, 0.8, true],
	"pipe":         ["steel",    Color(0.55, 0.30, 0.12), 128, 1.0, 0.5,  0.7, true],
	"wood":         ["wood",     Color(0.50, 0.36, 0.20), 256, 1.2, 0.8,  0.0, true],
	"crate":        ["crate",    Color(0.55, 0.40, 0.22), 256, 1.0, 0.85, 0.0, false],
	"pallet":       ["wood",     Color(0.62, 0.50, 0.30), 128, 1.0, 0.9,  0.0, true],
	"carton":       ["carton",   Color(0.62, 0.48, 0.30), 128, 1.0, 0.9,  0.0, false],
	"barrel_red":   ["barrel",   Color(0.62, 0.12, 0.08), 128, 1.0, 0.45, 0.6, false],
	"barrel_blue":  ["barrel",   Color(0.12, 0.25, 0.55), 128, 1.0, 0.45, 0.6, false],
	"barrel_green": ["barrel",   Color(0.20, 0.42, 0.18), 128, 1.0, 0.45, 0.6, false],
	"container_red":  ["corrugated", Color(0.55, 0.14, 0.10), 128, 2.0, 0.5, 0.6, true],
	"container_blue": ["corrugated", Color(0.13, 0.25, 0.48), 128, 2.0, 0.5, 0.6, true],
	"container_green":["corrugated", Color(0.18, 0.36, 0.20), 128, 2.0, 0.5, 0.6, true],
	"bag":          ["steel",    Color(0.08, 0.09, 0.08), 128, 0.6, 0.7, 0.0, true],
	"can":          ["steel",    Color(0.65, 0.65, 0.68), 128, 0.2, 0.3, 0.8, true],
	"cabinet":      ["steel",    Color(0.38, 0.42, 0.40), 128, 1.0, 0.5, 0.6, true],
	"jersey":       ["concrete", Color(0.55, 0.55, 0.53), 256, 2.0, 0.95, 0.0, true],
}

static func pbr(key: String) -> StandardMaterial3D:
	if key == "window":
		return emissive("window", Color(0.55, 0.72, 0.95), 1.6)
	if key == "panel":
		return emissive("panel", Color(1.0, 0.95, 0.85), 3.0)
	var ck := "pbr_" + key
	if _cache.has(ck):
		return _cache[ck]
	if not DEFS.has(key):
		return get_mat("fallback", Color(0.5, 0.5, 0.5))
	var d: Array = DEFS[key]
	var tex := _make_tex(d[0], d[1], d[2])
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex[0]
	m.normal_enabled = true
	m.normal_texture = tex[1]
	m.normal_scale = 1.0
	m.roughness = d[4]
	m.metallic = d[5]
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	if d[6]:
		m.uv1_triplanar = true
		m.uv1_world_triplanar = true
		var s := 1.0 / float(d[3])
		m.uv1_scale = Vector3(s, s, s)
	_cache[ck] = m
	return m

static func _noise(seed_v: int, freq: float, octaves: int, size: int) -> Image:
	var n := FastNoiseLite.new()
	n.seed = seed_v
	n.frequency = freq
	n.fractal_octaves = octaves
	n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	return n.get_seamless_image(size, size, false, false, 0.1, true)

static func _hash(a: int) -> float:
	var x := (a * 1103515245 + 12345) & 0x7fffffff
	x = ((x >> 8) ^ x) * 2654435 & 0x7fffffff
	return float(x % 1000) / 1000.0

static func _make_tex(kind: String, base: Color, n: int) -> Array:
	var seed_v := kind.hash() & 0xffff
	var lo := _noise(seed_v, 0.02, 4, n)         # крупные пятна
	var hi := _noise(seed_v + 1, 0.12, 3, n)     # мелкое зерно
	var streak := _noise(seed_v + 2, 0.015, 2, n)
	var alb := Image.create(n, n, false, Image.FORMAT_RGB8)
	var hgt := PackedFloat32Array()
	hgt.resize(n * n)
	for y in n:
		for x in n:
			var l := lo.get_pixel(x, y).r
			var h := hi.get_pixel(x, y).r
			var s := streak.get_pixel(x, y).r
			var col := base * (0.78 + 0.4 * l)
			var ht := h * 0.5
			var u := float(x) / n
			var v := float(y) / n
			match kind:
				"concrete":
					ht = h * 0.6 + l * 0.2
					if h > 0.72:
						col *= 0.7   # поры
						ht -= 0.3
					var crack := absf(s - 0.5)
					if crack < 0.006:
						col *= 0.45
						ht -= 0.5
					col *= 1.0 - 0.25 * smoothstep(0.6, 0.9, l)   # потёки
				"brick":
					var row := int(v * 8.0)
					var bx := fmod(u * 4.0 + (0.5 if row % 2 == 1 else 0.0), 1.0)
					var by := fmod(v * 8.0, 1.0)
					var mortar := bx < 0.06 or by < 0.12
					var id := int(u * 4.0 + (0.5 if row % 2 == 1 else 0.0)) + row * 7
					if mortar:
						col = Color(0.6, 0.58, 0.54) * (0.8 + 0.3 * h)
						ht = 0.0
					else:
						col = base * (0.7 + 0.5 * _hash(id)) * (0.85 + 0.3 * h)
						ht = 0.6 + h * 0.3
				"plaster":
					col = base * (0.9 + 0.15 * l) * (0.95 + 0.1 * h)
					ht = h * 0.3
				"tile":
					var tx := fmod(u * 4.0, 1.0)
					var ty := fmod(v * 4.0, 1.0)
					var grout := tx < 0.04 or ty < 0.04
					var id2 := int(u * 4.0) + int(v * 4.0) * 4
					col = Color(0.35, 0.35, 0.34) if grout else base * (0.85 + 0.25 * _hash(id2)) * (0.95 + 0.1 * h)
					ht = 0.0 if grout else 0.7
				"diamond":
					var cx := fmod(u * 8.0, 1.0)
					var cy := fmod(v * 8.0, 1.0)
					var alt := (int(u * 8.0) + int(v * 8.0)) % 2 == 0
					var dd := absf(cx - 0.5) + absf(cy - 0.5) if alt else absf((cx - 0.5) * 0.3) + absf(cy - 0.5) * 1.6
					ht = clampf(1.0 - dd * 2.2, 0.0, 1.0) if alt else clampf(1.0 - dd * 2.2, 0.0, 1.0)
					col = base * (0.7 + 0.5 * ht) * (0.9 + 0.2 * l)
				"steel":
					col = base * (0.75 + 0.5 * s) * (0.92 + 0.16 * h)
					ht = s * 0.2 + h * 0.1
				"wood":
					var pl := int(u * 6.0)
					var px := fmod(u * 6.0, 1.0)
					var grain := absf(sin((u * 6.0 + s * 3.0) * 18.0)) * 0.12
					col = base * (0.7 + 0.5 * _hash(pl + 5)) * (0.9 + grain + 0.1 * h)
					ht = 0.5 + grain
					if px < 0.03 or px > 0.97:
						col *= 0.4
						ht = 0.0
				"crate":
					var gx := absf(u - 0.5)
					var gy := absf(v - 0.5)
					var frame := gx > 0.42 or gy > 0.42
					var pl2 := int(v * 6.0)
					var grain2 := absf(sin((v * 6.0 + s * 3.0) * 16.0)) * 0.1
					col = base * (0.7 + 0.45 * _hash(pl2 + 3)) * (0.9 + grain2 + 0.1 * h)
					ht = 0.5 + grain2
					if frame:
						col *= 0.8
						ht += 0.25
					if fmod(v * 6.0, 1.0) < 0.04:
						col *= 0.4
						ht = 0.0
					if absf(gx - gy) < 0.025 and not frame:
						col *= 0.85
						ht += 0.2
				"carton":
					col = base * (0.88 + 0.2 * h) * (0.92 + 0.12 * l)
					ht = h * 0.2
					if absf(v - 0.5) < 0.07:
						col = Color(0.78, 0.68, 0.45) * (0.9 + 0.1 * h)   # скотч
						ht = 0.4
					if absf(u - 0.5) < 0.004 or u < 0.01:
						col *= 0.6
				"barrel":
					col = base * (0.8 + 0.3 * l)
					ht = 0.5
					var ring := absf(fmod(v * 5.0, 1.0) - 0.5)
					if ring > 0.46:
						ht = 1.0
						col *= 0.8
					var rust := smoothstep(0.55, 0.8, s) * smoothstep(0.4, 0.7, h)
					col = col.lerp(Color(0.35, 0.16, 0.06), rust * 0.9)
					ht -= rust * 0.2
					col *= 1.0 - 0.3 * smoothstep(0.7, 1.0, v)   # грязь снизу
				"corrugated":
					var wave := sin(u * TAU * 12.0)
					ht = wave * 0.5 + 0.5
					col = base * (0.75 + 0.3 * ht) * (0.85 + 0.25 * s)
					var rust2 := smoothstep(0.62, 0.8, s) * smoothstep(0.4, 0.8, v)
					col = col.lerp(Color(0.32, 0.15, 0.06), rust2 * 0.8)
			alb.set_pixel(x, y, Color(clampf(col.r, 0, 1), clampf(col.g, 0, 1), clampf(col.b, 0, 1)))
			hgt[y * n + x] = ht
	var nrm := Image.create(n, n, false, Image.FORMAT_RGB8)
	var k := 3.0 if kind in ["corrugated", "diamond", "brick", "tile", "barrel"] else 1.6
	for y in n:
		for x in n:
			var hl := hgt[y * n + (x - 1 + n) % n]
			var hr := hgt[y * n + (x + 1) % n]
			var hu := hgt[((y - 1 + n) % n) * n + x]
			var hd := hgt[((y + 1) % n) * n + x]
			var nv := Vector3((hl - hr) * k, (hu - hd) * k, 1.0).normalized()
			nrm.set_pixel(x, y, Color(nv.x * 0.5 + 0.5, nv.y * 0.5 + 0.5, nv.z * 0.5 + 0.5))
	alb.generate_mipmaps()
	nrm.generate_mipmaps()
	return [ImageTexture.create_from_image(alb), ImageTexture.create_from_image(nrm)]
