// Spray paint laid on whatever is inside a box (graffiti.gd): the box is
// drawn from the inside faces, and each pixel finds the surface behind it
// from the depth buffer; where that surface lies within the box the paint
// texture is looked up there (u along the box x, v along its z). Unlike an
// engine decal, the texture can be painted into every frame for free.
shader_type spatial;
render_mode blend_mix, depth_draw_never, depth_test_disabled, cull_front, specular_schlick_ggx;

uniform sampler2D paint : source_color, filter_linear_mipmap;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;
uniform mat4 world_to_box;       // world -> box space, box = unit cube
uniform vec3 box_up = vec3(0.0, 1.0, 0.0);
uniform float fade = 1.0;   // the surface normal it was made for (world)

void fragment() {
	float depth = texture(depth_tex, SCREEN_UV).r;
	vec4 ndc = vec4(SCREEN_UV * 2.0 - 1.0, depth, 1.0);
	vec4 view = INV_PROJECTION_MATRIX * ndc;
	view.xyz /= view.w;
	vec3 world = (INV_VIEW_MATRIX * vec4(view.xyz, 1.0)).xyz;
	vec3 b = (world_to_box * vec4(world, 1.0)).xyz;
	if (any(greaterThan(abs(b), vec3(0.5)))) {
		discard;
	}
	// Only on faces turned towards the can, not smeared down the sides.
	vec3 n = normalize(cross(dFdx(world), dFdy(world)));
	float facing = abs(dot(n, box_up));
	vec4 c = texture(paint, vec2(b.x + 0.5, b.z + 0.5));
	float a = c.a * smoothstep(0.35, 0.6, facing) * fade;
	if (a < 0.01) {
		discard;
	}
	ALBEDO = c.rgb;
	ALPHA = a;
	ROUGHNESS = 0.7;
	NORMAL = normalize((VIEW_MATRIX * vec4(box_up, 0.0)).xyz);
}
