extends Node
## Dev test: the bots stood in a row in front of the camera (what they wear),
## then some running past (how they lean).
## Usage: godot --path . res://tests/bots_lineup.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _placed := false
var _n := 0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	get_window().size = Vector2i(1600, 900)
	if OS.get_environment("BODYCAM") != "":
		Game.bodycam = true
	add_child(load("res://scenes/main.tscn").instantiate())


func _process(delta: float) -> void:
	if Game.player == null or is_instance_valid(Game.main.get("loading")) or Game.bots.size() < 5:
		return
	t += delta
	var p = Game.player
	p.global_position = Vector3(0, 0.1, 5.2)
	p.yaw = 0.0
	p.pitch = -0.05
	if not _placed:
		_placed = true
		for i in mini(Game.bots.size(), 6):
			var b = Game.bots[i]
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
			b.move_velocity = Vector3.ZERO
			var off: Vector3 = Vector3(-2.2 + i * 0.9, 0.0, 2.6) - b.position_ground()
			for part in b.parts:
				part.global_position += off
				part.linear_velocity = Vector3.ZERO
				part.reset_physics_interpolation()
			b.facing = Vector3(0, 0, 1)
	if t > 2.5 and _n == 0:
		_n = 1
		get_viewport().get_texture().get_image().save_png("%s/lineup.png" % out)
		print("saved lineup")
	if t > 2.5 and t < 4.5:
		# Speeding up to a run as a person does, over a second.
		for i in mini(Game.bots.size(), 6):
			var b = Game.bots[i]
			b.move_velocity = b.move_velocity.move_toward(Vector3(4.0, 0, 0), delta * 4.0)
			b.facing = (b.facing as Vector3).slerp(Vector3(1, 0, 0), minf(delta * 5.0, 1.0)).normalized()
	if t > 4.5 and _n == 1:
		_n = 2
		get_viewport().get_texture().get_image().save_png("%s/running.png" % out)
		print("saved running")
		get_tree().quit()
