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

const DEFAULT_RAGDOLL = {enabled: true, total_mass: 70, tone: 0.6, power: 1, flinch: 0.7, radius: 32, pin: 'until_limp', limp: 0, limp_time: 0, friction: 0.5, shot: 40, auto_react: true, react_scale: 1, facing: 'north', shot_part: 'auto', shot_yaw: 0, shot_pitch: 8, shot_time: 0.5, hits: [], reactions: [], poses: [], npc: false, blood: false, blood_amount: 1, bleed: 1, head_kills: true, balance: 1};
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
		add('upper_arm_' + side, 'chest', [0.25 * sx, 1.3, 0], {cap: [0.052, 0.3], rot: none}, 2.1, [0.22 * sx, 1.43, 0], m(arm_lo, arm_hi, false), m(arm_lo, arm_hi, true), 14, 130);
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
const HUMANOID_PARTS = humanoidParts();
// a part of the game -> the bone of a character made here (role, side)
const humanoidRole = name => {
	const base = name.replace(/_[rl]$/, '');
	return {role: ({upper_arm: 'upperarm'})[base] || base, side: /_r$/.test(name) ? 1 : /_l$/.test(name) ? -1 : 0};
};

// The standing pose the muscles hold (_compose_pose with no walking), and the legs of the held poses (HOLD_LEGS).
const HOLD_LEGS = {
	squat: [0.35, gv(1.9, 0.12, 0.35), gv(-2.35, 0, 0), gv(0.55, 0, 0)],
	kneel: [0.0, gv(0.06, 0.0, 0.06), gv(-1.57, 0, 0), gv(-1.25, 0, 0)],
	sit: [-0.08, gv(1.57, 0.05, 0.12), gv(-1.5, 0, 0), gv(0.0, 0, 0)],
};

// The pose a character is made in: joint angles per part (right side; the left one mirrored), in radians (Godot euler)
function humanoidPose(posture) {
	const a = {upper_arm: gv(0.05, 0, 0.08), forearm: gv(0.2, 0, 0), hand: gv(0.1, 0, 0), thigh: gv(0, 0, 0.04), shin: gv(-0.06, 0, 0), foot: gv(0, 0, 0)};
	const t = {abdomen: gv(), chest: gv(), head: gv()};
	if (HOLD_LEGS[posture]) { const l = HOLD_LEGS[posture]; a.thigh = l[1].clone(); a.shin = l[2].clone(); a.foot = l[3].clone(); t.pelvis_lean = l[0]; }
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
		this.posture = POSTURES.includes(this.s.posture) ? this.s.posture : 'stand';
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
		this.rest_rot = new THREE.Quaternion().setFromRotationMatrix(root_m);
		const restWorld = p => p.clone().multiplyScalar(s).add(offset).multiplyScalar(SCALE).applyMatrix4(root_m).divideScalar(SCALE);
		this.parts = [];
		this.part_index = {};
		this.total_mass = 0;
		for (const d of HUMANOID_PARTS) {
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
			if (entry && holder) this.items.push({node, entry, holder, drop: node.attach.drop !== false, constraint: null});
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
				const st = new J.FixedConstraintSettings();
				st.mSpace = J.EConstraintSpace_WorldSpace;
				st.mAutoDetectPoint = true;
				it.constraint = J.castObject(st.Create(it.holder.body, it.entry.body), J.FixedConstraint);
				world.system.AddConstraint(it.constraint);
			} catch (err) { console.warn('[Ragdoll] item', err); }
		});
		this.filter = filter;
		this.ray_exclude = new Set(this.parts.map(p => p.id.GetIndexAndSequenceNumber()));
		addPeopleToRays(this.rt, this.parts.map(p => p.id));
		for (const p of this.parts) if (p.parent >= 0) this.makeJoint(p);
		this._set_limp(false, true);
		// a seat under him (sat on a chair)
		if (this.posture == 'sit') {
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
		const d = HUMANOID_PARTS[this.parts.indexOf(p)];
		[AX.rx, AX.ry, AX.rz].forEach((axis, i) => {
			const lo = [d.lo.x, d.lo.y, d.lo.z][i], hi = [d.hi.x, d.hi.y, d.hi.z][i];
			if (lo > hi) st.MakeFreeAxis(axis); else st.SetLimitedAxis(axis, lo, hi);
		});
		const c = J.castObject(st.Create(par.body, p.body), J.SixDOFConstraint);
		J.destroy(st);
		for (const axis of [AX.rx, AX.ry, AX.rz]) c.SetMotorState(axis, J.EMotorState_Velocity);
		world.system.AddConstraint(c);
		p.joint = c;
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

	// ---- Simulation ----

	step(dt) {
		this.pending.splice(0).forEach(h => this.applyHit(h));
		while (this.next_hit < this.hits.length && this.hits[this.next_hit].t <= this.time + 1e-9) this.applyHit(this.hits[this.next_hit++]);
		this._time += dt;
		this._update_health(dt);
		this._update_state(dt);
		this._compose_pose(dt);
		this._apply_muscles();
		if (this.support > 0.001) this._apply_balance();
		this._update_squat_hold(dt);
		this._limit_speed();
		this.time += dt;
	}

	// a part of a person squeezed into something can be shot out of it at silly speeds: no part moves faster than a blast throws it
	_limit_speed() {
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
			const low = ['crouch', 'kneel', 'squat', 'sit'].includes(this.posture);
			if (tipped || (h > 0 && h < this.stand_height * 0.42 && !low) || this.mobility() < 0.2) this._fall(tipped ? 'tipped' : h > 0 && h < this.stand_height * 0.42 ? 'low' : 'mobility');
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
		if (['kneel', 'crouch', 'squat', 'sit'].includes(this.posture)) { this._unbalanced_t = 0; return false; }
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
		for (const side of ['r', 'l']) {
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
		this._pose_set('abdomen', gv(-0.02 * run, 0.07 * Math.sin(this._phase) * walk, 0));
		this._pose_set('chest', gv(-0.025 * run + 0.015 * Math.sin(this._time * 1.7), -0.05 * Math.sin(this._phase) * walk, 0));

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
		// fallen but conscious: catch the fall, then curl or push up
		if (this.fallen) {
			if (this._getup > 0) this._pose_getup(this._getup);
			else if (this._fallen_time < 1.2 && this.lin(this.pelvis).length() > 0.6) this._pose_catch_fall();
			else this._pose_writhe();
		}
	}

	facing() {
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
	_spasm() { const t = this._death_t; return gsmooth(0, 0.08, t) * (1 - gsmooth(0.35, HEADSHOT_SPASM, t)); }

	// weak, involuntary arm posture right after a brain injury: the fists drawn in to the wound, the body draws in a little
	_pose_decerebrate() {
		const t = this._death_t, k = this._spasm();
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
			if (this._death_kind == 'headshot' && this._death_t >= 0 && this._death_t < HEADSHOT_SPASM && c.arm == 1) t_i = Math.max(t_i, 0.95 * this._spasm());
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
		else if (this.posture == 'sit' && this.seat) target_h = 0.13 * s;
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
		const p_target = this.posture == 'squat' ? rotAbout(target, tx, -this.SQ_LEAN) : target;
		this._upright_torque(this.pelvis, p_target, 9.0, 7.0 * sup);
		let ch_target = target;
		if (this.posture == 'crouch' || this.posture == 'cover_head') ch_target = rotAbout(target, tx, -0.6);
		else if (this.posture == 'squat') ch_target = rotAbout(target, tx, -0.55);
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

	receive_hit(body, point, dir, impulse, weapon) {
		this.wake();
		// the impulse at the point it hit
		const com = this.pos(body), imp = dir.clone().multiplyScalar(impulse);
		this.world.tmp.Set(imp.x, imp.y, imp.z);
		this.world.bodies.AddImpulse(body.id, this.world.tmp);
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
		// what he holds is dropped (if the item is set to drop)
		for (const it of this.items) if (it.drop && it.constraint) {
			try { this.world.system.RemoveConstraint(it.constraint); } catch (err) { console.warn('[Ragdoll]', err); }
			it.constraint = null;
			it.entry.body.SetAllowSleeping(true);
		}
	}

	// ---- Held poses (squatting, kneeling, sitting): balancing those with muscles only ever looks like fidgeting, so once
	// he is in one the whole body is placed from the pose's joint angles (forward kinematics from the hips); anything that
	// happens to him gives the body back to physics at once ----

	_hold_kind() {
		if (this.posture == 'squat') return 'squat';
		if (this.posture == 'kneel') return 'kneel';
		if (this.posture == 'sit' && this.seat) return 'sit';
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
		const legs = HOLD_LEGS[kind];
		const ang = this._hold_angle.map(a => a.clone());
		for (const side of ['r', 'l']) {
			const m = side == 'r' ? gv(1, 1, 1) : gv(1, -1, -1);
			ang[this.part_index['thigh_' + side]] = legs[1].clone().multiply(m);
			ang[this.part_index['shin_' + side]] = legs[2].clone().multiply(m);
			ang[this.part_index['foot_' + side]] = legs[3].clone().multiply(m);
		}
		const fwd = this.facing();
		const yaw_b = glook(fwd, gv(0, 1, 0));
		const root_b = yaw_b.clone().multiply(new THREE.Quaternion().setFromAxisAngle(gv(1, 0, 0), -legs[0]));
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
	for (const d of HUMANOID_PARTS) ang[d.name] = gv();
	for (const sd of ['r', 'l']) {
		side('thigh', sd, gv(0, 0, 0.04)); side('shin', sd, gv(-0.06, 0, 0)); side('foot', sd, gv(0, 0, 0));
		side('upper_arm', sd, gv(0.05, 0, 0.08)); side('forearm', sd, gv(0.2, 0, 0)); side('hand', sd, gv(0.1, 0, 0));
	}
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
	if (HOLD_LEGS[posture]) {
		const l = HOLD_LEGS[posture];
		lean = l[0];
		for (const sd of ['r', 'l']) { side('thigh', sd, l[1]); side('shin', sd, l[2]); side('foot', sd, l[3]); }
	}
	// forward kinematics of the posture (metres, the game's rest frame); the hips are where the lowest point lands on the
	// ground (or the pelvis on the seat)
	const parts = HUMANOID_PARTS.map(d => ({d, rest: d.center.clone().multiplyScalar(s), joint: d.joint ? d.joint.clone().multiplyScalar(s) : null}));
	const index = Object.fromEntries(HUMANOID_PARTS.map((d, i) => [d.name, i]));
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


function hasHumanoidParts(bones) {
	const need = HUMANOID_PARTS.map(d => humanoidRole(d.name));
	return need.every(n => bones.some(g => roleOf(g) == n.role && (!n.side || sideOfGroup(g, bones) == n.side)));
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
			try {
				// a person of the Blood project (its 15 body parts are all there): the game's body, muscles and mind
				const bones = bonesOf(root);
				if (ragdollOf(root).npc && hasHumanoidParts(bones)) list.push(new Humanoid(rt, root, bones));
				else list.push(new RagdollRuntime(rt, root));
			} catch (err) { console.warn('[Ragdoll]', root.name, err); }
		}
		let blood = null;
		if (list.some(r => r.s.blood)) { try { blood = new BloodFX(rt); } catch (err) { console.warn('[Ragdoll] blood', err); } }
		for (const r of list) r.blood = r.s.blood ? blood : null;
		current = {rt, list, blood};
	},
	step(rt, dt) {
		if (!current || current.rt !== rt) return;
		for (const r of current.list) r.step(dt);
		if (current.blood) current.blood.step(dt);
	},
	show() { if (current && current.blood) current.blood.show(); },
	stop() {
		if (current && current.blood) { try { current.blood.dispose(); } catch (err) { /* scene is gone */ } }
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
	stand: {   // relaxed: arms hang with a little bend at the elbows, the feet turned out a little, knees not locked
		upperarm: {x: -4, z: -6}, forearm: {x: 14, z: 0}, hand: {x: 4, z: 0}, thigh: {x: 2, z: 2}, shin: {x: -3, z: 0}, foot: {x: 1, y: 8},
		abdomen: {x: 0}, chest: {x: 1}, neck: {x: 2}, head: {x: -1}, pelvis: {x: 0},
	},
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
	stand: {upperarm: {x: -3, z: -5}, forearm: {x: 10, z: 0}, hand: {x: 4, z: 0}, thigh: {x: 1, z: 1}, shin: {x: -2, z: 0}, foot: {x: 1, y: 6}},
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
		add('Upper Arm ' + L, 'upperarm', 'Chest', [s * 0.22, hi(1.43), 0], [cube([s * 0.25, hi(1.3), 0], [0.116, 0.32, 0.116], 'shirt'), cube([s * 0.25, hi(1.42), 0], [0.124, 0.12, 0.124], 'shirt')], [r(P.upperarm, 'x'), 0, -s * r(P.upperarm, 'z')]);
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
		model: 'Model', model_npc: 'Blood NPC (from the Godot project)', model_mannequin: 'Plain mannequin',
		living: 'Living body', npc: 'NPC: balance, health, falls, death', npc_tip: 'Blood, pain and shock; legs give way; it stumbles and falls, faints, dies. Hips are free (no pin).',
		head_kills: 'A head shot kills', balance: 'Balance', balance_tip: 'How strongly it keeps its feet. 0 = it falls at once', bleed: 'Bleeding ×', bleed_tip: 'How fast blood is lost',
		blood: 'Blood', blood_amount: 'Amount ×', blood_note: 'Blood is shown while the simulation plays (not baked into the animation).',
		add_character: 'Add a character', pose: 'Pose', pose_stand: 'Standing, relaxed', pose_sit: 'Sitting, hands on knees', height: 'Height (px)', add_character_btn: 'Add the default character',
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
		mode: 'Регдолл', build: 'Создать регдолл из выбранной группы', remove: 'Убрать регдолл', play: '▶ Пуск', pause: '❚❚ Пауза', reset: '⟲ Сброс', bake: '⏺ Запечь в анимацию',
		select_hint: 'Выделите группу персонажа (группа с костями-группами внутри: таз, торс, голова, руки, ноги…) и нажмите «Создать».',
		character: 'Персонаж', bones: 'костей', mass_total: 'Общая масса (кг)', tone: 'Тонус мышц', tone_tip: '0 = обмякший как тряпка, 1 = жёсткие мышцы держат позу',
		power: 'Сила мышц', flinch: 'Сокращение', flinch_tip: 'Насколько сильно напрягаются мышцы вокруг попадания', radius: 'Радиус сокращения (px)',
		pin: 'Таз', pin_none: 'Свободный (падает сразу)', pin_until: 'Держится до сильного удара', pin_always: 'Держится всегда',
		shot: 'Сила выстрела (Н·с)', shot_tip: 'Сила выстрела кликом: пуля 3–10, удар кулаком 50–150', limp: 'Сбить с ног при импульсе', limp_tip: 'Такой сильный удар (Н·с) выключает мышцы, и персонаж падает. 0 = никогда', limp_time: 'Обмякает на (с)', limp_time_tip: '0 = до конца',
		bone: 'Выбранная кость', joint: 'Сустав', j_ball: 'Шаровой (плечо, бедро, шея)', j_hinge: 'Шарнир (локоть, колено)', j_fixed: 'Жёсткий',
		swing: 'Отклонение (°)', twist: 'Кручение (±°)', axis: 'Ось шарнира', hmin: 'Шарнир от (°)', hmax: 'Шарнир до (°)', strength: 'Сила мышцы', zone: 'Зона',
		z_auto: 'Автоматически', z_head: 'Голова', z_torso: 'Торс', z_arms: 'Руки', z_legs: 'Ноги', z_any: 'Любая',
		model: 'Модель', model_npc: 'NPC из Blood (Godot-проект)', model_mannequin: 'Простой манекен',
		living: 'Живое тело', npc: 'NPC: баланс, здоровье, падение, смерть', npc_tip: 'Кровь, боль и шок; ноги подкашиваются; персонаж шатается и падает, теряет сознание, умирает. Таз свободный (без фиксации).',
		head_kills: 'Выстрел в голову убивает', balance: 'Баланс', balance_tip: 'Насколько крепко держится на ногах. 0 — падает сразу', bleed: 'Кровотечение ×', bleed_tip: 'Как быстро теряется кровь',
		blood: 'Кровь', blood_amount: 'Количество ×', blood_note: 'Кровь видна, пока идёт симуляция (в запечённую анимацию не попадает).',
		add_character: 'Добавить персонажа', pose: 'Поза', pose_stand: 'Стоит, расслабленно', pose_sit: 'Сидит, руки на коленях', height: 'Рост (px)', add_character_btn: 'Добавить персонажа по умолчанию',
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
			Object.assign(vue, {total_mass: s.total_mass, tone: s.tone, power: s.power, flinch: s.flinch, radius: s.radius, pin: s.pin, limp: s.limp, limp_time: s.limp_time, shot: s.shot, auto_react: s.auto_react, react_scale: s.react_scale, facing: s.facing, shot_part: s.shot_part, shot_yaw: s.shot_yaw, shot_pitch: s.shot_pitch, shot_time: s.shot_time, npc: s.npc, blood: s.blood, blood_amount: s.blood_amount, bleed: s.bleed, head_kills: s.head_kills, balance: s.balance,
				bone_list: bonesOf(root).map(g => ({uuid: g.uuid, name: g.name})), poses: s.poses.map(p => ({name: p.name})), items: itemsOf(root).map(n => ({uuid: n.uuid, name: n.name, bone_name: ((bonesOf(root).find(g => g.uuid == n.attach.bone)) || {}).name || '?', drop: n.attach.drop !== false})),
				root_name: root.name, bone_count: bonesOf(root).length, hits: s.hits.map(h => Object.assign({}, h)), reactions: s.reactions.map(r => Object.assign({name: '', zone: 'any', hold: 0.8, tension: 1}, r, {pose_count: Object.keys(r.pose || {}).length}))});
			vue.is_bone = !!(sel && sel.bone && sel.bone.joint);
			if (vue.is_bone) Object.assign(vue, {joint: boneOf(sel).joint, swing: boneOf(sel).swing, twist: boneOf(sel).twist, hinge_axis: boneOf(sel).hinge_axis, hmin: boneOf(sel).hmin,
				hmax: boneOf(sel).hmax, strength: boneOf(sel).strength, zone: boneOf(sel).zone});
		}
	}
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
			return {selection_key: null, has_selection: false, has_root: false, is_bone: false, sel_name: '', root_name: '', bone_count: 0, state: 'stopped', shoot: false, sim_time: '0.00',
				total_mass: 70, tone: 0.6, power: 1, flinch: 0.7, radius: 32, pin: 'until_limp', limp: 0, limp_time: 0, shot: 40, auto_react: true, react_scale: 1, facing: 'north', shot_part: 'auto', shot_yaw: 0, shot_pitch: 8, shot_time: 0.5, bone_list: [], poses: [], items: [], pose_edit: false, pose_name: 'My pose', item_bone: '', item_drop: true, item_mass: 1, new_pose: 'stand', new_model: 'npc', new_height: 28.6, npc: false, blood: false, blood_amount: 1, bleed: 1, head_kills: true, balance: 1,
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
						npc: !!this.npc, blood: !!this.blood, blood_amount: clamp(num_(this.blood_amount, 1), 0, 5), bleed: clamp(num_(this.bleed, 1), 0, 20), head_kills: !!this.head_kills, balance: clamp(num_(this.balance, 1), 0, 2)});
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
			toggleEdit() { pose_edit = !pose_edit; if (pose_edit) shoot_mode = false; syncSkeletonView(true); updatePanel(true); },
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

				<details class="rd_box" :open="!has_root">
					<summary>{{ t('add_character') }}</summary>
					<label class="rd_row">{{ t('model') }}
						<select v-model="new_model"><option value="npc">{{ t('model_npc') }}</option><option value="mannequin">{{ t('model_mannequin') }}</option></select>
					</label>
					<label class="rd_row">{{ t('pose') }}
						<select v-model="new_pose"><option value="stand">{{ t('pose_stand') }}</option><option value="sit">{{ t('pose_sit') }}</option></select>
					</label>
					<div class="rd_grid"><rope-num :label="t('height')" v-model="new_height" :min="8" :max="200" :step="0.5" :decimals="1"></rope-num></div>
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
						<template v-if="npc">
							<label class="rd_row">{{ t('head_kills') }}<input type="checkbox" v-model="head_kills" @change="saveRoot()"></label>
							<div class="rd_grid">
								${num('balance', 'balance', 0, 2, 0.05, 2, 'balance_tip', 'saveRoot()')}
								${num('bleed', 'bleed', 0, 20, 0.1, 1, 'bleed_tip', 'saveRoot()')}
							</div>
						</template>
						<label class="rd_row">{{ t('blood') }}<input type="checkbox" v-model="blood" @change="saveRoot()"></label>
						<div class="rd_grid" v-if="blood">${num('blood_amount', 'blood_amount', 0, 5, 0.1, 1, null, 'saveRoot()')}</div>
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

function attachItem(root, bone_uuid, drop, mass) {
	const bone = bonesOf(root).find(g => g.uuid == bone_uuid);
	if (!bone) { Blockbench.showQuickMessage(tr('msg_item_bone'), 3000); return; }
	const bones = bonesOf(root), g = Group.first_selected;
	const cubes = (Outliner.selected || []).filter(isPart).filter(c => !bones.includes(c.parent));
	let item = null, wrap = false;
	if (g && g !== root && !bones.includes(g) && (!cubes.length || cubes.every(c => c.parent === g))) item = g;
	else if (cubes.length) wrap = true;
	if (!item && !wrap) { Blockbench.showQuickMessage(tr('msg_item_select'), 3500); return; }
	Undo.initEdit({outliner: true, elements: cubes, groups: [root, bone].concat(item ? [item] : [])});
	if (wrap) {
		const box = new THREE.Box3();
		cubes.forEach(c => { if (c.mesh) { c.mesh.updateMatrixWorld(true); box.union(new THREE.Box3().setFromObject(c.mesh)); } });
		const center = box.isEmpty() ? [0, 0, 0] : box.getCenter(new THREE.Vector3()).toArray().map(v => Math.round(v * 100) / 100);
		item = new Group({name: (cubes[0].name || 'item') + ' (held)', origin: center});
		item.addTo('root').init();
		cubes.forEach(c => c.addTo(item));
	}
	item.attach = {root: root.uuid, bone: bone.uuid, drop: !!drop};
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

const PRINCIPAL = {pelvis: 'abdomen', abdomen: 'chest', chest: 'neck', neck: 'head', upperarm: 'forearm', forearm: 'hand', thigh: 'shin', shin: 'foot'};

// the bones of a character with what is needed to move them: the pivot, the end (the joint of the next bone, or the far end)
function skeletonOf(root) {
	const bones = bonesOf(root);
	const bone_of = g => { for (let p = g.parent; p && p != 'root'; p = p.parent) if (bones.includes(p)) return p; return null; };
	const info = new Map(bones.map(g => [g, {g, role: roleOf(g), parent: null, children: [], principal: null, end_local: null}]));
	bones.forEach(g => { const p = bone_of(g); if (p) { info.get(g).parent = info.get(p); info.get(p).children.push(info.get(g)); } });
	scene.updateMatrixWorld(true);
	for (const i of info.values()) {
		const want = PRINCIPAL[i.role];
		i.principal = i.children.find(c => c.role == want) || (i.children.length == 1 ? i.children[0] : null);
		if (!i.principal) {
			// the far end of the cubes of this bone, seen from its pivot
			const pivot = i.g.mesh.getWorldPosition(new THREE.Vector3()), box = new THREE.Box3();
			directParts(i.g).forEach(el => { if (el.mesh) { el.mesh.updateMatrixWorld(true); box.union(new THREE.Box3().setFromObject(el.mesh)); } });
			let far = pivot, best = -1;
			if (!box.isEmpty()) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
				const p = new THREE.Vector3(x, y, z), d = p.distanceTo(pivot);
				if (d > best) { best = d; far = p; }
			}
			i.end_local = i.g.mesh.worldToLocal(far.clone());
		}
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
let pose_edit = false, drag = null;

function removeSkeletonView() {
	if (skeleton && skeleton.group && skeleton.group.parent) skeleton.group.parent.remove(skeleton.group);
	skeleton = null;
}
function syncSkeletonView(rebuild) {
	const sel = Project && typeof Modes != 'undefined' && Modes.ragdoll ? Group.first_selected : null, root = sel && rootOf(sel);
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
	let best = null, best_d = 16;
	skeleton.infos.forEach((i, k) => {
		const s = screenPoint(skeleton.handles[k].position, preview), d = Math.hypot(s.x - event.clientX, s.y - event.clientY);
		if (d < best_d) { best_d = d; best = i; }
	});
	if (!best) return;
	event.stopPropagation(); event.preventDefault();
	const camera_dir = preview.camera.getWorldDirection(new THREE.Vector3());
	drag = {info: best, preview, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera_dir, endWorld(best))};
	const groups = bonesOf(skeleton.root);
	Undo.initEdit({outliner: true, groups});
	drag.groups = groups;
	syncSkeletonView();
}
function onSkeletonMove(event) {
	if (!drag) return;
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
	Undo.finishEdit('Pose skeleton', {outliner: true, groups: drag.groups});
	drag = null;
	syncSkeletonView();
	updatePanel(true);
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

const onSelection = () => updatePanel();
let poll = null;

if (typeof __RAGDOLL_EXPORT !== 'undefined') __RAGDOLL_EXPORT({npcSpec, skeletonOf, dragSkeleton, aimBone, reachWith, attachItem, itemsOf, shotDirection, createCharacter, characterSpec, autoRig, classifyParts, roleOfName, roleOf, zoneOfRole, rotationSigns, bbOfThree, quatOfThree, POSES, RagdollRuntime, physicsHook, BloodFX, Humanoid, HUMANOID_PARTS, castRay, buildRagdoll, bonesOf, envelope, flinchEnvelope, zoneOfName, hingeByName, ragdollOf, boneOf, DEFAULT_RAGDOLL, DEFAULT_BONE, DEFAULT_REACTION, NumberField, panelComponent, STYLE, getCurrent: () => current});

if (typeof Plugin !== 'undefined' && typeof Blockbench !== 'undefined') Plugin.register('ragdoll', {
	title: 'Ragdoll',
	author: 'Claude',
	description: 'A physical character with muscles that reacts to being shot or pushed: flinches, saved reaction poses (hands on the head), falls when hit hard. Baked to a normal animation.',
	about: 'Open the **Ragdoll** tab, select the group of a character (a group with bone groups inside) and press **Build**. Every bone becomes a physics body and every joint a real joint with limits and a **muscle**: a spring that holds the bone in its pose. **Muscle tone** is how stiff the muscles are, **Flinch** how much they tighten around a hit. A **hit** pushes the bone it touches: press Play, turn **Shoot** on and click the character in the 3D view (shots are recorded and replayed when you bake). **Reactions** are poses you save (pose the bones, press Capture): after a hit in their zone the character moves into the pose, for example hands on the head. A hard hit (**Knock down**) switches the muscles off and the character falls. Play and Bake use the Physics tab, so the result is baked into a normal animation of the bones. Needs physics.js 0.8 or newer.',
	icon: 'accessibility_new',
	version: '0.4.0',
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
			onUnselect() { shoot_mode = false; pose_edit = false; removeSkeletonView(); removeArrow(); const a = api(); if (a) a.reset(); },
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
				const c = tool.condition;
				if (c && typeof c == 'object' && c.modes instanceof Array) {
					if (c.modes.includes('ragdoll')) continue;
					c.modes.push('ragdoll');
					tool_patches.push(() => c.modes.remove('ragdoll'));
				} else if (typeof c == 'function') {
					tool.condition = (...args) => (Modes.ragdoll && Project && Format && Format.id != 'image') || c(...args);
					tool_patches.push(() => { tool.condition = c; });
				}
			} catch (err) { console.warn('[Ragdoll] tool', err); }
		}
		globalThis.__physicsHooks = (globalThis.__physicsHooks || []).filter(h => h !== physicsHook).concat([physicsHook]);
		document.addEventListener('pointerdown', onClick, true);
		document.addEventListener('pointerdown', onSkeletonDown, true);
		document.addEventListener('pointermove', onSkeletonMove, true);
		document.addEventListener('pointerup', onSkeletonUp, true);
		poll = setInterval(() => { updatePanel(); syncArrow(); if (!drag) syncSkeletonView(); }, 250);
		Blockbench.on('update_selection', onSelection);
		Blockbench.on('select_project', onSelection);
	},
	onunload() {
		if (poll) clearInterval(poll);
		removeArrow(); pose_edit = false; removeSkeletonView();
		document.removeEventListener('pointerdown', onClick, true);
		document.removeEventListener('pointerdown', onSkeletonDown, true);
		document.removeEventListener('pointermove', onSkeletonMove, true);
		document.removeEventListener('pointerup', onSkeletonUp, true);
		globalThis.__physicsHooks = (globalThis.__physicsHooks || []).filter(h => h !== physicsHook);
		tool_patches.splice(0).forEach(undo => { try { undo(); } catch (err) { /* already gone */ } });
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
