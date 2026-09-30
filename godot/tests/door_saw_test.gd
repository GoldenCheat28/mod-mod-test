extends Node
## Dev test: a door sawn through with the chainsaw's bar (door.gd saw()):
## from the top edge down to the handle edge, the corner falls away.

var t := -3.0
var _door: Node3D
var _view: Camera3D
var _snaps := {}


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 7.0:
		get_tree().quit()
	if Game.player == null or Game.main == null:
		return
	if _door == null:
		var ds := get_tree().get_nodes_in_group(&"door")
		if ds.is_empty():
			return
		_door = ds[0]
		_door.freeze = true
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
		var c: Vector3 = _door.to_global(Vector3(_door._size.x * 0.5, 1.3, 0))
		_view.global_position = c + _door.global_basis.z * 2.2 + Vector3.UP * 0.2
		_view.look_at(c)
		Game.player.global_position = c + _door.global_basis.z * 6.0
	if t > 0.5 and t < 3.5:
		var k := (t - 0.5) / 3.0
		var w: float = _door._size.x
		var hgt: float = _door._size.y
		var p2 := Vector2(w * 0.45, hgt + 0.06).lerp(Vector2(w + 0.06, hgt * 0.55), k)
		var z: Vector3 = _door.global_basis.z
		var at: Vector3 = _door.to_global(Vector3(p2.x, p2.y, 0))
		_door.saw(at + z * 0.35, at - z * 0.35, delta)
	if t > 3.6:
		_door.freeze = false
	for s in [2.0, 3.8, 6.5]:
		if t >= s and not _snaps.has(s):
			_snaps[s] = true
			get_viewport().get_texture().get_image().save_png("user://door_%s.png" % s)
			print("snap ", s, " poly ", _door._poly.size())
