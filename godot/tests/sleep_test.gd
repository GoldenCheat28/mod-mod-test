extends Node
var t := -3.0
var _done := {}
var before := {}
func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())
func _physics_process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.bots.size() < 3 or Game.main.weather == null:
		return
	if t > 2.0 and not _done.has("sleep"):
		_done["sleep"] = true
		for b in Game.bots:
			before[b] = b.position_ground()
		print("hour before=%.2f" % Game.main.day_night.hour)
		p._sleep_on(load("res://scripts/world/furniture.gd").beds[0])
		_done["sleep_at"] = Time.get_ticks_msec()
	if _done.has("sleep") and Time.get_ticks_msec() - int(_done["sleep_at"]) > 7000 and not _done.has("after"):
		_done["after"] = true
		print("hour after=%.2f fast=%.1f" % [Game.main.day_night.hour, Game.fast])
		for b in Game.bots:
			var d: float = b.position_ground().distance_to(before.get(b, b.position_ground()))
			print("%s moved %.1f m  state=%s act=%s alive=%s fallen=%s" % [b.name, d, b.ai.S.keys()[b.ai.state], b.ai.act != null, b.alive, b.fallen])
		get_tree().quit()
