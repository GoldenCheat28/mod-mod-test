extends Control
## Body-cam footage as it gets released: the faces blacked out. A flat black
## square on the screen over each face that is turned towards the camera and
## in plain view (from behind, or through a wall, nothing). It is drawn under
## the lens effect (its canvas layer is below post_fx.gd's), so the square
## bends with the picture like a real edit over the video.

const RANGE := 30.0

var _faces: Array = []           # [screen centre, half size] this frame
var _seen := {}                  # bot -> in plain view (checked a few times a second)
var _check_t := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	get_viewport().size_changed.connect(_fit)
	_fit()


func _fit() -> void:
	position = Vector2.ZERO
	size = get_viewport().get_visible_rect().size


func _process(delta: float) -> void:
	_faces.clear()
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		queue_redraw()
		return
	_check_t -= delta
	var recheck := _check_t <= 0.0
	if recheck:
		_check_t = 0.12
	var space := cam.get_world_3d().direct_space_state
	var eye := cam.global_position
	for b in Game.bots + _extra():
		if not is_instance_valid(b) or b.head == null or not is_instance_valid(b.head):
			continue
		var head: RigidBody3D = b.head
		var hx := head.global_transform
		var face := hx * (Vector3(0, -0.005, -0.075) * float(b.scale_factor))
		var to_cam := eye - face
		var d := to_cam.length()
		if d > RANGE or d < 0.15:
			continue
		# Turned towards the camera: the face's front, not the back of the head.
		var front := -hx.basis.z.normalized()
		if front.dot(to_cam / d) < 0.15:
			continue
		if not cam.is_position_in_frustum(face) or cam.is_position_behind(face):
			continue
		if recheck:
			var q := PhysicsRayQueryParameters3D.create(eye, face, Game.LAYER_WORLD | Game.LAYER_PROPS)
			_seen[b] = space.intersect_ray(q).is_empty()
		if not _seen.get(b, false):
			continue
		# The square covers the face: its width from the head's size there.
		var c := cam.unproject_position(face)
		var side := cam.unproject_position(face + cam.global_basis.x * 0.11 * float(b.scale_factor))
		var half := maxf(c.distance_to(side), 3.0)
		_faces.append([c + Vector2(0, -half * 0.1), half])
	queue_redraw()


## The trader and anyone else not in the crowd list.
func _extra() -> Array:
	var out: Array = []
	for n in get_tree().get_nodes_in_group(&"people_extra"):
		out.append(n)
	return out


func _draw() -> void:
	for f in _faces:
		var c: Vector2 = f[0]
		var h: float = f[1]
		draw_rect(Rect2(c - Vector2(h, h * 1.1), Vector2(h * 2.0, h * 2.2)), Color(0, 0, 0, 1))
