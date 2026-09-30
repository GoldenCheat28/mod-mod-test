extends Node3D
## Chainsaw held in both hands (rear handle right, top handle left). With the
## trigger held the chain runs (its links scroll round the bar) and the saw
## shakes; the bar is a line from its root to the nose, used to find what it
## is cutting. Origin at the rear handle, the bar points along -Z.

const BAR_ROOT := Vector3(0.035, 0.0, -0.3)
const BAR_NOSE := Vector3(0.035, 0.0, -0.74)

var running := false
var _chain_mat: StandardMaterial3D
var _shake := 0.0


func _init() -> void:
	var orange := StandardMaterial3D.new()
	orange.albedo_color = Color(0.85, 0.36, 0.08)
	orange.roughness = 0.5
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.08, 0.08, 0.09)
	dark.roughness = 0.6
	var steel := StandardMaterial3D.new()
	steel.albedo_color = Color(0.55, 0.56, 0.58)
	steel.metallic = 0.85
	steel.roughness = 0.35
	# Engine housing, cylinder cover, starter, fuel cap.
	_box(Vector3(0.12, 0.16, 0.26), Vector3(0.0, 0.03, -0.14), orange)
	_box(Vector3(0.1, 0.05, 0.18), Vector3(0.0, 0.12, -0.13), dark)
	_box(Vector3(0.02, 0.11, 0.15), Vector3(-0.068, 0.03, -0.12), dark)
	_cyl(0.018, 0.02, Vector3(0.03, 0.155, -0.06), dark, Vector3(0, 0, 0))
	# Rear handle (grip loop) and the top handle arching over the body.
	_box(Vector3(0.032, 0.032, 0.15), Vector3(0.0, -0.06, 0.05), dark)
	_box(Vector3(0.032, 0.09, 0.03), Vector3(0.0, -0.02, 0.12), dark)
	_box(Vector3(0.18, 0.026, 0.026), Vector3(-0.02, 0.15, -0.2), dark)
	_box(Vector3(0.026, 0.13, 0.026), Vector3(-0.1, 0.09, -0.2), dark)
	_box(Vector3(0.026, 0.1, 0.026), Vector3(0.06, 0.1, -0.2), dark)
	# Chain brake / front hand guard.
	_box(Vector3(0.13, 0.1, 0.008), Vector3(-0.01, 0.12, -0.25), dark, Vector3(-0.3, 0, 0))
	# Guide bar and its rounded nose.
	var bar_len := BAR_ROOT.z - BAR_NOSE.z
	_box(Vector3(0.008, 0.07, bar_len), Vector3(BAR_ROOT.x, 0.0, (BAR_ROOT.z + BAR_NOSE.z) * 0.5), steel)
	_cyl(0.035, 0.008, Vector3(BAR_ROOT.x, 0.0, BAR_NOSE.z), steel, Vector3(0, 0, PI * 0.5))
	# Chain: links along the top and bottom edge, scrolling when running.
	_chain_mat = StandardMaterial3D.new()
	var img := Image.create(32, 2, false, Image.FORMAT_RGB8)
	for x in 32:
		var c := Color(0.12, 0.12, 0.13) if (x / 4) % 2 == 0 else Color(0.62, 0.62, 0.64)
		img.set_pixel(x, 0, c)
		img.set_pixel(x, 1, c)
	_chain_mat.albedo_texture = ImageTexture.create_from_image(img)
	_chain_mat.metallic = 0.7
	_chain_mat.roughness = 0.4
	_chain_mat.uv1_scale = Vector3(12.0, 1.0, 1.0)
	for y in [0.037, -0.037]:
		var link := _box(Vector3(0.012, 0.008, bar_len), Vector3(BAR_ROOT.x, y, (BAR_ROOT.z + BAR_NOSE.z) * 0.5), _chain_mat)
		link.rotation = Vector3(0, PI * 0.5, 0)
		link.scale = Vector3(1, 1, 1)
		(link.mesh as BoxMesh).size = Vector3(bar_len, 0.008, 0.012)
	for c in get_children():
		(c as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON


func _box(size: Vector3, pos: Vector3, mat: Material, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	add_child(mi)
	return mi


func _cyl(r: float, h: float, pos: Vector3, mat: Material, rot: Vector3) -> MeshInstance3D:
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
	return mi


## Hand holds: right on the rear grip, left on the top handle.
func grip_right() -> Vector3:
	return global_transform * Vector3(0.0, -0.06, 0.05)


func grip_left() -> Vector3:
	return global_transform * Vector3(-0.06, 0.15, -0.2)


func bar_root() -> Vector3:
	return global_transform * BAR_ROOT


func bar_nose() -> Vector3:
	return global_transform * BAR_NOSE


## Chain movement and the buzz of the saw (a small random shake).
func animate(delta: float, cutting: bool) -> Vector3:
	if running:
		_chain_mat.uv1_offset.x = fmod(_chain_mat.uv1_offset.x + delta * 9.0, 1.0)
	_shake = move_toward(_shake, (0.004 if running else 0.0) + (0.01 if cutting else 0.0), delta * 0.2)
	return Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * _shake
