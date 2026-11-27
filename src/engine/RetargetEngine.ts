import {
  AnimationMixer,
  LoopOnce,
  type AnimationAction,
  Euler,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
  type AnimationClip,
} from 'three'
import { clipSequence, sampleSequence, sequenceDuration } from './AnimationUtils'
import {
  canonicalBoneName,
  classifyBone,
  defaultRig,
  mirrorBoneName,
  type RigSettings,
} from './RigDefinition'
import { SpringBoneSolver } from './SpringBoneSolver'
import { decomposeRigTransform, rigBones, type StudioModel } from './ModelLoader'

// Absolute sampling retains the GLTFLoader interpolant factories (including cubic splines).
export class ClipPlayer {
  private readonly mixer: AnimationMixer
  private action?: AnimationAction
  constructor(private root: Object3D) {
    this.mixer = new AnimationMixer(root)
  }
  sample(clip: AnimationClip | undefined, time: number) {
    if (clip !== this.action?.getClip()) {
      this.action?.stop()
      this.action = clip ? this.mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play() : undefined
      if (this.action) this.action.clampWhenFinished = true
    }
    if (this.action) {
      this.action.time = time
      this.mixer.update(0)
    }
    this.root.updateWorldMatrix(true, true)
  }
  dispose() {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.root)
  }
}

function indexRig(model: StudioModel) {
  return rigBones(model).map((node) => {
    const key = canonicalBoneName(node.name),
      rest = model.rest.get(node)!
    let ancestor: Object3D | null = node
    let group = classifyBone(key)
    while (ancestor && canonicalBoneName(ancestor.name) !== 'bip001') {
      if (canonicalBoneName(ancestor.name) === 'bip001_weapon') group = 'weapon'
      ancestor = ancestor.parent
    }
    return {
      node,
      character: !!ancestor,
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

export class RetargetEngine {
  private readonly targets: Joint[]
  private readonly weaponTarget?: Joint
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
  private readonly hiddenDriverGroups: Object3D[] = []
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
    this.weaponTarget = this.targets.find((joint) => joint.character && joint.key === 'bip001_weapon')
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
      for (const node of [
        ...driverModel.bodyMeshes,
        ...driverModel.haloNodes,
        ...driverModel.mouthMeshes,
        ...driverModel.weaponMeshes,
      ]) {
        if (node instanceof Mesh) driverModel.setPartEnabled(node, false)
        else if (node.visible) {
          node.visible = false
          this.hiddenDriverGroups.push(node)
        }
      }
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
    this.spring.reset()
  }
  get duration() {
    return sequenceDuration(this.sequence, this.startWindow)
  }
  checkpointSpring() {
    return this.spring.checkpoint()
  }
  reset() {
    this.spring.reset()
  }

  private sourceJoint(j: Joint, rig: RigSettings, source: SampledRig) {
    const explicit = rig.overrides[j.node.name]?.source
    if (explicit) return source.byName.get(explicit)
    // A shared accessory name does not imply a compatible bind frame. A manual
    // rotation alone is an offset from A's rest pose, independent of B's bones.
    if (this.manualOnlyTargets.has(j.node.name)) return undefined
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
      )
    }
    this.spring.settings = rig.spring
    if (!rig.spring.enabled || !this.lastRig?.spring.enabled) this.spring.reset()
    this.actorModel.setWeaponsEnabled(rig.showActorWeapon)
    this.lastRig = rig
  }

  // time is absolute on the selected sequence. dt is simulation time since the
  // last sample; seek/loop callers reset before supplying the new time.
  sample(time: number, dt: number, rig: RigSettings, loop = false) {
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
      rig.expressionSync &&
      !Object.keys(rig.overrides).length &&
      Object.values(rig.mixer).every((mode) => mode === 'motionB') &&
      rig.offset.every((v) => v === 0)
    let weaponCollapsed = false
    if (!direct) {
      this.motion.capture()
      // Tethered weapon skins can also weight backpack joints that remain at bind pose.
      if (
        !native &&
        this.weaponTarget &&
        rig.mixer.weapon === 'motionB' &&
        !rig.overrides[this.weaponTarget.node.name]
      ) {
        const scale = this.motion.byKey.get('bip001_weapon')?.scale
        weaponCollapsed = !!scale && Math.min(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) < 0.05
      }
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
      if (!rig.expressionSync || rig.mixer.face === 'rest') {
        for (const m of this.actorMouths) copyWeights(m.mesh, m.bind)
      } else (rig.mixer.face === 'actorA' ? this.secondaryMouths : this.motionMouths)?.apply()
    }
    this.actorModel.setWeaponsCollapsed(weaponCollapsed)
    if (rig.spring.enabled) this.spring.step(dt)
    if (!direct || rig.spring.enabled) this.actorModel.root.updateMatrixWorld(true)
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
        if (group === 'face') this.solveFace(dst, src, rig.mirror)
        else this.solveWorldJoint(dst, src, rigSource.model.hipRestHeight, rig)
      }
      if (override?.rotation) {
        const [x, y, z] = override.rotation,
          rad = Math.PI / 180
        node.quaternion.multiply(this.offsetQ.setFromEuler(this.euler.set(x * rad, y * rad, z * rad)))
      }
    }
    // Update this node immediately, without recursively updating its entire subtree
    // for each ancestor. The next joint reads its already-solved parent.
    node.updateWorldMatrix(false, false)
  }
  private solveWorldJoint(dst: Joint, src: Joint, height: number, rig: RigSettings) {
    const { node, key } = dst
    node.parent!.updateWorldMatrix(true, false)
    this.parent.multiplyMatrices(this.stageInverse, node.parent!.matrixWorld)
    if (!decomposeRigTransform(this.parent, this.pos, this.parentQ, this.scale)) return
    if (key === 'bip001_weapon') {
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
      if (rig.mirror) this.reflect(this.delta)
      node.quaternion
        .copy(this.parentQ.normalize().invert())
        .multiply(this.delta)
        .multiply(dst.rest.restWorldQuat)
        .normalize()
    }
    if (key === 'bip001') this.solveRoot(dst, src, height, rig)
  }

  private solveRoot(dst: Joint, src: Joint, height: number, rig: RigSettings) {
    if (rig.rootMode === 'ground-scaled') {
      this.pos.subVectors(src.pos, src.rest.restWorldPos)
      if (rig.mirror) this.pos.x *= -1
      this.pos
        .multiplyScalar(Math.abs(height) > 1e-6 ? this.actorModel.hipRestHeight / height : 1)
        .add(dst.rest.restWorldPos)
    } else {
      this.pos.copy(src.pos)
      if (rig.mirror) this.pos.x *= -1
    }
    this.pos.x += rig.offset[0]
    this.pos.y += rig.offset[1]
    this.pos.z += rig.offset[2]
    dst.node.position.copy(this.pos).applyMatrix4(this.parent.invert())
  }

  private solveFace(dst: Joint, src: Joint, mirror: boolean) {
    const { node, rest } = dst
    this.pos.subVectors(src.localPos, src.rest.restLocalPos)
    this.delta.copy(src.localRot).multiply(this.offsetQ.copy(src.rest.restLocalQuat).invert()).normalize()
    if (!src.validRot) this.delta.identity()
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
      if (Math.abs(src.rest.restLocalScale[axis]) > 1e-8)
        node.scale[axis] *= src.localScale[axis] / src.rest.restLocalScale[axis]
    }
  }

  private reflect(q: Quaternion) {
    q.set(q.x, -q.y, -q.z, q.w)
  }
  dispose() {
    this.spring.reset()
    this.actorModel.setWeaponsCollapsed(false)
    if (this.nativeModified) this.motion.restoreNative()
    this.motion.player.dispose()
    this.secondary?.player.dispose()
    if (this.actorModel !== this.driverModel) {
      for (const group of this.hiddenDriverGroups) group.visible = true
      for (const mesh of this.driverModel.meshGroups.keys()) this.driverModel.setPartEnabled(mesh, true)
      this.driverModel.syncSwitchVisibility()
    }
  }
}
