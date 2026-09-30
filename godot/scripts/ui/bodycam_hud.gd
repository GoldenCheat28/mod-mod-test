extends Control
## What a cheap body camera burns into its picture: the blinking REC, the
## date and time, the unit's name, the battery and the signal - and, when the
## link comes and goes, CAM CONNECTED / CAM DISCONNECTED over the static.

const MONO := Color(0.93, 0.93, 0.9, 0.85)
const RED := Color(0.95, 0.12, 0.08, 0.95)

var _font: Font
var _t := 0.0
var _msg := ""
var _msg_t := 0.0
var _hold := false               # the message stays (disconnected)
var _battery := 0.0
var unit := "CAM-07"
var timelapse := false           # sped-up recording (sleeping)


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_font = ThemeDB.fallback_font
	get_viewport().size_changed.connect(_fit)
	_fit()
	_battery = randf_range(0.35, 0.95)
	unit = "CAM-%02d" % (randi() % 40 + 1)


func _fit() -> void:
	position = Vector2.ZERO
	size = get_viewport().get_visible_rect().size


func connected() -> void:
	_msg = "CAM CONNECTED"
	_msg_t = 2.4
	_hold = false


func disconnected() -> void:
	_msg = "CAM DISCONNECTED"
	_msg_t = 999.0
	_hold = true


func _process(delta: float) -> void:
	_t += delta / maxf(Engine.time_scale, 0.05)
	if not _hold:
		_msg_t -= delta / maxf(Engine.time_scale, 0.05)
	_battery = maxf(_battery - delta * 0.00008, 0.05)
	queue_redraw()


func _draw() -> void:
	var vs := size
	var s := clampf(vs.y / 1080.0, 0.6, 2.0)
	var fs := int(22 * s)
	var m := Vector2(70, 58) * s
	if not _hold:
		# REC, blinking once a second.
		if fmod(_t, 1.0) < 0.6:
			draw_circle(m + Vector2(9, -7) * s, 8.0 * s, RED, true, -1.0, true)
		draw_string(_font, m + Vector2(24, 0) * s, "REC", HORIZONTAL_ALIGNMENT_LEFT, -1, fs, MONO)
		if timelapse:
			draw_string(_font, m + Vector2(90, 0) * s, "TIMELAPSE  x60  ▶▶", HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1.0, 0.85, 0.3, 0.9))
		var d := Time.get_datetime_dict_from_system()
		var stamp := "%04d-%02d-%02d  %02d:%02d:%02d" % [d.year, d.month, d.day, d.hour, d.minute, d.second]
		var sw := _font.get_string_size(stamp, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string(_font, Vector2(vs.x - m.x - sw, m.y), stamp, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, MONO)
		draw_string(_font, Vector2(m.x, vs.y - m.y + 10 * s), unit + "   1080P 30FPS   EIS OFF", HORIZONTAL_ALIGNMENT_LEFT, -1, int(17 * s), Color(MONO, 0.7))
		# Battery: a box with its level in bars.
		var b := Rect2(Vector2(vs.x - m.x - 46 * s, vs.y - m.y - 8 * s), Vector2(40, 18) * s)
		draw_rect(b, MONO, false, 2.0 * s)
		draw_rect(Rect2(b.end - Vector2(0, b.size.y * 0.7), Vector2(4, 8) * s), MONO)
		var bars := ceili(_battery * 4.0)
		for i in bars:
			draw_rect(Rect2(b.position + Vector2(4 + i * 9, 4) * s, Vector2(6, 10) * s), RED if bars <= 1 else MONO)
		# Signal: rising bars.
		for i in 4:
			var h := (5 + i * 4) * s
			draw_rect(Rect2(Vector2(vs.x - m.x - 100 * s + i * 8 * s, vs.y - m.y + 10 * s - h), Vector2(5 * s, h)), Color(MONO, 0.8 if i < 3 else 0.3))
	if _msg_t > 0.0 and _msg != "":
		var big := int(46 * s)
		var w := _font.get_string_size(_msg, HORIZONTAL_ALIGNMENT_LEFT, -1, big).x
		var a := clampf(_msg_t, 0.0, 1.0)
		if not _hold and fmod(_t, 0.5) < 0.12:
			a *= 0.4
		var p := Vector2(vs.x * 0.5 - w * 0.5, vs.y * 0.5 + big * 0.35)
		draw_rect(Rect2(p + Vector2(-24, -big - 6) * Vector2(1, 1), Vector2(w + 48, big + 26)), Color(0, 0, 0, 0.55 * a))
		draw_string(_font, p, _msg, HORIZONTAL_ALIGNMENT_LEFT, -1, big, Color(1, 1, 1, a))
