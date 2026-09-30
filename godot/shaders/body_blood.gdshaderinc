// Blood on a person's body (scripts/fx/body_blood.gd): a volume laid over
// him in his rest pose. Every piece of his clothes and skin carries where it
// sits in that pose (instance uniforms: the rows of its rest transform), so
// the blood stays on him as he moves. A thin film tints what is under it; a
// thick run covers it, dark and wet, and dries matt and brown with time.

uniform sampler3D blood_vol : filter_linear, repeat_disable;
uniform vec3 vol_min = vec3(0.0);
uniform vec3 vol_size = vec3(1.0);
uniform bool has_blood = false;
global uniform float blood_time;
instance uniform vec4 rest_x = vec4(1.0, 0.0, 0.0, 0.0);
instance uniform vec4 rest_y = vec4(0.0, 1.0, 0.0, 0.0);
instance uniform vec4 rest_z = vec4(0.0, 0.0, 1.0, 0.0);

varying vec3 v_rest;

float bb_hash(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

float bb_noise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(bb_hash(i), bb_hash(i + vec3(1, 0, 0)), f.x), mix(bb_hash(i + vec3(0, 1, 0)), bb_hash(i + vec3(1, 1, 0)), f.x), f.y),
			mix(mix(bb_hash(i + vec3(0, 0, 1)), bb_hash(i + vec3(1, 0, 1)), f.x), mix(bb_hash(i + vec3(0, 1, 1)), bb_hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

vec3 body_rest_pos(vec3 vertex) {
	vec4 v = vec4(vertex, 1.0);
	return vec3(dot(rest_x, v), dot(rest_y, v), dot(rest_z, v));
}

// On what is under it: `albedo`, `rough`, `spec` changed where there is blood.
void body_blood(vec3 rp, inout vec3 albedo, inout float rough, inout float spec) {
	if (!has_blood) {
		return;
	}
	vec3 uvw = (rp - vol_min) / vol_size;
	if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) {
		return;
	}
	vec2 s = texture(blood_vol, uvw).rg;
	// (the edge of the stain wanders a little: cloth takes blood up unevenly)
	float nz = bb_noise(rp * 60.0) * 0.6 + bb_noise(rp * 170.0) * 0.4;
	float amt = s.r + (nz - 0.5) * 0.12 * (1.0 - s.r);
	if (amt < 0.03) {
		return;
	}
	float age = mod(blood_time - s.g * 255.0, 256.0);
	float dry = clamp(age / 140.0, 0.0, 1.0);
	// A film first (the cloth / skin shows through, stained), then solid.
	float film = smoothstep(0.03, 0.3, amt);
	float solid = smoothstep(0.3, 0.7, amt);
	vec3 wet_col = mix(vec3(0.2, 0.012, 0.01), vec3(0.09, 0.004, 0.003), solid);
	vec3 dry_col = mix(vec3(0.12, 0.035, 0.025), vec3(0.05, 0.015, 0.01), solid);
	vec3 bc = mix(wet_col, dry_col, pow(dry, 0.7));
	// Darker where it lies thick and has settled, lighter where it thins out.
	bc *= 0.7 + 0.6 * nz * (0.5 + 0.5 * solid);
	vec3 stained = albedo * mix(vec3(1.0), vec3(0.55, 0.12, 0.1), film);
	albedo = mix(stained, bc, solid * 0.95 + film * 0.25);
	rough = mix(rough, mix(0.12, 0.75, dry), max(film * 0.7, solid));
	spec = mix(spec, 0.55, solid * (1.0 - dry));
}
