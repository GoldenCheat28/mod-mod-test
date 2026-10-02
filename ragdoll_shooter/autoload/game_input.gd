extends Node
## Регистрирует управление из кода, чтобы проект работал «из коробки».
## Если переназначишь действие в Project Settings → Input Map, код его не тронет.

const KEYS := {
	"move_forward": [KEY_W],
	"move_back": [KEY_S],
	"move_left": [KEY_A],
	"move_right": [KEY_D],
	"jump": [KEY_SPACE],
	"sprint": [KEY_SHIFT],
	"crouch": [KEY_CTRL, KEY_C],
	"interact": [KEY_E],
	"reload": [KEY_R],
	"spawn_bot": [KEY_B],
	"toggle_help": [KEY_F1],
}

const MOUSE := {
	"shoot": MOUSE_BUTTON_LEFT,
	"aim": MOUSE_BUTTON_RIGHT,
}


func _enter_tree() -> void:
	for action: String in KEYS:
		if InputMap.has_action(action):
			continue
		InputMap.add_action(action)
		for key: Key in KEYS[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = key
			InputMap.action_add_event(action, ev)
	for action: String in MOUSE:
		if InputMap.has_action(action):
			continue
		InputMap.add_action(action)
		var ev := InputEventMouseButton.new()
		ev.button_index = MOUSE[action]
		InputMap.action_add_event(action, ev)
