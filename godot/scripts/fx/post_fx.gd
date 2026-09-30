extends CanvasLayer
## Full-screen camera look in one cheap pass over the rendered frame:
##  - body-cam style barrel distortion, normalised so the frame corners stay
##    the corners: nothing is sampled outside the image (no black borders, no
##    stretched edge pixels, no oversized render);
##  - vignette;
##  - weak motion blur from camera turning (a few taps along the screen motion).

const SHADER := """
shader_type canvas_item;
render_mode unshaded;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear, repeat_disable;
uniform float distortion = 0.3;
uniform float vignette = 0.22;
uniform vec2 blur = vec2(0.0);   // screen motion over the exposure, in UV
uniform float high = 0.0;        // 0..1, joint effects
uniform float t = 0.0;
uniform float pulse = 0.0;       // brief jolt when something appears or vanishes
uniform float hurt = 0.0;        // just got shot
uniform float blood_loss = 0.0;  // 0..1: colour, sharpness and light drain away
uniform float black = 0.0;       // passing out / death
uniform float grain = 0.0;       // film/sensor noise, stronger in the shadows (off: it read as TV static)
uniform float bodycam = 0.0;     // 0..1: cheap chest camera (see Game.bodycam)
uniform float static_amt = 0.0;
uniform float deaf = 0.0;        // 0..1: stunned by a bang - the view closes in (hearing.gd)  // 0..1: the picture lost to static (camera disconnected)

vec3 hue_shift(vec3 c, float a) {
	// Rotate hue in YIQ space.
	mat3 to_yiq = mat3(vec3(0.299, 0.596, 0.211), vec3(0.587, -0.274, -0.523), vec3(0.114, -0.322, 0.312));
	mat3 to_rgb = mat3(vec3(1.0, 1.0, 1.0), vec3(0.956, -0.272, -1.106), vec3(0.621, -0.647, 1.703));
	vec3 yiq = to_yiq * c;
	float h = atan(yiq.z, yiq.y) + a;
	float ch = length(yiq.yz);
	return to_rgb * vec3(yiq.x, ch * cos(h), ch * sin(h));
}

vec2 lens(vec2 uv, float k, vec2 aspect, float corner2) {
	vec2 d = (uv - 0.5) * aspect;
	float r2 = dot(d, d);
	// Source radius = r * (1 + k r^2) / (1 + k R^2): the centre is slightly
	// magnified, the edges compressed, the corners map to themselves.
	float f = (1.0 + k * r2) / (1.0 + k * corner2);
	return 0.5 + d * f / aspect;
}

vec3 grab(vec2 uv, vec2 blur_v) {
	vec3 c = texture(screen_tex, uv).rgb;
	if (dot(blur_v, blur_v) > 1e-8) {
		c += texture(screen_tex, uv - blur_v * 0.5).rgb;
		c += texture(screen_tex, uv - blur_v * 0.25).rgb;
		c += texture(screen_tex, uv + blur_v * 0.25).rgb;
		c += texture(screen_tex, uv + blur_v * 0.5).rgb;
		c *= 0.2;
	}
	return c;
}

void fragment() {
	vec2 px = SCREEN_PIXEL_SIZE;
	vec2 aspect = vec2(px.y / px.x, 1.0);
	aspect /= max(aspect.x, 1.0);
	float corner2 = dot(0.5 * aspect, 0.5 * aspect);
	vec2 d = (SCREEN_UV - 0.5) * aspect;
	float edge = dot(d, d) / corner2;
	vec2 uv = SCREEN_UV;
	float inner = 1.0 - smoothstep(0.45, 1.0, edge);
	if (high > 0.001) {
		// The picture never holds still: slow waves, a downward melt that
		// comes and goes, breathing zoom and a twist around the centre.
		uv += high * 0.012 * inner * vec2(sin(uv.y * 7.0 + t * 1.3), cos(uv.x * 5.0 + t * 1.05));
		uv.y -= high * inner * 0.01 * (0.5 + 0.5 * sin(uv.x * 4.0 + t * 0.6)) * max(sin(t * 0.13), 0.0);
		uv = 0.5 + (uv - 0.5) * (1.0 - high * 0.035 * (0.5 + 0.5 * sin(t * 0.7)) - pulse * 0.06);
		vec2 r = uv - 0.5;
		float tw = high * 0.12 * inner * sin(t * 0.17) + pulse * 0.25 * inner;
		uv = 0.5 + mat2(vec2(cos(tw), sin(tw)), vec2(-sin(tw), cos(tw))) * r;
	}
	// Body cam: the strong barrel of a wide chest-camera lens, still filling
	// the frame (the corners stay the corners, the edges bulge and stretch).
	float k_lens = distortion * (1.0 + high * 0.8 * (0.5 + 0.5 * sin(t * 0.4))) + bodycam * 1.1;
	vec2 uv_g = lens(uv, k_lens, aspect, corner2);
	// Blur fades out towards the frame edge so it never reads past it.
	vec3 col = grab(uv_g, blur * (1.0 - smoothstep(0.6, 0.95, edge)));
	if (bodycam > 0.001) {
		// Colour fringes towards the edge of the lens.
		vec2 rad = (uv_g - 0.5);
		// (no colour fringes: the lens is cheap, but not that cheap)
		// A small sensor's sharpening: the edges a little crisp and haloed.
		vec3 nb4 = (texture(screen_tex, uv_g + vec2(px.x, 0.0)).rgb + texture(screen_tex, uv_g - vec2(px.x, 0.0)).rgb
				+ texture(screen_tex, uv_g + vec2(0.0, px.y)).rgb + texture(screen_tex, uv_g - vec2(0.0, px.y)).rgb) * 0.25;
		col = mix(col, col + (col - nb4) * 0.6, bodycam);
		// Bright things bleed light into what is round them (cheap bloom).
		vec3 wide = (texture(screen_tex, uv_g + vec2(0.006, 0.0)).rgb + texture(screen_tex, uv_g - vec2(0.006, 0.0)).rgb
				+ texture(screen_tex, uv_g + vec2(0.0, 0.009)).rgb + texture(screen_tex, uv_g - vec2(0.0, 0.009)).rgb) * 0.25;
		col += max(wide - 0.7, vec3(0.0)) * 0.6 * bodycam;
	}
	if (high > 0.001) {
		// Several drifting copies of the image.
		vec3 echo = vec3(0.0);
		for (int i = 1; i <= 3; i++) {
			float fi = float(i);
			vec2 g = vec2(sin(t * (0.5 + 0.23 * fi) + fi), cos(t * (0.41 + 0.19 * fi) + fi * 2.0)) * 0.014 * high * fi;
			echo = max(echo, texture(screen_tex, 0.5 + (uv_g - 0.5) * (1.0 - 0.012 * fi * high) + g).rgb);
		}
		col = mix(col, max(col, echo), 0.5 * high);
		// Tunnel: the edges smear towards the middle.
		vec3 tunnel = vec3(0.0);
		for (int i = 1; i <= 4; i++) {
			tunnel += texture(screen_tex, 0.5 + (uv_g - 0.5) * (1.0 - 0.04 * float(i) * high)).rgb;
		}
		col = mix(col, tunnel * 0.25, smoothstep(0.3, 1.0, edge) * high * 0.8);
		col = hue_shift(col, high * 0.9 * sin(t * 0.21) + pulse * 1.5);
		float luma = dot(col, vec3(0.299, 0.587, 0.114));
		col = mix(vec3(luma), col, 1.0 + 1.1 * high);
		col = mix(col, col * col * 2.2, high * 0.25 * (0.5 + 0.5 * sin(t * 0.33)));
		col *= 1.0 + 0.12 * high * sin(t * 1.7) + pulse * 0.4;
	}
	float vig = vignette * (1.0 + high * (0.9 + 0.6 * sin(t * 0.8))) + deaf * 0.55;
	col *= mix(vec3(1.0), mix(vec3(1.0 - vig), vec3(1.0 - vig, 1.0 - vig * 1.3, 1.0 - vig * 0.5), high), pow(smoothstep(0.15, 1.0, edge), 1.2));	col = mix(col, col * vec3(1.0, 0.25, 0.2), hurt * smoothstep(0.1, 1.0, edge) * 0.9);
	if (blood_loss > 0.001) {
		float bl = blood_loss;
		vec2 o = vec2(0.004, 0.003) * bl * (1.0 + 0.5 * sin(t * 2.1));
		vec3 soft = (texture(screen_tex, uv_g + o).rgb + texture(screen_tex, uv_g - o).rgb
				+ texture(screen_tex, uv_g + vec2(-o.x, o.y)).rgb + texture(screen_tex, uv_g + vec2(o.x, -o.y)).rgb) * 0.25;
		col = mix(col, soft, bl * 0.8);
		float lum = dot(col, vec3(0.299, 0.587, 0.114));
		col = mix(col, vec3(lum), bl * 0.85);
		col *= 1.0 - bl * (0.25 + 0.55 * smoothstep(0.05, 1.0, edge));
	}
	// Grain: fine per-pixel noise that changes every frame.
	float gn = fract(sin(dot(floor(FRAGCOORD.xy) + fract(t * 7.13) * vec2(311.7, 183.3), vec2(12.9898, 78.233))) * 43758.5453);
	float glum = dot(col, vec3(0.299, 0.587, 0.114));
	if (bodycam > 0.001) {
		// A small sensor told to see in the dark: exposure pushed right up,
		// the highlights blown and smeared, a cold cast, colour thinned, and
		// heavy noise in everything (worst in the shadows).
		// Exposure a little hot, highlights rolling off, colour a touch thin
		// and cool: a body camera's video, not a film.
		vec3 pushed = 1.0 - exp(-col * 1.9);
		float pl = dot(pushed, vec3(0.299, 0.587, 0.114));
		pushed = mix(vec3(pl), pushed, 0.85) * vec3(0.97, 1.0, 1.03);
		pushed = (pushed - 0.5) * 1.08 + 0.5;
		col = mix(col, pushed, bodycam);
		// Soft darkening into the corners (not black).
		col *= 1.0 - bodycam * 0.45 * smoothstep(0.5, 1.1, edge);
		float bn = fract(sin(dot(floor(FRAGCOORD.xy) + fract(t * 11.7) * vec2(91.7, 43.3), vec2(12.9898, 78.233))) * 43758.5453);
		col += (bn - 0.5) * bodycam * (0.015 + 0.03 * (1.0 - clamp(glum * 2.0, 0.0, 1.0)));
	}
	col += (gn - 0.5) * grain * (1.25 - clamp(glum, 0.0, 1.0));
	if (static_amt > 0.001) {
		// Snow: coarse noise, rolling bright bars, the picture torn sideways.
		vec2 cell = floor(FRAGCOORD.xy / 2.0);
		float sn = fract(sin(dot(cell + fract(t * 23.1) * vec2(517.3, 271.9), vec2(12.9898, 78.233))) * 43758.5453);
		float bar = smoothstep(0.85, 1.0, sin(SCREEN_UV.y * 9.0 - t * 7.0)) * 0.25;
		vec3 snow = vec3(sn * 0.85 + bar);
		col = mix(col, snow, static_amt);
	}
	col *= 1.0 - black;
	COLOR = vec4(col, 1.0);
}
"""

var _rect: ColorRect
var _mat: ShaderMaterial


func _ready() -> void:
	_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = SHADER
	_mat.shader = sh
	_rect = ColorRect.new()
	_rect.material = _mat
	_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_rect)
	set_bodycam(Game.bodycam)


func set_bodycam(on: bool) -> void:
	_mat.set_shader_parameter("bodycam", 1.0 if on else 0.0)


func set_static(amount: float) -> void:
	_mat.set_shader_parameter("static_amt", clampf(amount, 0.0, 1.0))


func set_high(level: float, time: float, jolt := 0.0) -> void:
	_mat.set_shader_parameter("high", level)
	_mat.set_shader_parameter("t", time)
	_mat.set_shader_parameter("pulse", jolt)


func set_vitals(loss: float, dark: float) -> void:
	_mat.set_shader_parameter("blood_loss", loss)
	_mat.set_shader_parameter("black", dark)


func set_deaf(level: float) -> void:
	_mat.set_shader_parameter("deaf", level)


func set_hurt(level: float) -> void:
	_mat.set_shader_parameter("hurt", level)


## Camera turn this frame (radians, yaw/pitch) and field of view: sets the
## motion blur for the frame. Only a fraction of the frame is "exposed", so
## the smear stays weak.
func set_motion(d_yaw: float, d_pitch: float, fov_deg: float, aspect: float) -> void:
	var v_fov := deg_to_rad(fov_deg)
	var h_fov := 2.0 * atan(tan(v_fov * 0.5) * aspect)
	var b := Vector2(d_yaw / h_fov, -d_pitch / v_fov) * 0.35
	_mat.set_shader_parameter("blur", b.limit_length(0.02))
