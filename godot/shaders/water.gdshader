// Standing rain water for flat puddle patches indoors.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, specular_schlick_ggx;

#include "res://shaders/blood.gdshaderinc"

uniform vec3 tint : source_color = vec3(0.045, 0.05, 0.045);
uniform sampler2D tex_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D tex_edge : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float seed = 0.0;
uniform float fill = 1.0;        // how much water is left (dries to 0)
uniform float clarity = 0.6;     // how clear it is: the floor shows through

void fragment() {
	vec2 wuv = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xz;
	vec3 n1 = texture(tex_normal, wuv * 0.5 + vec2(TIME * 0.006, 0.0)).xyz;
	vec3 n2 = texture(tex_normal, wuv * 0.37 - vec2(0.0, TIME * 0.005)).xyz;
	float edge = texture(tex_edge, UV * 0.6 + seed).r;
	// Drying, it shrinks into the lowest part; a dark damp ring is left
	// where it was.
	float r = (length(UV - 0.5) * 2.0 + (edge - 0.5) * 0.55) / max(fill, 0.05);
	vec3 alb = tint;
	vec3 wpos = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz - vec3(0.0, 0.004, 0.0);   // the floor under the water
	blood_water(wpos, 1.0, edge, alb);
	float water = 1.0 - smoothstep(0.7, 0.95, r);
	float ring = (1.0 - smoothstep(0.7, 0.95, r * max(fill, 0.05))) * (1.0 - water);
	ALBEDO = mix(vec3(0.0), alb, water);
	ROUGHNESS = mix(0.45, 0.03, water);
	SPECULAR = mix(0.3, 0.6, water);
	NORMAL_MAP = mix(vec3(0.5, 0.5, 1.0), (n1 + n2) * 0.5, 0.12 * water);
	ALPHA = water * mix(0.92, 0.5, clarity) + ring * 0.22 * step(0.02, fill);
}
