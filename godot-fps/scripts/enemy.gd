extends CharacterBody3D
# Анимации: добавь AnimationPlayer и клипы "idle", "run", "die" — скрипт сам их запустит.

@export var health := 100.0
@export var speed := 3.5
var target: Node3D
var dead := false
var gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")

func _ready() -> void:
	target = get_tree().get_first_node_in_group("player")

func take_damage(amount: float) -> void:
	if dead: return
	health -= amount
	if health <= 0.0:
		dead = true
		_play("die")
		$CollisionShape3D.set_deferred("disabled", true)
		get_tree().create_timer(3.0).timeout.connect(queue_free)

func _play(anim: String) -> void:
	var ap := get_node_or_null("AnimationPlayer") as AnimationPlayer
	if ap and ap.has_animation(anim) and ap.current_animation != anim:
		ap.play(anim)

func _physics_process(delta: float) -> void:
	if dead or target == null: return
	if not is_on_floor():
		velocity.y -= gravity * delta
	var to := target.global_position - global_position
	to.y = 0
	if to.length() > 1.8:
		var d := to.normalized()
		velocity.x = d.x * speed
		velocity.z = d.z * speed
		look_at(global_position + d, Vector3.UP)
		_play("run")
	else:
		velocity.x = 0
		velocity.z = 0
		_play("idle")
	move_and_slide()
