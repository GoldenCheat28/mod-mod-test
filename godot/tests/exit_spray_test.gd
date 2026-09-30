extends Node
## Dev test: a pistol round through a bot's head towards a wall - the exit
## spray following the bullet, the jet and the wall after. Side-on frames.
## Usage: godot --path . res://tests/exit_spray_test.tscn -- <out_dir>

var out := "user://"
var t := -1.0
var _bot: Node3D
var _cam: Camera3D
var _shots := [[0.03, "a"], [0.08, "b"], [0.16, "c"], [0.6, "d"], [2.5, "e"]]


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	var p = Game.player
	if p == null or (Game.main and is_instance_valid(Game.main.get("loading"))) or Game.bots.is_empty():
		return
	if _bot == null:
		_bot = Game.main.spawn_bot(Vector3(2.0, 0.15, -6.9), 0.0)
		_bot.ai.process_mode = Node.PROCESS_MODE_DISABLED
		for b in Game.bots:
			if b != _bot:
				b.ai.process_mode = Node.PROCESS_MODE_DISABLED
		p.global_position = Vector3(2.0, 0.2, -3.0)
		p.yaw = 0.0
		p.pitch = 0.0
		_cam = Camera3D.new()
		add_child(_cam)
		_cam.global_position = Vector3(5.2, 1.7, -5.0)
		_cam.look_at(Vector3(2.0, 1.5, -7.2))
		t = -1.5
		return
	t += delta
	if t < 0.0:
		return
	if not has_meta("fired"):
		set_meta("fired", true)
		p._switch_to("pistol")
		var from: Vector3 = _bot.head.global_position + Vector3(0, 0, 3.0)
		var dir: Vector3 = (_bot.head.global_position - from).normalized()
		_bot.receive_hit(_bot.head, _bot.head.global_position + Vector3(0, 0.02, 0.09), dir, 20.0, "pistol")
		_cam.make_current()
		t = 0.0
	if _shots.size() > 0 and t > _shots[0][0]:
		var s: Array = _shots.pop_front()
		get_viewport().get_texture().get_image().save_png("%s/exit_%s.png" % [out, s[1]])
		print("shot ", s[1], " drops=", Game.blood._drops.size())
	if _shots.is_empty():
		get_tree().quit()
