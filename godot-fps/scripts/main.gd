extends Node3D
# Свою карту: перетащи сцену в map_scene (тогда арена не создаётся).

@export var map_scene: PackedScene

const SPAWNS := [
	Vector3(-12, 1, -14), Vector3(-2, 1, -16), Vector3(8, 1, -15),
	Vector3(14, 1, -10), Vector3(-14, 1, -10), Vector3(3, 1, -9),
]

func _ready() -> void:
	_setup_environment()
	add_child(Blood.new())
	# пол-коллайдер для частиц крови (карта должна быть на уровне y=0)
	var pc := GPUParticlesCollisionBox3D.new()
	pc.size = Vector3(200, 1, 200)
	pc.position = Vector3(0, -0.5, 0)
	add_child(pc)
	if map_scene:
		add_child(map_scene.instantiate())
		var sun := DirectionalLight3D.new()
		sun.rotation_degrees = Vector3(-50, -30, 0)
		sun.shadow_enabled = true
		sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
		add_child(sun)
	else:
		add_child(Arena.new())
	_spawn_player()
	for p in SPAWNS:
		_spawn_enemy(p)

func _setup_environment() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = Sky.new()
	env.sky.sky_material = ProceduralSkyMaterial.new()
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.4, 0.42, 0.48)
	env.ambient_light_energy = 0.5
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.ssao_enabled = true
	env.ssil_enabled = true
	env.glow_enabled = true
	env.fog_enabled = true
	env.fog_density = 0.006
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

func _spawn_player() -> void:
	var p := CharacterBody3D.new()
	p.set_script(load("res://scripts/player.gd"))
	p.add_to_group("player")
	var cs := CollisionShape3D.new()
	cs.shape = CapsuleShape3D.new()
	cs.position.y = 0.9
	p.add_child(cs)
	var head := Node3D.new()
	head.name = "Head"
	head.position.y = 1.6
	var cam := Camera3D.new()
	cam.name = "Camera3D"
	cam.current = true
	cam.fov = 85.0
	var ray := RayCast3D.new()
	ray.name = "RayCast3D"
	ray.target_position = Vector3(0, 0, -100)
	var weapon := Node3D.new()
	weapon.name = "Weapon"
	weapon.set_script(load("res://scripts/weapon.gd"))
	cam.add_child(ray)
	cam.add_child(weapon)
	head.add_child(cam)
	p.add_child(head)
	p.position = Vector3(0, 1, 12)
	add_child(p)
	var hud := CanvasLayer.new()
	hud.set_script(load("res://scripts/hud.gd"))
	add_child(hud)
	weapon.ammo_changed.connect(hud.set_ammo)
	p.health_changed.connect(hud.set_hp)
	hud.set_hp(p.hp)

func _spawn_enemy(pos: Vector3) -> void:
	var e := CharacterBody3D.new()
	e.set_script(load("res://scripts/enemy.gd"))
	var cs := CollisionShape3D.new()
	cs.name = "CollisionShape3D"
	cs.shape = CapsuleShape3D.new()
	cs.position.y = 0.9
	var body := MeshInstance3D.new()
	body.mesh = CapsuleMesh.new()
	body.position.y = 0.9
	body.material_override = Mats.get_mat("enemy", Color(0.35, 0.4, 0.3), 0.8)
	var head := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.2
	sm.height = 0.4
	head.mesh = sm
	head.position = Vector3(0, 1.75, 0)
	head.material_override = Mats.get_mat("enemy_head", Color(0.7, 0.55, 0.45), 0.8)
	e.add_child(cs)
	e.add_child(body)
	e.add_child(head)
	e.position = pos
	add_child(e)
