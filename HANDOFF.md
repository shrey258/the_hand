# Handoff — the_hand (2026-09-27, OTA session)

**Next session: design the phone screen (the update card is a placeholder), then ship `ota-broadcast`.** Everything below was checked this session unless marked *unverified*.

## Where it stands
- Live: https://thehand-iota.vercel.app (Vercel team **shrey258s-projects**, never `not-a-number-labs`). `thehand.vercel.app` is someone else's.
- `main` = `production` = `8a7e39c` (the hand + phone, no OTA). Vercel only deploys `production`; `main` builds previews.
- **Branch `ota-broadcast`** (pushed) holds this session's work: the OTA stages are in `src/main.js`. The prototype and its picker are deleted. Not merged to `main`, not live.
- **Go live:** `git switch production && git merge main && git push`. Never `vercel deploy --prod`.
- **Dev:** `npm run dev` shows the DialKit panel. Production hides it and uses the code defaults. Hit **Reset** if the browser shows old saved values.

## The OTA story (on `ota-broadcast`)
The goal: after the phone reaches the customer, the hand turns into our OTA server, which pushes an update to the phone.

Line numbers are `src/main.js` on `ota-broadcast`. The scroll is now pinned for 670% (`amount` 0 → 3.35, `:434`):

| Scroll `amount` | Stage | DialKit value |
|---|---|---|
| 0 – 1 | Grip, as before | `grip.amount` |
| 1 – 1.25 | Hold on the lit screen | — |
| 1.25 – 2.25 | Hand → cloud → server | `ota.morph` |
| 2.35 – 3.35 | Server broadcasts to the phone | `ota.push` |

- **Server shape** (`serverSampler()`, `:586`): the classic server glyph, three stacked slabs with lights and slots. Only the faces the camera sees are sampled (front, top, left), so the server's dots skip the depth test.
- **Morph** (`:83`): the dots dissolve back into the opening cloud, then condense into the server.
- **Broadcast** (`:92–120`): the server's spare dots (the 80% its `keep` test hides) become Wi-Fi arcs.
  - Waves are **scroll-driven**: scrolling down sends them one at a time, scrolling up pulls them back.
  - Each wave eases out, starts thick and thins as it spreads, and fades into the phone's right edge.
  - They go quiet at 85–95% of the push, when the card switches to "Updated".
- **Phone screen** (`drawScreen`, `:287`): an "Updating to v2.4…" card with a progress bar that follows the push, then "Updated to v2.4 / Over the air, just now". **Placeholder**: the phone design is his to do later.
- **Knobs:** DialKit → Ota: server `x/y/z/scale/yaw`, `ink`, `keep`, and `waves` → `trips/count/spread/weight`.

## Decisions (from the picker rounds)
- **Server shape + morph: "Through the cloud"** (icon slabs, via the cloud).
  - Rejected: **Rack** (a straight morph into a 19" cabinet; reads instantly but looks like stock art). **Assembly line** (fingertips peel off and build a tower bottom-up; busy, and a blob mid-way).
- **Link to the phone: Broadcast.** It "serves the idea better" than the others.
  - Rejected: **Cable** (a wire contradicts "over the air"). **Pour** (dots stream into the screen; busiest, and it hides the phone's top edge).
- **Waves follow the scroll, not a clock.** Time-driven waves were tried and rejected: he likes that scrolling up "takes back the waves".
- **Waves need energy.** The first version had gaps in the arcs; the cause was correlated `fract(u * constant)` hashes. Fixed with `rnd()` (`:66`), a sin hash. Never derive several random values from one number by multiplying it by constants.

## Before shipping `ota-broadcast`
1. **Design the phone screen.** `drawScreen` is a placeholder card (`ponytail:` comment).
2. ~~Render loop never idles~~ **Done:** the server's lights tick at 8 fps, so a resting page draws ~8 frames/s instead of 120 (measured). Full frame rate only while scrolling, the cloud drifting, or the morph running.
3. Reduced motion: the lights freeze and the waves still scrub with the scroll. *Unverified* whether that's acceptable.
4. Ship: merge `ota-broadcast` into `main`, then `production` (see "Go live").

## Posting (in progress)
- The video was recorded: a 14s loop down and back up, 1:1, exported at 1080p max quality in Cursorful. *Unverified* whether it's been posted.
- Caption direction: an Endgame re-release tie-in, e.g. "For the Endgame re-release, I made the snap in reverse". *Unverified:* re-release timing.
- **Credit:** "iPhone 16 by Wes, sketchfab.com/wimell". He has no X account linked or findable, so don't guess a handle.
- Thread plan: reply 1 = what it is + link, reply 2 = fingertip story, reply 3 = DialKit shoutout (**verify Josh Puckett's X handle before tagging**).
- **Not done:** `og:`/`twitter:` meta tags and a preview image, so an X link shows as a bare URL. Offered; he hasn't decided.

## Learning tracker
Goal: be able to rebuild this without AI. Docs are allowed; AI only for hints (where to look → the idea → one line max, never full code). State a time guess before each step. At session start, remind him what's unchecked here before building.

Walkthrough (`src/main.js`, line numbers as of `8a7e39c`):
- [x] Renderer, camera, noise texture (since deleted), `apply()`. **Lights still not understood — revisit** (key = sun, one direction, gives shape; fill = sky/ground, stops the dark side going black).
- [ ] Standing the hand up (basis from up/across/normal).
- [ ] `swing()` + `pose()`. Open questions:
  1. Why `sub(pivot)` → rotate → `add(pivot)`?
  2. Why does each bone need both a position and a quaternion change?
- [ ] `subdivide.js` (check: `node src/subdivide.test.js`).
- [ ] The thumb pass: why it works (after pass 2 the depth buffer holds only the phone).

**Unread since the GSAP change. He asked to be told to read these.**
- [ ] Scroll (310–320): `gsap.to` on a plain object + `onUpdate` → `kit.setValue`. How many px from 0 to 1 on a 700px window? What breaks without `pin: true`?
- [ ] Invisible hand (32): `colorWrite: false` + `polygonOffset`. Why does the hand still need to exist?
- [ ] Dot shader (48–97): `mix(drift, home, k)`, the two-stage `gather`/`land`, the near-plane trick and its 5 mm cutoff, the dither `discard`.
- [ ] Dot uniforms (~180): why the size is rounded to whole device pixels.
- [ ] Sampling (323–358): cumulative triangle areas + binary search. Why fold `u + v > 1`?
- [ ] Thumb split + skinned points (359–388): `isSkinnedMesh`, layer 2, why `mesh.add(pts)`.
- [ ] Phone centring (155–160): `setViewOffset` vs moving the camera.
- [ ] Easing (~171): why the grip is ease-in-out but the phone is ease-out.
- [ ] Render loop (400–418): the `dirty` flag and the reduced-motion check.

**New this session (`src/main.js` on `ota-broadcast`), unread:**
- [ ] The wave maths (`:100–120`): how `push * trips - ring / count` + `fract` makes waves leave one at a time and reverse on scroll-up.
- [ ] Why the server's dots can skip the depth test (only camera-facing faces are sampled).
- [ ] Giving each dot a server spot (`:512`), and why the couriers are "spare" dots.

## Known loose ends
- The phone's shadow on the hand is gone (shadows removed for perf).
- The knuckles may tear when bent hard: each dot copies its nearest corner's bone weights (`ponytail:` comment).
- The skinned points rely on three.js internals (`isSkinnedMesh` flag). Recheck after upgrading three.
- Portrait phones: the hand sits right of the centred phone and may be cut off. *Unverified.* The server sits further right still, so this is worse now.
- The fingers pass through the phone in 3D; the occlusion is a render trick that only works from this fixed camera.
- Once the hand becomes the server, the phone floats on its own. Intended for now.

## Suggested skills
- `own-the-decision`: first. Get his goal for the phone screen and a time guess.
- `emil-prototype`: for the phone screen, if he's undecided what it should show.
