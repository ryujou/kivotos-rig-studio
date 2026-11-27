import {
  DetachedBindMode,
  Euler,
  MathUtils,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type AnimationClip,
} from 'three'
import { clipSequence, sampleSequence, sequenceDuration } from './AnimationUtils'
import {
  canonicalBoneName,
  classifyBone,
  defaultRig,
  mirrorBoneName,
  weaponKey,
  weaponSourceKey,
  type RigSettings,
  type Vec3,
} from './RigDefinition'
import { bodyColliders, ColliderGroup, type BodyColliders, type DynamicCapsule } from './BodyColliders'
import { SpringBoneSolver } from './SpringBoneSolver'
import { torsoAccessoryAnchor } from './TorsoAccessories'
import { decomposeRigTransform, rigBones, type StudioModel } from './ModelLoader'

import { ArmIKSolver, type ArmChain } from './ArmIK'
import {
  gripProfile,
  drawableVisible,
  handGrip,
  oppositeHand,
  sides,
  smoothContact,
  weaponCollapsed,
  WeaponGrasp,
  type GripProfile,
  type GripCapsule,
  type PropGroup,
  type Side,
  type WeaponGrip,
} from './GripCalibration'
import { ClipPlayer } from './ClipPlayer'
export { ClipPlayer } from './ClipPlayer'

function indexRig(model: StudioModel) {
  return rigBones(model).map((node) => {
    const key = canonicalBoneName(node.name),
      rest = model.rest.get(node)!
    let ancestor: Object3D | null = node
    let group = classifyBone(key)
    while (ancestor && canonicalBoneName(ancestor.name) !== 'bip001') {
      if (weaponKey.test(canonicalBoneName(ancestor.name))) group = 'weapon'
      ancestor = ancestor.parent
    }
    return {
      node,
      character: !!ancestor || weaponKey.test(key),
      key,
      mirroredKey: mirrorBoneName(key),
      group,
      rest,
      parentBind: rest.restWorldQuat.clone().multiply(rest.restLocalQuat.clone().invert()).normalize(),
      inverseRest: rest.restWorldQuat.clone().normalize().invert(),
      validRot: true,
      matrix: new Matrix4(),
      pos: new Vector3(),
      rot: new Quaternion(),
      scale: new Vector3(),
      localPos: new Vector3(),
      localRot: new Quaternion(),
      localScale: new Vector3(),
    }
  })
}
type Joint = ReturnType<typeof indexRig>[number]

const forward = new Vector3(0, 0, 1)
const twistKey = /^bip001_([lr])_(upperarm|forearm|thigh)_twist$/

// Express the anatomical axis in the reference joint's bind frame. This also
// works when a sleeve helper is a sibling of the wrist, or precedes the hand.
function twistBinding(key: string, joints: Map<string, Joint>) {
  const match = twistKey.exec(key)
  if (!match) return
  const [, side, limb] = match
  const prefix = 'bip001_' + side + '_'
  const wrist = limb === 'forearm'
  const start = joints.get(prefix + limb)
  const end = joints.get(prefix + (wrist ? 'hand' : limb === 'thigh' ? 'calf' : 'forearm'))
  const reference = wrist ? start : joints.get(limb === 'thigh' ? 'bip001_pelvis' : prefix + 'clavicle')
  const joint = wrist ? end : start
  if (!start || !end || !reference || !joint) return
  const axis = end.rest.restWorldPos.clone().sub(start.rest.restWorldPos)
  if (axis.lengthSq() < 1e-12) return
  axis.normalize()
  return {
    joint,
    reference,
    axis,
    referenceAxis: axis.clone().applyQuaternion(reference.inverseRest),
    inverseRelativeBind: joint.inverseRest.clone().multiply(reference.rest.restWorldQuat),
    weight: wrist ? 0.55 : limb === 'thigh' ? 0.45 : 0.5,
  }
}

function mouths(model: StudioModel) {
  return model.mouthMeshes.flatMap((mesh) => {
    const id = /^mouth_(\d{3})/i.exec(mesh.name) ?? /^mouth_(\d{3})/i.exec(mesh.parent?.name ?? '')
    if (!id || !mesh.morphTargetInfluences?.length) return []
    return [
      {
        id: Number(id[1]),
        mesh,
        bind: model.restMorphWeights.get(mesh)!,
        values: [...mesh.morphTargetInfluences],
      },
    ]
  })
}
type Mouth = ReturnType<typeof mouths>[number]

class SampledRig {
  readonly joints: Joint[]
  readonly byKey: Map<string, Joint>
  readonly byName: Map<string, Joint>
  readonly mouths: Mouth[]
  readonly root: Object3D
  readonly player: ClipPlayer
  private readonly inverseStage = new Matrix4()

  constructor(
    readonly model: StudioModel,
    independent = false,
  ) {
    this.joints = indexRig(model)
    this.mouths = mouths(model)
    this.root = model.root
    if (independent) {
      // Secondary clips need an independent hierarchy, including unweighted turret
      // ancestors and morph bindings. Share geometry; no second drawable skin.
      const copies = new Map<Object3D, Object3D>()
      for (const [node, rest] of model.rest) {
        const copy =
          node instanceof Mesh && node.morphTargetInfluences
            ? new Mesh(node.geometry, node.material)
            : new Object3D()
        copy.name = node.name
        copy.position.copy(rest.restLocalPos)
        copy.quaternion.copy(rest.restLocalQuat)
        copy.scale.copy(rest.restLocalScale)
        if (copy instanceof Mesh && node instanceof Mesh) {
          copy.morphTargetDictionary = node.morphTargetDictionary
          copy.morphTargetInfluences = [
            ...(model.restMorphWeights.get(node) ?? node.morphTargetInfluences ?? []),
          ]
        }
        copies.set(node, copy)
        if (node.parent) copies.get(node.parent)?.add(copy)
      }
      this.root = copies.get(model.root)!
      for (const j of this.joints) j.node = copies.get(j.node)!
      for (const m of this.mouths) m.mesh = copies.get(m.mesh) as Mesh
    }
    this.byKey = new Map(this.joints.map((j) => [j.key, j]))
    this.byName = new Map(this.joints.map((j) => [j.node.name, j]))
    this.player = new ClipPlayer(this.root)
  }
  capture() {
    const stage = this.root.parent
    if (stage) this.inverseStage.copy(stage.matrixWorld).invert()
    else this.inverseStage.identity()
    for (const j of this.joints) {
      j.matrix.multiplyMatrices(this.inverseStage, j.node.matrixWorld)
      j.validRot = decomposeRigTransform(j.matrix, j.pos, j.rot, j.scale)
      if (j.validRot) j.rot.normalize()
      else j.rot.copy(j.rest.restWorldQuat)
      j.localPos.copy(j.node.position)
      j.localRot.copy(j.node.quaternion)
      j.localScale.copy(j.node.scale)
    }
    for (const m of this.mouths) m.values.splice(0, m.values.length, ...m.mesh.morphTargetInfluences!)
  }
  restoreNative() {
    for (const j of this.joints) {
      j.node.position.copy(j.localPos)
      j.node.quaternion.copy(j.localRot)
      j.node.scale.copy(j.localScale)
    }
    for (const m of this.mouths) copyWeights(m.mesh, m.values)
  }
}
function copyWeights(mesh: Mesh, values: number[]) {
  const target = mesh.morphTargetInfluences!
  for (let i = 0; i < target.length; i++) target[i] = values[i]
}

class MouthTransfer {
  private readonly hidden: number
  private readonly unmatched: Mouth[] = []
  private readonly routes: { target: Mouth; sources: Mouth[] }[]
  constructor(
    private targets: Mouth[],
    sources: Mouth[],
  ) {
    // BA scales its morph *into* hiding. The dominant bind weight identifies the
    // hidden state, including files authored with the opposite convention.
    const weights = sources.flatMap((m) => m.bind)
    this.hidden = weights.filter((v) => v > 0.5).length >= weights.length / 2 ? 1 : 0
    this.routes = targets.map((target) => ({ target, sources: [] as Mouth[] }))
    for (const src of sources) {
      const series = Math.floor(src.id / 100)
      const candidates = this.routes.filter(
        (r) =>
          r.target.id === src.id || (series >= 2 && series <= 7 && Math.floor(r.target.id / 100) === series),
      )
      const distance = Math.min(...candidates.map((r) => Math.abs(r.target.id - src.id)))
      const closest = candidates.find((r) => Math.abs(r.target.id - src.id) === distance)
      if (!closest) this.unmatched.push(src)
      else {
        for (const route of candidates) if (route.target.id === closest.target.id) route.sources.push(src)
      }
    }
  }
  apply() {
    for (const target of this.targets) copyWeights(target.mesh, target.bind)
    const active = this.routes.some((r) =>
      r.sources.some((s) => s.values.some((v) => Math.abs(v - this.hidden) > 1e-5)),
    )
    if (!active && this.unmatched.some((s) => s.values.some((v) => Math.abs(v - this.hidden) > 1e-5))) return
    for (const { target, sources } of this.routes) {
      const out = target.mesh.morphTargetInfluences!
      if (!sources.length && !active) continue
      for (let i = 0; i < out.length; i++) {
        let weight = this.hidden
        for (const source of sources) {
          const candidate = source.values[i] ?? this.hidden
          if (Math.abs(candidate - this.hidden) > Math.abs(weight - this.hidden)) weight = candidate
        }
        out[i] = weight
      }
    }
  }
}

function visibleMeshes(meshes: Iterable<Mesh>) {
  for (const mesh of meshes) {
    if (drawableVisible(mesh)) return true
  }
  return false
}

export class RetargetEngine {
  private readonly targets: Joint[]
  private readonly byKey: Map<string, Joint>
  private readonly twistChildren = new Map<Joint, Object3D>()
  private readonly twistChildWorld = new Matrix4()
  private readonly twistAxes = new Map<Joint, Vector3>()
  private readonly driverTwists = new Map<string, NonNullable<ReturnType<typeof twistBinding>>>()
  private readonly upperArms: Joint[]
  private readonly torsoAccessories: { node: Object3D; anchor: Object3D; relativeToAnchor: Matrix4 }[] = []
  readonly colliders: BodyColliders
  private readonly weaponTargets: Joint[]
  private readonly collapsedMeshes = new Set<Mesh>()
  private readonly collapsedKeys = new Set<string>()
  private readonly grasp = new WeaponGrasp()
  private readonly ik = new ArmIKSolver()
  private readonly arms: Partial<Record<Side, ArmChain>> = {}
  private readonly ikOptions = { clavicleMuted: false }
  private readonly twists: Record<Side, Joint[]> = { r: [], l: [] }
  private readonly actorTwists = new Map<Joint, NonNullable<ReturnType<typeof twistBinding>>>()
  private readonly driverHands: Record<Side, Matrix4 | undefined>
  private readonly locked = { r: false, l: false }
  private readonly clearanceAngle = { r: 0, l: 0 }
  private readonly grounded: Partial<Record<Side, PropGroup>> = {}
  private readonly groundedTarget = { r: new Vector3(), l: new Vector3() }
  private readonly groundedContact = { r: false, l: false }
  private readonly armClearance: Partial<Record<Side, { mid: Float64Array; hand: Float64Array }>> = {}
  private readonly shoulder = new Vector3()
  private readonly armMid = new Vector3()
  private readonly wrist = new Vector3()
  private readonly heldProps: PropGroup[] = []
  private readonly capsulePool: DynamicCapsule[] = []
  private readonly activeCapsules: DynamicCapsule[] = []
  private readonly borrowedFrames = new WeakMap<WeaponGrip, Matrix4>()
  private readonly alignedBorrowed: WeaponGrip[] = []
  private clothPending = false
  private clothDt = 0
  private direct = false
  private readonly propFrame = new Matrix4()
  private readonly propWeights = { r: 0, l: 0 }
  private readonly propTargets = { r: new Vector3(), l: new Vector3() }
  private readonly handFrame = new Matrix4()
  private readonly placed = new Matrix4()
  private readonly frame = new Matrix4()
  private readonly world = new Matrix4()
  private readonly stage = new Matrix4()
  private readonly goal = new Vector3()
  private readonly shift = new Vector3()
  private readonly editedProps = new Map<
    Object3D,
    { pos: Vector3; rot: Quaternion; scale: Vector3; edited: boolean; bindMode?: SkinnedMesh['bindMode'] }
  >()
  private driverProfile?: GripProfile
  private readonly motion: SampledRig
  private secondary?: SampledRig
  private secondaryMouths?: MouthTransfer
  private readonly actorMouths: Mouth[]
  private readonly motionMouths: MouthTransfer
  readonly manualOnlyTargets: ReadonlySet<string>
  readonly targetNames: string[]
  readonly sourceNames: string[]
  readonly animations: AnimationClip[]
  private sequence: AnimationClip[] = []
  private sequenceName?: string
  private startWindow = 0
  private sequenceEnd?: string
  private chained = false
  private nativeModified = false
  private lastRig?: RigSettings
  private springExclusions = new Set<Object3D>()
  spring: SpringBoneSolver
  private readonly stageInverse = new Matrix4()
  private readonly parent = new Matrix4()
  private readonly weaponLocal = new Matrix4()
  private readonly reflection = new Matrix4().makeScale(-1, 1, 1)
  private readonly parentQ = new Quaternion()
  private readonly delta = new Quaternion()
  private readonly offsetQ = new Quaternion()
  private readonly euler = new Euler()
  private readonly pos = new Vector3()
  private readonly scale = new Vector3()

  constructor(
    readonly actorModel: StudioModel,
    readonly driverModel = actorModel,
    external: readonly AnimationClip[] = [],
  ) {
    const clips = new Map(driverModel.animations.map((c) => [c.name, c]))
    for (const clip of external) clips.set(clip.name, clip)
    this.animations = [...clips.values()]
    this.motion = new SampledRig(driverModel)
    this.targets = indexRig(actorModel)
    this.byKey = new Map(this.targets.map((j) => [j.key, j]))
    this.upperArms = this.targets.filter((j) => /^bip001_[lr]_upperarm$/.test(j.key))
    this.colliders = bodyColliders(actorModel)
    if (actorModel !== driverModel) {
      const pelvisX = this.byKey.get('bip001_pelvis')?.rest.restWorldPos.x
      for (const { node, group, character } of this.targets) {
        if (!character || group !== 'secondary') continue
        const anchor = torsoAccessoryAnchor(node, actorModel.rest, pelvisX)
        if (!anchor) continue
        // Inverse anchor bind × root bind is exactly the product of the local
        // bind matrices between them, even under a reflected or scaled stage.
        const relativeToAnchor = new Matrix4()
        for (let n = node; n !== anchor; n = n.parent!) {
          const bind = actorModel.rest.get(n)!
          this.frame.compose(bind.restLocalPos, bind.restLocalQuat, bind.restLocalScale)
          relativeToAnchor.premultiply(this.frame)
        }
        this.torsoAccessories.push({ node, anchor, relativeToAnchor })
      }
    }
    for (const dst of this.targets) {
      const target = twistBinding(dst.key, this.byKey)
      if (!target) continue
      this.twistAxes.set(dst, target.axis.clone().applyQuaternion(dst.inverseRest))
      this.actorTwists.set(dst, target)
      if (dst.key.includes('upperarm') || dst.key.includes('forearm'))
        this.twists[dst.key.includes('_r_') ? 'r' : 'l'].push(dst)
      const end = this.byKey.get(
        dst.key.replace('upperarm_twist', 'forearm').replace('forearm_twist', 'hand'),
      )
      for (let child = end?.node; child?.parent; child = child.parent) {
        if (child.parent === dst.node) {
          this.twistChildren.set(dst, child)
          break
        }
      }
      for (const key of [dst.key, dst.mirroredKey]) {
        const source = twistBinding(key, this.motion.byKey)
        if (source) this.driverTwists.set(key, source)
      }
    }
    this.weaponTargets = this.targets.filter((j) => weaponKey.test(j.key))
    this.driverHands = {
      r: this.motion.byKey.get('bip001_r_hand')?.matrix,
      l: this.motion.byKey.get('bip001_l_hand')?.matrix,
    }
    for (const side of sides) {
      const prefix = 'bip001_' + side + '_'
      const upper = this.byKey.get(prefix + 'upperarm'),
        fore = this.byKey.get(prefix + 'forearm'),
        hand = this.byKey.get(prefix + 'hand')
      if (!upper || !fore || !hand) continue
      this.armClearance[side] = {
        mid: this.colliders.bindRadii(
          fore.rest.restWorldPos.clone().lerp(hand.rest.restWorldPos, 0.5),
          0.028,
          ColliderGroup.torso,
        ),
        hand: this.colliders.bindRadii(hand.rest.restWorldPos, 0.022, ColliderGroup.torso),
      }
      const axis = hand.rest.restWorldPos.clone().sub(upper.rest.restWorldPos).normalize()
      const bend = fore.rest.restWorldPos.clone().sub(upper.rest.restWorldPos)
      bend.addScaledVector(axis, -bend.dot(axis))
      if (bend.lengthSq() < 1e-10) bend.set(0, -1, 0)
      bend.transformDirection(
        new Matrix4()
          .compose(upper.rest.restWorldPos, upper.rest.restWorldQuat, upper.rest.restWorldScale)
          .invert(),
      )
      this.arms[side] = {
        clavicle: this.byKey.get(prefix + 'clavicle')?.node,
        upperArm: upper.node,
        forearm: fore.node,
        hand: hand.node,
        restPoleLocal: bend,
      }
    }
    this.manualOnlyTargets = new Set(
      this.targets
        .filter((j) => actorModel !== driverModel && j.group === 'secondary')
        .map((j) => j.node.name),
    )
    this.targetNames = this.targets.map((j) => j.node.name)
    this.sourceNames = [...this.motion.byName.keys()]
    this.actorMouths = mouths(actorModel)
    this.motionMouths = new MouthTransfer(this.actorMouths, this.motion.mouths)
    this.spring = new SpringBoneSolver([], actorModel.rest, this.springExclusions, defaultRig().spring)
    if (actorModel !== driverModel) {
      for (const mesh of [...driverModel.bodyMeshes, ...driverModel.mouthMeshes])
        driverModel.setPartEnabled(mesh, false)
      driverModel.setWeaponsEnabled(false)
      driverModel.setHalosEnabled(false)
      for (const mesh of actorModel.propMeshes) actorModel.setPartEnabled(mesh, false)
    }
  }
  setClip(name: string, chain = false, end?: string, startWindow = 0) {
    if (
      this.sequenceName === name &&
      this.chained === chain &&
      this.sequenceEnd === end &&
      startWindow === this.startWindow
    )
      return
    this.startWindow = startWindow
    this.sequenceEnd = end
    this.sequenceName = name
    this.chained = chain
    this.sequence = clipSequence(this.animations, name, chain, end)
    this.resetArmHistory()
    this.spring.reset()
  }
  get duration() {
    return sequenceDuration(this.sequence, this.startWindow)
  }
  checkpointSpring() {
    const resumeSpring = this.spring.checkpoint()
    const angles = { ...this.clearanceAngle }
    const grounded = { ...this.grounded }
    const targets = { l: this.groundedTarget.l.clone(), r: this.groundedTarget.r.clone() }
    // Capture restores the sampled clip at dt=0. Recover the continuously
    // filtered arm pose too, including the children compensated by twist IK.
    const arms = this.targets
      .filter(({ group }) =>
        (group === 'leftArm' && (angles.l || grounded.l)) ||
        (group === 'rightArm' && (angles.r || grounded.r)),
      )
      .map(({ node }) => ({
        node,
        position: node.position.clone(),
        rotation: node.quaternion.clone(),
        scale: node.scale.clone(),
      }))
    return () => {
      for (const side of sides) {
        this.grounded[side] = grounded[side]
        this.groundedTarget[side].copy(targets[side])
        this.clearanceAngle[side] = angles[side]
      }
      for (const { node, position, rotation, scale } of arms) {
        node.position.copy(position)
        node.quaternion.copy(rotation)
        node.scale.copy(scale)
      }
      if (arms.length) {
        this.actorModel.root.updateWorldMatrix(true, true)
        if (this.lastRig) this.anchorTorsoAccessories(this.lastRig)
      }
      resumeSpring()
    }
  }
  reset() {
    this.clothPending = false
    this.activeCapsules.length = 0
    this.colliders.setDynamicCapsules(this.activeCapsules)
    this.restoreProps()
    this.resetArmHistory()
    this.spring.reset()
  }

  private resetArmHistory() {
    for (const side of sides) {
      this.grounded[side] = undefined
      this.clearanceAngle[side] = 0
    }
  }

  private sourceJoint(j: Joint, rig: RigSettings, source: SampledRig) {
    const explicit = rig.overrides[j.node.name]?.source
    if (explicit) return source.byName.get(explicit)
    // A shared accessory name does not imply a compatible bind frame. A manual
    // rotation alone is an offset from A's rest pose, independent of B's bones.
    if (this.manualOnlyTargets.has(j.node.name)) return undefined
    if (weaponKey.test(j.key)) {
      const key = weaponSourceKey(j.key, rig.mirror, source.byKey)
      return key ? source.byKey.get(key) : undefined
    }
    return source.byKey.get(rig.mirror ? j.mirroredKey : j.key)
  }
  private configure(rig: RigSettings) {
    const native = this.actorModel === this.driverModel
    const excluded = new Set<Object3D>()
    for (const j of this.targets) {
      const override = rig.overrides[j.node.name]
      if (
        override?.source ||
        override?.rotation ||
        override?.muted ||
        (!native && this.sourceJoint(j, rig, this.motion))
      )
        excluded.add(j.node)
    }
    if (
      !this.lastRig ||
      excluded.size !== this.springExclusions.size ||
      [...excluded].some((node) => !this.springExclusions.has(node))
    ) {
      this.spring.reset()
      this.springExclusions = excluded
      this.spring = new SpringBoneSolver(
        this.targets.map((j) => j.node),
        this.actorModel.rest,
        excluded,
        rig.spring,
        this.colliders,
      )
    }
    this.spring.settings = rig.spring
    if (rig.spring.enabled !== this.lastRig?.spring.enabled || rig.antiClip !== this.lastRig?.antiClip)
      this.spring.reset()
    if (!rig.antiClip) this.clearanceAngle.l = this.clearanceAngle.r = 0
    this.actorModel.setWeaponsEnabled(rig.showActorWeapon)
    this.lastRig = rig
  }

  // time is absolute on the selected sequence. dt is simulation time since the
  // last sample; seek/loop callers reset before supplying the new time.
  sample(
    time: number,
    dt: number,
    rig: RigSettings,
    loop = false,
    display: StudioModel | null = this.actorModel,
    deferCloth = false,
  ) {
    this.clothDt = Number.isFinite(dt) ? dt : 0
    this.groundedContact.l = this.groundedContact.r = false
    this.restoreProps()
    this.spring.restore()
    if (this.nativeModified) {
      this.motion.restoreNative()
      this.nativeModified = false
    }
    if (rig !== this.lastRig) this.configure(rig)
    const duration = this.duration
    const at = sampleSequence(
      this.sequence,
      loop && duration && time > duration ? time % duration : time,
      this.startWindow,
    )
    this.motion.player.sample(at?.clip, at?.time ?? 0)
    const native = this.actorModel === this.driverModel
    this.driverModel.syncSwitchVisibility(at?.clip)
    if (!native) this.actorModel.syncSwitchVisibility()
    const mixActor = Object.values(rig.mixer).includes('actorA')
    const direct =
      native &&
      !rig.mirror &&
      rig.armSpread === 0 &&
      rig.expressionSync &&
      !Object.keys(rig.overrides).length &&
      Object.values(rig.mixer).every((mode) => mode === 'motionB') &&
      rig.offset.every((v) => v === 0)
    this.alignedBorrowed.length = this.heldProps.length = 0
    this.collapsedMeshes.clear()
    let weaponCollapsed = false
    if (!direct) {
      this.motion.capture()
      this.nativeModified = native
      if (mixActor) {
        if (!this.secondary) {
          this.secondary = new SampledRig(this.actorModel, true)
          this.secondaryMouths = new MouthTransfer(this.actorMouths, this.secondary.mouths)
        }
        const clip =
          this.actorModel.animations.find((c) => c.name === rig.secondaryClip) ??
          this.actorModel.animations[0]
        const actorTime = clip?.duration
          ? loop && time > clip.duration
            ? time % clip.duration
            : Math.min(time, clip.duration)
          : 0
        this.secondary.player.sample(clip, actorTime)
        this.secondary.capture()
      }
      const root = this.actorModel.root
      root.updateWorldMatrix(true, false)
      if (root.parent) this.stageInverse.copy(root.parent.matrixWorld).invert()
      else this.stageInverse.identity()
      for (const joint of this.targets) this.solveJoint(joint, rig)
      this.stage.copy(this.stageInverse).invert()
      if (rig.armSpread > 0) this.spreadArms(rig)
      if (!native || rig.armSpread > 0) {
        this.locked.r = this.locked.l = false
        weaponCollapsed = this.graspWeapons(rig, display)
        if (!native && rig.gripIK) this.graspProps(rig)
        if (!native && rig.antiClip) this.clearFreeArms(rig)
      }
      if (!native) this.anchorTorsoAccessories(rig)
      if (!rig.expressionSync || rig.mixer.face === 'rest') {
        for (const m of this.actorMouths) copyWeights(m.mesh, m.bind)
      } else (rig.mixer.face === 'actorA' ? this.secondaryMouths : this.motionMouths)?.apply()
    }
    this.actorModel.setWeaponsCollapsed(weaponCollapsed, direct ? undefined : this.collapsedMeshes)
    this.direct = direct
    for (const side of sides) if (!this.groundedContact[side]) this.grounded[side] = undefined
    this.clothPending = true
    if (!deferCloth) this.finishCloth(display, false)
  }

  // Scene sampling can finish after SlotProps has applied the selected donor,
  // hand attachment and user offsets. Standalone samples finish immediately.
  finishCloth(display: StudioModel | null, presented = true) {
    if (!this.clothPending) return
    this.clothPending = false
    const rig = this.lastRig!
    this.activeCapsules.length = 0
    const staticPass = rig.antiClip && this.actorModel !== this.driverModel
    if (this.direct && presented && rig.spring.enabled) {
      const stage = this.actorModel.root.parent
      if (stage) this.stageInverse.copy(stage.matrixWorld).invert()
      else this.stageInverse.identity()
    }
    if ((!this.direct || presented) && (staticPass || rig.spring.enabled)) {
      if (display?.weaponMeshes.length && (display !== this.actorModel || rig.showActorWeapon)) {
        for (const w of gripProfile(display).weapons.values()) {
          if (!w.vertices.length) continue
          let frame = w.node.matrixWorld
          if (presented || display === this.actorModel) {
            if (!visibleMeshes(w.meshes)) continue
          } else {
            // Before presentation, borrowed bones still have their donor pose.
            // Use this sample's placed grip or its mirrored FK track on release.
            if (!this.weaponVisible(display, w)) continue
            const sources = gripProfile(this.driverModel).weapons
            const key = weaponSourceKey(w.key, rig.mirror, sources) ?? 'bip001_weapon'
            const track = this.motion.byKey.get(key),
              driver = sources.get(key)
            if (
              !track ||
              !driver ||
              !this.weaponVisible(this.driverModel, driver) ||
              weaponCollapsed(track.scale, driver.bindScale)
            )
              continue
            if (this.alignedBorrowed.includes(w)) frame = this.borrowedFrames.get(w)!
            else {
              frame = this.world.copy(track.matrix)
              if (rig.mirror) frame.premultiply(this.reflection).multiply(this.reflection)
              frame.premultiply(this.stage)
            }
          }
          this.frame.multiplyMatrices(this.stageInverse, frame)
          if (!weaponCollapsed(this.scale.setFromMatrixScale(this.frame), w.bindScale))
            this.addCapsule(w.capsule, frame)
        }
      }
      for (const g of this.heldProps) if (g.capsule) this.addCapsule(g.capsule, g.root.matrixWorld)
    }
    this.colliders.setDynamicCapsules(this.activeCapsules)
    if (rig.spring.enabled) this.spring.step(this.clothDt)
    else if (staticPass) this.spring.solveStaticCollisions(this.clothDt)
    if (!this.direct || rig.spring.enabled) this.actorModel.root.updateMatrixWorld(true)
  }

  private addCapsule(capsule: GripCapsule, world: Matrix4) {
    const i = this.activeCapsules.length
    const out = (this.capsulePool[i] ??= { a: new Vector3(), b: new Vector3(), radius: 0 })
    const scale = this.stage.getMaxScaleOnAxis()
    out.a.copy(capsule.localA).applyMatrix4(world)
    out.b.copy(capsule.localB).applyMatrix4(world)
    out.radius = Math.max(0.015 * scale, Math.min(0.085 * scale, capsule.radius * world.getMaxScaleOnAxis()))
    this.activeCapsules.push(out)
  }

  private weaponVisible(model: StudioModel, weapon: WeaponGrip) {
    for (const mesh of weapon.meshes) if (model.switchVisible(mesh)) return true
    return false
  }

  private restoreProps() {
    for (const [root, saved] of this.editedProps) {
      if (!saved.edited) continue
      root.position.copy(saved.pos)
      root.quaternion.copy(saved.rot)
      root.scale.copy(saved.scale)
      if (root instanceof SkinnedMesh && saved.bindMode) root.bindMode = saved.bindMode
      root.updateWorldMatrix(true, true)
      if (root instanceof SkinnedMesh) root.updateMatrixWorld(true)
      saved.edited = false
    }
  }

  private placeWorld(node: Object3D, world: Matrix4) {
    if (!node.parent || !node.parent.matrixWorld.determinantAffine()) return
    this.parent.copy(node.parent.matrixWorld).invert().multiply(world)
    if (this.parent.determinantAffine() === 0) {
      node.position.setFromMatrixPosition(this.parent)
      node.scale.setFromMatrixScale(this.parent)
    } else this.parent.decompose(node.position, node.quaternion, node.scale)
    node.updateWorldMatrix(false, true)
  }

  private anchorTorsoAccessories(rig: RigSettings) {
    for (const { node, anchor, relativeToAnchor } of this.torsoAccessories) {
      const override = rig.overrides[node.name]
      if (override?.muted || override?.source) continue
      this.placeWorld(node, this.world.multiplyMatrices(anchor.matrixWorld, relativeToAnchor))
      if (override?.rotation) {
        this.rotateLocal(node, override.rotation)
        node.updateWorldMatrix(false, true)
      }
    }
  }

  private placeProp(root: Object3D, world: Matrix4, detachSkin = false) {
    let saved = this.editedProps.get(root)
    if (!saved) {
      saved = { pos: new Vector3(), rot: new Quaternion(), scale: new Vector3(), edited: false }
      this.editedProps.set(root, saved)
    }
    if (!saved.edited) {
      saved.pos.copy(root.position)
      saved.rot.copy(root.quaternion)
      saved.scale.copy(root.scale)
      saved.edited = true
      if (root instanceof SkinnedMesh) saved.bindMode = root.bindMode
    }
    if (detachSkin && root instanceof SkinnedMesh) root.bindMode = DetachedBindMode
    this.placeWorld(root, world)
    if (detachSkin) root.updateMatrixWorld(true)
  }

  private actorHand(side: Side) {
    return this.byKey.get(side === 'r' ? 'bip001_r_hand' : 'bip001_l_hand')
  }

  private canSolve(side: Side, rig: RigSettings) {
    const chain = this.arms[side]
    return (
      chain &&
      rig.mixer[side === 'r' ? 'rightArm' : 'leftArm'] === 'motionB' &&
      !rig.overrides[chain.upperArm.name] &&
      !rig.overrides[chain.forearm.name] &&
      !rig.overrides[chain.hand.name]
    )
  }

  private solveHand(side: Side, target: Vector3, weight: number, rig: RigSettings) {
    if (!this.canSolve(side, rig)) return false
    const arm = this.arms[side]!
    this.ikOptions.clavicleMuted = !!(arm.clavicle && rig.overrides[arm.clavicle.name])
    if (!this.ik.solveArm(arm, target, weight, this.ikOptions)) return false
    this.syncArmTwists(side, rig)
    return true
  }

  private syncArmTwists(side: Side, rig: RigSettings) {
    for (const dst of this.twists[side]) {
      if (rig.overrides[dst.node.name]) continue
      // Some skins put the wrist below the twist helper rather than beside it.
      // Rotate that helper without disturbing the solved downstream limb frame.
      const child = this.twistChildren.get(dst)
      if (child) this.twistChildWorld.copy(child.matrixWorld)
      this.synthesizeTwist(dst, false, true)
      if (child) this.placeWorld(child, this.twistChildWorld)
    }
  }

  // The extra pistol has no Motion B track. Carry its own grip on the other
  // palm; even without a reference clip the bind-frame offset is well defined.
  private spareWeapon(dst: Joint, side: Side, rig: RigSettings) {
    const hand = this.actorHand(side)
    if (!hand) return
    const grip = rig.gripIK ? gripProfile(this.actorModel).weapons.get(dst.key) : undefined
    this.handFrame.multiplyMatrices(this.stageInverse, hand.node.matrixWorld)
    this.grasp.snap(this.placed, this.handFrame, grip && handGrip(grip, side), hand.rest, dst.rest)
    this.placeWorld(dst.node, this.placed.premultiply(this.stage))
  }

  private alignWeapon(
    target: WeaponGrip,
    driver: WeaponGrip,
    track: Joint,
    rig: RigSettings,
    active: boolean,
    node?: Object3D,
  ) {
    if (!this.weaponVisible(this.driverModel, driver) || weaponCollapsed(track.scale, driver.bindScale))
      return
    const side = this.grasp.primary(target.key, driver, track.matrix, this.driverHands, rig.mirror)
    if (!side) return
    const hand = this.actorHand(side)
    if (!hand) return
    const src = rig.mirror ? oppositeHand(side) : side
    this.handFrame.multiplyMatrices(this.stageInverse, hand.node.matrixWorld)
    const rotation = node && rig.overrides[node.name]?.rotation
    if (node && !rotation) this.frame.multiplyMatrices(this.stageInverse, node.matrixWorld)
    else {
      this.frame.copy(track.matrix)
      if (rig.mirror) this.frame.premultiply(this.reflection).multiply(this.reflection)
    }
    this.grasp.place(
      this.placed,
      this.frame,
      this.handFrame,
      this.driverHands[src]!,
      track.matrix,
      handGrip(target, side),
      handGrip(driver, src),
      this.grasp.weights[side],
      rig.mirror,
    )
    this.placed.premultiply(this.stage)
    if (node) {
      this.placeWorld(node, this.placed)
      if (rotation) {
        this.rotateLocal(node, rotation)
        node.updateWorldMatrix(false, true)
        this.placed.copy(node.matrixWorld)
      }
    }
    if (!active) return
    if (!node) {
      let frame = this.borrowedFrames.get(target)
      if (!frame) this.borrowedFrames.set(target, (frame = new Matrix4()))
      frame.copy(this.placed)
      this.alignedBorrowed.push(target)
    }
    this.locked[side] = true
    const secondary = oppositeHand(side),
      opposite = oppositeHand(src)
    if (target.key !== 'bip001_weapon' || !this.canSolve(secondary, rig)) return
    let weight = this.grasp.weights[secondary]
    if (track.key === target.key) {
      if (!weight) return
      this.grasp.support(
        this.goal,
        target,
        driver,
        secondary,
        rig.mirror,
        this.driverHands[opposite]!,
        track.matrix,
        this.placed,
      )
    } else {
      // Each driver palm holds its own pistol. The actor has one rifle, with
      // its own calibrated foregrip and no shared driver-space support point.
      const grip = handGrip(target, secondary)
      const key = opposite === 'l' ? 'bip001_weapon_l' : 'bip001_weapon_r'
      const other = gripProfile(this.driverModel).weapons.get(key)
      const otherTrack = this.motion.byKey.get(key),
        palm = this.driverHands[opposite]
      if (
        !grip.valid ||
        !other ||
        !otherTrack ||
        !palm?.determinantAffine() ||
        !this.weaponVisible(this.driverModel, other)
      )
        return
      weight = this.grasp.contact.weapon(
        other,
        otherTrack.matrix,
        this.pos.setFromMatrixPosition(palm),
        opposite,
      )
      if (!weight) return
      this.goal.copy(grip.supportInWeapon).applyMatrix4(this.placed)
    }
    this.locked[secondary] = this.solveHand(secondary, this.goal, weight, rig)
    if (node) this.placeWorld(node, this.placed)
  }

  private graspWeapons(rig: RigSettings, display: StudioModel | null) {
    this.collapsedKeys.clear()
    if (rig.mixer.weapon !== 'motionB') return false
    for (const dst of this.weaponTargets) {
      const override = rig.overrides[dst.node.name]
      const source = this.sourceJoint(dst, rig, this.motion)
      if (
        override?.muted ||
        (override?.source && source?.key !== weaponSourceKey(dst.key, rig.mirror, this.motion.byKey))
      )
        continue
      const spare = !source && dst.key !== 'bip001_weapon'
      const track = source ?? (spare ? this.motion.byKey.get('bip001_weapon') : undefined)
      if (!track) continue
      if (source && rig.gripIK && rig.armSpread > 0) {
        // A few rigs parent the weapon track to an arm. Spreading the arm
        // must not drag a released weapon off its authored world track.
        this.solveWorldJoint(dst, source, this.motion, rig)
        if (override?.rotation) this.rotateLocal(dst.node, override.rotation)
        dst.node.updateWorldMatrix(false, true)
      }
      const driver = this.driverModel.weaponMeshes.length
        ? gripProfile(this.driverModel).weapons.get(track.key)
        : undefined
      if (
        weaponCollapsed(track.scale, track.rest.restWorldScale) ||
        (driver?.meshes.size && !this.weaponVisible(this.driverModel, driver))
      ) {
        this.collapsedKeys.add(dst.key)
        if (spare) this.placeWorld(dst.node, this.world.multiplyMatrices(this.stage, track.matrix))
        continue
      }
      if (spare) {
        const side = dst.key.endsWith('_l') ? 'l' : 'r'
        this.spareWeapon(dst, side, rig)
        if (override?.rotation) {
          this.rotateLocal(dst.node, override.rotation)
          dst.node.updateWorldMatrix(false, true)
        }
        if (rig.showActorWeapon && display === this.actorModel) this.locked[side] = true
        continue
      }
      if (!rig.gripIK) continue
      const target = gripProfile(this.actorModel).weapons.get(dst.key)
      if (!target || !driver) continue
      this.alignWeapon(
        target,
        driver,
        track,
        rig,
        display === this.actorModel && rig.showActorWeapon && this.weaponVisible(this.actorModel, target),
        dst.node,
      )
    }
    // Solve the support arm against the selected weapon before cloth. SlotProps
    // later applies this same placement to the drawable B/C grip and user offsets.
    if (rig.gripIK && display && display !== this.actorModel) {
      const sources = gripProfile(this.driverModel).weapons
      for (const target of gripProfile(display).weapons.values()) {
        const key = weaponSourceKey(target.key, rig.mirror, sources)
        if (!this.weaponVisible(display, target)) continue
        if (!key) {
          const primary = this.motion.byKey.get('bip001_weapon')
          const source = sources.get('bip001_weapon')
          if (
            primary &&
            source &&
            this.weaponVisible(this.driverModel, source) &&
            !weaponCollapsed(primary.scale, primary.rest.restWorldScale)
          )
            this.locked[target.key.endsWith('_l') ? 'l' : 'r'] = true
          continue
        }
        const track = this.motion.byKey.get(key)
        if (track) this.alignWeapon(target, sources.get(key)!, track, rig, true)
      }
    }
    if (!this.collapsedKeys.size) return false
    if (this.collapsedKeys.size === this.weaponTargets.length) return true
    const weapons = gripProfile(this.actorModel).weapons
    for (const w of weapons.values())
      if (this.collapsedKeys.has(w.key)) for (const mesh of w.meshes) this.collapsedMeshes.add(mesh)
    // A dual skin may render both pistols in one primitive; the collapsed
    // joint already hides its own vertices. Keep the other half drawable.
    for (const w of weapons.values())
      if (!this.collapsedKeys.has(w.key)) for (const mesh of w.meshes) this.collapsedMeshes.delete(mesh)
    return false
  }

  private graspProps(rig: RigSettings) {
    if (!this.driverModel.propMeshes.length) return
    this.driverProfile ??= gripProfile(this.driverModel)
    for (const g of this.driverProfile.props) {
      if (g.kind === 'bodyAttached' || !visibleMeshes(g.meshes)) continue
      this.propFrame.multiplyMatrices(this.stageInverse, g.root.matrixWorld)
      const vertices = g.liveSurface?.vertices ?? g.vertices
      let vertexCount = vertices.length
      if (g.liveSurface) {
        vertexCount = this.grasp.contact.groundedSurface(g.liveSurface, this.stageInverse)
        this.propFrame.identity()
        if (!vertexCount) continue
      } else if (weaponCollapsed(this.scale.setFromMatrixScale(this.propFrame), g.bindScale)) continue
      let count = 0,
        total = 0
      this.shift.set(0, 0, 0)
      for (const side of sides) {
        this.propWeights[side] = 0
        const hand = this.actorHand(side),
          src = this.driverHands[rig.mirror ? oppositeHand(side) : side]
        if (
          !hand ||
          !src ||
          !src.determinantAffine() ||
          this.locked[side] ||
          rig.mixer[side === 'r' ? 'rightArm' : 'leftArm'] !== 'motionB' ||
          rig.overrides[hand.node.name] ||
          (this.arms[side] && !this.canSolve(side, rig))
        )
          continue
        const p = this.goal.setFromMatrixPosition(src)
        const target = this.propTargets[side]
        const weight = smoothContact(this.grasp.contact.distance(vertices, this.propFrame, p, target, vertexCount))
        if (!weight) continue
        if (g.kind === 'grounded') {
          const filtered = this.groundedTarget[side]
          if (this.grounded[side] === g && this.clothDt > 0)
            filtered.lerp(target, -Math.expm1(-24 * this.clothDt))
          else filtered.copy(target)
          this.locked[side] = this.solveHand(side, target.copy(filtered).applyMatrix4(this.stage), weight, rig)
          if (this.locked[side]) {
            this.grounded[side] = g
            this.groundedContact[side] = true
          }
          continue
        }
        target.copy(p).applyMatrix4(this.stage)
        this.shift.addScaledVector(this.pos.setFromMatrixPosition(hand.node.matrixWorld).sub(target), weight)
        this.locked[side] = true
        this.propWeights[side] = weight
        total += weight
        count++
      }
      if (!count) continue
      this.heldProps.push(g)
      if (count === 2) this.shift.divideScalar(total)
      this.world.copy(g.root.matrixWorld)
      this.world.setPosition(this.pos.setFromMatrixPosition(this.world).add(this.shift))
      this.placeProp(g.root, this.world)
      if (count === 2)
        for (const side of sides)
          this.solveHand(side, this.propTargets[side].add(this.shift), this.propWeights[side], rig)
    }
    // Body-mounted accessories use the final host pose, including prop/weapon IK.
    for (const g of this.driverProfile.props) {
      if (g.kind !== 'bodyAttached' || !g.hostBoneKey || !visibleMeshes(g.meshes)) continue
      const src = this.motion.byKey.get(g.hostBoneKey)
      const dst = this.byKey.get(rig.mirror ? mirrorBoneName(g.hostBoneKey) : g.hostBoneKey)
      if (!src?.validRot || !dst) continue
      // A prop weighted directly to a humanoid joint has no independent bone
      // to move. Apply the delta after skinning using its detached bind frame.
      const skin =
        g.directSkin && g.root instanceof SkinnedMesh && g.root.bindMode !== DetachedBindMode
          ? g.root
          : undefined
      this.frame
        .multiplyMatrices(this.stage, src.matrix)
        .invert()
        .multiply(skin?.bindMatrix ?? g.root.matrixWorld)
      if (rig.mirror) this.frame.premultiply(this.reflection).multiply(this.reflection)
      this.placeProp(g.root, this.world.multiplyMatrices(dst.node.matrixWorld, this.frame), !!skin)
    }
  }

  private rotateLocal(node: Object3D, rotation: Vec3) {
    const [x, y, z] = rotation,
      rad = Math.PI / 180
    node.quaternion.multiply(this.offsetQ.setFromEuler(this.euler.set(x * rad, y * rad, z * rad)))
  }

  private solveJoint(dst: Joint, rig: RigSettings) {
    const { node, rest, group } = dst
    const override = rig.overrides[node.name]
    // On a native rig, the mixer owns vehicle ancestors and their independent
    // visibility tracks. A character edit must not reset the turret or its props.
    if (!dst.character && !override) {
      if (this.actorModel !== this.driverModel) {
        node.position.copy(rest.restLocalPos)
        node.quaternion.copy(rest.restLocalQuat)
        node.scale.copy(rest.restLocalScale)
        node.updateWorldMatrix(false, false)
      }
      return
    }
    if (this.actorModel === this.driverModel && group === 'secondary' && !rig.mirror && !override) return
    const mode = group === 'secondary' ? 'motionB' : rig.mixer[group]
    const source = mode === 'actorA' ? this.secondary! : this.motion
    // An explicit binding selects a Motion B bone even on an Actor A group.
    const rigSource = override?.source ? this.motion : source
    const src = this.sourceJoint(dst, rig, rigSource)
    node.position.copy(rest.restLocalPos)
    node.quaternion.copy(rest.restLocalQuat)
    node.scale.copy(rest.restLocalScale)
    if (!override?.muted && mode !== 'rest' && (group !== 'face' || rig.expressionSync)) {
      if (src) {
        if (group === 'face') this.solveFace(dst, src, rig.mirror, rigSource.model === this.actorModel)
        else this.solveWorldJoint(dst, src, rigSource, rig)
      } else if (!override && rigSource === this.motion) this.synthesizeTwist(dst, rig.mirror)
      if (override?.rotation) this.rotateLocal(node, override.rotation)
    }
    // Update this node immediately, without recursively updating its entire subtree
    // for each ancestor. The next joint reads its already-solved parent.
    node.updateWorldMatrix(false, false)
  }
  private synthesizeTwist(dst: Joint, mirror: boolean, afterIK = false) {
    const axis = this.twistAxes.get(dst)
    if (!axis) return
    const binding = afterIK
      ? this.actorTwists.get(dst)
      : this.driverTwists.get(mirror ? dst.mirroredKey : dst.key)
    if (!binding) return
    const q = this.delta
    if (afterIK) {
      this.frame.multiplyMatrices(this.stageInverse, binding.reference.node.matrixWorld)
      if (!decomposeRigTransform(this.frame, this.pos, q, this.scale)) return
      this.frame.multiplyMatrices(this.stageInverse, binding.joint.node.matrixWorld)
      if (!decomposeRigTransform(this.frame, this.pos, this.parentQ, this.scale)) return
      q.normalize().invert().multiply(this.parentQ.normalize())
    } else {
      if (!binding.joint.validRot || !binding.reference.validRot) return
      q.copy(binding.reference.rot).invert().multiply(binding.joint.rot)
    }
    q.multiply(binding.inverseRelativeBind).normalize()
    const a = binding.referenceAxis
    const projection = q.x * a.x + q.y * a.y + q.z * a.z
    if (projection * projection + q.w * q.w < 1e-12) return
    // q and -q encode the same rotation. Choose the short signed twist.
    const angle = 2 * Math.atan2(q.w < 0 ? -projection : projection, Math.abs(q.w))
    if (!Number.isFinite(angle)) return
    if (afterIK) dst.node.quaternion.copy(dst.rest.restLocalQuat)
    dst.node.quaternion.multiply(
      this.offsetQ.setFromAxisAngle(axis, angle * binding.weight * (mirror ? -1 : 1)),
    )
    if (afterIK) dst.node.updateWorldMatrix(false, true)
  }

  private spreadArms(rig: RigSettings) {
    for (const arm of this.upperArms) {
      if (
        rig.overrides[arm.node.name]?.muted ||
        (arm.group !== 'secondary' && rig.mixer[arm.group] === 'rest')
      )
        continue
      this.abduct(arm, (Math.min(30, rig.armSpread) * Math.PI) / 180)
    }
  }

  private outwardSign(arm: Joint) {
    const center = this.byKey.get('bip001_pelvis')?.rest.restWorldPos.x ?? 0
    return Math.sign(arm.rest.restWorldPos.x - center) || (arm.key === 'bip001_l_upperarm' ? 1 : -1)
  }

  private abduct(arm: Joint, radians: number) {
    const parent = arm.node.parent!
    this.parent.multiplyMatrices(this.stageInverse, parent.matrixWorld)
    const determinant = this.parent.determinantAffine()
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return
    const axis = this.pos.copy(forward).transformDirection(this.parent.invert())
    if (determinant < 0) axis.negate()
    arm.node.quaternion.premultiply(this.offsetQ.setFromAxisAngle(axis, this.outwardSign(arm) * radians))
    arm.node.updateWorldMatrix(false, true)
  }

  private armDepth(side: Side, angle: number, scale: number) {
    const bind = this.armClearance[side]!
    this.offsetQ.setFromAxisAngle(forward, angle)
    this.goal.copy(this.armMid).applyQuaternion(this.offsetQ).add(this.shoulder).applyMatrix4(this.stage)
    const mid = this.colliders.torsoDepth(this.goal, 0.028 * scale, bind.mid)
    this.goal.copy(this.wrist).applyQuaternion(this.offsetQ).add(this.shoulder).applyMatrix4(this.stage)
    return Math.max(mid, this.colliders.torsoDepth(this.goal, 0.022 * scale, bind.hand))
  }

  private clearFreeArms(rig: RigSettings) {
    const scale = this.stage.getMaxScaleOnAxis(),
      tolerance = 0.004 * scale
    let updated = false
    for (const arm of this.upperArms) {
      const side = arm.key === 'bip001_l_upperarm' ? 'l' : 'r'
      if (this.locked[side] || !this.canSolve(side, rig)) {
        this.clearanceAngle[side] = 0
        continue
      }
      if (!updated) {
        this.colliders.updateTorso()
        updated = true
      }
      const chain = this.arms[side]!
      this.shoulder.setFromMatrixPosition(arm.node.matrixWorld).applyMatrix4(this.stageInverse)
      this.wrist
        .setFromMatrixPosition(chain.hand.matrixWorld)
        .applyMatrix4(this.stageInverse)
        .sub(this.shoulder)
      this.armMid
        .setFromMatrixPosition(chain.forearm.matrixWorld)
        .applyMatrix4(this.stageInverse)
        .sub(this.shoulder)
        .lerp(this.wrist, 0.5)
      const depth = this.armDepth(side, 0, scale)
      let angle = 0
      if (depth > tolerance) {
        const sign = this.outwardSign(arm)
        let lo = 0
        let hi = (14 * Math.PI) / 180
        const endDepth = this.armDepth(side, sign * hi, scale)
        if (endDepth < depth) {
          const targetDepth = Math.max(endDepth, 2 * tolerance - depth)
          for (let i = 0; i < 10; i++) {
            const mid = (lo + hi) / 2
            if (this.armDepth(side, sign * mid, scale) > targetDepth) lo = mid
            else hi = mid
          }
          angle = hi * MathUtils.smoothstep(depth - endDepth, 0, tolerance)
        }
      }
      if (this.clothDt > 0) {
        const previous = this.clearanceAngle[side]
        const limit = Math.PI * this.clothDt
        angle = previous + MathUtils.clamp(angle - previous, -limit, limit)
      }
      this.clearanceAngle[side] = angle
      if (!angle) continue
      // Clearance swings the whole arm. Its elbow and wrist retain their
      // relative pose, including the twist already supplied by FK or grip IK.
      this.abduct(arm, angle)
    }
  }

  private solveWorldJoint(dst: Joint, src: Joint, source: SampledRig, rig: RigSettings) {
    const { node, key } = dst
    node.parent!.updateWorldMatrix(true, false)
    this.parent.multiplyMatrices(this.stageInverse, node.parent!.matrixWorld)
    const validParentRotation = decomposeRigTransform(this.parent, this.pos, this.parentQ, this.scale)
    // Pickup clips shrink the turret. Its matrix can still map positions at that scale.
    if (key === 'bip001' && (validParentRotation || this.parent.determinantAffine() !== 0))
      this.solveRoot(dst, src, source.model.hipRestHeight, rig)
    if (!validParentRotation) return
    if (weaponKey.test(key)) {
      this.weaponLocal.copy(src.matrix)
      if (rig.mirror) this.weaponLocal.premultiply(this.reflection).multiply(this.reflection)
      this.weaponLocal.premultiply(this.parent.invert())
      if (src.validRot) {
        this.weaponLocal.decompose(node.position, node.quaternion, node.scale)
        node.quaternion.normalize()
      } else {
        // A collapsed grip still carries an authored position and scale.
        node.position.setFromMatrixPosition(this.weaponLocal)
        node.scale.setFromMatrixScale(this.weaponLocal)
      }
      return
    }
    if (src.validRot) {
      this.delta.copy(src.rot).multiply(src.inverseRest).normalize()
      if (key === 'bip001_spine1' && src.key === key && !rig.overrides[node.name]?.source) {
        if (!this.byKey.has('bip001_spine2')) this.foldRotation(source.byKey.get('bip001_spine2'), 0.65)
        if (!this.byKey.has('bip001_neck')) this.foldRotation(source.byKey.get('bip001_neck'), 0.35)
      }
      if (rig.mirror) this.reflect(this.delta)
      node.quaternion
        .copy(this.parentQ.normalize().invert())
        .multiply(this.delta)
        .multiply(dst.rest.restWorldQuat)
        .normalize()
    }
  }

  private foldRotation(joint: Joint | undefined, weight: number) {
    if (joint?.validRot)
      this.delta.slerp(this.offsetQ.copy(joint.rot).multiply(joint.inverseRest).normalize(), weight)
  }

  private solveRoot(dst: Joint, src: Joint, height: number, rig: RigSettings) {
    if (rig.rootMode === 'ground-scaled') {
      this.pos.subVectors(src.pos, src.rest.restWorldPos)
      if (rig.mirror) this.pos.x *= -1
      this.pos
        .multiplyScalar(Math.abs(height) > 1e-6 ? this.actorModel.hipRestHeight / height : 1)
        .add(dst.rest.restWorldPos)
      if (this.actorModel !== this.driverModel) this.pos.sub(this.actorModel.restGroundOffset)
    } else {
      this.pos.copy(src.pos)
      if (rig.mirror) this.pos.x *= -1
    }
    this.pos.x += rig.offset[0]
    this.pos.y += rig.offset[1]
    this.pos.z += rig.offset[2]
    dst.node.position.copy(this.pos).applyMatrix4(this.parent.invert())
  }

  private solveFace(dst: Joint, src: Joint, mirror: boolean, sameModel: boolean) {
    const { node, rest } = dst
    // Masked eye layers can have all-zero keys on otherwise nonzero bind transforms.
    if (src.localPos.lengthSq() < 1e-10 && src.rest.restLocalPos.lengthSq() > 1e-6) this.pos.set(0, 0, 0)
    else this.pos.subVectors(src.localPos, src.rest.restLocalPos)
    if (!src.validRot || src.localRot.lengthSq() < 1e-8) this.delta.identity()
    else
      this.delta.copy(src.localRot).multiply(this.offsetQ.copy(src.rest.restLocalQuat).invert()).normalize()
    if (mirror) {
      // Eye layers use model-specific local axes. Reflect in the character
      // frame and convert the result back into the target parent's bind frame.
      const from = this.offsetQ.copy(src.parentBind)
      this.pos.applyQuaternion(from)
      this.delta.premultiply(from).multiply(from.invert())
      this.reflect(this.delta)
      this.pos.x *= -1
      const to = this.parentQ.copy(dst.parentBind)
      this.delta.multiply(to).premultiply(to.invert())
      this.pos.applyQuaternion(to)
    }
    node.position.add(this.pos)
    node.quaternion.copy(this.delta).multiply(rest.restLocalQuat).normalize()
    for (const axis of ['x', 'y', 'z'] as const) {
      const scale = src.localScale[axis]
      const bindScale = src.rest.restLocalScale[axis]
      if (Math.abs(bindScale) > 1e-8 && (sameModel || Math.abs(scale) >= 1e-3))
        node.scale[axis] *= scale / bindScale
    }
  }

  private reflect(q: Quaternion) {
    q.set(q.x, -q.y, -q.z, q.w)
  }
  dispose() {
    this.reset()
    this.actorModel.setWeaponsCollapsed(false)
    if (this.nativeModified) this.motion.restoreNative()
    this.motion.player.dispose()
    this.secondary?.player.dispose()
    if (this.actorModel !== this.driverModel) {
      for (const mesh of this.driverModel.meshGroups.keys()) this.driverModel.setPartEnabled(mesh, true)
      this.driverModel.syncSwitchVisibility()
    }
  }
}
