// Lit smoke particles. Each particle is a camera-facing billboard showing an
// animated puff (flipbook of density + normal map) that evolves over the
// particle's life. It is shaded by the scene lights (sun, muzzle flash,
// lighter flame), receives shadows, lets light through from behind
// (backlight) and fades softly where it meets geometry.
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, diffuse_lambert_wrap, specular_disabled, shadows_disabled;

uniform sampler2D density_tex : hint_default_white, filter_linear_mipmap;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap;
uniform sampler2D depth_tex : hint_depth_texture, filter_linear;
uniform vec3 tint : source_color = vec3(0.82, 0.82, 0.84);
uniform float opacity = 1.0;
uniform float softness = 0.3;
uniform float backlight = 0.55;
uniform vec2 frames = vec2(4.0, 2.0);

varying float v_life;

void vertex() {
	// Particle billboard with the particle's own rotation (INSTANCE_CUSTOM.x).
	mat4 world = mat4(normalize(INV_VIEW_MATRIX[0]), normalize(INV_VIEW_MATRIX[1]), normalize(INV_VIEW_MATRIX[2]), MODEL_MATRIX[3]);
	float a = INSTANCE_CUSTOM.x;
	world = world * mat4(vec4(cos(a), -sin(a), 0.0, 0.0), vec4(sin(a), cos(a), 0.0, 0.0), vec4(0.0, 0.0, 1.0, 0.0), vec4(0.0, 0.0, 0.0, 1.0));
	MODELVIEW_MATRIX = VIEW_MATRIX * world;
	MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0.0, 0.0, 0.0),
			vec4(0.0, length(MODEL_MATRIX[1].xyz), 0.0, 0.0), vec4(0.0, 0.0, length(MODEL_MATRIX[2].xyz), 0.0), vec4(0.0, 0.0, 0.0, 1.0));
	MODELVIEW_NORMAL_MATRIX = mat3(MODELVIEW_MATRIX);
	v_life = INSTANCE_CUSTOM.y;
}

vec2 cell_uv(vec2 uv, float i) {
	return (uv + vec2(mod(i, frames.x), floor(i / frames.x))) / frames;
}

void fragment() {
	// Right in front of the camera a puff would cover the screen: fade it out
	// early and skip the pixel entirely (smoke fill-rate is the main cost).
	float near_fade = smoothstep(0.1, 0.5, -VERTEX.z);
	if (near_fade <= 0.001 || COLOR.a <= 0.003) {
		discard;
	}
	float last = frames.x * frames.y - 1.0;
	float f = clamp(v_life, 0.0, 1.0) * last;
	float i0 = floor(f);
	float i1 = min(i0 + 1.0, last);
	float b = f - i0;
	vec2 uv0 = cell_uv(UV, i0);
	vec2 uv1 = cell_uv(UV, i1);
	float dens = mix(texture(density_tex, uv0).a, texture(density_tex, uv1).a, b);
	vec3 nrm = mix(texture(normal_tex, uv0).rgb, texture(normal_tex, uv1).rgb, b);

	// Soft contact with the scene behind.
	float depth = texture(depth_tex, SCREEN_UV).r;
	vec4 view = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, depth, 1.0);
	view.xyz /= view.w;
	float fade = clamp((VERTEX.z - view.z) / softness, 0.0, 1.0);
	// And fade near the camera so a puff never fills the screen with an edge.
	fade *= near_fade;

	ALBEDO = tint * COLOR.rgb;
	ALPHA = clamp(dens * COLOR.a * opacity * fade, 0.0, 1.0);
	NORMAL_MAP = nrm;
	NORMAL_MAP_DEPTH = 1.0;
	ROUGHNESS = 1.0;
	BACKLIGHT = tint * backlight;
}
