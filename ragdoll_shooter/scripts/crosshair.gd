extends Control
## Прицел: зазор зависит от реального разброса оружия. Плюс хитмаркер.

var spread_deg := 1.0
var fov_deg := 78.0
var _hit_t := 0.0
var _hit_color := Color.WHITE


func hit(killed: bool, headshot: bool) -> void:
	_hit_t = 0.18 if not killed else 0.35
	_hit_color = Color(1, 0.2, 0.15) if killed else (Color(1, 0.85, 0.3) if headshot else Color.WHITE)


func _process(delta: float) -> void:
	_hit_t = maxf(_hit_t - delta, 0.0)
	queue_redraw()


func _draw() -> void:
	var h := get_viewport_rect().size.y
	var gap := tan(deg_to_rad(spread_deg)) / tan(deg_to_rad(fov_deg) * 0.5) * h * 0.5 + 3.0
	var len := 7.0
	var col := Color(1, 1, 1, 0.85)
	var shadow := Color(0, 0, 0, 0.5)
	for d: Vector2 in [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]:
		draw_line(d * gap + Vector2(1, 1), d * (gap + len) + Vector2(1, 1), shadow, 2.0)
		draw_line(d * gap, d * (gap + len), col, 2.0)
	draw_circle(Vector2.ZERO, 1.3, col)
	if _hit_t > 0.0:
		var c := _hit_color
		c.a = clampf(_hit_t * 6.0, 0.0, 1.0)
		for d: Vector2 in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			draw_line(d.normalized() * 6.0, d.normalized() * 14.0, c, 2.0)
