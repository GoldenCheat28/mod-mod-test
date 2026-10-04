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
const HIT_PART_SPEED = 12;   // m/s: the most a hit throws the part it struck (the rest of its push goes on into the body)
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
		[AX.rx, AX.ry, AX.rz].forEach((axis, i) => {
			let lo = [d.lo.x, d.lo.y, d.lo.z][i], hi = [d.hi.x, d.hi.y, d.hi.z][i];
			if (lo > hi) { st.MakeFreeAxis(axis); return; }
			const cap = i == 0 ? Math.PI : Math.PI - 0.05;
			lo = Math.max(-cap, Math.min(lo, now[i] - 0.12)); hi = Math.min(cap, Math.max(hi, now[i] + 0.12));
			st.SetLimitedAxis(axis, lo, hi);
		});
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
		// what he holds is dropped (if the item is set to drop)
		for (const it of this.items) if (it.drop && it.constraint) {
			try { this.world.system.RemoveConstraint(it.constraint); if (it.other_constraint) this.world.system.RemoveConstraint(it.other_constraint); } catch (err) { console.warn('[Ragdoll]', err); }
			it.constraint = null; it.other_constraint = null;
			it.entry.body.SetAllowSleeping(true);
		}
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
