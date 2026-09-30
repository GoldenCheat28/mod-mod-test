extends RefCounted
## Green coming back into the place: tufts of grass where the asphalt meets a
## wall or a kerb and in patches of broken ground (one MultiMesh of crossed
## blades, swaying in the wind, fading out with distance), and moss on the
## damp feet of the walls and under the windows (decals).

const TUFT_SHADER := """
shader_type spatial;
render_mode cull_disabled, depth_draw_opaque;

uniform sampler2D blades : source_color, filter_linear_mipmap, repeat_disable;
uniform float t = 0.0;

varying float tip;

void vertex() {
	tip = UV.y < 0.5 ? 1.0 - UV.y * 2.0 : 0.0;
	tip = 1.0 - UV.y;
	vec3 wp = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float sway = sin(TIME * 1.7 + wp.x * 0.7 + wp.z * 0.5) * 0.5 + sin(TIME * 3.1 + wp.x * 1.3) * 0.2;
	VERTEX.x += sway * 0.05 * tip * tip;
	VERTEX.z += sway * 0.03 * tip * tip;
}

void fragment() {
	vec4 c = texture(blades, UV);
	if (c.a < 0.5) {
		discard;
	}
	ALBEDO = c.rgb * mix(0.4, 1.0, tip * tip) * COLOR.rgb;
	ROUGHNESS = 0.85;
	SPECULAR = 0.2;
	BACKLIGHT = vec3(0.15, 0.2, 0.05);
}
"""

static var _blade_tex: ImageTexture
static var _moss_tex: Array = []


static func build(mb: Node3D, rng: RandomNumberGenerator) -> void:
	var space: PhysicsDirectSpaceState3D = mb.get_world_3d().direct_space_state
	var spots: Array = []            # tufts: [position, normal, scale, tint]
	var soil: Array = []             # dirt under them: [position, normal, along, width, length, dark]
	# Grass does not grow out of sound concrete: it grows where dirt has
	# gathered - in the corner at the foot of a wall or a kerb, in the cracks
	# of the asphalt, in the broken patches - and not under a roof.
	var tries := 0
	while spots.size() < 1500 and tries < 9000:
		tries += 1
		var p := Vector3(rng.randf_range(-35.0, 35.0), 12.0, rng.randf_range(-35.0, 35.0))
		var q := PhysicsRayQueryParameters3D.create(p, p + Vector3.DOWN * 14.0, Game.LAYER_WORLD)
		var hit := space.intersect_ray(q)
		if hit.is_empty() or (hit.normal as Vector3).y < 0.85:
			continue
		var g: Vector3 = hit.position
		if g.y > 1.5:
			continue                 # roofs and the first floor: not here
		var up_q := PhysicsRayQueryParameters3D.create(g + Vector3.UP * 0.2, g + Vector3.UP * 12.0, Game.LAYER_WORLD)
		if not space.intersect_ray(up_q).is_empty():
			continue                 # under a roof: no light, no rain
		var wall_dir := Vector3.ZERO
		for k in 8:
			var d := Vector3(cos(TAU * k / 8.0), 0.0, sin(TAU * k / 8.0))
			var eq := PhysicsRayQueryParameters3D.create(g + Vector3.UP * 0.08, g + Vector3.UP * 0.08 + d * 0.5, Game.LAYER_WORLD)
			var eh := space.intersect_ray(eq)
			if not eh.is_empty():
				wall_dir = d
				g = (eh.position as Vector3) - d * rng.randf_range(0.08, 0.2)
				g.y = hit.position.y
				break
		var n: Vector3 = hit.normal
		if wall_dir != Vector3.ZERO:
			# Along the foot of the wall: a strip of dirt, grass thick in it.
			var along := wall_dir.cross(Vector3.UP).normalized()
			var len := rng.randf_range(0.8, 2.2)
			soil.append([g - wall_dir * 0.05, n, along, rng.randf_range(0.35, 0.55), len, rng.randf_range(0.7, 1.0)])
			var count := int(len * rng.randf_range(5.0, 8.0))
			for c in count:
				var u := rng.randf_range(-0.5, 0.5)
				var o := g + along * u * len - wall_dir * rng.randf_range(0.0, 0.18)
				var mid := 1.0 - absf(u) * 1.4       # tall in the middle of the strip, short at its ends
				spots.append([o, n, rng.randf_range(0.5, 1.1) * maxf(mid, 0.35), _tint(rng)])
		elif _patchy(g) > 0.66:
			if rng.randf() < 0.5:
				# A crack across the asphalt, grass along it.
				var dir := Vector3(cos(rng.randf() * TAU), 0.0, 0.0)
				dir.z = sqrt(1.0 - dir.x * dir.x) * (1.0 if rng.randf() < 0.5 else -1.0)
				var at := g
				for s in rng.randi_range(6, 14):
					dir = (dir + Vector3(rng.randf_range(-0.5, 0.5), 0.0, rng.randf_range(-0.5, 0.5))).normalized()
					var nxt := at + dir * rng.randf_range(0.18, 0.3)
					soil.append([(at + nxt) * 0.5, n, dir, rng.randf_range(0.05, 0.1), at.distance_to(nxt) + 0.06, 1.0])
					if rng.randf() < 0.55:
						spots.append([nxt, n, rng.randf_range(0.3, 0.65), _tint(rng)])
					at = nxt
			else:
				# A broken patch: the surface gone, earth showing, a thick clump.
				var r := rng.randf_range(0.35, 0.8)
				soil.append([g, n, Vector3.RIGHT.rotated(Vector3.UP, rng.randf() * TAU), r * 2.0, r * 2.0 * rng.randf_range(0.7, 1.2), rng.randf_range(0.6, 0.9)])
				for c in int(r * rng.randf_range(14.0, 22.0)):
					var a := rng.randf() * TAU
					var rr := sqrt(rng.randf()) * r * 0.8
					spots.append([g + Vector3(cos(a), 0, sin(a)) * rr, n, rng.randf_range(0.6, 1.3) * (1.0 - rr / r * 0.5), _tint(rng)])
	_soil(mb, soil)
	_tufts(mb, spots, rng)
	_moss(mb, space, rng)


static func _tint(rng: RandomNumberGenerator) -> Color:
	# Mostly green, some yellowed, a few dead and straw-coloured.
	var r := rng.randf()
	if r < 0.12:
		return Color(1.25, 1.1, 0.55)
	return Color(0.8, 0.95, 0.75).lerp(Color(1.0, 0.95, 0.6), rng.randf() * 0.6)


const SOIL_SHADER := """
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled;

varying vec3 wp;
varying float dark;

float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	dark = COLOR.r;
}

void fragment() {
	// Earth: dark, damp, grit and small stones in it; the edge ragged.
	vec2 c = UV * 2.0 - 1.0;
	float d = length(c * vec2(1.0, 1.0));
	float n = noise(wp.xz * 9.0) * 0.6 + noise(wp.xz * 31.0) * 0.4;
	float edge = 1.0 - smoothstep(0.55, 1.0, d + (n - 0.5) * 0.55);
	if (edge < 0.02) {
		discard;
	}
	float grit = noise(wp.xz * 80.0);
	vec3 col = mix(vec3(0.075, 0.062, 0.045), vec3(0.14, 0.12, 0.09), n);
	col = mix(col, vec3(0.3, 0.29, 0.26), step(0.86, grit) * 0.6);
	ALBEDO = col * mix(1.15, 0.8, dark);
	ALPHA = edge * 0.92;
	ROUGHNESS = 0.95;
	SPECULAR = 0.2;
}
"""


## The dirt the grass grows in: flat ragged patches laid on the ground, one
## MultiMesh for all of them.
static func _soil(mb: Node3D, soil: Array) -> void:
	if soil.is_empty():
		return
	var quad := PlaneMesh.new()
	quad.size = Vector2.ONE
	var mat := ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = SOIL_SHADER
	mat.shader = sh
	quad.material = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = quad
	mm.instance_count = soil.size()
	for i in soil.size():
		var s: Array = soil[i]
		var n: Vector3 = (s[1] as Vector3).normalized()
		var along: Vector3 = (s[2] as Vector3)
		along = (along - n * along.dot(n)).normalized()
		var side := n.cross(along)
		# (plane mesh: x across, z along; a hair above the ground)
		var b := Basis(side * float(s[3]), n, along * float(s[4]))
		mm.set_instance_transform(i, Transform3D(b, (s[0] as Vector3) + n * (0.006 + 0.0005 * (i % 7))))
		mm.set_instance_color(i, Color(float(s[5]), 0, 0))
	var mi := MultiMeshInstance3D.new()
	mi.name = "Soil"
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visibility_range_end = 50.0
	mb.add_child(mi)


static func _patchy(p: Vector3) -> float:
	return 0.5 + 0.35 * sin(p.x * 0.31 + 1.7) * cos(p.z * 0.27 - 0.4) + 0.15 * sin(p.x * 1.3 + p.z * 0.9)


static func _tufts(mb: Node3D, spots: Array, rng: RandomNumberGenerator) -> void:
	# One tuft: three crossed quads of blades.
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in 3:
		var a := PI * k / 3.0
		var dx := Vector3(cos(a), 0.0, sin(a)) * 0.16
		var h := 0.26
		var n := Vector3(-sin(a), 0.0, cos(a))
		var v := [-dx, dx, dx + Vector3.UP * h, -dx + Vector3.UP * h]
		var uv := [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
		for idx in [0, 1, 2, 0, 2, 3]:
			st.set_normal(n.lerp(Vector3.UP, 0.6).normalized())
			st.set_uv(uv[idx])
			st.add_vertex(v[idx])
	var mesh := st.commit()
	var mat := ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = TUFT_SHADER
	mat.shader = sh
	mat.set_shader_parameter("blades", _blades())
	mesh.surface_set_material(0, mat)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh
	mm.instance_count = spots.size()
	for i in spots.size():
		var s: Array = spots[i]
		var up: Vector3 = s[1]
		var b := Basis(Vector3.UP, rng.randf() * TAU)
		b = Basis(Quaternion(Vector3.UP, up.normalized())) * b
		mm.set_instance_transform(i, Transform3D(b.scaled(Vector3.ONE * float(s[2])), s[0]))
		mm.set_instance_color(i, s[3])
	var mi := MultiMeshInstance3D.new()
	mi.name = "Grass"
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visibility_range_end = 45.0
	mi.visibility_range_end_margin = 8.0
	mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	mb.add_child(mi)


## A little texture of grass blades (green, yellowed at the tips, cut out).
static func _blades() -> ImageTexture:
	if _blade_tex:
		return _blade_tex
	var w := 64
	var h := 64
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var rng := RandomNumberGenerator.new()
	rng.seed = 4
	for b in 34:
		var x0 := rng.randf_range(4, w - 4)
		var lean := rng.randf_range(-10, 10)
		var len := rng.randf_range(0.45, 1.0) * h
		var base_w := rng.randf_range(1.0, 2.4)
		var col := Color(0.22, 0.35, 0.12).lerp(Color(0.35, 0.42, 0.15), rng.randf())
		for yi in int(len):
			var k := yi / len
			var x := x0 + lean * k * k
			var half := base_w * (1.0 - k)
			for xi in range(int(x - half), int(x + half) + 1):
				if xi >= 0 and xi < w:
					var c := col.lerp(Color(0.55, 0.52, 0.25), k * k * 0.7)
					img.set_pixel(xi, h - 1 - yi, Color(c.r, c.g, c.b, 1.0))
	img.generate_mipmaps()
	_blade_tex = ImageTexture.create_from_image(img)
	return _blade_tex


## Moss on the walls: along their feet, and in streaks under windows where
## the rain runs down.
static func _moss(mb: Node3D, space: PhysicsDirectSpaceState3D, rng: RandomNumberGenerator) -> void:
	var placed := 0
	var tries := 0
	while placed < 70 and tries < 1500:
		tries += 1
		var p := Vector3(rng.randf_range(-34.0, 34.0), rng.randf_range(0.2, 1.2), rng.randf_range(-34.0, 34.0))
		var d := Vector3(cos(rng.randf() * TAU), 0.0, 0.0)
		d.z = sqrt(maxf(1.0 - d.x * d.x, 0.0)) * (1.0 if rng.randf() < 0.5 else -1.0)
		var q := PhysicsRayQueryParameters3D.create(p, p + d * 3.0, Game.LAYER_WORLD)
		var hit := space.intersect_ray(q)
		if hit.is_empty() or absf((hit.normal as Vector3).y) > 0.2:
			continue
		var n: Vector3 = hit.normal
		var at: Vector3 = hit.position
		# Down to the foot of the wall.
		var gq := PhysicsRayQueryParameters3D.create(at + n * 0.1, at + n * 0.1 + Vector3.DOWN * 3.0, Game.LAYER_WORLD)
		var gh := space.intersect_ray(gq)
		if gh.is_empty():
			continue
		var foot: float = gh.position.y
		var tall := rng.randf_range(0.4, 1.3)
		var wide := rng.randf_range(0.8, 2.2)
		var dcl := Decal.new()
		dcl.texture_albedo = _moss_texture(placed % 4)
		var right := Vector3.UP.cross(n).normalized()
		dcl.basis = Basis(right, n, right.cross(n))
		dcl.position = Vector3(at.x, foot + tall * 0.45, at.z)
		dcl.size = Vector3(wide, 0.5, tall)
		dcl.cull_mask = 1
		dcl.upper_fade = 0.3
		dcl.lower_fade = 0.3
		dcl.normal_fade = 0.3
		dcl.distance_fade_enabled = true
		dcl.distance_fade_begin = 30.0
		dcl.distance_fade_length = 10.0
		mb.add_child(dcl)
		placed += 1


## Mossy green blotches, thickest at the bottom edge, thinning upwards.
static func _moss_texture(v: int) -> ImageTexture:
	while _moss_tex.size() <= v:
		var i := _moss_tex.size()
		var size := 128
		var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
		var n := FastNoiseLite.new()
		n.seed = 300 + i
		n.frequency = 0.05
		n.fractal_octaves = 4
		var n2 := FastNoiseLite.new()
		n2.seed = 900 + i
		n2.frequency = 0.2
		for y in size:
			for x in size:
				var up := float(y) / size          # 0 top .. 1 bottom (decal "down" is the wall foot)
				var blot := n.get_noise_2d(x, y) * 0.5 + 0.5
				var fine := n2.get_noise_2d(x, y) * 0.5 + 0.5
				var edge := smoothstep(0.0, 0.2, float(x) / size) * smoothstep(0.0, 0.2, 1.0 - float(x) / size)
				var a := clampf((blot * 1.3 - 0.55 + up * 0.55) * edge, 0.0, 1.0) * (0.6 + 0.4 * fine)
				var c := Color(0.16, 0.24, 0.08).lerp(Color(0.3, 0.36, 0.12), fine)
				img.set_pixel(x, y, Color(c.r, c.g, c.b, a * 0.9))
		img.generate_mipmaps()
		_moss_tex.append(ImageTexture.create_from_image(img))
	return _moss_tex[v]
