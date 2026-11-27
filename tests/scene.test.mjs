import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { setImmediate } from 'node:timers/promises'
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
  const bytes = animatedGlb()
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
