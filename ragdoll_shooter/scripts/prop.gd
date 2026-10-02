class_name Prop
extends RigidBody3D
## Физический предмет: можно взять на [E], пули его толкают и оставляют дырки.

## Материал для эффектов попадания: concrete, metal, wood, rubber.
@export_enum("concrete", "metal", "wood", "rubber") var surface := "wood"
@export var pickable := true


func _ready() -> void:
	collision_layer = 8                        # props
	collision_mask = 1 | 2 | 4 | 8 | 16        # world, player, bot, props, ragdoll
	if pickable:
		add_to_group("pickable")
	contact_monitor = true
	max_contacts_reported = 2
	body_entered.connect(_on_body_entered)


func _on_body_entered(_other: Node) -> void:
	var speed := linear_velocity.length()
	if speed > 1.2:
		var vol := linear_to_db(clampf(speed / 6.0 * clampf(mass / 10.0, 0.3, 1.5), 0.05, 1.0))
		Sfx.play_3d("impact_metal" if surface == "metal" else "thud", global_position, vol - 4.0, 0.15)
