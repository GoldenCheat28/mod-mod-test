// Сетка-прототип в стиле Unreal: линии каждые 1 м и тонкие каждые 25 см.

float grid_lines(vec2 p, float spacing, float width) {
	vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;   // расстояние до ближайшей линии
	vec2 fw = max(fwidth(p), vec2(0.0001));
	vec2 l = 1.0 - smoothstep(vec2(width) - fw, vec2(width) + fw, g);
	return max(l.x, l.y);
}

// pos/nrm в одном пространстве (мир или объект). Проекция с трёх сторон по нормали.
vec3 proto_grid(vec3 pos, vec3 nrm, vec3 base) {
	vec3 w = pow(abs(nrm), vec3(6.0));
	w /= (w.x + w.y + w.z);
	float minor = grid_lines(pos.zy, 0.25, 0.003) * w.x + grid_lines(pos.xz, 0.25, 0.003) * w.y
			+ grid_lines(pos.xy, 0.25, 0.003) * w.z;
	float major = grid_lines(pos.zy, 1.0, 0.007) * w.x + grid_lines(pos.xz, 1.0, 0.007) * w.y
			+ grid_lines(pos.xy, 1.0, 0.007) * w.z;
	// Лёгкая «шахматка» по 1 м, чтобы глазу было за что зацепиться.
	vec3 cell = floor(pos + nrm * 0.5);
	float checker = mod(cell.x + cell.y + cell.z, 2.0);
	vec3 col = base * mix(0.94, 1.0, checker);
	col = mix(col, base * 1.18 + 0.02, minor * 0.45);
	col = mix(col, base * 1.4 + 0.05, major * 0.75);
	return col;
}
