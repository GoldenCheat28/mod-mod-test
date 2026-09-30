extends RefCounted
## Who a man is to the player, for talking to him (dialog_ui.gd): a name,
## the money in his pockets, what he wants and would pay for it, what he has
## on him to spare, how he takes to the player. All of it made from his seed,
## so every copy of the game (net.gd) has the same man.

const NAMES := ["Серёга", "Витёк", "Толик", "Димон", "Саня", "Жека", "Колян", "Макс", "Лёха", "Гоша", "Вован",
		"Игорёк", "Стас", "Пашка", "Ромчик", "Юрец", "Андрюха", "Костян", "Эдик", "Славик"]
## What people here want, and roughly what it is worth to them.
const WANTS := [["cigarettes", 60], ["joint", 120], ["bandage", 70], ["water", 30], ["pistol", 450], ["alcohol", 90],
		["herb", 150], ["tape", 45], ["revolver", 550], ["syringe", 140], ["pills", 180], ["grenade", 300]]
## What he may have on him to hand over (a favour, or for sale).
const HAS := ["cigarettes", "cigarettes", "joint", "bandage", "water", "tape", "wires", "pills"]

var name := ""
var money := 0
var wants: Array = []            # [[item id, the most he pays], ...]
var has: Array = []              # item ids he could part with
var trust := 0.3                 # 0..1: how he takes to the player
var rude := false
var met := false                 # has talked to the player
var favours := 0                 # asked of him so far (he tires of it)
var offered := {}                # item -> last price the player asked (haggling)


static func make(seed_v: int, is_rude: bool) -> RefCounted:
	var p = load("res://scripts/bots/persona.gd").new()
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_v * 7919 + 17
	p.name = NAMES[rng.randi() % NAMES.size()]
	p.money = rng.randi_range(20, 500)
	p.rude = is_rude
	p.trust = rng.randf_range(0.05, 0.25) if is_rude else rng.randf_range(0.25, 0.5)
	for i in rng.randi_range(1, 2):
		var w: Array = WANTS[rng.randi() % WANTS.size()]
		var already := false
		for x in p.wants:
			already = already or x[0] == w[0]
		if not already:
			p.wants.append([w[0], int(float(w[1]) * rng.randf_range(0.8, 1.5))])
	for i in rng.randi_range(0, 2):
		var h: String = HAS[rng.randi() % HAS.size()]
		if not h in p.has:
			p.has.append(h)
	return p


func wants_price(id: String) -> int:
	for w in wants:
		if w[0] == id:
			return int(w[1])
	return -1


func item_name(id: String) -> String:
	return String(load("res://scripts/game/items.gd").def(id)["name"]).to_lower()
