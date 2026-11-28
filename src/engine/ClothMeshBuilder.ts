import { SkinnedMesh, Vector3, type BufferAttribute, type Object3D } from 'three'
import { bindSkinMatrices, collisionMasks, type BodyColliders, type ClothMaterial } from './BodyColliders'
import { discoverCloth } from './ClothTopology'
import { rigBones, type StudioModel } from './ModelLoader'
import { ensureClothOffsetAttribute } from './OutlineEffect'
import { canonicalBoneName } from './RigDefinition'

export const MAX_CAPSULES = 16
export const UNSIMULATED = 0xffffffff
export const vertexThickness = 0.004

interface Node {
  bind: Vector3
  meshIndex: number
  vertex: number
  mobility: number
  materialMask: number
}
export interface ClothEdge {
  a: number
  b: number
  restLength: number
  bending: boolean
}
export type ClothFace = [number, number, number]
export interface FineClothMesh {
  faces: ClothFace[]
  meshes: { mesh: SkinnedMesh; offset: BufferAttribute; vertexToNode: Uint32Array }[]
  nodes: Node[]
  // Four vec4s per node: local position/mobility, palette indices, weights, mesh/mask/floor.
  skinData: ArrayBuffer
  bindClearance: Float32Array
  edges: ClothEdge[]
  colorBatches: { offset: number; count: number }[]
}
const morphDelta = new Vector3()
const morphPoint = new Vector3()
// A GLB can open with nonzero shape keys. Calibrate against the saved weights,
// even when the solver is first created in the middle of a different animation.
export function clothLocalPoint(
  mesh: SkinnedMesh,
  vertex: number,
  weights: readonly number[] | undefined,
  out: Vector3,
) {
  const { geometry } = mesh
  out.fromBufferAttribute(geometry.attributes.position, vertex)
  const shapes = geometry.morphAttributes.position
  if (!shapes || !weights) return out
  morphDelta.set(0, 0, 0)
  for (let j = 0; j < shapes.length; j++) {
    if (!weights[j]) continue
    morphPoint.fromBufferAttribute(shapes[j], vertex)
    if (!geometry.morphTargetsRelative) morphPoint.sub(out)
    morphDelta.addScaledVector(morphPoint, weights[j])
  }
  return out.add(morphDelta)
}

const cache = new WeakMap<StudioModel, FineClothMesh | null>()

function triangles(mesh: SkinnedMesh, ids: Uint32Array, visit: (a: number, b: number, c: number) => void) {
  const index = mesh.geometry.index
  const count = index?.count ?? ids.length
  for (let i = 0; i + 2 < count; i += 3) {
    const a = ids[index?.getX(i) ?? i],
      b = ids[index?.getX(i + 1) ?? i + 1],
      c = ids[index?.getX(i + 2) ?? i + 2]
    if (a !== b && b !== c && c !== a) visit(a, b, c)
  }
}

function colorEdges(edges: ClothEdge[], nodeCount: number) {
  const used = Array.from({ length: nodeCount }, () => new Set<number>())
  const batches: ClothEdge[][] = []
  for (const edge of edges) {
    let color = 0
    while (used[edge.a].has(color) || used[edge.b].has(color)) color++
    used[edge.a].add(color)
    used[edge.b].add(color)
    const batch = (batches[color] ??= [])
    batch.push(edge)
  }
  let offset = 0
  const colorBatches = batches.map((batch) => {
    const range = { offset, count: batch.length }
    offset += batch.length
    return range
  })
  return { edges: batches.flat(), colorBatches }
}

function build(model: StudioModel, colliders: BodyColliders): FineClothMesh | null {
  const bones = rigBones(model)
  const movable = new Map<Object3D, ClothMaterial>()
  let skirts = 0,
    pelvis = -Infinity,
    knee = Infinity
  for (const j of discoverCloth(bones, model.rest, new Set(), colliders)) {
    if (j.bangs || j.material === 'wing') continue
    if (j.material === 'skirt' && colliders.skinned.has(j.bone)) skirts++
    if (!j.attachment) movable.set(j.bone, j.material)
  }
  for (const bone of bones) {
    const name = canonicalBoneName(bone.name)
    if (name === 'bip001_pelvis') pelvis = model.rest.get(bone)!.restWorldPos.y
    if (/^bip001_[lr]_calf$/.test(name)) knee = Math.min(knee, model.rest.get(bone)!.restWorldPos.y)
  }

  const nodes: Node[] = []
  const meshes: FineClothMesh['meshes'] = []
  const groups = new Map<string | SkinnedMesh, Map<string, number>>()
  const local = new Vector3(),
    part = new Vector3(),
    world = new Vector3()
  for (const mesh of model.bodyMeshes) {
    if (!(mesh instanceof SkinnedMesh) || !mesh.skeleton) continue
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes
    if (!position || !skinIndex || !skinWeight) continue
    const key = model.meshGroups.get(mesh) || mesh.name.replace(/_\d+$/, '') || mesh
    let weld = groups.get(key)
    if (!weld) groups.set(key, (weld = new Map()))
    const matrices = bindSkinMatrices(model, mesh)
    const kinds = mesh.skeleton.bones.map((b) => movable.get(b))
    const names = mesh.skeleton.bones.map((b) => canonicalBoneName(b.name))
    const core = names.map((n) =>
      /^(?:bip001|(?:bip001_)?(?:[lr]_)?(?:pelvis|spine\d*|neck|head|clavicle|upperarm|forearm|hand|thigh|calf|foot)(?:_twist)?)$/.test(
        n,
      ),
    )
    const vertexToNode = new Uint32Array(position.count)
    for (let i = 0; i < position.count; i++) {
      let clothW = 0,
        coreW = 0,
        pelvisW = 0,
        thighW = 0,
        largest = 0,
        dominant = '',
        mask = 0
      clothLocalPoint(mesh, i, model.restMorphWeights.get(mesh), local)
      world.set(0, 0, 0)
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(i, k),
          joint = skinIndex.getComponent(i, k)
        const matrix = matrices[joint]
        if (!(w > 0) || !matrix) continue
        world.addScaledVector(part.copy(local).applyMatrix4(matrix), w)
        const name = names[joint],
          kind = kinds[joint]
        if (kind) {
          clothW += w
          mask |= collisionMasks[kind]
        }
        if (core[joint]) coreW += w
        if (name === 'bip001_pelvis') pelvisW += w
        if (/^bip001_[lr]_thigh(?:_twist)?$/.test(name)) thighW += w
        if (w > largest) {
          largest = w
          dominant = name
        }
      }
      let mobility = Math.min(1, Math.max(0, clothW * (1 - coreW * 0.85)))
      if (mobility < 0.05) mobility = 0
      if (
        !mobility &&
        skirts < 3 &&
        world.y < pelvis &&
        world.y > knee &&
        pelvisW > 0 &&
        (dominant === 'bip001_pelvis' || (thighW > 0 && pelvisW + thighW >= 0.99))
      ) {
        mobility = 0.35
        mask = collisionMasks.skirt
      }
      const coord =
        Math.round(world.x * 1e4) + ',' + Math.round(world.y * 1e4) + ',' + Math.round(world.z * 1e4)
      let id = weld.get(coord)
      if (id === undefined) {
        id = nodes.length
        weld.set(coord, id)
        nodes.push({ bind: world.clone(), meshIndex: meshes.length, vertex: i, mobility, materialMask: mask })
      } else {
        nodes[id].mobility = Math.min(nodes[id].mobility, mobility)
        nodes[id].materialMask |= mask
      }
      vertexToNode[i] = id
    }
    meshes.push({ mesh, offset: ensureClothOffsetAttribute(mesh.geometry), vertexToNode })
  }
  if (!nodes.some((n) => n.mobility > 0)) return null

  // Keep fixed neighbors as anchors. Unrelated body vertices never reach the GPU.
  const used = Uint8Array.from(nodes, (n) => Number(n.mobility > 0))
  const edges: ClothEdge[] = []
  const structural = new Map<number, number>(),
    bending = new Set<number>()
  const key = (a: number, b: number) => Math.min(a, b) * nodes.length + Math.max(a, b)
  const add = (a: number, b: number, bend: boolean) => {
    if (a === b || !(nodes[a].mobility || nodes[b].mobility)) return
    used[a] = used[b] = 1
    edges.push({ a, b, restLength: nodes[a].bind.distanceTo(nodes[b].bind), bending: bend })
  }
  const side = (a: number, b: number, opposite: number) => {
    const id = key(a, b),
      first = structural.get(id)
    if (first === undefined) {
      structural.set(id, opposite)
      add(a, b, false)
    } else if (!bending.has(key(first, opposite))) {
      bending.add(key(first, opposite))
      add(first, opposite, true)
    }
  }
  for (const { mesh, vertexToNode } of meshes) {
    triangles(mesh, vertexToNode, (a, b, c) => {
      side(a, b, c)
      side(b, c, a)
      side(c, a, b)
    })
  }

  const remap = new Uint32Array(nodes.length).fill(UNSIMULATED)
  const compact = nodes.filter((_, i) => used[i])
  let next = 0
  for (let i = 0; i < used.length; i++) if (used[i]) remap[i] = next++
  for (const edge of edges) {
    edge.a = remap[edge.a]
    edge.b = remap[edge.b]
  }
  const meshIndices: number[] = []
  const participating = meshes.filter(({ vertexToNode }, i) => {
    let active = false
    for (let v = 0; v < vertexToNode.length; v++) {
      vertexToNode[v] = remap[vertexToNode[v]]
      if (vertexToNode[v] !== UNSIMULATED) active = true
    }
    if (active) meshIndices.push(i)
    return active
  })
  const faces: ClothFace[] = []
  for (const { mesh, vertexToNode } of participating) {
    triangles(mesh, vertexToNode, (a, b, c) => {
      if (
        a !== UNSIMULATED &&
        b !== UNSIMULATED &&
        c !== UNSIMULATED &&
        (compact[a].mobility || compact[b].mobility || compact[c].mobility)
      )
        faces.push([a, b, c])
    })
  }
  const skinData = new ArrayBuffer(compact.length * 64)
  const floats = new Float32Array(skinData),
    uints = new Uint32Array(skinData)
  const bindClearance = new Float32Array(compact.length * MAX_CAPSULES)
  compact.forEach((n, i) => {
    n.meshIndex = meshIndices.indexOf(n.meshIndex)
    const mesh = participating[n.meshIndex].mesh
    const { skinIndex, skinWeight } = mesh.geometry.attributes
    const base = i * 16
    clothLocalPoint(mesh, n.vertex, model.restMorphWeights.get(mesh), local).toArray(floats, base)
    floats[base + 3] = n.mobility
    for (let k = 0; k < 4; k++) {
      uints[base + 4 + k] = skinIndex.getComponent(n.vertex, k)
      floats[base + 8 + k] = skinWeight.getComponent(n.vertex, k)
    }
    uints[base + 12] = n.meshIndex
    uints[base + 13] = n.materialMask
    // Preserve authored floor intersections just as bindRadii preserves capsule clearance.
    floats[base + 14] = Math.min(vertexThickness, n.bind.y - 0.002)
    // Decide after welding so every copy of a seam sees the same contact model.
    uints[base + 15] = Number(n.materialMask === collisionMasks.skirt)
    bindClearance.set(
      colliders.bindRadii(n.bind, vertexThickness, ~0).subarray(0, MAX_CAPSULES),
      i * MAX_CAPSULES,
    )
  })
  return {
    meshes: participating,
    nodes: compact,
    faces,
    skinData,
    bindClearance,
    ...colorEdges(edges, compact.length),
  }
}

export function buildFineClothMesh(model: StudioModel, colliders: BodyColliders) {
  if (!cache.has(model)) cache.set(model, build(model, colliders))
  return cache.get(model) ?? null
}
