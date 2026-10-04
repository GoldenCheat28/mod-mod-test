# Blockbench plugins

Load a plugin with **File → Plugins → Load Plugin from File**.

| File | What it is |
| --- | --- |
| `physics.js` | Physics tab: rigid bodies (Jolt), liquid, force fields, start on impact / break apart, axle, bake to animation |
| `render.js` | Render view: materials, skybox, lights, cameras with lens effects |
| `softbody.js` | Soft body tab: crash deformation of meshes (dents) |
| `rope.js` | Ropes tab: a physical rope mesh between two objects (segments, sides, thickness, slack...), pulls physics bodies |
| `pipe.js` | Connect: join faces of two meshes with a pipe (right click → Connect faces…): smoothing, path, waypoints, going around obstacles |
| `seam.js` | Fillet between intersecting meshes (right click → Seam) |

`physics.js`, `softbody.js`, `pipe.js` and `rope.js` are built from `src/`: edit `src/<name>.js` and run `node build.js` (the Jolt WebAssembly blob lives in `jolt.b64` and is inlined into `physics.js`).
