extends RefCounted
## The blood on one person's body, kept in the body itself: a small volume
## (2 cm cells) laid over him as he stands at rest, each cell holding how
## much blood is on him there and when it got there. His clothes and skin
## (shaders/body_blood.gdshaderinc) find where each point of them is in that
## rest pose and show what is there - so it moves with him however he lies,
## runs on unbroken from one part onto the next, and never goes (it only
## darkens and dries). Painted by the runs of blood going down him
## (blood.gd) and the splashes landing on him.

const CELL := 0.02
const BOX_MIN := Vector3(-0.42, -0.05, -0.32)
const BOX_SIZE := Vector3(0.84, 2.0, 0.64)

var bot: Node3D
var dims := Vector3i.ZERO
var box_min := Vector3.ZERO
var box_size := Vector3.ONE
var cell := CELL
var data := PackedByteArray()     # 2 bytes a cell: amount, time slot (clock mod 256)
var tex: ImageTexture3D
var _dirty := false
var _flush_t := 0.0
# Stains still soaking outwards from a fresh wound: {p (rest), r, t, dur, amount}.
var _blooms: Array = []


func _init(b: Node3D) -> void:
	bot = b
	var s: float = b.scale_factor
	cell = CELL * s
	box_min = BOX_MIN * s
	box_size = BOX_SIZE * s
	dims = Vector3i(ceili(box_size.x / cell), ceili(box_size.y / cell), ceili(box_size.z / cell))
	data.resize(dims.x * dims.y * dims.z * 2)
	data.fill(0)


## Where a point of `part` (world) is in the rest pose.
func rest_of(part: RigidBody3D, world_p: Vector3) -> Vector3:
	var rest: Vector3 = part.get_meta("rest_pos", Vector3.ZERO)
	return rest + part.global_basis.orthonormalized().inverse() * (world_p - part.global_position)


## Blood at `world_p` on `part`: a round patch `r` across, `amount` (0..1)
## of full coverage at its middle.
func paint(part: RigidBody3D, world_p: Vector3, r: float, amount: float) -> void:
	paint_rest(rest_of(part, world_p), r, amount)


func paint_rest(p: Vector3, r: float, amount: float) -> void:
	r = maxf(r, cell * 1.2)
	var lo := ((p - Vector3.ONE * r - box_min) / cell).floor()
	var hi := ((p + Vector3.ONE * r - box_min) / cell).ceil()
	# (the same clock as the shader's blood_time: blood.gd's)
	var slot := int(fposmod(Game.blood.clock() if Game.blood else 0.0, 256.0))
	for z in range(maxi(int(lo.z), 0), mini(int(hi.z), dims.z)):
		for y in range(maxi(int(lo.y), 0), mini(int(hi.y), dims.y)):
			for x in range(maxi(int(lo.x), 0), mini(int(hi.x), dims.x)):
				var c := box_min + (Vector3(x, y, z) + Vector3.ONE * 0.5) * cell
				var d := c.distance_to(p) / r
				if d >= 1.0:
					continue
				var i := ((z * dims.y + y) * dims.x + x) * 2
				var add := int(amount * (1.0 - d * d) * 255.0)
				var now: int = data[i]
				data[i] = mini(now + add, 255)
				# (fresh blood over dried: it is wet again there)
				if add > now / 3:
					data[i + 1] = slot
	_dirty = true


## A stain that soaks outwards from `world_p` on `part` over `dur` seconds to
## `r` across - fast at first, then slower, with a ragged edge (a wound
## bleeding into the clothes round it).
func bloom(part: RigidBody3D, world_p: Vector3, r: float, dur: float, amount: float) -> void:
	_blooms.append({"p": rest_of(part, world_p), "r": r, "t": 0.0, "dur": dur, "amount": amount,
			"seed": randf() * 100.0})


func _grow_blooms(delta: float) -> void:
	var i := 0
	while i < _blooms.size():
		var b: Dictionary = _blooms[i]
		var t0: float = b["t"]
		b["t"] = t0 + delta
		var k := clampf(float(b["t"]) / float(b["dur"]), 0.0, 1.0)
		var k0 := clampf(t0 / float(b["dur"]), 0.0, 1.0)
		# (the front moves as the square root of time: quick, then creeping)
		var r := float(b["r"]) * sqrt(k)
		var dr := r - float(b["r"]) * sqrt(k0)
		if dr > 0.002 or k >= 1.0:
			var c: Vector3 = b["p"]
			var a: float = b["amount"]
			paint_rest(c, r * 0.6, a * 0.35)
			# The edge soaks on unevenly: a few dabs round it, where the
			# weave takes it up faster.
			var sd: float = b["seed"]
			for j in 3:
				var ang := sd + float(j) * 2.1 + k * 1.3
				var off := Vector3(cos(ang), sin(ang * 1.7), sin(ang)) * r * 0.55
				paint_rest(c + off, r * (0.35 + 0.15 * sin(sd + j)), a * 0.25)
		if k >= 1.0:
			_blooms.remove_at(i)
		else:
			i += 1


## Up to the GPU a few times a second.
func flush(delta: float) -> void:
	if not _blooms.is_empty():
		_grow_blooms(delta)
	_flush_t -= delta
	if not _dirty or _flush_t > 0.0:
		return
	_flush_t = 0.06 if not _blooms.is_empty() else 0.12
	_dirty = false
	var slices: Array[Image] = []
	var n := dims.x * dims.y * 2
	for z in dims.z:
		slices.append(Image.create_from_data(dims.x, dims.y, false, Image.FORMAT_RG8, data.slice(z * n, (z + 1) * n)))
	if tex == null:
		tex = ImageTexture3D.new()
		tex.create(Image.FORMAT_RG8, dims.x, dims.y, dims.z, false, slices)
		for m in bot.blood_materials():
			m.set_shader_parameter("blood_vol", tex)
			m.set_shader_parameter("vol_min", box_min)
			m.set_shader_parameter("vol_size", Vector3(dims) * cell)
			m.set_shader_parameter("has_blood", true)
	else:
		tex.update(slices)
