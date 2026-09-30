extends Node
## Dev test: the new guns emptied and reloaded, first person, a few frames
## of each reload.

var t := -3.0
var _done := {}
const KINDS := ["sawnoff", "crossbow", "nailgun", "flaregun"]


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 16.5:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null:
		return
	if not _done.has("setup"):
		_done["setup"] = true
		p.global_position = Vector3(3.0, 0.2, 12.0)
		p.pitch = -0.1
	for i in KINDS.size():
		var at := 0.5 + i * 4.0
		if t >= at and not _done.has("sw%d" % i):
			_done["sw%d" % i] = true
			p._last_switch = -10.0
			p._switch_to(KINDS[i])
		if t >= at + 1.2 and not _done.has("rl%d" % i) and p.current:
			_done["rl%d" % i] = true
			p.current.mag = 0
			p.current.chambered = false
			if p.current.kind == "crossbow":
				p.current._cock(0.0)
			p.current.try_reload()
		for f in [0.5, 0.95, 1.35, 1.9]:
			var key := "s%d_%s" % [i, f]
			if t >= at + 1.2 + f and not _done.has(key):
				_done[key] = true
				get_viewport().get_texture().get_image().save_png("user://reload_%s_%s.png" % [KINDS[i], f])
