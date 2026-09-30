extends Node
## Dev test: how many casings each gun throws out firing once and reloading.

const KINDS := ["akm", "rifle", "shotgun", "revolver", "pistol"]
var t := 0.0
var idx := 0
var phase := 0
var _base := 0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _casings() -> int:
	return Game.fx._casings.size() * 1000 + Game.fx._casing_i


func _process(delta: float) -> void:
	var p = Game.player
	if p == null or (Game.main and is_instance_valid(Game.main.get("loading"))):
		return
	t += delta
	if idx >= KINDS.size():
		get_tree().quit()
		return
	var k: String = KINDS[idx]
	match phase:
		0:
			p._last_switch = -99.0
			p._switch_to(k)
			phase = 1
			t = 0.0
		1:
			if t > 1.2 and p.current and p.current.kind == k and p.current.is_ready():
				_base = _casings()
				var ex: Array[RID] = [p.get_rid()]
				p.current._cooldown = 0.0
				p.current.try_fire(p.cam, ex)
				phase = 2
				t = 0.0
		2:
			if t > 1.5:
				var fired := _casings() - _base
				_base = _casings()
				p.current.try_reload()
				print("%s: after shot casings=%d state=%d" % [k, fired, p.current.state])
				phase = 3
				t = 0.0
		3:
			if t > 5.0:
				print("%s: during reload casings=%d" % [k, _casings() - _base])
				idx += 1
				phase = 0
