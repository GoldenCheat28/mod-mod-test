extends Node
## Dev test: a gun in the player's hands - fired empty, then reloaded.
## Usage: GUN=revolver godot --path . res://tests/gun_test.tscn --write-movie out.avi --fixed-fps 30
var t := -3.0
var _done := {}
var _shots := 0
func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())
func _physics_process(delta: float) -> void:
	t += delta
	if t > 12.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if not _done.has("setup"):
		_done["setup"] = true
		p.global_position = Vector3(3.0, 0.1, -1.5)
		p.yaw = 1.4
		p._switch_to(OS.get_environment("GUN"))
	var g = p.current
	if g == null:
		return
	if t > 1.5 and _shots < 7 and fmod(t, 0.5) < delta:
		var ex: Array[RID] = [p.get_rid()]
		g.try_fire(p.cam, ex)
		_shots += 1
		print("shot %d ammo=%d" % [_shots, g.total_ammo()])
	if t > 5.5 and not _done.has("reload"):
		_done["reload"] = true
		g.try_reload()
	if t > 11.5 and not _done.has("end"):
		_done["end"] = true
		print("end ammo=%d" % g.total_ammo())
