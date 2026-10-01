extends Node
## Dev test: the trade window - an item he wants put on the table and sold,
## then one of his bought; money and bags checked. Also a shot into a man
## (the 2D splash must not break anything).
var t := 0.0
var _step := 0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if t < 1.0 or t < 1.0 + _step * 0.5:
		return
	var p = Game.player
	var ui = p._trade_ui
	match _step:
		0:
			var b: Node3D = null
			for x in Game.bots:
				if x.ai and not x.has_meta("judge") and not x.has_meta("guard") and not x.has_meta("bartender") and not x.has_meta("foreman"):
					b = x
					break
			p.global_position = b.global_position + Vector3(1.5, 0.2, 0)
			var pe = b.ai._persona()
			pe.money = 1000
			pe.has = ["bandage", "water"]
			var want: String = pe.wants[0][0]
			p.inventory.add(want, 1)
			print("he wants ", want, " for ", pe.wants[0][1], "; player money ", p.inventory.count("money"))
			ui.open(b)
			# onto the table
			var it: Dictionary = {}
			for x in p.inventory.items:
				if x["id"] == want:
					it = x
			p.inventory.remove(it)
			ui._give.items.append({"id": want, "pos": Vector2i(0, 0), "rot": false, "count": 1})
			print("worth to him: ", ui._buy_price(want), "  balance: ", ui._value(ui._give, true) - ui._value(ui._take, false))
			ui._act("deal")
			print("after sale: '", ui._say, "' player money ", p.inventory.count("money"), " he has ", pe.money, " still has item: ", p.inventory.has(want))
		1:
			var pe = ui._persona()
			var it: Dictionary = ui._his.items[0]
			ui._his.remove(it)
			ui._take.items.append({"id": it["id"], "pos": Vector2i(0, 0), "rot": false, "count": 1})
			var m0: int = p.inventory.count("money")
			ui._act("deal")
			print("bought ", it["id"], ": '", ui._say, "' paid ", m0 - p.inventory.count("money"), " got it: ", p.inventory.has(it["id"]))
			ui.close()
		2:
			var b: Node3D = Game.bots[1]
			var part: RigidBody3D = b.head
			b.receive_hit(part, part.global_position + Vector3(0.05, 0, 0), Vector3(-1, 0, 0), 4.0, "pistol")
			print("splash pool: ", Game.blood.splash._quads.size(), " active: ", Game.blood.splash._life.filter(func(l): return float(l[1]) > 0.0).size())
		3:
			get_tree().quit()
	_step += 1
