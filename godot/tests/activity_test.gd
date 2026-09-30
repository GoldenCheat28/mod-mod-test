extends Node
## Dev test: everyone given something to do at once (activities.gd), put at
## their places, then a camera goes round the groups. Video + log.
## Usage: godot --path . res://tests/activity_test.tscn --write-movie out.avi --fixed-fps 30

var t := -3.0
var _done := {}
var _view: Camera3D
var _spots: Array = []
var _cur := -1


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 120.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.bots.size() < 2 or Game.main.weather == null or Game.main.activities == null:
		return
	Game.main.weather.storm = 0.0
	Game.main.weather._target = 0.0
	if _once("go", 1.0):
		var acts = Game.main.activities
		if OS.get_environment("BENCH") != "":
			acts.spots = acts.spots.filter(func(sp): return sp["kind"] == "bench")
		if OS.get_environment("SQUAT") != "":
			for sp in acts.spots:
				if sp["kind"] == "chat":
					sp["kind"] = "squat"
		print("spots: ", acts.spots.size(), " ", acts.spots.map(func(s): return s["kind"]))
		p.global_position = Vector3(0, 0.1, 40)
		for b in Game.bots:
			if b.ai._try_activity():
				var at: Vector3 = b.ai.act.slot["pos"]
				var off: Vector3 = at - b.position_ground()
				for part in b.parts:
					part.global_position += off
					part.linear_velocity = Vector3.ZERO
					part.reset_physics_interpolation()
				b.ai._path = PackedVector3Array()
		for s in acts.spots:
			var n := 0
			for sl in s["slots"]:
				if sl["bot"] != null:
					n += 1
			print("%s at %s: %d people" % [s["kind"], s["center"], n])
			if n > 0:
				_spots.append(s)
		_view = Camera3D.new()
		_view.fov = 55.0
		add_child(_view)
		_view.make_current()
	if _view == null or _spots.is_empty():
		return
	var i := clampi(int((t - 3.0) / 7.0), 0, _spots.size() - 1)
	if t > 3.0 + 7.0 * _spots.size():
		get_tree().quit()
	var s: Dictionary = _spots[i]
	var c: Vector3 = s["center"]
	var from: Vector3
	if s.has("normal"):
		var n: Vector3 = s["normal"]
		from = c + n * 2.8 + Vector3.UP.cross(n) * 1.2 + Vector3.UP * 1.4
	else:
		# The first way round with a clear view of them.
		from = c + Vector3(2.2, 1.5, 1.8)
		var space := get_viewport().world_3d.direct_space_state
		for k in 8:
			var d := Vector3(cos(TAU * k / 8.0), 0.0, sin(TAU * k / 8.0))
			var cand := c + d * 2.8 + Vector3.UP * 1.5
			var q := PhysicsRayQueryParameters3D.create(c + Vector3.UP * 1.0, cand, Game.LAYER_WORLD | Game.LAYER_PROPS)
			if space.intersect_ray(q).is_empty():
				from = cand
				break
	_view.global_position = from
	_view.look_at(c + Vector3.UP * 0.9)
	if OS.get_environment("YAW") != "" and int(t * 10) != int((t - delta) * 10) and t < 9.0:
		var line2 := "Y t=%.1f" % t
		for sl in s["slots"]:
			var b = sl["bot"]
			if b and is_instance_valid(b):
				var z: Vector3 = -b.pelvis.global_basis.z
				var zc: Vector3 = -b.chest.global_basis.z
				line2 += " | pel=%4.0f ch=%4.0f wy=%5.2f face=%4.0f py=%.2f" % [rad_to_deg(atan2(z.x, z.z)), rad_to_deg(atan2(zc.x, zc.z)), b.pelvis.angular_velocity.y, rad_to_deg(atan2(b.facing.x, b.facing.z)), b.pelvis.global_position.y]
		print(line2)
	if OS.get_environment("SQUAT") != "" and int(t * 2) != int((t - delta) * 2):
		var line := "t=%.1f" % t
		for sl in s["slots"]:
			var b = sl["bot"]
			if b and is_instance_valid(b):
				var fr: Vector3 = b.parts[b.part_index["foot_r"]].global_position
				line += " | py=%.2f fr=(%.2f,%.2f) sup=%.2f post=%d fall=%s" % [b.pelvis.global_position.y, fr.x, fr.z, b.support, b.posture, b.fallen]
		print(line)
	if i != _cur:
		_cur = i
		print("t=%.1f showing %s" % [t, s["kind"]])


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true
