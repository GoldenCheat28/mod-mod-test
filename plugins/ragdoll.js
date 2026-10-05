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

const DEFAULT_RAGDOLL = {enabled: true, total_mass: 70, tone: 0.6, power: 1, flinch: 0.7, radius: 32, pin: 'until_limp', limp: 0, limp_time: 0, friction: 0.5, shot: 40, auto_react: true, react_scale: 1, facing: 'north', shot_part: 'auto', shot_yaw: 0, shot_pitch: 8, shot_time: 0.5, hits: [], reactions: [], poses: [], npc: false, blood: false, blood_high: false, blood_amount: 1, bleed: 1, head_kills: true, balance: 1, spasm: 0.5, posture: 'stand', weapon: 'pistol', record_blood: true, follow_anim: '', follow_release_at: 0, follow_bump: true, route: '', route_speed: 1.3, route_mode: 'once', route_start: 0, kill_at: 0, kill_kind: 'heart'};
const DEFAULT_BONE = {joint: 'ball', swing: 50, twist: 30, hinge_axis: 'x', hmin: -120, hmax: 120, strength: 1, zone: 'auto', role: '', rest: null};
const DEFAULT_REACTION = {name: 'Reaction', zone: 'any', pose: {}, attack: 0.12, hold: 0.8, release: 0.8, tension: 1};

const ragdollOf = g => Object.assign({}, DEFAULT_RAGDOLL, g.ragdoll || {});
const boneOf = g => Object.assign({}, DEFAULT_BONE, g.bone || {});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => isFinite(parseFloat(v)) ? parseFloat(v) : d;
const eulerOrder = () => (typeof Format != 'undefined' && Format && Format.euler_order) || 'ZYX';
// How this Blockbench turns the rotation of a group into three.js angles: some versions mirror x and y. It is measured once, on a real group.
let signs_cache = null;
function rotationSigns() {
	if (signs_cache) return signs_cache;
	try {
		const g = (typeof Group != 'undefined' && Group.all || []).find(x => x.mesh);
		if (g && typeof Canvas != 'undefined' && Canvas.updateAllBones) {
			const saved = g.rotation.slice();
			g.rotation = [10, 20, 30];
			Canvas.updateAllBones([g]);
			const e = g.mesh.rotation, found = [Math.sign(e.x), Math.sign(e.y), Math.sign(e.z)];
			g.rotation = saved;
			Canvas.updateAllBones([g]);
			if (found.every(v => v !== 0)) signs_cache = found;
		}
	} catch (err) { /* keep the guess */ }
	return signs_cache || [1, 1, 1];
}
const bbOfThree = deg => deg.map((v, i) => Math.round(v * rotationSigns()[i] * 100) / 100);   // a physical angle (three.js terms) -> the rotation of a group
const quatOfDeg = r => { const s = rotationSigns(); return new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * s[0] * D2R, r[1] * s[1] * D2R, r[2] * s[2] * D2R, eulerOrder())); };
const quatOfThree = r => new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'ZYX'));

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

// what part of the body a bone is (from its name): the built-in reactions need it
const ROLES = ['pelvis', 'abdomen', 'chest', 'neck', 'head', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot'];
function roleOfName(name) {
	const n = String(name).toLowerCase();
	if (/head|skull|голов|череп/.test(n)) return 'head';
	if (/neck|шея/.test(n)) return 'neck';
	if (/fore.?arm|lower.?arm|elbow|предплеч|локт/.test(n)) return 'forearm';
	if (/hand|palm|finger|wrist|кист|ладон|палец|запяст/.test(n)) return 'hand';
	if (/upper.?arm|shoulder|(^|[^a-z])arm([^a-z]|$)|плеч|рука/.test(n)) return 'upperarm';
	if (/thigh|upper.?leg|бедр/.test(n)) return 'thigh';
	if (/shin|calf|lower.?leg|knee|голен|колен/.test(n)) return 'shin';
	if (/foot|feet|ankle|toe|стоп|ступн|лодыж/.test(n)) return 'foot';
	if (/chest|torso|ribs|breast|грудь|торс|груд/.test(n)) return 'chest';
	if (/abdomen|spine|belly|waist|stomach|живот|поясниц|спина/.test(n)) return 'abdomen';
	if (/pelvis|hips?|таз|бедра/.test(n)) return 'pelvis';
	return '';
}
const roleOf = g => { const b = boneOf(g); return b.role || roleOfName(g.name); };
const zoneOfRole = role => ({head: 'head', neck: 'head', chest: 'torso', abdomen: 'torso', pelvis: 'torso', upperarm: 'arms', forearm: 'arms', hand: 'arms', thigh: 'legs', shin: 'legs', foot: 'legs'})[role] || '';

// the joint a part of the body normally has (swing and twist in degrees, hinges have a range)
const JOINTS = {   // the joints of the Blood ragdoll: limits in degrees (swing, twist, hinge range), the strength of the muscle
	pelvis: {joint: 'ball', swing: 30, twist: 20, strength: 2}, abdomen: {joint: 'ball', swing: 30, twist: 26, strength: 2.2}, chest: {joint: 'ball', swing: 26, twist: 23, strength: 1.8},
	neck: {joint: 'ball', swing: 35, twist: 40, strength: 1.2}, head: {joint: 'ball', swing: 40, twist: 63, strength: 1.2},
	upperarm: {joint: 'ball', swing: 130, twist: 70, strength: 1}, forearm: {joint: 'hinge', hmin: 0, hmax: 143, strength: 1}, hand: {joint: 'ball', swing: 34, twist: 6, strength: 0.8},
	thigh: {joint: 'ball', swing: 100, twist: 30, strength: 2.6}, shin: {joint: 'hinge', hmin: -143, hmax: 0, strength: 3}, foot: {joint: 'ball', swing: 40, twist: 9, strength: 3},
};
// what every part weighs (kg, the whole body 74), how fast its muscle works (rad/s) and how strong it is (N·m): from the Blood ragdoll
const ROLE_PARAMS = {
	pelvis: {mass: 10.5, omega: 17, torque: 380}, abdomen: {mass: 10.3, omega: 17, torque: 380}, chest: {mass: 16, omega: 17, torque: 380}, neck: {mass: 1.2, omega: 15, torque: 60}, head: {mass: 6, omega: 15, torque: 70},
	upperarm: {mass: 2.1, omega: 14, torque: 130}, forearm: {mass: 1.2, omega: 12, torque: 80}, hand: {mass: 0.55, omega: 11, torque: 32},
	thigh: {mass: 7.4, omega: 18, torque: 480}, shin: {mass: 3.45, omega: 18, torque: 380}, foot: {mass: 1.07, omega: 14, torque: 140},
};

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
		this.rt = rt;
		this.blood = null;
		this.wounds = [];
		this.npc = null;
		this.build();
		if (this.s.npc) this.initNpc();
	}

	build() {
		const {J, world} = this;
		const entryOf = g => world.entries.find(e => e.desc.node === g && !e.broken) || null;
		const visit = (g, parent) => {
			if (g.attach && g.attach.bone) return;
			const entry = entryOf(g);
			let bone = null;
			if (entry) {
				bone = {group: g, entry, parent, b: boneOf(g), children: [], tension: 0, constraint: null, kind: 'none', rest_local: null, axis: null, length: 8, load: 0, zone: zoneOf(g), role: roleOf(g), side: 0};
				this.bones.push(bone);
				if (parent) parent.children.push(bone);
			}
			for (const child of g.children || []) if (child instanceof Group) visit(child, bone || parent);
		};
		visit(this.root, null);
		// which side of the body a limb is on (the character's right is +x when it looks toward -z)
		const top = this.bones.find(b => !b.parent);
		const cx = top ? top.entry.desc.pos.x : 0;
		for (const b of this.bones) b.side = ['upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot'].includes(b.role) ? (b.entry.desc.pos.x >= cx ? 1 : -1) : 0;
		this.face = this.s.facing == 'south' ? -1 : 1;
		// the weight a joint has to carry: the bone and everything below it
		const total = b => { b.load = b.entry.desc.settings.mass + b.children.reduce((s, c) => s + total(c), 0); return b.load; };
		this.bones.filter(b => !b.parent).forEach(total);
		// bones of one character do not collide with their neighbours (they overlap at the joints)
		const ids = new Map(this.bones.map((b, i) => [b, i]));
		// things held by the character (a weapon in the hand): found by their link to this character
		const holders = [...Group.all, ...Cube.all, ...Mesh.all].filter(n => n.attach && n.attach.root == this.root.uuid);
		this.items = [];
		for (const node of holders) {
			const entry = entryOf(node), holder = this.bones.find(b => b.group.uuid == node.attach.bone);
			if (entry && holder) this.items.push({node, entry, holder, drop: node.attach.drop !== false, constraint: null});
		}
		const filter = new J.GroupFilterTable(this.bones.length + this.items.length);
		const group_id = Math.floor(Math.random() * 1e6) + 1;
		// bones that touch each other in the rest pose (a hand on a knee) must not push each other apart
		const boxes = new Map(this.bones.map(b => {
			const box = new THREE.Box3();
			for (const part of b.entry.desc.parts) {
				const pts = part.kind == 'box' ? [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => new THREE.Vector3(x * part.half[0], y * part.half[1], z * part.half[2]).applyQuaternion(part.rot).add(part.center)))) : (part.points || []);
				pts.forEach(p => box.expandByPoint(p.clone().applyQuaternion(b.entry.desc.quat).add(b.entry.desc.pos)));
			}
			return [b, box.expandByScalar(0.15)];
		}));
		for (let i = 0; i < this.bones.length; i++) for (let j = i + 1; j < this.bones.length; j++) {
			if (boxes.get(this.bones[i]).intersectsBox(boxes.get(this.bones[j]))) filter.DisableCollision(ids.get(this.bones[i]), ids.get(this.bones[j]));
		}
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
		// a held item does not collide with the body that holds it; it is fixed to its hand until it is let go
		this.items.forEach((it, i) => {
			const sub = this.bones.length + i;
			it.entry.body.GetCollisionGroup().SetGroupFilter(filter);
			it.entry.body.GetCollisionGroup().SetGroupID(group_id);
			it.entry.body.GetCollisionGroup().SetSubGroupID(sub);
			this.bones.forEach(b => filter.DisableCollision(sub, ids.get(b)));
			it.entry.body.SetAllowSleeping(false);
			world.tmp.Set(0, 0, 0);
			world.bodies.SetLinearVelocity(it.entry.id, world.tmp);
			world.bodies.SetAngularVelocity(it.entry.id, world.tmp);
			try {
				const st = new J.FixedConstraintSettings();
				st.mSpace = J.EConstraintSpace_WorldSpace;
				st.mAutoDetectPoint = true;
				it.constraint = J.castObject(st.Create(it.holder.entry.body, it.entry.body), J.FixedConstraint);
				world.system.AddConstraint(it.constraint);
			} catch (err) { console.warn('[Ragdoll] item', err); }
		});
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


	// ---- reactions that every part of the body has by itself (no pose to save) ----
	// An arm or a leg gets a pose (in three.js angles, as in the character spec), the spine bends away from the shot.
	builtinReaction(hit_bone, dir, impulse) {
		const f = this.face, sc = clamp(impulse / 40, 0.5, 1.6) * (this.s.react_scale || 1);
		const targets = new Map(), bends = [];
		const q = (x, y, z) => quatOfThree([x * f, y, z]);
		const byRole = (role, side) => this.bones.find(b => b.role == role && (!side || b.side == side));
		const set = (role, side, x, y, z) => { const b = byRole(role, side); if (b) targets.set(b, q(x, y, z)); };
		// legs and spine move from the pose they are in (a seated person bends the knee from where it is)
		const rel = (role, side, x, y, z) => { const b = byRole(role, side); if (b) targets.set(b, q(x, y, z).multiply(b.rest_local)); };
		// arm poses found for the character: [upper arm x, z], [forearm x, z], hand x (z is mirrored for the other arm)
		const ARM = {
			head: [[78, -2], [114, -16], 0], chest: [[0, -2], [144, -36], 0], belly: [[0, 28], [72, 0], 0],
			pull: [[18, 10], [100, -25], 0], balance: [[0, -40], [8, 0], 0], guard: [[40, -10], [120, -10], 0],
		};
		const arm = (side, name) => { const [u, fo, h] = ARM[name]; set('upperarm', side, u[0], 0, -side * u[1]); set('forearm', side, fo[0], 0, -side * fo[1]); set('hand', side, h, 0, 0); };
		const bothArms = name => { arm(1, name); arm(-1, name); };
		const legs = (thigh, shin, foot) => { for (const side of [1, -1]) { rel('thigh', side, thigh, 0, -side * 2); rel('shin', side, shin, 0, 0); rel('foot', side, foot, 0, 0); } };
		const bend = (axis, angle, roles) => { if (axis) bends.push({axis, angle: angle * D2R * sc, roles}); };
		// the spine bends away from the shot: about the horizontal axis across the direction of the hit
		const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(dir.x, 0, dir.z);
		const away = d.lengthSq() > 1e-4 ? new THREE.Vector3().crossVectors(up, d.normalize()) : null;
		const forward = (name, angle) => { const b = byRole(name); if (b) targets.set(b, q(-angle * sc, 0, 0).multiply(b.rest_local)); };
		const role = hit_bone.role, side = hit_bone.side;
		if (role == 'head' || role == 'neck') {
			bend(away, 24, {head: 1, neck: 0.8, chest: 0.4, abdomen: 0.25});
			bothArms('head');
			legs(6, -10, 0);
		} else if (role == 'chest') {
			bend(away, 16, {chest: 0.9, head: 0.8, neck: 0.6, abdomen: 0.5});
			bothArms('chest');
			legs(5, -8, 0);
		} else if (role == 'abdomen' || role == 'pelvis') {
			// doubled over, hands on the belly, knees give way
			forward('abdomen', 28); forward('chest', 22); forward('neck', -10);
			bothArms('belly');
			legs(22, -38, 6);
		} else if (['upperarm', 'forearm', 'hand'].includes(role)) {
			// the arm is pulled in, the other hand goes to it, the body turns away
			arm(side, 'pull'); arm(-side, 'chest');
			const c = byRole('chest'); if (c) targets.set(c, q(2, -side * 18, 0).multiply(c.rest_local));
			bend(away, 8, {chest: 0.6, head: 0.5, abdomen: 0.3});
		} else if (['thigh', 'shin', 'foot'].includes(role)) {
			// the leg is drawn up, the other leg takes the weight, the arms go out for balance, a little bent over
			legs(5, -6, 0);
			rel('thigh', side, 32, 0, -side * 4); rel('shin', side, -58, 0, 0); rel('foot', side, 18, 0, 0);
			bothArms('balance');
			forward('abdomen', 10); forward('chest', 8);
		} else return null;
		return {name: role, zone: zoneOfRole(role), targets, bends, attack: 0.1, hold: 1.0 * Math.max(0.6, sc), release: 1.0, tension: 1.3};
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
		// a reaction you saved for this zone comes first; otherwise the built-in one for this part of the body
		const reaction = this.reactionFor(b.zone);
		if (reaction) this.reactions.push({def: Object.assign({}, DEFAULT_REACTION, reaction), t0: this.time});
		else if (this.s.auto_react) { const def = this.builtinReaction(b, dir, hit.impulse); if (def) this.reactions.push({def, t0: this.time}); }
		if (this.s.npc || this.s.blood) this.wound(b, dir, point, hit.impulse, hit.local);
		if (this.s.limp > 0 && hit.impulse >= this.s.limp) this.goLimp(this.s.limp_time > 0 ? this.time + this.s.limp_time : Infinity);
		this.log.push({t: this.time, bone: b.group.name, impulse: hit.impulse});
	}


	// the muscles switch off: the hips are let go and what the character holds is dropped (if the item is set to drop)
	goLimp(until) {
		this.limp_since = this.time;
		this.limp_until = until;
		if (this.pin) { try { this.world.system.RemoveConstraint(this.pin); } catch (err) { console.warn('[Ragdoll]', err); } this.pin = null; }
		for (const it of this.items) if (it.drop && it.constraint) { try { this.world.system.RemoveConstraint(it.constraint); } catch (err) { console.warn('[Ragdoll]', err); } it.constraint = null; it.entry.body.SetAllowSleeping(true); }
	}

	// ---- the character as a living body (as in the Blood project): blood, pain, shock, legs that give way, balance, falling, death ----

	initNpc() {
		const by = role => this.bones.find(b => b.role == role);
		const pelvis = by('pelvis') || this.bones.find(b => !b.parent);
		const tops = this.bones.filter(b => !b.parent);
		const g = this.ground();
		this.npc = {
			blood: 5000, pain: 0, shock: 0, stagger: 0, push: new THREE.Vector3(), leg: {'1': 1, '-1': 1}, arm: {'1': 1, '-1': 1},
			state: 'stand', stand: 1, tone: 1, dead: false, faint: false, pelvis,
			chest: by('chest') || by('abdomen') || pelvis, head: by('head') || by('neck'), feet: this.bones.filter(b => b.role == 'foot'),
			mass: tops.reduce((m, b) => m + b.load, 0), h0: pelvis ? (bodyPos(pelvis.entry).y - g) : 0, fell_at: null,
		};
	}

	ground() {
		const ws = this.rt.ws || {};
		if (ws.ground === false) return -1e6;
		try { return Project.model_3d.localToWorld(new THREE.Vector3(0, ws.ground_y || 0, 0)).y; } catch (err) { return ws.ground_y || 0; }
	}

	// where a hit makes a wound, and how bad it is
	wound(b, dir, point, impulse, local) {
		const dmg = clamp(impulse / 40, 0.1, 6);
		const n = this.npc, role = b.role, scale = this.s.bleed;
		const BASE = {head: 18, neck: 30, chest: 26, abdomen: 22, pelvis: 20, upperarm: 14, forearm: 8, hand: 5, thigh: 20, shin: 9, foot: 5};
		const arterial = ['neck', 'thigh', 'upperarm'].includes(role) && Math.random() < 0.5 + 0.2 * dmg;
		const rate = (BASE[role] || 12) * (0.6 + 0.4 * Math.min(dmg, 3)) * scale;
		const M = new THREE.Matrix4().compose(bodyPos(b.entry), bodyQuat(b.entry), new THREE.Vector3(1, 1, 1));
		const normal = dir.clone().negate().normalize();
		this.wounds.push({bone: b, local: new THREE.Vector3(...(local || [0, 0, 0])), normal, rate, rate0: rate, arterial, age: 0});
		if (this.wounds.length > 14) this.wounds.shift();
		if (this.blood) this.blood.hit(point, dir, dmg, this.s.blood_amount);
		if (!n) return;
		const side = b.side || 0;
		n.pain += 0.35 * dmg + (role == 'abdomen' || role == 'pelvis' ? 0.25 : 0);
		n.shock += 0.22 * dmg + (role == 'chest' ? 0.15 : 0) + (role == 'abdomen' ? 0.1 : 0);
		if (dmg > 2) n.shock += 0.35;
		if (['thigh', 'shin', 'foot'].includes(role)) n.leg[side] = Math.max(0, n.leg[side] - 0.55 * dmg);
		if (['upperarm', 'forearm', 'hand'].includes(role)) n.arm[side] = Math.max(0, n.arm[side] - 0.5 * dmg);
		n.stagger = Math.max(n.stagger, clamp(0.35 * dmg, 0, 1));
		n.push.add(new THREE.Vector3(dir.x, 0, dir.z).multiplyScalar(0.12 * dmg));
		if (!n.dead && this.s.head_kills && (role == 'head' || role == 'neck') && dmg >= 0.9) this.die('head');
	}

	die(why) {
		const n = this.npc;
		if (!n || n.dead) return;
		n.dead = true; n.why = why; n.state = 'fallen';
		this.goLimp(Infinity);
		this.log.push({t: this.time, died: why});
	}

	faint() {
		const n = this.npc;
		if (!n || n.faint) return;
		n.faint = true; n.state = 'fallen';
		this.goLimp(Infinity);
		this.log.push({t: this.time, fainted: true});
	}

	npcStep(dt) {
		const n = this.npc;
		if (!n || !n.pelvis) return;
		const {world} = this, g = (this.rt.ws && this.rt.ws.gravity) || 9.81, M = n.mass;
		n.pain = Math.max(0, n.pain - 0.1 * dt); n.shock = Math.max(0, n.shock - 0.025 * dt);
		n.stagger = Math.max(0, n.stagger - 1.2 * dt); n.push.multiplyScalar(Math.exp(-3 * dt));
		// bleeding: the wounds clot slowly (a cut artery much more slowly), blood is lost
		let bleed = 0;
		for (const w of this.wounds) { w.age += dt; w.rate *= Math.exp(-dt / (w.arterial ? 70 : 45)); bleed += w.rate; }
		n.blood -= bleed * dt; n.bleeding = bleed;
		if (!n.dead) {
			if (n.blood < 2500) this.die('blood');
			else if (!n.faint && (n.blood < 3600 || n.shock > 1.3 || n.pain > 2.2)) this.faint();
		}
		const legs = Math.min(n.leg['1'], n.leg['-1']);
		// is it still standing?
		const pp = bodyPos(n.pelvis.entry), spine = bodyPos(n.chest.entry).sub(pp);
		const tilt = spine.lengthSq() > 1e-6 && n.chest != n.pelvis ? Math.acos(clamp(spine.y / spine.length(), -1, 1)) : 0;
		const h = pp.y - this.ground();
		const com = new THREE.Vector3(); let mc = 0, vcom = new THREE.Vector3();
		for (const b of this.bones) {
			const c = b.entry.body.GetCenterOfMassPosition(), v = b.entry.body.GetLinearVelocity(), m = b.entry.desc.settings.mass;
			com.x += c.GetX() * m; com.y += c.GetY() * m; com.z += c.GetZ() * m; vcom.x += v.GetX() * m; vcom.y += v.GetY() * m; vcom.z += v.GetZ() * m; mc += m;
		}
		com.multiplyScalar(1 / mc); vcom.multiplyScalar(1 / mc);
		let support = null;
		if (n.feet.length) { support = new THREE.Vector3(); n.feet.forEach(f => support.add(bodyPos(f.entry))); support.multiplyScalar(1 / n.feet.length / SCALE); }
		else support = new THREE.Vector3(pp.x / SCALE, 0, pp.z / SCALE);
		const ex = support.x - com.x, ez = support.z - com.z;
		// a capture point: where the body will be when it has used its speed up; if that is far outside the feet, the character falls
		const lean = Math.atan2(Math.hypot(ex, ez), Math.max(0.2, com.y - support.y));
		const cap = Math.hypot(ex - vcom.x * 0.35, ez - vcom.z * 0.35);
		if (n.state == 'stand' && !n.dead) {
			const why = legs < 0.15 ? 'legs' : lean > 0.8 ? 'tilt' : h < 0.6 * n.h0 ? 'height' : cap > 0.9 ? 'capture' : '';
			n.unsteady = why ? (n.unsteady || 0) + dt : 0; n.dbg = {lean, cap, h, ex, ez, vz: vcom.z};
			if (why && n.unsteady > (why == 'legs' ? 0 : 0.3)) { n.state = 'fallen'; n.fell_at = this.time; this.log.push({t: this.time, fell: why}); }
		}
		const target = n.state == 'stand' ? clamp(1 - 0.9 * n.stagger, 0.1, 1) * (0.5 + 0.5 * Math.min(1, legs * 1.5)) * this.s.balance : 0;
		n.stand += (target - n.stand) * Math.min(1, dt * 8);
		n.tone = n.dead || n.faint ? 0 : n.state == 'fallen' ? 0.35 : clamp(1 - 0.35 * n.shock - 0.2 * n.pain, 0.3, 1);
		if (this.pin || n.stand < 0.01) return;
		// the balance assist (as in the Blood project): the weight is held up, the body is kept over its feet and upright
		const add = (b, f) => { world.tmp.Set(f.x, f.y, f.z); world.bodies.AddForce(b.entry.id, world.tmp, this.J.EActivation_Activate); };
		const vy = vcom.y, dh = (n.h0 - h) / SCALE;
		// the legs carry the weight by themselves while they are healthy; the assist lifts what has sagged and takes the weight of weak legs
		const dead = v => Math.sign(v) * Math.max(0, Math.abs(v) - 0.06);
		const fy = clamp(M * (Math.max(0, 70 * dh - 10 * vy) + g * 0.8 * (1 - clamp(legs * 1.2, 0, 1)) + g * 0.3 * n.stagger), 0, M * g * 1.6) * n.stand;
		const ax = clamp(45 * dead(ex) - 9 * vcom.x, -0.8 * g, 0.8 * g) * M * n.stand + n.push.x * M * 20 * n.stand;
		const az = clamp(45 * dead(ez) - 9 * vcom.z, -0.8 * g, 0.8 * g) * M * n.stand + n.push.z * M * 20 * n.stand;
		const split = n.chest != n.pelvis ? [[n.pelvis, 0.62], [n.chest, 0.38]] : [[n.pelvis, 1]];
		for (const [b, k] of split) add(b, new THREE.Vector3(ax * k, fy * k, az * k));
		// the same force the other way on the feet: the legs carry it into the ground, so the body is not pushed along by it
		if (n.feet.length) for (const f of n.feet) add(f, new THREE.Vector3(0, -fy / n.feet.length, 0));
	}

	// the blood leaves the wounds
	bleedStep(dt) {
		if (!this.blood) return;
		for (const w of this.wounds) {
			const M = new THREE.Matrix4().compose(bodyPos(w.bone.entry), bodyQuat(w.bone.entry), new THREE.Vector3(1, 1, 1));
			const pos = w.local.clone().applyMatrix4(M);
			const q = bodyQuat(w.bone.entry);
			const nrm = w.normal.clone();
			const lv = w.bone.entry.body.GetLinearVelocity();
			this.blood.wound(w, pos, nrm, new THREE.Vector3(lv.GetX(), lv.GetY(), lv.GetZ()), dt, this.s.blood_amount);
		}
	}

	// ---- one step ----

	step(dt) {
		const t = this.time;
		this.pending.splice(0).forEach(h => this.applyHit(h));
		while (this.next_hit < this.hits.length && this.hits[this.next_hit].t <= t + 1e-9) this.applyHit(this.hits[this.next_hit++]);
		this.drive(t);
		if (this.npc) this.npcStep(dt);
		this.bleedStep(dt);
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
			// the pose of a reaction: a saved one (turns from the rest pose) or a built-in one (poses and bends)
			let target = null;
			if (reaction && blend > 0) {
				const def = reaction.def;
				if (def.pose && def.pose[b.group.uuid]) {
					const d = def.pose[b.group.uuid];
					const rest = b.b.rest || b.group.rotation || [0, 0, 0];
					const delta = new THREE.Quaternion().slerp(quatOfDeg([rest[0] + d[0], rest[1] + d[1], rest[2] + d[2]]).multiply(quatOfDeg(rest).invert()), blend);
					target = delta.multiply(b.rest_local);
					tension = Math.max(tension, def.tension * blend);
				}
				if (def.targets && def.targets.has(b)) {
					target = b.rest_local.clone().slerp(def.targets.get(b), blend);
					tension = Math.max(tension, def.tension * blend);
				}
				if (def.bends) for (const bend of def.bends) {
					const k = bend.roles[b.role];
					if (!k) continue;
					const qp = bodyQuat(b.parent.entry);
					const rw = new THREE.Quaternion().setFromAxisAngle(bend.axis, bend.angle * k * blend);
					target = qp.clone().invert().multiply(rw).multiply(qp).multiply(target || b.rest_local);
					tension = Math.max(tension, 0.9 * blend);
				}
			}
			if (this.npc) {
				const n = this.npc;
				let k = n.tone;
				if (['upperarm', 'forearm', 'hand'].includes(b.role) && b.side) k *= clamp(n.arm[b.side], 0.15, 1);
				if (['thigh', 'shin', 'foot'].includes(b.role) && b.side) k *= clamp(n.leg[b.side], 0.1, 1);
				tension *= k;
			}
			tension = clamp(tension * limp * s.power, 0, 4);
			this.motor(b, tension, target);
		}
	}

	// The muscle: a spring and a damper that turn the bone toward its pose (rest pose, or the pose of a reaction), as torques on
	// the bone and, the other way, on its parent. tension 0 = limp, 1 = the muscle tone as set.
	motor(b, tension, target) {
		if (tension <= 0.01) return;
		const {world} = this;
		const p = b.parent.entry, c = b.entry;
		const qp = bodyQuat(p), qc = bodyQuat(c);
		if (!target) target = b.rest_local;
		const err = qp.clone().multiply(target).multiply(qc.clone().invert());
		if (err.w < 0) { err.x = -err.x; err.y = -err.y; err.z = -err.z; err.w = -err.w; }
		const angle = 2 * Math.acos(clamp(err.w, -1, 1)), s = Math.sqrt(Math.max(0, 1 - err.w * err.w));
		const axis = s > 1e-6 ? new THREE.Vector3(err.x / s, err.y / s, err.z / s) : new THREE.Vector3();
		const wc = c.body.GetAngularVelocity(), wp = p.body.GetAngularVelocity();
		const rel = new THREE.Vector3(wc.GetX() - wp.GetX(), wc.GetY() - wp.GetY(), wc.GetZ() - wp.GetZ());
		const f = 1.5 + 5 * Math.min(tension, 1.4), omega = 2 * Math.PI * f;
		const len = Math.max(0.12, b.length / SCALE);
		const heavy = b.load, inertia = heavy * len * len / 3;
		const torque = axis.multiplyScalar(inertia * omega * omega * angle).addScaledVector(rel, -2 * inertia * omega);
		const limit = 22 * heavy * Math.min(tension, 1.4);
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
// Blood (as in the Blood project): drops that fly and fall, sprays from a hit, a pulsing jet from an artery, pools that spread and dry
// ---------------------------------------------------------------------------

class BloodFX {
	constructor(rt) {
		this.g = ((rt.ws && rt.ws.gravity) || 9.81) * SCALE;
		this.ground = -1e6;
		if (!rt.ws || rt.ws.ground !== false) { try { this.ground = Project.model_3d.localToWorld(new THREE.Vector3(0, (rt.ws && rt.ws.ground_y) || 0, 0)).y; } catch (err) { this.ground = (rt.ws && rt.ws.ground_y) || 0; } }
		this.max_drops = 900; this.max_pools = 240;
		this.drops = [];   // {x,y,z,vx,vy,vz,ml}
		this.pools = [];   // {x,z,area,sx,sz,rot,t0,age}
		this.time = 0;
		this.group = new THREE.Group();
		this.group.name = 'ragdoll_blood';
		this.drop_mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({color: 0xffffff}), this.max_drops);
		const flat = new THREE.CircleGeometry(1, 20); flat.rotateX(-Math.PI / 2);
		const mat = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
		this.pool_mesh = new THREE.InstancedMesh(flat, mat, this.max_pools);
		for (const m of [this.drop_mesh, this.pool_mesh]) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); }
		for (let i = 0; i < this.max_drops; i++) this.drop_mesh.setColorAt(i, new THREE.Color(0x8a0808));
		for (let i = 0; i < this.max_pools; i++) this.pool_mesh.setColorAt(i, new THREE.Color(0x600505));
		if (typeof scene != 'undefined') scene.add(this.group);
		this.pulse_acc = new Map();
	}

	// a drop: position and speed in px and px/s
	drop(pos, vel, ml) {
		if (this.drops.length >= this.max_drops) this.drops.shift();
		this.drops.push({x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, ml});
	}

	// a spray from a hit: forward (out of the body) wide, back (out of the entrance) narrow
	hit(point, dir, dmg, amount) {
		const n = Math.round((14 + 26 * Math.min(dmg, 3)) * amount);
		const d = dir.clone().normalize(), tmp = new THREE.Vector3();
		for (let i = 0; i < n; i++) {
			const fwd = i % 5 != 0, base = fwd ? d : d.clone().negate();
			tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(fwd ? 1.1 : 0.7).add(base).normalize();
			const speed = (1.5 + Math.random() * 4.5) * (fwd ? 1 : 0.6) * SCALE;
			this.drop(point, tmp.clone().multiplyScalar(speed), 0.2 + Math.random() * 0.5);
		}
	}

	// a wound: seeps (drops from the skin) or, if it is an artery, a jet that pulses 1.7 times a second
	wound(w, pos, normal, body_vel, dt, amount) {
		const share = w.rate0 > 0 ? w.rate / w.rate0 : 0;
		if (w.rate < 0.15) return;
		let n;
		if (w.arterial) {
			const pulse = Math.pow(Math.max(0, Math.sin(2 * Math.PI * 1.7 * (w.age))), 2);
			n = 220 * pulse * share * dt * amount;
		} else n = w.rate * 1.6 * dt * amount;
		const acc = (this.pulse_acc.get(w) || 0) + n;
		let k = Math.floor(acc);
		this.pulse_acc.set(w, acc - k);
		const dir = new THREE.Vector3();
		while (k-- > 0) {
			const spread = w.arterial ? 0.18 : 0.9;
			dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spread).add(normal).normalize();
			const speed = (w.arterial ? 3 + Math.random() * 2.5 : 0.1 + Math.random() * 0.6) * share * SCALE + 0.2;
			this.drop(pos, dir.clone().multiplyScalar(speed).addScaledVector(body_vel, 0.5 * SCALE), w.arterial ? 0.5 : 0.3);
		}
	}

	step(dt) {
		this.time += dt;
		const g = this.g;
		for (let i = this.drops.length - 1; i >= 0; i--) {
			const d = this.drops[i];
			d.vy -= g * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
			if (d.y <= this.ground + 0.03) { this.land(d); this.drops[i] = this.drops[this.drops.length - 1]; this.drops.pop(); }
			else if (d.y < this.ground - 200) { this.drops[i] = this.drops[this.drops.length - 1]; this.drops.pop(); }
		}
		for (const p of this.pools) p.age += dt;
	}

	// a drop lands: it makes the nearest pool grow or starts a new one (every landing is a splat: elongated in the direction of flight)
	land(d) {
		const area = d.ml * 0.4;
		let near = null, best = Infinity;
		for (const p of this.pools) {
			const dist = Math.hypot(p.x - d.x, p.z - d.z), r = Math.sqrt(p.area / Math.PI);
			if (dist < r * 0.85 + 0.25 && dist < best) { best = dist; near = p; }
		}
		if (near) { near.area = Math.min(near.area + area, 1500); near.age = Math.min(near.age, 20); return; }
		if (this.pools.length >= this.max_pools) this.pools.shift();
		const sp = Math.hypot(d.vx, d.vz), rot = sp > 1 ? Math.atan2(d.vx, d.vz) : Math.random() * 6.28;
		const stretch = 1 + Math.min(sp / (4 * SCALE), 0.8);
		this.pools.push({x: d.x, z: d.z, area: Math.max(area, 0.12), sx: 1 / Math.sqrt(stretch), sz: Math.sqrt(stretch), rot, age: 0, y: this.ground + 0.03 + this.pools.length * 0.0004});
	}

	show() {
		const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
		const dm = this.drop_mesh;
		dm.count = this.drops.length;
		this.drops.forEach((d, i) => { pos.set(d.x, d.y, d.z); const r = 0.22 + Math.cbrt(d.ml) * 0.45; sc.set(r, r, r); m.compose(pos, q.identity(), sc); dm.setMatrixAt(i, m); });
		dm.instanceMatrix.needsUpdate = true;
		const pm = this.pool_mesh;
		pm.count = this.pools.length;
		this.pools.forEach((p, i) => {
			const r = Math.sqrt(p.area / Math.PI), dry = clamp(p.age / 140, 0, 1);
			pos.set(p.x, p.y, p.z); q.setFromAxisAngle(up, p.rot); sc.set(r * p.sx, 1, r * p.sz);
			m.compose(pos, q, sc); pm.setMatrixAt(i, m);
			c.setRGB(0.5 - 0.3 * dry, 0.02, 0.02); pm.setColorAt(i, c);
		});
		pm.instanceMatrix.needsUpdate = true;
		if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
	}

	dispose() {
		if (this.group.parent) this.group.parent.remove(this.group);
		for (const m of [this.drop_mesh, this.pool_mesh]) { m.geometry.dispose(); m.material.dispose(); if (m.dispose) m.dispose(); }
	}
}

// ---------------------------------------------------------------------------
// The Blood project's person (scripts/bots/humanoid.gd), ported line by line.
//
// 15 rigid body parts on 6DOF joints with the anatomical limits of the game. Every joint has a muscle: a velocity servo
// on the joint motor that pulls the child part towards its target pose, its strength the joint's max torque times the
// muscle tone. A balance assist (support force + upright torque) keeps a conscious body standing; injuries, shock and
// stagger take it away, so the body falls and stays a real ragdoll. Health: blood, bleeding, shock, pain, legs and arms.
//
// The game runs Godot 4 + Jolt at 120 Hz; the Physics tab runs Jolt at 120 Hz too. A Godot Generic6DOFJoint3D on Jolt is
// a Jolt SixDOFConstraint (LocalToBodyCOM frames, pyramid swing, rotation limits and motor speeds negated by Godot);
// humanoid.gd negates them once more, so here the limits are the pose limits and the motor speed is `des` as computed.
// Everything inside is in metres (Jolt units); a Blockbench pixel is 1/16 m.
// ---------------------------------------------------------------------------

const HG = 9.81;
const BLOOD_MAX = 5000.0;
const HEADSHOT_SPASM = 1.5;
const HIT_PART_SPEED = 12;
const ITEM_DROP_DELAY = 0.7;   // s after death a held thing is let go   // m/s: the most a hit throws the part it struck (the rest of its push goes on into the body)
const POSTURES = ['stand', 'crouch', 'hands_up', 'cover_head', 'aim', 'kneel', 'squat', 'sit'];

const gv = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const gsmooth = (a, b, x) => { if (a == b) return x < a ? 0 : 1; const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const glerp = (a, b, t) => a + (b - a) * t;
const gmove = (from, to, delta) => Math.abs(to - from) <= delta ? to : from + Math.sign(to - from) * delta;
// Basis.from_euler / Quaternion.from_euler: Godot's default order YXZ (R = Ry * Rx * Rz), the same as three.js 'YXZ'
const gquat = e => new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x, e.y, e.z, 'YXZ'));
const geuler = q => { const e = new THREE.Euler().setFromQuaternion(q, 'YXZ'); return gv(e.x, e.y, e.z); };
// Basis.looking_at(target, up): -Z towards the target
function glook(fwd, up) {
	const z = fwd.clone().negate().normalize(), x = up.clone().cross(z).normalize(), y = z.clone().cross(x);
	return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
// rotation error of a quaternion as axis * angle (the shortest way)
function gerr(qe) {
	let x = qe.x, y = qe.y, z = qe.z, w = qe.w;
	if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
	const s = Math.hypot(x, y, z);
	if (s <= 1e-6) return gv();
	const a = 2 * Math.atan2(s, w) / s;
	return gv(x * a, y * a, z * a);
}
const glimit = (v, len) => { const l = v.length(); if (l > len && l > 0) v.multiplyScalar(len / l); return v; };
const gaxis = (q, i) => gv(i == 0 ? 1 : 0, i == 1 ? 1 : 0, i == 2 ? 1 : 0).applyQuaternion(q);

// The body (_build_body), before scaling: positions in the standing rest pose, feet at y=0, facing -Z, right side = +X.
// shape: capsule [radius, height (total)] with its rotation, or a box [x, y, z]
function humanoidParts() {
	const along_x = [0, 0, Math.PI * 0.5], none = [0, 0, 0];
	const parts = [];
	const add = (name, parent, center, shape, mass, joint, lo, hi, omega, max_torque, adamp) =>
		parts.push({name, parent, center: gv(...center), shape, mass, joint: joint ? gv(...joint) : null, lo: gv(...lo), hi: gv(...hi), omega, max_torque, adamp: adamp || 0.6});
	add('pelvis', '', [0, 0.97, 0], {cap: [0.125, 0.34], rot: along_x}, 10.5, null, [0, 0, 0], [0, 0, 0], 0, 0);
	add('abdomen', 'pelvis', [0, 1.14, 0], {cap: [0.115, 0.3], rot: along_x}, 10.3, [0, 1.05, 0], [-0.55, -0.45, -0.35], [0.3, 0.45, 0.35], 17, 380);
	add('chest', 'abdomen', [0, 1.36, 0], {cap: [0.14, 0.36], rot: along_x}, 16.0, [0, 1.245, 0], [-0.45, -0.4, -0.3], [0.3, 0.4, 0.3], 17, 380);
	add('head', 'chest', [0, 1.665, -0.01], {cap: [0.1, 0.26], rot: none}, 6.0, [0, 1.53, 0], [-0.8, -1.1, -0.5], [0.65, 1.1, 0.5], 15, 70);
	for (const side of ['r', 'l']) {
		const sx = side == 'r' ? 1 : -1;
		// left limits are mirrored on Y/Z
		const m = (lo, hi, want_hi) => {
			if (sx > 0) return want_hi ? hi : lo;
			const src = want_hi ? lo : hi, other = want_hi ? hi : lo;
			return [other[0], -src[1], -src[2]];
		};
		const arm_lo = [-0.9, -1.3, -0.7], arm_hi = [2.8, 1.3, 2.6];
		add('upper_arm_' + side, 'chest', [0.25 * sx, 1.3, 0], {cap: [0.052, 0.3], rot: none}, 2.1, [0.25 * sx, 1.43, 0], m(arm_lo, arm_hi, false), m(arm_lo, arm_hi, true), 14, 130);
		const fa_lo = [0, -1.3, 0], fa_hi = [2.5, 1.3, 0];
		add('forearm_' + side, 'upper_arm_' + side, [0.25 * sx, 1.02, 0], {cap: [0.043, 0.28], rot: none}, 1.2, [0.25 * sx, 1.155, 0], m(fa_lo, fa_hi, false), m(fa_lo, fa_hi, true), 12, 80, 1.5);
		// (a wrist bends only so far, and the light hand is held firmly: with a loose one it whipped about at the end of every swing)
		const h_lo = [-0.6, -0.1, -0.25], h_hi = [0.6, 0.1, 0.3];
		add('hand_' + side, 'forearm_' + side, [0.25 * sx, 0.79, -0.005], {box: [0.05, 0.17, 0.09]}, 0.55, [0.25 * sx, 0.88, 0], m(h_lo, h_hi, false), m(h_lo, h_hi, true), 11, 32, 4.0);
		const hip_lo = [-0.45, -0.6, -0.35], hip_hi = [2.1, 0.6, 0.9];
		add('thigh_' + side, 'pelvis', [0.1 * sx, 0.72, 0], {cap: [0.077, 0.44], rot: none}, 7.4, [0.1 * sx, 0.92, 0], m(hip_lo, hip_hi, false), m(hip_lo, hip_hi, true), 18, 480);
		add('shin_' + side, 'thigh_' + side, [0.1 * sx, 0.29, 0], {cap: [0.056, 0.44], rot: none}, 3.45, [0.1 * sx, 0.505, 0], [-2.5, 0, 0], [0, 0, 0], 18, 380);
		const an_lo = [-0.75, -0.15, -0.25], an_hi = [0.65, 0.15, 0.25];   // (a deep squat needs the ankle well bent up)
		add('foot_' + side, 'shin_' + side, [0.1 * sx, 0.04, -0.05], {box: [0.095, 0.075, 0.25]}, 1.07, [0.1 * sx, 0.08, 0], m(an_lo, an_hi, false), m(an_lo, an_hi, true), 14, 140);
	}
	return parts;
}
let humanoid_parts_cache = null;
const humanoidPartsList = () => humanoid_parts_cache || (humanoid_parts_cache = humanoidParts());
// a part of the game -> the bone of a character made here (role, side)
const humanoidRole = name => {
	const base = name.replace(/_[rl]$/, '');
	return {role: ({upper_arm: 'upperarm'})[base] || base, side: /_r$/.test(name) ? 1 : /_l$/.test(name) ? -1 : 0};
};

// The standing pose the muscles hold (_compose_pose with no walking), and the legs of the held poses (HOLD_LEGS).
let hold_legs_cache = null;
const holdLegs = () => hold_legs_cache || (hold_legs_cache = {
	squat: [0.35, gv(1.9, 0.12, 0.35), gv(-2.35, 0, 0), gv(0.55, 0, 0)],
	kneel: [0.0, gv(0.06, 0.0, 0.06), gv(-1.57, 0, 0), gv(-1.25, 0, 0)],
	sit: [-0.08, gv(1.57, 0.05, 0.12), gv(-1.5, 0, 0), gv(0.0, 0, 0)],
});

// The pose a character is made in: joint angles per part (right side; the left one mirrored), in radians (Godot euler)
function humanoidPose(posture) {
	const a = {upper_arm: gv(0.05, 0, 0.08), forearm: gv(0.2, 0, 0), hand: gv(0.1, 0, 0), thigh: gv(0, 0, 0.04), shin: gv(-0.06, 0, 0), foot: gv(0, 0, 0)};
	const t = {abdomen: gv(), chest: gv(), head: gv()};
	if (holdLegs()[posture]) { const l = holdLegs()[posture]; a.thigh = l[1].clone(); a.shin = l[2].clone(); a.foot = l[3].clone(); t.pelvis_lean = l[0]; }
	return {a, t};
}

class Humanoid {
	constructor(rt, root, bones) {
		this.root = root;
		this.s = ragdollOf(root);
		this.J = rt.Jolt;
		this.rt = rt;
		this.world = rt.world;
		this.blood = null;          // the blood (BloodSim), set by the hook
		this.log = [];
		this.time = 0;
		this.pending = [];
		this.hits = (this.s.hits || []).map(h => Object.assign({}, h)).sort((a, b) => a.t - b.t);
		this.next_hit = 0;
		this.is_humanoid = true;
		// --- Control inputs (no mind here: standing where he was put, looking ahead) ---
		this.move_velocity = gv();
		this.heading = null;        // where he faces while he walks a route (null: the way he was put)
		this.route = null;          // {points (metres, world), speed, mode, kill_at}: set by the ragdoll runtime
		this._route_s = 0; this._route_dir = 1; this._route_done = false;
		this.posture = POSTURES.includes(this.s.posture) || this.s.posture == 'custom' ? this.s.posture : 'stand';
		this.clutch_part = '';
		this.has_look_target = false;
		// --- State ---
		this.alive = true; this.conscious = true; this.fallen = false;
		this.tone = 1.0; this.support = 1.0;
		this.blood_ml = BLOOD_MAX; this.bleed_rate = 0.0; this.shock = 0.0; this.pain = 0.0;
		this.leg_health = {l: 1.0, r: 1.0}; this.arm_health = {l: 1.0, r: 1.0};
		this.brain_dead = false;
		this._phase = 0; this._stagger = 0; this._flinch = 0; this._flinch_dir = gv(); this._stumble = 0; this._stumble_dir = gv();
		this._fallen_time = 0; this._getup = 0; this._getup_delay = 2.0; this._death_t = -1; this._death_kind = '';
		this._time = 0; this._limp = false; this._unbalanced_t = 0; this._blast_until = -1;
		this._squat_at = null; this._squat_feet = [];
		this._head_wound = null;
		this._ik_last = {};
		this.SQ_THIGH = 1.85; this.SQ_SHIN = -2.3; this.SQ_FOOT = 0.4; this.SQ_LEAN = 0.25;
		this._held_pose = false; this._hold_t = 0; this._hold_blend = 0; this._hold_from = []; this._hold_angle = []; this._hold_at = null; this._hold_cool = 0;
		this.seat = null;
		this.rng = mulberry(hashString(root.uuid));
		this.build(bones);
		// the pose he is made in (as the bones are turned in Blockbench): the joint angles and how the hips are turned.
		// A held pose (sat, knelt, squatting) keeps it as it is, a hand put on the knee or up by the face included
		this.start_angles = this.parts.map(p => p.parent < 0 ? gv() : geuler(this.quat(this.parts[p.parent]).invert().multiply(this.quat(p))));
		const look = glook(this.facing(), gv(0, 1, 0)).invert();
		this.start_pelvis = look.clone().multiply(this.quat(this.pelvis));
		// a pose made with the skeleton: its joint angles are what the muscles hold, the hips are held at the height they are
		if (this.posture == 'custom') {
			this.custom_targets = this.start_angles.map(a => a.clone());
			this.custom_pelvis = this.start_pelvis.clone();
			this.custom_chest = look.clone().multiply(this.quat(this.chest));
			const h = this._ground_distance();
			this.custom_h = h > 0 ? h : this.stand_height;
		}
		// arms turned by hand in Blockbench (the rotate tool, a pose applied) while the posture is one of the standard ones:
		// they keep the pose they were given - a thing held up stays up - instead of dropping to hang by his sides
		this.held_arms = {};
		if (!this.custom_targets) {
			const relaxed = {upper_arm: gv(0.05, 0, 0.08), forearm: gv(0.2, 0, 0)};
			for (const side of ['r', 'l']) for (const part of ['upper_arm', 'forearm']) {
				const i = this.part_index[part + '_' + side];
				if (i === undefined) continue;
				const e = side == 'l' ? gv(relaxed[part].x, -relaxed[part].y, -relaxed[part].z) : relaxed[part];
				if (this.start_angles[i].distanceTo(e) > 0.35) this.held_arms[side] = true;
			}
		}
		// already settled in a held pose (sat on his chair, down on his knees): placed at once, not got down into
		if (this._hold_kind()) { this._hold_t = 0.3; this._compose_pose(0); this._update_squat_hold(0, true); }
	}

	// ---- Construction: the parts made by the Physics tab get the game's shapes, masses, damping and joints ----
	build(bones) {
		const {J, world} = this;
		const entryOf = g => world.entries.find(e => e.desc.node === g && !e.broken) || null;
		const find = (role, side) => bones.find(g => roleOf(g) == role && (!side || sideOfGroup(g, bones) == side));
		// the scale and place of this character: from the thigh (hip to knee is 0.415 m at scale 1) and the hips
		const th = find('thigh', 1), sh = find('shin', 1), pv = find('pelvis');
		const s = (new THREE.Vector3(...th.origin).distanceTo(new THREE.Vector3(...sh.origin)) / SCALE) / 0.415;
		this.scale_factor = s;
		const root_m = this.modelMatrix();
		// rest pose (no rotations) of the game in this character's model space (metres), then in the world
		const offset = new THREE.Vector3(...pv.origin).divideScalar(SCALE).sub(gv(0, 0.97 * s, 0));
		this.rest_offset = offset;
		this.rest_rot = new THREE.Quaternion().setFromRotationMatrix(root_m);
		const restWorld = p => p.clone().multiplyScalar(s).add(offset).multiplyScalar(SCALE).applyMatrix4(root_m).divideScalar(SCALE);
		this.parts = [];
		this.part_index = {};
		this.total_mass = 0;
		for (const d of humanoidPartsList()) {
			const {role, side} = humanoidRole(d.name);
			const g = find(role, side);
			const entry = g && entryOf(g);
			if (!entry) throw new Error('missing part ' + d.name);
			const idx = this.parts.length;
			const p = {name: d.name, group: g, entry, id: entry.id, body: entry.body, parent: d.parent ? this.part_index[d.parent] : -1,
				omega: d.omega, max_torque: d.max_torque * s * s * s, target: gv(), weak: 1, hit_weak: 1, joint: null, motor_limit: -1,
				arm: /^(upper_arm|forearm|hand)/.test(d.name) ? 1 : 0, mass: d.mass * s * s * s, adamp: d.adamp,
				rest_pos: d.center.clone().multiplyScalar(s), joint_pos: d.joint ? d.joint.clone().multiplyScalar(s) : null,
				pivot_rest: new THREE.Vector3(...g.origin).divideScalar(SCALE).sub(offset), severed: false};
			this.parts.push(p);
			this.part_index[d.name] = idx;
			this.total_mass += p.mass;
			this.shapeFor(p, d, s);
		}
		this.pelvis = this.parts[this.part_index.pelvis];
		this.chest = this.parts[this.part_index.chest];
		this.head = this.parts[this.part_index.head];
		this.stand_height = 0.975 * s;
		this.restWorld = restWorld;
		// collisions: the joined parts do not touch each other (a Godot joint excludes its two bodies), and folded up the
		// arms lie on the legs and the heels under the seat: those pairs would keep the muscles pushing - a constant tremble
		const items = [...Group.all, ...Cube.all, ...Mesh.all].filter(n => n.attach && n.attach.root == this.root.uuid);
		this.items = [];
		for (const node of items) {
			const entry = entryOf(node), holder = this.parts.find(pp => pp.group.uuid == node.attach.bone);
			if (entry && holder) {
				const other = node.attach.hands == 'both' ? this.parts[this.part_index[holder.name == 'hand_l' ? 'hand_r' : 'hand_l']] : null;
				this.items.push({node, entry, holder, drop: node.attach.drop !== false, constraint: null, other, other_constraint: null,
					grip: node.attach.grip ? gv(...node.attach.grip).divideScalar(SCALE) : null, grip_other: node.attach.grip_other ? gv(...node.attach.grip_other).divideScalar(SCALE) : null});
			}
		}
		const n = this.parts.length;
		const filter = new J.GroupFilterTable(n + this.items.length);
		const off = (a, b) => filter.DisableCollision(this.part_index[a], this.part_index[b]);
		for (const p of this.parts) if (p.parent >= 0) filter.DisableCollision(this.parts.indexOf(p), p.parent);
		for (const side of ['r', 'l']) {
			for (const arm of ['forearm_', 'hand_', 'upper_arm_']) for (const leg of ['thigh_r', 'thigh_l', 'shin_r', 'shin_l']) off(arm + side, leg);
			for (const other of ['thigh_r', 'thigh_l', 'pelvis']) off('foot_' + side, other);
			off('shin_' + side, 'pelvis');
		}
		const group_id = Math.floor(Math.random() * 1e6) + 1;
		this.parts.forEach((p, i) => {
			const cg = p.body.GetCollisionGroup();
			cg.SetGroupFilter(filter); cg.SetGroupID(group_id); cg.SetSubGroupID(i);
			p.body.SetAllowSleeping(false);
			// the start speed is the one set for it, not the Physics tab's random "chaos" kick
			world.tmp.Set(0, 0, 0);
			world.bodies.SetLinearVelocity(p.id, world.tmp);
			world.bodies.SetAngularVelocity(p.id, world.tmp);
		});
		this.items.forEach((it, i) => {
			const sub = n + i;
			const cg = it.entry.body.GetCollisionGroup();
			cg.SetGroupFilter(filter); cg.SetGroupID(group_id); cg.SetSubGroupID(sub);
			this.parts.forEach((p, k) => filter.DisableCollision(sub, k));
			it.entry.body.SetAllowSleeping(false);
			world.tmp.Set(0, 0, 0);
			world.bodies.SetLinearVelocity(it.entry.id, world.tmp);
			world.bodies.SetAngularVelocity(it.entry.id, world.tmp);
			try {
				// in the hand: its grip is put in the fist (the hand closes on it), then it is held there
				// (the grip is the point of it nearest the hand as it is now: the arm may have been posed or the thing turned in
				// the hand since it was given to him - the point found then could be its far end. Already touching the hand,
				// it stays exactly where it was put)
				if (it.grip) {
					const palm = this.pos(it.holder), grip_w = this.nearestOnItem(it, palm);
					if (grip_w && grip_w.distanceTo(palm) > 0.03) {
						const bp = it.entry.body.GetPosition();
						const np = new J.RVec3(bp.GetX() + palm.x - grip_w.x, bp.GetY() + palm.y - grip_w.y, bp.GetZ() + palm.z - grip_w.z);
						world.bodies.SetPosition(it.entry.id, np, J.EActivation_Activate);
						J.destroy(np);
					}
				}
				const st = new J.FixedConstraintSettings();
				st.mSpace = J.EConstraintSpace_WorldSpace;
				st.mAutoDetectPoint = true;
				it.constraint = J.castObject(st.Create(it.holder.body, it.entry.body), J.FixedConstraint);
				world.system.AddConstraint(it.constraint);
			} catch (err) { console.warn('[Ragdoll] item', err); }
		});
		this.filter = filter;
		this.ray_exclude = new Set(this.parts.map(p => p.id.GetIndexAndSequenceNumber()));
		// (what he holds is part of him for the rays that look for the ground under him)
		addPeopleToRays(this.rt, this.parts.map(p => p.id).concat(this.items.map(it => it.entry.id)));
		for (const p of this.parts) if (p.parent >= 0) this.makeJoint(p);
		this._set_limp(false, true);
		// a seat under him (sat on a chair)
		if (this.posture == 'sit' || this.posture == 'custom') {
			const pp = this.pos(this.pelvis);
			const hit = this.ray(pp, gv(0, -0.8 * s, 0));
			// (the seat is a little behind the hips: the held pose puts them 6 cm ahead of it, where they are now)
		if (hit) this.seat = hit.position.clone().addScaledVector(this.facing(), -0.06);
		}
	}

	modelMatrix() {
		try { if (typeof Project != 'undefined' && Project.model_3d) { Project.model_3d.updateMatrixWorld(true); return Project.model_3d.matrixWorld.clone(); } } catch (err) { /* none */ }
		return new THREE.Matrix4();
	}

	// the game's collision shape on the body, centred on the part's centre (the body itself stays where the bone's pivot is)
	shapeFor(p, d, s) {
		const {J, world} = this;
		let shape, rot = new THREE.Quaternion(), volume;
		if (d.shape.cap) {
			const r = d.shape.cap[0] * s, h = d.shape.cap[1] * s;
			const half = Math.max(0.001, h * 0.5 - r);
			shape = new J.CapsuleShapeSettings(half, r);
			rot = gquat(gv(...d.shape.rot));
			volume = Math.PI * r * r * half * 2 + 4 / 3 * Math.PI * r * r * r;
			p.shape = {kind: 'capsule', radius: r, height: h, rot};
		} else {
			const e = d.shape.box.map(v => v * s * 0.5);
			shape = new J.BoxShapeSettings(new J.Vec3(e[0], e[1], e[2]), Math.min(0.05, Math.min(...e) * 0.9));
			volume = e[0] * e[1] * e[2] * 8;
			p.shape = {kind: 'box', size: gv(e[0] * 2, e[1] * 2, e[2] * 2), rot};
		}
		shape.mDensity = p.mass / volume;
		// the centre of the part relative to the pivot of its bone, in the bone's frame (= the rest frame)
		const c = p.rest_pos.clone().sub(p.pivot_rest);
		p.com_local = c;
		const rts = new J.RotatedTranslatedShapeSettings(new J.Vec3(c.x, c.y, c.z), new J.Quat(rot.x, rot.y, rot.z, rot.w), shape);
		const res = rts.Create();
		const made = res.Get();
		world.bodies.SetShape(p.id, made, true, J.EActivation_Activate);
		p.body.SetFriction(0.85);
		p.body.SetRestitution(0.0);
		try { world.bodies.SetMotionQuality(p.id, J.EMotionQuality_Discrete); } catch (err) { /* old Jolt */ }
	}

	// a Godot Generic6DOFJoint3D on Jolt (see the top of this file)
	makeJoint(p) {
		const {J, world} = this;
		const par = this.parts[p.parent];
		const st = new J.SixDOFConstraintSettings();
		st.mSpace = J.EConstraintSpace_LocalToBodyCOM;
		const a = p.joint_pos.clone().sub(par.rest_pos), b = p.joint_pos.clone().sub(p.rest_pos);
		st.mPosition1 = new J.RVec3(a.x, a.y, a.z);
		st.mPosition2 = new J.RVec3(b.x, b.y, b.z);
		st.mAxisX1 = new J.Vec3(1, 0, 0); st.mAxisY1 = new J.Vec3(0, 1, 0);
		st.mAxisX2 = new J.Vec3(1, 0, 0); st.mAxisY2 = new J.Vec3(0, 1, 0);
		st.mSwingType = J.ESwingType_Pyramid;
		const AX = this.axes();
		for (const t of [AX.tx, AX.ty, AX.tz]) st.MakeFixedAxis(t);
		const d = humanoidPartsList()[this.parts.indexOf(p)];
		// the pose he is made in is always one he can be in: where it goes past the game's limits of a joint (an arm posed
		// by hand: the shoulder out, the forearm up), the limits are widened to take it in - otherwise the joint snaps back
		// to its limit at the first step and the muscles can never hold the pose
		const now = this.jointAngles(par, p);
		const lim = {olo: [], ohi: [], lo: [], hi: [], free: []};
		[AX.rx, AX.ry, AX.rz].forEach((axis, i) => {
			let lo = [d.lo.x, d.lo.y, d.lo.z][i], hi = [d.hi.x, d.hi.y, d.hi.z][i];
			const cap = i == 0 ? Math.PI : Math.PI - 0.05;
			if (lo > hi) { st.MakeFreeAxis(axis); lim.free.push(true); lim.olo.push(-cap); lim.ohi.push(cap); lim.lo.push(-cap); lim.hi.push(cap); return; }
			lim.free.push(false); lim.olo.push(lo); lim.ohi.push(hi);
			lo = Math.max(-cap, Math.min(lo, now[i] - 0.12)); hi = Math.min(cap, Math.max(hi, now[i] + 0.12));
			lim.lo.push(lo); lim.hi.push(hi);
			st.SetLimitedAxis(axis, lo, hi);
		});
		// (widened only for the pose he was made in: given back to the ragdoll, the joint closes back to its own limits)
		p.lim = lim.lo.some((v, i) => v < lim.olo[i] - 1e-6) || lim.hi.some((v, i) => v > lim.ohi[i] + 1e-6) ? lim : null;
		const c = J.castObject(st.Create(par.body, p.body), J.SixDOFConstraint);
		J.destroy(st);
		for (const axis of [AX.rx, AX.ry, AX.rz]) c.SetMotorState(axis, J.EMotorState_Velocity);
		world.system.AddConstraint(c);
		p.joint = c;
	}

	// the turn of a joint now as Jolt's 6DOF measures it: twist about X, then the swing about Y and Z
	jointAngles(par, p) {
		const r = this.quat(par).invert().multiply(this.quat(p));
		if (r.w < 0) { r.x = -r.x; r.y = -r.y; r.z = -r.z; r.w = -r.w; }
		const tw = Math.hypot(r.x, r.w) > 1e-9 ? new THREE.Quaternion(r.x, 0, 0, r.w).normalize() : new THREE.Quaternion();
		const sw = r.clone().multiply(tw.clone().invert());
		return [2 * Math.atan2(tw.x, tw.w), 2 * Math.atan2(sw.y, sw.w), 2 * Math.atan2(sw.z, sw.w)];
	}

	axes() {
		const J = this.J;
		const pick = n => J['SixDOFConstraintSettings_EAxis_' + n] !== undefined ? J['SixDOFConstraintSettings_EAxis_' + n] : J['EAxis_' + n];
		return this._axes || (this._axes = {tx: pick('TranslationX'), ty: pick('TranslationY'), tz: pick('TranslationZ'), rx: pick('RotationX'), ry: pick('RotationY'), rz: pick('RotationZ')});
	}

	// ---- the state of a part (Godot: global_position is the centre of mass, global_basis its rotation) ----
	pos(p) { const c = p.body.GetCenterOfMassPosition(); return gv(c.GetX(), c.GetY(), c.GetZ()); }
	quat(p) { const r = p.body.GetRotation(); return new THREE.Quaternion(r.GetX(), r.GetY(), r.GetZ(), r.GetW()); }
	lin(p) { const v = p.body.GetLinearVelocity(); return gv(v.GetX(), v.GetY(), v.GetZ()); }
	ang(p) { const v = p.body.GetAngularVelocity(); return gv(v.GetX(), v.GetY(), v.GetZ()); }
	setLin(p, v) { this.world.tmp.Set(v.x, v.y, v.z); this.world.bodies.SetLinearVelocity(p.id, this.world.tmp); }
	setAng(p, v) { this.world.tmp.Set(v.x, v.y, v.z); this.world.bodies.SetAngularVelocity(p.id, this.world.tmp); }
	force(p, f) { if (!isFinite(f.x + f.y + f.z)) return; this.world.tmp.Set(f.x, f.y, f.z); this.world.bodies.AddForce(p.id, this.world.tmp, this.J.EActivation_Activate); }
	torque(p, t) { if (!isFinite(t.x + t.y + t.z)) return; this.world.tmp.Set(t.x, t.y, t.z); this.world.bodies.AddTorque(p.id, this.world.tmp, this.J.EActivation_Activate); }
	toWorld(p, local) { return local.clone().applyQuaternion(this.quat(p)).add(this.pos(p)); }
	toLocal(p, world_p) { return world_p.clone().sub(this.pos(p)).applyQuaternion(this.quat(p).invert()); }
	basis(p, i) { return gaxis(this.quat(p), i); }
	jointWorld(p) { const par = this.parts[p.parent]; return this.toWorld(par, p.joint_pos.clone().sub(par.rest_pos)); }

	// A ray against the world (not against this body): {position, normal, id} or null
	ray(from, dir_len) { return castRay(this.rt, from, dir_len, rayFilters(this.rt).people); }

	// a point of a held item (in its own frame, metres) in the world
	// the point of a held thing's shapes (its boxes) nearest to `p` (metres); null when it has none
	nearestOnItem(it, p) {
		const b = it.entry.body, bp = b.GetPosition(), br = b.GetRotation();
		const bm = new THREE.Matrix4().compose(gv(bp.GetX(), bp.GetY(), bp.GetZ()), new THREE.Quaternion(br.GetX(), br.GetY(), br.GetZ(), br.GetW()), gv(1, 1, 1));
		let best = null, best_d = Infinity;
		for (const part of it.entry.desc.parts || []) {
			let center, rot, half;
			if (part.kind == 'box') { center = part.center; rot = part.rot; half = part.half; }
			else if (part.points && part.points.length) {
				const box = new THREE.Box3().setFromPoints(part.points), size = box.getSize(gv());
				center = box.getCenter(gv()); rot = new THREE.Quaternion(); half = [size.x / 2, size.y / 2, size.z / 2];
			} else continue;
			// (shapes are in pixels about the body's pivot)
			const m = bm.clone().multiply(new THREE.Matrix4().compose(center.clone().divideScalar(SCALE), rot, gv(1, 1, 1)));
			const local = p.clone().applyMatrix4(m.clone().invert());
			local.set(clamp(local.x, -half[0] / SCALE, half[0] / SCALE), clamp(local.y, -half[1] / SCALE, half[1] / SCALE), clamp(local.z, -half[2] / SCALE, half[2] / SCALE));
			const w = local.applyMatrix4(m), d = w.distanceTo(p);
			if (d < best_d) { best_d = d; best = w; }
		}
		return best;
	}

	itemPoint(it, local) {
		const b = it.entry.body, p = b.GetPosition(), r = b.GetRotation();
		return local.clone().applyQuaternion(new THREE.Quaternion(r.GetX(), r.GetY(), r.GetZ(), r.GetW())).add(gv(p.GetX(), p.GetY(), p.GetZ()));
	}

	// held in both hands: the other hand reaches for its grip (as the game's hands reach for a gun's forend) and closes on it
	_update_grips() {
		const J = this.J;
		for (const it of this.items) {
			if (!it.other || !it.grip_other || !it.constraint || it.other_constraint) continue;
			const goal = this.itemPoint(it, it.grip_other);
			if (this.pos(it.other).distanceTo(goal) > 0.05 * this.scale_factor) continue;
			try {
				const st = new J.PointConstraintSettings();
				st.mSpace = J.EConstraintSpace_WorldSpace;
				// (the fist itself goes onto the grip: its middle to that point)
				const fist = this.pos(it.other);
				st.mPoint1 = new J.RVec3(fist.x, fist.y, fist.z);
				st.mPoint2 = new J.RVec3(goal.x, goal.y, goal.z);
				it.other_constraint = J.castObject(st.Create(it.other.body, it.entry.body), J.PointConstraint);
				this.world.system.AddConstraint(it.other_constraint);
			} catch (err) { console.warn('[Ragdoll] grip', err); it.other = null; }
		}
	}

	// ---- Simulation ----

	step(dt) {
		this.pending.splice(0).forEach(h => this.applyHit(h));
		while (this.next_hit < this.hits.length && this.hits[this.next_hit].t <= this.time + 1e-9) this.applyHit(this.hits[this.next_hit++]);
		this._time += dt;
		this._update_health(dt);
		this._update_state(dt);
		this._follow_route(dt);
		this._compose_pose(dt);
		this._apply_muscles();
		if (this.support > 0.001) this._apply_balance();
		this._update_squat_hold(dt);
		this._update_grips();
		this._limit_speed();
		this._relax_limits();
		if (this._drop_at !== undefined && this._time >= this._drop_at) { this._drop_at = undefined; this._drop_items(); }
		this.time += dt;
	}

	// a part of a person squeezed into something can be shot out of it at silly speeds: no part moves faster than a blast throws it
	_limit_speed() {
		// (not right after a hit: the joints must first pass its push on to the rest of the body - a head shot moves the
		// whole person, not only the head; clipping it here threw most of a strong hit away)
		if (this._time < (this._hit_until || 0)) return;
		const cap = this._time < this._blast_until ? 60 : 22;
		for (const p of this.parts) {
			const v = this.lin(p);
			if (v.lengthSq() > cap * cap) this.setLin(p, v.normalize().multiplyScalar(cap * 0.6));
			const w = this.ang(p);
			if (w.lengthSq() > 1600) this.setAng(p, w.normalize().multiplyScalar(30));
		}
	}

	_update_health(delta) {
		if (!this.alive) return;
		this.blood_ml = Math.max(this.blood_ml - this.bleed_rate * delta, 0);
		// small wounds slowly clot
		if (this.bleed_rate < 12) this.bleed_rate = Math.max(this.bleed_rate - delta * 0.3, 0);
		else this.bleed_rate = Math.max(this.bleed_rate * (1 - delta * 0.02), 12);   // torn vessels clamp down, slowly
		this.shock = Math.max(this.shock - delta * 0.015, 0);
		this.pain = Math.max(this.pain - delta * 0.08, 0);
		this._stagger = Math.max(this._stagger - delta * 1.4, 0);
		// muscle knocked out by a hit comes back over the best part of a second
		for (const p of this.parts) if (p.hit_weak < 1) p.hit_weak = Math.min(p.hit_weak + delta * 1.2, 1);
		this._flinch = Math.max(this._flinch - delta * 1.8, 0);
		if (this._stumble > 0) {
			this._stumble = Math.max(this._stumble - delta * 0.75, 0);
			// bad legs do not catch the stumble
			if (this._stumble <= 0 && !this.fallen && Math.min(this.leg_health.l, this.leg_health.r) < 0.5 && this.rng() < 0.6) this._fall();
		}
		const frac = this.blood_ml / BLOOD_MAX;
		const was_conscious = this.conscious;
		this.conscious = frac > 0.55 && this.shock < 1.0;
		if (was_conscious && !this.conscious) this._start_death_curve('faint');
		// (out cold only briefly before the end)
		if (frac < 0.475) this._die('bleed_out');
	}

	// standing ability from legs, shock and blood
	mobility() {
		const legs = Math.min(this.leg_health.l, this.leg_health.r) * 0.6 + (this.leg_health.l + this.leg_health.r) * 0.2;
		const frac = this.blood_ml / BLOOD_MAX;
		return clamp(legs * (1 - this.shock * 0.5) * clamp((frac - 0.55) / 0.2, 0, 1), 0, 1);
	}

	// loose limbs: little damping once there is no muscle tone to hold them (Godot adds the project's default damping, 0.1)
	_set_limp(on, force) {
		if (on == this._limp && !force) return;
		this._limp = on;
		this.parts.forEach(p => {
			const mp = p.body.GetMotionProperties();
			const a = force ? p.adamp : (on ? 0.12 : 0.6), l = force ? 0.05 : (on ? 0.02 : 0.05);
			mp.SetAngularDamping(a + 0.1);
			mp.SetLinearDamping(l + 0.1);
		});
	}

	_update_state(delta) {
		this._set_limp(this.tone < 0.2);
		// muscle tone envelope after a fatal / unconscious event
		if (this._death_t >= 0) {
			this._death_t += delta;
			if (this._death_kind == 'headshot') {
				// brain shot: postural tone is gone almost at once and the body drops; what is left is a weak, brief
				// involuntary stiffening (mostly arms) that fades smoothly over about a second
				if (this._death_t < 0.1) this.tone = glerp(this.tone, 0.32, this._death_t / 0.1);
				else {
					const k = clamp((this._death_t - 0.1) / (HEADSHOT_SPASM - 0.1), 0, 1);
					this.tone = glerp(0.32, 0.02, 1 - Math.pow(1 - k, 2));
				}
			} else {
				const k = clamp(this._death_t / 1.4, 0, 1);
				this.tone = glerp(this.tone, this.alive ? 0.08 : 0.03, k * 0.2);
			}
			this.support = 0;
			if (this._death_t > 6 && !this.alive && !this._sleepy) { this._sleepy = true; this.parts.forEach(p => p.body.SetAllowSleeping(true)); }
			return;
		}
		const ph = this.pos(this.pelvis);
		const up_p = this.basis(this.pelvis, 1), up_c = this.basis(this.chest, 1);
		const h = this._ground_distance();
		// (squatting the trunk leans well forward over the knees on purpose)
		const tipped = up_p.y < 0.45 || up_c.y < (this.posture == 'squat' ? 0.2 : 0.35);
		if (!this.fallen) {
			const low = ['crouch', 'kneel', 'squat', 'sit'].includes(this.posture) || (this.posture == 'custom' && (!!this.seat || this.custom_h < this.stand_height * 0.6));
			if (tipped || (h > 0 && h < this.stand_height * 0.42 && !low) || this.mobility() < 0.2) this._fall(tipped ? 'tipped' : this.mobility() < 0.2 ? 'mobility' : 'low');
			else if (!(this.posture == 'sit' && this.seat) && this._out_of_balance(delta)) this._fall('balance');   // (sat on a chair he is not balancing on his feet)
		} else {
			this._fallen_time += delta;
			const slow = this.lin(this.pelvis).length() < 0.6;
			if (this._getup <= 0) {
				if (slow && this._fallen_time > this._getup_delay && this.mobility() > 0.45 && this.conscious) this._getup = 0.001;
			} else {
				this._getup += delta;
				if (this._getup > 3) { this.fallen = false; this._getup = 0; this._fallen_time = 0; }
			}
		}
		// support is how much balance assist is available right now
		let target_support = 0;
		if (this.conscious && this.alive) {
			if (!this.fallen) target_support = this.mobility() * (1 - clamp(this._stagger, 0, 1)) * (1 - 0.3 * this._stumble);
			else if (this._getup > 0) target_support = gsmooth(0.4, 2.4, this._getup) * this.mobility();
		}
		this.support = gmove(this.support, target_support, delta * (target_support < this.support ? 6 : 1.5));
		// knocked down but awake: loose, bracing, not a stiff plank; firm again to get up
		let awake_tone = this.fallen && this._getup <= 0 ? 0.35 : 1.0;
		if (this.fallen && this._getup <= 0 && this._fallen_time < 1.2 && this.conscious) awake_tone = 0.85;   // bracing to catch the fall
		// losing blood, the muscles give out bit by bit
		awake_tone *= glerp(0.55, 1.0, clamp((this.blood_ml / BLOOD_MAX - 0.55) / 0.35, 0, 1));
		this.tone = gmove(this.tone, (this.conscious ? awake_tone : 0.08) * (1 - this.shock * 0.3), delta * (awake_tone < this.tone ? 4 : 2));
		if (!this.fallen && ph.y < -5 + this.groundY()) this._die('fell');
	}

	// Balance has a budget: where the body's weight is going to come to rest (the capture point) must be somewhere the
	// feet can get to. Beyond that for a moment, he goes over.
	_out_of_balance(delta) {
		if (['kneel', 'crouch', 'squat', 'sit'].includes(this.posture) || (this.posture == 'custom' && this.seat)) { this._unbalanced_t = 0; return false; }
		const com = gv(), vel = gv();
		let m = 0;
		for (const p of this.parts) { if (p.severed) continue; com.addScaledVector(this.pos(p), p.mass); vel.addScaledVector(this.lin(p), p.mass); m += p.mass; }
		if (m <= 0) return false;
		com.divideScalar(m); vel.divideScalar(m);
		const h = Math.max(this._ground_distance(), 0.3) + (com.y - this.pos(this.pelvis).y);
		const cp = com.clone().addScaledVector(vel, Math.sqrt(h / HG));
		cp.addScaledVector(this.move_velocity, -Math.sqrt(h / HG));
		const feet = gv();
		let n = 0;
		for (const side of ['r', 'l']) { const f = this.parts[this.part_index['foot_' + side]]; if (!f.severed) { feet.add(this.pos(f)); n++; } }
		if (n == 0) return true;
		feet.divideScalar(n);
		const off = Math.hypot(cp.x - feet.x, cp.z - feet.z);
		const reach = 0.22 + 0.55 * this.mobility() * (1 - clamp(this._stagger, 0, 1) * 0.6) * (1 - this.shock * 0.4);
		if (off > reach) this._unbalanced_t += delta;
		else this._unbalanced_t = Math.max(this._unbalanced_t - delta * 2, 0);
		return this._unbalanced_t > 0.12;
	}

	_fall(why) {
		this._release_pose();
		if (!this.fallen) this.log.push({t: this.time, fell: why || 'fall'});
		this.fallen = true;
		this._getup_delay = 1.5 + this.rng() * 1.5;
		this._fallen_time = 0;
		this._getup = 0;
	}

	groundY() { return groundLevel(this.rt); }

	_ground_distance() {
		const from = this.pos(this.pelvis);
		const hit = this.ray(from, gv(0, -1.8, 0));
		return hit ? from.y - hit.position.y : -1;
	}

	// ---- Pose generation ----

	_pose_set(name, e) { this.parts[this.part_index[name]].target = e.clone(); }
	// mirrors Y/Z for the left side so poses can be authored for the right side
	_side(part, side, e) { if (side == 'l') e = gv(e.x, -e.y, -e.z); this._pose_set(part + '_' + side, e); }
	_t(name) { return this.parts[this.part_index[name]].target.clone(); }

	_compose_pose(delta) {
		for (const p of this.parts) p.target = gv();
		if (this._death_kind == 'headshot' && this._death_t >= 0 && this._death_t < HEADSHOT_SPASM) { this._pose_decerebrate(); return; }
		if (!this.alive || !this.conscious) return;
		const fwd = this.facing();
		const vel = this.move_velocity.clone().addScaledVector(this._stumble_dir, 1.8 * this._stumble);
		const speed = Math.hypot(vel.x, vel.z);
		const backwards = speed > 0.1 && vel.clone().normalize().dot(fwd) < -0.3;
		const run = clamp((speed - 1.6) / 2.4, 0, 1);
		const walk = clamp(speed / 1.0, 0, 1);
		const cadence = 0.55 + speed * 0.22;
		this._phase += delta * Math.PI * 2 * cadence * (backwards ? -1 : 1);
		const base = this.custom_targets || (this.posture == 'sit' && this.seat ? this.start_angles : null);
		if (base) {
			// a pose made with the skeleton, or sat on a chair: the muscles hold the pose he was made in (sat, he does not
			// straighten his legs and rise off the chair when something happens to him)
			this.parts.forEach((p, i) => { p.target = base[i].clone(); });
		} else for (const side of ['r', 'l']) {
			const ph = this._phase + (side == 'r' ? 0 : Math.PI);
			const limp = 1 - this.leg_health[side];
			const hip = Math.sin(ph) * glerp(0.35, 0.8, run) * walk + run * 0.12;
			const knee = -Math.max(0, Math.sin(ph + 0.9)) * glerp(0.7, 1.6, run) * walk * (1 - limp * 0.6) - 0.06;
			const ankle = 0.22 * Math.sin(ph - 0.6) * walk;
			this._side('thigh', side, gv(hip, 0, 0.04));
			this._side('shin', side, gv(knee, 0, 0));
			this._side('foot', side, gv(ankle, 0, 0));
			const arm_swing = -Math.sin(ph) * glerp(0.28, 0.7, run) * walk;
			this._side('upper_arm', side, gv(arm_swing + 0.05, 0, 0.08));
			this._side('forearm', side, gv(glerp(0.2, 1.4, run) + 0.1 * walk, 0, 0));
			this._side('hand', side, gv(0.1, 0, 0));
		}
		for (const side of Object.keys(this.held_arms || {})) for (const part of ['upper_arm', 'forearm', 'hand']) {
			const i = this.part_index[part + '_' + side];
			if (i !== undefined) this.parts[i].target = this.start_angles[i].clone();
		}
		if (!base) {
			this._pose_set('abdomen', gv(-0.02 * run, 0.07 * Math.sin(this._phase) * walk, 0));
			this._pose_set('chest', gv(-0.025 * run + 0.015 * Math.sin(this._time * 1.7), -0.05 * Math.sin(this._phase) * walk, 0));
		}

		switch (this.posture) {
			case 'crouch': case 'cover_head':
				for (const side of ['r', 'l']) { this._side('thigh', side, gv(1.55, 0, 0.18)); this._side('shin', side, gv(-2.2, 0, 0)); this._side('foot', side, gv(0.4, 0, 0)); }
				this._pose_set('abdomen', gv(-0.45, 0, 0));
				this._pose_set('chest', gv(-0.3, 0, 0));
				if (this.posture == 'cover_head') for (const side of ['r', 'l']) { this._side('upper_arm', side, gv(2.3, 0.3, 0.55)); this._side('forearm', side, gv(2.2, 0, 0)); }
				break;
			case 'aim':
				// gun held out in the right hand, the left one supporting it
				this._side('upper_arm', 'r', gv(1.45, 0.05, 0.12)); this._side('forearm', 'r', gv(0.12, 0, 0)); this._side('hand', 'r', gv(0, 0, 0));
				this._side('upper_arm', 'l', gv(1.25, 0, -0.35)); this._side('forearm', 'l', gv(0.7, 0, 0));
				break;
			case 'kneel':
				// on both knees, sitting up: thighs upright, shins flat behind
				for (const side of ['r', 'l']) { this._side('thigh', side, gv(0.12, 0, 0.08)); this._side('shin', side, gv(-1.65, 0, 0)); this._side('foot', side, gv(0.7, 0, 0)); }
				this._pose_set('abdomen', gv(-0.08, 0, 0));
				break;
			case 'squat':
				// down on the heels, knees wide, feet flat, leaning in a little, the forearms resting on the knees
				for (const side of ['r', 'l']) {
					this._side('thigh', side, gv(this.SQ_THIGH, 0.12, 0.3)); this._side('shin', side, gv(this.SQ_SHIN, 0, 0)); this._side('foot', side, gv(this.SQ_FOOT, 0, 0));
					this._side('upper_arm', side, gv(0.6, 0, 0.22)); this._side('forearm', side, gv(0.75, 0, 0)); this._side('hand', side, gv(0.35, 0, 0));
				}
				this._pose_set('abdomen', gv(-0.28, 0, 0));
				this._pose_set('chest', gv(-0.12, 0, 0));
				break;
			case 'hands_up':
				for (const side of ['r', 'l']) { this._side('upper_arm', side, gv(2.65, 0, 0.45)); this._side('forearm', side, gv(0.55, 0, 0)); this._side('hand', side, gv(-0.3, 0, 0)); }
				break;
		}
		// hand pressed to a wound
		if (this.clutch_part != '' && this.posture != 'hands_up') {
			const side = this.clutch_part.endsWith('_r') || this.clutch_part == 'chest' ? 'l' : 'r';
			if (this.arm_health[side] > 0.3) {
				const high = ['chest', 'head', 'upper_arm_r', 'upper_arm_l'].includes(this.clutch_part);
				this._side('upper_arm', side, gv(!high ? 0.55 : 0.9, 0.3, -0.35));
				this._side('forearm', side, gv(!high ? 1.9 : 2.2, 0, 0));
			}
		}
		// bent over a wound in the belly or chest, more the more it hurts
		if (['abdomen', 'pelvis', 'chest'].includes(this.clutch_part) && !this.fallen) {
			const k = clamp(this.pain, 0, 1);
			this._pose_set('abdomen', this._t('abdomen').add(gv(-0.32, 0, 0).multiplyScalar(k)));
			this._pose_set('chest', this._t('chest').add(gv(-0.2, 0, 0).multiplyScalar(k)));
			this._pose_set('head', this._t('head').add(gv(-0.2, 0, 0).multiplyScalar(k)));
			for (const sd of ['r', 'l']) {
				this._pose_set('thigh_' + sd, this._t('thigh_' + sd).add(gv(0.18, 0, 0).multiplyScalar(k)));
				this._pose_set('shin_' + sd, this._t('shin_' + sd).add(gv(-0.25, 0, 0).multiplyScalar(k)));
			}
		}
		// shaking: shock, pain and blood loss
		const tremor = clamp(this.shock * 0.6 + this.pain * 0.15 + (1 - this.blood_ml / BLOOD_MAX) * 1.5, 0, 1);
		if (tremor > 0.05) this.parts.forEach((p, i) => {
			const f = 11 + i * 1.7;
			p.target.add(gv(Math.sin(this._time * f + i), Math.sin(this._time * f * 1.3 + i * 2), 0).multiplyScalar(0.035 * tremor));
		});
		// flinch / protective hunch after being hit
		if (this._flinch > 0) {
			const f = this._flinch;
			this._pose_set('abdomen', this._t('abdomen').add(gv(-0.12, 0, 0).multiplyScalar(f)));
			this._pose_set('chest', this._t('chest').add(gv(-0.1, 0, 0).multiplyScalar(f)));
			for (const side of ['r', 'l']) {
				const cur = this._t('upper_arm_' + side);
				this._pose_set('upper_arm_' + side, cur.lerp(gv(0.9, 0, side == 'r' ? 0.1 : -0.1), f * 0.35));
			}
		}
		// hands on a held thing (both hands: the other hand on its grip)
		if (!this.fallen) for (const it of this.items) {
			if (!it.other || !it.grip_other || !it.constraint) continue;
			const side = it.other.name.endsWith('_r') ? 'r' : 'l';
			if (this.arm_health[side] > 0.15) this._arm_ik(side, this.itemPoint(it, it.grip_other));
		}
		// fallen but conscious: catch the fall, then curl or push up
		if (this.fallen) {
			if (this._getup > 0) this._pose_getup(this._getup);
			else if (this._fallen_time < 1.2 && this.lin(this.pelvis).length() > 0.6) this._pose_catch_fall();
			else this._pose_writhe();
		}
	}

	// ---- Walking a route: a smooth curve through the points; he heads for a spot a little ahead of where he is on it,
	// turning at a person's pace. Knocked down he stops; back on his feet he goes on from where he is ----
	_route_curve() {
		const r = this.route;
		if (r._curve) return r._curve;
		const pts = r.points.map(p => gv(p[0], p[1], p[2]));
		const closed = r.mode == 'loop' && pts.length > 2;
		const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
		const n = Math.max(16, pts.length * 24), samples = curve.getSpacedPoints(n);
		const lengths = [0];
		for (let i = 1; i < samples.length; i++) lengths.push(lengths[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z));
		r._curve = {samples, lengths, total: lengths[lengths.length - 1], closed};
		return r._curve;
	}
	_route_point(s) {
		const c = this._route_curve();
		if (c.closed) s = ((s % c.total) + c.total) % c.total; else s = clamp(s, 0, c.total);
		let i = 1;
		while (i < c.lengths.length - 1 && c.lengths[i] < s) i++;
		const a = c.samples[i - 1], b = c.samples[i], f = (s - c.lengths[i - 1]) / Math.max(1e-6, c.lengths[i] - c.lengths[i - 1]);
		return a.clone().lerp(b, clamp(f, 0, 1));
	}
	_follow_route(dt) {
		const r = this.route;
		if (!r || !r.points || r.points.length < 2) return;
		if (r.kill_at > 0 && this.time >= r.kill_at && !this._route_killed) {
			this._route_killed = true;
			if (r.kill_kind == 'faint') { this.wake(); this.conscious = false; this.move_velocity = gv(); this._start_death_curve('faint'); }
			else this._die(r.kill_kind || 'heart');
			return;
		}
		if (!this.alive || !this.conscious || this.fallen || this._held_pose || this.posture != 'stand') { this.move_velocity = gv(); return; }
		if (this.time < (r.start || 0)) { this.move_velocity = gv(); return; }
		const c = this._route_curve(), s = this.scale_factor;
		const here = this.pos(this.pelvis);
		// where he is on the curve: the nearest spot not far from the last one (so a crossing curve is not cut short)
		let best = this._route_s, best_d = Infinity;
		for (let k = -12; k <= 30; k++) {
			const q = this._route_s + k * 0.1 * this._route_dir;
			if (!c.closed && (q < 0 || q > c.total)) continue;
			const p = this._route_point(q), d = Math.hypot(p.x - here.x, p.z - here.z);
			if (d < best_d) { best_d = d; best = q; }
		}
		this._route_s = best;
		let remaining = this._route_dir > 0 ? c.total - best : best;
		if (!c.closed && remaining < 0.15 * s) {
			if (r.mode == 'pingpong') { this._route_dir *= -1; remaining = c.total; }
			else { this._route_done = true; this.move_velocity = gv(); return; }
		}
		const ahead = this._route_point(best + this._route_dir * 0.7 * s);
		const to = gv(ahead.x - here.x, 0, ahead.z - here.z);
		if (to.lengthSq() < 1e-6) { this.move_velocity = gv(); return; }
		to.normalize();
		// turning at a walking pace (about 130 degrees a second)
		const cur = this.facing();
		const angle = Math.atan2(cur.x * to.z - cur.z * to.x, cur.dot(to)), turn = clamp(angle, -2.3 * dt, 2.3 * dt);
		this.heading = cur.applyAxisAngle(gv(0, 1, 0), -turn).normalize();
		// slowing down to stop at the end of an open route; walking off at the heading he has (no side steps)
		const ease = c.closed || r.mode == 'pingpong' ? 1 : clamp(remaining / (0.8 * s), 0.25, 1);
		const speed = r.speed * s * this.mobility() * ease * clamp(1 - Math.abs(angle) / 2.2, 0.35, 1);
		this.move_velocity = to.clone().lerp(this.heading, 0.5).normalize().multiplyScalar(speed);
	}

	facing() {
		if (this.heading) return this.heading.clone();
		const f = gv(0, 0, -1).applyQuaternion(this.rest_rot);
		f.y = 0;
		return f.lengthSq() > 1e-6 ? f.normalize() : gv(0, 0, -1);
	}

	// going down awake: both hands go out to where the body is going to land, the head is kept up, the knees give
	_pose_catch_fall() {
		const v = this.lin(this.pelvis), hv = gv(v.x, 0, v.z);
		const cq = this.quat(this.chest);
		const dir = hv.length() > 0.2 ? hv.clone().normalize() : gaxis(cq, 2).negate();
		const ground = this.pos(this.pelvis).y - Math.max(this._ground_distance(), 0);
		const fwd_fall = dir.dot(gaxis(cq, 2).negate()) > -0.2;   // falling forwards (or sideways)
		const cpos = this.pos(this.chest);
		const reach = cpos.clone().addScaledVector(dir, 0.45);
		const cx = gaxis(cq, 0);
		for (const side of ['r', 'l']) {
			if (this.arm_health[side] < 0.2) continue;
			const sx = side == 'r' ? 1 : -1;
			let goal = gv(reach.x, ground + 0.05, reach.z).addScaledVector(cx, 0.2 * sx);
			if (!fwd_fall) { goal = cpos.clone().addScaledVector(dir, 0.3).addScaledVector(cx, 0.3 * sx); goal.y = ground + 0.1; }   // backwards: hands go back and down behind
			this._arm_ik(side, goal);
		}
		// head: forwards it comes up (face off the ground), backwards the chin tucks
		this._pose_set('head', gv(fwd_fall ? 0.5 : -0.6, 0, 0));
		for (const side of ['r', 'l']) { this._side('thigh', side, gv(0.35, 0, 0.06)); this._side('shin', side, gv(-0.7, 0, 0)); }
		this._pose_set('abdomen', gv(fwd_fall ? -0.15 : -0.35, 0, 0));
	}

	// down and hurt, still conscious: curled round the wound, rolling a little, knees drawn up, now and then a hand reaching out
	_pose_writhe() {
		const k = clamp(this.pain + this.shock * 0.5, 0.15, 1);
		const t = this._time + (this.seed97 || (this.seed97 = Math.floor(this.rng() * 97)));
		const roll = Math.sin(t * 0.7) * 0.45 * k;
		const writhe = Math.sin(t * 2.3) * 0.25 * k;
		for (const side of ['r', 'l']) {
			const sx = side == 'r' ? 1 : -1;
			const draw = 0.6 + writhe * sx + 0.35 * k;
			this._side('thigh', side, gv(draw, 0, 0.1 + 0.1 * roll * sx));
			this._side('shin', side, gv(-1 - writhe * sx - 0.4 * k, 0, 0));
		}
		this._pose_set('abdomen', gv(-0.3 - 0.2 * k, roll * 0.6, roll * 0.3));
		this._pose_set('chest', gv(-0.15 * k, roll * 0.5, 0));
		this._pose_set('head', gv(0.2 * k, -roll * 0.4, 0));
		const reach = Math.max(Math.sin(t * 0.37), 0);
		if (reach > 0.3) {
			const side = this.clutch_part.endsWith('_l') || this.clutch_part == '' ? 'r' : 'l';
			if (this.arm_health[side] > 0.3) { this._side('upper_arm', side, gv(1.6 * reach, 0, 0.3)); this._side('forearm', side, gv(0.3, 0, 0)); }
		}
	}

	// Arm pose (upper arm and elbow bend, relative to the chest) that puts the hand on a world point: a few damped
	// Gauss-Newton steps from last frame's answer, a slight preference for the elbow hanging down
	_arm_ik(side, goal) {
		const cq = this.quat(this.chest), cp = this.pos(this.chest);
		const rest_c = this.chest.rest_pos;
		const ua = this.parts[this.part_index['upper_arm_' + side]], fa = this.parts[this.part_index['forearm_' + side]], hd = this.parts[this.part_index['hand_' + side]];
		const js = ua.joint_pos, je = fa.joint_pos, ch = hd.rest_pos;
		const shoulder = js.clone().sub(rest_c).applyQuaternion(cq).add(cp);
		const g = goal.clone().sub(shoulder).applyQuaternion(cq.clone().invert());
		const se = je.clone().sub(js), eh = ch.clone().sub(je);
		if (side == 'l') { g.x = -g.x; se.x = -se.x; eh.x = -eh.x; }
		let p = this._ik_solve(this._ik_last[side] || [0.3, 0, 0.2, 0.8], g, se, eh);
		const dist = q => g.distanceTo(ikHand(q, se, eh));
		if (dist(p) > 0.03) {
			// stuck against a limit: try from a few typical arm poses as well
			for (const seed of [[1.2, -0.2, 0.9, 1.8], [1.6, 0.4, 0.2, 1.4], [0.2, 0, 1.3, 1.6], [0.6, 0, 0.1, 0.4]]) {
				const q = this._ik_solve(seed, g, se, eh);
				if (dist(q) < dist(p)) p = q;
			}
		}
		this._ik_last[side] = p;
		this._side('upper_arm', side, gv(p[0], p[1], p[2]));
		this._side('forearm', side, gv(p[3], 0, 0));
		this._side('hand', side, gv());
	}

	_ik_solve(p, g, se, eh) {
		p = p.slice();
		for (let it = 0; it < 6; it++) {
			const h0 = ikHand(p, se, eh);
			const e = g.clone().sub(h0);
			if (e.length() < 0.004) break;
			// numeric Jacobian (3 x 4) and a damped least-squares step
			const cols = [];
			for (let k = 0; k < 4; k++) { const q = p.slice(); q[k] += 0.01; cols.push(ikHand(q, se, eh).sub(h0).divideScalar(0.01)); }
			const c = v => [v.x, v.y, v.z];
			const m = [];
			for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) {
				let sum = 0;
				for (let k = 0; k < 4; k++) sum += c(cols[k])[r] * c(cols[k])[cc];
				m[r * 3 + cc] = sum + (r == cc ? 0.02 : 0);
			}
			const M = new THREE.Matrix3().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
			const y = e.clone().applyMatrix3(M.invert());
			const step = cols.map(col => col.dot(y));
			step[1] -= p[1] * 0.05;
			p = ikClamp(p.map((v, k) => v + step[k]));
		}
		return p;
	}

	// getting up, in stages over 3 s: roll onto the front with knees tucked and hands under the shoulders, a knee, then stand
	_pose_getup(g) {
		if (g < 0.9) {
			for (const side of ['r', 'l']) { this._side('thigh', side, gv(1.5, 0, 0.15)); this._side('shin', side, gv(-2.2, 0, 0)); this._side('upper_arm', side, gv(1.1, 0, 0.25)); this._side('forearm', side, gv(1.4, 0, 0)); }
			this._pose_set('abdomen', gv(-0.4, 0, 0));
		} else if (g < 1.9) {
			// kneeling on the left knee, right foot planted
			const k = gsmooth(0.9, 1.5, g);
			this._side('thigh', 'l', gv(glerp(1.5, 0.3, k), 0, 0.1));
			this._side('shin', 'l', gv(glerp(-2.2, -1.6, k), 0, 0));
			this._side('thigh', 'r', gv(1.5, 0, 0.1));
			this._side('shin', 'r', gv(glerp(-2.2, -1.5, k), 0, 0));
			for (const side of ['r', 'l']) { this._side('upper_arm', side, gv(glerp(1.1, 0.5, k), 0, 0.2)); this._side('forearm', side, gv(glerp(1.4, 0.6, k), 0, 0)); }
			this._pose_set('abdomen', gv(glerp(-0.4, -0.25, k), 0, 0));
			this._pose_set('chest', gv(-0.15, 0, 0));
		} else {
			// stand up out of the kneel
			const k = gsmooth(1.9, 2.9, g);
			this._side('thigh', 'l', gv(0.3 * (1 - k), 0, 0.05));
			this._side('shin', 'l', gv(-1.6 * (1 - k), 0, 0));
			this._side('thigh', 'r', gv(1.5 * (1 - k), 0, 0.05));
			this._side('shin', 'r', gv(-1.5 * (1 - k), 0, 0));
			this._pose_set('abdomen', gv(-0.25 * (1 - k), 0, 0));
		}
	}

	// lying on the back: turn over onto the front to get up
	_roll_prone() {
		const front = this.basis(this.chest, 2).negate();
		if (front.y > 0.25) {
			const axis = this.basis(this.pelvis, 1);
			const cx = this.basis(this.chest, 0);
			const side = Math.abs(cx.y) > 0.05 ? Math.sign(cx.y) : 1;
			const tq = axis.multiplyScalar(55 * side * this.scale_factor);
			this.torque(this.chest, tq);
			this.torque(this.pelvis, tq.clone().multiplyScalar(0.8));
		}
	}

	// how far into the spasm after a shot to the brain, 0..1: in almost at once, held a moment, then let go slowly
	// how hard the arms draw in after a shot to the head (the Ragdoll panel: 1 = as in the game)
	spasmScale() { const v = this.s && this.s.spasm; return clamp(v === undefined || v === null ? 0.5 : +v, 0, 1); }
	_spasm() { const t = this._death_t; return gsmooth(0, 0.08, t) * (1 - gsmooth(0.35, HEADSHOT_SPASM, t)); }

	// weak, involuntary arm posture right after a brain injury: the fists drawn in to the wound, the body draws in a little
	_pose_decerebrate() {
		const t = this._death_t, k = this._spasm() * this.spasmScale();
		const wound = this.toWorld(this.head, this._head_wound || gv(0, 0, -0.08));
		const hc = this.pos(this.head);
		let out = wound.clone().sub(hc);
		out = out.length() > 0.01 ? out.normalize() : this.basis(this.head, 2).negate();
		const cq = this.quat(this.chest), cx = gaxis(cq, 0), cz = gaxis(cq, 2);
		for (const side of ['r', 'l']) {
			const sx = side == 'r' ? 1 : -1;
			const goal = wound.clone().addScaledVector(out, 0.07).addScaledVector(cx, 0.05 * sx).addScaledVector(cz, -0.04);
			this._arm_ik(side, goal);
			const ua = this._t('upper_arm_' + side), fa = this._t('forearm_' + side);
			fa.x = Math.max(fa.x, 2.3);   // all the way at the elbow, whatever the reach
			this._pose_set('upper_arm_' + side, ua.multiplyScalar(k));
			this._pose_set('forearm_' + side, fa.multiplyScalar(k));
			this._side('hand', side, gv(0.6, 0, 0).multiplyScalar(k));
		}
		this._pose_set('abdomen', gv(-0.22, 0, 0).multiplyScalar(k));
		this._pose_set('chest', gv(-0.12, 0, 0).multiplyScalar(k));
		this._pose_set('head', gv(-0.2, 0, 0).multiplyScalar(k));
		// the knees fold at once (that is what drops him where he stands), the hips follow
		const drop = gsmooth(0, 0.1, t);
		for (const side of ['r', 'l']) { this._side('thigh', side, gv(0.7 * drop, 0, 0.05)); this._side('shin', side, gv(-1.3 * drop, 0, 0)); this._side('foot', side, gv(0.3 * drop, 0, 0)); }
	}

	// Muscles: each joint runs a velocity servo on the joint motors. The pose error is turned into a desired relative
	// angular velocity; the motor torque limit is the muscle strength (scaled by tone). At very low tone the motor is
	// just joint friction.
	_apply_muscles() {
		const AX = this.axes(), J = this.J;
		const vtmp = this.vtmp || (this.vtmp = new J.Vec3(0, 0, 0));
		this.parts.forEach((c, i) => {
			if (c.parent < 0 || !c.joint) return;
			const p = this.parts[c.parent];
			const qp = this.quat(p), qc = this.quat(c);
			const err = gerr(qp.clone().multiply(gquat(c.target)).multiply(qc.clone().invert()));
			let t_i = this.tone * c.weak * c.hit_weak;
			if (this._death_kind == 'headshot' && this._death_t >= 0 && this._death_t < HEADSHOT_SPASM && c.arm == 1) t_i = Math.max(t_i, 0.95 * this._spasm() * this.spasmScale());
			// trunk and legs go limp first; after a shot to the head they still draw in with the arms, only weaker
			if (this._death_t >= 0 && c.arm == 0) t_i *= this._death_kind == 'headshot' && this._death_t < HEADSHOT_SPASM ? 0.4 : 0.15;
			// (Jolt drives a 6DOF motor about the axes of the child's joint frame: the wanted turn is given in those axes. The
			// game writes it in the parent's; the two are the same for small angles, and for big ones - an arm up by the head -
			// this is what keeps it still instead of flailing)
			const des = glimit(err.applyQuaternion(qc.clone().invert()).multiplyScalar(c.omega * clamp(t_i, 0, 1)), 14);
			vtmp.Set(des.x, des.y, des.z);
			c.joint.SetTargetAngularVelocityCS(vtmp);
			// awake, a joint never goes fully slack; out cold or dead only a trace of friction is left
			const limit = c.max_torque * Math.max(t_i, this.conscious ? 0.02 : 0.004);
			if (Math.abs(limit - c.motor_limit) > c.max_torque * 0.01) {
				c.motor_limit = limit;
				for (const axis of [AX.rx, AX.ry, AX.rz]) {
					const ms = c.joint.GetMotorSettings(axis);
					ms.mMinTorqueLimit = -limit;
					ms.mMaxTorqueLimit = limit;
				}
			}
		});
	}

	// Balance assist: vertical support spring on pelvis/chest, horizontal drive toward the wanted speed, upright torque
	_apply_balance() {
		const s = this.scale_factor;
		const h = this._ground_distance();
		let target_h = this.stand_height;
		const speed = Math.hypot(this.move_velocity.x, this.move_velocity.z);
		target_h -= 0.03 * clamp(speed, 0, 1) + 0.07 * clamp((speed - 1.6) / 2.4, 0, 1);
		if (this.posture == 'crouch' || this.posture == 'cover_head') target_h = 0.56 * s;
		else if (this.posture == 'kneel') target_h = 0.5 * s;
		else if (this.posture == 'squat') target_h = 0.41 * s;
		// (not in the game: there his mind makes him get up when he is hit on a chair. Without one he stays sat, the seat
		// under him, until the held pose takes him back - not heaved up to standing height over the chair)
		else if ((this.posture == 'sit' || this.posture == 'custom') && this.seat) target_h = 0.13 * s;
		else if (this.custom_targets) target_h = this.custom_h;
		const limp = 1 - Math.min(this.leg_health.l, this.leg_health.r);
		target_h -= limp * 0.08 + 0.02 * Math.abs(Math.sin(this._phase * 2)) * limp;
		if (this.fallen && this._getup > 0) {
			// knees and hands, then a knee, then up
			const low = glerp(0.22, 0.5, gsmooth(0.7, 1.6, this._getup)) * s;
			target_h = glerp(low, target_h, gsmooth(1.8, 2.9, this._getup));
			if (this._getup < 0.9) this._roll_prone();
		}
		const sup = this.support;
		// down on the heels the legs carry him: the hold only keeps him there, gently
		const soft = this.posture == 'squat' ? 0.45 : 1.0;
		const M = this.total_mass;
		if (h > 0 && h < 1.7) {
			const err = target_h - h;
			const vy = this.lin(this.pelvis).y;
			const damp = this.posture != 'squat' ? 16 * Math.sqrt(soft) : 15;
			const acc = clamp(HG * soft + err * 90 * soft - vy * damp, 0, HG * 2.8);
			const f = M * acc * sup;
			this.force(this.pelvis, gv(0, f * 0.62, 0));
			this.force(this.chest, gv(0, f * 0.38, 0));
			// horizontal drive
			const v = this.lin(this.pelvis), hv = gv(v.x, 0, v.z);
			let want = this.move_velocity.clone().addScaledVector(this._stumble_dir, 1.8 * this._stumble);
			if (this.posture == 'squat' && !this.fallen) {
				const fr = this.parts[this.part_index.foot_r], fl = this.parts[this.part_index.foot_l];
				if (!this._squat_at) { this._squat_at = this.pos(this.pelvis); this._squat_feet = [this.pos(fr), this.pos(fl)]; }
				[fr, fl].forEach((foot, k) => {
					const d = this._squat_feet[k].clone().sub(this.pos(foot)), fv = this.lin(foot);
					const fa = glimit(gv(d.x * 200 - fv.x * 22, Math.min(d.y * 200 - fv.y * 22, 0), d.z * 200 - fv.z * 22), 60);
					this.force(foot, fa.multiplyScalar(foot.mass * sup));
					this.torque(foot, this.ang(foot).multiplyScalar(-0.6 * sup));
				});
				const mid = this._squat_feet[0].clone().add(this._squat_feet[1]).multiplyScalar(0.5);
				const f_dir = this.facing();
				const seat = mid.clone().addScaledVector(f_dir, -0.1).sub(this.pos(this.pelvis));
				want = gv(seat.x, 0, seat.z).multiplyScalar(4);
			} else { this._squat_at = null; this._squat_feet = []; }
			if (this.posture == 'kneel' && !this.fallen) {
				const knees = this.jointWorld(this.parts[this.part_index.shin_r]).add(this.jointWorld(this.parts[this.part_index.shin_l])).multiplyScalar(0.5);
				const off = knees.sub(this.pos(this.pelvis));
				want = gv(off.x, 0, off.z).multiplyScalar(4);
			}
			const dv = gv(want.x, 0, want.z).sub(hv);
			const drive = glimit(dv.multiplyScalar(7), 8).multiplyScalar(M * sup);
			// (mostly at the hips: pulled along by the chest he would topple forward)
			this.force(this.pelvis, drive.clone().multiplyScalar(0.75));
			this.force(this.chest, drive.clone().multiplyScalar(0.25));
		}
		// upright and heading
		const fwd = this.facing();
		const lean = clamp(Math.hypot(this.move_velocity.x, this.move_velocity.z) * 0.01, 0, 0.04);
		const up = gv(0, 1, 0).addScaledVector(fwd, lean).normalize();
		const target = glook(fwd, up);
		const rotAbout = (q, axis, a) => new THREE.Quaternion().setFromAxisAngle(axis, a).multiply(q);
		const tx = gaxis(target, 0);
		const p_target = this.custom_pelvis ? target.clone().multiply(this.custom_pelvis) : this.posture == 'squat' ? rotAbout(target, tx, -this.SQ_LEAN) : target;
		this._upright_torque(this.pelvis, p_target, 9.0, 7.0 * sup);
		let ch_target = target;
		if (this.posture == 'crouch' || this.posture == 'cover_head') ch_target = rotAbout(target, tx, -0.6);
		else if (this.posture == 'squat') ch_target = rotAbout(target, tx, -0.55);
		else if (this.custom_chest) ch_target = target.clone().multiply(this.custom_chest);
		this._upright_torque(this.chest, ch_target, 3.0, 5.0 * sup);
	}

	// upright / heading assist, spread over pelvis, abdomen and chest and damped with their average angular velocity
	_upright_torque(b, target, inertia, strength) {
		if (strength <= 0) return;
		const err = gerr(target.clone().multiply(this.quat(b).invert()));
		const ab = this.parts[this.part_index.abdomen];
		const w_avg = this.ang(this.pelvis).add(this.ang(ab)).add(this.ang(this.chest)).divideScalar(3);
		const w = strength;
		const tq = glimit(err.multiplyScalar(w * w).addScaledVector(w_avg, -2 * w).multiplyScalar(inertia), 900);
		this.torque(b, tq.clone().multiplyScalar(0.5));
		this.torque(ab, tq.clone().multiplyScalar(0.25));
		this.torque(b == this.pelvis ? this.chest : this.pelvis, tq.clone().multiplyScalar(0.25));
	}

	// ---- Damage ----

	// a hit from the plugin: {t, bone: uuid, dir: [x,y,z], local: [x,y,z] (px, in the bone), impulse, weapon}
	applyHit(hit) {
		const part = this.parts.find(p => p.group.uuid == hit.bone) || this.chest;
		const r = part.body.GetPosition(), q = part.body.GetRotation();
		const origin = gv(r.GetX(), r.GetY(), r.GetZ()), bq = new THREE.Quaternion(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
		const point = gv(...(hit.local || [0, 0, 0])).divideScalar(SCALE).applyQuaternion(bq).add(origin);
		const dir = gv(...hit.dir).normalize();
		this.receive_hit(part, point, dir, hit.impulse, hit.weapon || this.s.weapon || 'pistol');
		this.log.push({t: this.time, bone: part.group.name, part: part.name, impulse: hit.impulse});
	}

	shoot(hit) { this.pending.push(Object.assign({t: this.time}, hit)); }

	// the blood on him (body_blood.gd), made when first needed
	paint_blood(part, world_p, r, amount) { (this.body_blood || (this.body_blood = new BodyBlood(this))).paint(part, world_p, r, amount); }
	bloom_blood(part, world_p, r, dur, amount) { (this.body_blood || (this.body_blood = new BodyBlood(this))).bloom(part, world_p, r, dur, amount); }

	receive_hit(body, point, dir, impulse, weapon) {
		this.wake();
		// the impulse at the point it hit
		const com = this.pos(body);
		// a part takes no more of the push than throws it at HIT_PART_SPEED; the rest goes on through the joints (neck, chest,
		// belly, pelvis) as the skeleton would pass it, and what is still left moves the whole body. (Given all to one small
		// part, the joints cannot catch up in a step: the neck stretched and most of a strong hit was lost)
		const mass = p => { const im = p.body.GetMotionProperties().GetInverseMass(); return im > 0 ? 1 / im : 0; };
		const push = (p, n) => { const v = dir.clone().multiplyScalar(n); this.world.tmp.Set(v.x, v.y, v.z); this.world.bodies.AddImpulse(p.id, this.world.tmp); };
		let left = impulse, own = 0;
		for (let p = body; p && left > 1e-6; p = p.parent >= 0 ? this.parts[p.parent] : null) {
			const give = Math.min(left, mass(p) * HIT_PART_SPEED);
			push(p, give);
			if (p === body) own = give;
			left -= give;
		}
		if (left > 1e-6) {
			const all = this.parts.reduce((m, p) => m + mass(p), 0);
			for (const p of this.parts) push(p, left * mass(p) / all);
		}
		this._hit_until = this._time + 0.05;
		this._release_pose();
		const imp = dir.clone().multiplyScalar(own);
		const L = point.clone().sub(com).cross(imp);
		this.world.tmp.Set(L.x, L.y, L.z);
		this.world.bodies.AddAngularImpulse(body.id, this.world.tmp);
		const part = body.name;
		const local = this.toLocal(body, point);
		const pellet = weapon == 'shotgun' || weapon == 'frag';
		const dmg = pellet ? 0.55 : 1.0;
		const was_alive = this.alive;
		const bleed_before = this.bleed_rate;
		let wound_kind = 'limb', arterial = false;
		this._flinch = Math.min(this._flinch + 0.7 * dmg, 1);
		this._flinch_dir = dir.clone();
		this._stagger += (pellet ? 0.18 : 0.28) * dmg * (0.6 + 0.4 * Math.abs(dir.y));
		// a hit to the legs or a heavy blow makes a standing person stumble
		if (this.alive && !this.fallen && (/^(thigh|shin|foot)/.test(part) || part == 'pelvis' || this._stagger > 0.45)) {
			this._stumble = 1;
			this._stumble_dir = gv(dir.x, 0, dir.z).normalize();
		}
		this.pain = Math.min(this.pain + 0.5 * dmg, 1.5);
		this.shock += 0.08 * dmg;
		const side = part.endsWith('_r') ? 'r' : 'l';
		this.knock_muscle(part, 0.95 * dmg);
		const s = this.scale_factor;
		if (part == 'head') {
			if (local.y < -0.075 * s) {
				// neck: jugular / carotid bleed, not instantly fatal
				this.bleed_rate += 38 * dmg;
				this.shock += 0.3;
				this.clutch_part = 'head';
				wound_kind = 'neck';
				arterial = true;
			} else {
				wound_kind = 'head';
				this._head_wound = local.clone();
				this._die('headshot');
				if (this.blood) {
					// the smashed skull: torn vessels of the scalp and brain pour out of the exit hole with every beat the heart has left
					const hd = dir.clone().normalize();
					const big = ['akm', 'shotgun', 'frag', 'rifle'].includes(weapon);
					this.blood.open_jet(this, this.head, this.pos(this.head).addScaledVector(hd, 0.1), hd.clone().add(gv(0, 0.2, 0)).normalize(), big ? 100 : 65, true);
					this.blood.open_jet(this, this.head, point.clone().addScaledVector(hd, -0.01), hd.clone().negate(), 14, true);
				}
			}
		} else if (part == 'chest') {
			const heart = local.x < 0.02 && local.x > -0.1 && local.y < 0.05;
			this.bleed_rate += (heart ? 55 : 14) * dmg;
			this.shock += (heart ? 0.7 : 0.22) * dmg;
			this.clutch_part = 'chest';
			wound_kind = 'torso';
			arterial = heart;
		} else if (part == 'abdomen') {
			this.bleed_rate += 9 * dmg; this.shock += 0.2 * dmg; this.clutch_part = 'abdomen'; wound_kind = 'torso';
		} else if (part == 'pelvis') {
			this.bleed_rate += 10 * dmg;
			this.leg_health.l -= 0.15 * dmg; this.leg_health.r -= 0.15 * dmg;
			this.clutch_part = 'pelvis'; wound_kind = 'torso';
		} else if (part.startsWith('thigh')) {
			const femoral = this.rng() < 0.15;
			arterial = femoral;
			this.bleed_rate += (femoral ? 40 : 5) * dmg;
			this.leg_health[side] -= 0.4 * dmg;
			body.weak *= 0.75;
			this.clutch_part = part;
			this._stagger += 0.5 * dmg;
		} else if (part.startsWith('shin') || part.startsWith('foot')) {
			this.bleed_rate += 3 * dmg;
			this.leg_health[side] -= 0.3 * dmg;
			body.weak *= 0.7;
			this._stagger += 0.4 * dmg;
		} else {
			this.bleed_rate += 3 * dmg;
			this.arm_health[side] -= 0.35 * dmg;
			body.weak *= 0.6;
			if (part.startsWith('upper')) this.clutch_part = part;
		}
		for (const k of ['l', 'r']) { this.leg_health[k] = clamp(this.leg_health[k], 0, 1); this.arm_health[k] = clamp(this.arm_health[k], 0, 1); }
		if (this.blood) {
			// a shot to the brain still leaks, it just does not pump
			const added = wound_kind != 'head' ? this.bleed_rate - bleed_before : 8;
			this.blood.on_hit(this, body, point, dir, weapon, wound_kind, added, arterial);
		}
		void was_alive;
	}

	// a blow or a bullet takes the muscle out of the part it lands on for a moment, half as much out of the parts next to it
	knock_muscle(part, amount) {
		const i = this.part_index[part];
		if (i === undefined) return;
		const p = this.parts[i];
		p.hit_weak = Math.min(p.hit_weak, 1 - clamp(amount, 0, 1));
		const near = [];
		if (p.parent >= 0) near.push(p.parent);
		this.parts.forEach((q, j) => { if (q.parent == i) near.push(j); });
		for (const j of near) this.parts[j].hit_weak = Math.min(this.parts[j].hit_weak, 1 - clamp(amount * 0.5, 0, 1));
	}

	_start_death_curve(kind) {
		if (this._death_t >= 0 && this._death_kind == 'headshot') return;
		this._death_kind = kind;
		this._death_t = 0;
		if (!this.fallen) this.log.push({t: this.time, fell: kind});
		this.fallen = true;
		this.support = 0;
		if (kind == 'faint') this.log.push({t: this.time, fainted: true});
	}

	_die(kind) {
		this.wake();
		if (!this.alive) return;
		this.alive = false;
		this.conscious = false;
		this.log.push({t: this.time, died: kind});
		if (kind == 'headshot') {
			this.brain_dead = true;
			this._death_kind = 'headshot';
			this._death_t = 0;
			this.fallen = true;
			this.support = 0;
		} else this._start_death_curve(kind);
		this.move_velocity = gv();
		this.has_look_target = false;
		this._release_pose();
		// what he holds is let go a moment after (if the item is set to drop): the hand opens as the grip goes
		this._drop_at = this._time + ITEM_DROP_DELAY;
	}

	_drop_items() {
		for (const it of this.items) if (it.drop && it.constraint) {
			try { this.world.system.RemoveConstraint(it.constraint); if (it.other_constraint) this.world.system.RemoveConstraint(it.other_constraint); } catch (err) { console.warn('[Ragdoll]', err); }
			it.constraint = null; it.other_constraint = null;
			it.entry.body.SetAllowSleeping(true);
		}
	}

	// the pose he was made in is no longer held once something happens to him (a hit, a fall, death): the arms posed by
	// hand become ordinary arms again, and joints opened wide for that pose close back to their own limits
	_release_pose() {
		if (this._released) return;
		this._released = true;
		this.held_arms = {};
	}
	_relax_limits() {
		if (!this._released || this._limits_done) return;
		if ((this._relax_tick = (this._relax_tick || 0) + 1) % 4) return;
		const J = this.J;
		let open = 0;
		for (const p of this.parts) {
			const L = p.lim;
			if (!L || !p.joint) continue;
			const a = this.jointAngles(this.parts[p.parent], p);
			let changed = false;
			for (let i = 0; i < 3; i++) {
				if (L.free[i]) continue;
				// it closes behind the limb as it comes back, and pushes it back gently too (about 1.2 rad/s: no snap) - a limp
				// arm bent past its own limits by hand does not stay so on the floor
				const lo = Math.max(L.lo[i], Math.min(L.olo[i], a[i] - 0.03), Math.min(L.olo[i], L.lo[i] + 0.04));
				const hi = Math.min(L.hi[i], Math.max(L.ohi[i], a[i] + 0.03), Math.max(L.ohi[i], L.hi[i] - 0.04));
				if (Math.abs(lo - L.lo[i]) > 1e-3 || Math.abs(hi - L.hi[i]) > 1e-3) { L.lo[i] = lo; L.hi[i] = hi; changed = true; }
				if (L.lo[i] < L.olo[i] - 1e-3 || L.hi[i] > L.ohi[i] + 1e-3) open++;
			}
			if (changed) {
				const lo = new J.Vec3(L.lo[0], L.lo[1], L.lo[2]), hi = new J.Vec3(L.hi[0], L.hi[1], L.hi[2]);
				try { p.joint.SetRotationLimits(lo, hi); } catch (err) { /* older Jolt: keeps the wide limits */ }
				J.destroy(lo); J.destroy(hi);
			}
		}
		if (!open) this._limits_done = true;
	}

	// ---- Held poses (squatting, kneeling, sitting): balancing those with muscles only ever looks like fidgeting, so once
	// he is in one the whole body is placed from the pose's joint angles (forward kinematics from the hips); anything that
	// happens to him gives the body back to physics at once ----

	_hold_kind() {
		if (this.posture == 'squat') return 'squat';
		if (this.posture == 'kneel') return 'kneel';
		if ((this.posture == 'sit' || this.posture == 'custom') && this.seat) return 'sit';
		return '';
	}

	_update_squat_hold(delta, at_once) {
		this._hold_cool = Math.max(this._hold_cool - delta, 0);
		const kind = this._hold_kind();
		const want = kind != '' && this.alive && this.conscious && !this.fallen && this._hold_cool <= 0;
		if (!want) { this._hold_t = 0; if (this._held_pose) this.wake(); return; }
		this._hold_t += delta;
		const J = this.J, bi = this.world.bodies;
		if (!this._held_pose) {
			if (this._hold_t < 0.3) return;   // once he has started getting down (the blend takes him the rest)
			this._held_pose = true;
			this._hold_blend = 0;
			this._hold_from = this.parts.map(p => ({p: this.pos(p), q: this.quat(p)}));
			this._hold_angle = this.parts.map(p => p.target.clone());
			for (const p of this.parts) bi.SetMotionType(p.id, J.EMotionType_Kinematic, J.EActivation_Activate);
			this._hold_at = this.pos(this.pelvis);
		}
		this._hold_blend = at_once ? 1 : Math.min(this._hold_blend + delta / 0.6, 1);
		// arms and head follow the pose targets smoothly; the legs are the pose's
		const k = Math.min(delta * 6, 1);
		this.parts.forEach((p, i) => this._hold_angle[i].lerp(p.target, k));
		// (in the game the arms and head follow what he is doing; here nobody makes him do anything, so the whole body
		// keeps the pose it was made in - with the legs the game gives the held pose unless they were posed by hand)
		const ang = this.start_angles.map(a => a.clone());
		const fwd = this.facing();
		const yaw_b = glook(fwd, gv(0, 1, 0));
		const root_b = yaw_b.clone().multiply(this.start_pelvis);
		const xfs = this._fk({p: gv(), q: root_b}, ang);
		if (kind != 'kneel') {
			// feet flat on the ground
			for (const side of ['r', 'l']) {
				const fi = this.part_index['foot_' + side], f = this.parts[fi];
				const ankle = this._fk_joint(xfs, fi);
				const off = f.rest_pos.clone().sub(f.joint_pos);
				xfs[fi] = {q: yaw_b.clone(), p: ankle.add(off.applyQuaternion(yaw_b))};
			}
		}
		// down onto whatever is under him: the lowest point of him on the ground, or his seat on the seat
		let lowest = Infinity;
		this.parts.forEach((p, i) => { lowest = Math.min(lowest, this._lowest_y(i, xfs[i])); });
		let lift = this._ground_under(this._hold_at) - lowest;
		if (kind == 'sit') {
			if (Math.abs(this.seat.y - (this._hold_at.y - 0.45)) > 1.0) { this.seat = null; this.wake(); return; }   // (the seat is on another floor)
			lift = this.seat.y - this._lowest_y(0, xfs[0]);
			this._hold_at = gv(this.seat.x, this._hold_at.y, this.seat.z).addScaledVector(fwd, 0.06);
		}
		const shift = gv(this._hold_at.x, lift, this._hold_at.z);
		const b = gsmooth(0, 1, this._hold_blend);
		const dt = 1 / 120;
		const rq = new J.Quat(0, 0, 0, 1), rp = new J.RVec3(0, 0, 0);
		this.parts.forEach((p, i) => {
			const x = {p: xfs[i].p.clone().add(shift), q: xfs[i].q.clone()};
			const fr = this._hold_from[i];
			const tp = b < 1 ? fr.p.clone().lerp(x.p, b) : x.p, tq = b < 1 ? fr.q.clone().slerp(x.q, b) : x.q;
			// the body's origin is the bone's pivot, not the centre
			const wq = tq;
			const origin = tp.clone().sub(p.com_local.clone().applyQuaternion(wq));
			rp.Set(origin.x, origin.y, origin.z);
			rq.Set(wq.x, wq.y, wq.z, wq.w);
			if (at_once) bi.SetPositionAndRotation(p.id, rp, rq, J.EActivation_Activate);
			else bi.MoveKinematic(p.id, rp, rq, dt);
		});
		J.destroy(rq); J.destroy(rp);
	}

	// forward kinematics: every part's transform from the hips' and the joint angles (child = parent * angles)
	_fk(root, ang) {
		const xfs = [];
		this.parts.forEach((p, i) => {
			if (p.parent < 0) { xfs.push({p: root.p.clone(), q: root.q.clone()}); return; }
			const par = this.parts[p.parent], pxf = xfs[p.parent];
			const cb = pxf.q.clone().multiply(gquat(ang[i]));
			const jw = p.joint_pos.clone().sub(par.rest_pos).applyQuaternion(pxf.q).add(pxf.p);
			xfs.push({q: cb, p: jw.add(p.rest_pos.clone().sub(p.joint_pos).applyQuaternion(cb))});
		});
		return xfs;
	}

	_fk_joint(xfs, i) { const p = this.parts[i], par = this.parts[p.parent]; return p.joint_pos.clone().sub(par.rest_pos).applyQuaternion(xfs[p.parent].q).add(xfs[p.parent].p); }

	// the lowest point of part i's collision shape placed at xf
	_lowest_y(i, xf) {
		const sh = this.parts[i].shape, q = xf.q.clone().multiply(sh.rot);
		if (sh.kind == 'capsule') {
			const h = sh.height * 0.5 - sh.radius;
			const a = gv(0, h, 0).applyQuaternion(q).add(xf.p).y, b = gv(0, -h, 0).applyQuaternion(q).add(xf.p).y;
			return Math.min(a, b) - sh.radius;
		}
		const e = sh.size.clone().multiplyScalar(0.5);
		let lo = Infinity;
		for (const cx of [-1, 1]) for (const cy of [-1, 1]) for (const cz of [-1, 1]) lo = Math.min(lo, gv(e.x * cx, e.y * cy, e.z * cz).applyQuaternion(q).add(xf.p).y);
		return lo;
	}

	_ground_under(p) {
		const hit = this.ray(gv(p.x, p.y + 0.5, p.z), gv(0, -3, 0));
		return hit ? hit.position.y : p.y - 0.45;
	}

	// back to a fully physical body
	wake() {
		if (!this._held_pose) return;
		this._held_pose = false;
		this._hold_cool = 1.5;
		const J = this.J;
		for (const p of this.parts) {
			this.world.bodies.SetMotionType(p.id, J.EMotionType_Dynamic, J.EActivation_Activate);
			this.setLin(p, gv());
			this.setAng(p, gv());
		}
	}
}

// the hand (chest frame, right-side authored) for upper arm angles xyz and elbow bend w
function ikHand(p, se, eh) {
	const ub = gquat(gv(p[0], p[1], p[2]));
	return se.clone().applyQuaternion(ub).add(eh.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(gv(1, 0, 0), p[3])).applyQuaternion(ub));
}
const ikClamp = p => [clamp(p[0], -0.9, 2.8), clamp(p[1], -1.3, 1.3), clamp(p[2], -0.7, 2.6), clamp(p[3], 0, 2.5)];

// a small random number generator (the game's rng is seeded per person)
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashString(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function sideOfGroup(g, bones) {
	const pv = bones.find(b => roleOf(b) == 'pelvis');
	const cx = pv ? pv.origin[0] : 0;
	return g.origin[0] >= cx ? 1 : -1;
}

// the person a body belongs to (blood lands on them)
function humanoidOfBody(idx) {
	if (!current) return null;
	for (const r of current.list) if (r.is_humanoid && r.ray_exclude.has(idx)) return r;
	return null;
}

function groundLevel(rt) {
	const ws = rt.ws || {};
	if (ws.ground === false) return -1e6;
	try { return Project.model_3d.localToWorld(new THREE.Vector3(0, ws.ground_y || 0, 0)).y / SCALE; } catch (err) { return (ws.ground_y || 0) / SCALE; }
}

// Rays in the physics world (metres). Filters: none (everything is hit), people (the people's own parts are not: Godot's
// rays for the ground and the level do not see the bots)
let ray_tools = null;
function rayFilters(rt) {
	const J = rt.Jolt, w = rt.world;
	if (!ray_tools || ray_tools.w !== w) {
		ray_tools = {w, settings: new J.RayCastSettings(), bp: new J.DefaultBroadPhaseLayerFilter(w.iface.GetObjectVsBroadPhaseLayerFilter(), 1),
			ol: new J.DefaultObjectLayerFilter(w.iface.GetObjectLayerPairFilter(), 1), shape: new J.ShapeFilter(), origin: new J.RVec3(0, 0, 0), dir: new J.Vec3(0, 0, 0),
			none: new J.BodyFilter(), people: new J.IgnoreMultipleBodiesFilter(), people_ids: new Set()};
	}
	return ray_tools;
}
function addPeopleToRays(rt, ids) {
	const t = rayFilters(rt);
	for (const id of ids) { const k = id.GetIndexAndSequenceNumber(); if (!t.people_ids.has(k)) { t.people_ids.add(k); t.people.IgnoreBody(id); } }
}

// the closest hit: {position, normal, fraction, id (index and sequence number)} or null
function castRay(rt, from, dir_len, body_filter) {
	const J = rt.Jolt, w = rt.world, t = rayFilters(rt);
	t.origin.Set(from.x, from.y, from.z);
	t.dir.Set(dir_len.x, dir_len.y, dir_len.z);
	const ray = new J.RRayCast(t.origin, t.dir);
	const col = new J.CastRayClosestHitCollisionCollector();
	w.system.GetNarrowPhaseQuery().CastRay(ray, t.settings, col, t.bp, t.ol, body_filter || t.none, t.shape);
	let out = null;
	if (col.HadHit()) {
		const hit = col.mHit, f = hit.mFraction, id = hit.mBodyID;
		const position = from.clone().addScaledVector(dir_len, f);
		let normal = gv(0, 1, 0);
		try {
			const body = w.system.GetBodyLockInterfaceNoLock().TryGetBody(id);
			const p = new J.RVec3(position.x, position.y, position.z);
			const n = body.GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, p);
			normal = gv(n.GetX(), n.GetY(), n.GetZ());
			J.destroy(p);
		} catch (err) { /* keep up */ }
		out = {position, normal, fraction: f, id: id.GetIndexAndSequenceNumber()};
	}
	J.destroy(ray); J.destroy(col);
	return out;
}

// ---------------------------------------------------------------------------
// The person as Blockbench sees him: the shapes of _build_visuals (capsules, spheres, boxes; the casual outfit, short
// hair), as mesh elements in bone groups whose pivots are the game's joints. The pose (standing, sat...) is the one the
// game holds him in: joint angles from _compose_pose / HOLD_LEGS.
// ---------------------------------------------------------------------------

const HUMANOID_GROUPS = {pelvis: 'Pelvis', abdomen: 'Abdomen', chest: 'Chest', head: 'Head', upper_arm: 'Upper Arm', forearm: 'Forearm', hand: 'Hand', thigh: 'Thigh', shin: 'Shin', foot: 'Foot'};
const groupNameOf = part => { const m = part.match(/^(.*?)(?:_([rl]))?$/); return HUMANOID_GROUPS[m[1]] + (m[2] ? ' ' + m[2].toUpperCase() : ''); };

// a mesh as [vertices, faces] (faces counter-clockwise seen from outside), unit sizes: capsule (radius, total height),
// ellipsoid (radius, height: Godot's SphereMesh), box (size)
function meshCapsule(r, h, seg = 12, rings = 3) {
	const v = [], f = [], half = Math.max(0, h / 2 - r);
	const ring = (y, rr) => { const start = v.length; for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2; v.push([Math.cos(a) * rr, y, Math.sin(a) * rr]); } return start; };
	const rows = [];
	for (let k = rings; k >= 1; k--) { const a = k / rings * Math.PI / 2; rows.push(ring(half + Math.cos(a) * r, Math.sin(a) * r)); }
	rows.push(ring(half, r));
	rows.push(ring(-half, r));
	for (let k = 1; k <= rings; k++) { const a = Math.PI / 2 - k / rings * Math.PI / 2; if (k == rings) break; rows.push(ring(-half - Math.sin(Math.PI / 2 - a) * r, Math.cos(Math.PI / 2 - a) * r)); }
	// (rows go from the top down; the pole caps close them)
	const top = v.length; v.push([0, half + r, 0]);
	const bottom = v.length; v.push([0, -half - r, 0]);
	for (let k = 0; k < rows.length - 1; k++) for (let i = 0; i < seg; i++) {
		const a = rows[k] + i, b = rows[k] + (i + 1) % seg, c = rows[k + 1] + (i + 1) % seg, d = rows[k + 1] + i;
		f.push([a, b, c, d]);
	}
	for (let i = 0; i < seg; i++) {
		f.push([top, rows[0] + (i + 1) % seg, rows[0] + i]);
		const last = rows[rows.length - 1];
		f.push([bottom, last + i, last + (i + 1) % seg]);
	}
	return orient([v, f]);
}
function meshSphere(r, h, seg = 12, rings = 7) {
	const v = [], f = [];
	const rows = [];
	for (let k = 1; k < rings; k++) {
		const a = k / rings * Math.PI, start = v.length;
		for (let i = 0; i < seg; i++) { const b = i / seg * Math.PI * 2; v.push([Math.cos(b) * Math.sin(a) * r, Math.cos(a) * h / 2, Math.sin(b) * Math.sin(a) * r]); }
		rows.push(start);
	}
	const top = v.length; v.push([0, h / 2, 0]);
	const bottom = v.length; v.push([0, -h / 2, 0]);
	for (let k = 0; k < rows.length - 1; k++) for (let i = 0; i < seg; i++) f.push([rows[k] + i, rows[k] + (i + 1) % seg, rows[k + 1] + (i + 1) % seg, rows[k + 1] + i]);
	for (let i = 0; i < seg; i++) { f.push([top, rows[0] + (i + 1) % seg, rows[0] + i]); const last = rows[rows.length - 1]; f.push([bottom, last + i, last + (i + 1) % seg]); }
	return orient([v, f]);
}
function meshBox(x, y, z) {
	const v = [];
	for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) v.push([sx * x / 2, sy * y / 2, sz * z / 2]);
	return orient([v, [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]]);
}
// turns every face so it looks out of the shape (all three shapes are convex round their centre)
function orient([v, f]) {
	const c = v.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map(x => x / v.length);
	const faces = f.map(face => {
		const [a, b, d] = face.map(i => new THREE.Vector3(...v[i]));
		const n = new THREE.Vector3().crossVectors(b.clone().sub(a), d.clone().sub(a));
		const mid = face.reduce((s, i) => s.add(new THREE.Vector3(...v[i])), new THREE.Vector3()).divideScalar(face.length);
		return n.dot(mid.sub(new THREE.Vector3(...c))) < 0 ? face.slice().reverse() : face;
	});
	return [v, faces];
}

// the visual pieces of each part: [mesh, material, position, rotation (Godot euler), scale], relative to the part's centre
function humanoidVisuals() {
	const ax = [0, 0, Math.PI * 0.5], cap = meshCapsule, sph = meshSphere;
	const V = {
		pelvis: [[cap(0.135, 0.36), 'pants', [0, 0, 0], ax, [1, 1, 0.85]]],
		abdomen: [[cap(0.125, 0.31), 'shirt', [0, 0, 0], ax, [1, 1, 0.82]]],
		chest: [[cap(0.15, 0.4), 'shirt', [0, 0, 0], ax, [1, 1, 0.8]], [cap(0.09, 0.44), 'shirt', [0, 0.07, 0.01], ax, [1, 1, 0.95]]],
		head: [
			[cap(0.055, 0.17), 'skin', [0, -0.12, 0.012]],                                   // neck
			[sph(0.1, 0.235), 'skin', [0, 0.01, 0], null, [0.93, 1, 1.08]],                    // skull
			[sph(0.07, 0.1), 'skin', [0, -0.06, -0.035], null, [1.05, 1, 1.2]],                // jaw
			[cap(0.014, 0.05, 8, 2), 'skin', [0, -0.005, -0.103], [-0.35, 0, 0], [1.2, 1, 1]], // nose
			[sph(0.02, 0.04, 10, 5), 'lips', [0, -0.072, -0.108], null, [1.25, 0.2, 0.35]],    // mouth
			[sph(0.104, 0.2), 'hair', [0, 0.05, 0.012], [-0.25, 0, 0], [0.96, 0.8, 1.06]],      // short hair
		],
	};
	for (const sx of [-1, 1]) {
		V.head.push([sph(0.022, 0.05, 8, 5), 'skin', [0.093 * sx, 0, 0.01], null, [0.5, 1, 0.9]]);        // ear
		V.head.push([sph(0.011, 0.022, 8, 5), 'eye', [0.035 * sx, 0.025, -0.092], null, [1, 0.7, 0.5]]);  // eye
		V.head.push([cap(0.008, 0.04, 6, 2), 'hair', [0.035 * sx, 0.047, -0.094], [0, 0, Math.PI * 0.5 + 0.15 * sx]]);   // brow
	}
	for (const side of ['r', 'l']) {
		V['upper_arm_' + side] = [[cap(0.058, 0.32), 'shirt'], [sph(0.062, 0.12), 'shirt', [0, 0.12, 0]]];
		V['forearm_' + side] = [[cap(0.047, 0.29), 'skin']];
		V['hand_' + side] = [[meshBox(0.044, 0.11, 0.078), 'skin', [0, 0.022, 0]], [cap(0.03, 0.1, 8, 2), 'skin', [0, 0.08, 0]], [meshBox(0.022, 0.045, 0.022), 'skin', [0, 0.05, -0.047], [0.35, 0, 0]]];
		V['thigh_' + side] = [[cap(0.082, 0.46), 'pants']];
		V['shin_' + side] = [[cap(0.062, 0.46), 'pants']];
		V['foot_' + side] = [[cap(0.05, 0.26), 'shoes', [0, -0.005, -0.005], [Math.PI * 0.5, 0, 0], [1, 1, 0.8]], [sph(0.05, 0.06), 'shoes', [0, 0.03, 0.06]]];
	}
	return V;
}

// The character for Blockbench (pixels), in a posture the game holds: 'stand', 'sit' (on a chair), 'kneel', 'squat',
// 'crouch', 'hands_up', 'cover_head', 'aim'
function humanoidSpec(o = {}) {
	const posture = POSTURES.includes(o.pose) ? o.pose : 'stand';
	const s = o.height ? o.height / 28.7 : 1;
	const px = s * SCALE;
	const visuals = humanoidVisuals();
	// the joint angles of the pose (as the muscles hold it)
	const ang = {};
	const set = (name, e) => { ang[name] = e.clone(); };
	const side = (part, sd, e) => set(part + '_' + sd, sd == 'l' ? gv(e.x, -e.y, -e.z) : e);
	for (const d of humanoidPartsList()) ang[d.name] = gv();
	// standing: every bone straight (arms straight down, legs straight, feet forward), so the skeleton is even from the
	// front, the side and above
	let lean = 0;
	if (posture == 'crouch' || posture == 'cover_head') {
		for (const sd of ['r', 'l']) { side('thigh', sd, gv(1.55, 0, 0.18)); side('shin', sd, gv(-2.2, 0, 0)); side('foot', sd, gv(0.4, 0, 0)); }
		set('abdomen', gv(-0.45, 0, 0)); set('chest', gv(-0.3, 0, 0));
		if (posture == 'cover_head') for (const sd of ['r', 'l']) { side('upper_arm', sd, gv(2.3, 0.3, 0.55)); side('forearm', sd, gv(2.2, 0, 0)); }
	} else if (posture == 'aim') {
		side('upper_arm', 'r', gv(1.45, 0.05, 0.12)); side('forearm', 'r', gv(0.12, 0, 0)); side('hand', 'r', gv());
		side('upper_arm', 'l', gv(1.25, 0, -0.35)); side('forearm', 'l', gv(0.7, 0, 0));
	} else if (posture == 'hands_up') {
		for (const sd of ['r', 'l']) { side('upper_arm', sd, gv(2.65, 0, 0.45)); side('forearm', sd, gv(0.55, 0, 0)); side('hand', sd, gv(-0.3, 0, 0)); }
	} else if (posture == 'squat') {
		for (const sd of ['r', 'l']) { side('upper_arm', sd, gv(0.6, 0, 0.22)); side('forearm', sd, gv(0.75, 0, 0)); side('hand', sd, gv(0.35, 0, 0)); }
		set('abdomen', gv(-0.28, 0, 0)); set('chest', gv(-0.12, 0, 0));
	} else if (posture == 'kneel') set('abdomen', gv(-0.08, 0, 0));
	if (holdLegs()[posture]) {
		const l = holdLegs()[posture];
		lean = l[0];
		for (const sd of ['r', 'l']) { side('thigh', sd, l[1]); side('shin', sd, l[2]); side('foot', sd, l[3]); }
	}
	// forward kinematics of the posture (metres, the game's rest frame); the hips are where the lowest point lands on the
	// ground (or the pelvis on the seat)
	const parts = humanoidPartsList().map(d => ({d, rest: d.center.clone().multiplyScalar(s), joint: d.joint ? d.joint.clone().multiplyScalar(s) : null}));
	const index = Object.fromEntries(humanoidPartsList().map((d, i) => [d.name, i]));
	const root_q = new THREE.Quaternion().setFromAxisAngle(gv(1, 0, 0), -lean);
	const xfs = [];
	parts.forEach((p, i) => {
		if (!p.d.parent) { xfs.push({p: gv(), q: root_q.clone()}); return; }
		const par = parts[index[p.d.parent]], pxf = xfs[index[p.d.parent]];
		const q = pxf.q.clone().multiply(gquat(ang[p.d.name]));
		const jw = p.joint.clone().sub(par.rest).applyQuaternion(pxf.q).add(pxf.p);
		xfs.push({q, p: jw.add(p.rest.clone().sub(p.joint).applyQuaternion(q))});
	});
	let lowest = Infinity;
	parts.forEach((p, i) => {
		const sh = p.d.shape, q = xfs[i].q.clone().multiply(sh.cap ? gquat(gv(...sh.rot)) : new THREE.Quaternion());
		const pts = sh.cap ? [gv(0, sh.cap[1] * s / 2 - sh.cap[0] * s, 0), gv(0, -(sh.cap[1] * s / 2 - sh.cap[0] * s), 0)] : [];
		if (sh.cap) pts.forEach(pt => { lowest = Math.min(lowest, pt.applyQuaternion(q).add(xfs[i].p).y - sh.cap[0] * s); });
		else for (const cx of [-1, 1]) for (const cy of [-1, 1]) for (const cz of [-1, 1]) lowest = Math.min(lowest, gv(cx * sh.box[0] * s / 2, cy * sh.box[1] * s / 2, cz * sh.box[2] * s / 2).applyQuaternion(q).add(xfs[i].p).y);
	});
	const seat_top = 0.423 * s;
	// where the pelvis is (FK above is relative to it): the lowest point on the ground, or sitting the bottom of the pelvis on the seat
	const offset = gv(0, (posture == 'sit' ? seat_top + 0.125 * s : -lowest) - 0.97 * s, 0);
	const rnd = v => Math.round(v * 1000) / 1000;
	const bones = [];
	parts.forEach((p, i) => {
		const d = p.d;
		const pivot_m = (d.joint ? p.joint : p.rest).clone().add(offset);
		const local_q = d.parent ? gquat(ang[d.name]) : root_q;
		const e = new THREE.Euler().setFromQuaternion(local_q, 'ZYX');
		const meshes = (visuals[d.name] || []).map(([mesh, mat, pos, rot, scl]) => {
			const q = gquat(gv(...(rot || [0, 0, 0]))), sc = gv(...(scl || [1, 1, 1]));
			const centre = p.rest.clone().add(offset).add(gv(...(pos || [0, 0, 0])).multiplyScalar(s));
			const vertices = mesh[0].map(v => gv(...v).multiplyScalar(s).multiply(sc).applyQuaternion(q).add(centre).multiplyScalar(SCALE).toArray().map(rnd));
			return {mat, origin: centre.clone().multiplyScalar(SCALE).toArray().map(rnd), vertices, faces: mesh[1]};
		});
		bones.push({name: groupNameOf(d.name), role: humanoidRole(d.name).role, part: d.name, parent: d.parent ? groupNameOf(d.parent) : null,
			pivot: pivot_m.multiplyScalar(SCALE).toArray().map(rnd), rot: [e.x / D2R, e.y / D2R, e.z / D2R].map(v => Math.round(v * 100) / 100), cubes: [], meshes});
	});
	let chair = null;
	if (posture == 'sit') {
		const top = seat_top / s, t = 0.04, k = px;
		const cube = (c, size) => ({from: [0, 1, 2].map(i => rnd((c[i] - size[i] / 2) * k)), to: [0, 1, 2].map(i => rnd((c[i] + size[i] / 2) * k)), mat: 'chair'});
		const post = (sx, zc) => cube([sx * 0.2, top / 2 - t / 2, zc], [0.03, top - t, 0.03]);
		chair = {name: 'Chair', cubes: [cube([0, top - t / 2, -0.05], [0.5, t, 0.5]), cube([0, top + 0.28, 0.22], [0.46, 0.55, 0.04]), post(1, 0.18), post(-1, 0.18), post(1, -0.3), post(-1, -0.3)]};
	}
	return {bones, chair, pose: posture, model: 'npc', scale: s};
}

// ---------------------------------------------------------------------------
// Blood shapes (scripts/fx/blood_tex.gd): each shape is built as a thickness field; from it the colour + coverage
// (decals) and the paint mask (R = film thickness, A = coverage: painted into the floor map) are baked. Cached.
// Also the smoke puff of the mist (textures.gd) and the splash animation (blood_splash.gd).
// ---------------------------------------------------------------------------

// FastNoiseLite as Godot makes it by default: smooth simplex, frequency 0.01, fractal FBM of 5 octaves
function makeNoise(seed) {
	const rnd = mulberry(seed >>> 0), perm = new Uint8Array(512), p = [...Array(256).keys()];
	for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
	for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
	const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
	const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
	const simplex = (x, y) => {
		const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2;
		const x0 = x - (i - t), y0 = y - (j - t);
		const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
		const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
		const ii = i & 255, jj = j & 255;
		let n = 0;
		for (const [dx, dy, gi] of [[x0, y0, perm[ii + perm[jj]]], [x1, y1, perm[ii + i1 + perm[jj + j1]]], [x2, y2, perm[ii + 1 + perm[jj + 1]]]]) {
			const tt = 0.5 - dx * dx - dy * dy;
			if (tt > 0) { const g = G[gi & 7]; n += tt * tt * tt * tt * (g[0] * dx + g[1] * dy); }
		}
		return 70 * n;
	};
	const bound = 1 / (1 + 0.5 + 0.25 + 0.125 + 0.0625);
	return {get(x, y) {
		let sum = 0, amp = 1, f = 0.01;
		for (let o = 0; o < 5; o++) { sum += simplex(x * f + o * 31.7, y * f - o * 17.3) * amp; amp *= 0.5; f *= 2; }
		return sum * bound;
	}};
}

// RandomNumberGenerator in the shape of Godot's
function makeRng(seed) {
	const r = mulberry(seed >>> 0);
	return {randf: r, range: (a, b) => a + (b - a) * r(), int: (a, b) => a + Math.floor(r() * (b - a + 1)), randfn: (m, d) => { const u = Math.max(1e-9, r()), v = r(); return m + d * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }};
}

const BT_WET = [0.48, 0.022, 0.016], BT_THICK = [0.24, 0.006, 0.006], BT_CLOT = [0.05, 0, 0];
const bt_cache = {};

const btPx = (size, u) => Math.floor((u * 0.5 + 0.5) * (size - 1));
// dome-shaped bump, merged with max()
function btBump(h, size, cx, cy, r, amp) {
	const x0 = Math.max(btPx(size, cx - r), 0), x1 = Math.min(btPx(size, cx + r) + 1, size - 1);
	const y0 = Math.max(btPx(size, cy - r), 0), y1 = Math.min(btPx(size, cy + r) + 1, size - 1);
	const inv = 2 / (size - 1);
	for (let y = y0; y <= y1; y++) {
		const py = y * inv - 1;
		for (let x = x0; x <= x1; x++) {
			const d = Math.hypot(x * inv - 1 - cx, py - cy) / r;
			if (d < 1) { const v = amp * Math.sqrt(1 - d * d), i = y * size + x; if (v > h[i]) h[i] = v; }
		}
	}
}
// lobed blob: radius varies with angle, flat-ish top, soft edge
function btBlob(h, size, n, r0, lobes, freq, amp) {
	const inv = 2 / (size - 1);
	for (let y = 0; y < size; y++) {
		const py = y * inv - 1;
		for (let x = 0; x < size; x++) {
			const px = x * inv - 1, d = Math.sqrt(px * px + py * py);
			if (d > r0 * (1 + lobes * 1.6)) continue;
			const a = Math.atan2(py, px);
			const r = r0 * (1 + lobes * n.get(Math.cos(a) * freq * 40, Math.sin(a) * freq * 40) * 2);
			const edge = (r - d) / Math.max(r, 0.001);
			if (edge > 0) { const v = amp * Math.pow(clamp(edge * 3.5, 0, 1), 0.55), i = y * size + x; h[i] = Math.max(h[i], v); }
		}
	}
}
function btSplat(h, size, rng, n) {
	const r0 = rng.range(0.3, 0.42);
	btBlob(h, size, n, r0, 0.18, 1.3, 0.85);
	// a few short tails on the side the drop was travelling (+V)
	for (let s = rng.int(1, 4); s > 0; s--) {
		const a = Math.PI * 0.5 + rng.range(-0.55, 0.55), dx = Math.cos(a), dy = Math.sin(a);
		const length = rng.range(0.08, 0.3), w = rng.range(0.04, 0.08), steps = Math.floor(length / 0.02) + 2;
		for (let k = 0; k < steps; k++) { const t = k / steps, d = r0 * 0.75 + length * t; btBump(h, size, dx * d, dy * d, w * (1 - t * 0.6), 0.6); }
		const e = r0 * 0.75 + length + 0.02;
		btBump(h, size, dx * e, dy * e, w * 0.75, 0.65);
	}
	// loose satellite droplets, mostly thrown ahead
	for (let s = rng.int(4, 12); s > 0; s--) {
		const a = Math.PI * 0.5 + rng.range(-1.2, 1.2), d = rng.range(r0 + 0.08, 0.93), r = rng.range(0.008, 0.03) * (1.2 - d * 0.5);
		btBump(h, size, Math.cos(a) * d, Math.sin(a) * d, r, 0.7);
	}
}
function btDrop(h, size, rng, n) {
	btBlob(h, size, n, 0.7, 0.09, 4.0, 0.75);
	for (let s = rng.int(0, 4); s > 0; s--) { const a = rng.randf() * Math.PI * 2, d = rng.range(0.8, 0.92); btBump(h, size, Math.cos(a) * d, Math.sin(a) * d, rng.range(0.04, 0.07), 0.6); }
}
function btStreak(h, size, n) {
	const inv = 2 / (size - 1);
	for (let y = 0; y < size; y++) {
		const py = y * inv - 1;
		const centre = n.get(0, py * 60) * 0.18;
		const half = (0.55 + n.get(50, py * 90) * 0.18) * gsmooth(1.0, 0.8, Math.abs(py));
		for (let x = 0; x < size; x++) { const e = half - Math.abs(x * inv - 1 - centre); if (e > 0) h[y * size + x] = 0.7 * Math.pow(clamp(e * 6, 0, 1), 0.5); }
	}
}
function btPrint(h, size, n, left) {
	const inv = 2 / (size - 1);
	for (let y = 0; y < size; y++) {
		const py = y * inv - 1;
		for (let x = 0; x < size; x++) {
			const px = (x * inv - 1) * (left ? -1 : 1);
			const fore = Math.pow((px - 0.08 + py * 0.08) / 0.62, 2) + Math.pow((py + 0.3) / 0.62, 2);
			const heel = Math.pow(px / 0.5, 2) + Math.pow((py - 0.62) / 0.32, 2);
			const inside = Math.min(fore, heel);
			if (inside < 1) {
				const tread = 0.5 + 0.5 * Math.sin(py * 38 + n.get(x * 3, y * 3) * 4);
				const blotch = n.get(x * 2, y * 2) * 0.5 + 0.5;
				h[y * size + x] = 0.35 * gsmooth(1, 0.8, inside) * gsmooth(0.25, 0.6, tread * 0.6 + blotch * 0.7);
			}
		}
	}
}
function btBrush(h, size, n) {
	const inv = 2 / (size - 1);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const px = x * inv - 1, py = y * inv - 1, r = Math.sqrt(px * px + py * py);
		if (r >= 1) continue;
		const fibre = n.get(px * 240, 7) * 0.5 + 0.5;
		h[y * size + x] = 0.6 * gsmooth(1, 0.55, r) * gsmooth(0.25, 0.7, fibre);
	}
}
function btPool(h, size, rng, n) {
	// irregular spread: a main body plus a few merged lobes of different size
	btBlob(h, size, n, 0.55, 0.2, 1.3, 1.0);
	for (let s = rng.int(3, 5); s > 0; s--) { const a = rng.randf() * Math.PI * 2, d = rng.range(0.3, 0.5); btBump(h, size, Math.cos(a) * d, Math.sin(a) * d, rng.range(0.2, 0.36), 1.0); }
}
function btSmear(h, size, n) {
	const inv = 2 / (size - 1);
	for (let y = 0; y < size; y++) {
		const py = y * inv - 1;
		for (let x = 0; x < size; x++) {
			const px = x * inv - 1;
			const env = 1 - Math.pow(Math.abs(px) / 0.8, 2) - Math.pow(Math.abs(py) / 0.95, 6);
			if (env <= 0) continue;
			const fibre = n.get(px * 260, py * 25) * 0.5 + 0.5;
			const run_out = gsmooth(0.95, -0.7, py + n.get(px * 120, 300) * 0.5);
			h[y * size + x] = gsmooth(0.3, 0.8, fibre * 0.55 + env * 0.55 + run_out * 0.3) * run_out * 0.5;
		}
	}
}
function btWound(h, size, rng, n) {
	btBlob(h, size, n, 0.55, 0.2, 2.0, 0.55);
	for (let s = 0; s < 10; s++) { const a = rng.randf() * Math.PI * 2, d = rng.range(0.55, 0.9); btBump(h, size, Math.cos(a) * d, Math.sin(a) * d, rng.range(0.03, 0.07), 0.5); }
	btBlob(h, size, n, 0.2, 0.25, 3.0, 1.5);   // torn entry hole: very high values bake to near-black clotted colour
}

// {albedo: RGBA bytes (colour, coverage), mask: RGBA bytes (thickness, 0, 0, coverage), size} for a shape kind and variant
function bloodShape(kind, variant) {
	const key = kind + '_' + variant;
	if (bt_cache[key]) return bt_cache[key];
	// (Godot: 96 / 192 px; here a power of two, so the textures have mip maps)
	const size = ['drop', 'wound', 'streak', 'brush', 'print'].includes(kind) ? 128 : 256;
	const h = new Float32Array(size * size);
	const rng = makeRng(hashString(key)), n = makeNoise(Math.floor(rng.randf() * 4294967295));
	switch (kind) {
		case 'splat': btSplat(h, size, rng, n); break;
		case 'drop': btDrop(h, size, rng, n); break;
		case 'streak': btStreak(h, size, n); break;
		case 'brush': btBrush(h, size, n); break;
		case 'print': btPrint(h, size, n, variant == 1); break;
		case 'pool': btPool(h, size, rng, n); break;
		case 'smear': btSmear(h, size, n); break;
		case 'wound': btWound(h, size, rng, n); break;
	}
	const flat = kind == 'pool';
	const albedo = new Uint8Array(size * size * 4), mask = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
	// the normal map of the film (blood_tex.gd _bake), its slope kept as the game's at our finer pixels
	const ns = (flat ? 2.2 : 3.0) * size / (['drop', 'wound', 'streak', 'brush', 'print'].includes(kind) ? 96 : 192);
	const H = (x, y) => Math.min(h[clamp(y, 0, size - 1) * size + clamp(x, 0, size - 1)], 1);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const nx = (H(x - 1, y) - H(x + 1, y)) * ns, ny = (H(x, y + 1) - H(x, y - 1)) * ns, l = Math.hypot(nx, ny, 1);
		normal.set([(nx / l * 0.5 + 0.5) * 255, (ny / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255, 255].map(Math.round), (y * size + x) * 4);
	}
	for (let i = 0; i < size * size; i++) {
		const v = h[i];
		const a = gsmooth(0.02, 0.1, v);
		const t = gsmooth(0.1, 0.95, v);
		let c = BT_WET.map((w, k) => w + (BT_THICK[k] - w) * t);
		if (v > 1) { const u = gsmooth(1, 1.4, v); c = c.map((x, k) => x + (BT_CLOT[k] - x) * u); }
		// slightly darker rim where the film dries first
		const rim = gsmooth(0.02, 0.07, v) * (1 - gsmooth(0.07, 0.22, v));
		c = c.map(x => x * (1 - rim * 0.25));
		albedo.set([c[0] * 255, c[1] * 255, c[2] * 255, a * 255].map(Math.round), i * 4);
		// paint mask: R = film thickness, A = coverage (a pool is one even sheet, full depth a little in from its edge)
		const th = flat ? gsmooth(0.02, 0.3, v) : clamp(v / 1.2, 0, 1);
		mask.set([th * 255, 0, 0, gsmooth(0.01, 0.09, v) * 255].map(Math.round), i * 4);
	}
	return (bt_cache[key] = {albedo, mask, normal, size, key});
}

// the mist's puff: a soft noisy round blot
function smokePuff() {
	if (bt_cache.smoke) return bt_cache.smoke;
	const size = 128, data = new Uint8Array(size * size * 4), n = makeNoise(77);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const d = Math.hypot(x - size * 0.5, y - size * 0.5) / (size * 0.5);
		let fall = clamp(1 - d, 0, 1); fall = fall * fall * (3 - 2 * fall);
		// (FastNoiseLite at frequency 0.045, 4 octaves)
		const v = clamp(n.get(x * 4.5, y * 4.5) * 0.6 + 0.6, 0, 1);
		data.set([255, 255, 255, Math.round(clamp(fall * v * 1.2, 0, 1) * 255)], (y * size + x) * 4);
	}
	return (bt_cache.smoke = {data, size});
}

// The splash at a hit (blood_splash.gd): eight frames of a burst drawn once: alpha the blood, red how thin, green a glint
function splashAtlas() {
	if (bt_cache.splash) return bt_cache.splash;
	const CELL = 128, FX = 4, FY = 2, W = CELL * FX, H = CELL * FY;
	const img = new Float32Array(W * H * 4);
	const rng = makeRng(77);
	const disc = (ox, oy, cx, cy, r, a, thin, glint) => {
		const x0 = Math.max(Math.floor(cx - r - 1), 0), x1 = Math.min(Math.floor(cx + r + 1), CELL - 1);
		const y0 = Math.max(Math.floor(cy - r - 1), 0), y1 = Math.min(Math.floor(cy + r + 1), CELL - 1);
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
			const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / Math.max(r, 0.001);
			if (d > 1) continue;
			const v = clamp((1 - d) * 3, 0, 1) * a, i = ((oy + y) * W + ox + x) * 4;
			if (v > img[i + 3]) {
				const g = glint * clamp(1 - d * 2.5, 0, 1);
				img[i] = Math.max(img[i], thin); img[i + 1] = Math.max(img[i + 1], g); img[i + 3] = v;
			}
		}
	};
	// the drops: where each flies (mostly forward, along +x, the throw) and how big it is
	const drops = [];
	for (let i = 0; i < 34; i++) {
		const ang = i < 24 ? rng.randfn(0, 0.75) : rng.range(-Math.PI, Math.PI);
		drops.push([ang, rng.range(0.45, 1.0) * (i < 24 ? 1 : 0.55), rng.range(0.6, 1.4)]);
	}
	const count = FX * FY;
	for (let f = 0; f < count; f++) {
		const t = f / (count - 1), ox = (f % FX) * CELL, oy = Math.floor(f / FX) * CELL;
		const cx = CELL * 0.38, cy = CELL * 0.5;
		const out = 1 - Math.pow(1 - t, 2.2);
		// the core: a ragged blob that bursts, then breaks up and thins
		const core_r = CELL * (0.09 + 0.12 * Math.sqrt(t)) * (1 - 0.5 * gsmooth(0.55, 1.0, t));
		const core_a = 1 - gsmooth(0.35, 1.0, t);
		for (let k = 0; k < 9; k++) {
			const a = Math.PI * 2 * k / 9 + rng.randf() * 0.4, rr = core_r * rng.range(0.2, 0.55);
			disc(ox, oy, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, core_r * rng.range(0.45, 0.75), core_a, 0.15, 0.4 * (1 - t));
		}
		// the drops: a streak from the core early on, a round drop at the end of it later; small ones fade first
		for (const d of drops) {
			const dx = Math.cos(d[0]), dy = Math.sin(d[0]);
			const reach = CELL * 0.6 * d[1] * out, r = CELL * 0.022 * d[2] * (1 - 0.55 * t);
			const alpha = 1 - gsmooth(0.55 + 0.35 * d[2] / 1.4, 1.0, t);
			if (alpha <= 0 || r < 0.6) continue;
			const tail = clamp(0.55 - t, 0, 0.55);
			for (let s = 0; s <= 6; s++) {
				const u = s / 6, along = reach * glerp(1 - tail, 1, u);
				disc(ox, oy, cx + dx * along, cy + dy * along, r * glerp(0.45, 1, u), alpha * glerp(0.5, 1, u), 0.55 * t, 0);
			}
		}
	}
	const data = new Uint8Array(W * H * 4);
	for (let i = 0; i < data.length; i++) data[i] = Math.round(clamp(img[i], 0, 1) * 255);
	return (bt_cache.splash = {data, width: W, height: H});
}

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
		this._time = 0; this._tick = 0; this._smear_t = 0; this._since_sim = 0;
		this._timers = [];
		this.view = null;
		// High: every drop of it flies on its own and lands where its flight takes it (nothing is thinned out, no drop
		// is dropped for want of room, a burst is drops and not rays painted at once)
		this.high = people.some(r => r.s && r.s.blood_high);
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
				if (people.has(n) || (n.attach && n.attach.root) || (n.physics && n.physics.type == 'dynamic') || n.cloth) return true; } return false; };
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
		Object.assign(d, {pos: pos.clone(), vel: vel.clone(), vol: Math.min(vol, 12), age: 0, drip, ignore, ignore_t, streak});
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
		if (n.y < -0.6) { if (d.vol > 0.3) this._start_run(p, n, d.vol * 0.6); }
		else if (n.y <= 0.8 && d.vol > 0.2) this._start_run(p, n, d.vol * 0.75);
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
					this._world_stamp(null, r.pos, r.n, r.dir, r.width, r.width * 1.4, 'drop', 0, 1.0, 0.5);
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
			this._world_stamp(null, r.pos.clone().addScaledVector(r.dir, -len * 0.5), r.n, r.dir, r.width, r.width + len, 'drop', 0, 1.0, 0.45);
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
			if (this.view) this.view.dab(p, n, along, w, l, kind, variant, thick, alpha, null);
			this._wrap_edges(p, n, along, w, l, kind, variant, thick, alpha, null);
			return;
		}
		if (this.view) this.view.decal(col && col.entry, p, n, along, w, l, kind, variant, alpha, this._time);
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
		this.clock = 0;
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

// three.js r129 examples/js/geometries/DecalGeometry.js (MIT), for blood stains projected on moving things
if (!THREE.DecalGeometry) {
// --- three.js r129 examples/js/geometries/DecalGeometry.js ---
( function () {

	/**
 * You can use this geometry to create a decal mesh, that serves different kinds of purposes.
 * e.g. adding unique details to models, performing dynamic visual environmental changes or covering seams.
 *
 * Constructor parameter:
 *
 * mesh — Any mesh object
 * position — Position of the decal projector
 * orientation — Orientation of the decal projector
 * size — Size of the decal projector
 *
 * reference: http://blog.wolfire.com/2009/06/how-to-project-decals/
 *
 */

	class DecalGeometry extends THREE.BufferGeometry {

		constructor( mesh, position, orientation, size ) {

			super(); // buffers

			const vertices = [];
			const normals = [];
			const uvs = []; // helpers

			const plane = new THREE.Vector3(); // this matrix represents the transformation of the decal projector

			const projectorMatrix = new THREE.Matrix4();
			projectorMatrix.makeRotationFromEuler( orientation );
			projectorMatrix.setPosition( position );
			const projectorMatrixInverse = new THREE.Matrix4();
			projectorMatrixInverse.copy( projectorMatrix ).invert(); // generate buffers

			generate(); // build geometry

			this.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
			this.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
			this.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );

			function generate() {

				let decalVertices = [];
				const vertex = new THREE.Vector3();
				const normal = new THREE.Vector3(); // handle different geometry types

				if ( mesh.geometry.isGeometry === true ) {

					console.error( 'THREE.DecalGeometry no longer supports THREE.Geometry. Use THREE.BufferGeometry instead.' );
					return;

				}

				const geometry = mesh.geometry;
				const positionAttribute = geometry.attributes.position;
				const normalAttribute = geometry.attributes.normal; // first, create an array of 'DecalVertex' objects
				// three consecutive 'DecalVertex' objects represent a single face
				//
				// this data structure will be later used to perform the clipping

				if ( geometry.index !== null ) {

					// indexed THREE.BufferGeometry
					const index = geometry.index;

					for ( let i = 0; i < index.count; i ++ ) {

						vertex.fromBufferAttribute( positionAttribute, index.getX( i ) );
						normal.fromBufferAttribute( normalAttribute, index.getX( i ) );
						pushDecalVertex( decalVertices, vertex, normal );

					}

				} else {

					// non-indexed THREE.BufferGeometry
					for ( let i = 0; i < positionAttribute.count; i ++ ) {

						vertex.fromBufferAttribute( positionAttribute, i );
						normal.fromBufferAttribute( normalAttribute, i );
						pushDecalVertex( decalVertices, vertex, normal );

					}

				} // second, clip the geometry so that it doesn't extend out from the projector


				decalVertices = clipGeometry( decalVertices, plane.set( 1, 0, 0 ) );
				decalVertices = clipGeometry( decalVertices, plane.set( - 1, 0, 0 ) );
				decalVertices = clipGeometry( decalVertices, plane.set( 0, 1, 0 ) );
				decalVertices = clipGeometry( decalVertices, plane.set( 0, - 1, 0 ) );
				decalVertices = clipGeometry( decalVertices, plane.set( 0, 0, 1 ) );
				decalVertices = clipGeometry( decalVertices, plane.set( 0, 0, - 1 ) ); // third, generate final vertices, normals and uvs

				for ( let i = 0; i < decalVertices.length; i ++ ) {

					const decalVertex = decalVertices[ i ]; // create texture coordinates (we are still in projector space)

					uvs.push( 0.5 + decalVertex.position.x / size.x, 0.5 + decalVertex.position.y / size.y ); // transform the vertex back to world space

					decalVertex.position.applyMatrix4( projectorMatrix ); // now create vertex and normal buffer data

					vertices.push( decalVertex.position.x, decalVertex.position.y, decalVertex.position.z );
					normals.push( decalVertex.normal.x, decalVertex.normal.y, decalVertex.normal.z );

				}

			}

			function pushDecalVertex( decalVertices, vertex, normal ) {

				// transform the vertex to world space, then to projector space
				vertex.applyMatrix4( mesh.matrixWorld );
				vertex.applyMatrix4( projectorMatrixInverse );
				normal.transformDirection( mesh.matrixWorld );
				decalVertices.push( new DecalVertex( vertex.clone(), normal.clone() ) );

			}

			function clipGeometry( inVertices, plane ) {

				const outVertices = [];
				const s = 0.5 * Math.abs( size.dot( plane ) ); // a single iteration clips one face,
				// which consists of three consecutive 'DecalVertex' objects

				for ( let i = 0; i < inVertices.length; i += 3 ) {

					let total = 0;
					let nV1;
					let nV2;
					let nV3;
					let nV4;
					const d1 = inVertices[ i + 0 ].position.dot( plane ) - s;
					const d2 = inVertices[ i + 1 ].position.dot( plane ) - s;
					const d3 = inVertices[ i + 2 ].position.dot( plane ) - s;
					const v1Out = d1 > 0;
					const v2Out = d2 > 0;
					const v3Out = d3 > 0; // calculate, how many vertices of the face lie outside of the clipping plane

					total = ( v1Out ? 1 : 0 ) + ( v2Out ? 1 : 0 ) + ( v3Out ? 1 : 0 );

					switch ( total ) {

						case 0:
						{

							// the entire face lies inside of the plane, no clipping needed
							outVertices.push( inVertices[ i ] );
							outVertices.push( inVertices[ i + 1 ] );
							outVertices.push( inVertices[ i + 2 ] );
							break;

						}

						case 1:
						{

							// one vertex lies outside of the plane, perform clipping
							if ( v1Out ) {

								nV1 = inVertices[ i + 1 ];
								nV2 = inVertices[ i + 2 ];
								nV3 = clip( inVertices[ i ], nV1, plane, s );
								nV4 = clip( inVertices[ i ], nV2, plane, s );

							}

							if ( v2Out ) {

								nV1 = inVertices[ i ];
								nV2 = inVertices[ i + 2 ];
								nV3 = clip( inVertices[ i + 1 ], nV1, plane, s );
								nV4 = clip( inVertices[ i + 1 ], nV2, plane, s );
								outVertices.push( nV3 );
								outVertices.push( nV2.clone() );
								outVertices.push( nV1.clone() );
								outVertices.push( nV2.clone() );
								outVertices.push( nV3.clone() );
								outVertices.push( nV4 );
								break;

							}

							if ( v3Out ) {

								nV1 = inVertices[ i ];
								nV2 = inVertices[ i + 1 ];
								nV3 = clip( inVertices[ i + 2 ], nV1, plane, s );
								nV4 = clip( inVertices[ i + 2 ], nV2, plane, s );

							}

							outVertices.push( nV1.clone() );
							outVertices.push( nV2.clone() );
							outVertices.push( nV3 );
							outVertices.push( nV4 );
							outVertices.push( nV3.clone() );
							outVertices.push( nV2.clone() );
							break;

						}

						case 2:
						{

							// two vertices lies outside of the plane, perform clipping
							if ( ! v1Out ) {

								nV1 = inVertices[ i ].clone();
								nV2 = clip( nV1, inVertices[ i + 1 ], plane, s );
								nV3 = clip( nV1, inVertices[ i + 2 ], plane, s );
								outVertices.push( nV1 );
								outVertices.push( nV2 );
								outVertices.push( nV3 );

							}

							if ( ! v2Out ) {

								nV1 = inVertices[ i + 1 ].clone();
								nV2 = clip( nV1, inVertices[ i + 2 ], plane, s );
								nV3 = clip( nV1, inVertices[ i ], plane, s );
								outVertices.push( nV1 );
								outVertices.push( nV2 );
								outVertices.push( nV3 );

							}

							if ( ! v3Out ) {

								nV1 = inVertices[ i + 2 ].clone();
								nV2 = clip( nV1, inVertices[ i ], plane, s );
								nV3 = clip( nV1, inVertices[ i + 1 ], plane, s );
								outVertices.push( nV1 );
								outVertices.push( nV2 );
								outVertices.push( nV3 );

							}

							break;

						}

						case 3:
						{

							// the entire face lies outside of the plane, so let's discard the corresponding vertices
							break;

						}

					}

				}

				return outVertices;

			}

			function clip( v0, v1, p, s ) {

				const d0 = v0.position.dot( p ) - s;
				const d1 = v1.position.dot( p ) - s;
				const s0 = d0 / ( d0 - d1 );
				const v = new DecalVertex( new THREE.Vector3( v0.position.x + s0 * ( v1.position.x - v0.position.x ), v0.position.y + s0 * ( v1.position.y - v0.position.y ), v0.position.z + s0 * ( v1.position.z - v0.position.z ) ), new THREE.Vector3( v0.normal.x + s0 * ( v1.normal.x - v0.normal.x ), v0.normal.y + s0 * ( v1.normal.y - v0.normal.y ), v0.normal.z + s0 * ( v1.normal.z - v0.normal.z ) ) ); // need to clip more values (texture coordinates)? do it this way:
				// intersectpoint.value = a.value + s * ( b.value - a.value );

				return v;

			}

		}

	} // helper


	class DecalVertex {

		constructor( position, normal ) {

			this.position = position;
			this.normal = normal;

		}

		clone() {

			return new this.constructor( this.position.clone(), this.normal.clone() );

		}

	}

	THREE.DecalGeometry = DecalGeometry;
	THREE.DecalVertex = DecalVertex;

} )();
}

// ---------------------------------------------------------------------------
// What the blood looks like in the viewport, drawn the way the game draws it (blood_canvas.gd, blood.gdshaderinc,
// blood.gd's drop shader and decals, body_blood.gdshaderinc). Units of the simulation: metres; the scene: pixels.
//  - The level: blood is painted into three world maps (render targets that are never cleared): the floor (seen from
//    above), wall_x (faces turned to +-X) and wall_z (faces turned to +-Z). A texel holds film thickness, the depth of
//    the face it landed on, the time it was wetted and coverage. Every surface of the model reads the maps in its own
//    lit material (blood_apply): dark wet blood with a sharp sheen, clots, a raised rim, drying to matt brown.
//  - Moving things and faces the maps cannot hold (slanted): decals projected onto the object, with a normal map,
//    wet and glossy, drying darker and matt. They go where the object goes.
//  - Drops: flat lit beads turned to the eye about their line of flight and stretched along it.
//  - The splash at a hit: an 8-frame sprite. The mist: a puff of fine spray.
//  - On the person: his blood volume (body_blood.gd) stains his clothes and skin and lies on them, lit.
// ---------------------------------------------------------------------------

const BV_AREA = 36.0, BV_RES = 2048, BV_PPM = BV_RES / BV_AREA;
const BV_WALL_RES = 640, BV_WALL_H = BV_WALL_RES / BV_PPM;
const BV_TIME_SPAN = 16384.0;
const BV_DEPTH_MIN = -40.0, BV_DEPTH_RANGE = 80.0;
const BV_DRY_COLOR = [0.42, 0.3, 0.27];
const BV_MAX_DECALS = 800;
const BV_FLOOR = 0, BV_WALL_X = 1, BV_WALL_Z = 2, BV_CEIL = 3;

// which world map a surface with normal n goes to, or -1 (slanted / overhanging: a decal)
function bloodMapFor(n) {
	if (n.y > 0.55) return BV_FLOOR;
	if (n.y < -0.55) return BV_CEIL;   // (the game puts blood on a ceiling as decals; here it is a map of its own, read like the floor)
	const ax = Math.abs(n.x), az = Math.abs(n.z);
	if (ax > az && ax > 0.6) return BV_WALL_X;
	if (az > 0.6) return BV_WALL_Z;
	return -1;
}

const BV_COMMON = `
float bh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float bnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(bh(i), bh(i + vec2(1.0, 0.0)), f.x), mix(bh(i + vec2(0.0, 1.0)), bh(i + vec2(1.0, 1.0)), f.x), f.y); }
`;

// blood.gdshaderinc: blood_sample + blood_apply, for a surface at wpos (metres) with world normal wnrm.
// In: the view-space position and geometric normal. Out: coverage, albedo, roughness, the view-space normal.
const BV_SURFACE = `
uniform sampler2D bv_floor; uniform sampler2D bv_wall_x; uniform sampler2D bv_wall_z; uniform sampler2D bv_ceil;
uniform vec2 bv_min; uniform float bv_size; uniform vec2 bv_wall; uniform float bv_time;
uniform float bv_gamma;
${BV_COMMON}
// Blockbench draws in display space (no sRGB output): the game's linear colours are put into it
vec3 bv_col(vec3 c) { return bv_gamma > 0.5 ? pow(max(c, vec3(0.0)), vec3(0.4545)) : c; }
vec3 blood_sample(vec3 p, vec3 n) {
	vec2 uv; float depth; float tol; vec4 s; vec3 an = abs(n);
	if (n.y > 0.55) { uv = (p.xz - bv_min) / bv_size; s = texture2D(bv_floor, uv); depth = p.y; tol = 0.08; }
	else if (n.y < -0.55) { uv = (p.xz - bv_min) / bv_size; s = texture2D(bv_ceil, uv); depth = p.y; tol = 0.08; }
	else if (an.x > an.z && an.x > 0.6) { uv = vec2((p.z - bv_min.y) / bv_size, (p.y - bv_wall.x) / bv_wall.y); s = texture2D(bv_wall_x, uv); depth = p.x; tol = 0.06; }
	else if (an.z > 0.6) { uv = vec2((p.x - bv_min.x) / bv_size, (p.y - bv_wall.x) / bv_wall.y); s = texture2D(bv_wall_z, uv); depth = p.z; tol = 0.06; }
	else return vec3(0.0);
	if (s.a < 0.04 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
	vec3 v = clamp(s.rgb / s.a, vec3(0.0), vec3(1.0));
	float d = v.g * ${BV_DEPTH_RANGE.toFixed(1)} + ${BV_DEPTH_MIN.toFixed(1)};
	if (abs(d - depth) > tol) return vec3(0.0);
	float age = mod(bv_time - v.b * ${BV_TIME_SPAN.toFixed(1)} + ${BV_TIME_SPAN.toFixed(1)}, ${BV_TIME_SPAN.toFixed(1)});
	return vec3(s.a, v.r, clamp(age / 150.0, 0.0, 1.0));
}
float blood_apply(vec3 wpos, vec3 wnrm, vec3 vertex, vec3 geom_view_n, inout vec3 albedo, inout float roughness, inout vec3 n_view) {
	vec3 b = blood_sample(wpos, wnrm);
	vec3 t1 = abs(wnrm.y) > 0.55 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
	vec3 t2 = normalize(cross(wnrm, t1));
	t1 = cross(t2, wnrm);
	float o = 0.011;
	float c4 = blood_sample(wpos + (t1 + t2) * o, wnrm).x + blood_sample(wpos + (t1 - t2) * o, wnrm).x
		+ blood_sample(wpos - (t1 + t2) * o, wnrm).x + blood_sample(wpos - (t1 - t2) * o, wnrm).x;
	b.x = b.x * 0.4 + c4 * 0.15;
	float n_ok = 0.0; vec2 yz = vec2(0.0);
	for (int k = 0; k < 4; k++) {
		vec2 sg = vec2(k < 2 ? 1.0 : -1.0, (k == 0 || k == 2) ? 1.0 : -1.0);
		vec3 q = blood_sample(wpos + (t1 * sg.x + t2 * sg.y) * o * 1.6, wnrm);
		if (q.x > 0.0) { yz += q.yz; n_ok += 1.0; }
	}
	if (b.x <= 0.0) return 0.0;
	if (n_ok > 0.0) b.yz = b.y > 0.0 ? (b.yz + yz) / (1.0 + n_ok) : yz / n_ok;
	vec2 ep = wnrm.y > 0.55 ? wpos.xz : (abs(wnrm.x) > abs(wnrm.z) ? wpos.zy : wpos.xy);
	float detail = bnoise(ep * 300.0);
	float thick = clamp(b.y, 0.0, 1.0);
	float film = smoothstep(0.03, 0.09, thick);
	float ragged = bnoise(ep * 70.0) * 0.6 + bnoise(ep * 190.0) * 0.4;
	float crisp = smoothstep(0.4, 0.5, b.x + (ragged - 0.5) * 0.34 + (detail - 0.5) * 0.08);
	float soft = smoothstep(0.08, 0.8, b.x + (detail - 0.5) * 0.3) * (0.3 + 0.35 * detail);
	float cov = mix(soft, crisp, film);
	if (cov <= 0.0) return 0.0;
	float deep = smoothstep(0.08, 0.45, thick);
	float clot = bnoise(ep * 9.0) * 0.6 + bnoise(ep * 31.0) * 0.4;
	float grain = bnoise(ep * 140.0);
	float edge = 1.0 - smoothstep(0.25, 0.85, thick);
	float dry = pow(clamp(b.z * (0.75 + 0.5 * clot) + edge * b.z * 0.8, 0.0, 1.0), 0.7);
	vec3 wet_col = mix(vec3(0.075, 0.004, 0.003), vec3(0.02, 0.0009, 0.0007), deep);
	wet_col *= mix(1.0, 0.5 + 1.0 * clot, deep);
	vec3 dry_col = mix(vec3(0.055, 0.017, 0.012), vec3(0.026, 0.009, 0.007), deep);
	dry_col *= 0.8 + 0.45 * clot;
	float crust = smoothstep(0.1, 0.5, b.z) * edge * smoothstep(0.02, 0.2, thick);
	dry_col = mix(dry_col, vec3(0.018, 0.006, 0.005), crust * 0.7);
	albedo = bv_col(mix(wet_col, dry_col, dry));
	float gloss = film * smoothstep(0.35, 0.8, cov);
	float sheen = smoothstep(0.35, 0.75, bnoise(ep * 5.0 + 3.1) * 0.7 + clot * 0.3);
	roughness = mix(mix(0.5, mix(0.05, 0.12, sheen), gloss), 0.88, smoothstep(0.35, 0.55, dry));
	// a liquid lies flat; its rim is raised (a bump from the film height, kept tame)
	vec3 nv = geom_view_n;
	float h = crisp * film * (0.0022 + deep * dry * ((clot - 0.5) * 0.0012 + (grain - 0.5) * 0.0006));
	vec3 dpdx = dFdx(vertex), dpdy = dFdy(vertex);
	vec3 r1 = cross(dpdy, nv), r2 = cross(nv, dpdx);
	float det = dot(dpdx, r1);
	vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
	vec3 bumped = abs(det) * nv - grad;
	float bl = length(bumped);
	if (abs(det) > 1e-12 && bl > 1e-12) { bumped /= bl; n_view = normalize(mix(nv, bumped, dot(bumped, nv) > 0.9 ? 1.0 : 0.35)); }
	else n_view = nv;
	return cov;
}
`;

class BloodView {
	constructor(sim, rt) {
		this.sim = sim;
		this.rt = rt;
		this.group = new THREE.Group();   // things placed in metres
		this.group.name = 'ragdoll_blood';
		this.group.scale.setScalar(SCALE);
		this.surface_group = new THREE.Group();   // things placed in the scene's pixels (on the model's own surfaces)
		this.surface_group.name = 'ragdoll_blood_surfaces';
		// not in the Render view's helper passes (reflections, materials, depth): only in the picture itself
		this.group.userData.render_no_fx = true;
		this.surface_group.userData.render_no_fx = true;
		this.root = typeof scene != 'undefined' ? scene : null;
		if (this.root) { this.root.add(this.group); this.root.add(this.surface_group); }
		this.textures = {};
		this.decals = [];
		this.decal_next = 0;
		this.pool_decals = new Map();
		this.splashes = [];
		this.mists = [];
		this.overlays = [];
		this.surfaces = new Map();   // element mesh -> its blood overlay
		this.surface_check = 0;
		this.time = 0;
		// the world maps round the people
		const people = sim.people;
		const c = people.length ? people[0].pos(people[0].pelvis) : gv();
		this.area_min = gv(c.x - BV_AREA / 2, 0, c.z - BV_AREA / 2);
		this.ground = sim.ground;
		this.wall_y0 = (this.ground || 0) - 0.5;
		this.renderer = this.findRenderer();
		this.makeLook();
		this.makeMaps();
		this.makeDrops();
		this.makeSplash();
		this.makeMist();
		this.makeBodies();
	}

	// does the picture come out without sRGB conversion (Blockbench, the Render view)? then colours go in display space
	// (the Render view works in linear light and makes the picture itself at the end: no conversion then)
	gamma() {
		if (globalThis.RenderView && globalThis.RenderView.rig) return false;
		return !(this.renderer && THREE.sRGBEncoding && this.renderer.outputEncoding === THREE.sRGBEncoding);
	}

	findRenderer() {
		try { if (typeof Preview != 'undefined') { const p = Preview.selected || (Preview.all || []).find(x => x.renderer); if (p && p.renderer) return p.renderer; } } catch (err) { /* none */ }
		return null;
	}

	tex(kind, variant, which) {
		const key = kind + variant + which;
		if (this.textures[key]) return this.textures[key];
		const sh = bloodShape(kind, variant);
		const t = new THREE.DataTexture(sh[which], sh.size, sh.size, THREE.RGBAFormat);
		t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
		t.needsUpdate = true;
		return (this.textures[key] = t);
	}

	// ---- light: Blockbench's own lights; reflections from the Render view's sky, or a soft sky of our own ----
	makeLook() {
		this.env = null;
		if (!this.renderer || !THREE.PMREMGenerator || typeof document == 'undefined') return;
		try {
			const canvas = document.createElement('canvas');
			canvas.width = 256; canvas.height = 128;
			const ctx = canvas.getContext('2d');
			const g = ctx.createLinearGradient(0, 0, 0, 128);
			g.addColorStop(0, '#9fb4d0'); g.addColorStop(0.48, '#e8ecf0'); g.addColorStop(0.52, '#7a746e'); g.addColorStop(1, '#3a3632');
			ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
			ctx.fillStyle = 'rgba(255,255,250,0.9)'; ctx.beginPath(); ctx.arc(80, 30, 9, 0, Math.PI * 2); ctx.fill();
			const t = new THREE.CanvasTexture(canvas);
			t.mapping = THREE.EquirectangularReflectionMapping;
			const pm = new THREE.PMREMGenerator(this.renderer);
			this.env = pm.fromEquirectangular(t).texture;
			pm.dispose(); t.dispose();
		} catch (err) { this.env = null; }
	}
	// the materials take the Render view's sky when there is one, ours otherwise
	litMaterials() { return [this.surface_mat, this.drops && this.drops.material, ...this.decals.map(d => d.mesh.material), ...this.bodyLit()].filter(Boolean); }
	bodyLit() { const out = []; for (const o of this.overlays) for (const ov of o.overlays) if (ov.meshes) out.push(ov.meshes[1].material); return out; }
	updateLook() {
		this.u.bv_gamma.value = this.gamma() ? 1 : 0;
		const want = this.root && this.root.environment ? null : this.env;
		for (const m of this.litMaterials()) if (m.envMap !== want) { m.envMap = want; m.needsUpdate = true; }
	}

	// ---- the world maps (blood_canvas.gd) and the surfaces that read them ----
	makeMaps() {
		this.maps = [];
		const type = THREE.HalfFloatType || THREE.FloatType;
		const sizes = [[BV_RES, BV_RES], [BV_RES, BV_WALL_RES], [BV_RES, BV_WALL_RES], [BV_RES, BV_RES]];
		if (this.renderer && THREE.WebGLRenderTarget) {
			this.dab_geo = new THREE.PlaneGeometry(1, 1);
			for (const [w, h] of sizes) {
				const target = new THREE.WebGLRenderTarget(w, h, {type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter});
				this.maps.push({target, w, h, scene: new THREE.Scene(), cam: new THREE.OrthographicCamera(0, w, h, 0, -10, 10), queue: [], meshes: [], cleared: false});
			}
		}
		const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
		blank.needsUpdate = true;
		this.blank = blank;
		this.u = {
			bv_floor: {value: this.maps[0] ? this.maps[0].target.texture : blank}, bv_wall_x: {value: this.maps[1] ? this.maps[1].target.texture : blank}, bv_wall_z: {value: this.maps[2] ? this.maps[2].target.texture : blank}, bv_ceil: {value: this.maps[3] ? this.maps[3].target.texture : blank},
			bv_min: {value: new THREE.Vector2(this.area_min.x, this.area_min.z)}, bv_size: {value: BV_AREA}, bv_wall: {value: new THREE.Vector2(this.wall_y0, BV_WALL_H)}, bv_time: {value: 0},
			bv_gamma: {value: this.gamma() ? 1 : 0},
		};
		this.surface_mat = this.surfaceMaterial();
		// the ground of the Physics tab (it may have no element of its own): a sheet that reads the floor map
		const geo = new THREE.PlaneGeometry(BV_AREA * SCALE, BV_AREA * SCALE);
		geo.rotateX(-Math.PI / 2);
		this.floor = new THREE.Mesh(geo, this.surface_mat);
		this.floor.position.set((this.area_min.x + BV_AREA / 2) * SCALE, (this.ground || 0) * SCALE + 0.01, (this.area_min.z + BV_AREA / 2) * SCALE);
		this.floor.renderOrder = 2;
		this.floor.frustumCulled = false;
		this.floor.receiveShadow = true;
		this.surface_group.add(this.floor);
	}

	// a lit material that is only the blood lying on a surface (blood_apply), laid over the surface itself
	surfaceMaterial() {
		const m = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.5, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: 0.35});
		m.extensions = {derivatives: true};
		const u = this.u;
		m.onBeforeCompile = shader => {
			Object.assign(shader.uniforms, u);
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nvarying vec3 vBW; varying vec3 vBN;')
				.replace('#include <project_vertex>', `#include <project_vertex>
					vec4 bv_w = modelMatrix * vec4(transformed, 1.0);
					vBW = bv_w.xyz / ${SCALE.toFixed(1)};
					vBN = normalize(mat3(modelMatrix) * objectNormal);`);
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nvarying vec3 vBW; varying vec3 vBN;\n' + BV_SURFACE)
				.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
					{
						vec3 b_albedo = vec3(0.0); float b_rough = 0.5; vec3 b_n = normal;
						float b_cov = blood_apply(vBW, normalize(vBN), -vViewPosition, normal, b_albedo, b_rough, b_n);
						if (b_cov <= 0.002) discard;
						diffuseColor = vec4(b_albedo, b_cov);
						roughnessFactor = b_rough;
						normal = b_n;
					}`);
		};
		m.customProgramCacheKey = () => 'ragdoll_blood_surface';
		return m;
	}

	// the elements of the model that do not move: they get the blood of the maps on their faces
	worldMeshes() {
		const out = [];
		if (typeof Cube == 'undefined') return out;
		const people = new Set();
		for (const bot of this.sim.people || []) for (const part of bot.parts || []) if (part.group) people.add(part.group);
		const moving = node => { for (let n = node; n && n !== 'root'; n = n.parent) { if (people.has(n)) return true; if (n.physics && n.physics.type == 'dynamic') return true; } return false; };
		for (const el of [...(Cube.all || []), ...((typeof Mesh != 'undefined' && Mesh.all) || [])]) {
			if (!el.mesh || !el.mesh.geometry || el.visibility === false || moving(el)) continue;
			out.push(el.mesh);
		}
		return out;
	}

	syncSurfaces(dt) {
		this.surface_check -= dt;
		if (this.surface_check <= 0) {
			this.surface_check = 0.5;
			const now = new Set(this.worldMeshes());
			for (const [mesh, ov] of this.surfaces) if (!now.has(mesh)) { this.surface_group.remove(ov); this.surfaces.delete(mesh); }
			for (const mesh of now) {
				if (this.surfaces.has(mesh)) continue;
				const ov = new THREE.Mesh(mesh.geometry, this.surface_mat);
				ov.matrixAutoUpdate = false;
				ov.renderOrder = 2;
				ov.receiveShadow = true;
				ov.frustumCulled = false;
				this.surface_group.add(ov);
				this.surfaces.set(mesh, ov);
			}
		}
		for (const [mesh, ov] of this.surfaces) {
			if (ov.geometry !== mesh.geometry) ov.geometry = mesh.geometry;   // Blockbench rebuilt it
			ov.matrix.copy(mesh.matrixWorld);
			ov.matrixWorldNeedsUpdate = true;
			ov.visible = mesh.visible !== false;
		}
	}

	covers(p) { return p.x > this.area_min.x && p.z > this.area_min.z && p.x < this.area_min.x + BV_AREA && p.z < this.area_min.z + BV_AREA; }

	// a dab of blood on the level (blood_canvas.gd dab). What the maps cannot hold becomes a decal. Returns true when painted.
	dab(p, n, along, w, l, kind, variant, thick, alpha, pool) {
		const m = bloodMapFor(n);
		let uv, dir, depth, v0;
		// (grad: how the depth of the surface changes across the map, metres per metre - a dab on a slope keeps to the slope)
		let grad = [0, 0];
		if (m == BV_FLOOR || m == BV_CEIL) { uv = [p.x - this.area_min.x, p.z - this.area_min.z]; dir = [along.x, along.z]; depth = p.y; grad = [-n.x / n.y, -n.z / n.y]; }
		else if (m == BV_WALL_X) { uv = [p.z - this.area_min.z, p.y - this.wall_y0]; dir = [along.z, along.y]; depth = p.x; grad = [-n.z / n.x, -n.y / n.x]; }
		else if (m == BV_WALL_Z) { uv = [p.x - this.area_min.x, p.y - this.wall_y0]; dir = [along.x, along.y]; depth = p.z; grad = [-n.x / n.z, -n.y / n.z]; }
		const map = m >= 0 ? this.maps[m] : null;
		const on_map = map && this.covers(p) && uv[1] >= 0 && uv[1] * BV_PPM <= map.h;
		if (!on_map) {
			if (pool) this.poolDecal(pool, p, n, along, w, l, kind, variant);
			else this.decal(null, p, n, along, w, l, kind, variant, alpha, this.sim._time);
			return false;
		}
		const angle = Math.hypot(dir[0], dir[1]) > 1e-4 ? Math.atan2(-dir[0], dir[1]) : brand() * Math.PI * 2;
		map.queue.push({u: uv[0] * BV_PPM, v: uv[1] * BV_PPM, w: w * BV_PPM, l: l * BV_PPM, angle, tex: this.tex(kind, variant, 'mask'),
			data: [clamp(thick, 0, 1), clamp((depth - BV_DEPTH_MIN) / BV_DEPTH_RANGE, 0, 1), (this.sim._time % BV_TIME_SPAN) / BV_TIME_SPAN, alpha], grad});
		return true;
	}

	flushDabs() {
		if (!this.renderer) return;
		const r = this.renderer;
		for (const map of this.maps) {
			if (!map.queue.length && map.cleared) continue;
			const prev = r.getRenderTarget(), auto = r.autoClear;
			try {
				if (!map.cleared) { r.setRenderTarget(map.target); r.setClearColor(0x000000, 0); r.clear(true, false, false); map.cleared = true; }
				while (map.queue.length) {
					const batch = map.queue.splice(0, 256);
					while (map.meshes.length < batch.length) {
						const mesh = new THREE.Mesh(this.dab_geo, new THREE.ShaderMaterial({
							uniforms: {map: {value: null}, data: {value: new THREE.Vector4()}, grad: {value: new THREE.Vector2()}, centre: {value: new THREE.Vector2()}},
							vertexShader: 'varying vec2 vUv; varying vec2 vMap; void main() { vUv = uv; vMap = (modelMatrix * vec4(position, 1.0)).xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
							// (the depth written follows the plane of the surface across the dab, not the depth of its middle)
							fragmentShader: `uniform sampler2D map; uniform vec4 data; uniform vec2 grad; uniform vec2 centre; varying vec2 vUv; varying vec2 vMap;
								void main() { vec4 m = texture2D(map, vUv); float g = data.g + dot(grad, (vMap - centre) / ${BV_PPM.toFixed(4)}) / ${BV_DEPTH_RANGE.toFixed(1)};
									gl_FragColor = vec4(data.r * m.r, clamp(g, 0.0, 1.0), data.b, m.a * data.a); }`,
							transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
							blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
						}));
						mesh.frustumCulled = false;
						map.meshes.push(mesh);
						map.scene.add(mesh);
					}
					map.meshes.forEach((mesh, i) => {
						const d = batch[i];
						mesh.visible = !!d;
						if (!d) return;
						mesh.position.set(d.u, d.v, 0);
						mesh.rotation.set(0, 0, d.angle);
						mesh.scale.set(d.w, d.l, 1);
						mesh.renderOrder = i;
						mesh.material.uniforms.map.value = d.tex;
						mesh.material.uniforms.data.value.set(...d.data);
						mesh.material.uniforms.grad.value.set(clamp(d.grad[0], -4, 4), clamp(d.grad[1], -4, 4));
						mesh.material.uniforms.centre.value.set(d.u, d.v);
					});
					r.setRenderTarget(map.target);
					r.autoClear = false;
					r.render(map.scene, map.cam);
				}
			} finally {
				r.autoClear = auto;
				r.setRenderTarget(prev);
			}
		}
	}

	// ---- decals: projected onto what they landed on (a moving thing carries them), lit, with a normal map ----
	// the element mesh under p (metres) along -n, or null
	surfaceAt(p, n) {
		if (typeof Cube == 'undefined' || !THREE.Raycaster) return null;
		if (!this.ray_list || this.ray_age-- <= 0) {
			const people = new Set();
			for (const bot of this.sim.people || []) for (const part of bot.parts || []) if (part.group) people.add(part.group);
			const ofPerson = node => { for (let x = node; x && x !== 'root'; x = x.parent) if (people.has(x)) return true; return false; };
			this.ray_list = [...(Cube.all || []), ...((typeof Mesh != 'undefined' && Mesh.all) || [])].filter(el => el.mesh && el.mesh.geometry && !ofPerson(el)).map(el => el.mesh);
			this.ray_age = 30;
		}
		const ray = this.raycaster || (this.raycaster = new THREE.Raycaster());
		const o = p.clone().addScaledVector(n, 0.12).multiplyScalar(SCALE);
		ray.set(o, n.clone().negate().normalize());
		ray.far = 0.3 * SCALE;
		const hits = ray.intersectObjects(this.ray_list, false);
		return hits.length ? hits[0] : null;
	}

	decalMaterial() {
		const m = new THREE.MeshStandardMaterial({transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.07, metalness: 0, envMapIntensity: 0.4});
		m.envMap = this.root && this.root.environment ? null : this.env;
		// the textures and the drying colour are display colours (Godot's sRGB albedo): into linear light for the Render view
		const gamma = this.u.bv_gamma;
		m.onBeforeCompile = shader => {
			shader.uniforms.bv_gamma = gamma;
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nuniform float bv_gamma;')
				.replace('#include <map_fragment>', '#include <map_fragment>\nif (bv_gamma < 0.5) diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(2.2));');
		};
		m.customProgramCacheKey = () => 'ragdoll_blood_decal';
		return m;
	}

	decal(entry, p, n, along, w, l, kind, variant, alpha, birth) {
		let d;
		if (this.decals.length < BV_MAX_DECALS) {
			d = {mesh: new THREE.Mesh(this.decalGeo(), this.decalMaterial())};
			d.mesh.renderOrder = 3;
			d.mesh.matrixAutoUpdate = false;
			this.surface_group.add(d.mesh);
			this.decals.push(d);
		} else {
			// the least important of the next few: small and old goes first
			let best = Infinity, pick = this.decal_next;
			for (let t = 0; t < 24; t++) {
				const k = (this.decal_next + t) % BV_MAX_DECALS, c = this.decals[k];
				const score = c.prio / (1 + (this.sim._time - c.birth) / 60);
				if (score < best) { best = score; pick = k; }
			}
			this.decal_next = (this.decal_next + 24) % BV_MAX_DECALS;
			d = this.decals[pick];
		}
		const mat = d.mesh.material;
		mat.map = this.tex(kind, variant, 'albedo');
		mat.normalMap = this.tex(kind, variant, 'normal');
		mat.roughness = 0.07;
		mat.opacity = alpha;
		mat.color.set(0xffffff);
		mat.needsUpdate = true;
		d.birth = birth; d.prio = w * l; d.dry = false;
		if (d.mesh.geometry !== this.decal_geo) d.mesh.geometry.dispose();
		const hit = this.surfaceAt(p, n);
		if (hit && THREE.DecalGeometry) {
			// projected onto the object it landed on (Godot's Decal): x across, y along, z out of the surface
			const nn = n.clone().normalize();
			let y = along.clone().addScaledVector(nn, -nn.dot(along));
			if (y.length() < 1e-4) y = anyTangent(nn);
			y.normalize();
			const x = y.clone().cross(nn);
			const rot = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, nn));
			const depth = clamp(Math.max(w, l) * 0.6, 0.05, 0.2);
			const target = hit.object;
			target.updateMatrixWorld(true);
			const geo = facingOnly(new THREE.DecalGeometry(target, hit.point, rot, gv(w * SCALE, l * SCALE, depth * SCALE)), nn, 0.35);
			geo.applyMatrix4(target.matrixWorld.clone().invert());   // kept in the object's own space: it goes where the object goes
			d.mesh.geometry = geo;
			d.target = target;
			d.flat = null;
		} else {
			// nothing of the model there (the ground of the Physics tab off the maps, a body without elements): a flat stain
			d.mesh.geometry = this.decalGeo();
			d.target = null;
			const q = decalBasis(n, along);
			d.flat = new THREE.Matrix4().compose(p.clone().addScaledVector(n, 0.002).multiplyScalar(SCALE), q, gv(w * SCALE, 1, l * SCALE));
			if (entry) {
				// kept in the moving thing's own frame
				const bp = entry.body.GetPosition(), br = entry.body.GetRotation();
				const bm = new THREE.Matrix4().compose(gv(bp.GetX(), bp.GetY(), bp.GetZ()).multiplyScalar(SCALE), new THREE.Quaternion(br.GetX(), br.GetY(), br.GetZ(), br.GetW()), gv(1, 1, 1));
				d.local = bm.invert().multiply(d.flat);
			} else d.local = null;
		}
		d.entry = entry || null;
		this.placeDecal(d);
		return d;
	}

	placeDecal(d) {
		const M = d.mesh.matrix;
		if (d.target) M.copy(d.target.matrixWorld);
		else if (d.entry && d.local) {
			const bp = d.entry.body.GetPosition(), br = d.entry.body.GetRotation();
			M.compose(gv(bp.GetX(), bp.GetY(), bp.GetZ()).multiplyScalar(SCALE), new THREE.Quaternion(br.GetX(), br.GetY(), br.GetZ(), br.GetW()), gv(1, 1, 1)).multiply(d.local);
		} else if (d.flat) M.copy(d.flat);
		d.mesh.matrixWorldNeedsUpdate = true;
	}

	decalGeo() {
		if (!this.decal_geo) { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); this.decal_geo = g; }
		return this.decal_geo;
	}

	poolStarted(pool) { this.pool_decals.delete(pool); }

	poolDecal(pool, p, n, along, w, l, kind, variant) {
		// a pool the maps cannot hold: its one decal, made again bigger as it spreads
		let d = this.pool_decals.get(pool);
		const grown = p.distanceTo(pool.pos) < 1e-6;
		if (!d || this.decals.indexOf(d) < 0 || d.pool !== pool || (grown && (w > d.w * 1.15 || l > d.l * 1.15))) {
			d = this.decal(null, pool.pos, n, along, w, l, kind, variant, 1, this.sim._time);
			d.pool = pool; d.w = w; d.l = l;
			this.pool_decals.set(pool, d);
		}
		if (grown) { d.birth = this.sim._time; d.prio = w * l * 10; }
	}

	// ---- drops: flat beads turned to the eye about their line of flight, stretched along it (blood.gd DROP_SHADER) ----
	makeDrops() {
		const geo = new THREE.PlaneGeometry(1, 1);
		const mat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.12, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 1});
		const gamma = this.u.bv_gamma;
		mat.onBeforeCompile = shader => {
			shader.uniforms.bv_gamma = gamma;
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nvarying vec2 vBUv;')
				.replace('#include <project_vertex>', `
					mat4 M = modelMatrix * instanceMatrix;
					vec3 centre = M[3].xyz; vec3 axis_v = M[1].xyz; float len = length(axis_v); float r = length(M[0].xyz);
					vec3 axis = axis_v / max(len, 1e-5);
					vec3 to_eye = normalize(cameraPosition - centre);
					vec3 side = cross(axis, to_eye);
					side = length(side) > 1e-3 ? normalize(side) : normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
					vec3 w = centre + side * position.x * 2.0 * r + axis * position.y * 2.0 * max(len, r);
					vBUv = uv;
					vec4 mvPosition = viewMatrix * vec4(w, 1.0);
					gl_Position = projectionMatrix * mvPosition;`);
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\nvarying vec2 vBUv; uniform float bv_gamma;')
				.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
					{
						vec2 d = vBUv * 2.0 - 1.0; float q = dot(d, d);
						if (q > 1.0) discard;
						// lit like anything else: a round wet bead, the normal bulging towards the eye, glossy
						diffuseColor.rgb = vec3(0.14, 0.006, 0.005) * (1.0 - 0.4 * q);
						if (bv_gamma > 0.5) diffuseColor.rgb = pow(diffuseColor.rgb, vec3(0.4545));
						normal = normalize(vec3(d.x, -d.y, sqrt(max(1.0 - q, 0.0)) + 0.3));
					}`);
		};
		mat.customProgramCacheKey = () => 'ragdoll_blood_drop';
		mat.envMap = this.env;
		this.drop_cap = this.sim.max_drops || B_MAX_DROPS;
		this.drops = new THREE.InstancedMesh(geo, mat, this.drop_cap);
		this.drops.count = 0;
		this.drops.frustumCulled = false;
		this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.group.add(this.drops);
	}

	drawDrops(extra) {
		const list = this.sim._drops, n = Math.min(list.length, this.drop_cap), m = new THREE.Matrix4();
		for (let i = 0; i < n; i++) {
			const d = list[i];
			const p = d.pos.clone().addScaledVector(d.vel, extra);
			const r = 0.0062 * Math.cbrt(d.vol), sp = d.vel.length();
			const y = sp > 0.01 ? d.vel.clone().divideScalar(sp) : gv(0, 1, 0);
			const x = y.clone().cross(Math.abs(y.y) < 0.95 ? gv(0, 1, 0) : gv(1, 0, 0)).normalize();
			const z = x.clone().cross(y);
			const stretch = r + sp * d.streak;
			m.makeBasis(x.multiplyScalar(r), y.multiplyScalar(stretch), z.multiplyScalar(r)).setPosition(p);
			this.drops.setMatrixAt(i, m);
		}
		this.drops.count = n;
		this.drops.instanceMatrix.needsUpdate = true;
	}

	// ---- the splash at a hit: an animated sprite (eight frames drawn once), turned to the camera ----
	makeSplash() {
		const a = splashAtlas();
		const tex = new THREE.DataTexture(a.data, a.width, a.height, THREE.RGBAFormat);
		tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
		this.splash_tex = tex;
		this.splash_geo = new THREE.PlaneGeometry(1, 1);
		for (let i = 0; i < 24; i++) {
			const mat = new THREE.ShaderMaterial({
				uniforms: {atlas: {value: tex}, k: {value: 0}, spin: {value: 0}, shade: {value: 1}, size: {value: 1}},
				vertexShader: `
					uniform float spin; uniform float size; varying vec2 vUv;
					void main() {
						vUv = uv;
						float c = cos(spin), s = sin(spin);
						vec2 v = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * size;
						vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
						mv.xy += v * ${SCALE.toFixed(1)};
						gl_Position = projectionMatrix * mv;
					}`,
				fragmentShader: `
					uniform sampler2D atlas; uniform float k; uniform float shade; varying vec2 vUv;
					void main() {
						float f = min(floor(k * 8.0), 7.0), fn = min(f + 1.0, 7.0), blend = fract(k * 8.0);
						vec2 cell = vec2(mod(f, 4.0), floor(f / 4.0)), cell2 = vec2(mod(fn, 4.0), floor(fn / 4.0));
						vec4 a = texture2D(atlas, (vUv + cell) / vec2(4.0, 2.0));
						vec4 b = texture2D(atlas, (vUv + cell2) / vec2(4.0, 2.0));
						vec4 t = mix(a, b, blend * 0.6);
						vec3 col = mix(vec3(0.16, 0.0, 0.005), vec3(0.45, 0.02, 0.015), t.r * 0.6) * shade;
						col += vec3(0.25, 0.08, 0.06) * t.g;
						if (t.a < 0.01) discard;
						gl_FragColor = linearToOutputTexel(vec4(col, t.a));
					}`,
				transparent: true, depthWrite: false, side: THREE.DoubleSide,
			});
			const mesh = new THREE.Mesh(this.splash_geo, mat);
			mesh.visible = false;
			mesh.frustumCulled = false;
			mesh.renderOrder = 6;
			this.group.add(mesh);
			this.splashes.push({mesh, age: 0, dur: 0});
		}
		this.splash_next = 0;
	}

	camera() { try { const p = typeof Preview != 'undefined' && Preview.selected; return p && p.camera; } catch (err) { return null; } }

	splash(at, dir, size, dur) {
		const s = this.splashes[this.splash_next];
		this.splash_next = (this.splash_next + 1) % this.splashes.length;
		const cam = this.camera();
		const p = at.clone();
		let spin = brand() * Math.PI * 2;
		if (cam) {
			const cp = cam.getWorldPosition(gv()).divideScalar(SCALE);
			p.addScaledVector(cp.clone().sub(at).normalize(), 0.06);   // (pushed a little toward the camera: not lost inside the body)
			const sd = dir.clone().applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()).invert());
			if (Math.hypot(sd.x, sd.y) > 0.2) spin = Math.atan2(sd.y, sd.x);
		}
		p.addScaledVector(dir.clone().normalize(), size * 0.18);
		s.mesh.position.copy(p);
		const u = s.mesh.material.uniforms;
		u.spin.value = spin; u.k.value = 0; u.shade.value = brange(0.8, 1.15); u.size.value = size;
		s.mesh.visible = true;
		s.age = 0; s.dur = dur;
	}

	// ---- mist: a puff of fine spray (GPUParticles3D in the game) ----
	makeMist() {
		const sp = smokePuff();
		const tex = new THREE.DataTexture(sp.data, sp.size, sp.size, THREE.RGBAFormat);
		tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
		this.mist_mat = new THREE.SpriteMaterial({map: tex, color: new THREE.Color(0.4, 0.02, 0.02), transparent: true, depthWrite: false});
		this.mist_parts = [];
	}

	mist(pos, dir, strength) {
		const d = dir.clone().normalize();
		const amount = Math.round(26 * clamp(strength, 0.1, 1));
		for (let i = 0; i < amount; i++) {
			const v = cone(d, deg(22)).multiplyScalar(brange(0.6, 4.5));
			const s = new THREE.Sprite(this.mist_mat.clone());
			s.material.rotation = brand() * Math.PI * 2;
			s.renderOrder = 5;
			this.group.add(s);
			this.mist_parts.push({s, p: pos.clone().add(jitter(0.03)), v, damp: brange(5, 9), scale: brange(0.5, 1.3), age: 0});
		}
	}

	updateMist(dt) {
		for (let i = 0; i < this.mist_parts.length;) {
			const m = this.mist_parts[i];
			m.age += dt;
			const k = m.age / 0.9;
			if (k >= 1) { this.group.remove(m.s); m.s.material.dispose(); this.mist_parts.splice(i, 1); continue; }
			const sp = m.v.length();
			if (sp > 0) m.v.multiplyScalar(Math.max(0, sp - m.damp * dt) / sp);
			m.v.y -= 1.2 * dt;
			m.p.addScaledVector(m.v, dt);
			m.s.position.copy(m.p);
			const size = 0.1 * m.scale * glerp(0.4, 2.6, k);
			m.s.scale.set(size, size, 1);
			m.s.material.opacity = glerp(0.55, 0, k);
			i++;
		}
	}

	// ---- on the people: their blood volume over their clothes and skin (body_blood.gdshaderinc) ----
	makeBodies() {
		if (!THREE.DataTexture3D) return;
		for (const bot of this.sim.people) {
			const overlays = [];
			for (const part of bot.parts) {
				for (const el of part.group.children || []) {
					if (!el.mesh || !el.mesh.geometry || !(el instanceof Mesh || el instanceof Cube)) continue;
					overlays.push({el});
				}
			}
			this.overlays.push({bot, overlays, tex: null, made: false, version: -1, flush: 0});
		}
	}

	// body_blood(): albedo = mix(albedo * stain, bc, a2) - drawn as two layers over what is there: the stain multiplied
	// into it (pass 0), then the blood itself, lit, on top (pass 1)
	bodyMaterial(bot, rest, pass) {
		const bb = bot.body_blood;
		const u = {vol: {value: null}, vol_min: {value: bb.box_min.clone()}, vol_size: {value: gv(bb.dims[0], bb.dims[1], bb.dims[2]).multiplyScalar(bb.cell)}, time: {value: 0}, rest: {value: rest}, bv_gamma: this.u.bv_gamma};
		const head = `
			precision highp sampler3D;
			uniform float bv_gamma;
			uniform sampler3D vol; uniform vec3 vol_min; uniform vec3 vol_size; uniform float time; varying vec3 rp;
			float h3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
			float n3(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
				return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
					mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
			// x: how much covers it (a2), yzw: the blood's colour; out: tint (the stain), rough
			vec4 body_blood(out vec3 tint, out float rough) {
				tint = vec3(1.0); rough = 0.9;
				vec3 uvw = (rp - vol_min) / vol_size;
				if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return vec4(0.0);
				vec2 s = texture(vol, uvw).rg;
				float nz = n3(rp * 60.0) * 0.6 + n3(rp * 170.0) * 0.4;
				float amt = s.r + (nz - 0.5) * 0.12 * (1.0 - s.r);
				if (amt < 0.03) return vec4(0.0);
				float age = mod(time - s.g * 255.0, 256.0);
				float dry = clamp(age / 140.0, 0.0, 1.0);
				float film = smoothstep(0.03, 0.3, amt);
				float solid = smoothstep(0.3, 0.7, amt);
				vec3 wet_col = mix(vec3(0.2, 0.012, 0.01), vec3(0.09, 0.004, 0.003), solid);
				vec3 dry_col = mix(vec3(0.12, 0.035, 0.025), vec3(0.05, 0.015, 0.01), solid);
				vec3 bc = mix(wet_col, dry_col, pow(dry, 0.7));
				bc *= 0.7 + 0.6 * nz * (0.5 + 0.5 * solid);
				tint = mix(vec3(1.0), vec3(0.55, 0.12, 0.1), film);
				if (bv_gamma > 0.5) { tint = pow(tint, vec3(0.4545)); bc = pow(bc, vec3(0.4545)); }
				rough = mix(0.12, 0.75, dry);
				return vec4(solid * 0.95 + film * 0.25, bc);
			}`;
		if (pass == 0) {
			return new THREE.ShaderMaterial({
				uniforms: u,
				vertexShader: 'uniform mat4 rest; varying vec3 rp; void main() { rp = (rest * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
				fragmentShader: head + `
					void main() {
						vec3 tint; float rough; vec4 b = body_blood(tint, rough);
						if (b.x <= 0.0) discard;
						gl_FragColor = vec4(tint * (1.0 - b.x), 1.0);
					}`,
				transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
				blending: THREE.MultiplyBlending, premultipliedAlpha: true,
			});
		}
		const m = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.5, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
			blending: THREE.AdditiveBlending, envMapIntensity: 0.35});
		m.envMap = this.root && this.root.environment ? null : this.env;
		m.onBeforeCompile = shader => {
			Object.assign(shader.uniforms, u);
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nuniform mat4 rest; varying vec3 rp;')
				.replace('#include <project_vertex>', '#include <project_vertex>\nrp = (rest * vec4(transformed, 1.0)).xyz;');
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', '#include <common>\n' + head)
				.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
					{
						vec3 tint; float rough; vec4 b = body_blood(tint, rough);
						if (b.x <= 0.0) discard;
						diffuseColor = vec4(b.yzw, b.x);
						roughnessFactor = rough;
					}`)
				// added on top of the stained cloth: its share of the light, weighted by how much of it there is
				.replace('#include <output_fragment>', 'gl_FragColor = vec4(outgoingLight * diffuseColor.a, 1.0);');
		};
		m.customProgramCacheKey = () => 'ragdoll_body_blood';
		m.userData.u = u;
		return m;
	}

	updateBodies(dt) {
		for (const o of this.overlays) {
			const bb = o.bot.body_blood;
			if (!bb) continue;
			o.flush -= dt;
			if (bb.dirty && o.flush <= 0) {
				o.flush = bb.blooms.length ? 0.06 : 0.12;
				bb.dirty = false;
				if (!o.tex) {
					o.tex = new THREE.DataTexture3D(bb.data, bb.dims[0], bb.dims[1], bb.dims[2]);
					o.tex.format = THREE.RGFormat; o.tex.type = THREE.UnsignedByteType; o.tex.internalFormat = 'RG8';
					o.tex.minFilter = o.tex.magFilter = THREE.LinearFilter;
					o.tex.unpackAlignment = 1;
				}
				o.tex.needsUpdate = true;
			}
			if (!o.tex) continue;
			if (!o.made) {
				o.made = true;
				// where each piece of him is in the rest pose: Blockbench rest (no bone turned), pixels -> the game's metres
				const off = o.bot.rest_offset;
				for (const ov of o.overlays) {
					const el = ov.el, g = el.parent && el.parent.origin ? el.parent : null;
					el.mesh.updateMatrix();
					const rest = new THREE.Matrix4().makeTranslation(-off.x, -off.y, -off.z).multiply(new THREE.Matrix4().makeScale(1 / SCALE, 1 / SCALE, 1 / SCALE))
						.multiply(new THREE.Matrix4().makeTranslation(...(g ? g.origin : [0, 0, 0]))).multiply(el.mesh.matrix);
					ov.meshes = [0, 1].map(pass => {
						const m = new THREE.Mesh(el.mesh.geometry, this.bodyMaterial(o.bot, rest, pass));
						m.renderOrder = 4 + pass;
						m.frustumCulled = false;
						el.mesh.add(m);
						return m;
					});
				}
			}
			for (const ov of o.overlays) for (const m of ov.meshes || []) {
				const uni = m.material.uniforms || m.material.userData.u;
				uni.vol.value = o.tex; uni.time.value = this.sim._time % 256;
			}
		}
	}
	// ---- every frame ----
	update(dt) {
		this.time = this.sim._time;
		this.u.bv_time.value = this.sim._time % BV_TIME_SPAN;
		this.flushDabs();
		this.syncSurfaces(dt);
		this.updateLook();
		this.drawDrops(this.sim._since_sim);
		for (const s of this.splashes) {
			if (s.dur <= 0) continue;
			s.age += dt;
			const k = s.age / s.dur;
			if (k >= 1) { s.dur = 0; s.mesh.visible = false; continue; }
			s.mesh.material.uniforms.k.value = k;
		}
		this.updateMist(dt);
		// decals: carried by what they are on, and drying (darker, then matt)
		for (const d of this.decals) if (d.target || d.entry) this.placeDecal(d);
		const budget = Math.min(40, this.decals.length);
		for (let k = 0; k < budget; k++) {
			this.dry_cursor = ((this.dry_cursor || 0) + 1) % this.decals.length;
			const d = this.decals[this.dry_cursor];
			const k_dry = clamp((this.sim._time - d.birth) / B_DRY_TIME, 0, 1);
			d.mesh.material.color.setRGB(1, 1, 1).lerp(this.dry_color || (this.dry_color = new THREE.Color(...BV_DRY_COLOR)), Math.pow(k_dry, 0.7));
			const dry = k_dry > 0.6;
			if (dry != d.dry) { d.dry = dry; d.mesh.material.roughness = dry ? 0.62 : 0.07; }
		}
		this.updateBodies(dt);
	}

	dispose() {
		for (const g of [this.group, this.surface_group]) if (g.parent) g.parent.remove(g);
		const geos = new Set(), mats = new Set(), theirs = new Set([...this.surfaces.values()].map(ov => ov.geometry));
		for (const g of [this.group, this.surface_group]) g.traverse(o => { if (o.geometry && o.geometry !== this.decal_geo && !theirs.has(o.geometry)) geos.add(o.geometry); if (o.material) mats.add(o.material); });
		geos.forEach(g => g.dispose());
		mats.forEach(m => m.dispose());
		if (this.decal_geo) this.decal_geo.dispose();
		for (const o of this.overlays) { for (const ov of o.overlays) for (const m of ov.meshes || []) { if (m.parent) m.parent.remove(m); m.material.dispose(); } if (o.tex) o.tex.dispose(); }
		for (const map of this.maps || []) { map.target.dispose(); for (const m of map.meshes) m.material.dispose(); }
		if (this.dab_geo) this.dab_geo.dispose();
		if (this.blank) this.blank.dispose();
		if (this.env) this.env.dispose();
		for (const k in this.textures) this.textures[k].dispose();
		if (this.splash_tex) this.splash_tex.dispose();
	}
}

// basis whose Y is the surface normal and Z follows `along`
function decalBasis(n, along) {
	const y = n.clone().normalize();
	let z = along.clone().addScaledVector(y, -y.dot(along));
	if (z.length() < 1e-4) z = anyTangent(y);
	z.normalize();
	const x = y.clone().cross(z);
	return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// the faces of a projected decal that look towards it (Godot's normal_fade): the sides it grazes would only show its texture
// smeared across them
function facingOnly(geo, n, min) {
	const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
	if (!pos || !nrm) return geo;
	const keep = {p: [], n: [], u: []}, a = new THREE.Vector3();
	for (let i = 0; i + 2 < pos.count; i += 3) {
		a.set(0, 0, 0);
		for (let k = 0; k < 3; k++) a.x += nrm.getX(i + k), a.y += nrm.getY(i + k), a.z += nrm.getZ(i + k);
		if (a.normalize().dot(n) < min) continue;
		for (let k = 0; k < 3; k++) {
			keep.p.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
			keep.n.push(nrm.getX(i + k), nrm.getY(i + k), nrm.getZ(i + k));
			if (uv) keep.u.push(uv.getX(i + k), uv.getY(i + k));
		}
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.Float32BufferAttribute(keep.p, 3));
	out.setAttribute('normal', new THREE.Float32BufferAttribute(keep.n, 3));
	if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(keep.u, 2));
	geo.dispose();
	return out;
}

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


function hasHumanoidParts(bones) {
	const need = humanoidPartsList().map(d => humanoidRole(d.name));
	return need.every(n => bones.some(g => roleOf(g) == n.role && (!n.side || sideOfGroup(g, bones) == n.side)));
}

// ---------------------------------------------------------------------------
// The hook into the Physics tab
// ---------------------------------------------------------------------------

let runtimes = [];   // {rt, list: [RagdollRuntime]}
let current = null;

// ---------------------------------------------------------------------------
// Following an animation: until something happens to him, the character plays an animation exactly (every bone is moved
// to where the animation has it, step by step, so he still pushes things around). A shot, a timed hit, a hard bump or a
// set moment lets him go: from there on he is a ragdoll (the person of the Blood project falls, catches himself, gets up).
// ---------------------------------------------------------------------------

// a keyframe's value (Blockbench may keep expressions; getArray works them out)
function keyValue(kf) {
	if (kf.getArray) { try { return kf.getArray().map(Number); } catch (err) { /* fall back */ } }
	const d = kf.data_points && kf.data_points[0] || {};
	return ['x', 'y', 'z'].map(a => num(d[a], 0));
}
function channelAt(list, t, fallback) {
	if (!list || !list.length) return fallback;
	const keys = list.slice().sort((a, b) => a.time - b.time);
	if (t <= keys[0].time) return keyValue(keys[0]);
	for (let i = 1; i < keys.length; i++) {
		if (keys[i].time >= t) {
			const a = keys[i - 1], b = keys[i];
			if (a.interpolation == 'step') return keyValue(a);
			const f = (t - a.time) / Math.max(1e-6, b.time - a.time), va = keyValue(a), vb = keyValue(b);
			return va.map((v, k) => v + (vb[k] - v) * f);
		}
	}
	return keyValue(keys[keys.length - 1]);
}
// the world matrix (Blockbench pixels) of a group at a time of an animation, as Blockbench would show it
function animatedGroupWorld(anim, g, t, cache) {
	if (cache.has(g)) return cache.get(g);
	const signs = rotationSigns(), order = eulerOrder();
	const a = anim.animators && anim.animators[g.uuid];
	const parent = g.parent instanceof Group ? g.parent : null;
	const base = parent ? animatedGroupWorld(anim, parent, t, cache).clone() : (g.mesh && g.mesh.parent ? g.mesh.parent.matrixWorld.clone() : new THREE.Matrix4());
	const kp = channelAt(a && a.position, t, [0, 0, 0]), kr = channelAt(a && a.rotation, t, [0, 0, 0]);
	const p = new THREE.Vector3(...g.origin).sub(parent ? new THREE.Vector3(...parent.origin) : new THREE.Vector3()).add(new THREE.Vector3(...kp));
	const r = new THREE.Euler(...[0, 1, 2].map(i => (g.rotation[i] + kr[i]) * signs[i] * D2R), order);
	const m = base.multiply(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(r), new THREE.Vector3(1, 1, 1)));
	cache.set(g, m);
	return m;
}

class AnimationFollower {
	constructor(rt, r, root) {
		this.rt = rt; this.r = r; this.root = root;
		const s = ragdollOf(root);
		this.anim = (typeof Animation != 'undefined' && Animation.all || []).find(a => a.uuid == s.follow_anim) || null;
		this.release_at = Math.max(0, num(s.follow_release_at, 0));
		this.bump = s.follow_bump !== false;
		this.active = !!this.anim;
		this.time = 0;
		if (!this.active) return;
		const bones = bonesOf(root);
		this.parts = rt.world.entries.filter(e => bones.includes(e.desc.node) && !e.broken).map(e => {
			const g = e.desc.node;
			g.mesh.updateMatrixWorld(true);
			const body = new THREE.Matrix4().compose(bodyPos(e), bodyQuat(e), new THREE.Vector3(1, 1, 1));
			return {e, g, offset: g.mesh.matrixWorld.clone().invert().multiply(body), aim: null};
		});
		// the joint motors of the Blood person's muscles would pull against the animation: slack while it plays (his muscles
		// set them again at his first step of his own)
		if (r.parts && r.axes) {
			try {
				const AX = r.axes();
				r.parts.forEach(c => {
					if (!c.joint) return;
					c.motor_limit = 0;
					for (const axis of [AX.rx, AX.ry, AX.rz]) { const ms = c.joint.GetMotorSettings(axis); ms.mMinTorqueLimit = 0; ms.mMaxTorqueLimit = 0; }
				});
			} catch (err) { console.warn('[Ragdoll] follow motors', err); }
		}
		// he starts in the first pose of the animation
		const start = this.targets(0);
		const J = rt.Jolt, world = rt.world;
		this.parts.forEach((p, i) => {
			const {pos, quat} = start[i];
			try {
				world.bodies.SetPositionAndRotation(p.e.id, new J.RVec3(pos.x, pos.y, pos.z), new J.Quat(quat.x, quat.y, quat.z, quat.w), J.EActivation_Activate);
			} catch (err) { console.warn('[Ragdoll] follow', err); }
		});
	}
	// where every body is at a time of the animation (metres)
	targets(t) {
		const len = Math.max(1e-3, this.anim.length || 1);
		const at = this.anim.loop == 'loop' ? t % len : Math.min(t, len);
		const cache = new Map();
		return this.parts.map(p => {
			const m = animatedGroupWorld(this.anim, p.g, at, cache).clone().multiply(p.offset);
			const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), sc = new THREE.Vector3();
			m.decompose(pos, quat, sc);
			return {pos: pos.divideScalar(SCALE), quat};
		});
	}
	release(why) {
		if (!this.active) return;
		this.active = false;
		if (this.r.log) this.r.log.push({t: this.r.time, released: why});
		if (this.r.wake) this.r.wake();
	}
	// one step: true while it still plays the animation (the runtime's own step is left out then)
	step(dt) {
		if (!this.active) return false;
		const r = this.r;
		// something happened to him
		const hit_due = r.hits && r.next_hit < r.hits.length && r.hits[r.next_hit].t <= r.time + 1e-9;
		if ((r.pending && r.pending.length) || hit_due) { this.release('hit'); return false; }
		if (this.release_at > 0 && this.time >= this.release_at) { this.release('time'); return false; }
		// pushed off his pose by something solid
		if (this.bump && this.time > 0.1) {
			let worst = 0;
			this.parts.forEach(p => { if (p.aim) worst = Math.max(worst, bodyPos(p.e).divideScalar(SCALE).distanceTo(p.aim)); });
			if (worst > 0.08) { this.release('bump'); return false; }
		}
		// every body is sent to where the animation has it one step later (gravity taken off: it is added in the step)
		const next = this.targets(this.time + dt);
		const world = this.rt.world, g = world.system.GetGravity();
		this.parts.forEach((p, i) => {
			const now = bodyPos(p.e).divideScalar(SCALE), q = bodyQuat(p.e), want = next[i];
			const v = want.pos.clone().sub(now).divideScalar(dt);
			world.tmp.Set(v.x - g.GetX() * dt, v.y - g.GetY() * dt, v.z - g.GetZ() * dt);
			world.bodies.SetLinearVelocity(p.e.id, world.tmp);
			const dq = want.quat.clone().multiply(q.clone().invert());
			if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
			const angle = 2 * Math.acos(Math.min(1, dq.w)), s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
			const w = s > 1e-6 ? new THREE.Vector3(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt) : new THREE.Vector3();
			world.tmp.Set(w.x, w.y, w.z);
			world.bodies.SetAngularVelocity(p.e.id, world.tmp);
			p.aim = want.pos.clone();
		});
		this.time += dt;
		r.time += dt;
		if (r._time !== undefined) r._time += dt;
		return true;
	}
}

const physicsHook = {
	start(rt) {
		this.stop();
		const roots = Group.all.filter(g => g.ragdoll && g.ragdoll.enabled);
		const list = [];
		for (const root of roots) {
			try {
				// a person of the Blood project (its 15 body parts are all there): the game's body, muscles and mind
				const bones = bonesOf(root);
				if (ragdollOf(root).npc && hasHumanoidParts(bones)) { const h = new Humanoid(rt, root, bones); h.route = routeFor(root); list.push(h); }
				else list.push(new RagdollRuntime(rt, root));
			} catch (err) { console.warn('[Ragdoll]', root.name, err); }
		}
		let blood = null, sim = null;
		// (a bake keeps the blood only if it is to be recorded: then it is written down instead of drawn)
		const plain = rt.baking ? [] : list.filter(r => !r.is_humanoid && r.s.blood);
		const people = list.filter(r => r.is_humanoid && r.s.blood && (!rt.baking || r.s.record_blood));
		if (plain.length) { try { blood = new BloodFX(rt); } catch (err) { console.warn('[Ragdoll] blood', err); } }
		for (const r of plain) r.blood = blood;
		// the people of the Blood project bleed as in the game
		if (people.length) {
			try {
				sim = new BloodSim(rt, people);
				for (const r of people) r.blood = sim;
				try { sim.view = rt.baking ? new BloodRecorder(sim) : new BloodView(sim, rt); } catch (err) { console.warn('[Ragdoll] blood view', err); }
			} catch (err) { console.warn('[Ragdoll] blood', err); sim = null; }
		}
		// the ones that play an animation until something happens to them
		const followers = new Map();
		for (const r of list) {
			if (!r.root || !ragdollOf(r.root).follow_anim) continue;
			try { const f = new AnimationFollower(rt, r, r.root); if (f.active) followers.set(r, f); } catch (err) { console.warn('[Ragdoll] follow', err); }
		}
		current = {rt, list, blood, sim, last_show: null, followers};
		startMarkers();
	},
	step(rt, dt) {
		if (!current || current.rt !== rt) return;
		stepMarkers(dt);
		for (const r of current.list) { const f = current.followers && current.followers.get(r); if (f && f.step(dt)) continue; r.step(dt); }
		if (current.blood) current.blood.step(dt);
		if (current.sim) current.sim.step(dt);
	},
	bake_frame(rt, time) { if (current && current.rt === rt && current.sim && current.sim.view instanceof BloodRecorder) current.sim.view.frame(time); },
	baked(rt, animation) {
		if (!current || current.rt !== rt || !current.sim || !(current.sim.view instanceof BloodRecorder) || !animation) return;
		blood_bakes.set(animation.uuid, current.sim.view.rec);
	},
	show() {
		if (!current) return;
		if (current.blood) current.blood.show();
		if (current.sim && current.sim.view) {
			// (the simulation's own time: the blood moves with the physics, however fast that plays)
			const now = current.sim._time, dt = current.last_show !== null ? clamp(now - current.last_show, 0, 0.1) : 0;
			current.last_show = now;
			try { current.sim.view.update(dt); } catch (err) { console.warn('[Ragdoll] blood view', err); current.sim.view = null; }
		}
	},
	stop() {
		if (current && current.blood) { try { current.blood.dispose(); } catch (err) { /* scene is gone */ } }
		if (current && current.sim) { try { if (current.sim.view) current.sim.view.dispose(); current.sim.dispose(); } catch (err) { /* scene is gone */ } }
		current = null;
	},
};

// ---------------------------------------------------------------------------
// Building a ragdoll from a group
// ---------------------------------------------------------------------------

const isPart = el => el instanceof Cube || el instanceof Mesh;
const directParts = g => (g.children || []).filter(isPart);
const volumeOf = g => directParts(g).reduce((s, el) => s + (el instanceof Cube ? Math.abs((el.to[0] - el.from[0]) * (el.to[1] - el.from[1]) * (el.to[2] - el.from[2])) : 1000), 0);

function bonesOf(root) {
	const out = [];
	const visit = g => { if (g.attach && g.attach.bone) return; if (directParts(g).length) out.push(g); (g.children || []).forEach(c => { if (c instanceof Group) visit(c); }); };   // a held item is not a bone
	visit(root);
	return out;
}

function buildRagdoll(root, total_mass) {
	const bones = bonesOf(root);
	if (bones.length < 2) return {error: 'few'};
	const roles = bones.map(g => (g.bone && g.bone.role) || roleOfName(g.name));
	const anatomy = roles.every(r => ROLE_PARAMS[r]);   // known body parts: the weights of a real body, else by volume
	const weight = (g, i) => anatomy ? ROLE_PARAMS[roles[i]].mass : Math.max(volumeOf(g), 1);
	const sum = bones.reduce((s, g, i) => s + weight(g, i), 0);
	const mass = total_mass || ragdollOf(root).total_mass;
	root.ragdoll = Object.assign(ragdollOf(root), {enabled: true, total_mass: mass});
	for (const [gi, g] of bones.entries()) {
		g.physics = Object.assign({}, g.physics || {}, {type: 'dynamic', mass: Math.max(0.2, Math.round(mass * weight(g, gi) / sum * 100) / 100), friction: 0.7, restitution: 0.05, velocity: (g.physics && g.physics.velocity) || [0, 0, 0]});
		const old = g.bone || {}, role = old.role || roleOfName(g.name), jd = (!old.joint && JOINTS[role]) || null;
		g.bone = Object.assign({}, DEFAULT_BONE, old, jd || {}, {role, joint: old.joint || (jd && jd.joint) || (hingeByName(g.name) ? 'hinge' : 'ball'), rest: (old.rest || g.rotation || [0, 0, 0]).slice(), hinge_axis: old.hinge_axis || 'x'});
		if (!jd && !old.joint && hingeByName(g.name)) { g.bone.hmin = -140; g.bone.hmax = 140; }
	}
	return {bones};
}

function removeRagdoll(root) {
	for (const g of bonesOf(root)) { g.physics = null; g.bone = null; }
	root.ragdoll = null;
}

// ---------------------------------------------------------------------------
// The default character: a minimal mannequin with the bones already in place
// ---------------------------------------------------------------------------

// angles are in three.js terms (degrees): x tips a limb that hangs down toward -Z (the front), z swings it sideways
const POSES = {   // the simple mannequin
	stand: {},   // straight: arms down, legs straight, feet forward
	sit: {     // on a stool, hands resting on the knees
		thigh: {x: 90, z: 3}, shin: {x: -90, z: 0}, foot: {x: 0, y: 6}, pelvis: {x: 0}, abdomen: {x: -3}, chest: {x: -2}, neck: {x: 4}, head: {x: 2},
		upperarm: {x: 0, z: 20}, forearm: {x: 93, z: 0}, hand: {x: 0},
	},
};


// ---- the person from the game Blood: 15 body parts with the proportions and the joints of that ragdoll (1.8 m tall) ----

// the game's casual outfit (humanoid.gd _make_materials): skin, a dark blue shirt, dark trousers, black shoes, dark hair
const NPC_COLORS = {skin: '#d1a180', shirt: '#29334d', pants: '#1f1f21', shoes: '#141212', hair: '#120d0a', eye: '#0a0908', lips: '#381412', chair: '#7a5a3a'};
const NPC_MATERIALS = ['skin', 'shirt', 'pants', 'shoes', 'hair', 'eye', 'lips', 'chair'];

const NPC_POSES = {
	stand: {},
	sit: {thigh: {x: 90, z: 3}, shin: {x: -90, z: 0}, foot: {x: 0, y: 5}, abdomen: {x: -3}, chest: {x: -2}, head: {x: 2},
		upperarm: {x: 0, z: 20}, forearm: {x: 75, z: 0}, hand: {x: 0}},
};

// all in metres here, the result in pixels (16 px = 1 m)
function npcSpec(o = {}) {
	const pose = NPC_POSES[o.pose] ? o.pose : 'stand', P = NPC_POSES[pose], sit = pose == 'sit';
	const k = (o.height ? o.height / 28.7 : 1) * SCALE;     // metres -> pixels (the character is 1.795 m tall)
	const drop = sit ? 0.415 : 0;                             // sitting: the body comes down by the thigh
	const bones = [], rnd = v => Math.round(v * 1000) / 1000;
	const r = (p, ax) => (p && p[ax]) || 0;
	const cube = (c, size, mat) => ({from: [0, 1, 2].map(i => rnd((c[i] - size[i] / 2) * k)), to: [0, 1, 2].map(i => rnd((c[i] + size[i] / 2) * k)), mat});
	const add = (name, role, parent, pivot, cubes, rot) => bones.push({name, role, parent, pivot: pivot.map(v => rnd(v * k)), cubes, rot: rot || [0, 0, 0]});
	const hi = y => y - drop;   // a height of the upper body
	add('Pelvis', 'pelvis', null, [0, hi(0.97), 0], [cube([0, hi(0.97), 0], [0.36, 0.27, 0.23], 'pants')], [0, 0, 0]);
	add('Abdomen', 'abdomen', 'Pelvis', [0, hi(1.05), 0], [cube([0, hi(1.14), 0], [0.31, 0.25, 0.205], 'shirt')], [r(P.abdomen, 'x'), 0, 0]);
	add('Chest', 'chest', 'Abdomen', [0, hi(1.245), 0], [cube([0, hi(1.36), 0], [0.40, 0.30, 0.24], 'shirt'), cube([0, hi(1.43), 0.01], [0.44, 0.18, 0.2], 'shirt')], [r(P.chest, 'x'), 0, 0]);
	add('Head', 'head', 'Chest', [0, hi(1.53), 0], [
		cube([0, hi(1.545), 0], [0.11, 0.17, 0.11], 'skin'),                     // neck
		cube([0, hi(1.675), -0.01], [0.186, 0.235, 0.216], 'skin'),                // skull
		cube([0, hi(1.605), -0.045], [0.147, 0.1, 0.168], 'skin'),                 // jaw
		cube([0, hi(1.66), -0.113], [0.034, 0.05, 0.034], 'skin'),                 // nose
		cube([0.093, hi(1.665), 0], [0.022, 0.05, 0.04], 'skin'), cube([-0.093, hi(1.665), 0], [0.022, 0.05, 0.04], 'skin'),   // ears
		cube([0.035, hi(1.69), -0.102], [0.022, 0.016, 0.011], 'eye'), cube([-0.035, hi(1.69), -0.102], [0.022, 0.016, 0.011], 'eye'),
		cube([0, hi(1.593), -0.108], [0.05, 0.008, 0.012], 'lips'),                // mouth
		cube([0, hi(1.76), 0.005], [0.2, 0.09, 0.225], 'hair'),                    // hair
	], [r(P.head, 'x'), 0, 0]);
	for (const s of [1, -1]) {
		const L = s > 0 ? 'R' : 'L';
		add('Upper Arm ' + L, 'upperarm', 'Chest', [s * 0.25, hi(1.43), 0], [cube([s * 0.25, hi(1.3), 0], [0.116, 0.32, 0.116], 'shirt'), cube([s * 0.25, hi(1.42), 0], [0.124, 0.12, 0.124], 'shirt')], [r(P.upperarm, 'x'), 0, -s * r(P.upperarm, 'z')]);
		add('Forearm ' + L, 'forearm', 'Upper Arm ' + L, [s * 0.25, hi(1.155), 0], [cube([s * 0.25, hi(1.02), 0], [0.094, 0.29, 0.094], 'skin')], [r(P.forearm, 'x'), 0, -s * r(P.forearm, 'z')]);
		add('Hand ' + L, 'hand', 'Forearm ' + L, [s * 0.25, hi(0.88), 0], [cube([s * 0.25, hi(0.812), -0.005], [0.044, 0.11, 0.078], 'skin'), cube([s * 0.25, hi(0.87), -0.005], [0.06, 0.1, 0.06], 'skin'), cube([s * 0.25, hi(0.84), -0.052], [0.022, 0.045, 0.022], 'skin')], [r(P.hand, 'x'), 0, 0]);
		add('Thigh ' + L, 'thigh', 'Pelvis', [s * 0.1, hi(0.92), 0], [cube([s * 0.1, hi(0.72), 0], [0.164, 0.46, 0.164], 'pants')], [r(P.thigh, 'x'), 0, -s * r(P.thigh, 'z')]);
		add('Shin ' + L, 'shin', 'Thigh ' + L, [s * 0.1, hi(0.505) + (sit ? 0 : 0), 0], [cube([s * 0.1, hi(0.29), 0], [0.124, 0.46, 0.124], 'pants')], [r(P.shin, 'x'), 0, 0]);
		add('Foot ' + L, 'foot', 'Shin ' + L, [s * 0.1, hi(0.08), 0], [cube([s * 0.1, hi(0.045), -0.055], [0.1, 0.08, 0.26], 'shoes'), cube([s * 0.1, hi(0.065), 0.025], [0.1, 0.06, 0.07], 'shoes')], [r(P.foot, 'x'), s * r(P.foot, 'y'), 0]);
	}
	let chair = null;
	if (sit) {
		const top = 0.505 - 0.082, t = 0.04;   // the thighs lie on the seat
		const post = (sx, zc) => cube([sx * 0.2, top / 2 - t / 2, zc], [0.03, top - t, 0.03], 'chair');
		chair = {name: 'Chair', cubes: [cube([0, top - t / 2, -0.05], [0.5, t, 0.5], 'chair'), cube([0, top + 0.28, 0.22], [0.46, 0.55, 0.04], 'chair'), post(1, 0.18), post(-1, 0.18), post(1, -0.3), post(-1, -0.3)]};
	}
	return {bones, chair, pose, model: 'npc'};
}

function characterSpec(o = {}) {
	if (o.model != 'mannequin') return humanoidSpec(o);
	const k = (o.height || 28.6) / 28.6, pose = POSES[o.pose] ? o.pose : 'stand', P = POSES[pose], sit = pose == 'sit';
	const y = v => v * k;
	const drop = sit ? y(6.9) : 0;   // sitting: the whole body comes down by the length of the thigh
	const Y = v => y(v) - drop;
	const hipY = sit ? y(8.1) : y(15);
	const bones = [];
	const rnd = v => Math.round(v * 1000) / 1000;
	const add = (name, role, parent, pivot, cubes, rot) => bones.push({name, role, parent, pivot: pivot.map(rnd), cubes, rot: rot || [0, 0, 0]});
	const box = (cx, y0, y1, cz, w, d) => ({from: [cx - w / 2, y0, cz - d / 2].map(rnd), to: [cx + w / 2, y1, cz + d / 2].map(rnd)});
	const r = (p, ax) => (p && p[ax]) || 0;
	add('Pelvis', 'pelvis', null, [0, hipY + y(0.2), 0], [box(0, hipY - y(1), hipY + y(1.4), 0, y(6.0), y(3.4))], [r(P.pelvis, 'x'), 0, 0]);
	add('Abdomen', 'abdomen', 'Pelvis', [0, Y(16.4), 0], [box(0, Y(16.4), Y(19.6), 0, y(5.6), y(3.1))], [r(P.abdomen, 'x'), 0, 0]);
	add('Chest', 'chest', 'Abdomen', [0, Y(19.6), 0], [box(0, Y(19.6), Y(23.5), 0, y(7.2), y(3.7))], [r(P.chest, 'x'), 0, 0]);
	add('Neck', 'neck', 'Chest', [0, Y(23.5), 0], [box(0, Y(23.5), Y(24.9), 0, y(1.5), y(1.5))], [r(P.neck, 'x'), 0, 0]);
	add('Head', 'head', 'Neck', [0, Y(24.9), 0], [box(0, Y(24.9), Y(28.6), -y(0.1), y(3.7), y(4.1))], [r(P.head, 'x'), 0, 0]);
	for (const s of [1, -1]) {
		const L = s > 0 ? 'R' : 'L';
		const sh = [s * y(4.1), Y(22.5), 0];
		add('Upper Arm ' + L, 'upperarm', 'Chest', sh, [box(s * y(4.1), sh[1] - y(5.2), sh[1] + y(0.8), 0, y(1.9), y(1.9))], [r(P.upperarm, 'x'), 0, -s * r(P.upperarm, 'z')]);
		const el = [s * y(4.1), sh[1] - y(5.2), 0];
		add('Forearm ' + L, 'forearm', 'Upper Arm ' + L, el, [box(s * y(4.1), el[1] - y(4.6), el[1] + y(0.6), 0, y(1.6), y(1.6))], [r(P.forearm, 'x'), 0, -s * r(P.forearm, 'z')]);
		const wr = [s * y(4.1), el[1] - y(4.6), 0];
		add('Hand ' + L, 'hand', 'Forearm ' + L, wr, [box(s * y(4.1), wr[1] - y(2.1), wr[1] + y(0.3), 0, y(1.4), y(0.9))], [r(P.hand, 'x'), 0, 0]);
		const hp = [s * y(1.9), hipY, 0];
		add('Thigh ' + L, 'thigh', 'Pelvis', hp, [box(s * y(1.9), hp[1] - y(6.9), hp[1] + y(0.4), 0, y(2.9), y(2.9))], [r(P.thigh, 'x'), 0, -s * r(P.thigh, 'z')]);
		const kn = [s * y(1.9), hp[1] - y(6.9), 0];
		add('Shin ' + L, 'shin', 'Thigh ' + L, kn, [box(s * y(1.9), kn[1] - y(7.0), kn[1] + y(0.4), 0, y(2.3), y(2.3))], [r(P.shin, 'x'), 0, 0]);
		const an = [s * y(1.9), kn[1] - y(7.0), 0];
		add('Foot ' + L, 'foot', 'Shin ' + L, an, [box(s * y(1.9), an[1] - y(1.1), an[1] + y(0.2), -y(1.5), y(2.3), y(4.7))], [r(P.foot, 'x'), s * r(P.foot, 'y'), 0]);
	}
	let chair = null;
	if (sit) {
		const top = hipY - y(1.45), t = y(1.4);   // the thighs lie on the seat
		const post = (sx, zc) => ({from: [sx * y(3.9) - y(0.5), 0, zc - y(0.5)].map(rnd), to: [sx * y(3.9) + y(0.5), top - t, zc + y(0.5)].map(rnd)});
		const back = {from: [-y(4.0), top, y(3.5)].map(rnd), to: [y(4.0), top + y(11), y(4.6)].map(rnd)};   // a low back so a hit does not tip the person off
		chair = {name: 'Chair', cubes: [{from: [-y(4.6), top - t, y(4.6)].map(rnd), to: [y(4.6), top, -y(8.2)].map(rnd)}, back, post(1, y(3.6)), post(-1, y(3.6)), post(1, -y(7.0)), post(-1, -y(7.0))]};
	}
	return {bones, chair, pose};
}


// a small colour texture for the character (skin, shirt, pants, shoes, hair...) and the faces that use it
function npcPalette() {
	try {
		if (typeof Texture == 'undefined' || typeof document == 'undefined') return null;
		const found = (Texture.all || []).find(t => t.name == 'npc_palette.png' || t.name == 'npc_palette');
		if (found) return found;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 16;
		const c = canvas.getContext('2d');
		NPC_MATERIALS.forEach((m, i) => { c.fillStyle = NPC_COLORS[m]; c.fillRect((i % 4) * 4, Math.floor(i / 4) * 4, 4, 4); });
		return new Texture({name: 'npc_palette.png'}).fromDataURL(canvas.toDataURL()).add(false);
	} catch (err) { console.warn('[Ragdoll] palette', err); return null; }
}
function paintCube(el, mat, texture) {
	try {
		const k = Math.max(0, NPC_MATERIALS.indexOf(mat || 'skin')), ratio = ((typeof Project != 'undefined' && Project && Project.texture_width) || 16) / 16;
		const x = (k % 4) * 4, y = Math.floor(k / 4) * 4, uv = [(x + 1) * ratio, (y + 1) * ratio, (x + 3) * ratio, (y + 3) * ratio];
		for (const f of ['north', 'east', 'south', 'west', 'up', 'down']) { if (el.faces && el.faces[f]) { el.faces[f].uv = uv.slice(); el.faces[f].texture = texture.uuid; } }
		if (typeof Canvas != 'undefined' && Canvas.updateView) Canvas.updateView({elements: [el], element_aspects: {uv: true, faces: true}});
	} catch (err) { /* unpainted */ }
}

function paintMesh(el, mat, texture) {
	try {
		const k = Math.max(0, NPC_MATERIALS.indexOf(mat || 'skin')), ratio = ((typeof Project != 'undefined' && Project && Project.texture_width) || 16) / 16;
		const uv = [((k % 4) * 4 + 2) * ratio, (Math.floor(k / 4) * 4 + 2) * ratio];
		for (const key in el.faces) { const f = el.faces[key]; f.texture = texture.uuid; for (const v of f.vertices) f.uv[v] = uv.slice(); }
		if (typeof Canvas != 'undefined' && Canvas.updateView) Canvas.updateView({elements: [el], element_aspects: {geometry: true, uv: true, faces: true}});
	} catch (err) { /* unpainted */ }
}

// makes the groups and cubes of the character; returns the group that holds the character
function createCharacter(o = {}) {
	const spec = characterSpec(o), made = new Map();
	Undo.initEdit({outliner: true, elements: [], groups: [], selection: true});
	const palette = spec.model == 'npc' ? npcPalette() : null;
	const root = new Group({name: 'Character', origin: [0, 0, 0]});
	root.addTo('root').init();
	const groups = [root], elements = [];
	for (const b of spec.bones) {
		const g = new Group({name: b.name, origin: b.pivot.slice(), rotation: bbOfThree(b.rot)});
		g.addTo(b.parent ? made.get(b.parent) : root).init();
		made.set(b.name, g);
		groups.push(g);
		for (const c of b.cubes) {
			const el = new Cube({name: b.name.toLowerCase().replace(/ /g, '_'), from: c.from, to: c.to, origin: [0, 1, 2].map(i => (c.from[i] + c.to[i]) / 2)});
			el.addTo(g).init();
			if (palette && c.mat) paintCube(el, c.mat, palette);
			elements.push(el);
		}
		// the person of the Blood project: his shapes as meshes
		for (const m of b.meshes || []) {
			const el = new Mesh({name: b.name.toLowerCase().replace(/ /g, '_'), origin: m.origin.slice(), vertices: {}});
			const keys = el.addVertices(...m.vertices.map(v => [v[0] - m.origin[0], v[1] - m.origin[1], v[2] - m.origin[2]]));
			el.addFaces(...m.faces.map(f => new MeshFace(el, {vertices: f.map(i => keys[i])})));
			el.addTo(g).init();
			if (palette) paintMesh(el, m.mat, palette);
			elements.push(el);
		}
	}
	let chair = null;
	if (spec.chair) {
		chair = new Group({name: spec.chair.name, origin: [0, 0, 0]});
		chair.addTo('root').init();
		chair.physics = {type: 'static', friction: 0.8, restitution: 0.05};
		groups.push(chair);
		for (const c of spec.chair.cubes) {
			const el = new Cube({name: 'chair', from: c.from, to: c.to, origin: [0, 1, 2].map(i => (c.from[i] + c.to[i]) / 2)});
			el.addTo(chair).init();
			if (palette) paintCube(el, 'chair', palette);
			elements.push(el);
		}
	}
	const bones = bonesOf(root);
	buildRagdoll(root, o.mass || 70);
	root.ragdoll = Object.assign(ragdollOf(root), spec.model == 'npc' ? {npc: true, pin: 'none', limp: 0, posture: spec.pose, shot: 4, weapon: 'pistol', blood: true} : {pin: 'until_limp', limp: 120});
	bones.forEach(g => { const b = boneOf(g), role = roleOfName(g.name); g.bone = Object.assign(b, {role, rest: g.rotation.slice()}); });
	Undo.finishEdit('Add character', {outliner: true, elements, groups, selection: true});
	if (typeof Canvas != 'undefined') { Canvas.updateAllBones(); Canvas.updateAllPositions(); }
	root.select();
	return {root, chair, spec};
}

// ---------------------------------------------------------------------------
// Automatic bones: loose cubes of a standing person are sorted into body parts, and the joints are put in
// ---------------------------------------------------------------------------

const centerOf = el => {
	if (el.mesh) { el.mesh.updateMatrixWorld(true); return new THREE.Box3().setFromObject(el.mesh); }
	return new THREE.Box3(new THREE.Vector3(...el.from), new THREE.Vector3(...el.to));
};

// which part of the body (and which side) an element is, from where it sits in the body box
function classifyParts(boxes) {
	const all = new THREE.Box3();
	boxes.forEach(b => all.union(b));
	const H = Math.max(1e-3, all.max.y - all.min.y), cx = (all.min.x + all.max.x) / 2;
	const out = [];
	for (const box of boxes) {
		const c = box.getCenter(new THREE.Vector3());
		const ny = (c.y - all.min.y) / H, nx = (c.x - cx) / H, side = nx >= 0 ? 1 : -1;
		let role;
		if (ny >= 0.86) role = 'head';
		else if (ny >= 0.82 && Math.abs(nx) < 0.05) role = 'neck';
		else if (Math.abs(nx) > 0.115 && ny >= 0.36) {
			// an arm: by how far from the shoulder it is (the arm may hang or stick out)
			const shoulder = new THREE.Vector3(cx + side * 0.13 * H, all.min.y + 0.80 * H, c.z);
			const d = c.distanceTo(shoulder) / (0.4 * H);
			role = d < 0.5 ? 'upperarm' : d < 0.86 ? 'forearm' : 'hand';
		} else if (ny >= 0.82) role = 'chest';
		else if (ny >= 0.67) role = 'chest';
		else if (ny >= 0.57) role = 'abdomen';
		else if (ny >= 0.5) role = 'pelvis';
		else if (ny >= 0.27) role = 'thigh';
		else if (ny >= 0.07) role = 'shin';
		else role = 'foot';
		const sided = ['upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot'].includes(role);
		out.push({role, side: sided ? side : 0, box});
	}
	return {parts: out, H, cx, bounds: all};
}

const PARENT_ROLE = {abdomen: 'pelvis', chest: 'abdomen', neck: 'chest', head: 'neck', upperarm: 'chest', forearm: 'upperarm', hand: 'forearm', thigh: 'pelvis', shin: 'thigh', foot: 'shin'};
const PART_NAMES = {pelvis: 'Pelvis', abdomen: 'Abdomen', chest: 'Chest', neck: 'Neck', head: 'Head', upperarm: 'Upper Arm', forearm: 'Forearm', hand: 'Hand', thigh: 'Thigh', shin: 'Shin', foot: 'Foot'};

// the joints of every part: where the bone turns
function placeJoints(parts) {
	const groups = new Map();
	parts.forEach((p, i) => {
		const key = p.role + ':' + p.side;
		if (!groups.has(key)) groups.set(key, {role: p.role, side: p.side, items: [], box: new THREE.Box3()});
		const g = groups.get(key);
		g.items.push(i);
		g.box.union(p.box);
	});
	const list = [...groups.values()];
	const find = (role, side) => list.find(g => g.role == role && (g.side == side || !g.side || !side)) || list.find(g => g.role == role);
	for (const g of list) {
		let parent = null, role = PARENT_ROLE[g.role];
		while (role && !parent) { parent = find(role, g.side); if (!parent) role = PARENT_ROLE[role]; }
		g.parent = parent;
		const c = g.box.getCenter(new THREE.Vector3()), size = g.box.getSize(new THREE.Vector3());
		const pc = parent ? parent.box.getCenter(new THREE.Vector3()) : c;
		const vertical = ['abdomen', 'chest', 'neck', 'head'].includes(g.role);
		if (g.role == 'pelvis') g.pivot = c.clone();
		else if (vertical) g.pivot = new THREE.Vector3(c.x, g.box.min.y, c.z);
		else if (g.role == 'foot') g.pivot = new THREE.Vector3(c.x, g.box.max.y, THREE.MathUtils.clamp(pc.z, g.box.min.z, g.box.max.z));
		else {
			// a limb turns at its end that is nearest to the parent, in the middle of its thickness
			const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.z > size.y ? 'z' : 'y';
			g.pivot = c.clone();
			g.pivot[axis] = Math.abs(pc[axis] - g.box.min[axis]) < Math.abs(pc[axis] - g.box.max[axis]) ? g.box.min[axis] : g.box.max[axis];
		}
		g.name = (PART_NAMES[g.role] || g.role) + (g.side ? (g.side > 0 ? ' R' : ' L') : '');
	}
	return list;
}

// makes the groups and puts the elements in them; returns {root, count}
function autoRig(elements) {
	const els = elements.filter(el => el instanceof Cube || el instanceof Mesh);
	if (els.length < 6) return {error: 'few'};
	const boxes = els.map(centerOf);
	const {parts} = classifyParts(boxes);
	const joints = placeJoints(parts);
	Undo.initEdit({outliner: true, elements: els, groups: [], selection: true});
	const root = new Group({name: 'Character', origin: [0, 0, 0]});
	root.addTo('root').init();
	const made = new Map(), order = [];
	const depth = j => { let d = 0; for (let p = j.parent; p; p = p.parent) d++; return d; };
	for (const j of joints.slice().sort((a, b) => depth(a) - depth(b))) {
		const g = new Group({name: j.name, origin: j.pivot.toArray().map(v => Math.round(v * 100) / 100)});
		g.addTo(j.parent ? made.get(j.parent) : root).init();
		made.set(j, g);
		order.push(g);
		j.items.forEach(i => els[i].addTo(g));
	}
	const all = [root, ...order];
	buildRagdoll(root, 70);
	order.forEach(g => { g.bone = Object.assign(boneOf(g), {role: roleOfName(g.name), rest: g.rotation.slice()}); });
	Undo.finishEdit('Auto bones', {outliner: true, elements: els, groups: all, selection: true});
	if (typeof Canvas != 'undefined') { Canvas.updateAllBones(); Canvas.updateAllPositions(); }
	root.select();
	return {root, count: order.length};
}

// ---------------------------------------------------------------------------
// Saved ragdolls: a character (its skeleton, joints, muscles, settings and its own model: cubes, meshes, textures) kept
// in the list of models, so it can be added again in any project. Kept by Blockbench (in its local storage).
// When it is added again, the pose and the chair come from the chosen pose, like the built-in person: only the model is his.
// ---------------------------------------------------------------------------

const SAVED_KEY = 'ragdoll_saved_models';
let saved_memory = null;   // when the storage cannot be used
function savedModels() {
	try { const raw = localStorage.getItem(SAVED_KEY); if (raw) return JSON.parse(raw); } catch (err) { /* no storage */ }
	return saved_memory || [];
}
function storeSavedModels(list) {
	saved_memory = list;
	try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); return true; } catch (err) { console.warn('[Ragdoll] saving the model', err); return false; }
}

const GROUP_KEYS = ['name', 'origin', 'rotation', 'color', 'visibility', 'export', 'locked', 'ragdoll', 'bone', 'physics', 'attach', 'render_light', 'render_camera', 'render_particles', 'softbody'];
function groupData(g) {
	const out = {};
	const keys = typeof Group != 'undefined' && Group.properties ? [...new Set([...Object.keys(Group.properties), ...GROUP_KEYS])] : GROUP_KEYS;
	for (const k of keys) if (g[k] !== undefined && k != 'uuid' && k != 'children' && k != 'parent') out[k] = JSON.parse(JSON.stringify(g[k]));
	return out;
}
function elementData(el) {
	if (el.getSaveCopy) return JSON.parse(JSON.stringify(el.getSaveCopy()));
	const out = {type: el instanceof Mesh ? 'mesh' : 'cube'};
	for (const k of ['name', 'from', 'to', 'origin', 'rotation', 'faces', 'vertices', 'color', 'render_material', 'physics', 'inflate']) if (el[k] !== undefined) out[k] = JSON.parse(JSON.stringify(el[k]));
	return out;
}

// the character as data: the group tree, the textures its faces use, and what is needed to pose it again
function characterData(root) {
	const textures = new Set();
	const walk = g => ({uuid: g.uuid, group: groupData(g), children: (g.children || []).map(c => {
		if (c instanceof Group) return walk(c);
		if (!(c instanceof Cube || c instanceof Mesh)) return null;
		const d = elementData(c);
		d.uuid = c.uuid;
		for (const f of Object.values(d.faces || {})) if (f && f.texture) textures.add(f.texture);
		return {element: d};
	}).filter(Boolean)});
	const tree = walk(root);
	const tex = [];
	for (const uuid of textures) {
		const t = (Texture.all || []).find(x => x.uuid == uuid);
		if (!t) continue;
		let data = null;
		try { data = (t.getDataURL && t.getDataURL()) || (t.canvas && t.canvas.toDataURL()) || (t.img && t.img.src && t.img.src.startsWith('data:') ? t.img.src : null) || (String(t.source || '').startsWith('data:') ? t.source : null); } catch (err) { /* left out */ }
		if (data) tex.push({uuid, name: t.name, data});
	}
	const pelvis = bonesOf(root).find(g => roleOf(g) == 'pelvis');
	const head = bonesOf(root).find(g => roleOf(g) == 'head');
	const s = ragdollOf(root);
	return {version: 1, tree, textures: tex, posture: s.posture || 'stand',
		pelvis_y: pelvis ? pelvis.origin[1] : null, head_y: head ? head.origin[1] : null};
}

function saveCharacterModel(root, name) {
	if (!root) { Blockbench.showQuickMessage(tr('msg_save_none'), 2500); return null; }
	const list = savedModels();
	const entry = {id: 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name: name || root.name, created: Date.now(), data: characterData(root)};
	list.push(entry);
	if (!storeSavedModels(list)) Blockbench.showQuickMessage(tr('msg_save_big'), 4000);
	else Blockbench.showQuickMessage(tr('msg_saved_model').replace('%', entry.name), 2500);
	return entry;
}
function deleteSavedModel(id) {
	storeSavedModels(savedModels().filter(m => m.id != id));
}

// adds a saved character; pose: one of the postures ('stand', 'sit'...), or 'saved' for the pose it was saved in
function createSavedCharacter(entry, pose) {
	const data = JSON.parse(JSON.stringify(entry.data));
	// the textures: the same picture already in the project is used again
	const tex_map = new Map();
	for (const t of data.textures || []) {
		let found = null;
		try { found = (Texture.all || []).find(x => x.name == t.name && ((x.getDataURL && x.getDataURL()) || x.source) == t.data); } catch (err) { /* compare failed */ }
		if (!found) { try { found = new Texture({name: t.name}).fromDataURL(t.data).add(false); } catch (err) { console.warn('[Ragdoll] texture', err); } }
		if (found) tex_map.set(t.uuid, found.uuid);
	}
	// the pose: the joint angles of the built-in person, by bone name; the body moved up or down so it stands (or sits) right
	const humanoid = POSTURES.includes(pose);
	let spec = null, dy = 0;
	const scale = data.pelvis_y !== null && data.head_y !== null ? (data.head_y - data.pelvis_y) / ((1.53 - 0.97) * SCALE) : 1;
	if (humanoid && data.pelvis_y !== null) {
		spec = humanoidSpec({pose, height: 28.7 * scale});
		const before = humanoidSpec({pose: POSTURES.includes(data.posture) ? data.posture : 'stand', height: 28.7 * scale});
		const pb = spec.bones.find(b => b.role == 'pelvis'), pa = before.bones.find(b => b.role == 'pelvis');
		if (pb && pa) dy = pb.pivot[1] - pa.pivot[1];
	}
	const rot_of = new Map(spec ? spec.bones.map(b => [b.name, bbOfThree(b.rot)]) : []);
	const up = v => v ? [v[0], v[1] + dy, v[2]] : v;
	Undo.initEdit({outliner: true, elements: [], groups: [], selection: true});
	const groups = [], elements = [], uuids = new Map();
	const make = (node, parent) => {
		const gd = Object.assign({}, node.group);
		gd.origin = up(gd.origin || [0, 0, 0]);
		if (spec && rot_of.has(gd.name) && node !== data.tree) gd.rotation = rot_of.get(gd.name);
		const g = new Group(gd);
		g.addTo(parent).init();
		for (const k of ['ragdoll', 'bone', 'physics', 'attach', 'render_particles', 'render_light']) if (gd[k] !== undefined) g[k] = gd[k];
		uuids.set(node.uuid, g.uuid);
		groups.push(g);
		for (const c of node.children) {
			if (c.group) { make(c, g); continue; }
			const d = c.element;
			const old = d.uuid;
			delete d.uuid;
			for (const f of Object.values(d.faces || {})) if (f && f.texture) f.texture = tex_map.get(f.texture) || false;
			if (d.from) d.from = up(d.from);
			if (d.to) d.to = up(d.to);
			if (d.origin) d.origin = up(d.origin);
			let el = null;
			try {
				el = typeof OutlinerElement != 'undefined' && OutlinerElement.fromSave ? OutlinerElement.fromSave(d) : (d.type == 'mesh' ? new Mesh(d) : new Cube(d));
			} catch (err) { console.warn('[Ragdoll] element', err); continue; }
			el.addTo(g).init();
			uuids.set(old, el.uuid);
			elements.push(el);
		}
	};
	make(data.tree, 'root');
	const root = groups[0];
	// what pointed at the old bones (poses, hits, the shot part) points at the new ones
	const remap = obj => {
		if (!obj || typeof obj != 'object') return obj;
		let s = JSON.stringify(obj);
		for (const [a, b] of uuids) s = s.split(a).join(b);
		return JSON.parse(s);
	};
	for (const g of groups) for (const k of ['ragdoll', 'bone', 'attach']) if (g[k]) g[k] = remap(g[k]);
	// the chair of a sitting person
	let chair = null;
	if (spec && spec.chair) {
		chair = new Group({name: spec.chair.name, origin: [0, 0, 0]});
		chair.addTo('root').init();
		chair.physics = {type: 'static', friction: 0.8, restitution: 0.05};
		groups.push(chair);
		const palette = npcPalette();
		for (const c of spec.chair.cubes) {
			const el = new Cube({name: 'chair', from: c.from, to: c.to, origin: [0, 1, 2].map(i => (c.from[i] + c.to[i]) / 2)});
			el.addTo(chair).init();
			if (palette) paintCube(el, 'chair', palette);
			elements.push(el);
		}
	}
	if (spec) {
		root.ragdoll = Object.assign(ragdollOf(root), {posture: pose});
		// the pose he is put in is his rest pose
		bonesOf(root).forEach(g => { g.bone = Object.assign(boneOf(g), {rest: g.rotation.slice()}); });
	}
	Undo.finishEdit('Add saved character', {outliner: true, elements, groups, selection: true});
	if (typeof Canvas != 'undefined') { Canvas.updateAllBones(); Canvas.updateAllPositions(); }
	root.select();
	return {root, chair};
}

// ---------------------------------------------------------------------------
// Blockbench side
// ---------------------------------------------------------------------------

const TEXTS = {
	en: {
		rec_time: 'Record (s)', rec_fps: 'Frames/s', rec_blood: 'Record the blood', rec_blood_tip: 'Bake the blood with the animation: in the Animate tab it lands, spreads and dries as the animation plays',
		spawn: 'Spawn ragdoll', click_shot: 'Click shot', click_shot_on: 'Click shot: click the character… (press again to cancel)', click_shot_msg: 'Click the character: a shot is made there, at the current time',
		msg_click_shot: 'Shot added', shots: 'Shots', add_shot2: 'Add shot', shot_name: 'Shot', shot_time2: 'Fires at (s)', shot_power: 'Power (N*s)',
		grab_tip: 'Edit this shot in the 3D view', grab_hint: 'Press ✥ on a shot: drag the orange ball (the gun) to move it - it keeps aiming at the same point; drag the yellow ball at the end of the line to aim it. It shoots along that line. Press ✥ again when done.',
		hands: 'In the hands', hands_hint: 'Select a thing (a group or cubes), then:', hand_r: 'Right hand', hand_l: 'Left hand', hand_both: 'Both hands', item_drop2: 'Dropped when he dies',
		skeleton: 'Pose', edit_skeleton: 'Edit skeleton', edit_skeleton_hint: 'W: drag a joint (the limb follows). R: click a joint, then turn that bone alone with the rotate handles. The pose is the model\'s pose (the Edit tab shows it) and the one he holds when it runs.',
		more: 'More settings', msg_spawn_first: 'Spawn a ragdoll first',
		mode: 'Ragdoll', build: 'Build ragdoll from the selected group', remove: 'Remove ragdoll', play: '▶ Start', pause: '❚❚ Pause', reset: '⟲ Reset', bake: '⏺ Bake to animation',
		select_hint: 'Select the group of a character (a group with bone groups inside: pelvis, torso, head, arms, legs…) and press Build.',
		character: 'Character', bones: 'bones', mass_total: 'Total mass (kg)', tone: 'Muscle tone', tone_tip: '0 = limp like a rag, 1 = stiff muscles hold the pose',
		power: 'Muscle power', flinch: 'Flinch', flinch_tip: 'How strongly the muscles around a hit tighten', radius: 'Flinch radius (px)',
		pin: 'Hips', pin_none: 'Free (falls at once)', pin_until: 'Held until a hard hit', pin_always: 'Always held',
		shot: 'Shot strength (N·s)', shot_tip: 'The strength of a click shot: a bullet 3–10, a punch 50–150', limp: 'Knock down at impulse', limp_tip: 'A hit this hard (N·s) switches the muscles off and the character falls. 0 = never', limp_time: 'Limp for (s)', limp_time_tip: '0 = until the end',
		bone: 'Selected bone', joint: 'Joint', j_ball: 'Ball (shoulder, hip, neck)', j_hinge: 'Hinge (elbow, knee)', j_fixed: 'Stiff',
		swing: 'Swing (°)', twist: 'Twist (±°)', axis: 'Hinge axis', hmin: 'Hinge from (°)', hmax: 'Hinge to (°)', strength: 'Muscle strength', zone: 'Zone',
		z_auto: 'Automatic', z_head: 'Head', z_torso: 'Torso', z_arms: 'Arms', z_legs: 'Legs', z_any: 'Any',
		follow: 'Animation, then physics', follow_anim: 'Plays', follow_none: '— nothing (physics at once) —', follow_release_at: 'Let go at (s, 0 = only when hit)', follow_bump: 'A hard bump lets go too', follow_bump_tip: 'Bumping into something solid (a wall, a car) ends the animation as a hit does',
		follow_hint: 'He plays the animation exactly until he is hit (a shot, a timed hit, a click shot), bumped or the moment comes; then he is a ragdoll: he falls, and the person of the Blood project gets up again.',
		route: 'Route', route_add: '+ Route (walks along a curve)', route_npc_only: 'Only the person of the Blood project (NPC) can walk: tick "Alive (NPC)" for the character', route_pts: 'points', route_point_add: '+ Point',
		route_speed: 'Speed (m/s)', route_speed_tip: '1.3 a walk, 2.5 a jog, 4 a run', route_start: 'Sets off at (s)', route_mode: 'At the end', rm_once: 'Stops', rm_loop: 'Goes round (closed loop)', rm_pingpong: 'Turns back',
		route_hint: 'The points are empty groups: move them with the Move tool (click a green ball to pick it). Shoot him anywhere on the way; knocked down he stops, back up he walks on.',
		kill_at: 'Dies at (s, 0 = no)', kill_at_tip: 'He dies at this moment of the simulation wherever he is', kill_kind: 'How', kk_heart: 'Collapses (heart)', kk_head: 'Drops dead (head shot)', kk_faint: 'Faints',
		route_name: 'Route', route_point: 'Point', msg_select_char: 'Select a character first',
		model: 'Model', model_npc: 'Blood NPC (from the Godot project)', model_mannequin: 'Plain mannequin',
		save_model: 'Save this ragdoll as a model', save_model_tip: 'The selected character (skeleton, joints, muscles, settings and its model: cubes, meshes, textures) goes into this list and can be added again in any project. Put your own model on the skeleton and save it: only the model changes, the pose and the rest work as before.',
		save_model_name: 'Name of the model', delete_model: 'Delete the saved model', delete_model_q: 'Delete the saved model "%"?', cancel: 'Cancel', pose_saved: 'As saved',
		msg_save_none: 'Select a character first', msg_saved_model: 'Saved: %', msg_save_big: 'The model is too big to keep (the storage is full); it is kept until Blockbench closes', msg_save_gone: 'This saved model is gone',
		living: 'Living body', npc: 'NPC: balance, health, falls, death', npc_tip: 'Blood, pain and shock; legs give way; it stumbles and falls, faints, dies. Hips are free (no pin).',
		head_kills: 'A head shot kills', balance: 'Balance', balance_tip: 'How strongly it keeps its feet. 0 = it falls at once', spasm: 'Arm spasm', spasm_tip: 'How hard the arms draw in to the head after a head shot. 0 = they just go limp, 1 = as in the game', bleed: 'Bleeding ×', bleed_tip: 'How fast blood is lost',
		blood: 'Blood', blood_high: 'High (every drop physical)', blood_high_tip: 'Every drop of blood flies on its own with physics and leaves its own stain where it lands: nothing is thinned out or skipped, a head shot is real drops too. Slower, much more blood on the walls.', blood_amount: 'Amount ×', blood_note: 'Blood is shown while the simulation plays (not baked into the animation).',
		add_character: 'Add a character', pose: 'Pose', pose_stand: 'Standing, relaxed', pose_sit: 'Sitting on a chair', pose_kneel: 'Kneeling', pose_squat: 'Squatting', pose_crouch: 'Crouching', pose_hands_up: 'Hands up', pose_cover_head: 'Covering the head', pose_aim: 'Aiming',
		npc_game: 'The person of the Blood game: its body, muscles, balance, wounds and blood, as in the game. A pistol in the game hits with 2-6 N*s.', weapon: 'Weapon', w_pistol: 'Pistol', w_revolver: 'Revolver', w_rifle: 'Rifle', w_akm: 'AKM', w_shotgun: 'Shotgun (pellet)', height: 'Height (px)', add_character_btn: 'Add the default character',
		auto_bones: 'Place bones automatically on the selected model', auto_bones_hint: 'Select the cubes (or the group) of a standing person: they are sorted into head, spine, arms and legs, the joints are put in and the ragdoll is built.',
		auto_react: 'Every part of the body reacts by itself', react_scale: 'Reaction strength', facing: 'The character looks toward', facing_north: 'North (−Z, the front in Blockbench)', facing_south: 'South (+Z)',
		shot_box: 'Shot', shot_at: 'Hits the part', shot_auto: 'Chest', shot_from: 'The shot comes from (the orange arrow in 3D)', d_front: 'Front', d_right: 'Right', d_back: 'Back', d_left: 'Left',
		shot_yaw: 'Around (°)', shot_pitch: 'Above (°)', fire: '🎯 Fire now (while playing)', add_shot: '➕ Put the shot on the timeline',
		msg_char: 'Character added: press Play, then shoot it', msg_auto: 'Bones placed: % body parts', msg_auto_few: 'Select at least 6 cubes of a standing person (or their group)',
		skeleton: 'Skeleton pose', skeleton_hint: 'Drag the orange points in the 3D view: the parts follow and stay joined. Hand and foot points move the whole arm or leg (the elbow or knee bends), the others turn the bone.', skeleton_edit: 'Edit the skeleton in 3D', skeleton_on: 'Editing: drag the orange points',
		pose_save: 'Save this pose', pose_rest_back: 'Back to the rest pose', pose_apply: 'Put the character in it', pose_as_rest: 'Make it the rest pose',
		items: 'Held items', items_hint: 'Select a weapon or a tool (a group, or its cubes), choose the part of the body and press Attach: it is held there. After a knock down it is dropped, if Drop is on.', item_bone: 'Held by', item_drop: 'Drop it when knocked down', item_mass: 'Mass (kg)', item_attach: 'Attach the selected object', item_drops: 'drops',
		msg_item_bone: 'Choose the part of the body first', msg_item_select: 'Select the item first (a group or its cubes, not a part of the character)', msg_item_done: 'Item attached', msg_pose_saved: 'Pose saved',
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
		rec_time: 'Запись (с)', rec_fps: 'Кадров/с', rec_blood: 'Записывать кровь', rec_blood_tip: 'Кровь запекается вместе с анимацией: во вкладке Animate она падает, растекается и сохнет по ходу анимации',
		spawn: 'Спавн регдолла', click_shot: 'Click shot', click_shot_on: 'Click shot: кликните по персонажу… (ещё раз — отмена)', click_shot_msg: 'Кликните по персонажу: туда будет выстрел, в текущий момент времени',
		msg_click_shot: 'Выстрел добавлен', shots: 'Выстрелы', add_shot2: 'Добавить выстрел', shot_name: 'Выстрел', shot_time2: 'Через (с)', shot_power: 'Сила (Н·с)',
		grab_tip: 'Редактировать этот выстрел в окне 3D', grab_hint: 'Нажмите ✥ у выстрела: оранжевый шар (пистолет) — тащите, чтобы передвинуть, он продолжает целиться в ту же точку; жёлтый шар в конце линии — тащите, чтобы прицелиться. Выстрел идёт ровно по этой линии. Ещё раз ✥ — готово.',
		hands: 'В руках', hands_hint: 'Выделите предмет (группу или кубы), затем:', hand_r: 'Правая рука', hand_l: 'Левая рука', hand_both: 'Обе руки', item_drop2: 'Выпадает при смерти',
		skeleton: 'Поза', edit_skeleton: 'Редактировать скелет', edit_skeleton_hint: 'W — тянуть сустав (конечность идёт следом). R — клик по суставу, затем вращайте эту кость отдельно рукоятками поворота. Поза сохраняется в модели (видна во вкладке Edit) и её персонаж держит при запуске.',
		more: 'Дополнительные настройки', msg_spawn_first: 'Сначала заспавните регдолл',
		mode: 'Регдолл', build: 'Создать регдолл из выбранной группы', remove: 'Убрать регдолл', play: '▶ Старт', pause: '❚❚ Пауза', reset: '⟲ Сброс', bake: '⏺ Запечь в анимацию',
		select_hint: 'Выделите группу персонажа (группа с костями-группами внутри: таз, торс, голова, руки, ноги…) и нажмите «Создать».',
		character: 'Персонаж', bones: 'костей', mass_total: 'Общая масса (кг)', tone: 'Тонус мышц', tone_tip: '0 = обмякший как тряпка, 1 = жёсткие мышцы держат позу',
		power: 'Сила мышц', flinch: 'Сокращение', flinch_tip: 'Насколько сильно напрягаются мышцы вокруг попадания', radius: 'Радиус сокращения (px)',
		pin: 'Таз', pin_none: 'Свободный (падает сразу)', pin_until: 'Держится до сильного удара', pin_always: 'Держится всегда',
		shot: 'Сила выстрела (Н·с)', shot_tip: 'Сила выстрела кликом: пуля 3–10, удар кулаком 50–150', limp: 'Сбить с ног при импульсе', limp_tip: 'Такой сильный удар (Н·с) выключает мышцы, и персонаж падает. 0 = никогда', limp_time: 'Обмякает на (с)', limp_time_tip: '0 = до конца',
		bone: 'Выбранная кость', joint: 'Сустав', j_ball: 'Шаровой (плечо, бедро, шея)', j_hinge: 'Шарнир (локоть, колено)', j_fixed: 'Жёсткий',
		swing: 'Отклонение (°)', twist: 'Кручение (±°)', axis: 'Ось шарнира', hmin: 'Шарнир от (°)', hmax: 'Шарнир до (°)', strength: 'Сила мышцы', zone: 'Зона',
		z_auto: 'Автоматически', z_head: 'Голова', z_torso: 'Торс', z_arms: 'Руки', z_legs: 'Ноги', z_any: 'Любая',
		follow: 'Анимация, потом физика', follow_anim: 'Проигрывает', follow_none: '— ничего (сразу физика) —', follow_release_at: 'Отпустить в (с, 0 — только при попадании)', follow_bump: 'Сильный толчок тоже отпускает', follow_bump_tip: 'Удар о твёрдое (стену, машину) заканчивает анимацию так же, как попадание',
		follow_hint: 'Он точно проигрывает анимацию, пока в него не попадут (выстрел, удар по времени, выстрел кликом), не толкнут или не наступит заданный момент; дальше он регдолл: падает, а человек из Blood потом встаёт.',
		route: 'Маршрут', route_add: '+ Маршрут (идёт по кривой)', route_npc_only: 'Ходить умеет только человек из Blood (NPC): включите у персонажа «Живой (NPC)»', route_pts: 'точек', route_point_add: '+ Точка',
		route_speed: 'Скорость (м/с)', route_speed_tip: '1.3 — шаг, 2.5 — трусца, 4 — бег', route_start: 'Выходит в (с)', route_mode: 'В конце', rm_once: 'Останавливается', rm_loop: 'Идёт по кругу (замкнутый)', rm_pingpong: 'Поворачивает обратно',
		route_hint: 'Точки — пустые группы: двигайте их «Перемещением» (клик по зелёному шару выбирает точку). Стреляйте в него в любой момент пути; сбитый — останавливается, поднявшись — идёт дальше.',
		kill_at: 'Умирает в (с, 0 — нет)', kill_at_tip: 'В этот момент симуляции он умирает, где бы ни был', kill_kind: 'Как', kk_heart: 'Оседает (сердце)', kk_head: 'Падает замертво (в голову)', kk_faint: 'Теряет сознание',
		route_name: 'Маршрут', route_point: 'Точка', msg_select_char: 'Сначала выделите персонажа',
		model: 'Модель', model_npc: 'NPC из Blood (Godot-проект)', model_mannequin: 'Простой манекен',
		save_model: 'Сохранить этот регдолл как модель', save_model_tip: 'Выбранный персонаж (скелет, суставы, мышцы, настройки и его модель: кубы, меши, текстуры) попадает в этот список, и его можно добавить снова в любом проекте. Наденьте на скелет свою модель и сохраните: меняется только модель, поза и всё остальное работают как раньше.',
		save_model_name: 'Имя модели', delete_model: 'Удалить сохранённую модель', delete_model_q: 'Удалить сохранённую модель «%»?', cancel: 'Отмена', pose_saved: 'Как сохранён',
		msg_save_none: 'Сначала выделите персонажа', msg_saved_model: 'Сохранено: %', msg_save_big: 'Модель слишком большая для хранилища; она сохранена до закрытия Blockbench', msg_save_gone: 'Эта сохранённая модель удалена',
		living: 'Живое тело', npc: 'NPC: баланс, здоровье, падение, смерть', npc_tip: 'Кровь, боль и шок; ноги подкашиваются; персонаж шатается и падает, теряет сознание, умирает. Таз свободный (без фиксации).',
		head_kills: 'Выстрел в голову убивает', balance: 'Баланс', balance_tip: 'Насколько крепко держится на ногах. 0 — падает сразу', spasm: 'Сжатие рук', spasm_tip: 'Насколько сильно руки поджимаются к голове после выстрела в голову. 0 — просто обмякают, 1 — как в игре', bleed: 'Кровотечение ×', bleed_tip: 'Как быстро теряется кровь',
		blood: 'Кровь', blood_high: 'High (каждая капля физическая)', blood_high_tip: 'Каждая капля крови летит сама по физике и оставляет своё пятно там, куда упала: ничего не прореживается и не пропускается, выстрел в голову — тоже настоящие капли. Медленнее, крови на стенах намного больше.', blood_amount: 'Количество ×', blood_note: 'Кровь видна, пока идёт симуляция (в запечённую анимацию не попадает).',
		add_character: 'Добавить персонажа', pose: 'Поза', pose_stand: 'Стоит, расслабленно', pose_sit: 'Сидит на стуле', pose_kneel: 'На коленях', pose_squat: 'На корточках', pose_crouch: 'Пригнулся', pose_hands_up: 'Руки вверх', pose_cover_head: 'Закрывает голову', pose_aim: 'Целится',
		npc_game: 'Человек из игры Blood: тело, мышцы, баланс, ранения и кровь — как в игре. Пистолет в игре бьёт с силой 2–6 Н·с.', weapon: 'Оружие', w_pistol: 'Пистолет', w_revolver: 'Револьвер', w_rifle: 'Винтовка', w_akm: 'АКМ', w_shotgun: 'Дробовик (дробина)', height: 'Рост (px)', add_character_btn: 'Добавить персонажа по умолчанию',
		auto_bones: 'Расставить кости автоматически на выбранной модели', auto_bones_hint: 'Выделите кубы (или группу) стоящего человека: они разложатся по голове, позвоночнику, рукам и ногам, суставы встанут на места и регдолл будет создан.',
		auto_react: 'Каждая часть тела реагирует по-своему', react_scale: 'Сила реакции', facing: 'Персонаж смотрит на', facing_north: 'Север (−Z, перед в Blockbench)', facing_south: 'Юг (+Z)',
		shot_box: 'Выстрел', shot_at: 'Попадает в часть', shot_auto: 'Грудь', shot_from: 'Откуда летит выстрел (оранжевая стрелка в 3D)', d_front: 'Спереди', d_right: 'Справа', d_back: 'Сзади', d_left: 'Слева',
		shot_yaw: 'Вокруг (°)', shot_pitch: 'Сверху (°)', fire: '🎯 Выстрелить сейчас (во время Пуска)', add_shot: '➕ Поставить выстрел на время',
		msg_char: 'Персонаж добавлен: нажмите Пуск и стреляйте', msg_auto: 'Кости расставлены: частей тела — %', msg_auto_few: 'Выделите минимум 6 кубов стоящего человека (или его группу)',
		skeleton: 'Поза по скелету', skeleton_hint: 'Тяните оранжевые точки в 3D: части тела следуют и остаются соединёнными. Точки кисти и стопы двигают всю руку или ногу (локоть или колено сгибаются), остальные поворачивают кость.', skeleton_edit: 'Править скелет в 3D', skeleton_on: 'Правка: тяните оранжевые точки',
		pose_save: 'Сохранить эту позу', pose_rest_back: 'Вернуть исходную позу', pose_apply: 'Поставить персонажа в неё', pose_as_rest: 'Сделать исходной позой',
		items: 'Предметы в руках', items_hint: 'Выделите оружие или инструмент (группу или её кубы), выберите часть тела и нажмите «Привязать»: предмет держится там. После сбития с ног он выпадает, если включено «Выпадает».', item_bone: 'Держит', item_drop: 'Выпадает при сбитии с ног', item_mass: 'Масса (кг)', item_attach: 'Привязать выбранный объект', item_drops: 'выпадает',
		msg_item_bone: 'Сначала выберите часть тела', msg_item_select: 'Сначала выделите предмет (группу или её кубы, не часть персонажа)', msg_item_done: 'Предмет привязан', msg_pose_saved: 'Поза сохранена',
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
const tool_patches = [];
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

// ---------------------------------------------------------------------------
// Routes: a person of the Blood project walks along a curve through points (empty groups, moved with the Move tool).
// He can be shot (or killed at a set moment) anywhere on the way; knocked down he stops, back on his feet he goes on.
// ---------------------------------------------------------------------------

const isRoute = g => g instanceof Group && !!g.ragdoll_route && typeof g.ragdoll_route == 'object' && g.ragdoll_route.kind == 'route';
const routePoints = route => (route.children || []).filter(c => c instanceof Group);
const routeOfRoot = root => { const id = ragdollOf(root).route; return id ? Group.all.find(g => g.uuid == id && isRoute(g)) || null : null; };
const worldOf = g => { g.mesh.updateMatrixWorld(true); return g.mesh.getWorldPosition(new THREE.Vector3()); };

// a new route in front of the character, a few metres long
function addRoute(root) {
	if (!root) { Blockbench.showQuickMessage(tr('msg_select_char'), 2500); return null; }
	const pelvis = bonesOf(root).find(g => roleOf(g) == 'pelvis');
	const base = pelvis ? new THREE.Vector3(pelvis.origin[0], 0, pelvis.origin[2]) : new THREE.Vector3();
	const fwd = new THREE.Vector3(0, 0, ragdollOf(root).facing == 'south' ? 1 : -1);
	const side = new THREE.Vector3(1, 0, 0);
	Undo.initEdit({outliner: true, groups: [], selection: true});
	const route = new Group({name: tr('route_name'), origin: base.toArray().map(v => Math.round(v * 100) / 100), color: 3}).init();
	route.ragdoll_route = {kind: 'route'};
	route.addTo('root');
	const groups = [route];
	const shape = [[0, 0], [2.5, 0.6], [5, -0.8], [7.5, 0]];
	shape.forEach(([f, s], i) => {
		const p = base.clone().addScaledVector(fwd, f * SCALE).addScaledVector(side, s * SCALE);
		const g = new Group({name: tr('route_point') + ' ' + (i + 1), origin: p.toArray().map(v => Math.round(v * 100) / 100), color: 3}).init();
		g.addTo(route);
		groups.push(g);
	});
	Undo.finishEdit('Add route', {outliner: true, groups, selection: true});
	edit([root], 'Assign route', () => { root.ragdoll = Object.assign(ragdollOf(root), {route: route.uuid}); });
	syncRouteView(true);
	return route;
}
function addRoutePoint(route) {
	if (!route) return;
	const pts = routePoints(route);
	const last = pts[pts.length - 1], before = pts[pts.length - 2];
	const p = last ? new THREE.Vector3(...last.origin) : new THREE.Vector3(...route.origin);
	const step = last && before ? p.clone().sub(new THREE.Vector3(...before.origin)) : new THREE.Vector3(0, 0, -2 * SCALE);
	Undo.initEdit({outliner: true, groups: [], selection: true});
	const g = new Group({name: tr('route_point') + ' ' + (pts.length + 1), origin: p.add(step).toArray().map(v => Math.round(v * 100) / 100), color: 3}).init();
	g.addTo(route);
	g.select();
	Undo.finishEdit('Add route point', {outliner: true, groups: [g], selection: true});
	syncRouteView(true);
}

// the curve in the viewport, with a ball at every point (a click on a ball selects that point)
let route_view = null;
function removeRouteView() { if (route_view && route_view.group.parent) route_view.group.parent.remove(route_view.group); route_view = null; }
function syncRouteView(rebuild) {
	if (!Project) { removeRouteView(); return; }
	const routes = Group.all.filter(g => isRoute(g) && g.visibility !== false && g.mesh);
	const key = routes.map(r => r.uuid + ':' + r.ragdoll_route.mode + ':' + routePoints(r).map(p => p.uuid + (p.selected ? '*' : '') + p.origin.join(',') + (p.mesh ? worldOf(p).toArray().map(v => v.toFixed(2)).join(',') : '')).join(';')).join('|');
	if (route_view && route_view.key == key && !rebuild) return;
	removeRouteView();
	if (!routes.length) return;
	const group = new THREE.Group();
	group.name = 'ragdoll_routes';
	const balls = [];
	for (const r of routes) {
		const pts = routePoints(r).filter(p => p.mesh).map(p => ({g: p, w: worldOf(p)}));
		if (pts.length >= 2) {
			const users = Group.all.filter(g => g.ragdoll && ragdollOf(g).route == r.uuid);
			const closed = users.some(u => ragdollOf(u).route_mode == 'loop') && pts.length > 2;
			const curve = new THREE.CatmullRomCurve3(pts.map(p => p.w), closed, 'centripetal');
			const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getSpacedPoints(Math.max(32, pts.length * 24))), new THREE.LineBasicMaterial({color: 0x57d18f, depthTest: false, transparent: true}));
			line.renderOrder = 997;
			group.add(line);
		}
		pts.forEach(p => {
			const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({color: p.g.selected ? 0xffffff : 0x57d18f, depthTest: false, transparent: true}));
			m.position.copy(p.w);
			m.renderOrder = 998;
			m.userData.point = p.g.uuid;
			group.add(m);
			balls.push(m);
		});
	}
	scene.add(group);
	route_view = {group, balls, key};
}
function onRoutePress(event) {
	if (!route_view || event.button !== 0 || !Project) return;
	const preview = previewOf(event);
	if (!preview) return;
	let best = null, best_d = 14;
	for (const b of route_view.balls) {
		const s = screenPoint(b.position, preview), d = Math.hypot(s.x - event.clientX, s.y - event.clientY);
		if (s.z < 1 && d < best_d) { best_d = d; best = b; }
	}
	if (!best) return;
	const g = Group.all.find(x => x.uuid == best.userData.point);
	if (!g || g.selected) return;   // a selected point is left to the Move tool's handles
	event.stopImmediatePropagation(); event.preventDefault();
	g.select(event);
	syncRouteView(true);
}

// what the runtime needs: the points in the world (metres) and how to walk them
function routeFor(root) {
	const route = routeOfRoot(root), s = ragdollOf(root);
	if (!route) return null;
	const points = routePoints(route).filter(p => p.mesh).map(p => worldOf(p).divideScalar(SCALE).toArray());
	if (points.length < 2) return null;
	return {points, speed: Math.max(0, num(s.route_speed, 1.3)), mode: s.route_mode || 'once', start: Math.max(0, num(s.route_start, 0)), kill_at: Math.max(0, num(s.kill_at, 0)), kill_kind: s.kill_kind || 'heart'};
}

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
			Object.assign(vue, {total_mass: s.total_mass, tone: s.tone, power: s.power, flinch: s.flinch, radius: s.radius, pin: s.pin, limp: s.limp, limp_time: s.limp_time, shot: s.shot, auto_react: s.auto_react, react_scale: s.react_scale, facing: s.facing, shot_part: s.shot_part, shot_yaw: s.shot_yaw, shot_pitch: s.shot_pitch, shot_time: s.shot_time, npc: s.npc, posture: s.posture || 'stand', weapon: s.weapon || 'pistol', is_human: hasHumanoidParts(bonesOf(root)), blood: s.blood, blood_high: !!s.blood_high, blood_amount: s.blood_amount, bleed: s.bleed, head_kills: s.head_kills, balance: s.balance, spasm: s.spasm ?? 0.5,
				bone_list: bonesOf(root).map(g => ({uuid: g.uuid, name: g.name})), poses: s.poses.map(p => ({name: p.name})), items: itemsOf(root).map(n => ({uuid: n.uuid, name: n.name, bone_name: ((bonesOf(root).find(g => g.uuid == n.attach.bone)) || {}).name || '?', drop: n.attach.drop !== false})),
				root_name: root.name, bone_count: bonesOf(root).length, hits: s.hits.map(h => Object.assign({}, h)), reactions: s.reactions.map(r => Object.assign({name: '', zone: 'any', hold: 0.8, tension: 1}, r, {pose_count: Object.keys(r.pose || {}).length}))});
			vue.is_bone = !!(sel && sel.bone && sel.bone.joint);
			if (vue.is_bone) Object.assign(vue, {joint: boneOf(sel).joint, swing: boneOf(sel).swing, twist: boneOf(sel).twist, hinge_axis: boneOf(sel).hinge_axis, hmin: boneOf(sel).hmin,
				hmax: boneOf(sel).hmax, strength: boneOf(sel).strength, zone: boneOf(sel).zone});
		}
	}
	// the simple controls: the character, its shots, what it holds
	const act = activeRoot();
	vue.char_name = act ? act.name : '';
	vue.click_shot = click_shot;
	if (act) {
		const sel_g = Group.first_selected;
		const shots = shotsOf(act).map(g => ({uuid: g.uuid, name: g.name, t: g.ragdoll_shot.t, impulse: g.ragdoll_shot.impulse, selected: shot_edit == g.uuid}));
		void sel_g;
		const key2 = JSON.stringify(shots) + '|' + act.uuid;
		if (force || vue.shots_key != key2) { vue.shots_key = key2; vue.shots = shots; }
		const bones = bonesOf(act);
		vue.held = itemsOf(act).map(n => ({uuid: n.uuid, name: n.name, drop: n.attach.drop !== false,
			where: n.attach.hands == 'both' ? tr('hand_both') : ((bones.find(g => g.uuid == n.attach.bone) || {}).name || '?')}));
		vue.char_blood = ragdollOf(act).blood !== false;
		vue.char_blood_high = !!ragdollOf(act).blood_high;
		const rs = ragdollOf(act), route = routeOfRoot(act);
		const anims = (typeof Animation != 'undefined' && Animation.all || []).map(a => ({uuid: a.uuid, name: a.name}));
		if (JSON.stringify(anims) != JSON.stringify(vue.anim_list)) vue.anim_list = anims;
		if (force || vue.follow_key != JSON.stringify([rs.follow_anim, rs.follow_release_at, rs.follow_bump])) {
			vue.follow_key = JSON.stringify([rs.follow_anim, rs.follow_release_at, rs.follow_bump]);
			Object.assign(vue, {follow_anim: rs.follow_anim || '', follow_release_at: rs.follow_release_at || 0, follow_bump: rs.follow_bump !== false});
		}
		vue.char_npc = !!rs.npc && hasHumanoidParts(bonesOf(act));
		vue.route_name = route ? route.name : '';
		vue.route_points = route ? routePoints(route).length : 0;
		if (force || vue.route_key != JSON.stringify([rs.route, rs.route_speed, rs.route_mode, rs.route_start, rs.kill_at, rs.kill_kind])) {
			vue.route_key = JSON.stringify([rs.route, rs.route_speed, rs.route_mode, rs.route_start, rs.kill_at, rs.kill_kind]);
			Object.assign(vue, {route_speed: rs.route_speed, route_mode: rs.route_mode, route_start: rs.route_start, kill_at: rs.kill_at, kill_kind: rs.kill_kind});
		}
		vue.char_rec_blood = ragdollOf(act).record_blood !== false;
	}
	if (Project) { const w = Project.physics_world || {}; vue.rec_time = w.duration || 3; vue.rec_fps = w.fps || 24; }
	const sim = simNow();
	vue.state = !sim ? 'stopped' : sim.playing ? 'playing' : 'paused';
	vue.shoot = shoot_mode;
	vue.pose_edit = pose_edit;
	vue.sim_time = sim ? sim.time.toFixed(2) : '0.00';
}

function panelComponent() {
	const num = (label, model, min, max, step, decimals, tip, action) => `<rope-num :label="t('${label}')" v-model="${model}" :min="${min}" :max="${max}" :step="${step}" :decimals="${decimals}" ${tip ? `:title="t('${tip}')"` : ''} @change="${action}"></rope-num>`;
	return {
		components: {'rope-num': NumberField},
		data() {
			return {selection_key: null, rec_time: 3, rec_fps: 24, char_rec_blood: true, char_blood_high: false, click_shot: false, char_name: '', char_blood: true, shots: [], held: [], has_selection: false, has_root: false, is_bone: false, sel_name: '', root_name: '', bone_count: 0, state: 'stopped', shoot: false, sim_time: '0.00',
				total_mass: 70, tone: 0.6, power: 1, flinch: 0.7, radius: 32, pin: 'until_limp', limp: 0, limp_time: 0, shot: 40, auto_react: true, react_scale: 1, facing: 'north', shot_part: 'auto', shot_yaw: 0, shot_pitch: 8, shot_time: 0.5, bone_list: [], poses: [], items: [], pose_edit: false, pose_name: 'My pose', item_bone: '', item_drop: true, item_mass: 1, new_pose: 'stand', new_model: 'npc', new_height: 28.6, follow_anim: '', follow_release_at: 0, follow_bump: true, anim_list: [], route_name: '', route_points: 0, route_speed: 1.3, route_mode: 'once', route_start: 0, kill_at: 0, kill_kind: 'heart', char_npc: false, saved_models: savedModels().map(m => ({id: m.id, name: m.name})), npc: false, posture: 'stand', weapon: 'pistol', is_human: false, blood: false, blood_high: false, blood_amount: 1, bleed: 1, head_kills: true, balance: 1, spasm: 0.5,
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
						flinch: clamp(num_(this.flinch, 0.7), 0, 1), radius: clamp(num_(this.radius, 32), 0, 400), pin: this.pin, limp: Math.max(0, num_(this.limp, 0)), limp_time: Math.max(0, num_(this.limp_time, 0)), shot: clamp(num_(this.shot, 40), 1, 2000), auto_react: !!this.auto_react, react_scale: clamp(num_(this.react_scale, 1), 0, 3), facing: this.facing,
						shot_part: this.shot_part, shot_yaw: clamp(num_(this.shot_yaw, 0), -360, 360), shot_pitch: clamp(num_(this.shot_pitch, 8), -85, 85), shot_time: Math.max(0, num_(this.shot_time, 0.5)),
						npc: !!this.npc, posture: this.posture, weapon: this.weapon, blood: !!this.blood, blood_high: !!this.blood_high, blood_amount: clamp(num_(this.blood_amount, 1), 0, 5), bleed: clamp(num_(this.bleed, 1), 0, 20), head_kills: !!this.head_kills, balance: clamp(num_(this.balance, 1), 0, 2), spasm: clamp(num_(this.spasm, 0.5), 0, 1)});
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
			toggleEdit() { pose_edit = !pose_edit; if (pose_edit) { shoot_mode = false; click_shot = false; shot_edit = null; syncShotLines(); } syncSkeletonView(true); updatePanel(true); },
			savePoseNow() { savePose(this.pose_name); },
			usePose(i, rest) { applyPose(i, rest); },
			removePose(i) { deletePose(i); },
			toRest() { backToRest(); },
			attach() {
				const sel = Group.first_selected, root = sel && rootOf(sel);
				if (!root) return;
				attachItem(root, this.item_bone || (this.bone_list[0] && this.bone_list[0].uuid), this.item_drop, num_(this.item_mass, 1));
			},
			detach(uuid) { detachItem(uuid); },
			addCharacter() { addCharacter(this.new_pose, num_(this.new_height, 28.6), this.new_model); },
			spawn() { addCharacter(this.new_pose, 28.6, this.new_model || 'npc'); },
			isSaved() { return String(this.new_model).startsWith('saved:'); },
			modelChanged() { if (this.isSaved()) this.new_pose = 'saved'; else if (this.new_pose == 'saved') this.new_pose = 'stand'; },
			loadSaved() { this.saved_models = savedModels().map(m => ({id: m.id, name: m.name})); },
			saveModel() {
				const root = activeRoot();
				if (!root) { Blockbench.showQuickMessage(tr('msg_save_none'), 2500); return; }
				const done = name => {
					if (name === null || name === undefined) return;
					const entry = saveCharacterModel(root, String(name).trim() || root.name);
					this.loadSaved();
					if (entry) { this.new_model = 'saved:' + entry.id; this.new_pose = 'saved'; }
				};
				if (Blockbench.textPrompt) Blockbench.textPrompt(tr('save_model_name'), root.name, done);
				else done(root.name);
			},
			deleteModel() {
				if (!this.isSaved()) return;
				const id = this.new_model.slice(6), m = savedModels().find(x => x.id == id);
				const go = () => { deleteSavedModel(id); this.new_model = 'npc'; this.new_pose = 'stand'; this.loadSaved(); };
				if (Blockbench.showMessageBox) Blockbench.showMessageBox({title: tr('delete_model'), message: tr('delete_model_q').replace('%', m ? m.name : ''), buttons: [tr('delete_model'), tr('cancel')], confirm: 0, cancel: 1}, b => { if (b === 0) go(); });
				else go();
			},
			toggleClickShot() {
				click_shot = !click_shot;
				// a shot that was being moved is let go
				if (click_shot) { pose_edit = false; shot_edit = null; syncShotLines(); syncSkeletonView(); Blockbench.showQuickMessage(tr('click_shot_msg'), 2500); }
				updatePanel(true);
			},
			addShot2() { const g = addShotFor(activeRoot()); if (g) { shot_edit = g.uuid; pose_edit = false; click_shot = false; syncSkeletonView(); syncShotLines(); updatePanel(true); } },
			grabShot(uuid) {
				const g = Group.all.find(x => x.uuid == uuid);
				if (!g) return;
				click_shot = false; pose_edit = false; syncSkeletonView();
				// (pressed again: done)
				shot_edit = shot_edit == uuid ? null : uuid;
				syncShotLines();
				updatePanel(true);
			},
			deleteShot(uuid) {
				const g = Group.all.find(x => x.uuid == uuid);
				if (!g) return;
				Undo.initEdit({outliner: true, elements: g.children.slice(), groups: [g]});
				g.remove();
				Undo.finishEdit('Delete shot', {outliner: true, elements: [], groups: []});
				updatePanel(true);
			},
			saveShot(sh) {
				const g = Group.all.find(x => x.uuid == sh.uuid);
				if (!g) return;
				edit([g], 'Change shot', () => { g.ragdoll_shot = Object.assign({}, g.ragdoll_shot, {t: Math.max(0, num_(sh.t, 0.5)), impulse: Math.max(0.1, num_(sh.impulse, 4))}); });
			},
			hand(side) { toHand(activeRoot(), side, this.item_drop, 1); },
			saveFollow() {
				const r = activeRoot();
				if (!r) return;
				edit([r], 'Follow animation', () => { r.ragdoll = Object.assign(ragdollOf(r), {follow_anim: this.follow_anim, follow_release_at: Math.max(0, num_(this.follow_release_at, 0)), follow_bump: !!this.follow_bump}); });
			},
			newRoute() { addRoute(activeRoot()); updatePanel(true); },
			addPoint() { const r = activeRoot(); addRoutePoint(r && routeOfRoot(r)); updatePanel(true); },
			dropRoute() { const r = activeRoot(); if (!r) return; edit([r], 'Remove route', () => { r.ragdoll = Object.assign(ragdollOf(r), {route: ''}); }); syncRouteView(true); updatePanel(true); },
			saveRoute() {
				const r = activeRoot();
				if (!r) return;
				edit([r], 'Change route', () => {
					r.ragdoll = Object.assign(ragdollOf(r), {route_speed: clamp(num_(this.route_speed, 1.3), 0, 8), route_mode: this.route_mode, route_start: Math.max(0, num_(this.route_start, 0)), kill_at: Math.max(0, num_(this.kill_at, 0)), kill_kind: this.kill_kind});
				});
				syncRouteView(true);
			},
			saveBlood() { const root = activeRoot(); if (!root) return; edit([root], 'Blood', () => { root.ragdoll = Object.assign(ragdollOf(root), {blood: !!this.char_blood, record_blood: !!this.char_rec_blood, blood_high: !!this.char_blood_high}); }); },
			// how long the bake records, and how many frames a second (the Physics tab's world settings)
			saveRecTime() {
				if (!Project) return;
				Project.physics_world = Object.assign({}, Project.physics_world || {}, {duration: clamp(num_(this.rec_time, 3), 0.1, 600), fps: Math.max(1, Math.round(num_(this.rec_fps, 24)))});
				Project.saved = false;
			},
			autoBones() { autoBonesFromSelection(); },
			setYaw(v) { this.shot_yaw = v; this.saveRoot(); },
			fire() { fireShot(false); },
			addShot() { fireShot(true); },
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

				<div class="rd_box rd_simple">
					<div class="rd_row">
						<button class="rd_big" @click="spawn()">{{ t('spawn') }}</button>
						<select v-model="new_pose" :title="t('pose')"><option v-if="isSaved()" value="saved">{{ t('pose_saved') }}</option><option value="stand">{{ t('pose_stand') }}</option><option value="sit">{{ t('pose_sit') }}</option><option value="kneel">{{ t('pose_kneel') }}</option><option value="squat">{{ t('pose_squat') }}</option><option value="crouch">{{ t('pose_crouch') }}</option><option value="hands_up">{{ t('pose_hands_up') }}</option><option value="cover_head">{{ t('pose_cover_head') }}</option><option value="aim">{{ t('pose_aim') }}</option></select>
					</div>
					<label class="rd_row">{{ t('model') }} <select v-model="new_model" @change="modelChanged()" :title="t('model')"><option value="npc">{{ t('model_npc') }}</option><option value="mannequin">{{ t('model_mannequin') }}</option><option v-for="m in saved_models" :value="'saved:' + m.id">{{ m.name }}</option></select></label>
					<div class="rd_row"><button class="rd_full" @click="saveModel()" :title="t('save_model_tip')">+ {{ t('save_model') }}</button><button v-if="isSaved()" class="rd_x" @click="deleteModel()" :title="t('delete_model')">✕</button></div>
					<div class="rd_grid">
						<rope-num :label="t('rec_time')" v-model="rec_time" :min="0.5" :max="120" :step="0.5" :decimals="1" @change="saveRecTime()"></rope-num>
						<rope-num :label="t('rec_fps')" v-model="rec_fps" :min="1" :max="120" :step="1" :decimals="0" @change="saveRecTime()"></rope-num>
					</div>
					<button class="rd_full" :class="{rd_on: click_shot}" @click="toggleClickShot()">{{ click_shot ? t('click_shot_on') : t('click_shot') }}</button>
					<template v-if="char_name">
						<div class="rd_head">{{ t('follow') }}</div>
						<label class="rd_row">{{ t('follow_anim') }}
							<select v-model="follow_anim" @change="saveFollow()"><option value="">{{ t('follow_none') }}</option><option v-for="a in anim_list" :value="a.uuid">{{ a.name }}</option></select>
						</label>
						<template v-if="follow_anim">
							<div class="rd_grid"><rope-num :label="t('follow_release_at')" v-model="follow_release_at" :min="0" :max="600" :step="0.1" :decimals="1" @change="saveFollow()"></rope-num></div>
							<label class="rd_row" :title="t('follow_bump_tip')">{{ t('follow_bump') }}<input type="checkbox" v-model="follow_bump" @change="saveFollow()"></label>
							<div class="rd_dim small">{{ t('follow_hint') }}</div>
						</template>
						<div class="rd_head">{{ t('route') }}</div>
						<template v-if="!route_name">
							<button class="rd_full" @click="newRoute()" :disabled="!char_npc" :title="char_npc ? '' : t('route_npc_only')">{{ t('route_add') }}</button>
							<div class="rd_dim small" v-if="!char_npc">{{ t('route_npc_only') }}</div>
						</template>
						<template v-else>
							<div class="rd_row"><span>{{ route_name }} · {{ route_points }} {{ t('route_pts') }}</span><span><button @click="addPoint()">{{ t('route_point_add') }}</button> <button class="rd_x" @click="dropRoute()">✕</button></span></div>
							<div class="rd_grid">
								<rope-num :label="t('route_speed')" v-model="route_speed" :min="0" :max="8" :step="0.1" :decimals="1" :title="t('route_speed_tip')" @change="saveRoute()"></rope-num>
								<rope-num :label="t('route_start')" v-model="route_start" :min="0" :max="600" :step="0.1" :decimals="1" @change="saveRoute()"></rope-num>
							</div>
							<label class="rd_row">{{ t('route_mode') }}
								<select v-model="route_mode" @change="saveRoute()"><option value="once">{{ t('rm_once') }}</option><option value="loop">{{ t('rm_loop') }}</option><option value="pingpong">{{ t('rm_pingpong') }}</option></select>
							</label>
							<div class="rd_dim small">{{ t('route_hint') }}</div>
						</template>
						<div class="rd_grid">
							<rope-num :label="t('kill_at')" v-model="kill_at" :min="0" :max="600" :step="0.1" :decimals="1" :title="t('kill_at_tip')" @change="saveRoute()"></rope-num>
						</div>
						<label class="rd_row" v-if="kill_at > 0">{{ t('kill_kind') }}
							<select v-model="kill_kind" @change="saveRoute()"><option value="heart">{{ t('kk_heart') }}</option><option value="headshot">{{ t('kk_head') }}</option><option value="faint">{{ t('kk_faint') }}</option></select>
						</label>
					</template>
					<template v-if="char_name">
						<div class="rd_head">{{ t('shots') }}</div>
						<button class="rd_full" @click="addShot2()">{{ t('add_shot2') }}</button>
						<div class="rd_shot" v-for="(sh, i) in shots" :key="sh.uuid" :class="{rd_sel: sh.selected}">
							<div class="rd_row">
								<span>{{ sh.name }}</span>
								<span>
									<button :class="{rd_on: sh.selected}" :title="t('grab_tip')" @click="grabShot(sh.uuid)">✥</button>
									<button class="rd_x" @click="deleteShot(sh.uuid)">✕</button>
								</span>
							</div>
							<div class="rd_grid">
								<rope-num :label="t('shot_time2')" v-model="sh.t" :min="0" :max="60" :step="0.05" :decimals="2" @change="saveShot(sh)"></rope-num>
								<rope-num :label="t('shot_power')" v-model="sh.impulse" :min="0.1" :max="500" :step="0.5" :decimals="1" @change="saveShot(sh)"></rope-num>
							</div>
						</div>
						<div class="rd_dim small" v-if="shots.length">{{ t('grab_hint') }}</div>

						<div class="rd_head">{{ t('hands') }}</div>
						<div class="rd_dim small">{{ t('hands_hint') }}</div>
						<div class="rd_buttons">
							<button @click="hand('r')">{{ t('hand_r') }}</button>
							<button @click="hand('l')">{{ t('hand_l') }}</button>
							<button @click="hand('both')">{{ t('hand_both') }}</button>
						</div>
						<label class="rd_row">{{ t('item_drop2') }}<input type="checkbox" v-model="item_drop"></label>
						<div class="rd_row" v-for="it in held" :key="it.uuid"><span>{{ it.name }} → {{ it.where }}<template v-if="it.drop"> · {{ t('item_drops') }}</template></span><button class="rd_x" @click="detach(it.uuid)">✕</button></div>

						<div class="rd_head">{{ t('skeleton') }}</div>
						<button class="rd_full" :class="{rd_on: pose_edit}" @click="toggleEdit()">{{ t('edit_skeleton') }}</button>
						<div class="rd_dim small" v-if="pose_edit">{{ t('edit_skeleton_hint') }}</div>
						<label class="rd_row">{{ t('blood') }}<input type="checkbox" v-model="char_blood" @change="saveBlood()"></label>
						<label class="rd_row" v-if="char_blood" :title="t('rec_blood_tip')">{{ t('rec_blood') }}<input type="checkbox" v-model="char_rec_blood" @change="saveBlood()"></label>
						<label class="rd_row" v-if="char_blood" :title="t('blood_high_tip')">{{ t('blood_high') }}<input type="checkbox" v-model="char_blood_high" @change="saveBlood()"></label>
					</template>
				</div>

				<details class="rd_box">
					<summary>{{ t('more') }}</summary>

				<details class="rd_box" :open="!has_root">
					<summary>{{ t('add_character') }}</summary>
					<label class="rd_row">{{ t('model') }}
						<select v-model="new_model" @change="modelChanged()" :title="t('model')"><option value="npc">{{ t('model_npc') }}</option><option value="mannequin">{{ t('model_mannequin') }}</option><option v-for="m in saved_models" :value="'saved:' + m.id">{{ m.name }}</option></select>
					</label>
					<div class="rd_row"><button class="rd_full" @click="saveModel()" :title="t('save_model_tip')">+ {{ t('save_model') }}</button><button v-if="isSaved()" class="rd_x" @click="deleteModel()" :title="t('delete_model')">✕</button></div>
					<label class="rd_row">{{ t('pose') }}
						<select v-model="new_pose"><option v-if="isSaved()" value="saved">{{ t('pose_saved') }}</option><option value="stand">{{ t('pose_stand') }}</option><option value="sit">{{ t('pose_sit') }}</option><option value="kneel">{{ t('pose_kneel') }}</option><option value="squat">{{ t('pose_squat') }}</option><option value="crouch">{{ t('pose_crouch') }}</option><option value="hands_up">{{ t('pose_hands_up') }}</option><option value="cover_head">{{ t('pose_cover_head') }}</option><option value="aim">{{ t('pose_aim') }}</option></select>
					</label>
					<div class="rd_grid" v-if="!isSaved()"><rope-num :label="t('height')" v-model="new_height" :min="8" :max="200" :step="0.5" :decimals="1"></rope-num></div>
					<button class="rd_full" @click="addCharacter()">{{ t('add_character_btn') }}</button>
					<button class="rd_full" @click="autoBones()">{{ t('auto_bones') }}</button>
					<div class="rd_dim small">{{ t('auto_bones_hint') }}</div>
				</details>

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
						</div>
						<label class="rd_row">{{ t('auto_react') }}<input type="checkbox" v-model="auto_react" @change="saveRoot()"></label>
						<div class="rd_grid"><rope-num :label="t('react_scale')" v-model="react_scale" :min="0" :max="3" :step="0.1" :decimals="1" @change="saveRoot()"></rope-num></div>
						<label class="rd_row">{{ t('facing') }}
							<select v-model="facing" @change="saveRoot()"><option value="north">{{ t('facing_north') }}</option><option value="south">{{ t('facing_south') }}</option></select>
						</label>
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

					<details class="rd_box" open>
						<summary>{{ t('living') }}</summary>
						<label class="rd_row" :title="t('npc_tip')">{{ t('npc') }}<input type="checkbox" v-model="npc" @change="saveRoot()"></label>
						<template v-if="npc && is_human">
							<div class="rd_dim">{{ t('npc_game') }}</div>
							<label class="rd_row">{{ t('pose') }}<select v-model="posture" @change="saveRoot()"><option value="stand">{{ t('pose_stand') }}</option><option value="sit">{{ t('pose_sit') }}</option><option value="kneel">{{ t('pose_kneel') }}</option><option value="squat">{{ t('pose_squat') }}</option><option value="crouch">{{ t('pose_crouch') }}</option><option value="hands_up">{{ t('pose_hands_up') }}</option><option value="cover_head">{{ t('pose_cover_head') }}</option><option value="aim">{{ t('pose_aim') }}</option></select></label>
							<label class="rd_row">{{ t('weapon') }}<select v-model="weapon" @change="saveRoot()">
								<option value="pistol">{{ t('w_pistol') }}</option><option value="revolver">{{ t('w_revolver') }}</option><option value="rifle">{{ t('w_rifle') }}</option><option value="akm">{{ t('w_akm') }}</option><option value="shotgun">{{ t('w_shotgun') }}</option>
							</select></label>
						</template>
						<template v-if="npc && !is_human">
							<label class="rd_row">{{ t('head_kills') }}<input type="checkbox" v-model="head_kills" @change="saveRoot()"></label>
							<div class="rd_grid">
								${num('balance', 'balance', 0, 2, 0.05, 2, 'balance_tip', 'saveRoot()')}
								${num('spasm', 'spasm', 0, 1, 0.05, 2, 'spasm_tip', 'saveRoot()')}
								${num('bleed', 'bleed', 0, 20, 0.1, 1, 'bleed_tip', 'saveRoot()')}
							</div>
						</template>
						<label class="rd_row">{{ t('blood') }}<input type="checkbox" v-model="blood" @change="saveRoot()"></label>
						<label class="rd_row" v-if="blood" :title="t('blood_high_tip')">{{ t('blood_high') }}<input type="checkbox" v-model="blood_high" @change="saveRoot()"></label>
						<div class="rd_grid" v-if="blood && !is_human">${num('blood_amount', 'blood_amount', 0, 5, 0.1, 1, null, 'saveRoot()')}</div>
						<div class="rd_dim" v-if="blood">{{ t('blood_note') }}</div>
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
						<summary>{{ t('skeleton') }}</summary>
						<div class="rd_dim small">{{ t('skeleton_hint') }}</div>
						<button class="rd_full" :class="{active: pose_edit}" @click="toggleEdit()">{{ pose_edit ? t('skeleton_on') : t('skeleton_edit') }}</button>
						<div class="rd_row"><input type="text" v-model="pose_name" class="rd_text" :placeholder="t('r_name')"></div>
						<button class="rd_full" @click="savePoseNow()">{{ t('pose_save') }}</button>
						<button class="rd_full" @click="toRest()">{{ t('pose_rest_back') }}</button>
						<div v-for="(p, i) in poses" :key="'p' + i" class="rd_item col">
							<div class="rd_row"><b>{{ p.name }}</b><button class="rd_x" @click="removePose(i)">✕</button></div>
							<div class="rd_quick"><button @click="usePose(i, false)">{{ t('pose_apply') }}</button><button @click="usePose(i, true)">{{ t('pose_as_rest') }}</button></div>
						</div>
					</details>

					<details class="rd_box" open>
						<summary>{{ t('items') }} · {{ items.length }}</summary>
						<div class="rd_dim small">{{ t('items_hint') }}</div>
						<label class="rd_row">{{ t('item_bone') }}
							<select v-model="item_bone"><option v-for="b in bone_list" :value="b.uuid">{{ b.name }}</option></select>
						</label>
						<label class="rd_row">{{ t('item_drop') }}<input type="checkbox" v-model="item_drop"></label>
						<div class="rd_grid"><rope-num :label="t('item_mass')" v-model="item_mass" :min="0.05" :max="100" :step="0.05" :decimals="2"></rope-num></div>
						<button class="rd_full" @click="attach()">{{ t('item_attach') }}</button>
						<div v-for="it in items" :key="it.uuid" class="rd_item col">
							<div class="rd_row"><span>{{ it.name }} → {{ it.bone_name }}<template v-if="it.drop"> · {{ t('item_drops') }}</template></span><button class="rd_x" @click="detach(it.uuid)">✕</button></div>
						</div>
					</details>

					<details class="rd_box" open>
						<summary>{{ t('shot_box') }}</summary>
						<label class="rd_row">{{ t('shot_at') }}
							<select v-model="shot_part" @change="saveRoot()"><option value="auto">{{ t('shot_auto') }}</option><option v-for="b in bone_list" :value="b.uuid">{{ b.name }}</option></select>
						</label>
						<div class="rd_dim small">{{ t('shot_from') }}</div>
						<div class="rd_quick">
							<button @click="setYaw(0)">{{ t('d_front') }}</button><button @click="setYaw(90)">{{ t('d_right') }}</button><button @click="setYaw(180)">{{ t('d_back') }}</button><button @click="setYaw(-90)">{{ t('d_left') }}</button>
						</div>
						<div class="rd_grid">
							<rope-num :label="t('shot_yaw')" v-model="shot_yaw" :min="-180" :max="180" :step="1" :decimals="0" @change="saveRoot()"></rope-num>
							<rope-num :label="t('shot_pitch')" v-model="shot_pitch" :min="-85" :max="85" :step="1" :decimals="0" @change="saveRoot()"></rope-num>
							<rope-num :label="t('shot')" v-model="shot" :min="1" :max="500" :step="1" :decimals="0" :title="t('shot_tip')" @change="saveRoot()"></rope-num>
							<rope-num :label="t('time')" v-model="shot_time" :min="0" :max="60" :step="0.05" :decimals="2" @change="saveRoot()"></rope-num>
						</div>
						<button class="rd_full" @click="fire()">{{ t('fire') }}</button>
						<button class="rd_full" @click="addShot()">{{ t('add_shot') }}</button>
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
				</details>
			</div>`,
	};
}
const num_ = num;

const STYLE = `
	#panel_ragdoll .rd_panel { overflow-y: auto !important; overflow-x: hidden !important; }
	.rd_panel { padding: 4px 8px 10px; font-size: 0.92em; }
	.rd_panel .rd_buttons { display: flex; gap: 4px; margin: 4px 0; }
	.rd_panel .rd_big { flex: 1; font-weight: bold; padding: 6px; }
	.rd_panel .rd_head { margin: 8px 0 2px; font-size: 0.85em; text-transform: uppercase; opacity: 0.7; }
	.rd_panel .rd_on { background: var(--color-accent); color: var(--color-accent_text); }
	.rd_panel .rd_shot { border: 1px solid var(--color-border); border-radius: 4px; padding: 2px 4px; margin: 3px 0; }
	.rd_panel .rd_shot.rd_sel { border-color: var(--color-accent); }
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
	.rd_panel .rd_quick { display: flex; gap: 4px; margin: 3px 0 5px; }
	.rd_panel .rd_quick button { flex: 1; min-width: 0; padding: 3px 4px; }
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


// ---------------------------------------------------------------------------
// Held items: a weapon, a tool: fixed to a part of the body, dropped when the character is knocked down
// ---------------------------------------------------------------------------

function attachItem(root, bone_uuid, drop, mass, extra) {
	const bone = bonesOf(root).find(g => g.uuid == bone_uuid);
	if (!bone) { Blockbench.showQuickMessage(tr('msg_item_bone'), 3000); return; }
	const bones = bonesOf(root), g = Group.first_selected;
	const cubes = (Outliner.selected || []).filter(isPart).filter(c => !bones.includes(c.parent));
	let item = null, wrap = false, wrap_center = null;
	if (g && g !== root && !bones.includes(g) && (!cubes.length || cubes.every(c => c.parent === g))) item = g;
	else if (cubes.length) wrap = true;
	if (!item && !wrap) { Blockbench.showQuickMessage(tr('msg_item_select'), 3500); return; }
	Undo.initEdit({outliner: true, elements: cubes, groups: [root, bone].concat(item ? [item] : [])});
	if (wrap) {
		const box = new THREE.Box3();
		cubes.forEach(c => { if (c.mesh) { c.mesh.updateMatrixWorld(true); box.union(new THREE.Box3().setFromObject(c.mesh)); } });
		const center = box.isEmpty() ? [0, 0, 0] : box.getCenter(new THREE.Vector3()).toArray().map(v => Math.round(v * 100) / 100);
		item = new Group({name: (cubes[0].name || 'item') + ' (held)', origin: center});
		wrap_center = center;
		item.addTo('root').init();
		cubes.forEach(c => c.addTo(item));
	}
	item.attach = Object.assign({root: root.uuid, bone: bone.uuid, drop: !!drop}, extra ? extra(item, wrap_center) : {});
	item.physics = Object.assign({}, item.physics || {}, {type: 'dynamic', mass: Math.max(0.05, mass || 1), friction: 0.6, restitution: 0.1, velocity: [0, 0, 0]});
	Undo.finishEdit('Attach item', {outliner: true, elements: cubes, groups: [root, bone, item]});
	Canvas.updateAll && Canvas.updateAll();
	Blockbench.showQuickMessage(tr('msg_item_done'), 1800);
	updatePanel(true);
}

function detachItem(uuid) {
	const node = [...Group.all, ...Cube.all, ...Mesh.all].find(n => n.uuid == uuid);
	if (!node) return;
	Undo.initEdit({outliner: true, groups: node instanceof Group ? [node] : [], elements: node instanceof Group ? [] : [node]});
	node.attach = null;
	node.physics = null;
	Undo.finishEdit('Detach item', {outliner: true, groups: node instanceof Group ? [node] : [], elements: node instanceof Group ? [] : [node]});
	updatePanel(true);
}

const itemsOf = root => [...Group.all, ...Cube.all, ...Mesh.all].filter(n => n.attach && n.attach.root == root.uuid);

// ---------------------------------------------------------------------------
// Skeleton poses: drag the joints, the parts follow and stay joined (no part is moved by itself)
// ---------------------------------------------------------------------------

// The Move / Rotate tools are let into this tab. Both the Physics and the Ragdoll plugin do this, so they share one wrapper
// on the tool (the modes it is let into, and its own condition, kept on the tool): loaded or unloaded in any order, they
// never wrap each other, and the tool's own condition (a function or Blockbench's condition object) is asked safely.
function letToolIntoMode(tool, mode_id, patches) {
	if (!tool) return;
	const c = tool.condition;
	if (!tool.__extra_modes && c && typeof c == 'object' && c.modes instanceof Array) {
		if (c.modes.includes(mode_id)) return;
		c.modes.push(mode_id);
		patches.push(() => { const i = c.modes.indexOf(mode_id); if (i >= 0) c.modes.splice(i, 1); });
		return;
	}
	if (!tool.__extra_modes) {
		tool.__extra_modes = new Set();
		tool.__original_condition = c;
		tool.condition = function (...args) {
			try {
				if (typeof Project != 'undefined' && Project && typeof Format != 'undefined' && Format && Format.id != 'image' && typeof Modes != 'undefined' && [...tool.__extra_modes].some(m => Modes[m])) return true;
			} catch (err) { /* ask the tool itself */ }
			const o = tool.__original_condition;
			try {
				if (typeof o == 'function') return o.apply(this, args);
				if (o && typeof o == 'object' && typeof Condition == 'function') return Condition(o);
				return o === undefined ? true : !!o;
			} catch (err) { return true; }
		};
	}
	tool.__extra_modes.add(mode_id);
	patches.push(() => {
		if (!tool.__extra_modes) return;
		tool.__extra_modes.delete(mode_id);
		if (!tool.__extra_modes.size) { tool.condition = tool.__original_condition; delete tool.__extra_modes; delete tool.__original_condition; }
	});
}

const PRINCIPAL = {pelvis: ['abdomen', 'chest'], abdomen: ['chest'], chest: ['neck', 'head'], neck: ['head'], upperarm: ['forearm', 'hand'], forearm: ['hand'], thigh: ['shin', 'foot'], shin: ['foot']};

// The far end of a bone that has no next bone (head, hand, foot): straight out of the joint through the middle of its
// shapes, up to where they end. Measured in the bone's own frame, and a direction that is nearly along an axis of the
// bone is put exactly on it, so the skeleton is even from the front, the side and above. A foot points to its toe.
function boneEnd(g, role) {
	g.mesh.updateMatrixWorld(true);
	const inv = new THREE.Matrix4().copy(g.mesh.matrixWorld).invert(), box = new THREE.Box3();
	directParts(g).forEach(el => {
		const m = el.mesh;
		if (!m || !m.geometry) return;
		m.updateMatrixWorld(true);
		if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
		const bb = m.geometry.boundingBox, to = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
		for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(to));
	});
	if (box.isEmpty()) return new THREE.Vector3(0, -4, 0);
	const c = box.getCenter(new THREE.Vector3());
	if (role == 'foot') {
		// the toe: the end of the foot that is farthest from the ankle along the ground
		const front = Math.abs(box.min.z) > Math.abs(box.max.z) ? box.min.z : box.max.z;
		return new THREE.Vector3(Math.abs(c.x) < 0.25 * (box.max.x - box.min.x) ? 0 : c.x, c.y, front);
	}
	const dir = c.clone();
	if (dir.lengthSq() < 1e-6) dir.set(0, -1, 0);
	dir.normalize();
	const ax = [Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z)], k = ax.indexOf(Math.max(...ax));
	if (ax[k] > Math.cos(30 * D2R)) { const sign = Math.sign(dir.getComponent(k)); dir.set(0, 0, 0).setComponent(k, sign); }
	// out to the side of the box the direction leaves through
	let t = Infinity;
	for (let a = 0; a < 3; a++) {
		const d = dir.getComponent(a);
		if (Math.abs(d) < 1e-6) continue;
		const lim = d > 0 ? box.max.getComponent(a) : box.min.getComponent(a);
		if (lim / d > 0) t = Math.min(t, lim / d);
	}
	if (!isFinite(t)) t = box.getSize(new THREE.Vector3()).length() / 2;
	return dir.multiplyScalar(t);
}

// the bones of a character with what is needed to move them: the pivot, the end (the joint of the next bone, or the far end)
function skeletonOf(root) {
	const bones = bonesOf(root);
	const bone_of = g => { for (let p = g.parent; p && p != 'root'; p = p.parent) if (bones.includes(p)) return p; return null; };
	const info = new Map(bones.map(g => [g, {g, role: roleOf(g), parent: null, children: [], principal: null, end_local: null}]));
	bones.forEach(g => { const p = bone_of(g); if (p) { info.get(g).parent = info.get(p); info.get(p).children.push(info.get(g)); } });
	scene.updateMatrixWorld(true);
	for (const i of info.values()) {
		const want = PRINCIPAL[i.role] || [];
		i.principal = want.map(r => i.children.find(c => c.role == r)).find(Boolean) || (i.children.length == 1 ? i.children[0] : null);
		if (!i.principal) i.end_local = boneEnd(i.g, i.role);
	}
	return [...info.values()];
}

const pivotWorld = g => { g.mesh.updateMatrixWorld(true); return g.mesh.getWorldPosition(new THREE.Vector3()); };
const worldQuatOf = g => { g.mesh.updateMatrixWorld(true); return g.mesh.getWorldQuaternion(new THREE.Quaternion()); };
const endWorld = i => { if (i.principal) return pivotWorld(i.principal.g); i.g.mesh.updateMatrixWorld(true); return i.g.mesh.localToWorld(i.end_local.clone()); };

// the rotation of a group from the turn of its bone relative to its parent
function setBoneTurn(g, local) {
	const e = new THREE.Euler().setFromQuaternion(local, eulerOrder()), s = rotationSigns();
	g.rotation = [e.x * s[0] / D2R, e.y * s[1] / D2R, e.z * s[2] / D2R].map(v => Math.round(v * 100) / 100);
	if (typeof Canvas != 'undefined') Canvas.updateAllBones();
	scene.updateMatrixWorld(true);
}

// turn a bone (about its pivot) so that its end points at `target`; the bones below it come along
function aimBone(i, target) {
	const p = pivotWorld(i.g), now = endWorld(i).sub(p), want = target.clone().sub(p);
	if (now.lengthSq() < 1e-8 || want.lengthSq() < 1e-8) return;
	const delta = new THREE.Quaternion().setFromUnitVectors(now.normalize(), want.normalize());
	const parent = i.parent ? worldQuatOf(i.parent.g) : (i.g.parent && i.g.parent.mesh ? worldQuatOf(i.g.parent) : new THREE.Quaternion());
	setBoneTurn(i.g, parent.invert().multiply(delta.multiply(worldQuatOf(i.g))));
}

// an arm or a leg reaches a point: two bones, the elbow (knee) stays on the side it was
function reachWith(upper, lower, target, forward) {
	forward = forward || new THREE.Vector3(0, 0, -1);
	const P0 = pivotWorld(upper.g), P1 = pivotWorld(lower.g), P2 = endWorld(lower);
	const L1 = P0.distanceTo(P1), L2 = P1.distanceTo(P2);
	const d = target.clone().sub(P0), dist = clamp(d.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3), dir = d.normalize();
	const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
	// a knee bends forward, an elbow backward (the side it is on now, if that is a sensible one)
	const sideways = v => v.clone().addScaledVector(dir, -v.dot(dir));
	let pole = sideways(P1.clone().sub(P0));
	if (lower.role == 'shin') pole = sideways(forward);
	else if (pole.dot(forward) > 0 || pole.lengthSq() < 1e-6) pole = sideways(forward.clone().negate());
	if (pole.lengthSq() < 1e-6) pole = perpendicular(dir);
	pole.normalize();
	aimBone(upper, P0.clone().addScaledVector(dir, a).addScaledVector(pole, h));
	aimBone(lower, P0.clone().addScaledVector(dir, dist));
}

// what dragging the end point of a bone does
function dragSkeleton(i, target, forward) {
	if ((i.role == 'forearm' || i.role == 'shin') && i.parent && (i.parent.role == 'upperarm' || i.parent.role == 'thigh')) reachWith(i.parent, i, target, forward);
	else aimBone(i, target);
}

let skeleton = null;   // {root, infos, group, handles, lines}

// a pose made with the skeleton is the pose the character holds (its muscles keep it when the simulation runs)
function markCustomPose(root) {
	if (!root || !root.ragdoll || root.ragdoll.posture == 'custom') return;
	root.ragdoll = Object.assign(ragdollOf(root), {posture: 'custom'});
	Project.saved = false;
}
let pose_edit = false, drag = null;

function removeSkeletonView() {
	if (skeleton && skeleton.group && skeleton.group.parent) skeleton.group.parent.remove(skeleton.group);
	skeleton = null;
}
function syncSkeletonView(rebuild) {
	const root = Project && typeof Modes != 'undefined' && Modes.ragdoll ? activeRoot() : null;
	if (!pose_edit || !root) { removeSkeletonView(); return; }
	if (!skeleton || skeleton.root !== root || rebuild) {
		removeSkeletonView();
		const infos = skeletonOf(root), group = new THREE.Group();
		group.name = 'ragdoll_skeleton';
		const handles = infos.map(i => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({color: 0xff9a2e, depthTest: false, transparent: true})); m.renderOrder = 1000; group.add(m); return m; });
		const lines = infos.map(() => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({color: 0xffd27a, depthTest: false, transparent: true})); l.renderOrder = 999; group.add(l); return l; });
		scene.add(group);
		skeleton = {root, infos, group, handles, lines};
	}
	scene.updateMatrixWorld(true);
	skeleton.infos.forEach((i, k) => {
		const a = pivotWorld(i.g), b = endWorld(i);
		skeleton.handles[k].position.copy(b);
		skeleton.handles[k].material.color.set(drag && drag.info === i ? 0xffffff : 0xff9a2e);
		const pos = skeleton.lines[k].geometry.attributes.position;
		pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z); pos.needsUpdate = true;
		skeleton.lines[k].geometry.computeBoundingSphere();
	});
}

function screenPoint(p, preview) {
	const rect = preview.canvas.getBoundingClientRect(), v = p.clone().project(preview.camera);
	return {x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height, z: v.z};
}

function rayFor(event, preview) {
	const rect = preview.canvas.getBoundingClientRect();
	const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
	const ray = new THREE.Raycaster();
	ray.setFromCamera(ndc, preview.camera);
	return ray.ray;
}

function onSkeletonDown(event) {
	if (!pose_edit || !skeleton || !Project || event.button !== 0) return;
	const sim = simNow();
	if (sim && sim.playing) return;
	const preview = previewOf(event);
	if (!preview) return;
	if (drag) endSkeletonDrag();   // a drag whose release was never seen (let go outside the window...): it ends now
	syncSkeletonView();            // the handles where the bones are now
	if (!skeleton) return;
	let best = null, best_d = 22;
	skeleton.infos.forEach((i, k) => {
		const s = screenPoint(skeleton.handles[k].position, preview), d = Math.hypot(s.x - event.clientX, s.y - event.clientY);
		if (d < best_d) { best_d = d; best = i; }
	});
	if (!best) return;
	event.stopPropagation(); event.preventDefault();
	// R (the rotate tool): the bone is picked, and Blockbench's own rotate handles turn it alone
	if (typeof Toolbox != 'undefined' && Toolbox.selected && Toolbox.selected.id == 'rotate_tool') { best.g.select(); markCustomPose(skeleton.root); syncSkeletonView(); return; }
	const camera_dir = preview.camera.getWorldDirection(new THREE.Vector3());
	drag = {info: best, preview, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera_dir, endWorld(best))};
	const groups = bonesOf(skeleton.root);
	try { Undo.initEdit({outliner: true, groups}); } catch (err) { console.warn('[Ragdoll] pose undo', err); }
	drag.groups = groups;
	syncSkeletonView();
}
function onSkeletonMove(event) {
	if (!drag) return;
	// the button is no longer held (its release went elsewhere): the drag is over
	if (event.buttons !== undefined && !(event.buttons & 1)) { endSkeletonDrag(); return; }
	event.stopPropagation(); event.preventDefault();
	const hit = new THREE.Vector3();
	if (!rayFor(event, drag.preview).intersectPlane(drag.plane, hit)) return;
	dragSkeleton(drag.info, hit, new THREE.Vector3(0, 0, ragdollOf(skeleton.root).facing == 'south' ? 1 : -1));
	Project.saved = false;
	syncSkeletonView();
}
function onSkeletonUp(event) {
	if (!drag) return;
	event.stopPropagation();
	endSkeletonDrag();
}
// the end of a drag, whatever goes wrong on the way: the next handle can always be taken
function endSkeletonDrag() {
	const d = drag;
	drag = null;
	if (!d) return;
	try { Undo.finishEdit('Pose skeleton', {outliner: true, groups: d.groups}); } catch (err) { console.warn('[Ragdoll] pose undo', err); }
	try { if (skeleton) markCustomPose(skeleton.root); } catch (err) { console.warn('[Ragdoll] pose', err); }
	try { syncSkeletonView(); updatePanel(true); } catch (err) { console.warn('[Ragdoll] pose view', err); }
}

// ---- a library of poses ----

function bonePose(root) { const rot = {}; bonesOf(root).forEach(g => { rot[g.uuid] = g.rotation.slice(); }); return rot; }

function savePose(name) {
	const sel = Project && Group.first_selected, root = sel && rootOf(sel);
	if (!root) { Blockbench.showQuickMessage(tr('msg_select'), 2500); return; }
	edit([root], 'Save pose', () => {
		const s = ragdollOf(root);
		root.ragdoll = Object.assign(s, {poses: (s.poses || []).concat([{name: name || 'Pose', rot: bonePose(root)}])});
	});
	Blockbench.showQuickMessage(tr('msg_pose_saved'), 1500);
	updatePanel(true);
}

// puts the character in a saved pose (and makes it the rest pose that the muscles hold, if asked)
function applyPose(index, as_rest) {
	const sel = Project && Group.first_selected, root = sel && rootOf(sel);
	if (!root) return;
	const pose = (ragdollOf(root).poses || [])[index];
	if (!pose) return;
	const bones = bonesOf(root);
	edit(bones.concat([root]), as_rest ? 'Pose as rest pose' : 'Apply pose', () => {
		bones.forEach(g => { const r = pose.rot[g.uuid]; if (r) { g.rotation = r.slice(); if (as_rest) g.bone = Object.assign(boneOf(g), {rest: r.slice()}); } });
	});
	if (typeof Canvas != 'undefined') Canvas.updateAllBones();
	syncSkeletonView(true);
	updatePanel(true);
}

function deletePose(index) {
	const sel = Project && Group.first_selected, root = sel && rootOf(sel);
	if (!root) return;
	edit([root], 'Delete pose', () => { const s = ragdollOf(root); root.ragdoll = Object.assign(s, {poses: (s.poses || []).filter((_, i) => i != index)}); });
	updatePanel(true);
}

// back to the rest pose
function backToRest() {
	const sel = Project && Group.first_selected, root = sel && rootOf(sel);
	if (!root) return;
	const bones = bonesOf(root);
	edit(bones, 'Back to rest pose', () => bones.forEach(g => { const r = boneOf(g).rest; if (r) g.rotation = r.slice(); }));
	if (typeof Canvas != 'undefined') Canvas.updateAllBones();
	syncSkeletonView(true);
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

// ---- the shot you aim: where it comes from, how hard, at which part ----

// the direction a shot travels: the shooter stands round the character (0 = in front, 90 = on its right) and above or below it
function shotDirection(root, yaw, pitch) {
	const a = yaw * D2R, p = pitch * D2R, south = ragdollOf(root).facing == 'south' ? -1 : 1;
	const from = new THREE.Vector3(Math.sin(a) * Math.cos(p) * south, Math.sin(p), -Math.cos(a) * Math.cos(p) * south);
	if (root.mesh) { root.mesh.updateMatrixWorld(true); from.applyQuaternion(root.mesh.getWorldQuaternion(new THREE.Quaternion())); }
	return from.negate().normalize();
}

function shotTarget(root) {
	const s = ragdollOf(root), bones = bonesOf(root);
	return bones.find(g => g.uuid == s.shot_part) || bones.find(g => roleOf(g) == 'chest') || bones[0] || null;
}

const boneCenter = g => { g.mesh.updateMatrixWorld(true); return new THREE.Box3().setFromObject(g.mesh).getCenter(new THREE.Vector3()); };

// fire the shot now (while the simulation runs) or put it on the timeline at the chosen time
function fireShot(on_timeline) {
	const sel = Project && Group.first_selected, root = sel && rootOf(sel);
	if (!root) { Blockbench.showQuickMessage(tr('msg_select'), 2500); return; }
	const target = shotTarget(root), s = ragdollOf(root);
	if (!target) return;
	const dir = shotDirection(root, s.shot_yaw, s.shot_pitch);
	const sim = simNow();
	if (!on_timeline && sim && sim.playing && current) {
		const r = current.list.find(x => x.root === root);
		if (r) {
			const entry = r.bones.find(b => b.group === target).entry;
			const M = new THREE.Matrix4().compose(bodyPos(entry), bodyQuat(entry), new THREE.Vector3(1, 1, 1));
			const local = boneCenter(target).applyMatrix4(M.invert());
			const hit = {t: Math.round(r.time * 1000) / 1000, bone: target.uuid, name: target.name, dir: dir.toArray().map(v => Math.round(v * 1e4) / 1e4), local: local.toArray().map(v => Math.round(v * 100) / 100), impulse: s.shot};
			r.shoot(hit);
			root.ragdoll = Object.assign(ragdollOf(root), {hits: ragdollOf(root).hits.concat([hit]).sort((a, b) => a.t - b.t)});
			Project.saved = false;
			updatePanel(true);
			return;
		}
	}
	const time = on_timeline ? s.shot_time : (sim ? sim.time : s.shot_time);
	recordHit(root, makeHit(target, boneCenter(target), dir, s.shot, time));
	Blockbench.showQuickMessage(tr('msg_hit'), 1200);
}

// the arrow in the 3D view: where the shot comes from, and the part it hits
let shot_arrow = null;
function removeArrow() { if (shot_arrow) { if (shot_arrow.parent) shot_arrow.parent.remove(shot_arrow); shot_arrow = null; } }
function syncArrow() {
	const sel = Project && typeof Modes != 'undefined' && Modes.ragdoll ? Group.first_selected : null, root = sel && rootOf(sel);
	const target = root && shotTarget(root);
	if (!target || !target.mesh) { removeArrow(); return; }
	const s = ragdollOf(root), dir = shotDirection(root, s.shot_yaw, s.shot_pitch), center = boneCenter(target);
	const length = 12 + Math.min(20, s.shot * 0.12);
	if (!shot_arrow) { shot_arrow = new THREE.ArrowHelper(dir, center, length, 0xff7a1a, 3, 2); shot_arrow.name = 'ragdoll_shot_arrow'; shot_arrow.renderOrder = 999; scene.add(shot_arrow); }
	shot_arrow.setDirection(dir);
	shot_arrow.position.copy(center).addScaledVector(dir, -length);
	shot_arrow.setLength(length, 3, 2);
}

function addCharacter(pose, height, model) {
	if (!Project) return;
	if (String(model).startsWith('saved:')) {
		const entry = savedModels().find(m => 'saved:' + m.id == model);
		if (!entry) { Blockbench.showQuickMessage(tr('msg_save_gone'), 2500); return; }
		const res = createSavedCharacter(entry, pose);
		Blockbench.showQuickMessage(tr('msg_char'), 1800);
		updatePanel(true);
		return res;
	}
	if (pose == 'saved') pose = 'stand';
	const res = createCharacter({pose, height, model});
	Blockbench.showQuickMessage(tr('msg_char'), 1800);
	updatePanel(true);
	return res;
}

function autoBonesFromSelection() {
	if (!Project) return;
	// everything selected, or all the cubes inside the selected group
	let els = (Outliner.selected || []).filter(e => e instanceof Cube || e instanceof Mesh);
	const group = Group.first_selected;
	if (!els.length && group) { const out = []; const visit = g => (g.children || []).forEach(c => (c instanceof Group ? visit(c) : (c instanceof Cube || c instanceof Mesh) && out.push(c))); visit(group); els = out; }
	const res = autoRig(els);
	if (res.error) { Blockbench.showQuickMessage(tr('msg_auto_few'), 3500); return; }
	Blockbench.showQuickMessage(tr('msg_auto').replace('%', res.count), 2500);
	updatePanel(true);
}

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


// ---------------------------------------------------------------------------
// Simple controls: shots as little guns in the scene (moved with W, turned with R), a click shot, things in the hands
// ---------------------------------------------------------------------------

let click_shot = false;
const isShot = g => g instanceof Group && g.ragdoll_shot;
const shotsOf = root => Group.all.filter(g => isShot(g) && (!root || g.ragdoll_shot.root == root.uuid));
// the character the simple controls are for: the one the selection is in, else the first one in the project
function activeRoot() {
	if (!Project) return null;
	const sel = Group.first_selected;
	const r = sel && (rootOf(sel) || (isShot(sel) && Group.all.find(g => g.uuid == sel.ragdoll_shot.root)));
	return r || Group.all.find(g => g.ragdoll && g.ragdoll.enabled) || null;
}

// where a shot marker is and where it shoots (Blockbench world, pixels): the muzzle is its pivot, it shoots along its -Z
function shotRay(g) {
	g.mesh.updateMatrixWorld(true);
	return {origin: g.mesh.getWorldPosition(new THREE.Vector3()), dir: new THREE.Vector3(0, 0, -1).applyQuaternion(g.mesh.getWorldQuaternion(new THREE.Quaternion())).normalize()};
}

// a new shot: a small gun at `at` (model pixels) aimed along `dir`
function addShotMarker(root, at, dir, t, impulse) {
	const n = shotsOf(null).length + 1;
	const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().normalize());
	const e = new THREE.Euler().setFromQuaternion(q, eulerOrder());
	const rotation = bbOfThree([e.x / D2R, e.y / D2R, e.z / D2R]);
	const elements = [];
	Undo.initEdit({outliner: true, elements: [], groups: []});
	const g = new Group({name: tr('shot_name') + ' ' + n, origin: at.toArray().map(v => Math.round(v * 100) / 100), rotation});
	g.ragdoll_shot = {root: root.uuid, t: Math.round(t * 100) / 100, impulse: impulse, weapon: ragdollOf(root).weapon || 'pistol'};
	g.addTo('root').init();
	const o = g.origin;
	// the gun: the barrel back from the muzzle, a grip under the back of it
	for (const [from, to] of [[[-0.3, -0.35, 0], [0.3, 0.35, 4]], [[-0.35, -2.2, 2.6], [0.35, -0.3, 3.6]]]) {
		const c = new Cube({name: 'gun', from: from.map((v, i) => v + o[i]), to: to.map((v, i) => v + o[i]), origin: o.slice(), rotation: [0, 0, 0]});
		c.addTo(g).init();
		elements.push(c);
	}
	Undo.finishEdit('Add shot', {outliner: true, elements, groups: [g]});
	if (typeof Canvas != 'undefined' && Canvas.updateAll) Canvas.updateAll();
	return g;
}

// "Add shot": two metres in front of the chest, aimed at it
function addShotFor(root) {
	if (!root) { Blockbench.showQuickMessage(tr('msg_spawn_first'), 2500); return null; }
	const chest = bonesOf(root).find(g => roleOf(g) == 'chest') || bonesOf(root)[0];
	const target = boneCenter(chest), front = shotDirection(root, 0, 0).negate();   // (the way the character faces)
	const at = target.clone().addScaledVector(front, 32).add(new THREE.Vector3(0, 2, 0));
	const dir = target.clone().sub(at).normalize();
	const g = addShotMarker(root, Project.model_3d ? Project.model_3d.worldToLocal(at.clone()) : at, dir, 0.5, ragdollOf(root).shot || 4);
	updatePanel(true);
	return g;
}

// fire a shot marker in the running simulation: the first thing its ray meets is hit
function fireMarker(g) {
	if (!current) return;
	const {origin, dir} = g.marker_ray || shotRay(g);
	const hit = castRay(current.rt, origin.clone().divideScalar(SCALE), dir.clone().multiplyScalar(60), null);
	if (!hit) return;
	for (const r of current.list) {
		const part = r.is_humanoid ? r.parts.find(p => p.id.GetIndexAndSequenceNumber() == hit.id) : r.bones.find(b => b.entry.id.GetIndexAndSequenceNumber() == hit.id);
		if (!part) continue;
		const entry = part.entry, group = part.group;
		const bp = entry.body.GetPosition(), br = entry.body.GetRotation();
		const local = hit.position.clone().sub(new THREE.Vector3(bp.GetX(), bp.GetY(), bp.GetZ())).applyQuaternion(new THREE.Quaternion(br.GetX(), br.GetY(), br.GetZ(), br.GetW()).invert()).multiplyScalar(SCALE);
		const sh = g.ragdoll_shot;
		r.shoot({bone: group.uuid, name: group.name, dir: dir.toArray(), local: local.toArray(), impulse: sh.impulse, weapon: sh.weapon});
		return;
	}
}

// the shots of a run: each fires once at its time
function startMarkers() {
	if (!current) return;
	current.markers = shotsOf(null).map(g => { g.marker_ray = shotRay(g); return {g, fired: false}; });
	current.time = 0;
}
function stepMarkers(dt) {
	if (!current || !current.markers) return;
	for (const m of current.markers) if (!m.fired && m.g.ragdoll_shot && m.g.ragdoll_shot.t <= current.time + 1e-9) { m.fired = true; try { fireMarker(m.g); } catch (err) { console.warn('[Ragdoll] shot', err); } }
	current.time += dt;
}

// a click on the character with "Click shot" on: a shot is made there, at the time the simulation is at
function onClickShot(event) {
	if (!click_shot || !Project || event.button !== 0) return;
	const preview = previewOf(event);
	if (!preview) return;
	const ray = rayFor(event, preview);
	for (const root of Group.all.filter(g => g.ragdoll && g.ragdoll.enabled)) {
		const found = pickBone(root, ray.origin, ray.direction);
		if (!found) continue;
		event.stopPropagation(); event.preventDefault();
		const sim = simNow();
		const t = sim ? sim.time : 0;
		const at = found.point.clone().addScaledVector(ray.direction, -24);
		const g = addShotMarker(root, Project.model_3d ? Project.model_3d.worldToLocal(at.clone()) : at, ray.direction.clone(), t, ragdollOf(root).shot || 4);
		g.marker_ray = {origin: at, dir: ray.direction.clone().normalize()};
		// running: it fires now (and is replayed at this time in the next run and in the bake)
		if (sim && current) { if (!current.markers) current.markers = []; current.markers.push({g, fired: true}); fireMarker(g); }
		click_shot = false;
		Blockbench.showQuickMessage(tr('msg_click_shot'), 1500);
		updatePanel(true);
		return;
	}
}

// The shot being edited (✥): its line from the gun to what it hits, and two handles. The gun handle moves the gun (it
// keeps aiming at the same point); the aim handle at the end of the line turns it. The gun is model data (the group and
// its cubes), so the simulation shoots from exactly where it is.
let shot_edit = null;   // uuid of the shot being edited
let shot_view = null, shot_drag = null;
function removeShotLines() { if (shot_view && shot_view.group.parent) shot_view.group.parent.remove(shot_view.group); shot_view = null; }
function editedShot() { const g = shot_edit && Group.all.find(x => x.uuid == shot_edit); if (!g) shot_edit = null; return g || null; }
function shotAim(g) {
	const {origin, dir} = shotRay(g);
	const root = Group.all.find(x => x.uuid == g.ragdoll_shot.root);
	const hit = root && pickBone(root, origin, dir);
	return {origin, dir, end: hit ? hit.point : origin.clone().addScaledVector(dir, 48), hit: !!hit};
}
function syncShotLines() {
	const g = Project && typeof Modes != 'undefined' && Modes.ragdoll ? editedShot() : null;
	if (!g || !g.mesh) { removeShotLines(); return; }
	if (!shot_view) {
		const group = new THREE.Group();
		group.name = 'ragdoll_shot_edit';
		const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]), new THREE.LineDashedMaterial({color: 0xff7a1a, dashSize: 1.2, gapSize: 0.8, depthTest: false, transparent: true}));
		line.renderOrder = 998;
		const ball = color => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({color, depthTest: false, transparent: true})); m.renderOrder = 1000; return m; };
		const gun = ball(0xff7a1a), aim = ball(0xffd27a);
		group.add(line, gun, aim);
		scene.add(group);
		shot_view = {group, line, gun, aim};
	}
	scene.updateMatrixWorld(true);
	const a = shot_drag && shot_drag.aim_point ? Object.assign(shotAim(g), {end: shot_drag.aim_point}) : shotAim(g);
	const pos = shot_view.line.geometry.attributes.position;
	pos.setXYZ(0, a.origin.x, a.origin.y, a.origin.z); pos.setXYZ(1, a.end.x, a.end.y, a.end.z); pos.needsUpdate = true;
	shot_view.line.geometry.computeBoundingSphere();
	shot_view.line.computeLineDistances();
	shot_view.line.material.color.set(a.hit ? 0xff7a1a : 0x888888);
	shot_view.gun.position.copy(a.origin);
	shot_view.aim.position.copy(a.end);
}

// the gun to a new place (Blockbench world pixels): the group and its cubes move together
function moveShotTo(g, world) {
	const to = Project.model_3d ? Project.model_3d.worldToLocal(world.clone()) : world.clone();
	const d = to.toArray().map((v, i) => v - g.origin[i]);
	g.origin = g.origin.map((v, i) => Math.round((v + d[i]) * 100) / 100);
	for (const c of g.children) if (c instanceof Cube) {
		c.from = c.from.map((v, i) => v + d[i]); c.to = c.to.map((v, i) => v + d[i]); c.origin = c.origin.map((v, i) => v + d[i]);
	}
}
// the gun turned to shoot at a point (Blockbench world pixels)
function aimShotAt(g, world) {
	g.mesh.updateMatrixWorld(true);
	const from = g.mesh.getWorldPosition(new THREE.Vector3()), dir = world.clone().sub(from);
	if (dir.lengthSq() < 1e-6) return;
	const parent_q = g.mesh.parent ? g.mesh.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
	const q = parent_q.invert().multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.normalize()));
	const e = new THREE.Euler().setFromQuaternion(q, eulerOrder());
	g.rotation = bbOfThree([e.x / D2R, e.y / D2R, e.z / D2R]);
}
function refreshShot(g) {
	if (typeof Canvas != 'undefined') { if (Canvas.updateAll) Canvas.updateAll(); else { Canvas.updateAllPositions(); Canvas.updateAllBones(); } }
	scene.updateMatrixWorld(true);
	syncShotLines();
}

function onShotDown(event) {
	const g = editedShot();
	if (!g || !shot_view || !Project || event.button !== 0 || !Modes.ragdoll) return;
	const preview = previewOf(event);
	if (!preview) return;
	let which = null, best = 16;
	for (const [name, h] of [['gun', shot_view.gun], ['aim', shot_view.aim]]) {
		const p = screenPoint(h.position, preview), d = Math.hypot(p.x - event.clientX, p.y - event.clientY);
		if (d < best) { best = d; which = name; }
	}
	if (!which) return;
	event.stopPropagation(); event.preventDefault();
	const at = (which == 'gun' ? shot_view.gun : shot_view.aim).position.clone();
	shot_drag = {g, which, preview, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(preview.camera.getWorldDirection(new THREE.Vector3()), at), aim_point: shot_view.aim.position.clone()};
	Undo.initEdit({outliner: true, elements: g.children.slice(), groups: [g]});
}
function onShotMove(event) {
	if (!shot_drag) return;
	event.stopPropagation(); event.preventDefault();
	const p = new THREE.Vector3();
	if (!rayFor(event, shot_drag.preview).intersectPlane(shot_drag.plane, p)) return;
	const g = shot_drag.g;
	if (shot_drag.which == 'gun') { moveShotTo(g, p); refreshShot(g); aimShotAt(g, shot_drag.aim_point); }
	else { shot_drag.aim_point = p.clone(); aimShotAt(g, p); }
	refreshShot(g);
	Project.saved = false;
}
function onShotUp(event) {
	if (!shot_drag) return;
	event.stopPropagation();
	const g = shot_drag.g;
	shot_drag = null;
	Undo.finishEdit('Move shot', {outliner: true, elements: g.children.slice(), groups: [g]});
	refreshShot(g);
	updatePanel(true);
}

// a thing into a hand ('r', 'l') or into both: its grip is the point of it nearest the fist
function toHand(root, side, drop, mass) {
	if (!root) { Blockbench.showQuickMessage(tr('msg_spawn_first'), 2500); return; }
	const bones = bonesOf(root);
	const hand = s => bones.find(g => roleOf(g) == 'hand' && sideOfGroup(g, bones) == (s == 'r' ? 1 : -1));
	const main = hand(side == 'l' ? 'l' : 'r'), other = side == 'both' ? hand('l') : null;
	if (!main) { Blockbench.showQuickMessage(tr('msg_item_bone'), 3000); return; }
	// the thing: the selected group, or the selected cubes / meshes (put in a group of their own)
	const g = Group.first_selected;
	const els = (Outliner.selected || []).filter(isPart).filter(c => !bones.includes(c.parent));
	const box = new THREE.Box3();
	if (g && !bones.includes(g) && g !== root && !isShot(g)) { g.mesh.updateMatrixWorld(true); box.setFromObject(g.mesh); }
	else els.forEach(c => { if (c.mesh) { c.mesh.updateMatrixWorld(true); box.union(new THREE.Box3().setFromObject(c.mesh)); } });
	if (box.isEmpty()) { Blockbench.showQuickMessage(tr('msg_item_select'), 3500); return; }
	const grip_w = box.clampPoint(boneCenter(main), new THREE.Vector3());
	const other_w = other ? box.clampPoint(boneCenter(other), new THREE.Vector3()) : null;
	attachItem(root, main.uuid, drop, mass, (item, wrap_center) => {
		const toLocal = p => wrap_center ? p.clone().sub(new THREE.Vector3(...wrap_center)) : item.mesh.worldToLocal(p.clone());
		const r2 = v => v.toArray().map(x => Math.round(x * 100) / 100);
		return {hands: side, grip: r2(toLocal(grip_w)), grip_other: other_w ? r2(toLocal(other_w)) : null};
	});
}

const onSelection = () => updatePanel();
let poll = null;

if (typeof __RAGDOLL_EXPORT !== 'undefined') __RAGDOLL_EXPORT({skeletonEditing: {down: e => onSkeletonDown(e), move: e => onSkeletonMove(e), up: e => onSkeletonUp(e), set: v => { pose_edit = v; syncSkeletonView(true); }, get: () => ({skeleton, drag})}, getCurrent: () => current, AnimationFollower, animatedGroupWorld, routeFor, addRoute, addRoutePoint, routePoints, isRoute, characterData, saveCharacterModel, createSavedCharacter, savedModels, deleteSavedModel, panelComponent, npcSpec, skeletonOf, dragSkeleton, aimBone, reachWith, attachItem, itemsOf, shotDirection, createCharacter, characterSpec, autoRig, classifyParts, roleOfName, roleOf, zoneOfRole, rotationSigns, bbOfThree, quatOfThree, POSES, RagdollRuntime, physicsHook, BloodFX, Humanoid, castRay, BloodSim, BloodView, BodyBlood, bloodShape, splashAtlas, smokePuff, humanoidSpec, blood_bakes, BloodPlayer, BloodRecorder, buildRagdoll, bonesOf, envelope, flinchEnvelope, zoneOfName, hingeByName, ragdollOf, boneOf, DEFAULT_RAGDOLL, DEFAULT_BONE, DEFAULT_REACTION, NumberField, panelComponent, STYLE, getCurrent: () => current});

if (typeof Plugin !== 'undefined' && typeof Blockbench !== 'undefined') Plugin.register('ragdoll', {
	title: 'Ragdoll',
	author: 'Claude',
	description: 'A physical character with muscles that reacts to being shot or pushed: flinches, saved reaction poses (hands on the head), falls when hit hard. Baked to a normal animation.',
	about: 'Open the **Ragdoll** tab, select the group of a character (a group with bone groups inside) and press **Build**. Every bone becomes a physics body and every joint a real joint with limits and a **muscle**: a spring that holds the bone in its pose. **Muscle tone** is how stiff the muscles are, **Flinch** how much they tighten around a hit. A **hit** pushes the bone it touches: press Play, turn **Shoot** on and click the character in the 3D view (shots are recorded and replayed when you bake). **Reactions** are poses you save (pose the bones, press Capture): after a hit in their zone the character moves into the pose, for example hands on the head. A hard hit (**Knock down**) switches the muscles off and the character falls. Play and Bake use the Physics tab, so the result is baked into a normal animation of the bones. Needs physics.js 0.8 or newer.',
	icon: 'accessibility_new',
	version: '0.10.2',
	variant: 'both',
	min_version: '4.10.0',
	tags: ['Animation'],
	onload() {
		properties.push(new Property(Group, 'object', 'ragdoll', {default: null}));
		properties.push(new Property(Group, 'object', 'bone', {default: null}));
		properties.push(new Property(Group, 'object', 'ragdoll_shot', {default: null}));
		properties.push(new Property(Group, 'object', 'ragdoll_route', {default: null}));
		for (const type of [Group, Cube, Mesh]) properties.push(new Property(type, 'object', 'attach', {default: null}));
		style_node = Blockbench.addCSS(STYLE);
		mode = new Mode('ragdoll', {
			name: tr('mode'),
			icon: 'accessibility_new',
			category: 'navigate',
			condition: () => Project && Format && Format.id != 'image',
			default_tool: 'move_tool',
			onSelect() { updatePanel(true); },
			onUnselect() { shoot_mode = false; click_shot = false; pose_edit = false; removeSkeletonView(); removeArrow(); removeShotLines(); const a = api(); if (a) a.reset(); },
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
		// moving and rotating bones in the ragdoll tab (to pose a reaction): the same way the Physics tab allows its tools
		for (const tool of [BarItems.move_tool, BarItems.rotate_tool]) {
			try {
				if (!tool) continue;
				letToolIntoMode(tool, 'ragdoll', tool_patches);
			} catch (err) { console.warn('[Ragdoll] tool', err); }
		}
		globalThis.__physicsHooks = (globalThis.__physicsHooks || []).filter(h => h !== physicsHook).concat([physicsHook]);
		document.addEventListener('pointerdown', onRoutePress, true);
		document.addEventListener('pointerdown', onClick, true);
		document.addEventListener('pointerdown', onClickShot, true);
		document.addEventListener('pointerdown', onShotDown, true);
		document.addEventListener('pointermove', onShotMove, true);
		document.addEventListener('pointerup', onShotUp, true);
		document.addEventListener('pointerdown', onSkeletonDown, true);
		document.addEventListener('pointermove', onSkeletonMove, true);
		document.addEventListener('pointerup', onSkeletonUp, true);
		window.addEventListener('pointerup', onSkeletonUp, true);
		window.addEventListener('blur', endSkeletonDrag);
		poll = setInterval(() => { updatePanel(); syncShotLines(); syncRouteView(); if (!drag) syncSkeletonView(); }, 250);
		Blockbench.on('update_selection', onSelection);
		Blockbench.on('display_animation_frame', updateBloodPlayback);
		Blockbench.on('select_project', onSelection);
	},
	onunload() {
		if (poll) clearInterval(poll);
		removeArrow(); removeShotLines(); pose_edit = false; click_shot = false; removeSkeletonView(); removeRouteView();
		document.removeEventListener('pointerdown', onRoutePress, true);
		document.removeEventListener('pointerdown', onClick, true);
		document.removeEventListener('pointerdown', onClickShot, true);
		document.removeEventListener('pointerdown', onShotDown, true);
		document.removeEventListener('pointermove', onShotMove, true);
		document.removeEventListener('pointerup', onShotUp, true);
		document.removeEventListener('pointerdown', onSkeletonDown, true);
		document.removeEventListener('pointermove', onSkeletonMove, true);
		document.removeEventListener('pointerup', onSkeletonUp, true);
		window.removeEventListener('pointerup', onSkeletonUp, true);
		window.removeEventListener('blur', endSkeletonDrag);
		globalThis.__physicsHooks = (globalThis.__physicsHooks || []).filter(h => h !== physicsHook);
		tool_patches.splice(0).forEach(undo => { try { undo(); } catch (err) { /* already gone */ } });
		Blockbench.removeListener('update_selection', onSelection);
		Blockbench.removeListener('display_animation_frame', updateBloodPlayback);
		stopBloodPlayback();
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
