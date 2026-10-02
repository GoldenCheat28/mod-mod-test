shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

// Поверхность мира: триплпланарный в мировых координатах (albedo + normal) + кровь из мировых карт.
#include "res://shaders/blood.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float tile = 0.33;       // 1 / метров на повторение
uniform float rough = 0.9;
uniform float metal = 0.0;
uniform float normal_strength = 1.0;

varying vec3 w_pos;
varying vec3 w_nrm;

void vertex() {
	w_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	w_nrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 bw = pow(abs(w_nrm), vec3(8.0));
	bw /= (bw.x + bw.y + bw.z);
	vec3 p = w_pos * tile;
	vec3 col = texture(albedo_tex, p.zy).rgb * bw.x + texture(albedo_tex, p.xz).rgb * bw.y + texture(albedo_tex, p.xy).rgb * bw.z;
	vec2 nx = (texture(normal_tex, p.zy).xy * 2.0 - 1.0) * normal_strength;
	vec2 ny = (texture(normal_tex, p.xz).xy * 2.0 - 1.0) * normal_strength;
	vec2 nz = (texture(normal_tex, p.xy).xy * 2.0 - 1.0) * normal_strength;
	vec3 n_world = normalize(w_nrm + bw.x * vec3(0.0, nx.y, nx.x) + bw.y * vec3(ny.x, 0.0, ny.y) + bw.z * vec3(nz.x, nz.y, 0.0));
	vec3 n_view = normalize((VIEW_MATRIX * vec4(n_world, 0.0)).xyz);
	vec3 geom_view_n = normalize((VIEW_MATRIX * vec4(w_nrm, 0.0)).xyz);
	float roughness = rough;
	float specular = 0.5;
	float detail = blood_noise(w_pos.xz * 23.0 + w_pos.y * 17.0);
	blood_apply(w_pos, normalize(w_nrm), detail, VERTEX, geom_view_n, col, roughness, specular, n_view);
	ALBEDO = col;
	ROUGHNESS = roughness;
	SPECULAR = specular;
	METALLIC = metal;
	NORMAL = n_view;
}
