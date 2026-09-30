extends RefCounted
## The man in the last lock-up garage with no door: he sells what one needs
## to make things (tape, wires, powder...), medicine, and a couple of guns,
## for cash. He stands behind a table of crates under a bare bulb and does
## not go anywhere. F on him opens his wares (shop_ui.gd).

const GOODS := [
	["tape", 40], ["wires", 25], ["pipe", 60], ["powder", 150], ["clock", 50],
	["nails", 30], ["tin_can", 10], ["fuse_cord", 60], ["cloth", 15], ["alcohol", 70],
	["empty_syringe", 30], ["ampoule", 80], ["chalk", 10], ["sugar", 15], ["dye", 20],
	["herb", 120], ["rolling_paper", 10], ["bandage", 45], ["sponge", 15], ["pistol", 400], ["revolver", 500],
]
const SPOT := Vector3(29.6, 0.0, -34.4)      # round the corner of the back alley (map_builder._alley)
const FACE := Vector3(1.0, 0.0, 0.3)          # towards the corner one comes round


static func spawn(main: Node3D) -> Node3D:
	var map = main.map
	var y: float = map.ground_height(SPOT.x, SPOT.z)
	var at := Vector3(SPOT.x, y, SPOT.z)
	# His stall: two crates and a board across them, a bulb on a wire.
	var crate := StandardMaterial3D.new()
	crate.albedo_color = Color(0.42, 0.32, 0.2)
	crate.roughness = 0.9
	var f := FACE.normalized()
	var side := f.cross(Vector3.UP)
	var yaw := atan2(f.x, f.z)
	for sx in [-0.55, 0.55]:
		_box(main, Vector3(0.5, 0.7, 0.45), at + side * sx + f * 1.0 + Vector3.UP * 0.35, crate, true, yaw)
	_box(main, Vector3(1.7, 0.04, 0.55), at + f * 1.0 + Vector3.UP * 0.72, crate, false, yaw)
	var bulb := OmniLight3D.new()
	bulb.light_color = Color(1.0, 0.75, 0.45)
	bulb.light_energy = 0.9
	bulb.omni_range = 4.0
	bulb.shadow_enabled = true
	bulb.add_to_group(&"lamp_light")
	main.add_child(bulb)
	bulb.global_position = at + Vector3(0, 2.1, 0) + f * 0.5
	var glow := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.04
	sm.height = 0.1
	glow.mesh = sm
	var gm := StandardMaterial3D.new()
	gm.emission_enabled = true
	gm.emission = Color(1.0, 0.8, 0.5)
	gm.emission_energy_multiplier = 4.0
	glow.material_override = gm
	main.add_child(glow)
	glow.global_position = bulb.global_position
	# Things laid out on the board (just for show).
	var maker = load("res://scripts/ui/item_icons.gd").new()
	for k in 4:
		var id: String = ["tape", "wires", "powder", "pistol"][k]
		var m: Node3D = maker._model(id)
		main.add_child(m)
		m.global_position = at + side * (-0.6 + k * 0.4) + f * 1.0 + Vector3.UP * 0.78
		m.rotation.y = randf() * TAU
	maker.free()
	# Him: someone who does not move from his place, facing out of the garage.
	var bot: Node3D = main.spawn_bot(at + f * 0.3, yaw)
	bot.set_meta("trader", true)
	if bot.ai:
		bot.ai.process_mode = Node.PROCESS_MODE_DISABLED
	bot.move_velocity = Vector3.ZERO
	bot.facing = f
	Game.bots.erase(bot)             # not one of the crowd: nobody picks on him
	bot.add_to_group(&"people_extra")
	return bot


static func _box(main: Node3D, size: Vector3, pos: Vector3, mat: Material, solid: bool, yaw := 0.0) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	if solid:
		var sb := StaticBody3D.new()
		sb.collision_layer = Game.LAYER_WORLD
		sb.collision_mask = 0
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = size
		cs.shape = bs
		sb.add_child(cs)
		sb.add_child(mi)
		main.add_child(sb)
		sb.global_position = pos
		sb.rotation.y = yaw
	else:
		main.add_child(mi)
		mi.global_position = pos
		mi.rotation.y = yaw
