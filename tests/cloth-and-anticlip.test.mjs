import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { assertAdjustInspector } from './adjust-inspector.mjs'
import { languages } from '../src/i18n/index.ts'
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
} from 'three'
import { BodyColliders, ColliderGroup, bodyColliders, collisionMasks } from '../src/engine/BodyColliders.ts'
import { buildFineClothMesh } from '../src/engine/ClothMeshBuilder.ts'
import { StudioModel, rigBones } from '../src/engine/ModelLoader.ts'
import { defaultRig } from '../src/engine/RigDefinition.ts'
import { SpringBoneSolver } from '../src/engine/SpringBoneSolver.ts'
import { SceneManager } from '../src/engine/SceneManager.ts'
import { useStudioStore } from '../src/store/useStudioStore.ts'
import { RetargetEngine } from '../src/engine/RetargetEngine.ts'

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z)
const Q = (axis, angle) => new Quaternion().setFromAxisAngle(axis, angle)
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)
const identity = new Quaternion()
const world = (n) => n.getWorldPosition(V())

function fixture({
  twists = false,
  spine2 = false,
  neck = true,
  longTips = false,
  skirtLink = longTips ? 0.71 : 0.18,
  tightWaist = false,
  extras = false,
  collisionLinks = false,
  handWeapon = false,
  accessories = false,
  bikeHandle = false,
  arc = 360,
  clips = [],
} = {}) {
  const root = new Group(),
    nodes = {},
    bones = [],
    vertices = [],
    indices = [],
    weights = []
  const add = (name, parent, x = 0, y = 0, z = 0, Node = Bone) => {
    const b = new Node()
    b.name = name
    b.position.set(x, y, z)
    parent.add(b)
    bones.push(b)
    return (nodes[name] = b)
  }
  const vertex = (bone, point, minor) => {
    vertices.push(...point)
    indices.push(bones.indexOf(bone), minor ? bones.indexOf(minor) : 0, 0, 0)
    weights.push(minor ? 0.8 : 1, minor ? 0.2 : 0, 0, 0)
  }
  const tube = (bone, radius, length) => {
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6
      vertex(bone, world(bone).add(V(radius * Math.sin(a), length / 2, radius * Math.cos(a))))
    }
  }
  const chain = (name, parent, offset, step) => {
    const b = add(name, parent, ...offset),
      child = add(name + '_end', b, ...step)
    vertex(child, world(child))
    return b
  }
  const bip = add('bip001', root, 0, 0.62),
    pelvis = add('bip001_pelvis', bip)
  const spine = add('bip001_spine', pelvis, 0, 0.1)
  const chest = add('bip001_spine1', spine, 0, 0.09)
  let top = chest
  if (spine2) top = add('bip001_spine2', top, 0, 0.045)
  if (neck) top = add('bip001_neck', top, 0, 0.045)
  const head = add('bip001_head', top, 0, 0.1)
  for (const d of [V(1), V(-1), V(0, 1), V(0, -1), V(0, 0, 1), V(0, 0, -1)])
    vertex(head, world(head).add(V(0, 0.07)).addScaledVector(d, 0.132))
  tube(pelvis, 0.087, 0.1)
  tube(chest, 0.092, 0.045)
  for (const [side, sign] of [
    ['l', 1],
    ['r', -1],
  ]) {
    const prefix = 'bip001_' + side + '_'
    const thigh = add(prefix + 'thigh', pelvis, sign * 0.067, -0.055)
    const calf = add(prefix + 'calf', thigh, 0, -0.225)
    add(prefix + 'foot', calf, 0, -0.23)
    tube(thigh, 0.062, -0.225)
    tube(calf, 0.042, -0.23)
    const clavicle = add(prefix + 'clavicle', chest, sign * 0.07)
    const upper = add(prefix + 'upperarm', clavicle, sign * 0.1)
    const fore = add(prefix + 'forearm', upper, 0, -0.14)
    add(prefix + 'hand', fore, 0, -0.14)
    tube(upper, 0.039, -0.14)
    tube(fore, 0.028, -0.14)
    if (twists) {
      add(prefix + 'thigh_twist', thigh)
      add(prefix + 'upperarm_twist', upper)
      const helper = add(prefix + 'forearm_twist', fore)
      chain('bone_' + side.toUpperCase() + '_Sodetake_01', helper, [0, -0.03, 0.03], [0, -0.09, 0.04])
    }
  }
  // Put the poles between panels. Lift the left leg through the front-left panel.
  for (let i = 0; i < 8; i++) {
    const a = 0.36 + ((i / (arc === 360 ? 8 : 7)) * arc * Math.PI) / 180
    const radius = tightWaist && i % 2 === 0 ? 0.067 : 0.145
    const skirt = chain(
      'bone_skirt_' + i,
      pelvis,
      [radius * Math.sin(a), -0.018, radius * Math.cos(a)],
      [0, -skirtLink, 0],
    )
    for (let j = 0; j < 20; j++) vertex(skirt, world(skirt).add(V(0.25, -0.13, 0)), nodes.bip001_l_thigh)
    if (tightWaist) {
      const thigh = nodes[Math.sin(a) > 0 ? 'bip001_l_thigh' : 'bip001_r_thigh']
      vertex(skirt, world(thigh).add(V(0, -0.09, 0.028)))
    }
  }
  chain('bone_Wing_L_00', pelvis, [0.13, 0.02, -0.07], [0.04, -0.1, -0.04])
  chain('bone_hair_F_01', head, [0, 0.07, 0.15], [0, -0.08, 0.02])
  if (collisionLinks) {
    chain('hair_long', head, [0.32, 0.02, 0.1], [0, -0.48, 0])
    chain('ribbon_long', chest, [-0.32, 0.1, 0], [0, -0.42, 0])
  }
  if (longTips) chain('bone_hair_long', head, [0, -0.04, -0.2], [0.15, -1.05, -0.08])
  if (extras) {
    const jacket = chain('jacket_Root', chest, [0, -0.02, -0.11], [0.04, -0.13, -0.03])
    chain('jacket_panel_R', jacket, [-0.04, -0.1, 0], [0, -0.08, 0])
    chain('bone_Dress_Frill_F_00', chest, [0, -0.02, 0.13], [0, -0.09, 0.04])
    chain('bone_Dress_Frill_R_00', chest, [0.03, 0.04, 0], [0, 0.03, 0.01])
    chain('plain_panel', spine, [0.1, -0.02, 0], [0.02, -0.07, 0])
    chain('bone_Earring_R_00', head, [0.13, 0.02, 0], [0, -0.05, 0])
    chain('bone_tail', pelvis, [0, 0.02, -0.08], [0, -0.05, -0.09])
    for (const [name, parent] of [
      ['bip001_weapon', nodes.bip001_l_forearm],
      ['haloroot', head],
      ['bone_eye_L', head],
    ]) {
      const blocked = add(name, parent)
      chain('ribbon_' + name, blocked, [0, -0.03, 0.01], [0, -0.05, 0])
    }
    add('Point001', spine, 0, 0.06, 0, Object3D)
    add('hair_unused', head, 0, -0.1)
  }
  if (handWeapon) {
    const gun = add('bip001_weapon_l', nodes.bip001_l_hand)
    const surface = new BufferGeometry()
    surface.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0.2, 0.01, 0, 0], 3))
    const mesh = new Mesh(surface, new MeshBasicMaterial())
    mesh.name = 'Weapon_L'
    gun.add(mesh)
  }
  if (bikeHandle) {
    const handle = world(nodes.bip001_r_hand).add(V(0.02, 0.02, 0.012))
    const surface = new BufferGeometry()
    surface.setAttribute('position', new Float32BufferAttribute([...handle, ...handle.clone().setY(0)], 3))
    const bike = new Mesh(surface, new MeshBasicMaterial())
    bike.name = 'bike'
    root.add(bike)
  }
  if (accessories) {
    const twist = nodes.bip001_r_upperarm_twist
    chain('bone_sling_cuff', twist, [0, -0.02, 0.01], [0, -0.03, 0])
    const strap = add('bone_bag_string_01', twist, 0.025, -0.01, 0.03)
    strap.rotation.x = 0.23
    const bag = add('bone_bag', strap, 0.28, -0.21, 0)
    const buckle = add('bone_bag_acc', bag, 0, -0.025)
    // Geometry alone identifies this unnamed strap. The same-side leg pack
    // instead depends on its child's name. A torso case needs no virtual anchor.
    const strap2 = add('strap_root', twist, 0.02, -0.015)
    const panel = add('panel_end', strap2, 0.27, -0.22)
    const belt = add('belt_loop', nodes.bip001_l_thigh, 0.03, -0.02)
    const pouch = add('bone_hip_satchel_02', belt, 0.03, -0.09)
    const hardCase = add('bone_case', chest, 0.06, -0.03, -0.04)
    const latch = add('latch', hardCase, 0.02, -0.02)
    const rigidBones = [strap, bag, buckle, strap2, panel, belt, pouch, hardCase, latch]
    const points = [], ids = [], ws = []
    for (const joint of rigidBones) {
      for (const offset of [V(), V(0.012), V(0, 0.012)]) {
        points.push(...world(joint).add(offset))
        ids.push(bones.indexOf(joint), 0, 0, 0)
        ws.push(1, 0, 0, 0)
      }
    }
    const surface = new BufferGeometry()
    surface.setAttribute('position', new Float32BufferAttribute(points, 3))
    surface.setAttribute('skinIndex', new Uint16BufferAttribute(ids, 4))
    surface.setAttribute('skinWeight', new Float32BufferAttribute(ws, 4))
    const rigidMesh = new SkinnedMesh(surface, new MeshBasicMaterial())
    rigidMesh.name = 'CH0001_Body_Accessories'
    root.add(rigidMesh)
    root.updateMatrixWorld(true)
    rigidMesh.bind(new Skeleton(bones))
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geo.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4))
  geo.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
  const mesh = new SkinnedMesh(geo, new MeshBasicMaterial())
  mesh.name = 'CH0001_Body'
  root.add(mesh)
  root.updateMatrixWorld(true)
  mesh.bind(new Skeleton(bones))
  const model = new StudioModel(root, clips, 1)
  return { model, nodes }
}

const solverFor = (model, settings = defaultRig().spring, exclude = new Set()) =>
  new SpringBoneSolver(
    rigBones(model),
    model.rest,
    exclude,
    { ...settings, enabled: true },
    bodyColliders(model),
  )
const pose = (solver) => solver.particles.map((p) => [...p.bone.quaternion, ...p.current, ...p.previous])
const tip = (p) => p.tip.clone().applyMatrix4(p.bone.matrixWorld)
const separation = (p, shape) => {
  const t = Math.max(0, Math.min(1, p.clone().sub(shape.a).dot(shape.segment) * shape.inverseLengthSq))
  return p.distanceTo(shape.a.clone().addScaledVector(shape.segment, t)) - shape.radius
}
const anim = (name, axis, angle) =>
  new QuaternionKeyframeTrack(name + '.quaternion', [0, 1], [...identity, ...Q(axis, angle)])

const swing = new AnimationClip('Swing', 1, [
  anim('bip001_r_upperarm', V(0, 0, 1), 2 * Math.PI / 3),
  anim('bip001_l_upperarm', V(0, 0, 1), -2 * Math.PI / 3),
  anim('bip001_spine1', V(0, 1), 0.35),
  anim('bip001_l_thigh', V(1), 0.7),
])
const relative = (node, anchor) => anchor.matrixWorld.clone().invert().multiply(node.matrixWorld)
function nearMatrix(actual, expected) {
  actual.elements.forEach((value, i) => near(value, expected.elements[i]))
}

test('limb-carried accessories keep their torso bind frames through arm swing, grip IK and clearance', (t) => {
  const a = fixture({ twists: true, accessories: true })
  const b = fixture({ bikeHandle: true, clips: [swing] })
  const n = a.nodes
  const bindings = [
    [n.bone_bag_string_01, n.bip001_spine1],
    [n.bone_bag, n.bip001_spine1],
    [n.bone_bag_acc, n.bip001_spine1],
    [n.panel_end, n.bip001_spine1],
    [n.bone_hip_satchel_02, n.bip001_pelvis],
  ].map(([node, anchor]) => [node, anchor, relative(node, anchor)])
  const sleeve = n.bone_L_Sodetake_01
  const sleeveBind = relative(sleeve, sleeve.parent)
  // Construct the engine on a posed actor, so reading live matrices would fail.
  n.bip001_r_upperarm.rotation.x = 0.8
  const stage = new Group()
  stage.position.set(0.2, 0.37, -0.5)
  stage.rotation.set(0.12, 0.61, -0.34)
  stage.add(a.model.root, b.model.root)
  stage.updateMatrixWorld(true)
  const e = new RetargetEngine(a.model, b.model)
  t.after(() => { e.dispose(); a.model.dispose(); b.model.dispose() })
  e.setClip('Swing')
  let rightHandGripped = false, rightArmCleared = false
  for (const mirror of [false, true]) {
    stage.scale.set(mirror ? -1.4 : 1.4, 0.83, 1.12)
    const rig = { ...defaultRig(), armSpread: 18, mirror }
    for (const time of [0, 0.25, 0.4, 0.7, 1]) {
      e.sample(time, 0, rig, false, null, true)
      for (const [node, anchor, bind] of bindings) nearMatrix(relative(node, anchor), bind)
      nearMatrix(relative(sleeve, sleeve.parent), sleeveBind)
      e.finishCloth(null)
      for (const [node, anchor, bind] of bindings) nearMatrix(relative(node, anchor), bind)
      rightHandGripped ||= e.locked.r
      rightArmCleared ||= e.clearanceAngle.r > 0
    }
    e.reset()
    e.sample(0.4, 1 / 120, rig)
    const restore = e.checkpointSpring()
    e.reset()
    e.sample(0.4, 0, rig)
    restore()
    for (const [node, anchor, bind] of bindings) nearMatrix(relative(node, anchor), bind)
  }
  assert.ok(rightHandGripped, 'the bike handle engaged right-arm IK')
  assert.ok(rightArmCleared, 'the released right arm was abducted for torso clearance')
})

test('manual rotation offsets the torso anchor; mute and explicit source retain normal limb binding', (t) => {
  const a = fixture({ twists: true, accessories: true }), b = fixture({ clips: [swing] })
  const e = new RetargetEngine(a.model, b.model), rig = { ...defaultRig(), antiClip: false }
  t.after(() => { e.dispose(); a.model.dispose(); b.model.dispose() })
  const strap = a.nodes.bone_bag_string_01, bag = a.nodes.bone_bag, spine = a.nodes.bip001_spine1
  const bind = relative(strap, spine), local = strap.matrix.clone(), bagLocal = bag.matrix.clone()
  e.setClip('Swing')
  const sample = (override) => e.sample(1, 0, { ...rig, overrides: { [strap.name]: override } })
  const rotated = bind.clone().multiply(new Matrix4().makeRotationY(Math.PI / 6))
  for (let i = 0; i < 2; i++) {
    sample({ rotation: [0, 30, 0] })
    nearMatrix(relative(strap, spine), rotated)
    nearMatrix(relative(bag, spine), rotated.clone().multiply(bagLocal))
  }
  sample({ muted: true, rotation: [0, 30, 0] })
  nearMatrix(strap.matrix, local)
  sample({ source: 'bip001_l_upperarm' })
  near(strap.position.distanceTo(a.model.rest.get(strap).restLocalPos), 0)
  const source = b.nodes.bip001_l_upperarm.getWorldQuaternion(new Quaternion())
  near(strap.getWorldQuaternion(new Quaternion()).angleTo(source.multiply(a.model.rest.get(strap).restWorldQuat)), 0)
})

test('free-arm clearance preserves authored twist as a torso strap compensates for the swing', (t) => {
  const clip = new AnimationClip('Reach', 1, [
    anim('bip001_r_upperarm', V(0, 0, 1), 0.6),
    anim('bip001_r_upperarm_twist', V(0, 1), 1.1),
  ])
  const a = fixture({ accessories: true, twists: true }), b = fixture({ twists: true, clips: [clip] })
  const e = new RetargetEngine(a.model, b.model), rig = defaultRig()
  t.after(() => { e.dispose(); a.model.dispose(); b.model.dispose() })
  e.setClip('Reach')
  const strap = a.nodes.bone_bag_string_01, previous = new Quaternion()
  let active = false
  for (let i = 0; i <= 60; i++) {
    e.sample(i / 60, i ? 1 / 60 : 0, rig)
    near(a.nodes.bip001_r_upperarm_twist.quaternion.angleTo(b.nodes.bip001_r_upperarm_twist.quaternion), 0)
    if (i) assert.ok(strap.quaternion.angleTo(previous) < 12 * Math.PI / 180)
    previous.copy(strap.quaternion)
    active ||= e.clearanceAngle.r > 0
  }
  assert.ok(active)
})

test('rigid accessory skin is absent from spring particles and fine cloth while sleeves remain movable', (t) => {
  const { model, nodes } = fixture({ twists: true, accessories: true, extras: true })
  t.after(() => model.dispose())
  const solver = solverFor(model)
  const particles = new Set(solver.particles.map(p => p.bone))
  const rigidMesh = model.bodyMeshes.find(m => m.name === 'CH0001_Body_Accessories')
  assert.ok(rigidMesh)
  const ids = rigidMesh.geometry.getAttribute('skinIndex')
  for (let i = 0; i < ids.count; i++) {
    const bone = rigidMesh.skeleton.bones[ids.getX(i)]
    assert.ok(!particles.has(bone), bone.name)
  }
  for (const bone of [nodes.bone_L_Sodetake_01, nodes.bone_sling_cuff, nodes.plain_panel])
    assert.ok(particles.has(bone), bone.name)
  const fine = buildFineClothMesh(model, bodyColliders(model))
  assert.ok(fine.nodes.some(n => n.mobility > 0))
  assert.ok(fine.meshes.every(m => m.mesh !== rigidMesh))
})

test('native playback preserves the authored bag translation and rotation with dynamics on or off', (t) => {
  const name = 'bone_bag_string_01'
  const endpoint = V(-0.07, 0.12, 0.06)
  const authored = new AnimationClip('Native', 1, [
    swing.tracks[0],
    new VectorKeyframeTrack(name + '.position', [0, 1], [0, 0, 0, ...endpoint]),
    anim(name, V(0, 1), 165 * Math.PI / 180),
  ])
  const a = fixture({ twists: true, accessories: true, clips: [authored] })
  const e = new RetargetEngine(a.model), strap = a.nodes[name]
  t.after(() => { e.dispose(); a.model.dispose() })
  e.setClip('Native')
  for (const enabled of [false, true]) {
    const rig = defaultRig()
    rig.spring.enabled = enabled
    for (const time of [0, 0.25, 0.6, 1]) {
      e.sample(time, 1 / 60, rig)
      near(strap.position.distanceTo(endpoint.clone().multiplyScalar(time)), 0)
      near(strap.quaternion.clone().normalize().angleTo(Q(V(0, 1), time * 165 * Math.PI / 180)), 0)
    }
  }
})

test('dominant skin weights fit anatomical caps and head centroid, with a transformed slot floor', () => {
  const { model, nodes } = fixture()
  const fit = new BodyColliders(model)
  assert.equal(fit.shapes.length, 11)
  for (const [name, radius] of Object.entries({
    head: 0.132,
    pelvis: 0.087,
    spine: 0.092,
    l_thigh: 0.062,
    r_thigh: 0.062,
    l_calf: 0.042,
    l_upperarm: 0.039,
    l_forearm: 0.028,
  })) {
    const shape = fit.shapes.find((s) => s.start === nodes['bip001_' + name])
    near(shape.radius, radius)
    const p = shape.a.clone().lerp(shape.b, 0.5),
      n = V()
    assert.ok(fit.resolvePoint(p, 0.005, shape.group, n))
    assert.ok(separation(p, shape) >= 0.005 - 1e-6)
    near(n.length(), 1)
  }
  near(fit.shapes[0].a.y - world(nodes.bip001_head).y, 0.07)
  const thigh = fit.shapes.find((s) => s.start === nodes.bip001_l_thigh)
  near(thigh.a.distanceTo(world(nodes.bip001_l_thigh).lerp(world(nodes.bip001_l_calf), 0.16)), 0)
  assert.equal(collisionMasks.skirt & ColliderGroup.torso, 0)
  const slot = new Group()
  slot.position.set(0.1, 0.7, -0.2)
  slot.rotation.z = 0.35
  slot.scale.setScalar(1.6)
  slot.add(model.root)
  fit.update()
  near(thigh.a.distanceTo(world(nodes.bip001_l_thigh).lerp(world(nodes.bip001_l_calf), 0.16)), 0)
  near(fit.shapes[0].radius, 0.132 * 1.6)
  const p = slot.localToWorld(V(0.35, -0.12, 0.42)),
    normal = V()
  assert.ok(fit.resolvePoint(p, 0.016, ColliderGroup.floor, normal))
  near(slot.worldToLocal(p).y, 0.01)
  near(normal.dot(fit.up), 1)
  assert.equal(collisionMasks.wing, ColliderGroup.torso | ColliderGroup.floor)
  model.dispose()
})

test('authored waist overlap at tips and skin probes stays neutral, including a solver rebuilt mid-clip', () => {
  const { model, nodes } = fixture({ tightWaist: true })
  const fit = bodyColliders(model)
  const thighs = fit.shapes.filter((s) => s.group === ColliderGroup.thigh)
  const solver = solverFor(model)
  const skirt = solver.particles.filter((p) => p.material === 'skirt')
  assert.ok(skirt.some((p) => thighs.some((s) => separation(tip(p), s) < -0.002)))
  assert.ok(
    skirt.some((p) =>
      p.probes?.some(({ local }) =>
        thighs.some((s) => separation(local.clone().applyMatrix4(p.bone.matrixWorld), s) < -0.002),
      ),
    ),
  )

  for (const stageScale of [1, 1.6]) {
    const stage = new Group()
    stage.position.set(0.4, 0.7, -0.1)
    stage.rotation.z = 0.3
    stage.scale.setScalar(stageScale)
    stage.add(model.root)
    nodes.bip001_l_thigh.rotation.x = -0.8
    fit.update()
    const rebuilt = solverFor(model)
    nodes.bip001_l_thigh.rotation.x = 0
    rebuilt.solveStaticCollisions()
    for (const p of rebuilt.particles) {
      near((p.swing.angleTo(identity) * 180) / Math.PI, 0, 0.0001)
      near(tip(p).distanceTo(stage.localToWorld(p.restTip.clone())), 0, 1e-6)
    }
    rebuilt.restore()
  }
  model.dispose()
})

test('skin probe deflection grows continuously through shallow thigh contact', () => {
  const { model, nodes } = fixture({ tightWaist: true })
  const bone = nodes.bone_skirt_1
  const excluded = new Set(
    Object.values(nodes).filter((n) => n.name.startsWith('bone_skirt_') && n !== bone && n.parent !== bone),
  )
  const solver = solverFor(model, defaultRig().spring, excluded)
  const panel = solver.particles.find((p) => p.bone === bone)
  const thigh = solver.colliders.shapes.find((s) => s.start === nodes.bip001_l_thigh)
  const start = tip(panel)
  let previous = 0
  for (let i = 0; i <= 100; i++) {
    const advance = i * 0.0001
    nodes.bip001_l_thigh.position.z = advance
    solver.solveStaticCollisions()
    assert.ok(separation(start, thigh) > 0.004, 'tip never contacts the thigh')
    const deflection = tip(panel).distanceTo(start)
    assert.ok(
      deflection >= previous - 1e-7 && deflection - previous < 0.0003,
      `advance=${advance}, previous=${previous}, now=${deflection}`,
    )
    previous = deflection
    if (i === 100) {
      assert.ok(tip(panel).distanceTo(start) > 0.001, 'the skin probe bends the panel')
      assert.ok(tip(panel).z > start.z && tip(panel).y < world(bone).y)
      assert.ok(panel.swing.angleTo(identity) < (42 * Math.PI) / 180)
    }
  }
  model.dispose()
})

test('a knee cap directly under a short waist joint cannot fold the skirt up', () => {
  const { model, nodes } = fixture({ skirtLink: 0.02 })
  const solver = solverFor(model)
  const panel = solver.particles.find((p) => p.bone === nodes.bone_skirt_0)
  const bindTip = tip(panel)
  // Bring the top of the shortened thigh capsule just under the authored tip.
  const thigh = nodes.bip001_l_thigh
  thigh.position.copy(thigh.parent.worldToLocal(bindTip.clone()))
  thigh.position.y += 0.225 * 0.16 - 0.001
  solver.solveStaticCollisions()
  const bent = (panel.swing.angleTo(identity) * 180) / Math.PI
  assert.ok(bent > 35 && bent < 42, `waist cap under direct contact: ${bent}°`)
  const origin = world(panel.bone)
  const outward = origin.clone().sub(world(nodes.bip001_pelvis)).setY(0)
  assert.ok(tip(panel).sub(bindTip).dot(outward) > 0)
  for (const p of solver.particles.filter((p) => p.material === 'skirt' && !p.depth))
    assert.ok(tip(p).y < world(p.bone).y)
  model.dispose()
})

test('weighted branches under body and twist helpers are classified; open arcs retain the largest gap', () => {
  const { model, nodes } = fixture({ twists: true, extras: true, arc: 155 })
  const solver = solverFor(model, defaultRig().spring, new Set([nodes.bone_tail]))
  const byName = new Map(solver.particles.map((p) => [p.bone.name, p]))
  for (const [name, kind] of Object.entries({
    jacket_Root: 'skirt',
    bone_Dress_Frill_F_00: 'skirt',
    bone_Dress_Frill_R_00: 'cloth',
    bone_L_Sodetake_01: 'cloth',
    plain_panel: 'cloth',
    bone_Earring_R_00: 'hair',
    bone_Wing_L_00: 'wing',
  }))
    assert.equal(byName.get(name)?.material, kind, name)
  for (const name of [
    'bone_tail',
    'hair_unused',
    'Point001',
    'ribbon_bip001_weapon',
    'ribbon_haloroot',
    'ribbon_bone_eye_L',
  ])
    assert.ok(!byName.has(name), name)
  assert.ok(byName.get('bone_hair_F_01').bangs)
  assert.ok(byName.get('bone_skirt_0').stiffnessScale > byName.get('bone_skirt_0_end').stiffnessScale)
  assert.ok(byName.get('jacket_Root').attachment)
  solver.solveStaticCollisions()
  assert.ok(nodes.jacket_Root.quaternion.equals(model.rest.get(nodes.jacket_Root).restLocalQuat))
  assert.ok(
    solver.edges.every(({ a, b }) => a.material === 'skirt' && b.material === 'skirt' && a.hub === b.hub),
  )
  const pelvisRings = solver.rings.filter((r) => r.particles[0].hub === nodes.bip001_pelvis)
  assert.equal(pelvisRings.length, 2)
  assert.equal(solver.edges.filter((edge) => edge.a.hub === nodes.bip001_pelvis).length, 14)
  for (const ring of pelvisRings) {
    assert.equal(ring.closed, false)
    assert.ok(ring.particles.every((p) => p.material === 'skirt' && p.hub === nodes.bip001_pelvis))
  }
  model.dispose()
})

for (const dynamic of [false, true])
  test(
    'raised thigh clears a panel and deflects adjacent panels: ' +
      (dynamic ? 'fixed-step dynamics' : 'paused cross-character anti-clip'),
    () => {
      const clip = new AnimationClip('Lift', 1, [anim('bip001_l_thigh', V(1), -0.79)])
      const { model: actor } = fixture()
      const { model: driver } = fixture({ clips: [clip] })
      const engine = new RetargetEngine(actor, driver)
      engine.setClip('Lift')
      const rig = defaultRig()
      rig.spring.gravity = 0
      engine.sample(1, 0, { ...rig, antiClip: false })
      const solver = engine.spring
      const panel = solver.particles.find((p) => p.bone.name === 'bone_skirt_0')
      const neighbor = solver.particles.find((p) => p.bone.name === 'bone_skirt_7')
      const initial = tip(panel),
        nearStart = tip(neighbor)
      const thigh = engine.colliders.shapes.find((s) => s.start.name === 'bip001_l_thigh')
      engine.colliders.update()
      assert.ok(separation(initial, thigh) < -0.025)
      rig.spring.enabled = dynamic
      engine.sample(1, dynamic ? 1 / 60 : 0, rig)
      assert.ok(separation(tip(panel), thigh) >= 0.0039, 'geometric tip stays outside the posed thigh')
      const waist = solver.particles.filter((p) => p.material === 'skirt' && !p.depth)
      assert.ok(
        waist.every((p) => tip(p).y < world(p.bone).y && p.swing.angleTo(identity) < (42 * Math.PI) / 180),
      )
      assert.ok(tip(neighbor).distanceTo(nearStart) > 0.00025, 'neighbor moves')
      assert.equal(solver.rings[0].closed, true)
      if (!dynamic) {
        const saved = pose(solver)
        for (let i = 0; i < 10; i++) engine.sample(1, 0, rig)
        assert.deepEqual(pose(solver), saved)
      }
      const connected = tip(neighbor)
      // Same contacts and pose with the lateral constraints removed isolate ring coupling.
      solver.edges.length = 0
      engine.reset()
      engine.sample(1, dynamic ? 1 / 60 : 0, rig)
      assert.ok(tip(neighbor).distanceTo(connected) > 0.00025, 'deflection comes from the ring')
      if (!dynamic) {
        engine.sample(1, 0, { ...rig, antiClip: false })
        near(tip(panel).distanceTo(initial), 0)
      }
      engine.dispose()
      actor.dispose()
      driver.dispose()
    },
  )

// Keep the full model assets external. Point CLOTH_MODEL_DIR at the original
// named GLBs to run these same frame and skin checks in the normal test suite.
for (const [actor, panels] of [
  ['Hina (Dress)', 8],
  ['Aru', 6],
]) {
  test(
    `${actor} ← Mika keeps its authored skirt and clears real thigh intrusions`,
    {
      skip: process.env.CLOTH_MODEL_DIR ? false : 'set CLOTH_MODEL_DIR to the external GLB directory',
    },
    async () => {
      const { checkCloth } = await import('../scripts/check-cloth.mjs')
      const file = (name) => join(process.env.CLOTH_MODEL_DIR, name + '.glb')
      const [report] = await checkCloth(file('Mika'), [file(actor)], null)
      assert.ok(report.bindDeg < 0.001)
      for (const clip of ['Victory_Start', 'Cafe_Walk']) {
        const row = report.results.find((r) => r.clip === clip && r.mode === 'antiClip')
        assert.ok(row.highestMeanDy < 0 && row.maxRootDeg < 42)
        if (clip === 'Victory_Start') assert.equal(row.at233.downwardRoots, panels)
        if (row.reduction !== null) assert.ok(row.reduction >= 20)
        else assert.equal(row.contacts, 0)
      }
    },
  )
}

test('long hair and skirt tips stay above the local floor in both modes', () => {
  const { model } = fixture({ longTips: true })
  const solver = solverFor(model)
  const hair = solver.particles.filter((p) => p.chain.name === 'bone_hair_long' || p.material === 'skirt')
  assert.ok(tip(hair[0]).y < 0)
  solver.solveStaticCollisions()
  for (const p of hair) assert.ok(tip(p).y >= -1e-7)
  for (let i = 0; i < 30; i++) {
    solver.step(1 / 60)
    for (const p of hair) assert.ok(tip(p).y >= -1e-7, `frame ${i}: ${p.bone.name} at ${tip(p).y}`)
  }
  model.dispose()
})

test('a floor-resting skirt panel settles under sideways ring tension at 120 Hz', (t) => {
  const { model, nodes } = fixture()
  t.after(() => model.dispose())
  const solver = solverFor(model)
  const hem = solver.rings.flatMap((r) => r.particles).find((p) => p.bone === nodes.bone_skirt_0_end)
  // Lower and offset one hem so its neighbors pull across the floor at the cone limit.
  nodes.bip001.position.y = 0.33
  hem.bone.position.set(0.06, -0.205, 0)
  hem.bone.rotation.x = -0.4
  solver.step(0)
  let previous = tip(hem), previousMove = V()
  for (let step = 0; step < 120; step++) {
    solver.step(1 / 120)
    const point = tip(hem), move = point.clone().sub(previous)
    assert.ok(point.y >= 0.004 - 1e-7, `hem below the contact plane at step ${step}`)
    if (move.length() > 0.005 && previousMove.length() > 0.005)
      assert.ok(move.dot(previousMove) >= 0, `hem reversed at step ${step}`)
    if (step >= 90) {
      near(point.y, 0.004, 1e-7)
      assert.ok(move.length() < 1e-5, 'hem settles on the floor')
    }
    previous = point
    previousMove = move
  }
})

test('longitudinal twist is rest-relative; a missing upper spine and neck contribute their bend', () => {
  const down = V(0, -1)
  const tracks = ['hand', 'upperarm', 'thigh'].map((limb) => anim('bip001_l_' + limb, down, 0.8))
  tracks.push(anim('bip001_spine2', V(1), 0.6))
  const clip = new AnimationClip('Roll', 1, tracks)
  const { model: driver } = fixture({ spine2: true, clips: [clip] })
  const { model, nodes } = fixture({ twists: true, neck: false })
  const engine = new RetargetEngine(model, driver),
    rig = defaultRig()
  engine.setClip('Roll')
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    engine.sample(t, 0, rig)
    for (const [limb, weight] of [
      ['forearm', 0.55],
      ['upperarm', 0.5],
      ['thigh', 0.45],
    ])
      near(nodes['bip001_l_' + limb + '_twist'].quaternion.angleTo(Q(down, t * 0.8 * weight)), 0)
    near(nodes.bip001_spine1.quaternion.angleTo(Q(V(1), (0.65 + 0.35 * 0.35) * 0.6 * t)), 0)
  }
  engine.sample(1, 0, {
    ...rig,
    overrides: { bip001_l_forearm_twist: { muted: true }, bip001_l_thigh_twist: { rotation: [10, 0, 0] } },
  })
  near(nodes.bip001_l_forearm_twist.quaternion.angleTo(identity), 0)
  near(nodes.bip001_l_thigh_twist.quaternion.angleTo(Q(V(1), Math.PI / 18)), 0)
  engine.dispose()
  model.dispose()
  driver.dispose()
})

test('arm clearance rotates both complete arms about slot forward, native direct preserves authored motion', () => {
  const clip = new AnimationClip('Native', 1, [anim('bone_skirt_0', V(1), 0.4)])
  const { model, nodes } = fixture({ clips: [clip] })
  const slot = new Group()
  slot.rotation.y = 0.8
  slot.add(model.root)
  const engine = new RetargetEngine(model),
    rig = defaultRig()
  engine.setClip('Native')
  const localX = (node) => slot.worldToLocal(world(node)).x
  engine.sample(1, 0, rig)
  const left = localX(nodes.bip001_l_hand),
    right = localX(nodes.bip001_r_hand)
  near(nodes.bone_skirt_0.quaternion.angleTo(Q(V(1), 0.4)), 0)
  engine.sample(1, 0, { ...rig, armSpread: 18 })
  near(localX(nodes.bip001_l_hand) - left, 0.28 * Math.sin(Math.PI / 10))
  near(right - localX(nodes.bip001_r_hand), 0.28 * Math.sin(Math.PI / 10))
  engine.sample(1, 0, rig)
  near(localX(nodes.bip001_l_hand), left)
  near(nodes.bone_skirt_0.quaternion.angleTo(Q(V(1), 0.4)), 0)
  engine.dispose()
  model.dispose()
})

test('wind is fixed-step deterministic across frame rates, pause, checkpoint replay and reset', () => {
  const { model } = fixture()
  const solver = solverFor(model, { ...defaultRig().spring, gravity: 0, wind: 0.85 })
  const run = (n, dt) => {
    for (let i = 0; i < n; i++) solver.step(dt)
    return pose(solver)
  }
  const first = run(60, 1 / 60),
    checkpoint = solver.checkpoint()
  assert.deepEqual(run(25, 0), first)
  const later = run(12, 1 / 60)
  checkpoint()
  assert.deepEqual(run(24, 1 / 120), later)
  solver.reset()
  assert.deepEqual(run(120, 1 / 120), first)
  solver.reset()
  solver.settings = { ...solver.settings, wind: 0 }
  assert.notDeepEqual(run(60, 1 / 60), first)
  solver.restore()
  for (const p of solver.particles) assert.ok(p.bone.quaternion.equals(model.rest.get(p.bone).restLocalQuat))
  model.dispose()
})

test('capture pre-roll advances cloth for a quarter second at the actual trim start', () => {
  const store = useStudioStore.getState()
  const slots = store.slots
  const slot = slots[0]
  let resets = 0
  const samples = [],
    entry = { engine: { reset: () => resets++ }, lastTime: 8 }
  const scene = { slots: new Map([[slot.id, entry]]), samplePose: (...args) => samples.push(args) }
  try {
    useStudioStore.setState({
      slots: [{ ...slot, rig: { ...slot.rig, spring: { ...slot.rig.spring, enabled: true } } }],
    })
    SceneManager.prototype.resetCapturePose.call(scene, 1.75)
    assert.equal(resets, 1)
    assert.equal(entry.lastTime, undefined)
    assert.deepEqual(
      samples,
      Array.from({ length: 15 }, () => [1.75, 1 / 60, false, true]),
    )
    samples.length = 0
    useStudioStore.setState({ slots })
    SceneManager.prototype.resetCapturePose.call(scene, 1.75)
    assert.equal(samples.length, 0)
  } finally {
    useStudioStore.setState({ slots })
  }
})

test('root tuning exposes physics sliders only with springs enabled in all four languages', () => {
  assert.equal(defaultRig().antiClip, true)
  assert.equal(defaultRig().spring.enabled, false)
  for (const lang of languages) {
    assertAdjustInspector(lang, false)
    assertAdjustInspector(lang, true)
  }
})

test('mid-link contact clears a forearm and torso while both tips already have clearance', () => {
  for (const [name, obstacle] of [
    ['hair_long', 'bip001_l_forearm'],
    ['ribbon_long', 'bip001_pelvis'],
  ]) {
    const { model, nodes } = fixture({ collisionLinks: true })
    const solver = solverFor(model)
    const p = solver.particles.find((p) => p.bone.name === name)
    const shape = solver.colliders.shapes.find((s) => s.start === nodes[obstacle])
    solver.solveStaticCollisions()
    near(p.swing.angleTo(identity), 0, (0.001 * Math.PI) / 180)
    const midpoint = () => world(p.bone).lerp(tip(p), 0.5)
    if (obstacle.endsWith('forearm')) {
      const newElbow = midpoint().add(V(-0.01, 0.07, 0))
      nodes[obstacle].position.copy(nodes[obstacle].parent.worldToLocal(newElbow))
    } else {
      // Pose the ribbon into the fixed torso; the short test link spans both ends of the capsule.
      const center = shape.a
        .clone()
        .lerp(shape.b, 0.5)
        .add(V(-0.018, 0, 0))
      const newOrigin = center.sub(midpoint()).add(world(p.bone))
      p.bone.position.copy(p.bone.parent.worldToLocal(newOrigin))
    }
    solver.colliders.update()
    assert.ok(separation(midpoint(), shape) < -0.012)
    assert.ok(separation(tip(p), shape) > 0.004)
    solver.solveStaticCollisions()
    assert.ok(separation(midpoint(), shape) > 0.0038, name + ' midpoint clears')
    near(world(p.bone).distanceTo(tip(p)), p.tip.length())
    model.dispose()
  }
})

test('wide panel probes clear an isolated calf intersection', () => {
  const limb = 'calf'
  const { model, nodes } = fixture()
  const bone = nodes.bone_skirt_0
  const others = new Set(
    Object.values(nodes).filter((n) => n.name.includes('skirt') && n !== bone && n.parent !== bone),
  )
  const solver = solverFor(model, defaultRig().spring, others)
  const p = solver.particles.find((p) => p.bone === bone)
  const local = p.probes[0].local
  const probe = () => local.clone().applyMatrix4(bone.matrixWorld)
  const joint = nodes['bip001_l_' + limb]
  const shape = solver.colliders.shapes.find((s) => s.start === joint)
  joint.position.copy(joint.parent.worldToLocal(probe().add(V(-0.018, 0.05, 0))))
  solver.colliders.update()
  assert.ok(separation(probe(), shape) < -0.009)
  assert.ok(separation(tip(p), shape) > 0.1)
  assert.ok(separation(world(bone).lerp(tip(p), 0.5), shape) > 0.1)
  solver.solveStaticCollisions()
  assert.ok(separation(probe(), shape) >= 0.003, limb + ' clears the panel surface')
  model.dispose()
})

test('hanging and swinging arms crossing short waist panels produce zero skirt snaps', () => {
  for (const dynamic of [false, true]) {
    const { model, nodes } = fixture({ skirtLink: 0.021 })
    const solver = solverFor(model, { ...defaultRig().spring, gravity: 0 })
    const skirt = solver.particles.filter((p) => p.material === 'skirt')
    const panel = skirt.find((p) => p.bone === nodes.bone_skirt_0)
    const forearm = nodes.bip001_l_forearm
    const cap = solver.colliders.shapes.find((s) => s.start === forearm)
    const center = forearm.parent.worldToLocal(tip(panel))
    let inside = 0,
      outside = 0
    const prev = skirt.map(() => identity.clone())
    for (let i = 0; i < 120; i++) {
      forearm.position.copy(center).x += 0.075 * Math.sin(i * 0.13)
      forearm.rotation.z = 0.25 * Math.cos(i * 0.13)
      if (dynamic) solver.step(1 / 60)
      else solver.solveStaticCollisions()
      if (separation(tip(panel), cap) < 0) inside++
      else outside++
      skirt.forEach((p, j) => {
        assert.ok(prev[j].angleTo(p.bone.quaternion) < 1e-6)
        prev[j].copy(p.bone.quaternion)
      })
    }
    assert.ok(inside && outside)
    model.dispose()
  }
})

test('a discontinuous root translation carries the skirt and preserves bounded local inertia on replay', () => {
  const { model } = fixture({ skirtLink: 0.021 })
  const solver = solverFor(model)
  solver.step(1 / 60)
  const restore = solver.checkpoint()
  const skirts = solver.particles.filter((p) => p.material === 'skirt')
  const before = skirts.map((p) => p.bone.quaternion.clone())
  model.root.position.x = 3
  solver.step(1 / 60)
  const first = pose(solver)
  skirts.forEach((p, i) => {
    assert.ok(p.bone.quaternion.angleTo(before[i]) < (9 * Math.PI) / 180)
    assert.ok(p.current.distanceTo(p.previous) <= 0.012 * p.scale + 1e-9)
    near(tip(p).distanceTo(p.current), 0, 1e-7)
  })
  model.root.position.x = 0
  restore()
  model.root.position.x = 3
  solver.step(1 / 60)
  assert.deepEqual(pose(solver), first)
  model.dispose()
})

test('an 85 degree knee opens only the contacted skirt cone', () => {
  const { nodes, model } = fixture({ skirtLink: 0.068 })
  const solver = solverFor(model)
  const front = solver.particles.find((p) => p.bone === nodes.bone_skirt_0)
  const thigh = nodes.bip001_l_thigh,
    calf = nodes.bip001_l_calf
  const knee = world(front.bone).add(V(0, -0.07, -0.009))
  thigh.rotation.x = (-85 * Math.PI) / 180
  calf.rotation.x = -thigh.rotation.x
  thigh.position.add(knee.sub(world(calf)))
  solver.solveStaticCollisions()
  const shape = solver.colliders.shapes.find((s) => s.start === thigh)
  near((front.contactLegElevation * 180) / Math.PI, 85)
  const angle = (front.swing.angleTo(identity) * 180) / Math.PI
  assert.ok(angle > 45 && angle <= 76.001, String(angle))
  assert.ok(separation(tip(front), shape) >= 0.0038)
  const other = solver.particles.filter((p) => p.material === 'skirt' && !p.depth && !p.contactLegElevation)
  assert.ok(other.length >= 4)
  for (const panel of other) {
    assert.ok((panel.swing.angleTo(identity) * 180) / Math.PI < 42)
    assert.ok(tip(panel).y < world(panel.bone).y)
  }
  model.dispose()
})

test('pooled weapon capsules deflect front hair and clear without leaving a bind correction', () => {
  const { model, nodes } = fixture()
  const solver = solverFor(model),
    colliders = solver.colliders
  const p = solver.particles.find((p) => p.bone === nodes.bone_hair_F_01)
  const rest = tip(p),
    bodyCount = colliders.shapes.length
  const capsule = {
    a: rest.clone().add(V(-0.08, 0, -0.016)),
    b: rest.clone().add(V(0.08, 0, -0.016)),
    radius: 0.025,
  }
  colliders.setDynamicCapsules([capsule])
  const slot = colliders.shapes[bodyCount]
  assert.equal(colliders.bindRadii(rest, 0.004, collisionMasks.hair).length, bodyCount)
  solver.solveStaticCollisions()
  assert.ok(tip(p).z > rest.z + 0.012)
  assert.ok(separation(tip(p), slot) > 0.0039)
  assert.equal(collisionMasks.skirt & ColliderGroup.weapon, 0)
  colliders.setDynamicCapsules([])
  solver.solveStaticCollisions()
  near(p.swing.angleTo(identity), 0, (0.001 * Math.PI) / 180)
  colliders.setDynamicCapsules([capsule])
  assert.equal(colliders.shapes[bodyCount], slot)
  model.dispose()
})

test('pose-relative gravity preserves upright bangs and wings and pulls tilted links toward world down', () => {
  const { model, nodes } = fixture({ collisionLinks: true })
  // Isolate gravity from body collisions and from inherited simulated joints.
  const solver = new SpringBoneSolver(rigBones(model), model.rest, new Set(), {
    ...defaultRig().spring,
    enabled: true,
    gravity: 8,
  })
  const roots = solver.particles.filter((p) =>
    ['hair_long', 'bone_hair_F_01', 'bone_Wing_L_00'].includes(p.bone.name),
  )
  const run = () => {
    for (let i = 0; i < 60; i++) solver.step(1 / 60)
  }
  run()
  for (const p of roots) {
    near(p.gravityFactor, p.bangs || p.material === 'wing' ? 0 : 0.15)
    near(p.swing.angleTo(identity), 0)
  }
  solver.reset()
  nodes.bip001.rotation.x = Math.PI / 2
  model.root.updateMatrixWorld(true)
  const starts = roots.map(tip)
  run()
  for (const [i, p] of roots.entries()) {
    near(p.gravityFactor, p.bangs || p.material === 'wing' ? 0.25 : 1)
    assert.ok(tip(p).y < starts[i].y - 0.0001, p.bone.name)
  }
  model.dispose()
})

test('rotating wind rotates the gust and flutter, with the same fixed-step trajectory', () => {
  const { model, nodes } = fixture({ collisionLinks: true })
  const solver = new SpringBoneSolver(rigBones(model), model.rest, new Set(), {
    ...defaultRig().spring,
    enabled: true,
    gravity: 0,
    wind: 1,
  })
  const p = solver.particles.find((p) => p.bone === nodes.hair_long)
  const run = (angle, steps) => {
    solver.reset()
    solver.settings.windAngle = angle
    for (let i = 0; i < steps; i++) solver.step(1 / steps)
    return tip(p).sub(p.restTip)
  }
  const x = run(0, 60),
    z = run(90, 60)
  assert.ok(x.x > 0.0005)
  near(x.x, z.z)
  near(x.z, -z.x)
  assert.deepEqual(run(90, 120).toArray(), z.toArray())
  model.dispose()
})

test('two-hop skirt bending relaxes the second neighbor and leaves the open gap uncoupled', () => {
  for (const arc of [155, 360]) {
    const { model } = fixture({ arc })
    const solver = solverFor(model)
    const ring = solver.rings[0],
      edges = solver.bendingEdges.filter((e) => e.a.depth === 0)
    assert.equal(edges.length, ring.particles.length - (ring.closed ? 0 : 2))
    for (const [i, edge] of edges.entries()) {
      assert.equal(edge.a, ring.particles[i])
      assert.equal(edge.b, ring.particles[(i + 2) % ring.particles.length])
      assert.ok(edge.bending)
    }
    const { a, b, restLength } = edges[0]
    a.next.copy(a.restTip).add(V(0, 0.14, 0))
    b.next.copy(b.restTip)
    const before = a.next.distanceTo(b.next)
    solver.relax(edges[0])
    const after = a.next.distanceTo(b.next)
    assert.ok(after < before && after > restLength)
    assert.ok(b.next.y > b.restTip.y)
    near((before - after) / (before - restLength), 2 / (2 + 0.0018 * 120 ** 2))
    model.dispose()
  }
})

test('free arm abduction clears the torso, respects overrides and leaves a held wrist fixed', () => {
  const clip = new AnimationClip('CrossBody', 1, [anim('bip001_l_upperarm', V(0, 0, 1), -0.5)])
  const a = fixture({ handWeapon: true }),
    b = fixture({ handWeapon: true, clips: [clip] })
  const engine = new RetargetEngine(a.model, b.model),
    rig = defaultRig()
  const stage = new Group()
  stage.rotation.y = 0.53
  stage.scale.setScalar(1.4)
  stage.add(a.model.root, b.model.root)
  engine.setClip('CrossBody')
  const upper = a.nodes.bip001_l_upperarm,
    hand = a.nodes.bip001_l_hand,
    fore = a.nodes.bip001_l_forearm
  const depth = () => {
    const bind = a.model.rest.get(hand).restWorldPos
    const radii = engine.colliders.bindRadii(bind, 0.022, ColliderGroup.torso)
    const mid = engine.colliders.bindRadii(
      bind.clone().lerp(a.model.rest.get(fore).restWorldPos, 0.5),
      0.028,
      ColliderGroup.torso,
    )
    engine.colliders.update()
    return (
      Math.max(
        engine.colliders.torsoDepth(world(hand), 0.022 * 1.4, radii),
        engine.colliders.torsoDepth(world(hand).lerp(world(fore), 0.5), 0.028 * 1.4, mid),
      ) / 1.4
    )
  }
  engine.sample(0, 0, rig, false, null)
  near(upper.quaternion.angleTo(identity), 0, (0.001 * Math.PI) / 180)
  engine.sample(1, 0, { ...rig, antiClip: false }, false, null)
  const raw = upper.quaternion.clone(),
    wrist = world(hand)
  assert.ok(depth() > 0.012)
  engine.sample(1, 0, rig, false, null)
  const correction = (upper.quaternion.angleTo(raw) * 180) / Math.PI
  assert.ok(correction > 0.5 && correction <= 14.001)
  assert.ok(depth() <= 0.00401)
  engine.sample(1, 0, { ...rig, overrides: { [fore.name]: { muted: true } } }, false, null)
  near(world(hand).distanceTo(wrist), 0)
  engine.sample(1, 0, rig)
  assert.equal(engine.locked.l, true)
  near(world(hand).distanceTo(wrist), 0)
  engine.dispose()
  a.model.dispose()
  b.model.dispose()
})

test('hair and garment centerline crossings escape toward their authored side, with final priority to anatomy', () => {
  const { model, nodes } = fixture({ collisionLinks: true })
  const solver = solverFor(model)
  solver.solveStaticCollisions()
  const fit = solver.colliders
  assert.equal(collisionMasks.cloth & ColliderGroup.weapon, 0)
  assert.ok(collisionMasks.hair & ColliderGroup.weapon)
  const arm = fit.shapes.find((s) => s.start === nodes.bip001_l_forearm)
  const center = arm.a.clone().lerp(arm.b, 0.5)
  for (const name of ['hair_long', 'ribbon_long']) {
    const p = solver.particles.find((p) => p.bone.name === name)
    const outward = p.restTip.clone().sub(world(p.hub)).setY(0).normalize()
    near(p.outward.distanceTo(outward), 0)
    for (const dx of [-0.0001, 0, 0.0001]) {
      const sample = center.clone().addScaledVector(outward, dx)
      const normal = V()
      assert.ok(fit.resolvePoint(sample, 0, collisionMasks[p.material], normal, undefined, { outward }))
      assert.ok(normal.dot(outward) > 0.999)
      near(separation(sample, arm), 0)
    }
  }
  const weaponCenter = center.clone().add(V(0, 0, 0.045))
  fit.setDynamicCapsules([{ a: weaponCenter, b: weaponCenter, radius: 0.036 }])
  const pinched = center.clone().add(V(0, 0, 0.02))
  fit.resolvePoint(pinched, 0, collisionMasks.hair)
  near(separation(pinched, arm), 0)
  fit.setDynamicCapsules([])
  for (const name of ['hair_long', 'ribbon_long']) {
    const p = solver.particles.find((p) => p.bone.name === name)
    const forearm = nodes.bip001_l_forearm
    for (const dx of [-0.002, 0.002]) {
      const elbow = p.restTip.clone().addScaledVector(p.outward, dx).add(V(0, 0.07, 0))
      forearm.position.copy(forearm.parent.worldToLocal(elbow))
      solver.solveStaticCollisions(0)
      assert.ok(tip(p).sub(p.restTip).dot(p.outward) > 0.02, name)
    }
  }
  model.dispose()
})

test('fractional fixed steps interpolate only the displayed pose and replay the same Verlet history', () => {
  const { model, nodes } = fixture({ collisionLinks: true })
  const solver = solverFor(model, { ...defaultRig().spring, gravity: 0, wind: 1 })
  const p = solver.particles.find((p) => p.bone === nodes.hair_long)
  const h = 1 / 120
  for (let i = 0; i < 45; i++) solver.step(h)
  solver.step(1.17 * h)
  const swing = p.swing.clone(), current = p.current.clone(), previous = p.previous.clone()
  const visual = (alpha) => p.prevStepSwing.clone().slerp(swing, alpha).multiply(p.base).normalize()
  near(p.bone.quaternion.angleTo(visual(0.17)), 0)
  const first = p.bone.quaternion.clone()
  solver.step(0.68 * h)
  assert.ok(p.bone.quaternion.angleTo(first) > 1e-6)
  near(p.bone.quaternion.angleTo(visual(0.85)), 0)
  assert.ok(p.swing.equals(swing) && p.current.equals(current) && p.previous.equals(previous))
  const resume = solver.checkpoint()
  solver.step(1.15 * h)
  const exact = pose(solver)
  assert.deepEqual(p.bone.quaternion.toArray(), p.swing.clone().multiply(p.base).normalize().toArray())
  resume()
  solver.step(0.15 * h)
  solver.step(h)
  assert.deepEqual(pose(solver), exact)
  model.dispose()
})

test('a 90-degree hub turn carries both cloth Verlet samples with the new pose', () => {
  const { model, nodes } = fixture({ collisionLinks: true })
  const solver = new SpringBoneSolver(rigBones(model), model.rest, new Set(), {
    ...defaultRig().spring, enabled: true, gravity: 0, wind: 0,
  })
  const p = solver.particles.find((p) => p.bone === nodes.ribbon_long)
  solver.step(1 / 120)
  const resume = solver.checkpoint()
  const turn = () => {
    nodes.bip001.rotation.y = Math.PI / 2
    solver.step(1 / 120)
    const goal = tip(p)
    const neutral = p.hub.localToWorld(p.restTip.clone().sub(model.rest.get(p.hub).restWorldPos))
    assert.ok(goal.distanceTo(neutral) < 0.009)
    assert.ok(p.previous.distanceTo(neutral) < 0.012)
    assert.ok(p.swing.angleTo(identity) < 1.3 * Math.PI / 180)
    return pose(solver)
  }
  const after = turn()
  nodes.bip001.rotation.y = 0
  resume()
  assert.deepEqual(turn(), after)
  model.dispose()
})

test('continuous static collision is slew-limited while reset and zero-dt samples project immediately', () => {
  const { model, nodes } = fixture()
  const solver = solverFor(model)
  const p = solver.particles.find((p) => p.bone === nodes.bone_hair_F_01)
  solver.solveStaticCollisions()
  const rest = tip(p)
  solver.colliders.setDynamicCapsules([{
    a: rest.clone().add(V(-0.06, 0, -0.01)),
    b: rest.clone().add(V(0.06, 0, -0.01)),
    radius: 0.04,
  }])
  solver.solveStaticCollisions(1 / 120)
  near(p.swing.angleTo(identity), 3.5 * Math.PI / 180)
  const resume = solver.checkpoint()
  solver.solveStaticCollisions(1 / 60)
  const limited = p.swing.clone()
  near(limited.angleTo(identity), 10.5 * Math.PI / 180)
  solver.solveStaticCollisions(0)
  const instant = p.swing.clone()
  assert.ok(instant.angleTo(identity) > limited.angleTo(identity) + 0.01)
  solver.reset()
  solver.solveStaticCollisions(1 / 120)
  near(p.swing.angleTo(instant), 0)
  resume()
  solver.solveStaticCollisions(1 / 60)
  assert.ok(p.swing.equals(limited))
  model.dispose()
})

test('free arm clearance starts continuously at marginal improvement and rate-limits both engagement and release', (t) => {
  const a = fixture(), b = fixture()
  const e = new RetargetEngine(a.model, b.model), rig = defaultRig()
  t.after(() => { e.dispose(); a.model.dispose(); b.model.dispose() })
  let improvement = 0
  const cap = 14 * Math.PI / 180
  t.mock.method(e, 'armDepth', (side, angle) =>
    side === 'l' ? 0.015 - improvement * Math.abs(angle) / cap : 0)
  const angle = (dt) => {
    e.sample(0, dt, rig, false, null)
    return a.nodes.bip001_l_upperarm.quaternion.angleTo(identity) * 180 / Math.PI
  }
  near(angle(0), 0)
  improvement = 0.0001
  const marginal = angle(0)
  assert.ok(marginal > 0 && marginal < 0.03)
  improvement = 0.008
  near(angle(1 / 120), marginal + 1.5)
  near(angle(0), 14)
  improvement = 0
  near(angle(1 / 60), 11)
  e.reset()
  near(angle(1 / 60), 0)
})

test('a fast authored wing track respects the slew bound on the composed local rotation', () => {
  const { model, nodes } = fixture()
  const solver = solverFor(model)
  const p = solver.particles.find((p) => p.bone === nodes.bone_Wing_L_00)
  solver.step(0)
  const before = p.bone.quaternion.clone()
  solver.restore()
  p.bone.rotation.x += 15 * Math.PI / 180
  const authored = p.bone.quaternion.clone()
  solver.step(1 / 60)
  assert.ok(before.angleTo(p.bone.quaternion) <= 7 * Math.PI / 180 + 1e-8)
  near(p.bone.quaternion.angleTo(p.swing.clone().multiply(p.base)), 0)
  solver.restore()
  assert.ok(p.bone.quaternion.equals(authored))
  model.dispose()
})
