extends Node3D
## A patch of wall (or floor, car, anything) that gets sprayed on. The paint
## is really laid down: each puff of the can is a soft round spot of colour
## with a fine overspray round it, drawn into this patch's texture, and it
## stays there. The texture is laid onto the surface by a projecting box
## (shaders/paint_projector.gdshader), so painting into it costs nothing to
## show (an engine decal would repack its whole atlas every time).
## Local space: Y out of the surface; X runs along it, Z down it (texture u
## along X, v along Z).

const PX_PER_M := 120.0

const Projector = preload("res://shaders/paint_projector.gdshader")

var img: Image
var tex: ImageTexture
var size := Vector3.ONE
var _mi: MeshInstance3D
var _mat: ShaderMaterial
var _dirty := false
var _flush_t := 0.0
var reward := 10                 # what cleaning it off earns (stain.gd sets its own)
var dirt_kind := "paint"
var _total := -1.0               # how much there was to clean (sum of alpha), counted at the first scrub
var _left := -1.0
var _gone := false

static var all: Array = []          # every sprayed patch there is (to paint on again)


func _enter_tree() -> void:
	all.append(self)


func _exit_tree() -> void:
	all.erase(self)


## The patch already on this surface at `p` (facing `n`), if there is one
## with room round the point.
static func find(p: Vector3, n: Vector3, margin := 0.1) -> Node:
	for g in all:
		if not is_instance_valid(g):
			continue
		if (g.global_basis.y.normalized()).dot(n) < 0.9:
			continue
		var l: Vector3 = g.to_local(p)
		if absf(l.y) < 0.08 and absf(l.x) < g.size.x * 0.5 - margin and absf(l.z) < g.size.z * 0.5 - margin:
			return g
	return null


## Covers `extent` (width, height, in metres) of the wall at `point` (the
## middle), the wall facing `normal`.
static var from_net := false       # (being made / painted on from another game's word)


func setup(point: Vector3, normal: Vector3, extent: Vector2) -> void:
	if not from_net:
		Net.graffiti_made.call_deferred(self, point, normal, extent)
	var n := normal.normalized()
	var x := Vector3.UP.cross(n)
	# (on a floor or a ceiling there is no "along the wall": any way will do)
	x = x.normalized() if x.length() > 0.1 else Vector3.RIGHT
	var z := x.cross(n).normalized()          # down the wall
	global_transform = Transform3D(Basis(x, n, z), point)
	size = Vector3(extent.x, 0.5, extent.y)
	img = Image.create(int(extent.x * PX_PER_M), int(extent.y * PX_PER_M), true, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	tex = ImageTexture.create_from_image(img)
	_mat = ShaderMaterial.new()
	_mat.shader = Projector
	_mat.set_shader_parameter("paint", tex)
	_mat.set_shader_parameter("box_up", n)
	_mat.set_shader_parameter("world_to_box", Projection(Transform3D(Basis.from_scale(Vector3.ONE / size), Vector3.ZERO) * global_transform.affine_inverse()))
	_mi = MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	_mi.mesh = box
	_mi.material_override = _mat
	_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_mi)


## Where on the wall (metres from the middle, x along, y up) a world point is.
func wall_xy(p: Vector3) -> Vector2:
	var l := to_local(p)
	return Vector2(l.x, -l.z)


func wall_point(xy: Vector2) -> Vector3:
	return to_global(Vector3(xy.x, 0.0, -xy.y))


## One puff of paint at wall position `xy` (metres): full colour in a core of
## `radius`, fading out, with a speckle of overspray beyond it. The puff is a
## ready-made brush image blended in by the engine (not pixel by pixel here),
## so a can going all the time costs next to nothing.
func spray(xy: Vector2, color: Color, radius: float, strength := 1.0) -> void:
	if not from_net:
		Net.graffiti_spray(self, xy, color, radius, strength)
	var w := img.get_width()
	var h := img.get_height()
	var cx := (xy.x / size.x + 0.5) * w
	var cy := (0.5 - xy.y / size.z) * h
	var brush := _brush(color, radius * PX_PER_M, strength)
	var half := brush.get_width() / 2
	var at := Vector2i(int(cx) - half, int(cy) - half)
	var src := Rect2i(Vector2i.ZERO, brush.get_size())
	# (clipped to the image by hand: blend_rect wants the part inside)
	var lo := Vector2i(maxi(-at.x, 0), maxi(-at.y, 0))
	var hi := Vector2i(mini(src.size.x, w - at.x), mini(src.size.y, h - at.y))
	if hi.x <= lo.x or hi.y <= lo.y:
		return
	img.blend_rect(brush, Rect2i(lo, hi - lo), at + lo)
	_dirty = true


static var _brushes := {}


## A puff of paint as an image: solid middle, soft edge, loose specks round
## it (a few variants, picked at random so it does not repeat).
static func _brush(color: Color, r: float, strength: float) -> Image:
	# (sizes in half-pixel steps, a few variants each: a handful of images)
	r = maxf(roundf(r * 2.0) * 0.5, 1.0)
	var key := "%s_%d_%d_%d" % [color.to_html(), int(r * 2.0), int(strength * 10.0), randi() % 3]
	if _brushes.has(key):
		return _brushes[key]
	var reach := int(ceil(r * 2.2))
	var n := reach * 2 + 1
	var b := Image.create(n, n, false, Image.FORMAT_RGBA8)
	b.fill(Color(color.r, color.g, color.b, 0.0))
	for y in n:
		for x in n:
			var d := Vector2(x - reach, y - reach).length() / r
			var a := 0.0
			if d < 1.0:
				a = (1.0 - d * d * 0.6) * 0.55
			elif d < 2.2 and randf() < 0.18 * (2.2 - d):
				a = 0.35 * (2.2 - d)
			if a > 0.0:
				b.set_pixel(x, y, Color(color.r, color.g, color.b, clampf(a * strength, 0.0, 1.0)))
	_brushes[key] = b
	return b


func _process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["graffiti._process"] = Game.prof.get("graffiti._process", 0) + __d
	Game.prof["max graffiti._process"] = maxi(Game.prof.get("max graffiti._process", 0), __d)


func _process_real(delta: float) -> void:
	_flush_t -= delta
	if _dirty and _flush_t <= 0.0:
		_flush_t = 0.05
		_dirty = false
		img.generate_mipmaps()
		tex.update(img)


## Letters as the lines a writer's can follows (0..0.7 across, 0..1 up):
## sprayed thick they come out as round bubble letters.
const FONT := {
	"A": [[Vector2(0.0, 0.0), Vector2(0.35, 1.0), Vector2(0.7, 0.0)], [Vector2(0.15, 0.4), Vector2(0.55, 0.4)]],
	"B": [[Vector2(0.0, 0.0), Vector2(0.0, 1.0), Vector2(0.42, 1.0), Vector2(0.6, 0.85), Vector2(0.45, 0.56), Vector2(0.0, 0.56)],
			[Vector2(0.45, 0.56), Vector2(0.66, 0.36), Vector2(0.52, 0.02), Vector2(0.0, 0.0)]],
	"C": [[Vector2(0.68, 0.85), Vector2(0.45, 1.0), Vector2(0.18, 0.92), Vector2(0.02, 0.6), Vector2(0.05, 0.25), Vector2(0.25, 0.02), Vector2(0.5, 0.0), Vector2(0.7, 0.15)]],
	"D": [[Vector2(0.0, 0.0), Vector2(0.0, 1.0), Vector2(0.38, 1.0), Vector2(0.66, 0.72), Vector2(0.66, 0.28), Vector2(0.4, 0.0), Vector2(0.0, 0.0)]],
	"E": [[Vector2(0.65, 1.0), Vector2(0.0, 1.0), Vector2(0.0, 0.0), Vector2(0.68, 0.0)], [Vector2(0.0, 0.52), Vector2(0.5, 0.52)]],
	"I": [[Vector2(0.35, 0.0), Vector2(0.35, 1.0)]],
	"K": [[Vector2(0.0, 0.0), Vector2(0.0, 1.0)], [Vector2(0.66, 1.0), Vector2(0.02, 0.45), Vector2(0.7, 0.0)]],
	"L": [[Vector2(0.02, 1.0), Vector2(0.0, 0.0), Vector2(0.66, 0.0)]],
	"M": [[Vector2(0.0, 0.0), Vector2(0.02, 1.0), Vector2(0.35, 0.45), Vector2(0.68, 1.0), Vector2(0.7, 0.0)]],
	"N": [[Vector2(0.0, 0.0), Vector2(0.0, 1.0), Vector2(0.66, 0.0), Vector2(0.66, 1.0)]],
	"O": [[Vector2(0.35, 1.0), Vector2(0.62, 0.86), Vector2(0.7, 0.5), Vector2(0.62, 0.14), Vector2(0.35, 0.0), Vector2(0.08, 0.14),
			Vector2(0.0, 0.5), Vector2(0.08, 0.86), Vector2(0.35, 1.0)]],
	"R": [[Vector2(0.0, 0.0), Vector2(0.0, 1.0), Vector2(0.42, 1.0), Vector2(0.62, 0.82), Vector2(0.45, 0.55), Vector2(0.0, 0.55)],
			[Vector2(0.3, 0.55), Vector2(0.68, 0.0)]],
	"S": [[Vector2(0.66, 0.88), Vector2(0.4, 1.0), Vector2(0.1, 0.9), Vector2(0.06, 0.66), Vector2(0.35, 0.52), Vector2(0.64, 0.36),
			Vector2(0.6, 0.1), Vector2(0.3, 0.0), Vector2(0.02, 0.12)]],
	"T": [[Vector2(0.0, 1.0), Vector2(0.7, 1.0)], [Vector2(0.35, 1.0), Vector2(0.35, 0.0)]],
	"X": [[Vector2(0.0, 0.0), Vector2(0.7, 1.0)], [Vector2(0.0, 1.0), Vector2(0.7, 0.0)]],
	"Y": [[Vector2(0.0, 1.0), Vector2(0.35, 0.5), Vector2(0.7, 1.0)], [Vector2(0.35, 0.5), Vector2(0.35, 0.0)]],
	"Z": [[Vector2(0.02, 1.0), Vector2(0.66, 1.0), Vector2(0.0, 0.0), Vector2(0.7, 0.0)]],
}
const WORDS := ["BLOOD", "TOXIC", "KRAK", "ROZA", "DEAD", "SKAM", "NOIR", "ZERO", "MARK", "ONYX", "BORZ", "STOK", "KOMA", "LEXA"]

## Coats, in order: the drop shadow, the thick outline, the fill, the white
## shine - each [offset on the wall (m), radius of the spray (m), strength].
const COATS := [[Vector2(0.028, -0.03), 0.062, 0.9], [Vector2.ZERO, 0.058, 1.0], [Vector2.ZERO, 0.038, 1.0], [Vector2(-0.012, 0.014), 0.009, 0.95]]


## A piece to paint: a word in bubble letters, as the strokes (polylines in
## wall metres, round the middle) the can follows; each letter tilted and
## bounced a little so it has life. Each stroke is [points, shine?]: the
## shine coat only goes over the first part of each stroke.
static func make_tag(rng: RandomNumberGenerator, width: float, height: float) -> Array:
	var word: String = WORDS[rng.randi() % WORDS.size()]
	var n := word.length()
	var unit := minf(width / (n * 0.95), height)
	var total := n * 0.95 * unit
	var x0 := -total * 0.5
	var strokes: Array = []
	for i in n:
		var ch := word.substr(i, 1)
		if not FONT.has(ch):
			continue
		var tilt := rng.randf_range(-0.12, 0.12)
		var bounce := rng.randf_range(-0.08, 0.08) * unit
		var lean := 0.12
		var c := Vector2(x0 + (i * 0.95 + 0.35) * unit, bounce)
		for line in FONT[ch]:
			var out := PackedVector2Array()
			# Densified, so the can goes round the curves.
			var pts: Array = line
			for k in pts.size():
				var p: Vector2 = pts[k]
				if k > 0:
					var q: Vector2 = pts[k - 1]
					var steps := int(ceil(q.distance_to(p) / 0.12))
					for s in range(1, steps):
						out.append(_place(q.lerp(p, float(s) / steps), c, unit, tilt, lean))
				out.append(_place(p, c, unit, tilt, lean))
			strokes.append([out, false])
	return strokes


static func _place(p: Vector2, c: Vector2, unit: float, tilt: float, lean: float) -> Vector2:
	var q := Vector2((p.x - 0.35 + (p.y - 0.5) * lean) * unit, (p.y - 0.5) * unit)
	return c + q.rotated(tilt)


## Scrubbing at `xy` (metres on the patch): the paint / dirt within `radius`
## comes off by `amount` (0..1) at the middle, less towards the edge.
## Returns how much of the whole is left (0..1).
func scrub(xy: Vector2, radius: float, amount: float) -> float:
	if not from_net:
		Net.stain_scrub(self, xy, radius, amount)
	var w := img.get_width()
	var h := img.get_height()
	if _total < 0.0:
		_total = 0.0
		for y in range(0, h, 2):
			for x in range(0, w, 2):
				_total += img.get_pixel(x, y).a
		_total *= 4.0
		_left = _total
	var cx := (xy.x / size.x + 0.5) * w
	var cy := (0.5 - xy.y / size.z) * h
	var r := radius * PX_PER_M
	var removed := 0.0
	for y in range(maxi(int(cy - r), 0), mini(int(cy + r) + 1, h)):
		for x in range(maxi(int(cx - r), 0), mini(int(cx + r) + 1, w)):
			var c := img.get_pixel(x, y)
			if c.a <= 0.0:
				continue
			var d := Vector2(x - cx, y - cy).length() / r
			if d >= 1.0:
				continue
			var k := amount * (1.0 - d * d)
			var na := maxf(c.a - k, 0.0) if c.a - k > 0.03 else 0.0
			removed += c.a - na
			c.a = na
			img.set_pixel(x, y, c)
	_left = maxf(_left - removed, 0.0)
	_dirty = true
	return left_fraction()


func left_fraction() -> float:
	if _total <= 0.0:
		return 1.0
	return clampf(_left / _total, 0.0, 1.0)


## Clean enough: what is left fades away and the patch goes.
func finish() -> void:
	if _gone:
		return
	_gone = true
	var tw := create_tween()
	tw.tween_method(func(k: float):
		if _mat:
			_mat.set_shader_parameter("fade", k), 1.0, 0.0, 0.8)
	tw.tween_callback(queue_free)
