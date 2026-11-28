import { Matrix4, SkinnedMesh, Vector3, type Object3D } from 'three'
import { canonicalBoneName } from './RigDefinition'
import { bindSkinMatrices, type BodyColliders } from './BodyColliders'
import type { StudioModel } from './ModelLoader'
import type { SpringBoneSolver } from './SpringBoneSolver'

const sides = 16
const normals = Array.from(
  { length: sides },
  (_, i) => new Vector3(Math.cos((i * 2 * Math.PI) / sides), 0, Math.sin((i * 2 * Math.PI) / sides)),
)
const bins = 32

// Cross sections of the legs in the pelvis' bind coordinate system. Interpolating
// neighbouring sections keeps contact continuous when a knee passes a coat panel.
class LegEnvelope {
  private readonly extent = new Float32Array(bins * sides)
  constructor(
    private readonly bottom: number,
    private readonly spacing: number,
  ) {
    this.clear()
  }
  clear() {
    this.extent.fill(-Infinity)
  }
  include(p: Vector3) {
    const height = (p.y - this.bottom) / this.spacing
    const lo = Math.max(0, Math.ceil(height - 1.5)),
      hi = Math.min(bins - 1, Math.floor(height + 1.5))
    for (let i = 0; i < sides; i++) {
      const support = p.dot(normals[i])
      for (let j = lo; j <= hi; j++) {
        const index = j * sides + i
        this.extent[index] = Math.max(this.extent[index], support)
      }
    }
  }
  at(y: number, side: number) {
    const height = (y - this.bottom) / this.spacing
    if (height < 0 || height >= bins - 1) return -Infinity
    const row = Math.floor(height),
      a = this.extent[row * sides + side],
      b = this.extent[(row + 1) * sides + side]
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Math.max(a, b)
    return a + (b - a) * (height - row)
  }
}

type Panel = {
  bone: Object3D
  probes: { local: Vector3; side: number; gap: number }[]
  base: Vector3
}

// A knee can intersect the interior of a triangle while clearing its vertices.
// Keep representative face centers per panel and skin them with the panel at runtime.
function panelFaceCenters(model: StudioModel, panels: Set<Object3D>, spacing: number) {
  const centers = new Map<Object3D, Map<string, Vector3>>()
  const part = new Vector3()
  for (const mesh of model.bodyMeshes) {
    if (!(mesh instanceof SkinnedMesh)) continue
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes
    if (!position || !skinIndex || !skinWeight) continue
    const bones = mesh.skeleton.bones
    if (!bones.some((bone) => panels.has(bone))) continue
    const matrices = bindSkinMatrices(model, mesh)
    const owners = Array.from({ length: position.count }, (_, i) => {
      let largest = 0
      let owner: Object3D | undefined
      for (let j = 0; j < skinWeight.itemSize; j++) {
        const weight = skinWeight.getComponent(i, j)
        if (weight > largest) {
          largest = weight
          owner = bones[skinIndex.getComponent(i, j)]
        }
      }
      return owner
    })
    const vertices: Vector3[] = []
    const vertex = (i: number) => {
      if (vertices[i]) return vertices[i]
      const p = new Vector3()
      for (let j = 0; j < skinWeight.itemSize; j++) {
        const weight = skinWeight.getComponent(i, j)
        const matrix = matrices[skinIndex.getComponent(i, j)]
        if (matrix && weight > 0)
          p.addScaledVector(part.fromBufferAttribute(position, i).applyMatrix4(matrix), weight)
      }
      return (vertices[i] = p)
    }
    const indices = mesh.geometry.index
    const count = indices?.count ?? position.count
    for (let i = 0; i + 2 < count; i += 3) {
      const a = indices?.getX(i) ?? i,
        b = indices?.getX(i + 1) ?? i + 1,
        c = indices?.getX(i + 2) ?? i + 2
      const owner =
        owners[a] === owners[b] || owners[a] === owners[c]
          ? owners[a]
          : owners[b] === owners[c]
            ? owners[b]
            : undefined
      if (!owner || !panels.has(owner)) continue
      let cells = centers.get(owner)
      if (!cells) centers.set(owner, (cells = new Map()))
      const center = vertex(a)
        .clone()
        .add(vertex(b))
        .add(vertex(c))
        .multiplyScalar(1 / 3)
      const cell = [center.x, center.y, center.z].map((value) => Math.round(value / spacing)).join(',')
      cells.set(cell, center)
    }
  }
  return centers
}

export class SkirtClearance {
  private readonly legs: { bone: Object3D; points: Vector3[] }[] = []
  private readonly panels: Panel[] = []
  private pelvis?: Object3D
  private readonly pelvisBind = new Matrix4()
  private readonly frame = new Matrix4()
  private readonly transform = new Matrix4()
  private readonly parentInverse = new Matrix4()
  private readonly point = new Vector3()
  private readonly shift = new Vector3()
  private envelope?: LegEnvelope
  private applied = false

  constructor(model: StudioModel, solver: SpringBoneSolver, colliders: BodyColliders) {
    const panels = solver.particles.filter((p) => p.material === 'skirt')
    if (!panels.length || !colliders.legSurface.size) return
    const bindMatrix = (bone: Object3D) => {
      const r = model.rest.get(bone)!
      return new Matrix4().compose(r.restWorldPos, r.restWorldQuat, r.restWorldScale)
    }
    for (const [bone] of model.rest) {
      if (canonicalBoneName(bone.name) === 'bip001_pelvis') this.pelvis = bone
    }
    if (!this.pelvis) return
    const center = model.rest.get(this.pelvis)!.restWorldPos
    this.pelvisBind.copy(bindMatrix(this.pelvis))
    const height = Math.max(0.1, model.hipRestHeight)
    const envelope = new LegEnvelope(center.y - height * 1.2, (height * 1.85) / (bins - 1))
    const faceCenters = panelFaceCenters(model, new Set(panels.map((p) => p.bone)), height / 26)
    for (const [bone, points] of colliders.legSurface) {
      const inverse = bindMatrix(bone).invert()
      for (const p of points) envelope.include(p)
      this.legs.push({ bone, points: points.map((p) => p.clone().applyMatrix4(inverse)) })
    }
    for (const p of panels) {
      const bind = bindMatrix(p.bone)
      const inverse = bind.clone().invert()
      const centers = faceCenters.get(p.bone)?.values() ?? []
      const localPoints = [
        ...(colliders.skinProbes.get(p.bone) ?? []),
        ...Array.from(centers, (v) => v.applyMatrix4(inverse)),
      ]
      const probes = localPoints.map((local) => {
        const point = local.clone().applyMatrix4(bind)
        const angle = Math.atan2(point.z - center.z, point.x - center.x)
        const side = (Math.round((angle * sides) / (2 * Math.PI)) + sides) % sides
        const gap = point.dot(normals[side]) - envelope.at(point.y, side)
        // Above the resting thighs the section is empty. A raised knee can still
        // reach that same patch during a crouch, so keep it as a zero-clearance probe.
        return { local, side, gap: Number.isFinite(gap) ? Math.min(0.09 * height, gap) : 0 }
      })
      if (probes.length) this.panels.push({ bone: p.bone, probes, base: new Vector3() })
    }
    if (this.panels.length) this.envelope = envelope
  }

  restore() {
    if (!this.applied) return
    for (const p of this.panels) {
      p.bone.position.copy(p.base)
      p.bone.updateWorldMatrix(false, true)
    }
    this.applied = false
  }

  apply() {
    const envelope = this.envelope
    this.restore()
    if (!envelope || !this.pelvis || !this.pelvis.matrixWorld.determinantAffine()) return
    envelope.clear()
    this.frame.copy(this.pelvis.matrixWorld).invert().premultiply(this.pelvisBind)
    for (const leg of this.legs) {
      this.transform.multiplyMatrices(this.frame, leg.bone.matrixWorld)
      for (const p of leg.points) envelope.include(this.point.copy(p).applyMatrix4(this.transform))
    }
    for (const panel of this.panels) {
      const bone = panel.bone
      panel.base.copy(bone.position)
      this.transform.multiplyMatrices(this.frame, bone.matrixWorld)
      this.shift.set(0, 0, 0)
      // Project a panel against its authored outer half-spaces. This also catches
      // knees which have already crossed an open coat between two sampled poses.
      for (const { local, side, gap } of panel.probes) {
        this.point.copy(local).applyMatrix4(this.transform).add(this.shift)
        const normal = normals[side]
        const depth = envelope.at(this.point.y, side) + gap - this.point.dot(normal)
        if (depth > 0.00001) this.shift.addScaledVector(normal, depth)
      }
      if (!this.shift.lengthSq()) continue
      this.parentInverse.multiplyMatrices(this.frame, bone.parent!.matrixWorld).invert()
      this.point.setFromMatrixPosition(this.parentInverse)
      bone.position.add(this.shift.applyMatrix4(this.parentInverse).sub(this.point))
      bone.updateWorldMatrix(false, true)
    }
    this.applied = true
  }
}
