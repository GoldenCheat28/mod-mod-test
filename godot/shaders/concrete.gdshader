// Weathered concrete: rain streaks, damp grime near the street, moss on
// up-facing surfaces, optional paving grooves.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

#include "res://shaders/triplanar.gdshaderinc"
#include "res://shaders/blood.gdshaderinc"

uniform vec3 base_color : source_color = vec3(0.56, 0.55, 0.52);
uniform vec3 dirt_color : source_color = vec3(0.30, 0.27, 0.22);
uniform vec3 moss_color : source_color = vec3(0.19, 0.26, 0.08);
uniform float tex_scale = 1.0;
uniform float moss_amount : hint_range(0.0, 1.0) = 0.5;
uniform float stain_amount : hint_range(0.0, 1.0) = 0.6;
uniform float normal_strength = 1.0;
uniform float tile_size = 0.0;
uniform float ground_level = 0.0;
uniform sampler2D tex_detail : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform sampler2D tex_large : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform sampler2D tex_normal : hint_normal, filter_linear_mipmap, repeat_enable;

varying vec3 v_wpos;
varying vec3 v_wnrm;

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 n = normalize(v_wnrm);
	vec3 w = tp_weights(n, 4.0);
	vec3 p = v_wpos * tex_scale;
	float detail = tp_sample(tex_detail, p * 1.7, w).r;
	float large = tp_sample(tex_large, p * 0.23, w).r;
	float pores = tp_sample(tex_detail, p * 7.0, w).r;

	vec3 col = base_color * (0.78 + 0.34 * detail) * (0.86 + 0.28 * large);
	col *= mix(0.9, 1.05, smoothstep(0.3, 0.7, pores));

	// Rain streaks running down vertical faces.
	float side = 1.0 - abs(n.y);
	float streak = texture(tex_large, vec2((v_wpos.x + v_wpos.z) * 1.3, v_wpos.y * 0.06)).r;
	float stain = smoothstep(0.5, 0.85, streak) * stain_amount * side;
	col = mix(col, col * vec3(0.55, 0.52, 0.47), stain);

	// Grime and damp band near the street level.
	float h = v_wpos.y - ground_level;
	float damp = (1.0 - smoothstep(0.0, 0.9 + large * 0.8, h)) * side;
	col = mix(col, dirt_color * (0.7 + 0.5 * detail), damp * 0.55);

	// Moss grows on up-facing surfaces and in damp corners.
	float moss_mask = smoothstep(0.52, 0.72, large + detail * 0.25);
	float moss = moss_mask * moss_amount * clamp(max(n.y, 0.0) * 0.9 + damp * 0.8, 0.0, 1.0);
	col = mix(col, moss_color * (0.6 + 0.8 * detail), moss);

	if (tile_size > 0.0) {
		vec2 g = abs(fract(v_wpos.xz / tile_size) - 0.5) * 2.0;
		float groove = smoothstep(0.94, 0.985, max(g.x, g.y)) * max(n.y, 0.0);
		col *= 1.0 - groove * 0.45;
	}

	vec3 wn = tp_normal(tex_normal, p * 1.7, n, w, normal_strength * (1.0 + moss * 0.6));
	float rough = clamp(0.93 - damp * 0.25 - moss * 0.05, 0.0, 1.0);
	float spec = 0.35;
	vec3 nv = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);
	blood_apply(v_wpos, n, pores, VERTEX, NORMAL, col, rough, spec, nv);
	ALBEDO = col;
	ROUGHNESS = rough;
	SPECULAR = spec;
	NORMAL = nv;
}
