class_name Arena
extends Node3D
# Строит карту из maps/layout.json (его генерирует tools/gen_arena_bbmodel.py,
# оттуда же берётся maps/arena.bbmodel для Blockbench).

var player_spawn := Vector3(0, 1, 24)
var enemy_spawns: Array[Vector3] = []
var _lights := 0

func _ready() -> void:
	var f := FileAccess.open("res://maps/layout.json", FileAccess.READ)
	if f == null:
		push_error("maps/layout.json не найден — запусти tools/gen_arena_bbmodel.py")
		return
	var data: Dictionary = JSON.parse_string(f.get_as_text())
	for it in data["items"]:
		_build(it)

func _v3(a: Array) -> Vector3:
	return Vector3(a[0], a[1], a[2])

func _build(it: Dictionary) -> void:
	var pos := _v3(it["p"])
	var size := _v3(it["z"])
	var rot := _v3(it["r"])
	var mat := Mats.pbr(it["m"])
	var kind: String = it["k"]
	match kind:
		"spawn":
			if String(it["n"]).begins_with("spawn_player"):
				player_spawn = pos
			else:
				enemy_spawns.append(pos)
		"static", "nocol":
			var node: Node3D = Node3D.new() if kind == "nocol" else StaticBody3D.new()
			node.position = pos
			node.rotation_degrees = rot
			node.add_child(_mesh(size, mat, "box"))
			if kind == "static":
				var c := CollisionShape3D.new()
				var s := BoxShape3D.new()
				s.size = size
				c.shape = s
				node.add_child(c)
				if rot == Vector3.ZERO and size.y > 0.15:
					var pc := GPUParticlesCollisionBox3D.new()
					pc.size = size
					node.add_child(pc)
			add_child(node)
		"prop":
			var rb := RigidBody3D.new()
			rb.position = pos
			rb.rotation_degrees = rot
			var shape_kind: String = it["s"]
			rb.add_child(_mesh(size, mat, shape_kind))
			var c := CollisionShape3D.new()
			if shape_kind == "cylinder":
				var cs := CylinderShape3D.new()
				cs.radius = size.x * 0.5
				cs.height = size.y
				c.shape = cs
			else:
				var bs := BoxShape3D.new()
				bs.size = size
				c.shape = bs
			rb.add_child(c)
			rb.mass = maxf(0.2, size.x * size.y * size.z * 60.0)
			rb.collision_layer = Game.LAYER_PROPS
			rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BODY | Game.LAYER_PLAYER
			add_child(rb)
		"light":
			var m := _mesh(size, mat, "box")
			m.position = pos
			m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(m)
			var l := OmniLight3D.new()
			l.position = pos + Vector3(0, -0.6, 0)
			l.omni_range = 16.0
			l.light_energy = 2.2
			l.light_color = Color(1.0, 0.93, 0.82)
			l.shadow_enabled = (_lights % 5 == 0)
			_lights += 1
			add_child(l)

func _mesh(size: Vector3, mat: Material, shape: String) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	if shape == "cylinder":
		var cm := CylinderMesh.new()
		cm.top_radius = size.x * 0.5
		cm.bottom_radius = size.x * 0.5
		cm.height = size.y
		cm.radial_segments = 16
		m.mesh = cm
	else:
		var bm := BoxMesh.new()
		bm.size = size
		m.mesh = bm
	m.material_override = mat
	return m
