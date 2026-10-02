shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_back, diffuse_burley, specular_schlick_ggx, shadows_disabled;

// Процедурная кровь на поверхности. Вся анимация считается здесь по возрасту пятна:
//  - форма зависит от удара: скорость -> брызги-лучи и сателлиты, угол -> вытягивание по направлению
//  - на стенах из пятна стекают капли (гравитация в uv-пространстве), на полу пятно растекается лужей
//  - со временем: края размываются, кровь темнеет и сохнет (из глянцевой красной в матовую коричневую)
global uniform float blood_time;

instance uniform float t0 = 0.0;                              // момент появления
instance uniform vec4 shape = vec4(0.0, 0.3, 1.0, 0.3);       // seed, радиус, вытягивание, лучи (скорость)
instance uniform vec4 flow = vec4(1.0, 0.0, 0.0, 0.0);        // xy: направление удара в uv, zw: гравитация в uv
instance uniform vec4 misc = vec4(0.0, 90.0, 0.4, 0.0);       // kind(0 стена,1 пол,2 лужа,3 дырка), время высыхания, сдвиг центра, рост лужи

float h11(float p) {
	p = fract(p * 0.1031);
	p *= p + 33.33;
	p *= p + p;
	return fract(p);
}

float field(vec2 q, float age) {
	float seed = shape.x;
	float R = shape.y;
	float stretch = max(shape.z, 1.0);
	float spike = shape.w;
	int kind = int(misc.x + 0.5);
	vec2 dir = normalize(flow.xy + vec2(1e-5, 0.0));
	vec2 gd = flow.zw;
	vec2 p = q + gd * misc.z;                                  // центр пятна смещён против гравитации
	if (kind == 2) {
		R += misc.w * (1.0 - exp(-age * 0.12));                // лужа растёт
	}
	R *= 1.0 + 0.10 * (1.0 - exp(-age * 0.25));                // вязкое растекание
	float along = dot(p, dir);
	float perp = dot(p, vec2(-dir.y, dir.x));
	vec2 a = vec2(along / stretch, perp);
	float r = length(a);
	float ang = atan(a.y, a.x);
	float wob = 1.0 + 0.22 * sin(ang * 3.0 + seed * 6.2831) + 0.12 * sin(ang * 5.0 + seed * 17.0) + 0.08 * sin(ang * 9.0 + seed * 31.0);
	float s = (ang / 6.2831853 + 0.5) * 22.0;
	float id = floor(s);
	float f = fract(s);
	float sp = h11(id + seed * 13.0);
	float spikes = spike * sp * sp * pow(max(0.0, 1.0 - abs(f - 0.5) * 2.0), 3.0);
	float edge = R * wob + R * spikes * 2.4;
	float hgt = clamp((edge - r) / max(edge, 1e-4), 0.0, 1.0);
	float h = pow(hgt, 0.6);

	// брызги-сателлиты
	if (kind != 2) {
		for (int i = 0; i < 9; i++) {
			if (float(i) > 3.0 + spike * 8.0) { break; }
			float fi = float(i);
			float sa = h11(seed * 7.0 + fi * 3.1) * 6.2831;
			float dist = R * (1.25 + h11(seed * 11.0 + fi * 5.7) * 1.1 + spike * 1.6);
			vec2 c = vec2(cos(sa), sin(sa)) * dist;
			float rr = R * (0.05 + 0.12 * h11(fi + seed * 2.0));
			h = max(h, clamp(1.0 - length(a - c) / rr, 0.0, 1.0) * 0.8);
		}
	}

	// подтёки на стенах
	if (kind == 0 && dot(gd, gd) > 0.1) {
		vec2 pg = vec2(dot(p, gd), dot(p, vec2(-gd.y, gd.x)));
		for (int i = 0; i < 5; i++) {
			float fi = float(i);
			float hx = h11(seed * 3.0 + fi * 9.1);
			float hy = h11(seed * 5.0 + fi * 4.3);
			float cx = (hx - 0.5) * R * 1.6;
			if (abs(cx) > R * 0.75) { continue; }
			float w = R * (0.05 + 0.07 * hy);
			float delay = 0.6 + hy * 4.0;
			float vmax = R * (1.3 + 3.2 * h11(fi + seed * 8.0));
			float len = vmax * (1.0 - exp(-max(age - delay, 0.0) * (0.04 + 0.05 * hy)));
			float start = R * 0.2;
			float da = pg.x - start;
			float tube = (1.0 - smoothstep(w * 0.55, w, abs(pg.y - cx))) * step(0.0, da) * step(da, len);
			float bulb = 1.0 - smoothstep(w * 1.1, w * 1.9, length(vec2(pg.x - (start + len), pg.y - cx)));
			h = max(h, max(tube * 0.55, bulb * 0.8) * step(0.0001, len));
		}
	}
	return h;
}

void fragment() {
	float age = max(blood_time - t0, 0.0);
	vec2 q = vec2(UV.x * 2.0 - 1.0, 1.0 - UV.y * 2.0);
	int kind = int(misc.x + 0.5);
	float dry_t = misc.y;
	if (kind == 3) {
		float d = length(q);
		ALBEDO = vec3(0.025);
		ROUGHNESS = 0.9;
		ALPHA = smoothstep(1.0, 0.55, d) * 0.95;
	} else {
		float e = 0.012;
		float h = field(q, age);
		float hx = field(q + vec2(e, 0.0), age);
		float hy = field(q + vec2(0.0, e), age);
		float dryk = clamp(age / (dry_t * (0.55 + 0.9 * h)), 0.0, 1.0);
		float soft = 0.05 + 0.14 * clamp(age / dry_t, 0.0, 1.0);          // края размываются
		float alpha = smoothstep(0.0, soft, h);
		alpha *= 1.0 - 0.25 * smoothstep(dry_t * 1.5, dry_t * 6.0, age);   // старая засохшая кровь бледнеет
		alpha *= 1.0 - smoothstep(0.88, 1.0, max(abs(q.x), abs(q.y)));
		vec3 wet = mix(vec3(0.62, 0.015, 0.03), vec3(0.13, 0.0, 0.01), h);
		vec3 dry = mix(vec3(0.28, 0.07, 0.035), vec3(0.075, 0.015, 0.01), h);
		ALBEDO = mix(wet, dry, dryk);
		ROUGHNESS = mix(0.05, 0.85, dryk);
		SPECULAR = mix(0.9, 0.3, dryk);
		float bump = (1.0 - dryk * 0.75) * 1.6;
		vec3 n = normalize(vec3(-(hx - h) / e * 0.05 * bump * 8.0, -(hy - h) / e * 0.05 * bump * 8.0, 1.0));
		NORMAL_MAP = n * 0.5 + 0.5;
		ALPHA = alpha;
	}
}
