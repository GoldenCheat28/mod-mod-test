extends Node
## Dev test: paints one dab with known values into the floor blood map and
## reads the texel back, to verify the stored numbers survive the 2D pipeline.

const BloodCanvas = preload("res://scripts/fx/blood_canvas.gd")
var c
var f := 0


func _ready() -> void:
	c = BloodCanvas.new()
	add_child(c)
	c.time = 1000.0


func _process(_d: float) -> void:
	f += 1
	if f == 3:
		c.dab(Vector3(0.0, 0.5, 0.0), Vector3.UP, Vector3.FORWARD, 0.5, 0.5, "pool", 0, 0.8, 1.0)
	if f == 8:
		var img: Image = c._vps[0].get_texture().get_image()
		var px := img.get_pixel(2048, 2048)
		print("PROBE raw=", px, " format=", img.get_format())
		if px.a > 0.0:
			print("PROBE thick=%.4f depth=%.4f (want 0.5) time=%.2f (want 1000)" % [px.r / px.a, (px.g / px.a) * 80.0 - 40.0, (px.b / px.a) * 16384.0])
		get_tree().quit()