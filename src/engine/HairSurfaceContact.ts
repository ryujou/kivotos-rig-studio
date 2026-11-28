import { Matrix3, Matrix4, Vector3, type Object3D } from 'three'
import { collisionMasks } from './BodyColliders'
import type { FineClothMesh } from './ClothMeshBuilder'
import type { StudioModel } from './ModelLoader'
import { canonicalBoneName } from './RigDefinition'
import {
  axes,
  poseRegion,
  sides,
  sideOf,
  SkinDepth,
  skinnedRegion,
  topView,
  type RegionSkin,
} from './SkinnedDepth'

const directions = new Set([...Array.from({ length: sides / 2 }, (_, i) => i * 2), topView])
const envelopeViews = [0, 4, 8, 12, topView]
const upperBones = /^bip001_(?:pelvis|spine\d*|[lr]_(?:clavicle|upperarm|forearm)(?:_twist)?)$/
interface Lock {
  offset: Vector3
  filtered: Vector3
  reduction: number
  cost: number
  gain: number
}
interface Probe {
  id: number
  sides: number[]
  clearance: number[]
  influence: number
  initialDepth: number
  posed: Vector3
  locks: { lock: Lock; weight: number }[]
}

// Push whole skinned locks around the animated shoulder and sleeves, with a
// continuous falloff toward the scalp. The original hair bones keep their motion.
export class HairSurfaceContact {
  private tracking = false
  private readonly probes: Probe[] = []
  private readonly locks = new Map<Object3D, Lock>()
  private readonly region: RegionSkin[]
  private readonly depth: SkinDepth
  private readonly anchor?: Object3D
  private readonly bind = new Matrix4()
  private readonly inverse = new Matrix4()
  private readonly toWorld = new Matrix3()
  private readonly center = new Vector3()
  private readonly point = new Vector3()
  private readonly shift = new Vector3()
  private readonly height: number

  constructor(
    model: StudioModel,
    private readonly cloth: FineClothMesh,
  ) {
    this.height = Math.max(0.1, model.hipRestHeight)
    this.depth = new SkinDepth(this.height, directions)
    const bones = [...model.rest.keys()]
    const find = (name: string) => bones.find((b) => canonicalBoneName(b.name) === name)
    this.anchor = find('bip001_spine1') ?? find('bip001_spine')
    const head = find('bip001_head'),
      headY = head && model.rest.get(head)?.restWorldPos.y
    const rest = this.anchor && model.rest.get(this.anchor)
    this.region =
      rest && cloth.nodes.some((n) => n.materialMask === collisionMasks.hair && n.mobility > 0)
        ? skinnedRegion(model, upperBones)
        : []
    if (!rest || !this.region.length) return
    this.bind.compose(rest.restWorldPos, rest.restWorldQuat, rest.restWorldScale)
    this.center.copy(rest.restWorldPos)
    for (const part of this.region) for (const p of part.bind) p.sub(this.center)
    this.depth.build(this.region, true)
    cloth.nodes.forEach((n, id) => {
      if (n.materialMask !== collisionMasks.hair || !n.mobility) return
      const t =
        headY === undefined
          ? 1
          : Math.max(0, Math.min(1, (headY + this.height * 0.14 - n.bind.y) / (this.height * 0.28)))
      const influence = t * t * (3 - 2 * t) * n.mobility
      if (!influence) return
      const p = this.point.subVectors(n.bind, this.center)
      const side = (Math.round(sideOf(p) / 2) * 2) % sides
      const views = [side, (side + sides - 2) % sides, (side + 2) % sides]
      const clearance = views.map((k) => Math.min(this.height * 0.012, p.dot(axes[k]) - this.depth.at(p, k)))
      const mesh = cloth.meshes[n.meshIndex].mesh,
        attrs = mesh.geometry.attributes
      const locks: Probe['locks'] = []
      for (let j = 0; j < 4; j++) {
        const weight = attrs.skinWeight.getComponent(n.vertex, j)
        if (!weight) continue
        const bone = mesh.skeleton.bones[attrs.skinIndex.getComponent(n.vertex, j)]
        if (!/hair|ponytail|twin|braid|ahoge/i.test(bone.name)) continue
        let lock = this.locks.get(bone)
        if (!lock) {
          lock = { offset: new Vector3(), filtered: new Vector3(), reduction: 0, cost: 0, gain: 1 }
          this.locks.set(bone, lock)
        }
        locks.push({ lock, weight })
      }
      if (locks.length)
        this.probes.push({
          id,
          sides: views,
          clearance,
          influence,
          initialDepth: this.penetration(p),
          posed: new Vector3(),
          locks,
        })
    })
  }

  private penetration(p: Vector3) {
    let depth = this.height * 0.16
    for (const k of envelopeViews) {
      depth = Math.min(depth, this.depth.at(p, k) + this.height * 0.015 - p.dot(axes[k]))
      if (depth <= 0) return 0
    }
    return depth
  }

  reset() {
    this.tracking = false
  }
  checkpoint() {
    const tracking = this.tracking
    const saved = [...this.locks.values()].map((lock) => [lock, lock.filtered.clone()] as const)
    return () => {
      this.tracking = tracking
      for (const [lock, previous] of saved) lock.filtered.copy(previous)
    }
  }
  project(enabled: boolean, data: Float32Array, stride: number, dt = 0) {
    if (!this.probes.length || !this.anchor) return
    if (!enabled) {
      this.reset()
      for (const p of this.probes) data.fill(0, p.id * stride, p.id * stride + 3)
      return
    }
    this.inverse.copy(this.anchor.matrixWorld).invert().premultiply(this.bind)
    this.inverse.elements[12] -= this.center.x
    this.inverse.elements[13] -= this.center.y
    this.inverse.elements[14] -= this.center.z
    this.toWorld.setFromMatrix4(this.inverse).invert()
    poseRegion(this.region, this.inverse)
    this.depth.build(this.region, false)
    for (const lock of this.locks.values()) {
      lock.offset.set(0, 0, 0)
      lock.reduction = lock.cost = 0
    }
    for (const probe of this.probes) {
      const n = this.cloth.nodes[probe.id],
        mesh = this.cloth.meshes[n.meshIndex].mesh
      const p = mesh
        .getVertexPosition(n.vertex, probe.posed)
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(this.inverse)
      let axis = axes[probe.sides[0]]
      let depth = this.depth.at(p, probe.sides[0]) + probe.clearance[0] - p.dot(axis)
      if (!(depth > 1e-6)) continue
      for (let j = 1; j < probe.sides.length; j++) {
        const k = probe.sides[j],
          d = this.depth.at(p, k) + probe.clearance[j] - p.dot(axes[k])
        if (d > 0 && d < depth * 0.78) {
          depth = d
          axis = axes[k]
        }
      }
      const target = Math.min(depth, this.height * 0.18)
      for (const { lock, weight } of probe.locks) {
        const deficit = target - lock.offset.dot(axis)
        if (deficit > 0) lock.offset.addScaledVector(axis, deficit * weight * probe.influence)
      }
    }
    for (const lock of this.locks.values()) lock.offset.clampLength(0, this.height * 0.16)
    for (const probe of this.probes) {
      const p = probe.posed
      const start = Math.max(0, this.penetration(p) - probe.initialDepth)
      for (const { lock, weight } of probe.locks) {
        const lengthSq = lock.offset.lengthSq()
        if (lengthSq < 1e-12) continue
        this.point.copy(p).addScaledVector(lock.offset, probe.influence)
        const end = Math.max(0, this.penetration(this.point) - probe.initialDepth)
        const change = start - end
        lock.reduction += weight * start * change
        lock.cost += weight * (change * change + 0.002 * lengthSq * probe.influence ** 2)
      }
    }
    // Least-squares step along the proposed correction. A lock with no new
    // penetration stays on its authored trajectory. Clear probes also count
    // against a move which would push them into the other side of the arm.
    for (const lock of this.locks.values())
      lock.gain = lock.cost > 0 ? Math.max(0, Math.min(1, lock.reduction / lock.cost)) : 0
    const blend = this.tracking && dt > 0 ? -Math.expm1(-23 * dt) : 1
    this.tracking = true
    for (const lock of this.locks.values()) lock.filtered.lerp(lock.offset.multiplyScalar(lock.gain), blend)
    for (const probe of this.probes) {
      this.shift.set(0, 0, 0)
      for (const { lock, weight } of probe.locks) this.shift.addScaledVector(lock.filtered, weight)
      this.shift
        .multiplyScalar(probe.influence)
        .applyMatrix3(this.toWorld)
        .toArray(data, probe.id * stride)
    }
  }
}
