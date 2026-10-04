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
	const waypoints = orderWaypoints(a.center, opts.waypoints || []);
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

if (typeof __PIPE_EXPORT !== 'undefined') __PIPE_EXPORT({boundaryLoop, resampleLoop, buildPath, buildTube, orderWaypoints, avoidObstacles, openConnect, selectedFaceKeys, loopOf});
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
		flip_a: 'Flip start direction', flip_b: 'Flip end direction', twist: 'Twist (steps)', shading: 'Smooth shading',
		add_waypoint: 'Add waypoint', clear_waypoints: 'Remove waypoints', waypoints: 'Waypoints',
		waypoint_hint: 'Waypoints bend the pipe through chosen places: press "Add waypoint" and drag the little cube with the Move tool, or select extra objects (cubes, groups…) together with the two meshes before opening this window.',
		msg_select: 'Connect: select two meshes and one or more faces on each (face selection mode)',
		msg_loop: 'Connect: the chosen faces have no open edge (select a part of the surface, not the whole closed shape)',
		msg_done: 'Pipe created',
		msg_waypoint_none: 'Open the Connect window first',
	},
	ru: {
		connect: 'Соединить грани…', connect_desc: 'Соединить выбранные грани двух мешей трубой',
		title: 'Соединение граней', smoothing: 'Сглаживание', smoothing_tip: 'Насколько круто труба гнётся. 0 = резко, 1 = широкие мягкие дуги',
		path: 'Путь', path_curve: 'Плавная кривая', path_straight: 'Прямо', path_elbow: 'Коленами (прямые углы)',
		segments: 'Полигонов вдоль трубы', sides: 'Граней вокруг', avoid: 'Обходить другие объекты', remove_faces: 'Убрать выбранные грани (открыть отверстия)',
		flip_a: 'Развернуть начало', flip_b: 'Развернуть конец', twist: 'Закрутка (шагов)', shading: 'Гладкое затенение',
		add_waypoint: 'Добавить точку пути', clear_waypoints: 'Убрать точки пути', waypoints: 'Точки пути',
		waypoint_hint: 'Точки пути заставляют трубу пройти через нужные места: нажмите «Добавить точку пути» и тащите кубик инструментом «Перемещение», либо выделите лишние объекты (кубы, группы…) вместе с двумя мешами до открытия окна.',
		msg_select: 'Соединение: выделите два меша и по одной или нескольким граням на каждом (режим выбора граней)',
		msg_loop: 'Соединение: у выбранных граней нет открытого края (выделите часть поверхности, а не всю замкнутую форму)',
		msg_done: 'Труба создана',
		msg_waypoint_none: 'Сначала откройте окно соединения',
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
	Object.values(mesh.vertices).forEach(v => box.expandByPoint(position2(M, v)));
	const away = loop.center.clone().sub(box.getCenter(new THREE.Vector3()));
	if (away.dot(loop.normal) < 0) loop.normal.negate();
	return loop;
}
const position2 = (M, v) => new THREE.Vector3(...v).applyMatrix4(M);

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

let action = null, add_action = null, clear_action = null, open_dialog = null, session = null;

const centerOf = element => new THREE.Box3().setFromObject(element.mesh).getCenter(new THREE.Vector3());

function openConnect() {
	if (open_dialog) return;
	const picked = meshesWithFaces();
	if (picked.length != 2) { Blockbench.showQuickMessage(tr('msg_select'), 3500); return; }
	const [pa, pb] = picked;
	const loopA = loopOf(pa.mesh, pa.faces), loopB = loopOf(pb.mesh, pb.faces);
	if (!loopA || !loopB) { Blockbench.showQuickMessage(tr('msg_loop'), 3500); return; }
	// other selected objects are waypoints
	const extras = Outliner.selected.filter(el => el.mesh && el !== pa.mesh && el !== pb.mesh);
	const wasSelected = Outliner.selected.slice();
	const obstacles = [...Cube.all, ...Mesh.all].filter(el => el.mesh && el.mesh.visible !== false && el !== pa.mesh && el !== pb.mesh && !extras.includes(el));
	const texture = (() => { for (const fk of pa.faces) { const t = pa.mesh.faces[fk].texture; if (t !== undefined && t !== null) return t; } return false; })();

	Undo.initEdit({outliner: true, elements: [pa.mesh, pb.mesh], selection: true});
	const pipe = new Mesh({name: 'Pipe', origin: [0, 0, 0], rotation: [0, 0, 0], vertices: []});
	pipe.addTo('root').init();
	const markers = [];
	const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color: 0x35d0ff, depthTest: false}));
	line.renderOrder = 998;
	scene.add(line);
	const sidesGuess = Math.max(loopA.keys.length, loopB.keys.length, 6);
	// how fat the pipe is: the walls must clear an obstacle, not just the middle line
	const radiusOf = loop => loop.points.reduce((sum, p) => sum + p.distanceTo(loop.center), 0) / loop.points.length;
	const pipeRadius = Math.max(radiusOf(loopA), radiusOf(loopB));
	let last_signature = '', error_shown = false, current = null;

	const waypoints = () => [...markers.map(m => centerOf(m)), ...extras.map(centerOf)];
	const bounds = () => obstacles.map(el => new THREE.Box3().setFromObject(el.mesh)).filter(b => !b.isEmpty());

	function rebuild(form) {
		try {
			const a = {center: loopA.center, normal: loopA.normal.clone().multiplyScalar(form.flip_a ? -1 : 1), points: loopA.points};
			const b = {center: loopB.center, normal: loopB.normal.clone().multiplyScalar(form.flip_b ? -1 : 1), points: loopB.points};
			const path = buildPath(a, b, {mode: form.path, smoothing: form.smoothing, segments: Math.round(form.segments), waypoints: waypoints(),
				obstacles: form.avoid ? bounds() : null, clearance: pipeRadius + 1});
			const tube = buildTube(a, b, path, Math.round(form.sides), Math.round(form.twist || 0));
			writePipe(pipe, tube, texture, !!form.shading);
			line.geometry.dispose();
			line.geometry = new THREE.BufferGeometry().setFromPoints(path);
			current = {path, tube};
			error_shown = false;
		} catch (err) {
			console.warn('[Connect]', err);
			if (!error_shown) { error_shown = true; Blockbench.showQuickMessage(String(err.message || err), 2500); }
		}
	}
	const signature = form => JSON.stringify([form, waypoints().map(p => p.toArray().map(n => n.toFixed(2)))]);

	function addMarker() {
		const at = current ? current.path[Math.floor(current.path.length / 2)] : loopA.center.clone().lerp(loopB.center, 0.5);
		const m = new Cube({name: 'Pipe point', from: [at.x - 1.5, at.y - 1.5, at.z - 1.5], to: [at.x + 1.5, at.y + 1.5, at.z + 1.5], color: 4}).addTo('root').init();
		markers.push(m);
		Canvas.updateView({elements: [m], element_aspects: {geometry: true, transform: true}});
		last_signature = '';
	}
	function clearMarkers() {
		markers.splice(0).forEach(m => m.remove());
		last_signature = '';
	}
	function cleanup() {
		clearInterval(session && session.poll);
		clearMarkers();
		scene.remove(line);
		line.geometry.dispose();
		open_dialog = null; session = null;
	}

	const form = {
		path: {label: tr('path'), type: 'select', options: {curve: tr('path_curve'), straight: tr('path_straight'), elbow: tr('path_elbow')}, value: 'curve'},
		smoothing: {label: tr('smoothing'), type: 'range', value: 0.5, min: 0, max: 1, step: 0.05},
		segments: {label: tr('segments'), type: 'number', value: 16, min: 2, max: 128, step: 1},
		sides: {label: tr('sides'), type: 'number', value: sidesGuess, min: 3, max: 96, step: 1},
		avoid: {label: tr('avoid'), type: 'checkbox', value: false},
		shading: {label: tr('shading'), type: 'checkbox', value: true},
		remove_faces: {label: tr('remove_faces'), type: 'checkbox', value: true},
		flip_a: {label: tr('flip_a'), type: 'checkbox', value: false},
		flip_b: {label: tr('flip_b'), type: 'checkbox', value: false},
		twist: {label: tr('twist'), type: 'number', value: 0, step: 1},
		waypoints_info: {type: 'info', text: tr('waypoint_hint')},
		waypoint_buttons: {type: 'buttons', buttons: [tr('add_waypoint'), tr('clear_waypoints')], click(index) { if (index == 0) addMarker(); else clearMarkers(); }},
	};
	const options = {
		id: 'pipe_connect_dialog', title: tr('title'), width: 460, darken: false, form,
		onFormChange(values) { rebuild(values); },
		onConfirm(values) {
			rebuild(values);
			const result = current;
			cleanup();
			if (!result) { pipe.remove(); Undo.cancelEdit(false); return; }
			if (values.remove_faces) {
				pa.faces.forEach(fk => { delete pa.mesh.faces[fk]; });
				pb.faces.forEach(fk => { delete pb.mesh.faces[fk]; });
				Canvas.updateView({elements: [pa.mesh, pb.mesh], element_aspects: {geometry: true, faces: true, uv: true}});
			}
			Undo.finishEdit('Connect faces', {outliner: true, elements: [pa.mesh, pb.mesh, pipe], selection: true});
			Blockbench.showQuickMessage(tr('msg_done'), 1500);
		},
		onCancel() {
			cleanup();
			pipe.remove();
			Undo.cancelEdit(false);
			if (typeof updateSelection == 'function') updateSelection();
		},
	};
	let dialog;
	try {
		dialog = new Dialog(options);
	} catch (err) {
		// this Blockbench has no button rows in forms: the same window without them (waypoints through the Edit menu / selecting objects)
		delete form.waypoint_buttons;
		dialog = new Dialog(options);
	}
	open_dialog = dialog;
	session = {poll: null, addMarker, clearMarkers};
	dialog.show();
	rebuild(dialog.getFormResult());
	session.poll = setInterval(() => {
		if (!open_dialog) return;
		const values = dialog.getFormResult(), sig = signature(values);
		if (sig != last_signature) { last_signature = sig; rebuild(values); }
	}, 150);
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

Plugin.register('pipe', {
	title: 'Connect',
	author: 'Claude',
	description: 'Join faces of two meshes with a pipe: smoothing, path, waypoints, going around obstacles.',
	about: 'In face selection mode pick one or more faces on a mesh and on another mesh, right click and choose **Connect faces…**. A window with a live preview opens: **Smoothing** sets how round the pipe bends, **Path** picks smooth curve, straight or elbows, **Add waypoint** drops a little cube you drag with the Move tool to lead the pipe through a place (extra objects selected together with the meshes work as waypoints too), **Go around other objects** keeps it out of other cubes and meshes. The pipe starts exactly on the edges of the chosen faces, so square, round or odd openings all fit.',
	icon: 'cable',
	version: '0.1.0',
	variant: 'both',
	min_version: '4.8.0',
	tags: ['Modeling'],
	onload() {
		action = new Action('pipe_connect', {
			name: tr('connect'),
			description: tr('connect_desc'),
			icon: 'cable',
			category: 'edit',
			condition: () => Modes.edit && Mesh.selected.length >= 2,
			click() { openConnect(); },
		});
		add_action = new Action('pipe_add_waypoint', {
			name: tr('add_waypoint'), icon: 'add_location_alt', category: 'edit',
			condition: () => !!open_dialog,
			click() { if (session) session.addMarker(); else Blockbench.showQuickMessage(tr('msg_waypoint_none'), 2000); },
		});
		clear_action = new Action('pipe_clear_waypoints', {
			name: tr('clear_waypoints'), icon: 'wrong_location', category: 'edit',
			condition: () => !!open_dialog,
			click() { if (session) session.clearMarkers(); },
		});
		Mesh.prototype.menu.addAction(action);
		try { MenuBar.addAction(add_action, 'edit'); MenuBar.addAction(clear_action, 'edit'); } catch (err) { /* the buttons of the window do the same */ }
	},
	onunload() {
		if (open_dialog) open_dialog.cancel();
		Mesh.prototype.menu.removeAction(action);
		try { MenuBar.removeAction('edit.pipe_add_waypoint'); MenuBar.removeAction('edit.pipe_clear_waypoints'); } catch (err) { /* not there */ }
		[action, add_action, clear_action].forEach(a => a && a.delete());
		action = add_action = clear_action = null;
	},
});

})();
