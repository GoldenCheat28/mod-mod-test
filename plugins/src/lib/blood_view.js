// ---------------------------------------------------------------------------
// What the blood looks like in the viewport (blood.gd's drawing, blood_canvas.gd, blood.gdshaderinc, blood_splash.gd,
// body_blood.gdshaderinc). Everything lives in one group in the scene, scaled from metres to Blockbench pixels.
//  - The ground: blood is painted into a floor map (a render target that is never cleared: thickness, time, coverage
//    per texel, blended like the game's), and a sheet over the ground shows it as the level shader does.
//  - Anything else (a chair, a moving thing): decals - flat stains lying on the surface.
//  - Drops: flat beads turned to the eye and stretched along their flight. The splash at a hit: an 8-frame sprite.
//    The mist: a puff of fine spray.
//  - On the person: his blood volume (body_blood.gd) shown over his clothes and skin.
// ---------------------------------------------------------------------------

const BV_AREA = 36.0, BV_RES = 2048, BV_PPM = BV_RES / BV_AREA;
const BV_TIME_SPAN = 16384.0;
const BV_DRY_COLOR = new THREE.Color(0.42, 0.3, 0.27);
const BV_MAX_DECALS = 800;

const BV_COMMON = `
float bh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float bnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(bh(i), bh(i + vec2(1.0, 0.0)), f.x), mix(bh(i + vec2(0.0, 1.0)), bh(i + vec2(1.0, 1.0)), f.x), f.y); }
`;

class BloodView {
	constructor(sim, rt) {
		this.sim = sim;
		this.rt = rt;
		this.group = new THREE.Group();
		this.group.name = 'ragdoll_blood';
		this.group.scale.setScalar(SCALE);
		this.root = typeof scene != 'undefined' ? scene : null;
		if (this.root) this.root.add(this.group);
		this.textures = {};
		this.queue = [];
		this.decals = [];
		this.decal_next = 0;
		this.pool_decals = new Map();
		this.splashes = [];
		this.mists = [];
		this.overlays = [];
		this.time = 0;
		// the floor map round the people
		const people = sim.people;
		const c = people.length ? people[0].pos(people[0].pelvis) : gv();
		this.area_min = gv(c.x - BV_AREA / 2, 0, c.z - BV_AREA / 2);
		this.ground = sim.ground;
		this.renderer = this.findRenderer();
		this.makeFloor();
		this.makeDrops();
		this.makeSplash();
		this.makeMist();
		this.makeBodies();
	}

	findRenderer() {
		try { if (typeof Preview != 'undefined') { const p = Preview.selected || (Preview.all || []).find(x => x.renderer); if (p && p.renderer) return p.renderer; } } catch (err) { /* none */ }
		return null;
	}

	tex(kind, variant, which) {
		const key = kind + variant + which;
		if (this.textures[key]) return this.textures[key];
		const sh = bloodShape(kind, variant);
		const t = new THREE.DataTexture(which == 'mask' ? sh.mask : sh.albedo, sh.size, sh.size, THREE.RGBAFormat);
		t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
		t.needsUpdate = true;
		return (this.textures[key] = t);
	}

	// ---- the ground ----
	makeFloor() {
		if (!this.renderer || !THREE.WebGLRenderTarget) return;
		const type = THREE.HalfFloatType || THREE.FloatType;
		this.target = new THREE.WebGLRenderTarget(BV_RES, BV_RES, {type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter});
		this.paint_scene = new THREE.Scene();
		this.paint_cam = new THREE.OrthographicCamera(0, BV_RES, BV_RES, 0, -10, 10);
		this.dab_geo = new THREE.PlaneGeometry(1, 1);
		this.dab_meshes = [];
		this.cleared = false;
		// the sheet over the ground that shows it (blood.gdshaderinc: blood_apply)
		const mat = new THREE.ShaderMaterial({
			uniforms: {map: {value: this.target.texture}, area: {value: new THREE.Vector3(this.area_min.x, this.area_min.z, BV_AREA)}, time: {value: 0}, texel: {value: 1 / BV_RES}},
			vertexShader: `varying vec3 vw; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vw = w.xyz / ${SCALE.toFixed(1)}; gl_Position = projectionMatrix * viewMatrix * w; }`,
			fragmentShader: `
				uniform sampler2D map; uniform vec3 area; uniform float time; uniform float texel; varying vec3 vw;
				${BV_COMMON}
				vec3 bsample(vec2 p) {
					vec2 uv = (p - area.xy) / area.z;
					if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
					vec4 s = texture2D(map, uv);
					if (s.a < 0.04) return vec3(0.0);
					vec3 v = clamp(s.rgb / s.a, vec3(0.0), vec3(1.0));
					float age = mod(time - v.b * ${BV_TIME_SPAN.toFixed(1)} + ${BV_TIME_SPAN.toFixed(1)}, ${BV_TIME_SPAN.toFixed(1)});
					return vec3(s.a, v.r, clamp(age / 150.0, 0.0, 1.0));
				}
				void main() {
					vec2 p = vw.xz;
					vec3 b = bsample(p);
					float o = 0.011;
					float c4 = bsample(p + vec2(o, o)).x + bsample(p + vec2(o, -o)).x + bsample(p - vec2(o, o)).x + bsample(p - vec2(o, -o)).x;
					b.x = b.x * 0.4 + c4 * 0.15;
					float n_ok = 0.0; vec2 yz = vec2(0.0);
					for (int k = 0; k < 4; k++) {
						vec2 sg = vec2(k < 2 ? 1.0 : -1.0, (k == 0 || k == 2) ? 1.0 : -1.0);
						vec3 q = bsample(p + sg * o * 1.6);
						if (q.x > 0.0) { yz += q.yz; n_ok += 1.0; }
					}
					if (b.x <= 0.0) discard;
					if (n_ok > 0.0) b.yz = b.y > 0.0 ? (b.yz + yz) / (1.0 + n_ok) : yz / n_ok;
					float detail = bnoise(p * 300.0);
					float thick = clamp(b.y, 0.0, 1.0);
					float film = smoothstep(0.03, 0.09, thick);
					float ragged = bnoise(p * 70.0) * 0.6 + bnoise(p * 190.0) * 0.4;
					float crisp = smoothstep(0.4, 0.5, b.x + (ragged - 0.5) * 0.34 + (detail - 0.5) * 0.08);
					float soft = smoothstep(0.08, 0.8, b.x + (detail - 0.5) * 0.3) * (0.3 + 0.35 * detail);
					float cov = mix(soft, crisp, film);
					if (cov <= 0.0) discard;
					float deep = smoothstep(0.08, 0.45, thick);
					float clot = bnoise(p * 9.0) * 0.6 + bnoise(p * 31.0) * 0.4;
					float edge = 1.0 - smoothstep(0.25, 0.85, thick);
					float dry = pow(clamp(b.z * (0.75 + 0.5 * clot) + edge * b.z * 0.8, 0.0, 1.0), 0.7);
					vec3 wet_col = mix(vec3(0.075, 0.004, 0.003), vec3(0.02, 0.0009, 0.0007), deep);
					wet_col *= mix(1.0, 0.5 + 1.0 * clot, deep);
					vec3 dry_col = mix(vec3(0.055, 0.017, 0.012), vec3(0.026, 0.009, 0.007), deep);
					dry_col *= 0.8 + 0.45 * clot;
					float crust = smoothstep(0.1, 0.5, b.z) * edge * smoothstep(0.02, 0.2, thick);
					dry_col = mix(dry_col, vec3(0.018, 0.006, 0.005), crust * 0.7);
					vec3 col = mix(wet_col, dry_col, dry);
					// lit like the ground round it, and a wet sheen on a real layer of it
					float gloss = film * smoothstep(0.35, 0.8, cov) * (1.0 - smoothstep(0.35, 0.55, dry));
					float sheen = smoothstep(0.35, 0.75, bnoise(p * 5.0 + 3.1) * 0.7 + clot * 0.3);
					col = col * 2.2 + vec3(0.05, 0.035, 0.035) * gloss * sheen;
					gl_FragColor = linearToOutputTexel(vec4(col, cov));
				}`,
			transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
		});
		const geo = new THREE.PlaneGeometry(BV_AREA, BV_AREA);
		geo.rotateX(-Math.PI / 2);
		this.floor = new THREE.Mesh(geo, mat);
		this.floor.position.set(this.area_min.x + BV_AREA / 2, this.ground + 0.002, this.area_min.z + BV_AREA / 2);
		this.floor.renderOrder = 2;
		this.floor.frustumCulled = false;
		this.group.add(this.floor);
	}

	// a dab of blood on the ground (blood_canvas.gd dab) or, for a pool that is not on the ground, its decal
	dab(p, n, along, w, l, kind, variant, thick, alpha, pool) {
		if (pool) { this.poolDecal(pool, p, n, along, w, l, kind, variant); return; }
		if (!this.target) return;
		const u = (p.x - this.area_min.x) * BV_PPM, v = (p.z - this.area_min.z) * BV_PPM;
		if (u < 0 || v < 0 || u > BV_RES || v > BV_RES) { this.decal(null, p, n, along, w, l, kind, variant, alpha, this.sim._time); return; }
		const dir = [along.x, along.z];
		const angle = Math.hypot(dir[0], dir[1]) > 1e-4 ? Math.atan2(-dir[0], dir[1]) : brand() * Math.PI * 2;
		this.queue.push({u, v, w: w * BV_PPM, l: l * BV_PPM, angle, tex: this.tex(kind, variant, 'mask'), data: [clamp(thick, 0, 1), 0.5, (this.sim._time % BV_TIME_SPAN) / BV_TIME_SPAN, alpha]});
	}

	flushDabs() {
		if (!this.target || !this.renderer) { this.queue.length = 0; return; }
		const r = this.renderer;
		const prev = r.getRenderTarget(), auto = r.autoClear;
		if (!this.cleared) { r.setRenderTarget(this.target); r.setClearColor(0x000000, 0); r.clear(true, false, false); this.cleared = true; }
		while (this.queue.length) {
			const batch = this.queue.splice(0, 256);
			while (this.dab_meshes.length < batch.length) {
				const m = new THREE.Mesh(this.dab_geo, new THREE.ShaderMaterial({
					uniforms: {map: {value: null}, data: {value: new THREE.Vector4()}},
					vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
					fragmentShader: 'uniform sampler2D map; uniform vec4 data; varying vec2 vUv; void main() { vec4 m = texture2D(map, vUv); gl_FragColor = vec4(data.r * m.r, data.g, data.b, m.a * data.a); }',
					transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
					blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
				}));
				m.frustumCulled = false;
				this.dab_meshes.push(m);
				this.paint_scene.add(m);
			}
			this.dab_meshes.forEach((m, i) => {
				const d = batch[i];
				m.visible = !!d;
				if (!d) return;
				m.position.set(d.u, d.v, 0);
				m.rotation.set(0, 0, d.angle);
				m.scale.set(d.w, d.l, 1);
				m.renderOrder = i;
				m.material.uniforms.map.value = d.tex;
				m.material.uniforms.data.value.set(...d.data);
			});
			r.setRenderTarget(this.target);
			r.autoClear = false;
			r.render(this.paint_scene, this.paint_cam);
		}
		r.autoClear = auto;
		r.setRenderTarget(prev);
	}

	// ---- decals: flat stains lying on what they landed on (a moving thing carries them) ----
	decal(entry, p, n, along, w, l, kind, variant, alpha, birth) {
		let d;
		if (this.decals.length < BV_MAX_DECALS) {
			d = {mesh: new THREE.Mesh(this.decalGeo(), new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4}))};
			d.mesh.renderOrder = 3;
			this.group.add(d.mesh);
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
		const q = decalBasis(n, along);
		d.mesh.material.map = this.tex(kind, variant, 'albedo');
		d.mesh.material.needsUpdate = true;
		d.mesh.material.opacity = alpha;
		d.mesh.material.color.set(0xffffff);
		d.birth = birth; d.prio = w * l; d.entry = entry || null;
		d.mesh.quaternion.copy(q);
		d.mesh.position.copy(p).addScaledVector(n, 0.002);
		d.mesh.scale.set(w, 1, l);
		if (entry) {
			// kept in the moving thing's own frame
			const bp = entry.body.GetPosition(), br = entry.body.GetRotation();
			const bm = new THREE.Matrix4().compose(gv(bp.GetX(), bp.GetY(), bp.GetZ()), new THREE.Quaternion(br.GetX(), br.GetY(), br.GetZ(), br.GetW()), gv(1, 1, 1));
			d.local = bm.invert().multiply(new THREE.Matrix4().compose(d.mesh.position, d.mesh.quaternion, d.mesh.scale));
		} else d.local = null;
		return d;
	}

	decalGeo() {
		if (!this.decal_geo) { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); this.decal_geo = g; }
		return this.decal_geo;
	}

	poolStarted(pool) { if (!pool.on_ground) this.pool_decals.delete(pool); }

	poolDecal(pool, p, n, along, w, l, kind, variant) {
		// a pool on something that is not the ground: its one decal, made bigger as it spreads
		let d = this.pool_decals.get(pool);
		if (!d || this.decals.indexOf(d) < 0 || d.pool !== pool) { d = this.decal(null, pool.pos, n, along, w, l, kind, variant, 1, this.sim._time); d.pool = pool; this.pool_decals.set(pool, d); }
		if (p.distanceTo(pool.pos) < 1e-6) { d.mesh.scale.set(w, 1, l); d.birth = this.sim._time; d.prio = w * l * 10; }
	}

	// ---- drops: flat beads turned to the eye about their line of flight, stretched along it ----
	makeDrops() {
		const geo = new THREE.PlaneGeometry(1, 1);
		const mat = new THREE.ShaderMaterial({
			vertexShader: `
				varying vec2 vUv;
				void main() {
					mat4 M = modelMatrix * instanceMatrix;
					vec3 centre = M[3].xyz; vec3 axis_v = M[1].xyz; float len = length(axis_v); float r = length(M[0].xyz);
					vec3 axis = axis_v / max(len, 1e-5);
					vec3 to_eye = normalize(cameraPosition - centre);
					vec3 side = cross(axis, to_eye);
					side = length(side) > 1e-3 ? normalize(side) : normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
					vec3 w = centre + side * position.x * 2.0 * r + axis * position.y * 2.0 * max(len, r);
					vUv = uv;
					gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
				}`,
			fragmentShader: `
				varying vec2 vUv;
				void main() {
					vec2 d = vUv * 2.0 - 1.0; float q = dot(d, d);
					if (q > 1.0) discard;
					// a round wet bead: dark, glossy, the light glinting off it
					vec3 albedo = vec3(0.14, 0.006, 0.005) * (1.0 - 0.4 * q);
					vec3 nrm = normalize(vec3(d.x, -d.y, sqrt(max(1.0 - q, 0.0)) + 0.3));
					float spec = pow(max(dot(nrm, normalize(vec3(-0.4, 0.6, 0.7))), 0.0), 40.0) * 0.6;
					gl_FragColor = linearToOutputTexel(vec4(albedo * 2.2 + vec3(spec), 1.0));
				}`,
			side: THREE.DoubleSide,
		});
		this.drops = new THREE.InstancedMesh(geo, mat, B_MAX_DROPS);
		this.drops.count = 0;
		this.drops.frustumCulled = false;
		this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.group.add(this.drops);
	}

	drawDrops(extra) {
		const list = this.sim._drops, n = Math.min(list.length, B_MAX_DROPS), m = new THREE.Matrix4();
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

	// ---- on the people: their blood volume over their clothes and skin ----
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

	bodyMaterial(bot, rest, pass) {
		const bb = bot.body_blood;
		const u = {vol: {value: null}, vol_min: {value: bb.box_min.clone()}, vol_size: {value: gv(bb.dims[0], bb.dims[1], bb.dims[2]).multiplyScalar(bb.cell)}, time: {value: 0}, rest: {value: rest}};
		return new THREE.ShaderMaterial({
			uniforms: u,
			vertexShader: 'uniform mat4 rest; varying vec3 rp; void main() { rp = (rest * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
			fragmentShader: `
				precision highp sampler3D;
				uniform sampler3D vol; uniform vec3 vol_min; uniform vec3 vol_size; uniform float time; varying vec3 rp;
				float h3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
				float n3(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
					return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
						mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
				void main() {
					vec3 uvw = (rp - vol_min) / vol_size;
					if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) discard;
					vec2 s = texture(vol, uvw).rg;
					float nz = n3(rp * 60.0) * 0.6 + n3(rp * 170.0) * 0.4;
					float amt = s.r + (nz - 0.5) * 0.12 * (1.0 - s.r);
					if (amt < 0.03) discard;
					float age = mod(time - s.g * 255.0, 256.0);
					float dry = clamp(age / 140.0, 0.0, 1.0);
					float film = smoothstep(0.03, 0.3, amt);
					float solid = smoothstep(0.3, 0.7, amt);
					vec3 wet_col = mix(vec3(0.2, 0.012, 0.01), vec3(0.09, 0.004, 0.003), solid);
					vec3 dry_col = mix(vec3(0.12, 0.035, 0.025), vec3(0.05, 0.015, 0.01), solid);
					vec3 bc = mix(wet_col, dry_col, pow(dry, 0.7));
					bc *= 0.7 + 0.6 * nz * (0.5 + 0.5 * solid);
					float a2 = solid * 0.95 + film * 0.25;
					vec3 tint = mix(vec3(1.0), vec3(0.55, 0.12, 0.1), film);
					${pass == 0
						// first: what is under it, stained and covered (multiplied)
						? 'gl_FragColor = vec4(tint * (1.0 - a2), 1.0);'
						// then the blood itself on top (added)
						: 'gl_FragColor = vec4(linearToOutputTexel(vec4(bc * 2.0, 1.0)).rgb * a2, 1.0);'}
				}`,
			transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
			blending: pass == 0 ? THREE.MultiplyBlending : THREE.AdditiveBlending, premultipliedAlpha: pass == 0,
		});
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
					o.tex.format = THREE.RGFormat; o.tex.type = THREE.UnsignedByteType;
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
			for (const ov of o.overlays) for (const m of ov.meshes || []) { m.material.uniforms.vol.value = o.tex; m.material.uniforms.time.value = this.sim._time % 256; }
		}
	}

	// ---- every frame ----
	update(dt) {
		this.time = this.sim._time;
		if (this.floor) this.floor.material.uniforms.time.value = this.sim._time % BV_TIME_SPAN;
		this.flushDabs();
		this.drawDrops(this.sim._since_sim);
		for (const s of this.splashes) {
			if (s.dur <= 0) continue;
			s.age += dt;
			const k = s.age / s.dur;
			if (k >= 1) { s.dur = 0; s.mesh.visible = false; continue; }
			s.mesh.material.uniforms.k.value = k;
		}
		this.updateMist(dt);
		// decals: carried by what they are on, and drying (colour to dark brown)
		for (const d of this.decals) {
			if (d.entry && d.local) {
				const bp = d.entry.body.GetPosition(), br = d.entry.body.GetRotation();
				const m = new THREE.Matrix4().compose(gv(bp.GetX(), bp.GetY(), bp.GetZ()), new THREE.Quaternion(br.GetX(), br.GetY(), br.GetZ(), br.GetW()), gv(1, 1, 1)).multiply(d.local);
				m.decompose(d.mesh.position, d.mesh.quaternion, d.mesh.scale);
			}
		}
		const budget = Math.min(40, this.decals.length);
		for (let k = 0; k < budget; k++) {
			this.dry_cursor = ((this.dry_cursor || 0) + 1) % this.decals.length;
			const d = this.decals[this.dry_cursor];
			const k_dry = clamp((this.sim._time - d.birth) / B_DRY_TIME, 0, 1);
			d.mesh.material.color.setRGB(1, 1, 1).lerp(BV_DRY_COLOR, Math.pow(k_dry, 0.7));
		}
		this.updateBodies(dt);
	}

	dispose() {
		if (this.group.parent) this.group.parent.remove(this.group);
		this.group.traverse(o => { if (o.geometry && o.geometry !== this.decal_geo) o.geometry.dispose(); if (o.material) o.material.dispose(); });
		if (this.decal_geo) this.decal_geo.dispose();
		for (const o of this.overlays) { for (const ov of o.overlays) for (const m of ov.meshes || []) { if (m.parent) m.parent.remove(m); m.material.dispose(); } if (o.tex) o.tex.dispose(); }
		if (this.target) this.target.dispose();
		for (const m of this.dab_meshes || []) m.material.dispose();
		if (this.dab_geo) this.dab_geo.dispose();
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
