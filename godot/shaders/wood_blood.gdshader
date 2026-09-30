// Old wood (tables, chairs, benches): grain along the boards, worn, and the
// world's blood on it like on any other surface (shaders/blood.gdshaderinc).
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

#include "res://shaders/triplanar.gdshaderinc"
#include "res://shaders/blood.gdshaderinc"

uniform vec3 base_color : source_color = vec3(0.3, 0.2, 0.12);
uniform float rough = 0.78;
uniform sampler2D tex_detail : hint_default_white, filter_linear_mipmap, repeat_enable;

varying vec3 v_wpos;
varying vec3 v_wnrm;

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 n = normalize(v_wnrm);
	vec3 w = tp_weights(n, 4.0);
	// Grain: stretched noise, rings of darker and lighter wood.
	float g = tp_sample(tex_detail, v_wpos * vec3(0.6, 9.0, 0.6), w).r;
	float fine = tp_sample(tex_detail, v_wpos * 6.0, w).r;
	vec3 col = base_color * (0.8 + 0.35 * g) * (0.9 + 0.2 * fine);
	float r = rough;
	float spec = 0.3;
	vec3 nv = NORMAL;
	blood_apply(v_wpos, n, fine, VERTEX, NORMAL, col, r, spec, nv);
	ALBEDO = col;
	ROUGHNESS = r;
	SPECULAR = spec;
	NORMAL = nv;
}
