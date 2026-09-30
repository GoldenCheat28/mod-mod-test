extends Node3D
## A kitchen sponge in the hand: a block of yellow foam with the green
## scouring layer on one face, going grey-brown as it takes up dirt.

var _foam: StandardMaterial3D


func _init() -> void:
	_foam = StandardMaterial3D.new()
	_foam.albedo_color = Color(0.95, 0.82, 0.25)
	_foam.roughness = 0.95
	var scour := StandardMaterial3D.new()
	scour.albedo_color = Color(0.15, 0.42, 0.18)
	scour.roughness = 1.0
	var a := MeshInstance3D.new()
	var am := BoxMesh.new()
	am.size = Vector3(0.1, 0.03, 0.065)
	a.mesh = am
	a.material_override = _foam
	a.position = Vector3(0, 0.015, 0)
	add_child(a)
	var b := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.1, 0.012, 0.065)
	b.mesh = bm
	b.material_override = scour
	b.position = Vector3(0, -0.006, 0)
	add_child(b)


func show_dirt(k: float) -> void:
	_foam.albedo_color = Color(0.95, 0.82, 0.25).lerp(Color(0.35, 0.3, 0.22), k)
