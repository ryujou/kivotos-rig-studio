import test from 'node:test'
import assert from 'node:assert/strict'
import {
  Bone,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line3,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Triangle,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { HairSurfaceContact } from '../src/engine/HairSurfaceContact.ts'
import { GarmentDisplacementField } from '../src/engine/GarmentDisplacementField.ts'
import { collisionMasks } from '../src/engine/BodyColliders.ts'
import { closestFacePoint, GarmentContact, surfaceOffset } from '../src/engine/GarmentContact.ts'
import { ClothPreviewBudget } from '../src/engine/ClothPreviewBudget.ts'
const v = (x, y, z) => new Vector3(x, y, z)

test('a swept capsule finds interior and edge contacts when all three garment vertices clear the leg', () => {
  const t = new Triangle(v(-1, 0, -1), v(1, 0, -1), v(0, 0, 1)),
    out = v()
  assert.equal(closestFacePoint(new Line3(v(0, -0.3, 0), v(0, 0.3, 0)), t, out), 0)
  assert.ok(out.length() < 1e-8)
  assert.ok(
    Math.abs(closestFacePoint(new Line3(v(-0.5, 0.005, -1), v(0.5, 0.005, -1)), t, out) - 0.005 ** 2) < 1e-9,
  )
  assert.ok(Math.abs(out.z + 1) < 1e-8)
})

function layered(pinned = false, adjacent = false) {
  const bind = [
    v(-0.08, 0, -0.08),
    v(0.08, 0, -0.08),
    v(0, 0, 0.08),
    v(0, 0.004, 0),
    v(0.15, 0.004, 0.03),
    v(0.13, 0.004, 0.06),
  ]
  const posed = bind.map((p) => p.clone())
  const mesh = { matrixWorld: new Matrix4(), getVertexPosition: (i, out) => out.copy(posed[i]) }
  const cloth = {
    nodes: bind.map((p, i) => ({
      bind: p,
      mobility: i < 3 || pinned ? 0 : 1,
      meshIndex: 0,
      vertex: i,
      materialMask: 52,
    })),
    meshes: [{ mesh }],
    faces: [
      [0, 1, 2],
      [3, 4, 5],
    ],
    edges: adjacent ? [{ a: 0, b: 3 }] : [],
  }
  const contact = new GarmentContact(
    { root: new Group(), rest: new Map(), bodyMeshes: [], hipRestHeight: 0.5 },
    cloth,
    { legCapsules: [] },
  )
  return { contact, posed }
}

test('layer contact restores an intersecting pleat to its authored side, with fixed waist and welded edges', () => {
  for (const [pin, adj] of [
    [false, false],
    [true, false],
    [false, true],
  ]) {
    const { contact, posed } = layered(pin, adj)
    contact.prepare(false, 1)
    assert.ok(surfaceOffset(contact, 3, v()).length() < 1e-7, 'rest silhouette')
    posed[3].y = -0.001
    contact.prepare(false, 1)
    const delta = surfaceOffset(contact, 3, v())
    if (pin || adj) assert.equal(delta.length(), 0)
    else {
      assert.ok(posed[3].y + delta.y >= 0.004 - 1e-6, 'fold crossing cleared')
      assert.ok(Math.abs(delta.x) + Math.abs(delta.z) < 1e-8, 'tangential slip')
    }
    for (let i = 0; i < 3; i++) assert.equal(surfaceOffset(contact, i, v()).length(), 0)
  }
})

test('a swinging layer crossing farther than its thickness retains its authored side', () => {
  const { contact, posed } = layered()
  posed[3].y = 0.012
  contact.prepare(false, 1)
  const resume = contact.checkpoint()
  posed[3].y = -0.016
  contact.prepare(false, 1)
  assert.ok(posed[3].y + surfaceOffset(contact, 3, v()).y >= 0.004 - 1e-6)
  contact.reset()
  contact.prepare(false, 1)
  assert.equal(surfaceOffset(contact, 3, v()).length(), 0)
  resume()
  contact.prepare(false, 1)
  assert.ok(posed[3].y + surfaceOffset(contact, 3, v()).y >= 0.004 - 1e-6)
})

test('a sparse imported skirt resolves a leg through the middle of a face and preserves its waist', () => {
  const pelvis = new Group()
  pelvis.name = 'Bip001_Pelvis'
  const rest = new Map([
    [
      pelvis,
      { restWorldPos: pelvis.position, restWorldQuat: pelvis.quaternion, restWorldScale: pelvis.scale },
    ],
  ])
  const bind = [v(-0.09, -0.07, 0.055), v(0.09, -0.07, 0.055), v(0, 0.14, 0.055)]
  const cloth = {
    nodes: bind.map((p, i) => ({
      bind: p,
      mobility: i === 2 ? 0 : 1,
      meshIndex: 0,
      vertex: i,
      materialMask: 52,
    })),
    meshes: [{ mesh: { matrixWorld: new Matrix4(), getVertexPosition: (i, out) => out.copy(bind[i]) } }],
    faces: [[0, 1, 2]],
    edges: [],
  }
  const axis = new Line3(v(0, 0, -0.15), v(0, 0, -0.1))
  const cap = { bindAxis: axis, bindRadius: 0.03, a: axis.start.clone(), b: axis.end.clone() }
  let floor = -0.2
  const c = new GarmentContact({ root: pelvis, rest, bodyMeshes: [], hipRestHeight: 0.5 }, cloth, {
    legCapsules: [cap],
    up: v(0, 1, 0),
    floorDepth: p => floor - p.y,
    update() {},
  })
  c.prepare(true, 1)
  assert.ok(c.skin.every((_, i) => surfaceOffset(c, i, v()).length() < 1e-8))
  cap.b.z = 0.055
  c.prepare(true, 1)
  assert.ok(surfaceOffset(c, 0, v()).z > 0.02)
  assert.ok(surfaceOffset(c, 1, v()).z > 0.02)
  assert.equal(surfaceOffset(c, 2, v()).length(), 0)
  floor = 0.1
  c.prepare(true, 1)
  for (const i of [0, 1]) {
    const offset = surfaceOffset(c, i, v())
    assert.ok(Math.abs(c.skin[i].y + offset.y - floor) < 1e-6)
    assert.ok(offset.z > 0.02, 'the floor projection keeps the leg clearance')
  }
  assert.equal(surfaceOffset(c, 2, v()).length(), 0, 'waist stays pinned')
})

test('preview changes only self-contact work after consecutive one-second windows', () => {
  const budget = new ClothPreviewBudget()
  const advance = (frames, h) => {
    for (let i = 0; i < frames; i++) budget.update(h)
  }
  advance(25, 1 / 25)
  assert.equal(budget.tier, 0)
  advance(25, 1 / 25)
  assert.equal(budget.tier, 1)
  advance(50, 1 / 25)
  assert.equal(budget.tier, 2)
  const cadence = new Set()
  for (let i = 0; i < 4; i++) {
    budget.update(1 / 40)
    cadence.add(budget.stride)
  }
  assert.deepEqual(cadence, new Set([0, 2]))
  advance(116, 1 / 40)
  assert.equal(budget.tier, 1)
  advance(120, 1 / 40)
  assert.equal(budget.tier, 0)
})

test('leg contact carries the adjacent outer sheet while the pinned waist and a distant panel stay in place', () => {
  const positions = [v(0, 0, 0), v(0, 0, 0.006), v(0.006, 0, 0), v(0.5, 0, 0)]
  const nodes = positions.map((_, i) => ({ materialMask: collisionMasks.skirt, mobility: i === 2 ? 0 : 1 }))
  const shifts = [v(0, 0, 0.03), v(0, 0, 0), v(0, 0, 0), v(0, 0, 0)]
  const field = new GarmentDisplacementField({ nodes }, 0.5)
  field.project(positions, shifts)
  assert.equal(shifts[0].z, 0.03)
  assert.ok(shifts[1].z > 0.025 && shifts[1].z <= shifts[0].z)
  assert.equal(shifts[2].lengthSq() + shifts[3].lengthSq(), 0)
  for (const s of shifts) s.set(0, 0, 0)
  field.project(positions, shifts)
  assert.ok(
    shifts.every((s) => !s.lengthSq()),
    'no previous-frame pressure',
  )
})

test('a raised sleeve displaces the supported lock, preserving scalp, skeleton, and bind silhouette', () => {
  const root = new Group()
  const spine = new Bone(),
    arm = new Bone(),
    hair = new Bone(),
    head = new Bone()
  spine.name = 'Bip001_Spine1'
  arm.name = 'Bip001_L_UpperArm'
  hair.name = 'bone_hair_back'
  head.name = 'Bip001_Head'
  root.add(spine)
  spine.add(arm, head)
  head.add(hair)
  head.position.y = 0.2
  root.updateMatrixWorld(true)
  const bones = [spine, arm, hair, head]
  const rest = new Map(
    bones.map((b) => [
      b,
      {
        restWorldPos: b.getWorldPosition(v()),
        restWorldQuat: b.getWorldQuaternion(new Quaternion()),
        restWorldScale: b.getWorldScale(v()),
      },
    ]),
  )
  const skeleton = new Skeleton(bones)
  function skin(g, bone) {
    const n = g.attributes.position.count
    g.setAttribute(
      'skinIndex',
      new Uint16BufferAttribute(Array.from({ length: n }, () => [bone, 0, 0, 0]).flat(), 4),
    )
    g.setAttribute(
      'skinWeight',
      new Float32BufferAttribute(Array.from({ length: n }, () => [1, 0, 0, 0]).flat(), 4),
    )
    const mesh = new SkinnedMesh(g, new MeshBasicMaterial())
    root.add(mesh)
    mesh.bind(skeleton)
    return mesh
  }
  const sleeve = skin(new BoxGeometry(0.12, 0.16, 0.12), 1)
  const bind = [v(0, 0, 0.075), v(0.008, 0, 0.075), v(0, 0.29, 0.075)]
  const g = new BufferGeometry()
  g.setAttribute(
    'position',
    new Float32BufferAttribute(
      bind.flatMap((p) => p.toArray()),
      3,
    ),
  )
  const strand = skin(g, 2)
  const nodes = bind.map((p, i) => ({
    bind: p,
    mobility: 1,
    materialMask: collisionMasks.hair,
    meshIndex: 0,
    vertex: i,
  }))
  const contact = new HairSurfaceContact(
    { rest, restMorphWeights: new Map(), bodyMeshes: [sleeve, strand], hipRestHeight: 0.5 },
    { nodes, meshes: [{ mesh: strand }] },
  )
  const packet = new Float32Array(60)
  contact.project(true, packet, 20)
  assert.ok(packet.every((x) => Math.abs(x) < 1e-7))
  arm.position.z = 0.045
  root.updateMatrixWorld(true)
  const before = bones.map((b) => b.matrixWorld.toArray())
  contact.project(true, packet, 20)
  assert.ok(packet[2] > 0.01 && packet[22] > 0.01)
  assert.equal(packet[42], 0, 'hairline remains pinned to the head')
  assert.deepEqual(
    bones.map((b) => b.matrixWorld.toArray()),
    before,
  )
  const peak = packet[2]
  const restore = contact.checkpoint()
  arm.position.z = 0
  root.updateMatrixWorld(true)
  contact.project(true, packet, 20, 1 / 60)
  const firstRelease = packet[2]
  assert.ok(firstRelease > 0 && firstRelease < peak)
  contact.project(true, packet, 20, 1 / 60)
  const secondRelease = packet[2]
  restore()
  contact.project(true, packet, 20, 1 / 30)
  assert.ok(Math.abs(secondRelease - packet[2]) < 1e-6, 'release depends on elapsed time')
  contact.reset()
  contact.project(true, packet, 20, 1 / 60)
  assert.ok(Math.abs(packet[2]) < 1e-7, 'a seek discards old contact history')
  contact.project(false, packet, 20)
  assert.ok(
    packet.every((x) => x === 0),
    'disabling contact releases the offsets',
  )
})
