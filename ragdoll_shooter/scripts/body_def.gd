class_name BodyDef
## Описание тела из капсул: общее для живого бота и для регдолла.
## Координаты в метрах, в пространстве персонажа (смотрит в -Z, ноги на y = 0).
## pivot — точка сустава, a/b — концы капсулы, r — радиус.
##
## joint — пределы сустава в градусах [мин, макс] по осям персонажа:
##   x — сгибание вперёд/назад, y — скручивание, z — отведение в сторону.
## Знак — как у rotation.x кости: плюс уводит свисающие руки/ноги вперёд,
## а корпус и голову отклоняет назад.

const PARTS := [
	{"name": "pelvis", "parent": "", "pivot": Vector3(0, 0.965, 0),
		"a": Vector3(0, 0.9, 0), "b": Vector3(0, 1.03, 0), "r": 0.15, "mass": 11.0, "dmg": 1.0},
	{"name": "chest", "parent": "pelvis", "pivot": Vector3(0, 1.08, 0),
		"a": Vector3(0, 1.13, 0), "b": Vector3(0, 1.38, 0), "r": 0.17, "mass": 20.0, "dmg": 1.0,
		"joint": {"x": [-45, 25], "y": [-30, 30], "z": [-25, 25]}},
	{"name": "head", "parent": "chest", "pivot": Vector3(0, 1.53, 0),
		"a": Vector3(0, 1.6, 0), "b": Vector3(0, 1.7, 0), "r": 0.11, "mass": 5.5, "dmg": 4.0,
		"joint": {"x": [-50, 40], "y": [-60, 60], "z": [-30, 30]}},
	{"name": "upper_arm_l", "parent": "chest", "pivot": Vector3(-0.25, 1.45, 0),
		"a": Vector3(-0.25, 1.42, 0), "b": Vector3(-0.25, 1.17, 0), "r": 0.055, "mass": 2.2, "dmg": 0.6,
		"joint": {"x": [-50, 150], "y": [-60, 60], "z": [-90, 90]}},
	{"name": "lower_arm_l", "parent": "upper_arm_l", "pivot": Vector3(-0.25, 1.13, 0),
		"a": Vector3(-0.25, 1.1, 0), "b": Vector3(-0.25, 0.85, 0), "r": 0.05, "mass": 1.8, "dmg": 0.5,
		"joint": {"x": [0, 145], "y": [-10, 10], "z": [0, 0]}},
	{"name": "upper_arm_r", "parent": "chest", "pivot": Vector3(0.25, 1.45, 0),
		"a": Vector3(0.25, 1.42, 0), "b": Vector3(0.25, 1.17, 0), "r": 0.055, "mass": 2.2, "dmg": 0.6,
		"joint": {"x": [-50, 150], "y": [-60, 60], "z": [-90, 90]}},
	{"name": "lower_arm_r", "parent": "upper_arm_r", "pivot": Vector3(0.25, 1.13, 0),
		"a": Vector3(0.25, 1.1, 0), "b": Vector3(0.25, 0.85, 0), "r": 0.05, "mass": 1.8, "dmg": 0.5,
		"joint": {"x": [0, 145], "y": [-10, 10], "z": [0, 0]}},
	{"name": "thigh_l", "parent": "pelvis", "pivot": Vector3(-0.1, 0.9, 0),
		"a": Vector3(-0.1, 0.86, 0), "b": Vector3(-0.1, 0.52, 0), "r": 0.075, "mass": 8.5, "dmg": 0.7,
		"joint": {"x": [-30, 110], "y": [-30, 30], "z": [-40, 40]}},
	{"name": "shin_l", "parent": "thigh_l", "pivot": Vector3(-0.1, 0.485, 0),
		"a": Vector3(-0.1, 0.45, 0), "b": Vector3(-0.1, 0.09, 0), "r": 0.06, "mass": 4.5, "dmg": 0.6,
		"joint": {"x": [-140, 0], "y": [-5, 5], "z": [0, 0]}},
	{"name": "thigh_r", "parent": "pelvis", "pivot": Vector3(0.1, 0.9, 0),
		"a": Vector3(0.1, 0.86, 0), "b": Vector3(0.1, 0.52, 0), "r": 0.075, "mass": 8.5, "dmg": 0.7,
		"joint": {"x": [-30, 110], "y": [-30, 30], "z": [-40, 40]}},
	{"name": "shin_r", "parent": "thigh_r", "pivot": Vector3(0.1, 0.485, 0),
		"a": Vector3(0.1, 0.45, 0), "b": Vector3(0.1, 0.09, 0), "r": 0.06, "mass": 4.5, "dmg": 0.6,
		"joint": {"x": [-140, 0], "y": [-5, 5], "z": [0, 0]}},
]


static func capsule_mesh(part: Dictionary, material: Material) -> CapsuleMesh:
	var m := CapsuleMesh.new()
	m.radius = part.r
	m.height = (part.b - part.a).length() + part.r * 2.0
	m.radial_segments = 16
	m.rings = 6
	m.material = material
	return m


static func capsule_shape(part: Dictionary) -> CapsuleShape3D:
	var s := CapsuleShape3D.new()
	s.radius = part.r
	s.height = (part.b - part.a).length() + part.r * 2.0
	return s


static func center(part: Dictionary) -> Vector3:
	return (part.a + part.b) * 0.5
