(function () {
'use strict';

/*
 * Connect — joins two meshes with a pipe (or any tube).
 *
 * Select one face (or a few) on a mesh and one on another mesh, right click, choose "Connect faces". A window opens with
 * a live preview: set the smoothing, the polygons along the pipe and pick the way it takes (smooth curve, straight, elbows),
 * add waypoints (movable markers, or simply select extra objects together with the meshes) and let it go around obstacles.
 * The pipe starts exactly on the edges of the chosen faces, so cross sections of any shape (square, round, odd) are carried over.
 */

const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Geometry (works on plain numbers and THREE vectors, no Blockbench in here)
// ---------------------------------------------------------------------------

// ordered boundary of a group of faces. faces: [{keys: [vertex keys in winding order]}]; position(key) -> THREE.Vector3 (world)
function boundaryLoop(faces, position) {
	const directed = new Map();   // "a>b" -> [a, b]
	for (const keys of faces) for (let i = 0; i < keys.length; i++) directed.set(keys[i] + '>' + keys[(i + 1) % keys.length], [keys[i], keys[(i + 1) % keys.length]]);
	const edges = [];
	for (const [id, [a, b]] of directed) if (!directed.has(b + '>' + a)) edges.push([a, b]);   // not shared with a neighbour in the group = on the boundary
	if (!edges.length) return null;
	const next = new Map();
	for (const [a, b] of edges) { if (!next.has(a)) next.set(a, []); next.get(a).push(b); }
	const used = new Set(), loops = [];
	for (const [a0] of edges) {
		if (used.has(a0)) continue;
		const loop = [a0];
		used.add(a0);
		let cur = a0;
		for (let guard = 0; guard < edges.length + 2; guard++) {
			const options = (next.get(cur) || []).filter(v => v == a0 || !used.has(v));
			if (!options.length) break;
			const n = options[0];
			if (n == a0) break;
			loop.push(n); used.add(n); cur = n;
		}
		if (loop.length >= 3) loops.push(loop);
	}
	if (!loops.length) return null;
	const perimeter = loop => loop.reduce((s, k, i) => s + position(k).distanceTo(position(loop[(i + 1) % loop.length])), 0);
	loops.sort((p, q) => perimeter(q) - perimeter(p));
	const keys = loops[0], points = keys.map(position);
	const center = points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(points.length);
	// Newell normal: points to the side the loop is wound counter-clockwise from (outward for faces of a closed mesh)
	const normal = new THREE.Vector3();
	for (let i = 0; i < points.length; i++) {
		const p = points[i], q = points[(i + 1) % points.length];
		normal.x += (p.y - q.y) * (p.z + q.z); normal.y += (p.z - q.z) * (p.x + q.x); normal.z += (p.x - q.x) * (p.y + q.y);
	}
	if (normal.lengthSq() < EPS) return null;
	normal.normalize();
	return {keys, points, center, normal};
}

// n points spread evenly along a closed polygon, starting at its first point
function resampleLoop(points, n) {
	if (points.length == n) return points.map(p => p.clone());
	const lens = points.map((p, i) => p.distanceTo(points[(i + 1) % points.length]));
	const total = lens.reduce((a, b) => a + b, 0);
	const out = [];
	let seg = 0, acc = 0;
	for (let k = 0; k < n; k++) {
		const target = total * k / n;
		while (seg < points.length - 1 && acc + lens[seg] < target) { acc += lens[seg]; seg++; }
		const t = lens[seg] > EPS ? (target - acc) / lens[seg] : 0;
		out.push(points[seg].clone().lerp(points[(seg + 1) % points.length], Math.max(0, Math.min(1, t))));
	}
	return out;
}

const smooth = t => t * t * (3 - 2 * t);

/**
 * The way of the pipe as (segments + 1) points, evenly spaced.
 * a, b: {center, normal} (normal points out of the mesh).  opts: {mode: 'curve'|'straight'|'elbow', smoothing 0..1, waypoints: [Vector3], segments, obstacles: [Box3], clearance}
 */
function buildPath(a, b, opts) {
	const segments = Math.max(2, opts.segments || 16);
	const waypoints = opts.keepOrder ? (opts.waypoints || []).map(w => w.clone()) : orderWaypoints(a.center, opts.waypoints || []);
	const dist = a.center.distanceTo(b.center);
	let points;
	if (opts.mode == 'straight') {
		points = [a.center, ...waypoints, b.center];
		return spaced(new THREE.CatmullRomCurve3(points.map(p => p.clone()), false, 'catmullrom', 0), segments, true);
	}
	if (opts.mode == 'elbow') {
		return spaced(elbowCurve(a, b, waypoints, opts.smoothing), segments, false);
	}
	// smooth curve: leave each face straight out along its normal, then bend toward the next point
	const lead = Math.max(0.5, opts.smoothing * dist * 0.4 / Math.sqrt(1 + waypoints.length));
	points = [a.center, a.center.clone().addScaledVector(a.normal, lead), ...waypoints, b.center.clone().addScaledVector(b.normal, lead), b.center];
	let path = spaced(new THREE.CatmullRomCurve3(points, false, 'centripetal'), segments, false);
	if (opts.obstacles && opts.obstacles.length) path = avoidObstacles(path, opts.obstacles, opts.clearance || 1);
	return path;
}

// visit waypoints in the order that keeps the way short (a chain of nearest ones, from the start)
function orderWaypoints(start, waypoints) {
	const left = waypoints.map(w => w.clone()), out = [];
	let cur = start;
	while (left.length) {
		let best = 0;
		for (let i = 1; i < left.length; i++) if (left[i].distanceTo(cur) < left[best].distanceTo(cur)) best = i;
		cur = left.splice(best, 1)[0];
		out.push(cur);
	}
	return out;
}

function spaced(curve, segments, polyline) {
	const dense = curve.getSpacedPoints(segments * 6);
	return resamplePolyline(dense, segments);
}
function resamplePolyline(points, segments) {
	const lens = [0];
	for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + points[i].distanceTo(points[i - 1]));
	const total = lens[lens.length - 1] || 1, out = [];
	let j = 0;
	for (let k = 0; k <= segments; k++) {
		const target = total * k / segments;
		while (j < points.length - 2 && lens[j + 1] < target) j++;
		const span = lens[j + 1] - lens[j];
		out.push(points[j].clone().lerp(points[j + 1], span > EPS ? Math.max(0, Math.min(1, (target - lens[j]) / span)) : 0));
	}
	return out;
}

// right-angle route with rounded corners (radius from the smoothing)
function elbowCurve(a, b, waypoints, smoothing) {
	const dist = a.center.distanceTo(b.center);
	const lead = Math.max(1, dist * 0.12);
	const start = a.center.clone().addScaledVector(a.normal, lead), end = b.center.clone().addScaledVector(b.normal, lead);
	const stops = [start, ...waypoints, end];
	const route = [a.center.clone(), start];
	for (let i = 1; i < stops.length; i++) {
		const p = route[route.length - 1], q = stops[i];
		const d = q.clone().sub(p), axes = [0, 1, 2].sort((m, n) => Math.abs(d.getComponent(n)) - Math.abs(d.getComponent(m)));
		const cur = p.clone();
		for (const axis of axes.slice(0, 2)) {   // all but the last axis; the last one is the move onto the stop itself
			if (Math.abs(d.getComponent(axis)) < EPS) continue;
			cur.setComponent(axis, q.getComponent(axis));
			route.push(cur.clone());
		}
		route.push(q.clone());
	}
	route.push(b.center.clone());
	// drop doubled points
	const clean = route.filter((p, i) => i == 0 || p.distanceTo(route[i - 1]) > 1e-4);
	const radius = Math.max(0, smoothing) * 0.5;
	const path = new THREE.CurvePath();
	const lerpPoint = (p, q, t) => p.clone().lerp(q, t);
	let from = clean[0].clone();
	for (let i = 1; i < clean.length - 1; i++) {
		const prev = clean[i - 1], corner = clean[i], nxt = clean[i + 1];
		const l1 = prev.distanceTo(corner), l2 = corner.distanceTo(nxt);
		const cut = radius * Math.min(l1, l2) * 0.9;
		const inPoint = lerpPoint(corner, prev, l1 > EPS ? cut / l1 : 0), outPoint = lerpPoint(corner, nxt, l2 > EPS ? cut / l2 : 0);
		if (from.distanceTo(inPoint) > EPS) path.add(new THREE.LineCurve3(from.clone(), inPoint));
		if (cut > EPS) path.add(new THREE.QuadraticBezierCurve3(inPoint, corner.clone(), outPoint));
		from = outPoint;
	}
	path.add(new THREE.LineCurve3(from.clone(), clean[clean.length - 1].clone()));
	return path;
}

// pushes points that are inside a box out through the nearest side, and evens the way out between the pushes
function avoidObstacles(path, boxes, clearance) {
	const pts = path.map(p => p.clone());
	const push = () => {
		let moved = false;
		for (const box of boxes) {
			const grown = box.clone().expandByScalar(clearance);
			const inside = [];
			for (let i = 1; i < pts.length - 1; i++) if (grown.containsPoint(pts[i])) inside.push(i);
			if (!inside.length) continue;
			// one side for the whole stretch inside this obstacle (the cheapest), so the pipe goes around it, not through it.
			// Never along the way the pipe is heading (that would just squash the stretch together)
			const heading = pts[Math.min(pts.length - 1, inside[inside.length - 1] + 1)].clone().sub(pts[Math.max(0, inside[0] - 1)]);
			const along = [0, 1, 2].reduce((m, a) => Math.abs(heading.getComponent(a)) > Math.abs(heading.getComponent(m)) ? a : m, 0);
			let best = null, bestCost = Infinity;
			for (let axis = 0; axis < 3; axis++) for (const side of [-1, 1]) {
				if (axis == along) continue;
				const edge = side < 0 ? grown.min.getComponent(axis) : grown.max.getComponent(axis);
				let cost = 0;
				for (const i of inside) cost += Math.abs(pts[i].getComponent(axis) - edge);
				if (cost < bestCost) { bestCost = cost; best = {axis, edge}; }
			}
			for (const i of inside) pts[i].setComponent(best.axis, best.edge);
			moved = true;
		}
		return moved;
	};
	for (let pass = 0; pass < 10; pass++) {
		push();
		// relax: every point moves toward the middle of its neighbours (the ends stay), then push again
		for (let i = 2; i < pts.length - 2; i++) pts[i].lerp(pts[i - 1].clone().add(pts[i + 1]).multiplyScalar(0.5), 0.25);
	}
	push();
	return resamplePolyline(pts, path.length - 1);
}

/**
 * The tube between two loops along a path.  loopA / loopB: {points, center, normal}.  Returns {rings: [[Vector3...]], faces: [[r,k,r,k...]]}
 * sides: points per ring.  twist: extra shift of the matching.
 */
function buildTube(loopA, loopB, path, sides, twist) {
	const n = Math.max(3, sides);
	const A = resampleLoop(loopA.points, n), B = resampleLoop(loopB.points, n);
	const M = path.length - 1;
	// tangents
	const T = path.map((p, i) => {
		const t = (path[Math.min(M, i + 1)].clone().sub(path[Math.max(0, i - 1)]));
		return t.lengthSq() > EPS ? t.normalize() : new THREE.Vector3(0, 1, 0);
	});
	// frames carried along the way without twisting
	const U = [], V = [];
	let ref = A[0].clone().sub(loopA.center);
	ref.addScaledVector(T[0], -ref.dot(T[0]));
	if (ref.lengthSq() < EPS) ref = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(T[0]) : new THREE.Vector3(1, 0, 0).cross(T[0]);
	U[0] = ref.normalize(); V[0] = new THREE.Vector3().crossVectors(T[0], U[0]).normalize();
	for (let i = 1; i <= M; i++) {
		const q = new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]);
		U[i] = U[i - 1].clone().applyQuaternion(q).normalize();
		V[i] = new THREE.Vector3().crossVectors(T[i], U[i]).normalize();
	}
	const coords = (pts, center, u, v) => pts.map(p => { const d = p.clone().sub(center); return [d.dot(u), d.dot(v)]; });
	const a2 = coords(A, loopA.center, U[0], V[0]), b2 = coords(B, loopB.center, U[M], V[M]);
	// which point of B goes with which of A (and in which direction): the least total distance, so the pipe does not twist
	let bestCost = Infinity, bestShift = 0, bestDir = 1;
	for (const dir of [1, -1]) for (let shift = 0; shift < n; shift++) {
		let cost = 0;
		for (let k = 0; k < n; k++) {
			const q = b2[((dir * k + shift) % n + n) % n];
			cost += (a2[k][0] - q[0]) ** 2 + (a2[k][1] - q[1]) ** 2;
		}
		if (cost < bestCost) { bestCost = cost; bestShift = shift; bestDir = dir; }
	}
	const pick = k => ((bestDir * k + bestShift + (twist || 0)) % n + n) % n;
	// the first and last ring must sit exactly on the edges of the chosen faces, also when the pipe leaves them at an angle
	const errA = A.map((p, k) => p.clone().sub(path[0].clone().addScaledVector(U[0], a2[k][0]).addScaledVector(V[0], a2[k][1])));
	const errB = A.map((_, k) => { const q = b2[pick(k)]; return B[pick(k)].clone().sub(path[M].clone().addScaledVector(U[M], q[0]).addScaledVector(V[M], q[1])); });
	const rings = [];
	for (let i = 0; i <= M; i++) {
		const t = i / M, w = smooth(t), ring = [];
		const fadeA = 1 - smooth(Math.min(1, t / 0.35)), fadeB = smooth(Math.max(0, (t - 0.65) / 0.35));
		for (let k = 0; k < n; k++) {
			const q = b2[pick(k)];
			const x = a2[k][0] + (q[0] - a2[k][0]) * w, y = a2[k][1] + (q[1] - a2[k][1]) * w;
			ring.push(path[i].clone().addScaledVector(U[i], x).addScaledVector(V[i], y).addScaledVector(errA[k], fadeA).addScaledVector(errB[k], fadeB));
		}
		rings.push(ring);
	}
	// quads between neighbouring rings, wound so the outside faces out
	const quads = [];
	for (let i = 0; i < M; i++) for (let k = 0; k < n; k++) quads.push([[i, k], [i, (k + 1) % n], [i + 1, (k + 1) % n], [i + 1, k]]);
	const mid = quads[Math.floor(quads.length / 2)];
	const p = ([ri, ki]) => rings[ri][ki];
	const normal = new THREE.Vector3().crossVectors(p(mid[1]).clone().sub(p(mid[0])), p(mid[3]).clone().sub(p(mid[0])));
	const radial = p(mid[0]).clone().sub(path[mid[0][0]]);
	if (normal.dot(radial) < 0) quads.forEach(q => q.reverse());
	return {rings, quads, sides: n, segments: M};
}

if (typeof __PIPE_EXPORT !== 'undefined') __PIPE_EXPORT({boundaryLoop, resampleLoop, buildPath, buildTube, orderWaypoints, avoidObstacles, startConnect, saveConnect, cancelConnect, selectedFaceKeys, loopOf, getSession: () => session, pickPoint, onPointerDown, onPointerMove, onPointerUp, onKey, tick});
if (typeof Plugin === 'undefined' || typeof Blockbench === 'undefined') return;

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

const TEXTS = {
	en: {
		connect: 'Connect faces…', connect_desc: 'Join the selected faces of two meshes with a pipe',
		title: 'Connect faces', smoothing: 'Smoothing', smoothing_tip: 'How round the pipe bends. 0 = sharp, 1 = wide soft curves',
		path: 'Path', path_curve: 'Smooth curve', path_straight: 'Straight', path_elbow: 'Elbows (right angles)',
		segments: 'Polygons along the pipe', sides: 'Sides around', avoid: 'Go around other objects', remove_faces: 'Remove the chosen faces (open the holes)',
		flip_a: 'Flip start direction', flip_b: 'Flip end direction', shading: 'Smooth shading',
		add_point: 'Add point', add_point_tip: 'Adds a point on the path. Drag points with the mouse: Shift = only up / down, Alt = only along the ground',
		delete_point: 'Delete point', delete_point_tip: 'Deletes the selected point (or press Delete)', clear_points: 'Remove all points',
		save: 'Save', cancel: 'Cancel', points: 'Points', start: 'Start', end: 'End',
		msg_select: 'Connect: select two meshes and one or more faces on each (face selection mode)',
		msg_loop: 'Connect: the chosen faces have no open edge (select a part of the surface, not the whole closed shape)',
		msg_done: 'Pipe created', msg_busy: 'Finish the current connection first (Save or Cancel)',
	},
	ru: {
		connect: 'Соединить грани…', connect_desc: 'Соединить выбранные грани двух мешей трубой',
		title: 'Соединение граней', smoothing: 'Сглаживание', smoothing_tip: 'Насколько круто труба гнётся. 0 = резко, 1 = широкие мягкие дуги',
		path: 'Путь', path_curve: 'Плавная кривая', path_straight: 'Прямо', path_elbow: 'Коленами (прямые углы)',
		segments: 'Полигонов вдоль трубы', sides: 'Граней вокруг', avoid: 'Обходить другие объекты', remove_faces: 'Убрать выбранные грани (открыть отверстия)',
		flip_a: 'Развернуть начало', flip_b: 'Развернуть конец', shading: 'Гладкое затенение',
		add_point: 'Добавить точку', add_point_tip: 'Добавляет точку на пути. Точки тащатся мышью: Shift = только вверх / вниз, Alt = только по земле',
		delete_point: 'Удалить точку', delete_point_tip: 'Удаляет выбранную точку (или клавиша Delete)', clear_points: 'Убрать все точки',
		save: 'Сохранить', cancel: 'Отмена', points: 'Точки', start: 'Начало', end: 'Конец',
		msg_select: 'Соединение: выделите два меша и по одной или нескольким граням на каждом (режим выбора граней)',
		msg_loop: 'Соединение: у выбранных граней нет открытого края (выделите часть поверхности, а не всю замкнутую форму)',
		msg_done: 'Труба создана', msg_busy: 'Сначала закончите текущее соединение (Сохранить или Отмена)',
	},
};
const tr = key => {
	const lang = (typeof Language != 'undefined' && Language.code) || 'en';
	return (TEXTS[lang] && TEXTS[lang][key]) || TEXTS.en[key] || key;
};

// ---------------------------------------------------------------------------
// Reading the selection
// ---------------------------------------------------------------------------

const facePoints = face => face.getSortedVertices ? face.getSortedVertices() : face.vertices;

function selectedFaceKeys(mesh) {
	let faces = mesh.getSelectedFaces ? mesh.getSelectedFaces() : [];
	if (!faces.length && mesh.getSelectedVertices) {
		// only points are selected: faces whose corners are all selected count
		const picked = new Set(mesh.getSelectedVertices());
		if (picked.size >= 3) faces = Object.keys(mesh.faces).filter(fk => facePoints(mesh.faces[fk]).every(k => picked.has(k)));
	}
	return faces.slice();
}
const meshesWithFaces = () => Mesh.selected.map(mesh => ({mesh, faces: selectedFaceKeys(mesh)})).filter(x => x.faces.length);

// the open edge of the chosen faces of a mesh, in world space, with the direction that leads out of the mesh
function loopOf(mesh, faceKeys) {
	mesh.mesh.updateWorldMatrix(true, false);
	const M = mesh.mesh.matrixWorld, flipped = M.determinant() < 0;
	const position = key => new THREE.Vector3(...mesh.vertices[key]).applyMatrix4(M);
	const faces = faceKeys.map(fk => { const keys = facePoints(mesh.faces[fk]).slice(); return flipped ? keys.reverse() : keys; });
	const loop = boundaryLoop(faces, position);
	if (!loop) return null;
	// make the direction point out of the mesh (a closed shape: away from its middle)
	const box = new THREE.Box3();
	Object.values(mesh.vertices).forEach(v => box.expandByPoint(new THREE.Vector3(...v).applyMatrix4(M)));
	const away = loop.center.clone().sub(box.getCenter(new THREE.Vector3()));
	if (away.dot(loop.normal) < 0) loop.normal.negate();
	return loop;
}

// ---------------------------------------------------------------------------
// The connection in progress: points on a path, a curve through them, a side panel. Nothing blocks the 3D view.
// ---------------------------------------------------------------------------

let action = null, add_action = null, clear_action = null, save_action = null, cancel_action = null, panel = null, style_node = null;
let session = null, drag = null, poll = null;
const centerOf = element => new THREE.Box3().setFromObject(element.mesh).getCenter(new THREE.Vector3());
const DEFAULTS = {path: 'curve', smoothing: 0.5, segments: 16, sides: 8, avoid: false, shading: true, remove_faces: true, flip_a: false, flip_b: false};

const previewCamera = () => (typeof Preview != 'undefined' && Preview.selected && Preview.selected.camera) || null;

function startConnect() {
	if (session) { Blockbench.showQuickMessage(tr('msg_busy'), 2500); return; }
	const picked = meshesWithFaces();
	if (picked.length != 2) { Blockbench.showQuickMessage(tr('msg_select'), 3500); return; }
	const [pa, pb] = picked;
	const loopA = loopOf(pa.mesh, pa.faces), loopB = loopOf(pb.mesh, pb.faces);
	if (!loopA || !loopB) { Blockbench.showQuickMessage(tr('msg_loop'), 3500); return; }
	// other selected objects start the path as points
	const extras = Outliner.selected.filter(el => el.mesh && el !== pa.mesh && el !== pb.mesh);
	const obstacles = [...Cube.all, ...Mesh.all].filter(el => el.mesh && el.mesh.visible !== false && el !== pa.mesh && el !== pb.mesh && !extras.includes(el));
	const texture = (() => { for (const fk of pa.faces) { const t = pa.mesh.faces[fk].texture; if (t !== undefined && t !== null) return t; } return false; })();
	const radiusOf = loop => loop.points.reduce((sum, p) => sum + p.distanceTo(loop.center), 0) / loop.points.length;
	session = {pa, pb, loopA, loopB, texture, obstacles, points: extras.map(centerOf), selected: -1, signature: '', path: null,
		pipe_radius: Math.max(radiusOf(loopA), radiusOf(loopB)), line: null, sprites: [], ends: [], defaults: Object.assign({}, DEFAULTS, {sides: Math.max(loopA.keys.length, loopB.keys.length, 6)})};
	if (panel && panel.inside_vue) panel.inside_vue.reset(session.defaults);
	showPanel(true);
	poll = setInterval(tick, 100);
	tick();
}

function showPanel(visible) {
	try {
		if (typeof updateInterface == 'function') updateInterface();
		if (visible && panel) { if (panel.toggle) panel.toggle(true); if (panel.slot == 'hidden' && panel.moveTo) panel.moveTo('right_bar'); }
	} catch (err) { console.warn('[Connect]', err); }
}

const valuesNow = () => Object.assign({twist: 0}, session ? (panel && panel.inside_vue ? panel.inside_vue.f : session.defaults) : DEFAULTS);

function currentPath(values) {
	const a = {center: session.loopA.center, normal: session.loopA.normal.clone().multiplyScalar(values.flip_a ? -1 : 1), points: session.loopA.points};
	const b = {center: session.loopB.center, normal: session.loopB.normal.clone().multiplyScalar(values.flip_b ? -1 : 1), points: session.loopB.points};
	const bounds = () => session.obstacles.map(el => new THREE.Box3().setFromObject(el.mesh)).filter(box => !box.isEmpty());
	const path = buildPath(a, b, {mode: values.path, smoothing: values.smoothing, segments: Math.max(8, Math.round(values.segments)), waypoints: session.points, keepOrder: true,
		obstacles: values.avoid ? bounds() : null, clearance: session.pipe_radius + 1});
	return {a, b, path};
}

// -- what is drawn in the 3D view: the curve, the points (flat icons), the start and the end --

const point_icons = new Map();
function pointIcon(label, color) {
	const key = label + color;
	if (point_icons.has(key)) return point_icons.get(key);
	const size = 96, canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const c = canvas.getContext('2d');
	c.fillStyle = 'rgba(16,18,22,0.88)'; c.beginPath(); c.arc(48, 48, 44, 0, Math.PI * 2); c.fill();
	c.strokeStyle = color; c.lineWidth = 8; c.beginPath(); c.arc(48, 48, 41, 0, Math.PI * 2); c.stroke();
	c.fillStyle = color; c.font = 'bold 44px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(label), 48, 52);
	const texture = new THREE.CanvasTexture(canvas);
	point_icons.set(key, texture);
	return texture;
}
function makeSprite(label, color) {
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: pointIcon(label, color), sizeAttenuation: false, depthTest: false, transparent: true}));
	sprite.renderOrder = 1000;
	scene.add(sprite);
	return sprite;
}
function iconScale() {
	const cam = previewCamera();
	return cam && cam.isOrthographicCamera ? (cam.top - cam.bottom) / (cam.zoom || 1) * 0.03 : 0.036;
}

function syncHelpers() {
	if (!session) return;
	const scale = iconScale();
	// start and end
	if (!session.ends.length) session.ends = [makeSprite('S', '#6ee86e'), makeSprite('E', '#ff7a6a')];
	session.ends[0].position.copy(session.loopA.center);
	session.ends[1].position.copy(session.loopB.center);
	session.ends.forEach(sp => sp.scale.setScalar(scale));
	// numbered points
	while (session.sprites.length > session.points.length) { const sp = session.sprites.pop(); scene.remove(sp); sp.material.dispose(); }
	session.points.forEach((p, i) => {
		const color = i == session.selected ? '#ffb347' : '#35d0ff';
		if (!session.sprites[i]) session.sprites[i] = makeSprite(i + 1, color);
		const sp = session.sprites[i];
		if (sp.userData.color != color || sp.userData.n != i + 1) { sp.material.map = pointIcon(i + 1, color); sp.material.needsUpdate = true; sp.userData = {color, n: i + 1}; }
		sp.position.copy(p);
		sp.scale.setScalar(scale);
	});
	// the curve
	if (session.line) { scene.remove(session.line); session.line.geometry.dispose(); session.line.material.dispose(); session.line = null; }
	if (session.path) {
		const curve = new THREE.CatmullRomCurve3(session.path.map(p => p.clone()));
		session.line = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, session.path.length * 2), 0.28, 5, false), new THREE.MeshBasicMaterial({color: 0x35d0ff, depthTest: false, transparent: true, opacity: 0.9}));
		session.line.renderOrder = 998;
		scene.add(session.line);
	}
}

function removeHelpers() {
	if (!session) return;
	[...session.sprites, ...session.ends].forEach(sp => { scene.remove(sp); sp.material.dispose(); });
	if (session.line) { scene.remove(session.line); session.line.geometry.dispose(); session.line.material.dispose(); }
}

// called many times a second: redraw when the settings or the points changed
function tick() {
	if (!session) return;
	const values = valuesNow();
	const signature = JSON.stringify([values.path, values.smoothing, values.segments, values.avoid, values.flip_a, values.flip_b, session.points.map(p => p.toArray().map(n => +n.toFixed(2))), session.selected]);
	if (signature != session.signature) {
		session.signature = signature;
		try { session.path = currentPath(values).path; } catch (err) { console.warn('[Connect]', err); }
		syncHelpers();
		if (panel && panel.inside_vue) { panel.inside_vue.count = session.points.length; panel.inside_vue.selected = session.selected; }
	}
}

// -- points --

function addPoint() {
	if (!session) return;
	const chain = [session.loopA.center, ...session.points, session.loopB.center];
	let gap = 0, longest = -1;
	chain.forEach((p, i) => { if (i < chain.length - 1) { const d = p.distanceTo(chain[i + 1]); if (d > longest) { longest = d; gap = i; } } });
	const middle = chain[gap].clone().lerp(chain[gap + 1], 0.5);
	// on the curve itself, near the middle of that gap
	let at = middle;
	if (session.path) { let best = Infinity; for (const p of session.path) { const d = p.distanceTo(middle); if (d < best) { best = d; at = p.clone(); } } }
	session.points.splice(gap, 0, at);
	session.selected = gap;
	tick();
}
function deletePoint() {
	if (!session || !session.points.length) return;
	const i = session.selected >= 0 ? session.selected : session.points.length - 1;
	session.points.splice(i, 1);
	session.selected = -1;
	tick();
}
function clearPoints() {
	if (!session) return;
	session.points = []; session.selected = -1;
	tick();
}

// -- the mouse: points are picked and dragged in the 3D view (Blockbench never sees these clicks) --

function screenOf(p, preview) {
	const rect = preview.canvas.getBoundingClientRect(), v = p.clone().project(preview.camera);
	if (v.z > 1 || v.z < -1) return null;
	return {x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height, rect};
}

// index of the point under the mouse (nearest, in pixels) or -1
function pickPoint(event, preview) {
	if (!session) return -1;
	let best = -1, bestDistance = Infinity;
	session.points.forEach((p, i) => {
		const s = screenOf(p, preview);
		if (!s) return;
		const d = Math.hypot(event.clientX - s.x, event.clientY - s.y);
		if (d <= 20 && d < bestDistance) { best = i; bestDistance = d; }
	});
	return best;
}

function previewAt(event) {
	return ((typeof Preview != 'undefined' && Preview.all) || []).find(p => p.canvas && p.canvas === event.target) || null;
}

function rayOf(event, preview) {
	const rect = preview.canvas.getBoundingClientRect();
	const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
	const ray = new THREE.Raycaster();
	ray.setFromCamera(ndc, preview.camera);
	return ray.ray;
}

function onPointerDown(event) {
	if (!session || event.button !== 0 || event.__pipe) return;
	const preview = previewAt(event);
	if (!preview) return;
	const i = pickPoint(event, preview);
	if (i < 0) return;
	event.__pipe = true;
	event.preventDefault();
	event.stopImmediatePropagation();
	session.selected = i;
	const origin = session.points[i].clone();
	drag = {index: i, preview, origin, normal: preview.camera.getWorldDirection(new THREE.Vector3())};
	tick();
}

function onPointerMove(event) {
	if (!session || !drag || event.__pipe) return;
	event.__pipe = true;
	event.preventDefault();
	event.stopImmediatePropagation();
	const ray = rayOf(event, drag.preview), o = drag.origin;
	const target = new THREE.Vector3();
	if (event.shiftKey) {
		// only up / down: the point of the vertical line through the start that is closest to the mouse ray
		const u = ray.direction, v = new THREE.Vector3(0, 1, 0), w0 = ray.origin.clone().sub(o);
		const a = u.dot(u), b = u.dot(v), c = v.dot(v), d = u.dot(w0), e = v.dot(w0), den = a * c - b * b;
		const t = Math.abs(den) < 1e-6 ? 0 : (a * e - b * d) / den;
		target.copy(o).addScaledVector(v, t);
	} else {
		// parallel to the screen, or along the ground with Alt
		const plane = event.altKey ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -o.y) : new THREE.Plane().setFromNormalAndCoplanarPoint(drag.normal, o);
		if (!ray.intersectPlane(plane, target)) return;
	}
	session.points[drag.index].copy(target);
	tick();
}

function onPointerUp(event) {
	if (!drag) return;
	drag = null;
	if (event && event.__pipe !== true && session) { event.__pipe = true; event.preventDefault(); event.stopImmediatePropagation(); }
}

function onKey(event) {
	if (!session) return;
	const tag = event.target && event.target.tagName;
	if (tag == 'INPUT' || tag == 'TEXTAREA' || tag == 'SELECT') return;
	if (event.key == 'Delete' || event.key == 'Backspace') {
		if (session.selected < 0) return;
		event.preventDefault(); event.stopImmediatePropagation();
		deletePoint();
	} else if (event.key == 'Enter') {
		event.preventDefault(); event.stopImmediatePropagation();
		saveConnect();
	} else if (event.key == 'Escape') {
		event.preventDefault(); event.stopImmediatePropagation();
		cancelConnect();
	}
}

// -- ending --

function endSession() {
	clearInterval(poll); poll = null;
	removeHelpers();
	session = null; drag = null;
	showPanel(false);
}
function cancelConnect() {
	if (!session) return;
	endSession();
}

// the pipe appears only now
function saveConnect() {
	if (!session) return;
	const values = valuesNow();
	let result;
	try {
		const {a, b, path} = currentPath(values);
		result = buildTube(a, b, path, Math.round(values.sides), 0);
	} catch (err) {
		console.warn('[Connect]', err);
		Blockbench.showQuickMessage(String(err.message || err), 3000);
		return;
	}
	const {pa, pb, texture} = session;
	Undo.initEdit({outliner: true, elements: [pa.mesh, pb.mesh], selection: true});
	const pipe = new Mesh({name: 'Pipe', origin: [0, 0, 0], rotation: [0, 0, 0], vertices: []});
	pipe.addTo('root').init();
	writePipe(pipe, result, texture, !!values.shading);
	if (values.remove_faces) {
		pa.faces.forEach(fk => { delete pa.mesh.faces[fk]; });
		pb.faces.forEach(fk => { delete pb.mesh.faces[fk]; });
		Canvas.updateView({elements: [pa.mesh, pb.mesh], element_aspects: {geometry: true, faces: true, uv: true}});
	}
	Undo.finishEdit('Connect faces', {outliner: true, elements: [pa.mesh, pb.mesh, pipe], selection: true});
	endSession();
	Blockbench.showQuickMessage(tr('msg_done'), 1500);
}

// the mesh of the pipe: rings of points joined by quads
function writePipe(mesh, tube, texture, smooth) {
	const vertices = {}, ids = [];
	tube.rings.forEach((ring, r) => {
		ids[r] = ring.map((p, k) => { const key = 'r' + r + 'k' + k; vertices[key] = [p.x, p.y, p.z]; return key; });
	});
	mesh.vertices = vertices;
	mesh.faces = {};
	const tw = (typeof Project != 'undefined' && Project.texture_width) || 16, th = (typeof Project != 'undefined' && Project.texture_height) || 16;
	for (const quad of tube.quads) {
		const keys = quad.map(([r, k]) => ids[r][k]);
		const uv = {};
		quad.forEach(([r, k], i) => {
			// k wraps around: the last quad goes up to 1
			const kk = (i == 1 || i == 2) && k == 0 ? tube.sides : k;
			uv[keys[i]] = [kk / tube.sides * tw, r / tube.segments * th];
		});
		const data = {vertices: keys, uv};
		if (texture !== false && texture !== undefined && texture !== null) data.texture = texture;
		mesh.addFaces(new MeshFace(mesh, data));
	}
	mesh.shading = smooth ? 'smooth' : 'flat';
	Canvas.updateView({elements: [mesh], element_aspects: {geometry: true, uv: true, faces: true}});
}

// ---------------------------------------------------------------------------
// Side panel (only while connecting)
// ---------------------------------------------------------------------------

function panelComponent() {
	return {
		data() { return {f: Object.assign({}, DEFAULTS), count: 0, selected: -1}; },
		methods: {
			t(key) { return tr(key); },
			reset(values) { this.f = Object.assign({}, values); this.count = 0; this.selected = -1; },
			add() { addPoint(); },
			remove() { deletePoint(); },
			clear() { clearPoints(); },
			save() { saveConnect(); },
			cancel() { cancelConnect(); },
		},
		template: `
			<div class="pipe_panel">
				<div class="pipe_buttons">
					<button @click="save()" class="pipe_primary">{{ t('save') }}</button>
					<button @click="cancel()">{{ t('cancel') }}</button>
				</div>
				<div class="pipe_points">
					<div class="pipe_caption">{{ t('points') }}: {{ count }}</div>
					<div class="pipe_buttons">
						<button @click="add()" :title="t('add_point_tip')">{{ t('add_point') }}</button>
						<button @click="remove()" :disabled="!count" :title="t('delete_point_tip')">{{ t('delete_point') }}</button>
					</div>
					<button v-if="count > 1" @click="clear()" class="pipe_full">{{ t('clear_points') }}</button>
				</div>
				<label class="pipe_row">{{ t('path') }}
					<select v-model="f.path">
						<option value="curve">{{ t('path_curve') }}</option>
						<option value="straight">{{ t('path_straight') }}</option>
						<option value="elbow">{{ t('path_elbow') }}</option>
					</select>
				</label>
				<label class="pipe_row" :title="t('smoothing_tip')">{{ t('smoothing') }}
					<span class="pipe_slider"><input type="range" min="0" max="1" step="0.05" v-model.number="f.smoothing"><span class="pipe_value">{{ f.smoothing }}</span></span>
				</label>
				<label class="pipe_row">{{ t('segments') }} <input type="number" min="2" max="128" step="1" v-model.number="f.segments"></label>
				<label class="pipe_row">{{ t('sides') }} <input type="number" min="3" max="96" step="1" v-model.number="f.sides"></label>
				<label class="pipe_row">{{ t('avoid') }} <input type="checkbox" v-model="f.avoid"></label>
				<label class="pipe_row">{{ t('shading') }} <input type="checkbox" v-model="f.shading"></label>
				<label class="pipe_row">{{ t('remove_faces') }} <input type="checkbox" v-model="f.remove_faces"></label>
				<label class="pipe_row">{{ t('flip_a') }} <input type="checkbox" v-model="f.flip_a"></label>
				<label class="pipe_row">{{ t('flip_b') }} <input type="checkbox" v-model="f.flip_b"></label>
			</div>`,
	};
}

const STYLE = `
	.pipe_panel { padding: 6px 10px 12px; font-size: 0.92em; }
	.pipe_panel .pipe_row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 6px 0; cursor: pointer; }
	.pipe_panel .pipe_row select, .pipe_panel .pipe_row input[type=number] { width: 52%; box-sizing: border-box; background: var(--color-back); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px; padding: 3px 6px; }
	.pipe_panel .pipe_slider { display: flex; align-items: center; gap: 8px; width: 52%; }
	.pipe_panel .pipe_slider input[type=range] { flex: 1; min-width: 0; width: 100%; }
	.pipe_panel .pipe_value { width: 32px; text-align: right; opacity: 0.8; }
	.pipe_panel .pipe_buttons { display: flex; gap: 6px; margin: 4px 0; }
	.pipe_panel .pipe_buttons button { flex: 1; padding: 5px 6px; min-width: 0; }
	.pipe_panel .pipe_primary { font-weight: bold; }
	.pipe_panel .pipe_points { margin: 8px 0; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-back); }
	.pipe_panel .pipe_caption { font-size: 0.85em; opacity: 0.75; margin-bottom: 4px; text-transform: uppercase; }
	.pipe_panel .pipe_full { width: 100%; padding: 4px 6px; margin-top: 2px; }
`;

Plugin.register('pipe', {
	title: 'Connect',
	author: 'Claude',
	description: 'Join faces of two meshes with a pipe: a path of points you drag in the 3D view, smoothing, going around obstacles.',
	about: 'In face selection mode pick one or more faces on a mesh and on another mesh, right click and choose **Connect faces…**. A panel opens on the side and does not block the 3D view. The start and the end are joined by a curve: press **Add point** and drag the numbered points with the mouse (Shift = only up / down, Alt = only along the ground) to lead the curve where you want. **Smoothing**, the path type (curve, straight, elbows) and **Go around other objects** change the curve. Nothing is built until you press **Save**: then the pipe appears along the curve, starting exactly on the edges of the chosen faces.',
	icon: 'cable',
	version: '0.2.0',
	variant: 'both',
	min_version: '4.8.0',
	tags: ['Modeling'],
	onload() {
		style_node = Blockbench.addCSS(STYLE);
		panel = new Panel('pipe_connect', {
			name: tr('title'),
			icon: 'cable',
			condition: () => !!session,
			growable: true,
			resizable: true,
			min_height: 200,
			default_position: {slot: 'right_bar', float_position: [0, 0], float_size: [320, 480], height: 480},
			component: panelComponent(),
		});
		action = new Action('pipe_connect', {
			name: tr('connect'), description: tr('connect_desc'), icon: 'cable', category: 'edit',
			condition: () => Modes.edit && Mesh.selected.length >= 2,
			click() { startConnect(); },
		});
		add_action = new Action('pipe_add_waypoint', {
			name: tr('add_point'), icon: 'add_location_alt', category: 'edit',
			condition: () => !!session, click() { addPoint(); },
		});
		clear_action = new Action('pipe_clear_waypoints', {
			name: tr('clear_points'), icon: 'wrong_location', category: 'edit',
			condition: () => !!session, click() { clearPoints(); },
		});
		save_action = new Action('pipe_save', {
			name: tr('save') + ' (' + tr('title') + ')', icon: 'check', category: 'edit',
			condition: () => !!session, click() { saveConnect(); },
		});
		cancel_action = new Action('pipe_cancel', {
			name: tr('cancel') + ' (' + tr('title') + ')', icon: 'close', category: 'edit',
			condition: () => !!session, click() { cancelConnect(); },
		});
		Mesh.prototype.menu.addAction(action);
		// the same as the panel buttons, in the Edit menu and in the action search (Ctrl+K)
		try { [add_action, clear_action, save_action, cancel_action].forEach(a => MenuBar.addAction(a, 'edit')); } catch (err) { /* the panel has the buttons */ }
		for (const name of ['pointerdown', 'mousedown']) document.addEventListener(name, onPointerDown, true);
		for (const name of ['pointermove', 'mousemove']) document.addEventListener(name, onPointerMove, true);
		for (const name of ['pointerup', 'mouseup']) document.addEventListener(name, onPointerUp, true);
		document.addEventListener('keydown', onKey, true);
	},
	onunload() {
		cancelConnect();
		for (const name of ['pointerdown', 'mousedown']) document.removeEventListener(name, onPointerDown, true);
		for (const name of ['pointermove', 'mousemove']) document.removeEventListener(name, onPointerMove, true);
		for (const name of ['pointerup', 'mouseup']) document.removeEventListener(name, onPointerUp, true);
		document.removeEventListener('keydown', onKey, true);
		Mesh.prototype.menu.removeAction(action);
		try { ['pipe_add_waypoint', 'pipe_clear_waypoints', 'pipe_save', 'pipe_cancel'].forEach(id => MenuBar.removeAction('edit.' + id)); } catch (err) { /* not there */ }
		[action, add_action, clear_action, save_action, cancel_action].forEach(a => a && a.delete());
		action = add_action = clear_action = save_action = cancel_action = null;
		if (panel) panel.delete();
		if (style_node) style_node.delete();
	},
});

})();
