extends Node3D
## The splash a hit makes, drawn as a hand-animated sprite (the old way):
## eight frames of a burst - a dark core bursting out, drops flung off it
## in streaks that run out, round off and thin away - played over a few
## tenths of a second where the bullet went in (small) and came out (big,
## thrown along the bullet's line). The frames are drawn once, at start;
## each splash is a quad from a small pool turned to the camera, so a
## firefight costs next to nothing.

const FRAMES := Vector2i(4, 2)
const CELL := 128
const POOL := 24

static var _atlas: ImageTexture
static var _shader: Shader

var _quads: Array[MeshInstance3D] = []
var _life: Array = []            # [age, dur] per quad (dur <= 0: free)
var _next := 0


func _ready() -> void:
	_build_atlas()
	var mat := ShaderMaterial.new()
	mat.shader = _make_shader()
	mat.set_shader_parameter("atlas", _atlas)
	var qm := QuadMesh.new()
	qm.size = Vector2.ONE
	for i in POOL:
		var mi := MeshInstance3D.new()
		mi.mesh = qm
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.visible = false
		mi.top_level = true
		add_child(mi)
		_quads.append(mi)
		_life.append([0.0, 0.0])


## A splash at `at`, thrown along `dir`, `size` metres across at its widest.
func splash(at: Vector3, dir: Vector3, size: float, dur := 0.32) -> void:
	var i := _next
	_next = (_next + 1) % POOL
	var mi := _quads[i]
	# (pushed a little toward the camera so it is not lost inside the body)
	var cam := get_viewport().get_camera_3d()
	var p := at
	if cam:
		p += (cam.global_position - at).normalized() * 0.06
	mi.global_transform = Transform3D(Basis.from_scale(Vector3.ONE * size), p + dir.normalized() * size * 0.18)
	# The burst's streaks point the way it was thrown, as seen from the camera.
	var spin := randf() * TAU
	if cam:
		var sd := cam.global_basis.inverse() * dir
		if Vector2(sd.x, sd.y).length() > 0.2:
			spin = atan2(sd.y, sd.x)
	mi.set_instance_shader_parameter("spin", spin)
	mi.set_instance_shader_parameter("k", 0.0)
	mi.set_instance_shader_parameter("shade", randf_range(0.8, 1.15))
	mi.visible = true
	_life[i] = [0.0, dur]


func _process(delta: float) -> void:
	for i in POOL:
		var l: Array = _life[i]
		if float(l[1]) <= 0.0:
			continue
		l[0] = float(l[0]) + delta
		var k := float(l[0]) / float(l[1])
		if k >= 1.0:
			l[1] = 0.0
			_quads[i].visible = false
			continue
		_quads[i].set_instance_shader_parameter("k", k)


static func _make_shader() -> Shader:
	if _shader:
		return _shader
	_shader = Shader.new()
	_shader.code = """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_mix, shadows_disabled, fog_disabled;
uniform sampler2D atlas : source_color, filter_linear_mipmap;
instance uniform float k = 0.0;        // 0..1 through the animation
instance uniform float spin = 0.0;     // the way it was thrown, on screen
instance uniform float shade = 1.0;

void vertex() {
	// Turned to the camera, keeping its size, and spun to its throw.
	float s = length(MODEL_MATRIX[0].xyz);
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	float c = cos(spin);
	float si = sin(spin);
	VERTEX.xy = vec2(c * VERTEX.x - si * VERTEX.y, si * VERTEX.x + c * VERTEX.y) * s;
}

void fragment() {
	float f = min(floor(k * 8.0), 7.0);
	float fn = min(f + 1.0, 7.0);
	float blend = fract(k * 8.0);
	vec2 cell = vec2(mod(f, 4.0), floor(f / 4.0));
	vec2 cell2 = vec2(mod(fn, 4.0), floor(fn / 4.0));
	vec4 a = texture(atlas, (UV + cell) / vec2(4.0, 2.0));
	vec4 b = texture(atlas, (UV + cell2) / vec2(4.0, 2.0));
	vec4 t = mix(a, b, blend * 0.6);
	// Deep red, darker where thick, a wet highlight in the core.
	vec3 col = mix(vec3(0.16, 0.0, 0.005), vec3(0.45, 0.02, 0.015), t.r * 0.6) * shade;
	col += vec3(0.25, 0.08, 0.06) * t.g;
	ALBEDO = col;
	ALPHA = t.a;
}
"""
	return _shader


## The eight frames, drawn into one texture: alpha the blood, red channel
## how thin it is (lighter), green a wet glint.
static func _build_atlas() -> void:
	if _atlas:
		return
	var img := Image.create(CELL * FRAMES.x, CELL * FRAMES.y, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var rng := RandomNumberGenerator.new()
	rng.seed = 77
	# The drops: where each flies (mostly forward, along +x, the throw) and
	# how big it is.
	var drops := []
	for i in 34:
		var ang := rng.randfn(0.0, 0.75) if i < 24 else rng.randf_range(-PI, PI)
		drops.append([ang, rng.randf_range(0.45, 1.0) * (1.0 if i < 24 else 0.55), rng.randf_range(0.6, 1.4)])
	var count := FRAMES.x * FRAMES.y
	for f in count:
		var t := float(f) / float(count - 1)
		var ox := (f % FRAMES.x) * CELL
		var oy := (f / FRAMES.x) * CELL
		var c := Vector2(CELL * 0.38, CELL * 0.5)          # (the core off-centre: the throw has room)
		var out := 1.0 - pow(1.0 - t, 2.2)                 # fast out, slowing
		# The core: a ragged blob that bursts, then breaks up and thins.
		var core_r := CELL * (0.09 + 0.12 * sqrt(t)) * (1.0 - 0.5 * smoothstep(0.55, 1.0, t))
		var core_a := 1.0 - smoothstep(0.35, 1.0, t)
		for k in 9:
			var a := TAU * k / 9.0 + rng.randf() * 0.4
			var off := Vector2(cos(a), sin(a)) * core_r * rng.randf_range(0.2, 0.55)
			_disc(img, ox, oy, c + off, core_r * rng.randf_range(0.45, 0.75), core_a, 0.15, 0.4 * (1.0 - t))
		# The drops: a streak from the core early on, a round drop at the end
		# of it later; small ones fade first.
		for d in drops:
			var dirv := Vector2(cos(float(d[0])), sin(float(d[0])))
			var reach := CELL * 0.6 * float(d[1]) * out
			var r := CELL * 0.022 * float(d[2]) * (1.0 - 0.55 * t)
			var alpha := 1.0 - smoothstep(0.55 + 0.35 * float(d[2]) / 1.4, 1.0, t)
			if alpha <= 0.0 or r < 0.6:
				continue
			var tail := clampf(0.55 - t, 0.0, 0.55)
			var steps := 6
			for s in steps + 1:
				var u := float(s) / steps
				var along := reach * lerpf(1.0 - tail, 1.0, u)
				_disc(img, ox, oy, c + dirv * along, r * lerpf(0.45, 1.0, u), alpha * lerpf(0.5, 1.0, u), 0.55 * t, 0.0)
	img.generate_mipmaps()
	_atlas = ImageTexture.create_from_image(img)


## A soft disc into frame (ox, oy): alpha kept at the most of what is there.
static func _disc(img: Image, ox: int, oy: int, c: Vector2, r: float, a: float, thin: float, glint: float) -> void:
	var x0 := maxi(int(c.x - r - 1.0), 0)
	var x1 := mini(int(c.x + r + 1.0), CELL - 1)
	var y0 := maxi(int(c.y - r - 1.0), 0)
	var y1 := mini(int(c.y + r + 1.0), CELL - 1)
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			var d := Vector2(x + 0.5, y + 0.5).distance_to(c) / maxf(r, 0.001)
			if d > 1.0:
				continue
			var v := clampf((1.0 - d) * 3.0, 0.0, 1.0) * a
			var px := img.get_pixel(ox + x, oy + y)
			if v > px.a:
				var g := glint * clampf(1.0 - d * 2.5, 0.0, 1.0)
				img.set_pixel(ox + x, oy + y, Color(maxf(px.r, thin), maxf(px.g, g), 0.0, v))
