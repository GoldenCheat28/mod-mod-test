extends MultiMeshInstance3D
## Sparks off a blast (explosion.gd): hundreds of tiny white-hot bits of
## metal and burning powder thrown out fast in every direction. Each is a
## real little body: it flies, drops, slows in the air, and bounces off
## whatever it meets - the floor, walls, cars - losing speed each time,
## sometimes breaking in two that fly apart; it cools from white through
## orange to a dull red and goes out. Drawn as a thin streak along its
## motion (as the eye sees something that bright and that fast), not as a
## flat card.

const SHADER := """
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled, skip_vertex_transform;

varying vec4 v_col;

void vertex() {
	// Instance transform: origin = the head of the streak, Y = the streak
	// itself (back along the motion), X length = its width.
	vec3 head = MODEL_MATRIX[3].xyz;
	vec3 axis = MODEL_MATRIX[1].xyz;
	float w = length(MODEL_MATRIX[0].xyz);
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	vec3 mid = head + axis * 0.5;
	vec3 to_eye = normalize(cam - mid);
	vec3 side = cross(axis, to_eye);
	float sl = length(side);
	side = sl > 1e-6 ? side / sl : normalize(INV_VIEW_MATRIX[0].xyz);
	// (a streak seen end-on still shows as a dot)
	vec3 along = length(axis) > 1e-5 ? axis : normalize(INV_VIEW_MATRIX[1].xyz) * w;
	vec3 wp = head + along * (VERTEX.y + 0.5) + side * VERTEX.x * w;
	VERTEX = (VIEW_MATRIX * vec4(wp, 1.0)).xyz;
	v_col = COLOR;
}

void fragment() {
	// Hot core along the middle, soft at the sides, the tail fading.
	float x = abs(UV.x - 0.5) * 2.0;
	float core = 1.0 - smoothstep(0.2, 1.0, x);
	float tail = mix(0.25, 1.0, 1.0 - UV.y);
	float a = core * tail * v_col.a;
	ALBEDO = v_col.rgb * a * 6.0;
	ALPHA = a;
}
"""

const MAX := 260

var _p: PackedVector3Array
var _v: PackedVector3Array
var _age: PackedFloat32Array
var _life: PackedFloat32Array
var _size: PackedFloat32Array
var _n := 0
var _t := 0.0
static var _mat: ShaderMaterial


static func burst(root: Node, pos: Vector3, power := 1.0) -> void:
	var s = load("res://scripts/fx/sparks.gd").new()
	root.add_child(s)
	s.global_position = Vector3.ZERO
	s._start(pos, power)


func _start(pos: Vector3, power: float) -> void:
	if _mat == null:
		_mat = ShaderMaterial.new()
		var sh := Shader.new()
		sh.code = SHADER
		_mat.shader = sh
	var q := QuadMesh.new()
	q.size = Vector2(1.0, 1.0)
	q.material = _mat
	multimesh = MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.use_colors = true
	multimesh.mesh = q
	multimesh.instance_count = MAX
	multimesh.visible_instance_count = 0
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	custom_aabb = AABB(pos - Vector3(30, 10, 30), Vector3(60, 40, 60))
	var count := mini(int((150 if Game.quality > 0 else 80) * power), MAX - 80)
	_p.resize(MAX)
	_v.resize(MAX)
	_age.resize(MAX)
	_life.resize(MAX)
	_size.resize(MAX)
	for i in count:
		# Thrown out every way, more of them sideways and up than into the
		# ground; a few very fast ones.
		var d := Vector3(randf_range(-1, 1), randf_range(-0.35, 1.0), randf_range(-1, 1)).normalized()
		var sp := randf_range(6.0, 18.0) * power * (2.0 if randf() < 0.1 else 1.0)
		_add(pos + d * randf_range(0.05, 0.3), d * sp, randf_range(0.35, 1.1), randf_range(0.005, 0.01))
	# ...and a slower lot, low: they skip and skitter over the ground round it.
	for i in int(count * 0.4):
		var d2 := Vector3(randf_range(-1, 1), randf_range(0.0, 0.5), randf_range(-1, 1)).normalized()
		_add(pos + d2 * 0.1, d2 * randf_range(2.0, 6.0) * power, randf_range(0.8, 1.8), randf_range(0.005, 0.009))


func _add(p: Vector3, v: Vector3, life: float, size: float) -> void:
	if _n >= MAX:
		return
	_p[_n] = p
	_v[_n] = v
	_age[_n] = 0.0
	_life[_n] = life
	_size[_n] = size
	_n += 1


func _physics_process(delta: float) -> void:
	_t += delta
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.new()
	q.collision_mask = Game.LAYER_WORLD | Game.LAYER_PROPS
	var i := 0
	while i < _n:
		_age[i] += delta
		if _age[i] >= _life[i]:
			# (gone out: its slot taken by the last one)
			_n -= 1
			_p[i] = _p[_n]
			_v[i] = _v[_n]
			_age[i] = _age[_n]
			_life[i] = _life[_n]
			_size[i] = _size[_n]
			continue
		var v := _v[i]
		v += Vector3.DOWN * 9.8 * delta
		v *= maxf(1.0 - 1.6 * delta, 0.0)           # (tiny: the air slows them hard)
		var from := _p[i]
		var to := from + v * delta
		q.from = from
		q.to = to
		var hit := space.intersect_ray(q)
		if not hit.is_empty():
			var n: Vector3 = hit.normal
			# Off it they go: most of the speed lost, flung off at an angle.
			var vn := v.dot(n)
			v = (v - n * vn * 1.45) * randf_range(0.45, 0.7)
			v += Vector3(randf_range(-1, 1), randf_range(-0.2, 1), randf_range(-1, 1)) * v.length() * 0.35
			to = (hit.position as Vector3) + n * 0.01
			# Some break in two, the halves flying apart.
			if randf() < 0.3 and v.length() > 2.0:
				var split := n.cross(Vector3(randf(), randf(), randf())).normalized()
				_add(to, v * 0.7 + split * v.length() * 0.5, (_life[i] - _age[i]) * 0.8, _size[i] * 0.7)
				v = v * 0.7 - split * v.length() * 0.5
				_size[i] *= 0.7
		_v[i] = v
		_p[i] = to
		i += 1
	if _n == 0 and _t > 0.3:
		queue_free()
		return
	multimesh.visible_instance_count = _n
	for k in _n:
		var k_age := _age[k] / _life[k]
		# White-hot, then yellow, orange, a dull red as it goes out.
		var c := Color(1.0, 0.78, 0.35).lerp(Color(1.0, 0.45, 0.08), smoothstep(0.0, 0.35, k_age)).lerp(Color(0.7, 0.12, 0.02), smoothstep(0.35, 1.0, k_age))
		c.a = 1.0 - smoothstep(0.7, 1.0, k_age)
		# The streak: as long as it moves in a short glimpse, back along its path.
		var tail := -_v[k] * 0.025
		var w := _size[k] * (1.0 - 0.4 * k_age)
		multimesh.set_instance_transform(k, Transform3D(Basis(Vector3(w, 0, 0), tail, Vector3(0, 0, w)), _p[k]))
		multimesh.set_instance_color(k, c)
