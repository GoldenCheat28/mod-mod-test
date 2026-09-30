extends Node
## Dev test: a patch of fire (fire.gd) and a man on fire beside it, close up.

var t := -3.0
var _view: Camera3D
var _done := {}
const AT := Vector3(-4.0, 0.0, 14.0)


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	t += delta
	if t > 7.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null or Game.bots.is_empty():
		return
	if not _done.has("setup"):
		_done["setup"] = true
		p.global_position = AT + Vector3(0, 0.2, 9)
		for b in Game.bots:
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
		var b: Node3D = Game.bots[0]
		var off: Vector3 = AT + Vector3(1.4, 0, 0.3) - b.position_ground()
		for part in b.parts:
			part.global_position += off
			part.reset_physics_interpolation()
		b.facing = Vector3.BACK
		load("res://scripts/fx/fire.gd").spawn(Game.main, AT, 1.4, 30.0)
		b.ignite(30.0)
		_view = Camera3D.new()
		add_child(_view)
		_view.make_current()
		_view.global_position = AT + Vector3(0.6, 1.2, 3.2)
		_view.look_at(AT + Vector3(0.6, 0.6, 0))
	if t > 1.5 and not _done.has("dbg"):
		_done["dbg"] = true
		var b: Node3D = Game.bots[0]
		for fx in b._burn_fx:
			print("fx ", fx.get_parent().name, " part ", fx.get_parent().global_position, " fx ", fx.global_position, " aabb ", fx.capture_aabb())
	for s in [2.0, 2.3, 5.5]:
		if t >= s and not _done.has(s):
			_done[s] = true
			get_viewport().get_texture().get_image().save_png("user://fire_%s_%s.png" % [OS.get_environment("HOUR"), s])
			print("snap ", s)
