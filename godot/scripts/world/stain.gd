extends "res://scripts/world/graffiti.gd"
## Dirt on a wall or a floor, as a patch like a graffiti one (graffiti.gd):
## soot above where a fire was, mud splashed up the foot of a wall, grime
## running down in streaks, rust weeping from an old bracket, muddy boot
## prints and old oil on a floor. It can be scrubbed off (the sponge, the
## mop) and whoever cleans it gets a little for it (`reward`).

const KINDS_WALL := ["soot", "mud", "grime", "rust"]
const KINDS_FLOOR := ["mud_floor", "prints", "oil"]


## Makes one: at `point` on a surface facing `normal`, `extent` across.
static func make(parent: Node, point: Vector3, normal: Vector3, extent: Vector2, kind: String, seed_v: int) -> Node3D:
	var s = load("res://scripts/world/stain.gd").new()
	parent.add_child(s)
	var G = load("res://scripts/world/graffiti.gd")
	G.from_net = true                  # (the level makes the same ones everywhere)
	s.setup(point, normal, extent)
	G.from_net = false
	s._paint_dirt(kind, seed_v)
	s.reward = {"soot": 12, "mud": 8, "grime": 10, "rust": 14, "mud_floor": 6, "prints": 5, "oil": 15}.get(kind, 8)
	s.dirt_kind = kind
	Net.register_stain(s)
	return s


func _paint_dirt(kind: String, seed_v: int) -> void:
	var w := img.get_width()
	var h := img.get_height()
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_v
	var n := FastNoiseLite.new()
	n.seed = seed_v
	n.frequency = 0.035
	n.fractal_octaves = 4
	var fine := FastNoiseLite.new()
	fine.seed = seed_v + 1
	fine.frequency = 0.25
	match kind:
		"soot", "mud", "grime", "mud_floor", "oil":
			var col: Color = {"soot": Color(0.05, 0.045, 0.04), "mud": Color(0.2, 0.15, 0.09), "grime": Color(0.12, 0.11, 0.08),
					"mud_floor": Color(0.22, 0.16, 0.1), "oil": Color(0.03, 0.03, 0.035)}[kind]
			for y in h:
				for x in w:
					var u := float(x) / w
					var v := float(y) / h            # 0 top .. 1 bottom
					var e := smoothstep(0.0, 0.2, u) * smoothstep(0.0, 0.2, 1.0 - u) * smoothstep(0.0, 0.2, v) * smoothstep(0.0, 0.2, 1.0 - v)
					var b := n.get_noise_2d(x, y) * 0.5 + 0.5
					var f := fine.get_noise_2d(x, y) * 0.5 + 0.5
					var a := 0.0
					match kind:
						"soot":
							# Thickest low in the middle, rising in a plume.
							var plume := 1.0 - absf(u - 0.5) * 2.0 * (0.4 + 0.6 * v)
							a = clampf((b * 1.2 + plume * 0.8 - 0.9) * 1.6, 0.0, 0.92) * (0.3 + 0.7 * v)
						"mud":
							# Splashed up from the ground: dense at the bottom, spots higher up.
							a = clampf((b * 1.1 - 0.35) * 2.0, 0.0, 0.9) * smoothstep(0.35, 1.0, v)
							if f > 0.83 and rng.randf() < 0.3:
								a = maxf(a, 0.8 * v)
						"grime":
							# Streaks running down.
							var streak := sin(u * 55.0 + b * 4.0) * 0.5 + 0.5
							a = clampf((streak * 0.9 + b * 0.6 - 0.8) * 1.5, 0.0, 0.75) * (0.4 + 0.6 * v)
						"mud_floor":
							a = clampf((b * 1.3 - 0.5) * 2.2, 0.0, 0.85)
						"oil":
							a = clampf((b * 1.4 - 0.45) * 3.0, 0.0, 0.88)
					a *= e * (0.75 + 0.25 * f)
					if a > 0.01:
						img.set_pixel(x, y, Color(col.r * (0.8 + 0.4 * f), col.g * (0.8 + 0.4 * f), col.b * (0.8 + 0.4 * f), a))
		"rust":
			# Weeping down from a few points near the top.
			var col := Color(0.42, 0.2, 0.08)
			for k in rng.randi_range(2, 4):
				var x0 := rng.randf_range(0.2, 0.8) * w
				var len := rng.randf_range(0.5, 0.95) * h
				var wide := rng.randf_range(3.0, 8.0)
				for y in int(len):
					var t := float(y) / len
					var half := wide * (1.0 - t * 0.7)
					var xc := x0 + sin(y * 0.08 + k) * 2.0
					for x in range(int(xc - half), int(xc + half) + 1):
						if x >= 0 and x < w and y + 4 < h:
							var a := (1.0 - absf(x - xc) / half) * (1.0 - t) * 0.85
							var old := img.get_pixel(x, y + 4)
							img.set_pixel(x, y + 4, Color(col.r, col.g, col.b, maxf(old.a, a)))
		"prints":
			# Muddy boot prints walking across.
			var col := Color(0.18, 0.13, 0.08)
			var along := Vector2(1, rng.randf_range(-0.3, 0.3)).normalized()
			var side := Vector2(-along.y, along.x)
			for k in 6:
				var c := Vector2(w * 0.12, h * 0.5) + along * (k * w * 0.15) + side * (12.0 if k % 2 == 0 else -12.0)
				for y in range(-16, 17):
					for x in range(-9, 10):
						var p := c + along * y + side * x
						var inside := (float(x * x) / 64.0 + float(y * y) / 225.0) < 1.0
						if inside and p.x >= 0 and p.y >= 0 and p.x < w and p.y < h and (fine.get_noise_2d(p.x, p.y) > -0.2 or absi(y) % 4 < 2):
							img.set_pixel(int(p.x), int(p.y), Color(col.r, col.g, col.b, 0.8 * (1.0 - k * 0.1)))
	img.generate_mipmaps()
	tex.update(img)
