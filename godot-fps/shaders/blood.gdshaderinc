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

// (no sin(): at world coordinates it loses precision and draws lines)
float blood_hash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

// Smooth value noise (world metres in, 0..1 out).
float blood_noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(blood_hash(i), blood_hash(i + vec2(1.0, 0.0)), f.x),
			mix(blood_hash(i + vec2(0.0, 1.0)), blood_hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

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
	// (at the very edge the stored numbers are divided by almost nothing:
	// too imprecise to use - that is where stray coloured specks came from)
	if (s.a < 0.04 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
		return vec3(0.0);
	}
	vec3 v = clamp(s.rgb / s.a, vec3(0.0), vec3(1.0));
	float d = v.g * BLOOD_DEPTH_RANGE + BLOOD_DEPTH_MIN;
	if (abs(d - depth) > tol) {
		return vec3(0.0);
	}
	float age = mod(blood_time - v.b * BLOOD_TIME_SPAN + BLOOD_TIME_SPAN, BLOOD_TIME_SPAN);
	return vec3(s.a, v.r, clamp(age / BLOOD_DRY_TIME, 0.0, 1.0));
}

// Blood that lands in standing water does not stay a film: it clouds out into
// the water as a translucent red haze that spreads and thins with time. The
// map is sampled in two rings around the point (a wide blur); fresh blood
// uses the tight ring, older blood the wide one.
void blood_water(vec3 wpos, float wet, float detail, inout vec3 albedo) {
	if (wet <= 0.01) {
		return;
	}
	vec3 up = vec3(0.0, 1.0, 0.0);
	vec3 c = blood_sample(wpos, up);
	float inner = c.x;
	float outer = c.x;
	float fresh = c.x > 0.0 ? c.z : 1.0;
	for (int i = 0; i < 8; i++) {
		float a = float(i) * 0.785398 + detail * 0.6;
		vec2 d = vec2(cos(a), sin(a));
		vec3 s1 = blood_sample(wpos + vec3(d.x, 0.0, d.y) * 0.05, up);
		vec3 s2 = blood_sample(wpos + vec3(d.x, 0.0, d.y) * 0.16, up);
		inner += s1.x;
		outer += s2.x;
		if (s1.x > 0.0) { fresh = min(fresh, s1.z); }
		if (s2.x > 0.0) { fresh = min(fresh, s2.z); }
	}
	inner /= 9.0;
	outer /= 9.0;
	// Spreads over the first ~20 s, then slowly pales.
	float spread = smoothstep(0.0, 0.14, fresh);
	float cloud = mix(max(inner, outer * 0.6), (inner + outer) * 0.55, spread);
	cloud *= 1.0 - 0.55 * smoothstep(0.1, 1.0, fresh);
	float k = clamp(cloud * 1.6, 0.0, 0.8) * wet;
	// Murky red water: fresh it is a strong red cloud, later a paler brownish tint.
	vec3 cloud_col = mix(vec3(0.16, 0.009, 0.007), vec3(0.11, 0.03, 0.022), smoothstep(0.1, 1.0, fresh));
	albedo = mix(albedo, cloud_col, k);
}

// Applies blood to a surface. `detail` is a 0..1 noise value at fine scale used
// to break up the edge; `n_view` is the surface normal in view space (in/out).
// `wet`: how much the point is under standing water (the film is not drawn
// there, see blood_water).
void blood_apply_wet(vec3 wpos, vec3 wnrm, float detail, vec3 vertex, vec3 geom_view_n, float wet,
		inout vec3 albedo, inout float roughness, inout float specular, inout vec3 n_view) {
	vec3 b = blood_sample(wpos, wnrm);
	// The coverage smoothed over a texel of the map around (a round outline
	// instead of the map's pixel steps).
	vec3 t1 = abs(wnrm.y) > 0.55 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
	vec3 t2 = normalize(cross(wnrm, t1));
	t1 = cross(t2, wnrm);
	float o = 0.011;
	float c4 = blood_sample(wpos + (t1 + t2) * o, wnrm).x + blood_sample(wpos + (t1 - t2) * o, wnrm).x
			+ blood_sample(wpos - (t1 + t2) * o, wnrm).x + blood_sample(wpos - (t1 - t2) * o, wnrm).x;
	b.x = b.x * 0.4 + c4 * 0.15;
	float n_ok = 0.0;
	vec2 yz = vec2(0.0);
	for (int k = 0; k < 4; k++) {
		vec2 sg = vec2(k < 2 ? 1.0 : -1.0, (k % 2 == 0) ? 1.0 : -1.0);
		vec3 q = blood_sample(wpos + (t1 * sg.x + t2 * sg.y) * o * 1.6, wnrm);
		if (q.x > 0.0) {
			yz += q.yz;
			n_ok += 1.0;
		}
	}
	if (b.x <= 0.0) {
		return;
	}
	// Depth and age smoothed with the neighbours too (they were stepping
	// from one texel of the map to the next: square patches of gloss).
	if (n_ok > 0.0) {
		b.yz = b.y > 0.0 ? (b.yz + yz) / (1.0 + n_ok) : yz / n_ok;
	}
	// Thick blood (pools, splats) has a crisp, slightly ragged edge: it either
	// covers the surface or not. A thin film (smears, drag marks) is
	// translucent and streaky, the ground shows through it.
	float thick = clamp(b.y, 0.0, 1.0);
	float film = smoothstep(0.03, 0.09, thick);
	// (the edge is broken up by world noise finer than a texel of the map,
	// so it is a ragged liquid outline and not the map's pixel steps)
	vec2 ep = wnrm.y > 0.55 ? wpos.xz : (abs(wnrm.x) > abs(wnrm.z) ? wpos.zy : wpos.xy);
	float ragged = blood_noise(ep * 70.0) * 0.6 + blood_noise(ep * 190.0) * 0.4;
	float crisp = smoothstep(0.4, 0.5, b.x + (ragged - 0.5) * 0.34 + (detail - 0.5) * 0.08);
	float soft = smoothstep(0.08, 0.8, b.x + (detail - 0.5) * 0.3) * (0.3 + 0.35 * detail);
	// In standing water a thin film clouds out into it (blood_water); a real
	// pool of blood lies there as blood, the water pushed aside.
	float in_water = wet * (1.0 - film * crisp * smoothstep(0.1, 0.35, thick));
	float cov = mix(soft, crisp, film) * (1.0 - in_water);
	// Where it is shallow the light stones of the ground stand up out of it.
	float stone = smoothstep(0.16, 0.3, dot(albedo, vec3(0.3, 0.59, 0.11)));
	cov *= 1.0 - stone * (1.0 - smoothstep(0.35, 0.8, clamp(b.y, 0.0, 1.0))) * 0.85;
	if (cov <= 0.0) {
		return;
	}
	// How deep it lies, evened out: a pool is one dark sheet, not the circles
	// of every splash that went into it.
	float deep = smoothstep(0.08, 0.45, thick);
	// The surface of real blood (in the plane it lies in): clots and darker
	// streaks where it settled, a skin that forms in patches as it dries.
	vec2 sp = wnrm.y > 0.55 ? wpos.xz : (abs(wnrm.x) > abs(wnrm.z) ? wpos.zy : wpos.xy);
	float clot = blood_noise(sp * 9.0) * 0.6 + blood_noise(sp * 31.0) * 0.4;
	float grain = blood_noise(sp * 140.0);
	// Patches of it dry faster than others; the edge (thin) dries first.
	float edge = 1.0 - smoothstep(0.25, 0.85, thick);
	float dry = pow(clamp(b.z * (0.75 + 0.5 * clot) + edge * b.z * 0.8, 0.0, 1.0), 0.7);
	// Linear albedo: fresh blood is a deep red that is almost black where
	// thick, brighter red at the thin edge where the light gets through.
	vec3 wet_col = mix(vec3(0.075, 0.004, 0.003), vec3(0.02, 0.0009, 0.0007), deep);
	wet_col *= mix(1.0, 0.5 + 1.0 * clot, deep);                     // clots
	vec3 dry_col = mix(vec3(0.055, 0.017, 0.012), vec3(0.026, 0.009, 0.007), deep);
	dry_col *= 0.8 + 0.45 * clot;
	// A dark crust line where the pool's edge has dried.
	float crust = smoothstep(0.1, 0.5, b.z) * edge * smoothstep(0.02, 0.2, thick);
	dry_col = mix(dry_col, vec3(0.018, 0.006, 0.005), crust * 0.7);
	albedo = mix(albedo, mix(wet_col, dry_col, dry), cov);
	// Only a real layer of it is glossy; a thin film soaks into the grain of
	// the surface and stays satin (a mirror-smooth film over a rough ground
	// sparkled in pale pink flecks).
	float gloss = film * smoothstep(0.35, 0.8, cov);
	// Glossy, but not a mirror all over: the skin that forms and the clots
	// take the shine off in patches.
	float sheen = smoothstep(0.35, 0.75, blood_noise(sp * 5.0 + 3.1) * 0.7 + clot * 0.3);
	// (not a mirror: a mirror-smooth pool showed every white shirt and cloud
	// above it as pale patches drifting in the blood)
	// Blood reflects about as much as water does (F0 ~2%, specular 0.25):
	// a soft sheen, no white glare off it.
	// Wet: smooth, a clean sharp reflection. Dry: matt. Never the in-between
	// (a middling roughness spreads the blurred sun and sky over the whole
	// pool as a pale milky sheen).
	roughness = mix(roughness, mix(mix(0.5, mix(0.05, 0.12, sheen), gloss), 0.88, smoothstep(0.35, 0.55, dry)), cov);
	specular = mix(specular, mix(0.35, 0.15, smoothstep(0.35, 0.55, dry)), cov);
	// The film fills the surface texture and is raised at its edge: flatten the
	// normal under it and add a bump from the film height (surface gradient).
	// (a liquid lies flat: under a layer of it the ground's own bumps are gone)
	vec3 nv = normalize(mix(n_view, geom_view_n, clamp(cov * (1.0 - dry * 0.6) + film * crisp * (1.0 - dry), 0.0, 1.0)));
	// The rim: only at the pool's own edge (not between the splashes in it).
	// plus a faint unevenness of the surface (it is not glass), gone flatter
	// and crazed as it dries.
	float h = crisp * film * (1.0 - in_water) * (0.0022 + deep * dry * ((clot - 0.5) * 0.0012 + (grain - 0.5) * 0.0006));
	vec3 dpdx = dFdx(vertex);
	vec3 dpdy = dFdy(vertex);
	vec3 r1 = cross(dpdy, nv);
	vec3 r2 = cross(nv, dpdx);
	float det = dot(dpdx, r1);
	vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
	// The rim bump, kept tame: at a pixel where the edge is crossed the
	// slope can come out huge (or the surface edge-on makes det ~ 0) - that
	// normal would catch any stray reflection as a speck of colour.
	vec3 bumped = abs(det) * nv - grad;
	float bl = length(bumped);
	if (abs(det) > 1e-12 && bl > 1e-12) {
		bumped /= bl;
		// No more than ~25 degrees off the flat.
		n_view = normalize(mix(nv, bumped, clamp(dot(bumped, nv) > 0.9 ? 1.0 : 0.35, 0.0, 1.0)));
	} else {
		n_view = nv;
	}
}


void blood_apply(vec3 wpos, vec3 wnrm, float detail, vec3 vertex, vec3 geom_view_n,
		inout vec3 albedo, inout float roughness, inout float specular, inout vec3 n_view) {
	blood_apply_wet(wpos, wnrm, detail, vertex, geom_view_n, 0.0, albedo, roughness, specular, n_view);
}
