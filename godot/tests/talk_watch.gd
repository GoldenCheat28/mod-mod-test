extends Node
## Dev test: an ordinary game left running a few minutes - who says what
## (TALK_DEBUG prints each line) and how many conversations start.

var t := 0.0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	if Game.player == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if int(t) % 20 == 0 and int(t - delta) % 20 != 0:
		var states := {}
		for b in Game.bots:
			if b.ai:
				var k: String = b.ai.S.keys()[b.ai.state] + (" spect" if b.ai.spectate else "") + (" table" if b.ai.roulette else "")
				states[k] = int(states.get(k, 0)) + 1
		print("t=%d states: %s" % [int(t), states])
	if t > float(OS.get_environment("WATCH_T") if OS.has_environment("WATCH_T") else "180"):
		get_tree().quit()
