import './style.css'
import 'dialkit/vanilla/styles.css'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { createDialKit, createDialRoot } from 'dialkit/vanilla'
import { subdivide } from './subdivide.js'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap // honours shadow.radius for a soft edge
renderer.setPixelRatio(devicePixelRatio)
renderer.setSize(innerWidth, innerHeight)
document.querySelector('#app').appendChild(renderer.domElement)

const scene = new THREE.Scene()
renderer.setClearColor('#ffffff') // not scene.background: that would repaint over the hand in the phone pass

// Eye level, straight on. Units are metres: the hand is ~0.19 tall.
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 10)

// Key light at an angle; dim sky/ground fill so the shadow side isn't black.
const key = new THREE.DirectionalLight('#ffffff')
// Only the phone casts, onto the hand, so it reads as held rather than pasted on.
// Shadow box sized to the scene (~0.2 m); layer 1 so the shadow pass sees the phone.
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
Object.assign(key.shadow.camera, { left: -0.2, right: 0.2, top: 0.2, bottom: -0.2 })
key.shadow.camera.layers.enable(1)
key.shadow.radius = 6
key.shadow.bias = -0.0005
const fill = new THREE.HemisphereLight('#ffffff', '#666666')
scene.add(key, fill)
key.layers.enable(1) // layer 1 = the phone, drawn in its own pass (see the render loop)
fill.layers.enable(1)

// Grain: random noise used acan s a bump map, so light catches tiny dents in the skin.
function noiseTexture(size = 512) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(4, 4)
  return tex
}

// The hand itself is never seen: it only writes depth, so dots on the far side of it stay hidden.
// polygonOffset pushes that depth back a hair so dots lying exactly on the surface don't flicker.
const skin = new THREE.MeshStandardMaterial({ bumpMap: noiseTexture(), colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })

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
    cloudSize: { value: 0.3 }, cloudInk: { value: 0.3 }, shade: { value: 0.7 }, color: { value: new THREE.Color() },
    lightDir: { value: key.position }, thumbOnly,
  },
  vertexShader: `
    #include <common>
    #include <skinning_pars_vertex>
    uniform float progress, travel, time, size, cloudSize;
    uniform vec3 lightDir;
    attribute vec3 cloud;
    attribute float seed;
    varying float vLit, vSeed, vThumb, vK;
    void main() {
      #include <skinbase_vertex>
      #include <beginnormal_vertex>
      #include <skinnormal_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      vThumb = dot(skinWeight, step(0.5, skinIndex) * step(skinIndex, vec4(4.5)));
      vec3 home = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vec3 drift = cloud * cloudSize + 0.01 * sin(time * 0.6 + seed * 50.0 + vec3(0.0, 2.0, 4.0));
      float start = seed * (1.0 - travel);
      float k = smoothstep(start, start + travel, progress);
      gl_Position = projectionMatrix * viewMatrix * vec4(mix(drift, home, k), 1.0);
      // In flight: draw in front of everything, or the invisible hand would cut a hand-shaped hole in the cloud.
      if (k < 1.0) gl_Position.z = -0.999 * gl_Position.w;
      gl_PointSize = size;
      vLit = k * max(dot(normalize(mat3(modelMatrix) * objectNormal), normalize(lightDir)), 0.0);
      vSeed = fract(seed * 97.0);
      vK = k;
    }`,
  fragmentShader: `
    uniform float shade, thumbOnly, cloudInk;
    uniform vec3 color;
    varying float vLit, vSeed, vThumb, vK;
    void main() {
      if (thumbOnly > 0.5 && (vThumb < 0.5 || vK < 1.0)) discard; // over the phone: only thumb dots that have landed
      if (vLit * shade > vSeed) discard; // dither: lit skin keeps fewer dots, shadowed skin keeps them all
      gl_FragColor = vec4(mix(vec3(1.0), color, mix(cloudInk, 1.0, vK)), 1.0); // cloud is pale grey, ink as it lands
      #include <colorspace_fragment>
    }`,
})

// Every tweakable number lives here. Sliders are [default, min, max, step].
// "Copy" in the panel's version menu gives you the values to paste back as new defaults.
createDialRoot({ position: 'top-right', productionEnabled: import.meta.env.DEV }) // panel only in dev (false hides it everywhere)
const kit = createDialKit('Hand', {
  reset: { type: 'action' },
  camera: { distance: [0.5, 0.2, 1.5, 0.01], height: [0, -0.15, 0.15, 0.005], fov: [35, 15, 70, 1] },
  light: {
    azimuth: [45, -180, 180, 1],
    elevation: [45, -90, 90, 1],
    intensity: [3.5, 0, 10, 0.1],
    fill: [0.35, 0, 2, 0.01],
  },
  skin: { color: '#d0d0d0', roughness: [0.75, 0, 1, 0.01], grain: [0.6, 0, 3, 0.05], wireframe: false, smoothness: [2, 0, 3, 1] },
  // Degrees around the palm normal; positive swings toward the pinky side.
  spread: { thumb: [-14, -60, 30, 1], index: [-5, -30, 30, 1], middle: [0, -30, 30, 1], ring: [3, -30, 30, 1], pinky: [8, -30, 40, 1] },
  // Grip = the "about to hold a phone" pose. Amount 0 is open, 1 is fully closed; scrolling sets it.
  // Angles are what each joint reaches at amount 1.
  grip: {
    amount: [0, 0, 1, 0.01],
    roll: [85, 0, 120, 1],
    proximal: [35, 0, 110, 1],
    // Middle and fingertip joints, per finger, so each tip can land on the phone's edge.
    intermediate: { index: [10, 0, 120, 1], middle: [35, 0, 120, 1], ring: [29, 0, 120, 1], pinky: [10, 0, 120, 1] },
    distal: { index: [49, 0, 90, 1], middle: [20, 0, 90, 1], ring: [21, 0, 90, 1], pinky: [22, 0, 90, 1] },
    // How much the gaps between fingers close by amount 1: 0 = keep the open fan, 1 = parallel to the
    // middle finger, >1 = tips lean in. Fingers keep their fan until `squeezeFrom`, then ease together.
    squeeze: [1.3, 0, 1.3, 0.01],
    squeezeFrom: [0.85, 0, 1, 0.01],
  },
  dots: { count: [500000, 10000, 500000, 10000], color: '#000000', size: [1, 0.5, 4, 0.5], cloud: [1, 0.05, 1, 0.01], cloudInk: [0.47, 0, 1, 0.01], travel: [0.8, 0.05, 1, 0.01], shade: [0, 0, 1, 0.01] },
  // Phone sits in world space, placed for the end state (grip amount 1). Position in metres.
  phone: {
    x: [-0.106, -0.15, 0.15, 0.001], y: [-0.049, -0.15, 0.15, 0.001], z: [0.027, -0.1, 0.15, 0.001],
    // How far above its resting spot the phone starts at grip 0; scrolling brings it down.
    // 0.3 clears the top of the frame at the default camera.
    drop: [0.3, 0, 0.5, 0.005],
  },
},{ id: 'hand', persist: import.meta.env.DEV, onAction: (path) => path === 'reset' && kit.resetValues() })

// Phone: iPhone 16 by Wes (sketchfab.com/wimell). Modelled in cm, so scale to metres.
const phone = new THREE.Group()
scene.add(phone)

let pose = () => {} // these two are replaced once the model has loaded
let smooth = () => {}
let dots = null // the dot cloud, built once the hand has loaded

function apply(v) {
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

  skin.color.set(v.skin.color)
  skin.roughness = v.skin.roughness
  skin.bumpScale = v.skin.grain
  skin.wireframe = v.skin.wireframe

  pose(v.spread, v.grip)
  smooth(v.skin.smoothness)

  const u = dotsMat.uniforms
  u.progress.value = v.grip.amount
  u.travel.value = v.dots.travel
  u.size.value = Math.max(1, Math.round(v.dots.size * renderer.getPixelRatio())) // whole device pixels, so every dot is the same crisp square
  u.cloudSize.value = v.dots.cloud
  u.shade.value = v.dots.shade
  u.cloudInk.value = v.dots.cloudInk
  dots?.geometry.setDrawRange(0, v.dots.count)
  u.color.value.set(v.dots.color)

  phone.position.set(v.phone.x, v.phone.y + v.phone.drop * (1 - v.grip.amount), v.phone.z)
}
kit.subscribe(apply)

// Whatever is drawn on this canvas shows on the phone's screen.
const screen = document.createElement('canvas')
screen.width = 590
screen.height = 1280
{
  const ctx = screen.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, screen.height)
  g.addColorStop(0, '#6a8cff')
  g.addColorStop(1, '#f0a0c0')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, screen.width, screen.height)
  ctx.fillStyle = '#fff'
  ctx.font = '600 160px system-ui'
  ctx.textAlign = 'center'
  ctx.fillText('9:41', screen.width / 2, 360)
}
const screenTex = new THREE.CanvasTexture(screen)
screenTex.colorSpace = THREE.SRGBColorSpace
// The screen mesh's UVs only span u 0.018–0.48 and run top-down, so stretch the canvas over that
// range and skip three's default vertical flip.
screenTex.repeat.x = 1 / (0.48 - 0.018)
screenTex.offset.x = -0.018 * screenTex.repeat.x
screenTex.flipY = false

new GLTFLoader().load('/models/iphone.glb', ({ scene: model }) => {
  model.scale.setScalar(0.01)
  const glass = model.getObjectByName('Object_18') // the display: its own mesh and material
  glass.material.emissiveMap = screenTex
  glass.material.emissiveIntensity = 0.85 // a touch under the lit skin so the screen doesn't glow off the hand
  model.traverse((o) => { o.layers.set(1); o.castShadow = true })
  phone.add(model)
})

new GLTFLoader().load('/models/right.glb', ({ scene: hand }) => {
  let mesh
  hand.traverse((o) => { if (o.isMesh) { o.material = skin; o.receiveShadow = true; mesh = o } })

  // Each level splits every triangle into 4 (1.4k → 5k → 21k → 87k vertices). Cached per level.
  const levels = [mesh.geometry]
  smooth = (n) => {
    while (levels.length <= n) levels.push(subdivide(levels.at(-1)))
    mesh.geometry = levels[n]
  }
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
      if (thumb) continue // thumb doesn't curl in the grip, like your photos

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
  gsap.to({ amount: 0 }, {
    amount: 1,
    ease: 'none', // linear: easing already lives in the pose (squeezeFrom, smoothstep)
    scrollTrigger: { trigger: '#app', pin: true, start: 'top top', end: '+=200%', scrub: 1 },
    onUpdate() { kit.setValue('grip.amount', this.targets()[0].amount) }, // re-poses via subscribe
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

  const count = 500000 // the Count slider's max. Dots are random, so drawing the first N is still an even spread
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

  // Points drawn with the hand's own skeleton. three only skins objects flagged isSkinnedMesh, so borrow
  // the mesh's skeleton and bind matrices. ponytail: relies on three internals; recheck after upgrades.
  dots = new THREE.Points(d, dotsMat)
  d.setDrawRange(0, kit.getValues().dots.count)
  Object.assign(dots, { isSkinnedMesh: true, skeleton: mesh.skeleton, bindMatrix: mesh.bindMatrix, bindMatrixInverse: mesh.bindMatrixInverse })
  dots.frustumCulled = false
  dots.renderOrder = 1 // after the invisible hand has written its depth
  mesh.add(dots) // same world matrix as the mesh, which its skinning assumes
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
  if (!still.matches) dotsMat.uniforms.time.value = ms / 1000 // the cloud's drift
  renderer.clear()
  renderer.render(scene, camera)
  renderer.clearDepth()
  camera.layers.set(1)
  renderer.render(scene, camera)
  camera.layers.set(0)
  thumbOnly.value = 1
  renderer.render(scene, camera)
  thumbOnly.value = 0
})
