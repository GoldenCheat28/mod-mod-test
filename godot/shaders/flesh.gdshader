// Soft head surface: skin/hair from vertex colour (rgb, linear), raw tissue
// where damaged (vertex alpha = 0..1) and on the inside of the shell, which
// shows through holes and on torn-off pieces.
shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;

uniform sampler2D tex_noise : hint_default_white, filter_linear_mipmap, repeat_enable;

varying vec3 v_pos;

void vertex() {
	v_pos = VERTEX;
}

void fragment() {
	float n = texture(tex_noise, v_pos.xy * 9.0 + v_pos.z * 5.0).r;
	float fine = texture(tex_noise, v_pos.zy * 31.0).r;
	// Linear albedo: dark, blood-soaked tissue with lighter streaks of fat/membrane.
	vec3 tissue = mix(vec3(0.06, 0.004, 0.003), vec3(0.2, 0.025, 0.018), smoothstep(0.35, 0.8, n * 0.75 + fine * 0.25));
	vec3 col = COLOR.rgb;
	float meat = COLOR.a;
	if (!FRONT_FACING) {
		// Inside: wet, darker tissue.
		col = tissue * 0.75;
		meat = 1.0;
		NORMAL = -NORMAL;
	}
	ALBEDO = mix(col, tissue, meat);
	ROUGHNESS = mix(0.58, 0.18, meat);
	SPECULAR = mix(0.35, 0.6, meat);
	SSS_STRENGTH = 0.25 * (1.0 - meat);
}
