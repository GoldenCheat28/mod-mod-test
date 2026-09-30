// The player's own body (player_body.gd): plain cloth / skin, dissolving
// near the camera (dithered), with blood soaked in round each wound - the
// stain spreads with the blood that has come out and runs down the clothes,
// dark and wet, with the hole dark in the middle.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

uniform vec3 albedo : source_color = vec3(0.5);
uniform float rough = 0.9;
uniform float fade_near = 0.1;
uniform float fade_far = 0.3;
// Per wound: xyz = where (world), w = stain radius (0 = none).
uniform vec4 wounds[6];
// Per wound: x = how far it has run down (m), y = 1 if it is an open hole.
uniform vec4 wound_run[6];

varying vec3 wp;

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	// Dithered fade close to the eyes (as the standard material does it).
	float fade = clamp(smoothstep(fade_near, fade_far, length(VERTEX)), 0.0, 1.0);
	const vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
	if (fade < fract(magic.z * fract(dot(FRAGCOORD.xy, magic.xy)))) {
		discard;
	}
	vec3 col = albedo;
	float wet = 0.0;
	float hole = 0.0;
	for (int i = 0; i < 6; i++) {
		vec4 w = wounds[i];
		if (w.w <= 0.0) {
			continue;
		}
		vec3 d = wp - w.xyz;
		// Below the wound the stain reaches further (it has run down).
		float below = max(-d.y, 0.0);
		float run = wound_run[i].x;
		vec3 q = vec3(d.x, d.y + min(below, run) * 1.0, d.z);
		float dist = length(q);
		// A ragged edge.
		float edge = w.w * (0.85 + 0.15 * sin(wp.x * 180.0 + wp.y * 140.0) * sin(wp.z * 160.0 - wp.y * 90.0));
		wet = max(wet, smoothstep(edge, edge * 0.6, dist));
		hole = max(hole, wound_run[i].y * smoothstep(0.011, 0.006, length(d)));
	}
	vec3 blood = mix(vec3(0.16, 0.01, 0.01), vec3(0.08, 0.005, 0.005), wet);
	col = mix(col, blood * (0.6 + 0.4 * albedo / max(max(albedo.r, albedo.g), max(albedo.b, 0.05))), wet * 0.92);
	col = mix(col, vec3(0.03, 0.0, 0.0), hole);
	ALBEDO = col;
	ROUGHNESS = mix(rough, 0.22, wet);
	SPECULAR = mix(0.5, 0.7, wet);
}
