import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import { Box3 } from 'three'
import { useStudioStore as store } from '../src/store/useStudioStore.ts'
import { animatedGlb } from './fixtures.mjs'

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three' && context.parentURL.endsWith('/engine/SceneManager.ts'))
      return next(new URL('./scene-renderer.mjs', import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { SceneManager } = await import('../src/engine/SceneManager.ts')
hooks.deregister()

test('scene loads and recasts slots, binds sockets, frames the camera and restores export leases', async (t) => {
  let nextFrame
  globalThis.requestAnimationFrame = (fn) => {
    nextFrame = fn
    return 1
  }
  globalThis.cancelAnimationFrame = () => {}
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  globalThis.window = { devicePixelRatio: 1 }
  const host = {
    clientWidth: 800,
    clientHeight: 600,
    appendChild() {},
    getBoundingClientRect: () => ({ width: 800 }),
  }
  const s = store.getState()
  const bytes = animatedGlb(undefined, { nodes: [
    { name: 'Bip001', children: [1, 2, 3] }, { name: 'Body', mesh: 0 }, { name: 'St_point' },
    { name: 'Bip001_Head', translation: [0, 0.72, 0], children: [4] },
    { name: 'Halo', mesh: 0, translation: [0, 0.36, 0] },
  ] })
  const model = new File([bytes], 'actor.glb')
  s.openLocal(model)
  const source = store.getState().slots[0].motion
  const scene = new SceneManager(host)
  t.after(() => scene.dispose())
  let now = 0
  function frame() {
    nextFrame((now += 16))
  }
  async function ready(id) {
    for (let i = 0; i < 50 && store.getState().runtime[id]?.status !== 'ready'; i++) await setImmediate()
    assert.equal(store.getState().runtime[id]?.status, 'ready')
  }
  assert.throws(() => scene.sampleDeterministic(0, 0), /stageUnavailable/)
  assert.throws(() => scene.beginCapture('transparent'), /stageUnavailable/)
  await ready(1)
  s.setSlotRig(1, { selectedBone: 'Bip001' })
  s.updateUI({ skeleton: true, gizmo: 'move' })
  frame()
  assert.equal(scene.gizmo.mode, 'translate')
  scene.gizmo.object.position.x = 2
  scene.gizmo.dispatchEvent({ type: 'objectChange' })
  assert.equal(store.getState().slots[0].position[0], 2)
  s.addSlot()
  s.updateSlot(2, { socket: { slotId: 1, bone: 'St_point', pitch: 90 } })
  frame()
  await ready(2)
  frame()
  assert.equal(scene.gizmo.object.parent.parent.name, 'St_point')
  s.focusSlot(1)
  const secondActor = s.registerFile(new File([bytes], 'replacement.glb'))
  s.castActor(1, secondActor)
  frame()
  await ready(1)
  assert.ok(store.getState().runtime[1].targetNames.includes('Bip001'))
  const halo = store.getState().slots[0].halo
  const faceTop = () => {
    const box = new Box3()
    scene.expandPoseBounds(box, true)
    return box.max.y
  }
  s.updateSlot(1, { halo: { ...halo, source: 'hidden' } })
  frame()
  const bodyTop = faceTop()
  s.updateSlot(1, { halo: { ...halo, source: 'motionB' } })
  frame()
  assert.ok(faceTop() > bodyTop + 0.9)
  const localRing = new File([animatedGlb([], { nodes: [{ name: 'Ring', mesh: 0 }] })], 'ring.glb')
  const donor = s.registerFile(localRing)
  s.updateSlot(1, { halo: { ...halo, source: 'donorC', donor, position: [0, 1, 0] } })
  assert.throws(() => scene.beginCapture('transparent'), /stageUnavailable/)
  await setImmediate()
  frame()
  assert.ok(faceTop() > bodyTop + 1.9)
  scene.beginCapture('transparent')()
  // Switching an already loaded donor must also block capture until its replacement is ready.
  s.updateSlot(1, { halo: { ...halo, source: 'donorC', donor: s.registerFile(new File([bytes], 'next.glb')) } })
  assert.throws(() => scene.beginCapture('transparent'), /stageUnavailable/)
  s.updateSlot(1, { halo })
  frame()
  s.castActor(1, source)
  frame()
  await ready(1)
  for (const preset of ['face', 'back', 'group', 'fitCrop']) {
    s.setCamera(preset)
    frame()
    assert.ok(scene.camera.position.toArray().every(Number.isFinite))
  }
  s.setStage({ shading: 'softLit', background: 'solid' })
  s.toggleTheme()
  s.updateUI({ right: 'export', rightOpen: true, gizmo: 'off' })
  frame()
  const before = store.getState().timeline
  const restore = scene.beginCapture('transparent')
  assert.equal(store.getState().timeline.playing, false)
  assert.throws(() => scene.beginCapture('solid'), /stageUnavailable/)
  const count = scene.renderer.rendered
  scene.sampleDeterministic(0.5, 1 / 24)
  assert.equal(scene.renderer.rendered, count + 1)
  restore()
  assert.equal(store.getState().timeline.time, before.time)
  assert.equal(store.getState().timeline.playing, before.playing)
  s.removeSlot(2)
  scene.retry(1)
  frame()
  await ready(1)
})
