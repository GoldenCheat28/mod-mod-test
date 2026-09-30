extends Node
## Dev test: frame rate on the ground floor of the abandoned building with
## the bulbs off, then on (light_switch.gd).

var t := -3.0
var _fr := []
var _phase := 0
var _acc := 0.0
var _n := 0


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or Game.main == null:
		return
	if _phase == 0 and t > 1.0:
		p.global_position = Vector3(3.0, 0.3, -12.5)
		p.rotation.y = PI * 0.75
		_phase = 1
		t = 0.0
		return
	if t > 1.0:
		_acc += delta
		_n += 1
	if _phase == 1 and t > 4.0:
		_fr.append(snappedf(_acc / _n * 1000.0, 0.01))
		_acc = 0.0
		_n = 0
		for n in Game.main.find_children("*", "StaticBody3D", true, false):
			if n.has_meta("switch"):
				n.set_on(true)
		_phase = 2
		t = 0.0
	elif _phase == 2 and OS.get_environment("BANG") != "" and int(t * 2) != int((t - delta) * 2):
		Game.gunshot.emit(p.cam.global_position + Vector3(0.3, 0, 0), 1.9)
		var h = p.find_children("*", "Node", true, false).filter(func(n): return n.get_script() == load("res://scripts/player/hearing.gd"))
		if not h.is_empty():
			print("boom ", h[0].boom, " deaf ", h[0].deaf, " ring ", h[0].ring, " bodycam ", Game.bodycam, " micvol ", AudioServer.get_bus_volume_db(AudioServer.get_bus_index("CamMic")))
	if _phase == 2 and t > 5.0:
		_fr.append(snappedf(_acc / _n * 1000.0, 0.01))
		get_viewport().get_texture().get_image().save_png("user://light_on.png")
		print("ms off/on: ", _fr, " lights: ", get_tree().get_nodes_in_group(&"lamp_light").size())
		get_tree().quit()
