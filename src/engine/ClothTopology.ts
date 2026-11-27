import { Object3D, Vector3 } from 'three'
import type { BodyColliders, ClothMaterial } from './BodyColliders'
import type { RestTransform } from './ModelLoader'
import { canonicalBoneName, classifyBone } from './RigDefinition'
import { isRigidAccessory, torsoAccessoryAnchor } from './TorsoAccessories'

const decorative =
  /hair|skirt|ribbon|cape|tail|ear|wing|tie|scarf|sleeve|sodetake|coat|jacket|frill|dress|apron|collar|lace|necklace|earring|ahoge|ponytail|twin|braid|cloak|mantle|veil|hem|cloth|sash|obi|tassel|fur|hood/i
const hubName =
  /^bip001_(?:head|neck|spine\d*|pelvis|[lr]_(?:clavicle|upperarm|forearm|thigh|calf)(?:_twist)?)$/
const skirtHub = /^bip001_(?:pelvis|spine\d*)$/
const hair = /hair|ponytail|twin|braid|ahoge|earring/i

function material(name: string, hub: string, bindDy: number): ClothMaterial {
  if (/earring|ponytail/i.test(name)) return 'hair'
  if (/wing|ear|tail/i.test(name)) return 'wing'
  if (
    skirtHub.test(hub) &&
    /skirt|dress|apron|coat|jacket/i.test(name) &&
    (hub === 'bip001_pelvis' || bindDy <= 0.008)
  )
    return 'skirt'
  if (hub === 'bip001_head' || hair.test(name)) return 'hair'
  return 'cloth'
}

export interface ClothJoint {
  bone: Object3D
  chain: Object3D
  hub: Object3D
  material: ClothMaterial
  attachment: boolean
  bangs: boolean
  depth: number
  stiffnessScale: number
  tip: Vector3
  restTip: Vector3
}

export function discoverCloth(
  bones: Object3D[],
  rest: Map<Object3D, RestTransform>,
  exclude: ReadonlySet<Object3D>,
  skin?: BodyColliders,
) {
  const candidates = new Set(bones)
  const pelvis = bones.find((bone) => canonicalBoneName(bone.name) === 'bip001_pelvis')
  const pelvisX = pelvis && rest.get(pelvis)!.restWorldPos.x
  const relevant = new Set<Object3D>()
  if (skin?.hasSkin) {
    for (const bone of skin.skinned) {
      for (let n: Object3D | null = bone; n && !relevant.has(n); n = n.parent) relevant.add(n)
    }
  }
  const eligible = (node: Object3D) => {
    if (!candidates.has(node) || (skin?.hasSkin && !relevant.has(node)) || exclude.has(node)) return false
    const key = canonicalBoneName(node.name)
    return (
      classifyBone(key) === 'secondary' &&
      !isRigidAccessory(key) &&
      !/halo|(?:^|_)(?:eye(?!ring)|mouth|jaw|tongue|pupil|face|brow)|(?:^|_)mesh$|^point\d+$/i.test(key)
    )
  }

  const joints: ClothJoint[] = []
  function visit(
    bone: Object3D,
    chain: Object3D,
    hub: Object3D,
    parentKind: ClothMaterial | undefined,
    depth: number,
    bangs: boolean,
  ): number {
    const bind = rest.get(bone)!
    const children = bone.children.filter(eligible)
    // A shared root like jacket_Root stays fixed at the attachment. Its
    // individual panels below it are free to rotate and contact the body.
    const tip = new Vector3()
    for (const child of children) tip.add(rest.get(child)!.restLocalPos)
    if (children.length) tip.divideScalar(children.length)
    const skinTip = !children.length && skin?.leafTips.get(bone)
    if (skinTip) tip.copy(skinTip)
    if (tip.lengthSq() < 1e-12 && Math.min(...bind.restLocalScale.toArray().map(Math.abs)) > 1e-8) {
      tip
        .copy(bind.restLocalPos)
        .applyQuaternion(bind.restLocalQuat.clone().invert())
        .divide(bind.restLocalScale)
        .multiplyScalar(0.65)
    }
    const restTip = tip
      .clone()
      .multiply(bind.restWorldScale)
      .applyQuaternion(bind.restWorldQuat)
      .add(bind.restWorldPos)
    const kind =
      parentKind ?? material(bone.name, canonicalBoneName(hub.name), restTip.y - bind.restWorldPos.y)
    const joint: ClothJoint = {
      bone,
      chain,
      hub,
      material: kind,
      depth,
      bangs: bangs && kind === 'hair',
      tip,
      attachment: children.length > 1 && bone === chain,
      stiffnessScale: 1,
      restTip,
    }
    if (tip.lengthSq() > 1e-14) joints.push(joint)
    let deepest = depth
    for (const child of children)
      deepest = Math.max(deepest, visit(child, chain, hub, kind, depth + 1, bangs))
    joint.stiffnessScale = (1.35 - (0.7 * depth) / Math.max(1, deepest)) * (joint.bangs ? 1.55 : 1)
    return deepest
  }

  for (const hub of bones) {
    const key = canonicalBoneName(hub.name)
    if (!hubName.test(key)) continue
    let blocked = false
    for (let ancestor = hub.parent; ancestor; ancestor = ancestor.parent) {
      if (/weapon|halo/i.test(ancestor.name) || classifyBone(canonicalBoneName(ancestor.name)) === 'face')
        blocked = true
    }
    if (blocked) continue
    for (const root of hub.children) {
      if (!eligible(root) || torsoAccessoryAnchor(root, rest, pelvisX)) continue
      if (!decorative.test(root.name) && !(skin?.hasSkin && root.children.some(eligible))) continue
      const bangs = /hair.*_f(?:_|\d|$)|bang|front/i.test(root.name)
      visit(root, root, hub, undefined, 0, bangs)
    }
  }
  return joints
}

export interface RingEdge<T> {
  a: T
  b: T
  bending: boolean
  restLength: number
  lambda: number
}
export function buildRings<T extends ClothJoint>(particles: T[], rest: Map<Object3D, RestTransform>) {
  const groups = new Map<Object3D, Map<number, T[]>>()
  for (const p of particles) {
    if (p.material !== 'skirt' || p.attachment) continue
    let depths = groups.get(p.hub)
    if (!depths) groups.set(p.hub, (depths = new Map()))
    let ring = depths.get(p.depth)
    if (!ring) depths.set(p.depth, (ring = []))
    ring.push(p)
  }
  const rings: { particles: T[]; closed: boolean }[] = []
  const edges: RingEdge<T>[] = [],
    bendingEdges: RingEdge<T>[] = []
  for (const [hub, depths] of groups) {
    const center = rest.get(hub)!.restWorldPos
    for (const group of depths.values()) {
      if (group.length < 3) continue
      const angle = (p: T) => Math.atan2(p.restTip.x - center.x, p.restTip.z - center.z)
      group.sort((a, b) => angle(a) - angle(b))
      let gap = -1,
        start = 0
      for (let i = 0; i < group.length; i++) {
        const next = (i + 1) % group.length
        const arc = angle(group[next]) - angle(group[i]) + (next ? 0 : Math.PI * 2)
        if (arc > gap) {
          gap = arc
          start = next
        }
      }
      const ordered = group.slice(start).concat(group.slice(0, start))
      const closed = Math.PI * 2 - gap >= (200 * Math.PI) / 180
      rings.push({ particles: ordered, closed })
      for (const hop of [1, 2]) {
        if (hop === 2 && ordered.length < 5) continue
        const bending = hop === 2
        const target = bending ? bendingEdges : edges
        for (let i = 0; i < ordered.length - (closed ? 0 : hop); i++) {
          const a = ordered[i],
            b = ordered[(i + hop) % ordered.length]
          const restLength = a.restTip.distanceTo(b.restTip)
          if (restLength > 1e-7) target.push({ a, b, restLength, lambda: 0, bending })
        }
      }
    }
  }
  return { rings, edges, bendingEdges }
}
