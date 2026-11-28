import test from 'node:test'
import assert from 'node:assert/strict'
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
} from 'three'
import { ColliderGroup } from '../src/engine/BodyColliders.ts'
import { ArmIKSolver } from '../src/engine/ArmIK.ts'
import { GripContact, gripProfile, smoothContact } from '../src/engine/GripCalibration.ts'
import { StudioModel } from '../src/engine/ModelLoader.ts'
import { RetargetEngine } from '../src/engine/RetargetEngine.ts'
import { SlotProps } from '../src/engine/PropManager.ts'
import { defaultRig } from '../src/engine/RigDefinition.ts'
import { languages } from '../src/i18n/index.ts'
import { assertAdjustInspector } from './adjust-inspector.mjs'
import { useStudioStore } from '../src/store/useStudioStore.ts'
import { makeClip } from './fixtures.mjs'

const v = (x, y, z) => new Vector3(x, y, z)
const pos = (node) => node.getWorldPosition(v())
const quat = (node) => node.getWorldQuaternion(new Quaternion()).normalize()
const near = (a, b, tolerance = 1e-6) =>
  assert.ok(a.distanceTo(b) < tolerance, `${a.toArray()} vs ${b.toArray()}, error ${a.distanceTo(b)}`)
function bone(parent, name, x = 0, y = 0, z = 0) {
  const node = new Bone()
  node.name = name
  node.position.set(x, y, z)
  parent.add(node)
  return node
}
function surface(parent, name, points) {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      points.flatMap((p) =>
        [
          p.toArray(),
          p
            .clone()
            .add(v(0.003, 0, 0))
            .toArray(),
          p
            .clone()
            .add(v(0, 0.003, 0))
            .toArray(),
        ].flat(),
      ),
      3,
    ),
  )
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.name = name
  parent.add(mesh)
  return mesh
}

// Grips have different authored origins/orientations, plus a real vertex at
// each palm. The holding clip can put the support hand somewhere other than bind.
function student(
  t,
  {
    height = 0.6,
    origin = 0.04,
    roll = 0,
    support = 0,
    dual = false,
    armed = true,
    props,
    spread = 0,
    animations = [],
    inlineTwist = false,
  } = {},
) {
  const root = new Group(),
    hip = bone(root, 'Bip001', 0, height)
  const spine = bone(hip, 'Bip001_Spine1', 0, 0.12)
  const hands = {},
    arms = {},
    weapons = {},
    contacts = {},
    refs = []
  for (const [side, sign] of [
    ['r', -1],
    ['l', 1],
  ]) {
    const prefix = 'Bip001_' + side + '_'
    const clavicle = bone(spine, prefix + 'Clavicle', sign * 0.06)
    const upperArm = bone(clavicle, prefix + 'UpperArm', sign * (0.12 + spread), 0.09)
    const forearm = bone(upperArm, prefix + 'Forearm', sign * 0.12, -0.14, 0.06)
    const twist = bone(forearm, prefix + 'Forearm_Twist')
    const hand = bone(inlineTwist ? twist : forearm, prefix + 'Hand', -sign * 0.15, 0.03, 0.15)
    hands[side] = hand
    arms[side] = { clavicle, upperArm, forearm, hand, twist }
    contacts[side] = pos(hand)
    if (side === 'l' && support) {
      refs.push(
        new VectorKeyframeTrack(
          hand.name + '.position',
          [0],
          [...hand.position.toArray().slice(0, 2), hand.position.z + support],
        ),
      )
      contacts.l.z += support
    }
  }
  if (armed)
    for (const side of dual ? ['r', 'l'] : ['r']) {
      const weapon = bone(hip, 'Bip001_Weapon' + (dual ? '_' + side : ''))
      weapon.position.copy(hip.worldToLocal(contacts[side].clone())).add(v(0, 0, origin))
      weapon.rotation.z = roll
      const points = (dual ? [contacts[side]] : [contacts.r, contacts.l]).map((point) =>
        weapon.worldToLocal(point.clone()),
      )
      surface(weapon, 'Weapon_' + side, points)
      weapons[side] = weapon
    }
  const meshNames = props?.({ root, spine, hands, arms, contacts })
  const model = new StudioModel(root, [...animations, makeClip('Normal_Idle', 1, refs)], 1, meshNames)
  t.after(() => model.dispose())
  return { model, hands, weapons, arms, contacts, root }
}

for (const reflected of [false, true]) {
  test(
    'analytical two-bone reach, elbow plane and wrist orientation' + (reflected ? ' under reflection' : ''),
    () => {
      const root = new Group()
      root.scale.set(reflected ? -1 : 1, 1, 1)
      root.rotation.y = 0.38
      const upperArm = bone(root, 'upper')
      const forearm = bone(upperArm, 'fore', 0.27, 0.13, 0)
      const hand = bone(forearm, 'hand', 0.23, -0.17, 0)
      hand.rotation.set(0.14, -0.33, 0.25)
      const solver = new ArmIKSolver(),
        chain = { upperArm, forearm, hand }
      const target = root.localToWorld(v(0.35, 0.07, 0))
      const before = pos(hand),
        facing = quat(hand)
      const normal = pos(forearm)
        .sub(pos(upperArm))
        .cross(before.clone().sub(pos(forearm)))
        .normalize()
      assert.equal(solver.solveArm(chain, target, 0), false)
      near(pos(hand), before)
      assert.ok(solver.solveArm(chain, target, 1))
      near(pos(hand), target, 1e-4)
      const endNormal = pos(forearm)
        .sub(pos(upperArm))
        .cross(pos(hand).sub(pos(forearm)))
        .normalize()
      assert.ok(normal.dot(endNormal) > 0.9999)
      assert.ok(facing.angleTo(quat(hand)) < 1e-6)
      solver.solveArm(chain, root.localToWorld(v(100, 0, 0)), 1)
      const length = pos(forearm).distanceTo(pos(upperArm)) + pos(hand).distanceTo(pos(forearm))
      assert.ok(pos(hand).distanceTo(pos(upperArm)) <= length * 0.985 + 1e-8)
      solver.solveArm(chain, pos(upperArm), 1)
      assert.ok(Number.isFinite(pos(hand).lengthSq()))
      root.scale.y = 0
      assert.equal(solver.solveArm(chain, target, 1), false)
    },
  )
}

test('calibration selects the holding clip, caches bounded surfaces, and restores an active pose and morph', (t) => {
  const a = student(t, { origin: 0.083, support: -0.045, animations: [makeClip('Cafe_Idle')] })
  const mesh = a.weapons.r.children[0]
  mesh.morphTargetInfluences = [0.37]
  a.model.restMorphWeights.set(mesh, [0])
  a.hands.l.position.set(0.3, 0.1, 0.4)
  a.weapons.r.rotation.y = 0.71
  const saved = [...a.model.rest.keys()].map((n) => [
    n,
    n.position.clone(),
    n.quaternion.clone(),
    n.scale.clone(),
  ])
  const profile = gripProfile(a.model),
    weapon = profile.weapons.get('bip001_weapon')
  assert.equal(gripProfile(a.model), profile)
  assert.ok(weapon.rightGrip.valid && weapon.leftGrip.valid)
  near(
    weapon.leftGrip.supportInWeapon,
    a.contacts.l
      .clone()
      .sub(a.contacts.r)
      .sub(v(0, 0, 0.083)),
  )
  assert.ok(weapon.rightGrip.surfaceDist < 1e-7 && weapon.leftGrip.surfaceDist < 1e-7)
  assert.ok(weapon.vertices.length <= 192 && weapon.capsule.localA.distanceTo(weapon.capsule.localB) > 0.2)
  assert.ok(weapon.capsule.radius > 0)
  for (const [n, p, q, s] of saved)
    assert.ok(n.position.equals(p) && n.quaternion.equals(q) && n.scale.equals(s))
  assert.deepEqual(mesh.morphTargetInfluences, [0.37])
  const dual = student(t, { dual: true })
  const grips = gripProfile(dual.model).weapons
  assert.equal(grips.size, 2)
  assert.ok(grips.get('bip001_weapon_l').leftGrip.valid && grips.get('bip001_weapon_r').rightGrip.valid)
  assert.equal(grips.get('bip001_weapon_l').rightGrip.valid, false)
  const w = grips.get('bip001_weapon_r'),
    contact = new GripContact()
  assert.equal(contact.weapon(w, w.node.matrixWorld, dual.contacts.r, 'r'), 1)
  assert.equal(contact.weapon(w, w.node.matrixWorld, dual.contacts.r.clone().add(v(0, 0.16, 0)), 'r'), 0)
  assert.equal(contact.weapon(w, new Matrix4().makeScale(0, 0, 0), v(), 'r'), 0)
  assert.equal(smoothContact(0.045), 1)
  assert.ok(Math.abs(smoothContact(0.07) - 0.5) < 1e-12)
  assert.equal(smoothContact(0.095), 0)
})

const atGrip = (w, side) =>
  (side === 'r' ? w.rightGrip : w.leftGrip).supportInWeapon.clone().applyMatrix4(w.node.matrixWorld)
function engine(t, a, b = a) {
  const e = new RetargetEngine(a.model, b.model)
  t.after(() => e.dispose())
  return e
}

test('ground-scaled grasp closes the pistol and foregrip gaps after spread and releases a thrown weapon', (t) => {
  const a = student(t, { height: 0.68, origin: -0.075, roll: 0.3, support: -0.04 })
  const b = student(t)
  const e = engine(t, a, b),
    rig = defaultRig()
  const w = gripProfile(a.model).weapons.get('bip001_weapon')
  for (const spread of [0, 12]) {
    rig.armSpread = spread
    e.sample(0, 0, rig)
    for (const side of ['r', 'l']) near(pos(a.hands[side]), atGrip(w, side), 0.001)
    const twist = a.arms.l.twist.quaternion.clone()
    e.sample(0, 0, rig)
    assert.ok(twist.angleTo(a.arms.l.twist.quaternion) < 1e-6)
  }
  e.sample(0, 0, { ...rig, gripIK: false })
  near(pos(a.weapons.r), pos(b.weapons.r))
  assert.ok(atGrip(w, 'r').distanceTo(pos(a.hands.r)) > 0.05)
  b.weapons.r.position.y -= 0.48
  e.sample(0, 0, rig)
  near(pos(a.weapons.r), pos(b.weapons.r))
})

test('native spread uses the captured authored palm and removing the edit restores the direct clip', (t) => {
  const a = student(t),
    e = engine(t, a),
    rig = defaultRig()
  const w = gripProfile(a.model).weapons.get('bip001_weapon')
  const bind = a.weapons.r.matrixWorld.clone()
  e.sample(0, 0, { ...rig, armSpread: 14 })
  near(atGrip(w, 'r'), pos(a.hands.r))
  near(atGrip(w, 'l'), pos(a.hands.l))
  e.sample(0, 0, rig)
  assert.ok(a.weapons.r.matrixWorld.equals(bind))
})

test('a skinned tether follows both displayed sockets and interpolates by its authored link lengths', (t) => {
  const links = []
  const a = student(t, { dual: true, props({ root }) {
    const from = pos(root.getObjectByName('Bip001_Weapon_r'))
    const to = pos(root.getObjectByName('Bip001_Weapon_l'))
    const delta = to.clone().sub(from)
    links.push(bone(root, 'tether_start'))
    links[0].position.copy(from)
    links.push(bone(links[0], 'tether_middle'))
    links[1].position.copy(delta).multiplyScalar(0.25)
    links.push(bone(links[1], 'tether_end'))
    links[2].position.copy(delta).multiplyScalar(0.75)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(links.flatMap((b) => pos(b).toArray()), 3))
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(links.flatMap((_, i) => [i, 0, 0, 0]), 4))
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(links.flatMap(() => [1, 0, 0, 0]), 4))
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
    mesh.name = 'Weapon_Tether'
    root.add(mesh)
    mesh.bind(new Skeleton(links))
    return new Map([[mesh, mesh.name]])
  } })
  const props = new SlotProps(a.model, student(t).model)
  const bind = links.map((b) => b.position.clone())
  const profile = gripProfile(a.model)
  assert.deepEqual(profile.tethers.map((link) => Math.round(100 * link.fraction)), [0, 25, 100])
  a.weapons.r.position.y += 0.1
  a.weapons.l.position.z -= 0.2
  a.root.updateMatrixWorld(true)
  props.apply(useStudioStore.getInitialState().slots[0])
  near(pos(links[0]), pos(a.weapons.r))
  near(pos(links[1]), pos(a.weapons.r).lerp(pos(a.weapons.l), 0.25))
  near(pos(links[2]), pos(a.weapons.l))
  props.restore()
  for (const [i, b] of links.entries()) near(b.position, bind[i])
})

test('dual and single tracks map by handedness and collapse independently', (t) => {
  const a = student(t, { dual: true, height: 0.68, origin: -0.04 }),
    b = student(t)
  const e = engine(t, a, b),
    rig = defaultRig(),
    weapons = gripProfile(a.model).weapons
  for (const mirror of [false, true]) {
    e.sample(0, 0, { ...rig, mirror })
    for (const side of ['r', 'l'])
      near(atGrip(weapons.get('bip001_weapon_' + side), side), pos(a.hands[side]))
    assert.ok(pos(a.weapons.l).distanceTo(pos(a.weapons.r)) > 0.2)
  }
  const c = student(t, { dual: true }),
    d = student(t, { height: 0.69 })
  c.weapons.r.scale.setScalar(0)
  const reverse = engine(t, d, c)
  reverse.sample(0, 0, rig)
  assert.equal(d.model.weaponMeshes[0].visible, false)
  reverse.sample(0, 0, { ...rig, mirror: true })
  assert.equal(d.model.weaponMeshes[0].visible, true)
  const both = student(t, { dual: true }),
    pair = engine(t, both, c)
  pair.sample(0, 0, rig)
  assert.equal(both.weapons.r.children[0].visible, false)
  assert.equal(both.weapons.l.children[0].visible, true)
})

test('presentation aligns a borrowed grip and preserves calibrated hand snap under stage and slider transforms', (t) => {
  const a = student(t, { height: 0.71 }),
    b = student(t),
    donor = student(t, { origin: -0.085, roll: 0.6 })
  const stage = new Group()
  stage.rotation.y = 0.42
  stage.scale.setScalar(1.4)
  stage.position.set(1.5, 0.2, -0.5)
  stage.add(a.root, b.root, donor.root)
  stage.updateMatrixWorld(true)
  const e = engine(t, a, b),
    rig = defaultRig(),
    slot = useStudioStore.getInitialState().slots[0]
  e.sample(0, 0, rig)
  const props = new SlotProps(a.model, b.model),
    saved = a.weapons.r.matrixWorld.clone()
  props.apply({ ...slot, rig })
  assert.ok(a.weapons.r.matrixWorld.equals(saved))
  for (const [source, model] of [
    ['donorC', donor],
    ['motionB', b],
  ]) {
    const w = gripProfile(model.model).weapons.get('bip001_weapon')
    for (const attach of ['rightHand', 'weaponTrack']) {
      props.apply({ ...slot, rig, weapon: { ...slot.weapon, source, attach } }, donor.model)
      near(atGrip(w, 'r'), pos(a.hands.r))
      const placed = w.node.matrixWorld.clone()
      props.restore()
      const position = [0.01, 0.02, 0.03]
      props.apply({ ...slot, rig, weapon: { ...slot.weapon, source, attach, position } }, donor.model)
      near(pos(w.node), v(...position).applyMatrix4(placed))
      props.restore()
    }
  }
})

for (const kind of ['bodyAttached', 'one hand', 'two hands', 'grounded']) {
  test(kind + ' prop follows its contacts and restores across resample, reset and disposal', (t) => {
    let prop
    const b = student(t, {
      armed: false,
      props({ root, arms, contacts }) {
        if (kind === 'bodyAttached') {
          prop = bone(arms.r.forearm, 'Umbrella_Root', 0.02, 0.03, 0.05)
          surface(prop, 'Umbrella', [v()])
        } else {
          prop = bone(root, 'Accessory')
          const points = kind === 'one hand' ? [contacts.r] : [contacts.r, contacts.l]
          surface(prop, kind === 'grounded' ? 'Piano' : 'Tray', points)
        }
      },
    })
    const a = student(t, { armed: false, height: 0.63, spread: 0.03 })
    const rig = defaultRig(),
      e = engine(t, a, b)
    const original = prop.position.clone(),
      g = gripProfile(b.model).props[0]
    assert.equal(g.kind, kind === 'one hand' || kind === 'two hands' ? 'handheld' : kind)
    if (kind === 'bodyAttached') assert.equal(g.hostBoneKey, 'bip001_r_forearm')
    const offsets = { r: pos(a.hands.r).sub(pos(b.hands.r)), l: pos(a.hands.l).sub(pos(b.hands.l)) }
    const delta = kind === 'one hand' ? offsets.r : offsets.r.clone().lerp(offsets.l, 0.5)
    for (let i = 0; i < 2; i++) {
      e.sample(0, 0, rig)
      if (kind === 'bodyAttached')
        near(pos(prop), original.clone().applyMatrix4(a.arms.r.forearm.matrixWorld))
      else if (kind === 'grounded') {
        near(prop.position, original)
        for (const side of ['r', 'l']) near(pos(a.hands[side]), b.contacts[side], 1e-4)
      } else {
        near(prop.position, original.clone().add(delta))
        for (const side of kind === 'one hand' ? ['r'] : ['r', 'l'])
          near(pos(a.hands[side]), b.contacts[side].clone().add(delta), 1e-4)
      }
    }
    e.reset()
    near(prop.position, original)
    e.sample(0, 0, rig)
    e.sample(0, 0, { ...rig, gripIK: false })
    near(prop.position, original)
    e.sample(0, 0, rig)
    e.dispose()
    near(prop.position, original)
  })
}

test('automatic grip IK keeps the same three root switches in all four languages', () => {
  assert.equal(defaultRig().gripIK, true)
  for (const lang of languages) assertAdjustInspector(lang, false)
})

test('a collapsed first reference frame calibrates from mid-clip and restores the previous scale', (t) => {
  const a = student(t, {
    animations: [
      makeClip('Normal_Idle', 1, [
        new VectorKeyframeTrack('Bip001_Weapon.scale', [0, 0.5, 1], [0, 0, 0, 1, 1, 1, 0, 0, 0]),
      ]),
    ],
  })
  a.weapons.r.scale.set(0.3, 0.4, 0.5)
  const w = gripProfile(a.model).weapons.get('bip001_weapon')
  assert.ok(w.rightGrip.valid && w.leftGrip.valid)
  near(a.weapons.r.scale, v(0.3, 0.4, 0.5))
})

test('a sleeve twist in the wrist hierarchy follows the solved forearm and preserves the wrist basis', (t) => {
  const a = student(t, { inlineTwist: true, height: 0.64, support: -0.055 }),
    b = student(t)
  const e = engine(t, a, b),
    rig = { ...defaultRig(), armSpread: 13 }
  e.sample(0, 0, { ...rig, gripIK: false })
  const facing = quat(a.hands.l)
  e.sample(0, 0, rig)
  const w = gripProfile(a.model).weapons.get('bip001_weapon')
  near(pos(a.hands.l), atGrip(w, 'l'))
  assert.ok(facing.angleTo(quat(a.hands.l)) < 1e-6)
  const arm = a.arms.l
  const axis = a.model.rest
    .get(arm.hand)
    .restWorldPos.clone()
    .sub(a.model.rest.get(arm.forearm).restWorldPos)
    .normalize()
  const relative = quat(arm.forearm).invert().multiply(quat(arm.hand))
  const projection = relative.x * axis.x + relative.y * axis.y + relative.z * axis.z
  const expected = new Quaternion().setFromAxisAngle(axis, 0.55 * 2 * Math.atan2(projection, relative.w))
  assert.ok(expected.angleTo(new Quaternion()) > 0.01)
  assert.ok(arm.twist.quaternion.angleTo(expected) < 1e-6)
})

test('selected borrowed weapons drive the support hand before the cloth pass', (t) => {
  const a = student(t, { height: 0.64, support: 0.045 }),
    b = student(t)
  const donor = student(t, { support: -0.05, origin: -0.08 })
  const e = engine(t, a, b),
    rig = defaultRig(),
    props = new SlotProps(a.model, b.model)
  const slot = useStudioStore.getInitialState().slots[0]
  // Configure the solver first; capture the wrist at the actual cloth entry point.
  e.sample(0, 0, rig)
  let beforeCloth
  t.mock.method(e.spring, 'solveStaticCollisions', () => {
    beforeCloth = pos(a.hands.l)
  })
  for (const [source, display] of [
    ['motionB', b],
    ['donorC', donor],
  ]) {
    const w = gripProfile(display.model).weapons.get('bip001_weapon')
    e.sample(0, 0, rig, false, display.model)
    const solved = pos(a.hands.l)
    props.apply({ ...slot, rig, weapon: { ...slot.weapon, source } }, donor.model)
    near(atGrip(w, 'r'), pos(a.hands.r))
    near(beforeCloth, solved)
    near(atGrip(w, 'l'), solved)
    props.restore()
  }
})

test('contact respects mixer locks, explicit arm bindings and full release while preserving driver deviation', (t) => {
  const a = student(t, { height: 0.66, support: -0.04 }),
    b = student(t),
    e = engine(t, a, b)
  const rig = defaultRig(),
    w = gripProfile(a.model).weapons.get('bip001_weapon')
  // Move the reference palm on B after calibrating. The grip follows this
  // reload deviation on A in addition to A's own authored support offset.
  gripProfile(b.model)
  b.hands.l.position.z += 0.018
  e.sample(0, 0, rig)
  near(pos(a.hands.l), atGrip(w, 'l').add(v(0, 0, 0.018)))
  for (const settings of [
    { ...rig, mixer: { ...rig.mixer, leftArm: 'rest' } },
    { ...rig, overrides: { [a.arms.l.forearm.name]: { muted: true } } },
    { ...rig, overrides: { [a.hands.l.name]: { source: b.hands.r.name } } },
  ]) {
    e.sample(0, 0, { ...settings, gripIK: false })
    const raw = pos(a.hands.l)
    e.sample(0, 0, settings)
    near(pos(a.hands.l), raw)
  }
})

test('calibrated presentation reuses every decomposition and scale operand across identical frames', (t) => {
  const a = student(t),
    b = student(t),
    c = student(t, { dual: true, origin: -0.04 })
  const props = new SlotProps(a.model, b.model),
    slot = useStudioStore.getInitialState().slots[0]
  const settings = { ...slot, weapon: { ...slot.weapon, source: 'donorC' } }
  const sample = () => {
    props.restore()
    props.apply(settings, c.model)
  }
  sample()
  const spy = t.mock.method(Matrix4.prototype, 'decompose')
  const scale = t.mock.method(Matrix4.prototype, 'scale')
  sample()
  const operands = (mock) => mock.mock.calls.flatMap((c) => [c.this, ...c.arguments])
  const first = [operands(spy), operands(scale)]
  assert.ok(first[0].length > 0)
  spy.mock.resetCalls()
  scale.mock.resetCalls()
  sample()
  for (const [i, mock] of [spy, scale].entries()) {
    const current = operands(mock)
    assert.equal(current.length, first[i].length)
    current.forEach((o, j) => assert.equal(o, first[i][j]))
  }
  props.restore()
})

test('directly skinned body accessory moves independently of the invisible driver skeleton', (t) => {
  let accessory
  const b = student(t, {
    armed: false,
    props({ root, arms }) {
      const host = arms.r.forearm
      const points = [pos(host), pos(host).add(v(0, 0.02, 0)), pos(host).add(v(0.02, 0, 0))]
      const geometry = new BufferGeometry()
      geometry.setAttribute(
        'position',
        new Float32BufferAttribute(
          points.flatMap((p) => p.toArray()),
          3,
        ),
      )
      geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(12), 4))
      geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
      accessory = new SkinnedMesh(geometry, new MeshBasicMaterial())
      accessory.name = 'Umbrella'
      root.add(accessory)
      root.updateMatrixWorld(true)
      accessory.bind(new Skeleton([host]))
    },
  })
  const a = student(t, { height: 0.68, armed: false }),
    e = engine(t, a, b)
  const original = pos(b.arms.r.forearm),
    mode = accessory.bindMode
  const point = () => accessory.getVertexPosition(0, v()).applyMatrix4(accessory.matrixWorld)
  e.sample(0, 0, { ...defaultRig(), armSpread: 12 })
  near(point(), pos(a.arms.r.forearm))
  near(pos(b.arms.r.forearm), original)
  e.reset()
  near(point(), original)
  assert.equal(accessory.bindMode, mode)
})

test('IK fades continuously at the reach knee, blends wrist orientation and caps clavicle assist', () => {
  const root = new Group(),
    clavicle = bone(root, 'clavicle')
  const upperArm = bone(clavicle, 'upper', 0.08),
    forearm = bone(upperArm, 'fore', 0.25)
  const hand = bone(forearm, 'hand', 0.25),
    solver = new ArmIKSolver()
  const chain = { upperArm, forearm, hand, clavicle, restPoleLocal: v(0, 0, 1) }
  const targetHandQuat = new Quaternion().setFromAxisAngle(v(0, 1, 0), 0.8)
  const target = pos(upperArm).add(v(0.35, 0.04, 0))
  solver.solveArm(chain, target, 0.5, { targetHandQuat })
  assert.ok(Math.abs(quat(hand).angleTo(targetHandQuat) - 0.4) < 1e-6)
  const distanceAt = (d) => {
    const s = pos(upperArm)
    solver.solveArm(chain, s.clone().add(v(d, 0, 0)), 1, { clavicleMuted: true })
    return pos(hand).distanceTo(s)
  }
  const knee = 0.47,
    eps = 1e-5,
    before = distanceAt(knee - eps),
    at = distanceAt(knee),
    after = distanceAt(knee + eps)
  assert.ok(Math.abs((at - before) / eps - (after - at) / eps) < 0.001)
  solver.solveArm(chain, v(0, 0.9, 0.25), 1)
  const assist = clavicle.quaternion.angleTo(new Quaternion())
  assert.ok(assist > 0 && assist <= Math.PI / 30 + 1e-8)
})

test('calibration restores local transforms even when sampling a malformed mesh throws', (t) => {
  const a = student(t),
    mesh = a.model.weaponMeshes[0]
  a.hands.r.rotation.x += 0.4
  a.weapons.r.position.y += 0.11
  const before = a.hands.r.quaternion.clone(),
    offset = a.weapons.r.position.clone()
  t.mock.method(mesh, 'getVertexPosition', () => {
    throw Error('malformed mesh')
  })
  assert.throws(() => gripProfile(a.model), /malformed mesh/)
  assert.ok(a.hands.r.quaternion.equals(before))
  near(a.weapons.r.position, offset)
})

test('a single rifle follows its calibrated foregrip only while the other driver pistol is held', (t) => {
  const a = student(t, { support: -0.07 }),
    b = student(t, { dual: true })
  const e = engine(t, a, b),
    w = gripProfile(a.model).weapons.get('bip001_weapon')
  for (const mirror of [false, true]) {
    const rig = { ...defaultRig(), mirror }
    e.sample(0, 0, { ...rig, gripIK: false })
    const raw = pos(a.hands.l)
    e.sample(0, 0, rig)
    assert.equal(e.locked.l, true)
    near(pos(a.hands.l), atGrip(w, 'l'), 0.0001)
    assert.ok(raw.distanceTo(pos(a.hands.l)) > 0.06)
    const other = b.weapons[mirror ? 'r' : 'l']
    other.position.z += 0.24
    e.sample(0, 0, rig)
    assert.equal(e.locked.l, false)
    near(pos(a.hands.l), raw)
    other.position.z -= 0.24
  }
})

for (const morph of [true, false])
  test(
    'grounded switch prop samples ' +
      (morph ? 'a late morph key' : 'a show-only selector') +
      ' and acquires the freed hand',
    (t) => {
      let mesh, handle
      const exs = makeClip('Exs', 1)
      const old = makeClip('Old', 1)
      const b = student(t, {
        animations: [exs, old],
        props({ root, contacts }) {
          handle = contacts.r.clone().add(v(0, 0, 0.038))
          mesh = surface(root, 'Switch_Primitive_2', [handle, handle.clone().add(v(0, -0.6, 0))])
          mesh.visible = false
          mesh.userData.switchBike = true
          exs.userData = { hide: ['Weapon_r'], show: [morph ? 'switchBike' : 'CH0177_FoodBike_Outline'] }
          old.userData = { hide: ['switchBike'] }
          if (morph) {
            const position = mesh.geometry.getAttribute('position')
            mesh.geometry.morphAttributes.position = [
              new Float32BufferAttribute(new Float32Array(position.count * 3), 3),
            ]
            mesh.updateMorphTargets()
            mesh.morphTargetInfluences[0] = 1
            exs.tracks.push(
              new NumberKeyframeTrack(
                mesh.uuid + '.morphTargetInfluences[0]',
                [0, 0.5, 0.75, 1],
                [1, 1, 0, 1],
              ),
            )
            // Exercise the independent keyed-collapse path as well as switch visibility.
            exs.tracks.push(new VectorKeyframeTrack('Bip001_Weapon.scale', [0], [0, 0, 0]))
          }
          return new Map([[mesh, 'CH0177_FoodBike_Outline']])
        },
      })
      const a = student(t, { height: 0.63, spread: 0.02 }),
        e = engine(t, a, b)
      b.model.syncSwitchVisibility(old)
      const g = gripProfile(b.model).props.find((g) => g.meshes.includes(mesh))
      assert.equal(g.kind, 'grounded')
      assert.ok(g.vertices.length >= 2)
      assert.equal(b.model.activeVisibilityClip, old)
      assert.equal(mesh.visible, false)
      if (morph) assert.equal(mesh.morphTargetInfluences[0], 1)
      e.setClip('Exs')
      e.sample(0.75, 0, defaultRig())
      assert.ok(mesh.visible)
      assert.equal(a.model.weaponMeshes[0].visible, false)
      near(pos(a.hands.r), handle, 0.0001)
      assert.equal(e.locked.r, true)
      assert.ok(pos(b.hands.r).distanceTo(handle) > 0.037)
      assert.equal(
        e.colliders.shapes.some((s) => s.group === ColliderGroup.weapon),
        false,
      )
    },
  )

test('active weapon capsules follow visible scaled poses and disappear on collapse, hide and native direct', (t) => {
  const a = student(t, { dual: true }),
    b = student(t, { dual: true }),
    e = engine(t, a, b)
  const stage = new Group()
  stage.rotation.y = 0.42
  stage.scale.setScalar(1.8)
  stage.add(a.root, b.root)
  const rig = defaultRig()
  const weapons = gripProfile(a.model).weapons
  const active = () => e.colliders.shapes.filter((s) => s.group === ColliderGroup.weapon)
  e.sample(0, 0, rig)
  assert.equal(active().length, 2)
  for (const [i, w] of Array.from(weapons.values()).entries()) {
    near(active()[i].a, w.capsule.localA.clone().applyMatrix4(w.node.matrixWorld))
    near(active()[i].b, w.capsule.localB.clone().applyMatrix4(w.node.matrixWorld))
    assert.ok(active()[i].radius >= 0.015 * 1.8 && active()[i].radius <= 0.085 * 1.8)
  }
  b.weapons.r.scale.setScalar(0)
  e.sample(0, 0, rig)
  assert.equal(active().length, 1)
  e.sample(0, 0, { ...rig, showActorWeapon: false })
  assert.equal(active().length, 0)
  e.sample(0, 0, rig)
  assert.equal(active().length, 1)
  engine(t, a).sample(0, 0, rig)
  assert.equal(active().length, 0)
})

test('cloth samples the displayed donor capsule after hand attachment and user offsets', (t) => {
  const a = student(t),
    b = student(t),
    donor = student(t, { origin: -0.09 })
  const e = engine(t, a, b),
    props = new SlotProps(a.model, b.model)
  const slot = useStudioStore.getInitialState().slots[0]
  const settings = {
    ...slot,
    weapon: { ...slot.weapon, source: 'donorC', attach: 'rightHand', position: [0.2, 0.1, -0.1] },
  }
  const w = gripProfile(donor.model).weapons.get('bip001_weapon')
  e.sample(0, 0, slot.rig, false, null, true)
  const displayed = props.apply(settings, donor.model)
  e.finishCloth(displayed)
  const active = e.colliders.shapes.filter((s) => s.group === ColliderGroup.weapon)
  assert.equal(active.length, 1)
  near(active[0].a, w.capsule.localA.clone().applyMatrix4(w.node.matrixWorld))
  near(active[0].b, w.capsule.localB.clone().applyMatrix4(w.node.matrixWorld))
  props.restore()
})

test('a handheld prop contributes its placed capsule only while in contact', (t) => {
  let tray
  const b = student(t, {
    armed: false,
    props({ root, contacts }) {
      tray = bone(root, 'Tray')
      surface(tray, 'Tray_Surface', [contacts.r, contacts.l])
    },
  })
  const a = student(t, { height: 0.64, armed: false }),
    e = engine(t, a, b),
    rig = defaultRig()
  const g = gripProfile(b.model).props[0]
  e.sample(0, 0, rig)
  const active = e.colliders.shapes.filter((s) => s.group === ColliderGroup.weapon)
  assert.equal(active.length, 1)
  near(active[0].a, g.capsule.localA.clone().applyMatrix4(tray.matrixWorld))
  near(active[0].b, g.capsule.localB.clone().applyMatrix4(tray.matrixWorld))
  assert.ok(e.locked.l && e.locked.r)
  e.reset()
  tray.position.z += 0.5
  e.sample(0, 0, rig)
  assert.equal(
    e.colliders.shapes.some((s) => s.group === ColliderGroup.weapon),
    false,
  )
  assert.ok(!e.locked.l && !e.locked.r)
})

test('grounded FoodBike tracks a small skinned handle that moves independently of the bike root', t => {
  let goal, mesh
  const exs = makeClip('Exs', 1)
  const b = student(t, {
    armed: false, animations: [exs],
    props({ root, contacts }) {
      const bike = bone(root, 'bone_bike'), handle = bone(bike, 'bone_handle')
      const points = [], indices = [], weights = []
      goal = contacts.r.clone().add(v(0, 0, 0.025))
      for (let i = 0; i < 301; i++) {
        const handlebar = i === 199
        points.push(...(handlebar ? goal.clone().add(v(0, 0, 0.4)) : v(i * 0.001, 0.05, 0.3)))
        indices.push(handlebar ? 1 : 0, 0, 0, 0)
        weights.push(1, 0, 0, 0)
      }
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
      geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4))
      geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
      mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
      mesh.name = 'CH0177_FoodBike_Outline_2'
      root.add(mesh)
      mesh.bind(new Skeleton([bike, handle]))
      exs.tracks.push(new VectorKeyframeTrack('bone_handle.position', [0, 1], [0, 0, 0, 0, 0, -0.4]))
      return new Map([[mesh, 'CH0177_FoodBike_Outline']])
    },
  })
  const a = student(t, { armed: false, height: 0.63, spread: 0.02 })
  const e = engine(t, a, b), rig = defaultRig()
  const group = gripProfile(b.model).props.find(g => g.meshes.includes(mesh))
  assert.equal(group.kind, 'grounded')
  assert.equal(group.liveSurface.parts[0].samples.length, 128)
  e.setClip('Exs')
  e.sample(0, 0, rig)
  assert.equal(e.locked.r, false)
  e.sample(1, 0, rig)
  assert.equal(e.locked.r, true)
  near(pos(a.hands.r), goal, 1e-4)
  e.sample(0.97, 1 / 60, rig)
  const filtered = goal.clone().add(v(0, 0, 0.012 * (1 - Math.exp(-24 / 60))))
  near(pos(a.hands.r), filtered, 1e-4)
  const resume = e.checkpointSpring()
  e.reset()
  e.sample(0.97, 0, rig)
  near(pos(a.hands.r), goal.clone().add(v(0, 0, 0.012)), 1e-4)
  resume()
  near(pos(a.hands.r), filtered, 1e-4)
  b.model.setPartEnabled(mesh, false)
  e.sample(1, 0, rig)
  assert.equal(e.locked.r, false)
  b.model.setPartEnabled(mesh, true)
  e.sample(1, 1 / 120, rig)
  near(pos(a.hands.r), goal, 1e-4)
})

test('the elbow pole moves smoothly through straight extension from either bend direction', () => {
  const root = new Group(), upperArm = bone(root, 'upper')
  const forearm = bone(upperArm, 'fore', 0.25), hand = bone(forearm, 'hand', 0.25)
  const solver = new ArmIKSolver()
  const chain = { upperArm, forearm, hand, restPoleLocal: v(0, 0, 1) }
  let previous
  for (let i = -32; i <= 32; i++) {
    upperArm.quaternion.identity()
    hand.quaternion.identity()
    forearm.rotation.set(0, 0, i * 0.01)
    assert.ok(solver.solveArm(chain, v(0.40, 0, 0), 1))
    const pole = pos(forearm).setX(0).normalize()
    if (Math.abs(i) <= 3) assert.ok(pole.z > 0.9999)
    if (previous) assert.ok(pole.angleTo(previous) < 0.12)
    previous = pole
  }
})
