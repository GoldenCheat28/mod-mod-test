extends Node
## Dev test: first-person body (looking down, walking), Q ragdoll, and getting
## shot to death by bots (blood loss view, black screen). Also checks bots
## stumbling and getting up.

var out := "user://"
var t := 0.0
var _done := {}
var _log := 1.0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	add_child(load("res://scenes/main.tscn").instantiate())


func _physics_process(delta: float) -> void:
	t += delta
	if t > 30.0:
		get_tree().quit()
	var p = Game.player
	if p == null:
		return
	if t < 7.0:
		p.pitch = -1.0
		p.yaw = PI
	if _once("walk", 4.5):
		Input.action_press("move_forward")
	if _once("stop", 6.5):
		Input.action_release("move_forward")
	if _once("rag", 7.5):
		p.pitch = 0.0
		p._go_ragdoll()
	if _once("up", 12.0):
		p._get_up()
	if _once("wound", 13.0):
		# Two chest hits: heavy bleeding.
		for i in 2:
			p.hurt(p.global_position + Vector3.UP * 1.3, Vector3.FORWARD, "pistol")
		p.vitals.bleed = 120.0
	if t > _log:
		_log += 1.0
		if p.vitals:
			print("t=%.0f blood=%.0f bleed=%.1f conscious=%s alive=%s ragdoll=%s black=%.2f" % [t, p.vitals.blood, p.vitals.bleed, p.vitals.conscious, p.vitals.alive, p._ragdoll != null, p._black])


func _process(_d: float) -> void:
	_snap(4.2, "body_down")
	_snap(5.6, "body_walk")
	_snap(9.0, "ragdoll_view")
	_snap(14.0, "hurt_view")
	_snap(18.0, "bleeding_view")
	_snap(24.0, "dead_view")


func _snap(at: float, name_: String) -> void:
	if t >= at and not _done.has(name_):
		_done[name_] = true
		get_viewport().get_texture().get_image().save_png("%s/%s.png" % [out, name_])
		print("saved ", name_)


func _once(key: String, at: float) -> bool:
	if t < at or _done.has(key):
		return false
	_done[key] = true
	return true