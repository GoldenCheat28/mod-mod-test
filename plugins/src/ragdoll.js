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

/* @include lib/humanoid.js */
/* @include lib/blood_tex.js */
/* @include lib/blood.js */
/* @include lib/decal_geometry.js */
/* @include lib/blood_view.js */
/* @include lib/blood_bake.js */

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
	version: '0.9.7',
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
