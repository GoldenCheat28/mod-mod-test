(function () {
'use strict';

/*
 * Ragdoll — a character that falls, is pushed and shot, and reacts: muscles and reactions, without complex AI.
 *
 * Select the group of a character (a group with bone groups inside: pelvis, torso, head, arms, legs...) and press "Build ragdoll".
 * Every bone becomes a physics body, every joint a real joint with limits and a muscle. A muscle is a spring that pulls the bone to
 * its pose: stiff muscles hold the character up, loose muscles let it flop. A hit (a shot) pushes the bone it touches, makes the
 * muscles around it tighten (a flinch), and can start a reaction: a pose you saved, like both hands on the head. A hard hit can
 * switch the muscles off, and the character falls. Everything runs inside the Physics tab (Play, Bake), so the result is baked into
 * a normal animation of the bones.
 *
 * Units: 16 Blockbench pixels = 1 meter. Hit strength is an impulse in N*s (a bullet is about 3-10, a punch 50-150).
 */

const SCALE = 16;
const D2R = Math.PI / 180;

const DEFAULT_RAGDOLL = {enabled: true, total_mass: 70, tone: 0.6, power: 1, flinch: 0.7, radius: 32, pin: 'until_limp', limp: 0, limp_time: 0, friction: 0.5, shot: 40, hits: [], reactions: []};
const DEFAULT_BONE = {joint: 'ball', swing: 50, twist: 30, hinge_axis: 'x', hmin: -120, hmax: 120, strength: 1, zone: 'auto', rest: null};
const DEFAULT_REACTION = {name: 'Reaction', zone: 'any', pose: {}, attack: 0.12, hold: 0.8, release: 0.8, tension: 1};

const ragdollOf = g => Object.assign({}, DEFAULT_RAGDOLL, g.ragdoll || {});
const boneOf = g => Object.assign({}, DEFAULT_BONE, g.bone || {});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => isFinite(parseFloat(v)) ? parseFloat(v) : d;
const eulerOrder = () => (typeof Format != 'undefined' && Format && Format.euler_order) || 'ZYX';
const quatOfDeg = r => new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R, eulerOrder()));

// what a bone is for the reactions: guessed from its name, or set by hand
function zoneOfName(name) {
	const n = String(name).toLowerCase();
	if (/head|neck|skull|face|голов|шея|череп|лиц/.test(n)) return 'head';
	if (/arm|hand|shoulder|elbow|finger|palm|рук|кист|плеч|локт|палец|ладон/.test(n)) return 'arms';
	if (/leg|foot|feet|thigh|shin|calf|knee|toe|ног|стоп|бедр|голен|колен|ступн/.test(n)) return 'legs';
	return 'torso';
}
const zoneOf = g => { const b = boneOf(g); return b.zone && b.zone != 'auto' ? b.zone : zoneOfName(g.name); };
const hingeByName = name => /forearm|lower.?arm|elbow|shin|calf|knee|lower.?leg|предплеч|голен|локт|колен/i.test(String(name));

// ---------------------------------------------------------------------------
// Muscle and reaction timing (pure functions)
// ---------------------------------------------------------------------------

const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// 0..1: up in `attack`, stays for `hold`, down in `release`
function envelope(t, attack, hold, release) {
	if (t < 0) return 0;
	if (t < attack) return smooth(t / Math.max(1e-6, attack));
	if (t < attack + hold) return 1;
	return 1 - smooth((t - attack - hold) / Math.max(1e-6, release));
}

// the flinch: the muscles tighten fast and let go slowly
const flinchEnvelope = t => envelope(t, 0.04, 0.18, 0.9);

// ---------------------------------------------------------------------------
// Runtime: joints and muscles inside the Physics tab's Jolt world
// ---------------------------------------------------------------------------

const perpendicular = a => {
	const ref = Math.abs(a.x) < 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
	return new THREE.Vector3().crossVectors(a, ref).normalize();
};

const bodyQuat = entry => { const r = entry.body.GetRotation(); return new THREE.Quaternion(r.GetX(), r.GetY(), r.GetZ(), r.GetW()); };
const bodyPos = entry => { const p = entry.body.GetPosition(); return new THREE.Vector3(p.GetX() * SCALE, p.GetY() * SCALE, p.GetZ() * SCALE); };

function partCenter(desc) {
	const c = new THREE.Vector3();
	let n = 0;
	for (const part of desc.parts) {
		if (part.kind == 'box') { c.add(part.center); n++; }
		else if (part.points && part.points.length) { const m = new THREE.Vector3(); part.points.forEach(p => m.add(p)); c.add(m.multiplyScalar(1 / part.points.length)); n++; }
	}
	return n ? c.multiplyScalar(1 / n) : c;
}

class RagdollRuntime {
	constructor(rt, root) {
		this.root = root;
		this.s = ragdollOf(root);
		this.J = rt.Jolt;
		this.world = rt.world;
		this.bones = [];
		this.events = [];       // flinches: {t0, center, amount}
		this.reactions = [];    // started reactions: {def, t0}
		this.limp_since = null;
		this.limp_until = Infinity;
		this.pin = null;
		this.pending = [];
		this.hits = (this.s.hits || []).map(h => Object.assign({}, h)).sort((a, b) => a.t - b.t);
		this.next_hit = 0;
		this.time = 0;
		this.log = [];
		this.build();
	}

	build() {
		const {J, world} = this;
		const entryOf = g => world.entries.find(e => e.desc.node === g && !e.broken) || null;
		const visit = (g, parent) => {
			const entry = entryOf(g);
			let bone = null;
			if (entry) {
				bone = {group: g, entry, parent, b: boneOf(g), children: [], tension: 0, constraint: null, kind: 'none', rest_local: null, axis: null, length: 8, load: 0, zone: zoneOf(g)};
				this.bones.push(bone);
				if (parent) parent.children.push(bone);
			}
			for (const child of g.children || []) if (child instanceof Group) visit(child, bone || parent);
		};
		visit(this.root, null);
		// the weight a joint has to carry: the bone and everything below it
		const total = b => { b.load = b.entry.desc.settings.mass + b.children.reduce((s, c) => s + total(c), 0); return b.load; };
		this.bones.filter(b => !b.parent).forEach(total);
		// bones of one character do not collide with their neighbours (they overlap at the joints)
		const ids = new Map(this.bones.map((b, i) => [b, i]));
		const filter = new J.GroupFilterTable(this.bones.length);
		const group_id = Math.floor(Math.random() * 1e6) + 1;
		for (const b of this.bones) {
			if (b.parent) filter.DisableCollision(ids.get(b), ids.get(b.parent));
			b.entry.body.GetCollisionGroup().SetGroupFilter(filter);
			b.entry.body.GetCollisionGroup().SetGroupID(group_id);
			b.entry.body.GetCollisionGroup().SetSubGroupID(ids.get(b));
			b.entry.body.SetAllowSleeping(false);   // a muscle that changes its pose must be able to move a bone that has been still
			// the start speed of a ragdoll is the one set for it (no random "chaos" kick on every bone)
			const v = b.entry.desc.settings.velocity || [0, 0, 0];
			world.tmp.Set(v[0], v[1], v[2]);
			world.bodies.SetLinearVelocity(b.entry.id, world.tmp);
			world.tmp.Set(0, 0, 0);
			world.bodies.SetAngularVelocity(b.entry.id, world.tmp);
		}
		this.filter = filter;
		for (const b of this.bones) if (b.parent) this.joint(b);
		// the hips are held in place until the character is knocked down
		const root_bone = this.bones.find(b => !b.parent);
		if (root_bone && this.s.pin != 'none' && J.FixedConstraintSettings) {
			const st = new J.FixedConstraintSettings();
			st.mSpace = J.EConstraintSpace_WorldSpace;
			st.mAutoDetectPoint = true;
			const fixed = J.JoltInterface.prototype.sGetFixedToWorldBody();
			this.pin = J.castObject(st.Create(fixed, root_bone.entry.body), J.FixedConstraint);
			world.system.AddConstraint(this.pin);
		}
	}

	joint(b) {
		const {J, world} = this, p = b.parent;
		const q1 = p.entry.desc.quat, q2 = b.entry.desc.quat;
		b.rest_local = q1.clone().invert().multiply(q2);
		const pivot = b.entry.desc.pos;
		const rp = new J.RVec3(pivot.x / SCALE, pivot.y / SCALE, pivot.z / SCALE);
		const com = pivot.clone().add(partCenter(b.entry.desc).applyQuaternion(q2));
		let a = com.sub(pivot);
		b.length = Math.max(2, a.length() * 2);   // the bone, joint to far end (px)
		if (a.lengthSq() < 0.25) a = new THREE.Vector3(0, -1, 0);
		a.normalize();
		const v3 = v => new J.Vec3(v.x, v.y, v.z);
		const p1 = perpendicular(a);
		const fixed = b.b.joint == 'fixed';
		let constraint;
		if (b.b.joint == 'hinge') {
			const axis = new THREE.Vector3(...[0, 1, 2].map(i => (b.b.hinge_axis == 'xyz'[i] ? 1 : 0))).applyQuaternion(q2).normalize();
			const normal = perpendicular(axis);
			const st = new J.HingeConstraintSettings();
			st.mSpace = J.EConstraintSpace_WorldSpace;
			st.mPoint1 = rp; st.mPoint2 = rp;
			st.mHingeAxis1 = v3(axis); st.mHingeAxis2 = v3(axis);
			st.mNormalAxis1 = v3(normal); st.mNormalAxis2 = v3(normal);
			st.mLimitsMin = Math.min(b.b.hmin, b.b.hmax) * D2R;
			st.mLimitsMax = Math.max(b.b.hmin, b.b.hmax) * D2R;
			st.mMaxFrictionTorque = 0.2 * b.entry.desc.settings.mass;
			constraint = J.castObject(st.Create(p.entry.body, b.entry.body), J.HingeConstraint);
			b.kind = 'hinge';
			b.axis = axis;
		} else if (fixed) {
			const st = new J.FixedConstraintSettings();
			st.mSpace = J.EConstraintSpace_WorldSpace;
			st.mAutoDetectPoint = true;
			constraint = J.castObject(st.Create(p.entry.body, b.entry.body), J.FixedConstraint);
			b.kind = 'fixed';
		} else {
			const st = new J.SwingTwistConstraintSettings();
			st.mSpace = J.EConstraintSpace_WorldSpace;
			st.mPosition1 = rp; st.mPosition2 = rp;
			st.mTwistAxis1 = v3(a); st.mTwistAxis2 = v3(a);
			st.mPlaneAxis1 = v3(p1); st.mPlaneAxis2 = v3(p1);
			st.mSwingType = J.ESwingType_Cone;
			st.mNormalHalfConeAngle = clamp(b.b.swing, 1, 179) * D2R;
			st.mPlaneHalfConeAngle = clamp(b.b.swing, 1, 179) * D2R;
			st.mTwistMinAngle = -clamp(b.b.twist, 0, 179) * D2R;
			st.mTwistMaxAngle = clamp(b.b.twist, 0, 179) * D2R;
			st.mMaxFrictionTorque = 0.2 * b.entry.desc.settings.mass;
			constraint = J.castObject(st.Create(p.entry.body, b.entry.body), J.SwingTwistConstraint);
			b.kind = 'ball';
		}
		world.system.AddConstraint(constraint);
		b.constraint = constraint;
	}

	// ---- reactions to a hit ----

	reactionFor(zone) {
		const list = (this.s.reactions || []).filter(r => r.zone == 'any' || r.zone == zone);
		if (!list.length) return null;
		const specific = list.filter(r => r.zone == zone);
		const pool = specific.length ? specific : list;
		return pool[this.log.length % pool.length];
	}

	// a hit: {t, bone: uuid, dir: [x,y,z], local: [x,y,z] (point in the bone), impulse}
	applyHit(hit) {
		const b = this.bones.find(x => x.group.uuid == hit.bone) || this.bones[0];
		if (!b) return;
		const {world} = this;
		const dir = new THREE.Vector3(...hit.dir).normalize();
		const impulse = dir.clone().multiplyScalar(hit.impulse);
		const entry = b.entry;
		const M = new THREE.Matrix4().compose(bodyPos(entry), bodyQuat(entry), new THREE.Vector3(1, 1, 1));
		const point = new THREE.Vector3(...(hit.local || [0, 0, 0])).applyMatrix4(M);
		const com = entry.body.GetCenterOfMassPosition();
		const r = point.clone().sub(new THREE.Vector3(com.GetX() * SCALE, com.GetY() * SCALE, com.GetZ() * SCALE)).multiplyScalar(1 / SCALE);
		world.tmp.Set(impulse.x, impulse.y, impulse.z);
		world.bodies.AddImpulse(entry.id, world.tmp);
		const L = new THREE.Vector3().crossVectors(r, impulse);
		world.tmp.Set(L.x, L.y, L.z);
		world.bodies.AddAngularImpulse(entry.id, world.tmp);
		this.events.push({t0: this.time, center: point, amount: this.s.flinch});
		const reaction = this.reactionFor(b.zone);
		if (reaction) this.reactions.push({def: Object.assign({}, DEFAULT_REACTION, reaction), t0: this.time});
		if (this.s.limp > 0 && hit.impulse >= this.s.limp) {
			this.limp_since = this.time;
			this.limp_until = this.s.limp_time > 0 ? this.time + this.s.limp_time : Infinity;
			if (this.pin) { try { this.world.system.RemoveConstraint(this.pin); } catch (err) { console.warn('[Ragdoll]', err); } this.pin = null; }
		}
		this.log.push({t: this.time, bone: b.group.name, impulse: hit.impulse});
	}

	// ---- one step ----

	step(dt) {
		const t = this.time;
		this.pending.splice(0).forEach(h => this.applyHit(h));
		while (this.next_hit < this.hits.length && this.hits[this.next_hit].t <= t + 1e-9) this.applyHit(this.hits[this.next_hit++]);
		this.drive(t);
		this.time += dt;
	}

	// how much the muscles work right now (0 = limp, 1 = as set by the tone)
	limpFactor(t) {
		if (this.limp_since === null) return 1;
		if (t < this.limp_until) return 0;
		return smooth((t - this.limp_until) / 0.8);
	}

	drive(t) {
		const {s} = this;
		const limp = this.limpFactor(t);
		// only the newest reaction counts
		const reaction = this.reactions.length ? this.reactions[this.reactions.length - 1] : null;
		let blend = 0;
		if (reaction) blend = envelope(t - reaction.t0, reaction.def.attack, reaction.def.hold, reaction.def.release);
		if (this.pin && this.limp_since === null && s.pin == 'until_limp') { /* held until a hard hit */ }
		for (const b of this.bones) {
			if (!b.constraint || b.kind == 'fixed') continue;
			// base muscle tone, tightened by flinches near a hit
			let tension = s.tone * b.b.strength;
			const bp = bodyPos(b.entry);
			for (const ev of this.events) {
				const age = t - ev.t0;
				if (age > 3) continue;
				const dist = bp.distanceTo(ev.center);
				const w = s.radius > 0 ? clamp(1 - dist / s.radius, 0, 1) : 1;
				tension += (1 - tension) * clamp(ev.amount * flinchEnvelope(age) * Math.max(w, 0.35 * ev.amount), 0, 1);
			}
			// the pose of a reaction
			let delta = null;
			if (reaction && blend > 0 && reaction.def.pose && reaction.def.pose[b.group.uuid]) {
				const d = reaction.def.pose[b.group.uuid];
				const rest = b.b.rest || b.group.rotation || [0, 0, 0];
				delta = quatOfDeg([rest[0] + d[0], rest[1] + d[1], rest[2] + d[2]]).multiply(quatOfDeg(rest).invert());
				tension = Math.max(tension, reaction.def.tension * blend);
				delta = new THREE.Quaternion().slerp(delta, blend);
			}
			tension = clamp(tension * limp * s.power, 0, 4);
			this.motor(b, tension, delta);
		}
	}

	// The muscle: a spring and a damper that turn the bone toward its pose (rest pose, or the pose of a reaction), as torques on
	// the bone and, the other way, on its parent. tension 0 = limp, 1 = the muscle tone as set.
	motor(b, tension, delta) {
		if (tension <= 0.01) return;
		const {world} = this;
		const p = b.parent.entry, c = b.entry;
		const qp = bodyQuat(p), qc = bodyQuat(c);
		const target = delta ? delta.clone().multiply(b.rest_local) : b.rest_local;
		const err = qp.clone().multiply(target).multiply(qc.clone().invert());
		if (err.w < 0) { err.x = -err.x; err.y = -err.y; err.z = -err.z; err.w = -err.w; }
		const angle = 2 * Math.acos(clamp(err.w, -1, 1)), s = Math.sqrt(Math.max(0, 1 - err.w * err.w));
		const axis = s > 1e-6 ? new THREE.Vector3(err.x / s, err.y / s, err.z / s) : new THREE.Vector3();
		const wc = c.body.GetAngularVelocity(), wp = p.body.GetAngularVelocity();
		const rel = new THREE.Vector3(wc.GetX() - wp.GetX(), wc.GetY() - wp.GetY(), wc.GetZ() - wp.GetZ());
		const f = 1.5 + 5 * Math.min(tension, 1.4), omega = 2 * Math.PI * f;
		const len = Math.max(0.12, b.length / SCALE);
		const inertia = b.load * len * len / 3;
		const torque = axis.multiplyScalar(inertia * omega * omega * angle).addScaledVector(rel, -2 * inertia * omega);
		const limit = 22 * b.load * Math.min(tension, 1.4);
		if (torque.length() > limit) torque.multiplyScalar(limit / torque.length());
		world.tmp.Set(torque.x, torque.y, torque.z);
		world.bodies.AddTorque(c.id, world.tmp, this.J.EActivation_Activate);
		world.tmp.Set(-torque.x, -torque.y, -torque.z);
		world.bodies.AddTorque(p.id, world.tmp, this.J.EActivation_Activate);
	}

	// a shot from outside (the viewport): it is applied in the next step
	shoot(hit) { this.pending.push(Object.assign({t: this.time}, hit)); }
}

// ---------------------------------------------------------------------------
// The hook into the Physics tab
// ---------------------------------------------------------------------------

let runtimes = [];   // {rt, list: [RagdollRuntime]}
let current = null;

const physicsHook = {
	start(rt) {
		this.stop();
		const roots = Group.all.filter(g => g.ragdoll && g.ragdoll.enabled);
		const list = [];
		for (const root of roots) {
			try { list.push(new RagdollRuntime(rt, root)); } catch (err) { console.warn('[Ragdoll]', root.name, err); }
		}
		current = {rt, list};
	},
	step(rt, dt) {
		if (!current || current.rt !== rt) return;
		for (const r of current.list) r.step(dt);
	},
	stop() { current = null; },
};

// ---------------------------------------------------------------------------
// Building a ragdoll from a group
// ---------------------------------------------------------------------------

const isPart = el => el instanceof Cube || el instanceof Mesh;
const directParts = g => (g.children || []).filter(isPart);
const volumeOf = g => directParts(g).reduce((s, el) => s + (el instanceof Cube ? Math.abs((el.to[0] - el.from[0]) * (el.to[1] - el.from[1]) * (el.to[2] - el.from[2])) : 1000), 0);

function bonesOf(root) {
	const out = [];
	const visit = g => { if (directParts(g).length) out.push(g); (g.children || []).forEach(c => { if (c instanceof Group) visit(c); }); };
	visit(root);
	return out;
}

function buildRagdoll(root, total_mass) {
	const bones = bonesOf(root);
	if (bones.length < 2) return {error: 'few'};
	const sum = bones.reduce((s, g) => s + Math.max(volumeOf(g), 1), 0);
	const mass = total_mass || ragdollOf(root).total_mass;
	root.ragdoll = Object.assign(ragdollOf(root), {enabled: true, total_mass: mass});
	for (const g of bones) {
		g.physics = Object.assign({}, g.physics || {}, {type: 'dynamic', mass: Math.max(0.2, Math.round(mass * Math.max(volumeOf(g), 1) / sum * 100) / 100), friction: 0.7, restitution: 0.05, velocity: (g.physics && g.physics.velocity) || [0, 0, 0]});
		const old = g.bone || {};
		g.bone = Object.assign({}, DEFAULT_BONE, old, {joint: old.joint || (hingeByName(g.name) ? 'hinge' : 'ball'), rest: (old.rest || g.rotation || [0, 0, 0]).slice(), hinge_axis: old.hinge_axis || 'x'});
		if (hingeByName(g.name) && !old.joint) { g.bone.hmin = -140; g.bone.hmax = 140; }
	}
	return {bones};
}

function removeRagdoll(root) {
	for (const g of bonesOf(root)) { g.physics = null; g.bone = null; }
	root.ragdoll = null;
}

// ---------------------------------------------------------------------------
// Blockbench side
// ---------------------------------------------------------------------------

const TEXTS = {
	en: {
		mode: 'Ragdoll', build: 'Build ragdoll from the selected group', remove: 'Remove ragdoll', play: '▶ Play', pause: '❚❚ Pause', reset: '⟲ Reset', bake: '⏺ Bake to animation',
		select_hint: 'Select the group of a character (a group with bone groups inside: pelvis, torso, head, arms, legs…) and press Build.',
		character: 'Character', bones: 'bones', mass_total: 'Total mass (kg)', tone: 'Muscle tone', tone_tip: '0 = limp like a rag, 1 = stiff muscles hold the pose',
		power: 'Muscle power', flinch: 'Flinch', flinch_tip: 'How strongly the muscles around a hit tighten', radius: 'Flinch radius (px)',
		pin: 'Hips', pin_none: 'Free (falls at once)', pin_until: 'Held until a hard hit', pin_always: 'Always held',
		shot: 'Shot strength (N·s)', shot_tip: 'The strength of a click shot: a bullet 3–10, a punch 50–150', limp: 'Knock down at impulse', limp_tip: 'A hit this hard (N·s) switches the muscles off and the character falls. 0 = never', limp_time: 'Limp for (s)', limp_time_tip: '0 = until the end',
		bone: 'Selected bone', joint: 'Joint', j_ball: 'Ball (shoulder, hip, neck)', j_hinge: 'Hinge (elbow, knee)', j_fixed: 'Stiff',
		swing: 'Swing (°)', twist: 'Twist (±°)', axis: 'Hinge axis', hmin: 'Hinge from (°)', hmax: 'Hinge to (°)', strength: 'Muscle strength', zone: 'Zone',
		z_auto: 'Automatic', z_head: 'Head', z_torso: 'Torso', z_arms: 'Arms', z_legs: 'Legs', z_any: 'Any',
		hits: 'Hits (shots)', hits_hint: 'While playing, turn Shoot on and click the character in the 3D view: the shot is recorded here. You can also add a hit by hand.',
		shoot: 'Shoot with a click (while playing)', shoot_on: 'Shooting: click the character', add_hit: 'Add hit on the selected bone', clear_hits: 'Clear hits',
		time: 'Time (s)', impulse: 'Strength (N·s)', hit_bone: 'Bone', no_hits: 'No hits yet',
		reactions: 'Reactions', reactions_hint: 'Pose the character (for example both hands on the head), give it a name and press Capture. The pose is saved and the bones go back. After a hit in its zone the character moves into this pose.',
		capture: 'Capture the current pose', r_name: 'Name', r_zone: 'After a hit in', r_hold: 'Holds (s)', r_tension: 'Muscle force', no_reactions: 'No reactions yet', set_rest: 'Use the current pose as the rest pose',
		footnote: 'Play and Bake run in the Physics tab\'s simulation. Set Chaos to 0 in its World settings for a calm start. Impulse: a bullet 3–10 N·s, a punch 50–150 N·s.',
		msg_built: 'Ragdoll built', msg_removed: 'Ragdoll removed', msg_few: 'The group needs at least two bone groups with cubes', msg_select: 'Select the group of the character first',
		msg_hit: 'Hit added', msg_captured: 'Pose captured', msg_no_physics: 'The Physics plugin is needed (physics.js 0.8 or newer)', msg_rest: 'Rest pose set', msg_nobone: 'Select a bone of the ragdoll first',
		hit_on: 'Shoot mode on: press Play and click the character',
	},
	ru: {
		mode: 'Регдолл', build: 'Создать регдолл из выбранной группы', remove: 'Убрать регдолл', play: '▶ Пуск', pause: '❚❚ Пауза', reset: '⟲ Сброс', bake: '⏺ Запечь в анимацию',
		select_hint: 'Выделите группу персонажа (группа с костями-группами внутри: таз, торс, голова, руки, ноги…) и нажмите «Создать».',
		character: 'Персонаж', bones: 'костей', mass_total: 'Общая масса (кг)', tone: 'Тонус мышц', tone_tip: '0 = обмякший как тряпка, 1 = жёсткие мышцы держат позу',
		power: 'Сила мышц', flinch: 'Сокращение', flinch_tip: 'Насколько сильно напрягаются мышцы вокруг попадания', radius: 'Радиус сокращения (px)',
		pin: 'Таз', pin_none: 'Свободный (падает сразу)', pin_until: 'Держится до сильного удара', pin_always: 'Держится всегда',
		shot: 'Сила выстрела (Н·с)', shot_tip: 'Сила выстрела кликом: пуля 3–10, удар кулаком 50–150', limp: 'Сбить с ног при импульсе', limp_tip: 'Такой сильный удар (Н·с) выключает мышцы, и персонаж падает. 0 = никогда', limp_time: 'Обмякает на (с)', limp_time_tip: '0 = до конца',
		bone: 'Выбранная кость', joint: 'Сустав', j_ball: 'Шаровой (плечо, бедро, шея)', j_hinge: 'Шарнир (локоть, колено)', j_fixed: 'Жёсткий',
		swing: 'Отклонение (°)', twist: 'Кручение (±°)', axis: 'Ось шарнира', hmin: 'Шарнир от (°)', hmax: 'Шарнир до (°)', strength: 'Сила мышцы', zone: 'Зона',
		z_auto: 'Автоматически', z_head: 'Голова', z_torso: 'Торс', z_arms: 'Руки', z_legs: 'Ноги', z_any: 'Любая',
		hits: 'Попадания (выстрелы)', hits_hint: 'Во время Пуска включите «Стрелять» и кликайте по персонажу в 3D: выстрел запишется сюда. Можно и добавить попадание вручную.',
		shoot: 'Стрелять кликом (во время Пуска)', shoot_on: 'Стрельба: кликайте по персонажу', add_hit: 'Добавить попадание в выбранную кость', clear_hits: 'Убрать все',
		time: 'Время (с)', impulse: 'Сила (Н·с)', hit_bone: 'Кость', no_hits: 'Попаданий пока нет',
		reactions: 'Реакции', reactions_hint: 'Поставьте персонажа в позу (например, обе руки на голове), дайте имя и нажмите «Запомнить». Поза сохранится, а кости вернутся. После попадания в её зону персонаж примет эту позу.',
		capture: 'Запомнить текущую позу', r_name: 'Название', r_zone: 'После попадания в', r_hold: 'Держит (с)', r_tension: 'Сила мышц', no_reactions: 'Реакций пока нет', set_rest: 'Сделать текущую позу исходной',
		footnote: 'Пуск и Запись идут через симуляцию вкладки «Физика». В её настройках мира поставьте «Хаос» 0 для спокойного старта. Импульс: пуля 3–10 Н·с, удар кулаком 50–150 Н·с.',
		msg_built: 'Регдолл создан', msg_removed: 'Регдолл убран', msg_few: 'В группе нужно минимум две кости-группы с кубами', msg_select: 'Сначала выделите группу персонажа',
		msg_hit: 'Попадание добавлено', msg_captured: 'Поза запомнена', msg_no_physics: 'Нужен плагин Физика (physics.js 0.8 или новее)', msg_rest: 'Исходная поза задана', msg_nobone: 'Сначала выберите кость регдолла',
		hit_on: 'Стрельба включена: нажмите Пуск и кликайте по персонажу',
	},
};
const tr = key => {
	const lang = (typeof Language != 'undefined' && Language.code) || 'en';
	return (TEXTS[lang] && TEXTS[lang][key]) || TEXTS.en[key] || key;
};

// a number you drag with the mouse, or click and type (Shift = fine, Ctrl = coarse)
const NumberField = {
	props: {value: {type: Number, default: 0}, min: {type: Number, default: 0}, max: {type: Number, default: 1}, step: {type: Number, default: 1}, decimals: {type: Number, default: 0}, label: {type: String, default: ''}},
	data() { return {editing: false, text: '', drag: null}; },
	computed: { shown() { return this.editing ? this.text : Number(this.value).toFixed(this.decimals); } },
	methods: {
		snap(v) { const q = Math.round(v / this.step) * this.step; return Math.max(this.min, Math.min(this.max, Number(q.toFixed(6)))); },
		down(e) {
			if (this.editing || (e.button !== undefined && e.button !== 0)) return;
			this.drag = {x: e.clientX, start: this.value, moved: false};
			try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* old browser */ }
		},
		move(e) {
			const d = this.drag;
			if (!d) return;
			const dx = e.clientX - d.x;
			if (!d.moved && Math.abs(dx) < 3) return;
			d.moved = true;
			const speed = (this.max - this.min) / 220 * (e.shiftKey ? 0.1 : e.ctrlKey ? 4 : 1);
			const v = this.snap(d.start + dx * speed);
			if (v !== this.value) this.$emit('input', v);
		},
		up(e) {
			const d = this.drag;
			this.drag = null;
			if (!d) return;
			try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
			if (d.moved) this.$emit('change', this.value);
			else this.startEdit();
		},
		startEdit() {
			this.editing = true;
			this.text = Number(this.value).toFixed(this.decimals);
			this.$nextTick(() => { const i = this.$refs.input; if (i) { i.focus(); i.select(); } });
		},
		finish(commit) {
			if (!this.editing) return;
			this.editing = false;
			if (!commit) return;
			const n = parseFloat(String(this.text).replace(',', '.'));
			if (!isFinite(n)) return;
			const v = Math.max(this.min, Math.min(this.max, n));
			this.$emit('input', v);
			this.$emit('change', v);
		},
	},
	template: `
		<div class="rd_num" :class="{editing: editing}" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" :title="label">
			<span class="rd_num_label">{{ label }}</span>
			<input ref="input" class="rd_num_value" type="text" :value="shown" :readonly="!editing" @input="text = $event.target.value"
				@keydown.enter.prevent="finish(true)" @keydown.esc.prevent="finish(false)" @blur="finish(true)">
		</div>`,
};

let mode = null, panel = null, properties = [], style_node = null;
let shoot_mode = false;
const api = () => (typeof window != 'undefined' && window.PhysicsPlugin) || null;
const simNow = () => { const a = api(); return a && a.sim ? a.sim() : null; };

const selectedRoot = () => {
	if (!Project) return null;
	const g = Group.first_selected;
	if (!g) return null;
	for (let n = g; n && n != 'root'; n = n.parent) if (n.ragdoll && n.ragdoll.enabled) return n;
	return g;
};
const rootOf = g => { for (let n = g; n && n != 'root'; n = n.parent) if (n.ragdoll && n.ragdoll.enabled) return n; return null; };
const edit = (groups, label, fn) => {
	Undo.initEdit({outliner: true, groups});
	fn();
	Undo.finishEdit(label, {outliner: true, groups});
	Project.saved = false;
};

function updatePanel(force) {
	if (!panel || !panel.inside_vue) return;
	const vue = panel.inside_vue, sel = Project ? Group.first_selected : null, root = sel ? rootOf(sel) : null;
	const key = (sel ? sel.uuid : '') + '|' + (root ? JSON.stringify(root.ragdoll) : '') + '|' + (sel && sel.bone ? JSON.stringify(sel.bone) : '');
	if (force || vue.selection_key != key) {
		vue.selection_key = key;
		vue.has_selection = !!sel;
		vue.has_root = !!root;
		vue.sel_name = sel ? sel.name : '';
		if (root) {
			const s = ragdollOf(root);
			Object.assign(vue, {total_mass: s.total_mass, tone: s.tone, power: s.power, flinch: s.flinch, radius: s.radius, pin: s.pin, limp: s.limp, limp_time: s.limp_time, shot: s.shot,
				root_name: root.name, bone_count: bonesOf(root).length, hits: s.hits.map(h => Object.assign({}, h)), reactions: s.reactions.map(r => Object.assign({name: '', zone: 'any', hold: 0.8, tension: 1}, r, {pose_count: Object.keys(r.pose || {}).length}))});
			vue.is_bone = !!(sel && sel.bone && sel.bone.joint);
			if (vue.is_bone) Object.assign(vue, {joint: boneOf(sel).joint, swing: boneOf(sel).swing, twist: boneOf(sel).twist, hinge_axis: boneOf(sel).hinge_axis, hmin: boneOf(sel).hmin,
				hmax: boneOf(sel).hmax, strength: boneOf(sel).strength, zone: boneOf(sel).zone});
		}
	}
	const sim = simNow();
	vue.state = !sim ? 'stopped' : sim.playing ? 'playing' : 'paused';
	vue.shoot = shoot_mode;
	vue.sim_time = sim ? sim.time.toFixed(2) : '0.00';
}

function panelComponent() {
	const num = (label, model, min, max, step, decimals, tip, action) => `<rope-num :label="t('${label}')" v-model="${model}" :min="${min}" :max="${max}" :step="${step}" :decimals="${decimals}" ${tip ? `:title="t('${tip}')"` : ''} @change="${action}"></rope-num>`;
	return {
		components: {'rope-num': NumberField},
		data() {
			return {selection_key: null, has_selection: false, has_root: false, is_bone: false, sel_name: '', root_name: '', bone_count: 0, state: 'stopped', shoot: false, sim_time: '0.00',
				total_mass: 70, tone: 0.6, power: 1, flinch: 0.7, radius: 32, pin: 'until_limp', limp: 0, limp_time: 0, shot: 40,
				joint: 'ball', swing: 50, twist: 30, hinge_axis: 'x', hmin: -120, hmax: 120, strength: 1, zone: 'auto', hits: [], reactions: [], new_name: 'Hands on head', new_zone: 'head'};
		},
		methods: {
			t(key) { return tr(key); },
			zoneLabel(z) { return tr('z_' + z); },
			build() { buildFromSelection(); },
			remove() { removeFromSelection(); },
			saveRoot() {
				const sel = Group.first_selected, root = sel && rootOf(sel);
				if (!root) return;
				edit([root], 'Change ragdoll', () => {
					root.ragdoll = Object.assign(ragdollOf(root), {total_mass: clamp(num_(this.total_mass, 70), 1, 5000), tone: clamp(num_(this.tone, 0.6), 0, 1.5), power: clamp(num_(this.power, 1), 0, 4),
						flinch: clamp(num_(this.flinch, 0.7), 0, 1), radius: clamp(num_(this.radius, 32), 0, 400), pin: this.pin, limp: Math.max(0, num_(this.limp, 0)), limp_time: Math.max(0, num_(this.limp_time, 0)), shot: clamp(num_(this.shot, 40), 1, 2000)});
				});
				updatePanel(true);
			},
			saveMass() {
				const sel = Group.first_selected, root = sel && rootOf(sel);
				if (!root) return;
				edit(bonesOf(root).concat([root]), 'Ragdoll mass', () => buildRagdoll(root, clamp(num_(this.total_mass, 70), 1, 5000)));
				updatePanel(true);
			},
			saveBone() {
				const sel = Group.first_selected;
				if (!sel || !sel.bone) return;
				edit([sel], 'Change bone', () => {
					sel.bone = Object.assign(boneOf(sel), {joint: this.joint, swing: clamp(num_(this.swing, 50), 1, 179), twist: clamp(num_(this.twist, 30), 0, 179), hinge_axis: this.hinge_axis,
						hmin: clamp(num_(this.hmin, -120), -179, 179), hmax: clamp(num_(this.hmax, 120), -179, 179), strength: clamp(num_(this.strength, 1), 0, 4), zone: this.zone});
				});
				updatePanel(true);
			},
			saveHits() {
				const sel = Group.first_selected, root = sel && rootOf(sel);
				if (!root) return;
				edit([root], 'Change hits', () => { root.ragdoll = Object.assign(ragdollOf(root), {hits: this.hits.map(h => ({t: Math.max(0, num_(h.t, 0)), bone: h.bone, dir: h.dir, local: h.local, impulse: Math.max(0, num_(h.impulse, 10)), name: h.name}))}); });
			},
			deleteHit(i) { this.hits.splice(i, 1); this.saveHits(); },
			clearHits() { this.hits = []; this.saveHits(); },
			addHit() { addHitFromView(); },
			toggleShoot() { shoot_mode = !shoot_mode; if (shoot_mode) Blockbench.showQuickMessage(tr('hit_on'), 2500); updatePanel(true); },
			capture() { capturePose(this.new_name, this.new_zone); },
			saveReactions() {
				const sel = Group.first_selected, root = sel && rootOf(sel);
				if (!root) return;
				const old = ragdollOf(root).reactions;
				edit([root], 'Change reactions', () => {
					root.ragdoll = Object.assign(ragdollOf(root), {reactions: this.reactions.map((r, i) => Object.assign({}, old[i] || {}, {name: r.name, zone: r.zone, hold: Math.max(0, num_(r.hold, 0.8)), tension: clamp(num_(r.tension, 1), 0, 2)}))});
				});
			},
			deleteReaction(i) { this.reactions.splice(i, 1); this.saveReactions(); updatePanel(true); },
			setRest() { setRestPose(); },
			play() { const a = api(); if (!a) { Blockbench.showQuickMessage(tr('msg_no_physics'), 3000); return; } a.play(); },
			pause() { const a = api(); if (a) a.pause(); },
			resetSim() { const a = api(); if (a) a.reset(); },
			bake() { const a = api(); if (!a || !a.bake) { Blockbench.showQuickMessage(tr('msg_no_physics'), 3000); return; } a.bake(); },
		},
		template: `
			<div class="rd_panel">
				<div class="rd_buttons">
					<button v-if="state != 'playing'" @click="play()">{{ t('play') }}</button>
					<button v-else @click="pause()">{{ t('pause') }}</button>
					<button @click="resetSim()">{{ t('reset') }}</button>
					<button @click="bake()">{{ t('bake') }}</button>
				</div>
				<div class="rd_dim">{{ sim_time }} s · {{ state }}</div>

				<template v-if="!has_root">
					<div class="rd_dim">{{ t('select_hint') }}</div>
					<button class="rd_full" :disabled="!has_selection" @click="build()">{{ t('build') }}</button>
				</template>
				<template v-else>
					<details class="rd_box" open>
						<summary>{{ t('character') }}: {{ root_name }} · {{ bone_count }} {{ t('bones') }}</summary>
						<div class="rd_grid">
							${num('mass_total', 'total_mass', 1, 500, 1, 0, null, 'saveMass()')}
							${num('tone', 'tone', 0, 1.5, 0.05, 2, 'tone_tip', 'saveRoot()')}
							${num('power', 'power', 0, 4, 0.1, 1, null, 'saveRoot()')}
							${num('flinch', 'flinch', 0, 1, 0.05, 2, 'flinch_tip', 'saveRoot()')}
							${num('radius', 'radius', 0, 200, 1, 0, null, 'saveRoot()')}
							${num('limp', 'limp', 0, 500, 1, 0, 'limp_tip', 'saveRoot()')}
							${num('limp_time', 'limp_time', 0, 30, 0.5, 1, 'limp_time_tip', 'saveRoot()')}
							${num('shot', 'shot', 1, 500, 1, 0, 'shot_tip', 'saveRoot()')}
						</div>
						<label class="rd_row">{{ t('pin') }}
							<select v-model="pin" @change="saveRoot()">
								<option value="none">{{ t('pin_none') }}</option>
								<option value="until_limp">{{ t('pin_until') }}</option>
								<option value="always">{{ t('pin_always') }}</option>
							</select>
						</label>
						<button class="rd_full" @click="setRest()">{{ t('set_rest') }}</button>
						<button class="rd_full" @click="remove()">{{ t('remove') }}</button>
					</details>

					<details class="rd_box" v-if="is_bone" open>
						<summary>{{ t('bone') }}: {{ sel_name }}</summary>
						<label class="rd_row">{{ t('joint') }}
							<select v-model="joint" @change="saveBone()">
								<option value="ball">{{ t('j_ball') }}</option>
								<option value="hinge">{{ t('j_hinge') }}</option>
								<option value="fixed">{{ t('j_fixed') }}</option>
							</select>
						</label>
						<div class="rd_grid">
							<template v-if="joint == 'ball'">
								${num('swing', 'swing', 1, 179, 1, 0, null, 'saveBone()')}
								${num('twist', 'twist', 0, 179, 1, 0, null, 'saveBone()')}
							</template>
							<template v-if="joint == 'hinge'">
								${num('hmin', 'hmin', -179, 179, 1, 0, null, 'saveBone()')}
								${num('hmax', 'hmax', -179, 179, 1, 0, null, 'saveBone()')}
							</template>
							${num('strength', 'strength', 0, 4, 0.1, 1, null, 'saveBone()')}
						</div>
						<label class="rd_row" v-if="joint == 'hinge'">{{ t('axis') }}
							<select v-model="hinge_axis" @change="saveBone()"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select>
						</label>
						<label class="rd_row">{{ t('zone') }}
							<select v-model="zone" @change="saveBone()">
								<option value="auto">{{ t('z_auto') }}</option><option value="head">{{ t('z_head') }}</option><option value="torso">{{ t('z_torso') }}</option>
								<option value="arms">{{ t('z_arms') }}</option><option value="legs">{{ t('z_legs') }}</option>
							</select>
						</label>
					</details>

					<details class="rd_box" open>
						<summary>{{ t('hits') }} · {{ hits.length }}</summary>
						<div class="rd_dim small">{{ t('hits_hint') }}</div>
						<button class="rd_full" :class="{active: shoot}" @click="toggleShoot()">{{ shoot ? t('shoot_on') : t('shoot') }}</button>
						<button class="rd_full" @click="addHit()">{{ t('add_hit') }}</button>
						<div v-if="!hits.length" class="rd_dim">{{ t('no_hits') }}</div>
						<div v-for="(h, i) in hits" :key="i" class="rd_item">
							<span class="rd_item_name">{{ h.name }}</span>
							<rope-num :label="t('time')" v-model="h.t" :min="0" :max="60" :step="0.05" :decimals="2" @change="saveHits()"></rope-num>
							<rope-num :label="t('impulse')" v-model="h.impulse" :min="0" :max="1000" :step="1" :decimals="0" @change="saveHits()"></rope-num>
							<button class="rd_x" @click="deleteHit(i)">✕</button>
						</div>
						<button v-if="hits.length" class="rd_full" @click="clearHits()">{{ t('clear_hits') }}</button>
					</details>

					<details class="rd_box" open>
						<summary>{{ t('reactions') }} · {{ reactions.length }}</summary>
						<div class="rd_dim small">{{ t('reactions_hint') }}</div>
						<div class="rd_row"><input type="text" v-model="new_name" class="rd_text" :placeholder="t('r_name')"></div>
						<label class="rd_row">{{ t('r_zone') }}
							<select v-model="new_zone"><option value="any">{{ t('z_any') }}</option><option value="head">{{ t('z_head') }}</option><option value="torso">{{ t('z_torso') }}</option>
								<option value="arms">{{ t('z_arms') }}</option><option value="legs">{{ t('z_legs') }}</option></select>
						</label>
						<button class="rd_full" @click="capture()">{{ t('capture') }}</button>
						<div v-if="!reactions.length" class="rd_dim">{{ t('no_reactions') }}</div>
						<div v-for="(r, i) in reactions" :key="'r' + i" class="rd_item col">
							<div class="rd_row"><input type="text" v-model="r.name" class="rd_text" @change="saveReactions()"><button class="rd_x" @click="deleteReaction(i)">✕</button></div>
							<label class="rd_row">{{ t('r_zone') }}
								<select v-model="r.zone" @change="saveReactions()"><option value="any">{{ t('z_any') }}</option><option value="head">{{ t('z_head') }}</option><option value="torso">{{ t('z_torso') }}</option>
									<option value="arms">{{ t('z_arms') }}</option><option value="legs">{{ t('z_legs') }}</option></select>
							</label>
							<div class="rd_grid">
								<rope-num :label="t('r_hold')" v-model="r.hold" :min="0" :max="10" :step="0.1" :decimals="1" @change="saveReactions()"></rope-num>
								<rope-num :label="t('r_tension')" v-model="r.tension" :min="0" :max="2" :step="0.05" :decimals="2" @change="saveReactions()"></rope-num>
							</div>
						</div>
					</details>
				</template>
				<div class="rd_dim small">{{ t('footnote') }}</div>
			</div>`,
	};
}
const num_ = num;

const STYLE = `
	#panel_ragdoll .rd_panel { overflow-y: auto !important; overflow-x: hidden !important; }
	.rd_panel { padding: 4px 8px 10px; font-size: 0.92em; }
	.rd_panel .rd_buttons { display: flex; gap: 4px; margin: 4px 0; }
	.rd_panel .rd_buttons button { flex: 1; min-width: 0; padding: 4px 6px; }
	.rd_panel .rd_full { width: 100%; padding: 4px 6px; margin: 3px 0; }
	.rd_panel .rd_full.active { background: var(--color-accent); color: var(--color-accent_text, #fff); }
	.rd_panel .rd_dim { opacity: 0.7; margin: 2px 0 6px; }
	.rd_panel .rd_dim.small { font-size: 0.85em; opacity: 0.6; }
	.rd_panel .rd_box { margin: 6px 0; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-back); }
	.rd_panel .rd_box > summary { cursor: pointer; text-transform: uppercase; font-size: 0.82em; opacity: 0.8; outline: none; }
	.rd_panel details.rd_box[open] > summary { margin-bottom: 6px; }
	.rd_panel .rd_grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 2px 0; }
	.rd_panel .rd_row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0; }
	.rd_panel .rd_text { flex: 1; min-width: 0; background: var(--color-dark); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px; padding: 3px 6px; }
	.rd_panel .rd_item { display: grid; grid-template-columns: 1fr 1fr auto; gap: 4px; align-items: center; margin: 4px 0; padding: 4px; border: 1px solid var(--color-border); border-radius: 3px; }
	.rd_panel .rd_item.col { display: block; }
	.rd_panel .rd_item_name { grid-column: 1 / 4; font-size: 0.85em; opacity: 0.8; }
	.rd_panel .rd_x { padding: 1px 6px; }
	.rd_panel select { background: var(--color-dark); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px; padding: 2px 4px; max-width: 62%; }
	.rd_num { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 8px; background: var(--color-dark); border: 1px solid var(--color-border);
		border-radius: 3px; cursor: ew-resize; user-select: none; touch-action: none; min-width: 0; }
	.rd_num:hover, .rd_num.editing { border-color: var(--color-accent); }
	.rd_num.editing { cursor: text; }
	.rd_num_label { opacity: 0.75; font-size: 0.88em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rd_num_value { width: 44px; text-align: right; background: transparent; border: none; color: var(--color-text); padding: 0; cursor: inherit; outline: none; font: inherit; font-weight: bold; }
`;

// ---- actions ----

function buildFromSelection() {
	const root = Project && Group.first_selected;
	if (!root) { Blockbench.showQuickMessage(tr('msg_select'), 2500); return; }
	const all = [root, ...bonesOf(root)];
	let result;
	edit(all, 'Build ragdoll', () => { result = buildRagdoll(root); });
	if (result.error) { Blockbench.showQuickMessage(tr('msg_few'), 3500); return; }
	Blockbench.showQuickMessage(tr('msg_built'), 1500);
	updatePanel(true);
}

function removeFromSelection() {
	const sel = Project && Group.first_selected, root = sel && rootOf(sel);
	if (!root) return;
	edit([root, ...bonesOf(root)], 'Remove ragdoll', () => removeRagdoll(root));
	Blockbench.showQuickMessage(tr('msg_removed'), 1500);
	updatePanel(true);
}

function setRestPose() {
	const sel = Project && Group.first_selected, root = sel && rootOf(sel);
	if (!root) return;
	edit(bonesOf(root), 'Rest pose', () => bonesOf(root).forEach(g => { g.bone = Object.assign(boneOf(g), {rest: g.rotation.slice()}); }));
	Blockbench.showQuickMessage(tr('msg_rest'), 1500);
}

// the current pose of the bones, as a turn from their rest pose; the bones go back to rest
function capturePose(name, zone) {
	const sel = Project && Group.first_selected, root = sel && rootOf(sel);
	if (!root) { Blockbench.showQuickMessage(tr('msg_select'), 2500); return; }
	const bones = bonesOf(root), pose = {};
	for (const g of bones) {
		const rest = boneOf(g).rest || g.rotation, d = [0, 1, 2].map(i => Math.round((g.rotation[i] - rest[i]) * 100) / 100);
		if (d.some(v => Math.abs(v) > 0.01)) pose[g.uuid] = d;
	}
	if (!Object.keys(pose).length) { Blockbench.showQuickMessage(tr('msg_nobone'), 3000); return; }
	edit([root, ...bones], 'Capture reaction', () => {
		root.ragdoll = Object.assign(ragdollOf(root), {reactions: ragdollOf(root).reactions.concat([Object.assign({}, DEFAULT_REACTION, {name: name || 'Reaction', zone: zone || 'any', pose})])});
		bones.forEach(g => { const rest = boneOf(g).rest; if (rest) g.rotation = rest.slice(); });
	});
	Canvas.updateAllBones();
	Blockbench.showQuickMessage(tr('msg_captured'), 1500);
	updatePanel(true);
}

// ---- shooting ----

function previewOf(event) {
	return ((typeof Preview != 'undefined' && Preview.all) || []).find(p => p.canvas && (p.canvas === event.target || p.canvas.contains && p.canvas.contains(event.target))) || null;
}

// where a click or a view direction meets the bones of the selected character
function pickBone(root, origin, dir) {
	const meshes = [], owner = new Map();
	for (const g of bonesOf(root)) for (const el of directParts(g)) if (el.mesh) { meshes.push(el.mesh); owner.set(el.mesh, g); }
	scene.updateMatrixWorld(true);
	const ray = new THREE.Raycaster(origin, dir.clone().normalize(), 0, 100000);
	const hit = ray.intersectObjects(meshes, false)[0];
	if (!hit) return null;
	let o = hit.object;
	while (o && !owner.has(o)) o = o.parent;
	return o ? {group: owner.get(o), point: hit.point} : null;
}

// the hit in the form that is kept: the point is in the coordinates of the bone, so it follows the bone when it moves
function makeHit(group, point, dir, impulse, time) {
	const mesh = group.mesh;
	mesh.updateMatrixWorld(true);
	const local = mesh.worldToLocal(point.clone());
	return {t: Math.round(time * 1000) / 1000, bone: group.uuid, name: group.name, dir: dir.clone().normalize().toArray().map(v => Math.round(v * 1e4) / 1e4), local: local.toArray().map(v => Math.round(v * 100) / 100), impulse};
}

function recordHit(root, hit) {
	edit([root], 'Add hit', () => {
		const s = ragdollOf(root);
		root.ragdoll = Object.assign(s, {hits: s.hits.concat([hit]).sort((a, b) => a.t - b.t)});
	});
	updatePanel(true);
}

// a click on the character while the simulation runs
function onClick(event) {
	if (!shoot_mode || !Project || event.button !== 0) return;
	const sim = simNow();
	if (!sim || !sim.playing || !current) return;
	const preview = previewOf(event);
	if (!preview) return;
	const rect = preview.canvas.getBoundingClientRect();
	const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
	const ray = new THREE.Raycaster();
	ray.setFromCamera(ndc, preview.camera);
	for (const r of current.list) {
		const found = pickBone(r.root, ray.ray.origin, ray.ray.direction);
		if (!found) continue;
		event.stopPropagation(); event.preventDefault();
		// the point is given in the coordinates of the bone body in the simulation
		const entry = r.bones.find(b => b.group === found.group).entry;
		const M = new THREE.Matrix4().compose(bodyPos(entry), bodyQuat(entry), new THREE.Vector3(1, 1, 1));
		const local = found.point.clone().applyMatrix4(M.invert());
		const impulse = r.s.shot || 40;
		const hit = {t: Math.round(r.time * 1000) / 1000, bone: found.group.uuid, name: found.group.name, dir: ray.ray.direction.clone().normalize().toArray().map(v => Math.round(v * 1e4) / 1e4), local: local.toArray().map(v => Math.round(v * 100) / 100), impulse};
		r.shoot(hit);
		const s = ragdollOf(r.root);
		r.root.ragdoll = Object.assign(s, {hits: s.hits.concat([hit]).sort((a, b) => a.t - b.t)});
		Project.saved = false;
		updatePanel(true);
		return;
	}
}

// a hit added by hand: from the direction the view looks, on the selected bone
function addHitFromView() {
	const sel = Project && Group.first_selected, root = sel && rootOf(sel);
	if (!root || !sel.bone) { Blockbench.showQuickMessage(tr('msg_nobone'), 2500); return; }
	const preview = Preview.selected, camera = preview && preview.camera;
	const dir = camera ? camera.getWorldDirection(new THREE.Vector3()) : new THREE.Vector3(0, 0, -1);
	sel.mesh.updateMatrixWorld(true);
	const center = new THREE.Box3().setFromObject(sel.mesh).getCenter(new THREE.Vector3());
	const sim = simNow();
	recordHit(root, makeHit(sel, center, dir, 40, sim ? sim.time : 0.5));
	Blockbench.showQuickMessage(tr('msg_hit'), 1200);
}

const onSelection = () => updatePanel();
let poll = null;

if (typeof __RAGDOLL_EXPORT !== 'undefined') __RAGDOLL_EXPORT({RagdollRuntime, physicsHook, buildRagdoll, bonesOf, envelope, flinchEnvelope, zoneOfName, hingeByName, ragdollOf, boneOf, DEFAULT_RAGDOLL, DEFAULT_BONE, DEFAULT_REACTION, NumberField, panelComponent, STYLE, getCurrent: () => current});

if (typeof Plugin !== 'undefined' && typeof Blockbench !== 'undefined') Plugin.register('ragdoll', {
	title: 'Ragdoll',
	author: 'Claude',
	description: 'A physical character with muscles that reacts to being shot or pushed: flinches, saved reaction poses (hands on the head), falls when hit hard. Baked to a normal animation.',
	about: 'Open the **Ragdoll** tab, select the group of a character (a group with bone groups inside) and press **Build**. Every bone becomes a physics body and every joint a real joint with limits and a **muscle**: a spring that holds the bone in its pose. **Muscle tone** is how stiff the muscles are, **Flinch** how much they tighten around a hit. A **hit** pushes the bone it touches: press Play, turn **Shoot** on and click the character in the 3D view (shots are recorded and replayed when you bake). **Reactions** are poses you save (pose the bones, press Capture): after a hit in their zone the character moves into the pose, for example hands on the head. A hard hit (**Knock down**) switches the muscles off and the character falls. Play and Bake use the Physics tab, so the result is baked into a normal animation of the bones. Needs physics.js 0.8 or newer.',
	icon: 'accessibility_new',
	version: '0.1.0',
	variant: 'both',
	min_version: '4.10.0',
	tags: ['Animation'],
	onload() {
		properties.push(new Property(Group, 'object', 'ragdoll', {default: null}));
		properties.push(new Property(Group, 'object', 'bone', {default: null}));
		style_node = Blockbench.addCSS(STYLE);
		mode = new Mode('ragdoll', {
			name: tr('mode'),
			icon: 'accessibility_new',
			category: 'navigate',
			condition: () => Project && Format && Format.id != 'image',
			default_tool: 'move_tool',
			onSelect() { updatePanel(true); },
			onUnselect() { shoot_mode = false; const a = api(); if (a) a.reset(); },
		});
		panel = new Panel('ragdoll', {
			name: tr('mode'),
			growable: true,
			resizable: true,
			min_height: 200,
			icon: 'accessibility_new',
			condition: {modes: ['ragdoll']},
			default_position: {slot: 'right_bar', float_position: [0, 0], float_size: [320, 600], height: 600},
			component: panelComponent(),
		});
		const outliner = Interface.Panels.outliner;
		if (outliner && outliner.condition && outliner.condition.modes instanceof Array && !outliner.condition.modes.includes('ragdoll')) outliner.condition.modes.push('ragdoll');
		// moving and rotating bones in the ragdoll tab (to pose a reaction)
		for (const tool of [BarItems.move_tool, BarItems.rotate_tool]) {
			if (!tool) continue;
			const c = tool.condition;
			tool.__ragdoll_condition = c;
			tool.condition = (...args) => (Modes.ragdoll && Project && Format && Format.id != 'image') || c(...args);
		}
		globalThis.__physicsHooks = (globalThis.__physicsHooks || []).filter(h => h !== physicsHook).concat([physicsHook]);
		document.addEventListener('pointerdown', onClick, true);
		poll = setInterval(() => updatePanel(), 250);
		Blockbench.on('update_selection', onSelection);
		Blockbench.on('select_project', onSelection);
	},
	onunload() {
		if (poll) clearInterval(poll);
		document.removeEventListener('pointerdown', onClick, true);
		globalThis.__physicsHooks = (globalThis.__physicsHooks || []).filter(h => h !== physicsHook);
		for (const tool of [BarItems.move_tool, BarItems.rotate_tool]) if (tool && tool.__ragdoll_condition !== undefined) { tool.condition = tool.__ragdoll_condition; delete tool.__ragdoll_condition; }
		Blockbench.removeListener('update_selection', onSelection);
		Blockbench.removeListener('select_project', onSelection);
		if (Modes.ragdoll) Modes.options.edit.select();
		const outliner = Interface.Panels.outliner;
		if (outliner && outliner.condition && outliner.condition.modes instanceof Array) outliner.condition.modes.remove('ragdoll');
		if (panel) panel.delete();
		if (mode) mode.delete();
		properties.forEach(p => p.delete());
		properties = [];
		if (style_node) style_node.delete();
	},
});

})();
