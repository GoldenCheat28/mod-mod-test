// Volumetric head: vertex colour carries the material colour (linear rgb) and
// how wet/raw it is (a: 0 = dry skin, 1 = freshly exposed inside). Exposed
// tissue gets a blood film, fine structure and gloss.
shader_type spatial;
render_mode diffuse_burley, specular_schlick_ggx;

uniform sampler2D tex_noise : hint_default_white, filter_linear_mipmap, repeat_enable;
// Jelly response to a hit (driven by damped springs in voxel_head.gd):
// the whole head swells with the pressure wave, a temporary cavity bulges
// out along the bullet path, and squash/stretch modes wobble it afterwards.
uniform vec3 jelly_centre = vec3(0.0, 0.005, 0.0);
uniform float swell = 0.0;
uniform vec3 squash = vec3(0.0);
uniform float cavity = 0.0;
uniform vec3 path_a = vec3(0.0);
uniform vec3 path_b = vec3(0.0, 0.0, 0.01);
// The face (drawn here so it can move): eyes, brows and mouth on the skin,
// shaped by how angry / afraid he is (humanoid._update_face).
uniform bool face_on = false;
uniform float head_scale = 1.0;
uniform float anger = 0.0;
uniform float fear = 0.0;
uniform float dead = 0.0;
uniform float sad = 0.0;
uniform float pain = 0.0;

varying vec3 v_pos;
varying float v_wet;

void vertex() {
	v_pos = VERTEX;
	v_wet = COLOR.a;
	vec3 r = VERTEX - jelly_centre;
	vec3 disp = r * swell + r * squash;
	vec3 ab = path_b - path_a;
	float t = clamp(dot(VERTEX - path_a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
	vec3 q = VERTEX - (path_a + ab * t);
	float d = length(q);
	disp += (q / max(d, 1e-4)) * cavity * exp(-d * d / 0.0018);
	VERTEX += disp;
}

void fragment() {
	vec3 col = COLOR.rgb;
	float wet = v_wet;
	float n = texture(tex_noise, v_pos.xy * 7.0 + v_pos.z * 4.0).r;
	float fine = texture(tex_noise, v_pos.zy * 23.0 + v_pos.x * 9.0).r;
	// Inside surfaces: folds and vessels, and a film of blood over them.
	vec3 raw = col * (0.7 + 0.6 * fine);
	vec3 blood = vec3(0.09, 0.004, 0.003);
	raw = mix(raw, blood, smoothstep(0.5, 0.85, n) * 0.45);
	vec3 skin_col = col;
	if (face_on && wet < 0.05) {
		vec3 u = normalize(v_pos / (vec3(0.093, 0.115, 0.106) * head_scale));
		if (u.z < -0.4) {
			for (int k = 0; k < 2; k++) {
				float sx = k == 0 ? -1.0 : 1.0;
				vec3 e = normalize(vec3(0.36 * sx, 0.26, -0.9));
				vec3 d = u - e;
				// Eye: narrowed in anger, wide open in fear, half shut in death.
				float h = 0.13 * clamp(0.72 - 0.38 * anger + 0.4 * fear - 0.55 * dead - 0.6 * pain - 0.22 * sad, 0.06, 1.2);
				float ew = 0.13 * (1.0 + 0.1 * fear);
				if (pow(d.x / ew, 2.0) + pow(d.y / h, 2.0) < 1.0) {
					col = vec3(0.02, 0.015, 0.015);
				}
				// Brow: drawn down and in (anger), raised, inner ends up (fear).
				float bx = d.x * sx;          // + outward
				float by = 0.17 + 0.06 * fear - 0.05 * anger + 0.02 * sad - 0.025 * pain;
				// (inner ends up in grief and pain, down in anger)
				float slope = 0.5 * anger - 0.45 * fear - 0.6 * sad - 0.55 * pain + 0.15;
				float line = by + slope * bx - 0.04 * anger * step(bx, 0.0);
				if (abs(bx + 0.01 * anger) < 0.12 && abs(d.y - line) < 0.032) {
					col = mix(skin_col, vec3(0.04, 0.03, 0.025), 0.75);
				}
			}
			// Mouth: pressed thin and wide (anger), dropped open (fear, death).
			vec3 m = normalize(vec3(0.0, -0.52 - 0.04 * fear, -0.85));
			vec3 dm = u - m;
			float mw = 0.12 * (1.0 + 0.15 * anger - 0.18 * fear + 0.3 * pain - 0.1 * sad);
			float mh = 0.022 + 0.085 * fear + 0.05 * dead - 0.01 * anger + 0.045 * pain;
			// Corners pulled down (anger, grief) or back (pain).
			float bend = 0.02 * anger + 0.045 * sad - 0.01 * pain;
			float r = pow(dm.x / mw, 2.0) + pow((dm.y + bend * pow(dm.x / mw, 2.0)) / mh, 2.0);
			if (r < 1.0) {
				col = mix(vec3(0.1, 0.02, 0.02), vec3(0.35, 0.12, 0.1), smoothstep(0.35, 1.0, r) * step(mh, 0.04));
				// Clenched teeth showing in pain.
				if (pain > 0.35 && abs(dm.y + bend * pow(dm.x / mw, 2.0)) < mh * 0.45) {
					col = vec3(0.78, 0.74, 0.66);
				}
			} else if (r < 1.6) {
				col = mix(col, skin_col * vec3(1.0, 0.72, 0.7), 0.5);
			}
		}
	}
	ALBEDO = mix(col, raw, wet);
	ROUGHNESS = mix(0.58, 0.12 + 0.2 * fine, wet);
	SPECULAR = mix(0.35, 0.6, wet);
	SSS_STRENGTH = 0.2 * (1.0 - wet);
}
