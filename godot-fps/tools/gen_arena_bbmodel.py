#!/usr/bin/env python3
"""Генерирует maps/arena.bbmodel для Blockbench (Generic Model). 1 м = 16 единиц Blockbench."""
import base64, json, random, struct, uuid, zlib, os

S = 16
SW = [  # палитра: 10 квадратов 16x16 (цвет можно перекрасить в Blockbench)
    (82, 84, 89), (140, 143, 133), (102, 102, 107), (115, 97, 77), (128, 128, 128),
    (140, 102, 56), (179, 38, 26), (38, 77, 153), (31, 33, 31), (255, 242, 217),
]
W, H = 16 * len(SW), 16

def png(w, h, rows):
    raw = b"".join(b"\x00" + bytes(sum(r, ())) if False else b"\x00" + b"".join(bytes(p) for p in r) for r in rows)
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

rows = [[SW[x // 16] for x in range(W)] for _ in range(H)]
tex_png = png(W, H, rows)

elements, groups = [], {}

def cube(group, name, center, size, sw, pivot_center=False):
    c = [v * S for v in center]; s = [v * S for v in size]
    frm = [c[i] - s[i] / 2 for i in range(3)]; to = [c[i] + s[i] / 2 for i in range(3)]
    uv = [16 * sw, 0, 16 * sw + 16, 16]
    u = str(uuid.uuid4())
    elements.append({
        "name": name, "box_uv": False, "rescale": False, "locked": False, "light_emission": 0,
        "render_order": "default", "allow_mirror_modeling": True,
        "from": frm, "to": to, "autouv": 0, "color": sw % 8,
        "origin": c if pivot_center else [0, 0, 0],
        "faces": {f: {"uv": uv, "texture": 0} for f in ("north", "east", "south", "west", "up", "down")},
        "type": "cube", "uuid": u})
    groups.setdefault(group, []).append(u)

H_ = 4.0
# оболочка
cube("shell", "floor", (0, -0.5, 0), (40, 1, 40), 0)
cube("shell", "ceiling", (0, H_ + 0.25, 0), (41, 0.5, 41), 2)
cube("shell", "wall_n", (0, H_ / 2, -20.25), (41, H_, 0.5), 1)
cube("shell", "wall_s", (0, H_ / 2, 20.25), (41, H_, 0.5), 1)
cube("shell", "wall_w", (-20.25, H_ / 2, 0), (0.5, H_, 40), 1)
cube("shell", "wall_e", (20.25, H_ / 2, 0), (0.5, H_, 40), 1)
# внутренние стены
cube("walls", "wall_in_1", (-8, H_ / 2, -6), (8, H_, 0.4), 1)
cube("walls", "wall_in_2", (8, H_ / 2, -6), (8, H_, 0.4), 1)
cube("walls", "wall_in_3", (-10, H_ / 2, 6), (0.4, H_, 12), 1)
cube("walls", "wall_in_4", (10, H_ / 2, 6), (0.4, H_, 12), 1)
# укрытия и колонны
cube("cover", "cover_1", (0, 0.6, 4), (6, 1.2, 0.5), 3)
cube("cover", "cover_2", (-14, 0.6, -4), (0.5, 1.2, 6), 3)
cube("cover", "cover_3", (14, 0.6, -3), (0.5, 1.2, 6), 3)
for i, p in enumerate([(-6, -12), (6, -12), (-14, 9), (14, 9), (0, -1)]):
    cube("pillars", f"pillar_{i+1}", (p[0], H_ / 2, p[1]), (1, H_, 1), 4)
# физические пропсы (prop_*): ящики, бочки, мусор
n = 0
for bx, bz in [(-16, 14), (15, 15), (-4, 16), (16, -17), (-17, 2)]:
    for dx, dy, dz in [(0, 0.5, 0), (1.1, 0.5, 0.2), (0.5, 1.5, 0.1)]:
        n += 1
        cube("props", f"prop_crate_{n}", (bx + dx, dy, bz + dz), (1, 1, 1), 5, True)
cube("props", "prop_crate_a", (5, 0.5, 8), (1, 1, 1), 5, True)
cube("props", "prop_crate_b", (-5, 0.4, 9), (0.8, 0.8, 0.8), 5, True)
for i, p in enumerate([(-18, 6), (-17, 7), (18, 4), (12, -1), (-12, 12), (3, 12), (19, -8)]):
    cube("props", f"prop_barrel_{i+1}", (p[0], 0.5, p[1]), (0.7, 1, 0.7), [6, 7, 6, 7, 6, 7, 6][i], True)
rnd = random.Random(42)
for i in range(14):
    x, z = rnd.uniform(-18, 18), rnd.uniform(-18, 18)
    if (x * x + (z - 10) ** 2) ** 0.5 < 3:
        continue
    cube("props", f"prop_trash_{i+1}", (x, 0.125, z), (0.45, 0.25, 0.35), 8, True)
# лампы (light_*)
k = 0
for x in (-12, 0, 12):
    for z in (-12, 0, 12):
        k += 1
        cube("lights", f"light_{k}", (x, H_ - 0.03, z), (2, 0.05, 0.6), 9)
# точки спавна (кубы удаляются при загрузке в игру)
cube("spawns", "spawn_player", (0, 1, 12), (0.5, 0.5, 0.5), 7, True)
for i, p in enumerate([(-12, -14), (-2, -16), (8, -15), (14, -10), (-14, -10), (3, -9)]):
    cube("spawns", f"spawn_enemy_{i+1}", (p[0], 1, p[1]), (0.5, 0.5, 0.5), 6, True)

outliner = [{"name": g, "origin": [0, 0, 0], "color": 0, "uuid": str(uuid.uuid4()), "export": True,
             "mirror_uv": False, "isOpen": g in ("shell", "walls"), "locked": False, "visibility": True,
             "autouv": 0, "children": ids} for g, ids in groups.items()]

model = {
    "meta": {"format_version": "4.10", "model_format": "free", "box_uv": False},
    "name": "arena", "model_identifier": "", "visible_box": [1, 1, 0],
    "variable_placeholders": "", "variable_placeholder_buttons": [], "timeline_setups": [],
    "unhandled_marked_keyframes": [], "resolution": {"width": W, "height": H},
    "elements": elements, "outliner": outliner,
    "textures": [{"path": "", "name": "palette.png", "folder": "", "namespace": "", "id": "0",
                  "width": W, "height": H, "uv_width": W, "uv_height": H, "particle": False,
                  "use_as_default": False, "layers_enabled": False, "sync_to_project": "",
                  "render_mode": "default", "render_sides": "auto", "frame_time": 1,
                  "frame_order_type": "loop", "frame_order": "", "frame_interpolate": False,
                  "visible": True, "internal": True, "saved": False, "uuid": str(uuid.uuid4()),
                  "source": "data:image/png;base64," + base64.b64encode(tex_png).decode()}],
}
out = os.path.join(os.path.dirname(__file__), "..", "maps", "arena.bbmodel")
json.dump(model, open(out, "w"), indent=1)
print("OK", len(elements), "кубов ->", os.path.normpath(out))
