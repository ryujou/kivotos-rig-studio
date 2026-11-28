import { type Matrix4, SkinnedMesh, Vector3 } from 'three'
import { bindSkinMatrices } from './BodyColliders'
import { clothLocalPoint, type ClothFace } from './ClothMeshBuilder'
import type { StudioModel } from './ModelLoader'
import { canonicalBoneName } from './RigDefinition'

const scratch = new Vector3()
export const sides = 16
export const axes = Array.from(
  { length: sides },
  (_, i) => new Vector3(Math.cos((i * Math.PI * 2) / sides), 0, Math.sin((i * Math.PI * 2) / sides)),
)
export const topView = axes.length
axes.push(new Vector3(0, 1, 0))
export const sideOf = (p: Vector3) =>
  (Math.round((Math.atan2(p.z, p.x) * sides) / (2 * Math.PI)) + sides) % sides
export type RegionSkin = {
  mesh: SkinnedMesh
  indices: number[]
  bind: Vector3[]
  posed: Vector3[]
  faces: ClothFace[]
}
export function skinnedRegion(model: StudioModel, bones: RegExp): RegionSkin[] {
  const result: RegionSkin[] = []
  for (const mesh of model.bodyMeshes) {
    if (!(mesh instanceof SkinnedMesh)) continue
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes
    if (!skinWeight || !skinIndex) continue
    const matrices = bindSkinMatrices(model, mesh)
    const selected = mesh.skeleton.bones.map((b) => bones.test(canonicalBoneName(b.name)))
    const map = new Int32Array(position.count).fill(-1)
    const indices: number[] = [],
      bind: Vector3[] = [],
      faces: ClothFace[] = []
    for (let i = 0; i < position.count; i++) {
      let weight = 0
      for (let j = 0; j < 4; j++)
        if (selected[skinIndex.getComponent(i, j)]) weight += skinWeight.getComponent(i, j)
      if (weight < 0.6) continue
      map[i] = indices.length
      indices.push(i)
      const p = new Vector3()
      const local = clothLocalPoint(mesh, i, model.restMorphWeights.get(mesh), new Vector3())
      for (let j = 0; j < 4; j++) {
        const w = skinWeight.getComponent(i, j),
          m = matrices[skinIndex.getComponent(i, j)]
        if (w && m) p.addScaledVector(scratch.copy(local).applyMatrix4(m), w)
      }
      bind.push(p)
    }
    const index = mesh.geometry.index
    for (let i = 0; i + 2 < (index?.count ?? map.length); i += 3) {
      const a = map[index?.getX(i) ?? i],
        b = map[index?.getX(i + 1) ?? i + 1],
        c = map[index?.getX(i + 2) ?? i + 2]
      if (a >= 0 && b >= 0 && c >= 0) faces.push([a, b, c])
    }
    if (faces.length) result.push({ mesh, indices, bind, posed: bind.map(() => new Vector3()), faces })
  }
  return result
}

// Orthographic depths of the animated skin in a bone-relative frame. Rasterize on a
// fixed-size grid so the cost of looking up contact depth is independent of body tessellation.
export class SkinDepth {
  private readonly size = 48
  private readonly layers: (Float32Array | undefined)[] = []
  constructor(
    private readonly height: number,
    private readonly active: Set<number>,
  ) {}
  build(region: RegionSkin[], bind: boolean) {
    const n = this.size,
      scale = n / (2.8 * this.height)
    for (const side of this.active) {
      const layer = (this.layers[side] ??= new Float32Array(n * n)),
        axis = axes[side]
      layer.fill(-Infinity)
      for (const part of region) {
        const pts = bind ? part.bind : part.posed
        for (const [a, b, c] of part.faces) {
          const p = pts[a],
            q = pts[b],
            r = pts[c]
          const x = (side === topView ? p.x : axis.x * p.z - axis.z * p.x) * scale + n / 2,
            y = (side === topView ? p.z : p.y) * scale + n / 2
          const u = (side === topView ? q.x - p.x : axis.x * (q.z - p.z) - axis.z * (q.x - p.x)) * scale,
            v = (side === topView ? q.z - p.z : q.y - p.y) * scale
          const s = (side === topView ? r.x - p.x : axis.x * (r.z - p.z) - axis.z * (r.x - p.x)) * scale,
            t = (side === topView ? r.z - p.z : r.y - p.y) * scale
          const det = u * t - v * s
          if (Math.abs(det) < 1e-9) continue
          const loX = Math.max(0, Math.ceil(x + Math.min(0, u, s))),
            hiX = Math.min(n - 1, Math.floor(x + Math.max(0, u, s)))
          const loY = Math.max(0, Math.ceil(y + Math.min(0, v, t))),
            hiY = Math.min(n - 1, Math.floor(y + Math.max(0, v, t)))
          const d = p.dot(axis),
            e = q.dot(axis) - d,
            f = r.dot(axis) - d
          for (let j = loY; j <= hiY; j++)
            for (let i = loX; i <= hiX; i++) {
              const w = ((i - x) * t - (j - y) * s) / det,
                h = (u * (j - y) - v * (i - x)) / det
              if (w < 0 || h < 0 || w + h > 1) continue
              const at = j * n + i
              layer[at] = Math.max(layer[at], d + e * w + f * h)
            }
        }
      }
    }
  }
  at(p: Vector3, side: number) {
    const n = this.size,
      k = n / (2.8 * this.height),
      axis = axes[side]
    const x = (side === topView ? p.x : axis.x * p.z - axis.z * p.x) * k + n / 2,
      y = (side === topView ? p.z : p.y) * k + n / 2
    const i = Math.floor(x),
      j = Math.floor(y)
    if (i < 0 || j < 0 || i + 1 >= n || j + 1 >= n) return -Infinity
    const dx = x - i,
      dy = y - j,
      data = this.layers[side],
      at = j * n + i
    if (!data) return -Infinity
    const a = data[at],
      b = data[at + 1],
      c = data[at + n],
      d = data[at + n + 1]
    if (Number.isFinite(a + b + c + d))
      return (1 - dy) * ((1 - dx) * a + dx * b) + dy * ((1 - dx) * c + dx * d)
    return Math.max(a, b, c, d)
  }
}

export function poseRegion(region: RegionSkin[], inverse: Matrix4) {
  for (const part of region)
    for (let i = 0; i < part.indices.length; i++)
      part.mesh
        .getVertexPosition(part.indices[i], part.posed[i])
        .applyMatrix4(part.mesh.matrixWorld)
        .applyMatrix4(inverse)
}
