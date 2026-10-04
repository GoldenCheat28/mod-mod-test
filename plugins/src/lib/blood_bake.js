// ---------------------------------------------------------------------------
// Blood in a baked animation. While the Physics tab bakes, everything the blood draws is written down with its time:
// the dabs on the floor, the decals, the stains on the people, the mist, and the flying drops at every frame. In the
// Animate tab the blood is drawn again from that at the time of the timeline, so it lands, spreads and dries as the
// animation plays (scrubbing back starts it again from the beginning).
// ---------------------------------------------------------------------------

const blood_bakes = new Map();   // animation uuid -> recording

// takes the place of the view while baking
class BloodRecorder {
	constructor(sim) {
		this.sim = sim;
		const p = sim.people[0];
		this.rec = {
			fps: 24, events: [], frames: [], ground: sim.ground, max_drops: sim.max_drops,
			centre: p ? p.pos(p.pelvis).toArray() : [0, 0, 0],
			people: sim.people.map(bot => ({parts: bot.parts.map(pt => pt.group.uuid), rest_offset: bot.rest_offset.toArray(), scale: bot.scale_factor, paints: []})),
		};
		this.pool_ids = new Map();
		// the stains on the people: every dab of their blood volume
		sim.people.forEach((bot, i) => { bot.blood_log = this.rec.people[i].paints; });
	}
	ev(e) { e.t = this.sim._time; this.rec.events.push(e); }
	poolId(pool) {
		if (!pool) return null;
		if (!this.pool_ids.has(pool)) this.pool_ids.set(pool, this.pool_ids.size);
		return this.pool_ids.get(pool);
	}
	dab(p, n, along, w, l, kind, variant, thick, alpha, pool) {
		this.ev({k: 'dab', p: p.toArray(), n: n.toArray(), a: along.toArray(), w, l, kind, variant, thick, alpha, pool: this.poolId(pool), pool_pos: pool ? pool.pos.toArray() : null, on_ground: pool ? !!pool.on_ground : null});
	}
	decal(entry, p, n, along, w, l, kind, variant, alpha) {
		let body = null;
		if (entry) { const bp = entry.body.GetPosition(), br = entry.body.GetRotation(); body = {g: entry.desc.node.uuid, p: [bp.GetX(), bp.GetY(), bp.GetZ()], q: [br.GetX(), br.GetY(), br.GetZ(), br.GetW()]}; }
		this.ev({k: 'decal', body, p: p.toArray(), n: n.toArray(), a: along.toArray(), w, l, kind, variant, alpha});
	}
	poolStarted(pool) { this.ev({k: 'pool', pool: this.poolId(pool), on_ground: !!pool.on_ground}); }
	mist(pos, dir, strength) { this.ev({k: 'mist', p: pos.toArray(), d: dir.toArray(), s: strength}); }
	splash() {}
	// a frame of the bake: where the drops are
	frame(time) {
		const d = this.sim._drops, a = new Float32Array(d.length * 8);
		d.forEach((x, i) => a.set([x.pos.x, x.pos.y, x.pos.z, x.vel.x, x.vel.y, x.vel.z, x.vol, x.streak], i * 8));
		this.rec.frames.push({t: time, drops: a});
	}
	update() {}
	dispose() { for (const bot of this.sim.people) bot.blood_log = null; }
}

// a body as the player sees it: the pose of its group in the animation (or the recorded pose, while a decal is put on it)
function animatedEntry(uuid) {
	const entry = {pose: null, group: Group.all.find(g => g.uuid == uuid)};
	const world = () => {
		if (entry.pose) return entry.pose;
		const m = entry.group && entry.group.mesh;
		if (!m) return {p: [0, 0, 0], q: [0, 0, 0, 1]};
		m.updateMatrixWorld(true);
		const p = m.getWorldPosition(new THREE.Vector3()).divideScalar(SCALE), q = m.getWorldQuaternion(new THREE.Quaternion());
		return {p: p.toArray(), q: [q.x, q.y, q.z, q.w]};
	};
	entry.body = {
		GetPosition() { const w = world(); return {GetX: () => w.p[0], GetY: () => w.p[1], GetZ: () => w.p[2]}; },
		GetRotation() { const w = world(); return {GetX: () => w.q[0], GetY: () => w.q[1], GetZ: () => w.q[2], GetW: () => w.q[3]}; },
	};
	return entry;
}

// draws a recording at a time of the animation
class BloodPlayer {
	constructor(rec) {
		this.rec = rec;
		this.build();
	}
	build() {
		const rec = this.rec;
		this.next = 0;
		this.paint_next = rec.people.map(() => 0);
		this.time = 0;
		this.pools = new Map();
		this.entries = new Map();
		const centre = new THREE.Vector3(...rec.centre);
		// what the view needs of the simulation and of the people
		this.people = rec.people.map(pp => {
			const bot = {scale_factor: pp.scale, rest_offset: new THREE.Vector3(...pp.rest_offset), pelvis: null, pos: () => centre.clone(),
				parts: pp.parts.map(uuid => ({group: Group.all.find(g => g.uuid == uuid)})).filter(p => p.group)};
			bot.body_blood = new BodyBlood(bot);
			return bot;
		});
		this.sim = {_time: 0, _since_sim: 0, _drops: [], people: this.people, ground: rec.ground, max_drops: rec.max_drops || B_MAX_DROPS};
		this.view = new BloodView(this.sim, null);
	}
	dispose() { if (this.view) this.view.dispose(); this.view = null; }

	show(t) {
		if (t < this.time - 1e-6) { this.dispose(); this.build(); }
		const dt = Math.max(0, t - this.time);
		this.time = t;
		const sim = this.sim, view = this.view;
		// what happened up to now
		const evs = this.rec.events;
		while (this.next < evs.length && evs[this.next].t <= t + 1e-6) {
			const e = evs[this.next++];
			sim._time = e.t;
			const V = a => new THREE.Vector3(...a);
			if (e.k == 'dab') {
				let pool = null;
				if (e.pool !== null) {
					pool = this.pools.get(e.pool);
					if (!pool) { pool = {pos: V(e.pool_pos), on_ground: e.on_ground}; this.pools.set(e.pool, pool); }
				}
				view.dab(V(e.p), V(e.n), V(e.a), e.w, e.l, e.kind, e.variant, e.thick, e.alpha, pool);
			} else if (e.k == 'decal') {
				let entry = null;
				if (e.body) {
					if (!this.entries.has(e.body.g)) this.entries.set(e.body.g, animatedEntry(e.body.g));
					entry = this.entries.get(e.body.g);
					entry.pose = {p: e.body.p, q: e.body.q};
				}
				view.decal(entry, V(e.p), V(e.n), V(e.a), e.w, e.l, e.kind, e.variant, e.alpha, e.t);
				if (entry) entry.pose = null;
			} else if (e.k == 'pool') {
				const pool = this.pools.get(e.pool);
				if (pool) view.poolStarted(pool);
			} else if (e.k == 'mist') view.mist(V(e.p), V(e.d), e.s);
		}
		// the stains on the people
		this.rec.people.forEach((pp, i) => {
			const bb = this.people[i].body_blood;
			while (this.paint_next[i] < pp.paints.length && pp.paints[this.paint_next[i]][0] <= t + 1e-6) {
				const q = pp.paints[this.paint_next[i]++];
				bb.clock = q[0];
				bb.paint_rest(new THREE.Vector3(q[1], q[2], q[3]), q[4], q[5], true);
			}
		});
		// the drops of the nearest frame, carried on to this moment
		const frames = this.rec.frames;
		let f = 0;
		while (f + 1 < frames.length && frames[f + 1].t <= t + 1e-6) f++;
		const fr = frames[f];
		sim._drops = [];
		if (fr) for (let i = 0; i < fr.drops.length; i += 8) {
			const a = fr.drops;
			sim._drops.push({pos: new THREE.Vector3(a[i], a[i + 1], a[i + 2]), vel: new THREE.Vector3(a[i + 3], a[i + 4], a[i + 5]), vol: a[i + 6], streak: a[i + 7]});
		}
		sim._since_sim = fr ? Math.max(0, t - fr.t) : 0;
		sim._time = t;
		view.update(dt);
	}
}

// the Animate tab: the blood of the selected animation at the time of the timeline
let blood_player = null, blood_player_anim = null;
function stopBloodPlayback() { if (blood_player) blood_player.dispose(); blood_player = null; blood_player_anim = null; }
function updateBloodPlayback() {
	try {
		const animation = Project && typeof Modes != 'undefined' && Modes.animate && typeof Animation != 'undefined' && Animation.selected;
		const rec = animation && blood_bakes.get(animation.uuid);
		if (!rec) { stopBloodPlayback(); return; }
		if (blood_player_anim !== animation.uuid) { stopBloodPlayback(); blood_player = new BloodPlayer(rec); blood_player_anim = animation.uuid; }
		blood_player.show(Timeline.time);
	} catch (err) { console.warn('[Ragdoll] blood playback', err); stopBloodPlayback(); }
}
