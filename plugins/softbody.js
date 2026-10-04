(function () {
'use strict';

/*
 * Soft body — crash test deformation for Blockbench meshes (like BeamNG).
 *
 * Mark meshes as "Soft body" or "Solid obstacle" in the Soft body tab, press Play: soft meshes fall, fly with their start
 * speed, hit obstacles (and each other) and dent. Dents can stay (metal) or spring back (rubber). It works on the polygons of
 * the mesh: every vertex is a point mass, every edge a spring, and a shape matching force keeps the whole body in shape.
 * "Apply" keeps the crushed shape in the model. (Blockbench cannot animate vertices, so the result is a shape, not keyframes.)
 *
 * Units: 16 Blockbench pixels = 1 meter.
 */

const SCALE = 16;

// ---------------------------------------------------------------------------
// Simulation core (no Blockbench in here, so it can be tested on its own)
// ---------------------------------------------------------------------------

const DEFAULT_SOFT = {role: 'none', mass: 1000, rigidity: 0.6, strength: 0.4, plastic: 0.7, damping: 0.2, friction: 0.3, velocity: [0, 0, 0]};
const DEFAULT_WORLD = {gravity: 9.81, ground: true, ground_y: 0, weld: 0.6, quality: 2, collide: true};

// rotation part of a 3x3 matrix (row major array of 9) as a quaternion [x, y, z, w], refined from the previous guess
function extractRotation(A, q) {
	for (let iter = 0; iter < 12; iter++) {
		// rotation matrix of q
		const [x, y, z, w] = q;
		const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
		const R = [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)];
		// columns of R and A
		const c = (M, j) => [M[j], M[3 + j], M[6 + j]];
		const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
		const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
		const r0 = c(R, 0), r1 = c(R, 1), r2 = c(R, 2), a0 = c(A, 0), a1 = c(A, 1), a2 = c(A, 2);
		const c0 = cross(r0, a0), c1 = cross(r1, a1), c2 = cross(r2, a2);
		const omega = [c0[0] + c1[0] + c2[0], c0[1] + c1[1] + c2[1], c0[2] + c1[2] + c2[2]];
		const denom = Math.abs(dot(r0, a0) + dot(r1, a1) + dot(r2, a2)) + 1e-9;
		const k = 1 / denom;
		const om = [omega[0] * k, omega[1] * k, omega[2] * k];
		const w2 = Math.hypot(om[0], om[1], om[2]);
		if (w2 < 1e-9) break;
		const s = Math.sin(w2 / 2) / w2, dq = [om[0] * s, om[1] * s, om[2] * s, Math.cos(w2 / 2)];
		// q = dq * q
		const nq = [dq[3] * q[0] + dq[0] * q[3] + dq[1] * q[2] - dq[2] * q[1], dq[3] * q[1] - dq[0] * q[2] + dq[1] * q[3] + dq[2] * q[0],
			dq[3] * q[2] + dq[0] * q[1] - dq[1] * q[0] + dq[2] * q[3], dq[3] * q[3] - dq[0] * q[0] - dq[1] * q[1] - dq[2] * q[2]];
		const len = Math.hypot(nq[0], nq[1], nq[2], nq[3]);
		q = [nq[0] / len, nq[1] / len, nq[2] / len, nq[3] / len];
		if (w2 < 1e-6) break;
	}
	return q;
}
function quatMatrix(q) {
	const [x, y, z, w] = q;
	const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
	return [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)];
}

// how hard (as an acceleration, in px/s²) a spring may be pushed before it gives in for good. Even the softest body can
// carry its own weight; strength 0..1 goes from thin sheet metal to thick steel
const yieldAccelOf = strength => 9.81 * SCALE * (2.2 + 12 * strength * strength);

class SoftBody {
	/**
	 * positions: Float64Array(n * 3) world px.  edges: [[i, j], ...] springs (also weld joints).  triangles: [[a, b, c], ...] the skin.
	 * params: {mass, rigidity, strength, plastic, damping, friction, velocity [m/s]}
	 */
	constructor(positions, edges, triangles, params, tag) {
		const p = Object.assign({}, DEFAULT_SOFT, params || {});
		this.tag = tag;
		this.params = p;
		this.n = positions.length / 3;
		this.x = Float64Array.from(positions);
		this.p = Float64Array.from(positions);
		this.v = new Float64Array(this.n * 3);
		const vel = p.velocity || [0, 0, 0];
		for (let i = 0; i < this.n; i++) for (let k = 0; k < 3; k++) this.v[i * 3 + k] = vel[k] * SCALE;
		this.mass = Math.max(0.01, p.mass) / this.n;
		this.w = 1 / this.mass;
		this.edgeA = Int32Array.from(edges.map(e => e[0]));
		this.edgeB = Int32Array.from(edges.map(e => e[1]));
		this.rest = new Float64Array(edges.length);
		for (let e = 0; e < edges.length; e++) this.rest[e] = this.dist(this.edgeA[e], this.edgeB[e], this.x);
		this.tris = Int32Array.from(triangles.flat());
		// bending: the two far corners of triangles that share an edge are kept at their distance (panels do not fold up)
		const bends = this.findBends(triangles);
		this.bendA = Int32Array.from(bends.map(b => b[0]));
		this.bendB = Int32Array.from(bends.map(b => b[1]));
		this.bendRest = new Float64Array(bends.length);
		for (let e = 0; e < bends.length; e++) this.bendRest[e] = this.dist(this.bendA[e], this.bendB[e], this.x);
		// shape matching: rest offsets from the centroid
		this.c0 = this.centroid(this.x);
		this.q = new Float64Array(this.n * 3);
		for (let i = 0; i < this.n; i++) for (let k = 0; k < 3; k++) this.q[i * 3 + k] = this.x[i * 3 + k] - this.c0[k];
		this.rot = [0, 0, 0, 1];
		let r2 = 0;
		for (let i = 0; i < this.n; i++) r2 = Math.max(r2, this.q[i * 3] ** 2 + this.q[i * 3 + 1] ** 2 + this.q[i * 3 + 2] ** 2);
		this.size = Math.max(1, Math.sqrt(r2));
		// every vertex is also a small ball for contacts with other bodies: half a typical edge, so the surface has no holes
		const lens = Array.from(this.rest).sort((p, q) => p - q);
		this.radius = Math.max(0.6, Math.min(6, (lens.length ? lens[Math.floor(lens.length * 0.35)] : 2) * 0.5));
		this.touch = new Uint8Array(this.n);
				this.corr = new Float64Array(this.n * 3);   // contact corrections between bodies, averaged before they are applied
		this.cnt = new Int32Array(this.n);
		this.push = new Float64Array(this.n * 3);   // how far every vertex was pushed out of something in this step (for friction)
		this.min = [0, 0, 0]; this.max = [0, 0, 0];
		this.updateBounds();
	}
	dist(i, j, a) {
		return Math.hypot(a[i * 3] - a[j * 3], a[i * 3 + 1] - a[j * 3 + 1], a[i * 3 + 2] - a[j * 3 + 2]);
	}
	centroid(a) {
		const c = [0, 0, 0];
		for (let i = 0; i < this.n; i++) { c[0] += a[i * 3]; c[1] += a[i * 3 + 1]; c[2] += a[i * 3 + 2]; }
		return c.map(s => s / this.n);
	}
	findBends(triangles) {
		const edgeTris = new Map();
		triangles.forEach((t, ti) => {
			for (let k = 0; k < 3; k++) {
				const a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3];
				const key = Math.min(a, b) + ',' + Math.max(a, b);
				if (!edgeTris.has(key)) edgeTris.set(key, []);
				edgeTris.get(key).push(c);
			}
		});
		const out = [];
		for (const opp of edgeTris.values()) if (opp.length == 2 && opp[0] != opp[1]) out.push([opp[0], opp[1]]);
		return out;
	}
	updateBounds() {
		const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < this.n; i++) for (let k = 0; k < 3; k++) { const v = this.p[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
		this.min = mn; this.max = mx;
	}
}

// closest point on triangle (Ericson), the corners read straight from a position array, written into out
function closestOnTriangleP(px, py, pz, P, ia, ib, ic, out) {
	const ax = P[ia * 3], ay = P[ia * 3 + 1], az = P[ia * 3 + 2], bx = P[ib * 3], by = P[ib * 3 + 1], bz = P[ib * 3 + 2], cx = P[ic * 3], cy = P[ic * 3 + 1], cz = P[ic * 3 + 2];
	const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
	const apx = px - ax, apy = py - ay, apz = pz - az;
	const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
	if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
	const bpx = px - bx, bpy = py - by, bpz = pz - bz;
	const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
	if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); out[0] = ax + abx * t; out[1] = ay + aby * t; out[2] = az + abz * t; return; }
	const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
	const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
	if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); out[0] = ax + acx * t; out[1] = ay + acy * t; out[2] = az + acz * t; return; }
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
		const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
		out[0] = bx + (cx - bx) * t; out[1] = by + (cy - by) * t; out[2] = bz + (cz - bz) * t; return;
	}
	const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
	out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}
// the same for a triangle given as three small arrays (used for the fixed obstacles)
function closestOnTriangle(px, py, pz, a, b, c, out) {
	const P = [a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]];
	closestOnTriangleP(px, py, pz, P, 0, 1, 2, out);
}

const MAX_SPEED = 120 * SCALE;   // px/s
const SKIN = 0.35;   // px: how close a vertex may get to a surface

class SoftWorld {
	/** solids: [{tris: Float64Array(9 per triangle) world px}] that never move */
	constructor(settings, solids) {
		this.s = Object.assign({}, DEFAULT_WORLD, settings || {});
		this.bodies = [];
		this.solids = (solids || []).map(s => this.prepareSolid(s));
		this.time = 0;
		this.stats = {contacts: 0};
	}
	prepareSolid(s) {
		const t = s.tris, n = t.length / 9;
		const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
		const normals = new Float64Array(n * 3), tmin = new Float64Array(n * 3), tmax = new Float64Array(n * 3);
		for (let i = 0; i < n; i++) {
			const o = i * 9;
			const e1 = [t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]], e2 = [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]];
			let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
			const len = Math.hypot(nx, ny, nz) || 1;
			normals[i * 3] = nx / len; normals[i * 3 + 1] = ny / len; normals[i * 3 + 2] = nz / len;
			for (let k = 0; k < 3; k++) {
				const a = t[o + k], b = t[o + 3 + k], c = t[o + 6 + k];
				tmin[i * 3 + k] = Math.min(a, b, c); tmax[i * 3 + k] = Math.max(a, b, c);
				box[k] = Math.min(box[k], tmin[i * 3 + k]); box[3 + k] = Math.max(box[3 + k], tmax[i * 3 + k]);
			}
		}
		return {tris: t, n, normals, tmin, tmax, box};
	}
	add(body) { this.bodies.push(body); return body; }

	step(dt) {
		let vmax = 0;
		for (const b of this.bodies) for (let i = 0; i < b.n * 3; i++) vmax = Math.max(vmax, Math.abs(b.v[i]));
		const sub = Math.max(1, Math.min(8, Math.ceil(vmax * dt / 1.2)));
		for (let s = 0; s < sub; s++) this.substep(dt / sub);
		this.time += dt;
	}

	substep(h) {
		const iters = [4, 6, 10][Math.max(0, Math.min(2, this.s.quality - 1))];
		const g = this.s.gravity * SCALE;
		this.stats.contacts = 0;
		for (const b of this.bodies) {
			const damp = Math.max(0, 1 - b.params.damping * h);
			b.touch.fill(0);
						b.push.fill(0);
			for (let i = 0; i < b.n; i++) {
				b.v[i * 3 + 1] -= g * h;
				for (let k = 0; k < 3; k++) {
					b.v[i * 3 + k] *= damp;
					b.x[i * 3 + k] = b.p[i * 3 + k];
					b.p[i * 3 + k] += b.v[i * 3 + k] * h;
				}
			}
			b.updateBounds();
		}
		const grids = this.s.collide && this.bodies.length > 1 ? this.bodies.map(b => this.particleGrid(b)) : [];
		for (let it = 0; it < iters; it++) {
			for (const b of this.bodies) {
				this.solveEdges(b, iters, h);
				this.solveShape(b, iters, h);
			}
			this.collide(grids);
		}
		for (const b of this.bodies) {
			for (let i = 0; i < b.n * 3; i++) {
				let v = (b.p[i] - b.x[i]) / h;
				if (!(Math.abs(v) < MAX_SPEED)) { v = Number.isNaN(v) ? 0 : Math.sign(v) * MAX_SPEED; b.p[i] = b.x[i] + v * h; }   // nothing flies faster than this (and no NaN)
				b.v[i] = v;
				b.x[i] = b.p[i];
			}
			// friction: the harder a vertex is pressed onto something, the more of its sliding speed is taken away
			const mu = b.params.friction;
			for (let i = 0; i < b.n; i++) {
				if (!b.touch[i]) continue;
				const o = i * 3, D = Math.hypot(b.push[o], b.push[o + 1], b.push[o + 2]);
				if (D < 1e-9) continue;
				const nx = b.push[o] / D, ny = b.push[o + 1] / D, nz = b.push[o + 2] / D;
				const vn = b.v[o] * nx + b.v[o + 1] * ny + b.v[o + 2] * nz;
				const tx = b.v[o] - vn * nx, ty = b.v[o + 1] - vn * ny, tz = b.v[o + 2] - vn * nz;
				const vt = Math.hypot(tx, ty, tz);
				if (vt < 1e-9) continue;
				const k = Math.max(0, 1 - mu * D / h / vt);
				b.v[o] = vn * nx + tx * k; b.v[o + 1] = vn * ny + ty * k; b.v[o + 2] = vn * nz + tz * k;
			}
		}
	}

	solveEdges(b, iters, h) {
		const k = 1 - Math.pow(1 - Math.min(0.999, 0.15 + b.params.rigidity * 0.84), 1 / iters), p = b.p;
		const yieldAccel = yieldAccelOf(b.params.strength), flow = b.params.plastic * 2 / iters, h2 = h * h;
		const pass = (A, B, R, stiff) => {
			for (let e = 0; e < A.length; e++) {
				const i = A[e], j = B[e];
				let dx = p[i * 3] - p[j * 3], dy = p[i * 3 + 1] - p[j * 3 + 1], dz = p[i * 3 + 2] - p[j * 3 + 2];
				const len = Math.hypot(dx, dy, dz);
				if (len < 1e-9) continue;
				// past the yield strain the spring gives in for good: its rest length follows (a dent / a stretch that stays)
				const load = Math.abs(len - R[e]) / h2;   // how hard this spring is pushed (correction / time^2)
				if (flow > 0 && load > yieldAccel) R[e] += (len - R[e]) * Math.min(1, flow * (load - yieldAccel) / yieldAccel);
				const f = (len - R[e]) / len * 0.5 * stiff;
				dx *= f; dy *= f; dz *= f;
				p[i * 3] -= dx; p[i * 3 + 1] -= dy; p[i * 3 + 2] -= dz;
				p[j * 3] += dx; p[j * 3 + 1] += dy; p[j * 3 + 2] += dz;
			}
		};
		pass(b.edgeA, b.edgeB, b.rest, Math.min(1, Math.max(k, 0.02) * 2.2));
		pass(b.bendA, b.bendB, b.bendRest, Math.max(k, 0.02) * 1.1);
	}

	// shape matching: the body is pulled toward its own (turned and moved) rest shape, and that shape gives in under heavy load
	solveShape(b, iters, h) {
		const stiff = 1 - Math.pow(1 - b.params.rigidity * 0.9, 1 / iters);
		if (stiff <= 1e-4) return;
		const c = b.centroid(b.p);
		const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
		for (let i = 0; i < b.n; i++) {
			const px = b.p[i * 3] - c[0], py = b.p[i * 3 + 1] - c[1], pz = b.p[i * 3 + 2] - c[2];
			const qx = b.q[i * 3], qy = b.q[i * 3 + 1], qz = b.q[i * 3 + 2];
			A[0] += px * qx; A[1] += px * qy; A[2] += px * qz;
			A[3] += py * qx; A[4] += py * qy; A[5] += py * qz;
			A[6] += pz * qx; A[7] += pz * qy; A[8] += pz * qz;
		}
		b.rot = extractRotation(A, b.rot);
		const R = quatMatrix(b.rot);
		const yieldAccel = yieldAccelOf(b.params.strength) * 4, flow = b.params.plastic * 2 / iters, h2 = h * h;
		for (let i = 0; i < b.n; i++) {
			const qx = b.q[i * 3], qy = b.q[i * 3 + 1], qz = b.q[i * 3 + 2];
			const gx = c[0] + R[0] * qx + R[1] * qy + R[2] * qz, gy = c[1] + R[3] * qx + R[4] * qy + R[5] * qz, gz = c[2] + R[6] * qx + R[7] * qy + R[8] * qz;
			const dx = b.p[i * 3] - gx, dy = b.p[i * 3 + 1] - gy, dz = b.p[i * 3 + 2] - gz;
			const d = Math.hypot(dx, dy, dz);
			const load = d / h2;
			if (flow > 0 && load > yieldAccel) {
				// the rest shape follows the deformed one (R^T * deviation brings it back into the rest frame)
				const f = Math.min(1, flow * (1 - yieldAccel / load));
				b.q[i * 3] += (R[0] * dx + R[3] * dy + R[6] * dz) * f;
				b.q[i * 3 + 1] += (R[1] * dx + R[4] * dy + R[7] * dz) * f;
				b.q[i * 3 + 2] += (R[2] * dx + R[5] * dy + R[8] * dz) * f;
			}
			b.p[i * 3] -= dx * stiff; b.p[i * 3 + 1] -= dy * stiff; b.p[i * 3 + 2] -= dz * stiff;
		}
		// keep the rest shape centered
		let mx = 0, my = 0, mz = 0;
		for (let i = 0; i < b.n; i++) { mx += b.q[i * 3]; my += b.q[i * 3 + 1]; mz += b.q[i * 3 + 2]; }
		mx /= b.n; my /= b.n; mz /= b.n;
		for (let i = 0; i < b.n; i++) { b.q[i * 3] -= mx; b.q[i * 3 + 1] -= my; b.q[i * 3 + 2] -= mz; }
	}

	// a hash of the vertices of a body (rebuilt every substep): what a vertex of another body may bump into
	particleGrid(b) {
		const cell = b.radius * 4;
		const map = new Map();
		const key = (x, y, z) => x * 73856093 ^ y * 19349663 ^ z * 83492791;
		for (let i = 0; i < b.n; i++) {
			const k = key(Math.floor(b.p[i * 3] / cell), Math.floor(b.p[i * 3 + 1] / cell), Math.floor(b.p[i * 3 + 2] / cell));
			let list = map.get(k);
			if (!list) map.set(k, list = []);
			list.push(i);
		}
		return {body: b, cell, map, key};
	}

	collide(grids) {
		const ground = this.s.ground ? this.s.ground_y * 1 : null;
		const tmp = [0, 0, 0];
		for (let bi = 0; bi < this.bodies.length; bi++) {
			const b = this.bodies[bi], mu = b.params.friction;
			for (let i = 0; i < b.n; i++) {
				const o = i * 3;
				// ground
				if (ground !== null && b.p[o + 1] < ground + SKIN) {
					b.push[o + 1] += ground + SKIN - b.p[o + 1];
					b.p[o + 1] = ground + SKIN;
					b.touch[i] = 1;
					this.stats.contacts++;
				}
				// fixed obstacles
				for (const s of this.solids) {
					const bx = s.box;
					if (b.p[o] < bx[0] - 2 && b.x[o] < bx[0] - 2) continue;
					if (b.p[o] > bx[3] + 2 && b.x[o] > bx[3] + 2) continue;
					if (b.p[o + 1] < bx[1] - 2 && b.x[o + 1] < bx[1] - 2) continue;
					if (b.p[o + 1] > bx[4] + 2 && b.x[o + 1] > bx[4] + 2) continue;
					if (b.p[o + 2] < bx[2] - 2 && b.x[o + 2] < bx[2] - 2) continue;
					if (b.p[o + 2] > bx[5] + 2 && b.x[o + 2] > bx[5] + 2) continue;
					this.vertexVsSolid(b, i, s, mu, tmp);
				}
				// other bodies (their skin, as it is right now)
				for (let gj = 0; gj < grids.length; gj++) {
					if (gj == bi) continue;
					this.vertexVsParticles(b, i, grids[gj]);
				}
			}
		}
		// apply the collected body-to-body corrections: a vertex that is in several contacts takes their average
		if (grids.length) {
			for (const b of this.bodies) {
				for (let i = 0; i < b.n; i++) {
					const c = b.cnt[i];
					if (!c) continue;
					const o = i * 3, k = 1 / c;
					const dx = b.corr[o] * k, dy = b.corr[o + 1] * k, dz = b.corr[o + 2] * k;
					b.p[o] += dx; b.p[o + 1] += dy; b.p[o + 2] += dz;
					b.push[o] += dx; b.push[o + 1] += dy; b.push[o + 2] += dz;
					b.touch[i] = 1;
					b.corr[o] = 0; b.corr[o + 1] = 0; b.corr[o + 2] = 0; b.cnt[i] = 0;
				}
			}
		}
	}

	// vertex against a fixed triangle soup: it must stay on the side it came from
	vertexVsSolid(b, i, s, mu, tmp) {
		const o = i * 3, t = s.tris;
		const px = b.p[o], py = b.p[o + 1], pz = b.p[o + 2], qx = b.x[o], qy = b.x[o + 1], qz = b.x[o + 2];
		const lox = Math.min(px, qx) - SKIN, loy = Math.min(py, qy) - SKIN, loz = Math.min(pz, qz) - SKIN;
		const hix = Math.max(px, qx) + SKIN, hiy = Math.max(py, qy) + SKIN, hiz = Math.max(pz, qz) + SKIN;
		for (let ti = 0; ti < s.n; ti++) {
			if (s.tmax[ti * 3] < lox || s.tmin[ti * 3] > hix || s.tmax[ti * 3 + 1] < loy || s.tmin[ti * 3 + 1] > hiy || s.tmax[ti * 3 + 2] < loz || s.tmin[ti * 3 + 2] > hiz) continue;
			const w = ti * 9;
			const a = [t[w], t[w + 1], t[w + 2]], bb = [t[w + 3], t[w + 4], t[w + 5]], c = [t[w + 6], t[w + 7], t[w + 8]];
			const nx = s.normals[ti * 3], ny = s.normals[ti * 3 + 1], nz = s.normals[ti * 3 + 2];
			const d0 = (qx - a[0]) * nx + (qy - a[1]) * ny + (qz - a[2]) * nz;
			const cx = b.p[o], cy = b.p[o + 1], cz = b.p[o + 2];
			const d1 = (cx - a[0]) * nx + (cy - a[1]) * ny + (cz - a[2]) * nz;
			const side = d0 >= 0 ? 1 : -1;
			if (side * d1 >= SKIN) continue;                    // still clear of this triangle
			// where on the plane the vertex is, and is that inside the triangle (a little generous)?
			closestOnTriangle(cx - nx * d1, cy - ny * d1, cz - nz * d1, a, bb, c, tmp);
			const off = Math.hypot(cx - nx * d1 - tmp[0], cy - ny * d1 - tmp[1], cz - nz * d1 - tmp[2]);
			if (off > SKIN * 1.5) continue;
			if (side * d1 < -Math.max(8, b.size * 0.5)) continue;   // far behind: another triangle's business
			this.pushOut(b, i, nx * side, ny * side, nz * side, SKIN - side * d1, mu);
		}
	}

	// a vertex (a ball) against the vertices of another body: they may not overlap; both give way by inverse mass
	vertexVsParticles(b, i, grid) {
		const o = i * 3, other = grid.body, Q = other.p;
		for (let k = 0; k < 3; k++) if (b.p[o + k] < other.min[k] - 8 || b.p[o + k] > other.max[k] + 8) return;
		const cell = grid.cell, cx = Math.floor(b.p[o] / cell), cy = Math.floor(b.p[o + 1] / cell), cz = Math.floor(b.p[o + 2] / cell);
		const px = b.p[o], py = b.p[o + 1], pz = b.p[o + 2], reach = b.radius + other.radius;
		for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
			const list = grid.map.get(grid.key(cx + dx, cy + dy, cz + dz));
			if (!list) continue;
			for (let li = 0; li < list.length; li++) {
				const j = list[li], q = j * 3;
				let ex = px - Q[q], ey = py - Q[q + 1], ez = pz - Q[q + 2];
				const d2 = ex * ex + ey * ey + ez * ez;
				if (d2 >= reach * reach) continue;
				let d = Math.sqrt(d2);
				if (d < 1e-6) { ex = 1; ey = 0; ez = 0; d = 1e-6; }
				const nx = ex / d, ny = ey / d, nz = ez / d, lambda = (reach - d) / (b.w + other.w);
				let f = lambda * b.w;
				b.corr[o] += nx * f; b.corr[o + 1] += ny * f; b.corr[o + 2] += nz * f; b.cnt[i]++;
				f = lambda * other.w;
				other.corr[q] -= nx * f; other.corr[q + 1] -= ny * f; other.corr[q + 2] -= nz * f; other.cnt[j]++;
				this.stats.contacts++;
			}
		}
	}

	pushOut(b, i, nx, ny, nz, depth, mu) {
		const o = i * 3;
		b.p[o] += nx * depth; b.p[o + 1] += ny * depth; b.p[o + 2] += nz * depth;
		b.push[o] += nx * depth; b.push[o + 1] += ny * depth; b.push[o + 2] += nz * depth;
		b.touch[i] = 1;
		this.stats.contacts++;
	}
}

// ---------------------------------------------------------------------------
// Meshes <-> simulation
// ---------------------------------------------------------------------------

const softOf = el => Object.assign({}, DEFAULT_SOFT, el.soft || {});
const isSoft = el => !!(el.soft && el.soft.role == 'soft') && el instanceof Mesh;
const isSolidFlag = el => !!(el.soft && el.soft.role == 'solid');
// elements of the Physics plugin that are marked as Ground are obstacles too
function isStaticPhysics(el) {
	for (let n = el; n && n != 'root'; n = n.parent) if (n.physics && n.physics.type == 'static') return true;
	return false;
}
const worldOf = () => Object.assign({}, DEFAULT_WORLD, (Project && Project.soft_world) || {});

// triangles of a cube / mesh in world space (a flat array, 9 numbers per triangle), wound counter-clockwise from outside
function worldTriangles(el) {
	const obj = el.mesh;
	if (!obj || !obj.geometry || !obj.geometry.attributes.position) return new Float64Array(0);
	obj.updateWorldMatrix(true, false);
	const pos = obj.geometry.attributes.position, index = obj.geometry.index;
	const flip = obj.matrixWorld.determinant() < 0;
	const count = index ? index.count : pos.count;
	const out = [];
	const v = new THREE.Vector3();
	const point = i => v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(obj.matrixWorld).toArray();
	for (let i = 0; i + 2 < count; i += 3) {
		const a = point(i), b = point(flip ? i + 2 : i + 1), c = point(flip ? i + 1 : i + 2);
		out.push(...a, ...b, ...c);
	}
	return Float64Array.from(out);
}

const facePoints = face => face.getSortedVertices ? face.getSortedVertices() : face.vertices;

/**
 * Turns soft meshes into simulation bodies. Vertices of different meshes that sit within `weld` px of each other become one point
 * (that is how a car made of several meshes holds together). Connected pieces make one body.
 * Returns {bodies: [{body, nodes}], map: [{el, key, node, body}], vertices}
 */
function buildBodies(elements, weld) {
	const entries = [];   // {el, key, world:[x,y,z]}
	const index = new Map();
	for (const el of elements) {
		el.mesh.updateWorldMatrix(true, false);
		const M = el.mesh.matrixWorld;
		for (const key in el.vertices) {
			const p = new THREE.Vector3(...el.vertices[key]).applyMatrix4(M);
			index.set(el.uuid + ':' + key, entries.length);
			entries.push({el, key, world: p.toArray()});
		}
	}
	// weld: union nearby points of different (or the same) mesh
	const parent = entries.map((_, i) => i);
	const find = i => { while (parent[i] != i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
	const cell = Math.max(0.05, weld), grid = new Map();
	const cellKey = (x, y, z) => x + ',' + y + ',' + z;
	entries.forEach((e, i) => {
		const cx = Math.floor(e.world[0] / cell), cy = Math.floor(e.world[1] / cell), cz = Math.floor(e.world[2] / cell);
		for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
			const list = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
			if (!list) continue;
			for (const j of list) {
				const o = entries[j].world;
				if (Math.hypot(o[0] - e.world[0], o[1] - e.world[1], o[2] - e.world[2]) <= weld) parent[find(i)] = find(j);
			}
		}
		const k = cellKey(cx, cy, cz);
		if (!grid.has(k)) grid.set(k, []);
		grid.get(k).push(i);
	});
	// node ids
	const nodeOf = new Map(), nodes = [];
	entries.forEach((e, i) => {
		const root = find(i);
		if (!nodeOf.has(root)) { nodeOf.set(root, nodes.length); nodes.push({sum: [0, 0, 0], count: 0, members: []}); }
		const n = nodes[nodeOf.get(root)];
		n.sum[0] += e.world[0]; n.sum[1] += e.world[1]; n.sum[2] += e.world[2]; n.count++; n.members.push(i);
		e.node = nodeOf.get(root);
	});
	nodes.forEach(n => { n.pos = n.sum.map(v => v / n.count); });
	// edges and triangles in node ids
	const edgeSet = new Set(), edges = [], tris = [];
	const addEdge = (a, b) => { if (a == b) return; const k = Math.min(a, b) + ',' + Math.max(a, b); if (!edgeSet.has(k)) { edgeSet.add(k); edges.push([a, b]); } };
	for (const el of elements) {
		for (const fk in el.faces) {
			const keys = facePoints(el.faces[fk]).map(k => entries[index.get(el.uuid + ':' + k)].node);
			for (let i = 0; i < keys.length; i++) addEdge(keys[i], keys[(i + 1) % keys.length]);
			if (keys.length == 4) addEdge(keys[0], keys[2]), addEdge(keys[1], keys[3]);   // diagonals keep a quad from shearing
			for (let i = 1; i + 1 < keys.length; i++) if (keys[0] != keys[i] && keys[i] != keys[i + 1] && keys[0] != keys[i + 1]) tris.push([keys[0], keys[i], keys[i + 1]]);
		}
	}
	// connected pieces -> bodies
	const comp = nodes.map((_, i) => i);
	const cfind = i => { while (comp[i] != i) { comp[i] = comp[comp[i]]; i = comp[i]; } return i; };
	edges.forEach(([a, b]) => { comp[cfind(a)] = cfind(b); });
	const groups = new Map();
	nodes.forEach((n, i) => { const r = cfind(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
	return {entries, nodes, edges, tris, groups};
}

/** creates the SoftBody objects (one per connected piece) and a lookup from every mesh vertex to its body and point */
// the start speed set in the Physics tab (m/s) for an object that has no start speed of its own here
function physicsVelocity(el) {
	for (let n = el; n && n != 'root'; n = n.parent) {
		if (n.physics && n.physics.type == 'dynamic') return (n.physics.velocity || [0, 0, 0]).slice(0, 3);
	}
	return null;
}

function makeBodies(elements, weld) {
	const scene = buildBodies(elements, weld);
	const bodies = [], lookup = new Map();
	for (const [root, ids] of scene.groups) {
		const local = new Map(ids.map((id, i) => [id, i]));
		const positions = Float64Array.from(ids.flatMap(id => scene.nodes[id].pos));
		const edges = scene.edges.filter(([a]) => local.has(a)).map(([a, b]) => [local.get(a), local.get(b)]);
		const tris = scene.tris.filter(t => local.has(t[0])).map(t => t.map(id => local.get(id)));
		// settings of the body: those of its first mesh, the masses add up
		const owners = scene.entries.filter(e => local.has(e.node)).map(e => e.el);
		const first = owners[0], params = softOf(first);
		params.mass = [...new Set(owners)].reduce((sum, el) => sum + softOf(el).mass, 0);
		if (!(params.velocity || [0, 0, 0]).some(v => v)) {
			// a car set going in the Physics tab drives off at the same speed here
			for (const el of owners) { const v = physicsVelocity(el); if (v && v.some(x => x)) { params.velocity = v; break; } }
		}
		const body = new SoftBody(positions, edges, tris, params, first.uuid);
		bodies.push(body);
		scene.entries.forEach(e => { if (local.has(e.node)) lookup.set(e.el.uuid + ':' + e.key, {body, i: local.get(e.node)}); });
	}
	return {bodies, lookup, entries: scene.entries};
}

// writes the simulated positions back into the vertices of the meshes (world -> local space of every mesh)
function writeBack(elements, made, inverses) {
	for (const e of made.entries) {
		const ref = made.lookup.get(e.el.uuid + ':' + e.key);
		if (!ref) continue;
		const b = ref.body, o = ref.i * 3;
		const p = new THREE.Vector3(b.p[o], b.p[o + 1], b.p[o + 2]).applyMatrix4(inverses.get(e.el));
		e.el.vertices[e.key] = [p.x, p.y, p.z];
	}
}

// ---------------------------------------------------------------------------
// More polygons: the mesh needs detail to be able to dent (a cube has 8 points only)
// ---------------------------------------------------------------------------

const longestEdge = mesh => {
	let longest = 0;
	for (const fk in mesh.faces) {
		const keys = facePoints(mesh.faces[fk]);
		for (let i = 0; i < keys.length; i++) {
			const a = mesh.vertices[keys[i]], b = mesh.vertices[keys[(i + 1) % keys.length]];
			longest = Math.max(longest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
		}
	}
	return longest;
};

/** splits every face of a mesh into k x k parts (triangles into k*k triangles), edges stay shared so there are no cracks */
function subdivideMesh(mesh, k, FaceClass, newKey) {
	if (k <= 1) return false;
	const faces = Object.entries(mesh.faces);
	const created = new Map();
	const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
	const vertexAt = (kind, a, b, step, position) => {
		// points on an original edge are shared by the faces next to it
		if (kind == 'edge') {
			const swapped = a > b, ka = swapped ? b : a, kb = swapped ? a : b, s = swapped ? k - step : step;
			const id = ka + '|' + kb + '|' + s;
			if (!created.has(id)) { const key = newKey(); mesh.vertices[key] = position; created.set(id, key); }
			return created.get(id);
		}
		const key = newKey();
		mesh.vertices[key] = position;
		return key;
	};
	const emitted = [];
	for (const [fkey, face] of faces) {
		const keys = facePoints(face);
		if (keys.length < 3 || keys.length > 4) continue;
		const pos = keys.map(key => mesh.vertices[key].slice());
		const uv = keys.map(key => (face.uv && face.uv[key] ? face.uv[key].slice() : [0, 0]));
		const grid = new Map();
		const put = (i, j, p, u, edgeInfo) => {
			let key;
			if (edgeInfo) key = vertexAt('edge', edgeInfo[0], edgeInfo[1], edgeInfo[2], p);
			else key = vertexAt('inner', null, null, 0, p);
			grid.set(i + ',' + j, {key, uv: u});
		};
		if (keys.length == 4) {
			const at = (u, v) => ({p: lerp(lerp(pos[0], pos[1], u), lerp(pos[3], pos[2], u), v), uv: lerp(lerp(uv[0], uv[1], u), lerp(uv[3], uv[2], u), v)});
			for (let j = 0; j <= k; j++) for (let i = 0; i <= k; i++) {
				const {p, uv: u} = at(i / k, j / k);
				const corner = (i == 0 || i == k) && (j == 0 || j == k) ? keys[i == 0 ? (j == 0 ? 0 : 3) : (j == 0 ? 1 : 2)] : null;
				if (corner) { grid.set(i + ',' + j, {key: corner, uv: u}); continue; }
				let edge = null;
				if (j == 0) edge = [keys[0], keys[1], i];
				else if (j == k) edge = [keys[3], keys[2], i];
				else if (i == 0) edge = [keys[0], keys[3], j];
				else if (i == k) edge = [keys[1], keys[2], j];
				put(i, j, p, u, edge);
			}
			for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
				emitted.push({face, corners: [grid.get(i + ',' + j), grid.get((i + 1) + ',' + j), grid.get((i + 1) + ',' + (j + 1)), grid.get(i + ',' + (j + 1))]});
			}
		} else {
			const at = (i, j) => {
				const a = i / k, b = j / k, c = 1 - a - b;
				return {p: pos[0].map((_, n) => pos[0][n] * c + pos[1][n] * a + pos[2][n] * b), uv: uv[0].map((_, n) => uv[0][n] * c + uv[1][n] * a + uv[2][n] * b)};
			};
			for (let j = 0; j <= k; j++) for (let i = 0; i + j <= k; i++) {
				const {p, uv: u} = at(i, j);
				const isCorner = (i == 0 && j == 0) ? 0 : (i == k) ? 1 : (j == k) ? 2 : -1;
				if (isCorner >= 0) { grid.set(i + ',' + j, {key: keys[isCorner], uv: u}); continue; }
				let edge = null;
				if (j == 0) edge = [keys[0], keys[1], i];
				else if (i == 0) edge = [keys[0], keys[2], j];
				else if (i + j == k) edge = [keys[1], keys[2], j];
				put(i, j, p, u, edge);
			}
			for (let j = 0; j < k; j++) for (let i = 0; i + j < k; i++) {
				emitted.push({face, corners: [grid.get(i + ',' + j), grid.get((i + 1) + ',' + j), grid.get(i + ',' + (j + 1))]});
				if (i + j + 1 < k) emitted.push({face, corners: [grid.get((i + 1) + ',' + j), grid.get((i + 1) + ',' + (j + 1)), grid.get(i + ',' + (j + 1))]});
			}
		}
		delete mesh.faces[fkey];
	}
	for (const {face, corners} of emitted) {
		const data = {vertices: corners.map(c => c.key), uv: {}, texture: face.texture};
		corners.forEach(c => { data.uv[c.key] = c.uv; });
		mesh.addFaces(new FaceClass(mesh, data));
	}
	return true;
}

if (typeof __SOFT_EXPORT !== 'undefined') __SOFT_EXPORT({createSim, showSim, keep, reset, getSim: () => sim, setSim: v => { sim = v; }, SoftBody, SoftWorld, DEFAULT_SOFT, DEFAULT_WORLD, SCALE, extractRotation, quatMatrix, subdivideMesh, makeBodies, writeBack, longestEdge, worldTriangles, buildBodies, softOf});
if (typeof Plugin === 'undefined' || typeof Blockbench === 'undefined') return;

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

const TEXTS = {
	en: {
		mode: 'Soft body', play: '▶ Play', pause: '❚❚ Pause', reset: '⟲ Reset', apply: '✔ Keep result',
		stopped: 'stopped', playing: 'playing', paused: 'paused', time: 'Time', sec: 's', points: 'points', contacts: 'contacts',
		selected: 'Selected', select_hint: 'Select meshes (or cubes for obstacles).', role: 'Role',
		role_none: 'Nothing', role_soft: 'Soft body (dents)', role_solid: 'Solid obstacle (does not move)',
		mass: 'Mass (kg)', friction: 'Friction', damping: 'Damping',
		rigidity: 'Stiffness', rigidity_tip: 'How strongly the body keeps its shape. Low = jelly, high = a stiff frame',
		strength: 'Dent resistance', strength_tip: 'How hard a hit must be before the body dents for good. Low = thin sheet metal, high = thick steel',
		plastic: 'Dents stay', plastic_tip: '0 = springs back like rubber, 1 = stays crushed like metal',
		velocity: 'Start velocity (m/s)', velocity_hint: 'Left at 0, the start speed from the Physics tab is used', video: '🎬 Render video (MP4)…',
		hook_label: 'Include soft bodies (the crash is simulated frame by frame)', msg_video: 'Video needs the Render view plugin (render.js 0.6 or newer)',
		detail: 'Detail', detail_hint: 'A mesh can only dent where it has points. A cube has 8; split the polygons into smaller ones first.',
		detail_size: 'Polygon size (px)', subdivide: 'Split polygons of selected meshes', cubes_to_meshes: 'Cubes → meshes',
		world: 'World', gravity: 'Gravity (m/s²)', ground: 'Ground', ground_height: 'Ground height (px)', weld: 'Join points closer than (px)',
		weld_tip: 'Meshes whose points touch (like the parts of a car) are held together at those points',
		quality: 'Quality', q1: 'Fast', q2: 'Normal', q3: 'Precise', collide: 'Bodies hit each other',
		footnote: '16 px = 1 m. Keep result writes the crushed shape into the meshes (Ctrl+Z undoes it). Blockbench cannot animate vertices, so this gives a shape, not keyframes. The Ground objects of the Physics plugin are obstacles too.',
		msg_nothing: 'Soft body: mark at least one mesh as "Soft body" first', msg_cubes: 'Soft bodies need meshes: convert cubes with Edit > Convert to mesh. Cubes can be obstacles.',
		msg_split: 'Polygons split', msg_no_mesh: 'Select a mesh first', msg_convert: 'Use Edit > Convert to mesh', msg_kept: 'Result kept',
		msg_big: 'That would make too many points (over 9000). Use a bigger polygon size.',
	},
	ru: {
		mode: 'Мягкие тела', play: '▶ Пуск', pause: '❚❚ Пауза', reset: '⟲ Сброс', apply: '✔ Оставить результат',
		stopped: 'остановлено', playing: 'идёт', paused: 'пауза', time: 'Время', sec: 'с', points: 'точек', contacts: 'контактов',
		selected: 'Выбрано', select_hint: 'Выделите меши (или кубы для препятствий).', role: 'Роль',
		role_none: 'Ничего', role_soft: 'Мягкое тело (мнётся)', role_solid: 'Твёрдое препятствие (не двигается)',
		mass: 'Масса (кг)', friction: 'Трение', damping: 'Затухание',
		rigidity: 'Жёсткость', rigidity_tip: 'Как сильно тело держит форму. Мало = желе, много = жёсткий каркас',
		strength: 'Сопротивление вмятинам', strength_tip: 'Насколько сильным должен быть удар, чтобы тело смялось насовсем. Мало = тонкая жесть, много = толстая сталь',
		plastic: 'Вмятины остаются', plastic_tip: '0 = пружинит обратно как резина, 1 = остаётся смятым как металл',
		velocity: 'Начальная скорость (м/с)', velocity_hint: 'Если 0, берётся начальная скорость из вкладки Физика', video: '🎬 Рендер видео (MP4)…',
		hook_label: 'Включить мягкие тела (авария считается кадр за кадром)', msg_video: 'Для видео нужен плагин Render view (render.js 0.6 или новее)',
		detail: 'Детализация', detail_hint: 'Меш мнётся только там, где у него есть точки. У куба их 8: сначала разбейте полигоны на более мелкие.',
		detail_size: 'Размер полигона (px)', subdivide: 'Разбить полигоны выбранных мешей', cubes_to_meshes: 'Кубы → меши',
		world: 'Мир', gravity: 'Гравитация (м/с²)', ground: 'Земля', ground_height: 'Высота земли (px)', weld: 'Соединять точки ближе (px)',
		weld_tip: 'Меши, у которых точки касаются (как части машины), держатся вместе в этих точках',
		quality: 'Качество', q1: 'Быстро', q2: 'Нормально', q3: 'Точно', collide: 'Тела сталкиваются друг с другом',
		footnote: '16 px = 1 м. «Оставить результат» записывает смятую форму в меши (Ctrl+Z отменяет). Blockbench не умеет анимировать вершины, поэтому получается форма, а не ключи. Объекты «Земля» из плагина Физика тоже считаются препятствиями.',
		msg_nothing: 'Мягкие тела: сначала отметьте хотя бы один меш как «Мягкое тело»', msg_cubes: 'Мягкому телу нужен меш: превратите кубы через Правка > Преобразовать в меш. Кубы могут быть препятствиями.',
		msg_split: 'Полигоны разбиты', msg_no_mesh: 'Сначала выделите меш', msg_convert: 'Используйте Правка > Преобразовать в меш', msg_kept: 'Результат оставлен',
		msg_big: 'Получится слишком много точек (больше 9000). Возьмите размер полигона побольше.',
	},
};
const tr = key => {
	const lang = (typeof Language != 'undefined' && Language.code) || 'en';
	return (TEXTS[lang] && TEXTS[lang][key]) || TEXTS.en[key] || key;
};

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

let sim = null;   // {world, made, elements, inverses, original, time, acc, last, playing}

function restPose() {
	if (typeof Canvas != 'undefined') { Canvas.updateAllPositions(); Canvas.updateAllBones(); }
	scene.updateMatrixWorld(true);
}

function createSim() {
	restPose();
	const soft = Mesh.all.filter(el => isSoft(el) && el.mesh);
	if (!soft.length) return null;
	const ws = worldOf();
	const solids = [...Cube.all, ...Mesh.all].filter(el => el.mesh && !isSoft(el) && (isSolidFlag(el) || isStaticPhysics(el))).map(el => ({tris: worldTriangles(el)}));
	const ground = Project.model_3d.localToWorld(new THREE.Vector3(0, ws.ground_y, 0)).y;
	const made = makeBodies(soft, ws.weld);
	const world = new SoftWorld({gravity: ws.gravity, ground: ws.ground, ground_y: ground, quality: ws.quality, collide: ws.collide}, solids);
	made.bodies.forEach(b => world.add(b));
	const inverses = new Map(soft.map(el => [el, el.mesh.matrixWorld.clone().invert()]));
	const original = soft.map(el => [el, JSON.parse(JSON.stringify(el.vertices))]);
	Undo.initEdit({elements: soft});
	return {world, made, elements: soft, inverses, original, time: 0, acc: 0, last: performance.now(), playing: false, points: made.bodies.reduce((n, b) => n + b.n, 0)};
}

function showSim() {
	if (!sim) return;
	writeBack(sim.elements, sim.made, sim.inverses);
	Canvas.updateView({elements: sim.elements, element_aspects: {geometry: true}});
}

function stopTicking() { if (sim) sim.playing = false; }

function play() {
	if (!sim) {
		sim = createSim();
		if (!sim) { Blockbench.showQuickMessage(tr('msg_nothing'), 2500); return; }
	}
	if (sim.playing) return;
	sim.playing = true;
	sim.last = performance.now();
	const tick = now => {
		if (!sim || !sim.playing) return;
		sim.acc += Math.min(0.1, (now - sim.last) / 1000);
		sim.last = now;
		let steps = 0;
		while (sim.acc >= 1 / 60 && steps < 3) {
			sim.world.step(1 / 60);
			sim.acc -= 1 / 60;
			sim.time += 1 / 60;
			steps++;
		}
		if (sim.acc > 0.2) sim.acc = 0;
		showSim();
		updatePanel();
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	updatePanel();
}

function pause() {
	stopTicking();
	updatePanel();
}

// back to the shape before Play
function reset() {
	if (!sim) return updatePanel();
	sim.playing = false;
	for (const [el, vertices] of sim.original) el.vertices = vertices;
	Undo.cancelEdit(false);
	Canvas.updateView({elements: sim.elements, element_aspects: {geometry: true}});
	sim = null;
	updatePanel();
}

// keep the crushed shape (one undo step)
function keep() {
	if (!sim) return;
	sim.playing = false;
	showSim();
	Undo.finishEdit('Soft body simulation', {elements: sim.elements});
	sim = null;
	Blockbench.showQuickMessage(tr('msg_kept'), 1500);
	updatePanel();
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

let mode = null, panel = null, properties = [], style_node = null;
const isPart = e => e instanceof Cube || e instanceof Mesh;
const selectedElements = () => (Project ? Outliner.selected.filter(isPart) : []);
const num = (v, d) => isFinite(parseFloat(v)) ? parseFloat(v) : d;
const clamp01 = v => Math.max(0, Math.min(1, v));

function updatePanel() {
	if (!panel || !panel.inside_vue) return;
	const vue = panel.inside_vue, nodes = selectedElements();
	const key = nodes.map(n => n.uuid).join(',');
	if (vue.selection_key != key) {
		vue.selection_key = key;
		vue.count = nodes.length;
		vue.label = nodes.length == 1 ? nodes[0].name : `${nodes.length} selected`;
		const roles = new Set(nodes.map(n => (n.soft && n.soft.role) || 'none'));
		vue.role = roles.size == 1 ? [...roles][0] : 'mixed';
		vue.has_mesh = nodes.some(n => n instanceof Mesh);
		const p = softOf(nodes.find(isSoft) || nodes[0] || {});
		Object.assign(vue, {mass: p.mass, rigidity: p.rigidity, strength: p.strength, plastic: p.plastic, damping: p.damping, friction: p.friction,
			vx: p.velocity[0], vy: p.velocity[1], vz: p.velocity[2]});
		vue.mesh_points = nodes.filter(n => n instanceof Mesh).reduce((sum, n) => sum + Object.keys(n.vertices).length, 0);
	}
	if (Project && vue.world_project != Project.uuid) {
		Object.assign(vue, worldOf());
		vue.world_project = Project.uuid;
	}
	vue.state = !sim ? 'stopped' : sim.playing ? 'playing' : 'paused';
	vue.time = sim ? sim.time.toFixed(2) : '0.00';
	vue.sim_points = sim ? sim.points : 0;
	vue.contacts = sim ? sim.world.stats.contacts : 0;
}

function editElements(elements, name, change) {
	Undo.initEdit({elements});
	elements.forEach(change);
	Undo.finishEdit(name, {elements});
	Project.saved = false;
}

function panelComponent() {
	return {
		data() {
			return {
				selection_key: null, count: 0, label: '', role: 'none', has_mesh: false, mesh_points: 0, world_project: '', state: 'stopped', time: '0.00', sim_points: 0, contacts: 0,
				mass: 1000, rigidity: 0.6, strength: 0.4, plastic: 0.7, damping: 0.2, friction: 0.3, vx: 0, vy: 0, vz: 0,
				gravity: 9.81, ground: true, ground_y: 0, weld: 0.6, quality: 2, collide: true, detail_size: 4,
			};
		},
		methods: {
			t(key) { return tr(key); },
			setRole(role) {
				reset();
				let nodes = selectedElements();
				if (!nodes.length) return;
				if (role == 'soft' && nodes.some(n => !(n instanceof Mesh))) {
					Blockbench.showQuickMessage(tr('msg_cubes'), 3500);
					nodes = nodes.filter(n => n instanceof Mesh);
					if (!nodes.length) { this.selection_key = null; return; }
				}
				editElements(nodes, 'Change soft body', el => { el.soft = role == 'none' ? null : Object.assign(softOf(el), {role}); });
				this.selection_key = null;
				updatePanel();
			},
			saveSoft() {
				reset();
				const values = {mass: Math.max(0.1, num(this.mass, 1000)), rigidity: clamp01(num(this.rigidity, 0.6)), strength: clamp01(num(this.strength, 0.4)),
					plastic: clamp01(num(this.plastic, 0.7)), damping: Math.max(0, num(this.damping, 0.2)), friction: clamp01(num(this.friction, 0.3)),
					velocity: [num(this.vx, 0), num(this.vy, 0), num(this.vz, 0)]};
				editElements(selectedElements().filter(isSoft), 'Change soft body', el => { el.soft = Object.assign(softOf(el), values); });
			},
			saveWorld() {
				reset();
				Project.soft_world = {gravity: num(this.gravity, 9.81), ground: !!this.ground, ground_y: num(this.ground_y, 0), weld: Math.max(0.05, num(this.weld, 0.6)),
					quality: Math.max(1, Math.min(3, Math.round(num(this.quality, 2)))), collide: !!this.collide};
				Project.saved = false;
			},
			subdivide() {
				reset();
				const meshes = selectedElements().filter(el => el instanceof Mesh);
				if (!meshes.length) { Blockbench.showQuickMessage(tr('msg_no_mesh'), 2000); return; }
				const target = Math.max(0.5, num(this.detail_size, 4));
				const plan = meshes.map(el => ({el, k: Math.max(1, Math.min(24, Math.ceil(longestEdge(el) / target)))}));
				const estimate = plan.reduce((n, p) => n + Object.keys(p.el.faces).length * p.k * p.k * 2, 0);
				if (estimate > 9000) { Blockbench.showQuickMessage(tr('msg_big'), 3500); return; }
				editElements(meshes, 'Split polygons', el => {
					const k = plan.find(p => p.el == el).k;
					subdivideMesh(el, k, MeshFace, () => (typeof bbuid == 'function' ? bbuid(4) : Math.random().toString(36).slice(2, 6)));
				});
				Canvas.updateView({elements: meshes, element_aspects: {geometry: true, uv: true, faces: true}});
				this.selection_key = null;
				updatePanel();
				Blockbench.showQuickMessage(tr('msg_split'), 1500);
			},
			cubesToMeshes() {
				const id = typeof BarItems != 'undefined' && Object.keys(BarItems).find(k => /convert.*mesh|mesh.*convert/i.test(k));
				if (id && BarItems[id].click) BarItems[id].click();
				else Blockbench.showQuickMessage(tr('msg_convert'), 3000);
				this.selection_key = null;
			},
			video() { const a = typeof BarItems != 'undefined' && BarItems.render_video; if (a && a.click) a.click(); else Blockbench.showQuickMessage(tr('msg_video'), 3500); },
				play() { play(); },
			pause() { pause(); },
			reset() { reset(); },
			keep() { keep(); },
		},
		template: `
			<div class="soft_panel">
				<div class="soft_buttons">
					<button v-if="state != 'playing'" @click="play()">{{ t('play') }}</button>
					<button v-else @click="pause()">{{ t('pause') }}</button>
					<button @click="reset()">{{ t('reset') }}</button>
					<button @click="keep()" :disabled="state == 'stopped'" class="wide">{{ t('apply') }}</button>
				</div>
				<button @click="video()" class="soft_full" style="margin: 0 0 6px;">{{ t('video') }}</button>
				<div class="soft_dim">{{ t('time') }} {{ time }} {{ t('sec') }} · {{ t(state) }}<template v-if="sim_points"> · {{ sim_points }} {{ t('points') }} · {{ contacts }} {{ t('contacts') }}</template></div>

				<h3>{{ t('selected') }}</h3>
				<div v-if="!count" class="soft_dim">{{ t('select_hint') }}</div>
				<template v-else>
					<div class="soft_title"><b>{{ label }}</b><span v-if="has_mesh" class="soft_dim"> · {{ mesh_points }} {{ t('points') }}</span></div>
					<label class="soft_row">{{ t('role') }}
						<select :value="role" @change="setRole($event.target.value)">
							<option value="none">{{ t('role_none') }}</option>
							<option value="soft">{{ t('role_soft') }}</option>
							<option value="solid">{{ t('role_solid') }}</option>
							<option v-if="role == 'mixed'" value="mixed" disabled>…</option>
						</select>
					</label>
					<div v-if="role == 'soft'" class="soft_box">
						<div class="soft_grid g3">
							<label>{{ t('mass') }}<input type="number" step="50" min="0.1" v-model="mass" @change="saveSoft()"></label>
							<label>{{ t('friction') }}<input type="number" step="0.05" min="0" max="1" v-model="friction" @change="saveSoft()"></label>
							<label>{{ t('damping') }}<input type="number" step="0.05" min="0" v-model="damping" @change="saveSoft()"></label>
						</div>
						<div class="soft_slider" :title="t('rigidity_tip')"><span>{{ t('rigidity') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="rigidity" @change="saveSoft()"><span class="value">{{ rigidity }}</span></div>
						<div class="soft_slider" :title="t('strength_tip')"><span>{{ t('strength') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="strength" @change="saveSoft()"><span class="value">{{ strength }}</span></div>
						<div class="soft_slider" :title="t('plastic_tip')"><span>{{ t('plastic') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="plastic" @change="saveSoft()"><span class="value">{{ plastic }}</span></div>
						<div class="soft_cap">{{ t('velocity') }}</div>
							<div class="soft_dim small" style="margin: 0 0 4px;">{{ t('velocity_hint') }}</div>
						<div class="soft_grid g3">
							<input type="number" v-model="vx" @change="saveSoft()" title="X">
							<input type="number" v-model="vy" @change="saveSoft()" title="Y">
							<input type="number" v-model="vz" @change="saveSoft()" title="Z">
						</div>
					</div>
				</template>

				<details class="soft_box" open>
					<summary>{{ t('detail') }}</summary>
					<div class="soft_dim">{{ t('detail_hint') }}</div>
					<div class="soft_grid g2">
						<label>{{ t('detail_size') }}<input type="number" step="0.5" min="0.5" v-model="detail_size"></label>
						<button @click="subdivide()" class="soft_wide">{{ t('subdivide') }}</button>
					</div>
					<button @click="cubesToMeshes()" class="soft_full">{{ t('cubes_to_meshes') }}</button>
				</details>

				<details class="soft_box">
					<summary>{{ t('world') }}</summary>
					<div class="soft_grid g2">
						<label>{{ t('gravity') }}<input type="number" step="0.1" v-model="gravity" @change="saveWorld()"></label>
						<label :title="t('weld_tip')">{{ t('weld') }}<input type="number" step="0.1" min="0.05" v-model="weld" @change="saveWorld()"></label>
						<label>{{ t('quality') }}
							<select v-model.number="quality" @change="saveWorld()">
								<option :value="1">{{ t('q1') }}</option>
								<option :value="2">{{ t('q2') }}</option>
								<option :value="3">{{ t('q3') }}</option>
							</select>
						</label>
						<label v-if="ground">{{ t('ground_height') }}<input type="number" v-model="ground_y" @change="saveWorld()"></label>
						<label class="inline">{{ t('ground') }}<input type="checkbox" v-model="ground" @change="saveWorld()"></label>
						<label class="inline">{{ t('collide') }}<input type="checkbox" v-model="collide" @change="saveWorld()"></label>
					</div>
				</details>
				<div class="soft_dim small">{{ t('footnote') }}</div>
			</div>`,
	};
}

const STYLE = `
	#panel_softbody .soft_panel { overflow-y: auto !important; overflow-x: hidden !important; }
	.soft_panel { padding: 4px 8px 10px; font-size: 0.92em; }
	.soft_panel h3 { font-size: 1em; text-transform: uppercase; opacity: 0.8; margin: 8px 0 4px; }
	.soft_panel .soft_buttons { display: flex; gap: 4px; margin-bottom: 6px; }
	.soft_panel .soft_buttons button { flex: 1; min-width: 0; padding: 4px 6px; }
	.soft_panel .soft_buttons button.wide { flex: 1.5; }
	.soft_panel .soft_dim { opacity: 0.7; margin: 2px 0 6px; }
	.soft_panel .soft_dim.small { font-size: 0.85em; opacity: 0.55; margin-top: 10px; }
	.soft_panel .soft_title { margin: 4px 0; }
	.soft_panel .soft_row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0; }
	.soft_panel .soft_row select { width: 62%; }
	.soft_panel .soft_box { margin: 6px 0; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-back); }
	.soft_panel .soft_box > summary { cursor: pointer; text-transform: uppercase; font-size: 0.82em; opacity: 0.8; outline: none; }
	.soft_panel details.soft_box[open] > summary { margin-bottom: 6px; }
	.soft_panel .soft_cap { font-size: 0.82em; opacity: 0.75; margin: 4px 0 2px; }
	.soft_panel .soft_grid { display: grid; gap: 4px 6px; }
	.soft_panel .soft_grid.g2 { grid-template-columns: 1fr 1fr; }
	.soft_panel .soft_grid.g3 { grid-template-columns: 1fr 1fr 1fr; }
	.soft_panel .soft_grid label { display: flex; flex-direction: column; gap: 1px; font-size: 0.82em; min-width: 0; }
	.soft_panel .soft_grid label.inline { flex-direction: row; align-items: center; justify-content: space-between; align-self: end; gap: 6px; }
	.soft_panel .soft_grid input, .soft_panel .soft_grid select { width: 100%; min-width: 0; box-sizing: border-box; }
	.soft_panel .soft_grid .soft_wide { align-self: end; padding: 4px 6px; }
	.soft_panel .soft_full { width: 100%; margin-top: 6px; padding: 4px 6px; }
	.soft_panel .soft_slider { display: flex; align-items: center; gap: 6px; margin: 3px 0; font-size: 0.88em; }
	.soft_panel .soft_slider > span:first-child { width: 38%; }
	.soft_panel .soft_slider input[type=range] { flex: 1; min-width: 0; }
	.soft_panel .soft_slider .value { width: 34px; text-align: right; opacity: 0.8; }
	.soft_panel input[type=number], .soft_panel select { background: var(--color-dark); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px; padding: 2px 4px; }
`;

const onSelection = () => updatePanel();

// the Render view plugin asks for the soft bodies frame by frame when it renders a video (the soft shape cannot be baked into keyframes)
const renderHook = {
	name: 'softbody',
	label: () => tr('hook_label'),
	available: () => !!Project && Mesh.all.some(el => isSoft(el) && el.mesh),
	start() { reset(); sim = createSim(); },
	frame(time) {
		if (!sim) return;
		while (sim.time < time - 1e-6) { sim.world.step(1 / 60); sim.time += 1 / 60; }
		showSim();
	},
	end() { reset(); },
};


Plugin.register('softbody', {
	title: 'Soft body',
	author: 'Claude',
	description: 'Crash test deformation: soft meshes dent when they hit walls and each other, like in BeamNG.',
	about: 'Open the **Soft body** tab. Mark meshes as **Soft body** (they dent) and meshes or cubes as **Solid obstacle**, split the polygons of the soft meshes into smaller ones (a cube only has 8 points), give the soft body a start velocity and press **Play**. Dents can stay (metal) or spring back (rubber). **Keep result** writes the crushed shape into the meshes. Works on the polygons of the mesh: every vertex is a point mass, every edge a spring, plus a shape matching force; meshes whose points touch are joined into one body (a car made of parts).',
	icon: 'car_crash',
	version: '0.2.0',
	variant: 'both',
	min_version: '4.10.0',
	tags: ['Animation'],
	onload() {
		properties.push(new Property(Mesh, 'object', 'soft', {default: null}));
		properties.push(new Property(Cube, 'object', 'soft', {default: null}));
		properties.push(new Property(ModelProject, 'object', 'soft_world', {default: null}));
		style_node = Blockbench.addCSS(STYLE);
		mode = new Mode('softbody', {
			name: tr('mode'),
			icon: 'car_crash',
			category: 'navigate',
			condition: () => Project && Format && Format.id != 'image',
			default_tool: 'move_tool',
			onSelect() {
				const vue = panel && panel.inside_vue;
				if (vue) { vue.selection_key = null; vue.world_project = ''; }
				updatePanel();
			},
			onUnselect() { reset(); },
		});
		panel = new Panel('softbody', {
			name: tr('mode'),
			growable: true,
			resizable: true,
			min_height: 200,
			icon: 'car_crash',
			condition: {modes: ['softbody']},
			default_position: {slot: 'right_bar', float_position: [0, 0], float_size: [320, 560], height: 560},
			component: panelComponent(),
		});
		// the outliner is needed to pick objects in this tab
		const outliner = Interface.Panels.outliner;
		if (outliner && outliner.condition && outliner.condition.modes instanceof Array && !outliner.condition.modes.includes('softbody')) {
			outliner.condition.modes.push('softbody');
		}
		globalThis.__renderHooks = (globalThis.__renderHooks || []).filter(h => h.name != 'softbody').concat([renderHook]);
		Blockbench.on('update_selection', onSelection);
		Blockbench.on('select_project', onSelection);
	},
	onunload() {
		if (sim) reset();
		globalThis.__renderHooks = (globalThis.__renderHooks || []).filter(h => h.name != 'softbody');
		Blockbench.removeListener('update_selection', onSelection);
		Blockbench.removeListener('select_project', onSelection);
		if (Modes.softbody) Modes.options.edit.select();
		const outliner = Interface.Panels.outliner;
		if (outliner && outliner.condition && outliner.condition.modes instanceof Array) outliner.condition.modes.remove('softbody');
		if (panel) panel.delete();
		if (mode) mode.delete();
		properties.forEach(p => p.delete());
		properties = [];
		if (style_node) style_node.delete();
	},
});

})();
