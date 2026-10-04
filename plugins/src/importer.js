(function () {
'use strict';

/*
 * Model import — brings 3D models from other programs into Blockbench: the geometry (as mesh elements), the textures (and the
 * colours of untextured materials), the skeleton and the animations.
 *
 *   OBJ (+MTL), FBX, glTF / GLB, Collada (DAE), 3DS, STL, PLY, 3MF, MD2, Half-Life MDL (GoldSrc), Quake MDL
 *
 * File > Import > 3D model. Pick the model, and (if they are not next to it) its textures, .mtl / .bin files too.
 *
 * A skeleton becomes:
 *   - bone groups, when every vertex follows one bone (Half-Life models, robots, most game props): each part moves with its bone;
 *   - an armature with vertex weights (Blockbench 5), when the skin bends smoothly between bones (characters from FBX / glTF).
 *     Without armatures (older Blockbench) such a skin is cut into parts that follow the bone they belong to most.
 * Every animation of the file becomes a Blockbench animation (sampled, then the keys that add nothing are left out).
 *
 * The loaders for the common formats are the three.js r129 examples (MIT, the same three.js Blockbench uses), kept apart from
 * Blockbench's own THREE. The MDL readers are written here from the published formats (studio.h of the Half-Life SDK, Quake's
 * modelgen.h).
 */

// ---------------------------------------------------------------------------
// three.js r129 loaders (MIT), in their own namespace
// ---------------------------------------------------------------------------

const fflate = (function () {
	// fflate is written to fit every module system: here it must simply hand itself over
	const module = undefined, exports = undefined, define = undefined, holder = {};
	const self = holder;   // eslint-disable-line no-unused-vars
/* @include vendor/fflate.min.js */
	return holder.fflate;
})();

const L = (function (THREE_GLOBAL) {
	const THREE = Object.create(THREE_GLOBAL);
/* @include vendor/NURBSUtils.js */
/* @include vendor/NURBSCurve.js */
/* @include vendor/TGALoader.js */
/* @include vendor/FBXLoader.js */
/* @include vendor/GLTFLoader.js */
/* @include vendor/ColladaLoader.js */
/* @include vendor/MTLLoader.js */
/* @include vendor/OBJLoader.js */
/* @include vendor/TDSLoader.js */
/* @include vendor/STLLoader.js */
/* @include vendor/PLYLoader.js */
/* @include vendor/3MFLoader.js */
/* @include vendor/MD2Loader.js */
	return THREE;
})(window.THREE);

const MODEL_EXT = ['obj', 'fbx', 'gltf', 'glb', 'dae', '3ds', 'stl', 'ply', '3mf', 'md2', 'mdl'];
const RESOURCE_EXT = ['mtl', 'bin', 'png', 'jpg', 'jpeg', 'tga', 'bmp', 'gif', 'webp', 'lmp'];

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

const TEXTS = {
	en: {
		action: '3D model (OBJ, FBX, glTF, DAE, 3DS, STL, PLY, MDL…)', action_desc: 'Import geometry, textures, skeleton and animations from a 3D model file',
		title: 'Import 3D model', files: 'Files', size: 'Size', size_fit: 'Fit to a height', size_keep: 'Keep the size of the file (× factor)', height: 'Height (px)', factor: 'Factor',
		ground: 'Stand it on the ground, centred', up: 'Up axis', up_auto: 'Automatic (Z for 3DS, STL, 3MF)', up_y: 'Y up', up_z: 'Z up (turn it upright)', anims: 'Animations', textures: 'Textures and colours', quads: 'Join triangles into quads', skin: 'Skeleton',
		skin_auto: 'Automatic', skin_groups: 'Bone groups (parts move rigidly)', skin_armature: 'Armature with vertex weights (smooth skin, Blockbench 5)', fps: 'Animation frames per second',
		target: 'Into', target_new: 'A new project (Generic model)', target_current: 'The open project',
		hint: 'Select the textures, .mtl and .bin files together with the model if Blockbench cannot read the folder of the model. Morph (vertex) animations cannot be shown in Blockbench: their first frame is imported.',
		busy: 'Importing…', done: 'Imported %n: % meshes, % bones, % animations', failed: 'Import failed', unknown: 'Not a model file this importer knows',
		no_mesh: 'There is no geometry in this file', morph: 'This model has morph (vertex) animations: Blockbench cannot play them, the first frame is imported',
		mdl_seqgroup: 'Some animations of this model are in separate files (%01.mdl…): select them too to import them',
		mdl_textures: 'The textures of this model are in a separate file (%t.mdl): select it too',
		quake_palette: 'Quake MDL: no palette.lmp found next to the model, the skin is shown in grey (select palette.lmp to get the colours)',
		source_mdl: 'This is a Source engine MDL (version %): only Half-Life (GoldSrc) and Quake MDL can be read. Export it to SMD/FBX with Crowbar first.',
		too_big: 'This model is very big (% triangles): Blockbench may be slow with it',
	},
	ru: {
		action: '3D-модель (OBJ, FBX, glTF, DAE, 3DS, STL, PLY, MDL…)', action_desc: 'Импорт геометрии, текстур, скелета и анимаций из файла 3D-модели',
		title: 'Импорт 3D-модели', files: 'Файлы', size: 'Размер', size_fit: 'Подогнать по высоте', size_keep: 'Как в файле (× множитель)', height: 'Высота (px)', factor: 'Множитель',
		ground: 'Поставить на землю по центру', up: 'Ось вверх', up_auto: 'Автоматически (Z для 3DS, STL, 3MF)', up_y: 'Y вверх', up_z: 'Z вверх (поставить вертикально)', anims: 'Анимации', textures: 'Текстуры и цвета', quads: 'Объединять треугольники в квадраты', skin: 'Скелет',
		skin_auto: 'Автоматически', skin_groups: 'Группы-кости (части двигаются целиком)', skin_armature: 'Арматура с весами вершин (плавная кожа, Blockbench 5)', fps: 'Кадров анимации в секунду',
		target: 'Куда', target_new: 'В новый проект (Generic model)', target_current: 'В открытый проект',
		hint: 'Если Blockbench не может прочитать папку модели, выберите текстуры, .mtl и .bin вместе с моделью. Морф-анимации (анимация вершин) Blockbench не показывает: берётся первый кадр.',
		busy: 'Импорт…', done: 'Импортировано %n: мешей %, костей %, анимаций %', failed: 'Импорт не удался', unknown: 'Этот файл не похож на модель, которую умеет читать импорт',
		no_mesh: 'В этом файле нет геометрии', morph: 'У модели морф-анимации (анимация вершин): Blockbench их не проигрывает, взят первый кадр',
		mdl_seqgroup: 'Часть анимаций этой модели лежит в отдельных файлах (%01.mdl…): выберите их тоже, чтобы импортировать',
		mdl_textures: 'Текстуры этой модели лежат в отдельном файле (%t.mdl): выберите его тоже',
		quake_palette: 'Quake MDL: рядом с моделью нет palette.lmp, скин будет серым (выберите palette.lmp, чтобы получить цвета)',
		source_mdl: 'Это MDL движка Source (версия %): читаются только MDL из Half-Life (GoldSrc) и Quake. Сначала переведите его в SMD/FBX через Crowbar.',
		too_big: 'Модель очень большая (треугольников: %): Blockbench может с ней тормозить',
	},
};
const tr = key => {
	const lang = (typeof Language != 'undefined' && Language.code) || 'en';
	return (TEXTS[lang] && TEXTS[lang][key]) || TEXTS.en[key] || key;
};
const fill = (text, ...values) => { let i = 0; return text.replace(/%n|%/g, m => m == '%n' ? values.shift() : (values.length ? values.shift() : '')); };

// ---------------------------------------------------------------------------
// Files: the ones picked, and the ones next to the model (read from its folder when Blockbench may)
// ---------------------------------------------------------------------------

const extOf = name => (String(name).match(/\.([^.\/\\]+)$/) || [, ''])[1].toLowerCase();
const baseOf = name => String(name).replace(/\\/g, '/').split('/').pop();
const textOf = buffer => new TextDecoder('utf-8').decode(buffer);
const MIME = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tga: 'application/octet-stream'};

let fs_module, path_module;
function nodeFs() {
	if (fs_module !== undefined) return fs_module;
	fs_module = null;
	try {
		if (typeof requireNativeModule == 'function') { fs_module = requireNativeModule('fs', {message: 'Read the textures and other files next to the imported model'}); path_module = requireNativeModule('path'); }
		else if (typeof require == 'function') { fs_module = require('fs'); path_module = require('path'); }
	} catch (err) { fs_module = null; }
	return fs_module;
}

class Resources {
	constructor(files, main) {
		this.files = new Map();     // lower case name -> {name, buffer}
		this.urls = new Map();
		this.names = new Map();    // blob url -> the file's name (the name of a texture)
		this.dir = null;
		for (const f of files) this.files.set(baseOf(f.name).toLowerCase(), f);
		if (main && main.path && /[\\/]/.test(main.path)) this.dir = main.path.replace(/[\\/][^\\/]*$/, '');
	}
	// a file by name: picked, or found in the folder of the model (also in a "textures" folder next to it, any letter case)
	get(name) {
		const key = baseOf(name).toLowerCase();
		if (this.files.has(key)) return this.files.get(key);
		const fs = this.dir && nodeFs();
		if (!fs) return null;
		for (const sub of ['', 'textures', 'Textures', 'texture', 'tex', 'maps', 'images', '..', '../textures', '../Textures']) {
			try {
				const dir = sub ? path_module.join(this.dir, sub) : this.dir;
				const hit = fs.readdirSync(dir).find(n => n.toLowerCase() == key);
				if (hit) {
					const data = fs.readFileSync(path_module.join(dir, hit));
					const f = {name: hit, buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)};
					this.files.set(key, f);
					return f;
				}
			} catch (err) { /* no such folder */ }
		}
		return null;
	}
	// a file with the same name and another picture format (a model that asks for .tga when there is a .png)
	getAnyImage(name) {
		const stem = baseOf(name).replace(/\.[^.]*$/, '');
		for (const ext of ['', 'png', 'jpg', 'jpeg', 'tga', 'bmp', 'webp']) {
			const f = ext ? this.get(stem + '.' + ext) : this.get(name);
			if (f) return f;
		}
		return null;
	}
	url(name) {
		const key = baseOf(name).toLowerCase();
		if (this.urls.has(key)) return this.urls.get(key);
		const f = /\.(png|jpe?g|tga|bmp|gif|webp|dds)$/i.test(key) ? this.getAnyImage(name) : this.get(name);
		const url = f ? URL.createObjectURL(new Blob([f.buffer], {type: MIME[extOf(f.name)] || 'application/octet-stream'})) : null;
		this.urls.set(key, url);
		if (url) this.names.set(url, f.name);
		return url;
	}
	// what a loader asks for -> a blob of the right file
	resolve(url) {
		if (/^(data|blob):/.test(url)) return url;
		let clean = url;
		try { clean = decodeURIComponent(url); } catch (err) { /* keep it */ }
		clean = clean.split(/[?#]/)[0];
		return this.url(clean) || url;
	}
	dispose() { this.urls.forEach(u => { if (u) URL.revokeObjectURL(u); }); }
}

// a loading manager that knows the files and can be waited for (textures load after the model is read)
function managerFor(res) {
	const m = new THREE.LoadingManager();
	let pending = 0, waiting = [];
	const start = m.itemStart.bind(m), end = m.itemEnd.bind(m);
	m.itemStart = url => { pending++; start(url); };
	m.itemEnd = url => { pending = Math.max(0, pending - 1); end(url); if (!pending) { waiting.forEach(r => r()); waiting = []; } };
	m.setURLModifier(url => res.resolve(url));
	m.addHandler(/\.tga$/i, new L.TGALoader(m));
	m.idle = (timeout = 20000) => pending ? Promise.race([new Promise(r => waiting.push(r)), new Promise(r => setTimeout(r, timeout))]) : Promise.resolve();
	return m;
}

// ---------------------------------------------------------------------------
// Half-Life (GoldSrc) MDL, version 10: bones, meshes (triangle strips and fans), 8 bit textures, sequences
// ---------------------------------------------------------------------------

function reader(buffer) {
	const dv = new DataView(buffer), u8 = new Uint8Array(buffer);
	return {
		dv, u8, size: buffer.byteLength,
		i32: o => dv.getInt32(o, true), u16: o => dv.getUint16(o, true), i16: o => dv.getInt16(o, true), f32: o => dv.getFloat32(o, true),
		str: (o, n) => { let s = ''; for (let i = 0; i < n && u8[o + i]; i++) s += String.fromCharCode(u8[o + i]); return s; },
		vec: o => [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)],
	};
}

// Half-Life's angles (roll, pitch, yaw around x, y, z) as a quaternion: AngleQuaternion of the SDK
function hlQuat(a) {
	const sy = Math.sin(a[2] / 2), cy = Math.cos(a[2] / 2), sp = Math.sin(a[1] / 2), cp = Math.cos(a[1] / 2), sr = Math.sin(a[0] / 2), cr = Math.cos(a[0] / 2);
	return new THREE.Quaternion(sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy);
}
// Half-Life is Z up and looks along +X; Blockbench is Y up and looks along -Z
const HL_TO_Y_UP = new THREE.Matrix4().set(0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1);

function goldsrcTextures(r, base_name, notes) {
	const textures = [];
	const num = r.i32(180), index = r.i32(184);
	for (let t = 0; t < num; t++) {
		const o = index + t * 80, name = r.str(o, 64), flags = r.i32(o + 64), w = r.i32(o + 68), h = r.i32(o + 72), data = r.i32(o + 76);
		if (w <= 0 || h <= 0 || data + w * h + 768 > r.size) { textures.push(null); continue; }
		const canvas = document.createElement('canvas');
		canvas.width = w; canvas.height = h;
		const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h), pal = data + w * h;
		const masked = !!(flags & 0x40);
		for (let i = 0; i < w * h; i++) {
			const c = r.u8[data + i];
			img.data[i * 4] = r.u8[pal + c * 3]; img.data[i * 4 + 1] = r.u8[pal + c * 3 + 1]; img.data[i * 4 + 2] = r.u8[pal + c * 3 + 2];
			img.data[i * 4 + 3] = masked && c == 255 ? 0 : 255;
		}
		ctx.putImageData(img, 0, 0);
		const tex = new THREE.CanvasTexture(canvas);
		tex.flipY = false;   // the coordinates below are counted from the top
		tex.name = name.replace(/\.bmp$/i, '');
		textures.push({tex, w, h, masked, name: tex.name});
	}
	return textures;
}

function parseGoldSrc(buffer, res, file_name, notes) {
	const r = reader(buffer);
	const base = file_name.replace(/\.mdl$/i, '');
	// bones, in the reference pose
	const num_bones = r.i32(140), bone_index = r.i32(144);
	const bones = [], info = [];
	const wrapper = new THREE.Group();
	wrapper.name = 'hl_axes';
	wrapper.quaternion.setFromRotationMatrix(HL_TO_Y_UP);
	for (let b = 0; b < num_bones; b++) {
		const o = bone_index + b * 112;
		const value = [], scale = [];
		for (let k = 0; k < 6; k++) { value.push(r.f32(o + 64 + k * 4)); scale.push(r.f32(o + 88 + k * 4)); }
		const bone = new THREE.Bone();
		bone.name = r.str(o, 32) || 'bone' + b;
		bone.position.set(value[0], value[1], value[2]);
		bone.quaternion.copy(hlQuat([value[3], value[4], value[5]]));
		bones.push(bone);
		info.push({parent: r.i32(o + 32), value, scale});
	}
	bones.forEach((bone, b) => { const p = info[b].parent; (p >= 0 && bones[p] ? bones[p] : wrapper).add(bone); });
	const root = new THREE.Group();
	root.name = base;
	root.add(wrapper);
	root.updateMatrixWorld(true);

	// textures: in this file, or in <name>T.mdl
	let tex_reader = r;
	if (!r.i32(180)) {
		const tf = res.get(base + 't.mdl');
		if (tf) tex_reader = reader(tf.buffer); else notes.push(fill(tr('mdl_textures'), base));
	}
	const textures = goldsrcTextures(tex_reader, base, notes);
	const materials = textures.map((t, i) => {
		const m = new THREE.MeshLambertMaterial({map: t ? t.tex : null, color: t ? 0xffffff : 0xbbbbbb, name: t ? t.name : 'texture' + i});
		if (t && t.masked) { m.transparent = true; m.alphaTest = 0.5; }
		return m;
	});
	const fallback = new THREE.MeshLambertMaterial({color: 0xbbbbbb, name: 'untextured'});
	// skin family 0: the texture of every mesh
	const num_skinref = tex_reader.i32(192), skin_index = tex_reader.i32(200);
	const skinref = i => num_skinref && skin_index && i < num_skinref ? tex_reader.i16(skin_index + i * 2) : i;

	// the meshes of the first model of every body part
	const positions = [], uvs = [], skin_i = [], skin_w = [], groups = [];
	const used_materials = [];
	const num_bodyparts = r.i32(204), bodypart_index = r.i32(208);
	const v = new THREE.Vector3(), n = new THREE.Vector3();
	for (let bp = 0; bp < num_bodyparts; bp++) {
		const bo = bodypart_index + bp * 76, nummodels = r.i32(bo + 64), modelindex = r.i32(bo + 72);
		if (nummodels < 1) continue;
		const mo = modelindex;
		const numverts = r.i32(mo + 80), vertinfo = r.i32(mo + 84), vertindex = r.i32(mo + 88), norminfo = r.i32(mo + 96), normindex = r.i32(mo + 100);
		const nummesh = r.i32(mo + 72), meshindex = r.i32(mo + 76);
		const vbone = k => r.u8[vertinfo + k], nbone = k => r.u8[norminfo + k];
		const vpos = k => { const b = bones[vbone(k)] || bones[0]; v.set(...r.vec(vertindex + k * 12)); return b ? v.applyMatrix4(b.matrixWorld).clone() : v.clone(); };
		const vnorm = k => { const b = bones[nbone(k)] || bones[0]; n.set(...r.vec(normindex + k * 12)); return b ? n.transformDirection(b.matrixWorld).clone() : n.clone(); };
		for (let me = 0; me < nummesh; me++) {
			const mo2 = meshindex + me * 20, triindex = r.i32(mo2 + 4), sref = r.i32(mo2 + 8);
			const ti = skinref(sref), t = textures[ti];
			const material = t ? materials[ti] : fallback;
			let mat_i = used_materials.indexOf(material);
			if (mat_i < 0) { used_materials.push(material); mat_i = used_materials.length - 1; }
			const start = positions.length / 3;
			const W = t ? t.w : 1, H = t ? t.h : 1;
			const emit = (a, b, c) => {
				const pa = vpos(a.v), pb = vpos(b.v), pc = vpos(c.v);
				// the right way round: as the normals of the vertices say
				const face = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa));
				const avg = vnorm(a.n).add(vnorm(b.n)).add(vnorm(c.n));
				const list = face.dot(avg) < 0 ? [a, c, b] : [a, b, c];
				for (const x of list) {
					const p = vpos(x.v);
					positions.push(p.x, p.y, p.z);
					uvs.push(x.s / W, x.t / H);
					skin_i.push(vbone(x.v), 0, 0, 0);
					skin_w.push(1, 0, 0, 0);
				}
			};
			let p = triindex;
			for (let guard = 0; guard < 100000; guard++) {
				if (p + 2 > r.size) break;
				let count = r.i16(p); p += 2;
				if (!count) break;
				const fan = count < 0;
				count = Math.abs(count);
				const list = [];
				for (let k = 0; k < count; k++) { list.push({v: r.i16(p), n: r.i16(p + 2), s: r.i16(p + 4), t: r.i16(p + 6)}); p += 8; }
				for (let k = 2; k < count; k++) {
					if (list[k].v >= numverts || list[k - 1].v >= numverts || list[k - 2].v >= numverts) continue;
					if (fan) emit(list[0], list[k - 1], list[k]);
					else if (k % 2 == 0) emit(list[k - 2], list[k - 1], list[k]);
					else emit(list[k - 1], list[k - 2], list[k]);
				}
			}
			const count = positions.length / 3 - start;
			if (count) groups.push({start, count, materialIndex: mat_i});
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skin_i, 4));
	geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skin_w, 4));
	groups.forEach(g => geometry.addGroup(g.start, g.count, g.materialIndex));
	const mesh = new THREE.SkinnedMesh(geometry, used_materials.length ? used_materials : [fallback]);
	mesh.name = base;
	root.add(mesh);
	root.updateMatrixWorld(true);
	mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());

	// sequences: the animation of every bone, frame by frame (the values are run-length packed)
	const clips = [];
	const num_seq = r.i32(164), seq_index = r.i32(168);
	let missing_group = false;
	for (let s = 0; s < num_seq; s++) {
		const o = seq_index + s * 176;
		const label = r.str(o, 32), fps = r.f32(o + 32) || 30, frames = Math.max(1, r.i32(o + 56)), anim_index = r.i32(o + 124), group = r.i32(o + 156);
		let ar = r;
		if (group > 0) {
			const gf = res.get(base + String(group).padStart(2, '0') + '.mdl');
			if (!gf) { missing_group = true; continue; }
			ar = reader(gf.buffer);
		}
		const times = [];
		for (let f = 0; f < frames; f++) times.push(f / fps);
		const tracks = [];
		for (let b = 0; b < num_bones; b++) {
			const anim = anim_index + b * 12;
			if (anim + 12 > ar.size) break;
			const value = (j, frame) => {
				const off = ar.u16(anim + j * 2);
				if (!off) return 0;
				let p = anim + off, k = frame;
				for (let guard = 0; guard < 10000; guard++) {
					const valid = ar.u8[p], total = ar.u8[p + 1];
					if (!total) return 0;
					if (total > k) return valid > k ? ar.i16(p + (k + 1) * 2) : ar.i16(p + valid * 2);
					k -= total;
					p += (valid + 1) * 2;
					if (p + 2 > ar.size) return 0;
				}
				return 0;
			};
			const pos = [], quat = [];
			const I = info[b];
			for (let f = 0; f < frames; f++) {
				const ch = [0, 1, 2, 3, 4, 5].map(j => I.value[j] + value(j, f) * I.scale[j]);
				pos.push(ch[0], ch[1], ch[2]);
				const q = hlQuat([ch[3], ch[4], ch[5]]);
				quat.push(q.x, q.y, q.z, q.w);
			}
			tracks.push(new THREE.VectorKeyframeTrack(bones[b].uuid + '.position', times, pos));
			tracks.push(new THREE.QuaternionKeyframeTrack(bones[b].uuid + '.quaternion', times, quat));
		}
		clips.push(new THREE.AnimationClip(label || 'sequence' + s, Math.max(1 / fps, (frames - 1) / fps), tracks));
	}
	if (missing_group) notes.push(fill(tr('mdl_seqgroup'), base));
	return {root, clips, units: 'inch'};
}

// ---------------------------------------------------------------------------
// Quake MDL (IDPO, version 6): the first frame and the first skin
// ---------------------------------------------------------------------------

function parseQuake(buffer, res, file_name, notes) {
	const r = reader(buffer);
	const scale = r.vec(8), translate = r.vec(20);
	const num_skins = r.i32(48), sw = r.i32(52), sh = r.i32(56), num_verts = r.i32(60), num_tris = r.i32(64), num_frames = r.i32(68);
	let p = 84;
	// the palette: palette.lmp next to the model, or grey
	const lmp = res.get('palette.lmp');
	const pal = lmp && lmp.buffer.byteLength >= 768 ? new Uint8Array(lmp.buffer) : null;
	if (!pal) notes.push(tr('quake_palette'));
	let skin = null;
	for (let s = 0; s < num_skins; s++) {
		const group = r.i32(p); p += 4;
		let data = p, n = 1;
		if (group) { n = r.i32(p); p += 4 + n * 4; data = p; }
		if (!skin) skin = data;
		p += n * sw * sh;
	}
	const canvas = document.createElement('canvas');
	canvas.width = sw; canvas.height = sh;
	const ctx = canvas.getContext('2d'), img = ctx.createImageData(sw, sh);
	for (let i = 0; i < sw * sh; i++) {
		const c = skin !== null ? r.u8[skin + i] : 0;
		img.data[i * 4] = pal ? pal[c * 3] : c; img.data[i * 4 + 1] = pal ? pal[c * 3 + 1] : c; img.data[i * 4 + 2] = pal ? pal[c * 3 + 2] : c; img.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(img, 0, 0);
	const tex = new THREE.CanvasTexture(canvas);
	tex.flipY = false;
	tex.name = file_name.replace(/\.mdl$/i, '') + '_skin';
	const st = [];
	for (let i = 0; i < num_verts; i++) { st.push({seam: r.i32(p), s: r.i32(p + 4), t: r.i32(p + 8)}); p += 12; }
	const tris = [];
	for (let i = 0; i < num_tris; i++) { tris.push({front: r.i32(p), v: [r.i32(p + 4), r.i32(p + 8), r.i32(p + 12)]}); p += 16; }
	// the first frame
	const type = r.i32(p); p += 4;
	if (type) { const n = r.i32(p); p += 4 + 8 + n * 4; }
	p += 8 + 16;   // its box and its name
	const verts = [];
	for (let i = 0; i < num_verts; i++) { verts.push([0, 1, 2].map(k => r.u8[p + i * 4 + k] * scale[k] + translate[k])); }
	if (num_frames > 1) notes.push(tr('morph'));
	const positions = [], uvs = [];
	for (const t of tris) {
		for (const k of [0, 2, 1]) {   // Quake turns its triangles the other way
			const i = t.v[k], v = verts[i] || [0, 0, 0];
			positions.push(v[0], v[1], v[2]);
			let s = st[i] ? st[i].s : 0;
			if (st[i] && !t.front && st[i].seam) s += sw / 2;
			uvs.push((s + 0.5) / sw, ((st[i] ? st[i].t : 0) + 0.5) / sh);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({map: tex, name: tex.name}));
	mesh.name = file_name.replace(/\.mdl$/i, '');
	const root = new THREE.Group();
	const axes = new THREE.Group();
	axes.quaternion.setFromRotationMatrix(HL_TO_Y_UP);   // Quake has the same axes as Half-Life
	axes.add(mesh);
	root.add(axes);
	return {root, clips: [], units: 'inch'};
}

// ---------------------------------------------------------------------------
// Reading a model into a three.js scene
// ---------------------------------------------------------------------------

async function loadModel(main, res, notes) {
	const ext = extOf(main.name);
	const manager = managerFor(res);
	let root = null, clips = [];
	const done = obj => { root = obj; clips = (obj && obj.animations) || []; };
	if (ext == 'fbx') done(new L.FBXLoader(manager).parse(main.buffer, ''));
	else if (ext == 'gltf' || ext == 'glb') {
		const gltf = await new Promise((ok, fail) => new L.GLTFLoader(manager).parse(ext == 'glb' ? main.buffer : textOf(main.buffer), '', ok, fail));
		root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
		clips = gltf.animations || [];
	} else if (ext == 'dae') {
		const c = new L.ColladaLoader(manager).parse(textOf(main.buffer), '');
		root = c.scene;
		clips = (c.scene && c.scene.animations && c.scene.animations.length ? c.scene.animations : c.animations) || [];
	} else if (ext == 'obj') {
		const text = textOf(main.buffer), loader = new L.OBJLoader(manager);
		const libs = [...text.matchAll(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/gm)].map(m => m[1]);
		let creator = null;
		for (const lib of libs) {
			const f = res.get(lib);
			if (!f) continue;
			const c = new L.MTLLoader(manager).parse(textOf(f.buffer), '');
			if (creator) Object.assign(creator.materialsInfo, c.materialsInfo); else creator = c;
		}
		if (creator) { creator.preload(); loader.setMaterials(creator); }
		done(loader.parse(text));
	} else if (ext == '3ds') done(new L.TDSLoader(manager).parse(main.buffer, ''));
	else if (ext == 'stl' || ext == 'ply') {
		const geometry = (ext == 'stl' ? new L.STLLoader(manager) : new L.PLYLoader(manager)).parse(main.buffer);
		const material = new THREE.MeshLambertMaterial({color: 0xc8c8c8, vertexColors: !!geometry.attributes.color, name: 'material'});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.name = main.name.replace(/\.[^.]*$/, '');
		root = new THREE.Group();
		root.add(mesh);
	} else if (ext == '3mf') done(new L.ThreeMFLoader(manager).parse(main.buffer));
	else if (ext == 'md2') {
		const geometry = new L.MD2Loader(manager).parse(main.buffer);
		if (geometry.morphAttributes && geometry.morphAttributes.position && geometry.morphAttributes.position.length > 1) notes.push(tr('morph'));
		const skin = res.getAnyImage(main.name.replace(/\.md2$/i, '.png'));
		let material = new THREE.MeshLambertMaterial({color: 0xc8c8c8, name: 'skin'});
		if (skin) { material = new THREE.MeshLambertMaterial({map: new THREE.TextureLoader(manager).load(res.url(skin.name)), name: 'skin'}); }
		const mesh = new THREE.Mesh(geometry, material);
		mesh.name = main.name.replace(/\.md2$/i, '');
		root = new THREE.Group();
		root.add(mesh);
	} else if (ext == 'mdl') {
		const r = reader(main.buffer), id = r.str(0, 4), version = r.i32(4);
		let out;
		if (id == 'IDST' && version == 10) out = parseGoldSrc(main.buffer, res, main.name, notes);
		else if (id == 'IDPO') out = parseQuake(main.buffer, res, main.name, notes);
		else if (id == 'IDST') throw new Error(fill(tr('source_mdl'), version));
		else throw new Error(tr('unknown'));
		root = out.root; clips = out.clips;
	} else throw new Error(tr('unknown'));
	await manager.idle();
	return {root, clips};
}

// ---------------------------------------------------------------------------
// The scene -> Blockbench: textures, meshes, bone groups or an armature, animations
// ---------------------------------------------------------------------------

// how this Blockbench turns the rotation of a group into three.js angles (some versions mirror x and y)
let signs_cache = null;
function rotationSigns() {
	if (signs_cache) return signs_cache;
	try {
		const g = Group.all.find(x => x.mesh);
		if (g && Canvas.updateAllBones) {
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

const canArmature = () => typeof Armature == 'function' && typeof ArmatureBone == 'function' && typeof Format != 'undefined' && Format && !!Format.armature_rig;

// the pictures of the model as Blockbench textures
class TextureBank {
	constructor(o, res) {
		this.o = o;
		this.res = res;
		this.by_image = new Map();
		this.colors = new Map();     // '#rrggbb' -> cell
		this.created = [];
		this.palette = null;
	}
	uvSize(tex) {
		if (typeof Format != 'undefined' && Format.per_texture_uv_size && tex.uv_width) return [tex.uv_width, tex.uv_height];
		return [Project.texture_width || 16, Project.texture_height || 16];
	}
	// a three.js texture -> {texture, size, flip, matrix} (null when it has no readable picture)
	forMap(map, fallback_name) {
		const image = map && map.image;
		if (!image) return null;
		// the same picture file used by several materials is one texture
		const file = image.src && this.res && this.res.names.get(image.src);
		const key = file ? 'file:' + file.toLowerCase() : image;
		if (this.by_image.has(key)) return this.by_image.get(key);
		let canvas = null;
		try {
			const w = image.width || (image.data && image.width), h = image.height;
			if (!w || !h) return null;
			canvas = document.createElement('canvas');
			canvas.width = w; canvas.height = h;
			const ctx = canvas.getContext('2d');
			if (image.data && !(image instanceof HTMLImageElement) && !(typeof ImageBitmap != 'undefined' && image instanceof ImageBitmap) && !(image instanceof HTMLCanvasElement)) {
				// raw pixels (TGA, data textures): RGBA or RGB
				const img = ctx.createImageData(w, h), src = image.data, ch = src.length / (w * h);
				for (let i = 0; i < w * h; i++) {
					img.data[i * 4] = src[i * ch]; img.data[i * 4 + 1] = src[i * ch + 1]; img.data[i * 4 + 2] = src[i * ch + 2];
					img.data[i * 4 + 3] = ch >= 4 ? src[i * ch + 3] : 255;
				}
				ctx.putImageData(img, 0, 0);
			} else ctx.drawImage(image, 0, 0, w, h);
		} catch (err) { console.warn('[Import] texture', err); return null; }
		let name = map.name || '';
		if (!name && image.src && this.res && this.res.names.has(image.src)) name = this.res.names.get(image.src);
		if (!name && image.src && !/^(blob|data):/.test(image.src)) { try { name = decodeURIComponent(baseOf(image.src)); } catch (err) { name = baseOf(image.src); } }
		name = (name || fallback_name || 'texture').replace(/\.[^.]*$/, '');
		const texture = new Texture({name}).fromDataURL(canvas.toDataURL('image/png')).add(false);
		if ('uv_width' in texture) { texture.uv_width = canvas.width; texture.uv_height = canvas.height; }
		this.created.push(texture);
		map.updateMatrix && map.updateMatrix();
		const plain = map.offset.x == 0 && map.offset.y == 0 && map.repeat.x == 1 && map.repeat.y == 1 && !map.rotation;
		const entry = {texture, flip: map.flipY !== false, matrix: plain ? null : map.matrix.clone(), size: null};
		this.by_image.set(key, entry);
		return entry;
	}
	// a plain colour: a cell of the colour palette (made at the end)
	colorCell(hex) {
		if (!this.colors.has(hex)) this.colors.set(hex, this.colors.size);
		return this.colors.get(hex);
	}
	makePalette() {
		if (!this.colors.size) return;
		const n = Math.ceil(Math.sqrt(this.colors.size)), cell = 4, size = n * cell;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		const ctx = canvas.getContext('2d');
		for (const [hex, i] of this.colors) { ctx.fillStyle = hex; ctx.fillRect((i % n) * cell, Math.floor(i / n) * cell, cell, cell); }
		const texture = new Texture({name: 'colors'}).fromDataURL(canvas.toDataURL('image/png')).add(false);
		if ('uv_width' in texture) { texture.uv_width = size; texture.uv_height = size; }
		this.created.push(texture);
		this.palette = {texture, n, cell, size};
	}
	// the uv (in the texture's pixels) of a colour cell
	cellUV(i) {
		const p = this.palette, [W, H] = this.uvSize(p.texture);
		return [((i % p.n) + 0.5) * p.cell / p.size * W, (Math.floor(i / p.n) + 0.5) * p.cell / p.size * H];
	}
}

const hexOf = c => '#' + c.getHexString();
// one component of a buffer attribute (r129 has no getComponent)
const comp = (attr, i, k) => k == 0 ? attr.getX(i) : k == 1 ? attr.getY(i) : k == 2 ? attr.getZ(i) : attr.getW(i);

// every triangle of the scene, in Blockbench's space: {p: [3 x Vector3], uv: [3 x [u,v]] (0..1) | null, mat, color, mesh, bones: [3 x [[node, w]...]], owner}
function collectTriangles(root, meshes, M, owner_of, bone_nodes_of, bank, o) {
	const tris = [];
	const v = new THREE.Vector3(), uvm = new THREE.Vector3();
	for (const mesh of meshes) {
		const g = mesh.geometry, pos = g.attributes.position;
		if (!pos) continue;
		const uv = g.attributes.uv, col = g.attributes.color, index = g.index;
		const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
		const skinned = mesh.isSkinnedMesh && mesh.skeleton && si && sw;
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		const flip = mesh.matrixWorld.determinant() < 0;
		const world = new Array(pos.count);
		for (let i = 0; i < pos.count; i++) {
			if (skinned) mesh.boneTransform(i, v); else v.fromBufferAttribute(pos, i);
			world[i] = v.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(M);
		}
		const vertexBones = i => {
			if (!skinned) return null;
			const list = [];
			for (let k = 0; k < 4; k++) {
				const w = comp(sw, i, k);
				if (w > 0.005) { const node = bone_nodes_of(mesh.skeleton.bones[comp(si, i, k)]); if (node) list.push([node, w]); }
			}
			return list;
		};
		const ranges = g.groups && g.groups.length ? g.groups : [{start: 0, count: index ? index.count : pos.count, materialIndex: 0}];
		for (const range of ranges) {
			const material = mats[range.materialIndex || 0] || mats[0];
			const map = o.textures && material && material.map ? bank.forMap(material.map, material.name) : null;
			const base_color = material && material.color ? material.color : new THREE.Color(0xc8c8c8);
			const end = Math.min(range.start + range.count, index ? index.count : pos.count);
			for (let k = range.start; k + 2 < end; k += 3) {
				let ids = index ? [index.getX(k), index.getX(k + 1), index.getX(k + 2)] : [k, k + 1, k + 2];
				if (flip) ids = [ids[0], ids[2], ids[1]];
				const p = ids.map(i => world[i]);
				if (new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).lengthSq() < 1e-12) continue;
				let uvs = null, color = null;
				if (map && uv) {
					uvs = ids.map(i => {
						let u = uv.getX(i), w = uv.getY(i);
						if (map.matrix) { uvm.set(u, w, 1).applyMatrix3(map.matrix); u = uvm.x; w = uvm.y; }
						return [u, map.flip ? 1 - w : w];
					});
				} else if (o.textures) {
					let c = base_color;
					if (col && material && material.vertexColors) {
						c = new THREE.Color(0, 0, 0);
						ids.forEach(i => { c.r += col.getX(i) / 3; c.g += col.getY(i) / 3; c.b += col.getZ(i) / 3; });
						c.multiply(base_color);
					}
					// a few hundred colours at most: near ones share a cell
					const q = x => Math.round(x * 31) / 31;
					color = bank.colorCell(hexOf(new THREE.Color(q(c.r), q(c.g), q(c.b))));
				}
				tris.push({p, uv: uvs, map, color, mesh, material, bones: skinned ? ids.map(vertexBones) : null, owner: owner_of(mesh)});
			}
		}
	}
	return tris;
}

// two triangles that share an edge, lie in one plane, have the same texture and the same uv on the edge -> one quad
function mergeQuads(tris) {
	const key = p => p.x.toFixed(4) + ',' + p.y.toFixed(4) + ',' + p.z.toFixed(4);
	const normal = t => new THREE.Vector3().subVectors(t.p[1], t.p[0]).cross(new THREE.Vector3().subVectors(t.p[2], t.p[0])).normalize();
	const edges = new Map();
	tris.forEach((t, ti) => { t.keys = t.p.map(key); t.n = normal(t); for (let e = 0; e < 3; e++) { const a = t.keys[e], b = t.keys[(e + 1) % 3]; edges.set(a + '|' + b, {ti, e}); } });
	const used = new Set(), out = [];
	const sameUV = (a, b) => !a && !b || (a && b && Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5);
	tris.forEach((t, ti) => {
		if (used.has(ti)) return;
		let best = null;
		for (let e = 0; e < 3 && !best; e++) {
			const a = t.keys[e], b = t.keys[(e + 1) % 3];
			const hit = edges.get(b + '|' + a);
			if (!hit || hit.ti == ti || used.has(hit.ti)) continue;
			const s = tris[hit.ti];
			if (s.map !== t.map || s.color !== t.color || s.material !== t.material || s.owner !== t.owner || t.n.dot(s.n) < 0.9995) continue;
			// the shared edge must carry the same uv in both, and the same bone weights
			const ia = e, ib = (e + 1) % 3, ja = (hit.e + 1) % 3, jb = hit.e;
			if (t.uv && !(sameUV(t.uv[ia], s.uv[ja]) && sameUV(t.uv[ib], s.uv[jb]))) continue;
			const q = 3 - hit.e - ((hit.e + 1) % 3);   // the third corner of the other triangle
			// p0 = start of the edge, p1 = end, p2 = the third corner of t
			const i2 = (e + 2) % 3;
			const loop = [ia, 'q', ib, i2];
			const P = i => i === 'q' ? s.p[q] : t.p[i];
			// convex: every corner turns the same way
			let convex = true;
			for (let k = 0; k < 4 && convex; k++) {
				const A = P(loop[k]), B = P(loop[(k + 1) % 4]), C = P(loop[(k + 2) % 4]);
				if (new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, B)).dot(t.n) <= 1e-9) convex = false;
			}
			if (convex) best = {hit, loop, q};
		}
		if (!best) { out.push(t); used.add(ti); return; }
		const s = tris[best.hit.ti];
		used.add(ti); used.add(best.hit.ti);
		const pick = (arr, sarr) => best.loop.map(i => i === 'q' ? sarr[best.q] : arr[i]);
		out.push(Object.assign({}, t, {p: pick(t.p, s.p), uv: t.uv ? pick(t.uv, s.uv) : null, bones: t.bones ? pick(t.bones, s.bones) : null}));
	});
	return out;
}

// builds one Blockbench mesh from faces; returns {el, keys (per face, per corner)}
function buildMesh(name, origin, faces, bank, weights_out) {
	const el = new Mesh({name, origin: origin.map(v => Math.round(v * 1000) / 1000), vertices: {}});
	const index = new Map(), points = [], point_bones = [];
	const key = p => p.x.toFixed(3) + ',' + p.y.toFixed(3) + ',' + p.z.toFixed(3);
	const corner = faces.map(f => f.p.map((p, k) => {
		const id = key(p);
		if (!index.has(id)) { index.set(id, points.length); points.push([p.x - origin[0], p.y - origin[1], p.z - origin[2]].map(v => Math.round(v * 10000) / 10000)); point_bones.push(f.bones ? f.bones[k] : null); }
		return index.get(id);
	}));
	const vkeys = el.addVertices(...points);
	const mesh_faces = faces.map((f, fi) => {
		const vertices = corner[fi].map(i => vkeys[i]);
		if (new Set(vertices).size < vertices.length) return null;
		const uv = {};
		let texture = false;
		if (f.uv && f.map) {
			const [W, H] = bank.uvSize(f.map.texture);
			// a face that runs past the edge of a repeating texture is moved back onto it
			const su = Math.floor(f.uv.reduce((s, x) => s + x[0], 0) / f.uv.length), sv = Math.floor(f.uv.reduce((s, x) => s + x[1], 0) / f.uv.length);
			vertices.forEach((vk, k) => { uv[vk] = [(f.uv[k][0] - su) * W, (f.uv[k][1] - sv) * H]; });
			texture = f.map.texture.uuid;
		} else if (f.color !== null && f.color !== undefined && bank.palette) {
			const c = bank.cellUV(f.color);
			vertices.forEach(vk => { uv[vk] = c.slice(); });
			texture = bank.palette.texture.uuid;
		}
		return new MeshFace(el, {vertices, uv, texture});
	}).filter(Boolean);
	el.addFaces(...mesh_faces);
	if (weights_out) points.forEach((p, i) => { if (point_bones[i]) weights_out.push([vkeys[i], point_bones[i]]); });
	return el;
}

// key reduction: a key is kept only where a straight line from the last kept one would miss by more than `tol`
function reduceKeys(samples, tol) {
	const n = samples.length;
	if (n <= 2) return samples.map((s, i) => i);
	const keep = [0];
	let last = 0;
	for (let i = 2; i < n; i++) {
		let bad = false;
		for (let j = last + 1; j < i && !bad; j++) {
			const t = (j - last) / (i - last);
			for (let a = 0; a < samples[j].length; a++) if (Math.abs(samples[last][a] + (samples[i][a] - samples[last][a]) * t - samples[j][a]) > tol) { bad = true; break; }
		}
		if (bad) { keep.push(i - 1); last = i - 1; }
	}
	keep.push(n - 1);
	return keep;
}

function convertScene(root, clips, o, model_name, notes, res) {
	root.updateMatrixWorld(true);
	const meshes = [];
	root.traverse(n => { if ((n.isMesh || n.isSkinnedMesh) && n.geometry && n.geometry.attributes.position && n.visible !== false) meshes.push(n); });
	if (!meshes.length) throw new Error(tr('no_mesh'));
	if (meshes.some(m => m.geometry.morphAttributes && Object.keys(m.geometry.morphAttributes).length) && !notes.includes(tr('morph'))) {
		if (clips.some(c => c.tracks.some(t => /morphTargetInfluences/.test(t.name)))) notes.push(tr('morph'));
	}
	// the rest pose of everything (the animations are sampled from it and it is put back after)
	const rest = new Map();
	root.traverse(n => rest.set(n, {p: n.position.clone(), q: n.quaternion.clone(), s: n.scale.clone()}));
	const restore = () => { rest.forEach((r, n) => { n.position.copy(r.p); n.quaternion.copy(r.q); n.scale.copy(r.s); }); root.updateMatrixWorld(true); };

	// the nodes that move: bones of skeletons, and anything an animation moves
	const moving = new Set();
	const skinned = meshes.filter(m => m.isSkinnedMesh && m.skeleton);
	skinned.forEach(m => m.skeleton.bones.forEach(b => moving.add(b)));
	const animated_clips = o.animations ? clips.filter(c => c.duration > 0 && c.tracks.length) : [];
	for (const clip of animated_clips) for (const track of clip.tracks) {
		try {
			const pb = THREE.PropertyBinding.parseTrackName(track.name);
			if (!['position', 'quaternion', 'rotation', 'scale'].includes(pb.propertyName)) continue;
			const node = THREE.PropertyBinding.findNode(root, pb.nodeName);
			if (node && node !== root) moving.add(node);
		} catch (err) { /* a track of something else */ }
	}
	moving.delete(root);
	const ownerOf = node => { for (let n = node; n && n !== root; n = n.parent) if (moving.has(n)) return n; return null; };
	const boneNode = bone => moving.has(bone) ? bone : ownerOf(bone);

	// blended skin? (a vertex pulled by two bones or more)
	let blended = false;
	for (const m of skinned) {
		const sw = m.geometry.attributes.skinWeight;
		if (!sw) continue;
		for (let i = 0; i < sw.count && !blended; i++) { let n = 0; for (let k = 0; k < 4; k++) if (comp(sw, i, k) > 0.02) n++; if (n > 1) blended = true; }
	}
	const armature = blended && o.skin != 'groups' && canArmature() || (o.skin == 'armature' && canArmature() && moving.size > 0);

	// the size and the place in Blockbench
	const box = new THREE.Box3(), v = new THREE.Vector3();
	for (const m of meshes) {
		const pos = m.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 20000));
		for (let i = 0; i < pos.count; i += step) {
			if (m.isSkinnedMesh && m.skeleton) m.boneTransform(i, v); else v.fromBufferAttribute(pos, i);
			box.expandByPoint(v.applyMatrix4(m.matrixWorld));
		}
	}
	const size = box.getSize(new THREE.Vector3());
	const k = o.size == 'keep' ? Math.max(1e-6, o.factor) : Math.max(1e-6, o.height) / Math.max(1e-6, size.y || Math.max(size.x, size.z) || 1);
	const shift = o.ground ? new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2) : new THREE.Vector3();
	const M = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-shift.x, -shift.y, -shift.z));
	const M_inv = M.clone().invert();

	// pivots of the moving nodes (Blockbench pixels), and who is the parent of whom
	const nodes = [...moving];
	const pivot = new Map(nodes.map(n => [n, n.getWorldPosition(new THREE.Vector3()).applyMatrix4(M)]));
	const parentOf = n => ownerOf(n.parent);
	const depth = n => { let d = 0; for (let p = parentOf(n); p; p = parentOf(p)) d++; return d; };
	nodes.sort((a, b) => depth(a) - depth(b));
	const rest_world_inv = new Map(nodes.map(n => [n, n.matrixWorld.clone().invert()]));

	// the triangles
	const bank = new TextureBank(o, res);
	let tris = collectTriangles(root, meshes, M, m => ownerOf(m), boneNode, bank, o);
	if (tris.length > 60000) notes.push(fill(tr('too_big'), tris.length));
	bank.makePalette();
	// in bone groups a triangle goes with the bone that pulls its corners most
	if (!armature) tris.forEach(t => {
		if (!t.bones) return;
		const sum = new Map();
		t.bones.forEach(list => (list || []).forEach(([n, w]) => sum.set(n, (sum.get(n) || 0) + w)));
		let best = null, bw = -1;
		sum.forEach((w, n) => { if (w > bw) { bw = w; best = n; } });
		t.owner = best || t.owner;
		t.bones = null;
	});
	if (o.quads) tris = mergeQuads(tris);

	// --- Blockbench elements ---
	const groups = [], elements = [], bone_of = new Map();
	const name = model_name.replace(/\.[^.]*$/, '');
	const used_names = new Map();
	const unique = n => { const base = (n || 'part').replace(/[^\w\- .]/g, '_'); const c = used_names.get(base) || 0; used_names.set(base, c + 1); return c ? base + '_' + c : base; };
	const round = a => a.map(x => Math.round(x * 1000) / 1000);
	let top;
	if (armature) {
		top = new Armature({name}).addTo('root').init();
		for (const n of nodes) {
			const p = parentOf(n), here = pivot.get(n), at = p ? here.clone().sub(pivot.get(p)) : here.clone();
			const kids = nodes.filter(c => parentOf(c) === n);
			const length = kids.length ? Math.max(0.5, pivot.get(kids[0]).distanceTo(here)) : Math.max(0.5, size.y * k * 0.05);
			const bone = new ArmatureBone({name: unique(n.name || 'bone'), origin: round(at.toArray()), rotation: [0, 0, 0], length, width: Math.max(0.3, length * 0.15)});
			bone.addTo(p ? bone_of.get(p) : top).init();
			bone_of.set(n, bone);
			groups.push(bone);
		}
	} else {
		top = new Group({name, origin: [0, 0, 0]}).addTo('root').init();
		groups.push(top);
		for (const n of nodes) {
			const p = parentOf(n);
			const g = new Group({name: unique(n.name || 'bone'), origin: round(pivot.get(n).toArray()), rotation: [0, 0, 0]});
			g.addTo(p ? bone_of.get(p) : top).init();
			bone_of.set(n, g);
			groups.push(g);
		}
	}
	// meshes: one per source mesh (and per bone, in bone groups)
	const buckets = new Map();
	for (const t of tris) {
		const key = armature ? t.mesh.uuid : t.mesh.uuid + '|' + (t.owner ? t.owner.uuid : '');
		if (!buckets.has(key)) buckets.set(key, {mesh: t.mesh, owner: armature ? null : t.owner, faces: []});
		buckets.get(key).faces.push(t);
	}
	let bone_count = armature ? nodes.length : nodes.length;
	for (const b of buckets.values()) {
		let origin;
		if (b.owner && pivot.has(b.owner)) origin = pivot.get(b.owner).toArray();
		else { const bb = new THREE.Box3(); b.faces.forEach(f => f.p.forEach(p => bb.expandByPoint(p))); origin = bb.getCenter(new THREE.Vector3()).toArray(); }
		const label = (b.mesh.name || (b.faces[0].material && b.faces[0].material.name) || 'mesh') + (b.owner && !armature && b.owner.name && b.owner.name != b.mesh.name ? ' ' + b.owner.name : '');
		const weights = armature ? [] : null;
		const el = buildMesh(unique(label), armature ? [0, 0, 0] : origin, b.faces, bank, weights);
		el.addTo(armature ? top : (b.owner ? bone_of.get(b.owner) : top)).init();
		elements.push(el);
		if (armature) {
			const static_owner = ownerOf(b.mesh);
			for (const [vkey, list] of weights) {
				const total = list.reduce((s, x) => s + x[1], 0) || 1;
				list.forEach(([n, w]) => { const bone = bone_of.get(n); if (bone && w / total > 0.01) bone.setVertexWeight(el, vkey, Math.round(w / total * 1000) / 1000); });
			}
			// a rigid part inside the armature follows the bone it hangs from
			if (!weights.length && static_owner && bone_of.has(static_owner)) Object.keys(el.vertices).forEach(vk => bone_of.get(static_owner).setVertexWeight(el, vk, 1));
		}
	}

	// --- animations ---
	const animations = [];
	if (animated_clips.length && nodes.length) {
		const fps = Math.max(1, Math.min(120, Math.round(o.fps || 30)));
		const signs = armature ? [1, 1, 1] : rotationSigns();
		const order = (typeof Format != 'undefined' && Format.euler_order) || 'ZYX';
		const mixer = new THREE.AnimationMixer(root);
		const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
		for (const clip of animated_clips) {
			const frames = Math.max(1, Math.min(Math.ceil(Math.min(clip.duration, 600) * fps), 36000));
			const samples = new Map(nodes.map(n => [n, {pos: [], rot: [], scl: []}]));
			const action = mixer.clipAction(clip);
			action.play();
			for (let f = 0; f <= frames; f++) {
				mixer.setTime(Math.min(clip.duration, f / fps));
				root.updateMatrixWorld(true);
				const G = new Map();
				for (const n of nodes) {
					// how the node moved from its rest place, in Blockbench space, carried to its pivot
					const S = M.clone().multiply(n.matrixWorld).multiply(rest_world_inv.get(n)).multiply(M_inv);
					const here = pivot.get(n);
					const g = S.multiply(T(here.x, here.y, here.z));
					G.set(n, g);
					const p = parentOf(n), parent_g = p ? G.get(p) : null;
					const local = parent_g ? parent_g.clone().invert().multiply(g) : g.clone();
					const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
					local.decompose(pos, quat, scl);
					const rest_offset = p ? here.clone().sub(pivot.get(p)) : here.clone();
					const s = samples.get(n);
					s.pos.push(pos.sub(rest_offset).toArray());
					const e = new THREE.Euler().setFromQuaternion(quat, order);
					let deg = [e.x, e.y, e.z].map((r, i) => r * 180 / Math.PI * signs[i]);
					const prev = s.rot[s.rot.length - 1];
					if (prev) deg = deg.map((d, i) => d + 360 * Math.round((prev[i] - d) / 360));
					s.rot.push(deg);
					s.scl.push(scl.toArray());
				}
			}
			action.stop();
			mixer.uncacheAction(clip);
			restore();
			const animation = new Animation({name: clip.name || 'animation', length: Math.round(clip.duration * 1000) / 1000, loop: 'loop', snapping: fps}).add(false);
			const r4 = x => Math.round(x * 1e4) / 1e4;
			for (const n of nodes) {
				const target = bone_of.get(n), s = samples.get(n);
				const moves = list => list.some(a => a.some((x, i) => Math.abs(x - list[0][i]) > 1e-4) || a.some(x => Math.abs(x) > 1e-4));
				const channels = [['rotation', s.rot, 0.15, moves(s.rot)], ['position', s.pos, 0.01, moves(s.pos)], ['scale', s.scl, 0.002, s.scl.some(a => a.some(x => Math.abs(x - 1) > 1e-3))]];
				if (!channels.some(c => c[3])) continue;
				const animator = animation.getBoneAnimator(target);
				if (!animator) continue;
				for (const [channel, list, tol, used] of channels) {
					if (!used) continue;
					for (const f of reduceKeys(list, tol)) {
						const a = list[f];
						animator.addKeyframe({channel, time: r4(f / fps), interpolation: 'linear', data_points: [{x: r4(a[0]), y: r4(a[1]), z: r4(a[2])}]});
					}
				}
			}
			animations.push(animation);
		}
		mixer.uncacheRoot(root);
	}
	restore();
	return {top, groups, elements, textures: bank.created, animations, bone_count, armature};
}

// ---------------------------------------------------------------------------
// The import: pick files, options, read, convert
// ---------------------------------------------------------------------------

const Z_UP_FORMATS = ['3ds', 'stl', '3mf'];
const DEFAULT_OPTIONS = {up: 'auto', size: 'fit', height: 32, factor: 1, ground: true, animations: true, textures: true, quads: true, skin: 'auto', fps: 30, target: 'new'};
let last_options = Object.assign({}, DEFAULT_OPTIONS);
try { Object.assign(last_options, JSON.parse(localStorage.getItem('model_import_options') || '{}')); } catch (err) { /* defaults */ }

function pickFiles() {
	Blockbench.import({
		resource_id: 'model_import',
		extensions: [...MODEL_EXT, ...RESOURCE_EXT],
		type: '3D model',
		readtype: 'binary',
		multiple: true,
	}, files => {
		const list = files.map(f => ({name: f.name || baseOf(f.path || 'model'), path: f.path, buffer: f.content instanceof ArrayBuffer ? f.content : (f.content && f.content.buffer) || f.content}));
		const main = list.find(f => MODEL_EXT.includes(extOf(f.name)) && !/t\.mdl$/i.test(f.name) && !/\d\d\.mdl$/i.test(f.name)) || list.find(f => MODEL_EXT.includes(extOf(f.name)));
		if (!main) { Blockbench.showQuickMessage(tr('unknown'), 3000); return; }
		optionsDialog(main, list);
	});
}

function optionsDialog(main, files) {
	const o = last_options;
	const has_project = typeof Project != 'undefined' && Project && Format && Format.meshes;
	new Dialog({
		id: 'model_import_options',
		title: tr('title') + ' — ' + main.name,
		width: 480,
		form: {
			files: {type: 'info', label: tr('files'), text: files.map(f => f.name).join(', ')},
			target: {label: tr('target'), type: 'select', value: has_project ? o.target : 'new', options: has_project ? {new: tr('target_new'), current: tr('target_current')} : {new: tr('target_new')}},
			size: {label: tr('size'), type: 'select', value: o.size, options: {fit: tr('size_fit'), keep: tr('size_keep')}},
			height: {label: tr('height'), type: 'number', value: o.height, min: 1, max: 4096, step: 1, condition: f => f.size == 'fit'},
			factor: {label: tr('factor'), type: 'number', value: o.factor, min: 0.0001, max: 10000, step: 0.1, condition: f => f.size == 'keep'},
			up: {label: tr('up'), type: 'select', value: o.up || 'auto', options: {auto: tr('up_auto'), y: tr('up_y'), z: tr('up_z')}},
			ground: {label: tr('ground'), type: 'checkbox', value: o.ground},
			textures: {label: tr('textures'), type: 'checkbox', value: o.textures},
			quads: {label: tr('quads'), type: 'checkbox', value: o.quads},
			skin: {label: tr('skin'), type: 'select', value: o.skin, options: {auto: tr('skin_auto'), groups: tr('skin_groups'), armature: tr('skin_armature')}},
			animations: {label: tr('anims'), type: 'checkbox', value: o.animations},
			fps: {label: tr('fps'), type: 'number', value: o.fps, min: 1, max: 120, step: 1, condition: f => f.animations},
			hint: {type: 'info', text: tr('hint')},
		},
		onConfirm(form) {
			last_options = Object.assign({}, DEFAULT_OPTIONS, form);
			try { localStorage.setItem('model_import_options', JSON.stringify(last_options)); } catch (err) { /* not kept */ }
			runImport(main, files, last_options);
		},
	}).show();
}

async function runImport(main, files, o) {
	const notes = [];
	const res = new Resources(files.filter(f => f !== main), main);
	let result = null;
	try {
		Blockbench.setProgress && Blockbench.setProgress(0.1);
		let {root, clips} = await loadModel(main, res, notes);
		if (!root) throw new Error(tr('no_mesh'));
		// a model made with Z up (CAD, 3ds Max) is stood up
		const z_up = o.up == 'z' || (o.up == 'auto' && Z_UP_FORMATS.includes(extOf(main.name)));
		if (z_up) { const turn = new THREE.Group(); turn.rotation.x = -Math.PI / 2; turn.add(root); root = turn; }
		Blockbench.setProgress && Blockbench.setProgress(0.5);
		if (o.target != 'current' || !Project || !Format || !Format.meshes) {
			newProject(Formats.free || Formats.generic || Object.values(Formats).find(f => f.meshes));
			Project.name = main.name.replace(/\.[^.]*$/, '');
		}
		const undo = {outliner: true, elements: [], selection: true, textures: [], animations: []};
		Undo.initEdit(undo);
		try {
			result = convertScene(root, clips, o, main.name, notes, res);
		} catch (err) {
			Undo.cancelEdit && Undo.cancelEdit();
			throw err;
		}
		Undo.finishEdit('Import 3D model', {outliner: true, elements: result.elements, selection: true, textures: result.textures, animations: result.animations});
		if (typeof Canvas != 'undefined') { Canvas.updateAll && Canvas.updateAll(); }
		result.textures.forEach(t => { try { t.updateMaterial && t.updateMaterial(); } catch (err) { /* later */ } });
		if (typeof updateInterface == 'function') updateInterface();
		if (typeof Animator != 'undefined' && result.animations.length && Animation.all) { /* the animations are in the Animate tab */ }
		Blockbench.showQuickMessage(fill(tr('done'), main.name, result.elements.length, result.bone_count, result.animations.length), 4000);
	} catch (err) {
		console.error('[Import]', err);
		Blockbench.showMessageBox({title: tr('failed'), message: String(err && err.message || err), icon: 'error'});
	} finally {
		Blockbench.setProgress && Blockbench.setProgress(0);
		res.dispose();
	}
	if (notes.length) Blockbench.showMessageBox({title: tr('title'), message: notes.map(n => '• ' + n).join('\n\n'), icon: 'info'});
	return result;
}

// ---------------------------------------------------------------------------

let import_action = null;

if (typeof __IMPORT_EXPORT !== 'undefined') __IMPORT_EXPORT({L, loadModel, convertScene, parseGoldSrc, parseQuake, Resources, mergeQuads, reduceKeys, runImport, hlQuat, TextureBank});

Plugin.register('model_import', {
	title: 'Model import',
	author: 'Claude',
	description: 'Import 3D models with textures, skeleton and animations: OBJ (+MTL), FBX, glTF/GLB, Collada, 3DS, STL, PLY, 3MF, MD2, Half-Life and Quake MDL.',
	about: 'File > Import > **3D model**. Pick the model (and its textures, .mtl or .bin if Blockbench cannot read its folder). The geometry becomes mesh elements, the textures and material colours become textures, a skeleton becomes bone groups (or an armature with vertex weights in Blockbench 5 for smooth skins), and every animation of the file becomes a Blockbench animation. Uses the three.js r129 loaders (MIT).',
	icon: 'file_download',
	version: '0.1.0',
	variant: 'both',
	min_version: '4.10.0',
	tags: ['Import'],
	onload() {
		import_action = new Action('import_3d_model', {
			name: tr('action'), description: tr('action_desc'), icon: 'view_in_ar', category: 'file',
			click() { pickFiles(); },
		});
		try { MenuBar.addAction(import_action, 'file.import'); } catch (err) { MenuBar.addAction(import_action, 'file'); }
	},
	onunload() {
		if (import_action) {
			try { MenuBar.removeAction('file.import.import_3d_model'); } catch (err) { /* not there */ }
			try { MenuBar.removeAction('file.import_3d_model'); } catch (err) { /* not there */ }
			import_action.delete();
			import_action = null;
		}
	},
});

})();
