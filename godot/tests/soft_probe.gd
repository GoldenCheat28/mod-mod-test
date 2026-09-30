extends Node3D
## Dev probe: does SoftBody3D simulate under Jolt, and which point APIs exist.

var sb: SoftBody3D
var t := 0.0


func _ready() -> void:
	for m in ["apply_point_impulse", "apply_central_impulse", "get_point_transform", "set_point_pinned", "apply_impulse"]:
		print("PROBE has ", m, " = ", ClassDB.class_has_method("SoftBody3D", m))
	print("PROBE engine=", ProjectSettings.get_setting("physics/3d/physics_engine"))
	var floor_body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var b := BoxShape3D.new()
	b.size = Vector3(10, 1, 10)
	cs.shape = b
	floor_body.add_child(cs)
	floor_body.position.y = -0.5
	add_child(floor_body)
	sb = SoftBody3D.new()
	var s := SphereMesh.new()
	s.radius = 0.1
	s.height = 0.2
	s.radial_segments = 12
	s.rings = 8
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, s.get_mesh_arrays())
	sb.mesh = am
	sb.position.y = 1.0
	add_child(sb)


func _physics_process(delta: float) -> void:
	t += delta
	if absf(t - 0.5) < delta * 0.5:
		print("PROBE points y @0.5 s: ", sb.get_point_transform(0).y)
	if t > 2.0:
		print("PROBE points y @2 s: ", sb.get_point_transform(0).y, " (floor at 0)")
		get_tree().quit()