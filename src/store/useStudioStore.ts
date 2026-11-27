import { create } from 'zustand'
import { snapshotModels, type CatalogModel } from '../services/wikiCatalog'
import { languages, translate, type Language, type MessageKey } from '../i18n'
import {
  defaultWeapon,
  identityTransform,
  type MountedProp,
  type Transform,
  type WeaponSettings,
} from '../engine/PropTypes'
import type { ExportSettings, Viewport } from '../engine/exportSpec'
import type { JointCombo } from '../data/jointCombos'
import type { AnimationClip } from 'three'
import { clipSequence, sequenceDuration } from '../engine/AnimationUtils'
import { defaultRig, type RigSettings } from '../engine/RigDefinition'
import type { ClipInfo, Shading } from '../engine/ModelLoader'

export type Mode = 'solo' | 'jointVictory' | 'propMode'
export type LeftTab = 'characters' | 'joint' | 'props' | 'scene'
export type InspectorTab = 'props' | 'rigging' | 'stage' | 'export'
export type CameraPreset = 'front' | 'threeQuarter' | 'side' | 'back' | 'face' | 'group' | 'reset' | 'fitCrop'
type Vec3 = [number, number, number]
export interface Lighting {
  key: number
  fill: number
  rim: number
  hemisphere: number
  ambient: number
}
export interface StageSettings {
  lighting: Lighting
  shading: Shading
  outline: boolean
  width: number
  color: string
  background: 'studio' | 'transparent' | 'solid' | 'chroma'
  solidColor: string
  floorGrid: boolean
  shadow: boolean
}
export interface Slot extends Transform {
  id: number
  actor: string
  motion: string
  clip: string
  position: Vec3
  yaw: number // Radians; synchronized with rotation[1] for Phase 2 callers.
  socket?: { slotId: number; bone: string; pitch: number }
  endClip?: string
  embedded: Record<string, boolean>
  weapon: WeaponSettings
  rig: RigSettings
  externalClips: AnimationClip[]
}
export interface JointSession {
  comboId: string | null
  chain: boolean
  members: {
    slotId: number
    modelId: string
    x: number
    z: number
    degrees: number
    flip: boolean
    start: string
    end: string
  }[]
}
export interface SlotRuntime {
  status: 'loading' | 'ready' | 'error'
  received: number
  total: number | null
  clips: ClipInfo[]
  actorClips: ClipInfo[]
  attachmentNames: string[]
  donorError?: boolean
  propGroups: string[]
  targetNames: string[]
  sourceNames: string[]
}
interface Timeline {
  playing: boolean
  loop: boolean
  speed: number
  time: number
  duration: number
  trimStart: number
  trimEnd: number
  chainStartEnd: boolean
  seekRevision: number
}
export const initialRuntime = (): SlotRuntime => ({
  status: 'loading',
  received: 0,
  total: null,
  clips: [],
  actorClips: [],
  targetNames: [],
  propGroups: [],
  attachmentNames: [],
  sourceNames: [],
})
const defaultModel = 'Hina (Dress)'
function createSlot(id: number, actor: string = defaultModel): Slot {
  return {
    id,
    actor,
    motion: actor,
    clip: 'Cafe_Reaction',
    ...identityTransform(),
    embedded: {},
    weapon: defaultWeapon(),
    yaw: 0,
    rig: defaultRig(),
    externalClips: [],
  }
}
function readPreference(key: string) {
  try {
    return localStorage.getItem('kivotos.' + key)
  } catch {
    return null
  }
}
function savePreference(key: string, value: string) {
  try {
    localStorage.setItem('kivotos.' + key, value)
  } catch {
    /* Private browsing. */
  }
}
const preference = readPreference('language')
const browserLanguage = (globalThis.navigator?.language ?? 'en').split('-')[0].toLowerCase()
const firstLanguage =
  languages.find((lang) => lang === preference) ?? languages.find((lang) => lang === browserLanguage) ?? 'en'

interface UI {
  left: LeftTab
  right: InspectorTab
  leftOpen: boolean
  rightOpen: boolean
  presets: boolean
  skeleton: boolean
  gizmo: 'off' | 'move' | 'rotate' | 'scale'
}
interface StudioState {
  language: Language
  theme: 'light' | 'dark'
  mode: Mode
  ui: UI
  models: CatalogModel[]
  wiki: 'connecting' | 'live' | 'offline'
  localFiles: Record<string, File>
  slots: Slot[]
  activeId: number
  runtime: Partial<Record<number, SlotRuntime>>
  stage: StageSettings
  camera: { preset: CameraPreset; revision: number }
  props: MountedProp[]
  selectedProp: string | null
  proxyBase: string
  indexUrl: string
  setUrl: (key: 'proxyBase' | 'indexUrl', url: string) => void
  selectProp: (id: string) => void
  updateSlot: (id: number, patch: Partial<Slot>) => void
  castActor: (id: number, actor: string) => void
  loadFormation: (combo: JointCombo, clips: AnimationClip[][], cast?: readonly string[]) => void
  showcaseSolo: (actor: string, motion: string, clip: string, combat: boolean) => void
  transformSlot: (id: number, transform: Partial<Transform>) => void
  joint: JointSession
  timeline: Timeline
  viewport: Viewport
  exportSettings: ExportSettings
  setLanguage: (lang: Language) => void
  toggleTheme: () => void
  setMode: (mode: Mode) => void
  updateUI: (value: Partial<UI>) => void
  setCatalog: (models: CatalogModel[], status: 'live' | 'offline') => void
  addSlot: () => void
  removeSlot: (id: number) => void
  focusSlot: (id: number) => void
  assign: (role: 'actor' | 'motion', model: string) => void
  swap: () => void
  registerFile: (file: File) => string
  openLocal: (file: File) => void
  applyExternalClips: (id: number, clips: AnimationClip[]) => void
  setClip: (name: string) => void
  updateRuntime: (id: number, data: Partial<SlotRuntime>) => void
  setStage: (settings: Partial<StageSettings>) => void
  setCamera: (preset: CameraPreset) => void
  setTimeline: (update: Partial<Timeline>) => void
  seek: (time: number) => void
  setSlotRig: (id: number, rig: Partial<Slot['rig']>) => void
  placeSlot: (id: number, position: Vec3, yaw: number) => void
  setJoint: (update: Partial<JointSession>) => void
  upsertProp: (prop: MountedProp) => void
  removeProp: (id: string) => void
  setExport: (update: Partial<ExportSettings>) => void
}

// Partners hold their final start pose until every member is ready for the end clip.
export function formationStartWindow(slots: Slot[], runtime: StudioState['runtime'], chain: boolean) {
  if (!chain) return 0
  return Math.max(
    0,
    ...slots.map((slot) =>
      slot.endClip ? (runtime[slot.id]?.clips.find((c) => c.name === slot.clip)?.duration ?? 0) : 0,
    ),
  )
}
function stageDuration(slots: Slot[], runtime: StudioState['runtime'], chain: boolean, props: MountedProp[]) {
  const startWindow = formationStartWindow(slots, runtime, chain)
  return Math.max(
    0,
    ...props.filter((p) => p.syncAnimation).map((p) => p.clips.find((c) => c.name === p.clip)?.duration ?? 0),
    ...slots.map((slot) =>
      sequenceDuration(
        clipSequence(runtime[slot.id]?.clips ?? [], slot.clip, chain, slot.endClip),
        slot.endClip ? startWindow : 0,
      ),
    ),
  )
}
function resizeTime(timeline: Timeline, duration: number): Timeline {
  return duration === timeline.duration
    ? timeline
    : {
        ...timeline,
        duration,
        time: Math.max(timeline.trimStart * duration, Math.min(timeline.time, timeline.trimEnd * duration)),
      }
}
function resetTime(timeline: Timeline, duration: number): Timeline {
  return {
    ...timeline,
    duration,
    time: 0,
    trimStart: 0,
    trimEnd: 1,
    seekRevision: timeline.seekRevision + 1,
  }
}
const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
export const useStudioStore = create<StudioState>((set, get) => {
  const updateActive = (change: Partial<Slot>) =>
    set((state) => {
      const slots = state.slots.map((s) => (s.id === state.activeId ? { ...s, ...change } : s))
      const runtime =
        change.actor || change.motion
          ? { ...state.runtime, [state.activeId]: initialRuntime() }
          : state.runtime
      return {
        slots,
        runtime,
        timeline: resetTime(
          state.timeline,
          stageDuration(slots, runtime, state.timeline.chainStartEnd, state.props),
        ),
      }
    })
  return {
    language: firstLanguage,
    theme: readPreference('theme') === 'dark' ? 'dark' : 'light',
    mode: 'solo',
    ui: {
      left: 'characters',
      right: 'stage',
      leftOpen: !mobile,
      rightOpen: !mobile,
      presets: false,
      skeleton: false,
      gizmo: 'off',
    },
    models: snapshotModels,
    wiki: 'connecting',
    localFiles: {},
    slots: [createSlot(1)],
    activeId: 1,
    runtime: {},
    stage: {
      lighting: { key: 1.65, fill: 0.9, rim: 1.25, hemisphere: 1.15, ambient: 0.35 },
      shading: 'unlit',
      outline: true,
      width: 25,
      color: '#23182e',
      background: 'studio',
      solidColor: '#dce8f7',
      floorGrid: true,
      shadow: true,
    },
    camera: { preset: 'front', revision: 0 },
    props: [],
    selectedProp: null,
    proxyBase: readPreference('proxyBase') ?? '',
    indexUrl: readPreference('indexUrl') ?? '',
    setUrl(key, url) {
      savePreference(key, url)
      set({ [key]: url })
    },
    selectProp: (id) => set({ selectedProp: id }),
    updateSlot: (id, patch) =>
      set((s) => ({ slots: s.slots.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)) })),
    castActor(id, actor) {
      const slot = get().slots.find((k) => k.id === id)
      if (!slot || slot.actor === actor) return
      get().updateSlot(id, {
        actor,
        rig: { ...slot.rig, overrides: {}, selectedBone: '', secondaryClip: '' },
      })
    },
    transformSlot(id, transform) {
      get().updateSlot(id, {
        ...transform,
        ...(transform.rotation ? { yaw: (transform.rotation[1] * Math.PI) / 180 } : {}),
      })
    },
    showcaseSolo(actor, motion, clip, combat) {
      const s = get(),
        slot = createSlot(1, actor)
      slot.motion = motion
      slot.clip = clip
      slot.rig.rootMode = combat ? 'ground-scaled' : 'prop-locked'
      if (combat) {
        slot.rig.spring.enabled = true
        slot.weapon = { ...slot.weapon, source: 'motionB', donor: 'Azusa' }
      } else slot.weapon.source = 'hidden'
      set({
        mode: combat ? 'solo' : 'propMode',
        slots: [slot],
        activeId: 1,
        runtime: {},
        props: [],
        selectedProp: null,
        joint: { comboId: null, chain: false, members: [] },
        timeline: resetTime({ ...s.timeline, playing: true, loop: true, speed: 1, chainStartEnd: false }, 0),
        camera: { preset: combat ? 'threeQuarter' : 'front', revision: s.camera.revision + 1 },
        ui: { ...s.ui, right: 'props', left: combat ? 'characters' : 'props', presets: false },
      })
    },
    loadFormation(combo, clips, cast) {
      const slots = combo.members.map((m, i) => {
        const slot = createSlot(i + 1, m.model.slice(0, -4))
        if (combo.id === 'toramaru' && i === 1) slot.socket = { slotId: 1, bone: 'St_point', pitch: 90 }
        if (cast) slot.actor = cast[i]
        slot.clip = m.start
        slot.endClip = m.end
        slot.externalClips = clips[i] ?? []
        slot.position = [m.x, 0, m.z]
        slot.rotation[1] = m.deg
        slot.yaw = (m.deg * Math.PI) / 180
        slot.scale[0] = m.flip ? -1 : 1
        slot.rig.rootMode = 'prop-locked'
        return slot
      })
      const s = get()
      const props = cast ? [] : s.props.filter((p) => p.slotId === null)
      set({
        slots,
        ...(cast
          ? {
              mode: 'jointVictory' as const,
              ui: { ...s.ui, left: 'joint' as const, right: 'props' as const, presets: false },
            }
          : {}),
        runtime: {},
        activeId: 1,
        selectedProp: null,
        props,
        camera: { preset: 'group', revision: s.camera.revision + 1 },
        timeline: resetTime(
          { ...s.timeline, ...(cast ? { playing: true, speed: 1, loop: true } : {}), chainStartEnd: true },
          stageDuration(slots, {}, true, props),
        ),
        joint: {
          comboId: combo.id,
          chain: true,
          members: combo.members.map((m, i) => ({
            slotId: i + 1,
            modelId: slots[i].motion,
            x: m.x,
            z: m.z,
            degrees: m.deg,
            flip: m.flip,
            start: m.start,
            end: m.end,
          })),
        },
      })
    },
    joint: { comboId: null, chain: false, members: [] },
    timeline: {
      playing: true,
      loop: true,
      speed: 1,
      time: 0,
      duration: 0,
      trimStart: 0,
      trimEnd: 1,
      chainStartEnd: false,
      seekRevision: 0,
    },
    viewport: { width: 1280, height: 800, dpr: 1, safe: { x: 320, y: 126, width: 640, height: 584 } },
    exportSettings: {
      aspect: '1:1',
      resolution: 'original',
      fps: 24,
      background: 'transparent',
      solidColor: '#dce8f7',
      alphaCutoff: 128,
      quality: 'balanced',
      showViewfinder: false,
    },
    setLanguage(language) {
      savePreference('language', language)
      set({ language })
    },
    toggleTheme() {
      const theme = get().theme === 'light' ? 'dark' : 'light'
      savePreference('theme', theme)
      set({ theme })
    },
    setMode(mode) {
      set((s) => ({
        mode,
        ui: {
          ...s.ui,
          leftOpen: true,
          ...(window.innerWidth <= 900 ? { rightOpen: false } : {}),
          left: mode === 'solo' ? 'characters' : mode === 'jointVictory' ? 'joint' : 'props',
        },
      }))
    },
    updateUI: (value) =>
      set((s) => {
        const ui = { ...s.ui, ...value }
        const openingExport =
          ui.rightOpen && ui.right === 'export' && (!s.ui.rightOpen || s.ui.right !== 'export')
        return {
          ui,
          ...(openingExport && { camera: { preset: 'fitCrop', revision: s.camera.revision + 1 } }),
        }
      }),
    setCatalog: (models, wiki) => set({ models, wiki }),
    addSlot() {
      const s = get()
      const id = [1, 2, 3, 4].find((n) => !s.slots.some((slot) => slot.id === n))
      if (!id) return
      const slot = createSlot(id, s.slots.find((x) => x.id === s.activeId)?.actor)
      slot.position[0] = Math.max(...s.slots.map((k) => k.position[0])) + 1.25
      set({
        selectedProp: null,
        slots: [...s.slots, slot],
        activeId: id,
        camera: { preset: 'group', revision: s.camera.revision + 1 },
      })
    },
    removeSlot(id) {
      const s = get()
      if (s.slots.length <= 1) return
      const slots = s.slots
        .filter((slot) => slot.id !== id)
        .map((slot) => (slot.socket?.slotId === id ? { ...slot, socket: undefined } : slot))
      const activeId = s.activeId === id ? slots[0].id : s.activeId
      const runtime = { ...s.runtime }
      delete runtime[id]
      const props = s.props.filter((p) => p.slotId !== id)
      set({
        slots,
        activeId,
        runtime,
        props,
        selectedProp: s.props.some((p) => p.id === s.selectedProp && p.slotId === id) ? null : s.selectedProp,
        joint: { ...s.joint, members: s.joint.members.filter((m) => m.slotId !== id) },
        timeline: resetTime(s.timeline, stageDuration(slots, runtime, s.timeline.chainStartEnd, props)),
      })
    },
    focusSlot(id) {
      const s = get()
      if (s.slots.some((slot) => slot.id === id)) set({ activeId: id, selectedProp: null })
    },
    assign(role, model) {
      const slot = get().slots.find((s) => s.id === get().activeId)!
      if (role === 'actor') return get().castActor(slot.id, model)
      if (slot[role] !== model)
        updateActive({
          motion: model,
          externalClips: [],
          endClip: undefined,
          embedded: {},
          socket: undefined,
          rig: {
            ...slot.rig,
            overrides: {},
            selectedBone: '',
            secondaryClip: slot.rig.secondaryClip,
          },
        })
    },
    swap() {
      const s = get().slots.find((slot) => slot.id === get().activeId)!
      if (s.actor !== s.motion)
        updateActive({
          endClip: undefined,
          embedded: {},
          actor: s.motion,
          motion: s.actor,
          externalClips: [],
          rig: { ...s.rig, overrides: {}, selectedBone: '', secondaryClip: '' },
        })
    },
    registerFile(file) {
      const id = 'local:' + crypto.randomUUID()
      set((s) => ({ localFiles: { ...s.localFiles, [id]: file } }))
      return id
    },
    openLocal(file) {
      const id = get().registerFile(file)
      updateActive({
        endClip: undefined,
        embedded: {},
        actor: id,
        motion: id,
        clip: 'Cafe_Reaction',
        rig: defaultRig(),
        externalClips: [],
      })
    },
    applyExternalClips(id, clips) {
      if (!clips.length) return
      set((s) => ({
        slots: s.slots.map((slot) => {
          if (slot.id !== id) return slot
          const byName = new Map(slot.externalClips.map((c) => [c.name, c]))
          for (const clip of clips) byName.set(clip.name, clip)
          return { ...slot, externalClips: [...byName.values()], clip: clips[0].name, endClip: undefined }
        }),
      }))
    },
    setClip: (name) =>
      updateActive({
        clip: name,
        endClip: get().joint.members.find((m) => m.slotId === get().activeId && m.start === name)?.end,
      }),
    updateRuntime(id, data) {
      set((s) => {
        if (!s.slots.some((slot) => slot.id === id)) return s
        const runtime = { ...s.runtime, [id]: { ...(s.runtime[id] ?? initialRuntime()), ...data } }
        let slots = s.slots
        const clips = data.clips
        if (clips && data.status === 'ready') {
          slots = slots.map((slot) => {
            if (slot.id !== id || clips.some((c) => c.name === slot.clip)) return slot
            return {
              ...slot,
              clip: clips.find((c) => c.name === 'Cafe_Reaction')?.name ?? clips[0]?.name ?? '',
            }
          })
        }
        return {
          slots,
          runtime,
          timeline:
            data.clips && data.status !== 'loading'
              ? resizeTime(s.timeline, stageDuration(slots, runtime, s.timeline.chainStartEnd, s.props))
              : s.timeline,
        }
      })
    },
    setStage: (settings) => set((s) => ({ stage: { ...s.stage, ...settings } })),
    setCamera: (preset) => set((s) => ({ camera: { preset, revision: s.camera.revision + 1 } })),
    setTimeline: (update) =>
      set((s) => {
        const next = { ...s.timeline, ...update }
        if (next.chainStartEnd !== s.timeline.chainStartEnd)
          return {
            joint: { ...s.joint, chain: next.chainStartEnd },
            timeline: resetTime(next, stageDuration(s.slots, s.runtime, next.chainStartEnd, s.props)),
          }
        const trimming = update.trimStart !== undefined || update.trimEnd !== undefined
        if (trimming) {
          const gap = next.duration ? Math.min(1, 1 / (s.exportSettings.fps * next.duration)) : 0
          next.trimStart = Math.max(0, Math.min(1 - gap, next.trimStart))
          next.trimEnd = Math.max(gap, Math.min(1, next.trimEnd))
          if (update.trimStart !== undefined) next.trimStart = Math.min(next.trimStart, next.trimEnd - gap)
          else next.trimEnd = Math.max(next.trimEnd, next.trimStart + gap)
        }
        next.time = Math.max(
          next.trimStart * next.duration,
          Math.min(next.trimEnd * next.duration, next.time),
        )
        if (trimming || (!s.timeline.playing && next.playing && s.timeline.time !== next.time))
          next.seekRevision++
        return { timeline: next }
      }),
    seek: (time) =>
      set((s) => ({
        timeline: {
          ...s.timeline,
          playing: false,
          seekRevision: s.timeline.seekRevision + 1,
          time: Math.max(
            s.timeline.trimStart * s.timeline.duration,
            Math.min(s.timeline.trimEnd * s.timeline.duration, time),
          ),
        },
      })),
    setSlotRig: (id, rig) =>
      set((s) => ({
        slots: s.slots.map((slot) => (slot.id === id ? { ...slot, rig: { ...slot.rig, ...rig } } : slot)),
      })),
    placeSlot: (id, position, yaw) =>
      get().transformSlot(id, { position, rotation: [0, (yaw * 180) / Math.PI, 0] }),
    setJoint: (update) => set((s) => ({ joint: { ...s.joint, ...update } })),
    upsertProp: (prop) =>
      set((s) => {
        const props = s.props.some((p) => p.id === prop.id)
          ? s.props.map((p) => (p.id === prop.id ? prop : p))
          : [...s.props, prop]
        return {
          props,
          timeline: resizeTime(
            s.timeline,
            stageDuration(s.slots, s.runtime, s.timeline.chainStartEnd, props),
          ),
        }
      }),
    removeProp: (id) =>
      set((s) => {
        const props = s.props.filter((p) => p.id !== id)
        return {
          props,
          selectedProp: s.selectedProp === id ? null : s.selectedProp,
          timeline: resizeTime(
            s.timeline,
            stageDuration(s.slots, s.runtime, s.timeline.chainStartEnd, props),
          ),
        }
      }),
    setExport: (update) =>
      set((s) => {
        const exportSettings = { ...s.exportSettings, ...update }
        const refit =
          exportSettings.aspect !== s.exportSettings.aspect ||
          (exportSettings.showViewfinder && !s.exportSettings.showViewfinder)
        return {
          exportSettings,
          ...(refit && { camera: { preset: 'fitCrop', revision: s.camera.revision + 1 } }),
        }
      }),
  }
})
export function useText() {
  const lang = useStudioStore((s) => s.language)
  return (key: MessageKey) => translate(lang, key)
}
export function useActiveSlot() {
  return useStudioStore((s) => s.slots.find((slot) => slot.id === s.activeId)!)
}
