extends Node
## Dev test: another player's body (remote_player.gd) fed the local
## player's own state, 1.6 m to the side: standing with a pistol, walking,
## crouching, then shot twice. Screenshots from the side.

const RemotePlayer = preload("res://scripts/net/remote_player.gd")

var t := -3.0
var pup: Node3D
var _view: Camera3D
var _snaps := {}


func _ready() -> void:
	add_child(load("res://scenes/main.tscn").instantiate())


func _snap(n: String) -> void:
	get_viewport().get_texture().get_image().save_png("user://mirror_%s.png" % n)
	print("snap ", n)


func _process(delta: float) -> void:
	t += delta
	if t > 12.0:
		get_tree().quit()
	var p = Game.player
	if p == null or Game.main == null:
		return
	if pup == null:
		p.global_position = Vector3(3.0, 0.2, 12.0)
		p.yaw = 0.0
		for b in Game.bots:
			b.ai.process_mode = Node.PROCESS_MODE_DISABLED
		pup = RemotePlayer.new()
		pup.peer = 7
		pup.display_name = "bnzimfps9"
		Game.main.add_child(pup)
		_view = Camera3D.new()
		add_child(_view)
		return
	var st: PackedFloat32Array = p.net_state()
	if st.size() < 31:
		return
	# (1.6 m to the right of the player)
	var off := Vector3(1.6, 0, 0)
	for i in [0, 9, 12, 25]:
		if is_finite(st[i]):
			st[i] += off.x
	pup.apply(st)
	_view.make_current()
	var c: Vector3 = p.global_position + off
	_view.global_position = c + Vector3(2.6, 1.2, 1.2)
	_view.look_at(c + Vector3(0, 0.9, 0))
	# Standing, then walking, then crouching.
	if t > 3.0 and t < 6.0:
		Input.action_press("move_forward")
	else:
		Input.action_release("move_forward")
	if t > 6.5 and t < 8.5:
		Input.action_press("crouch")
	else:
		Input.action_release("crouch")
	if t > 9.0 and not _snaps.has("hit"):
		_snaps["hit"] = true
		var h = pup._h
		pup.wound(h.parts.find(h.chest), Vector3(0.05, 0.05, -0.13), Vector3(0, 0, 1), "pistol")
		pup.wound(h.parts.find(h.parts[h.part_index["thigh_r"]]), Vector3(0.0, 0.05, -0.07), Vector3(0, 0, 1), "pistol")
	for s in [[2.5, "stand"], [4.6, "walk"], [8.0, "crouch"], [11.5, "hit"]]:
		if t >= s[0] and not _snaps.has(s[1] + "_s"):
			_snaps[s[1] + "_s"] = true
			_snap(s[1])
