import './style.css'
import 'dialkit/vanilla/styles.css'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createDialKit, createDialRoot } from 'dialkit/vanilla'
import { subdivide } from './subdivide.js'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(devicePixelRatio)
renderer.setSize(innerWidth, innerHeight)
document.querySelector('#app').appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#ffffff')

// Eye level, straight on. Units are metres: the hand is ~0.19 tall.
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 10)

// Key light at an angle; dim sky/ground fill so the shadow side isn't black.
const key = new THREE.DirectionalLight('#ffffff')
const fill = new THREE.HemisphereLight('#ffffff', '#666666')
scene.add(key, fill)

// Grain: random noise used as a bump map, so light catches tiny dents in the skin.
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

const skin = new THREE.MeshStandardMaterial({ bumpMap: noiseTexture() })

// Every tweakable number lives here. Sliders are [default, min, max, step].
// "Copy" in the panel's version menu gives you the values to paste back as new defaults.
createDialRoot({ position: 'top-right', productionEnabled: false }) // panel only in dev
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
  // Grip = the "about to hold a phone" pose. Amount 0 is open, 1 is fully closed; dragging the hand sets it.
  // Angles are what each joint reaches at amount 1.
  grip: {
    amount: [0, 0, 1, 0.01],
    roll: [84, 0, 120, 1],
    proximal: [0, 0, 110, 1],
    intermediate: [76, 0, 120, 1],
    distal: [45, 0, 90, 1],
    // How much the gaps between fingers close by amount 1: 0 = keep the open fan, 1 = parallel to the
    // middle finger, >1 = tips lean in. Fingers keep their fan until `squeezeFrom`, then ease together.
    squeeze: [1, 0, 1.3, 0.01],
    squeezeFrom: [0.5, 0, 1, 0.01],
  },
}, { id: 'hand', persist: import.meta.env.DEV, onAction: (path) => path === 'reset' && kit.resetValues() })

let pose = () => {} // these two are replaced once the model has loaded
let smooth = () => {}

function apply(v) {
  camera.position.set(0, v.camera.height, v.camera.distance)
  camera.fov = v.camera.fov
  camera.updateProjectionMatrix()

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
}
kit.subscribe(apply)

new GLTFLoader().load('/models/right.glb', ({ scene: hand }) => {
  let mesh
  hand.traverse((o) => { if (o.isMesh) { o.material = skin; mesh = o } })

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

  // Spread: swing each finger around the palm normal, pivoting at its knuckle.
  // All bones in this model are siblings, so every bone of the finger is moved explicitly.
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
      const bends = [grip.proximal, grip.intermediate, grip.distal]
      bends.forEach((b, i) => swing(bones.slice(i), bones[i].position.clone(), hinge, rad(b * t)))
    }

    // 3. Roll the whole hand around the wrist (view axis) so fingers end up pointing left, thumb up.
    swing(rest.keys(), rest.get(bone('wrist'))[0], normal, rad(grip.roll * t))
  }

  // Drag: the middle fingertip follows the mouse along its own arc.
  // Sample where the tip lands on screen for amounts 0..1, then pick the sample nearest the pointer.
  // ponytail: nearest-sample search can jump if the arc crosses itself; restrict to neighbours of the current amount if it does.
  const tip = bone('middle-finger-tip')
  let arc = null
  const screenTip = () => {
    hand.updateMatrixWorld(true)
    return tip.getWorldPosition(new THREE.Vector3()).project(camera)
  }
  renderer.domElement.addEventListener('pointerdown', (e) => {
    const v = kit.getValues()
    arc = Array.from({ length: 101 }, (_, i) => {
      pose(v.spread, { ...v.grip, amount: i / 100 })
      return [i / 100, screenTip()]
    })
    pose(v.spread, v.grip) // put the current pose back after sampling
    renderer.domElement.setPointerCapture(e.pointerId)
  })
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!arc) return
    const x = (e.clientX / innerWidth) * 2 - 1, y = -(e.clientY / innerHeight) * 2 + 1
    const dist = ([, p]) => Math.hypot((p.x - x) * camera.aspect, p.y - y) // aspect: equal pixels both ways
    const [amount] = arc.reduce((best, s) => (dist(s) < dist(best) ? s : best))
    kit.setValue('grip.amount', amount) // re-poses via subscribe; the hand stays here on release
  })
  addEventListener('pointerup', () => { arc = null })

  apply(kit.getValues())
  scene.add(hand)
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

renderer.setAnimationLoop(() => renderer.render(scene, camera))
