# Handoff — the_hand (2026-09-25, updated after phase 3)

## Where it stands
- Live: https://thehand-iota.vercel.app (Vercel team **shrey258s-projects**, never `not-a-number-labs`). `thehand.vercel.app` is someone else's.
- **Branches:** Vercel's production branch is now `production` (still @ `2f93826`, the pre-phone version). `main` @ `70293eb` has the phone work and only builds previews.
- **Go live:** `git switch production && git merge main && git push`. Don't use `vercel deploy --prod` any more; it ships the local folder to the live site from whatever branch you're on.
- **Dev:** `npm run dev` shows the DialKit panel + Reset. Production hides it and doesn't persist values.
  - Code defaults = your last Copy paste. Hit **Reset** if the browser shows old saved values.
- The `productionEnabled: false` from the last commit had hidden the panel in dev too. It's now `import.meta.env.DEV`.

## What was built (phase 1 + 2, ~1h50 total)
- Rigged WebXR "generic-hand" right.glb, stood upright palm-to-camera by measuring up/across/palm-normal and rotating the model.
- Grey grainy skin: `MeshStandardMaterial` + random-noise bump map.
- Round fingertips: `src/subdivide.js` splits every triangle into 4 and lifts new vertices onto the curve using normals (PN-triangle midpoint). Check: `node src/subdivide.test.js`.
- Drag to phone grip: `pose()` = spread → per-joint curl → wrist roll; drag samples the middle fingertip's screen arc and follows the mouse. `squeeze` closes the finger fan relative to the middle finger (`fanRest`).

## Phase 3: phone in the hand (~1h40, guessed 30 min)
- **Model:** `public/models/iphone.glb`, iPhone 16 by Wes (sketchfab.com/wimell).
  - License is Sketchfab Standard: **credit him when posting**.
  - Modelled in cm, so scaled by 0.01.
- **Screen:** node `Object_18` (three names meshes by node; the glTF mesh is `Object_3`).
  - A `<canvas>` is its `emissiveMap`. Draw on the canvas to change what shows.
  - Its UVs only span u 0.018–0.48 and run top-down, so the texture uses `repeat`/`offset` plus `flipY = false`.
- **Placement:** the phone lives in world space, tuned for grip = 1 with the Phone x/y/z sliders.
  - `drop` lifts it by `drop × (1 − amount)`, so the same drag brings it down from above.
- **Grip:** intermediate and distal are now per finger (`grip.intermediate[finger]`, `grip.distal[finger]`). Proximal is still shared.
- **Occlusion is a render trick, not collision.** Three passes each frame:
  1. Hand.
  2. Clear depth, then draw the phone (layer 1) on top.
  3. The hand again with `thumbOnly = 1`: the shader discards pixels not mostly skinned to thumb bones (skin indices 1–4), depth-tested against the phone.
  - Only correct from this fixed camera (`ponytail:` comment).
  - The white background is `setClearColor`, not `scene.background`, because a background would repaint over pass 1.
- **Shadow:** the key light casts, the phone casts, the hand receives. The shadow camera also sees layer 1.
  - `PCFSoftShadowMap` is removed in this three version, so it uses `PCFShadowMap` + `radius`.

## Phase 4: scroll + dots (branch `dither-dots`)
- **Scroll drives the grip** (`d7d2c81` on main): GSAP ScrollTrigger pins `#app` for 200% of the window height and scrubs `grip.amount` 0 → 1 via `kit.setValue`. The mouse drag is gone; the default amount is 0.
- **The hand is dots**, like vellabs' `docs/MOTION.md:195`: each dot has a cloud spot and a home on the skin, blended per dot by scroll with its own start time (`seed`, `travel`).
  - Homes are area-weighted random points on the skin. Each borrows the nearest corner's bone weights, so it rides the grip (`ponytail:` comment: knuckles may tear).
  - `Points` borrows the hand's skeleton via `isSkinnedMesh` (three internals, recheck after upgrades).
  - The real hand only writes depth (`colorWrite: false`), so back-side dots stay hidden. Dots still in flight are forced to the near plane so the invisible hand doesn't cut a hole in the cloud.
  - Dither: lit skin drops dots (`shade`); cloud dots are pale (`cloudInk`) and darken as they land. The Count slider sets the draw range of 500k pre-sampled dots.
- **Phone centred** with `camera.setViewOffset` (a shift lens). Moving the camera instead changed the viewing angle and broke the grip look.
- Lost: the phone's shadow on the hand. The Skin colour/roughness/grain/wireframe sliders now do nothing.

## Posting (not done yet)
- Thread under the video post: reply 1 = what it is + link, reply 2 = fingertip story, reply 3 = DialKit shoutout. **Verify Josh Puckett's X handle before tagging.**

## Learning — pick up here tomorrow
Goal: be able to rebuild this without AI. Docs allowed; AI only for hints (where to look → the idea → one line max, never full code). State a time guess before each step.

Walkthrough progress (`src/main.js`):
- [x] Part 1 (8–22): devicePixelRatio, domElement, camera fov/near/far (units = metres). **Lights not yet understood — revisit** (key = sun, one direction, gives shape; fill = sky above/ground below, stops the dark side going black; try Fill = 0).
- [x] Part 2 (24–42): noise texture + bump map (fakes dents via light, outline unchanged).
- [x] Part 3 (74–97): `apply()` = "make the scene match these values"; called by DialKit subscribe, after load, and via drag → setValue.
- [ ] Part 4 (111–126): standing the hand up (basis from up/across/normal).
- [ ] Part 5 (134–180): `swing()` + `pose()`. Unanswered questions:
  1. Why `sub(pivot)` → rotate → `add(pivot)`? What breaks without it?
  2. Why does each bone need both a position and a quaternion change?
- [ ] Part 6 (181–210): drag along the arc.
- [ ] `subdivide.js`.
- [ ] Phase 3: why the thumb pass works (depth buffer after pass 2 holds only the phone). Try deleting `renderer.clearDepth()` and predict what breaks first.

**Unread since the GSAP change (phase 4). Read these before building anything new.** Line numbers are as of `820ec0d`.
- [ ] Scroll (320–330): `gsap.to` on a plain object + `onUpdate` → `kit.setValue`. Predict: with `end: '+=200%'` on a 700px window, how many px from 0 to 1? What breaks without `pin: true`?
- [ ] Invisible hand (58): `colorWrite: false` + `polygonOffset`. Why does the hand still need to exist?
- [ ] Dot shader (72–117): `mix(drift, home, k)`, the per-dot `start`/`smoothstep`, the `-0.999 * w` near-plane trick, the dither `discard`. Predict what 50% scroll looks like without the near-plane line.
- [ ] Dot uniforms in `apply()` (190–197): why the size is rounded to whole device pixels.
- [ ] Sampling (333–367): cumulative triangle areas + binary search = even spread. Why fold `u + v > 1`?
- [ ] Skinned points (369–376): borrowing the skeleton via `isSkinnedMesh`, and why `mesh.add(dots)`.
- [ ] Phone centring (166–174): `setViewOffset` vs moving the camera. Why did moving the camera change the grip?
- [ ] Render loop (389–): reduced-motion check.
- [ ] Perf pass (uncommitted, 64 → 120 FPS): pixel-ratio cap, shadows deleted, `MeshBasicMaterial` depth hand, thumb dots split onto layer 2 (`split()`), `dirty` flag in the render loop. Why does the thumb pass now use `camera.layers.set(2)`?
- [ ] Easing (uncommitted): `easeOut` in `apply()` for the grip and the phone (`phone.land`), the screen lighting up (`phone.screenOn`), and the two-stage `gather`/`land` in the dot shader. Why did the grip end up ease-in-out while the phone is ease-out?
