// ---------------------------------------------------------------------------
// Extra head: a hard shot to the head breaks it open. The head's own meshes are cut along planes into pieces; a piece is
// a body of its own (it falls, swings, lands), and one still hanging on by skin and flesh is held to the rest of the head
// at a point: its vertices follow the piece more the farther they are from that point (a weight map), so near it the
// flesh stretches instead of breaking off clean. The inside of the head shows through the cut as wet flesh.
//   face  - the face is torn off and hangs from the chin
//   split - the head comes apart in two halves that peel away to the sides and hang
//   burst - the top of the skull is blown off in pieces, the face hangs from the jaw
// While baking, where each piece is is written down at every frame; the Animate tab draws it again at the timeline's time.
// ---------------------------------------------------------------------------

const GORE_SLOTS = 8;   // collision sub groups kept free for the pieces of a head
const gore_bakes = new Map();   // animation uuid -> [recording of a head]

// the meshes of the head: its own elements (not a held thing, not another bone)
function goreElements(group) {
	return (group.children || []).filter(el => (el instanceof Mesh || el instanceof Cube) && el.mesh && el.mesh.geometry && el.mesh.geometry.attributes.position);
}

// which piece a point of the head (the head group's own space, pixels) belongs to: 0 = what stays on the neck
function goreRegion(params, p) {
	const side = params.planes.map(pl => (pl.n[0] * p.x + pl.n[1] * p.y + pl.n[2] * p.z - pl.d) >= 0 ? 1 : -1);
	for (let k = 0; k < params.regions.length; k++) if (params.regions[k].every(([i, s]) => side[i] == s)) return k + 1;
	return 0;
}

// cuts the head's meshes along the planes. For every element: a geometry of its own with every triangle wholly in one
// piece (the ones across a cut are split there), the piece of each vertex and its weight (how much it follows the piece)
function goreCut(els, params) {
	const out = [];
	for (const el of els) {
		el.mesh.updateMatrix();
		const M = el.mesh.matrix.clone();
		const src0 = el.mesh.geometry, src = src0.index ? src0.toNonIndexed() : src0;
		const names = Object.keys(src.attributes).filter(n => src.attributes[n].itemSize && !src.attributes[n].isInterleavedBufferAttribute);
		const sizes = names.map(n => src.attributes[n].itemSize), stride = sizes.reduce((a, b) => a + b, 0);
		const pi = names.indexOf('position');
		const vert = i => { const v = new Float32Array(stride); let o = 0; names.forEach((n, k) => { const a = src.attributes[n]; for (let c = 0; c < sizes[k]; c++) v[o + c] = a.array[i * sizes[k] + c]; o += sizes[k]; }); return v; };
		let po = 0; for (let k = 0; k < pi; k++) po += sizes[k];
		const gpos = v => new THREE.Vector3(v[po], v[po + 1], v[po + 2]).applyMatrix4(M);
		const dist = (v, pl) => { const p = gpos(v); return pl.n[0] * p.x + pl.n[1] * p.y + pl.n[2] * p.z - pl.d; };
		const lerpV = (a, b, t) => { const v = new Float32Array(stride); for (let c = 0; c < stride; c++) v[c] = a[c] + (b[c] - a[c]) * t; return v; };
		// a polygon cut by a plane into its two sides
		const clip = (poly, pl) => {
			const front = [], back = [];
			for (let i = 0; i < poly.length; i++) {
				const a = poly[i], b = poly[(i + 1) % poly.length], da = dist(a, pl), db = dist(b, pl);
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
				let polys = [[vert(t), vert(t + 1), vert(t + 2)]];
				for (const pl of params.planes) polys = polys.flatMap(p => clip(p, pl));
				for (const p of polys) {
					const c = p.reduce((s, v) => s.add(gpos(v)), new THREE.Vector3()).divideScalar(p.length);
					const region = goreRegion(params, c);
					for (let i = 1; i + 1 < p.length; i++) tris.push({v: [p[0], p[i], p[i + 1]], region});
				}
			}
			new_groups.push({start: start * 3, count: (tris.length - start) * 3, materialIndex: g.materialIndex});
		}
		const n = tris.length * 3, geo = new THREE.BufferGeometry();
		const arrays = names.map((name, k) => new Float32Array(n * sizes[k]));
		const region = new Uint8Array(n), weight = new Float32Array(n), base = new Float32Array(n * 3);
		let vi = 0;
		for (const tri of tris) for (const v of tri.v) {
			let o = 0;
			names.forEach((name, k) => { for (let c = 0; c < sizes[k]; c++) arrays[k][vi * sizes[k] + c] = v[o + c]; o += sizes[k]; });
			const p = gpos(v);
			base.set([p.x, p.y, p.z], vi * 3);
			region[vi] = tri.region;
			const h = tri.region ? params.hinges[tri.region - 1] : null;
			// (the weight map: by the skin, at the point it hangs from, it stays with the head; farther out it is the piece's)
			weight[vi] = !tri.region ? 0 : !h ? 1 : gsmooth(params.R * 0.12, params.R * 0.85, p.distanceTo(new THREE.Vector3(...h)));
			vi++;
		}
		names.forEach((name, k) => geo.setAttribute(name, new THREE.BufferAttribute(arrays[k], sizes[k])));
		new_groups.forEach(g => geo.addGroup(g.start, g.count, g.materialIndex));
		geo.computeBoundingSphere();
		if (src !== src0) src.dispose();
		const nrm = geo.attributes.normal;
		out.push({el, M, Minv: M.clone().invert(), geo, region, weight, base, base_n: nrm ? new Float32Array(nrm.array) : null, orig: null, inner: null});
	}
	return out;
}

// the flesh inside, seen through the cut (the back faces of the head's own surfaces)
let gore_flesh_mat = null;
function goreFleshMaterial() {
	if (gore_flesh_mat) return gore_flesh_mat;
	gore_flesh_mat = new THREE.MeshStandardMaterial({color: 0x4a0606, roughness: 0.32, metalness: 0, side: THREE.BackSide, envMapIntensity: 0.6});
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

// puts the cut meshes in place of the head's own; `Q(k)` is where piece k is moved to (the head group's space), or null
function goreApply(cut, Q) {
	const mats = [null], rots = [null];
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
			c.inner = new THREE.Mesh(c.geo, goreFleshMaterial());
			c.inner.renderOrder = 1;
			el.mesh.add(c.inner);
		}
		const pos = c.geo.attributes.position, nrm = c.geo.attributes.normal, p = new THREE.Vector3(), q = new THREE.Vector3(), nv = new THREE.Vector3();
		for (let i = 0; i < c.region.length; i++) {
			const k = c.region[i];
			p.fromArray(c.base, i * 3);
			let w = 0;
			if (k) {
				if (mats[k] === undefined) { mats[k] = Q(k); rots[k] = mats[k] ? new THREE.Matrix3().setFromMatrix4(mats[k]) : null; }
				if (mats[k]) { w = c.weight[i]; q.copy(p).applyMatrix4(mats[k]); p.lerp(q, w); }
			}
			p.applyMatrix4(c.Minv);
			pos.setXYZ(i, p.x, p.y, p.z);
			if (nrm && c.base_n) {
				nv.fromArray(c.base_n, i * 3);
				if (k && rots[k] && w > 0) { q.copy(nv).applyMatrix3(new THREE.Matrix3().setFromMatrix4(c.M)).applyMatrix3(rots[k]).applyMatrix3(new THREE.Matrix3().setFromMatrix4(c.Minv)); nv.lerp(q, w).normalize(); }
				nrm.setXYZ(i, nv.x, nv.y, nv.z);
			}
		}
		pos.needsUpdate = true;
		if (nrm) nrm.needsUpdate = true;
		c.geo.computeBoundingSphere();
	}
}

function goreRestore(cut) {
	for (const c of cut) {
		const el = c.el;
		if (c.inner && c.inner.parent) c.inner.parent.remove(c.inner);
		for (const ch of c.over || []) if (ch.geometry === c.geo && c.orig) ch.geometry = c.orig;
		if (el.mesh && el.mesh.geometry === c.geo && c.orig) el.mesh.geometry = c.orig;
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
	const params = {mode, R, planes: [], regions: [], hinges: []};
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
		this.cut = goreCut(els, params);
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
		const total = this.cut.reduce((s, c) => s + c.region.length, 0) || 1;
		for (let k = 1; k <= params.regions.length; k++) {
			const pts = [];
			for (const c of this.cut) for (let i = 0; i < c.region.length; i++) if (c.region[i] == k) pts.push(new THREE.Vector3().fromArray(c.base, i * 3).applyMatrix4(toWorld));
			if (pts.length < 4) { this.pieces.push(null); continue; }
			const com = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
			const hull = new J.ConvexHullShapeSettings();
			// (a piece no thinner than a centimetre: a flap of skin still has some body to it)
			for (const p of pts) { const d = p.clone().sub(com); hull.mPoints.push_back(new J.Vec3(d.x, d.y, d.z)); }
			hull.mPoints.push_back(new J.Vec3(0.005, 0.005, 0.005)); hull.mPoints.push_back(new J.Vec3(-0.005, -0.005, -0.005));
			const res = hull.Create();
			if (res.HasError()) { this.pieces.push(null); continue; }
			const jp = new J.RVec3(com.x, com.y, com.z), jq = new J.Quat(0, 0, 0, 1);
			const bcs = new J.BodyCreationSettings(res.Get(), jp, jq, J.EMotionType_Dynamic, 1);
			const share = pts.length / total;
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
	show() { goreApply(this.cut, k => this.Q(k)); }
	record(time) { this.rec.frames.push({t: time, q: this.pieces.map((p, i) => { const m = this.Q(i + 1); return m ? Array.from(m.elements) : null; })}); }
	dispose() { goreRestore(this.cut); }
}

// the Animate tab: the broken heads of the selected animation at the time of the timeline
class GorePlayer {
	constructor(recs) { this.recs = recs; this.live = []; }
	show(t) {
		this.recs.forEach((rec, i) => {
			let live = this.live[i];
			if (t < rec.t - 1e-6) { if (live) { goreRestore(live.cut); this.live[i] = null; } return; }
			if (!live) {
				const els = rec.els.map(u => (Mesh.all.find(e => e.uuid == u) || Cube.all.find(e => e.uuid == u))).filter(Boolean);
				live = this.live[i] = {cut: goreCut(els, rec.params)};
			}
			let f = 0;
			while (f + 1 < rec.frames.length && rec.frames[f + 1].t <= t + 1e-6) f++;
			const fr = rec.frames[f];
			goreApply(live.cut, k => fr && fr.q[k - 1] ? new THREE.Matrix4().fromArray(fr.q[k - 1]) : null);
		});
	}
	dispose() { for (const l of this.live) if (l) goreRestore(l.cut); this.live = []; }
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
