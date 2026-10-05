// ---------------------------------------------------------------------------
// What the blood looks like in the viewport, drawn the way the game draws it (blood_canvas.gd, blood.gdshaderinc,
// blood.gd's drop shader and decals, body_blood.gdshaderinc). Units of the simulation: metres; the scene: pixels.
//  - The level: blood is painted into three world maps (render targets that are never cleared): the floor (seen from
//    above), wall_x (faces turned to +-X) and wall_z (faces turned to +-Z). A texel holds film thickness, the depth of
//    the face it landed on, the time it was wetted and coverage. Every surface of the model reads the maps in its own
//    lit material (blood_apply): dark wet blood with a sharp sheen, clots, a raised rim, drying to matt brown.
//  - Moving things and faces the maps cannot hold (slanted): decals projected onto the object, with a normal map,
//    wet and glossy, drying darker and matt. They go where the object goes.
//  - Drops: uneven lit blobs with tapered tails (threads with beads just off a spray) and a faint motion smear.
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
uniform float bv_gamma; uniform float bv_dry; uniform float bv_density;
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
	return vec3(s.a, v.r, clamp(age / bv_dry, 0.0, 1.0));
}
// what the blood lets through: the shape of the stain and the colour the light under it is filtered to (bv_tint)
float bv_shape; vec3 bv_tint;
float blood_apply(vec3 wpos, vec3 wnrm, vec3 vertex, vec3 geom_view_n, inout vec3 albedo, inout float roughness, inout vec3 n_view) {
	bv_shape = 0.0; bv_tint = vec3(1.0);
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
	float thick = clamp(b.y * bv_density, 0.0, 1.0);
	float film = smoothstep(0.01, 0.05, thick);
	float ragged = bnoise(ep * 70.0) * 0.6 + bnoise(ep * 190.0) * 0.4;
	float crisp = smoothstep(0.4, 0.5, b.x + (ragged - 0.5) * 0.34 + (detail - 0.5) * 0.08);
	float soft = smoothstep(0.08, 0.8, b.x + (detail - 0.5) * 0.3) * (0.3 + 0.35 * detail);
	float cov = mix(soft, crisp, film);
	// blood is a red filter: a thin film tints what is under it (drawn by the filter pass from bv_tint), the more of it
	// lies there the darker and the less of the surface shows, and where it builds up it covers it
	bv_shape = cov;
	cov *= mix(0.1, 1.0, smoothstep(0.12, 0.55, thick));
	if (cov <= 0.0) return 0.0;
	float deep = smoothstep(0.08, 0.45, thick);
	float clot = bnoise(ep * 9.0) * 0.6 + bnoise(ep * 31.0) * 0.4;
	float grain = bnoise(ep * 140.0);
	float edge = 1.0 - smoothstep(0.25, 0.85, thick);
	float dry = pow(clamp(b.z * (0.75 + 0.5 * clot) + edge * b.z * 0.8, 0.0, 1.0), 0.7);
	// a thin film is a lighter, clearer red (the light goes through it); a deep one nearly black-red
	vec3 wet_col = mix(vec3(0.16, 0.008, 0.005), vec3(0.02, 0.0009, 0.0007), deep);
	wet_col *= mix(1.0, 0.5 + 1.0 * clot, deep);
	vec3 dry_col = mix(vec3(0.055, 0.017, 0.012), vec3(0.026, 0.009, 0.007), deep);
	dry_col *= 0.8 + 0.45 * clot;
	float crust = smoothstep(0.1, 0.5, b.z) * edge * smoothstep(0.02, 0.2, thick);
	dry_col = mix(dry_col, vec3(0.018, 0.006, 0.005), crust * 0.7);
	albedo = bv_col(mix(wet_col, dry_col, dry));
	vec3 t_wet = mix(vec3(0.62, 0.1, 0.075), vec3(0.16, 0.008, 0.006), smoothstep(0.0, 0.45, thick));
	vec3 t_dry = mix(vec3(0.5, 0.22, 0.16), vec3(0.14, 0.04, 0.03), smoothstep(0.0, 0.45, thick));
	bv_tint = bv_col(mix(t_wet, t_dry, dry));
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

	// how long the blood takes to dry (s; the game: 150) and how thick it lies (1 = as in the game): the character's settings
	dryTime() { const v = this.sim.settings && this.sim.settings.dry; return Math.max(1, +v || 150); }
	density() { const v = this.sim.settings && this.sim.settings.density; return clamp(v === undefined || v === null ? 1 : +v, 0.05, 1); }

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
			bv_gamma: {value: this.gamma() ? 1 : 0}, bv_dry: {value: this.dryTime()}, bv_density: {value: this.density()},
		};
		this.surface_mat = this.surfaceMaterial();
		this.filter_mat = this.filterMaterial();
		// the ground of the Physics tab (it may have no element of its own): a sheet that reads the floor map
		const geo = new THREE.PlaneGeometry(BV_AREA * SCALE, BV_AREA * SCALE);
		geo.rotateX(-Math.PI / 2);
		this.floor = new THREE.Mesh(geo, this.surface_mat);
		this.floor.position.set((this.area_min.x + BV_AREA / 2) * SCALE, (this.ground || 0) * SCALE + 0.01, (this.area_min.z + BV_AREA / 2) * SCALE);
		this.floor.renderOrder = 2;
		this.floor.frustumCulled = false;
		this.floor.receiveShadow = true;
		this.withFilter(this.floor);
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

	// the filter under the lit blood: what lies on the surface tints it (dst * (1 - a + a * tint))
	filterMaterial() {
		const m = new THREE.ShaderMaterial({
			uniforms: this.u,
			vertexShader: `varying vec3 vBW; varying vec3 vBN; varying vec3 vView;
				void main() { vec4 w = modelMatrix * vec4(position, 1.0); vBW = w.xyz / ${SCALE.toFixed(1)}; vBN = normalize(mat3(modelMatrix) * normal);
					vec4 mv = viewMatrix * w; vView = mv.xyz; gl_Position = projectionMatrix * mv; }`,
			fragmentShader: `varying vec3 vBW; varying vec3 vBN; varying vec3 vView;
				${BV_SURFACE}
				void main() {
					vec3 gn = normalize(cross(dFdx(vView), dFdy(vView)));
					vec3 alb = vec3(0.0); float rough = 0.5; vec3 n = gn;
					blood_apply(vBW, normalize(vBN), vView, gn, alb, rough, n);
					if (bv_shape <= 0.002) discard;
					gl_FragColor = vec4(bv_shape * bv_tint, bv_shape);
				}`,
			transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
			blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
			blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
		});
		m.extensions = {derivatives: true};
		return m;
	}

	// a surface overlay: the filter first, the lit blood over it
	withFilter(ov) {
		const f = new THREE.Mesh(ov.geometry, this.filter_mat);
		f.renderOrder = 1;
		f.frustumCulled = false;
		f.userData.render_no_fx = true;
		ov.add(f);
		return ov;
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
				this.withFilter(ov);
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
		mat.opacity = alpha * (0.45 + 0.55 * this.density());
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

	// ---- drops in the air, as high-speed footage shows them: no balls, no sticks. Fresh off a wound the blood is a
	// stretched thread with beads along it that breaks up; a drop is an uneven blob that wobbles, drags a short tapered
	// tail behind it the faster it goes, and leaves a faint see-through smear (the eye's / a camera's blur) ----
	makeDrops() {
		const geo = new THREE.PlaneGeometry(1, 1);
		this.drop_cap = this.sim.max_drops || B_MAX_DROPS;
		// per drop: seed, tail length, blur length (both in radii), thread (0..1)
		this.drop_aux = new THREE.InstancedBufferAttribute(new Float32Array(this.drop_cap * 4), 4);
		this.drop_aux.setUsage(THREE.DynamicDrawUsage);
		geo.setAttribute('daux', this.drop_aux);
		const mat = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: 0.06, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 1.2,
			transparent: true, depthWrite: false});
		const gamma = this.u.bv_gamma;
		mat.onBeforeCompile = shader => {
			shader.uniforms.bv_gamma = gamma;
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', '#include <common>\nattribute vec4 daux; varying vec2 vQ; varying vec4 vAux; varying float vE;')
				.replace('#include <project_vertex>', `
					mat4 M = modelMatrix * instanceMatrix;
					vec3 centre = M[3].xyz; float r = length(M[0].xyz);
					vec3 axis = normalize(M[1].xyz);
					vE = length(M[2].xyz) / max(r, 1e-6) - 1.0;   // the wobble: + flat across, - long
					vec3 to_eye = normalize(cameraPosition - centre);
					vec3 side = cross(axis, to_eye);
					side = length(side) > 1e-3 ? normalize(side) : normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
					// the quad, in radii: the head round the middle, the tail / thread / smear behind it
					float back = max(max(daux.y, daux.z), 0.0) + 1.4;
					vQ = vec2(position.x * 2.0 * 1.45, mix(-back, 1.45, position.y + 0.5));
					vAux = daux;
					vec3 w = centre + side * vQ.x * r + axis * vQ.y * r;
					vec4 mvPosition = viewMatrix * vec4(w, 1.0);
					gl_Position = projectionMatrix * mvPosition;`);
			shader.fragmentShader = shader.fragmentShader
				.replace('#include <common>', `#include <common>
					varying vec2 vQ; varying vec4 vAux; varying float vE; uniform float bv_gamma;
					float dhash(float n) { return fract(sin(n) * 43758.5453); }
					float dnoise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(dhash(i), dhash(i + 1.0), f); }`)
				.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
					{
						float seed = vAux.x * 100.0, tail = vAux.y, smear = vAux.z, thread = vAux.w;
						vec2 q = vQ;
						// the head: an uneven blob (a few lobes of its own), squashed and stretched by its wobble
						vec2 h = vec2(q.x / (1.0 + vE), q.y / (1.0 - vE));
						float ang = atan(h.x, h.y);
						float R = 1.0 + 0.09 * (dnoise(ang * 1.6 + seed) - 0.5) * 2.0 + 0.05 * sin(ang * 3.0 + seed * 1.7);
						float hd = length(h) / R;
						float a = 1.0 - smoothstep(0.9, 1.0, hd);
						vec3 nrm = vec3(h.x, -h.y, sqrt(max(1.0 - hd * hd, 0.0)));
						float body = 1.0 - min(hd, 1.0);
						// behind it: a tail that tapers off (a thread with beads on it while it is still breaking up)
						if (q.y < 0.0 && tail > 0.05) {
							float t = -q.y / tail;
							if (t < 1.0) {
								float rad = mix(0.85, 0.0, pow(t, 0.55 + 0.6 * thread)) * (1.0 - 0.5 * thread);
								float bead = abs(sin(t * (3.0 + floor(dhash(seed) * 4.0)) * 3.14159 + seed));
								rad *= mix(1.0, 0.35 + 1.1 * bead * bead, thread);
								rad *= 1.0 + 0.25 * (dnoise(t * 6.0 + seed * 3.1) - 0.5);
								float ad = abs(q.x) / max(rad, 1e-3);
								float ta = (1.0 - smoothstep(0.75, 1.0, ad)) * step(1e-3, rad) * (1.0 - smoothstep(0.7, 1.0, t) * 0.6);
								if (ta > a) { a = ta; nrm = vec3(q.x / max(rad, 1e-3), 0.0, sqrt(max(1.0 - ad * ad, 0.0))); body = rad * (1.0 - ad); }
							}
						}
						// the smear of its motion: faint, the fainter the longer it is
						if (q.y < 0.0 && smear > 0.3) {
							float t = -q.y / smear;
							float sa = (1.0 - smoothstep(0.75, 1.0, abs(q.x))) * (1.0 - smoothstep(0.0, 1.0, t)) * clamp(1.6 / (smear + 1.6), 0.06, 0.45);
							if (sa > a) { a = sa; nrm = vec3(q.x, 0.0, 1.0); body = 0.3; }
						}
						if (a < 0.02) discard;
						nrm = normalize(nrm);
						// thin blood lets the light through (a clearer red at the rim and in the thread), thick is near black-red
						diffuseColor.rgb = mix(vec3(0.11, 0.005, 0.0035), vec3(0.03, 0.0012, 0.001), smoothstep(0.0, 0.5, body));
						if (bv_gamma > 0.5) diffuseColor.rgb = pow(diffuseColor.rgb, vec3(0.4545));
						diffuseColor.a = a;
						normal = nrm;
					}`);
		};
		mat.customProgramCacheKey = () => 'ragdoll_blood_drop2';
		mat.envMap = this.env;
		this.drops = new THREE.InstancedMesh(geo, mat, this.drop_cap);
		this.drops.count = 0;
		this.drops.frustumCulled = false;
		this.drops.renderOrder = 2;
		this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.group.add(this.drops);
	}

	drawDrops(extra) {
		const list = this.sim._drops, n = Math.min(list.length, this.drop_cap), m = new THREE.Matrix4(), aux = this.drop_aux.array;
		for (let i = 0; i < n; i++) {
			const d = list[i];
			const p = d.pos.clone().addScaledVector(d.vel, extra);
			const r = 0.0062 * Math.cbrt(d.vol), sp = d.vel.length(), age = d.age ?? 1, seed = d.seed ?? ((i * 0.618) % 1);
			const y = sp > 0.05 ? d.vel.clone().divideScalar(sp) : gv(0, -1, 0);
			const x = y.clone().cross(Math.abs(y.y) < 0.95 ? gv(0, 1, 0) : gv(1, 0, 0)).normalize();
			const z = x.clone().cross(y);
			// a big drop, just torn off, wobbles between flat and long as it settles
			const e = d.vol > 0.2 ? 0.2 * Math.min(d.vol, 3) / 3 * Math.exp(-age * 7) * Math.sin(age * 75 + seed * 20) : 0;
			// a thread for the first moments of a spray, then a tadpole tail growing with speed, and the smear of motion
			const thread = d.drip ? 0 : clamp(1 - age / 0.06, 0, 1) * clamp(sp / 4, 0, 1);
			const tail = clamp(sp * 0.07, 0, 1.4) * (0.4 + 1.2 * seed) + thread * (2.5 + 5 * seed * seed);
			const smear = Math.min(sp * 0.003 / r, 20);
			m.makeBasis(x.multiplyScalar(r), y.multiplyScalar(r), z.multiplyScalar(r * (1 + e))).setPosition(p);
			this.drops.setMatrixAt(i, m);
			aux[i * 4] = seed; aux[i * 4 + 1] = tail; aux[i * 4 + 2] = smear; aux[i * 4 + 3] = thread;
		}
		this.drops.count = n;
		this.drops.instanceMatrix.needsUpdate = true;
		this.drop_aux.needsUpdate = true;
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
		const u = {vol: {value: null}, vol_min: {value: bb.box_min.clone()}, vol_size: {value: gv(bb.dims[0], bb.dims[1], bb.dims[2]).multiplyScalar(bb.cell)}, time: {value: 0}, rest: {value: rest}, bv_gamma: this.u.bv_gamma, bv_dry: this.u.bv_dry, bv_density: this.u.bv_density};
		const head = `
			precision highp sampler3D;
			uniform float bv_gamma; uniform float bv_dry; uniform float bv_density;
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
				float amt = (s.r + (nz - 0.5) * 0.12 * (1.0 - s.r)) * bv_density;
				if (amt < 0.03) return vec4(0.0);
				float age = mod(time - s.g * 255.0, 256.0);
				float dry = clamp(age / (bv_dry * 0.93), 0.0, 1.0);
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
			const k_dry = clamp((this.sim._time - d.birth) / (this.dryTime() * 0.93), 0, 1);
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
