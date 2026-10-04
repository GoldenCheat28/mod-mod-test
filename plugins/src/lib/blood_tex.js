// ---------------------------------------------------------------------------
// Blood shapes (scripts/fx/blood_tex.gd): each shape is built as a thickness field; from it the colour + coverage
// (decals) and the paint mask (R = film thickness, A = coverage: painted into the floor map) are baked. Cached.
// Also the smoke puff of the mist (textures.gd) and the splash animation (blood_splash.gd).
// ---------------------------------------------------------------------------

// FastNoiseLite as Godot makes it by default: smooth simplex, frequency 0.01, fractal FBM of 5 octaves
function makeNoise(seed) {
	const rnd = mulberry(seed >>> 0), perm = new Uint8Array(512), p = [...Array(256).keys()];
	for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
	for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
	const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
	const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
	const simplex = (x, y) => {
		const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2;
		const x0 = x - (i - t), y0 = y - (j - t);
		const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
		const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
		const ii = i & 255, jj = j & 255;
		let n = 0;
		for (const [dx, dy, gi] of [[x0, y0, perm[ii + perm[jj]]], [x1, y1, perm[ii + i1 + perm[jj + j1]]], [x2, y2, perm[ii + 1 + perm[jj + 1]]]]) {
			const tt = 0.5 - dx * dx - dy * dy;
			if (tt > 0) { const g = G[gi & 7]; n += tt * tt * tt * tt * (g[0] * dx + g[1] * dy); }
		}
		return 70 * n;
	};
	const bound = 1 / (1 + 0.5 + 0.25 + 0.125 + 0.0625);
	return {get(x, y) {
		let sum = 0, amp = 1, f = 0.01;
		for (let o = 0; o < 5; o++) { sum += simplex(x * f + o * 31.7, y * f - o * 17.3) * amp; amp *= 0.5; f *= 2; }
		return sum * bound;
	}};
}

// RandomNumberGenerator in the shape of Godot's
function makeRng(seed) {
	const r = mulberry(seed >>> 0);
	return {randf: r, range: (a, b) => a + (b - a) * r(), int: (a, b) => a + Math.floor(r() * (b - a + 1)), randfn: (m, d) => { const u = Math.max(1e-9, r()), v = r(); return m + d * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }};
}

const BT_WET = [0.48, 0.022, 0.016], BT_THICK = [0.24, 0.006, 0.006], BT_CLOT = [0.05, 0, 0];
const bt_cache = {};

const btPx = (size, u) => Math.floor((u * 0.5 + 0.5) * (size - 1));
// dome-shaped bump, merged with max()
function btBump(h, size, cx, cy, r, amp) {
	const x0 = Math.max(btPx(size, cx - r), 0), x1 = Math.min(btPx(size, cx + r) + 1, size - 1);
	const y0 = Math.max(btPx(size, cy - r), 0), y1 = Math.min(btPx(size, cy + r) + 1, size - 1);
	const inv = 2 / (size - 1);
	for (let y = y0; y <= y1; y++) {
		const py = y * inv - 1;
		for (let x = x0; x <= x1; x++) {
			const d = Math.hypot(x * inv - 1 - cx, py - cy) / r;
			if (d < 1) { const v = amp * Math.sqrt(1 - d * d), i = y * size + x; if (v > h[i]) h[i] = v; }
		}
	}
}
// lobed blob: radius varies with angle, flat-ish top, soft edge
function btBlob(h, size, n, r0, lobes, freq, amp) {
	const inv = 2 / (size - 1);
	for (let y = 0; y < size; y++) {
		const py = y * inv - 1;
		for (let x = 0; x < size; x++) {
			const px = x * inv - 1, d = Math.sqrt(px * px + py * py);
			if (d > r0 * (1 + lobes * 1.6)) continue;
			const a = Math.atan2(py, px);
			const r = r0 * (1 + lobes * n.get(Math.cos(a) * freq * 40, Math.sin(a) * freq * 40) * 2);
			const edge = (r - d) / Math.max(r, 0.001);
			if (edge > 0) { const v = amp * Math.pow(clamp(edge * 3.5, 0, 1), 0.55), i = y * size + x; h[i] = Math.max(h[i], v); }
		}
	}
}
function btSplat(h, size, rng, n) {
	const r0 = rng.range(0.3, 0.42);
	btBlob(h, size, n, r0, 0.18, 1.3, 0.85);
	// a few short tails on the side the drop was travelling (+V)
	for (let s = rng.int(1, 4); s > 0; s--) {
		const a = Math.PI * 0.5 + rng.range(-0.55, 0.55), dx = Math.cos(a), dy = Math.sin(a);
		const length = rng.range(0.08, 0.3), w = rng.range(0.04, 0.08), steps = Math.floor(length / 0.02) + 2;
		for (let k = 0; k < steps; k++) { const t = k / steps, d = r0 * 0.75 + length * t; btBump(h, size, dx * d, dy * d, w * (1 - t * 0.6), 0.6); }
		const e = r0 * 0.75 + length + 0.02;
		btBump(h, size, dx * e, dy * e, w * 0.75, 0.65);
	}
	// loose satellite droplets, mostly thrown ahead
	for (let s = rng.int(4, 12); s > 0; s--) {
		const a = Math.PI * 0.5 + rng.range(-1.2, 1.2), d = rng.range(r0 + 0.08, 0.93), r = rng.range(0.008, 0.03) * (1.2 - d * 0.5);
		btBump(h, size, Math.cos(a) * d, Math.sin(a) * d, r, 0.7);
	}
}
function btDrop(h, size, rng, n) {
	btBlob(h, size, n, 0.7, 0.09, 4.0, 0.75);
	for (let s = rng.int(0, 4); s > 0; s--) { const a = rng.randf() * Math.PI * 2, d = rng.range(0.8, 0.92); btBump(h, size, Math.cos(a) * d, Math.sin(a) * d, rng.range(0.04, 0.07), 0.6); }
}
function btStreak(h, size, n) {
	const inv = 2 / (size - 1);
	for (let y = 0; y < size; y++) {
		const py = y * inv - 1;
		const centre = n.get(0, py * 60) * 0.18;
		const half = (0.55 + n.get(50, py * 90) * 0.18) * gsmooth(1.0, 0.8, Math.abs(py));
		for (let x = 0; x < size; x++) { const e = half - Math.abs(x * inv - 1 - centre); if (e > 0) h[y * size + x] = 0.7 * Math.pow(clamp(e * 6, 0, 1), 0.5); }
	}
}
function btPrint(h, size, n, left) {
	const inv = 2 / (size - 1);
	for (let y = 0; y < size; y++) {
		const py = y * inv - 1;
		for (let x = 0; x < size; x++) {
			const px = (x * inv - 1) * (left ? -1 : 1);
			const fore = Math.pow((px - 0.08 + py * 0.08) / 0.62, 2) + Math.pow((py + 0.3) / 0.62, 2);
			const heel = Math.pow(px / 0.5, 2) + Math.pow((py - 0.62) / 0.32, 2);
			const inside = Math.min(fore, heel);
			if (inside < 1) {
				const tread = 0.5 + 0.5 * Math.sin(py * 38 + n.get(x * 3, y * 3) * 4);
				const blotch = n.get(x * 2, y * 2) * 0.5 + 0.5;
				h[y * size + x] = 0.35 * gsmooth(1, 0.8, inside) * gsmooth(0.25, 0.6, tread * 0.6 + blotch * 0.7);
			}
		}
	}
}
function btBrush(h, size, n) {
	const inv = 2 / (size - 1);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const px = x * inv - 1, py = y * inv - 1, r = Math.sqrt(px * px + py * py);
		if (r >= 1) continue;
		const fibre = n.get(px * 240, 7) * 0.5 + 0.5;
		h[y * size + x] = 0.6 * gsmooth(1, 0.55, r) * gsmooth(0.25, 0.7, fibre);
	}
}
function btPool(h, size, rng, n) {
	// irregular spread: a main body plus a few merged lobes of different size
	btBlob(h, size, n, 0.55, 0.2, 1.3, 1.0);
	for (let s = rng.int(3, 5); s > 0; s--) { const a = rng.randf() * Math.PI * 2, d = rng.range(0.3, 0.5); btBump(h, size, Math.cos(a) * d, Math.sin(a) * d, rng.range(0.2, 0.36), 1.0); }
}
function btSmear(h, size, n) {
	const inv = 2 / (size - 1);
	for (let y = 0; y < size; y++) {
		const py = y * inv - 1;
		for (let x = 0; x < size; x++) {
			const px = x * inv - 1;
			const env = 1 - Math.pow(Math.abs(px) / 0.8, 2) - Math.pow(Math.abs(py) / 0.95, 6);
			if (env <= 0) continue;
			const fibre = n.get(px * 260, py * 25) * 0.5 + 0.5;
			const run_out = gsmooth(0.95, -0.7, py + n.get(px * 120, 300) * 0.5);
			h[y * size + x] = gsmooth(0.3, 0.8, fibre * 0.55 + env * 0.55 + run_out * 0.3) * run_out * 0.5;
		}
	}
}
function btWound(h, size, rng, n) {
	btBlob(h, size, n, 0.55, 0.2, 2.0, 0.55);
	for (let s = 0; s < 10; s++) { const a = rng.randf() * Math.PI * 2, d = rng.range(0.55, 0.9); btBump(h, size, Math.cos(a) * d, Math.sin(a) * d, rng.range(0.03, 0.07), 0.5); }
	btBlob(h, size, n, 0.2, 0.25, 3.0, 1.5);   // torn entry hole: very high values bake to near-black clotted colour
}

// {albedo: RGBA bytes (colour, coverage), mask: RGBA bytes (thickness, 0, 0, coverage), size} for a shape kind and variant
function bloodShape(kind, variant) {
	const key = kind + '_' + variant;
	if (bt_cache[key]) return bt_cache[key];
	// (Godot: 96 / 192 px; here a power of two, so the textures have mip maps)
	const size = ['drop', 'wound', 'streak', 'brush', 'print'].includes(kind) ? 128 : 256;
	const h = new Float32Array(size * size);
	const rng = makeRng(hashString(key)), n = makeNoise(Math.floor(rng.randf() * 4294967295));
	switch (kind) {
		case 'splat': btSplat(h, size, rng, n); break;
		case 'drop': btDrop(h, size, rng, n); break;
		case 'streak': btStreak(h, size, n); break;
		case 'brush': btBrush(h, size, n); break;
		case 'print': btPrint(h, size, n, variant == 1); break;
		case 'pool': btPool(h, size, rng, n); break;
		case 'smear': btSmear(h, size, n); break;
		case 'wound': btWound(h, size, rng, n); break;
	}
	const flat = kind == 'pool';
	const albedo = new Uint8Array(size * size * 4), mask = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
	// the normal map of the film (blood_tex.gd _bake), its slope kept as the game's at our finer pixels
	const ns = (flat ? 2.2 : 3.0) * size / (['drop', 'wound', 'streak', 'brush', 'print'].includes(kind) ? 96 : 192);
	const H = (x, y) => Math.min(h[clamp(y, 0, size - 1) * size + clamp(x, 0, size - 1)], 1);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const nx = (H(x - 1, y) - H(x + 1, y)) * ns, ny = (H(x, y + 1) - H(x, y - 1)) * ns, l = Math.hypot(nx, ny, 1);
		normal.set([(nx / l * 0.5 + 0.5) * 255, (ny / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255, 255].map(Math.round), (y * size + x) * 4);
	}
	for (let i = 0; i < size * size; i++) {
		const v = h[i];
		const a = gsmooth(0.02, 0.1, v);
		const t = gsmooth(0.1, 0.95, v);
		let c = BT_WET.map((w, k) => w + (BT_THICK[k] - w) * t);
		if (v > 1) { const u = gsmooth(1, 1.4, v); c = c.map((x, k) => x + (BT_CLOT[k] - x) * u); }
		// slightly darker rim where the film dries first
		const rim = gsmooth(0.02, 0.07, v) * (1 - gsmooth(0.07, 0.22, v));
		c = c.map(x => x * (1 - rim * 0.25));
		albedo.set([c[0] * 255, c[1] * 255, c[2] * 255, a * 255].map(Math.round), i * 4);
		// paint mask: R = film thickness, A = coverage (a pool is one even sheet, full depth a little in from its edge)
		const th = flat ? gsmooth(0.02, 0.3, v) : clamp(v / 1.2, 0, 1);
		mask.set([th * 255, 0, 0, gsmooth(0.01, 0.09, v) * 255].map(Math.round), i * 4);
	}
	return (bt_cache[key] = {albedo, mask, normal, size, key});
}

// the mist's puff: a soft noisy round blot
function smokePuff() {
	if (bt_cache.smoke) return bt_cache.smoke;
	const size = 128, data = new Uint8Array(size * size * 4), n = makeNoise(77);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const d = Math.hypot(x - size * 0.5, y - size * 0.5) / (size * 0.5);
		let fall = clamp(1 - d, 0, 1); fall = fall * fall * (3 - 2 * fall);
		// (FastNoiseLite at frequency 0.045, 4 octaves)
		const v = clamp(n.get(x * 4.5, y * 4.5) * 0.6 + 0.6, 0, 1);
		data.set([255, 255, 255, Math.round(clamp(fall * v * 1.2, 0, 1) * 255)], (y * size + x) * 4);
	}
	return (bt_cache.smoke = {data, size});
}

// The splash at a hit (blood_splash.gd): eight frames of a burst drawn once: alpha the blood, red how thin, green a glint
function splashAtlas() {
	if (bt_cache.splash) return bt_cache.splash;
	const CELL = 128, FX = 4, FY = 2, W = CELL * FX, H = CELL * FY;
	const img = new Float32Array(W * H * 4);
	const rng = makeRng(77);
	const disc = (ox, oy, cx, cy, r, a, thin, glint) => {
		const x0 = Math.max(Math.floor(cx - r - 1), 0), x1 = Math.min(Math.floor(cx + r + 1), CELL - 1);
		const y0 = Math.max(Math.floor(cy - r - 1), 0), y1 = Math.min(Math.floor(cy + r + 1), CELL - 1);
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
			const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / Math.max(r, 0.001);
			if (d > 1) continue;
			const v = clamp((1 - d) * 3, 0, 1) * a, i = ((oy + y) * W + ox + x) * 4;
			if (v > img[i + 3]) {
				const g = glint * clamp(1 - d * 2.5, 0, 1);
				img[i] = Math.max(img[i], thin); img[i + 1] = Math.max(img[i + 1], g); img[i + 3] = v;
			}
		}
	};
	// the drops: where each flies (mostly forward, along +x, the throw) and how big it is
	const drops = [];
	for (let i = 0; i < 34; i++) {
		const ang = i < 24 ? rng.randfn(0, 0.75) : rng.range(-Math.PI, Math.PI);
		drops.push([ang, rng.range(0.45, 1.0) * (i < 24 ? 1 : 0.55), rng.range(0.6, 1.4)]);
	}
	const count = FX * FY;
	for (let f = 0; f < count; f++) {
		const t = f / (count - 1), ox = (f % FX) * CELL, oy = Math.floor(f / FX) * CELL;
		const cx = CELL * 0.38, cy = CELL * 0.5;
		const out = 1 - Math.pow(1 - t, 2.2);
		// the core: a ragged blob that bursts, then breaks up and thins
		const core_r = CELL * (0.09 + 0.12 * Math.sqrt(t)) * (1 - 0.5 * gsmooth(0.55, 1.0, t));
		const core_a = 1 - gsmooth(0.35, 1.0, t);
		for (let k = 0; k < 9; k++) {
			const a = Math.PI * 2 * k / 9 + rng.randf() * 0.4, rr = core_r * rng.range(0.2, 0.55);
			disc(ox, oy, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, core_r * rng.range(0.45, 0.75), core_a, 0.15, 0.4 * (1 - t));
		}
		// the drops: a streak from the core early on, a round drop at the end of it later; small ones fade first
		for (const d of drops) {
			const dx = Math.cos(d[0]), dy = Math.sin(d[0]);
			const reach = CELL * 0.6 * d[1] * out, r = CELL * 0.022 * d[2] * (1 - 0.55 * t);
			const alpha = 1 - gsmooth(0.55 + 0.35 * d[2] / 1.4, 1.0, t);
			if (alpha <= 0 || r < 0.6) continue;
			const tail = clamp(0.55 - t, 0, 0.55);
			for (let s = 0; s <= 6; s++) {
				const u = s / 6, along = reach * glerp(1 - tail, 1, u);
				disc(ox, oy, cx + dx * along, cy + dy * along, r * glerp(0.45, 1, u), alpha * glerp(0.5, 1, u), 0.55 * t, 0);
			}
		}
	}
	const data = new Uint8Array(W * H * 4);
	for (let i = 0; i < data.length; i++) data[i] = Math.round(clamp(img[i], 0, 1) * 255);
	return (bt_cache.splash = {data, width: W, height: H});
}
