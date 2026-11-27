import * as THREE from 'three'
import { StudioModel } from '../src/engine/ModelLoader.ts'

export function makeClip(name, duration = 1, tracks = []) {
  return new THREE.AnimationClip(name, duration, tracks)
}

export function makeGlbBytes(jsonObj) {
  const jsonText = JSON.stringify(jsonObj)
  const raw = new TextEncoder().encode(jsonText)
  const paddedLen = Math.ceil(raw.length / 4) * 4
  const buf = new ArrayBuffer(20 + paddedLen)
  const view = new DataView(buf)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, 20 + paddedLen, true)
  view.setUint32(12, paddedLen, true)
  view.setUint32(16, 0x4e4f534a, true)
  const u8 = new Uint8Array(buf)
  u8.set(raw, 20)
  for (let i = raw.length; i < paddedLen; i++) u8[20 + i] = 0x20
  return u8
}

export function makeHumanoidModel({
  name = 'CH0001',
  hipY = 0.5,
  withSwitchCollapse = false,
  withNegativeScaleBone = false,
  withBakedOutline = false,
  withMouth = true,
  withUntexturedProp = false,
  withEyeRing = false,
  tethered = false,
  animations = [],
} = {}) {
  const root = new THREE.Group()
  root.name = name + '_Root'

  const bip = new THREE.Bone()
  bip.name = 'Bip001'
  bip.position.set(0, hipY, 0)
  root.add(bip)

  const pelvis = new THREE.Bone()
  pelvis.name = 'Bip001 Pelvis'
  bip.add(pelvis)

  const spine = new THREE.Bone()
  spine.name = 'Bip001 Spine1'
  spine.position.set(0, 0.2, 0)
  pelvis.add(spine)

  const head = new THREE.Bone()
  head.name = 'Bip001 Head'
  head.position.set(0, 0.25, 0)
  spine.add(head)

  const eyeL = new THREE.Bone()
  eyeL.name = 'bone_eye_L'
  eyeL.position.set(-0.05, 0.05, 0.08)
  head.add(eyeL)

  const hair1 = new THREE.Bone()
  hair1.name = 'bone_hair_01'
  hair1.position.set(0, -0.05, -0.08)
  head.add(hair1)

  const hair2 = new THREE.Bone()
  hair2.name = 'bone_hair_02'
  hair2.position.set(0, -0.15, -0.02)
  hair1.add(hair2)

  const lArm = new THREE.Bone()
  lArm.name = 'Bip001 L UpperArm'
  lArm.position.set(0.15, 0.1, 0)
  spine.add(lArm)

  const rArm = new THREE.Bone()
  rArm.name = 'Bip001 R UpperArm'
  rArm.position.set(-0.15, 0.1, 0)
  spine.add(rArm)

  const weapon = new THREE.Bone()
  weapon.name = 'Bip001_Weapon'
  weapon.position.set(-0.2, 0, 0.1)
  rArm.add(weapon)

  const lThigh = new THREE.Bone()
  lThigh.name = 'Bip001 L Thigh'
  lThigh.position.set(0.08, -0.1, 0)
  pelvis.add(lThigh)

  const rThigh = new THREE.Bone()
  rThigh.name = 'Bip001 R Thigh'
  rThigh.position.set(-0.08, -0.1, 0)
  pelvis.add(rThigh)

  const bones = [bip, pelvis, spine, head, eyeL, hair1, hair2, lArm, rArm, weapon, lThigh, rThigh]

  if (withNegativeScaleBone) {
    const skirtR = new THREE.Bone()
    skirtR.name = 'bone_skirtbelt_R_01'
    skirtR.position.set(-0.1, -0.05, 0)
    skirtR.scale.set(-1, -1, -1)
    pelvis.add(skirtR)
    bones.push(skirtR)
  }

  const bodyGeo = new THREE.BoxGeometry(0.4, 0.8, 0.3)
  const vCount = bodyGeo.getAttribute('position').count
  bodyGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(vCount * 4), 4))
  const wArr = new Float32Array(vCount * 4)
  for (let i = 0; i < vCount; i++) wArr[i * 4] = 1
  bodyGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wArr, 4))
  const bodyMat = new THREE.MeshBasicMaterial({ map: new THREE.Texture(), color: 0xffffff })
  bodyMat.name = 'BodyMat'
  const bodyMesh = new THREE.SkinnedMesh(bodyGeo, bodyMat)
  bodyMesh.name = `${name}_Body`
  bodyMesh.bind(new THREE.Skeleton(bones))
  root.add(bodyMesh)

  const faceMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.25, 0.25),
    new THREE.MeshBasicMaterial({ map: new THREE.Texture(), color: 0xffffff }),
  )
  faceMesh.name = `${name}_Face`
  root.add(faceMesh)

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 8),
    new THREE.MeshBasicMaterial({ color: 0x00a2ff, transparent: true }),
  )
  halo.name = `${name}_Halo`
  halo.position.set(0, 1.1, 0)
  root.add(halo)

  const weaponGeo = new THREE.BoxGeometry(0.1, 0.1, 0.6)
  const weaponMat = new THREE.MeshBasicMaterial({ map: new THREE.Texture() })
  const weaponMesh = tethered
    ? new THREE.SkinnedMesh(weaponGeo, weaponMat)
    : new THREE.Mesh(weaponGeo, weaponMat)
  if (tethered) {
    const cable = new THREE.Bone()
    cable.name = 'bone_line_01'
    cable.position.set(0, 0.1, -0.1)
    spine.add(cable)
    const count = weaponGeo.getAttribute('position').count
    const indices = new Uint16Array(count * 4)
    const weights = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      indices[i * 4] = i % 2
      weights[i * 4] = 1
    }
    weaponGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4))
    weaponGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4))
    root.updateMatrixWorld(true)
    weaponMesh.bind(new THREE.Skeleton([weapon, cable]))
  }
  weaponMesh.name = `${name}_Weapon`
  root.add(weaponMesh)

  if (withMouth) {
    const mouthGeo = new THREE.PlaneGeometry(0.05, 0.03)
    const mPos = mouthGeo.getAttribute('position')
    mouthGeo.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(mPos.count * 3), 3)]
    mouthGeo.morphTargetsRelative = true
    const mouthMesh = new THREE.Mesh(
      mouthGeo,
      new THREE.MeshBasicMaterial({ color: 0xff9999, alphaTest: 0.5 }),
    )
    mouthMesh.name = 'Mouth_200'
    mouthMesh.morphTargetInfluences = [1]
    root.add(mouthMesh)
  }

  if (withSwitchCollapse) {
    const swGeo = new THREE.BoxGeometry(0.4, 0.8, 0.3)
    const swPos = swGeo.getAttribute('position')
    const collapseTarget = new Float32Array(swPos.count * 3)
    for (let i = 0; i < swPos.count; i++) {
      collapseTarget[i * 3] = -swPos.getX(i)
      collapseTarget[i * 3 + 1] = -swPos.getY(i)
      collapseTarget[i * 3 + 2] = -swPos.getZ(i)
    }
    swGeo.morphAttributes.position = [new THREE.BufferAttribute(collapseTarget, 3)]
    swGeo.morphTargetsRelative = true
    const swMesh = new THREE.Mesh(swGeo, new THREE.MeshBasicMaterial({ map: new THREE.Texture() }))
    swMesh.name = `${name}_Body02`
    swMesh.userData.switch0 = true
    swMesh.morphTargetInfluences = [1]
    root.add(swMesh)
  }

  if (withBakedOutline) {
    const outMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.26, 0.26),
      new THREE.MeshBasicMaterial({ color: 0x221111 }),
    )
    outMesh.name = `${name}_Face01_Outline`
    root.add(outMesh)
  }

  if (withUntexturedProp) {
    const tankMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.6, 1.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    )
    tankMesh.name = `${name}_Tank`
    root.add(tankMesh)
  }

  if (withEyeRing) {
    const ringMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ map: new THREE.Texture(), color: 0xffffff }),
    )
    ringMesh.name = `${name}_Eyering_Prop`
    root.add(ringMesh)
  }

  return new StudioModel(root, animations, 4)
}

// Minimal animated triangle with inline binary data, built entirely in memory.
export function animatedGlb(names = ['Cafe_Reaction']) {
  const payload = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0.2, 0, 0])
  const json = makeGlbBytes({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Bip001', children: [1, 2] }, { name: 'Body', mesh: 0 }, { name: 'St_point' }],
    meshes: [{ name: 'CH0001_Body', primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: payload.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    animations: names.map((name) => ({
      name,
      channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      samplers: [{ input: 1, output: 2 }],
    })),
  })
  const bytes = new Uint8Array(json.length + 8 + payload.byteLength)
  bytes.set(json)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, bytes.length, true)
  view.setUint32(json.length, payload.byteLength, true)
  view.setUint32(json.length + 4, 0x004e4942, true)
  bytes.set(new Uint8Array(payload.buffer), json.length + 8)
  return bytes
}
