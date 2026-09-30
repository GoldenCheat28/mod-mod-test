// World distortion while high (Game.high -> global "hallu"): surfaces swell
// and settle, and their texture detail slowly crawls.
global uniform float hallu;

vec3 hallu_bend(vec3 p, vec3 n, float time) {
	if (hallu <= 0.001) {
		return vec3(0.0);
	}
	float w = sin(p.x * 0.8 + time * 0.7) * sin(p.z * 0.65 - time * 0.55) + 0.5 * sin(p.y * 1.4 + time * 0.9 + p.x * 0.3);
	return n * w * 0.08 * hallu;
}

vec3 hallu_flow(vec3 p, float time) {
	return vec3(sin(p.z * 0.5 + time * 0.4), cos(p.x * 0.4 + time * 0.3), sin(p.y * 0.6 - time * 0.35)) * 0.4 * hallu;
}