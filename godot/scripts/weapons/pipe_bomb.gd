extends StaticBody3D
## A home-made bomb: a steel pipe full of powder, capped at both ends, an
## old alarm clock taped to it with electrical tape and two wires from the
## clock into the cap. Put down, the clock ticks off the time it was set to
## (in the crafting, craft_ui.gd), then it goes off - smaller than the real
## charge, and it throws the pipe's pieces about.

const Explosion = preload("res://scripts/weapons/explosion.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")

var fuse := 30.0
var _tick := 0.0
var _hand: Node3D


static func place(parent: Node, point: Vector3, normal: Vector3, viewer: Vector3, seconds: float) -> StaticBody3D:
	var b = load("res://scripts/weapons/pipe_bomb.gd").new()
	b.fuse = seconds
	parent.add_child(b)
	var y := normal.normalized()
	var x := (viewer - point).cross(y)
	x = x.normalized() if x.length() > 0.01 else y.cross(Vector3.FORWARD).normalized()
	b.global_transform = Transform3D(Basis(x, y, x.cross(y)), point + y * 0.03)
	return b


## Its looks (also for the icon and in the hand).
static func model() -> Node3D:
	var root := Node3D.new()
	var steel := StandardMaterial3D.new()
	steel.albedo_color = Color(0.32, 0.32, 0.33)
	steel.metallic = 0.8
	steel.roughness = 0.45
	var tape := StandardMaterial3D.new()
	tape.albedo_color = Color(0.04, 0.04, 0.05)
	tape.roughness = 0.35
	var clock := StandardMaterial3D.new()
	clock.albedo_color = Color(0.7, 0.12, 0.1)
	clock.metallic = 0.3
	clock.roughness = 0.4
	var face := StandardMaterial3D.new()
	face.albedo_color = Color(0.92, 0.9, 0.82)
	var red := StandardMaterial3D.new()
	red.albedo_color = Color(0.8, 0.05, 0.05)
	var black := StandardMaterial3D.new()
	black.albedo_color = Color(0.05, 0.05, 0.05)
	# The pipe, lying along x, with caps.
	var pipe := MeshInstance3D.new()
	var pm := CylinderMesh.new()
	pm.top_radius = 0.028
	pm.bottom_radius = 0.028
	pm.height = 0.22
	pipe.mesh = pm
	pipe.material_override = steel
	pipe.rotation = Vector3(0, 0, PI * 0.5)
	root.add_child(pipe)
	for sx in [-1.0, 1.0]:
		var cap := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.034
		cm.bottom_radius = 0.034
		cm.height = 0.03
		cap.mesh = cm
		cap.material_override = steel
		cap.rotation = Vector3(0, 0, PI * 0.5)
		cap.position = Vector3(0.12 * sx, 0, 0)
		root.add_child(cap)
	# The tape round it.
	for x in [-0.05, 0.05]:
		var band := MeshInstance3D.new()
		var bm := CylinderMesh.new()
		bm.top_radius = 0.031
		bm.bottom_radius = 0.031
		bm.height = 0.035
		band.mesh = bm
		band.material_override = tape
		band.rotation = Vector3(0, 0, PI * 0.5)
		band.position = Vector3(x, 0, 0)
		root.add_child(band)
	# The alarm clock on top, its bells, the face.
	var body := MeshInstance3D.new()
	var clm := CylinderMesh.new()
	clm.top_radius = 0.035
	clm.bottom_radius = 0.035
	clm.height = 0.025
	body.mesh = clm
	body.material_override = clock
	body.rotation = Vector3(PI * 0.5, 0, 0)
	body.position = Vector3(0, 0.055, 0)
	root.add_child(body)
	var dial := MeshInstance3D.new()
	var dm := CylinderMesh.new()
	dm.top_radius = 0.03
	dm.bottom_radius = 0.03
	dm.height = 0.002
	dial.mesh = dm
	dial.material_override = face
	dial.rotation = Vector3(PI * 0.5, 0, 0)
	dial.position = Vector3(0, 0.055, 0.0135)
	dial.name = "Dial"
	root.add_child(dial)
	for sx in [-1.0, 1.0]:
		var bell := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.014
		sm.height = 0.016
		bell.mesh = sm
		bell.material_override = clock
		bell.position = Vector3(0.022 * sx, 0.092, 0)
		root.add_child(bell)
	var hand := Node3D.new()
	hand.name = "Hand"
	hand.position = Vector3(0, 0.055, 0.0152)
	root.add_child(hand)
	var hm := MeshInstance3D.new()
	var hb := BoxMesh.new()
	hb.size = Vector3(0.002, 0.024, 0.001)
	hm.mesh = hb
	hm.material_override = black
	hm.position = Vector3(0, 0.011, 0)
	hand.add_child(hm)
	# Two wires from the clock round into the cap.
	for w in [[red, 0.012], [black, -0.012]]:
		var wire := MeshInstance3D.new()
		var wm := CylinderMesh.new()
		wm.top_radius = 0.0022
		wm.bottom_radius = 0.0022
		wm.height = 0.12
		wire.mesh = wm
		wire.material_override = w[0]
		wire.position = Vector3(0.07, 0.035, float(w[1]))
		wire.rotation = Vector3(0, 0, 1.1)
		root.add_child(wire)
	return root


func _ready() -> void:
	collision_layer = Game.LAYER_PROPS
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(0.26, 0.1, 0.08)
	cs.shape = bs
	add_child(cs)
	var m := model()
	add_child(m)
	_hand = m.get_node("Hand")


func _process(delta: float) -> void:
	fuse -= delta
	_tick -= delta
	if _hand:
		_hand.rotation.z = -TAU * fmod(fuse, 60.0) / 60.0
	if _tick <= 0.0:
		_tick = 1.0
		Game.play_3d(Sfx.get_stream(&"key_press"), global_position, -16.0, 0.02, 1.5)
	if fuse <= 0.0:
		var none: Array[RID] = []
		Explosion.explode(get_tree(), global_position + global_basis.y * 0.05, 0.75, 0.8, none, &"bomb_blast")
		queue_free()
