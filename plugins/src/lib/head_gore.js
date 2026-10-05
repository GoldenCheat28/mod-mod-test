// ---------------------------------------------------------------------------
// Extra head: a hard shot to the head breaks it open. The head's own meshes are torn along ragged surfaces (planes
// made jagged by noise at several scales; the mesh is made finer along them first) into pieces; a piece is a body of
// its own (it falls, swings, lands), and one still hanging on by skin and flesh is held to the rest of the head at a
// point. Its vertices follow the piece more the farther they are from that point (a weight map, its border uneven), and
// each is a particle on a spring to that place - flesh that sags, lags and wobbles, stretched thin in the torn band.
// Strands of flesh stay stretched across the tear (Verlet chains) and snap when pulled too far. The inside of the head
// shows through as wet flesh, and the torn edges are soaked.
//   face  - the face is torn off and hangs from the chin
//   split - the head comes apart in two halves that peel away to the sides and hang
//   burst - the top of the skull is blown off in pieces, the face hangs from the jaw
// While baking, where each piece is is written down at every frame; the Animate tab draws it again at the timeline's
// time (the tear is the same: it comes from a recorded seed; the soft flesh is simulated again along the timeline).
// ---------------------------------------------------------------------------

const GORE_SLOTS = 8;   // collision sub groups kept free for the pieces of a head
const gore_bakes = new Map();   // animation uuid -> [recording of a head]

// the meshes of the head: its own elements (not a held thing, not another bone)
function goreElements(group) {
	return (group.children || []).filter(el => (el instanceof Mesh || el instanceof Cube) && el.mesh && el.mesh.geometry && el.mesh.geometry.attributes.position);
}

// a seeded value noise in 3D (0..1): the same head breaks the same way in the bake and in its playback
function goreNoise(seed) {
	const h = (x, y, z) => { let n = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1442695041) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
	const s = t => t * t * (3 - 2 * t);
	return (x, y, z) => {
		const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = s(x - xi), yf = s(y - yi), zf = s(z - zi);
		const l = (a, b, t) => a + (b - a) * t;
		return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
			l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf), zf);
	};
}

// the tears: each one a plane made ragged - torn flesh and bone do not part along a straight line, the edge wanders
// and is jagged at every scale (the planes of the head group's own space, pixels)
function goreFields(params) {
	if (params._fields) return params._fields;
	const nz = goreNoise(params.seed || 1), R = params.R, A = (params.rag ?? 0.14) * R;
	const f1 = 2.3 / R, f2 = 6.5 / R, f3 = 15 / R;
	const field = (i, p) => {
		const pl = params.planes[i], o = i * 17.3;
		const d = pl.n[0] * p.x + pl.n[1] * p.y + pl.n[2] * p.z - pl.d;
		// big wander, then smaller tears, then a sharp ragged fringe (the |..| makes it jag rather than wave)
		const r = (nz(p.x * f1 + o, p.y * f1, p.z * f1) - 0.5) * 1.3 + (nz(p.x * f2, p.y * f2 + o, p.z * f2) - 0.5) * 0.6
			+ (Math.abs(nz(p.x * f3, p.y * f3, p.z * f3 + o) - 0.5) - 0.25) * 0.8;
		return d + A * r;
	};
	return (params._fields = {field, A, nz});
}

// which piece a point of the head belongs to: 0 = what stays on the neck
function goreRegion(params, p) {
	const {field} = goreFields(params);
	const side = params.planes.map((pl, i) => field(i, p) >= 0 ? 1 : -1);
	for (let k = 0; k < params.regions.length; k++) if (params.regions[k].every(([i, s]) => side[i] == s)) return k + 1;
	return 0;
}

// cuts the head's meshes along the tears. Near a tear the surface is first made finer (so the edge can be ragged: the
// edges of the mesh are halved where a tear runs close by, the same way on both faces that share an edge - no cracks),
// then every triangle across a tear is split there. For every element: a geometry of its own, the piece of each
// vertex, its weight (how much it follows the piece: the weight map) and how far it is from the nearest tear
function goreCut(els, params) {
	const {field, A, nz} = goreFields(params), R = params.R, L = R * 0.085, np = params.planes.length;
	const out = [];
	for (const el of els) {
		el.mesh.updateMatrix();
		const M = el.mesh.matrix.clone();
		const src0 = el.mesh.geometry, src = src0.index ? src0.toNonIndexed() : src0;
		const names = Object.keys(src.attributes).filter(n => src.attributes[n].itemSize && !src.attributes[n].isInterleavedBufferAttribute && n != 'skyocc');
		const sizes = names.map(n => src.attributes[n].itemSize), stride = sizes.reduce((a, b) => a + b, 0);
		const pi = names.indexOf('position');
		const vert = i => { const v = new Float32Array(stride); let o = 0; names.forEach((n, k) => { const a = src.attributes[n]; for (let c = 0; c < sizes[k]; c++) v[o + c] = a.array[i * sizes[k] + c]; o += sizes[k]; }); return v; };
		let po = 0; for (let k = 0; k < pi; k++) po += sizes[k];
		const gpos = v => new THREE.Vector3(v[po], v[po + 1], v[po + 2]).applyMatrix4(M);
		const lerpV = (a, b, t) => { const v = new Float32Array(stride); for (let c = 0; c < stride; c++) v[c] = a[c] + (b[c] - a[c]) * t; return v; };
		// (an edge is halved when it is long and a tear runs across it or close by)
		const near = (a, b) => {
			const pa = gpos(a), pb = gpos(b), len = pa.distanceTo(pb);
			if (len <= L) return false;
			for (let i = 0; i < np; i++) { const fa = field(i, pa), fb = field(i, pb); if ((fa >= 0) != (fb >= 0) || Math.min(Math.abs(fa), Math.abs(fb)) < A * 1.3 + len * 0.6) return true; }
			return false;
		};
		const refine = (t, depth, outl) => {
			const [a, b, c] = t;
			if (depth >= 6) { outl.push(t); return; }
			const s0 = near(a, b), s1 = near(b, c), s2 = near(c, a), n = s0 + s1 + s2;
			if (!n) { outl.push(t); return; }
			const m0 = s0 ? lerpV(a, b, 0.5) : null, m1 = s1 ? lerpV(b, c, 0.5) : null, m2 = s2 ? lerpV(c, a, 0.5) : null;
			const go = x => refine(x, depth + 1, outl);
			if (n == 3) { go([a, m0, m2]); go([m0, b, m1]); go([m2, m1, c]); go([m0, m1, m2]); return; }
			if (n == 1) {
				if (s0) { go([a, m0, c]); go([m0, b, c]); } else if (s1) { go([b, m1, a]); go([m1, c, a]); } else { go([c, m2, b]); go([m2, a, b]); }
				return;
			}
			// two: turned so that the one left whole is the last edge
			if (!s2) { go([m0, b, m1]); go([a, m0, m1]); go([a, m1, c]); }
			else if (!s0) { go([m1, c, m2]); go([b, m1, m2]); go([b, m2, a]); }
			else { go([m2, a, m0]); go([c, m2, m0]); go([c, m0, b]); }
		};
		const clip = (poly, i) => {
			const front = [], back = [];
			for (let k = 0; k < poly.length; k++) {
				const a = poly[k], b = poly[(k + 1) % poly.length], da = field(i, gpos(a)), db = field(i, gpos(b));
				if (da >= 0) front.push(a); else back.push(a);
				if ((da >= 0) != (db >= 0)) { const x = lerpV(a, b, da / (da - db)); front.push(x); back.push(x); }
			}
			return [front, back].filter(p => p.length >= 3);
		};
		const groups = src.groups && src.groups.length ? src.groups : [{start: 0, count: src.attributes.position.count, materialIndex: 0}];
		const tris = [], new_groups = [];
		for (const g of groups) {
			const start = tris.length;
			for (let t = g.start; t + 2 < g.start + g.count; t += 3) {
				const fine = [];
				// (what is not torn - the brain, left whole in the open skull - is kept as it is, all on the head)
				if (el.no_cut) { tris.push({v: [vert(t), vert(t + 1), vert(t + 2)], region: 0}); continue; }
				refine([vert(t), vert(t + 1), vert(t + 2)], 0, fine);
				for (const f of fine) {
					let polys = [f];
					for (let i = 0; i < np; i++) polys = polys.flatMap(p => clip(p, i));
					for (const p of polys) {
						const c = p.reduce((s, v) => s.add(gpos(v)), new THREE.Vector3()).divideScalar(p.length);
						const region = goreRegion(params, c);
						for (let i = 1; i + 1 < p.length; i++) tris.push({v: [p[0], p[i], p[i + 1]], region});
					}
				}
			}
			new_groups.push({start: start * 3, count: (tris.length - start) * 3, materialIndex: g.materialIndex});
		}
		const n = tris.length * 3, geo = new THREE.BufferGeometry();
		const arrays = names.map((name, k) => new Float32Array(n * sizes[k]));
		const region = new Uint8Array(n), weight = new Float32Array(n), base = new Float32Array(n * 3), tear = new Float32Array(n);
		let vi = 0;
		for (const tri of tris) for (const v of tri.v) {
			let o = 0;
			names.forEach((name, k) => { for (let c = 0; c < sizes[k]; c++) arrays[k][vi * sizes[k] + c] = v[o + c]; o += sizes[k]; });
			const p = gpos(v);
			base.set([p.x, p.y, p.z], vi * 3);
			region[vi] = tri.region;
			let fm = Infinity;
			for (let i = 0; i < np; i++) fm = Math.min(fm, Math.abs(field(i, p)));
			tear[vi] = fm;
			const h = tri.region ? params.hinges[tri.region - 1] : null;
			// (the weight map: by the skin it hangs from it stays with the head, farther out it is the piece's - an
			// uneven border, as flesh tears unevenly)
			const wob = (nz(p.x * 3 / R + 40, p.y * 3 / R, p.z * 3 / R) - 0.5) * 0.4 * R;
			weight[vi] = !tri.region ? 0 : !h ? 1 : gsmooth(R * 0.1, R * 0.9, p.distanceTo(new THREE.Vector3(...h)) + wob);
			vi++;
		}
		names.forEach((name, k) => geo.setAttribute(name, new THREE.BufferAttribute(arrays[k], sizes[k])));
		new_groups.forEach(g => geo.addGroup(g.start, g.count, g.materialIndex));
		geo.computeBoundingSphere();
		if (src !== src0) src.dispose();
		const nrm = geo.attributes.normal;
		out.push({el, M, Minv: M.clone().invert(), geo, region, weight, base, tear, base_n: nrm ? new Float32Array(nrm.array) : null, orig: null, inner: null});
	}
	return out;
}

// What is inside a head: the skull (a shell of bone under the skin) and the brain in it - two hemispheres, folded
// all over (gyri and the sulci between them), a deep cleft between the halves. Made for the head as it was measured
// (its middle and its size), from the same seed as the tear, and torn with it like the head's own meshes
function goreInnards(params, parent) {
	const c = new THREE.Vector3(...params.c), half = new THREE.Vector3(...params.half), R = params.R;
	const right = new THREE.Vector3(...params.right), up = new THREE.Vector3(0, 1, 0), fwd = right.clone().cross(up).negate();
	const nz = goreNoise((params.seed || 1) + 31);
	// a sphere with its vertices shared (smooth normals), as an indexed geometry made from an icosphere
	const sphere = detail => {
		const g0 = new THREE.IcosahedronGeometry(1, detail), p0 = g0.attributes.position, keys = new Map(), pos = [], idx = [];
		for (let i = 0; i < p0.count; i++) {
			const x = p0.getX(i), y = p0.getY(i), z = p0.getZ(i), key = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
			let j = keys.get(key);
			if (j === undefined) { j = pos.length / 3; keys.set(key, j); pos.push(x, y, z); }
			idx.push(j);
		}
		g0.dispose();
		return {pos: new Float32Array(pos), idx};
	};
	const build = (s, shape, colour) => {
		const n = s.pos.length / 3, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), d = new THREE.Vector3(), out = new THREE.Vector3(), rgb = [0, 0, 0];
		for (let i = 0; i < n; i++) {
			d.fromArray(s.pos, i * 3);
			shape(d, out, rgb);
			pos.set([out.x, out.y, out.z], i * 3);
			col.set(rgb, i * 3);
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		g.setAttribute('color', new THREE.BufferAttribute(col, 3));
		g.setIndex(s.idx);
		g.computeVertexNormals();
		const flat = g.toNonIndexed();
		g.dispose();
		return flat;
	};
	// (a point on the unit sphere to the head's own space, an ellipsoid of radii r)
	const place = (d, r, out) => out.copy(c).addScaledVector(right, d.x * r.x).addScaledVector(up, d.y * r.y).addScaledVector(fwd, d.z * r.z);
	const skull_r = new THREE.Vector3(half.x * 0.8, half.y * 0.78, half.z * 0.8);
	const skull = build(sphere(10), (d, out, rgb) => {
		place(d, skull_r, out);
		out.y += R * 0.04;
		const k = 0.85 + 0.15 * nz(d.x * 6, d.y * 6, d.z * 6);
		rgb[0] = 0.86 * k; rgb[1] = 0.8 * k; rgb[2] = 0.7 * k;
	});
	const brain_r = new THREE.Vector3(skull_r.x * 0.78, skull_r.y * 0.7, skull_r.z * 0.8);
	const brain = build(sphere(16), (d, out, rgb) => {
		// the folds: ridges where a noise crosses its middle, sulci (the deep lines) between them
		const f = 7.5;
		const a = nz(d.x * f + 3, d.y * f, d.z * f), b = nz(d.x * f * 2.1, d.y * f * 2.1 + 5, d.z * f * 2.1);
		const ridge = 1 - Math.abs((a * 0.7 + b * 0.3) * 2 - 1);
		const fold = Math.pow(ridge, 0.6);
		// the cleft between the hemispheres, from the top down (along the line of the face)
		const cleft = Math.exp(-Math.pow(d.x / 0.07, 2)) * Math.max(d.y + 0.35, 0);
		const r = 1 + 0.12 * fold - 0.25 * cleft;
		place(d.clone().multiplyScalar(r), brain_r, out);
		out.y += R * 0.05;
		// pinkish grey; the sulci darker, with a little blood in them
		const s = Math.pow(1 - fold, 1.5), bl = nz(d.x * 2, d.y * 2 + 9, d.z * 2);
		rgb[0] = 0.7 - 0.42 * s; rgb[1] = 0.5 - 0.42 * s; rgb[2] = 0.52 - 0.4 * s;
		// blood over it in patches, run into the sulci
		const blood = Math.min(1, Math.max(0, (bl - 0.35) * 2.5) + s * 0.6);
		rgb[0] = rgb[0] + (0.42 - rgb[0]) * blood; rgb[1] = rgb[1] + (0.04 - rgb[1]) * blood; rgb[2] = rgb[2] + (0.04 - rgb[2]) * blood;
	});
	const make = (geo, name, mat, inner, no_cut) => {
		const mesh = new THREE.Mesh(geo, mat);
		mesh.name = name;
		parent.add(mesh);
		mesh.updateMatrix();
		return {mesh, uuid: name, name, fake: true, inner_mat: inner, no_cut};
	};
	return [
		make(skull, 'gore_skull', goreBoneMaterial(THREE.FrontSide), goreBoneMaterial(THREE.BackSide)),
		// (the brain comes apart only with the head split in two: its halves go with the halves of the head. Otherwise it
		// stays in the skull, laid open where the skull and the face are torn away)
		make(brain, 'gore_brain', goreBrainMaterial(), goreBrainInnerMaterial(), params.mode != 'split'),
	];
}

let gore_bone_mats = {}, gore_brain_mat = null;
function goreBoneMaterial(side) {
	return gore_bone_mats[side] || (gore_bone_mats[side] = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.55, metalness: 0, side,
		emissive: 0x1a1612, color: side == THREE.BackSide ? 0xb09080 : 0xffffff}));
}
let gore_brain_in = null;
function goreBrainInnerMaterial() {
	return gore_brain_in || (gore_brain_in = new THREE.MeshStandardMaterial({color: 0xb08c8c, roughness: 0.35, metalness: 0, side: THREE.BackSide, emissive: 0x221414}));
}
function goreBrainMaterial() {
	return gore_brain_mat || (gore_brain_mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.28, metalness: 0, emissive: 0x1c0a0a, envMapIntensity: 0.8}));
}

// the flesh inside, seen through the cut (the back faces of the head's own surfaces)
let gore_flesh_mat = null;
function goreFleshMaterial() {
	if (gore_flesh_mat) return gore_flesh_mat;
	gore_flesh_mat = new THREE.MeshStandardMaterial({color: 0x8a1410, roughness: 0.3, metalness: 0, side: THREE.BackSide, envMapIntensity: 0.6, emissive: 0x2a0403});
	gore_flesh_mat.onBeforeCompile = shader => {
		shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
			{
				vec3 q = floor(vViewPosition * 3.0);
				float h = fract(sin(dot(q, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
				diffuseColor.rgb *= 0.7 + 0.5 * h;
			}`);
	};
	gore_flesh_mat.customProgramCacheKey = () => 'ragdoll_gore_flesh';
	return gore_flesh_mat;
}

// The soft part. What hangs on is flesh, not a board: every vertex of a hanging piece is a particle on a spring to where
// the piece's bones would put it - stiff in the piece, slack in the torn, stretched band of the weight map - so it sags
// under its weight, lags, wobbles and settles. Strands of flesh are left stretched across a tear: chains of particles
// (Verlet) pinned to both sides that sag, swing and snap when pulled too far, then hang from the head.
// Everything here runs in the scene's space (pixels), on the head as it is drawn: the same in the simulation and in the
// playback of a bake.
class GoreSoft {
	constructor(cut, params) {
		this.cut = cut;
		this.params = params;
		const R = params.R, keys = new Map(), soft = [];
		this.n = 0;
		for (const c of cut) {
			c.pidx = new Int32Array(c.region.length).fill(-1);
			for (let i = 0; i < c.region.length; i++) {
				const k = c.region[i];
				if (!k || !params.hinges[k - 1] || c.weight[i] <= 0) continue;
				const key = k + ':' + Math.round(c.base[i * 3] * 200) + ',' + Math.round(c.base[i * 3 + 1] * 200) + ',' + Math.round(c.base[i * 3 + 2] * 200);
				let j = keys.get(key);
				if (j === undefined) { j = this.n++; keys.set(key, j); const w = c.weight[i]; soft.push(Math.min(1, 0.2 + 3.2 * w * (1 - w))); }
				c.pidx[i] = j;
			}
		}
		this.soft = Float32Array.from(soft);
		this.x = new Float32Array(this.n * 3); this.v = new Float32Array(this.n * 3);
		this.tgt = new Float32Array(this.n * 3); this.tgt0 = new Float32Array(this.n * 3);
		this.started = false;
		// the strands: from the edge of the tear on the head to the edge of the tear on a piece
		const nz = goreNoise((params.seed || 1) + 7);
		let rnd_i = 0;
		const rnd = () => nz(rnd_i++ * 1.37 + 0.5, 3.1, 7.7);
		const edge = k => { const o = []; for (const c of cut) for (let i = 0; i < c.region.length; i += 3) if (c.region[i] == k && c.tear[i] < R * 0.12) o.push([c, i]); return o; };
		const stump = edge(0);
		this.strands = [];
		const add = (o) => {
			// (each its own lumps: the cross-section is uneven and flattened, a ribbon of skin and meat, not a wire)
			o.bump = Array.from({length: o.n * 8}, () => 0.75 + 0.5 * rnd());
			o.flat = 0.45 + 0.35 * rnd();
			o.twist = rnd() * Math.PI;
			this.strands.push(o);
		};
		for (let k = 1; k <= params.regions.length && stump.length; k++) {
			const mine = edge(k);
			if (!mine.length) continue;
			const count = params.hinges[k - 1] ? 6 : 3;
			for (let s = 0; s < count; s++) {
				const b = mine[Math.floor(rnd() * mine.length)];
				const pb = new THREE.Vector3().fromArray(b[0].base, b[1] * 3);
				let best = null, bd = Infinity;
				for (let t = 0; t < 24; t++) { const a = stump[Math.floor(rnd() * stump.length)], d = new THREE.Vector3().fromArray(a[0].base, a[1] * 3).distanceTo(pb); if (d < bd) { bd = d; best = a; } }
				if (!best || bd > R * 0.9) continue;
				// (its length is the gap across the tear as the head was whole, a little slack; a piece thrown off tears it soon)
				const free_piece = !params.hinges[k - 1], n = 9;
				add({a: best, b, n, r: R * (0.05 + 0.07 * rnd()), rest: Math.max(bd, R * 0.08) * (1.05 + rnd() * 0.25) / (n - 1),
					snap: free_piece ? 1.6 + rnd() * 1.4 : 2.2 + rnd() * 2.5, free: false, flap: false, p: null, q: null, mesh: null});
			}
		}
		// torn flaps of skin and meat that hang from the wound by one end: they drop, sway heavily and lie on what is under
		const all_edge = [];
		for (let k = 0; k <= params.regions.length; k++) if (k == 0 || params.hinges[k - 1]) all_edge.push(...edge(k));
		const flaps = all_edge.length ? 4 + Math.floor(rnd() * 4) : 0;
		for (let s = 0; s < flaps; s++) {
			const a = all_edge[Math.floor(rnd() * all_edge.length)], n = 7;
			add({a, b: null, n, r: R * (0.07 + 0.07 * rnd()), rest: R * (0.3 + 0.6 * rnd()) / (n - 1), snap: Infinity, free: true, flap: true, p: null, q: null, mesh: null});
		}
		// what the soft things are kept out of: the head and each piece, as balls (the head group's space)
		this.balls = [];
		for (let k = 0; k <= params.regions.length; k++) {
			const pts = [];
			for (const c of cut) if (!c.el.fake) for (let i = 0; i < c.region.length; i += 3) if (c.region[i] == k) pts.push(new THREE.Vector3().fromArray(c.base, i * 3));
			if (!pts.length) { this.balls.push(null); continue; }
			const ctr = pts.reduce((s2, p) => s2.add(p), new THREE.Vector3()).divideScalar(pts.length);
			const ext = pts.reduce((m, p) => Math.max(m, p.distanceTo(ctr)), 0);
			this.balls.push({c: ctr, r: ext * 0.62, w: new THREE.Vector3()});
		}
		// shreds at the edges of the wound: lumps of torn meat, and of bone where the skull is broken
		this.chunks = [];
		const cands = [];
		for (const c of cut) for (let i = 0; i < c.region.length; i += 3) if (c.tear[i] < R * 0.05 && (!c.el.fake || c.el.name == 'gore_skull')) cands.push([c, i]);
		const nch = Math.min(cands.length, 70);
		for (let s = 0; s < nch; s++) {
			const [c, i] = cands[Math.floor(rnd() * cands.length)];
			const bone = c.el.name == 'gore_skull';
			const out = new THREE.Vector3().fromArray(c.base, i * 3).sub(new THREE.Vector3(...params.c)).normalize();
			this.chunks.push({c, i, bone, size: R * (bone ? 0.03 + 0.04 * rnd() : 0.04 + 0.08 * rnd()), off: out.multiplyScalar(R * 0.02 * rnd()),
				rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28)), stretch: new THREE.Vector3(0.7 + 0.6 * rnd(), 0.5 + 0.5 * rnd(), 0.7 + 0.6 * rnd())});
		}
		this.chunk_meshes = null;
	}
	reset() { this.started = false; for (const s of this.strands) { s.p = null; s.free = !!s.flap; } }
	// world positions where the rigid weight-mapped head puts every vertex (Q(k): where piece k is, the head group's space)
	targets(Q) {
		const mats = this.mats = [null];
		const out = [];
		const p = new THREE.Vector3(), q = new THREE.Vector3();
		for (const c of this.cut) {
			const G = c.el.mesh.parent ? c.el.mesh.parent.matrixWorld : new THREE.Matrix4();
			const t = c.tw || (c.tw = new Float32Array(c.region.length * 3));
			for (let i = 0; i < c.region.length; i++) {
				const k = c.region[i];
				p.fromArray(c.base, i * 3);
				if (k) {
					if (mats[k] === undefined) mats[k] = Q(k);
					if (mats[k]) { q.copy(p).applyMatrix4(mats[k]); p.lerp(q, c.weight[i]); }
				}
				p.applyMatrix4(G);
				t[i * 3] = p.x; t[i * 3 + 1] = p.y; t[i * 3 + 2] = p.z;
				const j = c.pidx[i];
				if (j >= 0) { this.tgt[j * 3] = p.x; this.tgt[j * 3 + 1] = p.y; this.tgt[j * 3 + 2] = p.z; }
			}
			out.push(t);
		}
		return mats;
	}
	step(dt) {
		const R = this.params.R, g = 9.81 * SCALE, K = g / (0.13 * R);
		// (at the start, or after a jump along the timeline: everything is put back where it hangs at rest)
		if (!this.started || dt > 0.3) { this.x.set(this.tgt); this.v.fill(0); this.tgt0.set(this.tgt); this.started = true; dt = 0; for (const st of this.strands) st.p = null; }
		const steps = Math.ceil(dt / (1 / 120)), h = steps ? dt / steps : 0, maxd = 0.6 * R;
		for (let s = 0; s < steps; s++) {
			const f = (s + 1) / steps;
			for (let j = 0; j < this.n; j++) {
				const sj = this.soft[j], k = K * (1 - 0.8 * sj), c = 2 * Math.sqrt(k) * 0.22;
				for (let a = 0; a < 3; a++) {
					const ia = j * 3 + a, tg = this.tgt0[ia] + (this.tgt[ia] - this.tgt0[ia]) * f, tv = dt > 0 ? (this.tgt[ia] - this.tgt0[ia]) / dt : 0;
					let acc = k * (tg - this.x[ia]) - c * (this.v[ia] - tv);
					if (a == 1) acc -= g * sj * sj;
					this.v[ia] += acc * h;
					this.x[ia] += this.v[ia] * h;
				}
				// (flesh stretches, but only so far)
				const dx = this.x[j * 3] - this.tgt[j * 3], dy = this.x[j * 3 + 1] - this.tgt[j * 3 + 1], dz = this.x[j * 3 + 2] - this.tgt[j * 3 + 2], d = Math.hypot(dx, dy, dz);
				if (d > maxd) { const m = maxd / d; this.x[j * 3] = this.tgt[j * 3] + dx * m; this.x[j * 3 + 1] = this.tgt[j * 3 + 1] + dy * m; this.x[j * 3 + 2] = this.tgt[j * 3 + 2] + dz * m; }
			}
		}
		this.tgt0.set(this.tgt);
		this.stepStrands(dt);
	}
	// where a vertex is drawn now (scene space)
	at(c, i, out) {
		const j = c.pidx[i];
		return j >= 0 ? out.set(this.x[j * 3], this.x[j * 3 + 1], this.x[j * 3 + 2]) : out.fromArray(c.tw, i * 3);
	}
	stepStrands(dt) {
		const g = 9.81 * SCALE, A = new THREE.Vector3(), B = new THREE.Vector3(), R = this.params.R;
		const floor = this.params.floor ?? -1e9;
		// where the balls are now
		const balls = this.balls.map((b, k) => {
			if (!b) return null;
			const G = this.cut[0].el.mesh.parent ? this.cut[0].el.mesh.parent.matrixWorld : new THREE.Matrix4();
			b.w.copy(b.c);
			if (k && this.mats && this.mats[k]) b.w.applyMatrix4(this.mats[k]);
			b.w.applyMatrix4(G);
			return b;
		}).filter(Boolean);
		for (const s of this.strands) {
			this.at(s.a[0], s.a[1], A);
			if (s.b) this.at(s.b[0], s.b[1], B);
			if (!s.free && s.b && A.distanceTo(B) > s.rest * (s.n - 1) * s.snap) s.free = true;
			if (!s.p) {
				// (laid from the head towards the piece; torn already, or a flap, it hangs from the head: out and down)
				let dir, len;
				if (s.b && !s.free) { dir = B.clone().sub(A); len = dir.length(); dir.divideScalar(len || 1); }
				else {
					const out = A.clone().sub(balls[0] ? balls[0].w : A);
					dir = out.lengthSq() > 1e-8 ? out.normalize().add(new THREE.Vector3(0, -1.2, 0)).normalize() : new THREE.Vector3(0, -1, 0);
					len = s.rest * (s.n - 1);
				}
				s.p = []; s.q = [];
				for (let i = 0; i < s.n; i++) { const pt = A.clone().addScaledVector(dir, len * i / (s.n - 1)); s.p.push(pt); s.q.push(pt.clone()); }
			}
		}
		const steps = Math.min(Math.ceil(dt / (1 / 120)), 40), h = steps ? dt / steps : 0;
		const pin = () => {
			for (const s of this.strands) {
				this.at(s.a[0], s.a[1], A);
				s.p[0].copy(A);
				if (!s.free && s.b) { this.at(s.b[0], s.b[1], B); s.p[s.n - 1].copy(B); }
			}
		};
		for (let st = 0; st < steps; st++) {
			// heavy and slow, as wet meat: most of the speed is lost every step
			for (const s of this.strands) for (let i = 1; i < s.n; i++) {
				const p = s.p[i], q = s.q[i], nx = p.x + (p.x - q.x) * 0.95, ny = p.y + (p.y - q.y) * 0.95 - g * h * h, nz = p.z + (p.z - q.z) * 0.95;
				q.copy(p); p.set(nx, ny, nz);
			}
			for (let it = 0; it < 5; it++) {
				pin();
				for (const s of this.strands) {
					const last = s.free ? s.n : s.n - 1;
					for (let i = 0; i + 1 < s.n; i++) {
						const p = s.p[i], q = s.p[i + 1], d = p.distanceTo(q);
						if (d < 1e-6) continue;
						// (stretches a little before it pulls)
						const want = d > s.rest ? s.rest + (d - s.rest) * 0.3 : d;
						const corr = (d - want) / d * 0.5;
						const dx = (q.x - p.x) * corr, dy = (q.y - p.y) * corr, dz = (q.z - p.z) * corr;
						if (i > 0) { p.x += dx; p.y += dy; p.z += dz; }
						if (i + 1 < last) { q.x -= dx; q.y -= dy; q.z -= dz; }
					}
				}
				this.collide(balls, floor);
			}
		}
		pin();
	}
	// soft things do not go through each other, nor into the head and its pieces, nor through the floor
	collide(balls, floor) {
		const nodes = [];
		for (const s of this.strands) for (let i = 1; i < s.n; i++) {
			if (!s.free && i == s.n - 1) continue;   // (pinned)
			nodes.push({id: nodes.length, s, i, p: s.p[i], q: s.q[i], r: s.r * this.taper(s, i)});
		}
		// against each other: a grid of cells as big as the biggest
		const cell = Math.max(...nodes.map(n => n.r), 1e-3) * 2, grid = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
		for (const n of nodes) { const k = key(Math.floor(n.p.x / cell), Math.floor(n.p.y / cell), Math.floor(n.p.z / cell)); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(n); }
		for (const n of nodes) {
			const cx = Math.floor(n.p.x / cell), cy = Math.floor(n.p.y / cell), cz = Math.floor(n.p.z / cell);
			for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
				const l = grid.get(key(cx + x, cy + y, cz + z));
				if (!l) continue;
				for (const m of l) {
					if (m.id <= n.id || (m.s === n.s && Math.abs(m.i - n.i) <= 2)) continue;
					const dx = m.p.x - n.p.x, dy = m.p.y - n.p.y, dz = m.p.z - n.p.z, d = Math.hypot(dx, dy, dz), want = (n.r + m.r) * 0.9;
					if (d >= want || d < 1e-6) continue;
					const k = (want - d) / d * 0.5;
					n.p.x -= dx * k; n.p.y -= dy * k; n.p.z -= dz * k;
					m.p.x += dx * k; m.p.y += dy * k; m.p.z += dz * k;
				}
			}
		}
		for (const n of nodes) {
			// out of the head and the pieces (a strand from a ball's own surface still starts on it)
			for (const b of balls) {
				const dx = n.p.x - b.w.x, dy = n.p.y - b.w.y, dz = n.p.z - b.w.z, d = Math.hypot(dx, dy, dz), want = b.r + n.r * 0.5;
				if (d >= want || d < 1e-6) continue;
				const k = (want - d) / d;
				n.p.x += dx * k; n.p.y += dy * k; n.p.z += dz * k;
			}
			// on the floor: it lies there, and drags rather than slides
			if (n.p.y < floor + n.r * 0.6) { n.p.y = floor + n.r * 0.6; n.q.x += (n.p.x - n.q.x) * 0.6; n.q.z += (n.p.z - n.q.z) * 0.6; }
		}
	}
	taper(s, i) {
		const k = i / (s.n - 1);
		// a strand thins where it is pulled out between its ends; a flap is broad at the wound and narrows to its torn tip
		return s.flap ? 1 - 0.55 * k : 0.6 + 0.4 * Math.abs(k - 0.5) * 2;
	}
	// the strands and flaps as lumpy flattened ribbons of meat
	drawStrands(root) {
		const rings = 8;
		for (const s of this.strands) {
			if (!s.p) continue;
			if (!s.mesh) {
				const geo = new THREE.BufferGeometry();
				geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((s.n * rings + 2) * 3), 3));
				geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array((s.n * rings + 2) * 3), 3));
				const idx = [];
				for (let i = 0; i + 1 < s.n; i++) for (let r = 0; r < rings; r++) {
					const a = i * rings + r, b = i * rings + (r + 1) % rings, c2 = a + rings, d = b + rings;
					idx.push(a, c2, b, b, c2, d);
				}
				// (closed at both ends)
				const e0 = s.n * rings, e1 = e0 + 1;
				for (let r = 0; r < rings; r++) { idx.push(e0, r, (r + 1) % rings); idx.push(e1, (s.n - 1) * rings + (r + 1) % rings, (s.n - 1) * rings + r); }
				geo.setIndex(idx);
				s.mesh = new THREE.Mesh(geo, goreStrandMaterial());
				s.mesh.frustumCulled = false;
				s.mesh.castShadow = true; s.mesh.receiveShadow = true;
				root.add(s.mesh);
			}
			const pos = s.mesh.geometry.attributes.position, nrm = s.mesh.geometry.attributes.normal;
			const t = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
			for (let i = 0; i < s.n; i++) {
				const a = s.p[Math.max(i - 1, 0)], b = s.p[Math.min(i + 1, s.n - 1)];
				t.subVectors(b, a).normalize();
				u.crossVectors(t, Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize().applyAxisAngle(t, s.twist + i * 0.25);
				w.crossVectors(t, u);
				const r = s.r * this.taper(s, i);
				for (let j = 0; j < rings; j++) {
					const an = j / rings * Math.PI * 2, cx = Math.cos(an), cy = Math.sin(an) * s.flat, bm = s.bump[i * rings + j];
					const nx = u.x * cx + w.x * cy, ny = u.y * cx + w.y * cy, nzz = u.z * cx + w.z * cy;
					pos.setXYZ(i * rings + j, s.p[i].x + nx * r * bm, s.p[i].y + ny * r * bm, s.p[i].z + nzz * r * bm);
					const ln = Math.hypot(u.x * cx + w.x * cy / s.flat, u.y * cx + w.y * cy / s.flat, u.z * cx + w.z * cy / s.flat) || 1;
					nrm.setXYZ(i * rings + j, (u.x * cx + w.x * Math.sin(an) / s.flat) / ln, (u.y * cx + w.y * Math.sin(an) / s.flat) / ln, (u.z * cx + w.z * Math.sin(an) / s.flat) / ln);
				}
			}
			const e0 = s.n * rings;
			const d0 = s.p[0].clone().sub(s.p[1]).normalize(), d1 = s.p[s.n - 1].clone().sub(s.p[s.n - 2]).normalize();
			pos.setXYZ(e0, s.p[0].x + d0.x * s.r * 0.3, s.p[0].y + d0.y * s.r * 0.3, s.p[0].z + d0.z * s.r * 0.3); nrm.setXYZ(e0, d0.x, d0.y, d0.z);
			pos.setXYZ(e0 + 1, s.p[s.n - 1].x + d1.x * s.r * 0.3, s.p[s.n - 1].y + d1.y * s.r * 0.3, s.p[s.n - 1].z + d1.z * s.r * 0.3); nrm.setXYZ(e0 + 1, d1.x, d1.y, d1.z);
			pos.needsUpdate = true; nrm.needsUpdate = true;
			s.mesh.geometry.computeBoundingSphere();
		}
		this.drawChunks(root);
	}
	// the shreds, on the edges of the wound wherever those are now
	drawChunks(root) {
		if (!this.chunks.length) return;
		if (!this.chunk_meshes) {
			this.chunk_meshes = [false, true].map(bone => {
				const list = this.chunks.filter(c => c.bone == bone);
				if (!list.length) return null;
				const m = new THREE.InstancedMesh(goreLumpGeometry(), bone ? goreBoneMaterial(THREE.FrontSide) : goreStrandMaterial(), list.length);
				if (bone) { m.geometry = m.geometry.clone(); const col = new Float32Array(m.geometry.attributes.position.count * 3).fill(0.85); m.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
				m.frustumCulled = false;
				m.userData.list = list;
				root.add(m);
				return m;
			}).filter(Boolean);
		}
		const G = this.cut[0].el.mesh.parent ? this.cut[0].el.mesh.parent.matrixWorld : new THREE.Matrix4();
		const gq = new THREE.Quaternion(), gs = new THREE.Vector3(), gp = new THREE.Vector3();
		G.decompose(gp, gq, gs);
		const m4 = new THREE.Matrix4(), at = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
		for (const mesh of this.chunk_meshes) {
			mesh.userData.list.forEach((ch, n) => {
				this.at(ch.c, ch.i, at).add(ch.off.clone().applyQuaternion(gq));
				q.copy(gq).multiply(ch.rot);
				sc.copy(ch.stretch).multiplyScalar(ch.size);
				m4.compose(at, q, sc);
				mesh.setMatrixAt(n, m4);
			});
			mesh.instanceMatrix.needsUpdate = true;
		}
	}
	dispose() {
		for (const s of this.strands) if (s.mesh) { if (s.mesh.parent) s.mesh.parent.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh = null; }
		for (const m of this.chunk_meshes || []) { if (m.parent) m.parent.remove(m); m.dispose && m.dispose(); }
		this.chunk_meshes = null;
	}
}

// a lump of torn meat: a ball pushed in and out, rough and uneven
let gore_lump_geo = null;
function goreLumpGeometry() {
	if (gore_lump_geo) return gore_lump_geo;
	const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, nz = goreNoise(77), seen = new Map();
	for (let i = 0; i < p.count; i++) {
		const key = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
		let k = seen.get(key);
		if (k === undefined) { k = 0.65 + 0.6 * nz(p.getX(i) * 2.5 + 3, p.getY(i) * 2.5, p.getZ(i) * 2.5); seen.set(key, k); }
		p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
	}
	g.computeVertexNormals();
	return (gore_lump_geo = g);
}

let gore_strand_mat = null;
function goreStrandMaterial() {
	return gore_strand_mat || (gore_strand_mat = new THREE.MeshStandardMaterial({color: 0x7a100c, roughness: 0.22, metalness: 0, envMapIntensity: 0.7, emissive: 0x220302}));
}

// where to hang the strands (they are drawn in the scene's own space)
function goreSceneRoot() { return typeof scene != 'undefined' && scene ? scene : (typeof Canvas != 'undefined' && Canvas.scene) || null; }

// puts the cut meshes in place of the head's own, drawn where the soft head is now; `Q(k)` is where piece k is moved to
// (the head group's space), or null
function goreApply(cut, Q, soft, dt) {
	for (const c of cut) {
		const el = c.el;
		if (!el.mesh) continue;
		// (Blockbench may have rebuilt the element's mesh: the cut goes back on)
		if (el.mesh.geometry !== c.geo) {
			c.orig = el.mesh.geometry;
			el.mesh.geometry = c.geo;
			if (c.orig && c.orig.attributes.skyocc && !c.geo.attributes.skyocc) c.geo.setAttribute('skyocc', new THREE.Float32BufferAttribute(new Float32Array(c.geo.attributes.position.count), 1));
		}
		// (what is drawn over the head's own surfaces - the blood on him - goes with the cut too)
		for (const ch of el.mesh.children) if (ch !== c.inner && ch.geometry && c.orig && ch.geometry === c.orig) { ch.geometry = c.geo; (c.over || (c.over = [])).push(ch); }
		if (!c.inner || c.inner.parent !== el.mesh) {
			c.inner = new THREE.Mesh(c.geo, el.inner_mat || goreFleshMaterial());
			c.inner.renderOrder = 1;
			el.mesh.add(c.inner);
		}
		el.mesh.updateMatrixWorld(true);
	}
	const mats = soft.targets(Q);
	soft.step(dt);
	const p = new THREE.Vector3(), q = new THREE.Vector3(), nv = new THREE.Vector3();
	for (const c of cut) {
		const el = c.el;
		if (!el.mesh) continue;
		const inv = el.mesh.matrixWorld.clone().invert();
		const pos = c.geo.attributes.position, nrm = c.geo.attributes.normal;
		const mR = new THREE.Matrix3().setFromMatrix4(c.M), mRi = new THREE.Matrix3().setFromMatrix4(c.Minv);
		for (let i = 0; i < c.region.length; i++) {
			soft.at(c, i, p).applyMatrix4(inv);
			pos.setXYZ(i, p.x, p.y, p.z);
			const k = c.region[i], w = c.weight[i];
			if (nrm && c.base_n) {
				nv.fromArray(c.base_n, i * 3);
				if (k && mats[k] && w > 0) { q.copy(nv).applyMatrix3(mR).applyMatrix3(new THREE.Matrix3().setFromMatrix4(mats[k])).applyMatrix3(mRi); nv.lerp(q, w).normalize(); }
				nrm.setXYZ(i, nv.x, nv.y, nv.z);
			}
		}
		pos.needsUpdate = true;
		if (nrm) nrm.needsUpdate = true;
		c.geo.computeBoundingSphere();
	}
	const root = goreSceneRoot();
	if (root) soft.drawStrands(root);
}

function goreRestore(cut, soft) {
	if (soft) soft.dispose();
	for (const c of cut) {
		const el = c.el;
		if (c.inner && c.inner.parent) c.inner.parent.remove(c.inner);
		for (const ch of c.over || []) if (ch.geometry === c.geo && c.orig) ch.geometry = c.orig;
		if (el.mesh && el.mesh.geometry === c.geo && c.orig) el.mesh.geometry = c.orig;
		// (the skull and the brain are only there while the head is open)
		if (el.fake && el.mesh.parent) { el.mesh.parent.remove(el.mesh); if (c.orig) c.orig.dispose(); }
		c.geo.dispose();
	}
}

// how a head breaks: the planes, the pieces and where each one hangs from, in the head group's space (pixels)
function goreParams(bot, point, dir, impulse) {
	const g = bot.head.group;
	g.mesh.updateMatrixWorld(true);
	const inv = g.mesh.matrixWorld.clone().invert(), rot = new THREE.Matrix3().setFromMatrix4(inv);
	const els = goreElements(g);
	const box = new THREE.Box3();
	for (const el of els) { el.mesh.updateMatrix(); el.mesh.geometry.computeBoundingBox(); box.union(el.mesh.geometry.boundingBox.clone().applyMatrix4(el.mesh.matrix)); }
	const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), R = Math.max(size.x, size.y, size.z) * 0.5;
	// the head's own axes: up, and the way the face looks (its rest pose: the character faces north, -Z, or south)
	const u = new THREE.Vector3(0, 1, 0), f = new THREE.Vector3(0, 0, bot.s.facing == 'south' ? 1 : -1);
	const sd = dir.clone().applyMatrix3(rot).normalize();
	let side = sd.clone().cross(u);
	if (side.length() < 0.3) side = f.clone().cross(u);
	side.normalize();
	const plane = (n, at) => ({n: n.toArray(), d: n.dot(at)});
	const P = v => c.clone().add(v);
	const k = impulse / Math.max(bot.s.extra_head_min || 6, 0.1), r = Math.random();
	let mode = k >= 1.6 ? (r < 0.5 ? 'burst' : r < 0.75 ? 'split' : 'face') : (r < 0.55 ? 'face' : 'split');
	if (globalThis.__GORE_MODE) mode = globalThis.__GORE_MODE;   // (tests)
	const jit = () => (Math.random() - 0.5) * 0.2 * R;
	// (the floor under him, in the scene's pixels: what hangs and falls lies on it)
	const floor = new THREE.Vector3(0, bot.groundY(), 0).multiplyScalar(SCALE).applyMatrix4(bot.modelMatrix()).y;
	const params = {mode, R, planes: [], regions: [], hinges: [], seed: 1 + Math.floor(Math.random() * 1e6), rag: 0.14, floor,
		c: c.toArray(), half: size.clone().multiplyScalar(0.5).toArray(), right: f.clone().cross(u).normalize().toArray()};
	if (mode == 'face') {
		params.planes.push(plane(f, P(f.clone().multiplyScalar(0.2 * R + jit()))));
		params.regions.push([[0, 1]]);
		params.hinges.push(P(f.clone().multiplyScalar(0.55 * R).addScaledVector(u, -0.8 * R)).toArray());
	} else if (mode == 'split') {
		const tilt = side.clone().applyAxisAngle(f, (Math.random() - 0.5) * 0.5);
		params.planes.push(plane(tilt, P(sd.clone().multiplyScalar(jit()))));
		params.planes.push(plane(u, P(u.clone().multiplyScalar(-0.45 * R + jit()))));
		params.regions.push([[1, 1], [0, 1]], [[1, 1], [0, -1]]);
		params.hinges.push(P(u.clone().multiplyScalar(-0.45 * R).addScaledVector(tilt, 0.55 * R)).toArray(), P(u.clone().multiplyScalar(-0.45 * R).addScaledVector(tilt, -0.55 * R)).toArray());
	} else {
		const a1 = side.clone().applyAxisAngle(u, (Math.random() - 0.5) * 0.8), a2 = a1.clone().applyAxisAngle(u, Math.PI / 2 + (Math.random() - 0.5) * 0.6);
		params.planes.push(plane(u, P(u.clone().multiplyScalar(-0.05 * R + jit()))));
		params.planes.push(plane(a1, P(new THREE.Vector3(jit(), 0, jit()))));
		params.planes.push(plane(a2, P(new THREE.Vector3(jit(), 0, jit()))));
		params.planes.push(plane(f, P(f.clone().multiplyScalar(0.25 * R))));
		params.regions.push([[0, 1], [1, 1], [2, 1]], [[0, 1], [1, 1], [2, -1]], [[0, 1], [1, -1], [2, 1]], [[0, 1], [1, -1], [2, -1]], [[0, -1], [3, 1]]);
		params.hinges.push(null, null, null, null, P(f.clone().multiplyScalar(0.5 * R).addScaledVector(u, -0.8 * R)).toArray());
	}
	return {params, els};
}

// a head broken open in the simulation
class HeadGore {
	constructor(bot, point, dir, impulse) {
		this.bot = bot;
		const J = this.J = bot.J, w = bot.world;
		const {params, els} = goreParams(bot, point, dir, impulse);
		this.params = params;
		this.cut = goreCut(els.concat(goreInnards(params, bot.head.group.mesh)), params);
		this.soft = new GoreSoft(this.cut, params);
		this.last_show = null;
		this.t = bot._time;
		const g = bot.head.group;
		g.mesh.updateMatrixWorld(true);
		this.Hg0 = g.mesh.matrixWorld.clone();
		// pixels of the scene <-> metres of the physics
		const Spx = bot.modelMatrix().multiply(new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE));
		this.Hb0 = this.bodyMatrix(bot.head.body);
		this.G = this.Hg0.clone().invert().multiply(Spx).multiply(this.Hb0);
		this.Ginv = this.G.clone().invert();
		const toWorld = Spx.clone().invert().multiply(this.Hg0);   // head group space -> metres
		const head_mass = 1 / Math.max(bot.head.body.GetMotionProperties().GetInverseMass(), 1e-6);
		const head_v = bot.lin(bot.head);
		this.pieces = [];
		const total = this.cut.reduce((s, c) => s + (c.el.fake ? 0 : c.region.length), 0) || 1;
		for (let k = 1; k <= params.regions.length; k++) {
			const pts = [];
			for (const c of this.cut) for (let i = 0; i < c.region.length; i++) if (c.region[i] == k) pts.push(new THREE.Vector3().fromArray(c.base, i * 3).applyMatrix4(toWorld));
			if (pts.length < 4) { this.pieces.push(null); continue; }
			let own = 0;
			for (const c of this.cut) if (!c.el.fake) for (let i = 0; i < c.region.length; i++) if (c.region[i] == k) own++;
			const com = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
			const hull = new J.ConvexHullShapeSettings();
			// (a piece no thinner than a centimetre: a flap of skin still has some body to it)
			for (const p of pts) { const d = p.clone().sub(com); hull.mPoints.push_back(new J.Vec3(d.x, d.y, d.z)); }
			hull.mPoints.push_back(new J.Vec3(0.005, 0.005, 0.005)); hull.mPoints.push_back(new J.Vec3(-0.005, -0.005, -0.005));
			const res = hull.Create();
			if (res.HasError()) { this.pieces.push(null); continue; }
			const jp = new J.RVec3(com.x, com.y, com.z), jq = new J.Quat(0, 0, 0, 1);
			const bcs = new J.BodyCreationSettings(res.Get(), jp, jq, J.EMotionType_Dynamic, 1);
			const share = Math.max(own, 1) / total;
			bcs.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
			bcs.mMassPropertiesOverride.mMass = Math.max(0.05, head_mass * share);
			bcs.mFriction = 0.8; bcs.mRestitution = 0.02;
			bcs.mLinearDamping = 0.3; bcs.mAngularDamping = 1.5;   // (soft, wet: it does not bounce or spin for long)
			bcs.mMotionQuality = J.EMotionQuality_LinearCast;
			bcs.mCollisionGroup.SetGroupFilter(bot.filter);
			bcs.mCollisionGroup.SetGroupID(bot.group_id);
			bcs.mCollisionGroup.SetSubGroupID(bot.gore_base + Math.min(k - 1, GORE_SLOTS - 1));
			const hinge = params.hinges[k - 1];
			// thrown the way the bullet goes; a free piece hard, a hanging one only so far as the flesh lets it
			const out = com.clone().sub(bot.pos(bot.head)).normalize();
			const v = head_v.clone().addScaledVector(dir, hinge ? 1.5 : Math.min(impulse / Math.max(head_mass * share, 0.2) * 0.35, 14)).addScaledVector(out, hinge ? 1.2 : 2.5 + Math.random() * 2);
			bcs.mLinearVelocity = new J.Vec3(v.x, v.y, v.z);
			const sp = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(hinge ? 4 : 25);
			bcs.mAngularVelocity = new J.Vec3(sp.x, sp.y, sp.z);
			const body = w.bodies.CreateBody(bcs);
			J.destroy(bcs); J.destroy(jp); J.destroy(jq);
			w.bodies.AddBody(body.GetID(), J.EActivation_Activate);
			const piece = {k, body, id: body.GetID(), P0inv: null, hinge: hinge ? new THREE.Vector3(...hinge).applyMatrix4(toWorld) : null, constraint: null, drip: Math.random() * 0.3, mass: head_mass * share};
			piece.P0inv = this.bodyMatrix(body).invert();
			if (piece.hinge) {
				try {
					const st = new J.PointConstraintSettings();
					st.mSpace = J.EConstraintSpace_WorldSpace;
					st.mPoint1 = new J.RVec3(piece.hinge.x, piece.hinge.y, piece.hinge.z);
					st.mPoint2 = new J.RVec3(piece.hinge.x, piece.hinge.y, piece.hinge.z);
					piece.constraint = J.castObject(st.Create(bot.head.body, body), J.PointConstraint);
					w.system.AddConstraint(piece.constraint);
				} catch (err) { console.warn('[Ragdoll] gore hinge', err); }
			}
			this.pieces.push(piece);
		}
		addPeopleToRays(bot.rt, this.pieces.filter(Boolean).map(p => p.id));
		// the blood: a burst from the open head, and from every piece as it comes away
		if (bot.blood) {
			try {
				bot.blood.exit_splatter(bot.pos(bot.head), dir, 1.4, null);
				for (const p of this.pieces) if (p) {
					const at = this.bodyPos(p.body);
					for (let i = 0; i < 14; i++) bot.blood.spawn_drop(at.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.05)),
						this.bodyVel(p.body).add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(3)), 0.05 + Math.random() * 0.4);
				}
			} catch (err) { console.warn('[Ragdoll] gore blood', err); }
		}
		// the torn edges are soaked: the blood on him there at once
		try {
			let n = 0;
			for (const c of this.cut) for (let i = 0; i < c.region.length && n < 60; i += 7) if (c.tear[i] < params.R * 0.08) {
				bot.paint_blood(bot.head, new THREE.Vector3().fromArray(c.base, i * 3).applyMatrix4(toWorld), 0.025 * bot.scale_factor, 0.9);
				n++;
			}
		} catch (err) { console.warn('[Ragdoll] gore blood', err); }
		this.rec = {t: this.t, head: g.uuid, els: els.map(e => e.uuid), params, frames: []};
	}
	bodyMatrix(b) {
		const p = b.GetPosition(), q = b.GetRotation();
		return new THREE.Matrix4().compose(new THREE.Vector3(p.GetX(), p.GetY(), p.GetZ()), new THREE.Quaternion(q.GetX(), q.GetY(), q.GetZ(), q.GetW()), new THREE.Vector3(1, 1, 1));
	}
	bodyPos(b) { const p = b.GetPosition(); return new THREE.Vector3(p.GetX(), p.GetY(), p.GetZ()); }
	bodyVel(b) { const v = b.GetLinearVelocity(); return new THREE.Vector3(v.GetX(), v.GetY(), v.GetZ()); }
	// where piece k is now, in the head group's space: G [Hb(t)^-1 P(t)] [P0^-1 Hb0] G^-1
	Q(k) {
		const p = this.pieces[k - 1];
		if (!p) return null;
		const A = this.bodyMatrix(this.bot.head.body).invert().multiply(this.bodyMatrix(p.body)).multiply(p.P0inv).multiply(this.Hb0);
		return this.G.clone().multiply(A).multiply(this.Ginv);
	}
	// what hangs and lies about drips
	step(dt) {
		const blood = this.bot.blood;
		if (!blood) return;
		for (const p of this.pieces) {
			if (!p) continue;
			p.drip -= dt;
			if (p.drip > 0) continue;
			const age = this.bot._time - this.t;
			p.drip = 0.08 + age * 0.12 + Math.random() * 0.2;
			if (age > 20) continue;
			const at = this.bodyPos(p.body).add(new THREE.Vector3(0, -0.03, 0));
			try { blood.spawn_drop(at, this.bodyVel(p.body), 0.03 + Math.random() * 0.12 / (1 + age), null, 0, true); } catch (err) { /* blood gone */ }
		}
	}
	show() {
		const now = this.bot._time, dt = this.last_show === null ? 0 : Math.max(0, now - this.last_show);
		this.last_show = now;
		goreApply(this.cut, k => this.Q(k), this.soft, dt);
	}
	record(time) { this.rec.frames.push({t: time, q: this.pieces.map((p, i) => { const m = this.Q(i + 1); return m ? Array.from(m.elements) : null; })}); }
	dispose() { goreRestore(this.cut, this.soft); }
}

// the Animate tab: the broken heads of the selected animation at the time of the timeline
class GorePlayer {
	constructor(recs) { this.recs = recs; this.live = []; }
	show(t) {
		this.recs.forEach((rec, i) => {
			let live = this.live[i];
			if (t < rec.t - 1e-6) { if (live) { goreRestore(live.cut, live.soft); this.live[i] = null; } return; }
			if (!live) {
				const els = rec.els.map(u => (Mesh.all.find(e => e.uuid == u) || Cube.all.find(e => e.uuid == u))).filter(Boolean);
				const g = Group.all.find(x => x.uuid == rec.head);
				const cut = goreCut(g && g.mesh ? els.concat(goreInnards(rec.params, g.mesh)) : els, rec.params);
				live = this.live[i] = {cut, soft: new GoreSoft(cut, rec.params), last: rec.t};
			}
			// (the soft flesh is simulated along the timeline: played back from the start when the time goes back)
			if (t < live.last - 1e-6) live.soft.reset();
			const dt = Math.max(0, t - live.last);
			live.last = t;
			let f = 0;
			while (f + 1 < rec.frames.length && rec.frames[f + 1].t <= t + 1e-6) f++;
			const fr = rec.frames[f];
			goreApply(live.cut, k => fr && fr.q[k - 1] ? new THREE.Matrix4().fromArray(fr.q[k - 1]) : null, live.soft, dt);
		});
	}
	dispose() { for (const l of this.live) if (l) goreRestore(l.cut, l.soft); this.live = []; }
}

let gore_player = null, gore_player_anim = null;
function stopGorePlayback() { if (gore_player) gore_player.dispose(); gore_player = null; gore_player_anim = null; }
function updateGorePlayback() {
	try {
		const animation = Project && typeof Modes != 'undefined' && Modes.animate && typeof Animation != 'undefined' && Animation.selected;
		const recs = animation && gore_bakes.get(animation.uuid);
		if (!recs || !recs.length) { stopGorePlayback(); return; }
		if (gore_player_anim !== animation.uuid) { stopGorePlayback(); gore_player = new GorePlayer(recs); gore_player_anim = animation.uuid; }
		gore_player.show(Timeline.time);
	} catch (err) { console.warn('[Ragdoll] gore playback', err); stopGorePlayback(); }
}
