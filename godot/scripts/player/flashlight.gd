extends Node3D
## Hand torch in the left hand (V). A real model with a spot light that casts
## shadows. It is held a little out to the left and follows the view with a
## slight lag, so the beam swings and settles as the player turns and walks.

const Sfx = preload("res://scripts/audio/sfx.gd")

## Where the hand holds it, in camera space, and the point it aims at.
const HOLD := Vector3(-0.17, -0.2, -0.36)
const AIM_AT := Vector3(0.0, -0.1, -8.0)

var on := false
var _shown := 0.0
var _light: SpotLight3D
var _lens_mat: StandardMaterial3D
var _model: Node3D
var _cam: Camera3D


func setup(cam: Camera3D) -> void:
	_cam = cam
	top_level = true
	_model = Node3D.new()
	add_child(_model)
	var body := _mat(Color(0.08, 0.08, 0.09), 0.45, 0.6)
	var ring := _mat(Color(0.35, 0.35, 0.37), 0.3, 1.0)
	# Model points along -Z: tail cap, knurled body, wider head, lens.
	_cyl(0.0165, 0.13, Vector3(0, 0, 0.02), body)
	_cyl(0.018, 0.012, Vector3(0, 0, 0.09), ring)
	_cyl(0.0235, 0.05, Vector3(0, 0, -0.065), body)
	_cyl(0.025, 0.008, Vector3(0, 0, -0.092), ring)
	_box(Vector3(0.008, 0.006, 0.016), Vector3(0, 0.018, 0.0), ring)          # switch
	_lens_mat = StandardMaterial3D.new()
	_lens_mat.albedo_color = Color(0.9, 0.92, 0.95)
	_lens_mat.emission_enabled = true
	_lens_mat.emission = Color(1.0, 0.95, 0.85)
	_lens_mat.emission_energy_multiplier = 0.0
	var lens := _cyl(0.021, 0.004, Vector3(0, 0, -0.097), _lens_mat)
	lens.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_light = SpotLight3D.new()
	_light.light_color = Color(1.0, 0.95, 0.86)
	_light.spot_range = 30.0
	_light.spot_angle = 24.0
	_light.spot_angle_attenuation = 0.6
	_light.spot_attenuation = 1.1
	_light.shadow_enabled = true
	_light.shadow_bias = 0.03
	_light.shadow_normal_bias = 1.0
	_light.light_energy = 0.0
	_light.light_size = 0.02
	_light.position = Vector3(0, 0, -0.11)
	_model.add_child(_light)
	visible = false


func _mat(c: Color, rough: float, metal: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	return m


func _cyl(r: float, h: float, pos: Vector3, mat: Material) -> MeshInstance3D:
	var cm := CylinderMesh.new()
	cm.top_radius = r
	cm.bottom_radius = r
	cm.height = h
	cm.radial_segments = 14
	var mi := MeshInstance3D.new()
	mi.mesh = cm
	mi.material_override = mat
	mi.rotation = Vector3(PI * 0.5, 0, 0)
	mi.position = pos
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_model.add_child(mi)
	return mi


func _box(size: Vector3, pos: Vector3, mat: Material) -> void:
	var bm := BoxMesh.new()
	bm.size = size
	var mi := MeshInstance3D.new()
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_model.add_child(mi)


func toggle() -> void:
	on = not on
	Game.play_3d(Sfx.get_stream(&"flashlight_click"), global_position, -6.0, 0.05, 1.0)
	if on and not visible:
		visible = true
		global_transform = _target()


## Where the torch wants to be this frame.
func _target() -> Transform3D:
	var cx := _cam.global_transform
	var lowered := 1.0 - _shown
	var p := cx * (HOLD + Vector3(0, -0.3, 0.1) * lowered)
	var aim := cx * AIM_AT
	var b := Basis.looking_at((aim - p).normalized(), cx.basis.y)
	return Transform3D(b, p)


## Point the left hand holds (grip) and which way the fingers wrap.
func grip() -> Vector3:
	return global_transform * Vector3(0, -0.01, 0.03)


func _process(delta: float) -> void:
	if _cam == null:
		return
	_shown = move_toward(_shown, 1.0 if on else 0.0, delta * 4.0)
	if _shown <= 0.0 and not on:
		visible = false
		return
	var t := _target()
	# Follows the hand with a little lag: position quickly, direction slower.
	var p := global_position.lerp(t.origin, 1.0 - exp(-delta * 28.0))
	var q := global_basis.get_rotation_quaternion().slerp(t.basis.get_rotation_quaternion(), 1.0 - exp(-delta * 12.0))
	global_transform = Transform3D(Basis(q), p)
	var e := (1.0 if on else 0.0) * (0.97 + 0.03 * sin(Time.get_ticks_msec() * 0.031))
	_light.light_energy = e * 4.0
	_lens_mat.emission_energy_multiplier = e * 6.0
