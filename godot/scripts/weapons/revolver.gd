extends Node3D
## Six-shot revolver for Russian roulette. The cylinder swings out to the
## left on its crane to load, spins, and turns one chamber per pull of the
## trigger (the hammer comes back and falls). Origin in the hand (top of the
## grip); the barrel points along -Z.

const Shape = preload("res://scripts/weapons/shape.gd")
const CHAMBERS := 6
const MUZZLE := Vector3(0.0, 0.035, -0.19)
const CYL_AXIS := Vector3(0.0, 0.035, -0.03)   # centre of the cylinder when shut

var loaded := -1                 # chamber with the round in it, or -1
var chamber := 0                 # chamber under the hammer
var open := 0.0                  # the cylinder swung out, 0..1
var spin := 0.0                  # extra cylinder turn (rad), for spinning
var hammer := 0.0                # hammer back, 0..1
var round_in := 0.0              # the round going into its chamber, 0..1 (1 = in)
var rounds := -1                 # as a gun in hand: how many chambers hold a round (-1: roulette's one)

var _crane: Node3D
var _cyl: Node3D
var _hammer: Node3D
var _round: MeshInstance3D       # the one cartridge (in the cylinder or on its way)
var _rounds: Array[MeshInstance3D] = []


func _init() -> void:
	var blued := StandardMaterial3D.new()
	blued.albedo_color = Color(0.1, 0.1, 0.11)
	blued.metallic = 0.85
	blued.roughness = 0.35
	var wood := StandardMaterial3D.new()
	wood.albedo_color = Color(0.3, 0.16, 0.08)
	wood.roughness = 0.6
	var brass := StandardMaterial3D.new()
	brass.albedo_color = Color(0.78, 0.6, 0.25)
	brass.metallic = 0.9
	brass.roughness = 0.3
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.02, 0.02, 0.02)
	# Shapes cut out in profile (side view) and given their thickness, the way
	# the real parts are: the frame with its top strap over the cylinder, the
	# barrel with the ejector shroud under it and the front sight ramp on top,
	# the rounded wooden grip with chequered panels, trigger, guard, hammer.
	var chequer := StandardMaterial3D.new()
	chequer.albedo_color = Color(0.2, 0.1, 0.05)
	chequer.roughness = 0.85
	# Frame: top strap, the window for the cylinder, the front where the
	# barrel screws in, down to the trigger guard and back to the grip.
	add_child(Shape.extrude(PackedVector2Array([Vector2(0.022, 0.034), Vector2(0.012, 0.052), Vector2(-0.012, 0.056),
			Vector2(-0.056, 0.056), Vector2(-0.062, 0.05), Vector2(-0.062, 0.016), Vector2(-0.05, 0.006),
			Vector2(-0.012, 0.004), Vector2(0.004, 0.0), Vector2(0.016, 0.012)]), 0.011, blued))
	# (the cylinder window: dark inside where the cylinder turns)
	_box(Vector3(0.0235, 0.03, 0.042), Vector3(0.0, 0.035, -0.03), dark)
	# Barrel, the ejector shroud under it, and the rib with the sight ramp.
	_tube(0.0085, 0.13, Vector3(0.0, 0.035, -0.125), blued, Vector3(PI * 0.5, 0, 0))
	add_child(Shape.extrude(PackedVector2Array([Vector2(-0.06, 0.03), Vector2(-0.186, 0.03), Vector2(-0.19, 0.024),
			Vector2(-0.184, 0.018), Vector2(-0.06, 0.018)]), 0.0065, blued))
	add_child(Shape.extrude(PackedVector2Array([Vector2(-0.058, 0.042), Vector2(-0.188, 0.042), Vector2(-0.19, 0.045),
			Vector2(-0.185, 0.054), Vector2(-0.176, 0.047), Vector2(-0.058, 0.047)]), 0.0035, blued))
	_tube(0.0042, 0.003, MUZZLE + Vector3(0, 0.002, -0.0005), dark, Vector3(PI * 0.5, 0, 0))
	# The recoil shield: the frame closes behind the cylinder, so with it shut
	# the backs of the cartridges are not seen (only when it swings out).
	_box(Vector3(0.04, 0.042, 0.005), Vector3(0.0, 0.035, CYL_AXIS.z + 0.0235), blued)
	# Rear sight: a groove along the top strap.
	_box(Vector3(0.003, 0.002, 0.03), Vector3(0.0, 0.0565, -0.0), dark)
	# Trigger guard (a curved loop) and the trigger in it.
	var guard := PackedVector2Array()
	for i in 9:
		var a := PI * i / 8.0
		guard.append(Vector2(-0.022 - cos(a) * 0.022, 0.004 - sin(a) * 0.021))
	for i in range(8, -1, -1):
		var a := PI * i / 8.0
		guard.append(Vector2(-0.022 - cos(a) * 0.018, 0.004 - sin(a) * 0.017))
	add_child(Shape.extrude(guard, 0.003, blued, 0.0004))
	add_child(Shape.extrude(PackedVector2Array([Vector2(-0.018, 0.004), Vector2(-0.024, -0.006), Vector2(-0.022, -0.016),
			Vector2(-0.016, -0.019), Vector2(-0.02, -0.008), Vector2(-0.013, 0.004)]), 0.0028, blued))
	# The grip: rounded, raked back, the wood panels with chequering.
	var grip_shape := PackedVector2Array([Vector2(0.004, 0.004), Vector2(0.02, 0.012), Vector2(0.032, -0.012),
			Vector2(0.04, -0.045), Vector2(0.041, -0.07), Vector2(0.034, -0.088), Vector2(0.016, -0.093),
			Vector2(0.0, -0.088), Vector2(-0.006, -0.066), Vector2(-0.006, -0.03), Vector2(-0.002, -0.008)])
	add_child(Shape.extrude(grip_shape, 0.0145, wood))
	for sx in [-1.0, 1.0]:
		var panel := Shape.extrude(PackedVector2Array([Vector2(0.012, -0.012), Vector2(0.03, -0.02), Vector2(0.035, -0.06),
				Vector2(0.028, -0.078), Vector2(0.008, -0.075), Vector2(0.003, -0.04)]), 0.0012, chequer)
		panel.position.x = 0.0148 * sx
		add_child(panel)
		_tube(0.003, 0.002, Vector3(0.0162 * sx, -0.045, 0.02), blued, Vector3(0, 0, PI * 0.5))

	# The cylinder, on a crane hinged below-left of it so it swings out.
	_crane = Node3D.new()
	_crane.position = CYL_AXIS + Vector3(-0.015, -0.018, 0.0)
	add_child(_crane)
	_cyl = Node3D.new()
	_cyl.position = Vector3(0.015, 0.018, 0.0)
	_crane.add_child(_cyl)
	var body := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.019
	cm.bottom_radius = 0.019
	cm.height = 0.038
	body.mesh = cm
	body.material_override = blued
	body.rotation = Vector3(PI * 0.5, 0, 0)
	_cyl.add_child(body)
	for i in CHAMBERS:
		# A flute on the outside between two chambers.
		var fa := TAU * (i + 0.5) / CHAMBERS
		var flute := MeshInstance3D.new()
		var fb := BoxMesh.new()
		fb.size = Vector3(0.006, 0.003, 0.026)
		flute.mesh = fb
		flute.material_override = dark
		flute.position = Vector3(sin(fa), cos(fa), 0.0) * 0.0185
		flute.rotation = Vector3(0, 0, -fa)
		_cyl.add_child(flute)
	for i in CHAMBERS:
		var a := TAU * i / CHAMBERS
		var at := Vector3(sin(a), cos(a), 0.0) * 0.011
		var hole := MeshInstance3D.new()
		var hm := CylinderMesh.new()
		hm.top_radius = 0.0045
		hm.bottom_radius = 0.0045
		hm.height = 0.039
		hole.mesh = hm
		hole.material_override = dark
		hole.position = at
		hole.rotation = Vector3(PI * 0.5, 0, 0)
		_cyl.add_child(hole)
		var r := MeshInstance3D.new()
		var rm := CylinderMesh.new()
		rm.top_radius = 0.0048
		rm.bottom_radius = 0.0048
		rm.height = 0.004
		r.mesh = rm
		r.material_override = brass
		r.position = at + Vector3(0, 0, 0.0195)
		r.rotation = Vector3(PI * 0.5, 0, 0)
		r.visible = false
		_cyl.add_child(r)
		_rounds.append(r)
	# The loose cartridge, shown while it goes in.
	_round = MeshInstance3D.new()
	var lm := CylinderMesh.new()
	lm.top_radius = 0.0045
	lm.bottom_radius = 0.0048
	lm.height = 0.038
	_round.mesh = lm
	_round.material_override = brass
	_round.visible = false
	add_child(_round)
	# Hammer, pivoting at the back of the frame.
	_hammer = Node3D.new()
	_hammer.position = Vector3(0.0, 0.045, 0.006)
	add_child(_hammer)
	_hammer.add_child(Shape.extrude(PackedVector2Array([Vector2(-0.004, 0.0), Vector2(-0.006, 0.012), Vector2(-0.002, 0.018),
			Vector2(0.008, 0.02), Vector2(0.016, 0.016), Vector2(0.006, 0.012), Vector2(0.004, 0.0)]), 0.003, blued))
	for c in find_children("*", "MeshInstance3D", true, false):
		(c as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON


func _box(size: Vector3, pos: Vector3, mat: Material, rot := Vector3.ZERO) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	add_child(mi)


func _tube(r: float, h: float, pos: Vector3, mat: Material, rot: Vector3) -> void:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = r
	cm.bottom_radius = r
	cm.height = h
	mi.mesh = cm
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	add_child(mi)


func _process(_delta: float) -> void:
	_crane.rotation = Vector3(0, 0, 1.35 * smoothstep(0.0, 1.0, open))
	# Chamber `chamber` sits at the top, under the hammer.
	_cyl.rotation = Vector3(0, 0, TAU * chamber / CHAMBERS + spin)
	_hammer.rotation = Vector3(0.75 * hammer, 0, 0)
	for i in CHAMBERS:
		if rounds >= 0:
			_rounds[i].visible = (i - chamber + CHAMBERS) % CHAMBERS < rounds
		else:
			_rounds[i].visible = i == loaded and round_in >= 1.0
	# The cartridge on its way: from below and behind, into the back of the
	# open cylinder's top chamber.
	_round.visible = round_in > 0.0 and round_in < 1.0
	if _round.visible:
		var hole := _cyl.global_transform * (Vector3(sin(TAU * loaded / CHAMBERS), cos(TAU * loaded / CHAMBERS), 0.0) * 0.011
				- Vector3(0, 0, -0.0) - Vector3.ZERO)
		var local_hole := global_transform.affine_inverse() * hole
		var start := local_hole + Vector3(-0.03, -0.06, 0.07)
		var k := smoothstep(0.0, 1.0, round_in)
		_round.position = start.lerp(local_hole + Vector3(0, 0, 0.022 * (1.0 - k)), k)
		_round.rotation = Vector3(PI * 0.5, 0, 0)


## Where a hand holds it (world) and where the muzzle is.
func grip() -> Vector3:
	return global_transform * Vector3(0.0, -0.01, 0.012)


func muzzle() -> Vector3:
	return global_transform * MUZZLE


## Where the left hand is while loading: at the cartridge.
func round_hand() -> Vector3:
	return _round.global_position if _round.visible else global_transform * Vector3(-0.03, -0.02, -0.03)


## The trigger pulled through: the cylinder turns the next chamber up and the
## hammer falls on it. Returns whether that was the round.
func fire() -> bool:
	chamber = (chamber + 1) % CHAMBERS
	return chamber == loaded
