import { Box3, Matrix4, Mesh, Object3D, PropertyBinding, Quaternion, SkinnedMesh, Vector3, Vector4 } from 'three'
import { normalizeClipName } from './AnimationUtils'
import { ClipPlayer } from './ClipPlayer'
import type { RestTransform, StudioModel } from './ModelLoader'
import { canonicalBoneName, classifyBone, weaponKey } from './RigDefinition'

export type Side = 'r' | 'l'
export const sides: readonly Side[] = ['r', 'l']
export const oppositeHand = (side: Side): Side => (side === 'r' ? 'l' : 'r')
const single = 'bip001_weapon'

export interface HandGrip {
  valid: boolean
  handToWeapon: Matrix4
  supportInWeapon: Vector3
  surfaceDist: number
}
export interface GripCapsule {
  localA: Vector3
  localB: Vector3
  radius: number
}

export interface WeaponGrip {
  key: string
  node: Object3D
  meshes: Set<Mesh>
  bindScale: Vector3
  vertices: Vector3[]
  capsule: GripCapsule
  rightGrip: HandGrip
  leftGrip: HandGrip
}
export interface PropGroup {
  root: Object3D
  bindScale: Vector3
  meshes: Mesh[]
  vertices: Vector3[]
  liveSurface?: {
    parts: { mesh: Mesh; samples: Uint32Array; points: Vector3[] }[]
    vertices: Vector3[]
  }
  kind: 'bodyAttached' | 'grounded' | 'handheld'
  capsule?: GripCapsule
  directSkin?: boolean
  hostBoneKey?: string
}
interface TetherJoint {
  bone: Object3D
  from: Object3D
  to: Object3D
  fromLocal: Matrix4
  toLocal: Matrix4
  fraction: number
}

function weaponTethers(model: StudioModel, weapons: Map<string, WeaponGrip>) {
  const result: TetherJoint[] = []
  const left = weapons.get('bip001_weapon_l')?.node
  const right = weapons.get('bip001_weapon_r')?.node
  if (!left || !right || !left.matrixWorld.determinant() || !right.matrixWorld.determinant()) return result
  const seen = new Set<Object3D>()
  for (const mesh of model.weaponMeshes) {
    if (!(mesh instanceof SkinnedMesh) || !/chain|tether/i.test(mesh.name)) continue
    const links = new Set(mesh.skeleton.bones.filter(b => /chain|tether/i.test(b.name)))
    const first = [...links].find(b => !links.has(b.parent as typeof b))
    if (!first || seen.has(first)) continue
    const ordered = [first]
    for (let bone = first; ; ) {
      const children = bone.children.filter(child => links.has(child as typeof bone))
      if (children.length !== 1) break
      bone = children[0] as typeof bone
      ordered.push(bone)
    }
    if (ordered.length !== links.size || ordered.length < 2) continue
    seen.add(first)
    const positions = ordered.map((bone) => bone.getWorldPosition(new Vector3()))
    const distances = [0]
    for (let i = 1; i < positions.length; i++)
      distances.push(distances[i - 1] + positions[i].distanceTo(positions[i - 1]))
    const length = distances[distances.length - 1]
    if (length < 1e-8) continue
    const start = positions[0], end = positions[positions.length - 1]
    const l = left.getWorldPosition(new Vector3()), r = right.getWorldPosition(new Vector3())
    const leftFirst = start.distanceTo(l) + end.distanceTo(r) < start.distanceTo(r) + end.distanceTo(l)
    const from = leftFirst ? left : right, to = leftFirst ? right : left
    const inverseFrom = from.matrixWorld.clone().invert(), inverseTo = to.matrixWorld.clone().invert()
    for (const [i, bone] of ordered.entries()) {
      result.push({
        bone, from, to, fraction: distances[i] / length,
        fromLocal: inverseFrom.clone().multiply(bone.matrixWorld),
        toLocal: inverseTo.clone().multiply(bone.matrixWorld),
      })
    }
  }
  return result
}

export interface GripProfile {
  tethers: TetherJoint[]
  weapons: Map<string, WeaponGrip>
  props: PropGroup[]
}
const profiles = new WeakMap<StudioModel, GripProfile>()
export const handGrip = (weapon: WeaponGrip, side: Side) =>
  side === 'r' ? weapon.rightGrip : weapon.leftGrip

export function smoothContact(dist: number, inner = 0.045, outer = 0.095) {
  if (dist <= inner) return 1
  if (dist >= outer) return 0
  const t = (dist - inner) / (outer - inner)
  return 1 - t * t * (3 - 2 * t)
}

export function weaponCollapsed(scale: Vector3, bind: Vector3) {
  // Stage/model units may be centimetres. A keyed shrink is relative to bind.
  return (
    Math.min(
      Math.abs(scale.x / (bind.x || 1)),
      Math.abs(scale.y / (bind.y || 1)),
      Math.abs(scale.z / (bind.z || 1)),
    ) < 0.05
  )
}

export function drawableVisible(mesh: Mesh) {
  for (let node: Object3D | null = mesh; node; node = node.parent) if (!node.visible) return false
  return true
}

export class GripContact {
  private readonly stageFrame = new Matrix4()
  private readonly skinPoint = new Vector4()

  // Sample the visible switch geometry once for both hands, in slot coordinates.
  groundedSurface(surface: NonNullable<PropGroup['liveSurface']>, stageInverse: Matrix4) {
    let count = 0
    for (const { mesh, samples, points } of surface.parts) {
      if (!drawableVisible(mesh)) continue
      if (mesh instanceof SkinnedMesh) mesh.updateMatrixWorld()
      this.stageFrame.multiplyMatrices(stageInverse, mesh.matrixWorld)
      const start = count
      let spread = 0
      for (let k = 0; k < samples.length; k++) {
        const index = samples[k], p = points[k]
        Mesh.prototype.getVertexPosition.call(mesh, index, p)
        if (mesh instanceof SkinnedMesh) {
          this.skinPoint.set(p.x, p.y, p.z, 1)
          mesh.applyBoneTransform(index, this.skinPoint)
          p.set(this.skinPoint.x, this.skinPoint.y, this.skinPoint.z)
        }
        p.applyMatrix4(this.stageFrame)
        spread = Math.max(spread, p.distanceToSquared(points[0]))
        surface.vertices[count++] = p
      }
      if (spread < 1e-10) count = start
    }
    return count
  }

  private readonly point = new Vector3()

  distance(vertices: readonly Vector3[], frame: Matrix4, hand: Vector3, nearest?: Vector3, count = vertices.length) {
    let best = Infinity
    for (let i = 0; i < count; i++) {
      const d = this.point.copy(vertices[i]).applyMatrix4(frame).distanceToSquared(hand)
      if (d < best) {
        best = d
        nearest?.copy(this.point)
      }
    }
    return Math.sqrt(best)
  }
  weapon(weapon: WeaponGrip, frame: Matrix4, hand: Vector3, side: Side) {
    if (weaponCollapsed(this.point.setFromMatrixScale(frame), weapon.bindScale)) return 0
    const distance = this.distance(weapon.vertices, frame, hand)
    const ref = handGrip(weapon, side)
    if (!ref.valid) return smoothContact(distance)
    const inner = Math.min(0.135, Math.max(0.045, ref.surfaceDist + 0.025))
    return smoothContact(distance, inner, Math.min(0.14, inner + 0.055))
  }
}

/** Keep a bounded, deterministic reservoir across all primitives (including small
 * submeshes). Also retain the closest real vertex to each reference palm. */
class SurfaceSampler {
  readonly points: Vector3[] = []
  readonly bounds = new Box3()
  private count = 0
  private seed = 1
  private readonly nearest = [new Vector3(), new Vector3()]
  private readonly distances = [Infinity, Infinity]
  constructor(
    private limit: number,
    private palms: (Vector3 | undefined)[],
  ) {}
  add(local: Vector3) {
    if (!Number.isFinite(local.lengthSq())) return
    this.bounds.expandByPoint(local)
    this.count++
    const capacity = this.limit - this.palms.length
    if (this.points.length < capacity) this.points.push(local.clone())
    else {
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
      const i = Math.floor((this.seed / 0x100000000) * this.count)
      if (i < capacity) this.points[i].copy(local)
    }
    for (let i = 0; i < this.palms.length; i++) {
      const d = this.palms[i]?.distanceToSquared(local) ?? Infinity
      if (d < this.distances[i]) {
        this.distances[i] = d
        this.nearest[i].copy(local)
      }
    }
  }
  finish() {
    for (let i = 0; i < this.palms.length; i++)
      if (Number.isFinite(this.distances[i])) this.points.push(this.nearest[i])
    return this.points
  }
}

function dominantBone(mesh: SkinnedMesh, index: number) {
  const weights = mesh.geometry.getAttribute('skinWeight'),
    indices = mesh.geometry.getAttribute('skinIndex')
  if (!weights || !indices) return
  let best = 0,
    joint
  for (let j = 0; j < 4; j++) {
    const w = weights.getComponent(index, j)
    if (w > best) {
      best = w
      joint = mesh.skeleton.bones[indices.getComponent(index, j)]
    }
  }
  return joint
}

function propAttachment(model: StudioModel, mesh: Mesh) {
  let start: Object3D = mesh
  if (mesh instanceof SkinnedMesh) {
    // Many BA skins list the entire character skeleton. Only weighted joints
    // identify the animated branch to which this drawable actually belongs.
    const counts = new Map<Object3D, number>()
    const count = mesh.geometry.getAttribute('position').count
    for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 128))) {
      const bone = dominantBone(mesh, i)
      if (bone) counts.set(bone, (counts.get(bone) ?? 0) + 1)
    }
    let max = 0
    for (const [bone, count] of counts)
      if (count > max) {
        start = bone
        max = count
      }
  }
  let root = start
  for (let n: Object3D | null = start; n && n !== model.root; n = n.parent) {
    const key = canonicalBoneName(n.name)
    if (key === 'bip001' && start === n && mesh instanceof SkinnedMesh)
      return { root: mesh, hostBoneKey: key, directSkin: true }
    if (key === 'bip001' || key === 'bone_root' || key === 'prop_root') break
    if (/^bip001_/.test(key) && classifyBone(key) !== 'secondary') {
      const directSkin = root === n && mesh instanceof SkinnedMesh
      return { root: directSkin ? mesh : root, hostBoneKey: key, directSkin }
    }
    // A vehicle/seat ancestor can contain Bip001. Never move the character with its accessory.
    if (n !== start && n.getObjectByName('Bip001')) break
    root = n
  }
  return { root, hostBoneKey: undefined }
}

const groundedName =
  /table|chair|desk|bike|tank|amp|drum|stand|platform|piano|cockpit|wheelchair|bath|train|car|boat|truck|turret|howitzer|howizer|stage/i

// Interleave the weighted branches so a tiny articulated handle is represented
// even when a large vehicle body dominates the primitive's index order.
function liveSurface(mesh: Mesh) {
  const count = mesh.geometry.getAttribute('position').count
  const branches = new Map<Object3D, number[]>()
  for (let i = 0; i < count; i++) {
    const owner = (mesh instanceof SkinnedMesh && dominantBone(mesh, i)) || mesh
    let vertices = branches.get(owner)
    if (!vertices) branches.set(owner, (vertices = []))
    vertices.push(i)
  }
  const samples = new Uint32Array(Math.min(count, 128))
  let next = 0
  const ordered = [...branches.values()].sort((a, b) => a.length - b.length)
  for (let k = 0; k < ordered.length; k++) {
    const branch = ordered[k]
    const share = Math.min(branch.length, Math.ceil((samples.length - next) / (ordered.length - k)))
    for (let j = 0; j < share; j++) samples[next++] = branch[Math.floor(j * branch.length / share)]
  }
  return { mesh, samples, points: Array.from(samples, () => new Vector3()) }
}

function propProfiles(model: StudioModel) {
  const groups = new Map<Object3D, PropGroup>()
  for (const mesh of model.propMeshes) {
    const { root, hostBoneKey, directSkin } = propAttachment(model, mesh)
    let group = groups.get(root)
    if (!group) {
      group = {
        root,
        bindScale: model.rest.get(root)!.restWorldScale,
        hostBoneKey,
        directSkin,
        meshes: [],
        vertices: [],
        kind: hostBoneKey ? 'bodyAttached' : 'handheld',
      }
      groups.set(root, group)
    }
    group.meshes.push(mesh)
  }
  for (const g of groups.values()) {
    const name = [g.root.name, ...g.meshes.map((m) => model.meshGroups.get(m) + ' ' + m.name)].join(' ')
    if ((!g.hostBoneKey || g.hostBoneKey === 'bip001') && groundedName.test(name)) g.kind = 'grounded'
  }
  return [...groups.values()]
}

function sampleProp(model: StudioModel, g: PropGroup, stageInv: Matrix4, hands: (Object3D | undefined)[]) {
  if (!g.root.matrixWorld.determinantAffine()) return
  const point = new Vector3(),
    stagePoint = new Vector3(),
    inverse = g.root.matrixWorld.clone().invert()
  const bounds = new Box3()
  const sampler = new SurfaceSampler(
    128,
    hands.map((h) => h && new Vector3().setFromMatrixPosition(h.matrixWorld).applyMatrix4(inverse)),
  )
  for (const mesh of g.meshes) {
    if (!model.switchVisible(mesh)) continue
    const count = mesh.geometry.getAttribute('position').count
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld)
      bounds.expandByPoint(stagePoint.copy(point).applyMatrix4(stageInv))
      sampler.add(point.applyMatrix4(inverse))
    }
  }
  const diagonal = bounds.getSize(point).length()
  if (diagonal < 1e-5) return // A switch morph can collapse every vertex at bind.
  g.vertices = sampler.finish()
  g.capsule = fitCapsule(sampler.bounds)
  if (!g.hostBoneKey && bounds.min.y < 0.08 && diagonal > 0.72) g.kind = 'grounded'
}

function fitCapsule(bounds: Box3): GripCapsule {
  const size = bounds.getSize(new Vector3())
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z'
  const localA = bounds.getCenter(new Vector3()),
    localB = localA.clone()
  localA[axis] = bounds.min[axis]
  localB[axis] = bounds.max[axis]
  size[axis] = 0
  return { localA, localB, radius: size.length() / 2 }
}

function collectWeapons(model: StudioModel, nodes: Map<string, Object3D>, stageInv: Matrix4) {
  const weapons = new Map<string, WeaponGrip>()
  const point = new Vector3(),
    pos = new Vector3(),
    scale = new Vector3(),
    rot = new Quaternion()
  const frame = new Matrix4(),
    handFrame = new Matrix4(),
    contact = new GripContact()
  const samplers = new Map<WeaponGrip, SurfaceSampler>(),
    inverses = new Map<WeaponGrip, Matrix4>()
  const emptyHand = (): HandGrip => ({
    valid: false,
    handToWeapon: new Matrix4(),
    supportInWeapon: new Vector3(),
    surfaceDist: Infinity,
  })
  for (const [key, node] of nodes) {
    if (!weaponKey.test(key)) continue
    const w: WeaponGrip = {
      key,
      node,
      bindScale: model.rest.get(node)!.restWorldScale,
      meshes: new Set(),
      vertices: [],
      capsule: { localA: new Vector3(), localB: new Vector3(), radius: 0 },
      rightGrip: emptyHand(),
      leftGrip: emptyHand(),
    }
    weapons.set(key, w)
    const inverse = node.matrixWorld.clone().invert()
    inverses.set(w, inverse)
    samplers.set(
      w,
      new SurfaceSampler(
        192,
        sides.map((side) => {
          const hand = nodes.get('bip001_' + side + '_hand')
          return hand && new Vector3().setFromMatrixPosition(hand.matrixWorld).applyMatrix4(inverse)
        }),
      ),
    )
  }
  if (!weapons.size) return weapons
  const owner = (node?: Object3D | null) => {
    for (let n = node; n; n = n.parent) {
      const w = weapons.get(canonicalBoneName(n.name))
      if (w) return w
    }
  }
  for (const mesh of model.weaponMeshes) {
    if (weapons.size > 1 && /chain|tether/i.test(mesh.name) && mesh instanceof SkinnedMesh &&
      mesh.skeleton.bones.some(b => /chain|tether/i.test(b.name))) continue
    const rigid = owner(mesh.parent)
    const owners =
      mesh instanceof SkinnedMesh ? new Map(mesh.skeleton.bones.map((b) => [b, owner(b)])) : undefined
    const hasOwners = owners && [...owners.values()].some(Boolean)
    const namedSide = /(?:^|[_ ])([rl])(?:[_ .]|$)/i.exec(mesh.name)?.[1].toLowerCase()
    const fallback = rigid ?? weapons.get(single) ?? weapons.get(single + '_' + namedSide)
    const count = mesh.geometry.getAttribute('position').count
    for (let i = 0; i < count; i++) {
      const bone = mesh instanceof SkinnedMesh && dominantBone(mesh, i)
      let w = bone && hasOwners ? owners?.get(bone) : fallback
      if (!w && bone && hasOwners) continue // Tethers weighted to the backpack aren't grip surfaces.
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld)
      if (!w) {
        let best = Infinity
        for (const candidate of weapons.values()) {
          const d = pos.setFromMatrixPosition(candidate.node.matrixWorld).distanceToSquared(point)
          if (d < best) {
            w = candidate
            best = d
          }
        }
      }
      if (!w) continue
      w.meshes.add(mesh)
      samplers.get(w)!.add(point.applyMatrix4(inverses.get(w)!))
    }
  }
  for (const w of weapons.values()) {
    const sampler = samplers.get(w)!
    w.vertices = sampler.finish()
    if (!w.vertices.length) continue
    w.capsule = fitCapsule(sampler.bounds)
    frame.multiplyMatrices(stageInv, w.node.matrixWorld)
    if (weaponCollapsed(scale.setFromMatrixScale(frame), w.bindScale)) continue
    for (const side of sides) {
      const hand = nodes.get('bip001_' + side + '_hand')
      if (!hand || (w.key !== single && !w.key.endsWith(side))) continue
      handFrame.multiplyMatrices(stageInv, hand.matrixWorld)
      if (handFrame.determinantAffine() === 0) continue
      handFrame.decompose(pos, rot, scale)
      const grip = handGrip(w, side)
      grip.surfaceDist = contact.distance(w.vertices, frame, pos)
      grip.supportInWeapon.setFromMatrixPosition(hand.matrixWorld).applyMatrix4(inverses.get(w)!)
      handFrame.compose(pos, rot.normalize(), scale.setScalar(1))
      grip.handToWeapon.copy(handFrame.invert()).multiply(frame)
      grip.valid = grip.surfaceDist < 0.14
    }
  }
  return weapons
}

export function gripProfile(model: StudioModel): GripProfile {
  const cached = profiles.get(model)
  if (cached) return cached
  const nodes = new Map([...model.rest.keys()].map((n) => [canonicalBoneName(n.name), n]))
  const saved = [...model.rest].map(([node, rest]) => ({
    node,
    rest,
    visible: node.visible,
    position: node.position.clone(),
    quaternion: node.quaternion.clone(),
    scale: node.scale.clone(),
    weights: node instanceof Mesh ? node.morphTargetInfluences?.slice() : undefined,
  }))
  const originalClip = model.activeVisibilityClip
  const clips = model.animations
  const named = (clip: (typeof clips)[number]) => normalizeClipName(clip.name)
  const clip =
    ['normal_idle', 'normal_attack_ing', 'formation_idle', 'cafe_idle']
      .map((name) => clips.find((c) => named(c) === name) ?? clips.find((c) => named(c).includes(name)))
      .find(Boolean) ??
    clips.find((c) => /idle|normal|attack|combat/.test(named(c))) ??
    clips[0]
  const player = new ClipPlayer(model.root)
  try {
    for (const { node, rest } of saved) {
      node.position.copy(rest.restLocalPos)
      node.quaternion.copy(rest.restLocalQuat)
      node.scale.copy(rest.restLocalScale)
      if (node instanceof Mesh && node.morphTargetInfluences)
        node.morphTargetInfluences.splice(
          0,
          node.morphTargetInfluences.length,
          ...model.restMorphWeights.get(node)!,
        )
    }
    model.root.updateWorldMatrix(true, false)
    model.root.updateMatrixWorld(true)
    const stageInv = new Matrix4()
    if (model.root.parent) stageInv.copy(model.root.parent.matrixWorld).invert()
    const hands = sides.map((side) => nodes.get('bip001_' + side + '_hand'))
    const props = propProfiles(model)
    model.syncSwitchVisibility()
    for (const group of props) sampleProp(model, group, stageInv, hands)
    player.sample(clip, 0)
    model.syncSwitchVisibility(clip)
    model.root.updateMatrixWorld(true)
    for (const group of props) if (!group.vertices.length) sampleProp(model, group, stageInv, hands)
    const weapons = collectWeapons(model, nodes, stageInv)
    const frame = new Matrix4(),
      scale = new Vector3()
    const collapsed = (w: WeaponGrip) =>
      weaponCollapsed(
        scale.setFromMatrixScale(frame.multiplyMatrices(stageInv, w.node.matrixWorld)),
        w.bindScale,
      )
    if (clip) {
      const hidden = [...weapons.values()].filter(collapsed)
      if (hidden.length) {
        player.sample(clip, clip.duration / 2)
        model.root.updateMatrixWorld(true)
        const middle = collectWeapons(model, nodes, stageInv)
        for (const w of hidden) weapons.set(w.key, middle.get(w.key)!)
        const stillHidden = hidden.filter(collapsed)
        if (stillHidden.length) {
          player.sample(undefined, 0)
          model.root.updateMatrixWorld(true)
          const bind = collectWeapons(model, nodes, stageInv)
          for (const w of stillHidden) weapons.set(w.key, bind.get(w.key)!)
        }
      }
    }
    const tethers = weaponTethers(model, weapons)
    for (const group of props) {
      if (group.vertices.length) continue
      // Switch-only props can be absent from every holding pose. Try authored
      // frames on their own tracks until a non-collapsed surface is available.
      const names = new Set<string>()
      for (const mesh of group.meshes) {
        names.add(model.meshGroups.get(mesh)!)
        for (let n: Object3D | null = mesh; n && n !== model.root; n = n.parent) {
          names.add(n.name)
          names.add(n.uuid)
        }
      }
      for (let n: Object3D | null = group.root; n && n !== model.root; n = n.parent) names.add(n.name)
      for (const propClip of clips) {
        if (
          !group.meshes.some((mesh) => model.clipSelectsPart(propClip, mesh)) &&
          !propClip.tracks.some((track) => names.has(PropertyBinding.parseTrackName(track.name).nodeName))
        )
          continue
        for (const fraction of [0, 0.25, 0.5, 0.75]) {
          player.sample(propClip, fraction * propClip.duration)
          model.syncSwitchVisibility(propClip)
          model.root.updateMatrixWorld(true)
          sampleProp(model, group, stageInv, hands)
          if (group.vertices.length) break
        }
        if (group.vertices.length) break
      }
    }
    for (const group of props) {
      if (group.kind === 'grounded' && (!group.vertices.length ||
        group.meshes.some(mesh => mesh instanceof SkinnedMesh || mesh.morphTargetInfluences?.length))) {
        const parts = group.meshes.map(liveSurface)
        group.liveSurface = { parts, vertices: parts.flatMap(part => part.points) }
      }
    }
    const profile = { weapons, props, tethers }
    profiles.set(model, profile)
    return profile
  } finally {
    player.dispose()
    for (const { node, position, quaternion, scale, weights } of saved) {
      node.position.copy(position)
      node.quaternion.copy(quaternion)
      node.scale.copy(scale)
      if (weights && node instanceof Mesh) node.morphTargetInfluences!.splice(0, weights.length, ...weights)
    }
    model.syncSwitchVisibility(originalClip)
    for (const { node, visible } of saved) node.visible = visible
    model.root.updateMatrixWorld(true)
  }
}

// All inputs and outputs here use slot coordinates, including the two hand frames.
// Reflection is therefore about the slot's X axis even on a rotated/scaled stage.
export class WeaponGrasp {
  readonly contact = new GripContact()
  readonly weights = { r: 0, l: 0 }
  private readonly relative = new Matrix4()
  private readonly inverse = new Matrix4()
  private readonly reflection = new Matrix4().makeScale(-1, 1, 1)
  private readonly pos = new Vector3()
  private readonly rotation = new Quaternion()
  private readonly scale = new Vector3()
  private readonly pivot = new Vector3()
  private readonly pivotOffset = new Vector3()
  private readonly fkPos = new Vector3()
  private readonly fkQuat = new Quaternion()
  private readonly fkScale = new Vector3()

  primary(
    displayKey: string,
    driver: WeaponGrip,
    track: Matrix4,
    hands: Record<Side, Matrix4 | undefined>,
    mirror: boolean,
  ) {
    for (const side of sides) {
      const src = mirror ? oppositeHand(side) : side,
        hand = hands[src]
      this.weights[side] =
        hand &&
        hand.determinantAffine() !== 0 &&
        (displayKey === single || displayKey.endsWith(side)) &&
        (driver.key === single || driver.key.endsWith(src))
          ? this.contact.weapon(driver, track, this.pos.setFromMatrixPosition(hand), src)
          : 0
    }
    const preferred = mirror ? 'l' : 'r',
      other = oppositeHand(preferred)
    if (this.weights[preferred] >= this.weights[other] && this.weights[preferred] > 0) return preferred
    if (this.weights[other] > 0) return other
  }

  unscaled(out: Matrix4, matrix: Matrix4) {
    matrix.decompose(this.pos, this.rotation, this.scale)
    return out.compose(this.pos, this.rotation.normalize(), this.scale.setScalar(1))
  }

  snap(
    out: Matrix4,
    hand: Matrix4,
    grip: HandGrip | undefined,
    bindHand: RestTransform | undefined,
    bindWeapon: RestTransform,
  ) {
    this.unscaled(out, hand)
    if (grip?.valid) return out.multiply(grip.handToWeapon)
    if (bindHand) {
      this.inverse.compose(bindHand.restWorldPos, bindHand.restWorldQuat, this.scale.setScalar(1)).invert()
      this.relative.compose(bindWeapon.restWorldPos, bindWeapon.restWorldQuat, bindWeapon.restWorldScale)
      out.multiply(this.inverse).multiply(this.relative)
    }
    return out
  }

  place(
    out: Matrix4,
    fk: Matrix4,
    actorHand: Matrix4,
    driverHand: Matrix4,
    track: Matrix4,
    actorGrip: HandGrip | undefined,
    driverGrip: HandGrip,
    weight: number,
    mirror: boolean,
  ) {
    if (!weight || actorHand.determinantAffine() === 0) return out.copy(fk)
    this.unscaled(this.relative, driverHand).invert().multiply(track)
    const compensate = actorGrip?.valid && driverGrip.valid
    if (compensate) this.relative.multiply(this.inverse.copy(driverGrip.handToWeapon).invert())
    if (mirror) this.relative.premultiply(this.reflection).multiply(this.reflection)
    if (compensate) this.relative.multiply(actorGrip.handToWeapon)
    this.unscaled(this.inverse, actorHand)
    this.relative.premultiply(this.inverse).decompose(this.pos, this.rotation, this.scale)
    const uniform = Math.cbrt(Math.abs(track.determinantAffine()))
    const reflected = this.scale.x < 0
    this.scale.set(reflected ? -uniform : uniform, uniform, uniform)
    // Keep the contact point fixed when removing scale/shear, including a
    // borrowed weapon whose mesh and native grip use different length units.
    const ref = actorGrip?.valid ? actorGrip : driverGrip
    if (ref.valid) {
      this.pivot.copy(ref.supportInWeapon).applyMatrix4(this.relative)
      this.pivotOffset
        .copy(ref.supportInWeapon)
        .multiply(this.scale)
        .applyQuaternion(this.rotation.normalize())
      this.pos.subVectors(this.pivot, this.pivotOffset)
    }
    fk.decompose(this.fkPos, this.fkQuat, this.fkScale)
    return out.compose(
      this.fkPos.lerp(this.pos, weight),
      this.fkQuat.normalize().slerp(this.rotation.normalize(), weight),
      this.fkScale.lerp(this.scale, weight),
    )
  }

  support(
    out: Vector3,
    target: WeaponGrip,
    source: WeaponGrip,
    side: Side,
    mirror: boolean,
    hand: Matrix4,
    track: Matrix4,
    placed: Matrix4,
  ) {
    const src = handGrip(source, mirror ? oppositeHand(side) : side),
      dst = handGrip(target, side)
    out.setFromMatrixPosition(hand).applyMatrix4(this.inverse.copy(track).invert())
    if (src.valid && dst.valid) {
      out.sub(src.supportInWeapon)
      out.clampLength(0, 0.12 / Math.max(1e-8, Math.cbrt(Math.abs(track.determinantAffine()))))
      if (mirror) out.x *= -1
      out.add(dst.supportInWeapon)
    } else if (mirror) out.x *= -1
    return out.applyMatrix4(placed)
  }
}
