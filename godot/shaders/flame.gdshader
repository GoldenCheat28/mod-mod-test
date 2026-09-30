// A tongue of flame on a particle (fire.gd): turned to face the eye, its
// shape eaten away by noise that runs up it, hot white-yellow at the root
// going orange and red towards the licking tip, each one flickering on its
// own. Drawn additively - it lights what is behind it, it does not cover it.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled, skip_vertex_transform;

uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;
uniform float intensity = 0.8;
uniform float heat = 1.0;        // 1: a good fire; lower for a dying one

varying float v_age;
varying float v_seed;

void vertex() {
	// Face the eye, keeping the particle's own size; stood upright.
	float sx = length(MODEL_MATRIX[0].xyz);
	float sy = length(MODEL_MATRIX[1].xyz);
	vec3 right = normalize(INV_VIEW_MATRIX[0].xyz);
	vec3 up = vec3(0.0, 1.0, 0.0);
	vec3 world = MODEL_MATRIX[3].xyz + right * VERTEX.x * sx + up * VERTEX.y * sy;
	VERTEX = (VIEW_MATRIX * vec4(world, 1.0)).xyz;
	v_age = INSTANCE_CUSTOM.y;          // 0 new .. 1 about to go
	v_seed = INSTANCE_CUSTOM.x;
}

void fragment() {
	vec2 uv = UV;
	float y = 1.0 - uv.y;               // 0 at the root, 1 at the top
	float t = TIME * 1.6 + v_seed * 37.0;
	// Two layers of noise running up, the finer one faster: the licking.
	float n1 = texture(noise_tex, vec2(uv.x * 0.7 + v_seed, uv.y * 0.6 + t * 0.55)).r;
	float n2 = texture(noise_tex, vec2(uv.x * 1.6 - v_seed, uv.y * 1.3 + t * 1.2)).r;
	float n = n1 * 0.65 + n2 * 0.35;
	// The tongue: wide at the root, narrowing up; the noise bites its edge,
	// more so the higher it goes.
	float x = abs(uv.x - 0.5) * 2.0;
	// (rounded at the root too: no flat cut where the quad ends)
	float width = mix(1.0, 0.3, pow(y, 0.9)) * mix(0.55, 1.0, smoothstep(0.0, 0.3, y));
	float edge = width + (n - 0.5) * (0.5 + 0.7 * y);
	float shape = 1.0 - smoothstep(edge - 0.45, edge, x);
	// It thins out and breaks up towards the top, and as the particle ages.
	float top = 1.0 - smoothstep(0.4, 1.0, y + (n - 0.5) * 0.7 + v_age * 0.35);
	float root = smoothstep(0.02, 0.25, y + (n - 0.5) * 0.15);
	float a = clamp(shape * top * root, 0.0, 1.0);
	float fade = (1.0 - smoothstep(0.55, 1.0, v_age)) * smoothstep(0.0, 0.08, v_age);
	a *= fade;
	// Colour by how hot this bit is: the root and the middle hottest.
	float h = clamp((1.0 - y) * 0.8 * shape - v_age * 0.4 + (n - 0.5) * 0.35, 0.0, 1.0) * heat;
	vec3 c = mix(vec3(0.55, 0.06, 0.01), vec3(1.0, 0.32, 0.03), smoothstep(0.05, 0.4, h));
	c = mix(c, vec3(1.0, 0.72, 0.25), smoothstep(0.4, 0.75, h));
	c = mix(c, vec3(1.0, 0.9, 0.65), smoothstep(0.88, 1.0, h));
	ALBEDO = c * intensity * a;
	ALPHA = a;
}
