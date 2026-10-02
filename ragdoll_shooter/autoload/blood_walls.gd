extends Node
## Хранит пятна крови в маленькой текстуре-таблице.
## Шейдер стен (prototype_grid.gdshader) читает её и рисует кляксы и подтёки.
## Строка 0: xyz = позиция, w = радиус. Строка 1: xyz = нормаль, w = время появления.

const MAX_SPLATS := 64   # больше = тяжелее для GPU (каждый пиксель стены перебирает все пятна)

var _img := Image.create(MAX_SPLATS, 2, false, Image.FORMAT_RGBAF)
var _tex: ImageTexture
var _count := 0
var _next := 0
var _time := 0.0


func _ready() -> void:
	_tex = ImageTexture.create_from_image(_img)
	RenderingServer.global_shader_parameter_set("blood_splats", _tex)
	RenderingServer.global_shader_parameter_set("blood_count", 0)


func _process(delta: float) -> void:
	_time += delta
	RenderingServer.global_shader_parameter_set("blood_time", _time)


func add_splat(pos: Vector3, normal: Vector3, radius: float) -> void:
	_img.set_pixel(_next, 0, Color(pos.x, pos.y, pos.z, radius))
	_img.set_pixel(_next, 1, Color(normal.x, normal.y, normal.z, _time))
	_tex.update(_img)
	_next = (_next + 1) % MAX_SPLATS   # самые старые перезаписываются
	_count = mini(_count + 1, MAX_SPLATS)
	RenderingServer.global_shader_parameter_set("blood_count", _count)
