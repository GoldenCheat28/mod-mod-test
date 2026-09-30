extends Node
## Dev test: a grenade going off by a wall; the sparks (sparks.gd) a few
## moments after, and how many there still are.

var t := -3.0
var _done := {}
var _view: Camera3D
const AT := Vector3(-3.0, 0.05, -7.4)


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	t += delta
	if t > 4.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null:
		return
	if _view == null:
		p.global_position = Vector3(10, 0.2, 10)
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
		_view.global_position = AT + Vector3(1.6, 1.0, 2.6)
		_view.look_at(AT + Vector3(0, 0.6, 0))
	if t > 1.0 and not _done.has("boom"):
		_done["boom"] = true
		var ex: Array[RID] = []
		load("res://scripts/weapons/explosion.gd").explode(get_tree(), AT, 1.0, 1.0, ex)
	for f in [0.03, 0.12, 0.3, 0.7]:
		if t > 1.0 + f and not _done.has(f):
			_done[f] = true
			get_viewport().get_texture().get_image().save_png("user://sparks_%s.png" % f)
