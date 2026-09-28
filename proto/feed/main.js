import '../../src/style.css'
import 'dialkit/vanilla/styles.css'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { createDialKit, createDialRoot } from 'dialkit/vanilla'
import { subdivide } from '../../src/subdivide.js'
import { drawScreen as paint, W as SW, H as SH } from './screen.js'

const renderer = new THREE.WebGLRenderer({ antialias: true })
// Capped at 1.5: at 2× a Retina screen draws 4.1M pixels a frame for a 1280×800 window, at 1.5× 2.3M.
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.setSize(innerWidth, innerHeight)
document.querySelector('#app').appendChild(renderer.domElement)
renderer.domElement.setAttribute('role', 'img')
renderer.domElement.setAttribute('aria-label', 'A hand made of dots scrolls a feed on a phone. The feed freezes, the hand turns into a server, and the fix arrives over the air.')

const scene = new THREE.Scene()
renderer.setClearColor('#ffffff') // not scene.background: that would repaint over the hand in the phone pass

// Eye level, straight on. Units are metres: the hand is ~0.19 tall.
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 10)

// Key light at an angle; dim sky/ground fill so the shadow side isn't black. They light the phone;
// the dots only read the key's direction for their dither.
const key = new THREE.DirectionalLight('#ffffff')
const fill = new THREE.HemisphereLight('#ffffff', '#666666')
scene.add(key, fill)
key.layers.enable(1) // layer 1 = the phone, drawn in its own pass (see the render loop)
fill.layers.enable(1)

// The hand itself is never seen: it only writes depth, so dots on the far side of it stay hidden.
// polygonOffset pushes that depth back a hair so dots lying exactly on the surface don't flicker.
const skin = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })

// thumbOnly = 1 draws just the thumb: pixels mostly skinned to thumb bones (skin indices 1–4 in right.glb).
// The render loop uses it to draw the thumb over the phone while the four fingers stay behind it.
const thumbOnly = { value: 0 }
skin.onBeforeCompile = (shader) => {
  shader.uniforms.thumbOnly = thumbOnly
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'varying float vThumb;\nvoid main() {')
    .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvThumb = dot(skinWeight, step(0.5, skinIndex) * step(skinIndex, vec4(4.5)));')
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float thumbOnly;\nvarying float vThumb;\nvoid main() {\nif (thumbOnly > 0.5 && vThumb < 0.5) discard;')
}

// Dots: each has a home on the skin (skinned like the hand, so it rides the grip) and a spot in a
// floating cloud. Each dot sets off at its own time (seed) and takes `travel` of the scroll to arrive.
const dotsMat = new THREE.ShaderMaterial({
  uniforms: {
    progress: { value: 0 }, travel: { value: 0.4 }, time: { value: 0 }, size: { value: 2 },
    cloudSize: { value: 0.3 }, gather: { value: 0.6 }, cloudInk: { value: 0.3 }, shade: { value: 0.7 }, color: { value: new THREE.Color() },
    lightDir: { value: key.position }, thumbOnly,
    morph: { value: 0 }, blink: { value: 0 }, serverAt: { value: new THREE.Vector3() }, serverScale: { value: 1 }, serverYaw: { value: 0 }, serverInk: { value: 0.5 }, serverKeep: { value: 0.4 }, push: { value: 0 }, waveSpeed: { value: 2 }, waveCount: { value: 3 }, waveSpread: { value: 1.4 }, waveInk: { value: 0.6 }, phoneAt: { value: new THREE.Vector3() },
  },
  vertexShader: `
    #include <common>
    #include <skinning_pars_vertex>
    uniform float progress, travel, time, size, cloudSize, gather, morph, serverScale, serverYaw, serverInk, serverKeep, push, waveSpeed, waveCount, waveSpread, waveInk;
    uniform vec3 serverAt, phoneAt;
    uniform vec3 lightDir;
    attribute vec3 cloud;
    attribute float seed, led;
    attribute vec3 server, serverN;
    varying float vLit, vSeed, vThumb, vK, vM, vInk, vLed, vKeep, vLink, vCourierRnd;
    // Real hash: fract(u * constant) lines up into patterns, which left gaps in the arcs.
    float rnd(float u, float k) { return fract(sin(u * 91.345 + k * 47.853) * 43758.5453); }
    float io(float x) { x = clamp(x, 0.0, 1.0); return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0; }
    void main() {
      #include <skinbase_vertex>
      #include <beginnormal_vertex>
      #include <skinnormal_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      vThumb = dot(skinWeight, step(0.5, skinIndex) * step(skinIndex, vec4(4.5)));
      vec3 home = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vec3 drift = cloud * cloudSize + 0.01 * sin(time * 0.6 + seed * 50.0 + vec3(0.0, 2.0, 4.0));
      // Two stages, like vellabs: the whole cloud drifts gather of the way in across the scroll, and each
      // dot lands the rest of the way in its own window, easing out so it settles rather than stops.
      float start = seed * (1.0 - travel);
      float land = 1.0 - pow(1.0 - clamp((progress - start) / travel, 0.0, 1.0), 3.0);
      float k = mix(gather * progress, 1.0, land);
      vec3 pos = mix(drift, home, k);
      // OTA morph: hand → server. m = how far this dot is along its trip to the server.
      float m = 0.0, away = 0.0;
      mat3 yaw = mat3(cos(serverYaw), 0.0, -sin(serverYaw), 0.0, 1.0, 0.0, sin(serverYaw), 0.0, cos(serverYaw));
      vec3 server = serverAt + yaw * server * serverScale;
      vec3 srvN = yaw * serverN;
      // The hand dissolves back into the opening cloud, then the cloud condenses into the server.
      away = io((morph - seed * 0.25) / 0.3);
      m = io((morph - 0.5 - seed * 0.2) / 0.3);
      pos = mix(mix(pos, drift, away), server, m);
      // Link: the server's spare dots (the ones its keep test hides) carry the update to the phone.
      // vLink = share of them drawn; 0 = not a courier right now.
      vLink = 0.0;
      float h = fract(seed * 13.7), u = (h - serverKeep) / 0.1;
      if (u > 0.0 && u < 1.0 && m > 0.999 && push > 0.0) {
        vec3 port = serverAt + yaw * vec3(-0.07, 0.0, 0.0) * serverScale; // left edge of the middle slab
        // Couriers are picked by a narrow band of seed, so their randomness comes from u (which spans 0–1 finely).
        vCourierRnd = rnd(u, 4.0);
        // Broadcast: arcs ripple out of the server toward the phone.
        // Waves ride the scroll: scrolling down sends them, scrolling up pulls them back into the server.
        // Each wave grows from the server until it touches the phone's edge, then fades into it.
        vec3 dock = phoneAt + vec3(0.037, 0.0, 0.0); // the phone's right edge
        vec2 aim = normalize(dock.xy - port.xy);
        float ring = floor(rnd(u, 5.0) * waveCount);
        float sent = push * waveSpeed - ring / waveCount; // waves leave one at a time, not all at once
        float r = sent < 0.0 ? 0.0 : fract(sent); // 0 at the server → 1 at the phone
        float a = (rnd(u, 6.0) - 0.5) * waveSpread;
        vec2 d = vec2(aim.x * cos(a) - aim.y * sin(a), aim.x * sin(a) + aim.y * cos(a));
        // Ease-out: each wave bursts off the server and slows as it reaches the phone. It's born thick and
        // thins as it spreads, like energy spending itself. Two hashes averaged give the stroke soft edges.
        float e = 1.0 - (1.0 - r) * (1.0 - r);
        float radius = mix(0.012, distance(dock.xy, port.xy), e) + (rnd(u, 7.0) + rnd(u, 8.0) - 1.0) * mix(0.005, 0.0015, e);
        pos = vec3(port.xy + d * radius, mix(port.z, dock.z, r));
        float tips = 1.0 - smoothstep(0.55, 1.0, abs(a) / (0.5 * waveSpread)); // arcs taper at their ends
        float life = smoothstep(0.0, 0.05, r) * (1.0 - smoothstep(0.8, 1.0, r)); // pop out, then sink into the phone
        float on = smoothstep(0.0, 0.08, push) * (1.0 - smoothstep(0.85, 0.95, push)); // silent once installed (the card reads "Updated" from 0.95)
        vLink = waveInk * tips * life * on * mix(0.3, 1.0, e); // longer arcs spend more of their dots, so the ink stays even
        if (vLink <= 0.0) vLink = -1.0; // moved off the server but not drawn: hide it, don't fall back to server shading
      }
      gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
      // Far from home: draw in front of everything, or the invisible hand would cut a hand-shaped hole in the
      // cloud. Within 5 mm, depth-test like a landed dot, or dots behind the hand show through and the hand
      // goes dark just before the grip, then pops lighter as they land.
      // Server dots never depth-test: only its camera-facing faces are sampled, so nothing needs hiding.
      if (distance(pos, home) > 0.005 || m > 0.0) gl_Position.z = -0.999 * gl_Position.w;
      gl_PointSize = size;
      vLit = (1.0 - m) * k * (1.0 - away) * max(dot(normalize(mat3(modelMatrix) * objectNormal), normalize(lightDir)), 0.0);
      // Server dots skip the lit dither: they keep a share (keep) of their dots, fewer on faces turned to the light.
      vKeep = mix(1.0, serverKeep * (1.0 - serverInk * max(dot(srvN, normalize(lightDir)), 0.0)), m);
      vM = max(m, away);
      vInk = max(mix(k, 0.0, away), m);
      vLed = m > 0.999 ? led : 0.0;
      vSeed = fract(seed * 97.0);
      vK = k;
    }`,
  fragmentShader: `
    uniform float shade, thumbOnly, cloudInk, blink;
    uniform vec3 color;
    varying float vLit, vSeed, vThumb, vK, vM, vInk, vLed, vKeep, vLink, vCourierRnd;
    void main() {
      if (thumbOnly > 0.5 && (vThumb < 0.5 || vK < 1.0 || vM > 0.0)) discard; // over the phone: only thumb dots that have landed
      if (vLink < 0.0) discard; // couriers first: one may have been paired with an LED spot
      if (vLink > 0.0) { // a courier: its own density, no lighting
        if (vCourierRnd > vLink) discard;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
        return;
      }
      if (vLed > 0.0) { // status LEDs: solid, blinking at their own phase
        if (fract(blink * 0.7 + vLed) > 0.55) discard;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
        return;
      }
      if (fract(vSeed * 13.7) > vKeep) discard;
      if (vLit * shade > vSeed) discard; // dither: lit skin keeps fewer dots, shadowed skin keeps them all
      gl_FragColor = vec4(mix(vec3(1.0), color, mix(cloudInk, 1.0, vInk)), 1.0); // cloud is pale grey, ink as it lands
      #include <colorspace_fragment>
    }`,
})

// Settled values, out of the panel. Angles are degrees.
const fixed = {
  camera: { distance: 0.5, height: 0, fov: 35 },
  light: { azimuth: 45, elevation: 45, intensity: 3.5, fill: 0.35 },
  // Around the palm normal; positive swings toward the pinky side.
  spread: { thumb: -14, index: -5, middle: 0, ring: 3, pinky: 8 },
  // What each joint reaches at grip amount 1. Middle and fingertip joints are per finger, so each tip lands on the phone's edge.
  // squeeze: how much the gaps between fingers close (0 = open fan, 1 = parallel, >1 = tips lean in), easing in from squeezeFrom.
  grip: {
    roll: 85, proximal: 35,
    intermediate: { index: 10, middle: 35, ring: 29, pinky: 10 },
    distal: { index: 49, middle: 20, ring: 21, pinky: 22 },
    squeeze: 1.3, squeezeFrom: 0.85,
  },
  dots: { color: '#000000', size: 1, cloud: 1, cloudInk: 0.3, travel: 0.87, gather: 0.98, shade: 1 },
  // Phone sits in world space, placed for the end state (grip amount 1). Position in metres.
  // drop: how far above its resting spot it starts (0.3 clears the top of the frame). land: grip amount at which
  // it lands, so it arrives before the fingers close. screenOn: the screen lights up over this last stretch.
  phone: { x: -0.106, y: -0.049, z: 0.027, drop: 0.3, land: 0.8, screenOn: 0.92 },
}

// Every tweakable number lives here. Sliders are [default, min, max, step].
// "Copy" in the panel's version menu gives you the values to paste back as new defaults.
createDialRoot({ position: 'top-right', productionEnabled: import.meta.env.DEV }) // panel only in dev (false hides it everywhere)
const kit = createDialKit('Hand', {
  reset: { type: 'action' },
  // Grip = the "about to hold a phone" pose. Amount 0 is open, 1 is fully closed; scrolling sets it.
  grip: { amount: [0, 0, 1, 0.01] },
  // The feed on the phone. scroll: flicks progress, 0–1, before the bug.
  feed: { scroll: [0, 0, 1, 0.01], bug: [0, 0, 1, 0.01], flicks: [3, 1, 6, 1], // The thumb's angle while scrolling, in degrees (bigger = lower on the screen): each flick drags from → to.
    from: [41, -30, 90, 1], to: [19, -30, 90, 1],
    peak: [0.45, 0.2, 0.8, 0.01], // share of a flick spent rising to `to`; the thumb lets go halfway up
    bend: [25, -60, 60, 1], // tip curl while the thumb is in the air, on its way back
    curl: [20, -60, 60, 1], // tip joint flexes this much more when the thumb is low (studies: ~6° high, ~40° low)
    lag: [0.05, 0, 0.2, 0.01], // how far the outer joints trail the base joint, as a share of a flick
    // Momentum: posts moved per flick, and the share of that moved while the thumb touches the glass.
    distance: [1.5, 0.5, 3, 0.05], drag: [0.3, 0.05, 0.9, 0.01] },
  // OTA: after the grip, scrolling on morphs the hand's dots into our update server, which then broadcasts to the phone.
  ota: {
    morph: [0, 0, 1, 0.01],
    push: [0, 0, 1, 0.01], // the update travelling server → phone; scroll sets it
    // Broadcast waves: trips each wave makes over the push, how many in flight, the arc's angle, and its ink.
    waves: { trips: [2, 0.5, 6, 0.1], count: [3, 1, 6, 1], spread: [80, 20, 160, 1], weight: [0.6, 0.05, 1, 0.01] }, // weight: share of wave dots drawn
    x: [0.03, -0.2, 0.2, 0.001], y: [-0.07, -0.2, 0.2, 0.001], z: [0, -0.2, 0.2, 0.001], scale: [0.55, 0.2, 2, 0.01],
    yaw: [20, -90, 90, 1], ink: [0.6, 0, 1, 0.01], keep: [0.2, 0.05, 1, 0.01], // keep: share of dots the server shows; ink: how much the lit faces fade
  },
},{ id: 'hand', persist: import.meta.env.DEV, onAction: (path) => path === 'reset' && kit.resetValues() })

// Phone: iPhone 16 by Wes (sketchfab.com/wimell). Modelled in cm, so scale to metres.
const phone = new THREE.Group()
scene.add(phone)

let pose = () => {} // replaced once the model has loaded
let dirty = true // something changed since the last frame was drawn
let glass = null // the phone's display, once loaded
let screenState = { scroll: 0, bug: 0, fix: 0, spin: 0 }

function apply(v) {
  v = { ...v, ...fixed, grip: { ...v.grip, ...fixed.grip } } // fixed wins over any old saved panel values
  camera.position.set(0, v.camera.height, v.camera.distance)
  camera.fov = v.camera.fov
  camera.clearViewOffset()
  camera.updateMatrixWorld()
  // Centre the phone's resting spot by sliding the frame (a shift lens), not by moving the camera,
  // which would change the angle we see the grip from.
  const c = new THREE.Vector3(v.phone.x, v.phone.y, v.phone.z).project(camera)
  camera.setViewOffset(innerWidth, innerHeight, (c.x * innerWidth) / 2, (-c.y * innerHeight) / 2, innerWidth, innerHeight)

  const az = THREE.MathUtils.degToRad(v.light.azimuth)
  const el = THREE.MathUtils.degToRad(v.light.elevation)
  key.position.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
  key.intensity = v.light.intensity
  fill.intensity = v.light.fill

  // Ease-in-out for the hand: it starts turning gently and brakes onto the phone, like a real grip.
  // The phone keeps ease-out, since it is arriving from off-screen.
  const easeOut = (x) => 1 - (1 - x) ** 3
  const easeInOut = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)
  const t = v.grip.amount
  // Thumb swipe. Over feed.scroll: the thumb moves onto the screen (first 15%), then flicks.
  // Every curve here has zero speed where it starts and stops, so nothing jerks (minimum-jerk motion).
  const F = v.feed, P = F.peak
  const seg = (x) => THREE.MathUtils.clamp((x - 0.15) / 0.85, 0, 1) * F.flicks
  const sc = F.scroll, f = seg(sc)
  // Height of the thumb through a flick, 0 (at `from`) → 1 (at `to`) → 0: a cosine bump that rises over
  // `peak` of the flick and falls over the rest. Smooth at both ends, so flicks chain without a kink.
  const bump = (q) => { const w = q < P ? 0.5 * q / P : 0.5 + 0.5 * (q - P) / (1 - P); return (1 - Math.cos(2 * Math.PI * w)) / 2 }
  const h = (x) => (x <= 0 || x >= F.flicks ? 0 : bump(x - Math.floor(x)))
  const on = THREE.MathUtils.smoothstep(sc, 0, 0.15)
  const R = P / 2 // the thumb lets go halfway up, while it's moving fastest: that's what makes it a flick
  // Joints share the swing and trail each other (overlapping action): the base (CMC) leads with 75%, the
  // middle joint (MCP) follows with 25% a little later, and the tip joint (IP) flexes more when the thumb is
  // low, later still. The tip also curls while in the air (sin², so it eases in and out).
  const span = F.to - F.from
  const thumb = THREE.MathUtils.lerp(v.spread.thumb, F.from, on) + 0.75 * span * h(f)
  const mcp = 0.25 * span * h(f - F.lag)
  const q = f - Math.floor(f), air = f > 0 && f < F.flicks && q > R ? Math.sin(Math.PI * (q - R) / (1 - R)) ** 2 : 0
  const ip = on * F.curl * (1 - h(f - 2 * F.lag)) + F.bend * air
  // Feed: stuck to the thumb while it touches, then it keeps the thumb's speed at release and slows like
  // friction (exponential decay), coming to rest just as the next flick lands. τ is solved so the speed at
  // release matches: no jump.
  const K = 2 * F.drag * F.distance, v0 = (K * Math.PI) / (2 * P), C = (1 - F.drag) * F.distance, T = 1 - R
  let lo = 1e-4, hi = 50 // τ·(1 − e^(−T/τ)) grows with τ; bisect for C / v0
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (m * (1 - Math.exp(-T / m)) < C / v0) lo = m; else hi = m }
  const tau = lo, coast = (t) => (C * (1 - Math.exp(-t / tau))) / (1 - Math.exp(-T / tau))
  const feedAt = (x) => { if (x <= 0) return 0; if (x >= F.flicks) return F.flicks * F.distance; const k = Math.floor(x), r = x - k; return k * F.distance + (r < R ? K * bump(r) : K / 2 + coast(r - R)) }
  const flicks = feedAt(f) // posts scrolled
  pose({ ...v.spread, thumb }, { ...v.grip, amount: easeInOut(t), thumbMcp: mcp, thumbIp: ip })

  const u = dotsMat.uniforms
  u.progress.value = v.grip.amount
  u.travel.value = v.dots.travel
  u.gather.value = v.dots.gather
  u.size.value = Math.max(1, Math.round(v.dots.size * renderer.getPixelRatio())) // whole device pixels, so every dot is the same crisp square
  u.cloudSize.value = v.dots.cloud
  u.shade.value = v.dots.shade
  u.cloudInk.value = v.dots.cloudInk
  u.color.value.set(v.dots.color)

  // The phone slows into its resting spot and lands at `land`, before the fingers finish closing.
  phone.position.set(v.phone.x, v.phone.y + v.phone.drop * (1 - easeOut(Math.min(t / v.phone.land, 1))), v.phone.z)
  u.morph.value = v.ota.morph
  u.serverAt.value.set(v.ota.x, v.ota.y, v.ota.z)
  u.serverScale.value = v.ota.scale
  u.serverYaw.value = THREE.MathUtils.degToRad(v.ota.yaw)
  u.serverInk.value = v.ota.ink
  u.serverKeep.value = v.ota.keep
  u.push.value = v.ota.push
  u.waveSpeed.value = v.ota.waves.trips
  u.waveCount.value = v.ota.waves.count
  u.waveSpread.value = THREE.MathUtils.degToRad(v.ota.waves.spread)
  u.waveInk.value = v.ota.waves.weight
  u.phoneAt.value.set(v.phone.x, v.phone.y, v.phone.z)
  screenState = { scroll: flicks, bug: v.feed.bug, fix: v.ota.push, spin: v.feed.bug && (v.feed.bug + v.ota.morph + v.ota.push) * 9 } // 0 before the bug, so the dark screen isn't repainted through the grip
  if (glass) drawScreen(THREE.MathUtils.smoothstep(v.ota.push, 0.1, 0.95))
  if (glass) glass.material.emissiveIntensity = 0.85 * THREE.MathUtils.smoothstep(t, v.phone.screenOn, 1) // 0.85: a touch under full so it doesn't glow off the page
  dirty = true
}
kit.subscribe(apply)

// Whatever is drawn on this canvas shows on the phone's screen.
const screen = document.createElement('canvas')
screen.width = SW
screen.height = SH
let drawn = ''
// p = install progress 0–1, for the caption.
function drawScreen(p) {
  const key = JSON.stringify([screenState, p])
  if (key === drawn) return
  drawn = key
  paint(screen.getContext('2d'), screenState)
  // The caption beside the phone says what didn't happen: each line rises in over its own stretch of the push.
  captionLines.forEach((el, i) => {
    const k = THREE.MathUtils.smoothstep(p, ...captionAt[i])
    el.style.opacity = k
    el.style.transform = `translateY(${10 * (1 - k)}px)`
  })
  screenTex.needsUpdate = true
}
const captionLines = [...document.querySelector('#caption').children]
const captionAt = [[0.02, 0.15], [0.25, 0.4], [0.45, 0.6], [0.9, 1]]
const screenTex = new THREE.CanvasTexture(screen)
screenTex.colorSpace = THREE.SRGBColorSpace
// The screen mesh's UVs only span u 0.018–0.48 and run top-down, so stretch the canvas over that
// range and skip three's default vertical flip.
screenTex.repeat.x = 1 / (0.48 - 0.018)
screenTex.offset.x = -0.018 * screenTex.repeat.x
screenTex.flipY = false
drawScreen(0)

new GLTFLoader().load('/models/iphone.glb', ({ scene: model }) => {
  model.scale.setScalar(0.01)
  glass = model.getObjectByName('Object_18') // the display: its own mesh and material
  glass.material.emissiveMap = screenTex
  model.traverse((o) => o.layers.set(1))
  phone.add(model)
  apply(kit.getValues()) // sets the screen's brightness
})

new GLTFLoader().load('/models/right.glb', ({ scene: hand }) => {
  let mesh
  hand.traverse((o) => { if (o.isMesh) { o.material = skin; mesh = o } })

  // Each level splits every triangle into 4: 1.4k → 5k → 21k vertices. Dots are sampled from the result.
  mesh.geometry = subdivide(subdivide(mesh.geometry))
  const bone = (name) => hand.getObjectByName(name)
  const pos = (name) => bone(name).position.clone()

  // Palm frame, in the model's own space. For a right hand, across × up points out of the palm
  // (checked with a side render: thumb and palm pad face +Z).
  const up = pos('middle-finger-tip').sub(pos('wrist')).normalize()
  const across = pos('index-finger-phalanx-proximal').sub(pos('pinky-finger-phalanx-proximal'))
  const normal = new THREE.Vector3().crossVectors(across, up).normalize()
  across.crossVectors(up, normal)

  // Rotate the whole model so across→+X, up→+Y, palm→+Z (towards the camera).
  const basis = new THREE.Matrix4().makeBasis(across, up, normal)
  hand.quaternion.setFromRotationMatrix(basis.transpose())

  // Centre on the camera: midpoint between wrist and middle fingertip.
  hand.updateMatrixWorld(true)
  const a = bone('wrist').getWorldPosition(new THREE.Vector3())
  const b = bone('middle-finger-tip').getWorldPosition(new THREE.Vector3())
  hand.position.sub(a.add(b).multiplyScalar(0.5))

  // Remember the rest pose so every slider change re-poses from scratch instead of stacking rotations.
  const rest = new Map()
  hand.traverse((o) => { if (o.isBone) rest.set(o, [o.position.clone(), o.quaternion.clone()]) })

  // Swing a list of bones rigidly around an axis through a pivot (all in the model's space).
  const swing = (bones, pivot, axis, rad) => {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, rad)
    for (const b of bones) {
      b.position.sub(pivot).applyQuaternion(q).add(pivot)
      b.quaternion.premultiply(q)
    }
  }
  const rad = THREE.MathUtils.degToRad

  // Each finger's rest-pose angle from the middle finger, around the palm normal, in degrees.
  // The model's fingers already fan out at rest, which is why a Spread of 0 still leaves gaps.
  const dir = (f) => pos(`${f}-finger-tip`).sub(pos(`${f}-finger-phalanx-proximal`)).projectOnPlane(normal).normalize()
  const fanRest = { thumb: 0 }
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    const m = dir('middle'), d = dir(f)
    fanRest[f] = THREE.MathUtils.radToDeg(Math.atan2(m.clone().cross(d).dot(normal), m.dot(d)))
  }

  pose = (spread, grip) => {
    const t = grip.amount
    for (const [b, [p, q]] of rest) { b.position.copy(p); b.quaternion.copy(q) }

    for (const [finger, deg] of Object.entries(spread)) {
      const thumb = finger === 'thumb'
      const prefix = thumb ? 'thumb' : `${finger}-finger`
      const names = thumb
        ? ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip']
        : ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip']
      const bones = names.map((n) => bone(`${prefix}-${n}`))

      // 1. Spread sideways. A finger's fan angle (measured from the middle finger) is its rest angle
      //    plus your Spread slider; the grip scales that angle down. The thumb keeps its spread.
      const k = thumb ? 0 : THREE.MathUtils.smoothstep(t, grip.squeezeFrom, 1)
      const fan = (fanRest[finger] + deg) * (1 - grip.squeeze * k)
      const side = fan - fanRest[finger]
      swing(bones, bones[0].position.clone(), normal, rad(side))
      if (thumb) { // thumb doesn't curl in the grip, like your photos; while swiping, its MCP and tip joints bend in-plane
        swing(bones.slice(1), bones[1].position.clone(), normal, rad(grip.thumbMcp || 0))
        swing(bones.slice(2), bones[2].position.clone(), normal, rad(grip.thumbIp || 0))
        continue
      }

      // 2. Curl: each joint bends everything past it toward the palm, around the finger's own side axis.
      const hinge = across.clone().applyAxisAngle(normal, rad(side))
      const bends = [grip.proximal, grip.intermediate[finger], grip.distal[finger]]
      bends.forEach((b, i) => swing(bones.slice(i), bones[i].position.clone(), hinge, rad(b * t)))
    }

    // 3. Roll the whole hand around the wrist (view axis) so fingers end up pointing left, thumb up.
    swing(rest.keys(), rest.get(bone('wrist'))[0], normal, rad(grip.roll * t))
  }

  // Scroll drives the grip: pin the canvas for two screens of scrolling, and map that distance to amount 0 → 1.
  // scrub: 1 = the hand takes ~1 s to catch up with the scrollbar, which is what smooths wheel steps.
  gsap.registerPlugin(ScrollTrigger)
  // 0–1 grip, 1–2.2 scroll the feed, 2.2–2.5 the bug, 2.6–3.6 morph into the server, 3.7–4.7 push the fix,
  // then a short hold so the ending sits.
  const S = 1.2, T = 5
  gsap.to({ amount: 0 }, {
    amount: T,
    ease: 'none', // linear: easing already lives in the pose (squeezeFrom, smoothstep)
    scrollTrigger: { trigger: '#app', pin: true, start: 'top top', end: `+=${T * 200}%`, scrub: 1 },
    onUpdate() {
      const a = this.targets()[0].amount
      const c = (x) => THREE.MathUtils.clamp(x, 0, 1)
      kit.setValues({ // one call, so apply runs once per tick
        grip: { amount: Math.min(a, 1) },
        feed: { scroll: c((a - 1) / S), bug: c((a - 2.2) / 0.3) },
        ota: { morph: c(a - 2.6), push: c(a - 3.7) },
      })
    }, // re-poses via subscribe
  })

  apply(kit.getValues())
  scene.add(hand)

  // Scatter dots over the skin, evenly: pick a triangle with odds by its area, then a random point in it.
  // ponytail: each dot copies the bone weights of its nearest corner; blend all three if knuckles tear.
  const g = mesh.geometry, idx = g.index.array, P = g.attributes.position, N = g.attributes.normal
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight
  const corner = (t, c) => new THREE.Vector3().fromBufferAttribute(P, idx[t * 3 + c])
  const areas = []
  for (let t = 0, sum = 0; t < idx.length / 3; t++) areas.push(sum += new THREE.Triangle(corner(t, 0), corner(t, 1), corner(t, 2)).getArea())

  const count = 250000
  const attr = (size) => new THREE.BufferAttribute(new Float32Array(count * size), size)
  const d = new THREE.BufferGeometry()
  for (const [name, size] of [['position', 3], ['normal', 3], ['skinWeight', 4], ['cloud', 3], ['seed', 1]]) d.setAttribute(name, attr(size))
  d.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(count * 4), 4))
  const at = d.attributes, p = new THREE.Vector3(), n = new THREE.Vector3(), tmp = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    const r = Math.random() * areas.at(-1)
    let lo = 0, hi = areas.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (areas[m] < r) lo = m + 1; else hi = m }
    let u = Math.random(), v = Math.random()
    if (u + v > 1) { u = 1 - u; v = 1 - v }
    const w = [1 - u - v, u, v]
    p.set(0, 0, 0); n.set(0, 0, 0)
    w.forEach((wc, c) => {
      p.addScaledVector(tmp.fromBufferAttribute(P, idx[lo * 3 + c]), wc)
      n.addScaledVector(tmp.fromBufferAttribute(N, idx[lo * 3 + c]), wc)
    })
    at.position.setXYZ(i, p.x, p.y, p.z)
    at.normal.setXYZ(i, n.x, n.y, n.z)
    const near = idx[lo * 3 + w.indexOf(Math.max(...w))]
    at.skinIndex.setXYZW(i, SI.getX(near), SI.getY(near), SI.getZ(near), SI.getW(near))
    at.skinWeight.setXYZW(i, SW.getX(near), SW.getY(near), SW.getZ(near), SW.getW(near))
    tmp.randomDirection().multiplyScalar(Math.cbrt(Math.random())) // uniform in a unit ball; cloudSize scales it
    at.cloud.setXYZ(i, tmp.x * 1.5, tmp.y, tmp.z * 0.5)
    at.seed.setX(i, Math.random())
  }

  // Split off the thumb's dots (mostly skinned to bones 1–4, like the shader's test) so the thumb pass
  // only redraws those, not all of them. Each half stays in random order, so any prefix is still even.
  const isThumb = (i) => [0, 1, 2, 3].reduce((s, j) => s + (at.skinIndex.getComponent(i, j) >= 1 && at.skinIndex.getComponent(i, j) <= 4 ? at.skinWeight.getComponent(i, j) : 0), 0) >= 0.5
  const keep = Array.from({ length: count }, (_, i) => isThumb(i))
  const split = (thumb) => {
    const ids = keep.flatMap((k, i) => (k === thumb ? [i] : []))
    const out = new THREE.BufferGeometry()
    for (const [name, a] of Object.entries(at)) {
      const arr = new a.array.constructor(ids.length * a.itemSize)
      ids.forEach((id, j) => arr.set(a.array.subarray(id * a.itemSize, (id + 1) * a.itemSize), j * a.itemSize))
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize))
    }
    // Points drawn with the hand's own skeleton. three only skins objects flagged isSkinnedMesh, so borrow
    // the mesh's skeleton and bind matrices. ponytail: relies on three internals; recheck after upgrades.
    const pts = new THREE.Points(out, dotsMat)
    Object.assign(pts, { isSkinnedMesh: true, skeleton: mesh.skeleton, bindMatrix: mesh.bindMatrix, bindMatrixInverse: mesh.bindMatrixInverse })
    pts.frustumCulled = false
    pts.renderOrder = 1 // after the invisible hand has written its depth
    mesh.add(pts) // same world matrix as the mesh, which its skinning assumes
    return pts
  }
  // Layer 2 = what the thumb pass draws: the depth hand and the thumb's dots (also in the main pass, while in flight).
  const thumbDots = split(true)
  thumbDots.layers.enable(2)
  mesh.layers.enable(2)
  const dots = [split(false), thumbDots]

  // Server targets: each dot gets a random spot on the server's faces, plus that face's normal (for
  // shading) and whether the spot is a status light.
  const sample = serverSampler()
  for (const pts of dots) {
    const n = pts.geometry.attributes.position.count
    const S = new Float32Array(n * 3), SN = new Float32Array(n * 3), L = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = sample()
      S.set(t.p, i * 3); SN.set(t.n, i * 3); L[i] = t.led
    }
    pts.geometry.setAttribute('server', new THREE.BufferAttribute(S, 3))
    pts.geometry.setAttribute('serverN', new THREE.BufferAttribute(SN, 3))
    pts.geometry.setAttribute('led', new THREE.BufferAttribute(L, 1))
  }
  document.querySelector('#loading').classList.add('done') // the first frame with the dots is next
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  renderer.setSize(innerWidth, innerHeight)
  apply(kit.getValues()) // re-centres the phone for the new size
})

// Three passes: hand, then wipe depth and draw the phone over it (so no finger shows through the phone's
// body), then the thumb again, depth-tested against the phone, so it stays in front where it really is.
// ponytail: only right from this fixed camera; real contact needs per-finger collision.
renderer.autoClear = false
const still = matchMedia('(prefers-reduced-motion: reduce)')
renderer.setAnimationLoop((ms) => {
  // Draw only when something changed or the cloud is still drifting. Once every dot has landed
  // (progress 1) the picture is still, and the canvas keeps showing the last frame for free.
  // The morph also drifts through the cloud, so it counts until the server has formed (morph 1).
  // After that only the server's lights change. They tick at 8 fps, so an idle page draws 8 frames a
  // second instead of 120.
  const u = dotsMat.uniforms
  const drifting = !still.matches && (u.progress.value < 1 || (u.morph.value > 0 && u.morph.value < 1))
  const tick = Math.floor(ms / 125) / 8
  const blinking = !still.matches && u.morph.value > 0 && tick !== u.blink.value
  if (!dirty && !drifting && !blinking) return
  dirty = false
  if (!still.matches) {
    u.time.value = ms / 1000 // the cloud's drift
    u.blink.value = tick
  }
  renderer.clear()
  renderer.render(scene, camera)
  renderer.clearDepth()
  camera.layers.set(1)
  renderer.render(scene, camera)
  camera.layers.set(2)
  thumbOnly.value = 1
  // Paper-white thumb over the phone, so the screen doesn't show through its sparse lit side. Only while
  // its dots sit on it: during the morph the mesh stays but the dots have left.
  skin.colorWrite = u.progress.value >= 1 && u.morph.value <= 0
  renderer.render(scene, camera)
  thumbOnly.value = 0
  skin.colorWrite = false
  camera.layers.set(0)
})

// ---------------------------------------------------------------------------------------------------
// The server's shape. The sampler returns one random dot on the server's camera-facing faces (front, top,
// left), in metres centred on the server: { p, n, led }. led > 0 marks a blinking status light (its phase).
// Patterns are cut by rejection: a dot that lands in a gap or vent hole is thrown away and re-rolled.
function boxSampler(W, H, D, front, cy) {
  const faces = [
    [W * H, () => [[(Math.random() - 0.5) * W, (Math.random() - 0.5) * H, D / 2], [0, 0, 1]], front],
    [W * D, () => [[(Math.random() - 0.5) * W, H / 2, (Math.random() - 0.5) * D], [0, 1, 0]], () => true],
    [D * H, () => [[-W / 2, (Math.random() - 0.5) * H, (Math.random() - 0.5) * D], [-1, 0, 0]], () => true],
  ]
  const total = faces.reduce((s, f) => s + f[0], 0)
  return () => {
    for (;;) {
      let r = Math.random() * total, f = faces[0]
      for (const face of faces) { if ((r -= face[0]) < 0) { f = face; break } }
      const [p, n] = f[1]()
      const led = f[2](p[0], p[1], p[2])
      if (led === false) continue
      p[1] += cy
      return { p, n, led: led === true ? 0 : led }
    }
  }
}
const near = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r

// The server glyph everyone knows — three fat slabs stacked with gaps, lights left, slots right.
function serverSampler() {
  const W = 0.14, h = 0.038, D = 0.1, gap = 0.016
  const slabs = [0, 1, 2].map((i) => {
    const cy = (i - 1) * (h + gap)
    return boxSampler(W, h, D, (x, y) => {
      for (let j = 0; j < 3; j++) if (near(x, y, -W / 2 + 0.016 + j * 0.013, 0, 0.0045)) return ((i * 3 + j) * 0.21) % 1 + 0.001
      if (x > 0 && x < W / 2 - 0.012 && [-0.01, 0, 0.01].some((ly) => Math.abs(y - ly) < 0.0022)) return false // slots
      return true
    }, cy)
  })
  return () => slabs[Math.floor(Math.random() * 3)]()
}
