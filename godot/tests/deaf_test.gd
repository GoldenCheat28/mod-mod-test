extends Node
## Dev test: an AKM burst by the player's ears, then a grenade 5 m off - the
## deafness, ringing, low-pass and vignette over time; pictures.
var t := -3.0
var out := "user://"
var _done := {}
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())
func _physics_process(delta: float) -> void:
	t += delta
	var p = Game.player
	if p == null or p.hearing == null or Game.main.weather == null:
		return
	if not _done.has("setup"):
		_done["setup"] = true
		p.global_position = Vector3(3, 0.1, 4)
		p._switch_to("akm")
	if t > 1.5 and t < 2.6 and p.current and p.current.is_ready():
		var ex: Array[RID] = [p.get_rid()]
		p.current.try_fire(p.cam, ex)
	if t > 6.0 and not _done.has("boom"):
		_done["boom"] = true
		var none: Array[RID] = []
		p.yaw = -PI * 0.5
		p.pitch = -0.05
		load("res://scripts/weapons/explosion.gd").explode(get_tree(), p.global_position + Vector3(9, 0, 0), 1.0, 1.0, none)
	if int(t * 2) != int((t - delta) * 2) and t > 1.0:
		var h = p.hearing
		print("t=%.1f deaf=%.2f ring=%.2f cutoff=%d" % [t, h.deaf, h.ring, int(h._lp.cutoff_hz)])
	if t > 2.7 and not _done.has("s1"):
		_done["s1"] = true
		get_viewport().get_texture().get_image().save_png(out + "/deaf_akm.png")
	if t > 6.12 and not _done.has("s2"):
		_done["s2"] = true
		get_viewport().get_texture().get_image().save_png(out + "/deaf_boom.png")
	if t > 20.0:
		get_tree().quit()
