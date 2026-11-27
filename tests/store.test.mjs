import test from 'node:test'
import assert from 'node:assert/strict'
import { detectBrowserLanguage, useStudioStore, initialRuntime, formationStartWindow } from '../src/store/useStudioStore.ts'
import { newProp } from '../src/engine/PropTypes.ts'
import { jointCombos } from '../src/data/jointCombos.ts'

test.beforeEach(() => useStudioStore.setState(useStudioStore.getInitialState(), true))
const findSlot = (slots, id) => slots.find((slot) => slot.id === id)

test('slots own their halo defaults and halo edits clear only that slot’s halo error', () => {
  const s = useStudioStore.getState()
  s.addSlot()
  const [a, b] = useStudioStore.getState().slots
  assert.deepEqual(a.halo, { source: 'actorA', donor: '', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })
  assert.deepEqual(a.halo, b.halo)
  assert.notEqual(a.halo.position, b.halo.position)
  assert.notEqual(a.halo.rotation, b.halo.rotation)
  for (const slot of [a, b]) s.updateRuntime(slot.id, { haloDonorError: true, donorError: true })
  s.updateSlot(a.id, { halo: { ...a.halo, source: 'donorC', donor: 'Aru' } })
  const { slots, runtime } = useStudioStore.getState()
  assert.equal(slots[0].halo.source, 'donorC')
  assert.equal(slots[1].halo.source, 'actorA')
  assert.equal(runtime[a.id].haloDonorError, false)
  assert.equal(runtime[a.id].donorError, true)
  assert.equal(runtime[b.id].haloDonorError, true)
  s.updateRuntime(a.id, { haloDonorError: true })
  s.updateSlot(a.id, { halo: { ...slots[0].halo, donor: 'Hina' } })
  assert.equal(useStudioStore.getState().runtime[a.id].haloDonorError, false)
})

test('detectBrowserLanguage maps the primary locale to a supported language', () => {
  const locales = {
    zh: ['zh-CN', 'zh-TW', 'zh_HK', 'cmn-Hans-CN', 'YUE_Hant_HK', 'wuu'],
    ja: ['ja-JP', 'jp'],
    ko: ['ko-KR', 'kr'],
    en: ['en-US', 'fr-FR', 'de-DE', 'es-ES', 'ru-RU', 'pt-BR'],
  }
  for (const [expected, tags] of Object.entries(locales)) {
    for (const tag of tags) {
      assert.equal(detectBrowserLanguage(null, tag, ['zh-CN']), expected, tag)
    }
  }
})

test('detectBrowserLanguage falls back to the first browser language or English', () => {
  assert.equal(detectBrowserLanguage(null, '', ['ko-KR']), 'ko')
  assert.equal(detectBrowserLanguage(undefined, undefined, ['ja-JP']), 'ja')
  assert.equal(detectBrowserLanguage(null, '', ['fr-FR', 'zh-TW']), 'en')
  assert.equal(detectBrowserLanguage(null, '', []), 'en')
  assert.equal(detectBrowserLanguage(undefined), 'en')
})

test('detectBrowserLanguage gives a saved language precedence over the browser locale', () => {
  for (const saved of ['zh', 'ja', 'ko', 'en']) {
    const browser = saved === 'zh' ? 'ja-JP' : 'zh-CN'
    assert.equal(detectBrowserLanguage(saved, browser), saved)
  }
  assert.equal(detectBrowserLanguage('invalid', 'ko-KR'), 'ko')
})

test('useStudioStore: core actions, slots, formation, runtime, timeline, stage, export, props', () => {
  const s = useStudioStore.getState()
  s.setLanguage('ja')
  assert.equal(localStorage.getItem('kivotos.language'), 'ja')
  assert.equal(useStudioStore.getState().language, 'ja')
  s.setLanguage('zh')
  const prevTheme = useStudioStore.getState().theme
  s.toggleTheme()
  assert.notEqual(useStudioStore.getState().theme, prevTheme)
  s.toggleTheme()

  const toramaru = jointCombos.find((c) => c.id === 'toramaru')
  s.loadFormation(toramaru, [[], []])
  assert.equal(useStudioStore.getState().slots.length, 2)
  assert.equal(useStudioStore.getState().timeline.chainStartEnd, true)

  // Runtime updates + formationStartWindow
  const [sl1, sl2] = useStudioStore.getState().slots
  s.updateRuntime(sl1.id, {
    ...initialRuntime(),
    status: 'ready',
    clips: [
      { name: sl1.clip, duration: 1.2, category: 'victory', chain: 'start' },
      { name: sl1.endClip, duration: 2.0, category: 'victory', chain: 'end' },
    ],
  })
  s.updateRuntime(sl2.id, {
    ...initialRuntime(),
    status: 'ready',
    clips: [
      { name: sl2.clip, duration: 1.8, category: 'victory', chain: 'start' },
      { name: sl2.endClip, duration: 2.0, category: 'victory', chain: 'end' },
    ],
  })
  assert.equal(
    formationStartWindow(useStudioStore.getState().slots, useStudioStore.getState().runtime, true),
    1.8,
  )

  // Recent picks max 5
  for (const id of ['Hina', 'Aru', 'Mika', 'Kisaki', 'Iroha', 'Arisu']) s.assign('actor', id)
  assert.equal(useStudioStore.getState().recentPicks.length, 5)
  assert.equal(useStudioStore.getState().recentPicks[0], 'Arisu')

  // Timeline trim clamping
  s.setTimeline({ trimStart: 0.9, trimEnd: 0.5 })
  const tl = useStudioStore.getState().timeline
  assert.ok(tl.trimStart < tl.trimEnd)

  // Slot add/focus/remove
  const beforeCount = useStudioStore.getState().slots.length
  s.addSlot()
  assert.equal(useStudioStore.getState().slots.length, beforeCount + 1)
  const newest = useStudioStore.getState().slots.at(-1).id
  s.focusSlot(newest)
  assert.equal(useStudioStore.getState().activeId, newest)
  s.removeSlot(newest)
  assert.equal(useStudioStore.getState().slots.length, beforeCount)

  // Props & stage & export
  const p = newProp('Hina', 'weapon')
  s.upsertProp(p)
  assert.ok(useStudioStore.getState().props.some((x) => x.id === p.id))
  s.removeProp(p.id)
  s.setStage({ shading: 'softLit' })
  assert.equal(useStudioStore.getState().stage.shading, 'softLit')
  s.setStage({ shading: 'unlit' })
  s.setExport({ fps: 15 })
  assert.equal(useStudioStore.getState().exportSettings.fps, 15)
  s.setExport({ fps: 20 })
})

test('useStudioStore: swap() must clear stale slot.socket', () => {
  const s = useStudioStore.getState()
  const activeId = s.activeId
  s.updateSlot(activeId, { actor: 'Aru', socket: { slotId: 2, bone: 'St_point', pitch: 90 } })
  s.swap()
  assert.equal(
    findSlot(useStudioStore.getState().slots, activeId).socket,
    undefined,
    'swap() left stale socket attached!',
  )
})

test('useStudioStore: openLocal() must clear stale slot.socket', () => {
  const s = useStudioStore.getState()
  const activeId = s.activeId
  s.updateSlot(activeId, { actor: 'Aru', socket: { slotId: 2, bone: 'St_point', pitch: 90 } })
  s.openLocal(new File([new Uint8Array(4)], 'custom.glb'))
  assert.equal(
    findSlot(useStudioStore.getState().slots, activeId).socket,
    undefined,
    'openLocal() left stale socket attached!',
  )
})

test('useStudioStore: setClip() must not attach stale joint endClip after motion changes', () => {
  const s = useStudioStore.getState()
  const officialCombo = jointCombos.find((c) => c.id === '1')
  s.loadFormation(officialCombo, [[], []])
  const s1Id = useStudioStore.getState().slots[0].id
  s.focusSlot(s1Id)
  s.assign('motion', 'Mika')
  s.setClip('Victory_Start_Interaction')
  assert.equal(
    findSlot(useStudioStore.getState().slots, s1Id).endClip,
    undefined,
    'setClip() attached stale joint endClip after slot.motion changed!',
  )
})

test('loading a formation removes world and socket props, their selection and duration', () => {
  const store = useStudioStore.getState()
  const keyboard = {
    ...newProp('Airi (Band)'),
    clip: 'Keyboard',
    clips: [{ name: 'Keyboard', duration: 60 }],
  }
  store.upsertProp(keyboard)
  store.upsertProp({ ...newProp('Aru'), slotId: 1 })
  store.selectProp(keyboard.id)
  assert.equal(useStudioStore.getState().timeline.duration, 60)
  const combo = jointCombos[0]
  store.loadFormation(combo, [])
  const state = useStudioStore.getState()
  assert.deepEqual(state.props, [])
  assert.equal(state.selectedProp, null)
  assert.equal(state.timeline.duration, 0)
  store.setClip(combo.members[0].start)
  assert.equal(useStudioStore.getState().slots[0].endClip, combo.members[0].end)
})

test('all drawer opening paths are exclusive through 900px and independent above it', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  })
  const { updateUI } = useStudioStore.getState()
  const drawers = () => {
    const { leftOpen, rightOpen } = useStudioStore.getState().ui
    return [leftOpen, rightOpen]
  }
  for (const width of [360, 390, 640, 900, 901]) {
    globalThis.window = { innerWidth: width }
    updateUI({ leftOpen: false, rightOpen: false })
    updateUI({ rightOpen: true, right: 'export' })
    assert.deepEqual(drawers(), [false, true])
    updateUI({ left: 'joint', leftOpen: true })
    assert.deepEqual(drawers(), [true, width > 900])
    updateUI({ rightOpen: true })
    assert.deepEqual(drawers(), [width > 900, true])
    updateUI({ leftOpen: false, rightOpen: false })
    assert.deepEqual(drawers(), [false, false])
  }
})
