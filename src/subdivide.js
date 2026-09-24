import * as THREE from 'three'

// Split every triangle into 4. Original vertices stay put; each new edge vertex is pushed
// onto the curved surface implied by the two end normals (PN-triangle midpoint), so tips round
// off instead of just gaining more flat facets. Skin weights are merged so posing still works.
export function subdivide(geometry) {
  const pos = geometry.attributes.position, nor = geometry.attributes.normal
  const uv = geometry.attributes.uv
  const skinIndex = geometry.attributes.skinIndex, skinWeight = geometry.attributes.skinWeight
  const index = geometry.index.array

  const P = [], N = [], U = [], SI = [], SW = []
  const v = (attr, i) => new THREE.Vector3().fromBufferAttribute(attr, i)
  const w4 = (attr, i) => [attr.getX(i), attr.getY(i), attr.getZ(i), attr.getW(i)]
  for (let i = 0; i < pos.count; i++) {
    P.push(v(pos, i)); N.push(v(nor, i))
    if (uv) U.push(new THREE.Vector2().fromBufferAttribute(uv, i))
    if (skinIndex) { SI.push(w4(skinIndex, i)); SW.push(w4(skinWeight, i)) }
  }

  const mids = new Map()
  const mid = (a, b) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`
    if (mids.has(k)) return mids.get(k)
    const pa = P[a], pb = P[b], na = N[a], nb = N[b]
    const d = pb.clone().sub(pa)
    // m = (pa+pb)/2 - ((pb-pa)·na * na + (pa-pb)·nb * nb) / 8
    const p = pa.clone().add(pb).multiplyScalar(0.5)
      .addScaledVector(na, -d.dot(na) / 8)
      .addScaledVector(nb, d.dot(nb) / 8)
    P.push(p)
    N.push(na.clone().add(nb).normalize())
    if (uv) U.push(U[a].clone().add(U[b]).multiplyScalar(0.5))
    if (skinIndex) {
      // Sum both vertices' bone weights, keep the 4 strongest, renormalise.
      const acc = new Map()
      for (const i of [a, b]) for (let j = 0; j < 4; j++) acc.set(SI[i][j], (acc.get(SI[i][j]) ?? 0) + SW[i][j] / 2)
      const top = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 4)
      while (top.length < 4) top.push([0, 0])
      const sum = top.reduce((s, t) => s + t[1], 0)
      SI.push(top.map((t) => t[0])); SW.push(top.map((t) => t[1] / sum))
    }
    mids.set(k, P.length - 1)
    return P.length - 1
  }

  const out = []
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]]
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
    out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
  }

  const g = new THREE.BufferGeometry()
  g.setIndex(out)
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.flatMap((p) => p.toArray()), 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N.flatMap((n) => n.toArray()), 3))
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(U.flatMap((u) => u.toArray()), 2))
  if (skinIndex) {
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI.flat(), 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW.flat(), 4))
  }
  return g
}
