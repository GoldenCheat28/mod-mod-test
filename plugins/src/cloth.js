(function () {
'use strict';

/*
 * Cloth — a mesh that hangs, drapes and flutters: a cape, a flag, a curtain, a tablecloth.
 *
 * Mark a mesh as cloth (right click → Cloth, or Add → Cloth for a ready subdivided sheet). Every vertex becomes a little
 * mass, every edge a thread that keeps its length, and the faces resist folding (bending stiffness). Pick faces in the
 * mesh's face mode and press Freeze (they stay where they are) or Attach (they move with an object: a physics body, a bone of
 * a ragdoll, any group). It runs inside the Physics tab: Play shows it live, falling onto and around the physics bodies and
 * the floor; Bake records it, and the Animate tab and a video from the Render view play the recording back.
 *
 * Units: 16 Blockbench pixels = 1 metre.
 */

const SCALE = 16;
const EPS = 1e-9;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => isFinite(parseFloat(v)) ? parseFloat(v) : d;

const DEFAULT_CLOTH = {enabled: true, stretch: 1, bend: 0.25, damping: 0.4, thickness: 0.5, friction: 0.5, gravity: 1, iterations: 8, frozen: [], attached: []};
const clothOf = el => Object.assign({}, DEFAULT_CLOTH, el.cloth || {});
const isCloth = el => el instanceof Mesh && !!el.cloth && el.cloth.enabled !== false;
const allCloth = () => Mesh.all.filter(isCloth);

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

const TEXTS = {
	en: {
		panel: 'Cloth', make: 'Make it cloth', remove: 'Not cloth any more', add: 'Add cloth', add_desc: 'A subdivided sheet of cloth at the current view',
		act_cloth: 'Cloth…', act_cloth_desc: 'Make the selected mesh hang, drape and flutter like cloth (Physics tab)',
		stretch: 'Stretch stiffness', bend: 'Bend stiffness', damping: 'Air damping', thickness: 'Thickness (px)', friction: 'Friction', gravity: 'Gravity ×', iterations: 'Accuracy',
		pins: 'Pinned faces', freeze: 'Freeze selected faces', attach: 'Attach selected faces to', attach_btn: 'Attach', unpin: 'Unpin selected', unpin_all: 'Unpin all',
		frozen_n: 'frozen vertices', attached_n: 'attached to', none: '— pick an object —',
		hint: 'Select faces (or vertices) of the mesh in Edit mode, then Freeze or Attach them. The cloth moves in the Physics tab: Play shows it, Bake records it for the Animate tab and for videos. More faces = softer folds (Add cloth makes a 16×16 sheet).',
		msg_faces: 'Select faces or vertices of this mesh first (Edit mode, face or vertex selection)', msg_pinned: 'Pinned: % vertices', msg_target: 'Pick the object to attach to',
		select_mesh: 'Select a mesh to make it cloth.', cloth_name: 'Cloth', verts: 'vertices',
	},
	ru: {
		panel: 'Ткань', make: 'Сделать тканью', remove: 'Больше не ткань', add: 'Добавить ткань', add_desc: 'Разбитое на клетки полотно ткани в текущем ракурсе',
		act_cloth: 'Ткань…', act_cloth_desc: 'Выбранный меш висит, драпируется и развевается как ткань (вкладка «Физика»)',
		stretch: 'Жёсткость на растяжение', bend: 'Жёсткость на изгиб', damping: 'Сопротивление воздуха', thickness: 'Толщина (px)', friction: 'Трение', gravity: 'Гравитация ×', iterations: 'Точность',
		pins: 'Закреплённые грани', freeze: 'Заморозить выбранные грани', attach: 'Прикрепить выбранные грани к', attach_btn: 'Прикрепить', unpin: 'Открепить выбранные', unpin_all: 'Открепить все',
		frozen_n: 'вершин заморожено', attached_n: 'прикреплено к', none: '— выберите объект —',
		hint: 'Выделите грани (или вершины) меша в режиме редактирования и нажмите «Заморозить» или «Прикрепить». Ткань движется во вкладке «Физика»: Play показывает, Bake записывает для вкладки «Анимация» и для видео. Больше граней — мягче складки («Добавить ткань» делает полотно 16×16).',
		msg_faces: 'Сначала выделите грани или вершины этого меша (режим редактирования, выбор граней или вершин)', msg_pinned: 'Закреплено вершин: %', msg_target: 'Выберите объект, к которому прикрепить',
		select_mesh: 'Выделите меш, чтобы сделать его тканью.', cloth_name: 'Ткань', verts: 'вершин',
	},
};
const tr = key => {
	const lang = (typeof Language != 'undefined' && Language.code) || 'en';
	return (TEXTS[lang] && TEXTS[lang][key]) || TEXTS.en[key] || key;
};

// ---------------------------------------------------------------------------
// The simulation (position based dynamics, in Blockbench pixels)
// ---------------------------------------------------------------------------

class ClothSim {
	// points: [Vector3] world positions; edges: [[i, j]]; bends: [[i, j]]; shear: [[i, j]]; pinned: Set of particle indices
	constructor(points, links, o) {
		this.n = points.length;
		this.x = new Float64Array(this.n * 3);
		this.p = new Float64Array(this.n * 3);
		points.forEach((q, i) => { this.x.set([q.x, q.y, q.z], i * 3); this.p.set([q.x, q.y, q.z], i * 3); });
		this.w = new Float64Array(this.n).fill(1);     // 0 = pinned
		this.o = Object.assign({gravity: 9.81 * SCALE, damping: 0.4, stretch: 1, bend: 0.25, thickness: 0.5, friction: 0.5, iterations: 8, substeps: 4}, o || {});
		const len = (i, j) => Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y, points[i].z - points[j].z);
		this.links = links.map(([i, j, kind]) => ({i, j, rest: len(i, j), kind}));
		this.contact = new Uint8Array(this.n);
		this.cn = new Float64Array(this.n * 3);   // the normal of what each point touches
		// the size of a cell of the cloth: things are kept that far off its threads, not only off its points (a corner of a
		// box went in between the points), and its own folds keep that far apart
		const edges = this.links.filter(L => L.kind == 'edge');
		this.cell = edges.length ? edges.reduce((a, L) => a + L.rest, 0) / edges.length : 1;
		this.near = new Set();   // pairs joined by a thread: never pushed apart by self-collision
		for (const L of this.links) this.near.add(Math.min(L.i, L.j) * this.n + Math.max(L.i, L.j));
	}
	pin(i, pos) { this.w[i] = 0; const k = i * 3; this.x[k] = this.p[k] = pos.x; this.x[k + 1] = this.p[k + 1] = pos.y; this.x[k + 2] = this.p[k + 2] = pos.z; }

	// targets: [{i, from: Vector3, to: Vector3}] for the pinned ones (they slide from where they were to where they are now)
	step(dt, targets, boxes, ground) {
		const {x, p, w, o, n} = this;
		const sub = o.substeps, h = dt / sub, damp = Math.exp(-o.damping * h), g = o.gravity * h * h;
		const stiff = {edge: clamp(o.stretch, 0, 1), shear: clamp(o.stretch, 0, 1) * 0.6, bend: clamp(o.bend, 0, 1) * 0.5};
		const r = Math.max(0.05, o.thickness, this.cell * 0.5);
		this.contact.fill(0);
		for (let s = 1; s <= sub; s++) {
			const f = s / sub;
			this.contact.fill(0);
			for (const t of targets) {
				const k = t.i * 3;
				x[k] = p[k] = t.from.x + (t.to.x - t.from.x) * f; x[k + 1] = p[k + 1] = t.from.y + (t.to.y - t.from.y) * f; x[k + 2] = p[k + 2] = t.from.z + (t.to.z - t.from.z) * f;
			}
			for (let i = 0; i < n; i++) {
				if (!w[i]) continue;
				const k = i * 3;
				for (let c = 0; c < 3; c++) {
					const cur = x[k + c];
					x[k + c] += (cur - p[k + c]) * damp - (c == 1 ? g : 0);
					p[k + c] = cur;
				}
			}
			// the threads and the contacts are solved together, round after round: done after the threads only, the threads
			// pulled the cloth back into what it lay on
			for (let it = 0; it < o.iterations; it++) {
				const links = this.links, forward = (it & 1) == 0;
				for (let q = 0; q < links.length; q++) {
					const L = links[forward ? q : links.length - 1 - q];
					this.distance(L.i, L.j, L.rest, stiff[L.kind]);
				}
				this.collide(boxes, ground, r);
			}
			if (o.self !== false) this.selfCollide(this.cell * 0.7);
			this.collide(boxes, ground, r);
			// friction: where a point touches something, its sliding along that surface in this substep is held back
			const mu = clamp(o.friction, 0, 1), cn = this.cn;
			for (let i = 0; i < n; i++) {
				if (!this.contact[i] || !w[i]) continue;
				const k = i * 3;
				const dx = x[k] - p[k], dy = x[k + 1] - p[k + 1], dz = x[k + 2] - p[k + 2];
				const dn = dx * cn[k] + dy * cn[k + 1] + dz * cn[k + 2];
				x[k] -= (dx - dn * cn[k]) * mu; x[k + 1] -= (dy - dn * cn[k + 1]) * mu; x[k + 2] -= (dz - dn * cn[k + 2]) * mu;
			}
		}
	}
	collide(boxes, ground, r) {
		const {x, w, n} = this;
		if (boxes && boxes.length) for (let i = 0; i < n; i++) if (w[i]) for (let m = 0; m < boxes.length; m++) this.collideBox(i, boxes[m], r);
		if (ground !== null && ground !== undefined) for (let i = 0; i < n; i++) {
			const k = i * 3 + 1;
			if (w[i] && x[k] < ground + r) { x[k] = ground + r; this.contact[i] = 1; this.cn[i * 3] = 0; this.cn[i * 3 + 1] = 1; this.cn[i * 3 + 2] = 0; }
		}
	}
	// its own folds do not pass through each other: points that are not neighbours are kept `d` apart (a grid of cells finds them)
	selfCollide(d) {
		const {x, w, n} = this, inv = 1 / d, grid = new Map(), d2 = d * d;
		const key = (a, b, c) => ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791));
		for (let i = 0; i < n; i++) {
			const kk = key(Math.floor(x[i * 3] * inv), Math.floor(x[i * 3 + 1] * inv), Math.floor(x[i * 3 + 2] * inv));
			const list = grid.get(kk);
			if (list) list.push(i); else grid.set(kk, [i]);
		}
		for (let i = 0; i < n; i++) {
			const cx = Math.floor(x[i * 3] * inv), cy = Math.floor(x[i * 3 + 1] * inv), cz = Math.floor(x[i * 3 + 2] * inv);
			for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
				const list = grid.get(key(cx + a, cy + b, cz + c));
				if (!list) continue;
				for (const j of list) {
					if (j <= i || this.near.has(i * n + j)) continue;
					const wi = w[i], wj = w[j], ws = wi + wj;
					if (!ws) continue;
					const dx = x[j * 3] - x[i * 3], dy = x[j * 3 + 1] - x[i * 3 + 1], dz = x[j * 3 + 2] - x[i * 3 + 2];
					const q = dx * dx + dy * dy + dz * dz;
					if (q >= d2 || q < EPS) continue;
					const dist = Math.sqrt(q), push = (d - dist) / dist / ws;
					x[i * 3] -= dx * push * wi; x[i * 3 + 1] -= dy * push * wi; x[i * 3 + 2] -= dz * push * wi;
					x[j * 3] += dx * push * wj; x[j * 3 + 1] += dy * push * wj; x[j * 3 + 2] += dz * push * wj;
				}
			}
		}
	}
	distance(i, j, rest, stiffness) {
		if (stiffness <= 0) return;
		const x = this.x, wi = this.w[i], wj = this.w[j], ws = wi + wj;
		if (!ws) return;
		const ki = i * 3, kj = j * 3;
		const dx = x[kj] - x[ki], dy = x[kj + 1] - x[ki + 1], dz = x[kj + 2] - x[ki + 2];
		const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (d < EPS) return;
		const diff = (d - rest) / d * stiffness / ws;
		x[ki] += dx * diff * wi; x[ki + 1] += dy * diff * wi; x[ki + 2] += dz * diff * wi;
		x[kj] -= dx * diff * wj; x[kj + 1] -= dy * diff * wj; x[kj + 2] -= dz * diff * wj;
	}
	// push particle i (a ball of radius r) out of an oriented box
	collideBox(i, box, r) {
		const x = this.x, k = i * 3;
		const px = x[k], py = x[k + 1], pz = x[k + 2];
		if (px < box.min[0] - r || px > box.max[0] + r || py < box.min[1] - r || py > box.max[1] + r || pz < box.min[2] - r || pz > box.max[2] + r) return;
		const A = box.axes, H = box.half;
		const dx = px - box.c[0], dy = py - box.c[1], dz = pz - box.c[2];
		const l0 = dx * A[0] + dy * A[1] + dz * A[2], l1 = dx * A[3] + dy * A[4] + dz * A[5], l2 = dx * A[6] + dy * A[7] + dz * A[8];
		const c0 = clamp(l0, -H[0], H[0]), c1 = clamp(l1, -H[1], H[1]), c2 = clamp(l2, -H[2], H[2]);
		let n0 = l0 - c0, n1 = l1 - c1, n2 = l2 - c2, push;
		const dist = Math.sqrt(n0 * n0 + n1 * n1 + n2 * n2);
		if (dist > EPS) {
			if (dist >= r) return;
			push = r - dist; n0 /= dist; n1 /= dist; n2 /= dist;
		} else {
			const pen0 = H[0] - Math.abs(l0), pen1 = H[1] - Math.abs(l1), pen2 = H[2] - Math.abs(l2);
			n0 = n1 = n2 = 0;
			if (pen0 <= pen1 && pen0 <= pen2) { n0 = l0 < 0 ? -1 : 1; push = pen0 + r; }
			else if (pen1 <= pen2) { n1 = l1 < 0 ? -1 : 1; push = pen1 + r; }
			else { n2 = l2 < 0 ? -1 : 1; push = pen2 + r; }
		}
		const wx = n0 * A[0] + n1 * A[3] + n2 * A[6], wy = n0 * A[1] + n1 * A[4] + n2 * A[7], wz = n0 * A[2] + n1 * A[5] + n2 * A[8];
		x[k] += wx * push; x[k + 1] += wy * push; x[k + 2] += wz * push;
		this.contact[i] = 1;
		this.cn[k] = wx; this.cn[k + 1] = wy; this.cn[k + 2] = wz;
	}
	point(i, out) { return out.set(this.x[i * 3], this.x[i * 3 + 1], this.x[i * 3 + 2]); }
}

// the threads of a mesh: its edges, the diagonals of its quads (shear) and links across every shared edge (bending)
function clothLinks(el, index) {
	const links = [], seen = new Set(), edge_faces = new Map();
	const add = (a, b, kind) => { if (a === b) return; const key = a < b ? a + '|' + b + '|' + kind : b + '|' + a + '|' + kind; if (seen.has(key)) return; seen.add(key); links.push([a, b, kind]); };
	for (const f of Object.values(el.faces)) {
		const vs = (f.getSortedVertices ? f.getSortedVertices() : f.vertices).map(k => index.get(k)).filter(i => i !== undefined);
		for (let i = 0; i < vs.length; i++) {
			const a = vs[i], b = vs[(i + 1) % vs.length];
			add(a, b, 'edge');
			const key = a < b ? a + '|' + b : b + '|' + a;
			if (!edge_faces.has(key)) edge_faces.set(key, []);
			edge_faces.get(key).push(vs);
		}
		if (vs.length == 4) { add(vs[0], vs[2], 'shear'); add(vs[1], vs[3], 'shear'); }
	}
	// bending: the far corners of two faces that share an edge
	for (const [key, faces] of edge_faces) {
		if (faces.length < 2) continue;
		const [a, b] = key.split('|').map(Number);
		const far = vs => vs.filter(v => v !== a && v !== b);
		const fa = far(faces[0]), fb = far(faces[1]);
		if (fa.length && fb.length) add(fa[fa.length > 1 ? 1 : 0], fb[0], 'bend');
	}
	return links;
}

// ---------------------------------------------------------------------------
// Inside the Physics tab
// ---------------------------------------------------------------------------

function restPose() {
	if (typeof Canvas != 'undefined') { Canvas.updateAllPositions(); Canvas.updateAllBones(); }
	scene.updateMatrixWorld(true);
}
const findNode = uuid => uuid && [...Group.all, ...Cube.all, ...Mesh.all].find(n => n.uuid == uuid);
function entryFor(rt, node) {
	for (let n = node; n && n != 'root'; n = n.parent) {
		const e = rt.world.entries.find(en => en.desc.node === n && !en.broken);
		if (e) return e;
	}
	return null;
}
const bodyMatrix = entry => {
	const p = entry.body.GetPosition(), r = entry.body.GetRotation();
	return new THREE.Matrix4().compose(new THREE.Vector3(p.GetX() * SCALE, p.GetY() * SCALE, p.GetZ() * SCALE), new THREE.Quaternion(r.GetX(), r.GetY(), r.GetZ(), r.GetW()), new THREE.Vector3(1, 1, 1));
};
const groundY = ws => Project.model_3d.localToWorld(new THREE.Vector3(0, (ws && ws.ground !== false) ? (ws.ground_y || 0) : -1e9, 0)).y;

// the cloth meshes, ready to move: their particles (one per vertex), threads and pins
function makeItem(el, rt) {
	if (!el.mesh) return null;
	el.mesh.updateMatrixWorld(true);
	const d = clothOf(el);
	const keys = Object.keys(el.vertices), index = new Map(keys.map((k, i) => [k, i]));
	const world = keys.map(k => new THREE.Vector3(...el.vertices[k]).applyMatrix4(el.mesh.matrixWorld));
	const sim = new ClothSim(world, clothLinks(el, index), {damping: d.damping * 3, stretch: d.stretch, bend: d.bend, thickness: d.thickness, friction: d.friction, gravity: 9.81 * SCALE * d.gravity, iterations: Math.round(clamp(d.iterations, 2, 30))});
	// frozen: stay where they are; attached: ride on their object (a physics body, or the object as it stands)
	const pins = [];
	for (const k of d.frozen || []) if (index.has(k)) pins.push({i: index.get(k), world: world[index.get(k)].clone()});
	for (const a of d.attached || []) {
		const node = findNode(a.target);
		if (!node) continue;
		const entry = rt ? entryFor(rt, node) : null;
		for (const k of a.vertices || []) {
			if (!index.has(k)) continue;
			const i = index.get(k), p = world[i].clone();
			pins.push(entry ? {i, entry, local: p.clone().applyMatrix4(entry.rest_inv ? new THREE.Matrix4().copy(entry.rest_inv) : bodyMatrix(entry).invert())} : {i, world: p});
		}
	}
	pins.forEach(pin => sim.pin(pin.i, pin.world || world[pin.i]));
	return {el, d, keys, sim, pins, inverse: el.mesh.matrixWorld.clone().invert(), original: JSON.parse(JSON.stringify(el.vertices)), last: pins.map(pin => (pin.world || world[pin.i]).clone())};
}
const pinWorld = pin => pin.entry ? pin.local.clone().applyMatrix4(bodyMatrix(pin.entry)) : pin.world.clone();

// the shape of a cloth into its mesh's preview (the vertices of the element are put back at once: the model itself keeps
// its shape, only what is drawn changes)
function drawShape(el, keys, positions) {
	const saved = el.vertices, shown = {};
	keys.forEach((k, i) => { shown[k] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]; });
	el.vertices = Object.assign({}, saved, shown);
	try { if (Mesh.preview_controller && Mesh.preview_controller.updateGeometry) Mesh.preview_controller.updateGeometry(el); else Canvas.updateView({elements: [el], element_aspects: {geometry: true}}); }
	finally { el.vertices = saved; }
}
function drawRest(el) {
	try { if (Mesh.preview_controller && Mesh.preview_controller.updateGeometry) Mesh.preview_controller.updateGeometry(el); else Canvas.updateView({elements: [el], element_aspects: {geometry: true}}); } catch (err) { /* gone */ }
}
// the particles of an item in the mesh's own space
function localPositions(item) {
	const out = new Float32Array(item.keys.length * 3), v = new THREE.Vector3();
	for (let i = 0; i < item.keys.length; i++) { item.sim.point(i, v).applyMatrix4(item.inverse); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
	return out;
}

let hooked = null;
const physicsHook = {
	active: () => !!Project && allCloth().length > 0,
	start(rt) {
		this.stop();
		restPose();
		const items = allCloth().map(el => { try { return makeItem(el, rt); } catch (err) { console.warn('[Cloth]', el.name, err); return null; } }).filter(Boolean);
		// a cloth mesh ticked as Ground / Physics object in an older physics.js is a box where the cloth was: never collide with it
		const own = new Set((rt.world && rt.world.entries || []).filter(e => e.desc && ((e.desc.node && isCloth(e.desc.node)) || (e.desc.parts || []).some(pt => pt.el && isCloth(pt.el)))));
		hooked = items.length ? {rt, items, step: 0, own, record: rt.baking ? {times: [], frames: items.map(() => [])} : null} : null;
	},
	step(rt, dt) {
		if (!hooked || hooked.rt !== rt) return;
		const boxes = hooked.step++ % 2 == 0 || !hooked.boxes ? (hooked.boxes = rt.colliders ? rt.colliders(hooked.own) : []) : hooked.boxes;
		const ground = groundY(rt.ws);
		for (const it of hooked.items) {
			const targets = it.pins.map((pin, k) => { const to = pinWorld(pin), from = it.last[k]; it.last[k] = to; return {i: pin.i, from, to}; });
			it.sim.step(dt, targets, boxes, ground);
		}
	},
	show() {
		if (!hooked) return;
		for (const it of hooked.items) drawShape(it.el, it.keys, localPositions(it));
	},
	bake_frame(rt, time) {
		if (!hooked || hooked.rt !== rt || !hooked.record) return;
		hooked.record.times.push(time);
		hooked.items.forEach((it, i) => hooked.record.frames[i].push(localPositions(it)));
	},
	baked(rt, animation) {
		if (!hooked || hooked.rt !== rt || !hooked.record || !animation) return;
		const rec = hooked.record;
		const bake = {times: rec.times, meshes: {}};
		hooked.items.forEach((it, i) => {
			const all = new Float32Array(rec.frames[i].length * it.keys.length * 3);
			rec.frames[i].forEach((f, k) => all.set(f, k * it.keys.length * 3));
			bake.meshes[it.el.uuid] = {keys: it.keys, data: toBase64(all)};
		});
		const store = Object.assign({}, Project.cloth_bakes || {});
		store[animation.uuid] = bake;
		Project.cloth_bakes = store;
		decoded.delete(animation.uuid);
	},
	stop() {
		if (!hooked) return;
		const h = hooked;
		hooked = null;
		h.items.forEach(it => drawRest(it.el));
	},
};

// ---------------------------------------------------------------------------
// Playing a bake back: the Animate tab (at the time of the timeline) and videos from the Render view
// ---------------------------------------------------------------------------

function toBase64(f32) {
	const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
	let s = '';
	for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
	return btoa(s);
}
function fromBase64(b64) {
	const s = atob(b64), u8 = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
	return new Float32Array(u8.buffer);
}
const decoded = new Map();   // animation uuid -> {times, meshes: {uuid: {keys, data: Float32Array}}}
function bakeFor(animation) {
	if (!animation || !Project || !Project.cloth_bakes || !Project.cloth_bakes[animation.uuid]) return null;
	if (!decoded.has(animation.uuid)) {
		const b = Project.cloth_bakes[animation.uuid], meshes = {};
		for (const uuid in b.meshes) meshes[uuid] = {keys: b.meshes[uuid].keys, data: fromBase64(b.meshes[uuid].data)};
		decoded.set(animation.uuid, {times: b.times, meshes});
	}
	return decoded.get(animation.uuid);
}
let showing = new Set();   // meshes drawn from a bake right now
function showBakeAt(animation, time) {
	const bake = bakeFor(animation);
	const now = new Set();
	if (bake && bake.times.length) {
		const T = bake.times;
		let f = 0;
		while (f + 1 < T.length && T[f + 1] <= time) f++;
		const g = f + 1 < T.length ? clamp((time - T[f]) / Math.max(1e-6, T[f + 1] - T[f]), 0, 1) : 0;
		for (const uuid in bake.meshes) {
			const el = Mesh.all.find(m => m.uuid == uuid);
			if (!el) continue;
			const {keys, data} = bake.meshes[uuid], n = keys.length * 3;
			const a = f * n, b = Math.min(T.length - 1, f + 1) * n, pos = new Float32Array(n);
			for (let i = 0; i < n; i++) pos[i] = data[a + i] + (data[b + i] - data[a + i]) * g;
			drawShape(el, keys, pos);
			now.add(el);
		}
	}
	for (const el of showing) if (!now.has(el)) drawRest(el);
	showing = now;
}
function onAnimationFrame() {
	if (hooked) return;   // the live simulation draws
	const anim = typeof Modes != 'undefined' && Modes.animate && typeof Animation != 'undefined' ? Animation.selected : null;
	try { showBakeAt(anim, typeof Timeline != 'undefined' ? Timeline.time : 0); } catch (err) { console.warn('[Cloth] playback', err); }
}
const renderHook = {
	name: 'cloth',
	available: () => !!(Project && Project.cloth_bakes && Object.keys(Project.cloth_bakes).length),
	frame(time) { try { showBakeAt(typeof Animation != 'undefined' ? Animation.selected : null, time); } catch (err) { console.warn('[Cloth] video', err); } },
	end() { onAnimationFrame(); },
};

// ---------------------------------------------------------------------------
// Editing: making cloth, pinning faces
// ---------------------------------------------------------------------------

function selectedMesh() { return Project ? (Mesh.selected || []).find(m => m instanceof Mesh) || null : null; }
// the vertices picked in the mesh: of the selected faces, or the selected vertices
function pickedVertices(el) {
	const out = new Set();
	try { if (el.getSelectedFaces) for (const fk of el.getSelectedFaces()) { const f = el.faces[fk]; if (f) f.vertices.forEach(v => out.add(v)); } } catch (err) { /* older Blockbench */ }
	try { if (el.getSelectedVertices) el.getSelectedVertices().forEach(v => out.add(v)); } catch (err) { /* older Blockbench */ }
	return [...out];
}
function editCloth(el, label, fn) {
	Undo.initEdit({elements: [el]});
	const d = clothOf(el);
	fn(d);
	el.cloth = d;
	Undo.finishEdit(label, {elements: [el]});
	Project.saved = false;
	updatePanel(true);
}
function pinSelected(el, how, target) {
	const vs = pickedVertices(el);
	if (!vs.length) { Blockbench.showQuickMessage(tr('msg_faces'), 3000); return; }
	if (how == 'attach' && !target) { Blockbench.showQuickMessage(tr('msg_target'), 2500); return; }
	editCloth(el, 'Pin cloth', d => {
		const set = new Set(vs);
		d.frozen = (d.frozen || []).filter(k => !set.has(k));
		d.attached = (d.attached || []).map(a => ({target: a.target, vertices: a.vertices.filter(k => !set.has(k))})).filter(a => a.vertices.length);
		if (how == 'freeze') d.frozen.push(...vs);
		else if (how == 'attach') {
			const a = d.attached.find(x => x.target == target);
			if (a) a.vertices.push(...vs); else d.attached.push({target, vertices: vs});
		}
	});
	if (how != 'unpin') Blockbench.showQuickMessage(tr('msg_pinned').replace('%', vs.length), 1500);
}
function addClothSheet() {
	if (!Project) return;
	const preview = Preview.selected;
	let c = new THREE.Vector3(0, 24, 0);
	if (preview && preview.controls) c = Project.model_3d.worldToLocal(preview.controls.target.clone()).add(new THREE.Vector3(0, 16, 0));
	const N = 16, size = 32;
	Undo.initEdit({outliner: true, elements: [], selection: true});
	const el = new Mesh({name: tr('cloth_name'), origin: c.toArray().map(v => Math.round(v * 100) / 100), vertices: {}});
	const pts = [];
	for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pts.push([(i / N - 0.5) * size, 0, (j / N - 0.5) * size]);
	const keys = el.addVertices(...pts);
	const W = Project.texture_width || 16, H = Project.texture_height || 16;
	const faces = [];
	for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
		const a = j * (N + 1) + i, b = a + 1, cc = a + N + 2, d = a + N + 1;
		const vs = [keys[a], keys[d], keys[cc], keys[b]], uv = {};
		[[a, i, j], [d, i, j + 1], [cc, i + 1, j + 1], [b, i + 1, j]].forEach(([k, u, v]) => { uv[keys[k]] = [u / N * W, v / N * H]; });
		faces.push(new MeshFace(el, {vertices: vs, uv}));
	}
	el.addFaces(...faces);
	el.cloth = Object.assign({}, DEFAULT_CLOTH);
	el.addTo().init();
	el.select();
	Undo.finishEdit('Add cloth', {outliner: true, elements: [el], selection: true});
	updatePanel(true);
}

// the pinned vertices of the selected cloth, as dots in the viewport
let pin_view = null;
function syncPinView() {
	const el = selectedMesh();
	const key = el && isCloth(el) ? el.uuid + JSON.stringify(el.cloth.frozen) + JSON.stringify(el.cloth.attached) + (el.mesh ? el.mesh.matrixWorld.elements.join(',') : '') : '';
	if (pin_view && pin_view.key == key) return;
	if (pin_view && pin_view.obj.parent) { pin_view.obj.parent.remove(pin_view.obj); pin_view.obj.geometry.dispose(); pin_view.obj.material.dispose(); }
	pin_view = null;
	if (!key || !el.mesh) return;
	const d = clothOf(el), pos = [], col = [];
	const add = (k, c) => { const v = el.vertices[k]; if (!v) return; const w = new THREE.Vector3(...v).applyMatrix4(el.mesh.matrixWorld); pos.push(w.x, w.y, w.z); col.push(...c); };
	(d.frozen || []).forEach(k => add(k, [0.3, 0.7, 1]));
	(d.attached || []).forEach(a => a.vertices.forEach(k => add(k, [1, 0.6, 0.2])));
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	const obj = new THREE.Points(geo, new THREE.PointsMaterial({size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true}));
	obj.renderOrder = 999;
	scene.add(obj);
	pin_view = {key, obj};
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

let panel = null, properties = [], actions = [], poll = null;

function updatePanel(force) {
	if (!panel || !panel.inside_vue) return;
	const vue = panel.inside_vue, el = selectedMesh();
	const key = el ? el.uuid + JSON.stringify(el.cloth) : '';
	if (!force && vue.key == key) return;
	vue.key = key;
	vue.has_mesh = !!el;
	vue.is_cloth = !!(el && isCloth(el));
	vue.name = el ? el.name : '';
	vue.vertex_count = el ? Object.keys(el.vertices).length : 0;
	const d = el ? clothOf(el) : DEFAULT_CLOTH;
	Object.assign(vue, {stretch: d.stretch, bend: d.bend, damping: d.damping, thickness: d.thickness, friction: d.friction, gravity: d.gravity, iterations: d.iterations,
		frozen_n: (d.frozen || []).length, attached: (d.attached || []).map(a => ({name: (findNode(a.target) || {}).name || '?', n: a.vertices.length}))});
	vue.targets = Project ? [...Group.all, ...Cube.all, ...Mesh.all].filter(n => n !== el).map(n => ({uuid: n.uuid, name: n.name})) : [];
}

function panelComponent() {
	const slider = (key, min, max, step) => `<div class="cl_slider"><span class="label">{{ t('${key}') }}</span><input type="range" min="${min}" max="${max}" step="${step}" v-model.number="${key}" @change="save()"><span>{{ ${key} }}</span></div>`;
	return {
		data() { return {key: '', has_mesh: false, is_cloth: false, name: '', vertex_count: 0, stretch: 1, bend: 0.25, damping: 0.4, thickness: 0.5, friction: 0.5, gravity: 1, iterations: 8, frozen_n: 0, attached: [], targets: [], target: ''}; },
		methods: {
			t: tr,
			make() { const el = selectedMesh(); if (el) editCloth(el, 'Make cloth', d => { d.enabled = true; }); },
			unmake() { const el = selectedMesh(); if (!el) return; Undo.initEdit({elements: [el]}); el.cloth = null; Undo.finishEdit('Remove cloth', {elements: [el]}); updatePanel(true); },
			save() {
				const el = selectedMesh();
				if (!el) return;
				editCloth(el, 'Change cloth', d => Object.assign(d, {stretch: clamp(num(this.stretch, 1), 0, 1), bend: clamp(num(this.bend, 0.25), 0, 1), damping: clamp(num(this.damping, 0.4), 0, 5),
					thickness: clamp(num(this.thickness, 0.5), 0.05, 20), friction: clamp(num(this.friction, 0.5), 0, 1), gravity: clamp(num(this.gravity, 1), -2, 5), iterations: Math.round(clamp(num(this.iterations, 8), 2, 30))}));
			},
			freeze() { const el = selectedMesh(); if (el) pinSelected(el, 'freeze'); },
			attach() { const el = selectedMesh(); if (el) pinSelected(el, 'attach', this.target); },
			unpin() { const el = selectedMesh(); if (el) pinSelected(el, 'unpin'); },
			unpinAll() { const el = selectedMesh(); if (el) editCloth(el, 'Unpin cloth', d => { d.frozen = []; d.attached = []; }); },
			addSheet() { addClothSheet(); },
		},
		template: `
			<div class="cloth_panel" style="padding: 4px 8px 10px;">
				<button class="cl_btn" @click="addSheet()">{{ t('add') }}</button>
				<div v-if="!has_mesh" class="cl_hint">{{ t('select_mesh') }}</div>
				<template v-else>
					<div class="cl_row"><b>{{ name }}</b><span class="cl_dim">{{ vertex_count }} {{ t('verts') }}</span></div>
					<button v-if="!is_cloth" class="cl_btn" @click="make()">{{ t('make') }}</button>
					<template v-else>
						${slider('stretch', 0, 1, 0.05)}
						${slider('bend', 0, 1, 0.05)}
						${slider('damping', 0, 5, 0.05)}
						${slider('thickness', 0.05, 8, 0.05)}
						${slider('friction', 0, 1, 0.05)}
						${slider('gravity', -2, 5, 0.1)}
						${slider('iterations', 2, 30, 1)}
						<div class="cl_cap">{{ t('pins') }}</div>
						<div class="cl_dim">{{ frozen_n }} {{ t('frozen_n') }}</div>
						<div class="cl_dim" v-for="a in attached">{{ a.n }} → {{ a.name }}</div>
						<button class="cl_btn" @click="freeze()">{{ t('freeze') }}</button>
						<div class="cl_row">
							<select v-model="target" style="flex: 1; min-width: 0;"><option value="">{{ t('none') }}</option><option v-for="x in targets" :value="x.uuid">{{ x.name }}</option></select>
							<button @click="attach()">{{ t('attach_btn') }}</button>
						</div>
						<div class="cl_row"><button @click="unpin()">{{ t('unpin') }}</button><button @click="unpinAll()">{{ t('unpin_all') }}</button></div>
						<button class="cl_btn" @click="unmake()">{{ t('remove') }}</button>
						<div class="cl_hint">{{ t('hint') }}</div>
					</template>
				</template>
			</div>`,
	};
}

const STYLE = `
	.cloth_panel .cl_row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 3px 0; }
	.cloth_panel .cl_slider { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
	.cloth_panel .cl_slider .label { width: 44%; }
	.cloth_panel .cl_slider input[type=range] { flex: 1; min-width: 0; }
	.cloth_panel .cl_slider > span:last-child { width: 36px; text-align: right; opacity: 0.8; }
	.cloth_panel .cl_btn { width: 100%; margin: 3px 0; }
	.cloth_panel .cl_cap { font-size: 0.82em; opacity: 0.75; margin: 8px 0 2px; text-transform: uppercase; }
	.cloth_panel .cl_dim { opacity: 0.65; font-size: 0.9em; }
	.cloth_panel .cl_hint { opacity: 0.6; font-size: 0.85em; margin: 6px 0; }
	.cloth_panel select { background: var(--color-back); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px; padding: 2px 4px; }
`;
let style_node = null;

if (typeof __CLOTH_EXPORT !== 'undefined') __CLOTH_EXPORT({ClothSim, clothLinks, makeItem, physicsHook, showBakeAt, toBase64, fromBase64, DEFAULT_CLOTH, pickedVertices});

const onSelection = () => updatePanel();

Plugin.register('cloth', {
	title: 'Cloth',
	author: 'Claude',
	description: 'Cloth for meshes (capes, flags, curtains): hangs, drapes over physics bodies and ragdolls, faces can be frozen or attached to objects. Runs and bakes in the Physics tab.',
	about: 'Select a mesh and open the **Cloth** panel (or right click → **Cloth…**, or **Add cloth** for a ready sheet). Pick faces in Edit mode and **Freeze** them or **Attach** them to an object. Press Play in the **Physics** tab to see it; **Bake** records it for the Animate tab and for videos from the Render view. Needs the Physics plugin.',
	icon: 'texture',
	version: '0.1.3',
	variant: 'both',
	min_version: '4.10.0',
	tags: ['Animation', 'Physics'],
	onload() {
		properties.push(new Property(Mesh, 'object', 'cloth', {default: null}));
		properties.push(new Property(ModelProject, 'object', 'cloth_bakes', {default: null}));
		style_node = Blockbench.addCSS(STYLE);
		const cloth_action = new Action('cloth_settings', {
			name: tr('act_cloth'), description: tr('act_cloth_desc'), icon: 'texture', category: 'edit',
			condition: () => !!selectedMesh(),
			click() { const el = selectedMesh(); if (el && !isCloth(el)) editCloth(el, 'Make cloth', d => { d.enabled = true; }); if (panel && panel.fold) panel.fold(false); updatePanel(true); },
		});
		const add_action = new Action('add_cloth', {
			name: tr('add'), description: tr('add_desc'), icon: 'texture', category: 'edit',
			condition: () => !!Project, click() { addClothSheet(); },
		});
		actions = [cloth_action, add_action];
		try { Mesh.prototype.menu.addAction(cloth_action); } catch (err) { console.warn('[Cloth] menu', err); }
		try { MenuBar.addAction(add_action, 'edit'); MenuBar.addAction(cloth_action, 'edit'); } catch (err) { console.warn('[Cloth] menu', err); }
		panel = new Panel('cloth', {
			name: tr('panel'), icon: 'texture', growable: true, resizable: true, min_height: 160,
			condition: () => !!Project && !!selectedMesh() && (Modes.edit || Modes.physics || Modes.animate),
			default_position: {slot: 'right_bar', float_position: [0, 0], float_size: [300, 480], height: 420},
			component: panelComponent(),
		});
		globalThis.__physicsHooks = (globalThis.__physicsHooks || []).filter(h => h !== physicsHook).concat([physicsHook]);
		globalThis.__renderHooks = (globalThis.__renderHooks || []).filter(h => h.name != 'cloth').concat([renderHook]);
		Blockbench.on('update_selection', onSelection);
		Blockbench.on('display_animation_frame', onAnimationFrame);
		poll = setInterval(() => { try { syncPinView(); } catch (err) { /* project closed */ } }, 300);
	},
	onunload() {
		physicsHook.stop();
		for (const el of showing) drawRest(el);
		showing = new Set();
		globalThis.__physicsHooks = (globalThis.__physicsHooks || []).filter(h => h !== physicsHook);
		globalThis.__renderHooks = (globalThis.__renderHooks || []).filter(h => h.name != 'cloth');
		Blockbench.removeListener('update_selection', onSelection);
		Blockbench.removeListener('display_animation_frame', onAnimationFrame);
		if (poll) clearInterval(poll);
		if (pin_view && pin_view.obj.parent) pin_view.obj.parent.remove(pin_view.obj);
		pin_view = null;
		try { Mesh.prototype.menu.removeAction(actions[0]); } catch (err) { /* gone */ }
		try { MenuBar.removeAction('edit.add_cloth'); MenuBar.removeAction('edit.cloth_settings'); } catch (err) { /* gone */ }
		actions.forEach(a => a.delete());
		actions = [];
		if (panel) panel.delete();
		properties.forEach(p => p.delete());
		properties = [];
		if (style_node) style_node.delete();
	},
});

})();
