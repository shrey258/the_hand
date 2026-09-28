# Handoff — the_hand (2026-09-27, phone-screen session)

**Next session: pick between Frozen and Crash (Shatter is out), then promote the feed story from `proto/feed/` into `src/main.js` and ship `ota-broadcast`.** Everything below was checked this session unless marked *unverified*.

## Where it stands
- Live: https://thehand-iota.vercel.app (Vercel team **shrey258s-projects**, never `not-a-number-labs`). `thehand.vercel.app` is someone else's.
- `main` = `production` = `8a7e39c` (the hand + phone, no OTA). Vercel only deploys `production`; `main` builds previews.
- **Branch `ota-broadcast`**: OTA stages committed (`e0ec18a`, `1007d2c`). **Uncommitted:** the page caption (`index.html`, `src/style.css`, `src/main.js` `drawScreen`), this file, and the whole `proto/feed/` directory.
- **Go live:** `git switch production && git merge main && git push`. Never `vercel deploy --prod`.
- **Dev:** `npm run dev` shows the DialKit panel. Production hides it. Hit **Reset** if the browser shows old saved values (new dials were added this session).

## The feed story (prototype: `proto/feed/`, open `/proto/feed/` on the dev server)
Goal: the hand is the user. They scroll a feed with their thumb, a bug hits, the hand becomes the OTA server and beams a fix, then turns back into the hand, and the user scrolls again.

- `proto/feed/main.js` is a copy of `src/main.js` plus the feed. `proto/feed/screen.js` draws the phone screen. Nothing in `src/` imports them; `vite build` ignores them.
- **Timeline** (`proto/feed/main.js:457`, pinned `T * 200%` = 1400%): grip 0–1 · scroll 1–2.2 · bug 2.2–2.5 · morph 2.6–3.6 · push 3.7–4.7 · server → hand 4.8–5.8 (`ota.back`, plays the morph in reverse) · scroll again 5.8–7.
- **Thumb swipe** (`:261`): the thumb moves onto the screen, then does 3 flicks per scroll stage. The design came from the research below. Dials are in DialKit → Feed:
  - `from`/`to`: the angle range, set by him. Bigger = lower on the screen.
  - `peak`, `curl`, `lag`, `bend`, `distance`, `drag`.
  - Each flick is a cosine bump with zero speed at both ends. The thumb lets go halfway up, at its fastest.
  - The feed follows the thumb while touching, then coasts with an exponential decay. τ is solved by bisection so the speed at release matches. Verified numerically: 3.142 before vs 3.141 after release, and each flick ends exactly `distance` posts on.
  - The joints share the swing: CMC 75%, MCP 25% a little later, and the IP joint flexes more when the thumb is low.
  - All bends are around the view axis (the only one verified to look right from this camera).
- **Paper-white thumb** (`:595`): in the thumb pass the depth hand also writes white, so the screen doesn't show through the sparse lit dots. That was the cause of his "flicker". It's on only while the dots sit on the hand (`progress ≥ 1 && morph ≤ 0`). *Unverified:* whether the fill switching off at morph start / on at the end of the return is noticeable.
- **Screen** (`screen.js`): a white "Feed" app, 16 posts, long names truncated with "…". A shared "Updated to v2.4" pill shows at the end of the push and fades as the hand returns. The caption fades out as the hand returns.
- **Picker**: the verbatim emil-prototype pill; keys `1`–`3`/`←→`, `?v=N`. `window.kit = kit` is exposed for poking values (proto only).

## Decisions
- **Bug look: keep Frozen and Crash, drop Shatter** (his words: "keep both frozen and crash for now"). Not yet decided between the two.
  - **Frozen** (`screen.js:128`): scrim, a 12-spoke spinner that turns with the scroll, "Feed isn't responding"; it clears as the push ends.
  - **Crash** (`:151`): the app shrinks to the home screen and an alert says "Feed quit unexpectedly". It becomes "Installing a fix…" with a progress bar, then the app reopens. It repeats the "Updated" pill; drop one of the two if Crash wins.
  - Rejected: **Shatter** (`:86`): tear, then dots scatter on black, and the waves pull them home.
- **Page scroll drives the feed, and the thumb must visibly swipe**: a thumb sitting still while the feed moves "doesn't make sense".
- **The hand comes back after the broadcast**, and the user scrolls again. Keep a brief "Updated" pill; the old "Updating to v2.4…" card is gone.
- **The caption has to move** (his words). Done so far: it fades out on the return. *Unverified* whether that's what he meant by "move".
- Earlier (still standing): server shape "Through the cloud", link "Broadcast", "no store" message = page caption, waves follow the scroll, `rnd()` sin hash. See git history `d533239`, `e0ec18a` for the rejected options.

## To promote the winner (emil-prototype Phase 7)
1. Write the decision (the winner + the rejected variants) into this file.
2. Port the feed code into `src/`: the `feed` dials, the thumb block, the `pose` MCP/IP swings, the timeline, the white thumb pass, `screen.js` minus the losing variants, and the extra caption fade. Drop `window.kit` and the picker.
3. Delete `proto/feed/`, then grep for `proto` and `picker` to confirm nothing is left.
4. Then the existing ship list: reduced motion is *unverified* (the lights freeze; the waves and thumb still scrub), and so are portrait phones (under 700px the caption moves above the phone). Merge to `main`, then `production`.

## Running things (die with this machine; restart as needed)
- A dev server on port 5199 (`npx vite --port 5199`) and a cloudflared quick tunnel (`cloudflared tunnel --url http://localhost:5199 --http-host-header localhost:5199`). The URL changes on every restart. He shared one to ask for opinions.
- A debug Chrome on CDP port 9222 (profile in `/private/tmp/claude-501/chrome-proto`). Screenshot helpers are in `/private/tmp/claude-501/`: `shot.mjs <v> <amount…>`, `poke.mjs`, `flick.sh`, `strip.sh`. Temp dir: *unverified* whether they survive.

## Posting (in progress, unchanged)
- Video recorded (14s loop, 1:1, 1080p, Cursorful). *Unverified* whether it's posted.
- Credit: "iPhone 16 by Wes, sketchfab.com/wimell". No X handle; don't guess one.
- Thread plan: reply 1 = what + link, 2 = fingertip story, 3 = DialKit shoutout (**verify Josh Puckett's X handle first**).
- Not done: `og:`/`twitter:` meta and a preview image.

## Learning tracker
Goal: be able to rebuild this without AI. Docs are allowed; AI only for hints (where to look → the idea → one line max, never full code). State a time guess before each step. At session start, remind him what's unchecked. **Time guess this session: 30 min; actual: much longer** (the thumb alone took several rounds).

Walkthrough (`src/main.js`):
- [x] Renderer, camera, `apply()`. **Lights: revisit** (key = one direction for shape; fill stops the dark side going black).
- [ ] Standing the hand up (basis from up/across/normal).
- [ ] `swing()` + `pose()`: why `sub(pivot)` → rotate → `add(pivot)`; why each bone needs a position and a quaternion change.
- [ ] `subdivide.js` (check: `node src/subdivide.test.js`).
- [ ] The thumb pass (after pass 2 the depth buffer holds only the phone).
- [ ] Scroll: `gsap.to` + `onUpdate` → `kit.setValue`; px per unit; what breaks without `pin`.
- [ ] Invisible hand: `colorWrite: false` + `polygonOffset`. (This session turned `colorWrite` on for the thumb pass; see why above.)
- [ ] Dot shader: `mix(drift, home, k)`, `gather`/`land`, the near-plane trick, the dither `discard`.
- [ ] Dot size rounded to whole device pixels.
- [ ] Sampling: cumulative triangle areas + binary search; why fold `u + v > 1`.
- [ ] Thumb split + skinned points: `isSkinnedMesh`, layer 2, `mesh.add(pts)`.
- [ ] Phone centring: `setViewOffset` vs moving the camera.
- [ ] Easing: grip ease-in-out vs phone ease-out.
- [ ] Render loop: `dirty` and reduced motion.
- [ ] Wave maths: `push * trips - ring / count` + `fract`.
- [ ] Why the server's dots skip the depth test; the server spots and the "spare" couriers.
- [ ] **New:** the flick maths in `proto/feed/main.js:261`: why a cosine bump has zero speed at both ends, why releasing mid-rise makes a flick, and how bisection finds τ.

## Known loose ends
- The knuckles may tear when bent hard (`ponytail:` comment); the skinned points rely on three internals (`isSkinnedMesh`).
- Portrait phones: the hand and server may be cut off. *Unverified.*
- The fingers pass through the phone in 3D; the occlusion only works from this fixed camera.
- Research used for the thumb: https://arxiv.org/pdf/2102.07459 (minimum jerk), https://pmc.ncbi.nlm.nih.gov/articles/PMC12649530/ and https://www.sciencedirect.com/science/article/am/pii/S0003687016301156 (thumb joint angles while swiping).

## Suggested skills
- `own-the-decision`: first. Frozen vs Crash is his call; get a time guess.
- `emil-prototype`: `keep <variant>` to write the decision, promote it and delete the harness.
- `emil-animations`: when porting, keep the minimum-jerk, zero-speed-at-both-ends rule for any new motion.
- `ponytail:ponytail`: keep the port small; don't carry the picker or the losing variants into `src/`.
