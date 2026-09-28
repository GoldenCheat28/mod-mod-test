// Standing rain water for flat puddle patches indoors.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, specular_schlick_ggx;

uniform vec3 tint : source_color = vec3(0.045, 0.05, 0.045);
uniform sampler2D tex_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D tex_edge : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float seed = 0.0;

void fragment() {
	vec2 wuv = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xz;
	vec3 n1 = texture(tex_normal, wuv * 0.5 + vec2(TIME * 0.006, 0.0)).xyz;
	vec3 n2 = texture(tex_normal, wuv * 0.37 - vec2(0.0, TIME * 0.005)).xyz;
	float edge = texture(tex_edge, UV * 0.6 + seed).r;
	float r = length(UV - 0.5) * 2.0 + (edge - 0.5) * 0.55;
	ALBEDO = tint;
	ROUGHNESS = 0.03;
	SPECULAR = 0.6;
	NORMAL_MAP = mix(vec3(0.5, 0.5, 1.0), (n1 + n2) * 0.5, 0.12);
	ALPHA = (1.0 - smoothstep(0.7, 0.95, r)) * 0.92;
}
