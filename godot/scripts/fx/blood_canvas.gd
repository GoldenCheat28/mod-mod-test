extends Node
## World blood maps. Blood on the level is not made of decals: it is painted
## into three world-space textures that the level shaders read directly
## (shaders/blood.gdshaderinc):
##   floor  - top-down (x, z), for up-facing surfaces; stores the surface height
##   wall_x - side view (z, y), for surfaces facing +-X; stores the x of the face
##   wall_z - side view (x, y), for surfaces facing +-Z; stores the z of the face
## The stored depth keeps blood on the face it landed on (not on the floor
## below a roof, or the other side of a wall).
##
## Texels: R = film thickness, G = normalised depth, B = normalised time of
## last wetting (drying is computed in the shader), A = coverage. Dabs are
## blended in premultiplied form, so overlapping blood merges into one film.
## Painting is GPU work: a dab is one textured quad drawn into a render target
## that is never cleared.

const BT = preload("res://scripts/fx/blood_tex.gd")

const AREA_MIN := -36.0
const AREA_SIZE := 72.0
const WALL_Y0 := -0.5
const FLOOR_RES := 4096
const WALL_RES := Vector2i(4096, 640)
const DEPTH_MIN := -40.0
const DEPTH_RANGE := 80.0
const TIME_SPAN := 16384.0
const PPM := FLOOR_RES / AREA_SIZE          # pixels per metre on every map
const WALL_HEIGHT := WALL_RES.y / PPM

enum { FLOOR, WALL_X, WALL_Z }

const PAINT_SHADER := """
shader_type canvas_item;
render_mode blend_mix, unshaded;
uniform bool srgb_input = false;
varying vec4 data;
void vertex() {
	data = COLOR;
}
vec3 to_srgb(vec3 c) {
	return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void fragment() {
	vec4 m = texture(TEXTURE, UV);
	vec3 d = srgb_input ? to_srgb(data.rgb) : data.rgb;
	COLOR = vec4(d.r * m.r, d.g, d.b, m.a * data.a);
}
"""


class Painter extends Node2D:
	var items: Array = []   # [texture, centre px, size px, angle, color]

	func _draw() -> void:
		for it in items:
			draw_set_transform(it[1], it[3], Vector2.ONE)
			var s: Vector2 = it[2]
			draw_texture_rect(it[0], Rect2(-s * 0.5, s), false, it[4])
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		items.clear()


var _vps: Array[SubViewport] = []
var _painters: Array[Painter] = []
var _mat: ShaderMaterial
var time := 0.0


func _ready() -> void:
	_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = PAINT_SHADER
	_mat.shader = sh
	_mat.set_shader_parameter("srgb_input", _srgb_input())
	_add_map(Vector2i(FLOOR_RES, FLOOR_RES))
	_add_map(WALL_RES)
	_add_map(WALL_RES)
	RenderingServer.global_shader_parameter_set(&"blood_floor", _vps[FLOOR].get_texture())
	RenderingServer.global_shader_parameter_set(&"blood_wall_x", _vps[WALL_X].get_texture())
	RenderingServer.global_shader_parameter_set(&"blood_wall_z", _vps[WALL_Z].get_texture())
	RenderingServer.global_shader_parameter_set(&"blood_area",
			Vector4(AREA_MIN, AREA_SIZE, WALL_Y0, WALL_HEIGHT))


## In an HDR 2D viewport Godot converts vertex colours from sRGB to linear
## before the shader sees them; the paint shader undoes that so the stored
## numbers are exactly the ones we pass.
func _srgb_input() -> bool:
	return true


func _add_map(res: Vector2i) -> void:
	var vp := SubViewport.new()
	vp.size = res
	vp.transparent_bg = true
	vp.use_hdr_2d = true
	vp.disable_3d = true
	vp.render_target_clear_mode = SubViewport.CLEAR_MODE_NEVER
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	vp.canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_LINEAR
	add_child(vp)
	var p := Painter.new()
	p.material = _mat
	vp.add_child(p)
	_vps.append(vp)
	_painters.append(p)


func _process(_delta: float) -> void:
	RenderingServer.global_shader_parameter_set(&"blood_time", fmod(time, TIME_SPAN))
	for i in _painters.size():
		if not _painters[i].items.is_empty():
			_painters[i].queue_redraw()
			_vps[i].render_target_update_mode = SubViewport.UPDATE_ONCE


## Which map a surface with normal n goes to, or -1 (slanted/overhanging).
static func map_for(n: Vector3) -> int:
	if n.y > 0.55:
		return FLOOR
	var a := n.abs()
	if a.x > a.z and a.x > 0.6:
		return WALL_X
	if a.z > 0.6:
		return WALL_Z
	return -1


func covers(p: Vector3) -> bool:
	return p.x > AREA_MIN and p.z > AREA_MIN and p.x < AREA_MIN + AREA_SIZE and p.z < AREA_MIN + AREA_SIZE


## Paints one dab of blood on the surface at p (normal n). `along` orients the
## texture's +V axis; w/l are the size across/along in metres.
func dab(p: Vector3, n: Vector3, along: Vector3, w: float, l: float, kind: String, variant: int,
		thick := 1.0, alpha := 1.0) -> bool:
	var m := map_for(n)
	if m < 0 or not covers(p):
		return false
	var uv: Vector2
	var dir: Vector2
	var depth: float
	match m:
		FLOOR:
			uv = Vector2(p.x, p.z)
			dir = Vector2(along.x, along.z)
			depth = p.y
		WALL_X:
			uv = Vector2(p.z, p.y)
			dir = Vector2(along.z, along.y)
			depth = p.x
		_:
			uv = Vector2(p.x, p.y)
			dir = Vector2(along.x, along.y)
			depth = p.z
	var px := Vector2(uv.x - AREA_MIN, uv.y - (AREA_MIN if m == FLOOR else WALL_Y0)) * PPM
	var angle := atan2(-dir.x, dir.y) if dir.length() > 1e-4 else randf() * TAU
	var tex: Texture2D = BT.get_pair(kind, variant)[2]
	var col := Color(clampf(thick, 0.0, 1.0), (depth - DEPTH_MIN) / DEPTH_RANGE, fmod(time, TIME_SPAN) / TIME_SPAN, alpha)
	_painters[m].items.append([tex, px, Vector2(w, l) * PPM, angle, col])
	return true
