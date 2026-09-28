// Shared world-space triplanar helpers. Batched level geometry has no
// meaningful UVs/tangents, so every surface is textured from world position.

vec3 tp_weights(vec3 n, float sharpness) {
	vec3 w = pow(abs(n), vec3(sharpness));
	return w / (w.x + w.y + w.z);
}

vec4 tp_sample(sampler2D t, vec3 p, vec3 w) {
	return texture(t, p.zy) * w.x + texture(t, p.xz) * w.y + texture(t, p.xy) * w.z;
}

// Whiteout-blended triplanar normal mapping, returns a world-space normal.
vec3 tp_normal(sampler2D nm, vec3 p, vec3 n, vec3 w, float strength) {
	vec3 tx = texture(nm, p.zy).xyz * 2.0 - 1.0;
	vec3 ty = texture(nm, p.xz).xyz * 2.0 - 1.0;
	vec3 tz = texture(nm, p.xy).xyz * 2.0 - 1.0;
	tx.xy *= strength;
	ty.xy *= strength;
	tz.xy *= strength;
	tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
	ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
	tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
	return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}
