import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import {
  Bone, BoxGeometry, Euler, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion,
  QuaternionKeyframeTrack, Vector3,
} from 'three'
import { ModelLoader, StudioModel } from '../src/engine/ModelLoader.ts'
import { PropManager, SlotProps } from '../src/engine/PropManager.ts'
import { defaultHalo } from '../src/engine/PropTypes.ts'
import { RetargetEngine } from '../src/engine/RetargetEngine.ts'
import { useStudioStore as store } from '../src/store/useStudioStore.ts'
import { animatedGlb, makeClip } from './fixtures.mjs'

test.beforeEach(() => store.setState(store.getInitialState(), true))

const vec = (x, y, z) => new Vector3(x, y, z)
const turn = (x, y, z) => new Quaternion().setFromEuler(new Euler(x, y, z))
const restOffset = vec(0, 0.36, -0.209)
const worldPosition = (node) => node.getWorldPosition(new Vector3())
function near(actual, expected) {
  assert.equal(actual.length, expected.length)
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6, `[${actual}] ≠ [${expected}]`))
}
function mesh(name) {
  const node = new Mesh(new BoxGeometry(0.14, 0.03, 0.14), new MeshBasicMaterial())
  node.name = name
  return node
}
function rig(t, { headY = 0.72, bind = new Quaternion(), direct = false, animations = [] } = {}) {
  const root = new Group()
  const hip = new Bone()
  hip.name = 'Bip001'
  root.add(hip)
  const head = new Bone()
  head.name = 'Bip001_Head'
  hip.add(head)
  head.position.y = headY
  head.quaternion.copy(bind)
  const ring = mesh(direct ? 'CH0175_Halo' : 'CH0069_Halo_1')
  const halo = direct ? ring : new Group()
  if (!direct) {
    halo.name = 'HaloRoot'
    const fx = new Group()
    fx.add(mesh('FX_Halo_Trail'), mesh('Streak'))
    halo.add(ring, fx)
  }
  head.add(halo)
  // Author a level halo above a head whose local bind axes may be tilted.
  halo.quaternion.copy(bind).invert()
  halo.position.copy(restOffset).applyQuaternion(halo.quaternion)
  root.add(mesh('CH0069_Body'), mesh('CH0069_Weapon'), mesh('Bag'))
  const model = new StudioModel(root, animations, 1)
  t?.after(() => model.dispose())
  return { model, head, ring, halo }
}
function haloMeshes(model) {
  return model.haloNodes.filter((n) => n instanceof Mesh)
}
function checkVisible(model, visible) {
  for (const part of haloMeshes(model)) assert.equal(part.visible, visible, part.name)
}
const slotWith = (patch) => ({ ...store.getState().slots[0], halo: { ...defaultHalo(), ...patch } })

test('mesh visibility covers every halo trail and respects clip switches without hiding HaloRoot', (t) => {
  const { model, halo } = rig(t)
  assert.deepEqual(haloMeshes(model).map((m) => m.name), ['CH0069_Halo_1', 'FX_Halo_Trail', 'Streak'])
  model.setHalosEnabled(false)
  checkVisible(model, false)
  assert.equal(halo.visible, true)
  const clip = makeClip('Idle')
  clip.userData = { hide: ['Streak'] }
  model.syncSwitchVisibility(clip)
  checkVisible(model, false)
  model.setHalosEnabled(true)
  assert.deepEqual(haloMeshes(model).map((m) => m.visible), [true, true, false])
  model.syncSwitchVisibility()
  checkVisible(model, true)
})

test('cross-character retargeting keeps the driver halo group usable and restores driver meshes on dispose', (t) => {
  const a = rig(t), b = rig(t)
  const engine = new RetargetEngine(a.model, b.model)
  checkVisible(b.model, false)
  assert.equal(b.halo.visible, true)
  const props = new SlotProps(a.model, b.model)
  props.apply(slotWith({ source: 'motionB' }))
  checkVisible(b.model, true)
  assert.equal(b.halo.visible, true)
  assert.equal(b.model.bodyMeshes[0].visible, false)
  props.restore()
  props.apply(slotWith({ source: 'hidden' }))
  engine.dispose()
  for (const mesh of b.model.meshGroups.keys()) assert.equal(mesh.visible, true)
})

test('all four sources switch independently of weapons and align an elevated vehicle halo to the actor', (t) => {
  const a = rig(t), b = rig(t, { headY: 1.94 }), c = rig(t, { headY: 1.94, direct: true })
  const props = new SlotProps(a.model, b.model)
  near(worldPosition(c.halo).toArray(), [0, 2.30, -0.209])
  for (const [source, active] of [['actorA', a], ['motionB', b], ['donorC', c], ['hidden', undefined]]) {
    const slot = slotWith({ source })
    slot.weapon = { ...slot.weapon, source: 'hidden' }
    props.apply(slot, undefined, c.model)
    for (const r of [a, b, c]) checkVisible(r.model, r === active)
    if (active) near(worldPosition(active.halo).toArray(), [0, 1.08, -0.209])
    props.restore()
    near(worldPosition(c.halo).toArray(), [0, 2.30, -0.209])
  }
  // Native A/B with identity settings must leave sampled transforms untouched.
  const native = new SlotProps(a.model, a.model)
  const updates = t.mock.method(a.halo, 'updateWorldMatrix')
  for (const source of ['actorA', 'motionB']) {
    native.apply(slotWith({ source }))
    native.restore()
    checkVisible(a.model, true)
  }
  assert.equal(updates.mock.callCount(), 0)
})

test('upright head offsets follow actor tilt; flipped slots preserve donor spin, trail animation and scale', (t) => {
  const actorBind = turn(0.7, 0, 1.1), donorBind = turn(0, -0.6, -1.3)
  const a = rig(t, { bind: actorBind }), c = rig(t, { headY: 1.94, bind: donorBind })
  const stage = new Group()
  stage.position.set(1, 2, 3)
  stage.rotation.y = 0.4
  stage.scale.x = -1
  stage.add(a.model.root, c.model.root)
  const tilt = turn(0, 0, Math.PI / 2), spin = turn(0, 0.76, 0)
  a.head.quaternion.copy(tilt).multiply(actorBind)
  c.head.quaternion.premultiply(turn(0.4, 0.2, -0.2))
  c.halo.quaternion.multiply(spin)
  const trail = c.halo.getObjectByName('FX_Halo_Trail')
  trail.rotation.x = 0.43
  trail.position.x = 0.23
  trail.updateMatrix()
  const trailLocal = trail.matrix.clone()
  const original = [c.halo.position, c.halo.quaternion, c.halo.scale].map((v) => v.toArray())
  const props = new SlotProps(a.model, a.model)
  const slot = slotWith({ source: 'donorC', position: [0.2, -0.1, 0.3], rotation: [90, 0, 0], scale: 1.7 })
  const center = restOffset.clone().add(vec(...slot.halo.position)).applyQuaternion(tilt).add(a.head.position)
  const orientation = tilt.clone().multiply(turn(Math.PI / 2, 0, 0)).multiply(spin)
  stage.updateMatrixWorld(true)
  const expected = stage.matrixWorld.clone().multiply(new Matrix4().compose(center, orientation, vec(1.7, 1.7, 1.7)))
  for (let frame = 0; frame < 12; frame++) {
    props.apply(slot, undefined, c.model)
    near(c.halo.matrixWorld.elements, expected.elements)
    near(trail.matrixWorld.elements, expected.clone().multiply(trailLocal).elements)
    props.restore()
    for (const [i, v] of [c.halo.position, c.halo.quaternion, c.halo.scale].entries())
      assert.deepEqual(v.toArray(), original[i])
  }
})

test('native direct-under-head offsets rotate and scale about the halo center and restore the bind pose', (t) => {
  const a = rig(t, { direct: true, bind: turn(0, 0, 1.1) })
  const props = new SlotProps(a.model, a.model)
  props.apply(slotWith({ position: [0.25, 0, 0], rotation: [0, 90, 0], scale: 2 }))
  const expected = new Matrix4().compose(vec(0.25, 1.08, -0.209), turn(0, Math.PI / 2, 0), vec(2, 2, 2))
  near(a.halo.matrixWorld.elements, expected.elements)
  props.restore()
  near(worldPosition(a.halo).toArray(), [0, 1.08, -0.209])
})

test('collapsed head frames remain finite and missing actor heads skip placement', (t) => {
  const a = rig(t), b = rig(t)
  const props = new SlotProps(a.model, b.model)
  a.head.scale.setScalar(0)
  props.apply(slotWith({ source: 'motionB' }))
  near(worldPosition(b.halo).toArray(), [0, 1.08, -0.209])
  props.restore()
  a.head.scale.setScalar(1)
  b.head.scale.setScalar(0)
  props.apply(slotWith({ source: 'motionB' }))
  assert.ok(b.halo.matrixWorld.elements.every(Number.isFinite))
  near(b.halo.scale.toArray(), [0, 0, 0])
  props.restore()
  near(b.halo.scale.toArray(), [1, 1, 1])
  const headless = new StudioModel(new Group(), [], 1)
  t.after(() => headless.dispose())
  const edits = t.mock.method(b.halo, 'updateWorldMatrix')
  new SlotProps(headless, b.model).apply(slotWith({ source: 'motionB' }))
  assert.equal(edits.mock.callCount(), 0)
})

function donorScene(t, load) {
  const scene = new Group(), group = new Group()
  scene.add(group)
  const a = rig(t)
  group.add(a.model.root)
  const entry = { group, actor: a.model, props: new SlotProps(a.model, a.model) }
  const slots = new Map([[1, entry]])
  const manager = new PropManager(scene, { load })
  t.after(() => manager.dispose())
  const sync = (time = 0) => {
    entry.props.restore()
    manager.sync(time, slots, (id) => store.getState().localFiles[id] ?? id)
  }
  const select = (donor) => store.getState().updateSlot(1, { halo: { ...defaultHalo(), source: 'donorC', donor } })
  return { manager, group, entry, sync, select }
}
function spinClip(name, angle) {
  const track = new QuaternionKeyframeTrack('HaloRoot.quaternion', [0, 1], [
    0, 0, 0, 1, ...turn(0, angle, 0).toArray(),
  ])
  return makeClip(name, 1, [track])
}

test('halo donors isolate geometry, follow the slot, sample exact/idle/first clips and release on mode changes', async (t) => {
  const first = spinClip('Other', 0.4), idle = spinClip('Cafe_Idle', 0.8), exact = spinClip('Skill', 1.4)
  idle.userData = { hide: ['FX_Halo_Trail'] }
  const load = async (source) => rig(undefined, {
    headY: 1.94, animations: source === 'second' ? [first] : [first, idle, exact],
  }).model
  const { manager, group, sync, select } = donorScene(t, load)
  group.position.set(2, 3, 4)
  group.scale.x = -1
  const s = store.getState()
  s.setTimeline({ loop: true })
  s.updateSlot(1, { weapon: { ...s.slots[0].weapon, source: 'donorC', donor: 'first' } })
  select('first')
  sync()
  await setImmediate()
  sync(1.5)
  const donor = manager.haloDonor(1), weaponDonor = manager.donor(1)
  assert.notEqual(donor, weaponDonor)
  assert.equal(donor.bodyMeshes[0].visible, false)
  assert.equal(donor.weaponMeshes[0].visible, false)
  assert.equal(donor.propMeshes[0].visible, false)
  assert.equal(weaponDonor.weaponMeshes[0].visible, true)
  checkVisible(weaponDonor, false)
  const halo = donor.root.getObjectByName('HaloRoot')
  const expected = (angle) => group.matrixWorld.clone().multiply(new Matrix4().compose(
    vec(0, 1.08, -0.209), turn(0, angle, 0), vec(1, 1, 1),
  ))
  near(halo.matrixWorld.elements, expected(0.4).elements)
  assert.equal(halo.getObjectByName('FX_Halo_Trail').visible, false)
  s.setClip('Skill')
  sync(0.5)
  near(halo.matrixWorld.elements, expected(0.7).elements)
  assert.equal(halo.getObjectByName('FX_Halo_Trail').visible, true)
  s.setTimeline({ loop: false })
  sync(2)
  near(halo.matrixWorld.elements, expected(1.4).elements)
  select('second')
  sync()
  await setImmediate()
  sync(0.5)
  assert.equal(donor.root.parent, null)
  const second = manager.haloDonor(1)
  near(second.root.getObjectByName('HaloRoot').matrixWorld.elements, expected(0.2).elements)
  s.updateSlot(1, { halo: defaultHalo() })
  sync()
  assert.equal(manager.haloDonor(1), undefined)
  assert.equal(second.root.parent, null)
  assert.equal(manager.donor(1), weaponDonor)
  manager.dispose()
  assert.equal(weaponDonor.root.parent, null)
})

test('standalone local GLB uses its authored origin at the canonical halo offset; rigged or invalid donors report halo errors', async (t) => {
  const s = store.getState(), loader = new ModelLoader(1)
  const { manager, sync, select } = donorScene(t, (source, progress, signal) => loader.load(source, progress, signal))
  const file = new File([animatedGlb([], { nodes: [{ name: 'Sculpture', mesh: 0 }] })], 'sculpture.glb')
  select(s.registerFile(file))
  sync()
  await setImmediate()
  sync()
  const donor = manager.haloDonor(1)
  assert.ok(donor.haloNodes.includes(donor.root))
  checkVisible(donor, true)
  near(worldPosition(donor.root).toArray(), [0, 1.085, -0.209])
  const emptyHalo = animatedGlb([], { nodes: [{ name: 'HaloRoot' }] })
  for (const bytes of [animatedGlb(), emptyHalo, new Uint8Array([1])]) {
    select(s.registerFile(new File([bytes], 'bad.glb')))
    assert.ok(!store.getState().runtime[1]?.haloDonorError)
    sync()
    await setImmediate()
    assert.equal(manager.haloDonor(1), undefined)
    assert.equal(store.getState().runtime[1].haloDonorError, true)
    assert.ok(!store.getState().runtime[1].donorError)
  }
  assert.equal(donor.root.parent, null)
})

test('stale halo loads release their models and ignore errors after a donor switch', async (t) => {
  const loads = []
  const { manager, sync, select } = donorScene(t, (_source, _progress, signal) =>
    new Promise((resolve, reject) => loads.push({ resolve, reject, signal })))
  select('stale success')
  sync()
  select('stale failure')
  sync()
  select('current')
  sync()
  assert.ok(loads[0].signal.aborted && loads[1].signal.aborted)
  const stale = rig().model, current = rig().model
  const disposed = t.mock.method(stale, 'dispose')
  loads[0].resolve(stale)
  loads[1].reject(new Error('late failure'))
  loads[2].resolve(current)
  await setImmediate()
  sync()
  assert.equal(disposed.mock.callCount(), 1)
  assert.equal(manager.haloDonor(1), current)
  assert.ok(!store.getState().runtime[1]?.haloDonorError)
  select('pending')
  sync()
  select('replacement')
  loads[3].reject(new Error('selection already changed before the next frame'))
  await setImmediate()
  assert.ok(!store.getState().runtime[1]?.haloDonorError)
  sync()
  manager.dispose()
  assert.ok(loads[4].signal.aborted)
})
