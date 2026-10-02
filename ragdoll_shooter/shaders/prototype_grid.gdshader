// Материал уровня: сетка-прототип + кровь, которая стекает и засыхает.
// Пятна приходят из BloodWalls (глобальная текстура blood_splats).
shader_type spatial;

#include "res://shaders/grid.gdshaderinc"

global uniform sampler2D blood_splats : filter_nearest;
global uniform int blood_count;
global uniform float blood_time;

uniform vec4 base_color : source_color = vec4(0.5, 0.5, 0.5, 1.0);
uniform float roughness = 0.85;

varying vec3 world_pos;
varying vec3 world_nrm;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_nrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

float hash(float n) { return fract(sin(n) * 43758.5453); }

// Подтёки: uv в единицах радиуса пятна, y растёт вниз по стене.
float drips(vec2 uv, float age, float seed) {
	float m = 0.0;
	for (int i = 0; i < 5; i++) {
		float fi = float(i);
		float h1 = hash(seed + fi * 7.13);
		float h2 = hash(seed + fi * 3.71 + 1.0);
		float h3 = hash(seed + fi * 11.3 + 2.0);
		float cx = (h1 - 0.5) * 1.3;                 // где по ширине кляксы начинается струйка
		float w = mix(0.035, 0.10, h2);              // толщина
		float maxlen = mix(0.6, 4.5, h3 * h3);       // насколько далеко стечёт
		float len = maxlen * (1.0 - exp(-age * mix(0.25, 1.0, h2) / maxlen));  // ползёт и замедляется
		float y = uv.y;
		if (y < 0.0 || y > len + w * 1.5) continue;
		float taper = mix(1.0, 0.55, clamp(y / max(len, 0.001), 0.0, 1.0));
		float dx = abs(uv.x - cx);
		float body = (1.0 - smoothstep(w * taper * 0.75, w * taper, dx)) * step(y, len);
		float tip = 1.0 - smoothstep(w * 0.85, w * 1.2, length(vec2(uv.x - cx, y - len)));  // капля на конце
		m = max(m, max(body, tip));
	}
	return m;
}

void fragment() {
	vec3 base = proto_grid(world_pos, world_nrm, base_color.rgb);
	float blood = 0.0;
	float dry = 1.0;

	for (int i = 0; i < blood_count; i++) {
		vec4 a = texelFetch(blood_splats, ivec2(i, 0), 0);   // xyz = позиция, w = радиус
		vec4 b = texelFetch(blood_splats, ivec2(i, 1), 0);   // xyz = нормаль, w = время
		vec3 d = world_pos - a.xyz;
		float r = a.w;
		if (r <= 0.0 || dot(d, d) > r * r * 36.0) continue;                         // далеко
		if (abs(dot(d, b.xyz)) > 0.12 || dot(world_nrm, b.xyz) < 0.6) continue;    // другая поверхность

		float age = max(blood_time - b.w, 0.0);
		vec3 g = vec3(0.0, -1.0, 0.0);
		vec3 down = g - b.xyz * dot(g, b.xyz);   // «вниз» вдоль стены
		float dl = length(down);
		vec3 t_down = dl > 0.2 ? down / dl : normalize(cross(b.xyz, vec3(1.0, 0.0, 0.0)));
		vec3 t_side = normalize(cross(b.xyz, t_down));
		vec2 uv = vec2(dot(d, t_side), dot(d, t_down)) / r;

		float seed = b.w * 13.7 + float(i) * 1.618;
		float ang = atan(uv.y, uv.x);
		float edge = 1.0 + 0.16 * sin(ang * 3.0 + seed) + 0.10 * sin(ang * 7.0 + seed * 2.0)
				+ 0.06 * sin(ang * 13.0 + seed * 3.0);
		edge *= 0.65 + 0.35 * (1.0 - exp(-age * 4.0));   // клякса чуть растекается
		float m = 1.0 - smoothstep(edge - 0.08, edge, length(uv));
		// Мелкие брызги вокруг кляксы.
		vec2 cellp = floor(uv * 3.0);
		float hs = hash(dot(cellp, vec2(12.9898, 78.233)) + seed);
		vec2 dp = fract(uv * 3.0) - 0.5 - (vec2(hs, hash(hs * 91.0)) - 0.5) * 0.6;
		float spray = (1.0 - smoothstep(0.05, 0.09, length(dp))) * step(0.72, hs) * step(length(uv), 2.3);
		m = max(m, spray);
		if (dl > 0.2) m = max(m, drips(uv, age, seed));  // на полу без подтёков

		if (m > 0.01) dry = min(dry, smoothstep(4.0, 90.0, age));
		blood = max(blood, m);
	}

	vec3 blood_col = mix(vec3(0.36, 0.012, 0.012), vec3(0.12, 0.03, 0.02), dry);  // свежая → засохшая
	ALBEDO = mix(base, blood_col, blood);
	ROUGHNESS = mix(roughness, mix(0.06, 0.55, dry), blood);                     // мокрая блестит
	SPECULAR = mix(0.5, 0.6, blood);
}
