extends StaticBody3D
## A light switch on a wall of the abandoned building, and the bare bulbs it
## works: each hangs on its flex from the ceiling, dead until switched on.
## F on the switch flips it (in a game with others, for everyone: net.gd).
## One of the old bulbs does not quite hold: it flickers now and then.

const Sfx = preload("res://scripts/audio/sfx.gd")

var on := false
var _bulbs: Array = []           # [OmniLight3D, glass material, flickers]
var _toggle: MeshInstance3D
var _flick := 0.0
var _flick_k := 1.0


## A switch at `at` on a wall facing out along `normal`, for bulbs hanging
## at the points `bulbs` (the top of the flex, on the ceiling).
static func build(parent: Node3D, at: Vector3, normal: Vector3, bulbs: Array, flicker_one := false) -> StaticBody3D:
	var s = load("res://scripts/world/light_switch.gd").new()
	parent.add_child(s)
	var n := normal.normalized()
	var x := Vector3.UP.cross(n).normalized()
	s.global_transform = Transform3D(Basis(x, Vector3.UP, n), at)
	s._make_switch()
	for i in bulbs.size():
		s._make_bulb(parent, bulbs[i], flicker_one and i == 0)
	s.set_meta("switch", true)
	Net.register_switch(s)
	return s


func _make_switch() -> void:
	collision_layer = Game.LAYER_PROPS
	collision_mask = 0
	var plate_mat := StandardMaterial3D.new()
	plate_mat.albedo_color = Color(0.78, 0.75, 0.66)
	plate_mat.roughness = 0.6
	var plate := MeshInstance3D.new()
	var pb := BoxMesh.new()
	pb.size = Vector3(0.085, 0.085, 0.018)
	plate.mesh = pb
	plate.material_override = plate_mat
	plate.position = Vector3(0, 0, 0.009)
	add_child(plate)
	_toggle = MeshInstance3D.new()
	var tb := BoxMesh.new()
	tb.size = Vector3(0.03, 0.045, 0.016)
	_toggle.mesh = tb
	var tm := StandardMaterial3D.new()
	tm.albedo_color = Color(0.9, 0.88, 0.8)
	_toggle.material_override = tm
	_toggle.position = Vector3(0, 0, 0.022)
	add_child(_toggle)
	# (a grubby wire running up the wall from it)
	var wire := MeshInstance3D.new()
	var wb := BoxMesh.new()
	wb.size = Vector3(0.012, 1.4, 0.01)
	wire.mesh = wb
	var wm := StandardMaterial3D.new()
	wm.albedo_color = Color(0.2, 0.19, 0.17)
	wire.material_override = wm
	wire.position = Vector3(0, 0.74, 0.006)
	add_child(wire)
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(0.12, 0.12, 0.06)
	cs.shape = bs
	cs.position = Vector3(0, 0, 0.03)
	add_child(cs)
	_show()


func _make_bulb(parent: Node3D, top: Vector3, flickers: bool) -> void:
	var flex_len := 0.55
	var cord := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.004
	cm.bottom_radius = 0.004
	cm.height = flex_len
	cord.mesh = cm
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.08, 0.08, 0.08)
	cord.material_override = dark
	# (right by the light: they would throw a huge shadow over the ceiling)
	cord.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(cord)
	cord.global_position = top + Vector3.DOWN * flex_len * 0.5
	var holder := MeshInstance3D.new()
	var hm := CylinderMesh.new()
	hm.top_radius = 0.018
	hm.bottom_radius = 0.022
	hm.height = 0.045
	holder.mesh = hm
	holder.material_override = dark
	holder.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(holder)
	holder.global_position = top + Vector3.DOWN * (flex_len + 0.02)
	var glass := MeshInstance3D.new()
	var gm := SphereMesh.new()
	gm.radius = 0.035
	gm.height = 0.085
	glass.mesh = gm
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.85, 0.82, 0.7, 0.8)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.emission_enabled = true
	mat.emission = Color(1.0, 0.72, 0.4)
	mat.emission_energy_multiplier = 0.0
	glass.material_override = mat
	glass.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(glass)
	glass.global_position = top + Vector3.DOWN * (flex_len + 0.08)
	var light := OmniLight3D.new()
	light.light_color = Color(1.0, 0.74, 0.46)
	light.omni_range = 6.0
	light.omni_attenuation = 1.3
	# Shadows: only the nearest couple of bulbs cast them (see _shadow_pick),
	# in two passes (the paraboloid) rather than six. People (visual layer 2:
	# dozens of pieces each) cast none from a bulb - the rooms do.
	light.shadow_enabled = false
	light.omni_shadow_mode = OmniLight3D.SHADOW_DUAL_PARABOLOID
	light.shadow_caster_mask = 0xFFFFFFFF & ~2
	light.distance_fade_enabled = true
	light.distance_fade_begin = 24.0
	light.distance_fade_length = 6.0
	light.distance_fade_shadow = 14.0
	light.light_volumetric_fog_energy = 1.5
	light.visible = false
	light.add_to_group(&"lamp_light")
	parent.add_child(light)
	light.global_position = glass.global_position + Vector3.DOWN * 0.06
	_bulbs.append([light, mat, flickers])


## F: flip it (through the net when there are others).
func use() -> void:
	Net.flip_switch(self, not on)


func set_on(v: bool) -> void:
	if v == on:
		return
	on = v
	Game.play_3d(Sfx.get_stream(&"key_press"), global_position, -8.0, 0.1, 2.0)
	_show()


func _show() -> void:
	if _toggle:
		_toggle.rotation.x = -0.35 if on else 0.35
	for b in _bulbs:
		(b[0] as OmniLight3D).visible = on
		(b[0] as OmniLight3D).light_energy = 1.6
		(b[1] as StandardMaterial3D).emission_energy_multiplier = 7.0 if on else 0.0


static var _pick_frame := -1
static var _pick_t := 0.0
static var _fade_frame := -1


## Every bulb with a shadow costs the whole scene drawn again from it: only
## the two lit bulbs nearest the eye get one (a quarter second's look round).
static func _shadow_pick(tree: SceneTree, delta: float) -> void:
	var f := Engine.get_process_frames()
	if f == _pick_frame:
		return
	_pick_frame = f
	_pick_t -= delta
	if _pick_t > 0.0:
		return
	_pick_t = 0.25
	var cam := tree.root.get_viewport().get_camera_3d()
	if cam == null:
		return
	var lit: Array = []
	for l in tree.get_nodes_in_group(&"lamp_light"):
		if l is OmniLight3D and l.visible:
			lit.append(l)
	var eye := cam.global_position
	lit.sort_custom(func(a, b): return a.global_position.distance_squared_to(eye) < b.global_position.distance_squared_to(eye))
	var n: int = [0, 1, 2][clampi(Game.quality, 0, 2)]
	for i in lit.size():
		var l: OmniLight3D = lit[i]
		# (a little slack, so two bulbs about as near do not keep swapping)
		var keep := l.shadow_enabled and i < n + 1 and l.global_position.distance_to(eye) < 13.5
		l.set_meta("shadow_want", (i < n and l.global_position.distance_to(eye) < 12.0) or keep)


## Shadows come and go softly (not snapping on and off as the eye moves).
static func _shadow_fade(tree: SceneTree, delta: float) -> void:
	for l in tree.get_nodes_in_group(&"lamp_light"):
		if not (l is OmniLight3D):
			continue
		var want: bool = l.get_meta("shadow_want", false) and l.visible
		var o: float = l.get_meta("shadow_k", 0.0)
		o = move_toward(o, 1.0 if want else 0.0, delta * 2.0)
		l.set_meta("shadow_k", o)
		l.shadow_enabled = o > 0.01
		l.shadow_opacity = o


func _process(delta: float) -> void:
	_shadow_pick(get_tree(), delta)
	if Engine.get_process_frames() != _fade_frame:
		_fade_frame = Engine.get_process_frames()
		_shadow_fade(get_tree(), delta)
	if not on:
		return
	_flick -= delta
	if _flick > 0.0:
		return
	_flick = randf_range(0.04, 0.5)
	_flick_k = 1.0 if randf() < 0.85 else randf_range(0.05, 0.4)
	for b in _bulbs:
		if b[2]:
			(b[0] as OmniLight3D).light_energy = 1.6 * _flick_k
			(b[1] as StandardMaterial3D).emission_energy_multiplier = 7.0 * _flick_k
