extends CharacterBody3D
# Анимации: добавь AnimationPlayer и клипы "idle", "run", "die" — скрипт запустит их сам.

@export var health := 100.0
@export var speed := 3.5
@export var melee_damage := 10.0
var target: Node3D
var dead := false
var attack_cd := 0.0
var gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")

func _ready() -> void:
	target = get_tree().get_first_node_in_group("player")

func take_damage(amount: float, point := Vector3.ZERO, normal := Vector3.UP) -> void:
	if dead:
		return
	if Blood.instance:
		Blood.instance.splash(point, normal)
	health -= amount
	if health <= 0.0:
		dead = true
		$CollisionShape3D.set_deferred("disabled", true)
		if get_node_or_null("AnimationPlayer"):
			_play("die")
		else:
			create_tween().tween_property(self, "rotation:x", -PI / 2.0, 0.5)
		get_tree().create_timer(6.0).timeout.connect(queue_free)

func _play(anim: String) -> void:
	var ap := get_node_or_null("AnimationPlayer") as AnimationPlayer
	if ap and ap.has_animation(anim) and ap.current_animation != anim:
		ap.play(anim)

func _physics_process(delta: float) -> void:
	if dead or target == null:
		return
	attack_cd -= delta
	if not is_on_floor():
		velocity.y -= gravity * delta
	var to := target.global_position - global_position
	to.y = 0
	if to.length() > 1.6:
		var d := to.normalized()
		velocity.x = d.x * speed
		velocity.z = d.z * speed
		look_at(global_position + d, Vector3.UP)
		_play("run")
	else:
		velocity.x = 0
		velocity.z = 0
		_play("idle")
		if attack_cd <= 0.0:
			attack_cd = 0.8
			target.take_damage(melee_damage)
	move_and_slide()
