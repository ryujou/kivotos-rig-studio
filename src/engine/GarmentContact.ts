import { Line3, Matrix3, Matrix4, Triangle, Vector3 } from 'three'
import { collisionMasks, type BodyColliders } from './BodyColliders'
import { UNSIMULATED, type ClothFace, type FineClothMesh } from './ClothMeshBuilder'
import type { StudioModel } from './ModelLoader'
import { canonicalBoneName } from './RigDefinition'

import { axes, sideOf, topView, SkinDepth, skinnedRegion, poseRegion, type RegionSkin } from './SkinnedDepth'

import { GarmentDisplacementField } from './GarmentDisplacementField'
import { HairSurfaceContact } from './HairSurfaceContact'

const combinations = [
  [0, 1],
  [1, 2],
  [2, 0],
] as const
const aPoint = new Vector3(),
  bPoint = new Vector3(),
  onFace = new Vector3(),
  bary = new Vector3()
const edge = new Line3(),
  normal = new Vector3(),
  scratch = new Vector3(),
  chord = new Vector3()

// Return the closest point ON the triangle, including a segment piercing its interior.
export function closestFacePoint(axis: Line3, t: Triangle, out: Vector3) {
  t.getNormal(normal)
  const denom = normal.dot(chord.subVectors(axis.end, axis.start))
  if (Math.abs(denom) > 1e-10) {
    const u = normal.dot(scratch.subVectors(t.a, axis.start)) / denom
    if (u >= 0 && u <= 1 && t.containsPoint(axis.at(u, aPoint))) {
      out.copy(aPoint)
      return 0
    }
  }
  let best = Infinity
  for (const end of [axis.start, axis.end]) {
    t.closestPointToPoint(end, aPoint)
    const sq = aPoint.distanceToSquared(end)
    if (sq < best) {
      best = sq
      out.copy(aPoint)
    }
  }
  const corners = [t.a, t.b, t.c]
  for (const [a, b] of combinations) {
    edge.start = corners[a]
    edge.end = corners[b]
    const sq = axis.distanceSqToLine3(edge, aPoint, bPoint)
    if (sq < best) {
      best = sq
      out.copy(bPoint)
    }
  }
  return Math.max(0, best)
}

const weights = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.5, 0.5, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
  [1 / 3, 1 / 3, 1 / 3],
]
interface Patch {
  ids: ClothFace
  side: number
  gaps: number[]
}
const triangle = new Triangle(),
  interp = new Vector3(),
  dp = new Vector3()
function blend(points: Vector3[], ids: ClothFace, weights: ArrayLike<number>, out: Vector3) {
  return out
    .copy(points[ids[0]])
    .multiplyScalar(weights[0])
    .addScaledVector(points[ids[1]], weights[1])
    .addScaledVector(points[ids[2]], weights[2])
}

// Packet per welded node, shared by the CPU reference and the WGSL projection.
// Body displacement, vertex/face indices, signed barycentrics, separating plane,
// then the receiving particle's mass-weighted share and its mesh palette index.
export const contactStride = 20
export class GarmentContact {
  readonly data: Float32Array
  readonly ids: Uint32Array
  readonly skin: Vector3[]
  private readonly local: Vector3[]
  private readonly shifts: Vector3[]
  private readonly skinnedLocal: Vector3[]
  private readonly previousSurface: Vector3[]
  private hasPreviousSurface = false
  private readonly contactMass: Float32Array
  private readonly panelEdges
  private readonly patches: Patch[] = []
  private readonly inverse = new Matrix4()
  private readonly frame = new Matrix4()
  private readonly pelvis
  private readonly layerField: GarmentDisplacementField
  private readonly hair: HairSurfaceContact
  private readonly legs: RegionSkin[]
  private readonly capsules
  private previousAxes: Line3[] = []
  private readonly bindDepth: SkinDepth
  private readonly depth: SkinDepth
  private readonly height: number
  private readonly neighbors: Set<number>[]
  private readonly scores: Float32Array
  private readonly rests: Vector3[]
  private readonly contactDirection = new Vector3()
  private readonly bodyNormal = new Vector3()
  private readonly mat = new Matrix3()
  private readonly thickness: number
  private readonly garmentFaces: ClothFace[]
  private readonly garmentNodes: number[]
  private readonly floorNodes: number[] = []
  private readonly floorOnly: number[] = []

  constructor(
    private readonly model: StudioModel,
    readonly cloth: FineClothMesh,
    readonly colliders: BodyColliders,
  ) {
    const nodes = cloth.nodes
    this.data = new Float32Array(nodes.length * contactStride)
    this.ids = new Uint32Array(this.data.buffer)
    this.skin = nodes.map(() => new Vector3())
    this.local = nodes.map(() => new Vector3())
    this.shifts = nodes.map(() => new Vector3())
    this.skinnedLocal = nodes.map(() => new Vector3())
    this.previousSurface = nodes.map(() => new Vector3())
    this.contactMass = new Float32Array(nodes.length)
    this.scores = new Float32Array(nodes.length)
    this.neighbors = nodes.map((_, i) => new Set([i]))
    for (const e of cloth.edges) {
      this.neighbors[e.a].add(e.b)
      this.neighbors[e.b].add(e.a)
    }
    this.garmentFaces = cloth.faces.filter((ids) =>
      ids.some((i) => {
        const mask = nodes[i].materialMask
        return mask === collisionMasks.skirt || mask === collisionMasks.cloth
      }),
    )
    const garmentIds = new Set(this.garmentFaces.flat())
    this.garmentNodes = [...garmentIds]
    this.panelEdges = cloth.edges.filter((e) => !e.bending && garmentIds.has(e.a) && garmentIds.has(e.b))
    nodes.forEach((n, i) => {
      this.data[i * contactStride + 17] = n.meshIndex
      if (n.mobility && [collisionMasks.skirt, collisionMasks.cloth, collisionMasks.tail].includes(n.materialMask)) {
        this.floorNodes.push(i)
        if (!garmentIds.has(i)) this.floorOnly.push(i)
      }
    })
    this.pelvis = Array.from(model.rest.keys()).find((b) => canonicalBoneName(b.name) === 'bip001_pelvis')
    const rest = this.pelvis && model.rest.get(this.pelvis)
    this.height = Math.max(0.1, model.hipRestHeight)
    this.hair = new HairSurfaceContact(model, cloth)
    this.thickness = Math.min(0.006, this.height * 0.012)
    // Keep bind axes stage-aligned even for rigs with a rotated pelvis bone.
    if (rest) this.frame.compose(rest.restWorldPos, rest.restWorldQuat, rest.restWorldScale)
    this.rests = nodes.map((n) => n.bind.clone().sub(rest?.restWorldPos ?? new Vector3()))
    this.layerField = new GarmentDisplacementField(cloth, this.height)
    this.legs = skinnedRegion(model, /^bip001_[lr]_(thigh|calf|foot)(?:_twist)?$/)
    for (const leg of this.legs) for (const p of leg.bind) if (rest) p.sub(rest.restWorldPos)
    this.capsules = colliders.legCapsules
    const active = new Set<number>()
    this.depth = new SkinDepth(this.height, active)
    for (const ids of cloth.faces) {
      if (!ids.some((i) => nodes[i].materialMask === collisionMasks.skirt)) continue
      const side = sideOf(blend(this.rests, ids, weights[6], interp))
      for (let k = 0; k <= topView; k++) active.add(k)
      this.patches.push({ ids, side, gaps: [] })
    }
    this.bindDepth = new SkinDepth(this.height, active)
    this.bindDepth.build(this.legs, true)
    for (const patch of this.patches)
      for (const w of weights) {
        blend(this.rests, patch.ids, w, interp)
        const gap = interp.dot(axes[patch.side]) - this.bindDepth.at(interp, patch.side)
        patch.gaps.push(Math.min(this.thickness, gap))
      }
  }

  reset() {
    this.hair.reset()
    this.layerField.reset()
    this.previousAxes = []
    this.hasPreviousSurface = false
    for (const i of this.garmentNodes) this.data[i * contactStride + 16] = 0
  }
  checkpoint() {
    const restoreHair = this.hair.checkpoint(),
      restoreField = this.layerField.checkpoint()
    const previous = this.previousAxes.map((l) => l.clone())
    const packet = this.data.slice()
    const previousSurface = this.hasPreviousSurface ? this.previousSurface.map((p) => p.clone()) : null
    return () => {
      restoreHair()
      restoreField()
      this.previousAxes = previous
      this.data.set(packet)
      this.hasPreviousSurface = !!previousSurface
      previousSurface?.forEach((p, i) => this.previousSurface[i].copy(p))
    }
  }

  prepare(body: boolean, stride: number, dt = 0) {
    const { nodes, meshes } = this.cloth
    const rest = this.pelvis && this.model.rest.get(this.pelvis)
    const toLocal = this.inverse.identity()
    if (rest && this.pelvis) {
      toLocal.copy(this.pelvis.matrixWorld).invert().premultiply(this.frame)
      toLocal.elements[12] -= rest.restWorldPos.x
      toLocal.elements[13] -= rest.restWorldPos.y
      toLocal.elements[14] -= rest.restWorldPos.z
    } else if (this.model.root.parent) toLocal.copy(this.model.root.parent.matrixWorld).invert()
    const toWorld = this.mat.setFromMatrix4(toLocal).invert()
    for (const i of this.garmentNodes) {
      if (stride) this.data.fill(0, i * contactStride, (i + 1) * contactStride)
      const n = nodes[i],
        mesh = meshes[n.meshIndex].mesh
      mesh.getVertexPosition(n.vertex, this.skin[i]).applyMatrix4(mesh.matrixWorld)
      this.local[i].copy(this.skin[i]).applyMatrix4(toLocal)
      this.skinnedLocal[i].copy(this.local[i])
      if (this.hasPreviousSurface) {
        dp.subVectors(this.previousSurface[i], this.local[i]).clampLength(0, this.height * 0.45)
        this.skinnedLocal[i].add(dp)
      }
      this.shifts[i].set(0, 0, 0)
      this.data[i * contactStride + 17] = n.meshIndex
    }
    if (!body) {
      this.previousAxes = []
      this.layerField.reset()
    }
    const hasLegContact = body && rest && this.patches.length > 0
    if (hasLegContact) poseRegion(this.legs, toLocal)
    if (hasLegContact && this.legContactMoved()) {
      this.depth.build(this.legs, false)
      this.colliders.update()
      const current = this.capsules.map(
        (cap) => new Line3(cap.a.clone().applyMatrix4(toLocal), cap.b.clone().applyMatrix4(toLocal)),
      )
      const sweeps = current.flatMap((l, i) => {
        const old = this.previousAxes[i],
          r = this.capsules[i].bindRadius
        if (!old || Math.max(l.start.distanceToSquared(old.start), l.end.distanceToSquared(old.end)) < r * r)
          return [{ axis: l, i }]
        return [l, new Line3(old.start, l.start), new Line3(old.end, l.end)].map((axis) => ({ axis, i }))
      })
      for (const patch of this.patches) {
        const { ids, side, gaps } = patch,
          direction = axes[side]
        const push = (w: ArrayLike<number>, gap: number, fallbackDepth = 0) => {
          blend(this.local, ids, w, interp)
          const surface = this.depth.at(interp, side)
          let depth = Number.isFinite(surface) ? surface + gap - interp.dot(direction) : fallbackDepth
          let outward = direction
          // Near the crown of a bent knee, the shorter exit is often upward or
          // sideways. Blend the two projections across the contact band so a
          // moving fold doesn't flip between raster directions in one frame.
          const t = Math.max(0, Math.min(1, (depth / this.height - 0.04) / 0.1))
          if (t > 0 && Number.isFinite(surface)) {
            const blend = t * t * (3 - 2 * t),
              above = this.depth.at(interp, topView) + this.thickness - interp.y
            const top = Number.isFinite(above) && above < depth
            const preferred = top ? axes[topView] : direction
            const preferredDepth = top ? Math.max(0, above) : depth
            let shortest = preferredDepth,
              exit = preferred
            for (let k = 0; k < topView; k++) {
              const axis = axes[k],
                distance = this.depth.at(interp, k) + this.thickness - interp.dot(axis)
              if (distance <= 0) {
                shortest = 0
                break
              }
              if (axis.dot(direction) > 0.35 && distance < shortest) {
                shortest = distance
                exit = axis
              }
            }
            outward = this.contactDirection
              .copy(direction)
              .multiplyScalar((1 - blend) * depth)
              .addScaledVector(preferred, blend * 0.3 * preferredDepth)
              .addScaledVector(exit, blend * 0.7 * shortest)
            depth = outward.length()
            if (depth > 0) outward.divideScalar(depth)
          }
          if (!(depth > 1e-5)) return
          blend(this.shifts, ids, w, dp)
          const remaining = depth - dp.dot(outward)
          if (remaining <= 0) return
          let denom = 0
          for (let j = 0; j < 3; j++) denom += nodes[ids[j]].mobility * w[j] * w[j]
          if (denom < 1e-6) return
          for (let j = 0; j < 3; j++) {
            const scale = Math.min((remaining / denom) * w[j] * nodes[ids[j]].mobility, this.height * 0.22)
            if (scale > 0) this.shifts[ids[j]].addScaledVector(outward, scale)
          }
        }
        for (let i = 0; i < weights.length; i++) push(weights[i], gaps[i])
        triangle.set(this.local[ids[0]], this.local[ids[1]], this.local[ids[2]])
        const minY = Math.min(triangle.a.y, triangle.b.y, triangle.c.y),
          maxY = Math.max(triangle.a.y, triangle.b.y, triangle.c.y)
        for (const { axis, i } of sweeps) {
          const r = this.height * 0.22
          if (
            minY > Math.max(axis.start.y, axis.end.y) + r ||
            maxY < Math.min(axis.start.y, axis.end.y) - r ||
            Math.min(triangle.a.x, triangle.b.x, triangle.c.x) > Math.max(axis.start.x, axis.end.x) + r ||
            Math.max(triangle.a.x, triangle.b.x, triangle.c.x) < Math.min(axis.start.x, axis.end.x) - r ||
            Math.min(triangle.a.z, triangle.b.z, triangle.c.z) > Math.max(axis.start.z, axis.end.z) + r ||
            Math.max(triangle.a.z, triangle.b.z, triangle.c.z) < Math.min(axis.start.z, axis.end.z) - r
          )
            continue
          if (closestFacePoint(axis, triangle, onFace) > r * r || !triangle.getBarycoord(onFace, bary))
            continue
          const w = bary.toArray()
          blend(this.rests, ids, w, interp)
          const gap = Math.min(this.thickness, interp.dot(direction) - this.bindDepth.at(interp, side))
          // A sparse leg mesh may leave this raster cell empty. Its capsule still
          // supports the face, limited by the original skin-to-axis clearance.
          if (Number.isFinite(this.depth.at(onFace, side))) {
            push(w, gap)
            continue
          }
          const cap = this.capsules[i]
          const restPoint = dp.copy(interp).add(rest.restWorldPos)
          const bindRadius = Math.min(
            cap.bindRadius + this.thickness,
            cap.bindAxis.closestPointToPoint(restPoint, true, scratch).distanceTo(restPoint),
          )
          const delta = this.bodyNormal.subVectors(onFace, axis.closestPointToPoint(onFace, true, scratch))
          const along = delta.dot(direction),
            sq = delta.lengthSq()
          const depth =
            sq < bindRadius ** 2 ? Math.sqrt(Math.max(0, bindRadius ** 2 - sq + along ** 2)) - along : 0
          push(w, gap, depth)
        }
      }
      this.limitStretch()
      this.layerField.project(this.local, this.shifts, dt)
      this.previousAxes = current
    } else if (hasLegContact) {
      this.previousAxes = []
      this.layerField.reset()
    }
    for (const i of this.garmentNodes) {
      this.local[i].add(this.shifts[i])
      this.shifts[i].applyMatrix3(toWorld).toArray(this.data, i * contactStride)
    }
    if (stride > 0) {
      this.prepareLayers(stride, toWorld)
      for (const i of this.garmentNodes) this.previousSurface[i].copy(this.local[i])
      this.hasPreviousSurface = true
    }
    this.hair.project(body, this.data, contactStride, dt)
    // A tail tip or the edge of a train can touch the floor while its
    // controlling bone is still above it. Project the posed surface as well.
    for (const i of this.floorOnly) {
      const at = i * contactStride
      this.data.fill(0, at, at + 3)
      if (!body) continue
      const n = nodes[i], mesh = meshes[n.meshIndex].mesh
      mesh.getVertexPosition(n.vertex, this.skin[i]).applyMatrix4(mesh.matrixWorld)
    }
    for (const i of this.floorNodes) this.data[i * contactStride + 3] = Number(body)
    return this.data
  }

  // Avoid raster and capsule corrections to the imported silhouette when only
  // the whole actor moved on stage. Capsule-only rigs have no skin to compare.
  private legContactMoved() {
    if (!this.legs.length) return true
    const toleranceSq = (this.height * 1e-6) ** 2
    return (
      this.garmentNodes.some((i) => this.local[i].distanceToSquared(this.rests[i]) > toleranceSq) ||
      this.legs.some((part) => part.posed.some((p, i) => p.distanceToSquared(part.bind[i]) > toleranceSq))
    )
  }

  // Limit elongation relative to the animated pose. A nearby free corner shares
  // the load before a contacting corner yields; a painted waist has zero mass.
  private limitStretch() {
    let active = false
    for (const i of this.garmentNodes) {
      const shift = this.shifts[i],
        touching = shift.lengthSq() > 1e-12
      active ||= touching
      shift.clampLength(0, this.height * 0.08)
      this.contactMass[i] = this.cloth.nodes[i].mobility * (touching ? 0.065 : 1)
    }
    if (!active) return
    for (let iteration = 0; iteration < 4; iteration++)
      for (const { a, b } of this.panelEdges) {
        const wa = this.contactMass[a],
          wb = this.contactMass[b],
          offsetA = this.shifts[a],
          offsetB = this.shifts[b]
        if (wa + wb === 0 || (offsetA.lengthSq() === 0 && offsetB.lengthSq() === 0)) continue
        const goal = this.local[a].distanceTo(this.local[b]) * 1.4 + this.thickness
        const delta = dp.copy(this.local[a]).add(offsetA).sub(this.local[b]).sub(offsetB)
        const length = delta.length()
        if (length <= goal) continue
        delta.multiplyScalar((1 - goal / length) / (wa + wb))
        offsetA.addScaledVector(delta, -wa)
        offsetB.addScaledVector(delta, wb)
      }
  }

  private prepareLayers(stride: number, toWorld: Matrix3) {
    const { nodes } = this.cloth,
      faces = this.garmentFaces,
      pts = this.local,
      gap = this.thickness
    const cell = this.height * 0.12,
      reach = gap * 2
    const start = this.skinnedLocal,
      startTriangle = new Triangle(),
      startNormal = new Vector3(),
      sweepTriangle = new Triangle()
    const buckets = new Map<number, number[]>(),
      key = (x: number, y: number, z: number) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791)
    this.scores.fill(0)
    this.worldNormal.copy(toWorld).invert().transpose()
    // Bin probe particles; scanning bounded face AABBs avoids duplicating large
    // faces across the entire grid. Hash aliases only add narrow-phase work.
    for (let j = 0; j < this.garmentNodes.length; j += stride) {
      const i = this.garmentNodes[j],
        p = pts[i],
        s = start[i]
      for (let x = Math.floor(Math.min(p.x, s.x) / cell); x <= Math.floor(Math.max(p.x, s.x) / cell); x++)
        for (let y = Math.floor(Math.min(p.y, s.y) / cell); y <= Math.floor(Math.max(p.y, s.y) / cell); y++)
          for (
            let z = Math.floor(Math.min(p.z, s.z) / cell);
            z <= Math.floor(Math.max(p.z, s.z) / cell);
            z++
          ) {
            const k = key(x, y, z),
              group = buckets.get(k)
            if (group) group.push(i)
            else buckets.set(k, [i])
          }
    }
    for (const ids of faces) {
      const [a, b, c] = ids,
        p = pts[a],
        q = pts[b],
        r = pts[c]
      triangle.set(p, q, r)
      triangle.getNormal(normal)
      startTriangle.set(start[a], start[b], start[c]).getNormal(startNormal)
      if (normal.lengthSq() < 0.5) continue
      const minX = Math.floor((Math.min(p.x, q.x, r.x, start[a].x, start[b].x, start[c].x) - reach) / cell),
        maxX = Math.floor((Math.max(p.x, q.x, r.x, start[a].x, start[b].x, start[c].x) + reach) / cell)
      const minY = Math.floor((Math.min(p.y, q.y, r.y, start[a].y, start[b].y, start[c].y) - reach) / cell),
        maxY = Math.floor((Math.max(p.y, q.y, r.y, start[a].y, start[b].y, start[c].y) + reach) / cell)
      const minZ = Math.floor((Math.min(p.z, q.z, r.z, start[a].z, start[b].z, start[c].z) - reach) / cell),
        maxZ = Math.floor((Math.max(p.z, q.z, r.z, start[a].z, start[b].z, start[c].z) + reach) / cell)
      // Pathological poses can stretch an edge across the scene. In that case
      // testing the existing probe list costs less than visiting empty cells.
      const visit = (i: number) => {
        const adj = this.neighbors[i]
        if (adj.has(a) || adj.has(b) || adj.has(c)) return
        const h = dp.subVectors(pts[i], p).dot(normal)
        const h0 = dp.subVectors(start[i], start[a]).dot(startNormal)
        const crossed = h * h0 < 0 && Math.abs(h - h0) > 1e-5
        if (!crossed && Math.abs(h) > reach) return
        let hit = triangle
        if (crossed) {
          const t = h0 / (h0 - h)
          sweepTriangle.a.lerpVectors(start[a], p, t)
          sweepTriangle.b.lerpVectors(start[b], q, t)
          sweepTriangle.c.lerpVectors(start[c], r, t)
          onFace.lerpVectors(start[i], pts[i], t)
          hit = sweepTriangle
        } else onFace.copy(pts[i]).addScaledVector(normal, -h)
        if (!hit.getBarycoord(onFace, bary) || Math.min(bary.x, bary.y, bary.z) < 0) return
        const w = bary.toArray()
        const bindDelta = dp.subVectors(this.rests[i], blend(this.rests, ids, w, interp))
        const bindLength = bindDelta.length()
        if (bindLength < 1e-5) return
        const bindNormal = scratch
          .subVectors(this.rests[b], this.rests[a])
          .cross(chord.subVectors(this.rests[c], this.rests[a]))
          .normalize()
        const restHeight = bindDelta.dot(bindNormal)
        const target = Math.min(gap, Math.abs(restHeight))
        if (target < 1e-5) return
        const sign = Math.sign(restHeight),
          depth = target - h * sign
        if (depth <= 1e-5) return
        const all = [i, a, b, c],
          coeff = [1, -w[0], -w[1], -w[2]]
        // Transform a plane with the inverse transpose, including mirrored slots.
        const plane = onFace.copy(normal).multiplyScalar(sign).applyMatrix3(this.worldNormal)
        const factor = plane.length()
        if (factor < 1e-8) return
        plane.divideScalar(factor)
        const free = all.map((node, k) => {
          const shift = this.shifts[node],
            sq = shift.lengthSq()
          const projection = shift.dot(plane)
          // Contact with the body removes inward travel, but leaves tangential
          // sliding and outward separation available to the layer constraint.
          return sq && coeff[k] * projection < 0 ? Math.max(0, 1 - (projection * projection) / sq) : 1
        })
        let denom = 0
        for (let k = 0; k < 4; k++) denom += nodes[all[k]].mobility * free[k] * coeff[k] ** 2
        if (denom < 1e-6) return
        for (let k = 0; k < 4; k++) {
          const n = all[k],
            share = free[k] > 1e-5 ? (nodes[n].mobility * coeff[k]) / denom : 0
          if (!share || depth * Math.abs(share) <= this.scores[n]) continue
          this.scores[n] = depth * Math.abs(share)
          const at = n * contactStride
          this.ids.set(all, at + 4)
          this.data.set(coeff, at + 8)
          plane.toArray(this.data, at + 12)
          this.data[at + 15] = target / factor
          this.data[at + 18] = (crossed ? Math.min(this.height * 0.08, gap + Math.abs(h - h0)) : gap) / factor
          this.data[at + 16] = share
        }
      }
      if ((maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1) > 512) {
        for (let j = 0; j < this.garmentNodes.length; j += stride) visit(this.garmentNodes[j])
      } else
        for (let x = minX; x <= maxX; x++)
          for (let y = minY; y <= maxY; y++)
            for (let z = minZ; z <= maxZ; z++) {
              const bucket = buckets.get(key(x, y, z))
              if (bucket) for (const i of bucket) visit(i)
            }
    }
  }
  private readonly worldNormal = new Matrix3()
}

export function surfaceOffset(packet: GarmentContact, i: number, out: Vector3) {
  const { data, ids, skin } = packet,
    at = i * contactStride
  out.fromArray(data, at)
  if (data[at + 16]) {
    const n = normal.fromArray(data, at + 12)
    let sep = 0
    for (let j = 0; j < 4; j++) {
      const k = ids[at + 4 + j]
      sep +=
        data[at + 8 + j] *
        dp
          .fromArray(data, k * contactStride)
          .add(skin[k])
          .dot(n)
    }
    out.addScaledVector(
      n,
      Math.max(-data[at + 18], Math.min(data[at + 18], Math.max(0, data[at + 15] - sep) * data[at + 16])),
    )
    // Body contact has priority over a layer closer to the skeleton.
    const body = dp.fromArray(data, at),
      sq = body.lengthSq()
    if (sq > 0) out.addScaledVector(body, Math.max(0, 1 - out.dot(body) / sq))
  }
  if (data[at + 3]) {
    const depth = packet.colliders.floorDepth(dp.copy(skin[i]).add(out), 0)
    if (depth > 0) out.addScaledVector(packet.colliders.up, depth)
  }
  return out
}

export class CPUContactSolver {
  private active = false
  private readonly offsets: Vector3[]
  private readonly inverse = new Matrix3()
  constructor(readonly contact: GarmentContact) {
    this.offsets = contact.skin.map(() => new Vector3())
  }
  step(body: boolean, stride: number, dt = 0) {
    const c = this.contact
    c.prepare(body, stride, dt)
    const inv = this.inverse,
      offsets = this.offsets
    for (let i = 0; i < offsets.length; i++) surfaceOffset(c, i, offsets[i])
    for (const { mesh, offset, vertexToNode } of c.cloth.meshes) {
      inv.setFromMatrix4(mesh.matrixWorld).invert()
      for (let v = 0; v < vertexToNode.length; v++) {
        const id = vertexToNode[v]
        if (id !== UNSIMULATED)
          dp.copy(offsets[id])
            .applyMatrix3(inv)
            .toArray(offset.array, v * 3)
      }
      offset.needsUpdate = true
    }
    this.active = true
  }
  clear() {
    if (!this.active) return
    this.contact.reset()
    for (const { offset } of this.contact.cloth.meshes) {
      offset.array.fill(0)
      offset.needsUpdate = true
    }
    this.active = false
  }
  checkpoint() {
    if (!this.active) return
    const active = this.active,
      restore = this.contact.checkpoint()
    const saved = this.contact.cloth.meshes.map(({ offset }) => offset.array.slice())
    return () => {
      restore()
      this.active = active
      this.contact.cloth.meshes.forEach(({ offset }, i) => {
        offset.array.set(saved[i])
        offset.needsUpdate = true
      })
    }
  }
}
