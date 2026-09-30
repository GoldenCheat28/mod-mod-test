extends Node3D
## Dev tool: exports the first-person smoking (smoking.gd) as glTF for
## animating elsewhere: the hands, the cigarette (or joint) and the lighter
## under the player's camera, with the whole thing recorded as animation -
## taking it out and lighting it, drags, holding it, flicking it away - plus
## a file of the bare models.
## Usage: godot --path . res://tests/export_cig.tscn --fixed-fps 30 -- <out_dir> [joint]

const Smoking = preload("res://scripts/player/smoking.gd")
const FPS := 30.0


class FakePlayer:
	extends Node3D
	var current = null
	var cam: Camera3D
	var velocity := Vector3.ZERO


var out := "user://cig_export"
var kind := "cigarette"
var _base := ""
var _root: Node3D
var _cam: Camera3D
var _sm: Node3D
var _t := 0.0
var _frames: Array = []          # per frame: {node path: [pos, quat, scale]}
var _marks: Array = []           # [time, state name]
var _last_state := -1
var _drags := 0
var _idle_t := 0.0
var _done := false
var _tracked := {}               # path -> node


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	if args.size() > 1:
		kind = args[1]
	# (each in its own folder: their textures have the same names)
	_base = out
	out = out.path_join(kind)
	DirAccess.make_dir_recursive_absolute(out)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.4, 0.42, 0.45)
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color(0.6, 0.6, 0.6)
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(-0.8, 0.5, 0)
	add_child(sun)
	_root = Node3D.new()
	_root.name = "Blood_Smoking_" + kind
	add_child(_root)
	_cam = Camera3D.new()
	_cam.name = "PlayerCamera"
	_cam.fov = 78.0
	_cam.near = 0.02
	_root.add_child(_cam)
	_cam.make_current()
	# Where the eye is: a small marker (a pyramid pointing the way it looks).
	var mark := MeshInstance3D.new()
	mark.name = "CAMERA_EYE_MARKER"
	var pm := PrismMesh.new()
	pm.size = Vector3(0.03, 0.03, 0.04)
	mark.mesh = pm
	mark.rotation = Vector3(-PI * 0.5, 0, 0)
	mark.position = Vector3(0, 0, 0.03)
	_cam.add_child(mark)
	var fp := FakePlayer.new()
	fp.cam = _cam
	add_child(fp)
	_sm = Smoking.new()
	_sm.name = "Smoking"
	_cam.add_child(_sm)
	_sm.setup(fp)
	_sm.start(kind)
	_name_parts()


func _name_parts() -> void:
	_sm._rhand.name = "RightHand"
	_sm._lhand.name = "LeftHand_Lighter"
	_sm._cig.name = "Cigarette" if kind == "cigarette" else "Joint"
	_sm._paper.name = "Paper"
	_sm._ember.name = "Ember"
	if _sm._char:
		_sm._char.name = "BurnRing"
	_sm._flame.name = "Flame"
	for n in [_sm._rhand, _sm._lhand, _sm._cig, _sm._paper, _sm._ember, _sm._char, _sm._flame]:
		if n:
			_tracked[String(_root.get_path_to(n))] = n
	_tracked[String(_root.get_path_to(_sm))] = _sm


func _process(delta: float) -> void:
	if _done:
		return
	_t += delta
	# Drive it through its whole routine: two drags, then away with it.
	var st: int = _sm.state
	if st != _last_state:
		_last_state = st
		_marks.append([_frames.size() / FPS, Smoking.S.keys()[st]])
	if st == Smoking.S.IDLE:
		_idle_t += delta
		if _idle_t > 1.6:
			_idle_t = 0.0
			if _drags < 2:
				_drags += 1
				_sm.drag_now()
			else:
				_sm.throw_now()
	var f := {}
	for path in _tracked:
		var n: Node3D = _tracked[path]
		var shown := n.visible and n.is_visible_in_tree()
		f[path] = [n.position, n.quaternion, n.scale if shown else Vector3.ONE * 0.0001]
	_frames.append(f)
	if st == Smoking.S.OFF and _frames.size() > 10 or _t > 60.0:
		_done = true
		_export()


func _export() -> void:
	# Loose things the routine left in the world (the flicked butt) go; the
	# particles do not export.
	for c in get_children():
		if c is RigidBody3D:
			c.queue_free()
	for p in _root.find_children("*", "GPUParticles3D", true, false):
		p.get_parent().remove_child(p)
		p.queue_free()
	for n in _root.find_children("*", "Node3D", true, false):
		if n.get_script() != null and n != _sm:
			n.get_parent().remove_child(n)
			n.queue_free()
	_sm.set_script(null)
	# (hidden-ness is in the animation, as scale: every node itself is shown)
	for n in _root.find_children("*", "Node3D", true, false):
		n.visible = true
	_sm.visible = true
	# The file's rest pose: the first frame where the hand is up.
	var rest: Dictionary = _frames[mini(int(4.5 * FPS), _frames.size() - 1)]
	for path in _tracked:
		var n: Node3D = _root.get_node(path)
		n.position = rest[path][0]
		n.quaternion = rest[path][1]
		n.scale = rest[path][2]
	# Show everything in its first frame's pose for the file.
	var ap := AnimationPlayer.new()
	ap.name = "AnimationPlayer"
	_root.add_child(ap)
	var lib := AnimationLibrary.new()
	lib.add_animation("full_sequence", _make_anim(0, _frames.size()))
	# One clip per part of it as well.
	for i in _marks.size():
		var from := int(float(_marks[i][0]) * FPS)
		var to := int(float(_marks[i + 1][0]) * FPS) if i + 1 < _marks.size() else _frames.size()
		if to - from < 2:
			continue
		var nm := "%02d_%s" % [i, String(_marks[i][1]).to_lower()]
		lib.add_animation(nm, _make_anim(from, to))
	ap.add_animation_library("", lib)
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_scene(_root, state)
	if err == OK:
		err = doc.write_to_filesystem(state, out.path_join("smoking_%s.gltf" % kind))
	print("export ", kind, ": ", error_string(err), " frames ", _frames.size(), " marks ", _marks)
	_write_readme()
	get_tree().quit()


func _make_anim(from: int, to: int) -> Animation:
	var a := Animation.new()
	a.length = (to - from) / FPS
	for path in _tracked:
		var tp := a.add_track(Animation.TYPE_POSITION_3D)
		var tr := a.add_track(Animation.TYPE_ROTATION_3D)
		var ts := a.add_track(Animation.TYPE_SCALE_3D)
		for tk in [tp, tr, ts]:
			a.track_set_path(tk, NodePath(path))
		for i in range(from, to):
			var v: Array = _frames[i][path]
			var t := (i - from) / FPS
			a.position_track_insert_key(tp, t, v[0])
			a.rotation_track_insert_key(tr, t, v[1])
			a.scale_track_insert_key(ts, t, v[2])
	return a


func _write_readme() -> void:
	var f := FileAccess.open(_base.path_join("README.txt"), FileAccess.WRITE)
	if f == null:
		return
	f.store_string("""Blood - first-person smoking, exported from the game (smoking.gd)

Files
  cigarette/smoking_cigarette.gltf  - hands, cigarette, lighter under the player's camera, animated
  joint/smoking_joint.gltf          - the same with a joint
  (the .bin files and the textures folder next to them belong to them -
   keep them together)

The camera
  The node PlayerCamera IS the player's eye. Everything is its child, in its
  space: it sits at the origin and looks down -Z, +Y is up, +X to the right.
  Field of view 78 degrees (vertical), near plane 2 cm.
  CAMERA_EYE_MARKER is a small pyramid at the eye pointing the way it looks,
  only so you can see where the camera is in Blender - it is not in the game.
  So: animate the hands in front of that camera, roughly 15-50 cm ahead of it
  and a little below (the cigarette at the mouth is ~5-8 cm below and in front).

Units and timing
  Metres. 30 frames per second.

Animations
  full_sequence  - the whole routine (15.7 s): hand comes up, lit with the
                   lighter, held, two drags, flicked away.
  01_raise, 02_light, 03_idle, 04_drag, 05_idle, 06_drag, 07_idle, 08_throw
                 - the same cut into its parts (numbered in the order they happen).

Nodes that move
  RightHand          - the hand with the cigarette between two fingers
  Cigarette / Joint  - held in RightHand; filter/crutch end at its origin, burning end towards -Z
  Paper              - shortens as it burns (its Z scale and position)
  Ember              - the glowing tip, moves back as the paper burns
  BurnRing           - the charred ring at the end of the paper (scale 0 = not lit yet)
  LeftHand_Lighter   - the other hand with the lighter; Flame above it (scale 0 = off)
  A scale of 0.0001 means the thing is hidden at that moment.
""")
	f.close()
