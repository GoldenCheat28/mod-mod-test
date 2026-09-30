extends RefCounted
## Everything that can be carried: how much room it takes in a bag (cells,
## width x height, laid flat), what it weighs, how many go in one stack, what
## kind of thing it is and what using it does. New things (food, water, tools,
## appliances) are a line here plus what "use" means for them (player.gd).

## kind: "weapon" (taken in hand), "throwable", "placeable", "medical",
## "smoking", "restraint", later "food", "drink", "tool"...
const DEFS := {
	"pistol": {"name": "Пистолет", "size": Vector2i(2, 1), "weight": 0.9, "stack": 1, "kind": "weapon"},
	"revolver": {"name": "Револьвер", "size": Vector2i(2, 1), "weight": 1.1, "stack": 1, "kind": "weapon"},
	"shotgun": {"name": "Дробовик", "size": Vector2i(5, 1), "weight": 3.2, "stack": 1, "kind": "weapon"},
	"akm": {"name": "АКМ", "size": Vector2i(5, 2), "weight": 3.6, "stack": 1, "kind": "weapon"},
	"machete": {"name": "Мачете", "size": Vector2i(3, 1), "weight": 0.7, "stack": 1, "kind": "weapon"},
	"chainsaw": {"name": "Бензопила", "size": Vector2i(4, 2), "weight": 6.5, "stack": 1, "kind": "weapon"},
	"grenade": {"name": "Граната", "short": "Граната", "size": Vector2i(1, 1), "weight": 0.6, "stack": 1, "kind": "throwable"},
	"bomb": {"name": "Бомба", "size": Vector2i(2, 2), "weight": 2.5, "stack": 1, "kind": "placeable"},
	"bandage": {"name": "Бинт", "short": "Бинт", "size": Vector2i(1, 1), "weight": 0.1, "stack": 3, "kind": "medical"},
	"spraycan": {"name": "Баллончик (зелёный)", "short": "Краска", "size": Vector2i(1, 2), "weight": 0.35, "stack": 1, "kind": "weapon"},
	"cuffs": {"name": "Наручники", "short": "Наручн.", "size": Vector2i(1, 1), "weight": 0.3, "stack": 1, "kind": "restraint"},
	"sponge": {"name": "Губка", "size": Vector2i(1, 1), "weight": 0.05, "stack": 1, "kind": "weapon"},
	"mop": {"name": "Швабра", "size": Vector2i(5, 1), "weight": 1.1, "stack": 1, "kind": "weapon"},
	"pipe": {"name": "Стальная труба", "short": "Труба", "size": Vector2i(3, 1), "weight": 1.2, "stack": 1, "kind": "part"},
	"powder": {"name": "Порох", "size": Vector2i(1, 2), "weight": 0.5, "stack": 1, "kind": "part"},
	"clock": {"name": "Будильник", "size": Vector2i(1, 1), "weight": 0.3, "stack": 1, "kind": "part"},
	"wires": {"name": "Провода", "size": Vector2i(1, 1), "weight": 0.1, "stack": 10, "kind": "part"},
	"tape": {"name": "Изолента", "size": Vector2i(1, 1), "weight": 0.1, "stack": 3, "kind": "part"},
	"boards": {"name": "Доски", "size": Vector2i(4, 1), "weight": 2.0, "stack": 1, "kind": "part"},
	"screws": {"name": "Шурупы", "size": Vector2i(1, 1), "weight": 0.1, "stack": 50, "kind": "part"},
	"scrap": {"name": "Железки", "size": Vector2i(2, 1), "weight": 0.8, "stack": 1, "kind": "part"},
	"water": {"name": "Бутылка воды", "short": "Вода", "size": Vector2i(1, 2), "weight": 0.55, "stack": 1, "kind": "food"},
	"pipe_bomb": {"name": "Самодельная бомба", "short": "Самоделка", "size": Vector2i(3, 1), "weight": 1.8, "stack": 1, "kind": "placeable"},
	"cigarettes": {"name": "Сигареты", "short": "Сигареты", "size": Vector2i(1, 1), "weight": 0.03, "stack": 20, "kind": "smoking"},
	"joint": {"name": "Косяк", "size": Vector2i(1, 1), "weight": 0.01, "stack": 5, "kind": "smoking"},
	# Medicine and the rest made in the notebook (craft_ui.gd), and what it takes.
	"syringe": {"name": "Шприц (обезболивающее)", "short": "Шприц", "size": Vector2i(2, 1), "weight": 0.03, "stack": 3, "kind": "medical"},
	"pills": {"name": "Таблетки «Улёт»", "short": "Таблетки", "size": Vector2i(1, 1), "weight": 0.02, "stack": 10, "kind": "drug"},
	"cloth": {"name": "Тряпки", "size": Vector2i(1, 1), "weight": 0.1, "stack": 6, "kind": "part"},
	"alcohol": {"name": "Спирт", "size": Vector2i(1, 2), "weight": 0.4, "stack": 1, "kind": "part"},
	"empty_syringe": {"name": "Пустой шприц", "short": "Шприц пуст.", "size": Vector2i(2, 1), "weight": 0.02, "stack": 5, "kind": "part"},
	"ampoule": {"name": "Ампула", "size": Vector2i(1, 1), "weight": 0.01, "stack": 6, "kind": "part"},
	"chalk": {"name": "Мел", "size": Vector2i(1, 1), "weight": 0.05, "stack": 5, "kind": "part"},
	"sugar": {"name": "Сахар", "size": Vector2i(1, 1), "weight": 0.2, "stack": 3, "kind": "part"},
	"dye": {"name": "Пищевой краситель", "short": "Краситель", "size": Vector2i(1, 1), "weight": 0.05, "stack": 3, "kind": "part"},
	"herb": {"name": "Сушёная трава", "short": "Трава", "size": Vector2i(1, 1), "weight": 0.02, "stack": 5, "kind": "part"},
	"rolling_paper": {"name": "Бумага для самокруток", "short": "Бумага", "size": Vector2i(1, 1), "weight": 0.01, "stack": 20, "kind": "part"},
	"nails": {"name": "Гвозди", "size": Vector2i(1, 1), "weight": 0.3, "stack": 3, "kind": "part"},
	"tin_can": {"name": "Жестяная банка", "short": "Банка", "size": Vector2i(1, 1), "weight": 0.1, "stack": 3, "kind": "part"},
	"fuse_cord": {"name": "Бикфордов шнур", "short": "Шнур", "size": Vector2i(1, 1), "weight": 0.1, "stack": 5, "kind": "part"},
	"sawnoff": {"name": "Обрез", "size": Vector2i(3, 1), "weight": 2.1, "stack": 1, "kind": "weapon"},
	"crossbow": {"name": "Арбалет", "size": Vector2i(4, 2), "weight": 3.0, "stack": 1, "kind": "weapon"},
	"flaregun": {"name": "Ракетница", "size": Vector2i(2, 1), "weight": 0.6, "stack": 1, "kind": "weapon"},
	"rifle": {"name": "Винтовка с оптикой", "short": "Винтовка", "size": Vector2i(6, 1), "weight": 2.8, "stack": 1, "kind": "weapon"},
	"molotov": {"name": "Коктейль Молотова", "short": "Молотов", "size": Vector2i(1, 2), "weight": 0.8, "stack": 1, "kind": "throwable"},
	"package": {"name": "Посылка", "size": Vector2i(2, 2), "weight": 1.2, "stack": 1, "kind": "misc"},
	"money": {"name": "Деньги", "short": "₽", "size": Vector2i(1, 1), "weight": 0.00002, "stack": 100000, "kind": "money"},
}


static func def(id: String) -> Dictionary:
	return DEFS.get(id, {"name": id, "size": Vector2i(1, 1), "weight": 0.5, "stack": 1, "kind": "misc"})


static func size_of(id: String, rotated := false) -> Vector2i:
	var s: Vector2i = def(id)["size"]
	return Vector2i(s.y, s.x) if rotated else s
