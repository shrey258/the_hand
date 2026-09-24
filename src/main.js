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
createDialRoot({ position: 'top-right' })
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
  spread: { thumb: [-11, -60, 30, 1], index: [-5, -30, 30, 1], middle: [0, -30, 30, 1], ring: [3, -30, 30, 1], pinky: [8, -30, 40, 1] },
}, { id: 'hand', persist: true, onAction: (path) => path === 'reset' && kit.resetValues() })

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

  pose(v.spread)
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
  pose = (spread) => {
    for (const [b, [p, q]] of rest) { b.position.copy(p); b.quaternion.copy(q) }
    for (const [finger, deg] of Object.entries(spread)) {
      const prefix = finger === 'thumb' ? 'thumb' : `${finger}-finger`
      const joints = finger === 'thumb'
        ? ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip']
        : ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip']
      const q = new THREE.Quaternion().setFromAxisAngle(normal, THREE.MathUtils.degToRad(deg))
      const pivot = rest.get(bone(`${prefix}-${joints[0]}`))[0]
      for (const j of joints) {
        const b = bone(`${prefix}-${j}`)
        b.position.sub(pivot).applyQuaternion(q).add(pivot)
        b.quaternion.premultiply(q)
      }
    }
  }

  apply(kit.getValues())
  scene.add(hand)
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

renderer.setAnimationLoop(() => renderer.render(scene, camera))
