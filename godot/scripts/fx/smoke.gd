extends RefCounted
## Smoke textures and materials shared by every smoke effect (muzzle smoke,
## barrel wisps, impact dust, cigarette smoke, exhaled smoke).
## The flipbook is a puff of billowing noise that swells and thins over its
## frames; the normal map is taken from the density so the puff is shaded as a
## rounded, lumpy volume by the scene lights.

const FRAMES := Vector2i(4, 2)
const SIZE := 96

static var _density: ImageTexture
static var _normal: ImageTexture
static var _mats := {}


static func _build() -> void:
	if _density:
		return
	var w := SIZE * FRAMES.x
	var h := SIZE * FRAMES.y
	var dimg := Image.create(w, h, false, Image.FORMAT_RGBA8)
	var nimg := Image.create(w, h, false, Image.FORMAT_RGB8)
	var n := FastNoiseLite.new()
	n.seed = 7
	n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	n.frequency = 2.2
	n.fractal_octaves = 5
	var warp := FastNoiseLite.new()
	warp.seed = 19
	warp.frequency = 1.3
	var count := FRAMES.x * FRAMES.y
	var field := PackedFloat32Array()
	field.resize(SIZE * SIZE)
	for f in count:
		var t := float(f) / (count - 1)
		var ox := (f % FRAMES.x) * SIZE
		var oy := (f / FRAMES.x) * SIZE
		# The puff grows and loosens with age.
		var reach := 0.78 + 0.18 * t
		for y in SIZE:
			for x in SIZE:
				var p := Vector2(x, y) / (SIZE - 1) * 2.0 - Vector2.ONE
				var q := p + Vector2(warp.get_noise_3d(p.x, p.y, t * 1.5), warp.get_noise_3d(p.x + 5.2, p.y, t * 1.5)) * (0.25 + 0.2 * t)
				var r := q.length() / reach
				var body := clampf(1.0 - r * r, 0.0, 1.0)
				var billow := n.get_noise_3d(q.x, q.y, t * 1.8) * 0.5 + 0.5
				var d := smoothstep(0.25, 0.85, billow * 0.8 + body * 0.55) * body
				d *= 1.0 - 0.35 * t
				field[y * SIZE + x] = d
		for y in SIZE:
			for x in SIZE:
				var d := field[y * SIZE + x]
				dimg.set_pixel(ox + x, oy + y, Color(1, 1, 1, d))
				var dl := field[y * SIZE + maxi(x - 1, 0)]
				var dr := field[y * SIZE + mini(x + 1, SIZE - 1)]
				var du := field[maxi(y - 1, 0) * SIZE + x]
				var dd := field[mini(y + 1, SIZE - 1) * SIZE + x]
				var p := Vector2(x, y) / (SIZE - 1) * 2.0 - Vector2.ONE
				# Rounded puff plus lumps from the density.
				var sphere := Vector3(p.x, -p.y, sqrt(maxf(1.0 - p.length_squared(), 0.05)))
				var lumps := Vector3((dl - dr) * 6.0, (dd - du) * 6.0, 1.0)
				var nv := (sphere * 0.6 + lumps.normalized() * 0.8).normalized()
				nimg.set_pixel(ox + x, oy + y, Color(nv.x * 0.5 + 0.5, nv.y * 0.5 + 0.5, nv.z * 0.5 + 0.5))
	dimg.generate_mipmaps()
	nimg.generate_mipmaps()
	_density = ImageTexture.create_from_image(dimg)
	_normal = ImageTexture.create_from_image(nimg)


## Shared lit smoke material. tint: base colour (grey gun smoke, bluish
## cigarette smoke, brown dust); opacity scales the whole effect.
static func material(key: String, tint: Color, opacity := 1.0, backlight := 0.55) -> ShaderMaterial:
	if _mats.has(key):
		return _mats[key]
	_build()
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/smoke.gdshader")
	m.set_shader_parameter("density_tex", _density)
	m.set_shader_parameter("normal_tex", _normal)
	m.set_shader_parameter("tint", tint)
	m.set_shader_parameter("opacity", opacity)
	m.set_shader_parameter("backlight", backlight)
	m.set_shader_parameter("frames", Vector2(FRAMES))
	_mats[key] = m
	return m


static func quad(key: String, size: float, tint: Color, opacity := 1.0) -> QuadMesh:
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	q.material = material(key, tint, opacity)
	return q
