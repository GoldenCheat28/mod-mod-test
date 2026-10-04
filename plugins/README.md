# Blockbench plugins

Load a plugin with **File → Plugins → Load Plugin from File**.

| File | What it is |
| --- | --- |
| `physics.js` | Physics tab: rigid bodies (Jolt), liquid, force fields, start on impact / break apart, axle, bake to animation |
| `render.js` | Render view: materials, skybox, lights, cameras with lens effects |
| `softbody.js` | Soft body tab: crash deformation of meshes (dents) |
| `rope.js` | Ropes tab: a physical rope mesh between two objects (segments, sides, thickness, slack...), pulls physics bodies |
| `ragdoll.js` | Ragdoll tab: the person of the Blood game ported from its Godot source (humanoid.gd: 15 body parts with the game's shapes and masses, 6DOF joints with motor muscles, balance assist, stumbling, falling, getting up, fainting, bleeding out, head-shot death, held poses on a chair / knees / heels) and its blood (blood.gd, body_blood.gd, blood_tex.gd, blood_splash.gd: drops, sprays, arterial pulses, jets, runs, pools with tongues, floor map, decals, stains on the clothes, drying); also plain ragdolls with reactions, a skeleton pose editor and held items; bakes through the Physics tab (blood is shown live only) |
| `pipe.js` | Connect: join faces of two meshes with a pipe (right click → Connect faces…): smoothing, path, waypoints, going around obstacles |
| `seam.js` | Fillet between intersecting meshes (right click → Seam) |

`physics.js`, `softbody.js`, `pipe.js`, `rope.js` and `ragdoll.js` are built from `src/`: edit `src/<name>.js` and run `node build.js` (the Jolt WebAssembly blob lives in `jolt.b64` and is inlined into `physics.js`).
