import { Box3, Group, Matrix4, Mesh, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three'
import { useStudioStore as store, type Slot, type StageSettings } from '../store/useStudioStore'
import { decomposeRigTransform, rigBones, ModelLoader, type StudioModel } from './ModelLoader'
import type { RetargetEngine } from './RetargetEngine'
import { ClipPlayer } from './ClipPlayer'
import {
  gripProfile,
  handGrip,
  oppositeHand,
  sides,
  weaponCollapsed,
  WeaponGrasp,
  type Side,
} from './GripCalibration'
import { canonicalBoneName, weaponKey, weaponSourceKey } from './RigDefinition'
import type { HaloSettings, MountedProp, Transform } from './PropTypes'

const rad = Math.PI / 180
const donorKinds = ['weapon', 'halo'] as const
type DonorKind = (typeof donorKinds)[number]
export function applyTransform(object: Object3D, value: Transform) {
  object.position.fromArray(value.position)
  object.rotation.set(value.rotation[0] * rad, value.rotation[1] * rad, value.rotation[2] * rad)
  object.scale.fromArray(value.scale)
}
export function readTransform(object: Object3D): Transform {
  return {
    position: object.position.toArray(),
    scale: object.scale.toArray(),
    rotation: [object.rotation.x / rad, object.rotation.y / rad, object.rotation.z / rad],
  }
}
export function styleModel(model: StudioModel, stage: StageSettings) {
  model.setShading(stage.shading)
  model.outline.apply(stage.outline && stage.shading !== 'wireframe', stage.width, stage.color)
}

const bindings = new WeakMap<StudioModel, ReturnType<typeof indexModel>>()
function indexModel(model: StudioModel) {
  const bones = new Map(rigBones(model).map((b) => [canonicalBoneName(b.name), b]))
  const halos = new Set(model.haloNodes)
  const haloRoots = [...halos].filter((node) => {
    for (let parent = node.parent; parent; parent = parent.parent) if (halos.has(parent)) return false
    return true
  })
  const grips = [...bones].filter(([key]) => weaponKey.test(key)).map(([, node]) => node)
  if (!bones.has('bip001') && model.weaponMeshes.length && !grips.length) grips.push(model.root)
  if (!grips.length) {
    for (const mesh of model.weaponMeshes) {
      if (mesh instanceof SkinnedMesh) {
        const joints = new Set(mesh.skeleton.bones)
        for (const bone of joints) {
          if (!mesh.skeleton.bones.some((parent) => parent.children.includes(bone)) && !grips.includes(bone))
            grips.push(bone)
        }
      } else grips.push(mesh)
    }
  }
  const groups = new Map<string, Mesh[]>()
  for (const mesh of model.propMeshes) {
    const name = model.meshGroups.get(mesh)!
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push(mesh)
  }
  // Unweighted sockets (e.g. St_point) are ordinary glTF nodes, outside the humanoid rig.
  const sockets = new Map(bones)
  for (const node of model.rest.keys()) {
    if (node.name && node.type === 'Object3D' && !sockets.has(canonicalBoneName(node.name)))
      sockets.set(canonicalBoneName(node.name), node)
  }
  const keys = new Map(grips.map((node) => [node, canonicalBoneName(node.name)]))
  const tracks = new Map(grips.map((node) => [node, new Matrix4()]))
  const originals = new Map(
    [...grips, ...haloRoots].map((node) => [
      node,
      { position: new Vector3(), rotation: new Quaternion(), scale: new Vector3() },
    ]),
  )
  const embeddedGroups = [...groups]
  return { bones, grips, groups, embeddedGroups, sockets, haloRoots, keys, tracks, originals }
}
function binding(model: StudioModel) {
  let data = bindings.get(model)
  if (!data) {
    data = indexModel(model)
    bindings.set(model, data)
  }
  return data
}
export const attachmentNames = (model: StudioModel) => [...binding(model).sockets.values()].map((n) => n.name)
export const propGroupNames = (model: StudioModel) => [...binding(model).groups.keys()]
function subsetMeshes(model: StudioModel, subset: string) {
  if (subset === 'halo') return model.haloNodes.filter((node) => node instanceof Mesh)
  if (subset === 'weapon') return model.weaponMeshes
  return binding(model).groups.get(subset)
}
function isolate(model: StudioModel, subset: string) {
  if (subset === 'whole') return
  const keep = new Set(subsetMeshes(model, subset))
  if (!keep.size) throw new Error('missing_mesh_group')
  for (const mesh of model.meshGroups.keys()) model.setPartEnabled(mesh, keep.has(mesh))
}

// Presentation edits must be removed before either the mixer or the retargeter
// samples the next pose. This also prevents offsets accumulating on paused frames.
export class SlotProps {
  private readonly editedGrips: Object3D[] = []
  private readonly savedPoses: { position: Vector3; rotation: Quaternion; scale: Vector3 }[] = []
  private readonly grasp = new WeaponGrasp()
  private readonly handMatrices = { r: new Matrix4(), l: new Matrix4() }
  private readonly hands: Record<Side, Matrix4 | undefined> = { r: undefined, l: undefined }
  private readonly reflection = new Matrix4().makeScale(-1, 1, 1)
  private scratch = new Matrix4()
  private offset = new Matrix4()
  private target = new Matrix4()
  private transform = new Object3D()
  private readonly stageWorld = new Matrix4()
  private readonly stageInv = new Matrix4()
  private readonly actorFrame = new Matrix4()
  private readonly sourceFrame = new Matrix4()
  private readonly position = new Vector3()
  private readonly rotation = new Quaternion()
  private readonly restInverse = new Quaternion()
  private readonly scale = new Vector3()
  constructor(
    readonly actor: StudioModel,
    readonly motion: StudioModel,
  ) {
    binding(actor)
    binding(motion)
  }
  restore() {
    for (let i = 0; i < this.editedGrips.length; i++) {
      const node = this.editedGrips[i],
        saved = this.savedPoses[i]
      node.position.copy(saved.position)
      node.quaternion.copy(saved.rotation)
      node.scale.copy(saved.scale)
      node.updateWorldMatrix(true, true)
    }
    this.editedGrips.length = this.savedPoses.length = 0
  }
  apply(slot: Slot, donor?: StudioModel, haloDonor?: StudioModel) {
    this.setEmbedded(slot.embedded)
    const weapon = this.applyWeapon(slot, donor)
    this.applyHalo(slot, haloDonor)
    return weapon
  }
  setEmbedded(embedded: Slot['embedded']) {
    for (const [name, meshes] of binding(this.motion).embeddedGroups)
      for (const mesh of meshes) this.motion.setPartEnabled(mesh, embedded[name] !== false)
  }
  private sourceModel(source: HaloSettings['source'], donor?: StudioModel) {
    switch (source) {
      case 'actorA':
        return this.actor
      case 'motionB':
        return this.motion
      case 'donorC':
        return donor
      case 'hidden':
        return undefined
    }
  }
  prepareWeapon(slot: Slot, donor?: StudioModel) {
    const w = slot.weapon
    if (w.attach === 'rightHand') {
      const model = this.sourceModel(w.source, donor)
      if (model) gripProfile(model)
    } else if (
      slot.rig.gripIK &&
      this.actor !== this.motion &&
      (w.source === 'motionB' || w.source === 'donorC')
    ) {
      gripProfile(this.motion)
      if (w.source === 'donorC' && donor) gripProfile(donor)
    }
  }
  displayedWeapon(slot: Slot, donor?: StudioModel) {
    if (slot.weapon.source === 'actorA' && !slot.rig.showActorWeapon) return null
    return this.sourceModel(slot.weapon.source, donor) ?? null
  }
  trackedWeapon(slot: Slot, donor?: StudioModel) {
    return slot.weapon.attach === 'weaponTrack' ? this.displayedWeapon(slot, donor) : null
  }
  private applyWeapon(slot: Slot, donor?: StudioModel) {
    const w = slot.weapon
    const model = this.sourceModel(w.source, donor)
    const enabled = w.source !== 'actorA' || slot.rig.showActorWeapon
    this.actor.setWeaponsEnabled(this.actor === model && enabled)
    if (this.motion !== this.actor) this.motion.setWeaponsEnabled(this.motion === model && enabled)
    donor?.setWeaponsEnabled(donor === model && enabled)
    if (!model || !enabled) return
    const motion = binding(this.motion),
      actor = binding(this.actor),
      display = binding(model)
    const align = slot.rig.gripIK && this.actor !== this.motion && w.attach === 'weaponTrack'
    const offsets = w.scale !== 1 || w.position.some(Boolean) || w.rotation.some(Boolean)
    if (
      w.source === 'actorA' &&
      w.attach === 'weaponTrack' &&
      !offsets &&
      (align || this.actor === this.motion)
    )
      return model
    const mirror = slot.rig.mirror
    const stage = this.actor.root.parent
    stage?.updateWorldMatrix(true, false)
    if (stage) this.stageWorld.copy(stage.matrixWorld)
    else this.stageWorld.identity()
    this.stageInv.copy(this.stageWorld).invert()
    if (align && model !== this.actor) {
      // Capture both tracks before writing either one (a mirrored motionB display
      // reads the opposite pistol). A paused sample must be order-independent.
      for (const grip of motion.grips) {
        grip.updateWorldMatrix(true, false)
        motion.tracks.get(grip)!.multiplyMatrices(this.stageInv, grip.matrixWorld)
      }
      for (const side of sides) {
        const hand = motion.bones.get(side === 'r' ? 'bip001_r_hand' : 'bip001_l_hand')
        hand?.updateWorldMatrix(true, false)
        this.hands[side] = hand
          ? this.handMatrices[side].multiplyMatrices(this.stageInv, hand.matrixWorld)
          : undefined
      }
    }
    this.transform.position.fromArray(w.position)
    this.transform.rotation.set(w.rotation[0] * rad, w.rotation[1] * rad, w.rotation[2] * rad)
    this.transform.scale.setScalar(w.scale)
    this.transform.updateMatrix()
    this.offset.copy(this.transform.matrix)
    for (const grip of display.grips) {
      if (!grip.parent) continue
      const key = display.keys.get(grip)!
      const mapped = weaponKey.test(key) ? weaponSourceKey(key, mirror, motion.bones) : undefined
      const spare = !mapped && key.startsWith('bip001_weapon_') && motion.bones.has('bip001_weapon')
      const actorEdit =
        model === this.actor &&
        (align ||
          spare ||
          slot.rig.mixer.weapon !== 'motionB' ||
          mirror ||
          slot.rig.overrides[grip.name] !== undefined)
      const track = (mapped && motion.bones.get(mapped)) || motion.bones.get(key) || motion.grips[0]
      const side = key === 'bip001_weapon_l' ? 'l' : 'r'
      const snap = w.attach === 'rightHand'
      const source = snap
        ? actor.bones.get(side === 'r' ? 'bip001_r_hand' : 'bip001_l_hand')
        : actorEdit
          ? grip
          : track
      if (!source) continue
      source.updateWorldMatrix(true, false)
      let bindScale = (actorEdit || snap ? this.actor : this.motion).rest.get(source)?.restWorldScale
      if (snap) {
        const displayGrip = gripProfile(model).weapons.get(key)
        const ref = displayGrip && handGrip(displayGrip, side)
        this.target.copy(source.matrixWorld)
        if (ref?.valid) {
          this.actorFrame.multiplyMatrices(this.stageInv, this.target)
          this.grasp
            .unscaled(this.target, this.actorFrame)
            .multiply(ref.handToWeapon)
            .premultiply(this.stageWorld)
          bindScale = displayGrip!.bindScale
        }
      } else if (align && model !== this.actor) {
        const trackKey = motion.keys.get(track)!
        const driver = gripProfile(this.motion).weapons.get(trackKey)
        const displayGrip = gripProfile(model).weapons.get(key)
        const frame = motion.tracks.get(track)!
        this.sourceFrame.copy(frame)
        if (mirror) this.sourceFrame.premultiply(this.reflection).multiply(this.reflection)
        this.target.copy(this.sourceFrame)
        if (
          driver &&
          spare &&
          displayGrip &&
          !weaponCollapsed(this.scale.setFromMatrixScale(frame), driver.bindScale)
        ) {
          const hand = actor.bones.get(side === 'r' ? 'bip001_r_hand' : 'bip001_l_hand')
          const ref = handGrip(displayGrip, side)
          if (hand) {
            hand.updateWorldMatrix(true, false)
            this.actorFrame.multiplyMatrices(this.stageInv, hand.matrixWorld)
            const donorHand = display.bones.get(side === 'r' ? 'bip001_r_hand' : 'bip001_l_hand')
            this.grasp.snap(this.target, this.actorFrame, ref, donorHand && model.rest.get(donorHand), model.rest.get(grip)!)
          }
        } else if (driver) {
          const primary = this.grasp.primary(
            displayGrip?.key ?? 'bip001_weapon',
            driver,
            frame,
            this.hands,
            mirror,
          )
          const hand = primary && actor.bones.get(primary === 'r' ? 'bip001_r_hand' : 'bip001_l_hand')
          if (primary && hand) {
            hand.updateWorldMatrix(true, false)
            const src = mirror ? oppositeHand(primary) : primary
            this.actorFrame.multiplyMatrices(this.stageInv, hand.matrixWorld)
            this.grasp.place(
              this.target,
              this.sourceFrame,
              this.actorFrame,
              this.hands[src]!,
              frame,
              displayGrip && handGrip(displayGrip, primary),
              handGrip(driver, src),
              this.grasp.weights[primary],
              mirror,
            )
          }
        }
        this.target.premultiply(this.stageWorld)
      } else {
        if (source === grip && !offsets) continue
        this.target.copy(source.matrixWorld)
      }
      this.offset.elements[12] = w.position[0] / (Math.abs(bindScale?.x ?? 1) || 1)
      this.offset.elements[13] = w.position[1] / (Math.abs(bindScale?.y ?? 1) || 1)
      this.offset.elements[14] = w.position[2] / (Math.abs(bindScale?.z ?? 1) || 1)
      grip.parent.updateWorldMatrix(true, false)
      this.scratch.copy(grip.parent.matrixWorld).invert().multiply(this.target).multiply(this.offset)
      this.place(model, grip, this.scratch)
    }
    return model
  }
  private place(model: StudioModel, node: Object3D, local: Matrix4) {
    if (!this.editedGrips.includes(node)) {
      const saved = binding(model).originals.get(node)!
      this.savedPoses.push(saved)
      saved.position.copy(node.position)
      saved.rotation.copy(node.quaternion)
      saved.scale.copy(node.scale)
      this.editedGrips.push(node)
    }
    if (local.determinant() === 0) {
      node.position.setFromMatrixPosition(local)
      node.scale.setScalar(0)
    } else local.decompose(node.position, node.quaternion, node.scale)
    node.updateWorldMatrix(false, true)
  }
  private uprightHeadFrame(model: StudioModel, out: Matrix4) {
    const head = binding(model).bones.get('bip001_head')
    if (!head) return false
    head.updateWorldMatrix(true, false)
    this.scratch.multiplyMatrices(this.stageInv, head.matrixWorld)
    const valid = decomposeRigTransform(this.scratch, this.position, this.rotation, this.scale)
    const rest = model.rest.get(head)!.restWorldQuat
    if (valid) this.rotation.normalize()
    else this.rotation.copy(rest)
    this.rotation.multiply(this.restInverse.copy(rest).normalize().invert()).normalize()
    out.compose(this.position, this.rotation, this.scale.setScalar(1))
    return true
  }
  private applyHalo(slot: Slot, donor?: StudioModel) {
    const h = slot.halo
    const model = this.sourceModel(h.source, donor)
    const sameModel = model === this.actor
    this.actor.setHalosEnabled(sameModel)
    if (this.motion !== this.actor) this.motion.setHalosEnabled(this.motion === model)
    donor?.setHalosEnabled(donor === model)
    if (!model) return
    const hasOffset = h.scale !== 1 || h.position.some(Boolean) || h.rotation.some(Boolean)
    if (sameModel && !hasOffset) return

    const stage = this.actor.root.parent
    if (stage) {
      stage.updateWorldMatrix(true, false)
      this.stageWorld.copy(stage.matrixWorld)
    } else this.stageWorld.identity()
    this.stageInv.copy(this.stageWorld).invert()
    if (!this.uprightHeadFrame(this.actor, this.actorFrame)) return
    if (sameModel) this.sourceFrame.copy(this.actorFrame)
    else if (!this.uprightHeadFrame(model, this.sourceFrame)) {
      // A standalone halo's origin sits above and behind the head in the upright bind frame.
      this.sourceFrame.makeTranslation(0, -0.365, 0.209)
    }
    this.sourceFrame.invert().multiply(this.stageInv)
    this.actorFrame.premultiply(this.stageWorld)
    this.transform.rotation.set(h.rotation[0] * rad, h.rotation[1] * rad, h.rotation[2] * rad)
    this.transform.scale.setScalar(h.scale)
    for (const root of binding(model).haloRoots) {
      if (!root.parent) continue
      root.updateWorldMatrix(true, false)
      this.target.multiplyMatrices(this.sourceFrame, root.matrixWorld)
      // Take translation out before rotating/scaling so the halo turns about its own center.
      this.transform.position.setFromMatrixPosition(this.target)
      this.transform.position.add(this.position.fromArray(h.position))
      this.transform.updateMatrix()
      this.target.setPosition(0, 0, 0)
      this.scratch.copy(root.parent.matrixWorld).invert()
        .multiply(this.actorFrame)
        .multiply(this.transform.matrix)
        .multiply(this.target)
      this.place(model, root, this.scratch)
    }
  }
}

interface Item {
  source: string | File
  subset: string
  anchor: Group
  handle: Group
  content: Group
  controller: AbortController
  model?: StudioModel
  player?: ClipPlayer
  lastStage?: StageSettings
  pivot: Matrix4
}
export class PropManager {
  private items = new Map<string, Item>()
  private readonly retained = new Set<string>()
  private readonly gripLocal = new Matrix4()
  private readonly position = new Vector3()
  private readonly rotation = new Quaternion()
  private readonly scale = new Vector3()
  constructor(
    private scene: Object3D,
    private loader: ModelLoader,
    private onModelReady?: () => void,
  ) {}
  handle(id: string) {
    return this.items.get(id)?.handle
  }
  donor(id: number) {
    return this.items.get('donor:' + id)?.model
  }
  haloDonor(id: number) {
    return this.items.get('halo-donor:' + id)?.model
  }
  private drop(id: string) {
    const item = this.items.get(id)
    if (!item) return
    item.controller.abort()
    item.player?.dispose()
    item.model?.dispose()
    item.anchor.removeFromParent()
    this.items.delete(id)
  }
  private ensure(
    id: string,
    source: string | File,
    subset: string,
    donorSlot?: number,
    donorKind: DonorKind = 'weapon',
  ) {
    let item = this.items.get(id)
    if (item?.source === source && item.subset === subset) return item
    this.drop(id)
    item = {
      source,
      subset,
      anchor: new Group(),
      handle: new Group(),
      content: new Group(),
      controller: new AbortController(),
      pivot: new Matrix4(),
    }
    item.anchor.matrixAutoUpdate = false
    item.anchor.add(item.handle)
    item.handle.add(item.content)
    item.content.matrixAutoUpdate = false
    this.scene.add(item.anchor)
    this.items.set(id, item)
    const current = item
    const donorId = store.getState().slots.find((slot) => slot.id === donorSlot)?.[donorKind].donor
    void this.loader
      .load(source, undefined, item.controller.signal)
      .then((model) => {
        if (current.controller.signal.aborted) {
          model.dispose()
          return
        }
        current.model = model
        if (
          donorSlot !== undefined &&
          typeof source !== 'string' &&
          !(donorKind === 'halo' ? model.haloNodes : model.weaponMeshes).length &&
          !rigBones(model).some((b) => canonicalBoneName(b.name) === 'bip001')
        ) {
          // A standalone local prop uses its authored origin for attachment.
          if (donorKind === 'halo') model.haloNodes.push(model.root, ...model.meshGroups.keys())
          else model.weaponMeshes.push(...model.meshGroups.keys())
        }
        isolate(model, subset)
        if (donorSlot !== undefined) {
          binding(model)
          if (donorKind === 'weapon') gripProfile(model)
        }
        current.player = new ClipPlayer(model.root)
        current.content.add(model.root)
        this.onModelReady?.()
        if (donorSlot !== undefined) return
        const prop = store.getState().props.find((p) => p.id === id)
        if (!prop) return
        // A borrowed weapon's local origin is its grip. Other borrowed mesh
        // groups center on their bind bounds when mounted on a bone.
        const grip = subset === 'weapon' && binding(model).grips[0]
        if (grip) {
          const rest = model.rest.get(grip)!
          current.pivot.compose(rest.restWorldPos, rest.restWorldQuat, new Vector3(1, 1, 1)).invert()
        } else if (subset !== 'whole') {
          const meshes = subsetMeshes(model, subset)!
          const center = new Vector3()
          for (const mesh of meshes) {
            mesh.geometry.computeBoundingBox()
            center.add(mesh.geometry.boundingBox!.getCenter(new Vector3()).applyMatrix4(mesh.matrixWorld))
          }
          center.divideScalar(meshes.length).negate()
          current.pivot.makeTranslation(center)
        }
        store.getState().upsertProp({
          ...prop,
          status: 'ready',
          clips: model.clips,
          clip:
            model.clips.find((c) => c.name === prop.clip)?.name ??
            (subset === 'weapon'
              ? model.clips.find((c) => /^(?:Normal|Stand)_Idle$/i.test(c.name))?.name
              : undefined) ??
            model.clips[0]?.name ??
            '',
        })
      })
      .catch(() => {
        if (current.controller.signal.aborted) return
        current.model?.dispose()
        current.model = undefined
        const s = store.getState()
        if (donorSlot !== undefined) {
          const selected = s.slots.find((slot) => slot.id === donorSlot)?.[donorKind]
          if (selected?.source === 'donorC' && selected.donor === donorId)
            s.updateRuntime(donorSlot, donorKind === 'halo' ? { haloDonorError: true } : { donorError: true })
          return
        }
        const prop = s.props.find((p) => p.id === id)
        if (prop) s.upsertProp({ ...prop, status: 'error' })
      })
    return item
  }
  sync(
    time: number,
    slots: Map<
      number,
      { group: Group; actor?: StudioModel; driver?: StudioModel; props?: SlotProps; engine?: RetargetEngine }
    >,
    resolve: (id: string) => File | string | undefined,
  ) {
    const s = store.getState()
    const retained = this.retained
    retained.clear()
    for (const slot of s.slots) {
      const entry = slots.get(slot.id)
      for (const kind of donorKinds) {
        const settings = slot[kind]
        const source = settings.source === 'donorC' && resolve(settings.donor)
        if (!source) continue
        const id = (kind === 'halo' ? 'halo-donor:' : 'donor:') + slot.id
        const item = this.ensure(id, source, kind, slot.id, kind)
        retained.add(id)
        item.anchor.visible = !!entry?.group && !!entry.actor
        if (entry?.group) {
          entry.group.updateWorldMatrix(true, false)
          item.anchor.matrix.copy(entry.group.matrixWorld)
        }
        item.anchor.updateMatrixWorld(true)
        if (!item.model) continue
        const { animations } = item.model
        let clip = animations.find((c) => c.name === slot.clip)
        if (!clip && kind === 'halo')
          clip = animations.find((c) => /^(?:Normal|Stand|Cafe)_Idle$/i.test(c.name)) ?? animations[0]
        else if (!clip && !binding(item.model).bones.has('bip001')) clip = animations[0]
        const at =
          clip?.duration && time > clip.duration && s.timeline.loop
            ? time % clip.duration
            : Math.min(time, clip?.duration ?? 0)
        item.player?.sample(clip, at)
        item.model.syncSwitchVisibility(clip)
      }
    }
    for (const slot of s.slots) {
      const entry = slots.get(slot.id)
      const props = entry?.props
      if (!props) continue
      const donor = this.donor(slot.id)
      props.prepareWeapon(slot, donor)
      const weapon = props.apply(slot, donor, this.haloDonor(slot.id))
      entry.engine?.finishCloth(weapon ?? null)
    }
    for (const prop of s.props) {
      const source = prop.file ?? resolve(prop.modelId)
      if (!source) continue
      retained.add(prop.id)
      const item = this.ensure(prop.id, source, prop.subset)
      const slot = slots.get(prop.slotId ?? -1)
      const actor = slot?.actor
      const rig = actor && binding(actor).sockets.has(canonicalBoneName(prop.bone)) ? actor : slot?.driver
      this.mount(item, prop, rig)
      const clip = item.model?.animations.find((c) => c.name === prop.clip)
      if (prop.syncAnimation && clip) {
        const at =
          s.timeline.loop && time > clip.duration && clip.duration
            ? time % clip.duration
            : Math.min(time, clip.duration)
        item.player?.sample(clip, at)
        item.model?.syncSwitchVisibility(clip)
      }
      if (item.model && prop.subset === 'weapon') {
        // Keep the donor grip at the mount origin as its internal bones animate.
        const grip = binding(item.model).grips[0]
        if (grip) {
          grip.updateWorldMatrix(true, false)
          const local = this.gripLocal.copy(item.content.matrixWorld).invert().multiply(grip.matrixWorld)
          if (local.determinant() !== 0) {
            local.decompose(this.position, this.rotation, this.scale)
            item.content.matrix
              .compose(this.position, this.rotation.normalize(), this.scale.setScalar(1))
              .invert()
            item.content.updateMatrixWorld(true)
          }
        }
      }
    }
    for (const [id, item] of this.items) {
      if (!retained.has(id)) this.drop(id)
      else if (item.model && item.lastStage !== s.stage) {
        styleModel(item.model, s.stage)
        item.lastStage = s.stage
      }
    }
  }
  private mount(item: Item, prop: MountedProp, actor?: StudioModel) {
    const onBone = prop.slotId !== null && prop.bone !== 'world'
    const bone = actor && binding(actor).sockets.get(canonicalBoneName(prop.bone))
    item.anchor.visible = prop.visible && (!onBone || !!bone)
    item.anchor.matrix.identity()
    if (onBone && actor && bone) {
      bone.updateWorldMatrix(true, false)
      const scale = actor.rest.get(bone)!.restWorldScale
      item.anchor.matrix
        .copy(bone.matrixWorld)
        .scale(this.scale.set(1 / (scale.x || 1), 1 / (scale.y || 1), 1 / (scale.z || 1)))
    }
    applyTransform(item.handle, prop)
    if (prop.subset !== 'weapon') {
      if (onBone && prop.subset !== 'whole') item.content.matrix.copy(item.pivot)
      else item.content.matrix.identity()
    }
    item.anchor.updateMatrixWorld(true)
  }
  expandBounds(box: Box3) {
    for (const item of this.items.values()) if (item.anchor.visible) item.model?.expandVisibleBounds(box)
  }
  dispose() {
    for (const id of this.items.keys()) this.drop(id)
  }
}
