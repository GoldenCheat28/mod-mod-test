// Old street asphalt: aggregate, repair patches, cracks and puddles that
// collect in the low spots of the (slightly uneven) ground mesh.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

#include "res://shaders/triplanar.gdshaderinc"
#include "res://shaders/blood.gdshaderinc"
#include "res://shaders/hallu.gdshaderinc"

uniform vec3 base_color : source_color = vec3(0.16, 0.16, 0.155);
uniform float puddle_level = -0.014;
uniform float normal_strength = 1.3;
uniform sampler2D tex_detail : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform sampler2D tex_large : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform sampler2D tex_cells : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform sampler2D tex_normal : hint_normal, filter_linear_mipmap, repeat_enable;

varying vec3 v_wpos;
varying vec3 v_wnrm;

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	VERTEX += hallu_bend(v_wpos, v_wnrm, TIME);
}

void fragment() {
	vec2 uv = v_wpos.xz + hallu_flow(v_wpos, TIME).xz;
	float d = texture(tex_detail, uv * 1.1).r;
	float fine = texture(tex_detail, uv * 6.0).r;
	float large = texture(tex_large, uv * 0.05).r;
	float cells = texture(tex_cells, uv * 0.08).r;
	float crack_mask = smoothstep(0.48, 0.62, texture(tex_large, uv * 0.11 + vec2(7.3, 1.9)).r);
	float crack = (1.0 - smoothstep(0.0, 0.03, cells)) * crack_mask;

	vec3 col = base_color * (0.72 + 0.5 * d) * (0.85 + 0.3 * large);
	col = mix(col, vec3(0.40, 0.39, 0.37), smoothstep(0.72, 0.8, fine) * 0.55);
	col = mix(col, col * 0.68, smoothstep(0.62, 0.66, large) * 0.8);
	col = mix(col, vec3(0.30, 0.27, 0.22), smoothstep(0.35, 0.2, large) * 0.35);
	col = mix(col, vec3(0.03), crack * 0.85);

	float h = v_wpos.y + (d - 0.5) * 0.004;
	float wet = 1.0 - smoothstep(puddle_level - 0.003, puddle_level + 0.003, h);
	float damp = 1.0 - smoothstep(puddle_level, puddle_level + 0.018, h);
	col *= mix(1.0, 0.55, damp);

	vec3 n = normalize(v_wnrm);
	vec3 wn = tp_normal(tex_normal, vec3(uv.x, 0.0, uv.y) * 1.1, n, vec3(0.0, 1.0, 0.0),
			normal_strength * (1.0 - wet) * (1.0 + crack));
	vec3 alb = mix(col, col * 0.3 + vec3(0.01, 0.012, 0.014), wet);
	float rough = mix(mix(0.9, 0.5, damp), 0.03, wet);
	float spec = mix(0.4, 0.6, wet);
	vec3 nv = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);
	blood_water(v_wpos, wet, fine, alb);
	blood_apply_wet(v_wpos, n, fine, VERTEX, NORMAL, smoothstep(0.2, 0.8, wet), alb, rough, spec, nv);
	ALBEDO = alb;
	ROUGHNESS = rough;
	SPECULAR = spec;
	NORMAL = nv;
}
