import {
  AmbientLight,
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  type Object3D,
  PlaneGeometry,
  RingGeometry,
  Scene,
  ShaderMaterial,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import {
  PropManager,
  SlotProps,
  applyTransform,
  attachmentNames,
  propGroupNames,
  readTransform,
  styleModel,
} from './PropManager'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  useStudioStore as store,
  initialRuntime,
  formationStartWindow,
  type CameraPreset,
  type Slot,
  type StageSettings,
} from '../store/useStudioStore'
import { snapshotModels } from '../services/wikiCatalog'
import { ModelLoader, StudioModel } from './ModelLoader'
import { RetargetEngine } from './RetargetEngine'
import { describeClip } from './AnimationUtils'
import { SkeletonOverlay } from './SkeletonOverlay'
import { buildFineClothMesh } from './ClothMeshBuilder'
import { getWebGPU, onWebGPULost, type GpuDeviceLike } from './WebGPUContext'
import { WebGPUClothSolver } from './WebGPUClothSolver'
import { cropRect } from './exportSpec'

interface StageSlot {
  actorSource: string | File
  pendingCast?: { source: File | string; controller: AbortController }
  motionSource: string | File
  controller: AbortController
  group: Group
  socketFrame?: Group
  actor?: StudioModel
  driver?: StudioModel
  externalClips: Slot['externalClips']
  engine?: RetargetEngine
  gpuCloth?: WebGPUClothSolver | null
  clothDt?: number
  overlay?: SkeletonOverlay
  props?: SlotProps
  lastSlot?: Slot
  lastWindow?: number
  lastEnd?: string
  lastRig?: Slot['rig']
  lastWeapon?: Slot['weapon']
  lastDisplay?: StudioModel | null
  lastEmbedded?: Slot['embedded']
  lastTime?: number
  lastSeek?: number
  lastClip?: string
  lastChain?: boolean
  placementChanged?: boolean
}
const directions: Record<Exclude<CameraPreset, 'fitCrop'>, [number, number, number]> = {
  front: [0, 0.09, 1],
  threeQuarter: [0.65, 0.18, 1],
  side: [1, 0.08, 0],
  back: [0, 0.09, -1],
  face: [0, 0.04, 1],
  group: [0, 0.18, 1],
  reset: [0, 0.09, 1],
}

export class SceneManager {
  readonly renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(30, 1, 0.01, 100)
  readonly gizmo: TransformControls
  readonly controls: OrbitControls
  private readonly loader = new ModelLoader(this.renderer.capabilities.getMaxAnisotropy())
  private readonly props = new PropManager(this.scene, this.loader, () => {
    this.needsFrame = true
  })
  private readonly slots = new Map<number, StageSlot>()
  private readonly lights = {
    key: new DirectionalLight(0xfff4ed),
    fill: new DirectionalLight(0xe1f2ff),
    rim: new DirectionalLight(0xffffff),
    hemisphere: new HemisphereLight(0xfffbff, 0xbad0e8),
    ambient: new AmbientLight(0xffffff),
  }
  private readonly floor = new Mesh(new PlaneGeometry(100, 100), new ShadowMaterial({ opacity: 0.16 }))
  private readonly disc = new Mesh(
    new CircleGeometry(1.15, 112),
    new MeshBasicMaterial({ transparent: true, opacity: 0.18, color: 0xffffff, depthWrite: false }),
  )
  private readonly rim = new Mesh(
    new RingGeometry(1.143, 1.15, 112),
    new MeshBasicMaterial({ transparent: true, opacity: 0.32, color: 0x94b5cd, depthWrite: false }),
  )
  private readonly grid = new Mesh(
    new PlaneGeometry(80, 80),
    new ShaderMaterial({
      uniforms: { ink: { value: new Color(0x95abc2) } },
      transparent: true,
      depthWrite: false,
      vertexShader: `varying vec2 coord; void main(){ coord = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 coord; uniform vec3 ink;
    void main(){vec2 p = coord * 3.; vec2 d = abs(fract(p-.5)-.5)/max(fwidth(p),vec2(.0001));
      float line = 1.-min(min(d.x,d.y),1.); float fade = 1.-smoothstep(1.,8.,length(coord));
      gl_FragColor = vec4(ink,line*.35*fade);
      #include <colorspace_fragment>
    }`,
    }),
  )
  private readonly observer: ResizeObserver
  private restoreCapture?: () => void
  private capturing = false
  private readonly gpuReady: Promise<void>
  private device?: GpuDeviceLike
  private stopWatchingGPU?: () => void
  private captureRevision = 0
  private disposed = false
  private frameId = 0
  private previous = 0
  private lastStage?: StageSettings
  private lastBackdrop = ''
  private lastTheme = ''
  private revision = -1
  private needsFrame = true
  private layoutKey = ''

  constructor(private readonly host: HTMLElement) {
    const renderer = this.renderer
    renderer.outputColorSpace = SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    renderer.setClearColor(0, 0)
    host.appendChild(renderer.domElement)
    this.controls = new OrbitControls(this.camera, renderer.domElement)
    this.gizmo = new TransformControls(this.camera, renderer.domElement)
    this.gizmo.setSize(0.72)
    this.scene.add(this.gizmo.getHelper())
    this.gizmo.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value
    })
    this.gizmo.addEventListener('objectChange', () => {
      const object = this.gizmo.object
      if (!object) return
      const state = store.getState(),
        transform = readTransform(object)
      // Keep scale invertible for skinning, including when crossing the origin.
      transform.scale = transform.scale.map((v) =>
        Math.abs(v) < 0.0001 ? (v < 0 ? -0.0001 : 0.0001) : v,
      ) as Slot['scale']
      if (state.selectedProp) {
        const prop = state.props.find((p) => p.id === state.selectedProp)
        if (prop && object === this.props.handle(prop.id)) state.upsertProp({ ...prop, ...transform })
      } else if (this.slots.get(state.activeId)?.group === object)
        state.transformSlot(state.activeId, transform)
    })
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.09
    this.controls.minDistance = 0.15
    this.controls.maxDistance = 40
    this.controls.maxPolarAngle = Math.PI * 0.53
    const { key, fill, rim, hemisphere, ambient } = this.lights
    key.position.set(2.4, 4.2, 4.0)
    fill.position.set(-3.2, 2.0, 2.5)
    rim.position.set(-1.6, 3.2, -3.6)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.1, far: 20 })
    key.shadow.camera.updateProjectionMatrix()
    key.shadow.radius = 2.5
    key.shadow.normalBias = 0.006
    this.scene.add(key, fill, rim, hemisphere, ambient)
    this.floor.receiveShadow = true
    for (const surface of [this.floor, this.grid, this.disc, this.rim]) {
      surface.rotation.x = -Math.PI / 2
      this.scene.add(surface)
    }
    this.grid.position.y = -0.007
    this.disc.position.y = -0.004
    this.rim.position.y = -0.002
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
    this.gpuReady = getWebGPU().then((state) => {
      if (this.disposed) return
      this.device = state.device
      store.getState().setGpu({ status: state.status, label: state.label })
      this.needsFrame = true
      this.stopWatchingGPU = onWebGPULost(state, () => this.fallbackGPU())
    })
    this.frameId = requestAnimationFrame(this.frame)
  }

  private fallbackGPU() {
    if (!this.device || this.disposed) return
    this.device = undefined
    for (const entry of this.slots.values()) {
      entry.gpuCloth?.dispose()
      entry.gpuCloth = undefined
    }
    store.getState().setGpu({ status: 'fallback', label: '' })
    this.needsFrame = true
  }

  private resize() {
    if (this.capturing) return
    const w = this.host.clientWidth || 1,
      h = this.host.clientHeight || 1
    this.renderer.setDrawingBufferSize(w, h, Math.min(window.devicePixelRatio || 1, 2))
    const dpr = this.canvas.width / (this.host.getBoundingClientRect().width || w)
    const { viewport } = store.getState()
    if (viewport.dpr !== dpr) store.setState({ viewport: { ...viewport, dpr } })
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }
  private applyStage(settings: StageSettings, theme: string) {
    for (const name of Object.keys(this.lights) as (keyof typeof this.lights)[])
      this.lights[name].intensity = settings.lighting[name]
    this.disc.material.color.set(theme === 'light' ? 0xeef7ff : 0x31495f)
    this.grid.material.uniforms.ink.value.set(theme === 'light' ? 0x91a9c2 : 0x566d89)
    for (const entry of this.slots.values()) {
      if (entry.actor) styleModel(entry.actor, settings)
      if (entry.driver) styleModel(entry.driver, settings)
    }
  }
  private applyBackdrop(
    settings: StageSettings,
    background: StageSettings['background'],
    solid: string,
    sticker: boolean,
  ) {
    this.scene.background =
      background === 'solid' ? new Color(solid) : background === 'chroma' ? new Color(0x00ff00) : null
    this.floor.visible = settings.shadow && !sticker
    this.grid.visible = settings.floorGrid && !sticker
    this.disc.visible = this.rim.visible = background === 'studio' && settings.floorGrid
  }
  private async loadSlot(slot: Slot, entry: StageSlot) {
    const signal = entry.controller.signal
    const progress = (received: number, total: number | null) => {
      if (!signal.aborted) store.getState().updateRuntime(slot.id, { received, total })
    }
    try {
      const actor = await this.loader.load(entry.actorSource, progress, signal)
      if (signal.aborted) {
        actor.dispose()
        return
      }
      entry.actor = actor
      entry.group.add(actor.root)
      styleModel(actor, store.getState().stage)
      this.needsFrame = true
      if (entry.motionSource !== entry.actorSource || entry.externalClips.length) {
        const driver = await this.loader.load(entry.motionSource, progress, signal)
        if (signal.aborted) {
          driver.dispose()
          return
        }
        entry.driver = driver
        entry.group.add(driver.root)
        styleModel(driver, store.getState().stage)
      }
      this.bindSlot(slot.id, entry, actor)
    } catch {
      if (!signal.aborted) store.getState().updateRuntime(slot.id, { status: 'error', clips: [] })
    }
  }
  private bindSlot(id: number, entry: StageSlot, actor: StudioModel) {
    const engine = new RetargetEngine(actor, entry.driver, entry.externalClips)
    entry.engine = engine
    entry.lastClip = undefined
    entry.lastRig = undefined
    entry.lastSeek = undefined
    entry.props = new SlotProps(actor, engine.driverModel)
    this.needsFrame = true
    store.getState().updateRuntime(id, {
      status: 'ready',
      clips: engine.animations.map(describeClip),
      actorClips: actor.clips,
      targetNames: engine.targetNames,
      manualOnlyTargets: engine.manualOnlyTargets,
      sourceNames: engine.sourceNames,
      propGroups: propGroupNames(engine.driverModel),
      attachmentNames: attachmentNames(actor),
    })
  }

  private async replaceActor(id: number, entry: StageSlot, source: string | File) {
    entry.pendingCast?.controller.abort()
    const controller = new AbortController()
    entry.pendingCast = { source, controller }
    const progress = (received: number, total: number | null) => {
      if (!controller.signal.aborted) store.getState().updateRuntime(id, { received, total })
    }
    store.getState().updateRuntime(id, { status: 'loading', received: 0, total: null })
    try {
      // Keep B, its running clip, passenger sockets and all prop meshes on stage
      // while the replacement is streaming. Only exchange the visible rig on success.
      const motion = entry.engine!.driverModel
      const native = source === entry.motionSource && !entry.externalClips.length
      const actor = native ? motion : await this.loader.load(source, progress, controller.signal)
      if (controller.signal.aborted) {
        actor.dispose()
        return
      }
      entry.props?.restore()
      entry.overlay?.dispose()
      entry.overlay = undefined
      entry.gpuCloth?.dispose()
      entry.gpuCloth = undefined
      entry.engine!.dispose()
      if (entry.actor !== motion) entry.actor?.dispose()
      entry.actorSource = source
      entry.actor = actor
      entry.driver = native ? undefined : motion
      if (actor.root.parent !== entry.group) entry.group.add(actor.root)
      styleModel(actor, store.getState().stage)
      this.bindSlot(id, entry, actor)
      entry.pendingCast = undefined
    } catch {
      if (!controller.signal.aborted) store.getState().updateRuntime(id, { status: 'error' })
    }
  }

  private drop(id: number) {
    const entry = this.slots.get(id)
    if (!entry) return
    entry.controller.abort()
    entry.pendingCast?.controller.abort()
    entry.overlay?.dispose()
    entry.props?.restore()
    entry.gpuCloth?.dispose()
    entry.engine?.dispose()
    entry.actor?.dispose()
    entry.driver?.dispose()
    entry.group.removeFromParent()
    entry.socketFrame?.removeFromParent()
    this.slots.delete(id)
  }
  retry(id: number) {
    this.drop(id)
  }

  private syncSlots() {
    const state = store.getState()
    for (const id of this.slots.keys())
      if (!state.slots.some((s) => s.id === id)) {
        this.drop(id)
        this.needsFrame = true
      }
    state.slots.forEach((slot) => {
      const actorSource = this.resolve(slot.actor),
        motionSource = this.resolve(slot.motion)
      let entry = this.slots.get(slot.id)
      if (!actorSource || !motionSource) return
      if (
        !entry ||
        (!entry.engine && entry.actorSource !== actorSource) ||
        entry.motionSource !== motionSource ||
        entry.externalClips !== slot.externalClips
      ) {
        this.drop(slot.id)
        entry = {
          actorSource,
          motionSource,
          externalClips: slot.externalClips,
          controller: new AbortController(),
          group: new Group(),
        }
        this.slots.set(slot.id, entry)
        this.scene.add(entry.group)
        state.updateRuntime(slot.id, initialRuntime())
        void this.loadSlot(slot, entry)
      } else if (entry.actorSource !== actorSource) {
        if (entry.pendingCast?.source !== actorSource) void this.replaceActor(slot.id, entry, actorSource)
      } else if (entry.pendingCast) {
        entry.pendingCast.controller.abort()
        entry.pendingCast = undefined
        state.updateRuntime(slot.id, { status: 'ready' })
      }
      if (slot.socket) {
        const host = this.slots.get(slot.socket.slotId)?.engine?.driverModel
        const socket = host?.root.getObjectByName(slot.socket.bone)
        entry.group.visible = !!socket
        if (socket) {
          const frame = (entry.socketFrame ??= new Group())
          if (frame.parent !== socket) socket.add(frame)
          frame.rotation.x = (slot.socket.pitch * Math.PI) / 180
          if (entry.group.parent !== frame) frame.add(entry.group)
        }
      } else {
        entry.group.visible = true
        if (entry.group.parent !== this.scene) this.scene.add(entry.group)
      }
      entry.placementChanged =
        !entry.lastSlot ||
        ['position', 'rotation', 'scale'].some(
          (key) => slot[key as 'position'] !== entry!.lastSlot![key as 'position'],
        )
      if (entry.placementChanged) applyTransform(entry.group, slot)
      entry.lastSlot = slot
    })
  }

  private resolve = (id: string) => {
    const s = store.getState()
    return (
      s.localFiles[id] ??
      s.models.find((m) => m.id === id)?.url ??
      snapshotModels.find((m) => m.id === id)?.url
    )
  }

  private syncGizmo() {
    const s = store.getState()
    const target = s.selectedProp ? this.props.handle(s.selectedProp) : this.slots.get(s.activeId)?.group
    const mode = s.ui.gizmo === 'move' ? 'translate' : s.ui.gizmo
    if (this.gizmo.dragging && (this.gizmo.object !== target || this.gizmo.mode !== mode))
      this.gizmo.dragging = false
    if (mode === 'off' || !target) {
      if (this.gizmo.object) this.gizmo.detach()
      return
    }
    if (this.gizmo.mode !== mode) this.gizmo.setMode(mode)
    if (this.gizmo.object !== target) this.gizmo.attach(target)
  }
  private expandPoseBounds(box: Box3, face: boolean) {
    this.scene.updateMatrixWorld(true)
    for (const [id, entry] of this.slots) {
      if (!entry.group.visible || !entry.actor) continue
      if (face) {
        if (id === store.getState().activeId) {
          entry.actor.expandVisibleBounds(box, [...entry.actor.bodyMeshes, ...entry.actor.haloNodes])
          entry.driver?.expandVisibleBounds(box, entry.driver.haloNodes)
          const donor = this.props.haloDonor(id)
          donor?.expandVisibleBounds(box, donor.haloNodes)
        }
      } else {
        entry.actor.expandVisibleBounds(box)
        entry.driver?.expandVisibleBounds(box)
      }
    }
    if (!face) this.props.expandBounds(box)
  }

  private frameCamera(preset: CameraPreset) {
    const s = store.getState(),
      box = new Box3()
    const face = preset === 'face'
    this.expandPoseBounds(box, face)
    const { time, trimStart, trimEnd, duration } = s.timeline
    if (!face && duration > 0) {
      const restore = this.checkpointPose(time)
      try {
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
          const sample = (trimStart + fraction * (trimEnd - trimStart)) * duration
          this.samplePose(sample, 0, false, true)
          this.expandPoseBounds(box, false)
        }
      } finally {
        restore()
      }
    }
    if (box.isEmpty()) box.set(new Vector3(-0.5, 0, -0.3), new Vector3(0.5, 1.3, 0.3))
    const center = box.getCenter(new Vector3()),
      size = box.getSize(new Vector3())
    const { viewport } = s
    const { width: w, height: h } = viewport
    const rect = face ? viewport.safe : cropRect(viewport, s.exportSettings.aspect)
    this.camera.setViewOffset(w, h, (w - rect.width) / 2 - rect.x, (h - rect.height) / 2 - rect.y, w, h)
    const direction =
      preset === 'fitCrop'
        ? this.camera.position.clone().sub(this.controls.target).normalize()
        : new Vector3(...directions[preset]).normalize()
    if (!direction.lengthSq()) direction.set(...directions.front).normalize()
    const right = new Vector3().crossVectors(this.camera.up, direction).normalize()
    const up = new Vector3().crossVectors(direction, right)
    if (face) {
      center.y = box.min.y + size.y * 0.72
      box.setFromCenterAndSize(center, size.multiply(new Vector3(0.6, 0.49, 0.6)))
    }
    const tanY = Math.tan((this.camera.getEffectiveFOV() * Math.PI) / 360)
    const slopeX = (tanY * rect.width) / h,
      slopeY = (tanY * rect.height) / h
    const margin = face ? 1 : 1.22
    let distance = this.controls.minDistance
    const corner = new Vector3()
    // Fit the nearest as well as the farthest corners at the current orbit angle.
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z).sub(center)
          const extent = Math.max(Math.abs(corner.dot(right)) / slopeX, Math.abs(corner.dot(up)) / slopeY)
          distance = Math.max(distance, corner.dot(direction) + margin * extent)
        }
    this.controls.maxDistance = Math.max(40, distance)
    this.camera.far = Math.max(100, distance + size.length())
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(center)
    this.camera.position.copy(center).addScaledVector(direction, distance)
    this.controls.update()
  }
  private frame = (now: number) => {
    if (this.renderer.getPixelRatio() !== Math.min(window.devicePixelRatio || 1, 2)) this.resize()
    const dt = this.previous ? Math.min((now - this.previous) / 1000, 0.1) : 0
    this.previous = now
    this.syncSlots()
    const s = store.getState()
    if (this.lastStage !== s.stage || this.lastTheme !== s.theme) {
      this.applyStage(s.stage, s.theme)
      this.lastStage = s.stage
      this.lastTheme = s.theme
    }
    const exporting = s.ui.rightOpen && s.ui.right === 'export'
    const bg =
      exporting && s.exportSettings.background !== 'stage' ? s.exportSettings.background : s.stage.background
    const solid =
      exporting && s.exportSettings.background === 'solid' ? s.exportSettings.solidColor : s.stage.solidColor
    const sticker = exporting && bg === 'transparent'
    const backdrop = [bg, solid, sticker, s.stage.shadow, s.stage.floorGrid].join('/')
    if (backdrop !== this.lastBackdrop) {
      this.applyBackdrop(s.stage, bg, solid, sticker)
      this.lastBackdrop = backdrop
    }
    const t = s.timeline
    let time = t.time
    let wrapped = false
    const start = t.trimStart * t.duration,
      end = t.trimEnd * t.duration
    const waitingForCast = s.joint.members.some((member) =>
      s.slots.some(
        (slot) =>
          slot.id === member.slotId && slot.motion === member.modelId && !this.slots.get(slot.id)?.engine,
      ),
    )
    if (t.playing && !waitingForCast && end > start) {
      time += dt * t.speed
      if (time >= end) {
        wrapped = t.loop
        time = t.loop ? start + ((time - start) % (end - start)) : end
      }
      s.setTimeline({ time, playing: t.loop || time < end })
    }
    this.samplePose(time, dt, wrapped, false, 'interactive')
    this.syncGizmo()
    this.syncCamera()
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    this.frameId = requestAnimationFrame(this.frame)
  }
  private syncCamera() {
    const s = store.getState()
    const { x, y, width, height } = s.viewport.safe
    const key = [s.viewport.width, s.viewport.height, x, y, width, height, s.slots.length, s.activeId].join(
      '/',
    )
    if (this.needsFrame || key !== this.layoutKey || s.camera.revision !== this.revision) {
      this.frameCamera(s.camera.preset)
      this.layoutKey = key
      this.revision = s.camera.revision
      this.needsFrame = false
    }
  }
  private samplePose(
    time: number,
    dt: number,
    wrapped: boolean,
    fixed: boolean,
    fine?: 'interactive' | 'capture',
  ) {
    const s = store.getState(),
      t = s.timeline
    const formationWindow = formationStartWindow(s.slots, s.runtime, t.chainStartEnd)
    for (const slot of s.slots) {
      const entry = this.slots.get(slot.id),
        engine = entry?.engine
      if (!entry || !engine) continue
      entry.props?.restore()
      const startWindow = slot.endClip ? formationWindow : 0
      const changed =
        entry.lastWindow !== startWindow ||
        entry.lastEnd !== slot.endClip ||
        entry.lastClip !== slot.clip ||
        entry.lastChain !== t.chainStartEnd
      if (changed || entry.lastRig?.rootMode !== slot.rig.rootMode) this.needsFrame = true
      if (changed) engine.setClip(slot.clip, t.chainStartEnd, slot.endClip, startWindow)
      const duration = engine.duration
      const loopSlot =
        t.loop &&
        !s.joint.members.some(
          (m) => m.slotId === slot.id && m.modelId === slot.motion && m.start === slot.clip,
        )
      const localTime = loopSlot && duration && time > duration ? time % duration : Math.min(time, duration)
      const discontinuity = changed || (!fixed && entry.placementChanged) || entry.lastSeek !== t.seekRevision
      const reset = discontinuity || wrapped || (entry.lastTime !== undefined && localTime < entry.lastTime)
      const cross = engine.actorModel !== engine.driverModel
      const grasping = slot.rig.gripIK && (cross || slot.rig.armSpread > 0)
      const cloth = slot.rig.spring.enabled || (cross && slot.rig.antiClip)
      const display =
        grasping || cloth ? (entry.props?.displayedWeapon(slot, this.props.donor(slot.id)) ?? null) : null
      const weaponChanged = entry.lastDisplay !== display || entry.lastWeapon !== slot.weapon
      entry.clothDt = undefined
      const pausedWeaponChange = cloth && weaponChanged && !t.playing
      if (reset || pausedWeaponChange) {
        engine.reset()
        if (fine) {
          if (discontinuity || pausedWeaponChange || fine === 'capture') entry.gpuCloth?.reset()
          else entry.gpuCloth?.reseed()
        }
      }
      if (
        fixed ||
        reset ||
        entry.lastTime !== localTime ||
        entry.lastRig !== slot.rig ||
        ((grasping || cloth) && (weaponChanged || entry.lastEmbedded !== slot.embedded)) ||
        (t.playing && engine.duration < time)
      ) {
        if (cross && grasping && entry.lastEmbedded !== slot.embedded) entry.props?.setEmbedded(slot.embedded)
        entry.clothDt = fixed ? dt : reset || !t.playing ? 0 : dt * t.speed
        engine.sample(
          time,
          entry.clothDt,
          slot.rig,
          loopSlot,
          slot.weapon.attach === 'weaponTrack' ? display : null,
          !!entry.props && cloth,
        )
        entry.lastWeapon = slot.weapon
        entry.lastDisplay = display
        entry.lastEmbedded = slot.embedded
        entry.lastTime = localTime
        entry.lastRig = slot.rig
        entry.lastClip = slot.clip
        entry.lastWindow = startWindow
        entry.lastEnd = slot.endClip
        entry.lastChain = t.chainStartEnd
        entry.lastSeek = t.seekRevision
      }
      if (!this.capturing && s.ui.skeleton && slot.id === s.activeId) {
        if (!entry.overlay) {
          entry.overlay = new SkeletonOverlay(engine.actorModel)
          this.scene.add(entry.overlay.lines)
        }
        entry.overlay.lines.visible = true
      } else if (entry.overlay) entry.overlay.lines.visible = false
    }
    this.props.sync(time, this.slots, this.resolve)
    const active = this.slots.get(s.activeId)
    if (active?.overlay?.lines.visible) active.overlay.update(active.lastRig?.selectedBone ?? '')
    if (fine && this.device) return this.stepFineCloth(fine === 'capture')
  }

  private createFineCloth(device: GpuDeviceLike, engine: RetargetEngine) {
    const actor = engine.actorModel,
      colliders = engine.colliders
    const cloth = buildFineClothMesh(actor, colliders)
    if (!cloth) return null
    device.pushErrorScope?.('validation')
    device.pushErrorScope?.('out-of-memory')
    try {
      return new WebGPUClothSolver(device, actor, colliders, cloth, () => this.fallbackGPU())
    } finally {
      for (let i = 0; i < 2; i++) {
        void device.popErrorScope?.().then(
          (error) => {
            if (!error) return
            if (error.message) console.warn('WebGPU cloth fallback:', error.message)
            this.fallbackGPU()
          },
          () => this.fallbackGPU(),
        )
      }
    }
  }

  private stepFineCloth(capture: boolean) {
    const pending: Promise<void>[] = []
    for (const slot of store.getState().slots) {
      const entry = this.slots.get(slot.id)
      if (!entry?.engine || !entry.actor || !this.device) continue
      const { rig } = slot
      if (!rig.gpuCloth || !(rig.spring.enabled || (rig.antiClip && slot.actor !== slot.motion))) {
        entry.gpuCloth?.clear()
        continue
      }
      const create = entry.gpuCloth === undefined
      if (!create && entry.clothDt === undefined) continue
      try {
        if (create) entry.gpuCloth = this.createFineCloth(this.device, entry.engine)
        const solver = entry.gpuCloth
        if (!solver) continue
        const dt = entry.clothDt ?? 0
        if (capture) {
          pending.push(solver.stepDeterministic(rig.spring, dt, rig.spring.enabled).catch(() => this.fallbackGPU()))
        } else solver.dispatch(rig.spring, dt, rig.spring.enabled)
      } catch {
        this.fallbackGPU()
      }
    }
    if (pending.length) return Promise.all(pending)
  }

  get canvas() {
    return this.renderer.domElement
  }

  private checkpointPose(time: number) {
    const entries = [...this.slots.values()]
    const springs = entries.map((entry) => entry.engine?.checkpointSpring())
    return () => {
      for (const entry of entries) entry.engine?.reset()
      this.samplePose(time, 0, false, true)
      for (const resume of springs) resume?.()
      // Reattach mounted props after restoring the original spring-driven sockets.
      for (const entry of entries) entry.props?.restore()
      this.props.sync(time, this.slots, this.resolve)
    }
  }

  /** Freeze the camera and live clock. The returned lease also restores a paused spring pose. */
  beginCapture(background: StageSettings['background']) {
    if (this.capturing || this.disposed) throw new Error('stageUnavailable')
    const s = store.getState()
    this.syncSlots()
    // A donor can change between the last animation frame and the export click.
    this.samplePose(s.timeline.time, 0, false, false)
    if (
      s.slots.some(
        (slot) =>
          store.getState().runtime[slot.id]?.status !== 'ready' ||
          !this.slots.get(slot.id)?.engine ||
          (slot.weapon.source === 'donorC' && !this.props.donor(slot.id)) ||
          (slot.halo.source === 'donorC' && !this.props.haloDonor(slot.id)),
      ) ||
      s.props.some((prop) => prop.visible && prop.status !== 'ready')
    )
      throw new Error('stageUnavailable')
    this.syncCamera()
    const { time, playing } = s.timeline
    const stageBackground = this.scene.background,
      alpha = this.renderer.getClearAlpha()
    const helpers: Object3D[] = [this.gizmo.getHelper(), this.grid, this.disc, this.rim, this.floor]
    const entries = [...this.slots.values()]
    for (const entry of entries) if (entry.overlay) helpers.push(entry.overlay.lines)
    const visibility = helpers.map((helper) => helper.visible)
    const restorePose = this.checkpointPose(time)
    const finePoses = entries.map((entry) => entry.gpuCloth?.checkpoint())
    const orbitEnabled = this.controls.enabled,
      gizmoEnabled = this.gizmo.enabled
    const width = this.host.clientWidth,
      height = this.host.clientHeight
    this.captureRevision++
    this.capturing = true
    cancelAnimationFrame(this.frameId)
    const restore = () => {
      if (!this.capturing || this.disposed) return
      try {
        restorePose()
        entries.forEach((entry, i) => {
          const resume = finePoses[i]
          if (resume) resume()
          else if (entry.gpuCloth) {
            // This solver first appeared during capture. Re-sample the restored pose on the next frame.
            entry.gpuCloth.reset()
            entry.lastTime = undefined
          }
        })
      } finally {
        this.scene.background = stageBackground
        this.renderer.setClearAlpha(alpha)
        helpers.forEach((helper, i) => {
          helper.visible = visibility[i]
        })
        this.controls.enabled = orbitEnabled
        this.gizmo.enabled = gizmoEnabled
        s.setTimeline({ time, playing })
        this.restoreCapture = undefined
        this.capturing = false
        this.previous = 0
        if (width !== this.host.clientWidth || height !== this.host.clientHeight) this.resize()
        this.frameId = requestAnimationFrame(this.frame)
        this.renderer.render(this.scene, this.camera)
      }
    }
    try {
      this.controls.enabled = this.gizmo.enabled = false
      this.scene.background = null
      this.renderer.setClearAlpha(0)
      this.gizmo.getHelper().visible = false
      for (const entry of entries) {
        if (entry.overlay) entry.overlay.lines.visible = false
      }
      this.resetCapturePose()
      this.floor.visible = s.stage.shadow && background !== 'transparent'
      this.grid.visible = s.stage.floorGrid && background !== 'transparent'
      this.disc.visible = this.rim.visible = s.stage.floorGrid && background === 'studio'
      s.setTimeline({ playing: false })
      this.restoreCapture = restore
      return restore
    } catch (error) {
      restore()
      throw error
    }
  }

  resetCapturePose(startTime?: number) {
    for (const entry of this.slots.values()) {
      entry.engine?.reset()
      entry.gpuCloth?.reset()
      entry.lastTime = undefined
    }
    if (startTime !== undefined && store.getState().slots.some((slot) => slot.rig.spring.enabled)) {
      for (let i = 0; i < 15; i++) this.samplePose(startTime, 1 / 60, false, true)
    }
  }
  private checkCapture(revision: number) {
    if (
      !this.capturing ||
      this.disposed ||
      revision !== this.captureRevision ||
      this.renderer.getContext().isContextLost()
    )
      throw new Error('stageUnavailable')
  }

  async resetCapturePoseAsync(startTime?: number) {
    const revision = this.captureRevision
    await this.gpuReady
    this.checkCapture(revision)
    this.resetCapturePose()
    if (startTime !== undefined && store.getState().slots.some((slot) => slot.rig.spring.enabled)) {
      for (let i = 0; i < 15; i++) {
        this.checkCapture(revision)
        await this.samplePose(startTime, 1 / 60, false, true, 'capture')
      }
    }
  }

  async sampleDeterministicAsync(time: number, dt: number) {
    const revision = this.captureRevision
    await this.gpuReady
    this.checkCapture(revision)
    await this.samplePose(time, dt, false, true, 'capture')
    this.checkCapture(revision)
    this.renderer.render(this.scene, this.camera)
  }

  sampleDeterministic(time: number, dt: number) {
    this.checkCapture(this.captureRevision)
    this.samplePose(time, dt, false, true)
    this.renderer.render(this.scene, this.camera)
  }
  dispose() {
    this.restoreCapture?.()
    this.stopWatchingGPU?.()
    this.disposed = true
    cancelAnimationFrame(this.frameId)
    this.observer.disconnect()
    for (const id of this.slots.keys()) this.drop(id)
    this.gizmo.detach()
    this.gizmo.dispose()
    this.props.dispose()
    this.controls.dispose()
    for (const mesh of [this.floor, this.grid, this.disc, this.rim]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    this.scene.traverse((n) => {
      if (n instanceof DirectionalLight) n.shadow.dispose()
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
