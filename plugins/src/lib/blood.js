// ---------------------------------------------------------------------------
// Blood (scripts/fx/blood.gd), ported line by line:
//  - Droplets: ballistic points (gravity + air drag) swept with rays, drawn as velocity-stretched beads.
//  - Impacts leave splats sized by volume and speed and stretched by the impact angle.
//  - Runs: blood on a slope or wall flows downhill as a thin film, hangs from ceilings, drips off edges, collects in pools.
//  - Pools grow and spread with the volume that reaches them (area = volume / film thickness), in tongues.
//  - Bodies: wounds ooze or spurt with the pulse, blood runs over the body parts under gravity, soaks the clothes and
//    drips off the lowest point. Moving bodies smear what they carry or lie in; bloody feet leave prints.
//  - Everything dries: colour goes to dark brown and the wet gloss disappears.
// The logic is here (BloodSim); what is drawn is in BloodView. Units: metres, seconds, ml.
// ---------------------------------------------------------------------------

const B_MAX_DROPS = 560, B_MAX_DROPS_HIGH = 20000, B_MAX_RUNS = 160, B_MAX_BODY_RUNS = 70, B_MAX_POOLS = 160;
const B_GRAVITY = 9.81;
const B_FILM = 1.4e-3;            // pool film thickness on hard ground, m (blood is thick)
const B_DEPOSIT_WALL = 3.0;       // ml left behind per metre by a 12 mm run on hard surfaces
const B_DEPOSIT_CLOTH = 2.5;      // ml the clothes take up per metre of a run (the rest runs on)
const B_EXTERNAL = 0.3;           // share of the lost blood that comes out of the wound (a torso wound bleeds mostly inside)
const B_EXTERNAL_ARTERIAL = 0.65;
const B_DRY_TIME = 140.0;
// a run is drawn no narrower than this (m): the world maps hold 1.8 cm a texel - a run of a few mm averaged away to nothing
const B_RUN_MIN_W = 0.025;
const B_SPARE = 3;

const brand = () => Math.random();
const brange = (a, b) => a + (b - a) * Math.random();
const brandi = n => Math.floor(Math.random() * n);
const deg = d => d * Math.PI / 180;
const rotAround = (v, axis, a) => v.clone().applyAxisAngle(axis.clone().normalize(), a);

class BloodSim {
	constructor(rt, people) {
		this.rt = rt;
		this.J = rt.Jolt;
		this.people = people;           // the humanoids (bots)
		this._drops = []; this._runs = []; this._body_runs = []; this._pools = [];
		this._bleeders = []; this._jets = [];
		this._soak = new Map(); this._soak_stamp = new Map(); this._dead_since = new Map(); this._feet = new Map();
		this._wounds = new Map();        // bot -> wounds
		this._splat_grid = new Set();
		this._film = new Map();   // how thick the blood already lies on the level, per 3 cm cell (0..1)
		this._time = 0; this._tick = 0; this._smear_t = 0; this._since_sim = 0;
		this._timers = [];
		this.view = null;
		// High: every drop of it flies on its own and lands where its flight takes it (nothing is thinned out, no drop
		// is dropped for want of room, a burst is drops and not rays painted at once)
		this.high = people.some(r => r.s && r.s.blood_high);
		// how the blood looks as it lies (the view reads it; a bake keeps it)
		const s0 = (people.find(r => r.s) || {}).s || {};
		this.settings = {dry: s0.blood_dry ?? 30, density: s0.blood_density ?? 0.6};
		this.max_drops = this.high ? B_MAX_DROPS_HIGH : B_MAX_DROPS;
		this.ground = groundLevel(rt);
		// rays: what is "world" (the level: static bodies and the ground) and "props" (moving things that are not people)
		const J = this.J;
		this.f_world = new J.IgnoreMultipleBodiesFilter();
		this.f_world_props = rayFilters(rt).people;
		this.part_of = new Map();       // body index -> {bot, part}
		for (const bot of people) for (const part of bot.parts) this.part_of.set(part.id.GetIndexAndSequenceNumber(), {bot, part});
		this.entry_of = new Map();
		for (const e of rt.world.entries) {
			this.entry_of.set(e.id.GetIndexAndSequenceNumber(), e);
			if (e.desc.settings.type == 'dynamic') this.f_world.IgnoreBody(e.id);
		}
		for (const bot of people) {
			bot.own_filter = new J.IgnoreMultipleBodiesFilter();
			for (const p of bot.parts) bot.own_filter.IgnoreBody(p.id);
		}
	}

	clock() { return this._time; }

	// a ray from a to b: {position, normal, collider: {part, bot} | {entry} | null (the level)} or null.
	// mode: 'all' (level, props, people), 'world' (the level), 'world_props', 'bots' (one part only: `only`)
	ray(a, b, mode, ignore_bot, only) {
		let filter;
		if (mode == 'world') filter = this.f_world;
		else if (mode == 'world_props') filter = this.f_world_props;
		else if (mode == 'bots') {
			filter = new this.J.IgnoreMultipleBodiesFilter();
			for (const e of this.rt.world.entries) if (e.id.GetIndexAndSequenceNumber() != only) filter.IgnoreBody(e.id);
		} else filter = ignore_bot ? ignore_bot.own_filter : null;
		let hit = castRay(this.rt, a, b.clone().sub(a), filter);
		if (mode == 'bots') this.J.destroy(filter);
		if (mode == 'bots') {
			if (!hit || hit.id != only) return null;
		}
		if (hit) {
			const owner = this.part_of.get(hit.id);
			const entry = this.entry_of.get(hit.id);
			hit.collider = owner || (entry && entry.desc.settings.type == 'dynamic' ? {entry} : null);
		}
		if (mode == 'bots') return hit;
		// what is seen of the level catches blood too: a thing not ticked as Ground in the Physics tab is no longer flown
		// through, and where a collider is not quite where its face is drawn, the stain goes on the face that is seen
		// (the maps keep blood to the depth of the face: a stain a few cm off it was not drawn at all)
		const vis = this._visual_ray(a, b);
		if (vis) {
			const hd = hit ? a.distanceTo(hit.position) : Infinity, vd = a.distanceTo(vis.position);
			if (hit && hit.collider && hd <= vd + 0.01) return hit;   // a person or a moving thing in front of it
			if (vd <= hd + 0.15) return vis;
		}
		return hit;
	}

	// the drawn elements of the level (not the people, not what moves, not cloth), pixels; found once
	_level_meshes() {
		if (this._vis_meshes) return this._vis_meshes;
		const list = [];
		try {
			const people = new Set();
			for (const bot of this.people) for (const pt of bot.parts) if (pt.group) people.add(pt.group);
			const skip = node => { for (let n = node; n && n !== 'root'; n = n.parent) {
				if (people.has(n) || (n.attach && n.attach.root) || (n.physics && n.physics.type == 'dynamic') || (n.cloth && n.cloth.enabled && Object.keys(n.cloth).length)) return true; } return false; };
			for (const el of [...(typeof Cube != 'undefined' ? Cube.all : []), ...(typeof Mesh != 'undefined' ? Mesh.all : [])]) {
				if (!el.mesh || !el.mesh.geometry || el.visibility === false || skip(el)) continue;
				el.mesh.updateMatrixWorld(true);
				if (!el.mesh.geometry.boundingBox) el.mesh.geometry.computeBoundingBox();
				list.push({mesh: el.mesh, box: el.mesh.geometry.boundingBox.clone().applyMatrix4(el.mesh.matrixWorld).expandByScalar(0.5)});
			}
		} catch (err) { /* outside Blockbench */ }
		return (this._vis_meshes = list);
	}
	_visual_ray(a, b) {
		const list = this._level_meshes();
		if (!list.length) return null;
		const A = a.clone().multiplyScalar(SCALE), B = b.clone().multiplyScalar(SCALE), d = B.clone().sub(A), len = d.length();
		if (len < 1e-6) return null;
		d.divideScalar(len);
		const ray = this._vray || (this._vray = new THREE.Raycaster());
		ray.set(A, d); ray.near = 0; ray.far = len;
		const seg = new THREE.Box3().setFromPoints([A, B]), cand = [];
		for (const m of list) if (m.box.intersectsBox(seg)) cand.push(m.mesh);
		if (!cand.length) return null;
		for (const h of ray.intersectObjects(cand, false)) {
			if (!h.face) continue;
			const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
			if (n.dot(d) >= 0) continue;   // (the back of a face: from inside a thing)
			return {position: h.point.clone().divideScalar(SCALE), normal: n, collider: null, fraction: h.distance / len, id: -1};
		}
		return null;
	}

	// --- Public API (called by the humanoid) ---

	// a bullet hit a body part. kind: "head", "neck", "torso", "limb"; rate: the bleed rate (ml/s) this wound added
	on_hit(bot, part, point, dir, weapon, kind, rate, arterial) {
		const pellet = weapon == 'shotgun' || weapon == 'frag';
		const sx = this.shapeXf(bot, part);
		const entry_n = shapeProject(part.shape, sx.toLocal(point))[1].applyQuaternion(sx.q).normalize();
		const ws = pellet ? 0.07 : 0.1;
		// a shot at an angle drags the blood sideways across the skin/cloth
		const slide = dir.clone().addScaledVector(entry_n, -dir.dot(entry_n));
		const graze = clamp(slide.length(), 0, 1);
		const slide_n = graze > 0.05 ? slide.clone().normalize() : gv();
		this._body_stamp(bot, part, point, entry_n, dir, ws, ws * (1 + graze * 1.2), 'wound', 0);
		// the burst where it went in: thrown back out the way it came
		this.splash(point, entry_n.clone().addScaledVector(dir, -0.6).normalize(), pellet ? 0.3 : 0.42);
		// then the stain spreads out from it through the clothes over the next seconds
		const spread = clamp(0.07 + rate * 0.004, 0.07, 0.16) * (pellet ? 0.7 : 1.0);
		bot.bloom_blood(part, point, spread, 2.2 + rate * 0.03, 0.8);
		if (graze > 0.3) {
			const l = (0.06 + 0.16 * graze) * (pellet ? 0.6 : 1.0);
			this._body_stamp(bot, part, point.clone().addScaledVector(slide_n, l * 0.5), entry_n, slide_n, ws * 0.45, l, 'streak', 0);
		}
		// where the bullet leaves the part (through-and-through)
		const exit = this._exit_point(bot, part, point, dir);
		if (exit) {
			const es = pellet ? 0.09 : 0.14;
			const ex_n = shapeProject(part.shape, sx.toLocal(exit))[1].applyQuaternion(sx.q).normalize();
			this._body_stamp(bot, part, exit, ex_n, dir, es, es, 'splat', brandi(B_SPARE));
			this.splash(exit, dir, pellet ? 0.45 : 0.7, 0.38);
			bot.bloom_blood(part, exit, es * 1.3, 3.0, 0.8);
		}
		let count = 14, total = 5;
		if (kind == 'head') { count = pellet ? 22 : 70; total = pellet ? 18 : 70; }
		else if (kind == 'neck') { count = pellet ? 16 : 36; total = pellet ? 12 : 35; }
		else if (kind == 'torso') { count = pellet ? 12 : 30; total = pellet ? 9 : 28; }
		else { count = pellet ? 7 : 16; total = pellet ? 4 : 12; }
		const origin = exit || point;
		// forward spray out of the exit wound
		this._spray(origin.clone().addScaledVector(dir, 0.02), dir, 24, 3, 11, count, total, bot);
		// back spatter out of the entry wound
		const back = dir.clone().multiplyScalar(-0.6).addScaledVector(entry_n, 0.8).normalize();
		this._spray(point.clone().addScaledVector(entry_n, 0.02), back, 45, 0.8, 3.5, Math.floor(count * 0.35), total * 0.2, bot);
		this._mist_burst(origin, dir, kind == 'head' && !pellet ? 1.0 : 0.55);
		// through the head: it is blown out of the far side, onto whatever is behind
		if (kind == 'head' && !pellet) this.exit_splatter(origin.clone().addScaledVector(dir, 0.03), dir, 1.0, bot);
		// register the wound for bleeding
		if (!this._wounds.has(bot)) this._wounds.set(bot, []);
		const wounds = this._wounds.get(bot);
		const push_s = slide_n.clone().applyQuaternion(sx.q.clone().invert());
		// a wrecked head pours: scalp, face and the vessels at the base of the skull empty out
		let gush = 0;
		if (kind == 'head') gush = pellet ? 220 : 480;
		else if (kind == 'neck') gush = 120;
		wounds.push({part, p: sx.toLocal(point), w: Math.max(rate, 2), arterial, acc: 0, pulse: brand(), push: push_s, graze, kind, gush});
		if (graze > 0.3) {
			// the first gush, thrown along the direction the bullet was going
			const br = this._start_body_run(bot, part, point, (1.5 + 3.5 * graze) * (pellet ? 0.5 : 1.0));
			if (br) { br.push = push_s.clone(); br.push_k = graze * 1.4; br.dir = push_s.clone(); }
		}
		if (exit) wounds.push({part, p: sx.toLocal(exit), w: Math.max(rate, 2) * 0.8, arterial: false, acc: 0, pulse: 0});
		if (!this._bleeders.includes(bot)) this._bleeders.push(bot);
	}

	// a stump or a smashed head: a stream of blood out of `at` along `out`; flow in ml/s at full pressure
	open_jet(bot, part, at, out, flow, head = false, gush = 0, spread = 0.02) {
		if (this._jets.filter(j => j.part == part).length >= 3) return;
		const q = bot.quat(part);
		this._jets.push({bot, part, p: bot.toLocal(part, at), dir: out.clone().applyQuaternion(q.clone().invert()).normalize(), flow, head, beat: brand(), acc: 0, drain: 0, age: 0, gush, spread});
	}

	// heart still going (a shot to the head kills the brain, not the heart), its rate, how full the vessels still are
	_pressure(jet) {
		const bot = jet.bot;
		let p = 1;
		if (!bot.alive) { const since = this._time - (this._dead_since.has(bot) ? this._dead_since.get(bot) : this._time); p = Math.exp(-since / (jet.head ? 7.0 : 2.2)); }
		return p * Math.exp(-jet.age / (jet.head ? 45 : 35));
	}

	_update_jets(dt) {
		for (let i = 0; i < this._jets.length;) {
			const jet = this._jets[i];
			if (jet.age > 90) { this._jets.splice(i, 1); continue; }
			jet.age += dt;
			if (!jet.bot.alive && !this._dead_since.has(jet.bot)) this._dead_since.set(jet.bot, this._time);
			const pr = this._pressure(jet);
			const q = jet.bot.quat(jet.part);
			const at = jet.bot.toWorld(jet.part, jet.p);
			const out = jet.dir.clone().applyQuaternion(q).normalize();
			const v0 = jet.bot.lin(jet.part);
			if (pr > 0.08) {
				// the heartbeat: a sharp surge, then the stream sags until the next
				const rate = 1.25 + 0.4 * (1 - pr);
				jet.beat += dt * rate;
				const ph = jet.beat % 1, surge = Math.exp(-ph * 6);
				const push = pr * (0.45 + 0.55 * surge);
				const speed = glerp(0.8, 5.2, push), vol = jet.flow * push * dt;
				const n = 2;
				for (let k = 0; k < n; k++) {
					const d = cone(out, deg(3 + 5 * (1 - push)));
					const sp = speed * brange(0.92, 1.05);
					this.spawn_drop(at.clone().addScaledVector(d, 0.01 + sp * dt * k / n), v0.clone().addScaledVector(d, sp), vol / n, jet.bot, 0.15, false, 0.014);
				}
			}
			// a body opened right across: what the trunk holds pours out of the whole cut face in the first seconds
			if (jet.gush > 0) {
				const g = Math.min(jet.gush, dt * (60 + jet.gush * 0.45));
				jet.gush -= g;
				let side = out.clone().cross(gv(0, 1, 0));
				side = side.length() > 0.05 ? side.normalize() : gv(1, 0, 0);
				const side2 = out.clone().cross(side).normalize();
				for (let k = 0; k < 2; k++) {
					const off = side.clone().multiplyScalar(brange(-1, 1)).addScaledVector(side2, brange(-1, 1)).multiplyScalar(jet.spread);
					this.spawn_drop(at.clone().add(off).addScaledVector(out, 0.02), v0.clone().addScaledVector(out, brange(0.3, 1.2)).add(gv(0, -0.3, 0)), g / 2, jet.bot, 0.2, true, 0.008);
				}
			}
			// whatever the pressure, some runs out by gravity from the lowest edge of the wound
			jet.drain += jet.flow * dt * (0.12 + 0.25 * (1 - pr)) * Math.exp(-jet.age / 60);
			if (jet.drain >= 1.2) {
				this._drip(at.clone().add(gv(brange(-0.02, 0.02), -0.02, brange(-0.02, 0.02))), v0, jet.drain, jet.bot);
				jet.drain = 0;
			}
			if (jet.gush <= 0 && pr <= 0.08 && jet.age > 30 && jet.flow * Math.exp(-jet.age / 60) < 0.5) { this._jets.splice(i, 1); continue; }
			i++;
		}
	}

	// --- Droplets ---

	_spray(origin, dir, cone_deg, v_min, v_max, count, total, ignore) {
		// fewer, somewhat bigger drops carry the same blood (High: all of them)
		if (!this.high) count = Math.ceil(count * 0.45);
		if (count <= 0) return;
		const weights = [];
		let sum = 0;
		for (let i = 0; i < count; i++) { const w = Math.pow(brand(), 3) + 0.02; weights.push(w); sum += w; }   // many fine droplets, a few heavy ones
		for (let i = 0; i < count; i++) {
			const d = cone(dir, deg(cone_deg));
			const vol = total * weights[i] / sum;
			const sp = brange(v_min, v_max) * glerp(0.7, 1.0, clamp(vol, 0, 1));   // heavy drops keep more of the bullet's speed
			this.spawn_drop(origin.clone().add(jitter(0.015)), d.multiplyScalar(sp), vol, ignore, 0.12);
		}
	}

	spawn_drop(pos, vel, vol, ignore = null, ignore_t = 0, drip = false, streak = 0.003) {
		if (vol < (this.high ? 0.0005 : 0.005)) return;
		let d;
		if (this._drops.length >= this.max_drops) d = this._drops[brandi(this._drops.length)];
		else { d = {}; this._drops.push(d); }
		Object.assign(d, {pos: pos.clone(), vel: vel.clone(), vol: Math.min(vol, 12), age: 0, drip, ignore, ignore_t, streak, seed: Math.random()});
	}

	// blood leaving a body: if the ground is right there (a body lying on it) it goes straight into the pool
	_drip(pos, vel, vol, ignore) {
		const hit = this.ray(pos.clone().add(gv(0, 0.12, 0)), pos.clone().add(gv(0, -0.1, 0)), 'world');
		if (hit && hit.normal.y > 0.8) { this._add_pool(hit.position, hit.normal, vol); return; }
		this.spawn_drop(pos, vel, vol, ignore, 0.1, true);
	}

	_update_drops(dt) {
		for (let i = 0; i < this._drops.length;) {
			const d = this._drops[i];
			d.age += dt;
			d.ignore_t -= dt;
			// drag: small droplets slow down much faster (mist hangs, beads fly)
			const radius = 0.0062 * Math.cbrt(d.vol);
			const drag = 0.0025 / Math.max(radius, 0.0008);
			d.vel.y -= B_GRAVITY * dt;
			d.vel.multiplyScalar(Math.max(1 - drag * d.vel.length() * dt * 0.1, 0.5));
			const to = d.pos.clone().addScaledVector(d.vel, dt);
			// its first step: born inside something, it lands on that thing's surface instead
			if (d.age <= dt * 1.5) {
				const land = this._inside_surface(d);
				if (land) { this._drop_land(d, land); this._drops.splice(i, 1); continue; }
			}
			const hit = this.ray(d.pos, to, 'all', d.ignore_t > 0 ? d.ignore : null);
			if (hit) { this._drop_land(d, hit); this._drops.splice(i, 1); continue; }
			d.pos = to;
			if (d.age > 6 || d.pos.y < this.ground - 30) { this._drops.splice(i, 1); continue; }
			i++;
		}
	}

	// if the drop starts inside level geometry or a prop: the surface it is under (straight up out of it)
	_inside_surface(d) {
		const inside = castRay(this.rt, d.pos, gv(0, 0.001, 0), this.f_world_props);
		if (!inside || inside.fraction > 0) return null;
		let out = this.ray(d.pos.clone().add(gv(0, 0.12, 0)), d.pos.clone().add(gv(0, -0.02, 0)), 'world_props');
		if (!out) { const e = this.entry_of.get(inside.id); out = {position: d.pos.clone(), normal: gv(0, 1, 0), collider: e && e.desc.settings.type == 'dynamic' ? {entry: e} : null}; }
		return out;
	}

	_drop_land(d, hit) {
		const col = hit.collider, p = hit.position, n = hit.normal;
		const speed = d.vel.length();
		if (col && col.part) {
			const {bot, part} = col;
			const w = clamp(0.014 + 0.03 * Math.sqrt(d.vol), 0.014, 0.08);
			this._body_stamp(bot, part, p, n, d.vel, w, w, w < 0.035 ? 'drop' : 'splat', brandi(B_SPARE));
			this._add_soak(part, d.vol * 0.5);
			if (d.vol > 0.25) this._start_body_run(bot, part, p, d.vol * 0.5);
			return;
		}
		const on_world = !col;   // (Godot: parent == self)
		if (n.y > 0.8 && on_world) {
			const pool = this._pool_at(p, 1.0);
			if (pool) { this._feed_pool(pool, d.vol); return; }   // landing in an existing pool just feeds it
			if ((d.drip && d.vol > 0.15) || d.vol > 2.5) { this._add_pool(p, n, d.vol); return; }   // drips collect where they fall
		}
		const vn = Math.abs(d.vel.dot(n));
		const vt = d.vel.clone().addScaledVector(n, -d.vel.dot(n));
		let size = 0.012 + 0.05 * Math.sqrt(d.vol);
		size *= 1 + clamp(speed - 2, 0, 10) * 0.07;
		const elong = 1 + clamp(vt.length() / Math.max(vn, 0.6), 0, 3) * 0.55;
		const kind = size < 0.035 || speed < 3 ? 'drop' : 'splat';
		this._world_stamp(col, p, n, vt.length() > 0.2 ? vt : anyTangent(n), size, size * elong, kind, brandi(B_SPARE));
		if (!on_world) return;
		if (n.y < -0.6) { if (d.vol > 0.3) { this._start_run(p, n, d.vol * 0.6); return; } }
		else if (n.y <= 0.8 && d.vol > 0.2) { this._start_run(p, n, d.vol * 0.75); return; }
		if (n.y > 0.8) return;
		// small drops close together on a wall (or a ceiling) run into one another: once a patch of it holds enough it
		// runs down (from a ceiling it drips) - a spray of fine drops does not just stay as dots
		const key = Math.floor(p.x / 0.05) + ',' + Math.floor(p.y / 0.05) + ',' + Math.floor(p.z / 0.05);
		const wet = this._wet || (this._wet = new Map());
		const was = wet.get(key), v = (was && this._time - was.t < 20 ? was.v : 0) + d.vol;
		if (v > (n.y < -0.6 ? 0.4 : 0.28)) { wet.delete(key); this._start_run(p, n, v * 0.8); }
		else wet.set(key, {v, t: this._time});
	}

	// --- Runs on world surfaces ---

	_start_run(pos, n, vol) {
		if (this._runs.length >= (this.high ? B_MAX_RUNS * 6 : B_MAX_RUNS)) return;
		const g = gv(0, -1, 0).addScaledVector(n, -n.dot(gv(0, -1, 0)));
		const dir = g.length() > 0.01 ? g.normalize() : anyTangent(n);
		this._runs.push({pos: pos.clone(), n: n.clone(), dir, vol, width: clamp(0.006 + 0.006 * Math.sqrt(vol), 0.006, 0.022), age: 0, hang: -1, wobble: brange(3, 9), v: 0, s_dir: dir.clone()});
	}

	_update_runs(dt) {
		for (let i = 0; i < this._runs.length;) {
			if (this._step_run(this._runs[i], dt)) i++;
			else {
				const r = this._runs[i];
				// the drop at the end of the run: a small bead where it stopped
				this._world_stamp(null, r.pos, r.n, r.dir, r.width * 1.5, r.width * 1.9, 'drop', 1);
				this._runs.splice(i, 1);
			}
		}
	}

	_step_run(r, dt) {
		r.age += dt;
		if (r.n.y < -0.6) {
			// under a ceiling or overhang: gather into a hanging drop, then fall
			if (r.hang < 0) r.hang = brange(0.5, 3);
			r.hang -= dt;
			if (r.hang <= 0) { this.spawn_drop(r.pos.clone().addScaledVector(r.n, 0.006), gv(), r.vol, null, 0, true); return false; }
			return true;
		}
		let g = gv(0, -1, 0).addScaledVector(r.n, -r.n.dot(gv(0, -1, 0)));
		const slope = g.length();
		if (r.vol < 0.06) return false;
		// film flow: the steeper, the faster; stick-slip makes it creep and surge
		const surge = 0.35 + 0.65 * Math.pow(Math.sin(r.age * r.wobble) * 0.5 + 0.5, 2);
		const target = (0.01 + 0.34 * Math.pow(slope, 1.5) * clamp(r.vol / 1.5, 0.15, 2)) * surge;
		r.v = gmove(r.v, target, dt * (target > r.v ? 0.6 : 0.9));
		if (slope < 0.3 && r.v < 0.012) { this._add_pool(r.pos, r.n, r.vol); return false; }
		if (slope > 0.05) {
			g.divideScalar(slope);
			const wander = r.n.clone().cross(g).multiplyScalar(brange(-0.6, 0.6));
			r.dir = r.dir.clone().add(g.clone().add(wander).multiplyScalar(dt * 5 * clamp(slope * 1.5, 0, 1))).normalize();
		} else g = r.dir.clone();
		r.dir = r.dir.clone().addScaledVector(r.n, -r.n.dot(r.dir));
		r.dir = r.dir.length() > 1e-3 ? r.dir.normalize() : g;
		const speed = r.v;
		const step = r.dir.clone().multiplyScalar(speed * dt);
		const lift = r.n.clone().multiplyScalar(0.004);
		// something ahead (an inside corner): continue on that surface
		let hit = this.ray(r.pos.clone().add(lift), r.pos.clone().add(lift).addScaledVector(step, 1.5), 'world');
		if (hit) { r.pos = hit.position; r.n = hit.normal; return true; }
		// follow the surface below the new position
		const np = r.pos.clone().add(step);
		hit = this.ray(np.clone().addScaledVector(r.n, 0.03), np.clone().addScaledVector(r.n, -0.05), 'world');
		if (!hit) {
			// ran over an edge: a thin, slow film clings and goes on round it; a fast or heavy one falls
			const clings = speed < 0.25 && r.vol < 3 && brand() > speed * 2.5;
			if (clings) {
				const round = this.ray(np.clone().addScaledVector(r.n, -0.012).addScaledVector(r.dir, 0.01), np.clone().addScaledVector(r.n, -0.012).addScaledVector(r.dir, -0.05), 'world');
				if (round && round.normal.dot(r.n) < 0.5) {
					this._world_stamp(null, r.pos, r.n, r.dir, Math.max(r.width, B_RUN_MIN_W), Math.max(r.width, B_RUN_MIN_W) * 1.4, 'drop', 0, 0.45, 0.85);
					const nn2 = round.normal;
					r.pos = round.position;
					const d2 = r.dir.clone().addScaledVector(nn2, -nn2.dot(r.dir));
					const g2 = gv(0, -1, 0).addScaledVector(nn2, -nn2.dot(gv(0, -1, 0)));
					const m = d2.clone().multiplyScalar(0.3).add(g2);
					r.dir = m.length() > 1e-3 ? m.normalize() : r.dir;
					r.n = nn2;
					r.v *= 0.5;
					return true;
				}
			}
			this.spawn_drop(np.clone().addScaledVector(r.dir, 0.004), r.dir.clone().multiplyScalar(speed).addScaledVector(g, 0.1), r.vol, null, 0, true);
			return false;
		}
		r.pos = hit.position;
		r.n = hit.normal;
		r.vol -= step.length() * B_DEPOSIT_WALL * (r.width / 0.012);
		// paint the film where the front has been: dabs every step make one continuous trail (on the ground they go into
		// the floor map; anywhere else each is a decal, so there a dab is only laid every one and a half widths of the run, as long as the way it came)
		const ground = this.isGround(r.pos, r.n);
		if (ground || !r.last_dab || r.last_dab.distanceTo(r.pos) > r.width * 1.5) {
			const len = ground ? step.length() : (r.last_dab ? r.last_dab.distanceTo(r.pos) : step.length());
			this._world_stamp(null, r.pos.clone().addScaledVector(r.dir, -len * 0.5), r.n, r.dir, Math.max(r.width, B_RUN_MIN_W), Math.max(r.width, B_RUN_MIN_W) + len, 'drop', 0, 0.35, 0.8);
			r.last_dab = r.pos.clone();
		}
		return true;
	}

	// --- Pools ---

	_pool_radius(vol) { return clamp(Math.sqrt(vol * 1e-6 / (Math.PI * B_FILM)), 0.015, 0.8); }

	// the pool this point is in or just beside (within its current size)
	_pool_near(p) {
		let best = null, best_d = Infinity;
		for (const q of this._pools) {
			const d = Math.hypot(q.pos.x - p.x, q.pos.z - p.z);
			if (Math.abs(q.pos.y - p.y) < 0.1 && d < Math.max(q.shown, q.r) * 1.05 + 0.06 && d < best_d) { best = q; best_d = d; }
		}
		return best;
	}

	_pool_at(p, reach) {
		for (const pool of this._pools) if (Math.abs(pool.pos.y - p.y) < 0.06 && Math.hypot(pool.pos.x - p.x, pool.pos.z - p.z) < pool.r * reach + 0.04) return pool;
		return null;
	}

	_add_pool(p, n, vol) {
		// joins a pool only if it lands in (or right at the edge of) it; blood dripping somewhere else starts its own pool
		let pool = this._pool_near(p);
		if (pool) {
			if (pool.r >= 0.79) {
				// full: the overflow spreads out at the edge as a new lobe
				let out = gv(p.x - pool.pos.x, 0, p.z - pool.pos.z);
				if (out.length() < 0.01) out = gv(brange(-1, 1), 0, brange(-1, 1));
				const at = pool.pos.clone().addScaledVector(out.normalize(), pool.r * 0.85);
				const hit = this.ray(at.clone().add(gv(0, 0.2, 0)), at.clone().add(gv(0, -0.3, 0)), 'world');
				if (!hit || hit.normal.y < 0.8) return;
				p = hit.position; n = hit.normal;
				pool = this._pool_at(p, 0.6);
				if (!pool || pool.r >= 0.79) { this._new_pool(p, n, vol); return; }
			}
			this._feed_pool(pool, vol);
			return;
		}
		this._new_pool(p, n, vol);
	}

	// adds volume; once the pool reaches an edge (a step nose, a kerb) the rest spills over it
	_feed_pool(pool, vol) {
		pool.vol += vol;
		pool.birth = this._time;
		const cap_vol = Math.PI * pool.cap * pool.cap * B_FILM * 1e6;
		if (pool.vol > cap_vol) {
			pool.spill += pool.vol - cap_vol;
			pool.vol = cap_vol;
			if (pool.spill > 0.8) { this._spill(pool, pool.spill); pool.spill = 0; }
		}
		pool.r = this._pool_radius(pool.vol);
	}

	_spill(pool, vol) {
		const d = rotAround(pool.edge_dir, gv(0, 1, 0), brange(-0.35, 0.35));
		const lip = pool.pos.clone().addScaledVector(d, pool.cap);
		// find the face below the lip (the riser) and run down it
		const hit = this.ray(lip.clone().addScaledVector(d, 0.05).add(gv(0, -0.03, 0)), lip.clone().addScaledVector(d, -0.06).add(gv(0, -0.03, 0)), 'world');
		if (hit && Math.abs(hit.normal.y) < 0.5) {
			this._world_stamp(null, lip.clone().add(gv(0, -0.005, 0)), gv(0, 1, 0), d, 0.04, 0.06, 'drop', 0);
			this._start_run(hit.position, hit.normal, vol);
		} else this.spawn_drop(lip.clone().addScaledVector(d, 0.01), d.clone().multiplyScalar(0.15), vol, null, 0, true);
	}

	// distance to the nearest drop-off around p (up to 0.8 m) and its direction
	_find_edge(p) {
		let best = 0.8, best_dir = gv(0, 0, -1);
		for (let i = 0; i < 8; i++) {
			const d = rotAround(gv(0, 0, -1), gv(0, 1, 0), i * Math.PI * 2 / 8);
			for (let rad = 0.04; rad < best; rad += 0.04) {
				const h = this._surface_height(p.clone().addScaledVector(d, rad), p.y);
				if (h > p.y + 0.035) break;   // wall or step up
				if (h < p.y - 0.035 && this._surface_height(p.clone().addScaledVector(d, rad + 0.06), p.y) < p.y - 0.035) { best = rad; best_dir = d; break; }
			}
		}
		return [best, best_dir];
	}

	_surface_height(at, y) {
		const hit = this.ray(gv(at.x, y + 0.45, at.z), gv(at.x, y - 0.25, at.z), 'world');
		if (!hit) return -Infinity;
		if (hit.normal.y < 0.8) return Infinity;
		return hit.position.y;
	}

	_new_pool(p, n, vol) {
		let pool;
		if (this._pools.length >= (this.high ? B_MAX_POOLS * 4 : B_MAX_POOLS)) {
			// out of pools: feed the nearest one if it is close, otherwise reuse the smallest (never wipe out a big pool)
			let nearest = null, smallest = this._pools[0];
			for (const q of this._pools) {
				if (!nearest || q.pos.distanceTo(p) < nearest.pos.distanceTo(p)) nearest = q;
				if (q.vol < smallest.vol) smallest = q;
			}
			if (nearest.pos.distanceTo(p) < Math.max(nearest.r, 0.05)) { this._feed_pool(nearest, vol); return; }
			pool = smallest;
			pool.recycled = (pool.recycled || 0) + 1;
		} else { pool = {}; this._pools.push(pool); }
		pool.pos = p.clone(); pool.n = n.clone();
		const edge = this._find_edge(p);
		pool.cap = Math.max(edge[0] * 1.1, 0.02);
		pool.edge_dir = edge[1];
		pool.spill = 0; pool.vol = 0; pool.r = 0;
		this._feed_pool(pool, vol);
		pool.shown = pool.r * 0.15;
		pool.birth = this._time;
		pool.along = anyTangent(n);
		pool.variant = brandi(B_SPARE);
		pool.on_ground = this.isGround(p, n);
		// blood does not grow as one circle: a few tongues creep out at their own pace (faster downhill)
		const g = gv(0, -1, 0).addScaledVector(n, -n.dot(gv(0, -1, 0)));
		pool.downhill = g.length() > 1e-4 ? g.clone().normalize().multiplyScalar(clamp((g.length() - 0.04) * 8, 0, 1)) : gv();
		pool.lobes = [];
		const count = 5 + brandi(4), t = pool.along, b = n.clone().cross(t);
		for (let i = 0; i < count; i++) {
			const a = (i + brange(-0.35, 0.35)) / count * Math.PI * 2;
			const dir = t.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a)).normalize();
			const sp = brange(0.55, 1.25) * (1 + 1.4 * Math.max(dir.dot(pool.downhill), 0));
			pool.lobes.push([dir, 0.1, sp, brand() * Math.PI * 2]);
		}
		if (this.view) this.view.poolStarted(pool);
	}

	_update_pools(delta) {
		for (const pool of this._pools) {
			// nothing more coming into it: it stays the size it has spread to
			if (this._time - pool.birth > 1.5 && pool.shown < pool.r) {
				pool.r = Math.max(pool.shown, 0.015);
				pool.vol = Math.PI * pool.r * pool.r * B_FILM * 1e6;
			}
			const growing = pool.shown < pool.r;
			// spreads out over several seconds, creeping at the end (thick blood slows down as the film thins)
			if (growing) pool.shown = Math.min(pool.r, pool.shown + (pool.r - pool.shown) * delta * 0.4 + delta * 0.002);
			// repaint while it spreads or is being fed (keeps it wet); it dries from the last time it was painted
			if (growing || this._time - pool.birth < 0.3) {
				const s = pool.shown * 2.7;
				this._dab(pool, pool.pos, pool.n, pool.along, s, s, 'pool', pool.variant, 1, 1);
				this._splat_grid.add(cellKey(pool.pos));
				this._grow_lobes(pool, delta);
			}
		}
	}

	// moves the tongues of a spreading pool outwards and paints them: soft round dabs along each tongue
	_grow_lobes(pool, delta) {
		const r = Math.max(pool.shown, 0.02);
		for (const lb of pool.lobes) {
			lb[3] += delta * 0.7;
			const dir = rotAround(lb[0], pool.n, Math.sin(lb[3]) * delta * 0.25).normalize();   // tongues wander a little sideways
			lb[0] = dir;
			const down = Math.max(dir.dot(pool.downhill), 0);
			const max_reach = 0.7 + 0.25 * lb[2] + 0.6 * down;
			lb[1] = Math.min(lb[1] + delta * 0.3 * lb[2] * (1 - lb[1] / max_reach), max_reach);
			const reach = lb[1] * r;
			const size = r * (0.85 - 0.2 * lb[1] / max_reach);
			const tip = pool.pos.clone().addScaledVector(dir, reach * 0.55);
			this._dab(pool, tip, pool.n, dir, size, size * (1 + down * 0.35), 'pool', (pool.variant + 1) % B_SPARE, 0.8, 1);
		}
	}

	// --- Bodies ---

	// the collision shape's frame of a part (centre of the part, its rotation and the shape's)
	shapeXf(bot, part) {
		const p = bot.pos(part), q = bot.quat(part).multiply(part.shape.rot);
		return {p, q, toLocal: w => w.clone().sub(p).applyQuaternion(q.clone().invert()), toWorld: l => l.clone().applyQuaternion(q).add(p)};
	}

	_exit_point(bot, part, point, dir) {
		const hit = this.ray(point.clone().addScaledVector(dir, 0.5), point.clone().addScaledVector(dir, 0.005), 'bots', null, part.id.GetIndexAndSequenceNumber());
		return hit ? hit.position : null;
	}

	_add_soak(part, ml) { this._soak.set(part, Math.min((this._soak.get(part) || 0) + ml, 40)); }

	_start_body_run(bot, part, world_p, vol) {
		if (this._body_runs.length >= (this.high ? B_MAX_BODY_RUNS * 4 : B_MAX_BODY_RUNS)) {
			// too much going on: send it straight down instead
			this._drip(world_p.clone().add(gv(0, -0.02, 0)), bot.lin(part), vol, bot);
			return null;
		}
		const sx = this.shapeXf(bot, part);
		const p = shapeProject(part.shape, sx.toLocal(world_p))[0];
		const br = {bot, part, p, dir: gv(), vol, width: clamp(0.018 + 0.01 * Math.sqrt(vol), 0.018, 0.05), age: 0, push: gv(), last_paint: null, push_k: 0};
		this._body_runs.push(br);
		return br;
	}

	_update_body_runs(dt) {
		for (let i = 0; i < this._body_runs.length;) {
			if (this._step_body_run(this._body_runs[i], dt)) i++;
			else this._body_runs.splice(i, 1);
		}
	}

	_step_body_run(br, dt) {
		br.age += dt;
		if (br.age > 25) return false;
		const xf = this.shapeXf(br.bot, br.part);
		const [surf, n] = shapeProject(br.part.shape, br.p);
		const n_w = n.clone().applyQuaternion(xf.q).normalize();
		const pos_w = xf.toWorld(surf);
		if (n_w.y < -0.55) {
			// lowest point of this part: flow onto the part below, or drip off
			const hit = this.ray(pos_w.clone().addScaledVector(n_w, 0.004), pos_w.clone().add(gv(0, -0.07, 0)), 'all', null);
			if (hit && hit.collider && hit.collider.part && hit.collider.bot == br.bot && hit.collider.part != br.part) {
				br.part = hit.collider.part;
				const nxf = this.shapeXf(br.bot, br.part);
				br.p = shapeProject(br.part.shape, nxf.toLocal(hit.position))[0];
				return true;
			}
			this._drip(pos_w.clone().add(gv(0, -0.008, 0)), br.bot.lin(br.part), br.vol, br.bot);
			return false;
		}
		const g_s = gv(0, -1, 0).applyQuaternion(xf.q.clone().invert());
		let g_t = g_s.clone().addScaledVector(n, -n.dot(g_s));
		let slope = g_t.length();
		br.push_k = Math.max(br.push_k - dt * 0.6, 0);
		const p_t = br.push.clone().addScaledVector(n, -n.dot(br.push));
		const pushing = br.push_k > 0.05 && p_t.length() > 0.1;
		if (slope < 0.2 && !pushing) {
			// on top of a lying body: it just soaks in
			br.vol -= dt * 1.5;
			this._add_soak(br.part, dt * 1.5);
			return br.vol > 0;
		}
		g_t = slope > 1e-4 ? g_t.divideScalar(slope) : gv();
		let want = g_t.clone();
		if (pushing) {
			const pk = clamp(br.push_k, 0, 0.9);
			want = g_t.clone().multiplyScalar(slope * (1 - pk)).addScaledVector(p_t.clone().normalize(), pk).normalize();
			slope = Math.max(slope, br.push_k * 0.8);
		}
		const speed = 0.02 + 0.1 * slope * clamp(br.vol / 2, 0.2, 2) + br.push_k * 0.12;
		br.dir = br.dir.clone().multiplyScalar(0.7).addScaledVector(want, 0.3).addScaledVector(n.clone().cross(want), brange(-0.08, 0.08)).normalize();
		br.p = surf.clone().addScaledVector(br.dir, speed * dt);
		const used = speed * dt * B_DEPOSIT_CLOTH * (br.width / 0.012);
		br.vol -= used;
		this._add_soak(br.part, used);
		if (br.vol < 0.05) return false;
		// painted into the body's own blood as it goes (a dab each centimetre), kept in part space
		const here = br.bot.toLocal(br.part, pos_w);
		const from = br.last_paint || here;
		const gap = from.distanceTo(here);
		if (!br.last_paint || gap > 0.008) {
			const amount = clamp(0.4 + br.vol * 0.12, 0.4, 0.9);
			const steps = clamp(Math.floor(gap / 0.008), 1, 12);
			for (let k = 0; k < steps; k++) br.bot.paint_blood(br.part, br.bot.toWorld(br.part, from.clone().lerp(here, (k + 1) / steps)), br.width * 0.5, amount);
			br.last_paint = here;
		}
		return true;
	}

	_update_bleeding(dt) {
		for (let i = 0; i < this._bleeders.length;) {
			const bot = this._bleeders[i];
			const wounds = this._wounds.get(bot) || [];
			let rate = bot.bleed_rate;
			if (!bot.alive) {
				if (!this._dead_since.has(bot)) this._dead_since.set(bot, this._time);
				// the heart has stopped: what is left drains out by gravity, and only from the body and head
				const core = wounds.some(w => ['torso', 'neck', 'head'].includes(w.kind));
				rate = (core ? Math.max(rate, 14) : rate) * Math.exp(-(this._time - this._dead_since.get(bot)) / (core ? 20 : 6));
			}
			if (rate < 0.3 || !wounds.length) { this._bleeders.splice(i, 1); continue; }
			const total_w = wounds.reduce((s, w) => s + w.w, 0);
			for (const w of wounds) {
				const part = w.part;
				let ext = w.arterial ? B_EXTERNAL_ARTERIAL : B_EXTERNAL;
				if (w.kind == 'head' || w.kind == 'neck') ext = 1.0;
				let r = rate * w.w / total_w * ext;
				const gush = w.gush || 0;
				if (gush > 0) {
					// pours out over the first several seconds, tapering off
					const g = Math.min(gush, dt * (8 + gush * 0.35));
					w.gush = gush - g;
					r += g / dt;
				}
				const xf = this.shapeXf(bot, part);
				const [sp, sn] = shapeProject(part.shape, w.p);
				const pos_w = xf.toWorld(sp), n_w = sn.clone().applyQuaternion(xf.q).normalize();
				if (w.arterial && bot.alive) {
					// arterial: spurts with every heartbeat
					const was = w.pulse;
					w.pulse = was + dt * 1.7;
					if (Math.floor(w.pulse) != Math.floor(was)) this._spray(pos_w.clone().addScaledVector(n_w, 0.01), n_w.clone().add(gv(0, 0.25, 0)).normalize(), 10, 1.2, 3.2, 6, r / 1.7 * 0.7, bot);
					r *= 0.3;
				}
				if ((w.kind == 'head' || w.kind == 'neck') && (!bot.alive || (w.gush || 0) > 0)) {
					// pours straight off the head onto the ground below it
					w.pour = (w.pour || 0) + r * dt;
					if (w.pour >= 1.5) {
						const low = bot.pos(part).add(gv(brange(-0.03, 0.03), -0.1, brange(-0.03, 0.03)));
						this._drip(low, bot.lin(part), w.pour, bot);
						w.pour = 0;
					}
					continue;
				}
				w.acc += r * dt;
				const threshold = clamp(r * 0.3, 0.4, 3);
				if (w.acc >= threshold) {
					// one stream per wound: while it is still running, keep feeding it
					const run = w.run;
					if (run && run.vol > 0 && this._body_runs.includes(run)) run.vol += w.acc;
					else w.run = this._start_body_run(bot, part, pos_w, w.acc);
					w.acc = 0;
				}
			}
			i++;
		}
	}

	// bodies that move while bloody (or lie in blood) smear it on the ground; bloody feet leave prints
	_update_smears() {
		for (const bot of this.people) {
			const lying = bot.fallen || !bot.alive;
			for (const part of bot.parts) {
				const is_foot = part.name.startsWith('foot');
				if (!lying && !is_foot) continue;
				let soak = this._soak.get(part) || 0;
				const pp = bot.pos(part);
				const pool = this._pool_at(pp, 1.0);
				const in_blood = !!pool || this._splat_grid.has(cellKey(pp.clone().add(gv(0, -0.08, 0))));
				if (soak < 0.2 && !in_blood) continue;
				const radius = part.shape.kind == 'capsule' ? part.shape.radius : 0.05;
				const hit = this.ray(pp, pp.clone().add(gv(0, -(radius + 0.1), 0)), 'world');
				if (!hit || hit.normal.y < 0.6) continue;
				if (in_blood) {
					this._add_soak(part, pool ? 3.0 : 0.8);
					soak = this._soak.get(part);
					const last = this._soak_stamp.has(part) ? this._soak_stamp.get(part) : -10;
					if (lying && this._time - last > 1.2) {
						this._soak_stamp.set(part, this._time);
						const under = pp.clone().add(gv(0, -radius * 0.9, 0));
						this._body_stamp(bot, part, under, gv(0, -1, 0), anyTangent(gv(0, 1, 0)), radius * 1.8, radius * 2.4, 'smear', brandi(B_SPARE));
					}
				}
				if (is_foot && !lying) { this._bot_footprint(bot, part, hit.position, hit.normal, soak); continue; }
				const v = bot.lin(part);
				v.y = 0;
				const sp = v.length();
				if (sp < 0.15) continue;
				// drag mark: one continuous brush stroke from where the part was to where it is now
				const w = radius * 1.8, here = hit.position;
				let prev = this._feet.get('drag' + part.name + bot.root.uuid);
				if (!prev || prev.distanceTo(here) > 0.8) prev = here.clone().addScaledVector(v, -0.05 / sp);
				this._feet.set('drag' + part.name + bot.root.uuid, here.clone());
				const seg = here.clone().sub(prev), seg_len = seg.length();
				if (seg_len < 0.005) continue;
				// a thin film: it wipes on streaky and see-through, heavier where the clothes are soaked
				const alpha = clamp(soak / 14, 0.06, 0.22);
				const dabs = Math.floor(seg_len / (w * 0.5)) + 1;
				for (let s = 0; s < dabs; s++) {
					const q = prev.clone().lerp(here, (s + 1) / dabs);
					this._world_stamp(null, q, hit.normal, seg.clone().divideScalar(seg_len), w, w * 1.3, 'brush', brandi(B_SPARE), clamp(soak / 600, 0.004, 0.025), alpha);
				}
				this._soak.set(part, soak - Math.min(0.08 * dabs, soak));
			}
		}
	}

	_bot_footprint(bot, foot, ground, n, soak) {
		if (soak < 0.3 || bot.lin(foot).length() > 0.5) return;
		const key = 'foot' + foot.name + bot.root.uuid;
		const last = this._feet.get(key);
		if (last && last.distanceTo(ground) < 0.3) return;
		this._feet.set(key, ground.clone());
		const fwd = gv(0, 0, -1).applyQuaternion(bot.quat(foot));
		this._world_stamp(null, ground, n, fwd, 0.1, 0.27, 'print', foot.name == 'foot_l' ? 1 : 0, 0.5, clamp(soak / 4, 0.3, 1));
		this._soak.set(foot, soak - Math.min(0.7, soak));
	}

	// --- Stamps: on the ground (painted into the floor map), on other things (decals), on people (their own blood) ---

	isGround(p, n) { return n.y > 0.55 && Math.abs(p.y - this.ground) < 0.03; }

	_dab(pool, p, n, along, w, l, kind, variant, thick, alpha) {
		if (this.view) this.view.dab(p, n, along, w, l, kind, variant, thick, alpha, pool);
		this._wrap_edges(p, n, along, w, l, kind, variant, thick, alpha, pool);
	}

	// the solid things of the level (static boxes, pixels), found once
	_level_boxes() {
		if (this._boxes) return this._boxes;
		const skip = new Set((this.rt.world.entries || []).filter(e => e.desc.settings.type != 'static'));
		return (this._boxes = this.rt.colliders ? this.rt.colliders(skip) : []);
	}

	// Blood does not stop at the edge of what it landed on: what goes past the edge of a face goes on over it onto the
	// face next to it. Off the top of a table it goes over the edge and down the side (a pool that spills over it runs
	// down); a splash on a corner wraps round it; on a wall it goes round onto the next wall or under onto the ceiling
	_wrap_edges(p, n, along, w, l, kind, variant, thick, alpha, pool) {
		if (this._wrapping || !this.rt || !this.rt.colliders) return;
		const boxes = this._level_boxes();
		if (!boxes.length) return;
		const P = p.clone().multiplyScalar(SCALE), R = Math.max(w, l) / 2 * SCALE;
		for (const b of boxes) {
			if (P.x < b.min[0] - R || P.x > b.max[0] + R || P.y < b.min[1] - R || P.y > b.max[1] + R || P.z < b.min[2] - R || P.z > b.max[2] + R) continue;
			const A = k => gv(b.axes[k * 3], b.axes[k * 3 + 1], b.axes[k * 3 + 2]);
			const d = P.clone().sub(gv(b.c[0], b.c[1], b.c[2])), loc = [0, 1, 2].map(k => d.dot(A(k)));
			// the face it is on: one side of the box, facing the way the surface does
			let face = -1, fs = 0;
			for (let k = 0; k < 3; k++) {
				const sg = loc[k] < 0 ? -1 : 1;
				if (Math.abs(Math.abs(loc[k]) - b.half[k]) < 0.6 && A(k).multiplyScalar(sg).dot(n) > 0.8) { face = k; fs = sg; break; }
			}
			if (face < 0) continue;
			const top = A(face).multiplyScalar(fs).y > 0.55;
			for (let j = 0; j < 3; j++) {
				if (j == face) continue;
				for (const sj of [-1, 1]) {
					const e = b.half[j] - sj * loc[j];   // how far the edge is (px)
					if (e < 0 || e >= R) continue;
					const over = R - e, chord = 2 * Math.sqrt(Math.max(0, R * R - e * e));
					const n2 = A(j).multiplyScalar(sj), down = A(face).multiplyScalar(-fs);   // the next face, and the way along it from the edge
					const vertical = Math.abs(n2.y) < 0.5;
					if (n2.y < -0.55 && b.min[1] <= this.ground * SCALE + 0.5) continue;   // (under a thing standing on the floor: nobody sees it)
					// over the top edge onto a side, blood runs down it: longer, a streak
					const runs = top && vertical;
					const length = over * (runs ? 1.8 : 1.0);
					const q = P.clone().addScaledVector(A(j), sj * b.half[j] - loc[j]).addScaledVector(down, length * 0.5).addScaledVector(n2, 0.03).divideScalar(SCALE);
					let along2 = runs ? gv(0, -1, 0) : down.clone();
					along2.addScaledVector(n2, -n2.dot(along2));
					along2 = along2.length() > 1e-4 ? along2.normalize() : down;
					this._wrapping = true;
					try { this._world_stamp(null, q, n2, along2, chord * 0.75 / SCALE, length / SCALE, runs ? 'streak' : (kind == 'pool' ? 'splat' : kind), variant, thick * 0.85, alpha); }
					finally { this._wrapping = false; }
					// a pool that spills over the edge of a table: it runs down the side now and then while it is fed
					if (pool && runs && over > R * 0.25 && (!pool._spill_t || this._time - pool._spill_t > 0.6)) {
						pool._spill_t = this._time;
						this._start_run(q, n2, Math.min(2, Math.max(0.3, (pool.vol || 1) * 0.04)));
					}
				}
			}
		}
	}

	// col: null (the level) or {entry} (a moving thing: the stain goes with it)
	_world_stamp(col, p, n, along, w, l, kind, variant, thick = 1.0, alpha = 1.0) {
		// the level goes into the world maps (blood_canvas.gd): the floor and the two wall maps; what they cannot hold
		// (slanted faces, outside the maps) and moving things get a decal
		if (!col && bloodMapFor(n) >= 0) {
			this._splat_grid.add(cellKey(p));
			thick = this._film_add(p, n, along, w, l, thick * alpha);
			if (this.view) this.view.dab(p, n, along, w, l, kind, variant, thick, alpha, null);
			this._wrap_edges(p, n, along, w, l, kind, variant, thick, alpha, null);
			return;
		}
		if (this.view) this.view.decal(col && col.entry, p, n, along, w, l, kind, variant, alpha, this._time);
	}

	// as in life the more blood lies in a place the less of the surface shows through it: a lone small drop is a thin
	// see-through film, drops landing on drops and big splats build it up until it is opaque. Returns the thickness to paint
	_film_add(p, n, along, w, l, amount) {
		const C = 0.03, mi = bloodMapFor(n);
		const key = q => mi + ':' + Math.round(q.x / C) + ',' + Math.round(q.y / C) + ',' + Math.round(q.z / C);
		const had = this._film.get(key(p)) || 0;
		const own = amount * clamp(Math.sqrt(w * l) / 0.07, 0.4, 1) * 0.55;
		const t = clamp(Math.max(had, own) + (had > 0 ? 0.8 * own + 0.2 * amount : 0), 0, 1);
		// the footprint gets at least this much
		const a = along.clone().addScaledVector(n, -n.dot(along)), b = n.clone().cross(a);
		if (a.lengthSq() < 1e-6) { this._film.set(key(p), Math.max(had, t)); return t; }
		a.normalize(); b.normalize();
		const nu = Math.min(Math.ceil(w * 0.4 / C), 8), nv = Math.min(Math.ceil(l * 0.4 / C), 8);
		for (let i = -nu; i <= nu; i++) for (let j = -nv; j <= nv; j++) {
			const k = key(p.clone().addScaledVector(b, i * C).addScaledVector(a, j * C));
			this._film.set(k, Math.max(this._film.get(k) || 0, t * (i || j ? 0.85 : 1)));
		}
		return t;
	}

	_body_stamp(bot, part, p, n, along, w, l, kind, variant) {
		const amount = ({wound: 0.9, splat: 0.75, streak: 0.6, drop: 0.5, smear: 0.45})[kind] || 0.6;
		if (kind == 'streak' || l > w * 1.4) {
			// long: a line of dabs along it
			let a = along.clone().addScaledVector(n, -n.dot(along));
			a = a.length() > 1e-3 ? a.normalize() : gv(0, -1, 0);
			const steps = Math.max(Math.floor(l / 0.02), 2);
			for (let k = 0; k < steps; k++) bot.paint_blood(part, p.clone().addScaledVector(a, (k / (steps - 1) - 0.5) * l), w * 0.5, amount);
		} else bot.paint_blood(part, p, Math.max(w, l) * 0.5, amount);
	}

	// what a bullet blows out of the far side of a head: a fan of blood thrown hard enough to reach the wall behind; where
	// it lands it lands in the shape of the burst. It arrives as it would: the far bits a moment after the near ones
	exit_splatter(origin, dir, strength = 1, ignore = null) {
		strength *= 3;   // (a head blown through is a lot, and hard)
		const d = dir.clone().normalize();
		this.splash(origin, d, clamp(0.55 * strength, 0.8, 1.6), 0.45);
		const helper = Math.abs(d.y) < 0.95 ? gv(0, 1, 0) : gv(1, 0, 0);
		const fwd = glook(d, helper);
		const speed = 20;
		this._spray(origin, d, 30, 8, 24, Math.floor(80 * strength), 65 * strength, ignore);
		this._spray(origin, d, 55, 2, 7, Math.floor(24 * strength), 12 * strength, ignore);
		this._mist_burst(origin, d, clamp(strength * 1.2, 0.3, 1.0));
		// a jet that follows the bullet out: a few more waves of it over a tenth of a second
		for (let k = 0; k < 5; k++) {
			const wave = k + 1;
			this.later(0.022 * wave, () => this._spray(origin.clone().addScaledVector(d, 0.02), d, 16 - wave * 1.6, 5, 17 - wave * 1.5, Math.floor(26 * strength / wave), 16 * strength / wave, ignore));
		}
		this.later(0.05, () => this._mist_burst(origin.clone().addScaledVector(d, 0.45), d, clamp(strength * 0.8, 0.3, 1.0)));
		// the middle of it
		const hit = this.ray(origin, origin.clone().addScaledVector(d, 8), 'world_props');
		if (hit && this.high) {
			// High: the heavy middle is a tight bunch of big drops that fly there, splash and run down
			const n_mid = Math.floor(24 * strength), total = 9 * strength;
			for (let i = 0; i < n_mid; i++) {
				const vol = total * (0.4 + brand() * 1.2) / n_mid;
				this.spawn_drop(origin.clone().add(jitter(0.01)), cone(d, deg(7)).multiplyScalar(speed * brange(0.75, 1.05)), vol, ignore, 0.12);
			}
		} else if (hit) {
			const dist = origin.distanceTo(hit.position);
			const spread = clamp(0.18 + dist * 0.12, 0.2, 0.6) * Math.sqrt(strength) * 0.85;
			this.later(dist / speed, () => this._splash_at(hit, d, spread, strength));
		}
		// the spatter round it: many rays in a cone, each a drop where it hits
		const n_rays = Math.floor(75 * strength);
		for (let i = 0; i < n_rays; i++) {
			const a = brand() * Math.PI * 2, r = Math.pow(brand(), 0.7) * deg(32);
			const rd = gv(Math.cos(a) * Math.sin(r), Math.sin(a) * Math.sin(r), -Math.cos(r)).applyQuaternion(fwd).normalize();
			if (this.high) {
				// High: a real drop along the ray, as big as the stain it would have left
				const w = brange(0.006, 0.02) * (1.3 - r / deg(32) * 0.6);
				this.spawn_drop(origin.clone(), rd.clone().multiplyScalar(speed * brange(0.7, 1.1)), clamp(w * w * 500, 0.003, 0.4), ignore, 0.12);
				continue;
			}
			const h = this.ray(origin, origin.clone().addScaledVector(rd, 9), 'world_props');
			if (!h) continue;
			const dist2 = origin.distanceTo(h.position);
			const w = brange(0.006, 0.02) * (1.3 - r / deg(32) * 0.6) * (1 + 0.5 / Math.max(dist2, 0.5));
			const slant = 1 + clamp(1 - Math.abs(rd.dot(h.normal)), 0, 1) * 3;
			let along = rd.clone().addScaledVector(h.normal, -rd.dot(h.normal));
			along = along.length() > 1e-3 ? along.normalize() : anyTangent(h.normal);
			const kind = w < 0.013 ? 'drop' : 'splat';
			this.later(dist2 / (speed * brange(0.7, 1.1)), () => this._world_stamp(h.collider, h.position.clone().addScaledVector(h.normal, 0.002), h.normal, along, w, w * slant, kind, brandi(B_SPARE), 1, 1));
		}
	}

	// the heavy middle of a burst on the wall: a splash, spikes of it thrown out round it, blood starting to run down
	_splash_at(hit, d, size, strength) {
		const p = hit.position, n = hit.normal, col = hit.collider;
		let t1 = d.clone().addScaledVector(n, -d.dot(n));
		t1 = t1.length() > 1e-3 ? t1.normalize() : anyTangent(n);
		const t2 = n.clone().cross(t1).normalize();
		const lift = n.clone().multiplyScalar(0.002);
		this._world_stamp(col, p.clone().add(lift), n, t1, size * 0.8, size * 0.8, 'splat', brandi(B_SPARE), 1, 1);
		this._world_stamp(col, p.clone().add(lift).addScaledVector(t1, size * 0.15), n, t1, size * 0.5, size * 0.7, 'splat', brandi(B_SPARE), 1, 1);
		for (let k = Math.floor(12 * strength) + 4; k > 0; k--) {
			const a = brand() * Math.PI * 2;
			const dirk = t1.clone().multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)).normalize();
			const bias = 1 + Math.max(dirk.dot(t1), 0) * 1.5;
			const l = brange(0.08, 0.22) * bias * size / 0.3;
			this._world_stamp(col, p.clone().addScaledVector(dirk, size * 0.3 + l * 0.5).add(lift), n, dirk, brange(0.01, 0.025), l, 'streak', brandi(B_SPARE), 0.8, 1);
			this._world_stamp(col, p.clone().addScaledVector(dirk, size * 0.3 + l).add(lift), n, dirk, 0.012, 0.018, 'drop', brandi(B_SPARE), 1, 1);
		}
		if (col) return;
		// it runs down (on a wall; on the floor it just lies)
		if (Math.abs(n.y) < 0.7) for (let k = 5 + brandi(5); k > 0; k--) this._start_run(p.clone().addScaledVector(t2, brange(-size, size) * 0.4).add(gv(0, -size * brange(0, 0.3), 0)), n, brange(1.5, 4.5) * strength);
		else if (n.y > 0.7) this._add_pool(p, n, 25 * strength);
	}

	// (the animated splash sprite of the game is left out: only the drops and the mist show a hit)
	splash() {}
	_mist_burst(pos, dir, strength) { if (this.view) this.view.mist(pos, dir, strength); }
	later(t, fn) { this._timers.push({t: this._time + t, fn}); }

	// --- Main loop: everything at 60 Hz, split across the physics steps (as in the game) ---

	step(delta) {
		this._time += delta;
		for (let i = 0; i < this._timers.length;) { if (this._timers[i].t <= this._time) { const t = this._timers.splice(i, 1)[0]; t.fn(); } else i++; }
		this._tick++;
		const dt = delta * 2;
		if (this._tick % 2 == 0) { this._update_drops(dt); this._since_sim = 0; }
		else {
			this._update_runs(dt);
			this._update_body_runs(dt);
			this._update_bleeding(dt);
			this._update_jets(dt);
			this._update_pools(dt);
		}
		this._since_sim += delta;
		this._smear_t += delta;
		if (this._smear_t > 0.1) { this._smear_t = 0; this._update_smears(); }
		for (const bot of this.people) if (bot.body_blood) bot.body_blood.grow(delta, this._time);
	}

	dispose() {
		const J = this.J;
		try { J.destroy(this.f_world); for (const bot of this.people) if (bot.own_filter) { J.destroy(bot.own_filter); bot.own_filter = null; } } catch (err) { /* gone */ }
	}
}

// nearest surface point and outward normal on a part's collision shape, in shape space
function shapeProject(shape, p) {
	if (shape.kind == 'capsule') {
		const half = shape.height * 0.5 - shape.radius;
		const c = gv(0, clamp(p.y, -half, half), 0);
		const d = p.clone().sub(c);
		const n = d.length() > 1e-5 ? d.normalize() : gv(0, 0, 1);
		return [c.addScaledVector(n, shape.radius), n];
	}
	const e = shape.size.clone().multiplyScalar(0.5).max(gv(0.001, 0.001, 0.001));
	const q = p.clone().clamp(e.clone().negate(), e);
	const rel = [Math.abs(q.x) / e.x, Math.abs(q.y) / e.y, Math.abs(q.z) / e.z];
	let axis = 0;
	if (rel[1] > rel[0] && rel[1] >= rel[2]) axis = 1;
	else if (rel[2] > rel[0] && rel[2] > rel[1]) axis = 2;
	const n = gv();
	const comp = q.getComponent(axis);
	n.setComponent(axis, comp != 0 ? Math.sign(comp) : 1);
	q.setComponent(axis, e.getComponent(axis) * n.getComponent(axis));
	return [q, n];
}

function cone(dir, angle) {
	const d = dir.clone().normalize();
	const helper = Math.abs(d.y) < 0.95 ? gv(0, 1, 0) : gv(1, 0, 0);
	const x = d.clone().cross(helper).normalize(), y = d.clone().cross(x);
	const a = brand() * Math.PI * 2, r = Math.sqrt(brand()) * Math.tan(angle);
	return d.add(x.multiplyScalar(Math.cos(a) * r).addScaledVector(y, Math.sin(a) * r)).normalize();
}
const jitter = r => gv(brange(-r, r), brange(-r, r), brange(-r, r));
function anyTangent(n) {
	const helper = Math.abs(n.dot(gv(0, 0, -1))) < 0.9 ? gv(0, 0, -1) : gv(1, 0, 0);
	return rotAround(n.clone().cross(helper), n, brand() * Math.PI * 2);
}
const cellKey = p => Math.floor(p.x / 0.06) + ',' + Math.floor(p.y / 0.06) + ',' + Math.floor(p.z / 0.06);

// ---------------------------------------------------------------------------
// The blood on one person's body (scripts/fx/body_blood.gd): a small volume (2 cm cells) laid over him as he stands at
// rest, each cell holding how much blood is on him there and when it got there. His clothes and skin show what is there
// at their place in the rest pose, so it moves with him, runs on unbroken from one part onto the next, and only dries.
// ---------------------------------------------------------------------------

class BodyBlood {
	constructor(bot) {
		this.bot = bot;
		const s = bot.scale_factor;
		this.cell = 0.02 * s;
		this.box_min = gv(-0.42, -0.05, -0.32).multiplyScalar(s);
		this.box_size = gv(0.84, 2.0, 0.64).multiplyScalar(s);
		this.dims = [Math.ceil(this.box_size.x / this.cell), Math.ceil(this.box_size.y / this.cell), Math.ceil(this.box_size.z / this.cell)];
		this.data = new Uint8Array(this.dims[0] * this.dims[1] * this.dims[2] * 2);
		this.dirty = false;
		this.version = 0;
		this.blooms = [];   // stains still soaking outwards from a fresh wound
		// (the blood's clock: made at the first wound, it starts at the time of that wound - a recorded stain is put on at
		// the time it was made, not at the start of the animation)
		this.clock = bot.blood && isFinite(bot.blood._time) ? bot.blood._time : 0;
	}

	// where a point of `part` (world) is in the rest pose
	rest_of(part, world_p) { return part.rest_pos.clone().add(this.bot.toLocal(part, world_p)); }

	paint(part, world_p, r, amount) { this.paint_rest(this.rest_of(part, world_p), r, amount); }

	paint_rest(p, r, amount, replay) {
		// (baking with the blood recorded: every dab is written down)
		if (!replay && this.bot.blood_log) this.bot.blood_log.push([this.clock, p.x, p.y, p.z, r, amount]);
		r = Math.max(r, this.cell * 1.2);
		const [dx, dy, dz] = this.dims, c = this.cell, m = this.box_min;
		const lo = [p.x - r - m.x, p.y - r - m.y, p.z - r - m.z].map(v => Math.floor(v / c)), hi = [p.x + r - m.x, p.y + r - m.y, p.z + r - m.z].map(v => Math.ceil(v / c));
		// (the same clock as the shader's blood time)
		const slot = Math.floor(((this.clock % 256) + 256) % 256);
		for (let z = Math.max(lo[2], 0); z < Math.min(hi[2], dz); z++) for (let y = Math.max(lo[1], 0); y < Math.min(hi[1], dy); y++) for (let x = Math.max(lo[0], 0); x < Math.min(hi[0], dx); x++) {
			const cx = m.x + (x + 0.5) * c, cy = m.y + (y + 0.5) * c, cz = m.z + (z + 0.5) * c;
			const d = Math.hypot(cx - p.x, cy - p.y, cz - p.z) / r;
			if (d >= 1) continue;
			const i = ((z * dy + y) * dx + x) * 2;
			const add = Math.floor(amount * (1 - d * d) * 255);
			const now = this.data[i];
			this.data[i] = Math.min(now + add, 255);
			if (add > now / 3) this.data[i + 1] = slot;   // (fresh blood over dried: it is wet again there)
		}
		this.dirty = true;
	}

	// a stain that soaks outwards from a wound over `dur` seconds to `r` across: fast at first, then slower, ragged
	bloom(part, world_p, r, dur, amount) { this.blooms.push({p: this.rest_of(part, world_p), r, t: 0, dur, amount, seed: brand() * 100}); }

	grow(delta, clock) {
		this.clock = clock;
		for (let i = 0; i < this.blooms.length;) {
			const b = this.blooms[i];
			const t0 = b.t;
			b.t = t0 + delta;
			const k = clamp(b.t / b.dur, 0, 1), k0 = clamp(t0 / b.dur, 0, 1);
			// (the front moves as the square root of time: quick, then creeping)
			const r = b.r * Math.sqrt(k), dr = r - b.r * Math.sqrt(k0);
			if (dr > 0.002 || k >= 1) {
				this.paint_rest(b.p, r * 0.6, b.amount * 0.35);
				// the edge soaks on unevenly: a few dabs round it, where the weave takes it up faster
				for (let j = 0; j < 3; j++) {
					const ang = b.seed + j * 2.1 + k * 1.3;
					this.paint_rest(b.p.clone().add(gv(Math.cos(ang), Math.sin(ang * 1.7), Math.sin(ang)).multiplyScalar(r * 0.55)), r * (0.35 + 0.15 * Math.sin(b.seed + j)), b.amount * 0.25);
				}
			}
			if (k >= 1) this.blooms.splice(i, 1); else i++;
		}
	}
}
