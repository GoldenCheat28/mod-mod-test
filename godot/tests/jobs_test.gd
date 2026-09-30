extends Node
## Dev test: each of the foreman's jobs taken, done (short-cut) and handed in.
var t := 0.0
var _step := 0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	var jobs: Node = Game.main.get_node("Jobs")
	var inv = Game.player.inventory
	if t < 1.0 or t < _step * 1.5:
		return
	match _step:
		0:
			print("foreman: ", jobs.foreman != null, " at ", jobs.foreman.global_position)
			print("courier: ", jobs._take("courier"))
		1:
			print("   hud: ", jobs._label.text)
			inv.add("package", 1)
		2:
			print("   hud: ", jobs._label.text)
			var money: int = inv.count("money")
			print("   deliver: ", jobs.deliver(jobs.job["to"]), " money +", inv.count("money") - money)
		3:
			print("craft: ", jobs._take("craft"))
			inv.add(jobs.job["id"], int(jobs.job["n"]))
		4:
			print("   hud: ", jobs._label.text, " can hand in: ", jobs._can_hand_in())
			print("   hand in: ", jobs._hand_in())
		5:
			print("trade: ", jobs._take("trade"), " cigs=", inv.count("cigarettes"))
			for i in 5:
				jobs.on_sold("cigarettes")
		6:
			print("   hud: ", jobs._label.text)
			print("   hand in: ", jobs._hand_in())
		7:
			print("kill: ", jobs._take("kill"))
		8:
			print("   hud: ", jobs._label.text)
			var who: Node3D = jobs.job["who"]
			who._die("headshot")
		9:
			print("   hud: ", jobs._label.text, " can hand in: ", jobs._can_hand_in())
			print("   hand in: ", jobs._hand_in())
			print("   foreman options now: ", jobs.foreman_options().map(func(o): return o[0]))
			get_tree().quit()
	_step += 1
