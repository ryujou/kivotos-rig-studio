import test from 'node:test'
import assert from 'node:assert/strict'
import { Box3, Group, Matrix4 } from 'three'
import { setImmediate } from 'node:timers/promises'
import { PropManager, SlotProps, readTransform } from '../src/engine/PropManager.ts'
import { useStudioStore as store } from '../src/store/useStudioStore.ts'
import { newProp } from '../src/engine/PropTypes.ts'
import { makeHumanoidModel, makeClip } from './fixtures.mjs'

test('mounts, resamples and unmounts weapons and mesh groups without sharing transforms across frames', async (t) => {
  const scene = new Group()
  const load = () => makeHumanoidModel({ withUntexturedProp: true, animations: [makeClip('Normal_Idle')] })
  const manager = new PropManager(scene, { load: async () => load() })
  t.after(() => manager.dispose())
  const actor = load(),
    driver = load()
  t.after(() => {
    actor.dispose()
    driver.dispose()
  })
  const slotProps = new SlotProps(actor, driver)
  const slots = new Map([[1, { group: new Group(), actor, driver, props: slotProps }]])
  const s = store.getState()
  const grip = actor.root.getObjectByName('Bip001_Weapon')
  const bone = actor.root.getObjectByName('Bip001 Head')
  const specs = [
    { ...newProp('donor', 'weapon'), bone: bone.name, slotId: 1, position: [1, 2, 3] },
    { ...newProp('donor', 'weapon'), bone: grip.name, slotId: 1, position: [-1, 2, 3] },
    { ...newProp('donor', 'CH0001_Tank'), bone: grip.name, slotId: 1 },
    newProp('donor'),
    newProp('bad', 'missing'),
  ]
  for (const prop of specs) s.upsertProp(prop)
  function sync(time) {
    slotProps.restore()
    manager.sync(time, slots, (id) => id)
  }
  s.updateSlot(1, {
    weapon: { ...s.slots[0].weapon, source: 'donorC', donor: 'donor', rotation: [0, 90, 0] },
  })
  sync(0)
  await setImmediate()
  sync(2)
  assert.equal(store.getState().props.at(-1).status, 'error')
  assert.ok(manager.donor(1))
  const handles = specs.slice(0, 2).map((p) => manager.handle(p.id))
  for (let i = 0; i < handles.length; i++) {
    assert.deepEqual(readTransform(handles[i]).position, specs[i].position)
    assert.equal(handles[i].parent.visible, true)
  }
  const matrices = handles.map((h) => h.children[0].matrixWorld.clone())
  assert.ok(!matrices[0].equals(matrices[1]))
  const decompose = t.mock.method(Matrix4.prototype, 'decompose')
  const scale = t.mock.method(Matrix4.prototype, 'scale')
  sync(2)
  // Compare identities for both the matrix and output arguments across identical
  // samples. This catches reintroducing scratch constructors in sync() or mount().
  for (const spy of [decompose, scale]) assert.ok(spy.mock.callCount() > 0)
  const objectsUsed = (spy) => spy.mock.calls.flatMap((call) => [call.this, ...call.arguments])
  const firstUse = [objectsUsed(decompose), objectsUsed(scale)]
  decompose.mock.resetCalls()
  scale.mock.resetCalls()
  sync(2)
  for (const [i, spy] of [decompose, scale].entries()) {
    const secondUse = objectsUsed(spy)
    assert.equal(secondUse.length, firstUse[i].length)
    secondUse.forEach((object, j) => assert.equal(object, firstUse[i][j]))
  }
  handles.forEach((h, i) => {
    const actual = h.children[0].matrixWorld.elements
    matrices[i].elements.forEach((value, j) => assert.ok(Math.abs(actual[j] - value) < 1e-10))
  })
  const box = new Box3()
  manager.expandBounds(box)
  assert.equal(box.isEmpty(), false)
  s.upsertProp({ ...specs[0], bone: 'missing' })
  sync(3)
  assert.equal(handles[0].parent.visible, false)
  s.updateSlot(1, { weapon: { ...s.slots[0].weapon, source: 'hidden' } })
  for (const prop of specs) s.removeProp(prop.id)
  sync(0)
  assert.equal(manager.donor(1), undefined)
  assert.equal(scene.children.length, 0)
})
