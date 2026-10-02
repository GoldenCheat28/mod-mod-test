extends Node3D
# Тестовый мир. Свою карту положи в maps/ и укажи в map_scene — тестовый пол исчезнет.

@export var map_scene: PackedScene

func _ready() -> void:
	_setup_environment()
	if map_scene:
		add_child(map_scene.instantiate())
	else:
		_build_test_arena()
	_spawn_player()
	for i in 5:
		_spawn_enemy(Vector3(randf_range(-15, 15), 1, randf_range(-20, -8)))

func _setup_environment() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = Sky.new()
	env.sky.sky_material = ProceduralSkyMaterial.new()
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.ssao_enabled = true
	env.ssil_enabled = true
	env.sdfgi_enabled = true
	env.glow_enabled = true
	env.volumetric_fog_enabled = true
	env.volumetric_fog_density = 0.01
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -30, 0)
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	add_child(sun)

func _build_test_arena() -> void:
	var floor_body := StaticBody3D.new()
	var mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(60, 1, 60)
	mesh.mesh = box
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = box.size
	col.shape = shape
	floor_body.add_child(mesh)
	floor_body.add_child(col)
	floor_body.position.y = -0.5
	add_child(floor_body)

func _spawn_player() -> void:
	var p := CharacterBody3D.new()
	p.set_script(load("res://scripts/player.gd"))
	p.add_to_group("player")
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cs.shape = cap
	cs.position.y = 0.9
	p.add_child(cs)
	var head := Node3D.new(); head.name = "Head"; head.position.y = 1.6
	var cam := Camera3D.new(); cam.name = "Camera3D"; cam.current = true
	var ray := RayCast3D.new(); ray.name = "RayCast3D"
	ray.target_position = Vector3(0, 0, -100)
	ray.collide_with_areas = false
	cam.add_child(ray); head.add_child(cam); p.add_child(head)
	p.position = Vector3(0, 1, 10)
	add_child(p)

func _spawn_enemy(pos: Vector3) -> void:
	var e := CharacterBody3D.new()
	e.set_script(load("res://scripts/enemy.gd"))
	var cs := CollisionShape3D.new(); cs.name = "CollisionShape3D"
	cs.shape = CapsuleShape3D.new(); cs.position.y = 0.9
	var m := MeshInstance3D.new(); m.mesh = CapsuleMesh.new(); m.position.y = 0.9
	e.add_child(cs); e.add_child(m)
	e.position = pos
	add_child(e)
