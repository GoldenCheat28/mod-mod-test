# Blockbench plugins

Load a plugin with **File → Plugins → Load Plugin from File**.

| File | What it is |
| --- | --- |
| `physics.js` | Physics tab: rigid bodies (Jolt), liquid, force fields, start on impact / break apart, axle, bake to animation |
| `render.js` | Render view: materials, skybox, lights, cameras with lens effects |
| `softbody.js` | Soft body tab: crash deformation of meshes (dents) |
| `seam.js` | Fillet between intersecting meshes (right click → Seam) |

`physics.js` and `softbody.js` are built from `src/`: edit `src/<name>.js` and run `node build.js` (the Jolt WebAssembly blob lives in `jolt.b64` and is inlined into `physics.js`).
