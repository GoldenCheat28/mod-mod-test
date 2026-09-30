extends Node3D
## Making things for real, with your hands, on whatever is in front of you
## (a table, or the floor): the view comes down over it, the parts are laid
## out on a rag as real objects, and each step is done to them - a bag of
## powder picked up and tipped over the open end of a pipe until it is full,
## the cap screwed on round and round, the alarm clock's hand set, its wires
## pulled over one by one to the contacts, tape wound on turn by turn; a rag
## cut into strips with scissors along the chalk lines, soaked, rolled up; an
## ampoule's neck snapped, the plunger drawn back, the bubbles tapped out;
## chalk and sugar ground in a mortar, coloured, pressed into pills that pop
## out onto the rag; herb ground, sprinkled on the paper, rolled, licked shut.
## Everything lies and falls and knocks about as things do.
##
## Mouse: LMB takes a thing and moves it over the surface (let go: it drops);
## RMB held while carrying tips it (to pour); LMB held and circled round a
## thing turns / winds it; Space goes on where there is a choice; Esc puts it
## all back in the bag (nothing is used up).

const Icons = preload("res://scripts/ui/item_icons.gd")
const Sfx = preload("res://scripts/audio/sfx.gd")

signal done(recipe: Dictionary, extra: Dictionary)
signal cancelled

var player
var recipe: Dictionary
var rid := ""
var step := 0
var prog := 0.0                    # the step's progress, 0..1
var fuse := 30.0                   # (the bomb's clock)

var S := Vector3.ZERO              # the middle of the work surface
var X := Vector3.RIGHT             # across it (to the right as one looks)
var Z := Vector3.BACK              # towards oneself
var _eye := Transform3D()
var _cam_k := 0.0
var _closing := false
var _close_t := 0.0

var _obj := {}                     # name -> Node3D (bodies and bits of the scene)
var _drag: RigidBody3D = null
var _drag_lift := 0.07
var _tilt := 0.0
var _mouse := Vector2.ZERO
var _lmb := false
var _rmb := false
var _turn_prev := INF
var _turns := 0.0
var _clicks := 0
var _saw_dir := 0.0
var _saw_run := 0.0
var _saw_last := Vector2.INF
var _strokes := 0
var _pour: CPUParticles3D
var _pour_t := 0.0
var _wires: Array = []             # [{start: Node3D, end: RigidBody3D, contact: Vector3, col, segs: [], done}]
var _cut_bins: Array = []          # per line: PackedByteArray of bins covered
var _msg := ""
var _msg_t := 0.0
var _finished_t := -1.0
var _hud: CanvasLayer
var mouse_override := Vector2.INF  # (tests drive the pointer)
var _label: Label
var _sub: Label
var _bar: ColorRect
var _bar_bg: ColorRect


# --- Starting and stopping ------------------------------------------------------------

## Sets up over the surface in front of `p` for recipe `r` (craft_ui.gd's).
## False if there is nowhere to work.
func begin(p, r: Dictionary) -> bool:
	player = p
	recipe = r
	rid = r["id"]
	var cam: Camera3D = p.cam
	var f := -cam.global_basis.z
	f.y = 0.0
	f = f.normalized() if f.length() > 0.1 else Vector3.FORWARD
	var space: PhysicsDirectSpaceState3D = p.get_world_3d().direct_space_state
	var found := false
	for dist in [0.65, 0.5, 0.8]:
		var from: Vector3 = p.global_position + f * dist + Vector3.UP * 1.25
		var q := PhysicsRayQueryParameters3D.create(from, from + Vector3.DOWN * 2.0, Game.LAYER_WORLD | Game.LAYER_PROPS)
		q.exclude = [p.get_rid()]
		var hit: Dictionary = space.intersect_ray(q)
		if not hit.is_empty() and (hit.normal as Vector3).y > 0.85 and (hit.position as Vector3).y < p.global_position.y + 1.2:
			S = hit.position
			found = true
			break
	if not found:
		return false
	Z = -f
	X = Vector3.UP.cross(Z).normalized()
	# The eye: a little back from it and well above, looking down at it.
	var eye_pos := S + Z * 0.3 + Vector3.UP * 0.4
	_eye = Transform3D(Basis(), eye_pos).looking_at(S - Z * 0.02, Vector3.UP)
	_build_hud()
	_build_pour()
	_mat()
	call("_setup_" + rid)
	_start_step()
	return true


func _local(v: Vector3) -> Vector3:
	return S + X * v.x + Vector3.UP * v.y + Z * v.z


## Puts it all away (Esc): nothing used up.
func cancel() -> void:
	if _closing:
		return
	_closing = true
	cancelled.emit()


func _process(delta: float) -> void:
	if player == null:
		return
	# The view: down over the work, and back up when it is over.
	_cam_k = move_toward(_cam_k, 0.0 if _closing else 1.0, delta * 2.2)
	var e := _cam_k * _cam_k * (3.0 - 2.0 * _cam_k)
	player.cine_xf = _eye
	player.cine_k = e
	if _closing:
		if _cam_k <= 0.0:
			player.cine_k = 0.0
			queue_free()
		return
	_mouse = get_viewport().get_mouse_position() if mouse_override == Vector2.INF else mouse_override
	_carry(delta)
	_step_tick(delta)
	_draw_wires()
	_update_hud(delta)
	if _finished_t >= 0.0:
		_finished_t += delta
		if _finished_t > 1.6:
			_closing = true


func _unhandled_input(event: InputEvent) -> void:
	if _closing:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		var k := (event as InputEventKey).keycode
		if k == KEY_ESCAPE:
			get_viewport().set_input_as_handled()
			cancel()
		elif k == KEY_SPACE or k == KEY_ENTER:
			get_viewport().set_input_as_handled()
			_space()
	elif event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_lmb = mb.pressed
			if mb.pressed:
				_press()
			else:
				_release()
		elif mb.button_index == MOUSE_BUTTON_RIGHT:
			_rmb = mb.pressed
		get_viewport().set_input_as_handled()


# --- Things on the bench -------------------------------------------------------------------

func _std(c: Color, rough := 0.7, metal := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	return m


func _mesh(parent: Node3D, mesh: Mesh, mat: Material, pos := Vector3.ZERO, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	parent.add_child(mi)
	return mi


func _cyl(parent: Node3D, r: float, h: float, mat: Material, pos := Vector3.ZERO, rot := Vector3.ZERO, r2 := -1.0, open := false) -> MeshInstance3D:
	var cm := CylinderMesh.new()
	cm.top_radius = r
	cm.bottom_radius = r if r2 < 0.0 else r2
	cm.height = h
	cm.radial_segments = 20
	cm.cap_top = not open
	return _mesh(parent, cm, mat, pos, rot)


func _boxm(parent: Node3D, size: Vector3, mat: Material, pos := Vector3.ZERO, rot := Vector3.ZERO) -> MeshInstance3D:
	var bm := BoxMesh.new()
	bm.size = size
	return _mesh(parent, bm, mat, pos, rot)


## A physical thing on the bench: `looks` is its model, `box` its size for
## collisions; `grab`: it can be picked up; `fixed`: it stays where it is put.
func _body(name_: String, looks: Node3D, box: Vector3, at: Vector3, grab := true, fixed := false, mass := 0.2) -> RigidBody3D:
	var rb := RigidBody3D.new()
	rb.name = name_
	rb.collision_layer = Game.LAYER_DEBRIS
	rb.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
	rb.mass = mass
	rb.continuous_cd = true
	rb.angular_damp = 2.0
	rb.linear_damp = 0.5
	if looks:
		rb.add_child(looks)
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = box
	cs.shape = bs
	cs.position = Vector3(0, box.y * 0.5, 0)
	rb.add_child(cs)
	add_child(rb)
	rb.global_transform = Transform3D(Basis(X, Vector3.UP, Z), _local(at) + Vector3.UP * 0.004)
	if grab:
		rb.set_meta("grab", true)
	if fixed:
		rb.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
		rb.freeze = true
	rb.set_meta("rest", rb.global_basis)
	rb.set_meta("top", box.y)
	_obj[name_] = rb
	return rb


## A bag's model from the icons (the same as it looks in the bag).
func _item_looks(id: String, scale_to := 0.12) -> Node3D:
	var maker = Icons.new()
	var m: Node3D = maker._model(id)
	maker.free()
	if m == null:
		m = Node3D.new()
		_boxm(m, Vector3(0.06, 0.08, 0.04), _std(Color(0.6, 0.55, 0.45)), Vector3(0, 0.04, 0))
		return m
	var holder := Node3D.new()
	holder.add_child(m)
	# Fitted to about `scale_to` tall, standing on the bench.
	var box := _aabb(m)
	var s := scale_to / maxf(maxf(box.size.x, box.size.y), maxf(box.size.z, 0.001))
	m.scale = Vector3.ONE * s
	m.position = -Vector3(box.get_center().x, box.position.y, box.get_center().z) * s
	return holder


func _aabb(n: Node) -> AABB:
	var out := AABB()
	var first := true
	for c in n.find_children("*", "VisualInstance3D", true, false):
		var vi := c as VisualInstance3D
		var xf: Transform3D = (n as Node3D).global_transform.affine_inverse() * vi.global_transform if n.is_inside_tree() else _rel(n, vi)
		var b := xf * vi.get_aabb()
		if first:
			out = b
			first = false
		else:
			out = out.merge(b)
	if first:
		out = AABB(Vector3(-0.03, 0, -0.03), Vector3(0.06, 0.08, 0.06))
	return out


func _rel(root: Node, n: Node3D) -> Transform3D:
	var xf := Transform3D()
	var c: Node = n
	while c != null and c != root:
		if c is Node3D:
			xf = (c as Node3D).transform * xf
		c = c.get_parent()
	return xf


## The rag it is all laid out on.
func _mat() -> void:
	var rag := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(0.7, 0.46)
	rag.mesh = pm
	var m := _std(Color(0.3, 0.27, 0.22), 0.95)
	m.albedo_texture = load("res://scripts/world/textures.gd").noise("rag", 0.5, 3, 128)
	rag.material_override = m
	add_child(rag)
	rag.global_transform = Transform3D(Basis(X, Vector3.UP, Z), S + Vector3.UP * 0.002)
	_obj["rag"] = rag


# --- The pointer: taking, carrying, tipping, dropping -----------------------------------------

func _ray(mask: int) -> Dictionary:
	var cam: Camera3D = get_viewport().get_camera_3d()
	var from := cam.project_ray_origin(_mouse)
	var dir := cam.project_ray_normal(_mouse)
	var q := PhysicsRayQueryParameters3D.create(from, from + dir * 3.0, mask)
	return get_world_3d().direct_space_state.intersect_ray(q)


## Where the pointer is over the bench, at `lift` above its surface.
func _on_plane(lift: float) -> Vector3:
	var cam: Camera3D = get_viewport().get_camera_3d()
	var from := cam.project_ray_origin(_mouse)
	var dir := cam.project_ray_normal(_mouse)
	var y := S.y + lift
	if absf(dir.y) < 1e-3:
		return S
	var t := (y - from.y) / dir.y
	var p := from + dir * maxf(t, 0.0)
	# (kept over the rag, more or less)
	var l := p - S
	var lx := clampf(l.dot(X), -0.42, 0.42)
	var lz := clampf(l.dot(Z), -0.3, 0.28)
	return S + X * lx + Z * lz + Vector3.UP * lift


func _screen(p: Vector3) -> Vector2:
	return get_viewport().get_camera_3d().unproject_position(p)


func _press() -> void:
	var st := _cur()
	var t: String = st["t"]
	# Clicking steps take the click on their target first.
	if t == "click":
		var hit := _ray(Game.LAYER_DEBRIS)
		var want: String = {"syringe0": "ampoule", "syringe2": "syringe", "pills2": "mould", "joint3": "paper"}.get(rid + str(step), "")
		if not hit.is_empty() and String((hit.collider as Node).name) == want:
			_clicked(hit.collider, hit.position)
		return
	if t == "dial" and _near_screen(_obj["clock"].global_position + Vector3.UP * 0.05, 90.0):
		_turn_prev = INF
		return
	if t in ["turn", "tape"] and not _placing():
		_turn_prev = INF
		return
	if t == "saw":
		_saw_last = _mouse
		return
	var hit2 := _ray(Game.LAYER_DEBRIS)
	if OS.get_environment("BENCH_DEBUG") != "":
		print("press at ", _mouse, " hit ", hit2.get("collider"), " ", hit2.get("position"))
	if not hit2.is_empty() and (hit2.collider as Node).has_meta("grab"):
		_drag = hit2.collider
		if not _drag.has_meta("axis_lock"):
			_drag.freeze = false
		_drag.sleeping = false
		_drag_lift = 0.06 + float(_drag.get_meta("lift", 0.0))
		Game.play_3d(Sfx.get_stream(&"item_pickup"), _drag.global_position, -18.0, 0.1, 1.2)


func _release() -> void:
	if _drag:
		_drag.set_meta("dropped", true)
		# Dropped: it falls where it is (flung a little if moving fast).
		_drag.linear_velocity = _drag.linear_velocity.limit_length(1.5)
		_drop_hook(_drag)
		_drag = null
	_turn_prev = INF


func _near_screen(p: Vector3, px: float) -> bool:
	return _screen(p).distance_to(_mouse) < px


## Carrying: pulled towards the pointer (so it knocks things over, and they
## it), turned upright - or tipped, RMB held, to pour.
func _carry(delta: float) -> void:
	_tilt = move_toward(_tilt, 1.9 if (_rmb and _drag != null) else 0.0, delta * 3.5)
	if _drag == null or not is_instance_valid(_drag):
		_drag = null
		return
	var target := _on_plane(_drag_lift + 0.06 * _tilt)
	var off: Vector3 = _drag.get_meta("axis_lock", Vector3.ZERO)
	if off != Vector3.ZERO:
		# (a plunger, a cord: only along its way)
		var o: Vector3 = _drag.get_meta("lock_from")
		var along := clampf((target - o).dot(off), float(_drag.get_meta("lock_min", 0.0)), float(_drag.get_meta("lock_max", 0.1)))
		_drag.global_position = o + off * along
		_drag.linear_velocity = Vector3.ZERO
		return
	var v := (target - _drag.global_position) / maxf(delta, 1e-3) * 0.35
	_drag.linear_velocity = v.limit_length(3.0)
	var rest: Basis = _drag.get_meta("rest")
	# Tipped forward, away from oneself: the mouth goes down.
	var want := Basis(X, -_tilt) * rest
	var q := (want * _drag.global_basis.inverse()).get_rotation_quaternion()
	var ang := q.get_angle()
	if ang > PI:
		ang -= TAU
	_drag.angular_velocity = (q.get_axis() * ang * 12.0 if absf(ang) > 1e-3 else Vector3.ZERO).limit_length(12.0)


## The carried thing's mouth, where what is in it comes out.
func _mouth(b: RigidBody3D) -> Vector3:
	return b.global_transform * Vector3(0, float(b.get_meta("top", 0.08)), 0)


# --- Steps -------------------------------------------------------------------------------------

func _cur() -> Dictionary:
	var steps: Array = recipe["steps"]
	return steps[mini(step, steps.size() - 1)]


func _start_step() -> void:
	prog = 0.0
	_turns = 0.0
	_clicks = 0
	_strokes = 0
	_turn_prev = INF
	_saw_last = Vector2.INF
	_cut_bins.clear()
	var hook := "_enter_%s%d" % [rid, step]
	if has_method(hook):
		call(hook)


func _next() -> void:
	Game.play_3d(Sfx.get_stream(&"key_press"), S, -12.0, 0.05)
	step += 1
	if step >= (recipe["steps"] as Array).size():
		_finish()
	else:
		_start_step()


func _finish() -> void:
	_finished_t = 0.0
	prog = 1.0
	var hook := "_done_" + rid
	if has_method(hook):
		call(hook)
	_say("Готово: " + String(recipe["name"]))
	done.emit(recipe, {"fuse": fuse} if rid == "pipe_bomb" else {})


func _space() -> void:
	if _cur()["t"] == "dial":
		_next()


func _step_tick(delta: float) -> void:
	if _finished_t >= 0.0:
		return
	var st := _cur()
	match st["t"]:
		"hold":
			_pour_tick(delta, float(st.get("time", 1.5)))
		"turn", "tape":
			if _placing():
				_place_tick()
			elif _lmb and _drag == null:
				_turn_tick(float(st.get("turns", 2.0)))
		"dial":
			if _lmb and _drag == null:
				_dial_tick()
		"wires":
			_wires_tick()
		"cuts":
			_cuts_tick()
		"pull":
			_pull_tick()
		"saw":
			if _lmb:
				_saw_tick(int(st.get("n", 4)))
		"click":
			pass


## What is poured in each recipe's "hold" steps: [source thing, target
## point (a Node3D's name and a local offset), colour of what comes out].
func _pour_spec() -> Array:
	match rid + str(step):
		"pipe_bomb0":
			return ["powder", _obj["pipe"].global_transform * Vector3(0.13, 0.02, 0), Color(0.12, 0.12, 0.11)]
		"grenade0":
			return ["nails", _obj["can"].global_transform * Vector3(0, 0.1, 0), Color(0.55, 0.55, 0.57)]
		"grenade1":
			return ["powder", _obj["can"].global_transform * Vector3(0, 0.1, 0), Color(0.12, 0.12, 0.11)]
		"bandage1":
			return ["alcohol", _obj["strips_c"].global_position + Vector3.UP * 0.01, Color(0.8, 0.9, 1.0, 0.6)]
		"pills1":
			return ["dye", _obj["mortar"].global_transform * Vector3(0, 0.07, 0), Color(0.9, 0.2, 0.5)]
		"joint1":
			return ["herb", _obj["paper"].global_position + Vector3.UP * 0.005, Color(0.35, 0.4, 0.18)]
	return []


func _pour_tick(delta: float, need: float) -> void:
	var spec := _pour_spec()
	if spec.is_empty():
		return
	var src: RigidBody3D = _obj.get(spec[0])
	var pouring := false
	if src and _drag == src and _tilt > 1.1:
		var m := _mouth(src)
		var tgt: Vector3 = spec[1]
		var flat := Vector2(m.x - tgt.x, m.z - tgt.z).length()
		pouring = true
		_pour.global_position = m
		(_pour.mesh.surface_get_material(0) as StandardMaterial3D).albedo_color = spec[2]
		if flat < 0.06 and m.y > tgt.y - 0.01 and m.y < tgt.y + 0.25:
			prog = minf(prog + delta / need, 1.0)
			_pour_hook(prog)
		elif _msg_t <= 0.0:
			_say("Мимо! Держи над тем, куда сыпать")
	_pour.emitting = pouring
	_pour_t -= delta
	if pouring and _pour_t <= 0.0:
		_pour_t = 0.25
		Game.play_3d(Sfx.get_stream(&"mop_swish" if spec[0] == "alcohol" or spec[0] == "dye" else &"casing"), _pour.global_position, -22.0, 0.2, 1.8)
	if prog >= 1.0:
		_pour.emitting = false
		_next()


## Winding round (turn / tape): the pointer circles the thing on screen.
func _turn_center() -> Vector3:
	match rid + str(step):
		"pipe_bomb1":
			return _obj["cap"].global_position
		"pipe_bomb4":
			return _obj["pipe"].global_position
		"grenade3":
			return _obj["can"].global_transform * Vector3(0, 0.08, 0)
		"bandage2":
			return _obj["strips_c"].global_position
		"pills0":
			return _obj["mortar"].global_transform * Vector3(0, 0.05, 0)
		"joint0":
			return _obj["grinder"].global_transform * Vector3(0, 0.04, 0)
		"molotov1":
			return _obj["bottle"].global_transform * Vector3(0, 0.25, 0)
	return S


func _turn_tick(need: float) -> void:
	var c := _screen(_turn_center())
	var d := _mouse - c
	if d.length() < 18.0:
		return
	var a := d.angle()
	if _turn_prev != INF:
		var da := wrapf(a - _turn_prev, -PI, PI)
		_turns += absf(da) / TAU
		prog = clampf(_turns / need, 0.0, 1.0)
		_turn_hook(da, prog)
	_turn_prev = a
	if prog >= 1.0:
		_next()


## A thing that has to be put in place first (the cap on the pipe).
func _placing() -> bool:
	return rid == "pipe_bomb" and step == 1 and not _obj["cap"].has_meta("on")


func _place_tick() -> void:
	var cap: RigidBody3D = _obj["cap"]
	var end: Vector3 = _obj["pipe"].global_transform * Vector3(0.135, 0.0, 0)
	if cap.global_position.distance_to(end) < 0.06:
		if _drag == cap:
			_drag = null
		cap.set_meta("on", true)
		cap.remove_meta("grab")
		cap.freeze = true
		var pipe: Node3D = _obj["pipe"]
		cap.global_transform = Transform3D(pipe.global_basis * Basis(Vector3.FORWARD, -PI * 0.5), end + pipe.global_basis.x * 0.012)
		Game.play_3d(Sfx.get_stream(&"metal_hit"), end, -18.0, 0.1, 2.5)
		_say("Крышка села. Теперь закручивай: крути мышью вокруг неё")


func _dial_tick() -> void:
	var clock: Node3D = _obj["clock"]
	var c := _screen(clock.global_transform * Vector3(0, 0.05, 0.012))
	var d := _mouse - c
	if d.length() < 8.0:
		return
	# The hand points at the pointer; the minutes left are where it points.
	var a := fposmod(d.angle() + PI * 0.5, TAU)
	var hand: Node3D = _obj["hand"]
	hand.rotation.z = -a
	fuse = snappedf(5.0 + a / TAU * 85.0, 1.0)
	prog = a / TAU


## The wires (and the fuse cord): each free end pulled over to its contact.
func _wires_tick() -> void:
	var all_done := not _wires.is_empty()
	for w in _wires:
		if w["done"]:
			continue
		all_done = false
		var e: RigidBody3D = w["end"]
		var c: Vector3 = w["contact"].global_position if w["contact"] is Node3D else w["contact"]
		if e.global_position.distance_to(c) < 0.03:
			if _drag == e:
				_drag = null
			w["done"] = true
			e.freeze = true
			e.remove_meta("grab")
			e.global_position = c
			Game.play_3d(Sfx.get_stream(&"key_press"), c, -14.0, 0.1, 2.0)
	var n_done := 0
	for w in _wires:
		if w["done"]:
			n_done += 1
	prog = float(n_done) / maxf(_wires.size(), 1)
	if all_done:
		_next()


func _pull_tick() -> void:
	var h: RigidBody3D = _obj.get("pull")
	if h == null:
		return
	if rid == "grenade" or rid == "molotov":
		_wires_tick()
		return
	var o: Vector3 = h.get_meta("lock_from")
	var along := (h.global_position - o).dot(h.get_meta("axis_lock"))
	prog = clampf(along / float(h.get_meta("lock_max")), 0.0, 1.0)
	_turn_hook(0.0, prog)
	if prog >= 0.98:
		_drag = null
		_next()


## Rolling (saw): the pointer back and forth across it, stroke by stroke.
func _saw_tick(need: int) -> void:
	if _saw_last == Vector2.INF:
		_saw_last = _mouse
		return
	var dx := _mouse.x - _saw_last.x
	_saw_last = _mouse
	if absf(dx) < 0.5:
		return
	var dir := signf(dx)
	if dir != _saw_dir:
		if _saw_run > 60.0:
			_strokes += 1
			Game.play_3d(Sfx.get_stream(&"mop_swish"), S, -26.0, 0.2, 2.2)
		_saw_dir = dir
		_saw_run = 0.0
	_saw_run += absf(dx)
	prog = clampf((float(_strokes) + minf(_saw_run / 60.0, 1.0) * 0.9) / need, 0.0, 1.0)
	_turn_hook(dx, prog)
	if _strokes >= need:
		_next()


## Cutting: the scissors' points drawn along each chalk line.
func _cuts_tick() -> void:
	var sc: RigidBody3D = _obj.get("scissors")
	var lines: Array = _obj.get("cut_lines", [])
	if sc == null or lines.is_empty():
		return
	if _cut_bins.is_empty():
		for l in lines:
			var b := PackedByteArray()
			b.resize(16)
			b.fill(0)
			_cut_bins.append(b)
	var tip := sc.global_transform * Vector3(0, 0.01, -0.07)
	var done_n := 0
	for i in lines.size():
		var a: Vector3 = lines[i][0]
		var b2: Vector3 = lines[i][1]
		var ab := b2 - a
		var t := clampf((tip - a).dot(ab) / ab.length_squared(), 0.0, 1.0)
		var near := a + ab * t
		if Vector2(near.x - tip.x, near.z - tip.z).length() < 0.02 and absf(tip.y - near.y) < 0.05 and _drag == sc:
			var bins: PackedByteArray = _cut_bins[i]
			var k := clampi(int(t * 16.0), 0, 15)
			if bins[k] == 0:
				bins[k] = 1
				_cut_bins[i] = bins
				_cut_mark(i, t)
				if randf() < 0.5:
					Game.play_3d(Sfx.get_stream(&"key_press"), tip, -22.0, 0.3, 2.0)
		var cnt := 0
		for v in _cut_bins[i]:
			cnt += v
		if cnt >= 14:
			done_n += 1
	prog = float(done_n) / lines.size()
	if done_n >= lines.size():
		_cloth_to_strips()
		_next()


func _clicked(body: Node, at: Vector3) -> void:
	var need := int(_cur().get("n", 1))
	_clicks += 1
	prog = float(_clicks) / need
	_click_hook(body, at, _clicks)
	if _clicks >= need:
		_next()


# --- Per-recipe: what is laid out, and what each step does to it --------------------------------

# Hooks called by the step engine:
func _pour_hook(k: float) -> void:
	match rid + str(step):
		"pipe_bomb0":
			(_obj["fill"] as Node3D).scale = Vector3(1, maxf(k, 0.01), 1)
		"grenade0":
			(_obj["can_fill"] as Node3D).scale = Vector3(1, maxf(k * 0.5, 0.01), 1)
		"grenade1":
			(_obj["can_fill"] as Node3D).scale = Vector3(1, maxf(0.5 + k * 0.45, 0.01), 1)
			(((_obj["can_fill"] as Node3D).get_child(0) as MeshInstance3D).material_override as StandardMaterial3D).albedo_color = Color(0.5, 0.5, 0.52).lerp(Color(0.13, 0.13, 0.12), k)
		"bandage1":
			for s in _obj.get("strips", []):
				if is_instance_valid(s):
					for m in (s as Node).find_children("*", "MeshInstance3D", true, false):
						((m as MeshInstance3D).material_override as StandardMaterial3D).albedo_color = Color(0.9, 0.88, 0.82).lerp(Color(0.72, 0.72, 0.7), k)
		"pills1":
			((_obj["mash"] as MeshInstance3D).material_override as StandardMaterial3D).albedo_color = Color(0.93, 0.92, 0.9).lerp(Color(0.92, 0.45, 0.62), k)
		"joint1":
			(_obj["herb_line"] as Node3D).scale = Vector3(maxf(k, 0.01), 1, 1)


func _turn_hook(da: float, k: float) -> void:
	match rid + str(step):
		"pipe_bomb1":
			var cap: Node3D = _obj["cap"]
			var pipe: Node3D = _obj["pipe"]
			cap.rotate(pipe.global_basis.x, -da)
			var end: Vector3 = pipe.global_transform * Vector3(0.135, 0.0, 0)
			cap.global_position = end + pipe.global_basis.x * lerpf(0.012, 0.0, k)
			if int(k * 12.0) != int((k - absf(da) / TAU / 2.0) * 12.0):
				Game.play_3d(Sfx.get_stream(&"key_press"), end, -26.0, 0.1, 2.5)
		"pipe_bomb4", "grenade3":
			var band: Node3D = _obj["tape_band"]
			band.visible = true
			if rid == "pipe_bomb":
				band.scale = Vector3(1, maxf(k, 0.01), 1)
				band.position = Vector3(-0.1 + 0.1 * k, 0, 0)
			else:
				band.scale = Vector3(1, maxf(k, 0.01), 1)
			var roll: Node3D = _obj.get("tape")
			if roll and roll is RigidBody3D and not (roll as RigidBody3D).has_meta("used"):
				(roll as RigidBody3D).set_meta("used", true)
				roll.visible = false
		"bandage2":
			for s in _obj.get("strips", []):
				if is_instance_valid(s):
					(s as Node3D).visible = k < 0.25
			var roll2: Node3D = _obj["roll"]
			roll2.visible = true
			roll2.scale = Vector3(0.3 + k * 0.7, 1, 0.3 + k * 0.7)
			roll2.rotate_object_local(Vector3.UP, da)
		"pills0":
			var pestle: Node3D = _obj["pestle"]
			pestle.rotation.y += da
			((_obj["mash"] as MeshInstance3D).material_override as StandardMaterial3D).albedo_color = Color(0.8, 0.78, 0.74).lerp(Color(0.95, 0.94, 0.92), k)
			for bit in _obj.get("lumps", []):
				(bit as Node3D).scale = Vector3.ONE * maxf(1.0 - k, 0.05)
		"joint0":
			(_obj["grinder_lid"] as Node3D).rotation.y += da
		"molotov1":
			var rag: Node3D = _obj["rag_in"]
			rag.rotation.y += da
			rag.scale = Vector3(1.0 - 0.25 * k, 1.0, 1.0 - 0.25 * k)
		"joint2":
			# The paper curls up round the herb.
			var paper: Node3D = _obj["paper_looks"]
			paper.scale = Vector3(1, 1, maxf(1.0 - k * 0.85, 0.15))
			var rolled: Node3D = _obj["rolled"]
			rolled.visible = k > 0.1
			rolled.scale = Vector3(1, clampf(k * 1.2, 0.1, 1.0), clampf(k * 1.2, 0.1, 1.0))
			rolled.rotation.x += da * 0.02
		"syringe1":
			var plunger_fill: Node3D = _obj["liquid"]
			plunger_fill.scale = Vector3(1, maxf(k, 0.01), 1)


func _click_hook(body: Node, at: Vector3, n: int) -> void:
	match rid + str(step):
		"syringe0":
			# The neck snaps; the tip flies off.
			var tip: Node3D = _obj["amp_tip"]
			var fly := RigidBody3D.new()
			fly.collision_layer = Game.LAYER_DEBRIS
			fly.collision_mask = Game.LAYER_WORLD | Game.LAYER_DEBRIS
			fly.mass = 0.01
			var gxf := tip.global_transform
			tip.get_parent().remove_child(tip)
			fly.add_child(tip)
			tip.transform = Transform3D()
			var cs := CollisionShape3D.new()
			var sp := SphereShape3D.new()
			sp.radius = 0.005
			cs.shape = sp
			fly.add_child(cs)
			add_child(fly)
			fly.global_transform = gxf
			fly.linear_velocity = X * 0.6 + Vector3.UP * 0.8
			fly.angular_velocity = Vector3(8, 3, 5)
			Game.play_3d(Sfx.get_stream(&"casing"), at, -10.0, 0.1, 2.5)
		"syringe2":
			var syr: RigidBody3D = _obj["syringe"]
			syr.freeze = false
			syr.apply_impulse(Vector3.UP * 0.01 + X * randf_range(-0.004, 0.004), X * 0.02)
			Game.play_3d(Sfx.get_stream(&"key_press"), at, -18.0, 0.1, 2.5)
			var bub: Node3D = _obj.get("bubbles")
			if bub:
				bub.scale = Vector3.ONE * maxf(1.0 - n / 3.0, 0.01)
			get_tree().create_timer(0.6).timeout.connect(func():
				if is_instance_valid(syr):
					syr.freeze = true)
		"pills2":
			# A pill pressed: it pops out of the mould onto the rag.
			var pill := RigidBody3D.new()
			pill.collision_layer = Game.LAYER_DEBRIS
			pill.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_DEBRIS
			pill.mass = 0.005
			var mi := MeshInstance3D.new()
			var cm := CylinderMesh.new()
			cm.top_radius = 0.008
			cm.bottom_radius = 0.008
			cm.height = 0.004
			mi.mesh = cm
			mi.material_override = _std(Color(0.95, 0.5, 0.66), 0.5)
			pill.add_child(mi)
			var cs2 := CollisionShape3D.new()
			var cy := CylinderShape3D.new()
			cy.radius = 0.008
			cy.height = 0.004
			cs2.shape = cy
			pill.add_child(cs2)
			add_child(pill)
			var mould: Node3D = _obj["mould"]
			pill.global_position = mould.global_transform * Vector3(-0.04 + 0.02 * (n - 1), 0.03, 0)
			pill.linear_velocity = Z * 0.4 + Vector3.UP * 0.6 + X * randf_range(-0.2, 0.2)
			pill.angular_velocity = Vector3(randf_range(-9, 9), 0, randf_range(-9, 9))
			_obj["pill%d" % n] = pill
			Game.play_3d(Sfx.get_stream(&"key_press"), at, -12.0, 0.1, 1.6)
			var press: Node3D = _obj["press_top"]
			var tw := create_tween()
			tw.tween_property(press, "position:y", 0.012, 0.06)
			tw.tween_property(press, "position:y", 0.04, 0.15)
		"joint3":
			((_obj["rolled_mesh"] as MeshInstance3D).material_override as StandardMaterial3D).albedo_color = Color(0.9, 0.87, 0.78)
			Game.play_3d(Sfx.get_stream(&"key_press"), at, -18.0, 0.1, 1.2)


func _drop_hook(_b: RigidBody3D) -> void:
	pass


# --- Recipes: laying them out ------------------------------------------------------------------

func _setup_pipe_bomb() -> void:
	var steel := _std(Color(0.42, 0.42, 0.41), 0.45, 0.7)
	var dark := _std(Color(0.18, 0.18, 0.18), 0.5, 0.6)
	# The pipe, lying across; one end capped, the other open.
	var pipe := Node3D.new()
	_cyl(pipe, 0.022, 0.26, steel, Vector3.ZERO, Vector3(0, 0, PI * 0.5), -1.0, true)
	_cyl(pipe, 0.017, 0.255, _std(Color(0.05, 0.05, 0.05), 1.0), Vector3.ZERO, Vector3(0, 0, PI * 0.5))
	_cyl(pipe, 0.026, 0.022, dark, Vector3(-0.13, 0, 0), Vector3(0, 0, PI * 0.5))
	var fill := _cyl(pipe, 0.0168, 0.25, _std(Color(0.1, 0.1, 0.09), 1.0), Vector3(0.0, 0, 0), Vector3(0, 0, PI * 0.5))
	fill.scale = Vector3(1, 0.01, 1)
	_obj["fill"] = fill
	# Five contacts for the wires along the top, in their colours.
	var cols := [Color(0.85, 0.1, 0.1), Color(0.08, 0.08, 0.08), Color(0.12, 0.35, 0.9), Color(0.95, 0.8, 0.1), Color(0.1, 0.65, 0.2)]
	var order := [0, 1, 2, 3, 4]
	order.shuffle()
	_obj["contacts"] = []
	for i in 5:
		var c := _cyl(pipe, 0.004, 0.006, _std(cols[order[i]], 0.4, 0.5), Vector3(-0.08 + 0.04 * i, 0.023, 0))
		_obj["contacts"].append([c, order[i]])
	var band := _cyl(pipe, 0.0235, 0.2, _std(Color(0.04, 0.04, 0.045), 0.35), Vector3(-0.1, 0, 0), Vector3(0, 0, PI * 0.5))
	band.visible = false
	_obj["tape_band"] = band
	var pb := _body("pipe", pipe, Vector3(0.26, 0.044, 0.044), Vector3(0.02, 0.022, -0.02), false, true, 1.2)
	pb.get_child(0).position = Vector3.ZERO
	(pb.get_child(1) as CollisionShape3D).position = Vector3.ZERO
	pb.global_position = _local(Vector3(0.02, 0.024, -0.02))
	# The cap, beside it.
	var cap := Node3D.new()
	_cyl(cap, 0.026, 0.024, dark)
	for k in 8:
		_boxm(cap, Vector3(0.004, 0.024, 0.006), dark, Vector3(cos(k * TAU / 8) * 0.026, 0, sin(k * TAU / 8) * 0.026), Vector3(0, -k * TAU / 8, 0))
	_body("cap", cap, Vector3(0.05, 0.024, 0.05), Vector3(0.24, 0.0, 0.1), true, false, 0.1)
	_obj["cap"].get_child(0).position = Vector3(0, 0.012, 0)
	# The bag of powder, the clock, the tape.
	_body("powder", _item_looks("powder", 0.13), Vector3(0.07, 0.13, 0.05), Vector3(-0.26, 0, 0.08), true, false, 0.4)
	_obj["powder"].set_meta("top", 0.13)
	_clock(Vector3(0.28, 0, -0.12))
	var tape := Node3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.018
	tm.outer_radius = 0.034
	_mesh(tape, tm, _std(Color(0.05, 0.05, 0.06), 0.4), Vector3(0, 0.009, 0))
	_body("tape", tape, Vector3(0.068, 0.018, 0.068), Vector3(-0.28, 0, -0.14), true, false, 0.08)


func _clock(at: Vector3) -> void:
	var red := _std(Color(0.7, 0.08, 0.06), 0.35, 0.3)
	var face_m := _std(Color(0.95, 0.93, 0.86), 0.6)
	var c := Node3D.new()
	# Standing, the face towards the eye.
	_cyl(c, 0.042, 0.03, red, Vector3(0, 0.05, 0), Vector3(PI * 0.5, 0, 0))
	_cyl(c, 0.037, 0.002, face_m, Vector3(0, 0.05, 0.016), Vector3(PI * 0.5, 0, 0))
	for k in 12:
		var a := k * TAU / 12.0
		_boxm(c, Vector3(0.002, 0.006 if k % 3 == 0 else 0.003, 0.001), _std(Color(0.1, 0.1, 0.1)), Vector3(sin(a) * 0.031, 0.05 + cos(a) * 0.031, 0.0175), Vector3(0, 0, -a))
	for sx in [-1.0, 1.0]:
		var bell := SphereMesh.new()
		bell.radius = 0.014
		bell.height = 0.014
		bell.is_hemisphere = true
		_mesh(c, bell, _std(Color(0.8, 0.78, 0.7), 0.3, 0.9), Vector3(sx * 0.026, 0.09, 0), Vector3(0, 0, sx * 0.4))
		_boxm(c, Vector3(0.004, 0.02, 0.004), red, Vector3(sx * 0.03, 0.01, 0), Vector3(0, 0, sx * 0.3))
	var hand := Node3D.new()
	hand.position = Vector3(0, 0.05, 0.018)
	c.add_child(hand)
	_boxm(hand, Vector3(0.003, 0.028, 0.001), _std(Color(0.05, 0.05, 0.05)), Vector3(0, 0.012, 0))
	_obj["hand"] = hand
	_body("clock", c, Vector3(0.09, 0.1, 0.035), at, true, false, 0.3)


func _enter_pipe_bomb2() -> void:
	# The clock stands up facing one to set it.
	var clock: RigidBody3D = _obj["clock"]
	if _drag == clock:
		_drag = null
	clock.freeze = true
	clock.remove_meta("grab")
	var tw := create_tween()
	tw.tween_property(clock, "global_transform", Transform3D(Basis(X, Vector3.UP, Z), _local(Vector3(0.22, 0.0, -0.08))), 0.35)
	_dial_tick_init()


func _dial_tick_init() -> void:
	var hand: Node3D = _obj["hand"]
	hand.rotation.z = -(fuse - 5.0) / 85.0 * TAU


func _enter_pipe_bomb3() -> void:
	# Onto the pipe with the clock, taped there; its five wires hang loose.
	var clock: RigidBody3D = _obj["clock"]
	clock.freeze = true
	clock.remove_meta("grab")
	var pipe: Node3D = _obj["pipe"]
	var on := Transform3D(Basis(X, Vector3.UP, Z), pipe.global_position + Vector3.UP * 0.021 - Z * 0.035)
	create_tween().tween_property(clock, "global_transform", on, 0.4)
	var cols := [Color(0.85, 0.1, 0.1), Color(0.08, 0.08, 0.08), Color(0.12, 0.35, 0.9), Color(0.95, 0.8, 0.1), Color(0.1, 0.65, 0.2)]
	_wires.clear()
	for i in 5:
		var pin := Node3D.new()
		clock.add_child(pin)
		pin.position = Vector3(-0.03 + 0.015 * i, 0.012, 0.012)
		var clip := Node3D.new()
		_cyl(clip, 0.005, 0.014, _std(cols[i], 0.5), Vector3(0, 0.007, 0))
		var e := _body("wire_end%d" % i, clip, Vector3(0.024, 0.02, 0.024), Vector3(-0.2 + 0.05 * i, 0.0, 0.13), true, false, 0.02)
		var contact: Node3D = null
		for c in _obj["contacts"]:
			if c[1] == i:
				contact = c[0]
		_wires.append({"start": pin, "end": e, "contact": contact, "col": cols[i], "segs": [], "done": false})
	_say("Тащи каждый провод к контакту его цвета на трубе")


func _done_pipe_bomb() -> void:
	pass


func _setup_grenade() -> void:
	var tin := _std(Color(0.62, 0.64, 0.66), 0.35, 0.8)
	tin.cull_mode = BaseMaterial3D.CULL_DISABLED
	var can := Node3D.new()
	_cyl(can, 0.035, 0.1, tin, Vector3(0, 0.05, 0), Vector3.ZERO, -1.0, true)
	var inner := _std(Color(0.1, 0.1, 0.1), 1.0)
	var fill := _cyl(can, 0.033, 0.095, _std(Color(0.5, 0.5, 0.52), 0.6, 0.5), Vector3(0, 0.0, 0))
	fill.position = Vector3(0, 0.0, 0)
	fill.scale = Vector3(1, 0.01, 1)
	# (scaled from the bottom: the mesh is moved up by half inside a holder)
	var holder := Node3D.new()
	can.add_child(holder)
	fill.get_parent().remove_child(fill)
	holder.add_child(fill)
	fill.position = Vector3(0, 0.0475, 0)
	_obj["can_fill"] = holder
	holder.scale = Vector3(1, 0.01, 1)
	fill.scale = Vector3.ONE
	_cyl(can, 0.034, 0.001, inner, Vector3(0, 0.001, 0))
	var band := _cyl(can, 0.0362, 0.035, _std(Color(0.04, 0.04, 0.045), 0.35), Vector3(0, 0.08, 0))
	band.visible = false
	_obj["tape_band"] = band
	var lid := _cyl(can, 0.036, 0.004, tin, Vector3(0, 0.102, 0))
	lid.visible = false
	_obj["lid"] = lid
	var cord_top := _cyl(can, 0.003, 0.05, _std(Color(0.4, 0.3, 0.15), 0.9), Vector3(0, 0.125, 0))
	cord_top.visible = false
	_obj["cord_top"] = cord_top
	_body("can", can, Vector3(0.07, 0.1, 0.07), Vector3(0.02, 0, -0.04), false, true, 0.2)
	_body("nails", _item_looks("nails", 0.08), Vector3(0.07, 0.06, 0.05), Vector3(-0.25, 0, 0.1), true, false, 0.3)
	_obj["nails"].set_meta("top", 0.06)
	_body("powder", _item_looks("powder", 0.13), Vector3(0.07, 0.13, 0.05), Vector3(0.26, 0, 0.1), true, false, 0.4)
	_obj["powder"].set_meta("top", 0.13)
	var tape := Node3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.018
	tm.outer_radius = 0.034
	_mesh(tape, tm, _std(Color(0.05, 0.05, 0.06), 0.4), Vector3(0, 0.009, 0))
	_body("tape", tape, Vector3(0.068, 0.018, 0.068), Vector3(-0.28, 0, -0.14), true, false, 0.08)


func _enter_grenade2() -> void:
	# The fuse cord, coiled on the rag; its end goes down into the can.
	var coil := Node3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.012
	tm.outer_radius = 0.02
	_mesh(coil, tm, _std(Color(0.4, 0.3, 0.15), 0.9), Vector3(0, 0.004, 0))
	var cb := _body("coil", coil, Vector3(0.04, 0.008, 0.04), Vector3(0.25, 0, -0.1), false, true, 0.05)
	var pin := Node3D.new()
	cb.add_child(pin)
	pin.position = Vector3(0, 0.006, 0)
	var tipn := Node3D.new()
	_cyl(tipn, 0.004, 0.02, _std(Color(0.35, 0.26, 0.12), 0.9), Vector3(0, 0.01, 0))
	var e := _body("pull", tipn, Vector3(0.01, 0.02, 0.01), Vector3(0.18, 0, 0.02), true, false, 0.01)
	var can: Node3D = _obj["can"]
	_wires.clear()
	_wires.append({"start": pin, "end": e, "contact": can.global_transform * Vector3(0, 0.1, 0), "col": Color(0.4, 0.3, 0.15), "segs": [], "done": false})


func _enter_grenade3() -> void:
	(_obj["lid"] as Node3D).visible = true
	(_obj["cord_top"] as Node3D).visible = true
	for w in _wires:
		for s in w["segs"]:
			(s as Node).queue_free()
		(w["end"] as Node).queue_free()
	_wires.clear()


func _setup_bandage() -> void:
	var cloth := Node3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(0.24, 0.2)
	var cm := _std(Color(0.9, 0.88, 0.82), 0.95)
	cm.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mesh(cloth, pm, cm, Vector3(0, 0.002, 0))
	var chalk := _std(Color(0.35, 0.4, 0.8), 0.9)
	var lines: Array = []
	for i in 3:
		var x := -0.06 + 0.06 * i
		for k in 10:
			_boxm(cloth, Vector3(0.002, 0.001, 0.012), chalk, Vector3(x, 0.003, -0.09 + k * 0.02))
	var cb := _body("cloth", cloth, Vector3(0.24, 0.004, 0.2), Vector3(0.0, 0, -0.04), false, true, 0.05)
	for i in 3:
		var x := -0.06 + 0.06 * i
		lines.append([cb.global_transform * Vector3(x, 0.004, -0.1), cb.global_transform * Vector3(x, 0.004, 0.1)])
	_obj["cut_lines"] = lines
	# Scissors: two blades crossed, their rings.
	var sc := Node3D.new()
	var steel := _std(Color(0.7, 0.7, 0.72), 0.3, 0.9)
	var plastic := _std(Color(0.1, 0.25, 0.7), 0.5)
	_boxm(sc, Vector3(0.006, 0.003, 0.08), steel, Vector3(-0.004, 0.006, -0.035), Vector3(0, 0.08, 0))
	_boxm(sc, Vector3(0.006, 0.003, 0.08), steel, Vector3(0.004, 0.009, -0.035), Vector3(0, -0.08, 0))
	var ring := TorusMesh.new()
	ring.inner_radius = 0.01
	ring.outer_radius = 0.016
	_mesh(sc, ring, plastic, Vector3(-0.016, 0.006, 0.02))
	_mesh(sc, ring, plastic, Vector3(0.016, 0.006, 0.02))
	_body("scissors", sc, Vector3(0.05, 0.012, 0.12), Vector3(0.25, 0, 0.08), true, false, 0.08)
	_body("alcohol", _item_looks("alcohol", 0.15), Vector3(0.05, 0.15, 0.05), Vector3(-0.28, 0, 0.06), true, false, 0.4)
	_obj["alcohol"].set_meta("top", 0.15)
	var roll := Node3D.new()
	_cyl(roll, 0.02, 0.06, _std(Color(0.88, 0.87, 0.82), 0.95), Vector3.ZERO, Vector3(0, 0, PI * 0.5))
	add_child(roll)
	roll.global_transform = Transform3D(Basis(X, Vector3.UP, Z), _local(Vector3(0.0, 0.02, -0.04)))
	roll.visible = false
	_obj["roll"] = roll
	var c := Node3D.new()
	add_child(c)
	c.global_position = _local(Vector3(0, 0.0, -0.04))
	_obj["strips_c"] = c


func _cut_mark(i: int, t: float) -> void:
	var lines: Array = _obj["cut_lines"]
	var a: Vector3 = lines[i][0]
	var b: Vector3 = lines[i][1]
	var p := a.lerp(b, t)
	var m := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.003, 0.002, 0.014)
	m.mesh = bm
	m.material_override = _std(Color(0.25, 0.23, 0.2), 1.0)
	add_child(m)
	m.global_transform = Transform3D(Basis(X, Vector3.UP, Z), p + Vector3.UP * 0.002)


## The rag, cut: four strips, each its own thing now.
func _cloth_to_strips() -> void:
	var cloth: Node3D = _obj["cloth"]
	var strips: Array = []
	for k in 4:
		var s := Node3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.056, 0.003, 0.2)
		var m := _std(Color(0.9, 0.88, 0.82), 0.95)
		_mesh(s, bm, m, Vector3(0, 0.0015, 0))
		var b := _body("strip%d" % k, s, Vector3(0.056, 0.003, 0.2), Vector3(-0.09 + 0.06 * k, 0.004, -0.04), true, false, 0.01)
		b.linear_velocity = X * (k - 1.5) * 0.15
		strips.append(b)
	_obj["strips"] = strips
	cloth.queue_free()
	for c in get_children():
		if c is MeshInstance3D and (c as MeshInstance3D).mesh is BoxMesh and ((c as MeshInstance3D).mesh as BoxMesh).size.z == 0.014:
			c.queue_free()
	var sc: RigidBody3D = _obj["scissors"]
	if _drag == sc:
		_drag = null


func _setup_syringe() -> void:
	var glass := _std(Color(0.8, 0.9, 0.95, 0.35), 0.1)
	glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var amp := Node3D.new()
	_cyl(amp, 0.008, 0.04, glass, Vector3(0, 0.02, 0))
	_cyl(amp, 0.007, 0.03, _std(Color(0.9, 0.75, 0.3, 0.8), 0.2), Vector3(0, 0.017, 0))
	_cyl(amp, 0.003, 0.012, glass, Vector3(0, 0.046, 0), Vector3.ZERO, 0.008)
	var tip := Node3D.new()
	tip.position = Vector3(0, 0.058, 0)
	amp.add_child(tip)
	_cyl(tip, 0.0035, 0.014, glass, Vector3(0, 0.007, 0), Vector3.ZERO, 0.0025)
	_obj["amp_tip"] = tip
	var ab := _body("ampoule", amp, Vector3(0.02, 0.072, 0.02), Vector3(0.18, 0, -0.08), false, true, 0.02)
	ab.set_meta("click", true)
	# The syringe, lying across; its plunger comes out along it.
	var syr := Node3D.new()
	_cyl(syr, 0.007, 0.08, glass, Vector3(0, 0.008, 0), Vector3(0, 0, PI * 0.5))
	_cyl(syr, 0.001, 0.035, _std(Color(0.8, 0.8, 0.82), 0.2, 0.9), Vector3(-0.058, 0.008, 0), Vector3(0, 0, PI * 0.5))
	var liquid := Node3D.new()
	liquid.position = Vector3(-0.038, 0.008, 0)
	syr.add_child(liquid)
	_cyl(liquid, 0.0062, 0.07, _std(Color(0.9, 0.75, 0.3, 0.9), 0.2), Vector3(0.035, 0, 0), Vector3(0, 0, PI * 0.5))
	liquid.scale = Vector3(0.01, 1, 1)
	_obj["liquid"] = liquid
	var bub := Node3D.new()
	syr.add_child(bub)
	for k in 4:
		var sm := SphereMesh.new()
		sm.radius = 0.0015
		sm.height = 0.003
		_mesh(bub, sm, _std(Color(1, 1, 1, 0.8), 0.1), Vector3(-0.02 + 0.012 * k, 0.013, 0))
	bub.visible = false
	_obj["bubbles"] = bub
	var sb := _body("syringe", syr, Vector3(0.1, 0.016, 0.016), Vector3(-0.02, 0, 0.04), false, true, 0.02)
	sb.set_meta("click", true)
	# The plunger: pulled out along the barrel.
	var pl := Node3D.new()
	_cyl(pl, 0.0025, 0.06, _std(Color(0.95, 0.95, 0.95), 0.4), Vector3(0.03, 0, 0), Vector3(0, 0, PI * 0.5))
	_cyl(pl, 0.009, 0.003, _std(Color(0.95, 0.95, 0.95), 0.4), Vector3(0, 0, 0), Vector3(0, 0, PI * 0.5))
	var pb := _body("pull", pl, Vector3(0.012, 0.018, 0.018), Vector3(0.03, 0.008, 0.04), true, false, 0.01)
	pb.freeze = true
	pb.set_meta("axis_lock", X)
	pb.set_meta("lock_from", pb.global_position)
	pb.set_meta("lock_min", 0.0)
	pb.set_meta("lock_max", 0.05)
	(pb.get_child(1) as CollisionShape3D).position = Vector3.ZERO


func _enter_syringe2() -> void:
	(_obj["bubbles"] as Node3D).visible = true
	var p: RigidBody3D = _obj["pull"]
	p.remove_meta("grab")


func _setup_pills() -> void:
	var stone := _std(Color(0.55, 0.53, 0.5), 0.8)
	stone.cull_mode = BaseMaterial3D.CULL_DISABLED
	var mortar := Node3D.new()
	_cyl(mortar, 0.055, 0.07, stone, Vector3(0, 0.035, 0), Vector3.ZERO, 0.04, true)
	var mash := _cyl(mortar, 0.045, 0.012, _std(Color(0.8, 0.78, 0.74), 0.95), Vector3(0, 0.025, 0))
	_obj["mash"] = mash
	var lumps: Array = []
	for k in 6:
		var bm := _boxm(mortar, Vector3(0.01, 0.008, 0.012), _std(Color(0.95, 0.95, 0.93) if k % 2 == 0 else Color(0.97, 0.96, 0.9), 0.9),
				Vector3(randf_range(-0.025, 0.025), 0.034, randf_range(-0.025, 0.025)), Vector3(0, randf() * TAU, 0))
		lumps.append(bm)
	_obj["lumps"] = lumps
	var pestle := Node3D.new()
	pestle.position = Vector3(0, 0.03, 0)
	mortar.add_child(pestle)
	var p2 := _cyl(pestle, 0.01, 0.12, _std(Color(0.5, 0.36, 0.22), 0.8), Vector3(0.02, 0.05, 0), Vector3(0, 0, 0.35), 0.014)
	p2.name = "stick"
	_obj["pestle"] = pestle
	_body("mortar", mortar, Vector3(0.11, 0.07, 0.11), Vector3(-0.05, 0, -0.06), false, true, 1.0)
	_body("dye", _item_looks("dye", 0.08), Vector3(0.03, 0.08, 0.03), Vector3(0.25, 0, 0.08), true, false, 0.05)
	_obj["dye"].set_meta("top", 0.08)
	# The mould the pills are pressed in, its press on top.
	var mould := Node3D.new()
	_boxm(mould, Vector3(0.13, 0.02, 0.04), _std(Color(0.35, 0.3, 0.25), 0.7), Vector3(0, 0.01, 0))
	for k in 5:
		_cyl(mould, 0.008, 0.002, _std(Color(0.1, 0.1, 0.1), 1.0), Vector3(-0.04 + 0.02 * k, 0.0205, 0))
	var press := Node3D.new()
	press.position = Vector3(0, 0.04, 0)
	mould.add_child(press)
	_boxm(press, Vector3(0.13, 0.008, 0.04), _std(Color(0.45, 0.45, 0.47), 0.4, 0.6))
	_boxm(press, Vector3(0.02, 0.03, 0.02), _std(Color(0.2, 0.2, 0.2), 0.5), Vector3(0, 0.018, 0))
	_obj["press_top"] = press
	var mb := _body("mould", mould, Vector3(0.13, 0.06, 0.04), Vector3(0.16, 0, -0.1), false, true, 0.5)
	mb.set_meta("click", true)


func _setup_joint() -> void:
	var metal := _std(Color(0.35, 0.55, 0.3), 0.35, 0.7)
	var grinder := Node3D.new()
	_cyl(grinder, 0.03, 0.03, metal, Vector3(0, 0.015, 0))
	var lid := Node3D.new()
	lid.position = Vector3(0, 0.03, 0)
	grinder.add_child(lid)
	_cyl(lid, 0.031, 0.018, metal, Vector3(0, 0.009, 0))
	for k in 12:
		_boxm(lid, Vector3(0.003, 0.018, 0.004), metal, Vector3(cos(k * TAU / 12) * 0.031, 0.009, sin(k * TAU / 12) * 0.031), Vector3(0, -k * TAU / 12, 0))
	_obj["grinder_lid"] = lid
	_body("grinder", grinder, Vector3(0.062, 0.05, 0.062), Vector3(-0.2, 0, -0.1), false, true, 0.3)
	# The paper, flat on the rag.
	var paper_n := Node3D.new()
	var pl := Node3D.new()
	paper_n.add_child(pl)
	var pm := BoxMesh.new()
	pm.size = Vector3(0.1, 0.0008, 0.045)
	var pmat := load("res://scripts/player/cig_tex.gd").joint_mat().duplicate() as StandardMaterial3D
	_mesh(pl, pm, pmat, Vector3(0, 0.0004, 0))
	_boxm(pl, Vector3(0.1, 0.0009, 0.004), _std(Color(0.85, 0.8, 0.62), 0.6), Vector3(0, 0.0005, 0.02))
	_obj["paper_looks"] = pl
	var line := Node3D.new()
	line.position = Vector3(-0.045, 0.003, 0)
	paper_n.add_child(line)
	_boxm(line, Vector3(0.09, 0.005, 0.012), _std(Color(0.33, 0.38, 0.17), 1.0), Vector3(0.045, 0, 0))
	line.scale = Vector3(0.01, 1, 1)
	_obj["herb_line"] = line
	var rolled := Node3D.new()
	paper_n.add_child(rolled)
	rolled.position = Vector3(0, 0.006, 0)
	var rm := _cyl(rolled, 0.006, 0.1, _std(Color(0.95, 0.93, 0.86), 0.9), Vector3.ZERO, Vector3(0, 0, PI * 0.5), 0.0075)
	_obj["rolled_mesh"] = rm
	rolled.visible = false
	_obj["rolled"] = rolled
	var pb := _body("paper", paper_n, Vector3(0.1, 0.012, 0.045), Vector3(0.05, 0, 0.04), false, true, 0.01)
	pb.set_meta("click", true)
	_body("herb", _item_looks("herb", 0.08), Vector3(0.06, 0.07, 0.04), Vector3(0.26, 0, -0.08), true, false, 0.05)
	_obj["herb"].set_meta("top", 0.07)


func _done_grenade() -> void:
	pass


func _setup_molotov() -> void:
	# The bottle of spirit, standing; the rag in a heap beside it.
	var b := Node3D.new()
	var mdl: Node3D = load("res://scripts/weapons/molotov.gd").model()
	for c in mdl.get_children():
		# (without its rag: that goes in now)
		if c.has_meta("rag"):
			c.queue_free()
	b.add_child(mdl)
	var rag_in := Node3D.new()
	rag_in.position = Vector3(0, 0.27, 0)
	b.add_child(rag_in)
	_cyl(rag_in, 0.014, 0.05, _std(Color(0.72, 0.68, 0.6), 0.95), Vector3(0, 0.0, 0), Vector3.ZERO, 0.011)
	rag_in.visible = false
	_obj["rag_in"] = rag_in
	_body("bottle", b, Vector3(0.075, 0.29, 0.075), Vector3(0.02, 0, -0.06), false, true, 0.8)


func _enter_molotov0() -> void:
	var heap := Node3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.1, 0.015, 0.08)
	_mesh(heap, bm, _std(Color(0.72, 0.68, 0.6), 0.95), Vector3(0, 0.0075, 0))
	var hb := _body("rag_heap", heap, Vector3(0.1, 0.015, 0.08), Vector3(0.22, 0, 0.06), false, true, 0.05)
	var pin := Node3D.new()
	hb.add_child(pin)
	pin.position = Vector3(0, 0.012, 0)
	var end := Node3D.new()
	_boxm(end, Vector3(0.03, 0.01, 0.03), _std(Color(0.72, 0.68, 0.6), 0.95), Vector3(0, 0.005, 0))
	var e := _body("pull", end, Vector3(0.03, 0.012, 0.03), Vector3(0.14, 0, 0.08), true, false, 0.01)
	var bottle: Node3D = _obj["bottle"]
	_wires.clear()
	_wires.append({"start": pin, "end": e, "contact": bottle.global_transform * Vector3(0, 0.27, 0), "col": Color(0.72, 0.68, 0.6), "segs": [], "done": false})


func _enter_molotov1() -> void:
	(_obj["rag_in"] as Node3D).visible = true
	for w in _wires:
		for sg in w["segs"]:
			(sg as Node).queue_free()
		(w["end"] as Node).queue_free()
	_wires.clear()
	(_obj["rag_heap"] as Node).queue_free()


# --- Wires drawn as sagging cords ---------------------------------------------------------------

func _draw_wires() -> void:
	for w in _wires:
		var a: Vector3 = (w["start"] as Node3D).global_position
		if not is_instance_valid(w["end"]):
			continue
		var b: Vector3 = (w["end"] as Node3D).global_position
		var segs: Array = w["segs"]
		var n := 10
		if segs.is_empty():
			var m := _std(w["col"], 0.5)
			for i in n:
				var mi := MeshInstance3D.new()
				var cm := CylinderMesh.new()
				cm.top_radius = 0.0022
				cm.bottom_radius = 0.0022
				cm.height = 1.0
				cm.radial_segments = 6
				mi.mesh = cm
				mi.material_override = m
				add_child(mi)
				segs.append(mi)
			w["segs"] = segs
		var sag := maxf(0.06 - a.distance_to(b) * 0.1, 0.01)
		var mid := (a + b) * 0.5 + Vector3.DOWN * sag
		mid.y = maxf(mid.y, S.y + 0.003)
		var prev := a
		for i in n:
			var t := float(i + 1) / n
			var p := a.lerp(mid, t).lerp(mid.lerp(b, t), t)
			p.y = maxf(p.y, S.y + 0.003)
			var mi: MeshInstance3D = segs[i]
			var d := p - prev
			var l := maxf(d.length(), 0.0005)
			var y := d / l
			var x := y.cross(Vector3.UP if absf(y.y) < 0.95 else Vector3.RIGHT).normalized()
			# (stretched along its own length only)
			mi.global_transform = Transform3D(Basis(x, y * l, x.cross(y)), (prev + p) * 0.5)
			prev = p


# --- The words on screen ------------------------------------------------------------------------

func _pour_particles() -> CPUParticles3D:
	return _pour


func _build_pour() -> void:
	_pour = CPUParticles3D.new()
	_pour.emitting = false
	_pour.amount = 60
	_pour.lifetime = 0.5
	_pour.direction = Vector3.DOWN
	_pour.spread = 12.0
	_pour.initial_velocity_min = 0.05
	_pour.initial_velocity_max = 0.2
	_pour.gravity = Vector3(0, -6.0, 0)
	_pour.scale_amount_min = 0.6
	_pour.scale_amount_max = 1.2
	var bm := BoxMesh.new()
	bm.size = Vector3.ONE * 0.003
	var m := _std(Color(0.12, 0.12, 0.11), 0.9)
	bm.material = m
	_pour.mesh = bm
	add_child(_pour)


func _build_hud() -> void:
	_hud = CanvasLayer.new()
	_hud.layer = 20
	add_child(_hud)
	var font := ThemeDB.fallback_font
	_label = Label.new()
	_label.add_theme_font_size_override("font_size", 22)
	_label.add_theme_color_override("font_color", Color(1, 1, 1))
	_label.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	_label.add_theme_constant_override("outline_size", 6)
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	_label.offset_top = 24
	_label.add_theme_font_override("font", font)
	_hud.add_child(_label)
	_bar_bg = ColorRect.new()
	_bar_bg.color = Color(0, 0, 0, 0.5)
	_hud.add_child(_bar_bg)
	_bar = ColorRect.new()
	_bar.color = Color(0.9, 0.75, 0.3)
	_hud.add_child(_bar)
	_sub = Label.new()
	_sub.add_theme_font_size_override("font_size", 15)
	_sub.add_theme_color_override("font_color", Color(0.9, 0.9, 0.9, 0.85))
	_sub.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	_sub.add_theme_constant_override("outline_size", 4)
	_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_sub.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_sub.offset_top = -40
	_sub.text = "ЛКМ — взять и двигать   ·   ПКМ (держать) — наклонить   ·   Esc — отложить"
	_hud.add_child(_sub)


const TEXTS := {
	"pipe_bomb": ["Засыпь порох в трубу: возьми мешок, поднеси к открытому концу, наклони (ПКМ) и держи",
		"Надень крышку на открытый конец трубы, потом закручивай: крути мышью вокруг неё",
		"Поставь время: веди стрелку будильника мышью. Пробел — готово (%d с)",
		"Подключи провода: тащи каждый к контакту своего цвета на трубе",
		"Обмотай изолентой: крути мышью вокруг трубы"],
	"grenade": ["Засыпь гвозди в банку: возьми коробку, наклони (ПКМ) над банкой",
		"Засыпь порох поверх: мешок над банкой, наклони (ПКМ)",
		"Протяни шнур в банку: тащи конец шнура к её горлышку",
		"Прихвати крышку изолентой: крути мышью вокруг банки"],
	"bandage": ["Разрежь тряпку: возьми ножницы и веди их концом по каждой синей линии",
		"Смочи полосы спиртом: бутылку над ними, наклони (ПКМ)",
		"Скатай бинт: крути мышью вокруг полос"],
	"syringe": ["Отломи кончик ампулы: щёлкни по ней",
		"Набери лекарство: тяни поршень назад",
		"Выгони пузырьки: постучи по шприцу (щёлкай, 3 раза)"],
	"pills": ["Разотри мел с сахаром: крути мышью вокруг ступки",
		"Добавь краситель: пузырёк над ступкой, наклони (ПКМ)",
		"Спрессуй таблетки: щёлкай по прессу (5 раз)"],
	"molotov": ["Засунь тряпку в горлышко: тащи её конец к бутылке",
		"Закрути тряпку потуже: крути мышью вокруг горлышка"],
	"joint": ["Измельчи траву: крути мышью вокруг гриндера",
		"Насыпь траву на бумагу: пакет над бумагой, наклони (ПКМ)",
		"Скрути: води мышью влево-вправо (4 раза)",
		"Заклей край: щёлкни по самокрутке"],
}


func _say(t: String) -> void:
	_msg = t
	_msg_t = 2.5


func _update_hud(delta: float) -> void:
	_msg_t -= delta
	var texts: Array = TEXTS.get(rid, [])
	var t := ""
	if _finished_t >= 0.0:
		t = _msg
	elif _msg_t > 0.0:
		t = _msg
	elif step < texts.size():
		t = String(texts[step])
		if "%d" in t:
			t = t % int(fuse)
	_label.text = t
	var vs := get_viewport().get_visible_rect().size
	var w := 360.0
	_bar_bg.position = Vector2(vs.x * 0.5 - w * 0.5, 64)
	_bar_bg.size = Vector2(w, 6)
	_bar.position = _bar_bg.position
	var total := float((recipe["steps"] as Array).size())
	_bar.size = Vector2(w * clampf((step + prog) / total, 0.0, 1.0), 6)
