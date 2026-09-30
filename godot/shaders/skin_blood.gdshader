// A person's skin (humanoid.gd): the skin colour, a faint mottling, a
// little light through it - and the blood that is on him (body_blood).
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

#include "res://shaders/body_blood.gdshaderinc"

uniform vec3 albedo : source_color = vec3(0.8, 0.62, 0.5);
uniform float rough = 0.58;

varying vec3 lp;

float n3(vec3 p) {
	return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

void vertex() {
	lp = VERTEX;
	v_rest = body_rest_pos(VERTEX);
}

void fragment() {
	vec3 col = albedo * (0.95 + 0.08 * n3(lp * 180.0));
	float r = rough;
	float spec = 0.5;
	body_blood(v_rest, col, r, spec);
	ALBEDO = col;
	ROUGHNESS = r;
	SPECULAR = spec;
	SSS_STRENGTH = 0.25;
}
