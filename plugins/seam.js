(function () {
'use strict';

/*
 * Seam — right click two (or more) intersecting cubes / meshes and pick "Seam".
 * A small window lets you set the strength (fillet radius) and the polygon count.
 * Along the line where the objects meet, a smooth concave fillet is generated as a new mesh
 * that blends one surface into the other. The original objects are not modified.
 */

const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Intersection of two triangle soups
// ---------------------------------------------------------------------------

function makeTriangle(a, b, c) {
	const n = b.clone().sub(a).cross(c.clone().sub(a));
	const len = n.length();
	if (len < 1e-10) return null;
	n.divideScalar(len);
	return {
		a, b, c, n,
		d: n.dot(a),
		min: new THREE.Vector3(Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.min(a.z, b.z, c.z)),
		max: new THREE.Vector3(Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y), Math.max(a.z, b.z, c.z)),
	};
}

// where a triangle crosses the plane of another one: two points, or null
function crossPlane(t, n, d) {
	const v = [t.a, t.b, t.c];
	const dist = v.map(p => n.dot(p) - d);
	if (dist.every(x => x > EPS) || dist.every(x => x < -EPS)) return null;
	if (dist.every(x => Math.abs(x) <= EPS)) return null;   // coplanar
	const pts = [];
	for (let i = 0; i < 3; i++) {
		const j = (i + 1) % 3;
		if (Math.abs(dist[i]) <= EPS) pts.push(v[i].clone());
		if ((dist[i] > EPS && dist[j] < -EPS) || (dist[i] < -EPS && dist[j] > EPS)) {
			pts.push(v[i].clone().lerp(v[j], dist[i] / (dist[i] - dist[j])));
		}
	}
	if (pts.length < 2) return null;
	let best = [pts[0], pts[1]], best_len = pts[0].distanceTo(pts[1]);
	for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
		const l = pts[i].distanceTo(pts[j]);
		if (l > best_len) { best_len = l; best = [pts[i], pts[j]]; }
	}
	return best;
}

function intersectTriangles(ta, tb) {
	const dir = ta.n.clone().cross(tb.n);
	if (dir.lengthSq() < 1e-10) return null;   // parallel
	dir.normalize();
	const sa = crossPlane(ta, tb.n, tb.d);
	if (!sa) return null;
	const sb = crossPlane(tb, ta.n, ta.d);
	if (!sb) return null;
	const ra = [dir.dot(sa[0]), dir.dot(sa[1])].sort((x, y) => x - y);
	const rb = [dir.dot(sb[0]), dir.dot(sb[1])].sort((x, y) => x - y);
	const lo = Math.max(ra[0], rb[0]), hi = Math.min(ra[1], rb[1]);
	if (hi - lo < 1e-5) return null;
	const base = sa[0];
	const at = t => base.clone().addScaledVector(dir, t - dir.dot(base));
	return {p: at(lo), q: at(hi), nA: ta.n, nB: tb.n};
}

function boxOf(tris) {
	const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
	tris.forEach(t => { min.min(t.min); max.max(t.max); });
	return {min, max};
}
const overlaps = (a, b) =>
	a.min.x <= b.max.x && a.max.x >= b.min.x &&
	a.min.y <= b.max.y && a.max.y >= b.min.y &&
	a.min.z <= b.max.z && a.max.z >= b.min.z;

// every line segment where the surface of one object crosses the surface of another
function findSeams(lists) {
	const segments = [];
	for (let i = 0; i < lists.length; i++) {
		for (let j = i + 1; j < lists.length; j++) {
			const boxA = boxOf(lists[i]), boxB = boxOf(lists[j]);
			if (!overlaps(boxA, boxB)) continue;
			const A = lists[i].filter(t => overlaps(t, boxB));
			const B = lists[j].filter(t => overlaps(t, boxA));
			for (const ta of A) {
				for (const tb of B) {
					if (!overlaps(ta, tb)) continue;
					const seg = intersectTriangles(ta, tb);
					if (seg) {
						seg.ta = ta; seg.tb = tb; seg.listA = lists[i]; seg.listB = lists[j];
						segments.push(seg);
					}
				}
			}
		}
	}
	return segments;
}

// ---------------------------------------------------------------------------
// Fillet generation
// ---------------------------------------------------------------------------

// closest point of triangle tri to p (Ericson, Real-Time Collision Detection)
function closestOnTriangle(p, tri) {
	const {a, b, c} = tri;
	const ab = b.clone().sub(a), ac = c.clone().sub(a), ap = p.clone().sub(a);
	const d1 = ab.dot(ap), d2 = ac.dot(ap);
	if (d1 <= 0 && d2 <= 0) return a.clone();
	const bp = p.clone().sub(b);
	const d3 = ab.dot(bp), d4 = ac.dot(bp);
	if (d3 >= 0 && d4 <= d3) return b.clone();
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) return a.clone().addScaledVector(ab, d1 / (d1 - d3));
	const cp = p.clone().sub(c);
	const d5 = ab.dot(cp), d6 = ac.dot(cp);
	if (d6 >= 0 && d5 <= d6) return c.clone();
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) return a.clone().addScaledVector(ac, d2 / (d2 - d6));
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
		return b.clone().addScaledVector(c.clone().sub(b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
	}
	const denom = 1 / (va + vb + vc);
	return a.clone().addScaledVector(ab, vb * denom).addScaledVector(ac, vc * denom);
}

// signed distance to a closed surface (positive outside), its gradient and the closest surface point
function probe(list, p) {
	let best = Infinity, point = null, tri = null;
	for (const t of list) {
		// cheap reject: the box of the triangle is already farther than the best hit
		const dx = Math.max(t.min.x - p.x, 0, p.x - t.max.x);
		const dy = Math.max(t.min.y - p.y, 0, p.y - t.max.y);
		const dz = Math.max(t.min.z - p.z, 0, p.z - t.max.z);
		if (dx * dx + dy * dy + dz * dz >= best) continue;
		const q = closestOnTriangle(p, t);
		const d2 = q.distanceToSquared(p);
		if (d2 < best) { best = d2; point = q; tri = t; }
	}
	const dist = Math.sqrt(best);
	const out = p.clone().sub(point);
	const sign = out.dot(tri.n) >= 0 ? 1 : -1;
	const grad = dist > 1e-12 ? out.divideScalar(dist).multiplyScalar(sign) : tri.n.clone();
	return {s: sign * dist, grad, point};
}

/**
 * Rolling ball fillet. For every point C of the junction a ball of the given radius is placed so that
 * it touches both objects; the fillet profile is the arc of that ball between the two touching points.
 * segments: [{p, q, nA, nB, listA, listB}]   radius: ball radius   segs: polygons across the seam
 */
function buildSeam(segments, radius, segs) {
	const TOL = 1e-3;
	const nodes = [];
	const cells = new Map();
	const cellKey = (x, y, z) => x + ',' + y + ',' + z;
	function nodeFor(p, s) {
		const cx = Math.round(p.x / TOL), cy = Math.round(p.y / TOL), cz = Math.round(p.z / TOL);
		for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
			const list = cells.get(cellKey(x, y, z));
			if (!list) continue;
			for (const idx of list) if (nodes[idx].pos.distanceTo(p) < TOL * 2) return nodes[idx];
		}
		const node = {pos: p.clone(), nA: new THREE.Vector3(), nB: new THREE.Vector3(), tangent: new THREE.Vector3(),
			listA: s.listA, listB: s.listB, keys: null};
		nodes.push(node);
		const k = cellKey(cx, cy, cz);
		if (!cells.has(k)) cells.set(k, []);
		cells.get(k).push(nodes.length - 1);
		return node;
	}

	const links = [];
	segments.forEach(s => {
		const u = nodeFor(s.p, s), v = nodeFor(s.q, s);
		if (u === v) return;
		const dir = s.q.clone().sub(s.p).normalize();
		[u, v].forEach(n => {
			n.nA.add(s.nA); n.nB.add(s.nB);
			n.tangent.add(n.tangent.lengthSq() > 0 && n.tangent.dot(dir) < 0 ? dir.clone().negate() : dir);
		});
		links.push({u, v, normal: s.nA.clone().add(s.nB)});
	});

	const vertices = {};
	let uid = 0;
	const addVertex = p => { const key = 's' + (uid++).toString(36); vertices[key] = p.toArray(); return key; };
	const stats = {unconverged: 0, inserted: 0};

	// ball of radius r touching both objects, its centre lying in the plane through P with normal n
	function solveBall(listA, listB, P, n, starts, anchor, max_dist, r) {
		const residual = (c, a, b) => Math.max(Math.abs(a.s - r), Math.abs(b.s - r), Math.abs(n.dot(c.clone().sub(P))));
		const solve = start => {
			let c = start, a = probe(listA, c), b = probe(listB, c), res = residual(c, a, b);
			for (let it = 0; it < 40 && res > 1e-7; it++) {
				const J = new THREE.Matrix3().set(
					a.grad.x, a.grad.y, a.grad.z,
					b.grad.x, b.grad.y, b.grad.z,
					n.x, n.y, n.z);
				if (Math.abs(J.determinant()) < 1e-6) break;
				const step = new THREE.Vector3(-(a.s - r), -(b.s - r), -n.dot(c.clone().sub(P))).applyMatrix3(J.invert());
				if (step.length() > r) step.multiplyScalar(r / step.length());
				// backtracking: take the longest step that lowers the residual
				let moved = false;
				for (let f = 1; f > 0.05; f /= 2) {
					const c2 = c.clone().addScaledVector(step, f);
					const a2 = probe(listA, c2), b2 = probe(listB, c2), res2 = residual(c2, a2, b2);
					if (res2 < res) { c = c2; a = a2; b = b2; res = res2; moved = true; break; }
				}
				if (!moved) break;
			}
			return {c, a, b, res, r};
		};
		let best = null;
		for (const start of starts) {
			const ball = solve(start);
			const sane = ball.a.s > r * 0.5 && ball.b.s > r * 0.5 && ball.c.distanceTo(anchor) < max_dist;
			if (sane && (!best || ball.res < best.res)) best = ball;
			if (best && best.res < 1e-6) break;
		}
		return best;
	}

	// 1. a ball at every point of the junction. In a sharp crease a full size ball would sit far away and
	//    the seam would turn into a long tongue (or break off), so there the ball shrinks and the seam narrows.
	const REACH = 3;   // the ball centre stays within about 3 radii of the junction
	const solveNode = (node, extra_starts) => {
		const nA = node.nA.clone().normalize(), nB = node.nB.clone().normalize();
		const bis = nA.clone().add(nB);
		if (bis.lengthSq() < 1e-6) return null;   // the surfaces face away from each other
		bis.normalize();
		const k = Math.max(0.02, (bis.dot(nA) + bis.dot(nB)) / 2);   // = sin(half the crease angle)
		const tangent = node.tangent.clone().normalize();
		let r = Math.min(radius, REACH * radius * k);
		let best = null;
		for (let attempt = 0; attempt < 5; attempt++, r *= 0.6) {
			const starts = [1, 0.75, 1.3, 0.55, 1.8].map(f => node.pos.clone().addScaledVector(bis, r / k * f));
			const ball = solveBall(node.listA, node.listB, node.pos, tangent, extra_starts.concat(starts), node.pos, Math.max(r / k * 2.5, r * 4), r);
			if (ball && (!best || ball.res < best.res)) best = ball;
			if (best && best.res < 1e-4) break;
		}
		return best;
	};
	nodes.forEach(node => { node.ball = solveNode(node, []); });
	// junction points that failed get a second try, starting from the balls of their neighbours
	links.forEach(({u, v}) => {
		if (!u.ball && v.ball) u.ball = solveNode(u, [v.ball.c]);
		if (!v.ball && u.ball) v.ball = solveNode(v, [u.ball.c]);
	});
	nodes.forEach(n => { if (n.ball && n.ball.res > 1e-3) stats.unconverged++; });

	// 2. where the ball has to roll around an edge or a corner, follow it with extra positions
	const contactDir = (ball, side) => ball[side].point.clone().sub(ball.c).normalize();
	const MAX_TURN = Math.cos(Math.degToRad(20));
	function refine(b1, b2, listA, listB, depth) {
		if (depth >= 5) return [];
		if (contactDir(b1, 'a').dot(contactDir(b2, 'a')) > MAX_TURN && contactDir(b1, 'b').dot(contactDir(b2, 'b')) > MAX_TURN) return [];
		const r = (b1.r + b2.r) / 2;
		const chord = b2.c.clone().sub(b1.c);
		if (chord.length() < r * 0.05) return [];
		const P = b1.c.clone().add(b2.c).multiplyScalar(0.5);
		const mid = solveBall(listA, listB, P, chord.clone().normalize(), [P, b1.c, b2.c], P, r * 4 + chord.length(), r);
		if (!mid || mid.res > 1e-4) return [];
		stats.inserted++;
		return [...refine(b1, mid, listA, listB, depth + 1), mid, ...refine(mid, b2, listA, listB, depth + 1)];
	}

	// 3. profile: arc of the ball between its two touching points
	function arcPoints(ball) {
		const va = ball.a.point.clone().sub(ball.c), vb = ball.b.point.clone().sub(ball.c);
		const la = va.length(), lb = vb.length();
		if (la < 1e-9 || lb < 1e-9) return null;
		va.divideScalar(la); vb.divideScalar(lb);
		const angle = Math.acos(Math.max(-1, Math.min(1, va.dot(vb))));
		if (angle < 1e-4) return null;
		const sinA = Math.sin(angle);
		const pts = [];
		for (let i = 0; i <= segs; i++) {
			const f = i / segs;
			const dir = va.clone().multiplyScalar(Math.sin((1 - f) * angle) / sinA).addScaledVector(vb, Math.sin(f * angle) / sinA);
			pts.push(ball.c.clone().addScaledVector(dir, la + (lb - la) * f));
		}
		return pts;
	}

	// 4. order the junction into chains so the seam can be simplified along its length
	nodes.forEach(n => { n.nei = []; });
	links.forEach(l => { l.u.nei.push(l); l.v.nei.push(l); });
	const walked = new Set();
	const chains = [];
	function walk(start, link) {
		const seq = [start];
		let cur = start, l = link;
		while (l && !walked.has(l)) {
			walked.add(l);
			cur = l.u === cur ? l.v : l.u;
			seq.push(cur);
			if (cur.nei.length != 2) break;
			l = cur.nei.find(x => !walked.has(x));
		}
		return seq;
	}
	nodes.forEach(n => { if (n.nei.length != 2) n.nei.forEach(l => { if (!walked.has(l)) chains.push(walk(n, l)); }); });
	links.forEach(l => { if (!walked.has(l)) chains.push(walk(l.u, l)); });   // closed loops

	// drop profiles that lie (almost) on the straight blend between their neighbours
	const SIMPLIFY_TOL = radius * 0.04;
	function simplify(items) {
		const keep = items.map((_, i) => i == 0 || i == items.length - 1);
		const along = [0];
		for (let i = 1; i < items.length; i++) along.push(along[i - 1] + items[i].ball.c.distanceTo(items[i - 1].ball.c));
		const stack = [[0, items.length - 1]];
		while (stack.length) {
			const [i, j] = stack.pop();
			if (j <= i + 1) continue;
			let worst = 0, idx = -1;
			for (let m = i + 1; m < j; m++) {
				const f = along[j] > along[i] ? (along[m] - along[i]) / (along[j] - along[i]) : 0.5;
				let err = 0;
				for (let p = 0; p <= segs; p++) {
					err = Math.max(err, items[m].pts[p].distanceTo(items[i].pts[p].clone().lerp(items[j].pts[p], f)));
				}
				if (err > worst) { worst = err; idx = m; }
			}
			if (worst > SIMPLIFY_TOL) { keep[idx] = true; stack.push([i, idx], [idx, j]); }
		}
		return items.filter((_, i) => keep[i]);
	}

	const faces = [];
	const ends = [];
	const keys_of = new Map();
	function keysFor(item) {
		if (!keys_of.has(item.ball)) {
			const keys = item.pts.map(addVertex);
			ends.push(keys[0], keys[segs]);
			keys_of.set(item.ball, keys);
		}
		return keys_of.get(item.ball);
	}
	function strip(k1, k2, center) {
		for (let i = 0; i < segs; i++) {
			let ks = [k1[i], k1[i + 1], k2[i + 1], k2[i]];
			const pts = ks.map(k => new THREE.Vector3().fromArray(vertices[k]));
			const n = new THREE.Vector3();
			for (let j = 0; j < 4; j++) {
				const p = pts[j], q = pts[(j + 1) % 4];
				n.x += (p.y - q.y) * (p.z + q.z);
				n.y += (p.z - q.z) * (p.x + q.x);
				n.z += (p.x - q.x) * (p.y + q.y);
			}
			if (n.lengthSq() < 1e-14) continue;
			// the visible side of the fillet faces the centre of the ball
			const centroid = pts.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(4);
			if (n.dot(center.clone().sub(centroid)) < 0) ks = ks.reverse();
			faces.push(ks);
		}
	}
	const item_of = new Map();
	const itemFor = ball => {
		if (!item_of.has(ball)) {
			const pts = arcPoints(ball);
			item_of.set(ball, pts ? {ball, pts} : null);
		}
		return item_of.get(ball);
	};
	chains.forEach(chain => {
		// split the chain where a ball is missing, refine each pair of neighbours
		let piece = [];
		const flush = () => {
			if (piece.length >= 2) {
				const kept = simplify(piece);
				for (let i = 1; i < kept.length; i++) {
					strip(keysFor(kept[i - 1]), keysFor(kept[i]), kept[i - 1].ball.c.clone().add(kept[i].ball.c).multiplyScalar(0.5));
				}
			}
			piece = [];
		};
		for (let i = 0; i < chain.length; i++) {
			const node = chain[i];
			const item = node.ball && itemFor(node.ball);
			if (!item) { flush(); continue; }
			if (piece.length) {
				const prev = piece[piece.length - 1];
				for (const ball of refine(prev.ball, node.ball, node.listA, node.listB, 0)) {
					const mid = itemFor(ball);
					if (mid) piece.push(mid);
				}
			}
			piece.push(item);
		}
		flush();
	});

	const used = new Set();
	faces.forEach(f => f.forEach(k => used.add(k)));
	for (const k in vertices) if (!used.has(k)) delete vertices[k];
	return {vertices, faces, ends: ends.filter(k => used.has(k)), missing: nodes.filter(n => !n.ball).length,
		nodes: nodes.length, unconverged: stats.unconverged, inserted: stats.inserted};
}

if (typeof __SEAM_EXPORT !== 'undefined') __SEAM_EXPORT({makeTriangle, findSeams, buildSeam});
if (typeof Plugin === 'undefined' || typeof Blockbench === 'undefined') return;

// ---------------------------------------------------------------------------
// Blockbench integration
// ---------------------------------------------------------------------------

let action = null;
let open_dialog = null;

// triangles of an element in world space, wound counter-clockwise when seen from outside
function collectTriangles(element) {
	const obj = element.mesh;
	if (!obj || !obj.geometry || !obj.geometry.attributes.position) return [];
	obj.updateWorldMatrix(true, false);
	const pos = obj.geometry.attributes.position;
	const index = obj.geometry.index;
	const flip = obj.matrixWorld.determinant() < 0;
	const count = index ? index.count : pos.count;
	const point = i => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(obj.matrixWorld);
	const tris = [];
	for (let i = 0; i + 2 < count; i += 3) {
		let a = point(i), b = point(i + 1), c = point(i + 2);
		if (flip) [b, c] = [c, b];
		const t = makeTriangle(a, b, c);
		if (t) tris.push(t);
	}
	return tris;
}

function openSeamDialog() {
	if (open_dialog) return;
	const elements = Outliner.selected.filter(e => e instanceof Cube || e instanceof Mesh);
	if (elements.length < 2) {
		Blockbench.showQuickMessage('Seam: select at least two objects', 2500);
		return;
	}
	const segments = findSeams(elements.map(collectTriangles));
	if (!segments.length) {
		Blockbench.showQuickMessage('Seam: the selected objects do not intersect', 2500);
		return;
	}

	Undo.initEdit({outliner: true, elements: [], selection: true});
	let mesh = null;

	function preview(form) {
		const geo = buildSeam(segments, Math.max(0.01, Number(form.radius) || 0), Math.max(1, Math.round(Number(form.segments) || 1)));
		if (!mesh) {
			mesh = new Mesh({name: 'Seam', origin: [0, 0, 0], rotation: [0, 0, 0], vertices: []});
			mesh.addTo('root').init();
		}
		mesh.vertices = geo.vertices;
		mesh.faces = {};
		geo.faces.forEach(keys => {
			const uv = {};
			keys.forEach(k => { uv[k] = [0, 0]; });
			mesh.addFaces(new MeshFace(mesh, {vertices: keys, uv}));
		});
		mesh.shading = form.smooth ? 'smooth' : 'flat';
		Canvas.updateView({elements: [mesh], element_aspects: {geometry: true, uv: true, faces: true}});
	}

	const dialog = open_dialog = new Dialog({
		id: 'seam_dialog',
		title: 'Seam',
		width: 340,
		darken: false,
		form: {
			radius: {label: 'Strength (radius)', type: 'number', value: 2, min: 0.05, max: 200, step: 0.25},
			segments: {label: 'Polygons', type: 'number', value: 4, min: 1, max: 48, step: 1},
			smooth: {label: 'Smooth shading', type: 'checkbox', value: true},
		},
		onFormChange(form) { preview(form); },
		onConfirm(form) {
			open_dialog = null;
			preview(form);
			Undo.finishEdit('Create seam', {outliner: true, elements: [mesh], selection: true});
		},
		onCancel() {
			open_dialog = null;
			if (mesh) mesh.remove();
			Undo.cancelEdit(false);
			updateSelection();
		},
	});
	dialog.show();
	preview(dialog.getFormResult());
}

Plugin.register('seam', {
	title: 'Seam',
	author: 'Claude',
	description: 'Right click two intersecting objects, choose Seam: a smooth fillet blends one into the other.',
	about: 'Select two or more intersecting cubes or meshes, right click and choose **Seam** at the bottom of the menu. Set the strength (fillet radius) and the number of polygons in the small window and confirm. The seam is created as a new mesh; the original objects are untouched.',
	icon: 'blur_linear',
	version: '0.1.0',
	variant: 'both',
	min_version: '4.8.0',
	tags: ['Modeling'],
	onload() {
		action = new Action('seam', {
			name: 'Seam',
			description: 'Create a smooth fillet where the selected objects intersect',
			icon: 'blur_linear',
			category: 'edit',
			condition: () => Modes.edit && Outliner.selected.filter(e => e instanceof Cube || e instanceof Mesh).length >= 2,
			click() { openSeamDialog(); },
		});
		Cube.prototype.menu.addAction(action);
		Mesh.prototype.menu.addAction(action);
	},
	onunload() {
		if (open_dialog) open_dialog.cancel();
		Cube.prototype.menu.removeAction(action);
		Mesh.prototype.menu.removeAction(action);
		if (action) action.delete();
		action = null;
	},
});

})();
