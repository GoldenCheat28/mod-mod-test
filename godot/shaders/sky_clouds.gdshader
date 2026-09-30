// Sky with volumetric clouds. The clouds are ray-marched through a slab of
// 3D noise (1.1-2.1 km up) in the half-resolution pass, lit with one sample
// towards the sun, and drift with the wind. Separate cumulus shapes rather
// than a uniform haze: coverage cuts the noise into individual clouds.
// The radiance cubemap (reflections/ambient) sees the plain sky only.
shader_type sky;
render_mode use_half_res_pass;

uniform vec3 top_color : source_color = vec3(0.36, 0.45, 0.58);
uniform vec3 horizon_color : source_color = vec3(0.66, 0.68, 0.7);
uniform vec3 ground_color : source_color = vec3(0.2, 0.2, 0.2);
uniform sampler3D cloud_noise : filter_linear_mipmap, repeat_enable;
uniform float coverage = 0.47;
uniform float cloud_dark = 0.0;          // night: the clouds unlit, dark shapes on a dark sky
uniform float cloud_bottom = 1100.0;
uniform float cloud_top = 2100.0;
uniform vec2 wind = vec2(14.0, 5.0);     // m/s

vec3 base_sky(vec3 dir) {
	float h = dir.y;
	vec3 c = mix(horizon_color, top_color, pow(clamp(h, 0.0, 1.0), 0.45));
	if (h < 0.0) {
		c = mix(horizon_color, ground_color, clamp(-h * 4.0, 0.0, 1.0));
	}
	if (LIGHT0_ENABLED) {
		float s = max(dot(dir, LIGHT0_DIRECTION), 0.0);
		c += LIGHT0_COLOR * LIGHT0_ENERGY * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.12);
	}
	return c;
}

float cloud_density(vec3 p) {
	float h = (p.y - cloud_bottom) / (cloud_top - cloud_bottom);
	// Flat-ish bases, rounded tops.
	float shape = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.35, h);
	vec3 q = (p + vec3(wind.x, 0.0, wind.y) * TIME) * 0.00022;
	float n = texture(cloud_noise, q).r * 0.72 + texture(cloud_noise, q * 3.3 + 0.37).r * 0.28;
	return max(n * shape - (1.0 - coverage), 0.0) * 3.0;
}

void sky() {
	vec3 dir = EYEDIR;
	if (AT_HALF_RES_PASS) {
		if (dir.y < 0.02) {
			COLOR = vec3(0.0);
			ALPHA = 0.0;
		} else {
			float t0 = cloud_bottom / dir.y;
			float t1 = min(cloud_top / dir.y, t0 + 5000.0);
			const int STEPS = 14;
			float dt = (t1 - t0) / float(STEPS);
			float jitter = fract(sin(dot(SCREEN_UV, vec2(12.9898, 78.233))) * 43758.5453);
			float trans = 1.0;
			vec3 light = vec3(0.0);
			vec3 sun_dir = LIGHT0_ENABLED ? LIGHT0_DIRECTION : vec3(0.0, 1.0, 0.0);
			vec3 sun_col = LIGHT0_ENABLED ? LIGHT0_COLOR * LIGHT0_ENERGY : vec3(1.0);
			for (int i = 0; i < STEPS; i++) {
				vec3 p = dir * (t0 + dt * (float(i) + jitter));
				float d = cloud_density(p);
				if (d > 0.001) {
					float toward_sun = cloud_density(p + sun_dir * 180.0);
					float lit = exp(-toward_sun * 2.2);
					vec3 col = mix(vec3(0.42, 0.45, 0.52), sun_col * 1.05, lit);
					col *= mix(1.0, 0.05, cloud_dark);
					float a = 1.0 - exp(-d * dt * 0.0035);
					light += trans * a * col;
					trans *= 1.0 - a;
					if (trans < 0.03) {
						break;
					}
				}
			}
			// Thin out towards the horizon where the slab is seen edge-on.
			float fade = smoothstep(0.02, 0.14, dir.y);
			COLOR = light * fade;
			ALPHA = (1.0 - trans) * fade;
		}
	} else {
		vec3 c = base_sky(dir);
		if (!AT_CUBEMAP_PASS) {
			c = c * (1.0 - HALF_RES_COLOR.a) + HALF_RES_COLOR.rgb;
		}
		COLOR = c;
	}
}
