(function () {
'use strict';

/*
 * Physics — a "Physics" tab next to Edit / Paint / Animate, powered by Jolt Physics (JoltPhysics.js, MIT).
 *
 * Select cubes, meshes or groups and tick:
 *   Ground          — does not move, other objects land on it
 *   Physics object  — falls and collides
 * A ticked group moves as one solid piece made of everything inside it.
 * Play / Pause / Reset preview the simulation, Bake writes it into a new animation as keyframes.
 * (Blockbench can only animate groups, so Bake puts ticked cubes into their own group; Ctrl+Z undoes all of it.)
 *
 * Liquid: tick "Liquid source" on a cube and it shoots drops (blood, water...) that splash off everything.
 * Bake records the liquid too; it plays back in the Animate tab with the timeline (kept while Blockbench is open).
 *
 * Units: 16 Blockbench pixels = 1 meter, so a 16px cube is a 1m crate and gravity is 9.81 m/s².
 */

const SCALE = 16;
const FIXED_DT = 1 / 120;
const LAYER_STATIC = 0, LAYER_MOVING = 1;

const DEFAULT_BODY = {type: 'none', mass: 1, friction: 0.5, restitution: 0.3, velocity: [0, 0, 0], spin: [0, 0, 0], impact: false, threshold: 1};
const DEFAULT_WORLD = {gravity: 9.81, chaos: 0.3, ground: true, ground_y: 0, duration: 3, fps: 24, liquid_view: 'surface', bake_quality: 2};

// ---------------------------------------------------------------------------
// Texts (English, or Russian when Blockbench runs in Russian)
// ---------------------------------------------------------------------------

const TEXTS = {
	en: {
		mode: 'Physics', play: '▶ Play', pause: '❚❚ Pause', reset: '⟲ Reset', bake: '● Bake',
		time: 'Time', sec: 's', stopped: 'stopped', playing: 'playing', paused: 'paused',
		selected: 'Selected', select_hint: 'Select cubes, meshes or groups.', moves_with: 'Moves together with',
		ground: 'Ground', ground_desc: 'does not move, things land on it',
		object: 'Physics object', object_desc: 'falls and collides',
		mixed: 'The selection has different settings.', group_solid: 'A ticked group moves as one solid piece.',
		mass: 'Mass (kg)', friction: 'Friction', bounciness: 'Bounciness', velocity: 'Start velocity (m/s)', spin: 'Start spin (°/s)',
		liquid: 'Liquid', liquid_hint: 'Select cubes or meshes to make them a liquid source. A source inside a moving physics group goes along with it.',
		liquid_source: 'Liquid source', liquid_source_desc: 'shoots liquid (blood, water…)',
		color: 'Color', amount: 'Amount (drops)', drop_size: 'Drop size (px)', strength: 'Strength (m/s)',
		spread: 'Spread', shoot_time: 'Shoot time (s)',
		shoot_time_tip: 'How long the source keeps shooting. 0 = everything at once',
		cohesion: 'Cohesion', cohesion_tip: 'How strongly drops hold together (streams and blobs instead of spray)',
		stickiness: 'Stickiness', stickiness_tip: 'How much drops stick to walls and floors instead of sliding or bouncing',
		thickness: 'Thickness', thickness_tip: 'Thick liquids (blood, syrup) move together, thin ones (water) splash apart',
		look: 'Drop thickness (look)', look_tip: 'Only how the flying liquid is drawn: 0 = fine separate droplets, 1 = thick connected streams. Liquid lying on surfaces is drawn a bit flatter. The physics stays the same',
		liquid_gravity: 'Gravity ×', liquid_note: 'The source is hidden while playing.',
		world: 'World', gravity: 'Gravity (m/s²)', chaos: 'Chaos',
		chaos_tip: 'Small random push and spin for every object, because nothing in the real world is perfectly straight. 0 = off',
		infinite_ground: 'Infinite ground', ground_height: 'Ground height (px)',
		liquid_view: 'Liquid view', liquid_view_tip: 'Points shows every drop on its own (debug)', surface: 'Surface', points: 'Points (debug)',
		bake_length: 'Bake length (s)', bake_fps: 'Bake FPS',
		bake_quality: 'Liquid when baking', bake_quality_tip: 'The preview stays fast; Bake computes the liquid again with smaller drops',
		quality_1: 'Like the preview', quality_2: 'High (8× drops)', quality_3: 'Max (27× drops, slow)',
		footnote: '16 px = 1 m. Bake also records the liquid: it plays in the Animate tab (until Blockbench is closed). Bake puts ticked cubes into their own group (Blockbench animates groups only). Ctrl+Z undoes it.',
		tab_object: 'Object', tab_liquid: 'Liquid', tab_forces: 'Forces',
		impact: 'Start on impact', impact_desc: 'drives straight, physics turns on at a hit',
		impact_tip: 'The object keeps its start speed and does not fall, tilt or fall apart until something hits it hard enough',
		threshold: 'Impact threshold (m/s)', threshold_tip: 'How hard the hit must be (sudden change of speed) to turn the physics on',
		aim_hint: 'Aim: turn the source with the Rotate tool, the arrow shows where it shoots.', aim_tip: 'Switch to the Rotate tool',
		rotate_tool: 'Rotate', move_tool: 'Move',
		l_flow: 'Flow', l_material: 'Material', l_view: 'View and bake',
		force: 'Force field', force_desc: 'pushes, pulls or blows (use an empty group)',
		f_kind: 'Type', f_push: 'Push', f_pull: 'Pull', f_wind: 'Wind',
		f_strength: 'Strength (m/s²)', f_strength_tip: 'Negative strength pulls instead of pushing',
		f_radius: 'Radius (px)', f_radius_tip: 'Shown as a sphere. 0 = reaches everywhere (wind only)', f_falloff: 'Fade at the edge',
		f_time: 'Timing', f_ramp: 'Ramp-up (s)', f_ramp_tip: 'Time the force needs to grow from 0 to full strength',
		f_duration: 'Duration (s)', f_duration_tip: '0 = works forever', f_delay: 'Starts at (s)',
		f_noise: 'Noise', f_noise_tip: 'Randomness of the strength and direction, changing in time and place (gusts, creatures)', f_noise_speed: 'Noise speed',
		f_affects: 'Affects', f_objects: 'Objects', f_liquid: 'Liquid',
		f_add: '+ Add force (empty group)', f_hint: 'Select an empty group (or press the button) to make it a force field.',
		f_wind_hint: 'Wind blows along the arrow: aim it with the Rotate tool, place it with the Move tool.',
		f_note: 'The sphere is the radius, the round icon marks the field. Turn the empty with the Rotate tool to aim a wind.',
		msg_nothing: 'Physics: tick "Physics object" or "Liquid source" on something first',
		msg_no_animations: 'Physics: this format has no animations', msg_baked: 'Physics baked into',
	},
	ru: {
		mode: 'Физика', play: '▶ Пуск', pause: '❚❚ Пауза', reset: '⟲ Сброс', bake: '● Запечь',
		time: 'Время', sec: 'с', stopped: 'остановлено', playing: 'идёт', paused: 'пауза',
		selected: 'Выбрано', select_hint: 'Выделите кубы, меши или группы.', moves_with: 'Двигается вместе с',
		ground: 'Земля', ground_desc: 'не двигается, на неё всё падает',
		object: 'Физический объект', object_desc: 'падает и сталкивается',
		mixed: 'У выделенных объектов разные настройки.', group_solid: 'Отмеченная группа движется как одно целое.',
		mass: 'Масса (кг)', friction: 'Трение', bounciness: 'Упругость', velocity: 'Начальная скорость (м/с)', spin: 'Начальное вращение (°/с)',
		liquid: 'Жидкость', liquid_hint: 'Выделите кубы или меши, чтобы сделать их источником жидкости. Источник внутри движущейся группы летит вместе с ней.',
		liquid_source: 'Источник жидкости', liquid_source_desc: 'выплёскивает жидкость (кровь, воду…)',
		color: 'Цвет', amount: 'Количество капель', drop_size: 'Размер капли (px)', strength: 'Сила выплеска (м/с)',
		spread: 'Разброс', shoot_time: 'Время выплеска (с)',
		shoot_time_tip: 'Сколько секунд источник выплёскивает жидкость. 0 = всё сразу',
		cohesion: 'Сцепление', cohesion_tip: 'Насколько капли держатся вместе (струи и комки вместо мелких брызг)',
		stickiness: 'Липкость', stickiness_tip: 'Насколько капли прилипают к стенам и полу, а не скользят и не отскакивают',
		thickness: 'Густота', thickness_tip: 'Густые жидкости (кровь, сироп) движутся вместе, жидкие (вода) разлетаются',
		look: 'Толщина капли (вид)', look_tip: 'Только то, как рисуется летящая жидкость: 0 = мелкие отдельные капли, 1 = толстые сплошные струи. Жидкость на поверхностях рисуется чуть площе. Физика не меняется',
		liquid_gravity: 'Гравитация ×', liquid_note: 'Во время проигрывания источник скрыт.',
		world: 'Мир', gravity: 'Гравитация (м/с²)', chaos: 'Хаос',
		chaos_tip: 'Небольшой случайный толчок и вращение каждому объекту: в жизни ничто не стоит идеально ровно. 0 = выключено',
		infinite_ground: 'Бесконечный пол', ground_height: 'Высота пола (px)',
		liquid_view: 'Вид жидкости', liquid_view_tip: 'Точки показывают каждую каплю отдельно (отладка)', surface: 'Поверхность', points: 'Точки (отладка)',
		bake_length: 'Длина записи (с)', bake_fps: 'Кадров в секунду',
		bake_quality: 'Жидкость при записи', bake_quality_tip: 'Превью остаётся быстрым; при записи жидкость считается заново с более мелкими каплями',
		quality_1: 'Как в превью', quality_2: 'Высокое (×8 капель)', quality_3: 'Максимум (×27 капель, долго)',
		footnote: '16 px = 1 м. «Запечь» записывает и жидкость: она проигрывается во вкладке «Анимация» (пока Blockbench открыт). При записи отмеченные кубы кладутся в свои группы (Blockbench анимирует только группы). Ctrl+Z отменяет.',
		tab_object: 'Объект', tab_liquid: 'Жидкость', tab_forces: 'Силы',
		impact: 'Старт от удара', impact_desc: 'едет прямо, физика включается при ударе',
		impact_tip: 'Объект держит стартовую скорость и не падает, не кренится и не разваливается, пока что-то не ударит его достаточно сильно',
		threshold: 'Порог удара (м/с)', threshold_tip: 'Насколько сильным должен быть удар (резкое изменение скорости), чтобы включилась физика',
		aim_hint: 'Направление: поверните источник инструментом «Вращение», стрелка показывает, куда летит жидкость.', aim_tip: 'Переключиться на вращение',
		rotate_tool: 'Вращение', move_tool: 'Перемещение',
		l_flow: 'Поток', l_material: 'Материал', l_view: 'Вид и запись',
		force: 'Поле силы', force_desc: 'толкает, притягивает или дует (используйте пустую группу)',
		f_kind: 'Тип', f_push: 'Отталкивание', f_pull: 'Притяжение', f_wind: 'Ветер',
		f_strength: 'Сила (м/с²)', f_strength_tip: 'Отрицательная сила притягивает вместо отталкивания',
		f_radius: 'Радиус (px)', f_radius_tip: 'Показан сферой. 0 = действует везде (только ветер)', f_falloff: 'Спад к краю',
		f_time: 'Время', f_ramp: 'Нарастание (с)', f_ramp_tip: 'За сколько секунд сила вырастает от 0 до полной',
		f_duration: 'Длительность (с)', f_duration_tip: '0 = работает всегда', f_delay: 'Начало (с)',
		f_noise: 'Шум', f_noise_tip: 'Случайность силы и направления, меняется во времени и в пространстве (порывы, живность)', f_noise_speed: 'Скорость шума',
		f_affects: 'Действует на', f_objects: 'Объекты', f_liquid: 'Жидкость',
		f_add: '+ Добавить силу (пустышка)', f_hint: 'Выделите пустую группу (или нажмите кнопку), чтобы сделать её полем силы.',
		f_wind_hint: 'Ветер дует по стрелке: направьте его инструментом «Вращение», двигайте «Перемещением».',
		f_note: 'Сфера — это радиус, круглая иконка — маркер поля. Поверните пустышку инструментом «Вращение», чтобы направить ветер.',
		msg_nothing: 'Физика: сначала отметьте что-нибудь как «Физический объект» или «Источник жидкости»',
		msg_no_animations: 'Физика: в этом формате нет анимаций', msg_baked: 'Физика записана в анимацию',
	},
};
const tr = key => {
	const lang = (typeof Language != 'undefined' && Language.code) || 'en';
	return (TEXTS[lang] && TEXTS[lang][key]) || TEXTS.en[key] || key;
};

const isPart = e => e instanceof Cube || e instanceof Mesh;
const bodyOf = node => Object.assign({}, DEFAULT_BODY, node.physics || {});
const typeOf = node => (node.physics && node.physics.type) || 'none';
const worldOf = () => Object.assign({}, DEFAULT_WORLD, (Project && Project.physics_world) || {});

// ---------------------------------------------------------------------------
// Jolt (embedded at the end of this file, loaded on first use)
// ---------------------------------------------------------------------------

let Jolt = null;
let jolt_loading = null;
function loadJolt() {
	if (Jolt) return Promise.resolve(Jolt);
	if (!jolt_loading) {
		jolt_loading = (async () => {
			const bin = atob(JOLT_SOURCE);
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			const url = URL.createObjectURL(new Blob([bytes], {type: 'text/javascript'}));
			try {
				const mod = await import(url);
				Jolt = await mod.default();
			} finally {
				URL.revokeObjectURL(url);
			}
			return Jolt;
		})();
		jolt_loading.catch(err => { console.error('[Physics] could not load Jolt', err); jolt_loading = null; });
	}
	return jolt_loading;
}

// ---------------------------------------------------------------------------
// Scene description: which nodes are bodies, their rest transforms and shapes
// ---------------------------------------------------------------------------

const depthOf = node => { let d = 0; for (let p = node.parent; p instanceof Group; p = p.parent) d++; return d; };

// every ticked group, cube and mesh, parents before children
function bodyNodes() {
	return [...Group.all, ...Cube.all, ...Mesh.all].filter(n => typeOf(n) != 'none').sort((a, b) => depthOf(a) - depthOf(b));
}

// cubes and meshes that belong to a body (ticked children are bodies of their own)
function partsOf(node) {
	if (isPart(node)) return [node];
	const out = [];
	const visit = group => {
		for (const child of group.children || []) {
			if (typeOf(child) != 'none' || isLiquid(child)) continue;
			if (child instanceof Group) visit(child);
			else if (isPart(child)) out.push(child);
		}
	};
	visit(node);
	return out;
}

// the body an element moves with (itself or the closest ticked group above it)
function ownerOf(node) {
	for (let n = node; n && n != 'root'; n = n.parent) {
		if (typeOf(n) != 'none') return n;
	}
	return null;
}

function restPose() {
	Canvas.updateAllPositions();
	Canvas.updateAllBones();
	scene.updateMatrixWorld(true);
}

function decompose(matrix) {
	const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
	matrix.decompose(pos, quat, scale);
	return {pos, quat};
}

// everything about one body, in Blockbench pixel units, captured at rest
function describeBody(node) {
	const settings = bodyOf(node);
	const world = node.mesh.matrixWorld.clone();
	const {pos, quat} = decompose(world);
	const inv = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)).invert();
	const inv_quat = quat.clone().invert();
	const parts = [];
	for (const el of partsOf(node)) {
		if (el instanceof Cube) {
			const half = [0, 1, 2].map(i => Math.abs(el.to[i] - el.from[i]) / 2 + (el.inflate || 0));
			const center_local = new THREE.Vector3(...[0, 1, 2].map(i => (el.from[i] + el.to[i]) / 2 - el.origin[i]));
			const center = el.mesh.localToWorld(center_local).applyMatrix4(inv);
			const rot = inv_quat.clone().multiply(el.mesh.getWorldQuaternion(new THREE.Quaternion()));
			parts.push({kind: 'box', half, center, rot});
		} else if (el instanceof Mesh) {
			const points = Object.values(el.vertices).map(v => el.mesh.localToWorld(new THREE.Vector3(...v)).applyMatrix4(inv));
			if (points.length >= 4) parts.push({kind: 'hull', points});
		}
	}
	return {node, settings, pos, quat, world, rest_position: node.mesh.position.clone(), parts};
}

// ---------------------------------------------------------------------------
// Jolt world
// ---------------------------------------------------------------------------

const v3 = (x, y, z) => new Jolt.Vec3(x, y, z);
const quatToJolt = q => new Jolt.Quat(q.x, q.y, q.z, q.w);

// small deterministic random numbers, so the preview and the bake are the same
function randomFor(text) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	return () => {
		h = Math.imul(h ^ (h >>> 15), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		h ^= h >>> 16;
		return (h >>> 0) / 4294967296 * 2 - 1;
	};
}

function shapeSettingsFor(part) {
	if (part.kind == 'box') {
		const half = part.half.map(h => Math.max(h / SCALE, 0.002));
		const radius = Math.min(0.05, Math.min(...half) * 0.5);
		return new Jolt.BoxShapeSettings(v3(...half), radius);
	}
	const hull = new Jolt.ConvexHullShapeSettings();
	part.points.forEach(p => hull.mPoints.push_back(v3(p.x / SCALE, p.y / SCALE, p.z / SCALE)));
	return hull;
}

function createShape(desc) {
	const parts = desc.parts;
	if (!parts.length) return null;
	let settings;
	if (parts.length == 1 && parts[0].kind == 'hull') {
		settings = shapeSettingsFor(parts[0]);
	} else if (parts.length == 1) {
		const p = parts[0];
		settings = new Jolt.RotatedTranslatedShapeSettings(v3(p.center.x / SCALE, p.center.y / SCALE, p.center.z / SCALE), quatToJolt(p.rot), shapeSettingsFor(p));
	} else {
		settings = new Jolt.StaticCompoundShapeSettings();
		for (const p of parts) {
			const center = p.kind == 'box' ? v3(p.center.x / SCALE, p.center.y / SCALE, p.center.z / SCALE) : v3(0, 0, 0);
			const rot = p.kind == 'box' ? quatToJolt(p.rot) : new Jolt.Quat(0, 0, 0, 1);
			settings.AddShape(center, rot, shapeSettingsFor(p), 0);
		}
	}
	const result = settings.Create();
	if (result.HasError()) {
		console.warn('[Physics] shape error for', desc.node.name, result.GetError().c_str());
		return null;
	}
	return result.Get();
}

function createWorld(descs, world_settings) {
	const settings = new Jolt.JoltSettings();
	const pairs = new Jolt.ObjectLayerPairFilterTable(2);
	pairs.EnableCollision(LAYER_STATIC, LAYER_MOVING);
	pairs.EnableCollision(LAYER_MOVING, LAYER_MOVING);
	const bp = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
	bp.MapObjectToBroadPhaseLayer(LAYER_STATIC, new Jolt.BroadPhaseLayer(0));
	bp.MapObjectToBroadPhaseLayer(LAYER_MOVING, new Jolt.BroadPhaseLayer(1));
	settings.mObjectLayerPairFilter = pairs;
	settings.mBroadPhaseLayerInterface = bp;
	settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(bp, 2, pairs, 2);
	const iface = new Jolt.JoltInterface(settings);
	Jolt.destroy(settings);
	const system = iface.GetPhysicsSystem();
	system.SetGravity(v3(0, -world_settings.gravity, 0));
	const bodies = system.GetBodyInterface();

	if (world_settings.ground) {
		const y = Project.model_3d.localToWorld(new THREE.Vector3(0, world_settings.ground_y, 0)).y / SCALE;
		const ground = new Jolt.BodyCreationSettings(new Jolt.BoxShape(v3(1000, 1, 1000), 0.05), new Jolt.RVec3(0, y - 1, 0),
			new Jolt.Quat(0, 0, 0, 1), Jolt.EMotionType_Static, LAYER_STATIC);
		ground.mFriction = 0.8;
		bodies.CreateAndAddBody(ground, Jolt.EActivation_DontActivate);
		Jolt.destroy(ground);
	}

	const chaos = Math.max(0, world_settings.chaos || 0);
	const entries = [];
	for (const desc of descs) {
		const shape = createShape(desc);
		if (!shape) continue;
		const s = desc.settings;
		const dynamic = s.type == 'dynamic';
		const bcs = new Jolt.BodyCreationSettings(shape, new Jolt.RVec3(desc.pos.x / SCALE, desc.pos.y / SCALE, desc.pos.z / SCALE),
			quatToJolt(desc.quat), dynamic ? Jolt.EMotionType_Dynamic : Jolt.EMotionType_Static, dynamic ? LAYER_MOVING : LAYER_STATIC);
		bcs.mFriction = s.friction;
		bcs.mRestitution = s.restitution;
		const dormant = dynamic && !!s.impact;
		let kick = null;
		if (dynamic) {
			bcs.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
			bcs.mMassPropertiesOverride.mMass = Math.max(0.001, s.mass);
			bcs.mMotionQuality = Jolt.EMotionQuality_LinearCast;   // fast objects (cars) do not tunnel through each other
			// nothing in the real world is perfectly straight: a little random push and spin (Chaos)
			const rnd = randomFor(s.seed || desc.node.uuid);
			const velocity = s.velocity.slice(), spin = s.spin.slice();
			const kick_v = [rnd() * chaos * 0.5, 0, rnd() * chaos * 0.5];
			const kick_s = [rnd() * chaos * 120, rnd() * chaos * 120, rnd() * chaos * 120];
			if (dormant) {
				// waits for an impact: goes straight at its start speed, no gravity, no friction, no spin (a car does not fall apart on the way)
				kick = {velocity: kick_v, spin: spin.map((d, i) => d + kick_s[i])};
				bcs.mFriction = 0;
				bcs.mGravityFactor = 0;
				bcs.mAllowSleeping = false;
				bcs.mLinearVelocity = v3(...velocity);
			} else {
				for (let i = 0; i < 3; i++) { velocity[i] += kick_v[i]; spin[i] += kick_s[i]; }
				bcs.mLinearVelocity = v3(...velocity);
				bcs.mAngularVelocity = v3(...spin.map(d => d * Math.PI / 180));
			}
			}
		const body = bodies.CreateBody(bcs);
		Jolt.destroy(bcs);
		bodies.AddBody(body.GetID(), dynamic ? Jolt.EActivation_Activate : Jolt.EActivation_DontActivate);
		entries.push({desc, body, id: body.GetID(), dormant, kick, hold: dormant ? s.velocity.slice() : null});
	}
	return {iface, system, bodies, entries, tmp: new Jolt.Vec3(), tmp2: new Jolt.Vec3()};
}

function destroyWorld(w) {
if (!w) return;
Jolt.destroy(w.tmp);
Jolt.destroy(w.tmp2);
Jolt.destroy(w.iface);
}

// world transform of a body right now, in Blockbench pixels
function bodyWorld(entry) {
	const p = entry.body.GetPosition(), r = entry.body.GetRotation();
	return new THREE.Matrix4().compose(
		new THREE.Vector3(p.GetX() * SCALE, p.GetY() * SCALE, p.GetZ() * SCALE),
		new THREE.Quaternion(r.GetX(), r.GetY(), r.GetZ(), r.GetW()),
		new THREE.Vector3(1, 1, 1));
}

// ---------------------------------------------------------------------------
// Force fields: an empty group that pushes, pulls or blows (on physics objects and / or liquid)
// ---------------------------------------------------------------------------

const DEFAULT_FORCE = {enabled: false, kind: 'push', strength: 10, radius: 48, falloff: true, ramp: 0, delay: 0, duration: 0,
	noise: 0, noise_speed: 1, objects: true, liquid: true};
const forceOf = node => Object.assign({}, DEFAULT_FORCE, node.force || {});
const isForce = node => !!(node.force && node.force.enabled);
const forceNodes = () => Group.all.filter(isForce);

// the direction of a wind (and the arrow of a field) is the local +Y axis of the empty: turn it with the Rotate tool
function nodeDirection(node) {
	node.mesh.updateMatrixWorld(true);
	return new THREE.Vector3(0, 1, 0).applyQuaternion(node.mesh.getWorldQuaternion(new THREE.Quaternion())).normalize();
}

function describeField(node) {
	node.mesh.updateMatrixWorld(true);
	return {node, s: forceOf(node), pos: node.mesh.getWorldPosition(new THREE.Vector3()), dir: nodeDirection(node), seed: randomFor(node.uuid)() * 100};
}

// smooth random numbers in space and time (value noise), -1..1; k picks one of three independent channels
function lattice(ix, iy, iz, it, k) {
	let h = Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791) ^ Math.imul(it, 2654435761) ^ Math.imul(k + 1, 40503);
	h = Math.imul(h ^ (h >>> 15), 2246822507);
	h = Math.imul(h ^ (h >>> 13), 3266489909);
	h ^= h >>> 16;
	return (h >>> 0) / 2147483648 - 1;
}
const fade = t => t * t * (3 - 2 * t);
function noise4(x, y, z, t, k) {
	const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), it = Math.floor(t);
	const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz), ft = fade(t - it);
	let sum = 0;
	for (let dt = 0; dt < 2; dt++) {
		const wt = dt ? ft : 1 - ft;
		for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
			sum += lattice(ix + dx, iy + dy, iz + dz, it + dt, k) * wt * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
		}
	}
	return sum;
}
const NOISE_SCALE = 1 / (SCALE * 2);   // one noise cell is about 2 m wide

// acceleration (px/s²) of a field at a point and a time, written into out; false when the field does not reach it
function fieldAccel(f, x, y, z, time, out) {
	const s = f.s, t = time - s.delay;
	if (t < 0 || (s.duration > 0 && t > s.duration)) return false;
	const dx = x - f.pos.x, dy = y - f.pos.y, dz = z - f.pos.z, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
	let fall = 1;
	if (s.radius > 0) {
		if (dist >= s.radius) return false;
		if (s.falloff) fall = 1 - dist / s.radius;
	}
	let ux, uy, uz;
	if (s.kind == 'wind') {
		ux = f.dir.x; uy = f.dir.y; uz = f.dir.z;
	} else {
		if (dist < 1e-6) return false;
		ux = dx / dist; uy = dy / dist; uz = dz / dist;
	}
	let mag = s.strength * SCALE * fall * (s.ramp > 0 ? Math.min(1, t / s.ramp) : 1);
	if (s.noise > 0) {
		// random gusts: the strength wobbles and the direction wanders a little, differently at every place and moment
		const nt = time * s.noise_speed + f.seed, nx = x * NOISE_SCALE, ny = y * NOISE_SCALE, nz = z * NOISE_SCALE;
		mag *= Math.max(0, 1 + s.noise * noise4(nx, ny, nz, nt, 0) * 1.5);
		ux += s.noise * noise4(nx, ny, nz, nt, 1); uy += s.noise * noise4(nx, ny, nz, nt, 2); uz += s.noise * noise4(nx, ny, nz, nt, 3);
		const len = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
		ux /= len; uy /= len; uz /= len;
	}
	out.set(ux * mag, uy * mag, uz * mag);
	return true;
}

// ---------------------------------------------------------------------------
// Runtime: the Jolt world, the liquid and the fields stepped together (preview and bake share it)
// ---------------------------------------------------------------------------

const IMPACT_SPIN = 3;   // rad/s: a waiting object that gets spun faster than this by a hit starts too

function wakeEntry(rt, entry) {
	const w = rt.world, s = entry.desc.settings;
	entry.dormant = false;
	w.bodies.SetGravityFactor(entry.id, 1);
	w.bodies.SetFriction(entry.id, s.friction);
	entry.body.SetAllowSleeping(true);
	w.tmp.Set(...entry.kick.velocity);
	w.tmp2.Set(...entry.kick.spin.map(d => d * Math.PI / 180));
	w.bodies.AddLinearAndAngularVelocity(entry.id, w.tmp, w.tmp2);
	entry.woke_at = rt.time;
}

// objects that wait for an impact keep going straight at their start speed until something hits them hard enough
function holdWaiting(world) {
	for (const e of world.entries) {
		if (!e.dormant) continue;
		world.tmp.Set(e.hold[0], e.hold[1], e.hold[2]);
		world.bodies.SetLinearVelocity(e.id, world.tmp);
		world.tmp.Set(0, 0, 0);
		world.bodies.SetAngularVelocity(e.id, world.tmp);
	}
}
function wakeHit(rt) {
	for (const e of rt.world.entries) {
		if (!e.dormant) continue;
		const lv = e.body.GetLinearVelocity(), av = e.body.GetAngularVelocity();
		const dv = Math.hypot(lv.GetX() - e.hold[0], lv.GetY() - e.hold[1], lv.GetZ() - e.hold[2]);
		if (dv > Math.max(0.05, e.desc.settings.threshold) || Math.hypot(av.GetX(), av.GetY(), av.GetZ()) > IMPACT_SPIN) wakeEntry(rt, e);
	}
}

const tmp_accel = new THREE.Vector3();
function pushBodies(rt) {
	const w = rt.world;
	for (const e of w.entries) {
		if (e.desc.settings.type != 'dynamic' || e.dormant) continue;
		const p = e.body.GetPosition(), x = p.GetX() * SCALE, y = p.GetY() * SCALE, z = p.GetZ() * SCALE;
		let ax = 0, ay = 0, az = 0, noisy = 0;
		for (const f of rt.fields) {
			if (!f.s.objects || !fieldAccel(f, x, y, z, rt.time, tmp_accel)) continue;
			ax += tmp_accel.x; ay += tmp_accel.y; az += tmp_accel.z;
			noisy = Math.max(noisy, f.s.noise);
		}
		if (!ax && !ay && !az) continue;
		const m = Math.max(0.001, e.desc.settings.mass) / SCALE;   // px/s² -> force
		w.tmp.Set(ax * m, ay * m, az * m);
		w.bodies.AddForce(e.id, w.tmp, Jolt.EActivation_Activate);
		if (noisy > 0) {
			// gusts also turn the object a little, like a creature fidgeting
			const k = Math.hypot(ax, ay, az) * m * 0.08 * noisy, t = rt.time * 2;
			w.tmp.Set(noise4(x, y, z, t, 4) * k, noise4(x, y, z, t, 5) * k, noise4(x, y, z, t, 6) * k);
			w.bodies.AddTorque(e.id, w.tmp, Jolt.EActivation_Activate);
		}
	}
}

// a liquid source on a moving object follows it (position, aim and speed)
function bindSources(liquid, world, descs) {
	const rest = new THREE.Matrix4();
	for (const e of liquid.emitters) {
		const owner = ownerOf(e.el);
		const entry = owner && world.entries.find(en => en.desc.node == owner && en.desc.settings.type == 'dynamic');
		if (!entry) continue;
		const d = entry.desc;
		rest.compose(d.pos, d.quat, new THREE.Vector3(1, 1, 1));
		const inv = rest.clone().invert();
		const source = new THREE.Matrix4().compose(e.box.center, e.box.quat, new THREE.Vector3(1, 1, 1));
		const rel = inv.multiply(source);
		const rel_dir = e.dir.clone().applyQuaternion(d.quat.clone().invert());
		const center = new THREE.Vector3(), quat = new THREE.Quaternion(), bquat = new THREE.Quaternion(), bpos = new THREE.Vector3(), scale = new THREE.Vector3(), M = new THREE.Matrix4();
		const point = new Jolt.RVec3(0, 0, 0);
		e.follow = em => {
			const W = bodyWorld(entry);
			W.decompose(bpos, bquat, scale);
			M.copy(W).multiply(rel).decompose(center, quat, scale);
			em.box = {center: center.clone(), half: e.box.half, quat: em.el instanceof Cube ? quat.clone() : e.box.quat};
			em.dir = rel_dir.clone().applyQuaternion(bquat);
			point.Set(center.x / SCALE, center.y / SCALE, center.z / SCALE);
			const v = world.bodies.GetPointVelocity(entry.id, point);
			em.vel.set(v.GetX() * SCALE, v.GetY() * SCALE, v.GetZ() * SCALE);
		};
	}
}

function createRuntime(descs, ws, quality = 1) {
	const world = createWorld(descs, ws);
	const sources = liquidSources();
	const liquid = sources.length ? new LiquidSim(sources, ws, quality) : null;
	const fields = forceNodes().map(describeField);
	if (liquid) {
		liquid.fields = fields.filter(f => f.s.liquid);
		bindSources(liquid, world, descs);
	}
	return {world, liquid, fields, sources, time: 0, liquid_acc: 0};
}

function stepRuntime(rt) {
	if (rt.fields.length) pushBodies(rt);
	holdWaiting(rt.world);
	rt.world.iface.Step(FIXED_DT, 1);
	rt.time += FIXED_DT;
	wakeHit(rt);
	if (rt.liquid) {
		rt.liquid_acc += FIXED_DT;
		if (rt.liquid_acc >= LIQUID_DT - 1e-9) {
			rt.liquid_acc -= LIQUID_DT;
			rt.liquid.step(LIQUID_DT, liquidColliders(rt.world));
		}
	}
}

// ---------------------------------------------------------------------------
// Liquid: a cloud of small drops that push each other apart, stick together a little and
// splash off everything that is ticked as Ground or Physics object (Position Based Fluids).
// Everything here works in Blockbench pixels (16 px = 1 m).
// ---------------------------------------------------------------------------

const DEFAULT_LIQUID = {enabled: false, amount: 1500, size: 0.35, speed: 6, yaw: 0, pitch: 25, spread: 12, emit_time: 0.3,
	cohesion: 0.35, stickiness: 0.6, thickness: 0.35, gravity: 1, color: '#7c0a0a', look: 0.5};
const MAX_DROPS = 20000;          // per source, in the preview
const MAX_BAKE_DROPS = 80000;     // per source, when baking in high quality
const LIQUID_DT = 1 / 60;
const MAX_NEIGHBORS = 48;
const REST_SPEED = 0.15 * SCALE;   // drops on a surface slower than this (px/s) stay put
const VISCOSITY_FLOOR = 0.1;     // even thin water has some internal friction
const SURFACE_DRAG = 0.12;       // a drop sliding on a surface loses this part of its speed per step...
const CROWD_FREE = 0.9;          // ...but drops inside a body of liquid feel the floor much less, so a pool levels out fast

const liquidOf = node => Object.assign({}, DEFAULT_LIQUID, node.liquid || {});
const isLiquid = node => !!(node.liquid && node.liquid.enabled);
const liquidSources = () => [...Cube.all, ...Mesh.all].filter(isLiquid);

// the liquid shoots along the local +Y axis of its source: turn the source with the Rotate tool to aim it
function liquidDirection(el) {
	el.mesh.updateMatrixWorld(true);
	return new THREE.Vector3(0, 1, 0).applyQuaternion(el.mesh.getWorldQuaternion(new THREE.Quaternion())).normalize();
}

// the volume drops are born in: the source cube (or the box around a mesh), in world space
function sourceBox(el) {
	el.mesh.updateMatrixWorld(true);
	if (el instanceof Cube) {
		const half = [0, 1, 2].map(i => Math.abs(el.to[i] - el.from[i]) / 2 + (el.inflate || 0));
		const center = el.mesh.localToWorld(new THREE.Vector3(...[0, 1, 2].map(i => (el.from[i] + el.to[i]) / 2 - el.origin[i])));
		return {center, half, quat: el.mesh.getWorldQuaternion(new THREE.Quaternion())};
	}
	const box = new THREE.Box3();
	Object.values(el.vertices).forEach(v => box.expandByPoint(el.mesh.localToWorld(new THREE.Vector3(...v))));
	const size = box.getSize(new THREE.Vector3());
	return {center: box.getCenter(new THREE.Vector3()), half: [size.x / 2, size.y / 2, size.z / 2], quat: new THREE.Quaternion()};
}

// boxes the liquid bounces off: every part of every Ground / Physics object, at its current position
function liquidColliders(world) {
	const boxes = [];
	for (const entry of world.entries) {
		const W = bodyWorld(entry);
		const {pos, quat} = decompose(W);
		for (const part of entry.desc.parts) {
			let center, rot, half;
			if (part.kind == 'box') {
				center = part.center.clone().applyQuaternion(quat).add(pos);
				rot = quat.clone().multiply(part.rot);
				half = part.half;
			} else {
				if (!part.obb) {
					const b = new THREE.Box3().setFromPoints(part.points);
					const size = b.getSize(new THREE.Vector3());
					part.obb = {center: b.getCenter(new THREE.Vector3()), half: [size.x / 2, size.y / 2, size.z / 2]};
				}
				center = part.obb.center.clone().applyQuaternion(quat).add(pos);
				rot = quat.clone();
				half = part.obb.half;
			}
			const m = new THREE.Matrix4().makeRotationFromQuaternion(rot).elements;
			const axes = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];   // local x, y, z axes in world space
			const ext = [0, 1, 2].map(i => Math.abs(axes[i]) * half[0] + Math.abs(axes[3 + i]) * half[1] + Math.abs(axes[6 + i]) * half[2]);
			boxes.push({c: [center.x, center.y, center.z], axes, half: half.slice(),
				min: [center.x - ext[0], center.y - ext[1], center.z - ext[2]], max: [center.x + ext[0], center.y + ext[1], center.z + ext[2]]});
		}
	}
	return boxes;
}

class LiquidSim {
	// quality 1 = as set (preview), 2 = drops half as big and 8x as many, 3 = a third as big and 27x as many
	constructor(sources, world_settings, quality = 1) {
		const q = Math.max(1, quality);
		this.max_substeps = q > 1 ? 8 : 3;
		this.emitters = sources.map((el, index) => {
			const s = liquidOf(el);
			return {el, s, index, box: sourceBox(el), dir: liquidDirection(el), vel: new THREE.Vector3(), follow: null, rnd: randomFor('liquid' + el.uuid),
				amount: Math.min(q > 1 ? MAX_BAKE_DROPS : MAX_DROPS, Math.max(0, Math.round(s.amount * q * q * q))), emitted: 0, carry: 0};
		});
		this.r = Math.max(0.05 / q, ...this.emitters.map(e => e.s.size / q));
		this.d = 2 * this.r;       // distance between drops at rest
		this.h = 4 * this.r;       // how far drops feel each other
		const cap = this.emitters.reduce((s, e) => s + e.amount, 0);
		this.cap = cap;
		this.n = 0;
		this.x = new Float64Array(cap * 3);
		this.p = new Float64Array(cap * 3);
		this.v = new Float64Array(cap * 3);
		this.dp = new Float64Array(cap * 3);
		this.lambda = new Float64Array(cap);
		this.owner = new Int32Array(cap);
		this.contact = new Float64Array(cap * 3);
		this.touch = new Uint8Array(cap);
		this.nb_count = new Int32Array(cap);
		this.nb = new Int32Array(cap * MAX_NEIGHBORS);
		this.time = 0;
		this.fields = [];
		this.kills = 0;   // drops removed so far (their numbering changes then)
		this.gravity = world_settings.gravity * SCALE;
		this.ground = world_settings.ground ? Project.model_3d.localToWorld(new THREE.Vector3(0, world_settings.ground_y, 0)).y : null;

		const h = this.h;
		this.k_poly6 = 315 / (64 * Math.PI * Math.pow(h, 9));
		this.k_spiky = -45 / (Math.PI * Math.pow(h, 6));
		// rest density = density of drops packed at their rest distance, so a calm liquid has no pressure
		let rho = 0, grad_sq = 0;
		for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (let k = -3; k <= 3; k++) {
			const r = this.d * Math.hypot(i, j, k);
			if (r >= h) continue;
			rho += this.W(r * r);
			if (r > 0) grad_sq += Math.pow(this.k_spiky * (h - r) * (h - r), 2);
		}
		this.rho0 = rho;
		this.eps = 0.25 * grad_sq / (rho * rho);
	}
	W(r2) {
		const h2 = this.h * this.h;
		if (r2 >= h2) return 0;
		const d = h2 - r2;
		return this.k_poly6 * d * d * d;
	}

	spawn(e, inside) {
		if (this.n >= this.cap || e.emitted >= e.amount) return false;
		const rnd = e.rnd, box = e.box;
		// a free place in the nozzle: drops never start on top of each other (that is what threw the liquid apart)
		const local = new THREE.Vector3();
		let free = false;
		const min_d2 = Math.pow(this.d * 0.85, 2);
		for (let attempt = 0; attempt < 8 && !free; attempt++) {
			local.set(rnd() * box.half[0], rnd() * box.half[1], rnd() * box.half[2]).applyQuaternion(box.quat).add(box.center);
			free = true;
			for (const q of inside) {
				const dx = local.x - this.x[q * 3], dy = local.y - this.x[q * 3 + 1], dz = local.z - this.x[q * 3 + 2];
				if (dx * dx + dy * dy + dz * dz < min_d2) { free = false; break; }
			}
		}
		if (!free) return false;
		const i = this.n++;
		e.emitted++;
		inside.push(i);
		// direction inside the spread cone
		const spread = e.s.spread * Math.PI / 180;
		const cos_t = 1 - (rnd() * 0.5 + 0.5) * (1 - Math.cos(spread));
		const sin_t = Math.sqrt(Math.max(0, 1 - cos_t * cos_t));
		const phi = (rnd() * 0.5 + 0.5) * Math.PI * 2;
		const dir = e.dir;
		const a = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
		const u = new THREE.Vector3().crossVectors(dir, a).normalize(), w = new THREE.Vector3().crossVectors(dir, u);
		const d = dir.clone().multiplyScalar(cos_t).addScaledVector(u, sin_t * Math.cos(phi)).addScaledVector(w, sin_t * Math.sin(phi));
		const speed = e.s.speed * SCALE * (1 + rnd() * 0.15);
		this.x[i * 3] = this.p[i * 3] = local.x;
		this.x[i * 3 + 1] = this.p[i * 3 + 1] = local.y;
		this.x[i * 3 + 2] = this.p[i * 3 + 2] = local.z;
		// a source on a moving object throws the liquid along with the object's own speed
		this.v[i * 3] = d.x * speed + e.vel.x; this.v[i * 3 + 1] = d.y * speed + e.vel.y; this.v[i * 3 + 2] = d.z * speed + e.vel.z;
		this.owner[i] = e.index;
		return true;
	}

	// drops that are still inside the source volume
	dropsInside(e) {
		const box = e.box, inv = box.quat.clone().invert(), out = [];
		const v = new THREE.Vector3(), m = this.r;
		for (let i = 0; i < this.n; i++) {
			if (this.owner[i] != e.index) continue;
			v.set(this.x[i * 3] - box.center.x, this.x[i * 3 + 1] - box.center.y, this.x[i * 3 + 2] - box.center.z).applyQuaternion(inv);
			if (Math.abs(v.x) <= box.half[0] + m && Math.abs(v.y) <= box.half[1] + m && Math.abs(v.z) <= box.half[2] + m) out.push(i);
		}
		return out;
	}

	emit(dt) {
		for (const e of this.emitters) {
			if (e.emitted >= e.amount) continue;
			if (e.follow) e.follow(e);
			const volume = 8 * e.box.half[0] * e.box.half[1] * e.box.half[2];
			const capacity = Math.max(1, Math.floor(0.8 * volume / Math.pow(this.d, 3)));
			const inside = this.dropsInside(e);
			// the nozzle only lets out as much as fits: with no push the liquid pours out instead of bursting out
			let room = capacity - inside.length;
			if (e.s.emit_time <= 0) {
				while (room-- > 0 && e.emitted < e.amount && this.spawn(e, inside));
				continue;
			}
			e.carry = Math.min(e.carry + e.amount * dt / e.s.emit_time, 40);
			while (e.carry >= 1 && room > 0) {
				if (!this.spawn(e, inside)) break;
				e.carry--; room--;
			}
		}
	}

	findNeighbors() {
		const n = this.n, h = this.h, h2 = h * h, p = this.p;
		let size = 1;
		while (size < n * 2) size <<= 1;
		const mask = size - 1;
		const cell = new Int32Array(n), start = new Int32Array(size + 1), sorted = new Int32Array(n);
		const hash = (x, y, z) => ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) & mask;
		for (let i = 0; i < n; i++) {
			cell[i] = hash(Math.floor(p[i * 3] / h), Math.floor(p[i * 3 + 1] / h), Math.floor(p[i * 3 + 2] / h));
			start[cell[i] + 1]++;
		}
		for (let c = 0; c < size; c++) start[c + 1] += start[c];
		const fill = start.slice(0, size);
		for (let i = 0; i < n; i++) sorted[fill[cell[i]]++] = i;
		for (let i = 0; i < n; i++) {
			const px = p[i * 3], py = p[i * 3 + 1], pz = p[i * 3 + 2];
			const cx = Math.floor(px / h), cy = Math.floor(py / h), cz = Math.floor(pz / h);
			let count = 0;
			const base = i * MAX_NEIGHBORS;
			for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
				const c = hash(cx + dx, cy + dy, cz + dz);
				for (let s = start[c]; s < start[c + 1] && count < MAX_NEIGHBORS; s++) {
					const j = sorted[s];
					if (j == i) continue;
					const rx = px - p[j * 3], ry = py - p[j * 3 + 1], rz = pz - p[j * 3 + 2];
					if (rx * rx + ry * ry + rz * rz < h2) this.nb[base + count++] = j;
				}
			}
			this.nb_count[i] = count;
		}
	}

	// keep a drop out of the ground and the boxes; from = where it was before this step (to catch thin walls)
	collide(i, boxes, swept) {
		const p = this.p, x = this.x, r = this.r;
		let px = p[i * 3], py = p[i * 3 + 1], pz = p[i * 3 + 2];
		if (this.ground !== null && py < this.ground + r) {
			py = this.ground + r;
			this.touch[i] = 1;
			this.contact[i * 3] = 0; this.contact[i * 3 + 1] = 1; this.contact[i * 3 + 2] = 0;
		}
		for (const b of boxes) {
			if (px < b.min[0] - r && (!swept || x[i * 3] < b.min[0] - r)) continue;
			if (px > b.max[0] + r && (!swept || x[i * 3] > b.max[0] + r)) continue;
			if (py < b.min[1] - r && (!swept || x[i * 3 + 1] < b.min[1] - r)) continue;
			if (py > b.max[1] + r && (!swept || x[i * 3 + 1] > b.max[1] + r)) continue;
			if (pz < b.min[2] - r && (!swept || x[i * 3 + 2] < b.min[2] - r)) continue;
			if (pz > b.max[2] + r && (!swept || x[i * 3 + 2] > b.max[2] + r)) continue;
			const A = b.axes;
			const toLocal = (wx, wy, wz) => {
				const dx = wx - b.c[0], dy = wy - b.c[1], dz = wz - b.c[2];
				return [dx * A[0] + dy * A[1] + dz * A[2], dx * A[3] + dy * A[4] + dz * A[5], dx * A[6] + dy * A[7] + dz * A[8]];
			};
			const H = [b.half[0] + r, b.half[1] + r, b.half[2] + r];
			let lp = toLocal(px, py, pz);
			let normal_axis = -1, normal_sign = 0;
			const inside = Math.abs(lp[0]) < H[0] && Math.abs(lp[1]) < H[1] && Math.abs(lp[2]) < H[2];
			if (swept) {
				// entering the box during this step (also catches drops that would jump through a thin wall)
				const lx = toLocal(x[i * 3], x[i * 3 + 1], x[i * 3 + 2]);
				const was_inside = Math.abs(lx[0]) < H[0] && Math.abs(lx[1]) < H[1] && Math.abs(lx[2]) < H[2];
				if (!was_inside) {
					let t0 = 0, t1 = 1, axis = -1, sign = 0;
					for (let k = 0; k < 3 && t0 <= t1; k++) {
						const d = lp[k] - lx[k];
						if (Math.abs(d) < 1e-12) { if (Math.abs(lx[k]) >= H[k]) t0 = 2; continue; }
						let ta = (-H[k] - lx[k]) / d, tb = (H[k] - lx[k]) / d, s = -1;
						if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
						if (ta > t0) { t0 = ta; axis = k; sign = s; }
						if (tb < t1) t1 = tb;
					}
					if (t0 <= t1 && t0 >= 0 && t0 <= 1 && axis >= 0) {
						lp = [0, 1, 2].map(k => lx[k] + (lp[k] - lx[k]) * t0);
						lp[axis] = sign * H[axis];
						normal_axis = axis; normal_sign = sign;
					}
				}
			}
			if (normal_axis < 0 && inside) {
				// push out through the closest face
				let best = Infinity;
				for (let k = 0; k < 3; k++) {
					const depth = H[k] - Math.abs(lp[k]);
					if (depth < best) { best = depth; normal_axis = k; normal_sign = lp[k] >= 0 ? 1 : -1; }
				}
				lp[normal_axis] = normal_sign * H[normal_axis];
			}
			if (normal_axis < 0) continue;
			px = b.c[0] + lp[0] * A[0] + lp[1] * A[3] + lp[2] * A[6];
			py = b.c[1] + lp[0] * A[1] + lp[1] * A[4] + lp[2] * A[7];
			pz = b.c[2] + lp[0] * A[2] + lp[1] * A[5] + lp[2] * A[8];
			this.touch[i] = 1;
			this.contact[i * 3] = A[normal_axis * 3] * normal_sign;
			this.contact[i * 3 + 1] = A[normal_axis * 3 + 1] * normal_sign;
			this.contact[i * 3 + 2] = A[normal_axis * 3 + 2] * normal_sign;
		}
		p[i * 3] = px; p[i * 3 + 1] = py; p[i * 3 + 2] = pz;
	}

	step(dt, boxes) {
		let vmax = 0;
		const v = this.v;
		for (let i = 0; i < this.n; i++) vmax = Math.max(vmax, v[i * 3] * v[i * 3] + v[i * 3 + 1] * v[i * 3 + 1] + v[i * 3 + 2] * v[i * 3 + 2]);
		vmax = Math.sqrt(vmax);
		for (const e of this.emitters) if (e.emitted < e.amount) vmax = Math.max(vmax, e.s.speed * SCALE * 1.15);
		const sub = Math.max(1, Math.min(this.max_substeps, Math.ceil(vmax * dt / (0.5 * this.h))));
		for (let s = 0; s < sub; s++) this.stepOnce(dt / sub, boxes);
	}

	stepOnce(dt, boxes) {
		this.emit(dt);
		this.time += dt;
		const n = this.n;
		if (!n) return;
		const x = this.x, p = this.p, v = this.v, dp = this.dp, lambda = this.lambda, nb = this.nb, nbc = this.nb_count;
		const em = this.emitters;
		const h = this.h, rho0 = this.rho0, ks = this.k_spiky;

		// 0. force fields (push, pull, wind)
		if (this.fields.length) {
			const a = tmp_accel;
			for (const f of this.fields) {
				for (let i = 0; i < n; i++) {
					if (!fieldAccel(f, x[i * 3], x[i * 3 + 1], x[i * 3 + 2], this.time, a)) continue;
					v[i * 3] += a.x * dt; v[i * 3 + 1] += a.y * dt; v[i * 3 + 2] += a.z * dt;
				}
			}
		}

		// 1. gravity and a first guess where every drop goes
		for (let i = 0; i < n; i++) {
			v[i * 3 + 1] -= this.gravity * em[this.owner[i]].s.gravity * dt;
			p[i * 3] = x[i * 3] + v[i * 3] * dt;
			p[i * 3 + 1] = x[i * 3 + 1] + v[i * 3 + 1] * dt;
			p[i * 3 + 2] = x[i * 3 + 2] + v[i * 3 + 2] * dt;
			this.touch[i] = 0;
			this.collide(i, boxes, true);
		}
		this.findNeighbors();

		// 2. push drops apart where they are packed too densely (a few rounds)
		for (let iter = 0; iter < 3; iter++) {
			for (let i = 0; i < n; i++) {
				let rho = this.W(0), gx = 0, gy = 0, gz = 0, sum_sq = 0;
				const base = i * MAX_NEIGHBORS;
				for (let k = 0; k < nbc[i]; k++) {
					const j = nb[base + k];
					const rx = p[i * 3] - p[j * 3], ry = p[i * 3 + 1] - p[j * 3 + 1], rz = p[i * 3 + 2] - p[j * 3 + 2];
					const r2 = rx * rx + ry * ry + rz * rz;
					rho += this.W(r2);
					const r = Math.sqrt(r2);
					if (r < 1e-9 || r >= h) continue;
					const g = ks * (h - r) * (h - r) / r / rho0;
					gx += g * rx; gy += g * ry; gz += g * rz;
					sum_sq += g * g * r2;
				}
				const C = Math.max(0, rho / rho0 - 1);
				lambda[i] = -C / (sum_sq + gx * gx + gy * gy + gz * gz + this.eps);
			}
			for (let i = 0; i < n; i++) {
				let dx = 0, dy = 0, dz = 0;
				const base = i * MAX_NEIGHBORS;
				for (let k = 0; k < nbc[i]; k++) {
					const j = nb[base + k];
					const rx = p[i * 3] - p[j * 3], ry = p[i * 3 + 1] - p[j * 3 + 1], rz = p[i * 3 + 2] - p[j * 3 + 2];
					const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
					if (r < 1e-9 || r >= h) continue;
					const g = (lambda[i] + lambda[j]) * ks * (h - r) * (h - r) / r / rho0;
					dx += g * rx; dy += g * ry; dz += g * rz;
				}
				const len = Math.sqrt(dx * dx + dy * dy + dz * dz), max = this.r;
				const f = len > max ? max / len : 1;
				dp[i * 3] = dx * f; dp[i * 3 + 1] = dy * f; dp[i * 3 + 2] = dz * f;
			}
			for (let i = 0; i < n; i++) {
				p[i * 3] += dp[i * 3]; p[i * 3 + 1] += dp[i * 3 + 1]; p[i * 3 + 2] += dp[i * 3 + 2];
				this.collide(i, boxes, false);
			}
		}

		// 3. new velocities, then thickness (drops move like their neighbours) and cohesion (they hold together)
		for (let i = 0; i < n; i++) {
			v[i * 3] = (p[i * 3] - x[i * 3]) / dt;
			v[i * 3 + 1] = (p[i * 3 + 1] - x[i * 3 + 1]) / dt;
			v[i * 3 + 2] = (p[i * 3 + 2] - x[i * 3 + 2]) / dt;
		}
		const d = this.d;
		for (let i = 0; i < n; i++) {
			const s = em[this.owner[i]].s;
			let ax = 0, ay = 0, az = 0, wsum = 0, cx = 0, cy = 0, cz = 0;
			const base = i * MAX_NEIGHBORS;
			for (let k = 0; k < nbc[i]; k++) {
				const j = nb[base + k];
				const rx = p[j * 3] - p[i * 3], ry = p[j * 3 + 1] - p[i * 3 + 1], rz = p[j * 3 + 2] - p[i * 3 + 2];
				const r2 = rx * rx + ry * ry + rz * rz;
				const w = this.W(r2);
				ax += v[j * 3] * w; ay += v[j * 3 + 1] * w; az += v[j * 3 + 2] * w; wsum += w;
				const r = Math.sqrt(r2);
				if (r > d && r < h) {
					const pull = Math.sin(Math.PI * (r - d) / (h - d)) / r;
					cx += rx * pull; cy += ry * pull; cz += rz * pull;
				}
			}
			if (wsum > 0) {
				const f = Math.min(1, Math.max(s.thickness, VISCOSITY_FLOOR) * 0.6);   // even thin water has some internal friction, or it keeps bouncing around
				dp[i * 3] = v[i * 3] + (ax / wsum - v[i * 3]) * f;
				dp[i * 3 + 1] = v[i * 3 + 1] + (ay / wsum - v[i * 3 + 1]) * f;
				dp[i * 3 + 2] = v[i * 3 + 2] + (az / wsum - v[i * 3 + 2]) * f;
			} else {
				dp[i * 3] = v[i * 3]; dp[i * 3 + 1] = v[i * 3 + 1]; dp[i * 3 + 2] = v[i * 3 + 2];
			}
			const coh = s.cohesion * 12 * SCALE * dt;
			dp[i * 3] += cx * coh; dp[i * 3 + 1] += cy * coh; dp[i * 3 + 2] += cz * coh;
		}
		for (let i = 0; i < n * 3; i++) v[i] = dp[i];

		// 4. stickiness: drops touching a surface grip it like friction. Fast drops still slide (the splat spreads out),
		//    lone drops stop and stay, and where a lot of liquid gathered it is heavy enough to run down (drips).
		for (let i = 0; i < n; i++) {
			if (!this.touch[i]) continue;
			const s = em[this.owner[i]].s;
			const nx = this.contact[i * 3], ny = this.contact[i * 3 + 1], nz = this.contact[i * 3 + 2];
			let vn = v[i * 3] * nx + v[i * 3 + 1] * ny + v[i * 3 + 2] * nz;
			let tx = v[i * 3] - vn * nx, ty = v[i * 3 + 1] - vn * ny, tz = v[i * 3 + 2] - vn * nz;
			const crowd = Math.min(1, nbc[i] / 30);
			const grip = s.stickiness * 30 * SCALE * (1 - 0.75 * crowd) * dt;
			const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
			const keep = vt <= grip ? 0 : (vt - grip) / vt * (1 - SURFACE_DRAG * (1 - CROWD_FREE * crowd) - 0.08 * s.stickiness);   // no stickiness = slippery, but a puddle still comes to rest
			tx *= keep; ty *= keep; tz *= keep;
			if (vn < 0) vn = 0;
			vn -= s.stickiness * 14 * SCALE * dt;   // held against the surface, so drops can hang under things
			v[i * 3] = tx + vn * nx; v[i * 3 + 1] = ty + vn * ny; v[i * 3 + 2] = tz + vn * nz;
			if (tx * tx + ty * ty + tz * tz < REST_SPEED * REST_SPEED) { v[i * 3] = vn * nx; v[i * 3 + 1] = vn * ny; v[i * 3 + 2] = vn * nz; }
		}
		x.set(p.subarray(0, n * 3));

		// 5. forget drops that fell far below everything
		const floor = (this.ground !== null ? this.ground : Math.min(0, ...boxes.map(b => b.min[1]))) - 400;
		for (let i = 0; i < this.n; i++) {
			if (x[i * 3 + 1] > floor) continue;
			const last = --this.n;
			this.kills++;
			for (let k = 0; k < 3; k++) { x[i * 3 + k] = x[last * 3 + k]; v[i * 3 + k] = v[last * 3 + k]; }
			this.owner[i] = this.owner[last];
			this.touch[i] = this.touch[last];
			for (let k = 0; k < 3; k++) this.contact[i * 3 + k] = this.contact[last * 3 + k];
			i--;
		}
	}
}

// ---------------------------------------------------------------------------
// Liquid display: smooth surface around the drops (or just the drops in debug view)
// ---------------------------------------------------------------------------

// a shiny ball picture used as the liquid material, so it shines without extra lights in the scene
const matcaps = new Map();
function matcapFor(color) {
	if (matcaps.has(color)) return matcaps.get(color);
	const size = 128, canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d');
	const base = new THREE.Color(color);
	const shade = (f) => `rgb(${Math.round(Math.min(1, base.r * f) * 255)},${Math.round(Math.min(1, base.g * f) * 255)},${Math.round(Math.min(1, base.b * f) * 255)})`;
	const body = ctx.createRadialGradient(size * 0.45, size * 0.4, size * 0.05, size * 0.5, size * 0.5, size * 0.5);
	body.addColorStop(0, shade(1.35));
	body.addColorStop(0.55, shade(0.9));
	body.addColorStop(1, shade(0.35));
	ctx.fillStyle = body;
	ctx.fillRect(0, 0, size, size);
	const spot = ctx.createRadialGradient(size * 0.36, size * 0.3, 0, size * 0.36, size * 0.3, size * 0.16);
	spot.addColorStop(0, 'rgba(255,255,255,0.95)');
	spot.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = spot;
	ctx.fillRect(0, 0, size, size);
	const texture = new THREE.CanvasTexture(canvas);
	matcaps.set(color, texture);
	return texture;
}

// Smooth surface around the drops that are flying (naive surface nets).
// The grid only exists in small blocks where drops are, so a wide fast splash keeps the same fine detail.
const BLOCK = 8, BLOCK3 = BLOCK * BLOCK * BLOCK;
const KS = 131072, KOFF = 65536;
const gridKey = (i, j, k) => ((i + KOFF) * KS + (j + KOFF)) * KS + (k + KOFF);

function liquidSurface(sim, owner) {
	const r = sim.r;
	// "look": 0 = fine separate droplets, 1 = thick connected streams
	const look = Math.max(0, Math.min(1, sim.emitters[owner].s.look ?? 0.5));
	const R = r * (1.1 + 1.3 * look), R2 = R * R, T = 0.5;
	const cs = Math.min(r * 0.7, R * 0.45);
	const FLAT = 0.6, flat_k = 1 / (FLAT * FLAT) - 1;
	const blocks = new Map();
	let last_key = null, last_block = null;
	const blockFor = (i, j, k, create) => {
		const key = gridKey(i >> 3, j >> 3, k >> 3);
		if (key === last_key) return last_block;
		let b = blocks.get(key);
		if (!b) {
			if (!create) return null;
			b = new Float32Array(BLOCK3);
			blocks.set(key, b);
		}
		last_key = key; last_block = b;
		return b;
	};
	const local = (i, j, k) => ((i & 7) * BLOCK + (j & 7)) * BLOCK + (k & 7);
	const get = (i, j, k) => { const b = blockFor(i, j, k, false); return b ? b[local(i, j, k)] : 0; };

	const x = sim.x;
	for (let p = 0; p < sim.n; p++) {
		if (sim.owner[p] != owner) continue;
		let px = x[p * 3], py = x[p * 3 + 1], pz = x[p * 3 + 2];
		const touching = sim.touch[p];
		const cnx = sim.contact[p * 3], cny = sim.contact[p * 3 + 1], cnz = sim.contact[p * 3 + 2];
		if (touching) { px -= cnx * r * (1 - FLAT); py -= cny * r * (1 - FLAT); pz -= cnz * r * (1 - FLAT); }
		const i0 = Math.ceil((px - R) / cs), i1 = Math.floor((px + R) / cs);
		const j0 = Math.ceil((py - R) / cs), j1 = Math.floor((py + R) / cs);
		const k0 = Math.ceil((pz - R) / cs), k1 = Math.floor((pz + R) / cs);
		for (let i = i0; i <= i1; i++) {
			const dx = i * cs - px, dx2 = dx * dx;
			for (let j = j0; j <= j1; j++) {
				const dy = j * cs - py, dxy2 = dx2 + dy * dy;
				if (dxy2 >= R2) continue;
				for (let k = k0; k <= k1; k++) {
					const dz = k * cs - pz;
					let d2 = dxy2 + dz * dz;
					if (d2 >= R2) continue;
					if (touching) {
						const dn = dx * cnx + dy * cny + dz * cnz;
						d2 += dn * dn * flat_k;
						if (d2 >= R2) continue;
					}
					const f = 1 - d2 / R2;
					blockFor(i, j, k, true)[local(i, j, k)] += f * f * f;
				}
			}
		}
	}

	const positions = [], indices = [];
	const vertex_of = new Map();
	const CX = [0, 1, 0, 1, 0, 1, 0, 1], CY = [0, 0, 1, 1, 0, 0, 1, 1], CZ = [0, 0, 0, 0, 1, 1, 1, 1];
	const EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
	const vals = new Float32Array(8);
	const cellVertex = (i, j, k) => {
		const key = gridKey(i, j, k);
		const known = vertex_of.get(key);
		if (known !== undefined) return known;
		for (let n = 0; n < 8; n++) vals[n] = get(i + CX[n], j + CY[n], k + CZ[n]);
		let sx = 0, sy = 0, sz = 0, count = 0;
		for (let e = 0; e < 12; e++) {
			const a = EA[e], b = EB[e], va = vals[a], vb = vals[b];
			if ((va > T) == (vb > T)) continue;
			const t = (T - va) / (vb - va);
			sx += CX[a] + (CX[b] - CX[a]) * t; sy += CY[a] + (CY[b] - CY[a]) * t; sz += CZ[a] + (CZ[b] - CZ[a]) * t;
			count++;
		}
		const index = positions.length / 3;
		positions.push((i + sx / count) * cs, (j + sy / count) * cs, (k + sz / count) * cs);
		vertex_of.set(key, index);
		return index;
	};
	const AX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
	for (const [key, b] of blocks) {
		const bk = key % KS - KOFF, rest = (key - (key % KS)) / KS, bj = rest % KS - KOFF, bi = (rest - (rest % KS)) / KS - KOFF;
		for (let n = 0; n < BLOCK3; n++) {
			if (b[n] <= T) continue;
			const i = bi * BLOCK + Math.floor(n / 64), j = bj * BLOCK + (Math.floor(n / 8) & 7), k = bk * BLOCK + (n & 7);
			for (let ax = 0; ax < 3; ax++) {
				const e = AX[ax], u = AX[(ax + 1) % 3], w = AX[(ax + 2) % 3];
				for (let s = 1; s >= -1; s -= 2) {
					if (get(i + e[0] * s, j + e[1] * s, k + e[2] * s) > T) continue;
					// edge between an inside and an outside grid point: one quad from the 4 cells around that edge
					const si = s > 0 ? i : i - e[0], sj = s > 0 ? j : j - e[1], sk = s > 0 ? k : k - e[2];
					const q0 = cellVertex(si, sj, sk);
					const q1 = cellVertex(si - u[0], sj - u[1], sk - u[2]);
					const q2 = cellVertex(si - u[0] - w[0], sj - u[1] - w[1], sk - u[2] - w[2]);
					const q3 = cellVertex(si - w[0], sj - w[1], sk - w[2]);
					if (s > 0) indices.push(q0, q1, q2, q0, q2, q3);
					else indices.push(q0, q2, q1, q0, q3, q2);
				}
			}
		}
	}
	smoothSurface(positions, indices, 2);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	return geometry;
}

// move every vertex half way to the average of its neighbours: rounder drops, no blocky steps
function smoothSurface(positions, indices, passes) {
	const nv = positions.length / 3;
	const sum = new Float64Array(nv * 3), count = new Uint16Array(nv);
	for (let pass = 0; pass < passes; pass++) {
		sum.fill(0); count.fill(0);
		for (let t = 0; t < indices.length; t += 3) {
			for (let e = 0; e < 3; e++) {
				const a = indices[t + e], b = indices[t + (e + 1) % 3];
				sum[a * 3] += positions[b * 3]; sum[a * 3 + 1] += positions[b * 3 + 1]; sum[a * 3 + 2] += positions[b * 3 + 2]; count[a]++;
				sum[b * 3] += positions[a * 3]; sum[b * 3 + 1] += positions[a * 3 + 1]; sum[b * 3 + 2] += positions[a * 3 + 2]; count[b]++;
			}
		}
		for (let v = 0; v < nv; v++) {
			if (!count[v]) continue;
			for (let k = 0; k < 3; k++) positions[v * 3 + k] = positions[v * 3 + k] * 0.5 + sum[v * 3 + k] / count[v] * 0.5;
		}
	}
}


// ---------------------------------------------------------------------------
// Baked liquid: every frame of the drops is kept, and shown in the Animate tab along with the timeline
// ---------------------------------------------------------------------------

const liquid_bakes = new Map();   // animation uuid -> recorded drops
function snapshotLiquid(sim) {
	const n = sim.n;
	const contact = new Int8Array(n * 3);
	for (let i = 0; i < n; i++) {
		if (!sim.touch[i]) continue;
		for (let k = 0; k < 3; k++) contact[i * 3 + k] = Math.round(sim.contact[i * 3 + k] * 127) || (k == 1 ? 1 : 0);
	}
	return {n, kills: sim.kills, x: Float32Array.from(sim.x.subarray(0, n * 3)), owner: Int16Array.from(sim.owner.subarray(0, n)), contact};
}

// the drops at any moment of the animation (smoothly between two recorded frames)
function liquidAtTime(bake, time) {
	const last = bake.frames.length - 1;
	const f = Math.max(0, Math.min(last, time * bake.fps));
	const i0 = Math.floor(f), i1 = Math.min(last, i0 + 1), t = f - i0;
	const a = bake.frames[i0], b = bake.frames[i1];
	const blend = a.n == b.n && a.kills == b.kills;
	const src = blend || t < 0.5 ? a : b;
	const n = src.n;
	const x = new Float64Array(n * 3);
	for (let k = 0; k < n * 3; k++) x[k] = blend ? a.x[k] + (b.x[k] - a.x[k]) * t : src.x[k];
	const touch = new Uint8Array(n), contact = new Float64Array(n * 3);
	for (let i = 0; i < n; i++) {
		const cx = src.contact[i * 3], cy = src.contact[i * 3 + 1], cz = src.contact[i * 3 + 2];
		if (!cx && !cy && !cz) continue;
		const len = Math.hypot(cx, cy, cz);
		touch[i] = 1;
		contact[i * 3] = cx / len; contact[i * 3 + 1] = cy / len; contact[i * 3 + 2] = cz / len;
	}
	return {r: bake.r, n, x, owner: src.owner, touch, contact, emitters: bake.emitters};
}

function setSourcesVisible(visible, sources) {
	(sources || liquidSources()).forEach(el => { if (el.mesh) el.mesh.visible = visible ? el.visibility !== false : false; });
}

let animation_liquid_shown = false, animation_liquid_key = '';
function updateAnimationLiquid() {
	const animation = Project && Modes.animate && Animation.selected;
	const bake = animation && liquid_bakes.get(animation.uuid);
	if (!bake) {
		if (animation_liquid_shown) {
			clearLiquidDisplay();
			setSourcesVisible(true);
			animation_liquid_shown = false;
			animation_liquid_key = '';
		}
		return;
	}
	// Blockbench redraws the animation many times a second even when paused: only rebuild when the time changes
	const key = animation.uuid + ':' + Timeline.time.toFixed(4) + ':' + bake.view;
	if (animation_liquid_shown && key == animation_liquid_key && liquid_objects.length) return;
	animation_liquid_key = key;
	setSourcesVisible(false, bake.sources);
	if (bake.shapes && bake.view != 'points') {
		const f = Math.max(0, Math.min(bake.shapes.length - 1, Math.round(Timeline.time * bake.fps)));
		showLiquidShapes(unpackShapes(bake.shapes[f]), bake.emitters);
	} else {
		showLiquid(liquidAtTime(bake, Timeline.time), bake.view);
	}
	animation_liquid_shown = true;
}


let liquid_objects = [];
function clearLiquidDisplay() {
	animation_liquid_key = '';
	liquid_objects.forEach(o => { if (o.parent) o.parent.remove(o); o.geometry.dispose(); o.material.dispose(); });
	liquid_objects = [];
}
// 3D geometry of the liquid of every source
function liquidShapes(sim) {
	return sim.emitters.map(e => ({surface: liquidSurface(sim, e.index)}));
}
function addLiquidObject(object) {
	object.renderOrder = 2;
	scene.add(object);
	liquid_objects.push(object);
}
function showLiquidShapes(shapes, emitters) {
	clearLiquidDisplay();
	shapes.forEach((shape, i) => {
		const matcap = matcapFor(emitters[i].s.color);
		addLiquidObject(new THREE.Mesh(shape.surface, new THREE.MeshMatcapMaterial({matcap, side: THREE.DoubleSide})));
	});
}
function showLiquid(sim, view) {
	clearLiquidDisplay();
	if (!sim || !sim.n) return;
	if (view != 'points') return showLiquidShapes(liquidShapes(sim), sim.emitters);
	for (const e of sim.emitters) {
		const pts = [];
		for (let p = 0; p < sim.n; p++) if (sim.owner[p] == e.index) pts.push(sim.x[p * 3], sim.x[p * 3 + 1], sim.x[p * 3 + 2]);
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
		addLiquidObject(new THREE.Points(geometry, new THREE.PointsMaterial({color: e.s.color, size: sim.r * 2, sizeAttenuation: true})));
	}
}

// the finished geometry of one baked frame, kept as plain arrays
function packShapes(shapes) {
	return shapes.map(({surface}) => ({
		surface: {position: surface.attributes.position.array, index: surface.index ? surface.index.array : new Uint32Array(0)},
	}));
}
function unpackShapes(packed) {
	return packed.map(({surface}) => {
		const a = new THREE.BufferGeometry();
		a.setAttribute('position', new THREE.BufferAttribute(surface.position, 3));
		a.setIndex(new THREE.BufferAttribute(surface.index, 1));
		a.computeVertexNormals();
		return {surface: a};
	});
}



// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

let sim = null;   // {world, time, acc, last, playing}

function applyPoses(entries) {
	for (const entry of entries) {
		if (entry.desc.settings.type != 'dynamic') continue;
		const mesh = entry.desc.node.mesh;
		mesh.parent.updateMatrixWorld(true);
		const local = new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert().multiply(bodyWorld(entry));
		const {pos, quat} = decompose(local);
		mesh.position.copy(pos);
		mesh.quaternion.copy(quat);
		mesh.updateMatrixWorld(true);
	}
}

function noObjectsMessage() {
	Blockbench.showQuickMessage(tr('msg_nothing'), 2500);
}

function createSim() {
	restPose();
	const descs = bodyNodes().map(describeBody);
	const sources = liquidSources();
	if (!descs.some(d => d.settings.type == 'dynamic') && !sources.length) return null;
	const ws = worldOf();
	const rt = createRuntime(descs, ws);
	sources.forEach(el => { el.mesh.visible = false; });   // the source cube only marks where the liquid comes from
	return Object.assign(rt, {view: ws.liquid_view, acc: 0, last: performance.now(), playing: false});
}

const stepSim = stepRuntime;

function showSim(s) {
	hideArrows();
	applyPoses(s.world.entries);
	if (s.liquid) showLiquid(s.liquid, s.view);
}

// run the simulation without the screen (used for testing and for quick checks)
async function simulateFor(seconds) {
	await loadJolt();
	reset();
	sim = createSim();
	if (!sim) return null;
	const steps = Math.round(seconds / FIXED_DT);
	const t0 = performance.now();
	for (let i = 0; i < steps; i++) stepSim(sim);
	const t1 = performance.now();
	showSim(sim);
	updatePanel();
	return {time: sim.time, drops: sim.liquid ? sim.liquid.n : 0, step_ms: Math.round(t1 - t0), draw_ms: Math.round(performance.now() - t1)};
}

async function play() {
	await loadJolt();
	if (!sim) {
		sim = createSim();
		if (!sim) return noObjectsMessage();
	}
	if (sim.playing) return;
	hideArrows();
	sim.playing = true;
	sim.last = performance.now();
	const tick = now => {
		if (!sim || !sim.playing) return;
		sim.acc += Math.min(0.1, (now - sim.last) / 1000);
		sim.last = now;
		while (sim.acc >= FIXED_DT) {
			stepSim(sim);
			sim.acc -= FIXED_DT;
		}
		showSim(sim);
		updatePanel();
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	updatePanel();
}

function pause() {
	if (sim) sim.playing = false;
	updatePanel();
}

function reset() {
	if (sim) {
		sim.playing = false;
		destroyWorld(sim.world);
		sim = null;
	}
	clearLiquidDisplay();
	if (Project) {
		liquidSources().forEach(el => { el.mesh.visible = el.visibility !== false; });
		restPose();
	}
	updatePanel();
	updateArrows();
}

// ---------------------------------------------------------------------------
// Bake into an animation
// ---------------------------------------------------------------------------

// keep only the keyframes needed to follow the samples within the tolerance (linear interpolation)
function reduceKeys(samples, tolerance) {
	if (samples.length <= 2) return samples.map((_, i) => i);
	const keep = [0];
	let i = 0;
	while (i < samples.length - 1) {
		let j = i + 1;
		while (j + 1 < samples.length) {
			const cand = j + 1;
			let ok = true;
			for (let m = i + 1; m < cand && ok; m++) {
				const f = (m - i) / (cand - i);
				for (let a = 0; a < 3; a++) {
					const lerp = samples[i][a] + (samples[cand][a] - samples[i][a]) * f;
					if (Math.abs(lerp - samples[m][a]) > tolerance) { ok = false; break; }
				}
			}
			if (!ok) break;
			j = cand;
		}
		keep.push(j);
		i = j;
	}
	return keep;
}

async function bake() {
	if (!Format.animation_mode) {
		Blockbench.showQuickMessage(tr('msg_no_animations'), 2500);
		return;
	}
	await loadJolt();
	reset();
	if (!bodyNodes().some(n => typeOf(n) == 'dynamic') && !liquidSources().length) return noObjectsMessage();

	// Blockbench animates groups only: ticked cubes / meshes get their own group (same pivot, same random seed)
	const loose = bodyNodes().filter(n => isPart(n) && typeOf(n) == 'dynamic');
	Undo.initEdit({outliner: true, groups: [], elements: loose, animations: [], selection: true});
	const new_groups = [];
	for (const el of loose) {
		const group = new Group({name: el.name, origin: el.origin.slice()});
		if (el.parent instanceof Group) group.addTo(el.parent);
		group.init();
		group.physics = Object.assign(JSON.parse(JSON.stringify(el.physics)), {seed: el.physics.seed || el.uuid});
		el.addTo(group);
		el.physics = null;
		new_groups.push(group);
	}
	if (loose.length) Canvas.updateAll();
	restPose();

	const descs = bodyNodes().map(describeBody);
	const dynamic = descs.filter(d => d.settings.type == 'dynamic');
	const ws = worldOf();
	const fps = Math.max(1, Math.round(ws.fps));
	const frames = Math.max(1, Math.round(ws.duration * fps));
	const rt = createRuntime(descs, ws, Math.max(1, Math.min(3, Math.round(ws.bake_quality || 1))));
	const {world, liquid, sources} = rt;
	const liquid_frames = [], liquid_shapes = [];

	// sample every body's world transform (and the liquid) at every frame
	const tracks = new Map(world.entries.map(e => [e.desc.node, []]));
	for (let f = 0; f <= frames; f++) {
	const target = f / fps;
	while (rt.time + FIXED_DT / 2 < target) stepRuntime(rt);
		world.entries.forEach(e => tracks.get(e.desc.node).push(bodyWorld(e)));
		if (liquid) {
			liquid_frames.push(snapshotLiquid(liquid));
			if (ws.liquid_view != 'points') liquid_shapes.push(packShapes(liquidShapes(liquid)));
			// a detailed liquid takes a while: show progress and keep Blockbench responsive
			Blockbench.setProgress(f / frames);
			await new Promise(resolve => setTimeout(resolve, 0));
		}
	}
	Blockbench.setProgress(0);
	destroyWorld(world);

	// animated world transform of any group at a frame (bodies follow their track, the rest follow their parents)
	const rest_world = g => descs.find(d => d.node == g)?.world || g.mesh.matrixWorld.clone();
	const animatedWorld = (node, f) => {
		if (tracks.has(node) && typeOf(node) == 'dynamic') return tracks.get(node)[f].clone();
		const parent = node.parent instanceof Group ? node.parent : null;
		if (!parent) return rest_world(node);
		const local = new THREE.Matrix4().copy(rest_world(parent)).invert().multiply(rest_world(node));
		return animatedWorld(parent, f).multiply(local);
	};
	const parentWorld = (group, f) => group.parent instanceof Group ? animatedWorld(group.parent, f) : group.mesh.parent.matrixWorld.clone();

	const animation = new Animation({name: 'physics', length: frames / fps, loop: 'once', snapping: fps}).add(false);   // part of the 'Bake physics' undo step
	for (const desc of dynamic) {
		const group = desc.node;
		const animator = animation.getBoneAnimator(group);
		const positions = [], rotations = [];
		let prev = null;
		for (let f = 0; f <= frames; f++) {
			const local = parentWorld(group, f).invert().multiply(tracks.get(group)[f]);
			const {pos, quat} = decompose(local);
			positions.push([0, 1, 2].map(i => pos.getComponent(i) - desc.rest_position.getComponent(i)));
			const e = new THREE.Euler().setFromQuaternion(quat, Format.euler_order || 'ZYX');
			let deg = [e.x, e.y, e.z].map((r, i) => r * 180 / Math.PI - group.rotation[i]);
			if (prev) deg = deg.map((d, i) => d + 360 * Math.round((prev[i] - d) / 360));   // no jumps between frames
			rotations.push(deg);
			prev = deg;
		}
		const round = n => Math.round(n * 1e4) / 1e4;
		for (const [channel, samples, tol] of [['position', positions, 0.01], ['rotation', rotations, 0.1]]) {
			for (const f of reduceKeys(samples, tol)) {
				const s = samples[f];
				animator.addKeyframe({channel, time: f / fps, interpolation: 'linear', data_points: [{x: round(s[0]), y: round(s[1]), z: round(s[2])}]});
			}
		}
	}
	Undo.finishEdit('Bake physics', {outliner: true, groups: new_groups, elements: loose, animations: [animation], selection: true});
	if (liquid) {
		liquid_bakes.set(animation.uuid, {fps, r: liquid.r, view: ws.liquid_view, sources, frames: liquid_frames, shapes: liquid_shapes.length ? liquid_shapes : null,
			emitters: liquid.emitters.map(e => ({index: e.index, s: Object.assign({}, e.s)}))});
	}
	Modes.options.animate.select();
	animation.select();
	Timeline.setTime(0);
	Animator.preview();
	Blockbench.showQuickMessage(`${tr('msg_baked')} "${animation.name}"`, 2000);
}

// ---------------------------------------------------------------------------
// Editor helpers: arrows (where liquid / objects start going) and force field icons.
// Everything is redrawn when something moves, so dragging or rotating an object keeps them right.
// ---------------------------------------------------------------------------

let arrows = [];
let arrow_key = '';
function hideArrows() {
	arrows.forEach(a => a.parent && a.parent.remove(a));
	arrows = [];
	arrow_key = '';
}
function addArrow(origin, dir, length, color) {
	const arrow = new THREE.ArrowHelper(dir.clone().normalize(), origin, length, color, Math.min(4, length * 0.3), Math.min(2.5, length * 0.2));
	arrow.renderOrder = 999;
	arrow.traverse(o => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; } });
	scene.add(arrow);
	arrows.push(arrow);
}
const matrixKey = obj => { obj.updateMatrixWorld(true); return obj.matrixWorld.elements.map(n => Math.round(n * 100)).join(','); };
function updateArrows(preview) {
	if (!Project || !Modes.physics || sim) return hideArrows();
	const items = [];
	for (const el of liquidSources()) {
		const s = preview && preview.nodes.includes(el) ? Object.assign(liquidOf(el), preview.values) : liquidOf(el);
		items.push({color: new THREE.Color(s.color).lerp(new THREE.Color(1, 1, 1), 0.35), origin: sourceBox(el).center, dir: liquidDirection(el), length: 6 + s.speed * 2.5});
	}
	for (const node of bodyNodes()) {
		const s = bodyOf(node);
		if (s.type != 'dynamic') continue;
		const v = new THREE.Vector3(...s.velocity), speed = v.length();
		if (speed < 1e-6) continue;
		items.push({color: new THREE.Color(0xff8a1f), origin: node.mesh.getWorldPosition(new THREE.Vector3()), dir: v.normalize(), length: Math.min(80, 4 + speed * 2)});
	}
	// only rebuild when something changed (called many times a second)
	const key = items.map(i => [i.color.getHex(), i.length.toFixed(2), i.origin.toArray().map(n => n.toFixed(2)), i.dir.toArray().map(n => n.toFixed(3))].join()).join('|');
	if (key == arrow_key && !preview) return;
	hideArrows();
	arrow_key = key;
	items.forEach(i => addArrow(i.origin, i.dir, i.length, i.color));
}

const FIELD_COLORS = {push: 0xff7a1a, pull: 0x35b6ff, wind: 0x4ee08a};
const field_icons = new Map();
// flat 2D icon of a field (push: arrows out, pull: arrows in, wind: wavy lines)
function fieldIcon(kind) {
	if (field_icons.has(kind)) return field_icons.get(kind);
	const size = 128, canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const c = canvas.getContext('2d'), color = '#' + FIELD_COLORS[kind].toString(16).padStart(6, '0');
	c.fillStyle = 'rgba(20,20,24,0.8)'; c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
	c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 6; c.lineCap = 'round'; c.lineJoin = 'round';
	c.beginPath(); c.arc(64, 64, 58, 0, Math.PI * 2); c.stroke();
	const arrow = (angle, from, to) => {
		c.save(); c.translate(64, 64); c.rotate(angle);
		c.beginPath(); c.moveTo(from, 0); c.lineTo(to, 0); c.stroke();
		const d = to > from ? -1 : 1;
		c.beginPath(); c.moveTo(to + d * 12, -9); c.lineTo(to, 0); c.lineTo(to + d * 12, 9); c.stroke();
		c.restore();
	};
	if (kind == 'wind') {
		c.lineWidth = 7;
		[-24, 0, 24].forEach((y, i) => { c.beginPath(); c.moveTo(24, 64 + y); c.bezierCurveTo(48, 64 + y - 16, 72, 64 + y + 16, 100 + (i == 1 ? 4 : -6), 64 + y); c.stroke(); });
	} else {
		for (let k = 0; k < 4; k++) kind == 'push' ? arrow(k * Math.PI / 2, 12, 46) : arrow(k * Math.PI / 2, 46, 12);
	}
	const texture = new THREE.CanvasTexture(canvas);
	field_icons.set(kind, texture);
	return texture;
}

let field_helpers = new Map();   // group uuid -> {object, sphere, wire, sprite, arrow, icon}
function removeFieldHelper(uuid) {
	const h = field_helpers.get(uuid);
	if (!h) return;
	if (h.object.parent) h.object.parent.remove(h.object);
	h.object.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
	field_helpers.delete(uuid);
}
function clearFieldHelpers() {
	[...field_helpers.keys()].forEach(removeFieldHelper);
}
function previewCamera() {
	return typeof Preview != 'undefined' && Preview.selected && Preview.selected.camera;
}
function syncFieldHelpers() {
	if (!Project || sim || !(Modes.physics || Modes.edit || Modes.animate)) return clearFieldHelpers();
	const nodes = forceNodes().filter(n => n.mesh);
	for (const uuid of [...field_helpers.keys()]) if (!nodes.some(n => n.uuid == uuid)) removeFieldHelper(uuid);
	const cam = previewCamera();
	for (const node of nodes) {
		const s = forceOf(node);
		const kind = s.kind == 'wind' ? 'wind' : s.strength < 0 ? 'pull' : 'push';
		let h = field_helpers.get(node.uuid);
		if (!h) {
			const object = new THREE.Object3D();
			const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshBasicMaterial({transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide}));
			const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 16, 10)), new THREE.LineBasicMaterial({transparent: true, opacity: 0.35, depthWrite: false}));
			const sprite = new THREE.Sprite(new THREE.SpriteMaterial({sizeAttenuation: false, depthTest: false, transparent: true}));
			sprite.renderOrder = 1000;
			object.add(sphere, wire, sprite);
			object.renderOrder = 900;
			scene.add(object);
			h = {object, sphere, wire, sprite, arrow: null, icon: ''};
			field_helpers.set(node.uuid, h);
		}
		const color = FIELD_COLORS[kind];
		node.mesh.updateMatrixWorld(true);
		h.object.position.copy(node.mesh.getWorldPosition(new THREE.Vector3()));
		const radius = s.radius > 0 ? s.radius : 0;
		h.sphere.visible = h.wire.visible = radius > 0;
		h.sphere.scale.setScalar(Math.max(radius, 0.001)); h.wire.scale.setScalar(Math.max(radius, 0.001));
		h.sphere.material.color.setHex(color); h.wire.material.color.setHex(color);
		if (h.icon != kind) { h.sprite.material.map = fieldIcon(kind); h.sprite.material.needsUpdate = true; h.icon = kind; }
		const ortho = cam && cam.isOrthographicCamera;
		h.sprite.scale.setScalar(ortho ? (cam.top - cam.bottom) / (cam.zoom || 1) * 0.045 : 0.05);
		// wind direction arrow
		if (h.arrow) { h.object.remove(h.arrow); h.arrow = null; }
		if (kind == 'wind') {
			const length = Math.max(12, Math.min(60, radius > 0 ? radius * 0.8 : 30));
			h.arrow = new THREE.ArrowHelper(nodeDirection(node), new THREE.Vector3(), length, color, 5, 3);
			h.arrow.traverse(o => { if (o.material) { o.material.depthTest = false; o.material.transparent = true; } });
			h.arrow.renderOrder = 999;
			h.object.add(h.arrow);
		}
	}
}

// the Move / Rotate tools have to work in the physics tab (to aim sources and winds and to place empties)
let tool_patches = [];
function allowToolInPhysics(tool) {
	if (!tool) return;
	const c = tool.condition;
	if (c && typeof c == 'object' && c.modes instanceof Array) {
		if (c.modes.includes('physics')) return;
		c.modes.push('physics');
		tool_patches.push(() => c.modes.remove('physics'));
	} else if (typeof c == 'function') {
		tool.condition = (...args) => (Modes.physics && Project && Format && Format.id != 'image') || c(...args);
		tool_patches.push(() => { tool.condition = c; });
	}
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

let mode = null, panel = null, properties = [], poll = null;

// selected groups, otherwise selected cubes / meshes
function selectedNodes() {
	if (!Project) return [];
	const groups = (Group.multi_selected && Group.multi_selected.length) ? Group.multi_selected.slice() : (Group.first_selected ? [Group.first_selected] : []);
	if (groups.length) return groups;
	return Outliner.selected.filter(isPart);
}

function updatePanel() {
	if (!panel || !panel.inside_vue) return;
	const vue = panel.inside_vue;
	const nodes = selectedNodes();
	const key = nodes.map(n => n.uuid).join(',');
	if (vue.selection_key != key) {
		vue.selection_key = key;
		vue.count = nodes.length;
		vue.has_group = nodes.some(n => n instanceof Group);
		vue.label = nodes.length == 1 ? nodes[0].name : `${nodes.length} selected`;
		const types = new Set(nodes.map(typeOf));
		vue.type = types.size == 1 ? [...types][0] : 'mixed';
		const owner = nodes.length == 1 && typeOf(nodes[0]) == 'none' ? ownerOf(nodes[0].parent) : null;
		vue.owner = owner ? owner.name : '';
		vue.l_available = nodes.length > 0 && nodes.every(isPart);
		vue.l_enabled = vue.l_available && nodes.every(isLiquid);
		const l = liquidOf(nodes.find(isLiquid) || nodes[0] || {});
		Object.assign(vue, {l_amount: l.amount, l_size: l.size, l_speed: l.speed, l_spread: l.spread,
			l_emit_time: l.emit_time, l_cohesion: l.cohesion, l_stickiness: l.stickiness, l_thickness: l.thickness, l_gravity: l.gravity, l_color: l.color, l_look: l.look});
		const s = bodyOf(nodes.find(n => typeOf(n) == 'dynamic') || nodes[0] || {});
		Object.assign(vue, {mass: s.mass, friction: s.friction, restitution: s.restitution, impact: !!s.impact, threshold: s.threshold,
			vx: s.velocity[0], vy: s.velocity[1], vz: s.velocity[2], sx: s.spin[0], sy: s.spin[1], sz: s.spin[2]});
		vue.f_available = nodes.length > 0 && nodes.every(n => n instanceof Group);
		vue.f_enabled = vue.f_available && nodes.every(isForce);
		const f = forceOf(nodes.find(isForce) || nodes[0] || {});
		Object.assign(vue, {f_kind: f.kind, f_strength: f.strength, f_radius: f.radius, f_falloff: !!f.falloff, f_ramp: f.ramp, f_delay: f.delay, f_duration: f.duration,
			f_noise: f.noise, f_noise_speed: f.noise_speed, f_objects: !!f.objects, f_liquid: !!f.liquid});
	}
	// world settings belong to the project: reload them when another project is opened
	if (Project && vue.world_project != Project.uuid) {
		Object.assign(vue, worldOf());
		vue.world_project = Project.uuid;
	}
	vue.state = !sim ? 'stopped' : sim.playing ? 'playing' : 'paused';
	vue.time = sim ? sim.time.toFixed(2) : '0.00';
}

function editNodes(nodes, name, change) {
	const elements = nodes.filter(isPart), groups = nodes.filter(n => n instanceof Group);
	const aspects = groups.length ? {elements, outliner: true, groups} : {elements};
	Undo.initEdit(aspects);
	nodes.forEach(change);
	Undo.finishEdit(name, aspects);
	Project.saved = false;
}

const num = (v, d) => isFinite(parseFloat(v)) ? parseFloat(v) : d;
const clamp01 = v => Math.max(0, Math.min(1, v));

function panelComponent() {
	return {
		data() {
			return {
				tab: 'object',
				selection_key: null, count: 0, has_group: false, label: '', owner: '', type: 'none', world_project: '', state: 'stopped', time: '0.00',
				mass: 1, friction: 0.5, restitution: 0.3, impact: false, threshold: 1, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0,
				gravity: 9.81, chaos: 0.3, ground: true, ground_y: 0, duration: 3, fps: 24, liquid_view: 'surface', bake_quality: 2,
				l_available: false, l_enabled: false, l_amount: 1500, l_size: 0.35, l_speed: 6, l_spread: 12,
				l_emit_time: 0.3, l_cohesion: 0.35, l_stickiness: 0.6, l_thickness: 0.35, l_gravity: 1, l_color: '#7c0a0a', l_look: 0.5,
				f_available: false, f_enabled: false, f_kind: 'push', f_strength: 10, f_radius: 48, f_falloff: true, f_ramp: 0, f_delay: 0, f_duration: 0,
				f_noise: 0, f_noise_speed: 1, f_objects: true, f_liquid: true,
			};
		},
		methods: {
			setType(type, checked) {
				const nodes = selectedNodes();
				if (!nodes.length) return;
				const new_type = checked ? type : 'none';
				editNodes(nodes, 'Change physics', node => {
					node.physics = new_type == 'none' ? null : Object.assign(bodyOf(node), {type: new_type});
					if (new_type != 'none' && node.liquid) node.liquid = Object.assign({}, node.liquid, {enabled: false});
				});
				this.selection_key = null;
				reset();
			},
			saveBody() {
				const values = {
					mass: num(this.mass, 1), friction: num(this.friction, 0.5), restitution: num(this.restitution, 0.3),
					impact: !!this.impact, threshold: Math.max(0, num(this.threshold, 1)),
					velocity: [num(this.vx, 0), num(this.vy, 0), num(this.vz, 0)],
					spin: [num(this.sx, 0), num(this.sy, 0), num(this.sz, 0)],
				};
				editNodes(selectedNodes().filter(n => typeOf(n) != 'none'), 'Change physics', node => {
					node.physics = Object.assign(bodyOf(node), values);
				});
				reset();
			},
			liquidValues() {
				return {
					amount: Math.max(1, Math.min(MAX_DROPS, Math.round(num(this.l_amount, 1500)))), size: Math.max(0.05, num(this.l_size, 0.35)),
					speed: Math.max(0, num(this.l_speed, 6)), spread: Math.max(0, num(this.l_spread, 12)),
					emit_time: Math.max(0, num(this.l_emit_time, 0.3)), cohesion: clamp01(num(this.l_cohesion, 0.35)),
					stickiness: clamp01(num(this.l_stickiness, 0.6)), thickness: clamp01(num(this.l_thickness, 0.35)),
					gravity: num(this.l_gravity, 1), color: this.l_color || '#7c0a0a', look: clamp01(num(this.l_look, 0.5)),
				};
			},
			setLiquid(checked) {
				const nodes = selectedNodes().filter(isPart);
				if (!nodes.length) return;
				editNodes(nodes, 'Change liquid', node => {
					node.liquid = Object.assign(liquidOf(node), {enabled: !!checked});
					if (checked) node.physics = null;
				});
				this.selection_key = null;
				reset();
			},
			saveLiquid() {
				const values = Object.assign(this.liquidValues(), {enabled: true});
				editNodes(selectedNodes().filter(isLiquid), 'Change liquid', node => {
					node.liquid = Object.assign(liquidOf(node), values);
				});
				reset();
			},
			previewArrow() {
				if (sim) return;
				updateArrows({nodes: selectedNodes().filter(isLiquid), values: this.liquidValues()});
			},
			forceValues() {
				return {
					kind: this.f_kind == 'wind' ? 'wind' : 'push', strength: num(this.f_strength, 10), radius: Math.max(0, num(this.f_radius, 48)), falloff: !!this.f_falloff,
					ramp: Math.max(0, num(this.f_ramp, 0)), delay: Math.max(0, num(this.f_delay, 0)), duration: Math.max(0, num(this.f_duration, 0)),
					noise: clamp01(num(this.f_noise, 0)), noise_speed: Math.max(0, num(this.f_noise_speed, 1)), objects: !!this.f_objects, liquid: !!this.f_liquid,
				};
			},
			setForce(checked) {
				const nodes = selectedNodes().filter(n => n instanceof Group);
				if (!nodes.length) return;
				editNodes(nodes, 'Change force', node => { node.force = Object.assign(forceOf(node), {enabled: !!checked}); });
				this.selection_key = null;
				reset();
				syncFieldHelpers();
			},
			saveForce() {
				const values = Object.assign(this.forceValues(), {enabled: true});
				editNodes(selectedNodes().filter(isForce), 'Change force', node => { node.force = Object.assign(forceOf(node), values); });
				reset();
				syncFieldHelpers();
			},
			addForce() {
				Undo.initEdit({outliner: true, groups: [], selection: true});
				const group = new Group({name: 'Force', origin: [0, 16, 0]}).init();
				group.force = Object.assign(forceOf({}), {enabled: true});
				group.addTo();
				group.select();
				Undo.finishEdit('Add force', {outliner: true, groups: [group], selection: true});
				Project.saved = false;
				this.selection_key = null;
				syncFieldHelpers();
				updatePanel();
			},
			tool(name) { const t = BarItems[name]; if (t) t.select(); },
			saveWorld() {
				Project.physics_world = {gravity: num(this.gravity, 9.81), chaos: Math.max(0, num(this.chaos, 0.3)), ground: !!this.ground,
					ground_y: num(this.ground_y, 0), duration: Math.max(0.1, num(this.duration, 3)), fps: Math.max(1, Math.round(num(this.fps, 24))),
					liquid_view: this.liquid_view == 'points' ? 'points' : 'surface', bake_quality: Math.max(1, Math.min(3, Math.round(num(this.bake_quality, 2))))};
				Project.saved = false;
				reset();
			},
			t(key) { return tr(key); },
			play() { play(); },
			pause() { pause(); },
			reset() { reset(); },
			bake() { bake(); },
		},
		template: `
			<div class="physics_panel">
				<div class="physics_buttons">
					<button v-if="state != 'playing'" @click="play()">{{ t('play') }}</button>
					<button v-else @click="pause()">{{ t('pause') }}</button>
					<button @click="reset()">{{ t('reset') }}</button>
					<button @click="bake()" class="wide">{{ t('bake') }}</button>
				</div>
				<div class="physics_dim">{{ t('time') }} {{ time }} {{ t('sec') }} · {{ t(state) }}</div>

				<div class="physics_tabs">
					<button :class="{active: tab == 'object'}" @click="tab = 'object'">{{ t('tab_object') }}</button>
					<button :class="{active: tab == 'liquid'}" @click="tab = 'liquid'">{{ t('tab_liquid') }}</button>
					<button :class="{active: tab == 'forces'}" @click="tab = 'forces'">{{ t('tab_forces') }}</button>
				</div>

				<template v-if="tab == 'object'">
					<div v-if="!count" class="physics_dim">{{ t('select_hint') }}</div>
					<template v-else>
						<div class="physics_title"><b>{{ label }}</b></div>
						<div v-if="owner" class="physics_dim">{{ t('moves_with') }} «{{ owner }}».</div>
						<label class="physics_check">
							<input type="checkbox" :checked="type == 'static'" @change="setType('static', $event.target.checked)">
							<span><b>{{ t('ground') }}</b> — {{ t('ground_desc') }}</span>
						</label>
						<label class="physics_check">
							<input type="checkbox" :checked="type == 'dynamic'" @change="setType('dynamic', $event.target.checked)">
							<span><b>{{ t('object') }}</b> — {{ t('object_desc') }}</span>
						</label>
						<div v-if="type == 'mixed'" class="physics_dim">{{ t('mixed') }}</div>
						<div v-if="has_group && type == 'dynamic'" class="physics_dim">{{ t('group_solid') }}</div>

						<div v-if="type == 'dynamic' || type == 'static'" class="physics_box">
							<div class="physics_grid g3">
								<label v-if="type == 'dynamic'">{{ t('mass') }}<input type="number" step="0.1" v-model="mass" @change="saveBody()"></label>
								<label>{{ t('friction') }}<input type="number" step="0.05" v-model="friction" @change="saveBody()"></label>
								<label>{{ t('bounciness') }}<input type="number" step="0.05" v-model="restitution" @change="saveBody()"></label>
							</div>
						</div>
						<div v-if="type == 'dynamic'" class="physics_box">
							<div class="physics_cap">{{ t('velocity') }}</div>
							<div class="physics_grid g3">
								<input type="number" v-model="vx" @change="saveBody()" title="X">
								<input type="number" v-model="vy" @change="saveBody()" title="Y">
								<input type="number" v-model="vz" @change="saveBody()" title="Z">
							</div>
							<div class="physics_cap">{{ t('spin') }}</div>
							<div class="physics_grid g3">
								<input type="number" v-model="sx" @change="saveBody()" title="X">
								<input type="number" v-model="sy" @change="saveBody()" title="Y">
								<input type="number" v-model="sz" @change="saveBody()" title="Z">
							</div>
						</div>
						<div v-if="type == 'dynamic'" class="physics_box">
							<label class="physics_check" :title="t('impact_tip')">
								<input type="checkbox" v-model="impact" @change="saveBody()">
								<span><b>{{ t('impact') }}</b> — {{ t('impact_desc') }}</span>
							</label>
							<div v-if="impact" class="physics_grid g1">
								<label :title="t('threshold_tip')">{{ t('threshold') }}<input type="number" step="0.1" min="0" v-model="threshold" @change="saveBody()"></label>
							</div>
						</div>
					</template>

					<details class="physics_box">
						<summary>{{ t('world') }}</summary>
						<div class="physics_grid g2">
							<label>{{ t('gravity') }}<input type="number" step="0.1" v-model="gravity" @change="saveWorld()"></label>
							<label :title="t('chaos_tip')">{{ t('chaos') }}<input type="number" step="0.1" min="0" v-model="chaos" @change="saveWorld()"></label>
							<label>{{ t('bake_length') }}<input type="number" step="0.5" v-model="duration" @change="saveWorld()"></label>
							<label>{{ t('bake_fps') }}<input type="number" v-model="fps" @change="saveWorld()"></label>
							<label class="inline">{{ t('infinite_ground') }}<input type="checkbox" v-model="ground" @change="saveWorld()"></label>
							<label v-if="ground">{{ t('ground_height') }}<input type="number" v-model="ground_y" @change="saveWorld()"></label>
						</div>
					</details>
					<div class="physics_dim small">{{ t('footnote') }}</div>
				</template>

				<template v-if="tab == 'liquid'">
					<div v-if="!l_available" class="physics_dim">{{ t('liquid_hint') }}</div>
					<template v-else>
						<label class="physics_check">
							<input type="checkbox" :checked="l_enabled" @change="setLiquid($event.target.checked)">
							<span><b>{{ t('liquid_source') }}</b> — {{ t('liquid_source_desc') }}</span>
						</label>
						<template v-if="l_enabled">
							<div class="physics_box">
								<div class="physics_grid g3">
									<label>{{ t('color') }}<input type="color" v-model="l_color" @change="saveLiquid()"></label>
									<label>{{ t('amount') }}<input type="number" step="100" min="1" v-model="l_amount" @change="saveLiquid()"></label>
									<label>{{ t('drop_size') }}<input type="number" step="0.05" min="0.05" v-model="l_size" @change="saveLiquid()"></label>
								</div>
								<div class="physics_aim">
									<span>{{ t('aim_hint') }}</span>
									<button @click="tool('rotate_tool')" :title="t('aim_tip')">⟳ {{ t('rotate_tool') }}</button>
								</div>
							</div>
							<details class="physics_box" open>
								<summary>{{ t('l_flow') }}</summary>
								<div class="physics_grid g3">
									<label>{{ t('strength') }}<input type="number" step="0.5" min="0" v-model="l_speed" @input="previewArrow()" @change="saveLiquid()"></label>
									<label :title="t('shoot_time_tip')">{{ t('shoot_time') }}<input type="number" step="0.05" min="0" v-model="l_emit_time" @change="saveLiquid()"></label>
									<label>{{ t('liquid_gravity') }}<input type="number" step="0.1" v-model="l_gravity" @change="saveLiquid()"></label>
								</div>
								<div class="physics_slider"><span>{{ t('spread') }}</span><input type="range" min="0" max="90" step="1" v-model.number="l_spread" @change="saveLiquid()"><span class="value">{{ l_spread }}°</span></div>
							</details>
							<details class="physics_box" open>
								<summary>{{ t('l_material') }}</summary>
								<div class="physics_slider" :title="t('cohesion_tip')"><span>{{ t('cohesion') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="l_cohesion" @change="saveLiquid()"><span class="value">{{ l_cohesion }}</span></div>
								<div class="physics_slider" :title="t('stickiness_tip')"><span>{{ t('stickiness') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="l_stickiness" @change="saveLiquid()"><span class="value">{{ l_stickiness }}</span></div>
								<div class="physics_slider" :title="t('thickness_tip')"><span>{{ t('thickness') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="l_thickness" @change="saveLiquid()"><span class="value">{{ l_thickness }}</span></div>
								<div class="physics_slider" :title="t('look_tip')"><span>{{ t('look') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="l_look" @change="saveLiquid()"><span class="value">{{ l_look }}</span></div>
							</details>
						</template>
					</template>
					<details class="physics_box">
						<summary>{{ t('l_view') }}</summary>
						<div class="physics_grid g2">
							<label :title="t('liquid_view_tip')">{{ t('liquid_view') }}
								<select v-model="liquid_view" @change="saveWorld()">
									<option value="surface">{{ t('surface') }}</option>
									<option value="points">{{ t('points') }}</option>
								</select>
							</label>
							<label :title="t('bake_quality_tip')">{{ t('bake_quality') }}
								<select v-model.number="bake_quality" @change="saveWorld()">
									<option :value="1">{{ t('quality_1') }}</option>
									<option :value="2">{{ t('quality_2') }}</option>
									<option :value="3">{{ t('quality_3') }}</option>
								</select>
							</label>
						</div>
					</details>
				</template>

				<template v-if="tab == 'forces'">
					<button class="physics_add" @click="addForce()">{{ t('f_add') }}</button>
					<div v-if="!f_available" class="physics_dim">{{ t('f_hint') }}</div>
					<template v-else>
						<div class="physics_title"><b>{{ label }}</b></div>
						<label class="physics_check">
							<input type="checkbox" :checked="f_enabled" @change="setForce($event.target.checked)">
							<span><b>{{ t('force') }}</b> — {{ t('force_desc') }}</span>
						</label>
						<template v-if="f_enabled">
							<div class="physics_box">
								<div class="physics_grid g2">
									<label>{{ t('f_kind') }}
										<select v-model="f_kind" @change="saveForce()">
											<option value="push">{{ f_strength < 0 ? t('f_pull') : t('f_push') }}</option>
											<option value="wind">{{ t('f_wind') }}</option>
										</select>
									</label>
									<label :title="t('f_strength_tip')">{{ t('f_strength') }}<input type="number" step="0.5" v-model="f_strength" @change="saveForce()"></label>
									<label :title="t('f_radius_tip')">{{ t('f_radius') }}<input type="number" step="4" min="0" v-model="f_radius" @change="saveForce()"></label>
									<label class="inline">{{ t('f_falloff') }}<input type="checkbox" v-model="f_falloff" @change="saveForce()"></label>
								</div>
								<div v-if="f_kind == 'wind'" class="physics_aim">
									<span>{{ t('f_wind_hint') }}</span>
									<button @click="tool('rotate_tool')">⟳ {{ t('rotate_tool') }}</button>
									<button @click="tool('move_tool')">✥ {{ t('move_tool') }}</button>
								</div>
							</div>
							<details class="physics_box" open>
								<summary>{{ t('f_time') }}</summary>
								<div class="physics_grid g3">
									<label :title="t('f_ramp_tip')">{{ t('f_ramp') }}<input type="number" step="0.1" min="0" v-model="f_ramp" @change="saveForce()"></label>
									<label :title="t('f_duration_tip')">{{ t('f_duration') }}<input type="number" step="0.1" min="0" v-model="f_duration" @change="saveForce()"></label>
									<label>{{ t('f_delay') }}<input type="number" step="0.1" min="0" v-model="f_delay" @change="saveForce()"></label>
								</div>
							</details>
							<details class="physics_box" open>
								<summary>{{ t('f_noise') }}</summary>
								<div class="physics_slider" :title="t('f_noise_tip')"><span>{{ t('f_noise') }}</span><input type="range" min="0" max="1" step="0.05" v-model.number="f_noise" @change="saveForce()"><span class="value">{{ f_noise }}</span></div>
								<div v-if="f_noise > 0" class="physics_grid g1"><label>{{ t('f_noise_speed') }}<input type="number" step="0.1" min="0" v-model="f_noise_speed" @change="saveForce()"></label></div>
							</details>
							<div class="physics_box">
								<div class="physics_cap">{{ t('f_affects') }}</div>
								<div class="physics_grid g2">
									<label class="inline">{{ t('f_objects') }}<input type="checkbox" v-model="f_objects" @change="saveForce()"></label>
									<label class="inline">{{ t('f_liquid') }}<input type="checkbox" v-model="f_liquid" @change="saveForce()"></label>
								</div>
							</div>
						</template>
					</template>
					<div class="physics_dim small">{{ t('f_note') }}</div>
				</template>
			</div>`,
	};
}

const STYLE = `
	#panel_physics .physics_panel { overflow-y: auto !important; overflow-x: hidden !important; padding: 4px 8px 10px; font-size: 0.92em; }
	.physics_panel .physics_buttons { display: flex; gap: 4px; margin-bottom: 6px; }
	.physics_panel .physics_buttons button { flex: 1; }
	.physics_panel .physics_buttons button.wide { flex: 1.3; }
	.physics_panel .physics_dim { opacity: 0.7; margin: 2px 0 6px; }
	.physics_panel .physics_dim.small { font-size: 0.85em; opacity: 0.55; margin-top: 10px; }
	.physics_panel .physics_title { margin: 4px 0; }
	.physics_panel .physics_tabs { display: flex; gap: 2px; margin: 6px 0 8px; border-bottom: 1px solid var(--color-border); }
	.physics_panel .physics_tabs button { flex: 1; background: transparent; border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 5px 4px; opacity: 0.65; text-transform: uppercase; font-size: 0.85em; }
	.physics_panel .physics_tabs button.active { opacity: 1; border-bottom-color: var(--color-accent); }
	.physics_panel .physics_check { display: flex; align-items: flex-start; gap: 8px; margin: 4px 0; cursor: pointer; }
	.physics_panel .physics_check input { margin-top: 3px; }
	.physics_panel .physics_box { margin: 6px 0; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-back); }
	.physics_panel .physics_box > summary { cursor: pointer; text-transform: uppercase; font-size: 0.82em; opacity: 0.8; outline: none; }
	.physics_panel details.physics_box[open] > summary { margin-bottom: 6px; }
	.physics_panel .physics_cap { font-size: 0.82em; opacity: 0.75; margin: 4px 0 2px; }
	.physics_panel .physics_grid { display: grid; gap: 4px 6px; }
	.physics_panel .physics_grid.g1 { grid-template-columns: 1fr; }
	.physics_panel .physics_grid.g2 { grid-template-columns: 1fr 1fr; }
	.physics_panel .physics_grid.g3 { grid-template-columns: 1fr 1fr 1fr; }
	.physics_panel .physics_grid label { display: flex; flex-direction: column; gap: 1px; font-size: 0.82em; min-width: 0; }
	.physics_panel .physics_grid label.inline { flex-direction: row; align-items: center; justify-content: space-between; align-self: end; gap: 6px; }
	.physics_panel .physics_grid input, .physics_panel .physics_grid select { width: 100%; min-width: 0; box-sizing: border-box; }
	.physics_panel .physics_slider { display: flex; align-items: center; gap: 6px; margin: 2px 0; font-size: 0.88em; }
	.physics_panel .physics_slider > span:first-child { width: 34%; }
	.physics_panel .physics_slider input[type=range] { flex: 1; min-width: 0; }
	.physics_panel .physics_slider .value { width: 34px; text-align: right; opacity: 0.8; }
	.physics_panel .physics_aim { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 6px; font-size: 0.82em; opacity: 0.9; }
	.physics_panel .physics_aim span { flex: 1 1 100%; opacity: 0.75; }
	.physics_panel .physics_add { width: 100%; margin-bottom: 6px; }
	.physics_panel input[type=color] { height: 22px; border: 1px solid var(--color-border); background: transparent; padding: 0; }
	.physics_panel input[type=number], .physics_panel select {
		background: var(--color-back); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 3px; padding: 2px 4px;
	}
	.physics_panel .physics_box input[type=number], .physics_panel .physics_box select { background: var(--color-dark); }
	.physics_panel button { padding: 4px 6px; min-width: 0; }
`;
let style_node = null;
const onSelection = () => updatePanel();
const onModeChange = () => { updateArrows(); syncFieldHelpers(); };
const onPoll = () => {
	if (!Project) return;
	syncFieldHelpers();
	if (Modes.physics && !sim) updateArrows();
};

if (typeof __PHYSICS_EXPORT !== 'undefined') __PHYSICS_EXPORT({createRuntime, stepRuntime, forceNodes, LiquidSim, DEFAULT_LIQUID, setJolt: j => { Jolt = j; }, createWorld, describeBody, liquidColliders, bodyWorld, DEFAULT_WORLD, DEFAULT_BODY, FIXED_DT, LIQUID_DT, SCALE});
if (typeof Plugin === 'undefined' || typeof Blockbench === 'undefined') return;

Plugin.register('physics', {
	title: 'Physics',
	author: 'Claude',
	description: 'A Physics tab: rigid bodies powered by Jolt Physics, liquid and force fields, baked into animations.',
	about: 'Open the **Physics** tab (next to Animate). Three sub-tabs: **Object** (Ground / Physics object, mass, friction, start velocity, optional "start on impact"), **Liquid** (liquid sources that follow their object, aimed with the Rotate tool) and **Forces** (empty groups that push, pull or blow on objects and liquid, with ramp-up, duration and noise). Play / Pause / Reset preview the simulation, **Bake** writes it into a new animation. 16 px = 1 m. Powered by Jolt Physics (JoltPhysics.js, MIT license).',
	icon: 'sports_baseball',
	version: '0.6.0',
	variant: 'both',
	min_version: '4.10.0',
	tags: ['Animation'],
	onload() {
		properties.push(new Property(Group, 'object', 'physics', {default: null}));
		properties.push(new Property(Cube, 'object', 'physics', {default: null}));
		properties.push(new Property(Mesh, 'object', 'physics', {default: null}));
		properties.push(new Property(Cube, 'object', 'liquid', {default: null}));
		properties.push(new Property(Mesh, 'object', 'liquid', {default: null}));
		properties.push(new Property(Group, 'object', 'force', {default: null}));
		window.PhysicsPlugin = {simulateFor, reset};
		properties.push(new Property(ModelProject, 'object', 'physics_world', {default: null}));
		style_node = Blockbench.addCSS(STYLE);
		mode = new Mode('physics', {
			name: tr('mode'),
			icon: 'sports_baseball',
			category: 'navigate',
			condition: () => Project && Format && Format.id != 'image',
			default_tool: 'move_tool',
			onSelect() {
				loadJolt();
				const vue = panel && panel.inside_vue;
				if (vue) { vue.selection_key = null; vue.world_project = ''; }
				updatePanel();
				updateArrows();
				syncFieldHelpers();
			},
			onUnselect() {
				reset();
				hideArrows();
			},
		});
		panel = new Panel('physics', {
			name: tr('mode'),
			growable: true,
			resizable: true,
			min_height: 200,
			icon: 'sports_baseball',
			condition: {modes: ['physics']},
			default_position: {slot: 'right_bar', float_position: [0, 0], float_size: [320, 560], height: 560},
			component: panelComponent(),
		});
		// the outliner is needed to pick objects in the physics tab
		const outliner = Interface.Panels.outliner;
		if (outliner && outliner.condition && outliner.condition.modes instanceof Array && !outliner.condition.modes.includes('physics')) {
			outliner.condition.modes.push('physics');
		}
		allowToolInPhysics(BarItems.move_tool);
		allowToolInPhysics(BarItems.rotate_tool);
		Blockbench.on('update_selection', onSelection);
		Blockbench.on('display_animation_frame', updateAnimationLiquid);
		Blockbench.on('select_mode', updateAnimationLiquid);
		Blockbench.on('select_mode', onModeChange);
		Blockbench.on('select_project', onModeChange);
		Blockbench.on('select_project', onSelection);
		poll = setInterval(onPoll, 100);
	},
	onunload() {
		if (poll) clearInterval(poll);
		if (sim) reset();
		clearLiquidDisplay();
		hideArrows();
		clearFieldHelpers();
		delete window.PhysicsPlugin;
		Blockbench.removeListener('update_selection', onSelection);
		Blockbench.removeListener('display_animation_frame', updateAnimationLiquid);
		Blockbench.removeListener('select_mode', updateAnimationLiquid);
		Blockbench.removeListener('select_mode', onModeChange);
		Blockbench.removeListener('select_project', onModeChange);
		Blockbench.removeListener('select_project', onSelection);
		tool_patches.forEach(undo => undo());
		tool_patches = [];
		if (Modes.physics) Modes.options.edit.select();
		const outliner = Interface.Panels.outliner;
		if (outliner && outliner.condition && outliner.condition.modes instanceof Array) outliner.condition.modes.remove('physics');
		if (panel) panel.delete();
		if (mode) mode.delete();
		properties.forEach(p => p.delete());
		properties = [];
		if (style_node) style_node.delete();
	},
});

// Jolt Physics, WebAssembly build with the binary embedded (JoltPhysics.js 1.1.0, MIT, (c) Jorrit Rouwe)
const JOLT_SOURCE = "__JOLT_SOURCE__";

})();
