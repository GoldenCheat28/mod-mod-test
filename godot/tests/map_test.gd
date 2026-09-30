extends Node
## Dev test: screenshots of the added places (warehouse, garages, wrecks, lamps,
## fence) and an FPS log.
## Usage: godot --path . res://tests/map_test.tscn -- <out_dir>

var out := "user://"
var t := 0.0
var _done := {}
# [time, position, yaw, pitch, name]
var views := [
	[4.0, Vector3(27.0, 0.1, -10.0), 0.15, 0.05, "warehouse_out"],
	[6.0, Vector3(24.0, 0.2, -22.5), 0.4, 0.0, "warehouse_in"],
	[8.0, Vector3(-27.0, 0.1, -20.0), 0.0, 0.0, "garages"],
	[10.0, Vector3(-9.0, 0.1, 17.0), -0.8, -0.05, "car"],
	[12.0, Vector3(3.0, 0.1, -1.5), 1.4, 0.05, "street"],
	[14.0, Vector3(-24.0, 0.1, 10.0), 2.8, 0.25, "poles"],
]


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)


func _physics_process(delta: float) -> void:
	t += delta
	if t > 5.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null or Game.main.weather == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if not _done.has("off"):
		_done["off"] = true
		var mode := OS.get_environment("OFF")
		for n in Game.main.get_children():
			if mode == "probes" and n is ReflectionProbe:
				n.queue_free()
			if mode == "weather" and n == Game.main.weather:
				n.process_mode = Node.PROCESS_MODE_DISABLED
				n.visible = false
		if mode == "decals":
			for n in Game.main.map.get_children():
				if n is Decal:
					n.visible = false
		if mode == "post":
			p._post.visible = false
		if mode == "body":
			p._body.visible = false
		if mode.begins_with("node:"):
			var nn := Game.main.get_node_or_null(mode.substr(5))
			if nn:
				nn.process_mode = Node.PROCESS_MODE_DISABLED
				print("disabled ", nn.name)
		if mode == "player":
			p.process_mode = Node.PROCESS_MODE_DISABLED
	for v in views:
		if t > v[0] - 1.5 and t < v[0] + 0.2:
			p.global_position = v[1]
			p.velocity = Vector3.ZERO
			p.yaw = v[2]
			p.pitch = v[3]
	if int(t) != int(t - delta):
		print("t=%d fps=%d gpu=%.1f proc=%.1f phys=%.1f" % [t, Engine.get_frames_per_second(), RenderingServer.viewport_get_measured_render_time_gpu(get_viewport().get_viewport_rid()), Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0])


func _process(_d: float) -> void:
	for v in views:
		if t >= v[0] and not _done.has(v[4]):
			_done[v[4]] = true
			get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, v[4]])
