import { Line3, Matrix3, Matrix4, Object3D, SkinnedMesh, Vector3 } from 'three'
import { rigBones, type StudioModel } from './ModelLoader'
import { canonicalBoneName, classifyBone, kimonoHemKey, sleevePanelKey } from './RigDefinition'
import { sleeveSide } from './ClothTopology'

const thigh = 4,
  calf = 32
export const ColliderGroup = {
  head: 1,
  torso: 2,
  thigh,
  calf,
  legs: thigh | calf,
  arms: 8,
  floor: 16,
  weapon: 64,
} as const
const { head, torso, legs, arms, floor, weapon } = ColliderGroup
export const collisionMasks = {
  tail: torso | legs | floor,
  skirt: legs | floor,
  hair: head | torso | arms | floor | weapon,
  cloth: torso | arms | legs | floor,
  wing: torso | floor,
}
export type ClothMaterial = keyof typeof collisionMasks

export interface DynamicCapsule {
  a: Vector3
  b: Vector3
  radius: number
}

interface Capsule extends DynamicCapsule {
  group: number
  segment: Vector3
  inverseLengthSq: number
  bindRadius: number
  elevation: number
}

interface Shape extends Capsule {
  start: Object3D
  end?: Object3D
  offset: Vector3
  startFraction: number
  bindAxis: Line3
  bindScale: number
}

export interface PointContact {
  bindRadii?: Float64Array
  skirtOutward?: Vector3
  outward?: Vector3
  panelScale?: number
  legElevation?: number
}

const cache = new WeakMap<StudioModel, BodyColliders>()
export function bodyColliders(model: StudioModel) {
  let fit = cache.get(model)
  if (!fit) cache.set(model, (fit = new BodyColliders(model)))
  return fit
}

export function bindSkinMatrices(model: StudioModel, mesh: SkinnedMesh) {
  const { bones, boneInverses } = mesh.skeleton
  return bones.map((bone, i) => {
    const bind = model.rest.get(bone)
    return (
      bind &&
      new Matrix4()
        .compose(bind.restWorldPos, bind.restWorldQuat, bind.restWorldScale)
        .multiply(boneInverses[i])
        .multiply(mesh.bindMatrix)
    )
  })
}

function sampleBindVertices(model: StudioModel, weighted: Set<Object3D>) {
  let hasSkin = false
  const samples = new Map<Object3D, Vector3[]>()
  const v = new Vector3(),
    blended = new Vector3(),
    part = new Vector3()
  for (const mesh of model.bodyMeshes) {
    if (!(mesh instanceof SkinnedMesh)) continue
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes
    if (!position || !skinIndex || !skinWeight) continue
    hasSkin = true
    const { bones } = mesh.skeleton
    const hemPivots = bones.map((b) => kimonoHemKey.test(canonicalBoneName(b.name)))
    const hasHems = hemPivots.includes(true)
    const matrices = bindSkinMatrices(model, mesh)
    for (let i = 0; i < position.count; i++) {
      let dominant = -1,
        largest = 0
      blended.set(0, 0, 0)
      v.fromBufferAttribute(position, i)
      for (let k = 0; k < skinWeight.itemSize; k++) {
        const w = skinWeight.getComponent(i, k),
          index = skinIndex.getComponent(i, k)
        const matrix = matrices[index]
        if (!(w > 0) || !matrix) continue
        weighted.add(bones[index])
        blended.addScaledVector(part.copy(v).applyMatrix4(matrix), w)
        if (w > largest) {
          largest = w
          dominant = index
        }
      }
      if (dominant < 0) continue
      const owner = bones[dominant]
      let points = samples.get(owner)
      if (!points) samples.set(owner, (points = []))
      points.push(blended.clone())
      // At the kimono's lower seam a shin often carries the largest weight.
      // Fit the actual panel edge as well, even where its pivot is secondary.
      if (hasHems) {
        for (let k = 0; k < skinWeight.itemSize; k++) {
          const index = skinIndex.getComponent(i, k)
          if (index === dominant || !hemPivots[index] || skinWeight.getComponent(i, k) < 0.15) continue
          let panel = samples.get(bones[index])
          if (!panel) samples.set(bones[index], (panel = []))
          panel.push(blended.clone())
        }
      }
    }
  }

  return { samples, hasSkin }
}

// Fit in the original bind frame. Keep all positive skin influences for topology,
// and fit each body shape from vertices dominated by that joint.
export class BodyColliders {
  readonly shapes: Capsule[] = []
  private readonly bodyShapes: Shape[] = []
  private readonly dynamicPool: Capsule[] = []
  readonly legSurface = new Map<Object3D, Vector3[]>()
  readonly skinProbes = new Map<Object3D, Vector3[]>()
  readonly leafTips = new Map<Object3D, Vector3>()
  readonly hangingSleeveTips = new Map<Object3D, Vector3>()
  readonly skinned = new Set<Object3D>()
  readonly hasSkin: boolean
  readonly up = new Vector3(0, 1, 0)
  readonly floorOrigin = new Vector3()
  private readonly normalMatrix = new Matrix3()
  private readonly closest = new Vector3()
  private readonly normal = new Vector3()
  private readonly tangent = new Vector3()

  constructor(private readonly model: StudioModel) {
    const nodes = new Map(rigBones(model).map((b) => [canonicalBoneName(b.name), b]))
    const { samples, hasSkin } = sampleBindVertices(model, this.skinned)
    this.hasSkin = hasSkin
    const legSpacing = Math.max(0.1, model.hipRestHeight) / 44
    for (const [bone, points] of samples) {
      if (!/^bip001_[lr]_(?:thigh|calf)(?:_twist)?$/.test(canonicalBoneName(bone.name))) continue
      const occupied = new Set<string>()
      this.legSurface.set(bone, points.filter((p) => {
        const cell = [p.x, p.y, p.z].map((v) => Math.round(v / legSpacing)).join(',')
        if (occupied.has(cell)) return false
        occupied.add(cell)
        return true
      }))
    }
    const v = new Vector3()
    // The final weighted joint frequently has no end bone. Sample the distal
    // quarter of its skin in bind space: a short extrapolation misses long hems.
    for (const [bone, points] of samples) {
      const bind = model.rest.get(bone)!,
        parent = bone.parent && model.rest.get(bone.parent)
      if (classifyBone(canonicalBoneName(bone.name)) !== 'secondary') continue
      if (points.length >= 4) {
        // Four widely separated skin samples cover the width of a panel. Their
        // bone-local bind positions can be posed without CPU-skinning the mesh.
        const inverse = new Matrix4()
          .compose(bind.restWorldPos, bind.restWorldQuat, bind.restWorldScale)
          .invert()
        const probes = [points[0]]
        while (probes.length < 4) {
          let best = 0,
            furthest = points[0]
          for (const point of points) {
            let distance = Infinity
            for (const probe of probes) distance = Math.min(distance, point.distanceToSquared(probe))
            if (distance > best) {
              best = distance
              furthest = point
            }
          }
          if (best < 1e-6) break
          probes.push(furthest)
        }
        this.skinProbes.set(
          bone,
          probes.map((point) => point.clone().applyMatrix4(inverse)),
        )
      }
      if (!parent || points.length < 4 || bone.children.some((child) => this.skinned.has(child))) continue
      if (sleevePanelKey.test(canonicalBoneName(bone.name))) {
        const side = sleeveSide(bone), fore = nodes.get('bip001_' + side + '_forearm'), hand = nodes.get('bip001_' + side + '_hand')
        if (fore && hand) {
          const elbow = model.rest.get(fore)!.restWorldPos
          const axis = model.rest.get(hand)!.restWorldPos.clone().sub(elbow)
          const length = axis.length()
          axis.normalize()
          const center = new Vector3()
          for (const p of points) center.add(v.subVectors(p, elbow))
          center.divideScalar(points.length)
          center.addScaledVector(axis, -center.dot(axis))
          // A cuff wraps around the arm. A loose single-bone sleeve has a
          // weighted lobe predominantly on one side of the forearm.
          if (length > 1e-6 && center.length() > 0.18 * length) {
            center.normalize()
            let high = -Infinity, low = Infinity
            for (const p of points) {
              const d = v.subVectors(p, elbow).dot(center)
              high = Math.max(high, d); low = Math.min(low, d)
            }
            if (high > 0.6 * length && -low < 0.55 * high) {
              const tip = new Vector3()
              let count = 0
              for (const p of points) if (v.subVectors(p, elbow).dot(center) >= high * 0.75) {
                count++; tip.add(p)
              }
              tip.divideScalar(count).sub(bind.restWorldPos)
              if (tip.dot(center) > 0.35 * length) this.hangingSleeveTips.set(bone,
                tip.applyQuaternion(bind.restWorldQuat.clone().invert()).divide(bind.restWorldScale))
            }
          }
        }
      }
      const axis = v.subVectors(bind.restWorldPos, parent.restWorldPos)
      const incoming = axis.length()
      if (incoming < 1e-6) continue
      axis.divideScalar(incoming)
      points.sort((a, b) => a.dot(axis) - b.dot(axis))
      const distal = new Vector3(),
        start = Math.floor(points.length * 0.75)
      for (let i = start; i < points.length; i++) distal.add(points[i])
      distal.divideScalar(points.length - start).sub(bind.restWorldPos)
      // A hem pivot is near the seam but parented at the waist. Its real
      // weighted tip can be much shorter than the incoming pelvis-to-shin link.
      const minimum = kimonoHemKey.test(canonicalBoneName(bone.name)) ? 1e-5 : incoming * 0.2
      if (distal.dot(axis) < minimum) continue
      distal.clampLength(0, 2.5 * incoming)
      if (
        Math.min(
          Math.abs(bind.restWorldScale.x),
          Math.abs(bind.restWorldScale.y),
          Math.abs(bind.restWorldScale.z),
        ) < 1e-8
      )
        continue
      this.leafTips.set(
        bone,
        distal.applyQuaternion(bind.restWorldQuat.clone().invert()).divide(bind.restWorldScale),
      )
    }
    const fit = (
      group: number,
      start: string,
      end: string | undefined,
      owners: string[],
      min: number,
      max: number,
      fallback: number,
      startFraction = 0,
    ) => {
      const from = nodes.get('bip001_' + start),
        to = end ? nodes.get('bip001_' + end) : undefined
      if (!from || (end && !to)) return
      const bind = model.rest.get(from)!
      const a = bind.restWorldPos.clone(),
        b = to ? model.rest.get(to)!.restWorldPos : a
      const points = owners.flatMap((name) => samples.get(nodes.get('bip001_' + name)!) ?? [])
      const offset = new Vector3()
      if (!to && points.length && bind.restWorldScale.x && bind.restWorldScale.y && bind.restWorldScale.z) {
        for (const p of points) offset.add(p)
        offset.divideScalar(points.length).sub(a)
        a.add(offset)
        offset.applyQuaternion(bind.restWorldQuat.clone().invert()).divide(bind.restWorldScale)
      }
      a.lerp(b, startFraction)
      const segment = new Vector3().subVectors(b, a),
        lengthSq = segment.lengthSq()
      const distances = points
        .map((p) => {
          const t = lengthSq ? Math.max(0, Math.min(1, v.subVectors(p, a).dot(segment) / lengthSq)) : 0
          return v.copy(a).addScaledVector(segment, t).distanceTo(p)
        })
        .sort((x, y) => x - y)
      const percentile = group === head ? 0.75 : 0.6
      const radius = Math.max(
        min,
        Math.min(max, distances[Math.floor(distances.length * percentile)] ?? fallback),
      )
      this.bodyShapes.push({
        start: from,
        end: to,
        group,
        a,
        b: b.clone(),
        offset,
        startFraction,
        elevation: 0,
        bindAxis: new Line3(a.clone(), b.clone()),
        segment,
        inverseLengthSq: 0,
        radius,
        bindRadius: radius,
        bindScale: Math.max(
          1e-8,
          Math.abs(bind.restWorldScale.x),
          Math.abs(bind.restWorldScale.y),
          Math.abs(bind.restWorldScale.z),
        ),
      })
    }
    fit(head, 'head', undefined, ['head'], 0.08, 0.18, 0.13)
    const spine1 = nodes.has('bip001_spine1') ? 'spine1' : 'spine'
    fit(torso, 'pelvis', spine1, ['pelvis', 'spine'], 0.04, 0.095, 0.068)
    fit(
      torso,
      nodes.has('bip001_spine') ? 'spine' : spine1,
      nodes.has('bip001_neck') ? 'neck' : 'head',
      ['spine1'],
      0.04,
      0.095,
      0.068,
    )
    for (const side of ['l_', 'r_']) {
      fit(
        thigh,
        side + 'thigh',
        side + 'calf',
        [side + 'thigh', side + 'thigh_twist'],
        0.025,
        0.062,
        0.042,
        0.16,
      )
      fit(calf, side + 'calf', side + 'foot', [side + 'calf'], 0.022, 0.055, 0.035)
      fit(
        arms,
        side + 'upperarm',
        side + 'forearm',
        [side + 'upperarm', side + 'upperarm_twist'],
        0.02,
        0.052,
        0.032,
      )
      fit(
        arms,
        side + 'forearm',
        side + 'hand',
        [side + 'forearm', side + 'forearm_twist'],
        0.018,
        0.045,
        0.028,
      )
    }
    this.shapes.push(...this.bodyShapes)
    this.update()
  }

  // With a non-uniform slot scale, measure the animated joint in the original
  // stage units before comparing its radius to the artist's bind clearance.
  bodyRadiusScale(index: number, inverseStage: Matrix4, scratch: Matrix4) {
    const shape = this.bodyShapes[index]
    return (
      scratch.multiplyMatrices(inverseStage, shape.start.matrixWorld).getMaxScaleOnAxis() / shape.bindScale
    )
  }

  get bodyShapeCount() {
    return this.bodyShapes.length
  }

  setDynamicCapsules(capsules: readonly DynamicCapsule[]) {
    this.shapes.length = this.bodyShapes.length + capsules.length
    for (let i = 0; i < capsules.length; i++) {
      const src = capsules[i]
      const slot = (this.dynamicPool[i] ??= {
        group: weapon,
        a: new Vector3(),
        b: new Vector3(),
        segment: new Vector3(),
        radius: 0,
        inverseLengthSq: 0,
        bindRadius: 0,
        elevation: 0,
      })
      slot.a.copy(src.a)
      slot.b.copy(src.b)
      slot.radius = src.radius
      const lengthSq = slot.segment.subVectors(slot.b, slot.a).lengthSq()
      slot.inverseLengthSq = lengthSq > 1e-16 ? 1 / lengthSq : 0
      this.shapes[this.bodyShapes.length + i] = slot
    }
  }

  update() {
    const stage = this.model.root.parent
    this.floorOrigin.set(0, 0, 0)
    this.up.set(0, 1, 0)
    this.model.root.updateWorldMatrix(true, true)
    if (stage) {
      this.floorOrigin.applyMatrix4(stage.matrixWorld)
      this.up.applyNormalMatrix(this.normalMatrix.getNormalMatrix(stage.matrixWorld))
    }
    for (const s of this.bodyShapes) this.updateShape(s)
  }

  // Retargeting already updated these joint matrices. Arm clearance only needs
  // the two torso capsules before cloth updates the complete posed skeleton.
  updateTorso() {
    for (const s of this.bodyShapes) if (s.group === torso) this.updateShape(s)
  }

  private updateShape(s: Shape) {
    s.a.copy(s.offset).applyMatrix4(s.start.matrixWorld)
    if (s.end) {
      s.b.setFromMatrixPosition(s.end.matrixWorld)
      s.a.lerp(s.b, s.startFraction)
    } else s.b.copy(s.a)
    s.segment.subVectors(s.b, s.a)
    const lengthSq = s.segment.lengthSq()
    s.inverseLengthSq = lengthSq > 1e-16 ? 1 / lengthSq : 0
    if (s.group & legs) {
      const cos = -s.segment.dot(this.up) * Math.sqrt(s.inverseLengthSq)
      s.elevation = lengthSq > 1e-16 ? Math.acos(Math.max(-1, Math.min(1, cos))) : 0
    }
    s.radius = (s.bindRadius * s.start.matrixWorld.getMaxScaleOnAxis()) / s.bindScale
  }

  // Solvers can be rebuilt while a clip is posed. Only the immutable bind axes
  // are valid references for measuring how much clearance the artist left.
  get legCapsules() {
    return this.bodyShapes.filter(shape => (shape.group & ColliderGroup.legs) !== 0)
  }

  bindRadii(point: Vector3, thickness: number, mask: number) {
    return Float64Array.from(this.bodyShapes, (s) => {
      if (!(s.group & mask)) return 0
      const { start, end } = s.bindAxis
      const closest = start.equals(end) ? start : s.bindAxis.closestPointToPoint(point, true, this.closest)
      return Math.min(s.bindRadius + thickness, Math.max(0, closest.distanceTo(point) - 0.002))
    })
  }

  // With an anchor, project onto the contact tangent plane along the sphere of
  // reachable tips. A straight push followed by length normalization re-penetrates.
  private push(p: Vector3, n: Vector3, depth: number, anchor?: Vector3, preferredTangent?: Vector3) {
    if (!anchor) {
      p.addScaledVector(n, depth)
      return
    }
    const tangent = this.tangent.subVectors(p, anchor),
      length = tangent.length()
    const oldHeight = tangent.dot(n)
    const height = Math.min(length, oldHeight + depth)
    tangent.addScaledVector(n, -oldHeight)
    if (preferredTangent && preferredTangent.lengthSq() > 0 && tangent.dot(preferredTangent) <= 1e-10) {
      tangent.copy(preferredTangent)
    } else if (tangent.lengthSq() < 1e-16) {
      tangent.set(Math.abs(n.x) < 0.8 ? 1 : 0, 0, Math.abs(n.x) < 0.8 ? 0 : 1)
      tangent.addScaledVector(n, -tangent.dot(n))
    }
    tangent.setLength(Math.sqrt(Math.max(0, length * length - height * height)))
    p.copy(anchor).addScaledVector(n, height).add(tangent)
  }

  floorDepth(point: Vector3, margin: number) {
    return margin - this.closest.subVectors(point, this.floorOrigin).dot(this.up)
  }

  // Leaves the separation vector in normal for the contact projection.
  private overlap(p: Vector3, s: Capsule, radius: number, bindRadius?: number) {
    const n = this.normal.subVectors(p, s.a)
    const t = Math.max(0, Math.min(1, n.dot(s.segment) * s.inverseLengthSq))
    const distance = n.addScaledVector(s.segment, -t).length()
    const surface = s.radius + radius
    return (
      (bindRadius === undefined ? surface : Math.min(surface, (bindRadius * s.radius) / s.bindRadius)) -
      distance
    )
  }

  torsoDepth(p: Vector3, radius: number, bindRadii: Float64Array) {
    let depth = 0
    for (let i = 0; i < this.bodyShapes.length; i++) {
      const s = this.bodyShapes[i]
      if (s.group === torso && s.radius > 1e-8)
        depth = Math.max(depth, this.overlap(p, s, radius, bindRadii[i]))
    }
    return depth
  }

  resolvePoint(
    p: Vector3,
    radius: number,
    mask: number,
    normalOut?: Vector3,
    anchor?: Vector3,
    options?: PointContact,
  ) {
    const skirtOutward = options?.skirtOutward
    let contact = false
    normalOut?.set(0, 0, 0)
    // Keep the original body indices for bind clearance, but give anatomy
    // the final projection when a held prop pinches a strand against it.
    const count = this.shapes.length
    const dynamicCount = count - this.bodyShapes.length
    for (let j = 0; j < count; j++) {
      const i = j < dynamicCount ? this.bodyShapes.length + j : j - dynamicCount
      const s = this.shapes[i]
      if (!(s.group & mask) || s.radius < 1e-8) continue
      let overlap = this.overlap(p, s, radius, options?.bindRadii?.[i])
      if (overlap <= 1e-9) continue
      const t = options?.panelScale
        ? Math.min(1, Math.max(0, (overlap / options.panelScale - 0.001) / 0.005))
        : 1
      if (t === 0) continue
      const n = this.normal
      const outward = options?.outward
      const distance = n.length()
      if (distance > 1e-8) n.divideScalar(distance)
      else {
        n.set(0, 0, 1).addScaledVector(s.segment, -s.segment.z * s.inverseLengthSq)
        if (n.lengthSq() < 1e-8) n.set(1, 0, 0)
        n.normalize()
      }
      if (skirtOutward && s.group & legs) {
        // Above a knee cap, the closest normal can point straight up or back
        // into the other leg. Send hanging fabric around the limb in stage space.
        n.addScaledVector(this.up, -n.dot(this.up))
        if (n.lengthSq() < 1e-10 || n.dot(skirtOutward) < 0) n.copy(skirtOutward)
        if (n.lengthSq() < 1e-10) continue
        n.normalize()
      } else if (outward && (distance < 1e-8 || n.dot(outward) < 0) && outward.lengthSq() > 1e-12) {
        const escape = this.tangent.copy(outward)
        escape.addScaledVector(s.segment, -outward.dot(s.segment) * s.inverseLengthSq)
        if (escape.lengthSq() < 1e-12) escape.copy(outward)
        escape.normalize()
        // Measure to the tangent plane on the chosen side of the capsule.
        overlap += distance * (1 - n.dot(escape))
        n.copy(escape)
      }
      if (options?.legElevation !== undefined && s.group & legs)
        options.legElevation = Math.max(options.legElevation, s.elevation)
      this.push(p, n, overlap * t * t * (3 - 2 * t), anchor)
      normalOut?.add(n)
      contact = true
    }
    if (mask & floor) {
      const depth = this.floorDepth(p, radius)
      if (depth > 1e-9) {
        this.push(p, this.up, depth, anchor, skirtOutward)
        normalOut?.add(this.up)
        contact = true
      }
    }
    normalOut?.normalize()
    return contact
  }
}
