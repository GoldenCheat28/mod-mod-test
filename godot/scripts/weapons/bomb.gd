extends StaticBody3D
## Demolition charge with a timer, stuck to whatever it was placed on.
## Its keypad has digits 0-9, an erase key and a red one: type the seconds, press red,
## and it counts down on its little display, beeping and blinking red faster
## and faster, then goes off: a big blast that breaks doors, throws and kills
## people nearby, and leaves a lot of smoke.
## Local frame: +Y out of the surface (the keypad side), +Z towards whoever
## placed it (the keys read the right way up for them).

const Explosion = preload("res://scripts/weapons/explosion.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")

const KEY := 0.03             # key spacing
const PAD := Vector3(-0.04, 0.0, 0.0)   # keypad centre on the top face
const RED := Vector3(0.068, 0.0, 0.04)
const TOP := 0.036

var entry := ""
var armed := false
var remaining := 0.0
var _beep_t := 0.0
var _led := 0.0
var _display: Label3D
var _led_mat: StandardMaterial3D
var _keys := {}               # key index -> mesh
var _key_down := {}           # key index -> time left pressed in
var _red: MeshInstance3D
var _blink := 0.0


static func place(parent: Node, point: Vector3, normal: Vector3, viewer: Vector3) -> StaticBody3D:
	var b = load("res://scripts/weapons/bomb.gd").new()
	parent.add_child(b)
	# Keys read upright for the person who put it there: on a floor or a
	# ceiling the bottom row is towards them, on a wall the text stands up.
	var y := normal.normalized()
	var z: Vector3
	if absf(y.y) > 0.7:
		z = viewer - point
	else:
		z = Vector3.DOWN
	z = (z - y * z.dot(y))
	if z.length() < 0.01:
		z = y.cross(Vector3.RIGHT)
	z = z.normalized()
	var x := y.cross(z).normalized()
	b.global_transform = Transform3D(Basis(x, y, z), point + y * 0.035)
	return b


## The same box, for holding in the hand before it is placed.
static func model(with_parts := true) -> Node3D:
	var root := Node3D.new()
	var casing := StandardMaterial3D.new()
	casing.albedo_color = Color(0.22, 0.24, 0.2)
	casing.roughness = 0.6
	var charge := StandardMaterial3D.new()
	charge.albedo_color = Color(0.62, 0.56, 0.42)
	charge.roughness = 0.85
	var tape := StandardMaterial3D.new()
	tape.albedo_color = Color(0.12, 0.12, 0.13)
	tape.roughness = 0.4
	# Three blocks of explosive side by side, taped together, the timer on top.
	for i in 3:
		_box(root, Vector3(0.075, 0.05, 0.16), Vector3(-0.08 + i * 0.08, -0.008, 0), charge)
	for zz in [-0.05, 0.05]:
		_box(root, Vector3(0.25, 0.054, 0.02), Vector3(0, -0.008, zz), tape)
	_box(root, Vector3(0.2, 0.02, 0.13), Vector3(0, 0.026, 0), casing)
	if with_parts:
		var wire := StandardMaterial3D.new()
		wire.albedo_color = Color(0.7, 0.1, 0.08)
		_box(root, Vector3(0.004, 0.004, 0.14), Vector3(0.1, 0.02, -0.01), wire, Vector3(0, 0.3, 0))
	return root


static func _box(parent: Node3D, size: Vector3, pos: Vector3, mat: Material, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	parent.add_child(mi)
	return mi


func _ready() -> void:
	collision_layer = Game.LAYER_PROPS
	collision_mask = 0
	set_meta("surface", "metal")
	add_child(model())
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = Vector3(0.25, 0.075, 0.17)
	cs.shape = sh
	add_child(cs)
	var key_mat := StandardMaterial3D.new()
	key_mat.albedo_color = Color(0.1, 0.1, 0.1)
	key_mat.roughness = 0.5
	for i in [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11]:
		var k := _box(self, Vector3(0.024, 0.008, 0.024), key_pos(i), key_mat)
		_keys[i] = k
		var l := Label3D.new()
		l.text = key_label(i)
		l.font_size = 48
		l.pixel_size = 0.0004
		l.outline_size = 0
		l.modulate = Color(0.85, 0.85, 0.8)
		l.rotation = Vector3(-PI * 0.5, 0, 0)
		l.position = Vector3(0, 0.0045, 0)
		k.add_child(l)
	var red_mat := StandardMaterial3D.new()
	red_mat.albedo_color = Color(0.75, 0.05, 0.04)
	red_mat.roughness = 0.35
	var rb := CylinderMesh.new()
	rb.top_radius = 0.014
	rb.bottom_radius = 0.015
	rb.height = 0.01
	_red = MeshInstance3D.new()
	_red.mesh = rb
	_red.material_override = red_mat
	_red.position = RED + Vector3(0, TOP + 0.004, 0)
	add_child(_red)
	# Display window.
	_box(self, Vector3(0.06, 0.004, 0.028), Vector3(0.068, TOP + 0.001, -0.035), key_mat)
	_display = Label3D.new()
	_display.font_size = 64
	_display.pixel_size = 0.0005
	_display.modulate = Color(1.0, 0.15, 0.1)
	_display.shaded = false
	_display.rotation = Vector3(-PI * 0.5, 0, 0)
	_display.position = Vector3(0.068, TOP + 0.0035, -0.035)
	add_child(_display)
	# Red LED.
	_led_mat = StandardMaterial3D.new()
	_led_mat.albedo_color = Color(0.3, 0.02, 0.02)
	_led_mat.emission_enabled = true
	_led_mat.emission = Color(1.0, 0.08, 0.05)
	_led_mat.emission_energy_multiplier = 0.0
	var led := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.004
	sm.height = 0.008
	led.mesh = sm
	led.material_override = _led_mat
	led.position = Vector3(0.09, TOP + 0.002, 0.005)
	add_child(led)
	_update_display()


## Keys: 0..8 are the digits 1..9, 9 the red button, 10 the digit 0 and 11
## erase (bottom row: erase, 0).
func key_label(i: int) -> String:
	if i == 10:
		return "0"
	if i == 11:
		return "<"
	return str(i + 1)


## Centre of key i on the top face, local.
func key_pos(i: int) -> Vector3:
	var col := i % 3
	var row := i / 3
	if i == 10:
		col = 1
		row = 3
	elif i == 11:
		col = 0
		row = 3
	return PAD + Vector3((col - 1) * KEY, TOP, (row - 1.5) * KEY)


## The key under a world point: 0..8 digits, 9 = red, -1 = none.
func key_at(world: Vector3) -> int:
	var p := to_local(world)
	if p.y < TOP - 0.02:
		return -1
	var flat := Vector2(p.x, p.z)
	if flat.distance_to(Vector2(RED.x, RED.z)) < 0.02:
		return 9
	for i in _keys.keys():
		var k := key_pos(i)
		if absf(flat.x - k.x) < 0.014 and absf(flat.y - k.z) < 0.014:
			return i
	return -1


func key_world(i: int) -> Vector3:
	var p := RED + Vector3(0, TOP + 0.008, 0) if i == 9 else key_pos(i) + Vector3(0, 0.005, 0)
	return global_transform * p


## A finger lands on key i.
func press(i: int) -> void:
	Game.play_3d(Sfx.get_stream(&"key_press"), key_world(i), -14.0, 0.05, 1.0)
	if i == 9:
		_red.position.y = TOP + 0.001
		get_tree().create_timer(0.15).timeout.connect(func(): if is_instance_valid(_red): _red.position.y = TOP + 0.004)
		if not armed and entry != "" and int(entry) > 0:
			armed = true
			remaining = float(int(entry))
			_beep_t = 0.0
		return
	_key_down[i] = 0.12
	if armed:
		return
	if i == 11:
		entry = entry.substr(0, maxi(entry.length() - 1, 0))
	else:
		if entry.length() >= 3:
			entry = ""
		entry += "0" if i == 10 else str(i + 1)
	_update_display()


func _update_display() -> void:
	if armed:
		_display.text = "%d" % int(ceil(remaining))
	elif entry == "":
		_display.text = "_" if fmod(_blink, 1.0) < 0.5 else " "
	else:
		_display.text = entry


func _process(delta: float) -> void:
	_blink += delta
	for i in _key_down.keys():
		_key_down[i] = float(_key_down[i]) - delta
		_keys[i].position.y = key_pos(i).y - (0.003 if _key_down[i] > 0.0 else 0.0)
		if _key_down[i] <= 0.0:
			_key_down.erase(i)
	_led = move_toward(_led, 0.0, delta * 12.0)
	_led_mat.emission_energy_multiplier = _led * 8.0
	if not armed:
		_update_display()
		return
	remaining -= delta
	_beep_t -= delta
	if _beep_t <= 0.0:
		# Beeps speed up as the end comes: once a second, down to ten a second.
		_beep_t = clampf(0.15 + remaining * 0.08, 0.1, 1.0)
		_led = 1.0
		Game.play_3d(Sfx.get_stream(&"beep"), global_position, -6.0, 0.0, 3.0)
	_update_display()
	if remaining <= 0.0:
		var ex: Array[RID] = [get_rid()]
		Explosion.explode(get_tree(), global_position + global_basis.y * 0.1, 2.6, 2.2, ex, &"bomb_blast")
		queue_free()
