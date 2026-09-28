// World blood, painted by scripts/fx/blood_canvas.gd into three world-space
// maps. Texels are premultiplied: rgb / a = (thickness, depth, time).

global uniform sampler2D blood_floor;
global uniform sampler2D blood_wall_x;
global uniform sampler2D blood_wall_z;
global uniform vec4 blood_area;      // area min (x/z), area size, wall y0, wall height
global uniform float blood_time;

const float BLOOD_DEPTH_MIN = -40.0;
const float BLOOD_DEPTH_RANGE = 80.0;
const float BLOOD_TIME_SPAN = 16384.0;
const float BLOOD_DRY_TIME = 150.0;

// x = coverage (0..1), y = film thickness, z = dryness (0 wet .. 1 dry)
vec3 blood_sample(vec3 p, vec3 n) {
	vec2 uv;
	float depth;
	float tol;
	vec4 s;
	vec3 an = abs(n);
	if (n.y > 0.55) {
		uv = (p.xz - blood_area.x) / blood_area.y;
		s = texture(blood_floor, uv);
		depth = p.y;
		tol = 0.08;
	} else if (an.x > an.z && an.x > 0.6) {
		uv = vec2((p.z - blood_area.x) / blood_area.y, (p.y - blood_area.z) / blood_area.w);
		s = texture(blood_wall_x, uv);
		depth = p.x;
		tol = 0.06;
	} else if (an.z > 0.6) {
		uv = vec2((p.x - blood_area.x) / blood_area.y, (p.y - blood_area.z) / blood_area.w);
		s = texture(blood_wall_z, uv);
		depth = p.z;
		tol = 0.06;
	} else {
		return vec3(0.0);
	}
	if (s.a < 0.01 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
		return vec3(0.0);
	}
	vec3 v = s.rgb / s.a;
	float d = v.g * BLOOD_DEPTH_RANGE + BLOOD_DEPTH_MIN;
	if (abs(d - depth) > tol) {
		return vec3(0.0);
	}
	float age = mod(blood_time - v.b * BLOOD_TIME_SPAN + BLOOD_TIME_SPAN, BLOOD_TIME_SPAN);
	return vec3(s.a, v.r, clamp(age / BLOOD_DRY_TIME, 0.0, 1.0));
}

// Applies blood to a surface. `detail` is a 0..1 noise value at fine scale used
// to break up the edge; `n_view` is the surface normal in view space (in/out).
void blood_apply(vec3 wpos, vec3 wnrm, float detail, vec3 vertex, vec3 geom_view_n,
		inout vec3 albedo, inout float roughness, inout float specular, inout vec3 n_view) {
	vec3 b = blood_sample(wpos, wnrm);
	if (b.x <= 0.0) {
		return;
	}
	// Crisp, slightly ragged edge: the film either covers the surface or not.
	float cov = smoothstep(0.38, 0.55, b.x + (detail - 0.5) * 0.22);
	if (cov <= 0.0) {
		return;
	}
	float thick = clamp(b.y, 0.0, 1.0);
	float dry = pow(b.z, 0.7);
	// Linear albedo: fresh blood is a deep red that is almost black where thick.
	vec3 wet_col = mix(vec3(0.13, 0.0055, 0.004), vec3(0.045, 0.0018, 0.0014), thick);
	vec3 dry_col = mix(vec3(0.05, 0.016, 0.012), vec3(0.024, 0.009, 0.007), thick);
	albedo = mix(albedo, mix(wet_col, dry_col, dry), cov);
	roughness = mix(roughness, mix(0.05, 0.72, dry), cov);
	specular = mix(specular, 0.55, cov);
	// The film fills the surface texture and is raised at its edge: flatten the
	// normal under it and add a bump from the film height (surface gradient).
	vec3 nv = normalize(mix(n_view, geom_view_n, cov * (1.0 - dry * 0.6)));
	float h = cov * (0.35 + thick * 0.65) * 0.0025;
	vec3 dpdx = dFdx(vertex);
	vec3 dpdy = dFdy(vertex);
	vec3 r1 = cross(dpdy, nv);
	vec3 r2 = cross(nv, dpdx);
	float det = dot(dpdx, r1);
	vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
	n_view = normalize(abs(det) * nv - grad);
}
