extends Node3D
## Smoke as a volume, not particles: a grid of smoke density around where it
## is being made, carried by the air and drawn by marching through it. Every
## puff that goes into the same patch of air is the same smoke - two drags
## and a friend's breath make one cloud - and it rises, curls, spreads and
## thins the way smoke does.
##
## One SmokeField is a box of air (CELLS cells of CELL metres). The manager
## (smoke_air.gd) makes one where smoke is let out and nothing is there yet,
## and drops it once it has cleared. The air moves by itself: the breeze,
## warm smoke rising, slow curling eddies, and the push of a breath ("jets")
## that dies away in a second or so. Every frame, on the GPU (a compute
## shader), the density is carried along that air (semi-Lagrangian), spreads
## a little and thins, and new smoke goes in; the picture is drawn from the
## same 3D texture by a raymarching shader, lit by the sun through the smoke
## itself and stopping at whatever is in the way.

const CELLS := Vector3i(48, 36, 48)     # (the same box as 64x48x64 of 6 cm, a third of the cells)
const CELL := 0.08
const MAX_SOURCES := 64

const SIM := """
#version 450
layout(local_size_x = 4, local_size_y = 4, local_size_z = 4) in;

layout(set = 0, binding = 0, r16f) uniform restrict readonly image3D src;
layout(set = 0, binding = 1, r16f) uniform restrict writeonly image3D dst;
struct Source { vec4 pos_amount; vec4 vel_radius; };
layout(set = 0, binding = 2, std430) restrict readonly buffer Sources { Source s[]; } srcs;
// The same density laid out flat for drawing: the z slices side by side,
// ATLAS_COLS to a row.
layout(set = 0, binding = 3, r16f) uniform restrict writeonly image2D atlas;
layout(push_constant, std430) uniform Params {
	vec4 size_cell;   // cells xyz, cell size (m)
	vec4 wind_dt;     // breeze xyz (m/s), dt
	vec4 misc;        // time, number of sources, keep (per step), spread (0..1)
} P;

ivec3 N;

// Trilinear read at normalised coordinates (outside the box: clear air).
float sample3(vec3 uvw) {
	vec3 c = uvw * vec3(N) - 0.5;
	ivec3 i0 = ivec3(floor(c));
	vec3 f = c - vec3(i0);
	float r = 0.0;
	for (int k = 0; k < 8; k++) {
		ivec3 o = ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
		ivec3 q = i0 + o;
		if (all(greaterThanEqual(q, ivec3(0))) && all(lessThan(q, N))) {
			vec3 w = mix(1.0 - f, f, vec3(o));
			r += imageLoad(src, q).r * w.x * w.y * w.z;
		}
	}
	return r;
}

void main() {
	N = ivec3(P.size_cell.xyz);
	ivec3 id = ivec3(gl_GlobalInvocationID);
	ivec3 n = ivec3(P.size_cell.xyz);
	if (any(greaterThanEqual(id, n))) {
		return;
	}
	float cell = P.size_cell.w;
	vec3 ext = vec3(n) * cell;
	vec3 half_ext = ext * 0.5;
	vec3 p = (vec3(id) + 0.5) * cell - half_ext;
	vec3 uvw0 = (vec3(id) + 0.5) / vec3(n);
	float d0 = sample3(uvw0).r;
	float dt = P.wind_dt.w;
	float time = P.misc.x;
	int ns = int(P.misc.y);
	// The air here: the breeze, warm smoke rising, eddies, breaths.
	vec3 v = P.wind_dt.xyz + vec3(0.0, 0.1 + 0.16 * min(d0, 1.0), 0.0);
	float s = 3.1;
	float t = time * 0.4;
	v.x += 0.07 * (sin(p.y * s + t) - cos(p.z * s * 0.8 - t * 0.7)) + 0.03 * sin(p.y * s * 2.7 - t * 1.9);
	v.y += 0.04 * (sin(p.z * s * 1.1 + t * 0.6) - cos(p.x * s + t));
	v.z += 0.07 * (sin(p.x * s * 0.9 - t * 0.8) - cos(p.y * s * 1.2 + t * 0.4)) + 0.03 * cos(p.x * s * 2.3 + t * 1.7);
	// Small, quick curls (what tears a thread of smoke into wisps), stronger
	// where the smoke is thin and has slowed.
	float s2 = s * 3.7;
	float t2 = time * 1.3;
	float small = 0.05 * (1.0 - 0.5 * min(d0, 1.0));
	v.x += small * sin(p.z * s2 + t2) * cos(p.y * s2 * 0.7 - t2);
	v.y += small * 0.6 * sin(p.x * s2 * 0.8 - t2 * 0.9);
	v.z += small * cos(p.x * s2 * 1.1 + t2 * 0.7) * sin(p.y * s2 * 0.9 + t2);
	for (int i = 0; i < ns; i++) {
		vec3 jv = srcs.s[i].vel_radius.xyz;
		if (dot(jv, jv) > 0.0) {
			float r = srcs.s[i].vel_radius.w * 1.6;
			vec3 dp = p - srcs.s[i].pos_amount.xyz;
			v += jv * exp(-dot(dp, dp) / (r * r));
		}
	}
	// Carried: what was upstream comes here.
	vec3 back = (p - v * dt + half_ext) / ext;
	float keep = P.misc.z;
	float val = sample3(back).r;
	// Spreading a little.
	vec3 tx = 1.0 / vec3(n);
	float nb = sample3(back + vec3(tx.x, 0.0, 0.0)).r + sample3(back - vec3(tx.x, 0.0, 0.0)).r
			+ sample3(back + vec3(0.0, tx.y, 0.0)).r + sample3(back - vec3(0.0, tx.y, 0.0)).r
			+ sample3(back + vec3(0.0, 0.0, tx.z)).r + sample3(back - vec3(0.0, 0.0, tx.z)).r;
	val = mix(val, nb / 6.0, P.misc.w) * keep;
	// New smoke.
	for (int i = 0; i < ns; i++) {
		float amt = srcs.s[i].pos_amount.w;
		if (amt > 0.0) {
			float r = max(srcs.s[i].vel_radius.w, cell * 0.7);
			vec3 dp = p - srcs.s[i].pos_amount.xyz;
			float q = dot(dp, dp) / (r * r);
			if (q < 6.0) {
				// Normalised: `amount` is the same smoke whatever the radius.
				val += amt * exp(-q) * (cell * cell * cell) / (5.568 * r * r * r);
			}
		}
	}
	// At the sides of the box it drifts off into the open.
	vec3 e = min(vec3(id), vec3(n - 1) - vec3(id));
	float edge = min(min(e.x, e.y), e.z);
	val *= smoothstep(0.0, 3.0, edge);
	val = min(val, 30.0);
	imageStore(dst, id, vec4(val));
	ivec2 tile = ivec2(id.z % 8, id.z / 8);
	imageStore(atlas, id.xy + tile * n.xy, vec4(val));
}
"""

const SHADER := """
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_never, depth_test_disabled, blend_mix, shadows_disabled;

uniform sampler2D atlas : filter_linear, repeat_disable;
uniform vec3 cells;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;
uniform vec3 half_size;
uniform vec3 sun_dir = vec3(0.5, 0.8, 0.3);   // towards the sun, world
uniform vec3 sun_col = vec3(1.0, 0.96, 0.9);
uniform vec3 ambient = vec3(0.55, 0.58, 0.62);
uniform vec3 tint = vec3(0.84, 0.85, 0.88);
uniform float thickness = 60.0;                // extinction per unit density per metre

// One z slice, bilinear inside its tile (kept off the tile's edges).
float slice(vec2 cxy, float z) {
	vec2 tile = vec2(mod(z, 8.0), floor(z / 8.0));
	vec2 px = clamp(cxy + 0.5, vec2(0.5), cells.xy - 0.5) + tile * cells.xy;
	return texture(atlas, px / (cells.xy * vec2(8.0, ceil(cells.z / 8.0)))).r;
}

uniform float time;
uniform int steps = 40;

float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
			mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
			mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
			mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float dens(vec3 p) {
	vec3 uvw = p / (2.0 * half_size) + 0.5;
	if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) {
		return 0.0;
	}
	vec3 c = uvw * cells - 0.5;
	float z0 = clamp(floor(c.z), 0.0, cells.z - 1.0);
	float z1 = min(z0 + 1.0, cells.z - 1.0);
	float d = mix(slice(c.xy, z0), slice(c.xy, z1), clamp(c.z - z0, 0.0, 1.0));
	if (d < 0.0005) {
		return 0.0;
	}
	// Finer than the grid: ragged edges and wisps, drifting up with the smoke.
	vec3 q = p * 22.0 + vec3(0.0, -time * 0.6, time * 0.2);
	float n = noise(q) * 0.65 + noise(q * 2.3 + 7.1) * 0.35;
	return d * clamp(n * 1.9 - 0.35, 0.0, 1.6);
}

void fragment() {
	// The ray from the eye through this pixel, in the box's own space.
	vec3 cam_w = INV_VIEW_MATRIX[3].xyz;
	vec3 frag_w = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	mat4 inv_model = inverse(MODEL_MATRIX);
	vec3 ro = (inv_model * vec4(cam_w, 1.0)).xyz;
	vec3 rd = normalize((inv_model * vec4(frag_w, 1.0)).xyz - ro);
	vec3 inv_d = 1.0 / rd;
	vec3 t0 = (-half_size - ro) * inv_d;
	vec3 t1 = (half_size - ro) * inv_d;
	vec3 tmin = min(t0, t1);
	vec3 tmax = max(t0, t1);
	float t_in = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
	float t_out = min(min(tmax.x, tmax.y), tmax.z);
	// It stops at whatever is in the way (walls, people, the ground).
	float depth = texture(depth_tex, SCREEN_UV).r;
	vec4 view = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, depth, 1.0);
	view.xyz /= view.w;
	vec3 hit_w = (INV_VIEW_MATRIX * vec4(view.xyz, 1.0)).xyz;
	t_out = min(t_out, length((inv_model * vec4(hit_w, 1.0)).xyz - ro));
	if (t_out <= t_in) {
		discard;
	}
	vec3 sun_l = normalize((inv_model * vec4(sun_dir, 0.0)).xyz);
	int STEPS = steps;
	float dt = (t_out - t_in) / float(STEPS);
	float jitter = fract(sin(dot(FRAGCOORD.xy, vec2(12.9898, 78.233))) * 43758.5453);
	float trans = 1.0;
	vec3 light = vec3(0.0);
	for (int i = 0; i < STEPS; i++) {
		vec3 p = ro + rd * (t_in + (float(i) + jitter) * dt);
		float d = dens(p);
		if (d > 0.001) {
			// Light getting here from the sun, through the smoke on the way.
			// (one look towards the sun: the smoke between shades this point)
			float sh = dens(p + sun_l * 0.12) * 2.4;
			vec3 l = ambient + sun_col * exp(-sh * thickness * 0.08);
			float a = 1.0 - exp(-d * thickness * dt);
			light += trans * a * l * tint;
			trans *= 1.0 - a;
			if (trans < 0.02) {
				break;
			}
		}
	}
	if (trans > 0.998) {
		discard;
	}
	ALBEDO = light / max(1.0 - trans, 1e-3);
	ALPHA = 1.0 - trans;
}
"""

static var _rd: RenderingDevice
static var _shader: RID
static var _pipeline: RID

var air: Node                    # the manager (wind, sun)
var total := 0.0                 # about how much smoke is in it
var _pending: Array = []         # [local pos, amount, radius, velocity] this frame
var _jets: Array = []            # [local pos, velocity, radius, life]
var _time := 0.0
var _empty_t := 0.0
var _skip := false
var _acc_dt := 0.0
var _tex_a: RID                  # the density (sampled)
var _tex_b: RID                  # the next step (written)
var _buf: RID
var _set: RID
var _atlas: RID                  # the density laid flat, for drawing
var _atlas_tex: Texture2DRD
var _mat: ShaderMaterial
var _box: MeshInstance3D
var _ok := false


static func size() -> Vector3:
	return Vector3(CELLS) * CELL


func _ready() -> void:
	_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = SHADER
	_mat.shader = sh
	_mat.set_shader_parameter("half_size", size() * 0.5)
	_mat.set_shader_parameter("cells", Vector3(CELLS))
	_box = MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size()
	_box.mesh = bm
	_box.material_override = _mat
	_box.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_box)
	_mat.set_shader_parameter("steps", [20, 30, 44][clampi(Game.quality, 0, 2)])
	RenderingServer.call_on_render_thread(_create)


## GPU side: the shared compute pipeline, two density textures and the
## sources buffer.
func _create() -> void:
	if _rd == null:
		_rd = RenderingServer.get_rendering_device()
		if _rd == null:
			return
		var src := RDShaderSource.new()
		src.language = RenderingDevice.SHADER_LANGUAGE_GLSL
		src.source_compute = SIM
		var spirv := _rd.shader_compile_spirv_from_source(src)
		if spirv.compile_error_compute != "":
			push_error("smoke sim: " + spirv.compile_error_compute)
			_rd = null
			return
		_shader = _rd.shader_create_from_spirv(spirv)
		_pipeline = _rd.compute_pipeline_create(_shader)
	var fmt := RDTextureFormat.new()
	fmt.texture_type = RenderingDevice.TEXTURE_TYPE_3D
	fmt.width = CELLS.x
	fmt.height = CELLS.y
	fmt.depth = CELLS.z
	fmt.format = RenderingDevice.DATA_FORMAT_R16_SFLOAT
	fmt.usage_bits = RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT | RenderingDevice.TEXTURE_USAGE_STORAGE_BIT \
			| RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT | RenderingDevice.TEXTURE_USAGE_CAN_COPY_TO_BIT \
			| RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT
	var zeros := PackedByteArray()
	zeros.resize(CELLS.x * CELLS.y * CELLS.z * 2)
	_tex_a = _rd.texture_create(fmt, RDTextureView.new(), [zeros])
	_tex_b = _rd.texture_create(fmt, RDTextureView.new(), [zeros])
	var af := RDTextureFormat.new()
	af.texture_type = RenderingDevice.TEXTURE_TYPE_2D
	af.width = CELLS.x * 8
	af.height = CELLS.y * ceili(CELLS.z / 8.0)
	af.format = RenderingDevice.DATA_FORMAT_R16_SFLOAT
	af.usage_bits = RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT | RenderingDevice.TEXTURE_USAGE_STORAGE_BIT | RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT
	var az := PackedByteArray()
	az.resize(af.width * af.height * 2)
	_atlas = _rd.texture_create(af, RDTextureView.new(), [az])
	var bytes := PackedByteArray()
	bytes.resize(MAX_SOURCES * 32)
	_buf = _rd.storage_buffer_create(bytes.size(), bytes)
	var u0 := RDUniform.new()
	u0.uniform_type = RenderingDevice.UNIFORM_TYPE_IMAGE
	u0.binding = 0
	u0.add_id(_tex_a)
	var u1 := RDUniform.new()
	u1.uniform_type = RenderingDevice.UNIFORM_TYPE_IMAGE
	u1.binding = 1
	u1.add_id(_tex_b)
	var u2 := RDUniform.new()
	u2.uniform_type = RenderingDevice.UNIFORM_TYPE_STORAGE_BUFFER
	u2.binding = 2
	u2.add_id(_buf)
	var u3 := RDUniform.new()
	u3.uniform_type = RenderingDevice.UNIFORM_TYPE_IMAGE
	u3.binding = 3
	u3.add_id(_atlas)
	_set = _rd.uniform_set_create([u0, u1, u2, u3], _shader, 0)

	_ok = true
	call_deferred("_bind_texture")


func _bind_texture() -> void:
	_atlas_tex = Texture2DRD.new()
	_atlas_tex.texture_rd_rid = _atlas
	_mat.set_shader_parameter("atlas", _atlas_tex)


func contains(p: Vector3, margin := 0.35) -> bool:
	var l := p - global_position
	var h := size() * 0.5 - Vector3.ONE * margin
	return absf(l.x) < h.x and absf(l.y) < h.y and absf(l.z) < h.z


## Lets out smoke: `amount` (about 1 is the smoke of one breath) spread over
## `radius` metres at `pos`, pushed off at `vel` (a breath's own push).
func add(pos: Vector3, amount: float, radius: float, vel := Vector3.ZERO) -> void:
	var l := pos - global_position
	_pending.append([l, amount, radius, Vector3.ZERO])
	if vel.length() > 0.05:
		# Breaths overlapping in time and place are one jet.
		for j in _jets:
			if (j[0] as Vector3).distance_to(l) < 0.12 and float(j[3]) > 0.7:
				j[1] = (j[1] as Vector3).lerp(vel, 0.3)
				return
		_jets.append([l, vel, maxf(radius * 1.5, 0.06), 1.0])
	total += amount
	_empty_t = 0.0


func _process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["smoke_field._process"] = Game.prof.get("smoke_field._process", 0) + __d
	Game.prof["max smoke_field._process"] = maxi(Game.prof.get("max smoke_field._process", 0), __d)


func _process_real(delta: float) -> void:
	_time += delta
	_mat.set_shader_parameter("time", _time)
	if air:
		_mat.set_shader_parameter("sun_dir", air.sun_dir)
		_mat.set_shader_parameter("sun_col", air.sun_col)
		_mat.set_shader_parameter("ambient", air.ambient)
	# Jets carry on and die away.
	var still: Array = []
	for j in _jets:
		j[0] = (j[0] as Vector3) + (j[1] as Vector3) * delta
		j[1] = (j[1] as Vector3) * exp(-delta * 2.0)
		j[2] = float(j[2]) + delta * 0.2
		j[3] = float(j[3]) - delta * 0.7
		if float(j[3]) > 0.0 and (j[1] as Vector3).length() > 0.04:
			still.append(j)
	_jets = still
	var keep := exp(-delta * 0.08)
	total *= keep
	if total < 0.05:
		_empty_t += delta
	if not _ok:
		_pending.clear()
		return
	# This frame's sources: new smoke, then the breaths still pushing.
	var bytes := PackedFloat32Array()
	var n := 0
	for a in _pending:
		if n >= MAX_SOURCES:
			break
		var p: Vector3 = a[0]
		bytes.append_array([p.x, p.y, p.z, float(a[1]), 0.0, 0.0, 0.0, float(a[2])])
		n += 1
	for j in _jets:
		if n >= MAX_SOURCES:
			break
		var p: Vector3 = j[0]
		var v: Vector3 = j[1]
		bytes.append_array([p.x, p.y, p.z, 0.0, v.x, v.y, v.z, float(j[2])])
		n += 1
	_pending.clear()
	# Next to nothing left in it: not drawn, not worked out.
	_box.visible = total > 0.015 or n > 0
	if not _box.visible:
		return
	# Far off or out of sight, the air is worked out every other frame.
	_skip = not _skip
	var cam := get_viewport().get_camera_3d()
	var far := cam != null and (cam.global_position.distance_to(global_position) > 12.0 or not cam.is_position_in_frustum(global_position))
	if far and _skip and n == 0:
		_acc_dt += delta
		return
	delta += _acc_dt
	_acc_dt = 0.0
	keep = exp(-delta * 0.08)
	var wind: Vector3 = air.wind if air else Vector3.ZERO
	var push := PackedFloat32Array([CELLS.x, CELLS.y, CELLS.z, CELL, wind.x, wind.y, wind.z, minf(delta, 0.05),
			_time, n, keep, clampf(delta * 2.0, 0.0, 0.3)])
	RenderingServer.call_on_render_thread(_dispatch.bind(bytes.to_byte_array(), push.to_byte_array()))


func _dispatch(sources: PackedByteArray, push: PackedByteArray) -> void:
	if not _ok:
		return
	if sources.size() > 0:
		_rd.buffer_update(_buf, 0, sources.size(), sources)
	var cl := _rd.compute_list_begin()
	_rd.compute_list_bind_compute_pipeline(cl, _pipeline)
	_rd.compute_list_bind_uniform_set(cl, _set, 0)
	_rd.compute_list_set_push_constant(cl, push, push.size())
	_rd.compute_list_dispatch(cl, ceili(CELLS.x / 4.0), ceili(CELLS.y / 4.0), ceili(CELLS.z / 4.0))
	_rd.compute_list_end()
	if OS.has_environment("SMOKE_DBG") and Engine.get_frames_drawn() % 30 == 0:
		var data := _rd.texture_get_data(_atlas, 0)
		var sum := 0.0
		var mx := 0.0
		for i in range(0, data.size(), 2):
			var v := data.decode_half(i)
			sum += v
			mx = maxf(mx, v)
		print("DBG smoke atlas sum=%.3f max=%.3f sources=%d" % [sum, mx, sources.size() / 32])
	# The new step becomes the one that is sampled (by the next step and the picture).
	_rd.texture_copy(_tex_b, _tex_a, Vector3.ZERO, Vector3.ZERO, Vector3(CELLS), 0, 0, 0, 0)


func is_clear() -> bool:
	return _empty_t > 3.0


func _exit_tree() -> void:
	if _ok:
		_ok = false
		_mat.set_shader_parameter("atlas", null)
		var rids := [_set, _buf, _tex_a, _tex_b, _atlas]
		RenderingServer.call_on_render_thread(func():
			for r in rids:
				if r.is_valid():
					_rd.free_rid(r))
