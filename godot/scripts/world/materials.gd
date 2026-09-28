extends RefCounted
## Shared materials. Created once so every mesh using a look shares one
## material (keeps draw-call batching and shader compiles down).

const Tex = preload("res://scripts/world/textures.gd")

static var _cache := {}


static func _concrete_shader() -> Shader:
	return load("res://shaders/concrete.gdshader")


static func concrete(kind := "wall") -> ShaderMaterial:
	var key := "concrete_" + kind
	if _cache.has(key):
		return _cache[key]
	var m := ShaderMaterial.new()
	m.shader = _concrete_shader()
	m.set_shader_parameter("tex_detail", Tex.detail())
	m.set_shader_parameter("tex_large", Tex.large())
	m.set_shader_parameter("tex_normal", Tex.detail_normal())
	match kind:
		"wall":
			m.set_shader_parameter("base_color", Color(0.55, 0.54, 0.51))
			m.set_shader_parameter("moss_amount", 0.55)
		"floor":
			m.set_shader_parameter("base_color", Color(0.47, 0.46, 0.43))
			m.set_shader_parameter("moss_amount", 0.35)
			m.set_shader_parameter("stain_amount", 0.2)
		"sidewalk":
			m.set_shader_parameter("base_color", Color(0.6, 0.59, 0.56))
			m.set_shader_parameter("tile_size", 0.9)
			m.set_shader_parameter("moss_amount", 0.4)
		"dark":
			m.set_shader_parameter("base_color", Color(0.36, 0.35, 0.33))
			m.set_shader_parameter("moss_amount", 0.7)
		"rubble":
			m.set_shader_parameter("base_color", Color(0.52, 0.5, 0.47))
			m.set_shader_parameter("moss_amount", 0.25)
			m.set_shader_parameter("tex_scale", 2.0)
			m.set_shader_parameter("normal_strength", 1.6)
		"brick":
			m.set_shader_parameter("base_color", Color(0.45, 0.25, 0.18))
			m.set_shader_parameter("moss_amount", 0.3)
			m.set_shader_parameter("tex_scale", 1.6)
	_cache[key] = m
	return m


static func asphalt() -> ShaderMaterial:
	if _cache.has("asphalt"):
		return _cache["asphalt"]
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/asphalt.gdshader")
	m.set_shader_parameter("tex_detail", Tex.detail())
	m.set_shader_parameter("tex_large", Tex.large())
	m.set_shader_parameter("tex_cells", Tex.cells())
	m.set_shader_parameter("tex_normal", Tex.detail_normal())
	_cache["asphalt"] = m
	return m


static func water() -> ShaderMaterial:
	if _cache.has("water"):
		return _cache["water"]
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/water.gdshader")
	m.set_shader_parameter("tex_normal", Tex.detail_normal())
	m.set_shader_parameter("tex_edge", Tex.large())
	_cache["water"] = m
	return m


static func standard(key: String, color: Color, roughness := 0.8, metallic := 0.0, normal_scale := 0.0) -> StandardMaterial3D:
	if _cache.has(key):
		return _cache[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = roughness
	m.metallic = metallic
	if normal_scale > 0.0:
		m.normal_enabled = true
		m.normal_texture = Tex.detail_normal()
		m.normal_scale = normal_scale
		m.uv1_triplanar = true
		m.uv1_world_triplanar = false
		m.uv1_scale = Vector3.ONE * 2.0
	_cache[key] = m
	return m


static func rust() -> StandardMaterial3D:
	if _cache.has("rust"):
		return _cache["rust"]
	var m := standard("rust", Color(0.38, 0.2, 0.1), 0.85, 0.35, 0.8)
	m.albedo_texture = Tex.detail()
	m.albedo_color = Color(0.55, 0.3, 0.15)
	return m


## Painted steel drum, colour picked per variant, with rust showing through.
static func barrel(variant: int) -> StandardMaterial3D:
	var key := "barrel_%d" % variant
	if _cache.has(key):
		return _cache[key]
	var cols := [Color(0.13, 0.25, 0.42), Color(0.45, 0.1, 0.08), Color(0.18, 0.28, 0.15), Color(0.5, 0.42, 0.12)]
	var m := StandardMaterial3D.new()
	var grad := Gradient.new()
	grad.set_color(0, Color(0.33, 0.17, 0.08))
	grad.set_color(1, cols[variant % cols.size()])
	grad.add_point(0.55, Color(0.4, 0.22, 0.1))
	grad.add_point(0.62, cols[variant % cols.size()].darkened(0.1))
	var t := NoiseTexture2D.new()
	var n := FastNoiseLite.new()
	n.seed = 100 + variant
	n.frequency = 0.03
	t.noise = n
	t.color_ramp = grad
	t.seamless = true
	m.albedo_texture = t
	m.roughness = 0.7
	m.metallic = 0.45
	m.normal_enabled = true
	m.normal_texture = Tex.detail_normal()
	m.normal_scale = 0.6
	_cache[key] = m
	return m


static func glass(color: Color) -> StandardMaterial3D:
	var key := "glass_%s" % color.to_html()
	if _cache.has(key):
		return _cache[key]
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = Color(color.r, color.g, color.b, 0.55)
	m.roughness = 0.12
	m.metallic_specular = 0.8
	_cache[key] = m
	return m


static func decal_material_textured(key: String, tex: Texture2D, color := Color.WHITE) -> StandardMaterial3D:
	if _cache.has(key):
		return _cache[key]
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex
	m.albedo_color = color
	m.roughness = 0.95
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	_cache[key] = m
	return m
