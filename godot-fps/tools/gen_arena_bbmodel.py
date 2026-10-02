#!/usr/bin/env python3
"""Генерирует карту-склад: maps/layout.json (читает игра) и maps/arena.bbmodel (для Blockbench).
1 м = 16 единиц Blockbench. Запуск: python3 tools/gen_arena_bbmodel.py"""
import base64, json, math, os, random, struct, uuid, zlib

S = 16
HERE = os.path.dirname(os.path.abspath(__file__))
MATS = ["concrete", "concrete_wall", "brick", "plaster", "roof", "tile", "metal_floor", "steel", "pipe",
        "wood", "crate", "pallet", "carton", "barrel_red", "barrel_blue", "barrel_green", "container_red",
        "container_blue", "container_green", "bag", "can", "cabinet", "jersey", "window", "panel"]
COL = {"concrete": (117, 117, 115), "concrete_wall": (148, 145, 138), "brick": (128, 56, 41), "plaster": (189, 184, 166),
       "roof": (82, 82, 84), "tile": (158, 163, 158), "metal_floor": (102, 107, 112), "steel": (56, 64, 71),
       "pipe": (140, 77, 31), "wood": (128, 92, 51), "crate": (140, 102, 56), "pallet": (158, 128, 77),
       "carton": (158, 122, 77), "barrel_red": (158, 31, 20), "barrel_blue": (31, 64, 140), "barrel_green": (51, 107, 46),
       "container_red": (140, 36, 26), "container_blue": (33, 64, 122), "container_green": (46, 92, 51),
       "bag": (20, 23, 20), "can": (166, 166, 173), "cabinet": (97, 107, 102), "jersey": (140, 140, 135),
       "window": (140, 184, 242), "panel": (255, 242, 217)}

items = []   # {n,k,s,p,z,r,m,g}

def add(g, n, k, p, z, m, s="box", r=(0, 0, 0)):
    items.append({"n": n, "k": k, "s": s, "p": [round(v, 3) for v in p], "z": [round(v, 3) for v in z],
                  "r": list(r), "m": m, "g": g})

H = 6.0
HW, HD = 40.0, 30.0   # зал 80 x 60

# ---------- оболочка ----------
add("shell", "floor", "static", (0, -0.5, 0), (80, 1, 60), "concrete")
add("shell", "ceiling", "static", (0, H + 0.25, 0), (81, 0.5, 61), "roof")
add("shell", "wall_n", "static", (0, H / 2, -HD - 0.25), (81, H, 0.5), "brick")
add("shell", "wall_s", "static", (0, H / 2, HD + 0.25), (81, H, 0.5), "brick")
add("shell", "wall_w", "static", (-HW - 0.25, H / 2, 0), (0.5, H, 60), "brick")
add("shell", "wall_e", "static", (HW + 0.25, H / 2, 0), (0.5, H, 60), "brick")
# плинтус по периметру и «окна» под потолком
for i, (p, z) in enumerate([((0, 0.15, -HD + 0.1), (80, 0.3, 0.2)), ((0, 0.15, HD - 0.1), (80, 0.3, 0.2)),
                            ((-HW + 0.1, 0.15, 0), (0.2, 0.3, 60)), ((HW - 0.1, 0.15, 0), (0.2, 0.3, 60))]):
    add("details", f"nocol_base_{i}", "nocol", p, z, "concrete_wall")
for i, x in enumerate(range(-32, 33, 16)):
    add("details", f"nocol_window_n{i}", "nocol", (x, 4.6, -HD + 0.02), (5, 1.0, 0.06), "window")
    add("details", f"nocol_window_s{i}", "nocol", (x, 4.6, HD - 0.02), (5, 1.0, 0.06), "window")

# ---------- потолочные балки и трубы (без коллизии) ----------
for i, x in enumerate((-32, -16, 0, 16, 32)):
    add("beams", f"nocol_beam_{i}", "nocol", (x, H - 0.3, 0), (0.5, 0.6, 60), "steel")
for i, z in enumerate((-20, -6, 8, 22)):
    add("beams", f"nocol_cross_{i}", "nocol", (0, H - 0.75, z), (80, 0.35, 0.4), "steel")
for i, (y, z) in enumerate([(5.0, -29.4), (4.6, 29.4)]):
    add("beams", f"nocol_pipe_{i}", "nocol", (0, y, z), (80, 0.3, 0.3), "pipe")
add("beams", "nocol_pipe_w", "nocol", (-39.4, 4.4, 0), (0.3, 0.3, 60), "pipe")

# ---------- колонны ----------
for i, p in enumerate([(-16, -6), (0, -6), (16, -6), (-16, 8), (0, 8), (16, 8), (-30, 6), (30, -8), (-8, 22), (24, 22)]):
    add("pillars", f"pillar_{i+1}", "static", (p[0], H / 2, p[1]), (0.8, H, 0.8), "concrete")
    add("pillars", f"nocol_pillar_base_{i+1}", "nocol", (p[0], 0.5, p[1]), (1.0, 1.0, 1.0), "concrete_wall")

def room(g, x0, z0, x1, z1, h, doors, mat="plaster", floor="tile"):
    """Комната со стенами, дверными проёмами, перемычками, потолком и плиткой.
    doors: список (сторона 'n|s|e|w', центр вдоль стены, ширина)"""
    t = 0.3
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    add(g, f"nocol_floor_{g}", "nocol", (cx, 0.005, cz), (x1 - x0, 0.01, z1 - z0), floor)
    add(g, f"ceiling_{g}", "static", (cx, h + 0.1, cz), (x1 - x0 + t, 0.2, z1 - z0 + t), "plaster")
    for side in "nsew":
        if side in "ns":
            z = z0 if side == "n" else z1
            a0, a1 = x0 - t / 2, x1 + t / 2
        else:
            x = x0 if side == "w" else x1
            a0, a1 = z0 - t / 2, z1 + t / 2
        cuts = sorted([(c - w / 2, c + w / 2) for sd, c, w in doors if sd == side])
        cur = a0
        segs = []
        for lo, hi in cuts:
            segs.append((cur, lo))
            cur = hi
        segs.append((cur, a1))
        for j, (lo, hi) in enumerate(segs):
            if hi - lo < 0.05:
                continue
            m = (lo + hi) / 2
            if side in "ns":
                add(g, f"wall_{g}_{side}{j}", "static", (m, h / 2, z), (hi - lo, h, t), mat)
            else:
                add(g, f"wall_{g}_{side}{j}", "static", (x, h / 2, m), (t, h, hi - lo), mat)
        for lo, hi in cuts:   # перемычка над дверью
            m = (lo + hi) / 2
            lint_h = h - 2.2
            if side in "ns":
                add(g, f"wall_{g}_lintel_{side}", "static", (m, 2.2 + lint_h / 2, z), (hi - lo, lint_h, t), mat)
                add(g, f"nocol_frame_{g}_{side}", "nocol", (m, 1.1, z), (hi - lo + 0.2, 2.2, t + 0.06), "wood")
            else:
                add(g, f"wall_{g}_lintel_{side}", "static", (x, 2.2 + lint_h / 2, m), (t, lint_h, hi - lo), mat)
                add(g, f"nocol_frame_{g}_{side}", "nocol", (x, 1.1, m), (t + 0.06, 2.2, hi - lo + 0.2), "wood")
    add(g, f"light_{g}_1", "light", (cx - 3, h - 0.03, cz), (1.6, 0.05, 0.5), "panel")
    add(g, f"light_{g}_2", "light", (cx + 3, h - 0.03, cz), (1.6, 0.05, 0.5), "panel")

# ---------- офис (северо-запад) ----------
room("office", -40, -30, -22, -14, 3.4, [("s", -31, 2.2), ("e", -22, 2.2)])
for i, (x, z) in enumerate([(-37, -28), (-33, -28), (-37, -24)]):
    add("office", f"desk_{i+1}", "static", (x, 0.38, z), (1.6, 0.76, 0.8), "wood")
    add("office", f"prop_chair_{i+1}", "prop", (x, 0.45, z + 0.9), (0.45, 0.9, 0.45), "steel")
for i, z in enumerate((-29.4, -28.4, -27.4)):
    add("office", f"cabinet_{i+1}", "static", (-39.4, 0.9, z), (0.6, 1.8, 0.9), "cabinet")

# ---------- склад (юго-восток) ----------
room("storage", 22, 12, 40, 30, 3.6, [("w", 21, 2.2), ("n", 31, 2.2)], mat="concrete_wall", floor="concrete")
def rack(g, x, z, length, along="x"):
    for lv, y in enumerate((0.4, 1.3, 2.2)):
        sz = (length, 0.06, 0.9) if along == "x" else (0.9, 0.06, length)
        add(g, f"rack_shelf_{x}_{z}_{lv}", "static", (x, y, z), sz, "steel")
    for k in range(int(length // 2) + 1):
        o = -length / 2 + k * (length / max(1, int(length // 2)))
        p = (x + o, 1.4, z) if along == "x" else (x, 1.4, z + o)
        add(g, f"rack_post_{x}_{z}_{k}", "static", p, (0.08, 2.8, 0.08) if along == "x" else (0.08, 2.8, 0.08), "steel")
    rng = random.Random(int(abs(x * 31 + z * 17)))
    for lv, y in enumerate((0.66, 1.56)):
        for k in range(int(length // 1.1)):
            o = -length / 2 + 0.7 + k * 1.1
            p = (x + o, y, z) if along == "x" else (x, y, z + o)
            add(g, f"carton_{x}_{z}_{lv}_{k}", "static", p, (0.8, 0.45, 0.6), "carton")
rack("storage", 30, 16, 8)
rack("storage", 30, 20, 8)
rack("storage", 30, 26, 8)

# ---------- контейнеры в центре-востоке ----------
add("containers", "container_1", "static", (14, 1.3, -22), (12, 2.6, 2.4), "container_red")
add("containers", "container_2", "static", (14, 1.3, -17.5), (12, 2.6, 2.4), "container_blue")
add("containers", "container_3", "static", (16, 3.9, -22), (12, 2.6, 2.4), "container_green")
add("containers", "container_4", "static", (28, 1.3, -4), (2.4, 2.6, 12), "container_blue")
add("containers", "container_5", "static", (-26, 1.3, 14), (12, 2.6, 2.4), "container_red")

# ---------- мостик с пандусом ----------
add("catwalk", "catwalk_deck", "static", (-2, 2.9, -27), (24, 0.2, 4), "metal_floor")
for i, x in enumerate((-12, -2, 8)):
    add("catwalk", f"catwalk_post_{i}", "static", (x, 1.45, -25.2), (0.3, 2.9, 0.3), "steel")
for i in range(0, 25):
    add("catwalk", f"nocol_rail_post_{i}", "nocol", (-14 + i, 3.5, -25.1), (0.05, 1.0, 0.05), "steel")
add("catwalk", "nocol_rail_top", "nocol", (-2, 4.0, -25.1), (24, 0.06, 0.06), "steel")
add("catwalk", "nocol_rail_mid", "nocol", (-2, 3.5, -25.1), (24, 0.05, 0.05), "steel")
ang = math.degrees(math.atan2(3.0, 7.5))
add("catwalk", "ramp", "static", (13.4, 1.4, -27), (8.2, 0.2, 3), "metal_floor", r=(0, 0, -ang))

# ---------- укрытия ----------
for i, (p, ry) in enumerate([((-6, 0.4, 14), 0), ((6, 0.4, 14), 0), ((0, 0.4, 0), 90), ((-18, 0.4, -4), 20),
                             ((18, 0.4, 4), -15), ((-4, 0.4, -14), 0)]):
    add("cover", f"jersey_{i+1}", "static", p, (2.4, 0.8, 0.6), "jersey", r=(0, ry, 0))

# ---------- физические пропсы ----------
n = 0
for bx, bz in [(-30, 20), (36, -22), (-6, 26), (8, 18), (-12, -12), (32, 2)]:
    for dx, dy, dz in [(0, 0.5, 0), (1.1, 0.5, 0.2), (0.5, 1.5, 0.1)]:
        n += 1
        add("props", f"prop_crate_{n}", "prop", (bx + dx, dy, bz + dz), (1, 1, 1), "crate")
for i, (px, pz) in enumerate([(-3, -12), (4, 4), (-22, 4), (20, -10), (-34, -4)]):
    add("props", f"prop_pallet_{i+1}", "prop", (px, 0.08, pz), (1.2, 0.16, 1.0), "pallet")
    for k in range(3):
        add("props", f"prop_carton_{i+1}_{k}", "prop", (px + (k - 1) * 0.3, 0.4 + 0.0, pz), (0.55, 0.45, 0.6), "carton")
barrel_mats = ["barrel_red", "barrel_blue", "barrel_green"]
bp = [(-36, 8), (-35, 9), (-37, 9), (34, -12), (35, -11), (-18, 22), (2, -22), (-24, -8), (26, 8),
      (38, 4), (-8, -26), (22, 4), (-2, 12), (12, 26), (-28, 28), (16, -2)]
for i, (px, pz) in enumerate(bp):
    add("props", f"prop_barrel_{i+1}", "prop", (px, 0.5, pz), (0.7, 1.0, 0.7), barrel_mats[i % 3], s="cylinder")
rnd = random.Random(42)
for i in range(30):
    x, z = rnd.uniform(-38, 38), rnd.uniform(-28, 28)
    if abs(x) < 4 and z > 18:
        continue
    add("props", f"prop_trash_{i+1}", "prop", (x, 0.125, z), (0.45, 0.25, 0.35), "bag")
for i in range(26):
    x, z = rnd.uniform(-38, 38), rnd.uniform(-28, 28)
    if abs(x) < 4 and z > 18:
        continue
    add("props", f"prop_can_{i+1}", "prop", (x, 0.06, z), (0.1, 0.12, 0.1), "can", s="cylinder")

# ---------- освещение зала ----------
k = 0
for x in (-30, -15, 0, 15, 30):
    for z in (-18, 0, 18):
        k += 1
        add("lights", f"light_{k}", "light", (x, H - 0.45, z), (2.2, 0.06, 0.6), "panel")

# ---------- спавны ----------
add("spawns", "spawn_player", "spawn", (0, 1, 24), (0.5, 0.5, 0.5), "panel")
for i, p in enumerate([(-31, 1, -22), (-30, 1, 0), (-20, 1, -6), (4, 1, -10), (22, 1, 0), (31, 1, 22), (0, 3.1, -27), (-26, 1, 22)]):
    add("spawns", f"spawn_enemy_{i+1}", "spawn", p, (0.5, 0.5, 0.5), "barrel_red")

# ================= layout.json =================
json.dump({"height": H, "items": items}, open(os.path.join(HERE, "..", "maps", "layout.json"), "w"))

# ================= bbmodel =================
SWN = len(MATS)
W, Hh = 16 * SWN, 16
def png(w, h, rows):
    raw = b"".join(b"\x00" + b"".join(bytes(px) for px in r) for r in rows)
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
tex_png = png(W, Hh, [[COL[MATS[x // 16]] for x in range(W)] for _ in range(Hh)])

elements, groups = [], {}
for it in items:
    c = [v * S for v in it["p"]]; sz = [v * S for v in it["z"]]
    sw = MATS.index(it["m"])
    uv = [16 * sw, 0, 16 * sw + 16, 16]
    u = str(uuid.uuid4())
    el = {"name": it["n"], "box_uv": False, "rescale": False, "locked": False, "light_emission": 0,
          "render_order": "default", "allow_mirror_modeling": True,
          "from": [c[i] - sz[i] / 2 for i in range(3)], "to": [c[i] + sz[i] / 2 for i in range(3)],
          "autouv": 0, "color": sw % 8, "origin": c,
          "faces": {f: {"uv": uv, "texture": 0} for f in ("north", "east", "south", "west", "up", "down")},
          "type": "cube", "uuid": u}
    if any(it["r"]):
        el["rotation"] = it["r"]
    elements.append(el)
    groups.setdefault(it["g"], []).append(u)
outliner = [{"name": g, "origin": [0, 0, 0], "color": 0, "uuid": str(uuid.uuid4()), "export": True,
             "mirror_uv": False, "isOpen": False, "locked": False, "visibility": True, "autouv": 0, "children": ids}
            for g, ids in groups.items()]
model = {"meta": {"format_version": "4.10", "model_format": "free", "box_uv": False}, "name": "arena",
         "model_identifier": "", "visible_box": [1, 1, 0], "variable_placeholders": "",
         "variable_placeholder_buttons": [], "timeline_setups": [], "unhandled_marked_keyframes": [],
         "resolution": {"width": W, "height": Hh}, "elements": elements, "outliner": outliner,
         "textures": [{"path": "", "name": "palette.png", "folder": "", "namespace": "", "id": "0", "width": W,
                       "height": Hh, "uv_width": W, "uv_height": Hh, "particle": False, "use_as_default": False,
                       "layers_enabled": False, "sync_to_project": "", "render_mode": "default",
                       "render_sides": "auto", "frame_time": 1, "frame_order_type": "loop", "frame_order": "",
                       "frame_interpolate": False, "visible": True, "internal": True, "saved": False,
                       "uuid": str(uuid.uuid4()), "source": "data:image/png;base64," + base64.b64encode(tex_png).decode()}]}
json.dump(model, open(os.path.join(HERE, "..", "maps", "arena.bbmodel"), "w"), indent=1)
print("OK:", len(items), "объектов")
