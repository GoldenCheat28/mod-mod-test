(function () {
'use strict';

/*
 * Rope — a physical rope between two objects, made of a real mesh.
 *
 * Select two objects (cubes, meshes or groups), press "Create rope". A mesh tube appears between them. Press Play and it moves like
 * a rope: it hangs, swings, lies on the ground and on other objects. You choose how many segments and sides the mesh has (the
 * polygon count), the thickness, the slack, the stiffness, the stretch and so on.
 *
 * With the Physics plugin the rope is a real constraint: when the Physics tab is playing (or baking), a rope between two physics
 * objects pulls them together (a tow rope), a rope on a static object holds a falling body (a swing). The mesh follows.
 *
 * Units: 16 Blockbench pixels = 1 meter.
 */

const SCALE = 16;
const EPS = 1e-9;
const clamp01 = v => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------------------
// Rope simulation core (no Blockbench in here, so it can be tested on its own)
// Position based dynamics: a chain of points, a distance constraint between neighbours, collisions with boxes and the ground.
// ---------------------------------------------------------------------------

const DEFAULT_ROPE = {a: '', b: '', pa: [0, 0, 0], pb: [0, 0, 0], length: 100, slack: 15, segments: 24, sides: 6, radius: 1, bend: 0.2, damping: 0.5,
	elastic: 0, gravity: 1, collide: true, friction: 0.5, attach: 'surface'};

class RopeSim {
	// points: where the particles start (array of {x, y, z}); length and radius in px; gravity in px/s^2 (positive number)
	constructor(points, o) {
		this.n = points.length;
		this.x = new Float64Array(this.n * 3);
		this.p = new Float64Array(this.n * 3);
		points.forEach((q, i) => { this.x.set([q.x, q.y, q.z], i * 3); this.p.set([q.x, q.y, q.z], i * 3); });
		this.o = Object.assign({length: 100, radius: 1, gravity: 9.81 * SCALE, damping: 0.5, bend: 0.2, friction: 0.5, iterations: 6, substeps: 4}, o || {});
		this.contact = new Uint8Array(this.n);
		this.touching = 0;
	}

	setLength(length) { this.o.length = length; }

	pin(a, b) {
		const n = this.n, x = this.x, p = this.p;
		x[0] = p[0] = a.x; x[1] = p[1] = a.y; x[2] = p[2] = a.z;
		const e = (n - 1) * 3;
		x[e] = p[e] = b.x; x[e + 1] = p[e + 1] = b.y; x[e + 2] = p[e + 2] = b.z;
	}

	// a and b: where the two ends are now ({x, y, z}); boxes: [{c, axes, half, min, max}]; ground: world y of the floor or null.
	// Several small sub-steps keep a taut rope taut (one big step would let it sag like elastic)
	step(dt, a, b, boxes, ground) {
		const n = this.n, x = this.x, p = this.p, o = this.o;
		const sub = o.substeps, h = dt / sub, ends = (n - 1) * 3;
		const damp = Math.exp(-o.damping * h), g = o.gravity * h * h;
		const span = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
		const seg = Math.max(o.length, span) / (n - 1);
		const bend = o.bend * 0.45;
		const tight = clamp01((span / Math.max(o.length, 1e-6) - 0.985) / 0.015);
		const pull = tight * tight * (3 - 2 * tight);
		this.contact.fill(0);
		this.touching = 0;
		const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
		// the ends travel from where they were to where they are now over the sub-steps
		const sx = this.pinned ? this.x[0] : ax, sy = this.pinned ? this.x[1] : ay, sz = this.pinned ? this.x[2] : az;
		const ex = this.pinned ? this.x[ends] : bx, ey = this.pinned ? this.x[ends + 1] : by, ez = this.pinned ? this.x[ends + 2] : bz;
		this.pinned = true;
		for (let s = 1; s <= sub; s++) {
			const f = s / sub;
			x[0] = p[0] = sx + (ax - sx) * f; x[1] = p[1] = sy + (ay - sy) * f; x[2] = p[2] = sz + (az - sz) * f;
			x[ends] = p[ends] = ex + (bx - ex) * f; x[ends + 1] = p[ends + 1] = ey + (by - ey) * f; x[ends + 2] = p[ends + 2] = ez + (bz - ez) * f;
			for (let i = 1; i < n - 1; i++) {
				const k = i * 3;
				for (let c = 0; c < 3; c++) {
					const cur = x[k + c];
					x[k + c] += (cur - p[k + c]) * damp + (c == 1 ? -g : 0);
					p[k + c] = cur;
				}
			}
			for (let it = 0; it < o.iterations; it++) {
				const forward = (it & 1) == 0;
				for (let q = 0; q < n - 1; q++) this.distance(forward ? q : n - 2 - q, forward ? q + 1 : n - 1 - q, seg, 1);
				if (bend > 0) for (let i = 0; i < n - 2; i++) this.distance(i, i + 2, seg * 2, bend);
			}
			// a rope pulled tight is a straight line (the constraints alone leave a little sag)
			if (pull > 0) {
				for (let i = 1; i < n - 1; i++) {
					const k = i * 3, u = i / (n - 1);
					for (let c = 0; c < 3; c++) {
						const target = x[c] + (x[ends + c] - x[c]) * u, d = (target - x[k + c]) * pull;
						x[k + c] += d; p[k + c] += d;
					}
				}
			}
			if (boxes && boxes.length) for (let i = 1; i < n - 1; i++) for (let m = 0; m < boxes.length; m++) this.collideBox(i, boxes[m]);
			if (ground !== null && ground !== undefined) {
				for (let i = 1; i < n - 1; i++) {
					const k = i * 3 + 1;
					if (x[k] < ground + o.radius) { x[k] = ground + o.radius; this.contact[i] = 1; }
				}
			}
		}
		// friction: what touched something loses part of its sliding speed
		const keep = 1 - Math.min(1, o.friction) * 0.5;
		for (let i = 1; i < n - 1; i++) {
			if (!this.contact[i]) continue;
			this.touching++;
			const k = i * 3;
			for (let c = 0; c < 3; c++) p[k + c] = x[k + c] - (x[k + c] - p[k + c]) * keep;
		}
	}

	// keep particles i and j `rest` apart (stiffness 0..1); the end particles do not move
	distance(i, j, rest, stiffness) {
		const x = this.x, n = this.n;
		const ki = i * 3, kj = j * 3;
		const dx = x[kj] - x[ki], dy = x[kj + 1] - x[ki + 1], dz = x[kj + 2] - x[ki + 2];
		const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (d < EPS) return;
		const wi = i == 0 || i == n - 1 ? 0 : 1, wj = j == 0 || j == n - 1 ? 0 : 1, w = wi + wj;
		if (!w) return;
		const diff = (d - rest) / d * stiffness / w;
		x[ki] += dx * diff * wi; x[ki + 1] += dy * diff * wi; x[ki + 2] += dz * diff * wi;
		x[kj] -= dx * diff * wj; x[kj + 1] -= dy * diff * wj; x[kj + 2] -= dz * diff * wj;
	}

	// push particle i (a ball of radius r) out of an oriented box
	collideBox(i, box) {
		const x = this.x, r = this.o.radius, k = i * 3;
		const px = x[k], py = x[k + 1], pz = x[k + 2];
		if (px < box.min[0] - r || px > box.max[0] + r || py < box.min[1] - r || py > box.max[1] + r || pz < box.min[2] - r || pz > box.max[2] + r) return;
		const A = box.axes, H = box.half;
		const dx = px - box.c[0], dy = py - box.c[1], dz = pz - box.c[2];
		const l0 = dx * A[0] + dy * A[1] + dz * A[2], l1 = dx * A[3] + dy * A[4] + dz * A[5], l2 = dx * A[6] + dy * A[7] + dz * A[8];
		const c0 = Math.max(-H[0], Math.min(H[0], l0)), c1 = Math.max(-H[1], Math.min(H[1], l1)), c2 = Math.max(-H[2], Math.min(H[2], l2));
		let n0 = l0 - c0, n1 = l1 - c1, n2 = l2 - c2, push;
		const dist = Math.sqrt(n0 * n0 + n1 * n1 + n2 * n2);
		if (dist > EPS) {
			if (dist >= r) return;
			push = r - dist;
			n0 /= dist; n1 /= dist; n2 /= dist;
		} else {
			// the centre is inside the box: leave through the nearest face
			const pen0 = H[0] - Math.abs(l0), pen1 = H[1] - Math.abs(l1), pen2 = H[2] - Math.abs(l2);
			n0 = n1 = n2 = 0;
			if (pen0 <= pen1 && pen0 <= pen2) { n0 = l0 < 0 ? -1 : 1; push = pen0 + r; }
			else if (pen1 <= pen2) { n1 = l1 < 0 ? -1 : 1; push = pen1 + r; }
			else { n2 = l2 < 0 ? -1 : 1; push = pen2 + r; }
		}
		x[k] += (n0 * A[0] + n1 * A[3] + n2 * A[6]) * push;
		x[k + 1] += (n0 * A[1] + n1 * A[4] + n2 * A[7]) * push;
		x[k + 2] += (n0 * A[2] + n1 * A[5] + n2 * A[8]) * push;
		this.contact[i] = 1;
	}

	point(i, out) { out.set(this.x[i * 3], this.x[i * 3 + 1], this.x[i * 3 + 2]); return out; }
}

// a box for the simulation from a centre, rotation (THREE.Quaternion) and half sizes
function makeBox(center, quat, half) {
	const m = new THREE.Matrix4().makeRotationFromQuaternion(quat).elements;
	const axes = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
	const ext = [0, 1, 2].map(i => Math.abs(axes[i]) * half[0] + Math.abs(axes[3 + i]) * half[1] + Math.abs(axes[6 + i]) * half[2]);
	return {c: [center.x, center.y, center.z], axes, half: half.slice(),
		min: [center.x - ext[0], center.y - ext[1], center.z - ext[2]], max: [center.x + ext[0], center.y + ext[1], center.z + ext[2]]};
}

// the point where a ray from the centre of a box towards `target` leaves the box
function surfacePoint(box, target) {
	const c = box.getCenter(new THREE.Vector3()), half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
	const d = target.clone().sub(c);
	if (d.lengthSq() < EPS) return c;
	let t = Infinity;
	for (const axis of ['x', 'y', 'z']) if (Math.abs(d[axis]) > 1e-6) t = Math.min(t, half[axis] / Math.abs(d[axis]));
	return c.add(d.multiplyScalar(Math.min(1, t)));
}

// ---------------------------------------------------------------------------
// The mesh of the rope: rings of points around the path, joined by quads
// ---------------------------------------------------------------------------

// rings of points around a path; `frame` remembers the turning of the rings so they do not twist from one frame to the next
function ringsOf(points, sides, radius, frame) {
	const M = points.length - 1, T = [], U = [], V = [];
	for (let i = 0; i <= M; i++) {
		const t = points[Math.min(M, i + 1)].clone().sub(points[Math.max(0, i - 1)]);
		T.push(t.lengthSq() > EPS ? t.normalize() : new THREE.Vector3(0, 1, 0));
	}
	let ref = frame && frame.u ? frame.u.clone() : (Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
	ref.addScaledVector(T[0], -ref.dot(T[0]));
	if (ref.lengthSq() < 1e-8) ref = new THREE.Vector3(1, 0, 0).addScaledVector(T[0], -T[0].x);
	U[0] = ref.normalize();
	V[0] = new THREE.Vector3().crossVectors(T[0], U[0]).normalize();
	for (let i = 1; i <= M; i++) {
		const q = new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]);
		U[i] = U[i - 1].clone().applyQuaternion(q).normalize();
		V[i] = new THREE.Vector3().crossVectors(T[i], U[i]).normalize();
	}
	if (frame) frame.u = U[0].clone();
	const rings = [];
	for (let i = 0; i <= M; i++) {
		const ring = [];
		for (let k = 0; k < sides; k++) {
			const a = k / sides * Math.PI * 2;
			ring.push(points[i].clone().addScaledVector(U[i], Math.cos(a) * radius).addScaledVector(V[i], Math.sin(a) * radius));
		}
		rings.push(ring);
	}
	return rings;
}

const ringKey = (r, k) => 'r' + r + 'k' + k;

// the faces of a rope with `segments` pieces and `sides` sides (quads along the rope, a cap on each end)
function ropeTopology(segments, sides) {
	const quads = [];
	for (let i = 0; i < segments; i++) for (let k = 0; k < sides; k++) quads.push([[i, k], [i, (k + 1) % sides], [i + 1, (k + 1) % sides], [i + 1, k]]);
	const start = [], end = [];
	for (let k = sides - 1; k >= 0; k--) start.push([0, k]);
	for (let k = 0; k < sides; k++) end.push([segments, k]);
	return {quads, caps: [start, end]};
}

// ---------------------------------------------------------------------------
// Blockbench side
// ---------------------------------------------------------------------------

const TEXTS = {
	en: {
		mode: 'Ropes', create: 'Create rope between the 2 selected objects', play: '▶ Simulate', pause: '❚❚ Pause', reset: '⟲ Reset', apply: '✔ Keep shape',
		stopped: 'stopped', playing: 'playing', paused: 'paused', ropes: 'ropes', physics: 'Physics tab is running: the ropes pull the objects',
		select_hint: 'Select two objects (cubes, meshes or groups) in the outliner, then press Create.',
		rope: 'Rope', ends: 'Connects', refit: 'Re-fit to the objects', refit_tip: 'Move the rope to the objects as they are now, with the same settings',
		detail: 'Mesh', segments: 'Segments (along)', sides: 'Sides (around)', polys: 'polygons', thickness: 'Thickness (px)',
		behavior: 'Behaviour', slack: 'Slack (%)', slack_tip: 'How much longer the rope is than the distance between the objects. 0 = tight, negative = pulls the objects together',
		length: 'Length', stiffness: 'Stiffness', stiffness_tip: '0 = soft string, 1 = a stiff cable that keeps its shape',
		damping: 'Damping', elastic: 'Stretch', elastic_tip: '0 = a rope that does not stretch, 1 = a rubber band (needs the Physics tab)',
		gravity: 'Gravity', friction: 'Friction', collide: 'Rope lies on objects and the ground', attach: 'Attach to', attach_surface: 'Surface', attach_center: 'Centre',
		footnote: '16 px = 1 m. Simulate moves the rope on its own: its ends follow the objects. In the Physics tab (Play / Bake) the rope is also a real constraint: it pulls bodies. Keep shape writes the current shape into the mesh (Ctrl+Z undoes it).',
		phys_dynamic: 'physics object: moves, the rope pulls it', phys_static: 'physics ground: fixed', phys_none: 'no physics: stays in place (tick it in the Physics tab to let the rope pull it)',
		msg_two: 'Select exactly two objects: cubes, meshes or groups (not ropes)', msg_created: 'Rope created', msg_kept: 'Shape kept', msg_refit: 'Rope fitted',
		msg_lost: 'One of the ends of this rope was deleted', msg_big: 'Too many polygons (over 6000)', msg_nothing: 'No ropes yet: create one first',
	},
	ru: {
		mode: 'Верёвки', create: 'Создать верёвку между 2 выбранными объектами', play: '▶ Симуляция', pause: '❚❚ Пауза', reset: '⟲ Сброс', apply: '✔ Оставить форму',
		stopped: 'остановлено', playing: 'идёт', paused: 'пауза', ropes: 'верёвок', physics: 'Идёт вкладка Физика: верёвки тянут объекты',
		select_hint: 'Выделите два объекта (кубы, меши или группы) в списке элементов и нажмите «Создать».',
		rope: 'Верёвка', ends: 'Соединяет', refit: 'Подогнать под объекты', refit_tip: 'Перенести верёвку к объектам там, где они сейчас, с теми же настройками',
		detail: 'Меш', segments: 'Сегментов (вдоль)', sides: 'Граней (вокруг)', polys: 'полигонов', thickness: 'Толщина (px)',
		behavior: 'Поведение', slack: 'Провис (%)', slack_tip: 'Насколько верёвка длиннее расстояния между объектами. 0 = натянута, минус = стягивает объекты',
		length: 'Длина', stiffness: 'Жёсткость', stiffness_tip: '0 = мягкая нитка, 1 = жёсткий трос, держит форму',
		damping: 'Затухание', elastic: 'Растяжение', elastic_tip: '0 = верёвка не тянется, 1 = резинка (работает во вкладке Физика)',
		gravity: 'Гравитация', friction: 'Трение', collide: 'Верёвка ложится на объекты и землю', attach: 'Крепить к', attach_surface: 'Поверхности', attach_center: 'Центру',
		footnote: '16 px = 1 м. «Симуляция» двигает верёвку сама: её концы следуют за объектами. Во вкладке Физика (Пуск / Запись) верёвка ещё и настоящая связь: она тянет тела. «Оставить форму» записывает текущую форму в меш (Ctrl+Z отменяет).',
		phys_dynamic: 'физический объект: двигается, верёвка его тянет', phys_static: 'физическая земля: неподвижна', phys_none: 'без физики: стоит на месте (отметьте его во вкладке Физика, чтобы верёвка его тянула)',
		msg_two: 'Выделите ровно два объекта: кубы, меши или группы (не верёвки)', msg_created: 'Верёвка создана', msg_kept: 'Форма оставлена', msg_refit: 'Верёвка подогнана',
		msg_lost: 'Один из концов этой верёвки удалён', msg_big: 'Слишком много полигонов (больше 6000)', msg_nothing: 'Верёвок пока нет: сначала создайте',
	},
};
const tr = key => {
	const lang = (typeof Language != 'undefined' && Language.code) || 'en';
	return (TEXTS[lang] && TEXTS[lang][key]) || TEXTS.en[key] || key;
};

const num = (v, d) => isFinite(parseFloat(v)) ? parseFloat(v) : d;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ropeOf = el => Object.assign({}, DEFAULT_ROPE, el.rope || {});
const isRope = el => el instanceof Mesh && !!(el.rope && el.rope.a && el.rope.b);
const allRopes = () => (Project ? Mesh.all.filter(el => isRope(el) && el.mesh) : []);
const isNode = el => (el instanceof Cube || el instanceof Mesh || el instanceof Group) && !!el.mesh && !isRope(el);
const findNode = uuid => [...Cube.all, ...Mesh.all, ...Group.all].find(n => n.uuid == uuid) || null;
// what the Physics tab makes of this object: the closest ticked group / element above it decides
function physicsKind(node) {
	for (let n = node; n && n != 'root'; n = n.parent) if (n.physics && n.physics.type && n.physics.type != 'none') return n.physics.type;
	return 'none';
}
const worldOfProject = () => Object.assign({gravity: 9.81, ground: true, ground_y: 0}, (Project && Project.physics_world) || {});

function restPose() {
	if (typeof Canvas != 'undefined') { Canvas.updateAllPositions(); Canvas.updateAllBones(); }
	scene.updateMatrixWorld(true);
}

const nodeBox = node => { node.mesh.updateMatrixWorld(true); return new THREE.Box3().setFromObject(node.mesh); };
const attachWorld = (node, local) => node.mesh.localToWorld(new THREE.Vector3(...local));
const toLocal = (node, world) => node.mesh.worldToLocal(world.clone()).toArray();

// where the rope touches both objects (world space)
function attachPoints(a, b, mode) {
	const ba = nodeBox(a), bb = nodeBox(b);
	const ca = ba.getCenter(new THREE.Vector3()), cb = bb.getCenter(new THREE.Vector3());
	if (mode == 'center') return [ca, cb];
	return [surfacePoint(ba, cb), surfacePoint(bb, ca)];
}

// the rope as it hangs between two points: simulated until it settles
function settleShape(a, b, d) {
	const n = Math.max(2, Math.round(d.segments));
	const pts = [];
	for (let i = 0; i <= n; i++) pts.push(a.clone().lerp(b, i / n));
	const sim = new RopeSim(pts, {length: d.length, radius: d.radius, gravity: 9.81 * SCALE * d.gravity, damping: 3, bend: d.bend, friction: d.friction, iterations: 8, substeps: 4});
	for (let s = 0; s < 240; s++) sim.step(1 / 60, a, b, null, null);
	return pts.map((_, i) => sim.point(i, new THREE.Vector3()));
}

// ---- writing the mesh ----
function writeTopology(mesh, segments, sides) {
	const topo = ropeTopology(segments, sides);
	mesh.vertices = {};
	mesh.faces = {};
	for (let r = 0; r <= segments; r++) for (let k = 0; k < sides; k++) mesh.vertices[ringKey(r, k)] = [0, 0, 0];
	const tw = (Project && Project.texture_width) || 16, th = (Project && Project.texture_height) || 16;
	const tex = (typeof Texture != 'undefined' && Texture.getDefault && Texture.getDefault()) || null;
	for (const quad of topo.quads) {
		const keys = quad.map(([r, k]) => ringKey(r, k)), uv = {};
		quad.forEach(([r, k], i) => { const kk = (i == 1 || i == 2) && k == 0 ? sides : k; uv[keys[i]] = [kk / sides * tw, r / segments * th]; });
		const data = {vertices: keys, uv};
		if (tex) data.texture = tex.uuid;
		mesh.addFaces(new MeshFace(mesh, data));
	}
	for (const cap of topo.caps) {
		const keys = cap.map(([r, k]) => ringKey(r, k)), uv = {};
		cap.forEach(([r, k], i) => { const a = i / sides * Math.PI * 2; uv[keys[i]] = [tw * (0.5 + Math.cos(a) * 0.1), th * (0.5 + Math.sin(a) * 0.1)]; });
		const data = {vertices: keys, uv};
		if (tex) data.texture = tex.uuid;
		mesh.addFaces(new MeshFace(mesh, data));
	}
	mesh.shading = 'smooth';
}

// moves the points of the mesh to the rope (world points)
const frames = new WeakMap();
function writeShape(mesh, points, d, update = true) {
	mesh.mesh.updateMatrixWorld(true);
	const inv = mesh.mesh.matrixWorld.clone().invert();
	let frame = frames.get(mesh);
	if (!frame) { frame = {u: null}; frames.set(mesh, frame); }
	const local = points.map(p => p.clone().applyMatrix4(inv));
	const rings = ringsOf(local, Math.round(d.sides), d.radius, frame);
	rings.forEach((ring, r) => ring.forEach((p, k) => {
		const v = mesh.vertices[ringKey(r, k)];
		if (v) { v[0] = p.x; v[1] = p.y; v[2] = p.z; } else mesh.vertices[ringKey(r, k)] = [p.x, p.y, p.z];
	}));
	if (update) Canvas.updateView({elements: [mesh], element_aspects: {geometry: true}});
}

// the centre line of the mesh right now (world points)
function pathOf(mesh, segments) {
	mesh.mesh.updateMatrixWorld(true);
	const out = [];
	for (let r = 0; r <= segments; r++) {
		const c = new THREE.Vector3();
		let count = 0;
		for (let k = 0; ; k++) { const v = mesh.vertices[ringKey(r, k)]; if (!v) break; c.x += v[0]; c.y += v[1]; c.z += v[2]; count++; }
		if (!count) return null;
		out.push(mesh.mesh.localToWorld(c.multiplyScalar(1 / count)));
	}
	return out;
}

// the ends of a rope right now: where its two attach points are (world space)
function ends(rope) {
	const d = ropeOf(rope), a = findNode(d.a), b = findNode(d.b);
	if (!a || !b || !a.mesh || !b.mesh) return null;
	return {a, b, pa: attachWorld(a, d.pa), pb: attachWorld(b, d.pb), d};
}

// every box the rope could lie on, in the current pose
function sceneBoxes(skipNodes) {
	const out = [];
	const skipped = el => { for (let n = el; n && n != 'root'; n = n.parent) if (skipNodes.includes(n)) return true; return false; };
	for (const el of [...Cube.all, ...Mesh.all]) {
		if (!el.mesh || el.mesh.visible === false || isRope(el) || skipped(el)) continue;
		el.mesh.updateMatrixWorld(true);
		if (el instanceof Cube) {
			const half = [0, 1, 2].map(i => Math.abs(el.to[i] - el.from[i]) / 2 + (el.inflate || 0));
			const center = el.mesh.localToWorld(new THREE.Vector3(...[0, 1, 2].map(i => (el.from[i] + el.to[i]) / 2 - el.origin[i])));
			out.push(makeBox(center, el.mesh.getWorldQuaternion(new THREE.Quaternion()), half));
		} else {
			const box = new THREE.Box3();
			Object.values(el.vertices).forEach(v => box.expandByPoint(el.mesh.localToWorld(new THREE.Vector3(...v))));
			if (box.isEmpty()) continue;
			const size = box.getSize(new THREE.Vector3());
			out.push(makeBox(box.getCenter(new THREE.Vector3()), new THREE.Quaternion(), [size.x / 2, size.y / 2, size.z / 2]));
		}
	}
	return out;
}

const groundY = ws => (ws.ground ? Project.model_3d.localToWorld(new THREE.Vector3(0, ws.ground_y, 0)).y : null);

// ---------------------------------------------------------------------------
// Creating and changing ropes
// ---------------------------------------------------------------------------

function lengthFor(pa, pb, slack) { return Math.max(1, pa.distanceTo(pb) * (1 + slack / 100)); }

// (re)builds the shape of a rope mesh for its two objects as they are now
function fitRope(mesh, a, b, patch) {
	const d = Object.assign(ropeOf(mesh), patch || {});
	const [pa, pb] = attachPoints(a, b, d.attach);
	d.pa = toLocal(a, pa); d.pb = toLocal(b, pb);
	d.length = lengthFor(pa, pb, d.slack);
	d.a = a.uuid; d.b = b.uuid;
	const old = ropeOf(mesh);
	if (!mesh.vertices || !Object.keys(mesh.vertices).length || Math.round(old.segments) != Math.round(d.segments) || Math.round(old.sides) != Math.round(d.sides) || !mesh.faces || !Object.keys(mesh.faces).length) {
		writeTopology(mesh, Math.round(d.segments), Math.round(d.sides));
	}
	mesh.rope = d;
	writeShape(mesh, settleShape(pa, pb, d), d, false);
	Canvas.updateView({elements: [mesh], element_aspects: {geometry: true, uv: true, faces: true}});
	return d;
}

function createRope() {
	const picked = Outliner.selected.filter(el => el.mesh);
	const nodes = picked.filter(isNode);
	if (nodes.length != 2 || picked.length != 2) { Blockbench.showQuickMessage(tr('msg_two'), 3000); return null; }
	stopLive(false);
	restPose();
	const [a, b] = nodes;
	Undo.initEdit({outliner: true, elements: [], selection: true});
	const mesh = new Mesh({name: 'Rope', origin: [0, 0, 0], rotation: [0, 0, 0], vertices: []});
	mesh.addTo('root').init();
	try {
		fitRope(mesh, a, b, {});
	} finally {
		Undo.finishEdit('Create rope', {outliner: true, elements: [mesh], selection: true});
	}
	mesh.select();
	Blockbench.showQuickMessage(tr('msg_created'), 1500);
	updatePanel(true);
	return mesh;
}

function editRope(mesh, patch, label) {
	const old = ropeOf(mesh), next = Object.assign({}, old, patch);
	const polys = Math.round(next.segments) * Math.round(next.sides) + 2;
	if (polys > 6000) { Blockbench.showQuickMessage(tr('msg_big'), 2500); return false; }
	const e = ends(mesh);
	if (!e) { Blockbench.showQuickMessage(tr('msg_lost'), 2500); return false; }
	stopLive(false);
	restPose();
	Undo.initEdit({elements: [mesh]});
	fitRope(mesh, e.a, e.b, patch);
	Undo.finishEdit(label || 'Change rope', {elements: [mesh]});
	Project.saved = false;
	return true;
}

// ---------------------------------------------------------------------------
// Playing without the Physics tab: the rope follows its objects
// ---------------------------------------------------------------------------

let live = null;   // {items: [{mesh, sim, d, a, b}], original, elements, time, acc, last, playing}
let hooked = null; // while the Physics tab runs: {rt, items}
let hooked_at = 0;

function makeItem(mesh) {
	const d = ropeOf(mesh), e = ends(mesh);
	if (!e) return null;
	const n = Math.round(d.segments);
	const pts = pathOf(mesh, n) || settleShape(e.pa, e.pb, d);
	const sim = new RopeSim(pts, {length: d.length, radius: d.radius, gravity: 9.81 * SCALE * d.gravity, damping: d.damping, bend: d.bend, friction: d.friction});
	return {mesh, d, a: e.a, b: e.b, sim, tmp: pts.map(() => new THREE.Vector3())};
}

function createLive() {
	restPose();
	const items = allRopes().map(makeItem).filter(Boolean);
	if (!items.length) return null;
	const elements = items.map(i => i.mesh);
	const original = items.map(i => [i.mesh, JSON.parse(JSON.stringify(i.mesh.vertices))]);
	Undo.initEdit({elements});
	return {items, original, elements, time: 0, acc: 0, last: performance.now(), playing: false, ws: worldOfProject()};
}

function stepItem(item, dt, boxes, ws) {
	const pa = attachWorld(item.a, item.d.pa), pb = attachWorld(item.b, item.d.pb);
	item.sim.step(dt, pa, pb, item.d.collide ? boxes : null, item.d.collide ? groundY(ws) : null);
}

function showItem(item) {
	item.sim.o.length = item.d.length;
	for (let i = 0; i < item.tmp.length; i++) item.sim.point(i, item.tmp[i]);
	writeShape(item.mesh, item.tmp, item.d, false);
}

function showLive() {
	if (!live) return;
	live.items.forEach(showItem);
	Canvas.updateView({elements: live.elements, element_aspects: {geometry: true}});
}

function liveTick(now) {
	if (!live || !live.playing) return;
	live.acc += Math.min(0.1, (now - live.last) / 1000);
	live.last = now;
	if (performance.now() - hooked_at > 150) {   // when the Physics tab runs, it moves the ropes
		let steps = 0;
		while (live.acc >= 1 / 60 && steps < 3) {
			restPoseObjects();
			const boxes = live.items.map(it => sceneBoxes([it.a, it.b]));
			live.items.forEach((it, i) => { stepItem(it, 1 / 60, boxes[i], live.ws); stepItem(it, 1 / 60, boxes[i], live.ws); });
			live.acc -= 1 / 60;
			live.time += 1 / 60;
			steps++;
		}
		if (live.acc > 0.2) live.acc = 0;
		showLive();
	} else live.acc = 0;
	updatePanel();
	requestAnimationFrame(liveTick);
}

// objects may move (animation, other plugins): their matrices are read as they are
function restPoseObjects() { scene.updateMatrixWorld(true); }

function playLive() {
	if (!live) {
		live = createLive();
		if (!live) { Blockbench.showQuickMessage(tr('msg_nothing'), 2500); return; }
	}
	if (live.playing) return;
	live.playing = true;
	live.last = performance.now();
	requestAnimationFrame(liveTick);
	updatePanel();
}

function pauseLive() { if (live) live.playing = false; updatePanel(); }

// back to the shape before Simulate (cancel = true) or stop and leave things as they are
function stopLive(restore = true) {
	if (!live) return;
	live.playing = false;
	if (restore) {
		for (const [mesh, vertices] of live.original) mesh.vertices = vertices;
		Undo.cancelEdit(false);
		Canvas.updateView({elements: live.elements, element_aspects: {geometry: true}});
	} else {
		for (const [mesh, vertices] of live.original) mesh.vertices = vertices;
		Undo.cancelEdit(false);
	}
	live = null;
	updatePanel();
}

function keepLive() {
	if (!live) return;
	live.playing = false;
	showLive();
	Undo.finishEdit('Rope simulation', {elements: live.elements});
	live = null;
	Blockbench.showQuickMessage(tr('msg_kept'), 1500);
	updatePanel();
}

// ---------------------------------------------------------------------------
// The Physics plugin: ropes as real constraints between bodies
// ---------------------------------------------------------------------------

function entryFor(rt, node) {
	for (let n = node; n && n != 'root'; n = n.parent) {
		const e = rt.world.entries.find(en => en.desc.node === n && !en.broken);
		if (e) return e;
	}
	return null;
}

const bodyMatrix = entry => {
	const p = entry.body.GetPosition(), r = entry.body.GetRotation();
	return new THREE.Matrix4().compose(new THREE.Vector3(p.GetX() * SCALE, p.GetY() * SCALE, p.GetZ() * SCALE),
		new THREE.Quaternion(r.GetX(), r.GetY(), r.GetZ(), r.GetW()), new THREE.Vector3(1, 1, 1));
};

const physicsHook = {
	start(rt) {
		this.stop();
		restPose();
		const J = rt.Jolt, items = [];
		for (const mesh of allRopes()) {
			const item = makeItem(mesh);
			if (!item) continue;
			const ea = entryFor(rt, item.a), eb = entryFor(rt, item.b);
			const wa = attachWorld(item.a, item.d.pa), wb = attachWorld(item.b, item.d.pb);
			Object.assign(item, {ea, eb, wa, wb, la: ea ? wa.clone().applyMatrix4(ea.rest_inv) : null, lb: eb ? wb.clone().applyMatrix4(eb.rest_inv) : null,
				original: JSON.parse(JSON.stringify(mesh.vertices)), boxes: null, skip: new Set([ea, eb].filter(Boolean))});
			if (ea !== eb && (ea || eb) && J && J.DistanceConstraintSettings) {
				try {
					const dyn = [ea, eb].some(e => e && e.desc.settings.type == 'dynamic');
					if (dyn) {
						const st = new J.DistanceConstraintSettings();
						st.mSpace = J.EConstraintSpace_WorldSpace;
						st.mPoint1 = new J.RVec3(wa.x / SCALE, wa.y / SCALE, wa.z / SCALE);
						st.mPoint2 = new J.RVec3(wb.x / SCALE, wb.y / SCALE, wb.z / SCALE);
						st.mMinDistance = 0;
						st.mMaxDistance = Math.max(item.d.length, wa.distanceTo(wb)) / SCALE;
						if (item.d.elastic > 0) {
							st.mLimitsSpringSettings.mMode = J.ESpringMode_FrequencyAndDamping;
							st.mLimitsSpringSettings.mFrequency = 1.5 + 14 * (1 - clamp(item.d.elastic, 0, 1)) ** 2;
							st.mLimitsSpringSettings.mDamping = 0.6;
						}
						const fixed = J.JoltInterface.prototype.sGetFixedToWorldBody();
						const constraint = st.Create(ea ? ea.body : fixed, eb ? eb.body : fixed);
						rt.world.system.AddConstraint(constraint);
						item.constraint = constraint;
					}
				} catch (err) { console.warn('[Rope] constraint', err); }
			}
			items.push(item);
		}
		hooked = {rt, items, step: 0, ws: rt.ws};
	},
	step(rt, dt) {
		if (!hooked || hooked.rt !== rt) return;
		hooked_at = performance.now();
		if (hooked.step++ % 2 == 0) for (const it of hooked.items) it.boxes = it.d.collide ? rt.colliders(it.skip) : null;
		for (const it of hooked.items) {
			const pa = it.ea ? it.la.clone().applyMatrix4(bodyMatrix(it.ea)) : it.wa, pb = it.eb ? it.lb.clone().applyMatrix4(bodyMatrix(it.eb)) : it.wb;
			it.sim.step(dt, pa, pb, it.boxes, it.d.collide ? groundY(hooked.ws) : null);
		}
	},
	show() {
		if (!hooked) return;
		hooked.items.forEach(showItem);
		Canvas.updateView({elements: hooked.items.map(i => i.mesh), element_aspects: {geometry: true}});
	},
	stop() {
		if (!hooked) return;
		const h = hooked;
		hooked = null;
		for (const it of h.items) it.mesh.vertices = it.original;
		try { Canvas.updateView({elements: h.items.map(i => i.mesh), element_aspects: {geometry: true}}); } catch (err) { /* project closed */ }
	},
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

let mode = null, panel = null, properties = [], style_node = null, create_action = null;
const selectedRope = () => (Project ? Mesh.selected.find(isRope) || null : null);

function updatePanel(force) {
	if (!panel || !panel.inside_vue) return;
	const vue = panel.inside_vue, rope = selectedRope();
	const key = rope ? rope.uuid + ':' + JSON.stringify(rope.rope) : '';
	if (force || vue.selection_key != key) {
		vue.selection_key = key;
		vue.has_rope = !!rope;
		if (rope) {
			const d = ropeOf(rope), e = ends(rope);
			Object.assign(vue, {segments: d.segments, sides: d.sides, radius: d.radius, slack: d.slack, bend: d.bend, damping: d.damping, elastic: d.elastic,
				gravity: d.gravity, friction: d.friction, collide: d.collide, attach: d.attach, name: rope.name, a_name: e ? e.a.name : '?', b_name: e ? e.b.name : '?', a_phys: e ? physicsKind(e.a) : 'none', b_phys: e ? physicsKind(e.b) : 'none',
				length: Math.round(d.length * 10) / 10});
		}
	}
	vue.state = !live ? 'stopped' : live.playing ? 'playing' : 'paused';
	vue.rope_count = allRopes().length;
	vue.physics_on = performance.now() - hooked_at < 300;
}

function panelComponent() {
	return {
		data() {
			return {selection_key: null, has_rope: false, state: 'stopped', rope_count: 0, physics_on: false, name: '', a_name: '', b_name: '', a_phys: 'none', b_phys: 'none', length: 0,
				segments: 24, sides: 6, radius: 1, slack: 15, bend: 0.2, damping: 0.5, elastic: 0, gravity: 1, friction: 0.5, collide: true, attach: 'surface'};
		},
		computed: {
			polys() { return Math.round(this.segments) * Math.round(this.sides) + 2; },
		},
		methods: {
			t(key) { return tr(key); },
			create() { createRope(); },
			play() { playLive(); },
			pause() { pauseLive(); },
			reset() { stopLive(true); },
			keep() { keepLive(); },
			save(extra) {
				const rope = selectedRope();
				if (!rope) return;
				const patch = Object.assign({segments: clamp(Math.round(num(this.segments, 24)), 2, 120), sides: clamp(Math.round(num(this.sides, 6)), 3, 24),
					radius: clamp(num(this.radius, 1), 0.05, 32), slack: clamp(num(this.slack, 15), -30, 400), bend: clamp(num(this.bend, 0.2), 0, 1),
					damping: clamp(num(this.damping, 0.5), 0, 5), elastic: clamp(num(this.elastic, 0), 0, 1), gravity: clamp(num(this.gravity, 1), 0, 3),
					friction: clamp(num(this.friction, 0.5), 0, 1), collide: !!this.collide, attach: this.attach}, extra || {});
				editRope(rope, patch, 'Change rope');
				updatePanel(true);
			},
			refit() { this.save(); Blockbench.showQuickMessage(tr('msg_refit'), 1200); },
		},
		template: `
			<div class="rope_panel">
				<button class="rope_full" @click="create()">{{ t('create') }}</button>
				<div class="rope_buttons">
					<button v-if="state != 'playing'" @click="play()">{{ t('play') }}</button>
					<button v-else @click="pause()">{{ t('pause') }}</button>
					<button @click="reset()">{{ t('reset') }}</button>
					<button @click="keep()" :disabled="state == 'stopped'">{{ t('apply') }}</button>
				</div>
				<div class="rope_dim">{{ rope_count }} {{ t('ropes') }} · {{ t(state) }}<template v-if="physics_on"> · {{ t('physics') }}</template></div>

				<div v-if="!has_rope" class="rope_dim">{{ t('select_hint') }}</div>
				<template v-else>
					<div class="rope_title"><b>{{ name }}</b> <span class="rope_dim">{{ t('ends') }}: {{ a_name }} ↔ {{ b_name }} · {{ t('length') }} {{ length }} px</span></div>

					<div class="rope_dim small" style="margin: 0 0 6px;">{{ a_name }}: {{ t('phys_' + a_phys) }}<br>{{ b_name }}: {{ t('phys_' + b_phys) }}</div>

					<details class="rope_box" open>
						<summary>{{ t('detail') }} · {{ polys }} {{ t('polys') }}</summary>
						<div class="rope_slider"><span>{{ t('segments') }}</span><input type="range" min="2" max="80" step="1" v-model.number="segments" @change="save()"><span class="value">{{ segments }}</span></div>
						<div class="rope_slider"><span>{{ t('sides') }}</span><input type="range" min="3" max="16" step="1" v-model.number="sides" @change="save()"><span class="value">{{ sides }}</span></div>
						<div class="rope_slider"><span>{{ t('thickness') }}</span><input type="range" min="0.2" max="8" step="0.1" v-model.number="radius" @change="save()"><span class="value">{{ radius }}</span></div>
					</details>

					<details class="rope_box" open>
						<summary>{{ t('behavior') }}</summary>
						<div class="rope_slider" :title="t('slack_tip')"><span>{{ t('slack') }}</span><input type="range" min="-30" max="300" step="1" v-model.number="slack" @change="save()"><span class="value">{{ slack }}</span></div>
						<div class="rope_slider" :title="t('stiffness_tip')"><span>{{ t('stiffness') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="bend" @change="save()"><span class="value">{{ bend }}</span></div>
						<div class="rope_slider" :title="t('elastic_tip')"><span>{{ t('elastic') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="elastic" @change="save()"><span class="value">{{ elastic }}</span></div>
						<div class="rope_slider"><span>{{ t('damping') }}</span><input type="range" min="0" max="3" step="0.05" v-model.number="damping" @change="save()"><span class="value">{{ damping }}</span></div>
						<div class="rope_slider"><span>{{ t('gravity') }}</span><input type="range" min="0" max="2" step="0.05" v-model.number="gravity" @change="save()"><span class="value">{{ gravity }}</span></div>
						<div class="rope_slider"><span>{{ t('friction') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="friction" @change="save()"><span class="value">{{ friction }}</span></div>
						<label class="rope_row">{{ t('collide') }}<input type="checkbox" v-model="collide" @change="save()"></label>
						<label class="rope_row">{{ t('attach') }}
							<select v-model="attach" @change="save()">
								<option value="surface">{{ t('attach_surface') }}</option>
								<option value="center">{{ t('attach_center') }}</option>
							</select>
						</label>
					</details>
					<button class="rope_full" @click="refit()" :title="t('refit_tip')">{{ t('refit') }}</button>
				</template>
				<div class="rope_dim small">{{ t('footnote') }}</div>
			</div>`,
	};
}

const STYLE = `
	#panel_rope .rope_panel { overflow-y: auto !important; overflow-x: hidden !important; }
	.rope_panel { padding: 4px 8px 10px; font-size: 0.92em; }
	.rope_panel .rope_buttons { display: flex; gap: 4px; margin: 6px 0; }
	.rope_panel .rope_buttons button { flex: 1; min-width: 0; padding: 4px 6px; }
	.rope_panel .rope_full { width: 100%; padding: 5px 6px; margin: 2px 0; }
	.rope_panel .rope_dim { opacity: 0.7; margin: 2px 0 6px; }
	.rope_panel .rope_dim.small { font-size: 0.85em; opacity: 0.55; margin-top: 10px; }
	.rope_panel .rope_title { margin: 6px 0; }
	.rope_panel .rope_box { margin: 6px 0; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-back); }
	.rope_panel .rope_box > summary { cursor: pointer; text-transform: uppercase; font-size: 0.82em; opacity: 0.8; outline: none; }
	.rope_panel details.rope_box[open] > summary { margin-bottom: 6px; }
	.rope_panel .rope_slider { display: flex; align-items: center; gap: 6px; margin: 3px 0; font-size: 0.9em; }
	.rope_panel .rope_slider > span:first-child { width: 40%; }
	.rope_panel .rope_slider input[type=range] { flex: 1; min-width: 0; }
	.rope_panel .rope_slider .value { width: 34px; text-align: right; opacity: 0.8; }
	.rope_panel .rope_row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0; }
	.rope_panel select { background: var(--color-dark); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px; padding: 2px 4px; }
`;

const onSelection = () => updatePanel();

if (typeof __ROPE_EXPORT !== 'undefined') __ROPE_EXPORT({RopeSim, makeBox, surfacePoint, ringsOf, ropeTopology, writeTopology, writeShape, settleShape, createRope, fitRope, physicsHook, DEFAULT_ROPE});

if (typeof Plugin !== 'undefined' && typeof Blockbench !== 'undefined') Plugin.register('rope', {
	title: 'Rope',
	author: 'Claude',
	description: 'A physical rope between two objects: a real mesh with the polygon count and thickness you choose. It pulls physics objects (with the Physics plugin).',
	about: 'Open the **Ropes** tab, select two objects (cubes, meshes or groups) and press **Create rope**. A mesh tube appears between them. Change **segments** and **sides** (the polygon count), **thickness**, **slack**, **stiffness**, **stretch**, damping, gravity and friction in the panel. **Simulate** moves the rope on its own: its ends follow the objects, it hangs, swings and lies on other objects and on the ground. In the **Physics** tab the rope is also a real constraint: ropes between physics objects pull them (a tow rope) and a rope on a static object holds a falling body, in the preview and in the bake. **Keep shape** writes the current shape into the mesh.',
	icon: 'cable',
	version: '0.1.1',
	variant: 'both',
	min_version: '4.10.0',
	tags: ['Animation'],
	onload() {
		properties.push(new Property(Mesh, 'object', 'rope', {default: null}));
		style_node = Blockbench.addCSS(STYLE);
		mode = new Mode('rope', {
			name: tr('mode'),
			icon: 'cable',
			category: 'navigate',
			condition: () => Project && Format && Format.id != 'image',
			default_tool: 'move_tool',
			onSelect() { updatePanel(true); },
			onUnselect() { stopLive(true); },
		});
		panel = new Panel('rope', {
			name: tr('mode'),
			growable: true,
			resizable: true,
			min_height: 200,
			icon: 'cable',
			condition: {modes: ['rope']},
			default_position: {slot: 'right_bar', float_position: [0, 0], float_size: [320, 520], height: 520},
			component: panelComponent(),
		});
		const outliner = Interface.Panels.outliner;
		if (outliner && outliner.condition && outliner.condition.modes instanceof Array && !outliner.condition.modes.includes('rope')) outliner.condition.modes.push('rope');
		create_action = new Action('rope_create', {
			name: tr('create'), icon: 'cable', category: 'edit',
			condition: () => Project && Outliner.selected.filter(el => el.mesh).length == 2,
			click() { createRope(); },
		});
		for (const type of [Cube, Mesh, Group]) { try { type.prototype.menu.addAction(create_action, 0); } catch (err) { /* no menu */ } }
		globalThis.__physicsHooks = (globalThis.__physicsHooks || []).filter(h => h !== physicsHook).concat([physicsHook]);
		Blockbench.on('update_selection', onSelection);
		Blockbench.on('select_project', onSelection);
	},
	onunload() {
		stopLive(true);
		physicsHook.stop();
		globalThis.__physicsHooks = (globalThis.__physicsHooks || []).filter(h => h !== physicsHook);
		Blockbench.removeListener('update_selection', onSelection);
		Blockbench.removeListener('select_project', onSelection);
		if (Modes.rope) Modes.options.edit.select();
		const outliner = Interface.Panels.outliner;
		if (outliner && outliner.condition && outliner.condition.modes instanceof Array) outliner.condition.modes.remove('rope');
		for (const type of [Cube, Mesh, Group]) { try { type.prototype.menu.removeAction(create_action); } catch (err) { /* ignore */ } }
		if (create_action) create_action.delete();
		if (panel) panel.delete();
		if (mode) mode.delete();
		properties.forEach(p => p.delete());
		properties = [];
		if (style_node) style_node.delete();
	},
});

})();
