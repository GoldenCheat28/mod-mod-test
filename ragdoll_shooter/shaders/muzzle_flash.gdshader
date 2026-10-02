// Вспышка выстрела: процедурная «звезда», каждый выстрел новый seed.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;

uniform float seed = 0.0;
uniform float intensity = 1.0;
uniform float stretch = 1.0;   // >1 для боковых языков пламени

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	p.y /= stretch;
	float r = length(p);
	float a = atan(p.y, p.x);
	float spikes = 0.55 + 0.45 * sin(a * 5.0 + seed * 6.28) * sin(a * 3.0 + seed * 17.0);
	float shape = 1.0 - smoothstep(0.0, 0.25 + spikes * 0.75, r);
	float core = 1.0 - smoothstep(0.0, 0.3, r);
	vec3 col = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.88, 0.65), core);
	float v = clamp(shape * shape + core, 0.0, 1.0) * intensity;
	ALBEDO = col * v * 4.0;
	ALPHA = v;
}
