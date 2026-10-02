extends Node
# Автозагрузка «Game»: общие константы и ссылки, которых ждёт система крови (scripts/fx/blood.gd).

const LAYER_WORLD := 1     # статичная геометрия
const LAYER_PROPS := 2     # физические предметы
const LAYER_BOTS := 4      # части тел ботов (по ним попадают пули)
const LAYER_BODY := 8      # капсулы движения ботов
const LAYER_PLAYER := 16

var bots: Array = []
var blood: Node = null     # экземпляр scripts/fx/blood.gd (создаёт main.gd)
var gibs: Node = null      # необязательно
var holes: Node = null     # следы от пуль
var prof: Dictionary = {}
var player: Node3D = null

func reset() -> void:
	bots.clear()
	blood = null
	holes = null
