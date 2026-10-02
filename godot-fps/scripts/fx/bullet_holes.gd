extends Node3D
# Следы от пуль: пул декалей с процедурной текстурой отверстия.

const POOL := 64
var _decals: Array[Decal] = []
var _i := 0
var _tex: ImageTexture

func _ready() -> void:
	var n := 32
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			var d := Vector2(x + 0.5, y + 0.5).distance_to(Vector2(n / 2.0, n / 2.0)) / (n / 2.0)
			var a := clampf((1.0 - d) * 3.0, 0.0, 1.0)
			var rim := clampf(1.0 - absf(d - 0.55) * 6.0, 0.0, 1.0) * 0.35
			var c := 0.02 if d < 0.5 else 0.12
			img.set_pixel(x, y, Color(c, c, c, maxf(a, 0.0) * (0.95 if d < 0.5 else 0.5 + rim)))
	img.generate_mipmaps()
	_tex = ImageTexture.create_from_image(img)

func add(pos: Vector3, normal: Vector3) -> void:
	var d: Decal
	if _decals.size() < POOL:
		d = Decal.new()
		d.texture_albedo = _tex
		d.size = Vector3(0.12, 0.2, 0.12)
		add_child(d)
		_decals.append(d)
	else:
		d = _decals[_i]
		_i = (_i + 1) % POOL
	var up := normal.normalized()
	var ref := Vector3.RIGHT if absf(up.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD
	var x := up.cross(ref).normalized().rotated(up, randf() * TAU)
	d.global_transform = Transform3D(Basis(x, up, x.cross(up)), pos)
