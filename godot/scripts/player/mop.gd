extends Node3D
## A mop: a wooden handle and a head of cotton strings. Its origin is where
## the head touches the floor, +Y up the handle. The strings darken as they
## soak up water and go red-brown with the blood they take up.

var _strings: Array[MeshInstance3D] = []
var _mat: StandardMaterial3D
var _top := Vector3.UP


func _init() -> void:
	var wood := StandardMaterial3D.new()
	wood.albedo_color = Color(0.55, 0.42, 0.28)
	wood.roughness = 0.6
	var metal := StandardMaterial3D.new()
	metal.albedo_color = Color(0.5, 0.5, 0.52)
	metal.metallic = 0.8
	metal.roughness = 0.4
	_mat = StandardMaterial3D.new()
	_mat.albedo_color = Color(0.85, 0.83, 0.76)
	_mat.roughness = 0.95
	var plastic := StandardMaterial3D.new()
	plastic.albedo_color = Color(0.75, 0.12, 0.08)
	plastic.roughness = 0.45
	# A varnished wooden handle, worn pale where the hands go, a red plastic
	# cap with a hole to hang it by.
	var handle := MeshInstance3D.new()
	var hm := CylinderMesh.new()
	hm.top_radius = 0.0125
	hm.bottom_radius = 0.0135
	hm.height = 1.3
	hm.radial_segments = 10
	handle.mesh = hm
	handle.material_override = wood
	handle.position = Vector3(0, 0.74, 0)
	add_child(handle)
	var worn := StandardMaterial3D.new()
	worn.albedo_color = Color(0.68, 0.56, 0.4)
	worn.roughness = 0.75
	for y in [0.78, 1.18]:
		var band := MeshInstance3D.new()
		var bm0 := CylinderMesh.new()
		bm0.top_radius = 0.0137
		bm0.bottom_radius = 0.0137
		bm0.height = 0.16
		bm0.radial_segments = 10
		band.mesh = bm0
		band.material_override = worn
		band.position = Vector3(0, y, 0)
		add_child(band)
	var cap := MeshInstance3D.new()
	var capm := CylinderMesh.new()
	capm.top_radius = 0.012
	capm.bottom_radius = 0.016
	capm.height = 0.05
	cap.mesh = capm
	cap.material_override = plastic
	cap.position = Vector3(0, 1.41, 0)
	add_child(cap)
	var ring := MeshInstance3D.new()
	var rt := TorusMesh.new()
	rt.inner_radius = 0.006
	rt.outer_radius = 0.011
	ring.mesh = rt
	ring.material_override = plastic
	ring.rotation = Vector3(0, 0, PI * 0.5)
	ring.position = Vector3(0, 1.45, 0)
	add_child(ring)
	# The metal ferrule and the plastic clamp the strings are bound in.
	var clamp_mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.018
	cm.bottom_radius = 0.03
	cm.height = 0.07
	clamp_mi.mesh = cm
	clamp_mi.material_override = metal
	clamp_mi.position = Vector3(0, 0.1, 0)
	add_child(clamp_mi)
	var holder := MeshInstance3D.new()
	var hb := CylinderMesh.new()
	hb.top_radius = 0.034
	hb.bottom_radius = 0.038
	hb.height = 0.035
	holder.mesh = hb
	holder.material_override = plastic
	holder.position = Vector3(0, 0.055, 0)
	add_child(holder)
	# The strings: a thick bunch of thin cords, each hanging down from the
	# clamp and then lying out over the floor, all of different lengths.
	var rng := RandomNumberGenerator.new()
	rng.seed = 12
	for i in 44:
		var a := TAU * i / 44.0 + rng.randf_range(-0.08, 0.08)
		var out := Vector3(cos(a), 0, sin(a))
		var len1 := rng.randf_range(0.07, 0.1)
		var len2 := rng.randf_range(0.08, 0.2)
		var w := rng.randf_range(0.006, 0.009)
		for seg in 2:
			var st := MeshInstance3D.new()
			var sm := BoxMesh.new()
			sm.size = Vector3(w, len1 if seg == 0 else len2, w * 0.8)
			st.mesh = sm
			st.material_override = _mat
			if seg == 0:
				# From the clamp down and out.
				st.position = out * 0.035 + Vector3(0, 0.035, 0)
				st.rotation = Vector3(0, -a, 0)
				st.rotate_object_local(Vector3.FORWARD, 0.55 + rng.randf_range(-0.1, 0.15))
				st.translate_object_local(Vector3(0, -len1 * 0.5, 0))
			else:
				# Then flopped over along the floor.
				st.position = out * (0.07 + len2 * 0.45) + Vector3(0, 0.006, 0)
				st.rotation = Vector3(0, -a, 0)
				st.rotate_object_local(Vector3.FORWARD, PI * 0.5 - rng.randf_range(0.0, 0.2))
			add_child(st)
			_strings.append(st)
	for c in get_children():
		if c is GeometryInstance3D:
			(c as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON


## Stood with its head at `head` on the floor and the handle up to `top`.
func pose(head: Vector3, top: Vector3) -> void:
	_top = top
	var y := (top - head).normalized()
	var x := y.cross(Vector3.FORWARD if absf(y.z) < 0.9 else Vector3.RIGHT).normalized()
	global_transform = Transform3D(Basis(x, y, x.cross(y)), head)


## Wet (0..1) and bloody (0..1): the colour of the strings.
func show_state(water: float, dirt: float) -> void:
	var c := Color(0.85, 0.83, 0.76).lerp(Color(0.55, 0.54, 0.5), water)
	c = c.lerp(Color(0.42, 0.12, 0.09), clampf(dirt, 0.0, 1.0) * 0.8)
	_mat.albedo_color = c
	_mat.roughness = lerpf(0.95, 0.55, water)


## Where the hands hold it: right lower down the handle, left near the top.
func grip_right() -> Vector3:
	return global_transform * Vector3(0, 0.78, 0)


func grip_left() -> Vector3:
	return global_transform * Vector3(0, 1.18, 0)
