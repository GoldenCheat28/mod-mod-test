extends Node3D
# Свою карту: перетащи сцену в map_scene (тогда арена не создаётся).

@export var map_scene: PackedScene

const MAP_PATHS := ["res://maps/map.glb", "res://maps/map.gltf"]

var region: NavigationRegion3D
var player_spawn := Vector3(0, 1, 24)
var enemy_spawns: Array[Vector3] = []
var has_lights := false

func _ready() -> void:
	_setup_environment()
	Game.reset()
	var blood := Node3D.new()
	blood.name = "Blood"
	blood.set_script(load("res://scripts/fx/blood.gd"))
	add_child(blood)
	Game.blood = blood
	var holes := Node3D.new()
	holes.name = "BulletHoles"
	holes.set_script(load("res://scripts/fx/bullet_holes.gd"))
	add_child(holes)
	Game.holes = holes
	# пол-коллайдер для частиц крови (уровень y=0)
	var pc := GPUParticlesCollisionBox3D.new()
	pc.size = Vector3(200, 1, 200)
	pc.position = Vector3(0, -0.5, 0)
	add_child(pc)
	# навигация: navmesh запекается по статическим коллайдерам
	region = NavigationRegion3D.new()
	var nm := NavigationMesh.new()
	nm.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	nm.cell_size = 0.25
	nm.cell_height = 0.25
	nm.agent_radius = 0.5
	nm.agent_height = 2.0
	nm.agent_max_climb = 0.25
	region.navigation_mesh = nm
	add_child(region)
	var scene := map_scene
	if scene == null:
		for path in MAP_PATHS:
			if ResourceLoader.exists(path):
				scene = load(path)
				break
	if scene:
		var map := scene.instantiate() as Node3D
		region.add_child(map)
		_prepare_map(map)
		if not has_lights:
			var sun := DirectionalLight3D.new()
			sun.rotation_degrees = Vector3(-50, -30, 0)
			sun.shadow_enabled = true
			sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
			add_child(sun)
	else:
		var arena := Arena.new()
		region.add_child(arena)
		player_spawn = arena.player_spawn
		enemy_spawns = arena.enemy_spawns
	region.bake_navigation_mesh(false)
	_spawn_player()
	for p in enemy_spawns:
		_spawn_enemy(p)

# Карта из Blockbench (glb): коллизии, лампы, пропсы, точки спавна — по именам объектов.
#   spawn_player, spawn_enemy*  — точки спавна (кубы удаляются)
#   light_*                     — светящаяся панель + источник света
#   prop_*                      — физический предмет (ящик, бочка, мусор)
#   nocol_*                     — без коллизии
func _prepare_map(root: Node3D) -> void:
	var meshes: Array[MeshInstance3D] = []
	for n in root.find_children("*", "MeshInstance3D", true, false):
		meshes.append(n as MeshInstance3D)
	var box := AABB()
	for i in meshes.size():
		var wb := meshes[i].global_transform * meshes[i].get_aabb()
		box = wb if i == 0 else box.merge(wb)
	if box.size.x > 200.0 or box.size.z > 200.0:
		root.scale = Vector3.ONE / 16.0   # glb в единицах Blockbench (16 = 1 м)
	var light_i := 0
	for mi in meshes:
		var nm := String(mi.name).to_lower()
		var center := mi.global_transform * mi.get_aabb().get_center()
		if nm.begins_with("spawn_player"):
			player_spawn = center
			mi.queue_free()
		elif nm.begins_with("spawn_enemy"):
			enemy_spawns.append(center)
			mi.queue_free()
		elif nm.begins_with("light_"):
			has_lights = true
			mi.material_override = Mats.emissive("panel", Color(1.0, 0.95, 0.85), 3.0)
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			var l := OmniLight3D.new()
			l.omni_range = 11.0
			l.light_energy = 1.4
			l.light_color = Color(1.0, 0.93, 0.82)
			l.shadow_enabled = (light_i % 4 == 0)
			light_i += 1
			region.add_child(l)
			l.global_position = center + Vector3(0, -0.6, 0)
		elif nm.begins_with("prop_"):
			_make_prop(mi)
		elif nm.begins_with("nocol"):
			continue
		else:
			mi.create_trimesh_collision()
			var pcb := GPUParticlesCollisionBox3D.new()
			pcb.size = mi.get_aabb().size
			mi.add_child(pcb)
			pcb.position = mi.get_aabb().get_center()

func _make_prop(mi: MeshInstance3D) -> void:
	var gt := mi.global_transform
	var sc := gt.basis.get_scale()
	var rb := RigidBody3D.new()
	rb.mass = 10.0
	region.add_child(rb)
	rb.global_transform = Transform3D(gt.basis.orthonormalized(), gt.origin)
	mi.reparent(rb)
	var shape := mi.mesh.create_convex_shape() as ConvexPolygonShape3D
	var pts := PackedVector3Array()
	for p in shape.points:
		pts.append(p * sc)
	shape.points = pts
	var cs := CollisionShape3D.new()
	cs.shape = shape
	rb.add_child(cs)

func _setup_environment() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = Sky.new()
	env.sky.sky_material = ProceduralSkyMaterial.new()
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.4, 0.42, 0.48)
	env.ambient_light_energy = 1.1
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
	ray.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS
	var weapon := Node3D.new()
	weapon.name = "Weapon"
	weapon.set_script(load("res://scripts/weapon.gd"))
	cam.add_child(ray)
	cam.add_child(weapon)
	head.add_child(cam)
	p.add_child(head)
	p.position = player_spawn
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
	e.collision_layer = Game.LAYER_BODY
	e.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_PLAYER
	e.add_child(cs)
	e.position = pos
	add_child(e)
