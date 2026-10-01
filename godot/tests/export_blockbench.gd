extends Node
## Dev tool: writes the game's procedural models out for editing in
## Blockbench - each as a .bbmodel (Blockbench's own project: meshes in the
## groups they are built in, textures inside, the smoking as an animation)
## and as an .obj with its .mtl and textures beside it.
## Usage (needs a renderer for the mesh data):
##   xvfb-run -a godot --rendering-driver opengl3 --path . res://tests/export_blockbench.tscn -- <out dir> [what,...]
## what: weapons, cigarette, map (all by default).

const WM = preload("res://scripts/weapons/weapon_models.gd")
const AM = preload("res://scripts/weapons/arms_models.gd")
const Revolver = preload("res://scripts/weapons/revolver.gd")
const Smoking = preload("res://scripts/player/smoking.gd")
const MapBuilder = preload("res://scripts/world/map_builder.gd")

const Mats = preload("res://scripts/world/materials.gd")

const TEX_MAX := 128          # textures are cut down to this (Blockbench paints them by hand)

var _out := ""
var _uuid_n := 0
var _mat_name := {}              # Material -> a readable name

const RU := {
	"polymer": "полимер", "polymer_black": "полимер", "steel": "сталь", "steel_worn": "сталь_потёртая",
	"steel_bright": "сталь_светлая", "blued": "воронёная_сталь", "bore": "канал_ствола", "brass": "латунь",
	"shell": "гильза", "wood": "дерево", "akm_wood": "дерево_АКМ", "walnut": "орех", "rubber": "резина",
	"bakelite": "бакелит", "sight": "мушка", "alu": "алюминий", "tool_yellow": "жёлтый", "orange": "оранжевый",
	"red": "красный", "string": "тетива", "akm_mag": "магазин_сталь",
}
const SHAPE := {
	"BoxMesh": "брус", "CylinderMesh": "цилиндр", "ArrayMesh": "форма", "SphereMesh": "сфера",
	"CapsuleMesh": "капсула", "QuadMesh": "плоскость", "PlaneMesh": "плоскость", "PrismMesh": "призма",
	"TorusMesh": "тор",
}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	_out = args[0] if args.size() > 0 else "user://blockbench"
	var what: PackedStringArray = args[1].split(",") if args.size() > 1 else PackedStringArray(["weapons", "cigarette", "map"])
	await get_tree().process_frame
	if "weapons" in what:
		await _weapons()
	if "cigarette" in what:
		await _cigarette()
	if "map" in what:
		await _map()
	print("done")
	get_tree().quit()


# --- What is written ------------------------------------------------------------

func _weapons() -> void:
	var guns := [
		["Пистолет_Glock17", "pistol", WM.pistol()],
		["Автомат_АКМ", "akm", WM.akm()],
		["Винтовка_снайперская", "rifle", AM.rifle()],
		["Двустволка_обрез", "double_barrel", AM.sawnoff()],
		["Дробовик_помповый", "shotgun", WM.shotgun()],
		["Револьвер_рулетка", "revolver", Revolver.new()],
	]
	for g in guns:
		var n: Node3D = g[2]
		add_child(n)
		if g[1] == "revolver":
			(n.get("_crane") as Node3D).name = "Crane_откидной_узел"
			(n.get("_cyl") as Node3D).name = "Cylinder_барабан"
			(n.get("_hammer") as Node3D).name = "Hammer_курок"
		await _settle()
		var dir: String = _out.path_join("02_Оружие").path_join(g[0])
		_write(n, dir, g[1], 100.0, {})
		n.queue_free()
		print("weapon: ", g[0])


## Smoking as a first-person animation (the eye at the origin, looking down
## -Z): the hands come up, the lighter lights it, a drag, the smoke out, held,
## another drag, then the flick.
func _cigarette() -> void:
	var fake := GDScript.new()
	fake.source_code = "extends Node3D\nvar current = null\nvar cam: Camera3D\nvar velocity := Vector3.ZERO\n"
	fake.reload()
	var p: Node3D = fake.new()
	add_child(p)
	var cam := Camera3D.new()
	p.add_child(cam)
	p.set("cam", cam)
	var s: Node3D = Smoking.new()
	s.name = "Smoking"
	cam.add_child(s)
	s.setup(p)
	s.set_process(false)
	await _settle()
	s.start("cigarette")
	var rh: Node3D = s.get("_rhand")
	var lh: Node3D = s.get("_lhand")
	rh.name = "Правая_рука"
	lh.name = "Левая_рука_зажигалка"
	(s.get("_cig") as Node3D).name = "Сигарета"
	(s.get("_paper") as Node3D).name = "бумага"
	(s.get("_ember") as Node3D).name = "огонёк"
	(s.get("_char") as Node3D).name = "пепел_у_огонька"
	(s.get("_flame") as Node3D).name = "пламя_зажигалки"
	var names := ["кожа", "", "", "", "", "", "рукав"]
	var kids := rh.get_children()
	for i in names.size():
		if names[i] != "":
			_mat_name[(kids[i] as MeshInstance3D).material_override] = names[i]
	var lk := lh.get_children()
	_mat_name[(lk[0] as MeshInstance3D).material_override] = "зажигалка"
	_mat_name[(lk[1] as MeshInstance3D).material_override] = "металл"
	_mat_name[(lk[lk.size() - 3] as MeshInstance3D).material_override] = "рукав_левый"
	_mat_name[(s.get("_flame") as MeshInstance3D).material_override] = "пламя"
	var cig: Node3D = s.get("_cig")
	for c in cig.get_children():
		if c is MeshInstance3D:
			var mn := String(c.name)
			_mat_name[(c as MeshInstance3D).material_override] = "фильтр" if mn.begins_with("@") or mn.begins_with("MeshInstance") else mn
	var fps := 30.0
	var dt := 1.0 / fps
	var frames: Array = []          # [{node: [Transform3D, visible]}]
	var nodes: Array[Node3D] = []
	var rest := -1
	var t := 0.0
	var phase := 0
	var idle_t := 0.0
	while t < 20.0:
		s._process(dt)
		t += dt
		var st: int = s.state
		if st == Smoking.S.IDLE:
			idle_t += dt
			if phase == 0 and idle_t > 1.5:
				phase = 1
				rest = frames.size()
				s.drag_now()
			elif phase == 2 and idle_t > 1.2:
				phase = 3
				s.throw_now()
		else:
			if phase == 1 and st == Smoking.S.DRAG:
				phase = 2
			idle_t = 0.0
		# (the butt flies off as a physics object: kept in the hand here)
		nodes = _anim_nodes(s)
		var f := {}
		for n in nodes:
			var vis := n.visible
			if n == s.get("_cig"):
				vis = true
			f[n] = [n.transform, vis]
		if OS.has_environment("BB_PROBE") and frames.size() % 15 == 0:
			var e: Node3D = s.get("_ember")
			var ep := (s.global_transform.affine_inverse() * e.global_transform).origin * 100.0 + Vector3(0, 50, 35)
			print("probe t=%.2f ember=(%.2f, %.2f, %.2f)" % [frames.size() / fps, ep.x, ep.y, ep.z])
		frames.append(f)
		if st == Smoking.S.OFF and t > 1.0:
			break
	if rest < 0:
		rest = frames.size() / 2
	# The rest pose (geometry baked in it): the cigarette held, lit.
	var rest_f: Dictionary = frames[rest]
	for n in rest_f:
		(n as Node3D).transform = rest_f[n][0]
		(n as Node3D).visible = true
	var anim := {"name": "курение", "fps": fps, "frames": frames, "root": s}
	# (the eye, where the camera is, sits 50 cm above the floor of the scene
	# and 35 cm behind its centre: the hands come up in front of it)
	_shift = Vector3(0.0, 0.5, 0.35)
	_write(s, _out.path_join("03_Сигарета"), "cigarette_smoking", 100.0, anim)
	_shift = Vector3.ZERO
	print("cigarette: %d frames (%.1f s)" % [frames.size(), frames.size() / fps])
	p.queue_free()


func _anim_nodes(s: Node3D) -> Array[Node3D]:
	var out: Array[Node3D] = []
	for n in s.find_children("*", "Node3D", true, false):
		if n is GPUParticles3D or n is Light3D or n is Camera3D:
			continue
		out.append(n as Node3D)
	return out


## The level, as built for play, in the parts it is built in (each loading
## step its own model): the static geometry, merged per step instead of once
## for all, keeps to its part.
func _map() -> void:
	var map: Node3D = MapBuilder.new()
	map.name = "Map"
	add_child(map)
	var parts: Array = []            # [name, [nodes]]
	var steps: Array = map.steps()
	for i in steps.size():
		var before := {}
		for n in map.find_children("*", "", true, false):
			before[n] = true
		(steps[i][1] as Callable).call()
		var geo = map.get("geo")
		if geo:
			geo.commit()
		await get_tree().process_frame
		var fresh: Array = []
		for n in map.find_children("*", "Node3D", true, false):
			if not before.has(n) and (before.has(n.get_parent()) or n.get_parent() == map):
				fresh.append(n)
		var tris := 0
		for n in fresh:
			tris += _count_tris(n)
		print("map step %s: %d nodes, %d tris" % [steps[i][0], fresh.size(), tris])
		if tris > 0:
			parts.append([steps[i][0], fresh])
	await _settle()
	# The ground is a 25 cm grid in the game (half a million triangles): a
	# 1 m one here, the same heights.
	for n in map.find_children("Ground*", "MeshInstance3D", true, false):
		var gm := n as MeshInstance3D
		var aabb := gm.mesh.get_aabb()
		var x0 := aabb.position.x
		var z0 := aabb.position.z
		var nx := int(round(aabb.size.x)) + 1
		var nz := int(round(aabb.size.z)) + 1
		var v := PackedVector3Array()
		var uv := PackedVector2Array()
		var idx := PackedInt32Array()
		for zi in nz:
			for xi in nx:
				var x := x0 + xi
				var z := z0 + zi
				v.append(Vector3(x, map.ground_height(x, z), z))
				uv.append(Vector2(x, z))
		for zi in nz - 1:
			for xi in nx - 1:
				var a := zi * nx + xi
				idx.append_array([a, a + 1, a + nx, a + 1, a + nx + 1, a + nx])
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = v
		arr[Mesh.ARRAY_TEX_UV] = uv
		arr[Mesh.ARRAY_INDEX] = idx
		var am := ArrayMesh.new()
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		gm.mesh = am
		print("ground %s: %d tris" % [gm.name, idx.size() / 3])
	if OS.has_environment("BB_STATS"):
		map.queue_free()
		return
	var dir := _out.path_join("01_Карта")
	var names := {
		"Кладём асфальт": "Земля_и_асфальт", "Строим заброшку": "Заброшка_главное_здание",
		"Улица и заборы": "Улица_и_заборы", "Мусор и обломки": "Мусор_и_обломки",
		"Склад, гаражи, машины": "Склад_гаражи_машины", "Трёхэтажки": "Трёхэтажки_бар_рулетка",
		"Южный квартал": "Южный_квартал", "Расставляем мебель": "Мебель",
		"Бочки, бутылки, лужи": "Бочки_бутылки_лужи", "Граффити и грязь": "Граффити_и_грязь",
		"Двери и мелочи": "Двери_фонари_мелочи",
	}
	for i in parts.size():
		var step: String = parts[i][0]
		var nm: String = "%02d_%s" % [i + 1, names.get(step, step.replace(" ", "_").replace(",", ""))]
		_write_many(parts[i][1], dir.path_join(nm), nm, 16.0, map)
	map.queue_free()


func _count_tris(n: Node) -> int:
	var c := 0
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		var m := (n as MeshInstance3D).mesh
		for i in m.get_surface_count():
			var a := m.surface_get_arrays(i)
			var idx = a[Mesh.ARRAY_INDEX]
			c += (idx.size() if idx != null else (a[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
	for ch in n.get_children():
		c += _count_tris(ch)
	return c


func _settle() -> void:
	for i in 20:
		await get_tree().process_frame


# --- The model: parts, textures --------------------------------------------------

class Part:
	var name: String
	var node: MeshInstance3D
	var xf: Transform3D          # mesh to model space (rest)
	var group: Dictionary        # the group it is in (or {} at the top)


var _textures: Array = []        # [{name, img, mat}]
var _tex_of := {}                # Material -> index
var _proj := {}                  # Material -> projected (triplanar) uv scale, or absent


func _tex_index(m: Material) -> int:
	if m == null:
		m = _grey
	if _tex_of.has(m):
		return _tex_of[m]
	var col := Color(0.6, 0.6, 0.6)
	var tex: Texture2D = null
	var scale := Vector3.ONE
	var tri := false
	var nm := ""
	if m is BaseMaterial3D:
		var b := m as BaseMaterial3D
		col = b.albedo_color
		tex = b.albedo_texture
		scale = b.uv1_scale
		tri = b.uv1_triplanar
		nm = m.resource_name
	elif m is ShaderMaterial:
		var sm := m as ShaderMaterial
		for k in ["base_color", "albedo", "albedo_color", "color"]:
			var v = sm.get_shader_parameter(k)
			if v is Color:
				col = v
				break
		for k in ["tex_detail", "albedo_texture", "texture_albedo", "tex"]:
			var v = sm.get_shader_parameter(k)
			if v is Texture2D:
				tex = v
				break
		var ts = sm.get_shader_parameter("tex_scale")
		scale = Vector3.ONE * (float(ts) if ts != null else 1.0)
		tri = true
		nm = sm.shader.resource_path.get_file().get_basename() if sm.shader else "shader"
	var img: Image = null
	if tex:
		img = tex.get_image()
	if img:
		img = img.duplicate() as Image
		if img.is_compressed():
			img.decompress()
		img.convert(Image.FORMAT_RGBA8)
		if img.get_width() > TEX_MAX or img.get_height() > TEX_MAX:
			var k := float(TEX_MAX) / maxf(img.get_width(), img.get_height())
			img.resize(maxi(int(img.get_width() * k), 1), maxi(int(img.get_height() * k), 1), Image.INTERPOLATE_LANCZOS)
		for y in img.get_height():
			for x in img.get_width():
				var c := img.get_pixel(x, y)
				img.set_pixel(x, y, Color(c.r * col.r, c.g * col.g, c.b * col.b, c.a * col.a))
	else:
		img = Image.create(16, 16, false, Image.FORMAT_RGBA8)
		img.fill(Color(col.r, col.g, col.b, col.a))
		tri = true
		scale = Vector3.ONE
	if tri:
		_proj[m] = scale
	if _mat_name.has(m):
		nm = _mat_name[m]
	elif _mat_name.is_empty() or nm == "":
		nm = "цвет"
	var i := _textures.size()
	var hexc := col.to_html(false)
	_textures.append({"name": "%02d_%s_%s" % [i, nm.validate_filename().replace(" ", "_"), hexc], "img": img})
	_tex_of[m] = i
	return i


var _grey := StandardMaterial3D.new()
var _shift := Vector3.ZERO       # moves the whole model (metres)


## The shared materials by the keys they are made under (filled as the
## models are built).
func _refresh_names() -> void:
	for d in [WM._mats, AM._mats, Mats._cache]:
		var dd: Dictionary = d
		for k in dd:
			if not _mat_name.has(dd[k]):
				_mat_name[dd[k]] = RU.get(k, String(k))


func _reset() -> void:
	_refresh_names()
	_textures.clear()
	_tex_of.clear()
	_proj.clear()


## One element's faces: vertex positions (model units), per-face uv (px),
## texture. Quads where two triangles make one flat, convex quad.
func _mesh_faces(mi: MeshInstance3D, xf: Transform3D, unit: float) -> Dictionary:
	var verts: Array[Vector3] = []          # model units
	var vkey := {}                           # quantized pos -> index
	var faces: Array = []                    # [[idx...], [uv px...], tex]
	var mesh := mi.mesh
	for si in mesh.get_surface_count():
		if mesh is ArrayMesh and (mesh as ArrayMesh).surface_get_primitive_type(si) != Mesh.PRIMITIVE_TRIANGLES:
			continue
		var a := mesh.surface_get_arrays(si)
		var pos: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
		var uvs = a[Mesh.ARRAY_TEX_UV]
		var nrm = a[Mesh.ARRAY_NORMAL]
		var idx = a[Mesh.ARRAY_INDEX]
		if idx == null:
			idx = PackedInt32Array(range(pos.size()))
		var mat := mi.get_active_material(si)
		var ti := _tex_index(mat)
		var img: Image = _textures[ti]["img"]
		var tw := float(img.get_width())
		var th := float(img.get_height())
		var proj = _proj.get(mat if mat else _grey)
		# Godot's front faces wind clockwise; Blockbench's and OBJ's the other way.
		var tris: Array = []
		for k in range(0, (idx as PackedInt32Array).size(), 3):
			var ids := [idx[k], idx[k + 2], idx[k + 1]]
			var p0 := pos[ids[0]]
			var fn := (pos[ids[1]] - p0).cross(pos[ids[2]] - p0)
			if fn.length_squared() < 1e-14:
				continue
			fn = fn.normalized()
			var face_v: Array = []
			var face_uv: Array = []
			for j in ids:
				var wp := xf * pos[j] * unit
				var q := "%d,%d,%d" % [roundi(wp.x * 1000.0), roundi(wp.y * 1000.0), roundi(wp.z * 1000.0)]
				if not vkey.has(q):
					vkey[q] = verts.size()
					verts.append(wp)
				face_v.append(vkey[q])
				var uv := Vector2.ZERO
				if proj != null:
					# Triplanar look: the face's own plane, as Godot projects it.
					var sc: Vector3 = proj
					var lp := pos[j] * sc
					var an := fn.abs()
					if an.x >= an.y and an.x >= an.z:
						uv = Vector2(lp.z, -lp.y)
					elif an.y >= an.z:
						uv = Vector2(lp.x, lp.z)
					else:
						uv = Vector2(lp.x, -lp.y)
				elif uvs != null and (uvs as PackedVector2Array).size() > j:
					uv = (uvs as PackedVector2Array)[j]
				face_uv.append(Vector2(uv.x * tw, uv.y * th))
			tris.append([face_v, face_uv, ti, fn])
		# Pairs of triangles into quads.
		var k2 := 0
		while k2 < tris.size():
			var t1: Array = tris[k2]
			if k2 + 1 < tris.size():
				var q := _quad(t1, tris[k2 + 1], verts)
				if not q.is_empty():
					faces.append(q)
					k2 += 2
					continue
			faces.append([t1[0], t1[1], t1[2]])
			k2 += 1
	return {"verts": verts, "faces": faces}


func _quad(t1: Array, t2: Array, verts: Array[Vector3]) -> Array:
	if t1[2] != t2[2] or (t1[3] as Vector3).dot(t2[3]) < 0.9995:
		return []
	var a: Array = t1[0]
	var b: Array = t2[0]
	var shared := []
	for v in a:
		if v in b:
			shared.append(v)
	if shared.size() != 2:
		return []
	# The uv must agree where they meet.
	for v in shared:
		if ((t1[1] as Array)[a.find(v)] as Vector2).distance_to((t2[1] as Array)[b.find(v)]) > 0.01:
			return []
	var d := -1
	var duv := Vector2.ZERO
	for i in 3:
		if not (b[i] in shared):
			d = b[i]
			duv = (t2[1] as Array)[i]
	# Insert d between the shared edge, in t1's order.
	var ring: Array = []
	var ring_uv: Array = []
	for i in 3:
		var v: int = a[i]
		var nxt: int = a[(i + 1) % 3]
		ring.append(v)
		ring_uv.append((t1[1] as Array)[i])
		if v in shared and nxt in shared:
			ring.append(d)
			ring_uv.append(duv)
	# Convex: every corner turns the same way.
	var n: Vector3 = t1[3]
	for i in 4:
		var p0: Vector3 = verts[ring[i]]
		var p1: Vector3 = verts[ring[(i + 1) % 4]]
		var p2: Vector3 = verts[ring[(i + 2) % 4]]
		if (p1 - p0).cross(p2 - p1).dot(n) <= 0.0:
			return []
	return [ring, ring_uv, t1[2]]


# --- Writing ----------------------------------------------------------------------

func _uuid() -> String:
	var h := ""
	for i in 4:
		h += "%08x" % (randi() & 0xffffffff)
	return "%s-%s-4%s-8%s-%s" % [h.substr(0, 8), h.substr(8, 4), h.substr(13, 3), h.substr(17, 3), h.substr(20, 12)]


static func _r(v: float) -> float:
	return snappedf(v, 0.0001)


## A model from one node (its groups as built).
func _write(root: Node3D, dir: String, file: String, unit: float, anim: Dictionary) -> void:
	_write_many([root], dir, file, unit, root, anim)


## A model from some nodes, positions taken against `space`.
func _write_many(roots: Array, dir: String, file: String, unit: float, space: Node3D, anim := {}) -> void:
	_reset()
	DirAccess.make_dir_recursive_absolute(dir)
	DirAccess.make_dir_recursive_absolute(dir.path_join("textures"))
	var inv := Transform3D(Basis(), _shift) * space.global_transform.affine_inverse()
	var elements: Array = []
	var outliner: Array = []
	var group_of := {}            # Node3D -> group dict (animated bones)
	var obj := {"v": PackedStringArray(), "vt": PackedStringArray(), "f": PackedStringArray(), "nv": 0, "nvt": 0}
	var animated := {}
	if not anim.is_empty():
		var frames: Array = anim["frames"]
		var f0: Dictionary = frames[0]
		for n in f0:
			for f in frames:
				var fr: Dictionary = f
				if fr.has(n) and (not (fr[n][0] as Transform3D).is_equal_approx(f0[n][0]) or fr[n][1] != f0[n][1]):
					animated[n] = true
					break
	for r in roots:
		var rn := r as Node3D
		if rn == space:
			_walk(rn, inv, unit, outliner, elements, group_of, animated, obj, true)
		else:
			var holder: Array = []
			_walk_node(rn, inv, unit, holder, elements, group_of, animated, obj, true)
			outliner.append_array(holder)
	# Textures.
	var texs: Array = []
	var mtl := PackedStringArray()
	for i in _textures.size():
		var t: Dictionary = _textures[i]
		var img: Image = t["img"]
		var png := img.save_png_to_buffer()
		img.save_png(dir.path_join("textures").path_join(t["name"] + ".png"))
		texs.append({
			"path": "", "name": t["name"] + ".png", "folder": "", "namespace": "", "id": str(i),
			"width": img.get_width(), "height": img.get_height(),
			"uv_width": img.get_width(), "uv_height": img.get_height(),
			"particle": false, "use_as_default": false, "layers_enabled": false,
			"render_mode": "default", "render_sides": "auto", "wrap_mode": "repeat",
			"pbr_channel": "color", "frame_time": 1, "frame_order_type": "loop", "frame_order": "",
			"frame_interpolate": false, "visible": true, "internal": true, "saved": false,
			"uuid": _uuid(), "source": "data:image/png;base64," + Marshalls.raw_to_base64(png),
		})
		mtl.append("newmtl %s\nKd 1 1 1\nmap_Kd textures/%s.png\n" % [t["name"], t["name"]])
	var model := {
		"meta": {"format_version": "5.0", "model_format": "free", "box_uv": false},
		"name": file,
		"model_identifier": "",
		"visible_box": [1, 1, 0],
		"variable_placeholders": "",
		"variable_placeholder_buttons": [],
		"timeline_setups": [],
		"unhandled_root_fields": {},
		"resolution": {"width": 16, "height": 16},
		"elements": elements,
		"outliner": outliner,
		"textures": texs,
	}
	if not anim.is_empty():
		model["animations"] = [_animation(anim, group_of, inv, unit)]
	var f := FileAccess.open(dir.path_join(file + ".bbmodel"), FileAccess.WRITE)
	f.store_string(JSON.stringify(model))
	f.close()
	# OBJ (metres) and its materials.
	var o := FileAccess.open(dir.path_join(file + ".obj"), FileAccess.WRITE)
	o.store_string("# %s - из игры Blood (метры)\nmtllib %s.mtl\n" % [file, file])
	o.store_string("\n".join(obj["v"]) + "\n")
	o.store_string("\n".join(obj["vt"]) + "\n")
	o.store_string("\n".join(obj["f"]) + "\n")
	o.close()
	var m := FileAccess.open(dir.path_join(file + ".mtl"), FileAccess.WRITE)
	m.store_string("\n".join(mtl))
	m.close()
	print("  wrote %s: %d elements, %d textures" % [dir.path_join(file), elements.size(), _textures.size()])


func _keep(n: Node) -> bool:
	if not (n is Node3D):
		return false
	if n is GPUParticles3D or n is CPUParticles3D or n is Light3D or n is Camera3D or n is Decal \
			or n is CollisionShape3D or n is NavigationRegion3D or n is AudioStreamPlayer3D or n is RayCast3D:
		return false
	return true


func _walk(n: Node3D, inv: Transform3D, unit: float, into: Array, elements: Array, group_of: Dictionary,
		animated: Dictionary, obj: Dictionary, _top: bool) -> void:
	for c in n.get_children():
		if _keep(c):
			_walk_node(c as Node3D, inv, unit, into, elements, group_of, animated, obj, false)


## A node: a group if it holds anything or moves on its own, else the mesh
## goes straight into its parent's group.
func _walk_node(c: Node3D, inv: Transform3D, unit: float, into: Array, elements: Array, group_of: Dictionary,
		animated: Dictionary, obj: Dictionary, top: bool) -> void:
	if not c.visible and not animated.has(c) and not top:
		return
	var mi := c as MeshInstance3D
	var has_kids := false
	for k in c.get_children():
		if _keep(k):
			has_kids = true
			break
	var xf := inv * c.global_transform
	var name := String(c.name)
	if name.begins_with("@") or name.begins_with("MeshInstance3D") or name.begins_with("Node3D"):
		name = _auto_name(c)
	if has_kids or animated.has(c) or (top and mi == null):
		var g := {
			"name": name, "origin": _v(xf.origin * unit), "rotation": [0, 0, 0], "color": 0,
			"uuid": _uuid(), "export": true, "mirror_uv": false, "isOpen": false, "locked": false,
			"visibility": true, "autouv": 0, "children": [],
		}
		group_of[c] = g
		if mi and mi.mesh:
			_element(mi, xf, unit, g["children"], elements, obj, name)
		for k in c.get_children():
			if _keep(k):
				_walk_node(k as Node3D, inv, unit, g["children"], elements, group_of, animated, obj, false)
		if (g["children"] as Array).size() > 0 or animated.has(c):
			into.append(g)
	elif c is MultiMeshInstance3D:
		var mm := (c as MultiMeshInstance3D).multimesh
		if mm and mm.mesh:
			var cnt := mm.visible_instance_count if mm.visible_instance_count >= 0 else mm.instance_count
			for i in cnt:
				var tmp := MeshInstance3D.new()
				tmp.mesh = mm.mesh
				tmp.material_override = (c as MultiMeshInstance3D).material_override
				_element(tmp, xf * mm.get_instance_transform(i), unit, into, elements, obj, "%s_%d" % [name, i])
				tmp.free()
	elif mi and mi.mesh:
		_element(mi, xf, unit, into, elements, obj, name)


## A name for an unnamed part: what it is made of and its shape.
func _auto_name(c: Node3D) -> String:
	var mi := c as MeshInstance3D
	if mi == null or mi.mesh == null:
		return "узел"
	var m := mi.get_active_material(0)
	var mn := ""
	if m and _mat_name.has(m):
		mn = _mat_name[m]
	elif m:
		_tex_index(m)
		mn = String(_textures[_tex_of[m]]["name"]).substr(3)
	return "%s (%s)" % [mn, SHAPE.get(mi.mesh.get_class(), mi.mesh.get_class())]


func _v(p: Vector3) -> Array:
	return [_r(p.x), _r(p.y), _r(p.z)]


func _element(mi: MeshInstance3D, xf: Transform3D, unit: float, into: Array, elements: Array, obj: Dictionary, name: String) -> void:
	var data := _mesh_faces(mi, xf, unit)
	var verts: Array[Vector3] = data["verts"]
	var faces: Array = data["faces"]
	if faces.is_empty():
		return
	var origin := xf.origin * unit
	var vs := {}
	var keys: Array[String] = []
	for i in verts.size():
		var key := "v" + String.num_int64(i, 36)
		keys.append(key)
		vs[key] = _v(verts[i] - origin)
	var fs := {}
	var fi := 0
	# OBJ: positions in metres, faces by material.
	var base_v: int = obj["nv"]
	for p in verts:
		(obj["v"] as PackedStringArray).append("v %.5f %.5f %.5f" % [p.x / unit, p.y / unit, p.z / unit])
	obj["nv"] = base_v + verts.size()
	(obj["f"] as PackedStringArray).append("o %s_%d\ng %s" % [name.validate_node_name().replace(" ", "_"), elements.size(), name.validate_node_name().replace(" ", "_")])
	var cur_t := -1
	for face in faces:
		var ids: Array = face[0]
		var uvs: Array = face[1]
		var ti: int = face[2]
		var uvd := {}
		var fv: Array = []
		for j in ids.size():
			var k: String = keys[ids[j]]
			fv.append(k)
			uvd[k] = [_r((uvs[j] as Vector2).x), _r((uvs[j] as Vector2).y)]
		fs["f" + String.num_int64(fi, 36)] = {"uv": uvd, "vertices": fv, "texture": ti}
		fi += 1
		if ti != cur_t:
			cur_t = ti
			(obj["f"] as PackedStringArray).append("usemtl " + _textures[ti]["name"])
		var img: Image = _textures[ti]["img"]
		var line := "f"
		for j in ids.size():
			var uv: Vector2 = uvs[j]
			(obj["vt"] as PackedStringArray).append("vt %.5f %.5f" % [uv.x / img.get_width(), 1.0 - uv.y / img.get_height()])
			obj["nvt"] = int(obj["nvt"]) + 1
			line += " %d/%d" % [base_v + int(ids[j]) + 1, obj["nvt"]]
		(obj["f"] as PackedStringArray).append(line)
	var uuid := _uuid()
	elements.append({
		"name": name, "color": elements.size() % 8, "origin": _v(origin), "rotation": [0, 0, 0],
		"export": true, "visibility": true, "locked": false, "render_order": "default",
		"allow_mirror_modeling": true, "vertices": vs, "faces": fs, "type": "mesh", "uuid": uuid,
	})
	into.append(uuid)


## The animation: per moving group, rotation/position (about its pivot,
## against the rest pose) and scale 0 when hidden; keys kept only where the
## motion bends.
func _animation(anim: Dictionary, group_of: Dictionary, inv: Transform3D, unit: float) -> Dictionary:
	var frames: Array = anim["frames"]
	var fps: float = anim["fps"]
	var root: Node3D = anim["root"]
	var rest: Dictionary = {}
	for n in group_of:
		rest[n] = _model_xf(n, root, null, inv)
	var animators := {}
	for n in group_of:
		var g: Dictionary = group_of[n]
		var node := n as Node3D
		var parent := node.get_parent() as Node3D
		var p_rest: Transform3D = _model_xf(parent, root, null, inv) if parent != root.get_parent() else Transform3D.IDENTITY
		var w0: Transform3D = rest[n]
		var o := w0.origin
		var rot_k: Array = []
		var pos_k: Array = []
		var sc_k: Array = []
		for fi in frames.size():
			var fr: Dictionary = frames[fi]
			if not fr.has(n):
				continue
			var local: Transform3D = fr[n][0]
			var vis: bool = fr[n][1]
			# The bone's motion against the rest, in its parent's rest frame.
			var d := p_rest * local * w0.affine_inverse()
			var b := d.basis.orthonormalized()
			var pos := d.origin + b * o - o
			# Blockbench turns bones Z, then Y, then X (three.js 'ZYX').
			var ax := atan2(b.y.z, b.z.z)
			var ay := asin(clampf(-b.x.z, -1.0, 1.0))
			var az := atan2(b.x.y, b.x.x)
			var t := fi / fps
			rot_k.append([t, Vector3(rad_to_deg(ax), rad_to_deg(ay), rad_to_deg(az))])
			pos_k.append([t, pos * unit])
			sc_k.append([t, Vector3.ONE * (1.0 if vis else 0.0)])
		var kfs: Array = []
		for ch in [["rotation", rot_k, 0.05], ["position", pos_k, 0.005], ["scale", sc_k, 0.001]]:
			var keys: Array = _reduce(ch[1], ch[2], ch[0] == "scale")
			if keys.size() == 1 and ((keys[0][1] as Vector3).is_equal_approx(Vector3.ONE if ch[0] == "scale" else Vector3.ZERO)):
				continue
			for k in keys:
				var v: Vector3 = k[1]
				kfs.append({
					"channel": ch[0], "data_points": [{"x": _r(v.x), "y": _r(v.y), "z": _r(v.z)}],
					"uuid": _uuid(), "time": _r(k[0]), "color": -1,
					"interpolation": "step" if ch[0] == "scale" else "linear",
				})
		if kfs.is_empty():
			continue
		animators[g["uuid"]] = {"name": g["name"], "type": "bone", "keyframes": kfs}
	return {
		"uuid": _uuid(), "name": anim["name"], "loop": "once", "override": false,
		"length": _r(frames.size() / fps), "snapping": int(fps), "selected": true,
		"anim_time_update": "", "blend_weight": "", "start_delay": "", "loop_delay": "",
		"animators": animators,
	}


## A node's rest transform in model space (from its scene parents).
func _model_xf(n: Node3D, _root: Node3D, _f, inv: Transform3D) -> Transform3D:
	return inv * n.global_transform


## Keys where linear interpolation from the kept ones misses by more than tol.
func _reduce(keys: Array, tol: float, step: bool) -> Array:
	if keys.size() <= 2:
		return keys
	var out: Array = [keys[0]]
	if step:
		for i in range(1, keys.size()):
			if not (keys[i][1] as Vector3).is_equal_approx(out.back()[1]):
				out.append(keys[i])
		return out
	var last := 0
	var i := 2
	while i < keys.size():
		# Can last -> i stand for everything between?
		var ok := true
		var t0: float = keys[last][0]
		var t1: float = keys[i][0]
		var v0: Vector3 = keys[last][1]
		var v1: Vector3 = keys[i][1]
		for j in range(last + 1, i):
			var k := (float(keys[j][0]) - t0) / (t1 - t0)
			if v0.lerp(v1, k).distance_to(keys[j][1]) > tol:
				ok = false
				break
		if not ok:
			last = i - 1
			out.append(keys[last])
		i += 1
	out.append(keys.back())
	return out
