extends Node3D
var t := 0.0
func _ready() -> void:
	var c := Camera3D.new()
	add_child(c)
func _process(delta: float) -> void:
	t += delta
	if t > 4.0:
		print("BLANK fps=", Engine.get_frames_per_second(), " proc=", Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, " mode=", DisplayServer.window_get_mode())
		get_tree().quit()
