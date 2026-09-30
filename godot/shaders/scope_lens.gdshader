// The eyepiece of a rifle scope (weapon.gd): what the scope's own camera
// sees, magnified, with the reticle in it - thin lines, the outer parts of
// the cross heavier (a duplex). With the eye off the scope's axis a dark
// crescent comes in from the side, and further off it goes black - as a
// real one does. Not being looked through, it is dark glass.
shader_type spatial;
render_mode unshaded, cull_back;

uniform sampler2D view_tex : source_color, filter_linear;
uniform float active = 0.0;
uniform vec2 eye_off = vec2(0.0);   // where the eye is off the axis (-1..1 is a lot)

void fragment() {
	vec2 c = UV - 0.5;
	float r = length(c) * 2.0;
	if (r > 1.0) {
		discard;
	}
	vec3 img = texture(view_tex, UV).rgb;
	// The reticle: fine in the middle, heavy posts out towards the edge.
	float thin = 0.0035;
	float thick = 0.018;
	float wx = mix(thin, thick, step(0.28, abs(c.y)));
	float wy = mix(thin, thick, step(0.28, abs(c.x)));
	float line_v = 1.0 - smoothstep(wx * 0.5, wx * 0.5 + 0.002, abs(c.x));
	float line_h = 1.0 - smoothstep(wy * 0.5, wy * 0.5 + 0.002, abs(c.y));
	float ret = max(line_v, line_h);
	// A small gap round the very centre of the cross is left out: no, a dot.
	img = mix(img, vec3(0.0), ret * 0.95);
	// Eye position: the exit pupil (a dark ring closing in, shifted).
	float rr = length(c * 2.0 + eye_off * 0.9);
	float lit = 1.0 - smoothstep(0.78 - length(eye_off) * 0.4, 0.98 - length(eye_off) * 0.4, rr);
	vec3 col = img * lit;
	// The edge of the lens always a little dark.
	col *= 1.0 - smoothstep(0.85, 1.0, r) * 0.6;
	vec3 glass = vec3(0.02, 0.03, 0.04) + vec3(0.05, 0.07, 0.1) * (1.0 - r);
	ALBEDO = mix(glass, col, active);
}
