// Clothes on a person (humanoid.gd): fabric with a fine weave, that can be
// torn - up to four holes per piece (instance uniforms: xyz where in the
// piece's own space, w how big). Inside a hole the skin shows, with the
// wound darker in the middle; round it the cloth is frayed and darkened.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

#include "res://shaders/body_blood.gdshaderinc"

uniform vec3 albedo : source_color = vec3(0.5);
uniform vec3 skin : source_color = vec3(0.8, 0.62, 0.5);
uniform float rough = 0.9;
uniform sampler2D weave : hint_default_white, filter_linear_mipmap, repeat_enable;
instance uniform vec4 hole0 = vec4(0.0);
instance uniform vec4 hole1 = vec4(0.0);
instance uniform vec4 hole2 = vec4(0.0);
instance uniform vec4 hole3 = vec4(0.0);

varying vec3 lp;
varying vec3 ln;

float fray(vec3 p) {
	return sin(p.x * 173.0 + p.y * 61.0) * sin(p.y * 151.0 - p.z * 97.0) * sin(p.z * 127.0 + p.x * 83.0);
}

// 0 outside, 1 in the hole; `rim` set to how close to its edge.
float hole(vec4 h, vec3 p, inout float rim, inout float wound) {
	if (h.w <= 0.0) {
		return 0.0;
	}
	float r = h.w * (0.85 + 0.25 * fray(p));
	float d = distance(p, h.xyz);
	rim = max(rim, smoothstep(r * 1.45, r, d) * step(r, d));
	wound = max(wound, smoothstep(h.w * 0.45, h.w * 0.15, d));
	return step(d, r);
}

void vertex() {
	lp = VERTEX;
	ln = NORMAL;
	v_rest = body_rest_pos(VERTEX);
}

void fragment() {
	// The weave, laid on from three sides (the pieces have no good UVs).
	vec3 bw = abs(ln);
	bw /= (bw.x + bw.y + bw.z);
	float w = texture(weave, lp.yz * 9.0).r * bw.x + texture(weave, lp.xz * 9.0).r * bw.y + texture(weave, lp.xy * 9.0).r * bw.z;
	vec3 col = albedo * (0.86 + 0.28 * w);
	float r = rough;
	float rim = 0.0;
	float wound = 0.0;
	float inside = max(max(hole(hole0, lp, rim, wound), hole(hole1, lp, rim, wound)),
			max(hole(hole2, lp, rim, wound), hole(hole3, lp, rim, wound)));
	// Frayed, dirtied edges round a tear.
	col *= 1.0 - rim * 0.55;
	if (inside > 0.5) {
		col = mix(skin * 0.9, vec3(0.22, 0.02, 0.02), wound);
		r = mix(0.55, 0.3, wound);
	}
	float spec = 0.4;
	body_blood(v_rest, col, r, spec);
	ALBEDO = col;
	ROUGHNESS = r;
	SPECULAR = spec;
}
