extends Node
## Pictures of the things you carry, for the bag (inventory_ui.gd): each thing's
## own 3D model, photographed once side-on in a little studio of its own (a
## separate world, soft light, clear background) at the size it takes in the
## bag, kept as a texture.

const Items = preload("res://scripts/game/items.gd")
const Models = preload("res://scripts/weapons/weapon_models.gd")
const Grenade = preload("res://scripts/weapons/grenade.gd")
const Bomb = preload("res://scripts/weapons/bomb.gd")
const Chainsaw = preload("res://scripts/weapons/chainsaw.gd")
const Machete = preload("res://scripts/weapons/machete.gd")
const Revolver = preload("res://scripts/weapons/revolver.gd")
const PX := 64                   # pixels per bag cell

static var textures := {}        # id -> Texture2D
var _queue: Array = []
var _busy := false


func _ready() -> void:
	for id in Items.DEFS:
		_queue.append(id)


func _process(_delta: float) -> void:
	if not _busy and not _queue.is_empty():
		_busy = true
		_shoot(_queue.pop_front())


static func get_icon(id: String) -> Texture2D:
	return textures.get(id)


func _shoot(id: String) -> void:
	var cells: Vector2i = Items.def(id)["size"]
	var vp := SubViewport.new()
	vp.size = Vector2i(cells.x * PX, cells.y * PX) * 2
	vp.own_world_3d = true
	vp.transparent_bg = true
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(vp)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_CLEAR_COLOR
	e.background_color = Color(0, 0, 0, 0)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.75, 0.77, 0.8)
	e.ambient_light_energy = 0.9
	e.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.environment = e
	vp.add_child(env)
	var key := DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-35, -60, 0)
	key.light_energy = 1.4
	vp.add_child(key)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-20, 120, 0)
	fill.light_energy = 0.5
	vp.add_child(fill)
	var model := _model(id)
	vp.add_child(model)
	# Frame it: side-on, the long way across the picture.
	var box := _bounds(model)
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	vp.add_child(cam)
	var c := box.get_center()
	cam.look_at_from_position(c + Vector3(-2.0, 0.0, 0.0), c, Vector3.UP)
	var aspect := float(cells.x) / cells.y
	cam.size = maxf(box.size.y, box.size.z / aspect) * 1.12
	cam.near = 0.01
	cam.far = 5.0
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var img := vp.get_texture().get_image()
	img.resize(cells.x * PX, cells.y * PX, Image.INTERPOLATE_LANCZOS)
	textures[id] = ImageTexture.create_from_image(img)
	vp.queue_free()
	_busy = false


func _bounds(n: Node) -> AABB:
	var box := AABB()
	var first := true
	for m in n.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null or not mi.visible:
			continue
		var b := mi.global_transform * mi.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box


func _model(id: String) -> Node3D:
	match id:
		"pistol":
			return Models.pistol()
		"shotgun":
			return Models.shotgun()
		"akm":
			return Models.akm()
		"revolver":
			return Revolver.new()
		"chainsaw":
			return Chainsaw.new()
		"machete":
			var m = Machete.new()
			m.freeze = true
			return m
		"grenade":
			return Grenade.model()
		"sawnoff":
			return Models.sawnoff()
		"crossbow":
			return Models.crossbow()
		"nailgun":
			return Models.nailgun()
		"flaregun":
			return Models.flaregun()
		"rifle":
			return Models.rifle()
		"molotov":
			return load("res://scripts/weapons/molotov.gd").model()
		"bomb":
			return Bomb.model(false)
		"cuffs":
			return load("res://scripts/player/player.gd").cuffs_model()
		"spraycan":
			return load("res://scripts/player/player.gd").spraycan_model()
		"pipe_bomb":
			return load("res://scripts/weapons/pipe_bomb.gd").model()
		"sponge":
			return load("res://scripts/player/player.gd").sponge_model()
		"mop":
			var m = load("res://scripts/player/mop.gd").new()
			m.rotation = Vector3(PI * 0.5, 0, 0)
			return m
		"package":
			return load("res://scripts/game/jobs.gd").package_model()
		"pipe", "powder", "clock", "wires", "tape", "boards", "screws", "scrap", "water":
			return _part_model(id)
		"syringe", "empty_syringe", "pills", "cloth", "alcohol", "ampoule", "chalk", "sugar", "dye", "herb",				"rolling_paper", "nails", "tin_can", "fuse_cord", "money":
			return extra_model(id)
	return _simple(id)


## Medicine, the notebook's ingredients and money: small things put together
## from a few shapes each.
static func extra_model(id: String) -> Node3D:
	var root := Node3D.new()
	var add := func(mesh: Mesh, color: Color, pos: Vector3, rot := Vector3.ZERO, metal := 0.0, rough := 0.7, alpha := 1.0) -> void:
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(color, alpha)
		m.metallic = metal
		m.roughness = rough
		if alpha < 1.0:
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mi.material_override = m
		mi.position = pos
		mi.rotation = rot
		root.add_child(mi)
	var cyl := func(r: float, h: float) -> CylinderMesh:
		var c := CylinderMesh.new()
		c.top_radius = r
		c.bottom_radius = r
		c.height = h
		c.radial_segments = 14
		return c
	var box := func(size: Vector3) -> BoxMesh:
		var b := BoxMesh.new()
		b.size = size
		return b
	var side := Vector3(0, 0, PI * 0.5)
	match id:
		"syringe", "empty_syringe":
			var lng := Vector3(PI * 0.5, 0, 0)     # lying along Z, as the bag's pictures are taken
			add.call(cyl.call(0.007, 0.08), Color(0.9, 0.92, 0.95), Vector3.ZERO, lng, 0.0, 0.2, 0.55)
			if id == "syringe":
				add.call(cyl.call(0.0062, 0.05), Color(0.85, 0.75, 0.2), Vector3(0, 0, 0.012), lng, 0.0, 0.3)
			add.call(cyl.call(0.003, 0.05), Color(0.95, 0.95, 0.95), Vector3(0, 0, -0.055), lng)
			add.call(box.call(Vector3(0.02, 0.02, 0.003)), Color(0.95, 0.95, 0.95), Vector3(0, 0, -0.08))
			add.call(cyl.call(0.0008, 0.03), Color(0.8, 0.8, 0.82), Vector3(0, 0, 0.055), lng, 0.9, 0.2)
		"pills":
			add.call(box.call(Vector3(0.06, 0.004, 0.035)), Color(0.8, 0.82, 0.85), Vector3.ZERO, Vector3.ZERO, 0.8, 0.3)
			for i in 6:
				var dome := SphereMesh.new()
				dome.radius = 0.0055
				dome.height = 0.008
				add.call(dome, Color(0.95, 0.4, 0.75), Vector3(-0.02 + (i % 3) * 0.02, 0.003, -0.009 + (i / 3) * 0.018))
		"cloth":
			for k in 3:
				add.call(box.call(Vector3(0.06, 0.008, 0.05)), [Color(0.6, 0.55, 0.45), Color(0.35, 0.4, 0.5), Color(0.55, 0.3, 0.25)][k],
						Vector3(0.004 * k, k * 0.008, -0.003 * k), Vector3(0, 0.3 * k, 0.05 * k), 0.0, 0.95)
		"alcohol":
			add.call(cyl.call(0.028, 0.13), Color(0.75, 0.82, 0.8), Vector3.ZERO, Vector3.ZERO, 0.0, 0.1, 0.6)
			add.call(cyl.call(0.029, 0.05), Color(0.9, 0.9, 0.85), Vector3(0, -0.01, 0))
			add.call(cyl.call(0.01, 0.04), Color(0.75, 0.82, 0.8), Vector3(0, 0.085, 0), Vector3.ZERO, 0.0, 0.1, 0.6)
			add.call(cyl.call(0.011, 0.012), Color(0.15, 0.3, 0.7), Vector3(0, 0.108, 0))
		"ampoule":
			add.call(cyl.call(0.006, 0.03), Color(0.6, 0.4, 0.2), Vector3.ZERO, Vector3.ZERO, 0.0, 0.1, 0.7)
			add.call(cyl.call(0.0025, 0.012), Color(0.6, 0.4, 0.2), Vector3(0, 0.021, 0), Vector3.ZERO, 0.0, 0.1, 0.7)
			add.call(cyl.call(0.004, 0.006), Color(0.6, 0.4, 0.2), Vector3(0, 0.03, 0), Vector3.ZERO, 0.0, 0.1, 0.7)
		"chalk":
			for k in 3:
				add.call(cyl.call(0.006, 0.07), Color(0.95, 0.95, 0.92), Vector3(0, k * 0.012 - 0.012, 0), Vector3(PI * 0.5, 0, 0), 0.0, 1.0)
		"sugar":
			add.call(box.call(Vector3(0.05, 0.07, 0.03)), Color(0.95, 0.95, 0.97), Vector3.ZERO)
			add.call(box.call(Vector3(0.051, 0.025, 0.031)), Color(0.2, 0.35, 0.75), Vector3(0, 0.01, 0))
		"dye":
			add.call(cyl.call(0.013, 0.04), Color(0.1, 0.5, 0.9), Vector3.ZERO, Vector3.ZERO, 0.0, 0.2, 0.8)
			add.call(cyl.call(0.006, 0.012), Color(0.95, 0.95, 0.95), Vector3(0, 0.026, 0))
		"herb":
			for k in 7:
				var sp := SphereMesh.new()
				sp.radius = 0.012
				sp.height = 0.018
				add.call(sp, Color(0.35, 0.45, 0.18).darkened(0.1 * (k % 3)), Vector3(cos(k * 1.7) * 0.015, (k % 2) * 0.008, sin(k * 1.7) * 0.015), Vector3.ZERO, 0.0, 1.0)
		"rolling_paper":
			add.call(box.call(Vector3(0.05, 0.006, 0.028)), Color(0.85, 0.25, 0.15), Vector3.ZERO)
			add.call(box.call(Vector3(0.045, 0.007, 0.026)), Color(0.97, 0.96, 0.92), Vector3(0.004, 0.001, 0))
		"nails":
			add.call(box.call(Vector3(0.05, 0.035, 0.035)), Color(0.55, 0.42, 0.25), Vector3.ZERO)
			for k in 5:
				add.call(cyl.call(0.0015, 0.05), Color(0.7, 0.7, 0.72), Vector3(-0.015 + k * 0.007, 0.03, 0.0), Vector3(0, 0, 0.2 * (k - 2)), 0.9, 0.3)
		"tin_can":
			add.call(cyl.call(0.032, 0.08), Color(0.7, 0.7, 0.72), Vector3.ZERO, Vector3.ZERO, 0.9, 0.35)
			add.call(cyl.call(0.0325, 0.05), Color(0.8, 0.3, 0.1), Vector3.ZERO)
		"fuse_cord":
			var t := TorusMesh.new()
			t.inner_radius = 0.018
			t.outer_radius = 0.026
			t.rings = 20
			add.call(t, Color(0.25, 0.22, 0.15), Vector3.ZERO, side, 0.0, 0.9)
			add.call(cyl.call(0.004, 0.03), Color(0.25, 0.22, 0.15), Vector3(0, 0.025, 0.02), Vector3(0.6, 0, 0))
		"money":
			return money_model()
	return root


## Parts for making things, and odds and ends found about.
func _part_model(id: String) -> Node3D:
	var root := Node3D.new()
	var add := func(mesh: Mesh, color: Color, pos: Vector3, rot := Vector3.ZERO, metal := 0.0, rough := 0.7) -> void:
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		var m := StandardMaterial3D.new()
		m.albedo_color = color
		m.metallic = metal
		m.roughness = rough
		mi.material_override = m
		mi.position = pos
		mi.rotation = rot
		root.add_child(mi)
	match id:
		"pipe":
			var c := CylinderMesh.new()
			c.top_radius = 0.028
			c.bottom_radius = 0.028
			c.height = 0.3
			add.call(c, Color(0.4, 0.4, 0.42), Vector3.ZERO, Vector3(PI * 0.5, 0, 0), 0.8, 0.45)
			var h := CylinderMesh.new()
			h.top_radius = 0.02
			h.bottom_radius = 0.02
			h.height = 0.302
			add.call(h, Color(0.08, 0.08, 0.08), Vector3.ZERO, Vector3(PI * 0.5, 0, 0))
		"powder":
			var b := BoxMesh.new()
			b.size = Vector3(0.05, 0.14, 0.09)
			add.call(b, Color(0.55, 0.45, 0.28), Vector3.ZERO)
			var lb := BoxMesh.new()
			lb.size = Vector3(0.052, 0.04, 0.06)
			add.call(lb, Color(0.85, 0.82, 0.7), Vector3(0, 0.0, 0))
			var tie := CylinderMesh.new()
			tie.top_radius = 0.012
			tie.bottom_radius = 0.02
			tie.height = 0.03
			add.call(tie, Color(0.5, 0.4, 0.25), Vector3(0, 0.085, 0))
		"clock":
			var c := CylinderMesh.new()
			c.top_radius = 0.04
			c.bottom_radius = 0.04
			c.height = 0.03
			add.call(c, Color(0.7, 0.12, 0.1), Vector3.ZERO, Vector3(0, 0, PI * 0.5), 0.3, 0.4)
			var f := CylinderMesh.new()
			f.top_radius = 0.034
			f.bottom_radius = 0.034
			f.height = 0.002
			add.call(f, Color(0.93, 0.9, 0.82), Vector3(-0.016, 0, 0), Vector3(0, 0, PI * 0.5))
			for sz in [-1.0, 1.0]:
				var bell := SphereMesh.new()
				bell.radius = 0.016
				bell.height = 0.018
				add.call(bell, Color(0.7, 0.12, 0.1), Vector3(0, 0.042, 0.025 * sz), Vector3.ZERO, 0.4, 0.4)
			var hand := BoxMesh.new()
			hand.size = Vector3(0.002, 0.026, 0.003)
			add.call(hand, Color(0.05, 0.05, 0.05), Vector3(-0.018, 0.01, 0.0))
		"wires":
			for k in 2:
				var t := TorusMesh.new()
				t.inner_radius = 0.022 + k * 0.006
				t.outer_radius = 0.026 + k * 0.006
				add.call(t, Color(0.8, 0.08, 0.08) if k == 0 else Color(0.06, 0.06, 0.06), Vector3(0, 0, 0), Vector3(0, 0, PI * 0.5))
		"tape":
			var t := TorusMesh.new()
			t.inner_radius = 0.018
			t.outer_radius = 0.035
			t.rings = 24
			add.call(t, Color(0.04, 0.04, 0.05), Vector3.ZERO, Vector3(0, 0, PI * 0.5), 0.0, 0.3)
		"boards":
			for k in 3:
				var b := BoxMesh.new()
				b.size = Vector3(0.02, 0.02, 0.5)
				add.call(b, Color(0.5, 0.36, 0.22).darkened(0.1 * k), Vector3(0, -0.025 + k * 0.025, 0.01 * k))
		"screws":
			var box := BoxMesh.new()
			box.size = Vector3(0.03, 0.04, 0.06)
			add.call(box, Color(0.75, 0.62, 0.3), Vector3.ZERO)
			for k in 3:
				var sc := CylinderMesh.new()
				sc.top_radius = 0.004
				sc.bottom_radius = 0.001
				sc.height = 0.03
				add.call(sc, Color(0.7, 0.7, 0.72), Vector3(0, 0.03, -0.015 + k * 0.015), Vector3(0, 0, 0.3), 0.9, 0.3)
		"scrap":
			var p := BoxMesh.new()
			p.size = Vector3(0.006, 0.06, 0.14)
			add.call(p, Color(0.45, 0.32, 0.22), Vector3.ZERO, Vector3(0.3, 0, 0), 0.6, 0.6)
			var q := BoxMesh.new()
			q.size = Vector3(0.006, 0.05, 0.08)
			add.call(q, Color(0.4, 0.4, 0.42), Vector3(0, 0.01, 0.06), Vector3(-0.5, 0, 0), 0.8, 0.5)
		"water":
			var bottle := CylinderMesh.new()
			bottle.top_radius = 0.032
			bottle.bottom_radius = 0.034
			bottle.height = 0.2
			add.call(bottle, Color(0.55, 0.75, 0.9), Vector3.ZERO, Vector3.ZERO, 0.0, 0.15)
			var neck := CylinderMesh.new()
			neck.top_radius = 0.013
			neck.bottom_radius = 0.03
			neck.height = 0.04
			add.call(neck, Color(0.55, 0.75, 0.9), Vector3(0, 0.12, 0), Vector3.ZERO, 0.0, 0.15)
			var cap := CylinderMesh.new()
			cap.top_radius = 0.014
			cap.bottom_radius = 0.014
			cap.height = 0.02
			add.call(cap, Color(0.1, 0.3, 0.8), Vector3(0, 0.15, 0))
			var label := CylinderMesh.new()
			label.top_radius = 0.0345
			label.bottom_radius = 0.0345
			label.height = 0.06
			add.call(label, Color(0.9, 0.9, 0.95), Vector3(0, -0.01, 0))
	return root


## Small things without a model of their own.
func _simple(id: String) -> Node3D:
	var root := Node3D.new()
	var mi := MeshInstance3D.new()
	var mat := StandardMaterial3D.new()
	match id:
		"bandage":
			# A roll of gauze seen end on: the wound layers, the hole in the
			# middle, the loose end hanging off it.
			var cm := CylinderMesh.new()
			cm.top_radius = 0.032
			cm.bottom_radius = 0.032
			cm.height = 0.05
			mi.mesh = cm
			mi.rotation = Vector3(0, 0, PI * 0.5)
			mat.albedo_color = Color(0.94, 0.93, 0.88)
			mat.roughness = 0.95
			var hole := MeshInstance3D.new()
			var hm := CylinderMesh.new()
			hm.top_radius = 0.01
			hm.bottom_radius = 0.01
			hm.height = 0.052
			hole.mesh = hm
			hole.rotation = Vector3(0, 0, PI * 0.5)
			var dark := StandardMaterial3D.new()
			dark.albedo_color = Color(0.35, 0.33, 0.3)
			hole.material_override = dark
			root.add_child(hole)
			for i in 3:
				var ring := MeshInstance3D.new()
				var tm := TorusMesh.new()
				tm.inner_radius = 0.016 + i * 0.006
				tm.outer_radius = 0.0175 + i * 0.006
				ring.mesh = tm
				ring.rotation = Vector3(0, 0, PI * 0.5)
				ring.position = Vector3(-0.0255, 0, 0)
				var line := StandardMaterial3D.new()
				line.albedo_color = Color(0.78, 0.77, 0.72)
				ring.material_override = line
				root.add_child(ring)
			var tail := MeshInstance3D.new()
			var tb := BoxMesh.new()
			tb.size = Vector3(0.045, 0.05, 0.002)
			tail.mesh = tb
			tail.position = Vector3(0, -0.045, 0.031)
			tail.rotation = Vector3(0.2, 0, 0)
			tail.material_override = mat
			root.add_child(tail)
		"cigarettes":
			# The pack face on, the lid open and three filters showing.
			var bm := BoxMesh.new()
			bm.size = Vector3(0.022, 0.085, 0.055)
			mi.mesh = bm
			mat.albedo_color = Color(0.72, 0.08, 0.08)
			var white := StandardMaterial3D.new()
			white.albedo_color = Color(0.95, 0.95, 0.93)
			var band := MeshInstance3D.new()
			var bb := BoxMesh.new()
			bb.size = Vector3(0.0225, 0.028, 0.0555)
			band.mesh = bb
			band.material_override = white
			band.position = Vector3(0, 0.0, 0)
			root.add_child(band)
			var filt := StandardMaterial3D.new()
			filt.albedo_color = Color(0.85, 0.55, 0.25)
			for k in 3:
				var f := MeshInstance3D.new()
				var fm := CylinderMesh.new()
				fm.top_radius = 0.0045
				fm.bottom_radius = 0.0045
				fm.height = 0.02
				f.mesh = fm
				f.material_override = filt if k != 1 else white
				f.position = Vector3(0, 0.05, -0.012 + k * 0.012)
				root.add_child(f)
		"joint":
			# Twisted paper, fat at the lit end, a bit crooked.
			var cm := CylinderMesh.new()
			cm.top_radius = 0.0095
			cm.bottom_radius = 0.0045
			cm.height = 0.085
			mi.mesh = cm
			mi.rotation = Vector3(0.9, 0, 0)
			mat.albedo_color = Color(0.96, 0.94, 0.86)
			mat.roughness = 0.8
			var tip := MeshInstance3D.new()
			var tm := CylinderMesh.new()
			tm.top_radius = 0.0098
			tm.bottom_radius = 0.009
			tm.height = 0.006
			tip.mesh = tm
			var ash := StandardMaterial3D.new()
			ash.albedo_color = Color(0.25, 0.23, 0.2)
			tip.material_override = ash
			tip.rotation = Vector3(0.9, 0, 0)
			tip.position = Basis(Vector3.RIGHT, 0.9) * Vector3(0, 0.044, 0)
			root.add_child(tip)
		_:
			var bm := BoxMesh.new()
			bm.size = Vector3(0.05, 0.05, 0.05)
			mi.mesh = bm
			mat.albedo_color = Color(0.5, 0.5, 0.5)
	mi.material_override = mat
	root.add_child(mi)
	return root


static var _money_tex := {}


## A wad of roubles: a stack of thousand-rouble notes (the paper edges
## showing at the sides), a bank strap round the middle, one note on top
## pushed a little askew. Real size: a note is 157 x 69 mm.
static func money_model() -> Node3D:
	var root := Node3D.new()
	var note := _note_mat()
	var edge := StandardMaterial3D.new()
	edge.albedo_texture = _money_img("edge")
	edge.roughness = 0.9
	var strap := StandardMaterial3D.new()
	strap.albedo_texture = _money_img("strap")
	strap.roughness = 0.8
	var w := 0.157
	var d := 0.069
	var h := 0.012
	# The stack: its sides the paper edges, top and bottom a note each.
	var stack := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(w, h, d)
	stack.mesh = bm
	stack.material_override = edge
	stack.position = Vector3(0, h * 0.5, 0)
	root.add_child(stack)
	for top in [true, false]:
		var q := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(w, d)
		q.mesh = pm
		q.material_override = note
		q.position = Vector3(0, h + 0.0003 if top else -0.0003, 0)
		q.rotation = Vector3(0 if top else PI, 0, 0)
		root.add_child(q)
	# The bank strap.
	var sm := MeshInstance3D.new()
	var sb := BoxMesh.new()
	sb.size = Vector3(0.03, h + 0.002, d + 0.002)
	sm.mesh = sb
	sm.material_override = strap
	sm.position = Vector3(-0.02, h * 0.5, 0)
	root.add_child(sm)
	# One note on top, off square, its far end lifting.
	var loose := MeshInstance3D.new()
	var lp := PlaneMesh.new()
	lp.size = Vector2(w, d)
	loose.mesh = lp
	loose.material_override = note
	loose.position = Vector3(0.012, h + 0.0022, -0.004)
	loose.rotation = Vector3(0.0, 0.09, 0.02)
	root.add_child(loose)
	for c in root.get_children():
		(c as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	return root


static func _note_mat() -> StandardMaterial3D:
	if _money_tex.has("mat"):
		return _money_tex["mat"]
	var m := StandardMaterial3D.new()
	m.albedo_texture = _money_img("note")
	m.roughness = 0.85
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	_money_tex["mat"] = m
	return m


const _DIGITS := {"0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"]}


## The pictures: a thousand-rouble note (blue-green, fine wavy guilloche,
## the pale watermark field on the left, a darker engraving in the middle,
## "1000" in the corners), the strap, the striped paper edges.
static func _money_img(kind: String) -> ImageTexture:
	if _money_tex.has(kind):
		return _money_tex[kind]
	var img: Image
	match kind:
		"note":
			var W := 256
			var H := 112
			img = Image.create(W, H, false, Image.FORMAT_RGBA8)
			var n := FastNoiseLite.new()
			n.frequency = 0.05
			for y in H:
				for x in W:
					var u := float(x) / W
					var v := float(y) / H
					var c := Color(0.55, 0.68, 0.62).lerp(Color(0.42, 0.55, 0.62), u)
					# guilloche: fine interfering waves
					var g := sin(u * 90.0 + sin(v * 14.0) * 3.0) * sin(v * 70.0 + sin(u * 11.0) * 2.5)
					c = c.darkened(0.06 * (g * 0.5 + 0.5))
					# the watermark field, pale, on the left
					var wm := Vector2((u - 0.17) / 0.12, (v - 0.5) / 0.3).length()
					if wm < 1.0:
						c = c.lerp(Color(0.86, 0.88, 0.82), 0.7 * (1.0 - wm * wm))
					# the engraving in the middle: a building, darker
					if u > 0.38 and u < 0.72 and v > 0.2 and v < 0.85:
						var e := (n.get_noise_2d(x * 3.0, y * 3.0) * 0.5 + 0.5)
						var bars := 0.5 + 0.5 * sin(x * 1.8)
						c = c.darkened(0.25 * e + (0.12 * bars if v > 0.45 else 0.0))
					# the frame
					if x < 4 or y < 4 or x > W - 5 or y > H - 5:
						c = c.darkened(0.3)
					img.set_pixel(x, y, c)
			# "1000" in two corners.
			for corner in [Vector2i(W - 60, 10), Vector2i(12, H - 26)]:
				var cx: int = corner.x
				for ch in "1000":
					var glyph: Array = _DIGITS[ch]
					for gy in 5:
						for gx in 3:
							if String(glyph[gy])[gx] == "1":
								for py in 3:
									for px in 3:
										img.set_pixel(cx + gx * 3 + px, corner.y + gy * 3 + py, Color(0.15, 0.3, 0.32))
					cx += 12
		"strap":
			img = Image.create(64, 32, false, Image.FORMAT_RGBA8)
			for y in 32:
				for x in 64:
					var c := Color(0.93, 0.9, 0.78)
					if y % 8 == 3 and x > 6 and x < 58 and (x / 3) % 4 != 0:
						c = Color(0.35, 0.4, 0.62)
					img.set_pixel(x, y, c)
		"edge":
			img = Image.create(64, 64, false, Image.FORMAT_RGBA8)
			for y in 64:
				for x in 64:
					var c := Color(0.8, 0.82, 0.74) if y % 2 == 0 else Color(0.62, 0.68, 0.62)
					img.set_pixel(x, y, c)
	img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	_money_tex[kind] = t
	return t
