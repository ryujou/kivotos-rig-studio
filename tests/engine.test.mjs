import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { makeClip, makeHumanoidModel } from './fixtures.mjs'
import { SlotProps } from '../src/engine/PropManager.ts'
import { useStudioStore } from '../src/store/useStudioStore.ts'
import {
  describeClip,
  normalizeClipName,
  clipSequence,
  sequenceDuration,
  sampleSequence,
} from '../src/engine/AnimationUtils.ts'
import {
  bodyParts,
  canonicalBoneName,
  mirrorBoneName,
  classifyBone,
  defaultRig,
} from '../src/engine/RigDefinition.ts'
import { cropRect, outputSize, clipTiming, gifPaletteFrames } from '../src/engine/exportSpec.ts'
import { StudioModel, decomposeRigTransform, rigBones } from '../src/engine/ModelLoader.ts'
import { RetargetEngine } from '../src/engine/RetargetEngine.ts'
import { addSmoothNormals } from '../src/engine/OutlineEffect.ts'
import { SkeletonOverlay } from '../src/engine/SkeletonOverlay.ts'
import { SpringBoneSolver } from '../src/engine/SpringBoneSolver.ts'

test('clip aliases, categories and chain timing match authored clip names', () => {
  assert.equal(normalizeClipName('Fomation_Idle'), 'formation_idle')
  assert.equal(normalizeClipName('01_Tank_EX_CallSigh_Start'), 'ex_callsign_start')
  assert.equal(normalizeClipName('Victory_Start_01'), 'victory_start_01')

  assert.equal(describeClip(makeClip('Cafe_Reaction')).category, 'cafe')
  assert.equal(describeClip(makeClip('Interaction_01')).category, 'interact')
  assert.equal(describeClip(makeClip('Victory_Start')).category, 'victory')
  assert.equal(describeClip(makeClip('Victory_Start')).chain, 'start')
  assert.equal(describeClip(makeClip('Victory_End')).chain, 'end')
  assert.equal(describeClip(makeClip('Formation_Pickup')).chain, 'start')
  assert.equal(describeClip(makeClip('Exs_Cutin')).category, 'exs')
  assert.equal(describeClip(makeClip('Tank_Move')).category, 'vehicle')
  assert.equal(describeClip(makeClip('Normal_Attack')).category, 'combat')
  assert.equal(describeClip(makeClip('RandomPose')).category, 'other')

  const vStart = makeClip('Victory_Start', 1.2)
  const vEnd = makeClip('Victory_End', 2.0)
  const fPick = makeClip('Formation_Pickup', 0.8)
  const fIdle = makeClip('Formation_Idle', 1.5)
  const iStart = makeClip('Cafe_Interaction_Start', 1.0)
  const iIng = makeClip('Cafe_Interaction_Ing', 2.0)
  const iEnd = makeClip('Cafe_Interaction_End', 1.0)
  const all = [vStart, vEnd, fPick, fIdle, iStart, iIng, iEnd]

  assert.deepEqual(clipSequence(all, 'Victory_Start', false), [vStart])
  assert.deepEqual(clipSequence(all, 'Victory_Start', true), [vStart, vEnd])
  assert.deepEqual(clipSequence(all, 'Victory_Start', true, 'Formation_Idle'), [vStart, fIdle])
  assert.deepEqual(clipSequence(all, 'Victory_Start', true, 'Victory_Start'), [vStart])
  assert.deepEqual(clipSequence(all, 'Formation_Pickup', true), [fPick, fIdle])
  assert.deepEqual(clipSequence(all, 'Cafe_Interaction_Start', true), [iStart, iIng, iEnd])
  assert.deepEqual(clipSequence(all, 'DoesNotExist', true), [])

  assert.equal(sequenceDuration([vStart, vEnd], 0), 3.2)
  assert.equal(sequenceDuration([vStart, vEnd], 1.5), 3.5)
  assert.equal(sequenceDuration([], 0), 0)

  assert.equal(sampleSequence([], 0.5), undefined)
  assert.deepEqual(sampleSequence([vStart, vEnd], -1), { clip: vStart, time: 0 })
  assert.deepEqual(sampleSequence([vStart, vEnd], 0.6), { clip: vStart, time: 0.6 })
  assert.ok(Math.abs(sampleSequence([vStart, vEnd], 1.5).time - 0.3) < 1e-9)
  assert.deepEqual(sampleSequence([vStart, vEnd], 99), { clip: vEnd, time: 2.0 })
  assert.deepEqual(sampleSequence([vStart, vEnd], 1.3, 1.5), { clip: vStart, time: 1.2 })
  assert.ok(Math.abs(sampleSequence([vStart, vEnd], 1.8, 1.5).time - 0.3) < 1e-9)
})

test('rig names normalize and mirror into their correct body groups', () => {
  assert.equal(canonicalBoneName('Bip001_L_UpperArm'), 'bip001_l_upperarm')
  assert.equal(canonicalBoneName('Bip001 L ForeTwist1'), 'bip001_l_foretwist1')
  assert.equal(canonicalBoneName('Bone_R_UpperArm_Tw'), 'bip001_r_upperarm_twist')
  assert.equal(canonicalBoneName('Bip001_B_L_Forearm_Twist'), 'bip001_l_forearm_twist')

  assert.equal(mirrorBoneName('bip001_l_hand'), 'bip001_r_hand')
  assert.equal(mirrorBoneName('bip001_r_thigh'), 'bip001_l_thigh')
  assert.equal(mirrorBoneName('bone_hair_fl'), 'bone_hair_fr')
  assert.equal(mirrorBoneName('bone_wing_l'), 'bone_wing_r')
  assert.equal(mirrorBoneName('bip001_head'), 'bip001_head')

  assert.equal(classifyBone('bip001'), 'torso')
  assert.equal(classifyBone('bip001_pelvis'), 'torso')
  assert.equal(classifyBone('bip001_spine2'), 'torso')
  assert.equal(classifyBone('bip001_head'), 'head')
  assert.equal(classifyBone('bip001_neck'), 'head')
  assert.equal(classifyBone('bone_eye_l'), 'face')
  assert.equal(classifyBone('eyebrow_r'), 'face')
  assert.equal(classifyBone('bip001_l_hand'), 'leftArm')
  assert.equal(classifyBone('bip001_r_clavicle'), 'rightArm')
  assert.equal(classifyBone('bip001_l_calf'), 'legs')
  assert.equal(classifyBone('bip001_r_foot'), 'legs')
  assert.equal(classifyBone('bip001_weapon'), 'weapon')
  assert.equal(classifyBone('bone_skirt_01'), 'secondary')

  const rig = defaultRig()
  assert.equal(rig.rootMode, 'ground-scaled')
  assert.equal(rig.mirror, false)
  assert.equal(bodyParts.length, 7)
  assert.deepEqual(rig.offset, [0, 0, 0])
})

test('Arisu’s Eyering bone belongs to the secondary group', () => {
  assert.equal(
    classifyBone(canonicalBoneName('bone_Eyering_R_01')),
    'secondary',
    'bone_Eyering_R_01 matched /eye/ and was misclassified as face instead of secondary!',
  )
})

test('export aspect ratios, sample counts and timing use the selected viewport and trim', () => {
  const view = { width: 1000, height: 800, dpr: 2, safe: { x: 200, y: 50, width: 600, height: 700 } }
  assert.deepEqual(cropRect(view, 'free'), { x: 0, y: 0, width: 1000, height: 800 })
  assert.deepEqual(cropRect(view, '1:1'), { x: 200, y: 100, width: 600, height: 600 })
  assert.deepEqual(cropRect(view, '16:9'), { x: 200, y: 231.25, width: 600, height: 337.5 })
  assert.deepEqual(cropRect(view, '4:3'), { x: 200, y: 175, width: 600, height: 450 })

  assert.deepEqual(outputSize({ x: 0, y: 0, width: 400, height: 400 }, 'original', 2), {
    width: 800,
    height: 800,
  })
  assert.deepEqual(outputSize({ x: 0, y: 0, width: 400, height: 200 }, 512, 2), { width: 512, height: 256 })

  assert.deepEqual(clipTiming({ trimStart: 0.25, trimEnd: 0.75, duration: 2, speed: 1 }, 20), {
    start: 0.5,
    end: 1.5,
    duration: 1,
    frames: 20,
    step: 0.05,
  })
  assert.equal(clipTiming({ trimStart: 0.5, trimEnd: 0.5, duration: 2, speed: 1 }, 20).frames, 0)
  assert.equal(gifPaletteFrames(2), 2)
  assert.equal(gifPaletteFrames(50), 5)
})

test('30 FPS export treats Float32 animation endpoints as frame boundaries', () => {
  const frames = duration => clipTiming({ trimStart: 0, trimEnd: 1, duration, speed: 1 }, 30).frames
  assert.equal(frames(Math.fround(310 / 30)), 310)
  assert.equal(frames(1), 30)
  assert.equal(frames(310 / 30 + .0001), 311)
  assert.equal(frames(.000001), 1)
})

test('a zero-sized crop produces finite output dimensions', () => {
  const zeroOut = outputSize({ x: 0, y: 0, width: 0, height: 0 }, 512, 1)
  assert.ok(
    Number.isFinite(zeroOut.width) && zeroOut.width >= 1,
    `Expected finite width, got ${zeroOut.width}`,
  )
  assert.ok(
    Number.isFinite(zeroOut.height) && zeroOut.height >= 1,
    `Expected finite height, got ${zeroOut.height}`,
  )
})

test('model preparation preserves bind transforms, switch visibility and material variants', () => {
  const pos = new THREE.Vector3(),
    quat = new THREE.Quaternion(),
    scale = new THREE.Vector3()

  assert.equal(decomposeRigTransform(new THREE.Matrix4(), pos, quat, scale), true)
  assert.deepEqual(scale.toArray(), [1, 1, 1])

  const zeroMat = new THREE.Matrix4().compose(
    new THREE.Vector3(1, 2, 3),
    new THREE.Quaternion(),
    new THREE.Vector3(0, 0, 0),
  )
  assert.equal(decomposeRigTransform(zeroMat, pos, quat, scale), false)
  assert.deepEqual(pos.toArray(), [1, 2, 3])
  assert.deepEqual(scale.toArray(), [0, 0, 0])

  const tinyMat = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(1e-5, 1, 1),
  )
  assert.equal(decomposeRigTransform(tinyMat, pos, quat, scale), false)

  const negMat = new THREE.Matrix4().compose(
    new THREE.Vector3(1, 0, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)),
    new THREE.Vector3(-1, -1, -1),
  )
  assert.equal(decomposeRigTransform(negMat, pos, quat, scale), true)
  const recon = new THREE.Matrix4().compose(pos, quat, scale)
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(recon.elements[i] - negMat.elements[i]) < 1e-5)

  const clipShow = makeClip('ShowSwitch', 1)
  clipShow.userData = { hide: ['CH0139_Body'], show: ['switch0'] }
  const model = makeHumanoidModel({
    name: 'CH0139',
    withSwitchCollapse: true,
    withNegativeScaleBone: true,
    withUntexturedProp: true,
    animations: [clipShow],
  })

  const swMesh = model.root.getObjectByName('CH0139_Body02')
  assert.equal(swMesh.visible, false)
  swMesh.morphTargetInfluences[0] = 0
  model.syncSwitchVisibility()
  assert.equal(swMesh.visible, true)
  model.setPartEnabled(swMesh, false)
  assert.equal(swMesh.visible, false)
  model.setPartEnabled(swMesh, true)
  assert.equal(swMesh.visible, true)

  model.syncSwitchVisibility(clipShow)
  assert.equal(model.root.getObjectByName('CH0139_Body').visible, false)

  model.setShading('unlit')
  assert.equal(model.root.getObjectByName('CH0139_Tank').material.type, 'MeshLambertMaterial')

  model.setShading('softLit')
  assert.equal(model.root.getObjectByName('CH0139_Halo').material.type, 'MeshBasicMaterial')
  assert.equal(model.root.getObjectByName('CH0139_Body').material.type, 'MeshLambertMaterial')
  assert.equal(model.root.getObjectByName('CH0139_Face').material.type, 'MeshLambertMaterial')

  model.setShading('wireframe')
  assert.equal(model.root.getObjectByName('CH0139_Body').material.wireframe, true)

  model.outline.apply(true, 25, '#2b2434')
  model.outline.apply(false, 0, '#000000')
  assert.ok(!model.bounds.isEmpty())
  assert.ok(rigBones(model).length >= 10)
  model.dispose()
})

test('soft lighting shades an Eyering prop', () => {
  const model = makeHumanoidModel({ name: 'CH0334', withEyeRing: true })
  model.setShading('softLit')
  const eyering = model.root.getObjectByName('CH0334_Eyering_Prop')
  const type = eyering.material.type
  model.dispose()
  assert.equal(type, 'MeshLambertMaterial', 'Eyering matched /eye/i false positive and stayed unlit!')
})

test('combined Original skins keep their clothing and face visible when weapons are hidden', () => {
  const root = new THREE.Group(), meshNames = new Map()
  const primitive = (materialName, group) => {
    const skin = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    skin.material.name = materialName
    skin.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    skin.bind(new THREE.Skeleton([]))
    root.add(skin)
    meshNames.set(skin, group)
    return skin
  }
  const body = primitive('Mimori_Original_Body', 'Mimori_Original')
  const face = primitive('Mimori_Original_Face', 'Mimori_Original')
  const weapon = primitive('Mimori_Original_Weapon', 'Mimori_Original_Weapon')
  const model = new StudioModel(root, [], 1, meshNames)
  assert.deepEqual(model.bodyMeshes, [body, face])
  assert.deepEqual(model.weaponMeshes, [weapon])
  model.dispose()
})

test('Sena’s SM vehicle body hides as an actor prop during cross-character playback', () => {
  const root = new THREE.Group()
  const ambulance = new THREE.Group()
  ambulance.name = 'SM008101_Body'
  root.add(ambulance)
  const panel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  panel.name = 'SM008101_Body_1'
  ambulance.add(panel)
  const body = panel.clone()
  body.name = 'CH0081_Body'
  const weapon = panel.clone()
  weapon.name = 'SM008101_Weapon'
  root.add(body, weapon)
  const actor = new StudioModel(root, [], 1)
  assert.deepEqual(actor.propMeshes, [panel])
  assert.deepEqual(actor.bodyMeshes, [body])
  assert.deepEqual(actor.weaponMeshes, [weapon])
  assert.equal(panel.visible, true)
  const driver = makeHumanoidModel()
  const engine = new RetargetEngine(actor, driver)
  engine.sample(0, 0, defaultRig())
  assert.equal(panel.visible, false)
  assert.equal(body.visible, true)
  engine.dispose()
  driver.dispose()
  actor.dispose()
})

test('ground-scaled vehicle students use anatomical hip height while native and prop-locked poses keep the seat', () => {
  const hipHeight = 0.362
  const jump = 0.2
  function student(rootPosition, localHip) {
    const root = new THREE.Group()
    const charRoot = new THREE.Object3D()
    charRoot.name = 'character_root'
    charRoot.position.fromArray(rootPosition)
    root.add(charRoot)
    const hip = new THREE.Bone()
    hip.name = 'Bip001'
    hip.position.fromArray(localHip)
    charRoot.add(hip)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.3), new THREE.MeshBasicMaterial())
    body.name = 'CH0156_Body'
    body.position.y = 0.4 - hipHeight
    hip.add(body)
    const track = new THREE.VectorKeyframeTrack('Bip001.position', [0, 1], [
      ...localHip, localHip[0], localHip[1] + jump, localHip[2],
    ])
    const dismount = new THREE.VectorKeyframeTrack('character_root.position', [0, 1], [0, 0, 0, 0, 0, 0])
    return new StudioModel(root, [makeClip('Jump', 1, [track]), makeClip('Dismount', 1, [dismount, track])], 1)
  }
  function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-6, `expected ${expected}, got ${actual}`)
  }
  const rider = student([0.253, 1.27, 0.049], [0, hipHeight, 0.038])
  const walker = student([0, 0, 0], [0, hipHeight, 0.038])
  const medic = student([0, 0.007, 0], [-0.741, hipHeight - 0.007, 0.038])
  near(rider.hipRestHeight, hipHeight)
  near(rider.restGroundOffset.x, 0.253)
  near(rider.restGroundOffset.y, 1.27)
  near(rider.restGroundOffset.z, 0.049)
  assert.deepEqual(medic.restGroundOffset.toArray(), [-0.741, 0, 0])
  const rig = defaultRig()
  for (const actor of [rider, medic]) {
    const engine = new RetargetEngine(actor, walker)
    engine.setClip('Jump')
    for (const time of [0, 1]) {
      engine.sample(time, 0, rig)
      const hip = actor.root.getObjectByName('Bip001').getWorldPosition(new THREE.Vector3())
      near(hip.x, 0)
      near(hip.y, hipHeight + time * jump)
      near(hip.z, 0.038)
      const feet = new THREE.Box3()
      actor.expandVisibleBounds(feet, actor.bodyMeshes)
      near(feet.min.y, time * jump)
    }
    engine.dispose()
  }
  const seatedHip = new THREE.Vector3(0.253, 1.27 + hipHeight + jump, 0.049 + 0.038)
  const native = new RetargetEngine(rider)
  native.setClip('Jump')
  for (const mirror of [false, true]) {
    native.sample(1, 0, { ...rig, mirror })
    near(rider.root.getObjectByName('Bip001').getWorldPosition(new THREE.Vector3()).distanceTo(seatedHip), 0)
  }
  native.dispose()
  const passenger = new RetargetEngine(walker, rider)
  passenger.setClip('Jump')
  passenger.sample(1, 0, rig)
  near(walker.root.getObjectByName('Bip001').getWorldPosition(new THREE.Vector3()).y, hipHeight + jump)
  passenger.sample(1, 0, { ...rig, rootMode: 'prop-locked' })
  near(walker.root.getObjectByName('Bip001').getWorldPosition(new THREE.Vector3()).distanceTo(seatedHip), 0)
  passenger.setClip('Dismount')
  for (const t of [0.5, 1, 0]) {
    passenger.sample(t, 0, rig)
    const hip = walker.root.getObjectByName('Bip001').getWorldPosition(new THREE.Vector3())
    near(hip.y, hipHeight + jump * t)
  }
  passenger.dispose()
  walker.dispose()
  rider.dispose()
  medic.dispose()
})

test('Wakamo’s masked face tracks preserve the target eye and still transfer authored expression', () => {
  const times = [0, 0.5, 1]
  const clip = makeClip('Formation_Pickup', 1, [
    new THREE.VectorKeyframeTrack('bone_eye_L.position', times, [0, 0, 0, 0, 0, 0, -0.04, 0.06, 0.08]),
    new THREE.QuaternionKeyframeTrack('bone_eye_L.quaternion', times, [
      0, 0, 0, 0, 0.00004, 0, 0, 0, 0, 0, 0.6, 0.8,
    ]),
    new THREE.VectorKeyframeTrack('bone_eye_L.scale', times, [0, 0, 0, 1, 1, 1, 0.0005, 0.5, 1.25]),
  ])
  const driver = makeHumanoidModel({ animations: [clip] })
  const actor = makeHumanoidModel()
  const eye = actor.root.getObjectByName('bone_eye_L')
  const bind = actor.rest.get(eye)
  const engine = new RetargetEngine(actor, driver)
  engine.setClip(clip.name)
  const rig = defaultRig()
  for (const time of [0, 0.5]) {
    engine.sample(time, 0, rig)
    assert.ok(eye.position.equals(bind.restLocalPos))
    assert.ok(eye.quaternion.equals(bind.restLocalQuat))
    assert.ok(eye.scale.equals(bind.restLocalScale))
  }
  engine.sample(1, 0, rig)
  assert.ok(eye.position.distanceTo(new THREE.Vector3(-0.04, 0.06, 0.08)) < 1e-6)
  assert.ok(eye.quaternion.angleTo(new THREE.Quaternion(0, 0, 0.6, 0.8)) < 1e-6)
  assert.deepEqual(eye.scale.toArray(), [1, 0.5, 1.25])
  engine.dispose()
  actor.dispose()
  driver.dispose()
})

test('mirrored native pickup preserves hip height under a shrunken vehicle parent', () => {
  const root = new THREE.Group()
  const turret = new THREE.Object3D()
  turret.name = 'character_root'
  turret.position.y = 0.882
  root.add(turret)
  const hip = new THREE.Bone()
  hip.name = 'Bip001'
  hip.position.y = 0.364
  turret.add(hip)
  const clip = makeClip('Formation_Pickup', 1, [
    new THREE.VectorKeyframeTrack('character_root.scale', [0], [0.00009, 0.00009, 0.00009]),
    new THREE.VectorKeyframeTrack('Bip001.position', [0], [500, -5000, 0]),
  ])
  const model = new StudioModel(root, [clip], 1)
  const native = new RetargetEngine(model)
  native.setClip(clip.name)
  const rig = defaultRig()
  native.sample(0, 0, rig)
  const authored = hip.getWorldPosition(new THREE.Vector3())
  native.sample(0, 0, { ...rig, mirror: true })
  const mirrored = hip.getWorldPosition(new THREE.Vector3())
  assert.ok(Math.abs(mirrored.y - authored.y) < 1e-6)
  assert.ok(Math.abs(mirrored.x + authored.x) < 1e-6)
  native.dispose()
  model.dispose()
})

test('Kanoe’s untextured white weapon uses slate in both shading modes even with a shared material', () => {
  const root = new THREE.Group()
  const geometry = new THREE.BoxGeometry()
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const names = ['CH0306_Weapon_1', 'CH0306_Body', 'CH0306_Halo', 'Mouth_200']
  const [gun, body, halo, mouth] = names.map((name) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    root.add(mesh)
    return mesh
  })
  const model = new StudioModel(root, [], 1, new Map([[gun, 'CH0306_Weapon']]))
  assert.deepEqual(model.weaponMeshes, [gun])
  for (const mode of ['unlit', 'softLit']) {
    model.setShading(mode)
    assert.ok(gun.material.isMeshLambertMaterial)
    assert.equal(gun.material.color.getHex(), 0xc7d2e0)
    for (const part of [body, halo, mouth]) assert.equal(part.material.color.getHex(), 0xffffff)
    assert.equal(body.material.type, mode === 'unlit' ? 'MeshBasicMaterial' : 'MeshLambertMaterial')
    assert.ok(halo.material.isMeshBasicMaterial && mouth.material.isMeshBasicMaterial)
  }
  model.dispose()
})

test('a baked outline mesh receives no generated hull', () => {
  const model = makeHumanoidModel({ name: 'CH0336', withBakedOutline: true })
  const bakedOutline = model.root.getObjectByName('CH0336_Face01_Outline')
  const doubleHull = bakedOutline.children.find((c) => c.userData.isOutline)
  model.dispose()
  assert.equal(
    doubleHull,
    undefined,
    'Baked *_Outline mesh received a duplicate OutlineEffect __outline hull!',
  )
})

test('smoothed normals and joint markers track the visible skeleton', () => {
  const geo = new THREE.BoxGeometry(1, 1, 1)
  addSmoothNormals(geo)
  assert.ok(geo.hasAttribute('smoothNormal'))
  addSmoothNormals(geo)
  const empty = new THREE.BufferGeometry()
  addSmoothNormals(empty)
  assert.ok(!empty.hasAttribute('smoothNormal'))

  const model = makeHumanoidModel({ name: 'CH0020' })
  const overlay = new SkeletonOverlay(model)
  overlay.update('Bip001 Head')
  assert.equal(overlay.marker.visible, true)
  overlay.update('')
  assert.equal(overlay.marker.visible, false)
  overlay.dispose()
  model.dispose()
  geo.dispose()
  empty.dispose()
})

test('hair chains support fixed steps and restoring a checkpoint', () => {
  const model = makeHumanoidModel({ name: 'CH0010' })
  const nodes = rigBones(model)
  const solver = new SpringBoneSolver(nodes, model.rest, new Set(), { ...defaultRig().spring, enabled: true })
  assert.ok(solver.particles.length >= 2)
  const hair1 = model.root.getObjectByName('bone_hair_01')
  const head = model.root.getObjectByName('Bip001 Head')
  head.position.x += 0.3
  model.root.updateMatrixWorld(true)
  solver.step(1 / 60)
  const cp = solver.checkpoint()
  head.position.x += 0.2
  model.root.updateMatrixWorld(true)
  solver.step(1 / 60)
  assert.ok(Number.isFinite(hair1.quaternion.x))
  cp()
  solver.step(0)
  solver.step(10)
  solver.settings = { ...defaultRig().spring, enabled: false }
  solver.step(1 / 60)
  solver.restore()
  solver.reset()
  model.dispose()
})

test('native and mirrored retargeting preserve mouth weights and unmapped accessories', () => {
  const track = new THREE.QuaternionKeyframeTrack(
    'Bip001 L UpperArm.quaternion',
    [0, 1],
    [0, 0, 0, 1, 0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)],
  )
  const rootTrack = new THREE.VectorKeyframeTrack('Bip001.position', [0, 1], [0, 0.5, 0, 0.4, 0.6, 0])
  const hairTrack = new THREE.QuaternionKeyframeTrack(
    'bone_hair_01.quaternion',
    [0, 1],
    [0, 0, 0, 1, 0.5, 0, 0, Math.sqrt(0.75)],
  )
  const mouthTrack = new THREE.NumberKeyframeTrack('Mouth_200.morphTargetInfluences[0]', [0, 1], [1, 0])
  const clipB = makeClip('Victory_Start', 1, [track, rootTrack, hairTrack, mouthTrack])

  const actorA = makeHumanoidModel({ name: 'ActorA', hipY: 0.6, animations: [makeClip('Idle_A', 1)] })
  const driverB = makeHumanoidModel({ name: 'DriverB', hipY: 0.5, animations: [clipB] })

  const nativeEngine = new RetargetEngine(driverB, driverB)
  nativeEngine.setClip('Victory_Start', false)
  assert.equal(nativeEngine.duration, 1)
  nativeEngine.sample(0.5, 1 / 60, defaultRig(), true)
  // Native modified path (offset != 0) -> triggers restoreNative on next sample & dispose
  nativeEngine.sample(0.5, 1 / 60, { ...defaultRig(), offset: [0.1, 0, 0] }, true)
  nativeEngine.sample(0.6, 1 / 60, defaultRig(), true)
  nativeEngine.dispose()

  const engine = new RetargetEngine(actorA, driverB)
  assert.ok(engine.manualOnlyTargets.has('bone_hair_01'))
  engine.setClip('Victory_Start', false)
  const noSpring = { ...defaultRig(), spring: { ...defaultRig().spring, enabled: false } }
  engine.sample(1.0, 1 / 60, noSpring, false)
  const actorHair = actorA.root.getObjectByName('bone_hair_01')
  assert.ok(actorHair.quaternion.angleTo(actorA.rest.get(actorHair).restLocalQuat) < 1e-4)
  assert.ok(actorA.root.getObjectByName('Mouth_200').morphTargetInfluences[0] < 0.05)

  const customRig = {
    ...noSpring,
    mirror: true,
    rootMode: 'prop-locked',
    offset: [0.1, 0, -0.1],
    mixer: { ...noSpring.mixer, head: 'actorA', legs: 'rest', face: 'rest' },
    overrides: {
      'Bip001 R UpperArm': { source: 'Bip001 L UpperArm', rotation: [15, 0, 0] },
      'Bip001 L UpperArm': { muted: true },
    },
  }
  engine.sample(0.5, 1 / 60, customRig, true)
  assert.equal(actorA.root.getObjectByName('Mouth_200').morphTargetInfluences[0], 1)
  const cp = engine.checkpointSpring()
  cp()
  engine.reset()
  engine.dispose()
  assert.equal(driverB.root.getObjectByName('DriverB_Body').visible, true)

  actorA.dispose()
  driverB.dispose()
})

test('Eimi’s shared grip/cable skin follows Aru’s sampled weapon visibility independently of user controls', () => {
  const actor = makeHumanoidModel({ name: 'CH0337', tethered: true })
  const clip = makeClip('Cafe_Reaction', 1, [
    new THREE.VectorKeyframeTrack('Bip001_Weapon.scale', [0, 1], [1, 1, 1, -0.001, 1, 1]),
  ])
  const driver = makeHumanoidModel({ name: 'Aru', animations: [clip] })
  const engine = new RetargetEngine(actor, driver)
  const presentation = new SlotProps(actor, driver)
  const slot = useStudioStore.getInitialState().slots[0]
  const rig = defaultRig()
  const weapon = actor.weaponMeshes[0]
  const cable = actor.root.getObjectByName('bone_line_01')
  assert.ok(weapon.isSkinnedMesh && weapon.skeleton.bones.includes(cable))
  engine.setClip(clip.name)
  function sample(time, settings = rig) {
    presentation.restore()
    engine.sample(time, 1 / 24, settings)
    presentation.apply({ ...slot, rig: settings })
    return weapon.visible
  }
  assert.equal(sample(0), true)
  assert.equal(sample(1), false)
  assert.equal(cable.scale.y, 1)
  actor.setPartEnabled(weapon, true)
  assert.equal(weapon.visible, false)
  assert.equal(sample(0), true)
  assert.equal(sample(1, { ...rig, overrides: { Bip001_Weapon: { muted: true } } }), true)
  assert.equal(sample(1, { ...rig, overrides: { Bip001_Weapon: { source: 'bone_eye_L' } } }), true)
  for (const mode of ['rest', 'actorA']) {
    assert.equal(sample(1, { ...rig, mixer: { ...rig.mixer, weapon: mode } }), true)
  }
  const hidden = { ...rig, showActorWeapon: false }
  assert.equal(sample(1, hidden), false)
  assert.equal(sample(0, hidden), false)
  assert.equal(sample(1), false)
  presentation.restore()
  engine.dispose()
  assert.equal(weapon.visible, true)
  const native = new RetargetEngine(driver)
  driver.setWeaponsCollapsed(true)
  native.setClip(clip.name)
  native.sample(1, 0, rig)
  assert.equal(driver.weaponMeshes[0].visible, true)
  native.dispose()
  actor.dispose()
  driver.dispose()
})

test('soft lighting preserves baked outline groups and tokenized eye layers, and weights the body rim by alpha', () => {
  const root = new THREE.Group()
  const group = new THREE.Group()
  group.name = 'CH0336_Prop_Outline02'
  const mesh = (name, parent = root) => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ transparent: false }))
    model.name = name
    parent.add(model)
    return model
  }
  root.add(group)
  const baked = mesh('Primitive0', group)
  const eye = mesh('CH0336-Eye01')
  const body = mesh('CH0336_Body')
  const model = new StudioModel(root, [], 1)
  model.setShading('softLit')
  assert.equal(baked.children.length, 0)
  assert.ok(baked.material.isMeshBasicMaterial && eye.material.isMeshBasicMaterial)
  assert.ok(body.children.some((child) => child.userData.isOutline))
  const shader = { fragmentShader: '#include <opaque_fragment>' }
  body.material.onBeforeCompile(shader)
  assert.match(shader.fragmentShader, /0\.78 \+ 0\.28 \* wrap/)
  assert.match(shader.fragmentShader, /rim \* 0\.12 \* diffuseColor\.a/)
  model.dispose()
})

test('non-finite spring gravity produces the same constrained pose as zero gravity', () => {
  function pose(gravity) {
    const model = makeHumanoidModel()
    const solver = new SpringBoneSolver(rigBones(model), model.rest, new Set(), {
      ...defaultRig().spring,
      enabled: true,
      gravity,
    })
    solver.step(1 / 60)
    model.root.position.x += 0.1
    solver.step(1 / 30)
    const state = solver.particles.map((p) => [...p.current.toArray(), ...p.bone.quaternion.toArray()])
    model.dispose()
    return state
  }
  assert.deepEqual(pose(NaN), pose(0))
  assert.deepEqual(pose(Infinity), pose(0))
})
