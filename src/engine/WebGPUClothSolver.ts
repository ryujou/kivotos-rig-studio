import { Matrix3, Matrix4, Vector3, type Skeleton } from 'three'
import { ColliderGroup, type BodyColliders } from './BodyColliders'
import {
  clothLocalPoint,
  MAX_CAPSULES,
  UNSIMULATED,
  vertexThickness,
  type FineClothMesh,
} from './ClothMeshBuilder'
import { contactStride, type GarmentContact } from './GarmentContact'
import type { StudioModel } from './ModelLoader'
import type { SpringSettings } from './RigDefinition'
import type { GpuBufferLike, GpuComputePipelineLike, GpuDeviceLike, GpuEncoderLike } from './WebGPUContext'

const MAP_READ = 1,
  COPY_SRC = 4,
  COPY_DST = 8,
  UNIFORM = 64,
  STORAGE = 128
const substepHz = 120
const maxSubsteps = 12
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

// Each entry point gets its own inferred layout. Even the collision pass uses
// only four storage bindings, below the WebGPU baseline limit of eight.
const shader = /* wgsl */ `
struct Node {
  position: vec3f, mobility: f32, joints: vec4u, weights: vec4f,
  mesh: u32, mask: u32, floorHeight: f32, skirt: u32,
}
struct Pose { skin: vec3f, prev: vec3f, curr: vec3f, pred: vec3f, contact: vec3f }
struct MeshFrame { bind: mat4x4f, inverseBind: mat4x4f, world: mat4x4f, inverseWorld: mat4x4f }
struct Edge { a: u32, b: u32, compliance: f32, lambda: f32, bindDirection: vec3f, restLength: f32 }
struct Capsule { aRadius: vec4f, bScale: vec4f, mask: u32, stageMetric: u32, localRadius: f32, localScale: f32 }
struct Params {
  count: u32, shapes: u32, bodyCount: u32, dynamic: u32,
  dt: f32, scale: f32, retention: f32, stiffness: f32,
  initialized: u32,
  floorOrigin: vec3f, tether: f32, up: vec3f, thickness: f32,
  stage: mat4x4f, inverseStage: mat4x4f,
}
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> nodes: array<Node>;
@group(0) @binding(2) var<storage, read_write> poses: array<Pose>;
@group(0) @binding(3) var<storage, read> bones: array<mat4x4f>;
@group(0) @binding(4) var<storage, read> meshes: array<MeshFrame>;
@group(0) @binding(5) var<storage, read_write> edges: array<Edge>;
@group(0) @binding(6) var<uniform> batch: vec4u;
@group(0) @binding(7) var<storage, read> capsules: array<Capsule>;
@group(0) @binding(8) var<storage, read> clearance: array<f32>;
@group(0) @binding(9) var<storage, read_write> offsets: array<f32>;

@compute @workgroup_size(64)
fn skin_predict(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= p.count) { return; }
  let n = nodes[i];
  let frame = meshes[n.mesh];
  let local = frame.bind * vec4f(n.position, 1);
  var skinned = vec4f(0);
  for (var k = 0u; k < 4u; k++) {
    skinned += (bones[n.joints[k]] * local) * n.weights[k];
  }
  let meshLocal = (frame.inverseBind * skinned).xyz;
  let goal = (frame.world * vec4f(meshLocal, 1)).xyz;
  let initialized = p.initialized != 0u || batch.y == 0u;
  let oldSkin = select(goal, poses[i].skin, initialized);
  // Each substep sees its own interpolated pose. prev/curr are offsets from
  // skin, so 75% frame transport leaves just 25% of the pose motion as lag.
  let skin = mix(oldSkin, goal, 1.0 / f32(batch.x));
  poses[i].skin = skin;
  poses[i].contact = vec3f(0);
  if (!initialized || n.mobility == 0) {
    poses[i].curr = vec3f(0);
    poses[i].prev = vec3f(0);
  }
  poses[i].pred = skin;
  if (p.dynamic == 0u || n.mobility == 0) { return; }
  let curr = poses[i].curr;
  if (p.dt == 0) {
    poses[i].pred = skin + curr;
    return;
  }
  let velocity = (curr - poses[i].prev) * p.retention;
  let free = curr - 0.25 * (skin - oldSkin) + velocity;
  let pull = 1.0 - pow(max(n.mobility * (0.62 - 0.28 * p.stiffness), 1e-6), p.dt * 60.0);
  let predicted = free * (1 - pull);
  poses[i].pred = skin + predicted;
  // Save only integration velocity. XPBD and contact displacements never
  // become free-flight impulses in the following substep.
  poses[i].prev = predicted - curr;
}

@compute @workgroup_size(64)
fn solve_edges(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= batch.y) { return; }
  let i = batch.x + gid.x;
  let e = edges[i];
  let wa = nodes[e.a].mobility;
  let wb = nodes[e.b].mobility;
  let delta = poses[e.b].pred - poses[e.a].pred;
  let dist = length(delta);
  // Transform the rest chord so reflected and non-uniform slot scales keep their bind shape.
  let rest = e.restLength * length((p.stage * vec4f(e.bindDirection, 0)).xyz);
  let constraint = dist - rest;
  var lambda = select(e.lambda, 0.0, batch.z != 0u);
  if (dist > 1e-8 && abs(constraint) > max(1e-7, 1e-6 * rest)) {
    let h = select(1.0 / 60.0, p.dt, p.dt > 0);
    let alpha = e.compliance / (h * h);
    let step = (-constraint - alpha * lambda) / (wa + wb + alpha);
    let correction = delta * (step / dist);
    poses[e.a].pred -= wa * correction;
    poses[e.b].pred += wb * correction;
    lambda += step;
  }
  edges[i].lambda = lambda;
}

@compute @workgroup_size(64)
fn solve_collisions(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= p.count || nodes[i].mobility == 0) { return; }
  let n = nodes[i];
  var point = poses[i].pred;
  var contact = poses[i].contact;
  for (var c = 0u; c < p.shapes; c++) {
    let cap = capsules[c];
    if ((n.mask & cap.mask) == 0u || cap.aRadius.w <= 0) { continue; }
    var a = cap.aRadius.xyz;
    var b = cap.bScale.xyz;
    var samplePos = point;
    var radius = cap.aRadius.w + p.thickness;
    var clearanceScale = cap.bScale.w;
    // A non-uniform or sheared slot makes a circular bind capsule elliptical.
    // Project in its original metric and transform the correction back to world space.
    if (cap.stageMetric != 0u) {
      a = (p.inverseStage * vec4f(a, 1)).xyz;
      b = (p.inverseStage * vec4f(b, 1)).xyz;
      samplePos = (p.inverseStage * vec4f(point, 1)).xyz;
      radius = cap.localRadius + ${vertexThickness};
      clearanceScale = cap.localScale;
    }
    let axis = b - a;
    let t = clamp(dot(samplePos - a, axis) / max(dot(axis, axis), 1e-16), 0, 1);
    let diff = samplePos - (a + t * axis);
    let dist = length(diff);
    if (c < p.bodyCount) { radius = min(radius, clearance[i * ${MAX_CAPSULES}u + c] * clearanceScale); }
    if (dist < radius) {
      var normal = diff / max(dist, 1e-8);
      if (dist < 1e-8) {
        normal = cross(axis, vec3f(0, 0, 1));
        if (dot(normal, normal) < 1e-12) { normal = vec3f(1, 0, 0); }
        normal = normalize(normal);
      }
      let skirtLeg = n.skirt != 0u && (cap.mask & ${ColliderGroup.legs}u) != 0u;
      if (skirtLeg) {
        let up = select(p.up, vec3f(0, 1, 0), cap.stageMetric != 0u);
        normal = diff - up * dot(diff, up);
        if (dot(normal, normal) < 1e-12) {
          let radial = samplePos - a;
          normal = radial - up * dot(radial, up);
        }
        if (dot(normal, normal) < 1e-12) {
          let side = select(vec3f(1, 0, 0), vec3f(0, 0, 1), abs(up.x) > 0.8);
          normal = side - up * dot(side, up);
        }
        normal = normalize(normal);
      }
      var correction = normal * (radius - dist);
      if (cap.stageMetric != 0u) {
        correction = (p.stage * vec4f(correction, 0)).xyz;
        normal = normalize((transpose(p.inverseStage) * vec4f(normal, 0)).xyz);
        if (skirtLeg) { normal = normalize(correction); }
      }
      point += correction;
      contact += normal;
    }
  }
  if ((n.mask & ${ColliderGroup.floor}u) != 0u) {
    let floorScale = dot(p.stage[1].xyz, p.up);
    let depth = n.floorHeight * floorScale - dot(point - p.floorOrigin, p.up);
    if (depth > 0) { point += p.up * depth; contact += p.up; }
  }
  let displacement = point - poses[i].skin;
  let limit = p.tether * n.mobility;
  if (length(displacement) > limit) { point = poses[i].skin + normalize(displacement) * limit; }
  if (length(point - poses[i].skin) < 1e-6 * p.scale) { point = poses[i].skin; }
  poses[i].pred = point;
  poses[i].contact = contact;
}

@compute @workgroup_size(64)
fn finalize_offsets(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= p.count) { return; }
  let s = poses[i];
  var offset = s.pred - s.skin;
  // Cap the visible, pose-relative surface correction as well as its Verlet
  // velocity. A newly intersecting capsule may request the entire tether at once.
  let change = offset - s.curr;
  let maxChange = 0.225 * p.scale * p.dt;
  if (p.dt > 0 && length(change) > maxChange) {
    offset = s.curr + normalize(change) * maxChange;
  }
  if (p.dynamic != 0u && p.initialized != 0u && p.dt == 0) { offset = s.curr; }
  // Clip in offset space after subtracting the world positions as well.
  // Leave a float32 rounding margin for the mesh-local readback transform.
  let limit = p.tether * nodes[i].mobility * (1.0 - 1e-6);
  if (length(offset) > limit) { offset = normalize(offset) * limit; }
  var velocity = s.prev;
  let maxVel = 0.004 * p.scale;
  if (length(velocity) > maxVel) { velocity = normalize(velocity) * maxVel; }
  if (dot(s.contact, s.contact) > 1e-12) {
    let normal = normalize(s.contact);
    velocity = (velocity - normal * dot(velocity, normal)) * 0.35;
  }
  if (p.dynamic == 0u || (p.initialized == 0u && p.dt == 0.0)) { poses[i].prev = offset; }
  else if (p.dt > 0) { poses[i].prev = offset - velocity; }
  poses[i].curr = offset;
  let off = (meshes[nodes[i].mesh].inverseWorld * vec4f(offset, 0)).xyz;
  offsets[i * 3u] = off.x;
  offsets[i * 3u + 1u] = off.y;
  offsets[i * 3u + 2u] = off.z;
}
`

const kernels = ['skin_predict', 'solve_edges', 'solve_collisions', 'finalize_offsets'] as const
type Kernel = (typeof kernels)[number]
type Programs = Record<Kernel, GpuComputePipelineLike>
const programs = new WeakMap<GpuDeviceLike, Programs>()
function pipelines(device: GpuDeviceLike) {
  let result = programs.get(device)
  if (!result) {
    const module = device.createShaderModule({ code: shader })
    result = Object.fromEntries(
      kernels.map((entryPoint) => [
        entryPoint,
        device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } }),
      ]),
    ) as Programs
    programs.set(device, result)
  }
  return result
}
// This pass reads a frozen snapshot of all particles. Each invocation owns
// one output, including when adjacent faces share a hem or a UV seam.
const surfaceShader = /* wgsl */ `
struct Pose { skin: vec3f, prev: vec3f, curr: vec3f, pred: vec3f, contact: vec3f }
struct Frame { bind: mat4x4f, invBind: mat4x4f, world: mat4x4f, inverseWorld: mat4x4f }
struct Contact { body: vec4f, ids: vec4u, weights: vec4f, plane: vec4f, receiver: vec4f }
@group(0) @binding(0) var<storage,read> poses: array<Pose>;
@group(0) @binding(1) var<storage,read> rows: array<Contact>;
@group(0) @binding(2) var<storage,read> frames: array<Frame>;
@group(0) @binding(3) var<storage,read_write> output: array<f32>;
fn bodyOffset(i:u32) -> vec3f {
  let b = rows[i].body.xyz;
  let base = poses[i].curr;
  return base + b * max(0.0, 1.0-dot(base,b)/max(dot(b,b),1e-20));
}
@compute @workgroup_size(64)
fn surface_contacts(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&rows)) { return; }
  let row = rows[i];
  var offset = bodyOffset(i);
  if (row.receiver.x != 0.0) {
    var d = 0.0;
    for (var j=0u; j<4u; j++) {
      let k=row.ids[j];
      d += row.weights[j]*dot(poses[k].skin+bodyOffset(k),row.plane.xyz);
    }
    offset += clamp(row.receiver.x*max(0.0,row.plane.w-d),-row.receiver.z,row.receiver.z)*row.plane.xyz;
    let b=row.body.xyz;
    offset += b*max(0.0,1.0-dot(offset,b)/max(dot(b,b),1e-20));
  }
  let v=(frames[u32(row.receiver.y)].inverseWorld*vec4f(offset,0)).xyz;
  output[i*3u]=v.x; output[i*3u+1u]=v.y; output[i*3u+2u]=v.z;
}
`
const surfacePipelines = new WeakMap<GpuDeviceLike, GpuComputePipelineLike>()
interface Staging {
  buffer: GpuBufferLike
  pending?: Promise<void>
  transforms: Matrix3[]
}

export class WebGPUClothSolver {
  private readonly resources = new Set<GpuBufferLike>()
  private readonly pipeline: Programs
  private readonly groups
  private readonly batches
  private readonly staging: Staging[]
  private readonly params = new Float32Array(52)
  private readonly integers = new Uint32Array(this.params.buffer)
  private readonly caps = new Float32Array(MAX_CAPSULES * 12)
  private readonly capGroups = new Uint32Array(this.caps.buffer)
  private readonly frames: Float32Array
  private readonly palettes = new Map<Skeleton, { offset: number; matrices: Float32Array }>()
  private readonly scratch = new Matrix4()
  private readonly identity = new Matrix4()
  private readonly inverseStage = new Matrix4()
  private readonly sourceFrame = new Matrix4()
  private readonly point = new Vector3()
  private readonly conversions: { src: number; dst: number }[] = []
  private readonly conversionIds: Map<number, number>[] = []
  private readonly paramBuffer
  private readonly capsuleBuffer
  private readonly boneBuffer
  private readonly frameBuffer
  private readonly skinBuffer: GpuBufferLike
  private readonly skinFloats: Float32Array
  private readonly morphMeshes: { index: number; weights: number[]; nodes: number[] }[] = []
  private readonly stateBuffer
  private readonly output
  private surfacePass?: {
    pipeline: GpuComputePipelineLike
    group: ReturnType<GpuDeviceLike['createBindGroup']>
    buffer: GpuBufferLike
  }
  private readonly outputBytes: number
  private initialized = false
  private hasOffsets = false
  private phase = 0
  private lastDynamic = false
  private disposed = false
  private generation = 0
  private sequence = 0
  private scattered = 0
  private needsCopy = false

  constructor(
    private readonly device: GpuDeviceLike,
    private readonly model: StudioModel,
    private readonly colliders: BodyColliders,
    private readonly cloth: FineClothMesh,
    private readonly onFailure?: () => void,
    readonly surface?: GarmentContact,
  ) {
    const { meshes, nodes, edges, colorBatches } = cloth
    this.outputBytes = nodes.length * 12
    this.frames = new Float32Array(meshes.length * 64)
    const make = (label: string, size: number, usage: number, data?: ArrayBufferView) => {
      const buffer = device.createBuffer({ label, size: Math.max(16, size), usage })
      this.resources.add(buffer)
      if (data?.byteLength) device.queue.writeBuffer(buffer, 0, data)
      return buffer
    }
    const storage = STORAGE | COPY_DST
    try {
      this.pipeline = pipelines(device)
      let boneCount = 0
      for (const { mesh } of meshes) {
        const skeleton = mesh.skeleton
        if (this.palettes.has(skeleton)) continue
        if (!skeleton.boneMatrices) {
          skeleton.init()
          skeleton.update()
        }
        const length = skeleton.bones.length * 16
        this.palettes.set(skeleton, {
          offset: boneCount,
          matrices: skeleton.boneMatrices!.subarray(0, length),
        })
        boneCount += skeleton.bones.length
      }
      const skin = new Uint32Array(cloth.skinData.slice(0))
      nodes.forEach((n, i) => {
        const base = this.palettes.get(meshes[n.meshIndex].mesh.skeleton)!.offset
        for (let k = 0; k < 4; k++) skin[i * 16 + 4 + k] += base
      })
      const chords = new Float32Array(edges.length * 8),
        ids = new Uint32Array(chords.buffer)
      edges.forEach((e, i) => {
        ids[i * 8] = e.a
        ids[i * 8 + 1] = e.b
        chords[i * 8 + 2] = e.bending ? 0.0028 : 0.00018
        this.point
          .subVectors(nodes[e.b].bind, nodes[e.a].bind)
          .normalize()
          .toArray(chords, i * 8 + 4)
        chords[i * 8 + 7] = e.restLength
      })
      this.paramBuffer = make('cloth parameters', this.params.byteLength, UNIFORM | COPY_DST)
      this.stateBuffer = make('cloth positions', nodes.length * 80, storage | COPY_SRC)
      this.boneBuffer = make('cloth bones', boneCount * 64, storage)
      this.frameBuffer = make('cloth mesh frames', this.frames.byteLength, storage)
      this.capsuleBuffer = make('cloth capsules', this.caps.byteLength, storage)
      this.output = make('cloth offsets', this.outputBytes, STORAGE | COPY_SRC | COPY_DST)
      this.skinBuffer = make('cloth skin', skin.byteLength, storage, skin)
      this.skinFloats = new Float32Array(skin.buffer)
      meshes.forEach(({ mesh }, index) => {
        if (mesh.geometry.morphAttributes.position?.length)
          this.morphMeshes.push({
            index,
            weights: [...(model.restMorphWeights.get(mesh) ?? [])],
            nodes: nodes.flatMap((n, i) => (n.meshIndex === index ? [i] : [])),
          })
      })
      const buffers = [
        this.paramBuffer,
        this.skinBuffer,
        this.stateBuffer,
        this.boneBuffer,
        this.frameBuffer,
        make('cloth edges', Math.max(32, chords.byteLength), storage, chords),
        null,
        this.capsuleBuffer,
        make('cloth clearance', cloth.bindClearance.byteLength, storage, cloth.bindClearance),
        this.output,
      ]
      if (surface) {
        const buffer = make('garment contacts', nodes.length * contactStride * 4, storage)
        let pipeline = surfacePipelines.get(device)
        if (!pipeline) {
          pipeline = device.createComputePipeline({
            layout: 'auto',
            compute: {
              module: device.createShaderModule({ code: surfaceShader }),
              entryPoint: 'surface_contacts',
            },
          })
          surfacePipelines.set(device, pipeline)
        }
        const group = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [this.stateBuffer, buffer, this.frameBuffer, this.output].map((buffer, binding) => ({
            binding,
            resource: { buffer },
          })),
        })
        this.surfacePass = { pipeline, group, buffer }
      }
      const group = (
        kernel: Kernel,
        bindings: number[],
        batch?: { buffer: GpuBufferLike; offset: number; size: number },
      ) =>
        device.createBindGroup({
          layout: this.pipeline[kernel].getBindGroupLayout(0),
          entries: bindings.map((binding) => ({
            binding,
            resource: binding === 6 ? batch! : { buffer: buffers[binding]! },
          })),
        })
      // Each prediction reads a different interpolation fraction; all dispatches
      // in a submission share the same uploaded bone palette and frame parameters.
      const steps = new Uint32Array(maxSubsteps * 2 * 64)
      for (let i = 0; i < maxSubsteps; i++) {
        steps.set([i + 1, 0], i * 128)
        steps.set([i + 1, 1], i * 128 + 64)
      }
      const stepBuffer = make('cloth substeps', steps.byteLength, UNIFORM | COPY_DST, steps)
      this.groups = {
        predict: Array.from({ length: 2 * maxSubsteps }, (_, i) =>
          group('skin_predict', [0, 1, 2, 3, 4, 6], {
            buffer: stepBuffer,
            offset: i * 256,
            size: 16,
          }),
        ),
        collide: group('solve_collisions', [0, 1, 2, 7, 8]),
        finalize: group('finalize_offsets', [0, 1, 2, 4, 9]),
      }
      // Uniform offsets must be aligned to 256 bytes. Pre-bind both first-iteration
      // (zero lambda) and continuation ranges; queue writes cannot vary between dispatches.
      const ranges = new Uint32Array(colorBatches.length * 2 * 64)
      colorBatches.forEach(({ offset, count }, i) => {
        ranges.set([offset, count, 1], i * 128)
        ranges.set([offset, count, 0], i * 128 + 64)
      })
      const batchBuffer = make('cloth color ranges', ranges.byteLength, UNIFORM | COPY_DST, ranges)
      this.batches = colorBatches.map(({ count }, i) => ({
        count: Math.ceil(count / 64),
        groups: [0, 1].map((j) =>
          group('solve_edges', [0, 1, 2, 5, 6], {
            buffer: batchBuffer,
            offset: (2 * i + j) * 256,
            size: 16,
          }),
        ),
      }))
      for (const [dst, { vertexToNode }] of meshes.entries()) {
        const map = new Map<number, number>()
        for (const node of vertexToNode) {
          if (node === UNSIMULATED) continue
          const src = nodes[node].meshIndex
          if (src === dst || map.has(src)) continue
          map.set(src, this.conversions.length)
          this.conversions.push({ src, dst })
        }
        this.conversionIds.push(map)
      }
      this.staging = [0, 1, 2].map((i) => ({
        buffer: make('cloth readback ' + i, this.outputBytes, MAP_READ | COPY_DST),
        transforms: this.conversions.map(() => new Matrix3()),
      }))
    } catch (error) {
      for (const buffer of this.resources) buffer.destroy()
      throw error
    }
  }

  private upload(settings: SpringSettings, dt: number, dynamic: boolean) {
    this.colliders.update()
    const { meshes } = this.cloth
    for (const [i, { mesh }] of meshes.entries()) {
      mesh.updateMatrixWorld()
      mesh.bindMatrix.toArray(this.frames, i * 64)
      mesh.bindMatrixInverse.toArray(this.frames, i * 64 + 16)
      mesh.matrixWorld.toArray(this.frames, i * 64 + 32)
      this.scratch
        .copy(mesh.matrixWorld)
        .invert()
        .toArray(this.frames, i * 64 + 48)
    }
    const queue = this.device.queue
    let morphChanged = false
    for (const state of this.morphMeshes) {
      const mesh = meshes[state.index].mesh,
        weights = mesh.morphTargetInfluences ?? []
      if (weights.length === state.weights.length && weights.every((w, i) => w === state.weights[i])) continue
      state.weights = weights.slice()
      for (const i of state.nodes) {
        clothLocalPoint(mesh, this.cloth.nodes[i].vertex, weights, this.point).toArray(
          this.skinFloats,
          i * 16,
        )
      }
      morphChanged = true
    }
    if (morphChanged) queue.writeBuffer(this.skinBuffer, 0, this.skinFloats)
    for (const [skeleton, palette] of this.palettes) {
      skeleton.update()
      // Three can pad/reallocate boneMatrices when WebGL creates its bone texture.
      const matrices = skeleton.boneMatrices!
      if (palette.matrices.buffer !== matrices.buffer)
        palette.matrices = matrices.subarray(0, skeleton.bones.length * 16)
      queue.writeBuffer(this.boneBuffer, palette.offset * 64, palette.matrices)
    }
    const stage = this.model.root.parent?.matrixWorld ?? this.identity
    const scale = stage.getMaxScaleOnAxis()
    // Equal orthogonal axes attain the maximal volume for these axis lengths.
    const nonUniform = Math.abs(stage.determinantAffine()) < scale ** 3 * (1 - 1e-6)
    this.inverseStage.copy(stage).invert()
    const count = Math.min(this.colliders.shapes.length, MAX_CAPSULES)
    for (let i = 0; i < count; i++) {
      const c = this.colliders.shapes[i],
        at = 12 * i
      c.a.toArray(this.caps, at)
      this.caps[at + 3] = c.radius
      c.b.toArray(this.caps, at + 4)
      this.caps[at + 7] = c.bindRadius ? c.radius / c.bindRadius : 1
      this.capGroups[at + 8] = c.group
      const stageMetric = nonUniform && i < this.colliders.bodyShapeCount
      this.capGroups[at + 9] = Number(stageMetric)
      if (stageMetric) {
        const ratio = this.colliders.bodyRadiusScale(i, this.inverseStage, this.scratch)
        this.caps[at + 10] = c.bindRadius * ratio
        this.caps[at + 11] = ratio
      }
    }
    this.integers.set([this.cloth.nodes.length, count, this.colliders.bodyShapeCount, Number(dynamic)])
    this.params[4] = dt
    this.params[5] = scale
    this.params[6] = Math.pow(1 - Math.max(0.35, clamp01(settings.damping)), dt * 60)
    this.params[7] = clamp01(settings.stiffness)
    this.integers[8] = Number(this.initialized && dynamic === this.lastDynamic)
    this.colliders.floorOrigin.toArray(this.params, 12)
    this.params[15] = 0.032 * scale
    this.colliders.up.toArray(this.params, 16)
    this.params[19] = vertexThickness * scale
    stage.toArray(this.params, 20)
    this.inverseStage.toArray(this.params, 36)
    queue.writeBuffer(this.paramBuffer, 0, this.params)
    queue.writeBuffer(this.frameBuffer, 0, this.frames)
    queue.writeBuffer(this.capsuleBuffer, 0, this.caps)
    this.lastDynamic = dynamic
    this.initialized = true
  }

  private submit(settings: SpringSettings, dt: number, dynamic: boolean, slot?: Staging) {
    const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(dt, maxSubsteps / substepHz)) : 0
    const steps = dynamic ? Math.max(1, Math.ceil(elapsed * substepHz)) : 1
    if (dynamic) this.phase += elapsed
    this.upload(settings, elapsed / steps, dynamic)
    const encoder = this.device.createCommandEncoder(),
      pass = encoder.beginComputePass()
    const blocks = Math.ceil(this.cloth.nodes.length / 64)
    for (let step = 0; step < steps; step++) {
      pass.setPipeline(this.pipeline.skin_predict)
      pass.setBindGroup(0, this.groups.predict[(steps - step - 1) * 2 + Number(step === 0)])
      pass.dispatchWorkgroups(blocks)
      for (let iteration = 0; iteration < (dynamic ? 6 : 4); iteration++) {
        pass.setPipeline(this.pipeline.solve_edges)
        for (const batch of this.batches) {
          pass.setBindGroup(0, batch.groups[iteration === 0 ? 0 : 1])
          pass.dispatchWorkgroups(batch.count)
        }
        pass.setPipeline(this.pipeline.solve_collisions)
        pass.setBindGroup(0, this.groups.collide)
        pass.dispatchWorkgroups(blocks)
      }
      pass.setPipeline(this.pipeline.finalize_offsets)
      pass.setBindGroup(0, this.groups.finalize)
      pass.dispatchWorkgroups(blocks)
    }
    if (this.surfacePass) {
      pass.setPipeline(this.surfacePass.pipeline)
      pass.setBindGroup(0, this.surfacePass.group)
      pass.dispatchWorkgroups(blocks)
    }
    pass.end()
    this.sequence++
    this.needsCopy = !slot
    if (slot) return this.readback(encoder, slot)
    this.device.queue.submit([encoder.finish()])
  }

  private readback(encoder: GpuEncoderLike, slot: Staging) {
    const generation = this.generation,
      frame = this.sequence
    this.conversions.forEach(({ src, dst }, i) => {
      const inverse = this.scratch.fromArray(this.frames, dst * 64 + 48)
      slot.transforms[i].setFromMatrix4(
        inverse.multiply(this.sourceFrame.fromArray(this.frames, src * 64 + 32)),
      )
    })
    encoder.copyBufferToBuffer(this.output, 0, slot.buffer, 0, this.outputBytes)
    this.device.queue.submit([encoder.finish()])
    const copy = async () => {
      await slot.buffer.mapAsync(MAP_READ)
      try {
        if (generation !== this.generation || frame <= this.scattered) return
        this.scatterOffsets(new Float32Array(slot.buffer.getMappedRange()), slot)
        this.scattered = frame
      } finally {
        slot.buffer.unmap()
      }
    }
    slot.pending = copy()
      .catch((error) => {
        if (generation === this.generation) {
          this.clear()
          if (!this.onFailure) throw error
          this.onFailure()
        }
      })
      .finally(() => {
        slot.pending = undefined
        // Publish the newest pose when a staging slot becomes available, even after a pause.
        if (this.needsCopy && !this.disposed) {
          this.needsCopy = false
          void this.readback(this.device.createCommandEncoder(), slot).catch(() => {})
        }
      })
    return slot.pending
  }

  private scatterOffsets(values: Float32Array, slot: Staging) {
    this.hasOffsets = true
    for (const [i, { offset, vertexToNode }] of this.cloth.meshes.entries()) {
      const array = offset.array,
        conversions = this.conversionIds[i]
      for (let v = 0; v < vertexToNode.length; v++) {
        const node = vertexToNode[v]
        if (node === UNSIMULATED) continue
        const src = node * 3,
          dst = v * 3
        const transform = conversions.size ? conversions.get(this.cloth.nodes[node].meshIndex) : undefined
        if (transform !== undefined) {
          this.point.fromArray(values, src).applyMatrix3(slot.transforms[transform]).toArray(array, dst)
        } else {
          array[dst] = values[src]
          array[dst + 1] = values[src + 1]
          array[dst + 2] = values[src + 2]
        }
      }
      offset.needsUpdate = true
    }
  }

  prepareSurface(body: boolean, stride: number, dt = 0) {
    if (this.surfacePass && this.surface)
      this.device.queue.writeBuffer(this.surfacePass.buffer, 0, this.surface.prepare(body, stride, dt))
  }

  dispatch(settings: SpringSettings, dt: number, dynamicMode: boolean) {
    if (this.disposed) return
    void this.submit(
      settings,
      dt,
      dynamicMode,
      this.staging.find((slot) => !slot.pending),
    )?.catch(() => {})
  }

  async stepDeterministic(settings: SpringSettings, dt: number, dynamicMode: boolean) {
    const generation = this.generation
    while (this.staging.some((slot) => slot.pending))
      await Promise.all(this.staging.map((slot) => slot.pending))
    if (!this.disposed && generation === this.generation)
      await this.submit(settings, dt, dynamicMode, this.staging[0])
  }

  reseed() {
    this.surface?.reset()
    this.generation++
    this.needsCopy = this.initialized = false
    this.phase = 0
  }

  clear() {
    if (this.initialized || this.hasOffsets) this.reset()
  }

  reset() {
    this.reseed()
    if (!this.hasOffsets) return
    for (const { offset } of this.cloth.meshes) {
      offset.array.fill(0)
      offset.needsUpdate = true
    }
    this.hasOffsets = false
  }

  // Capture temporarily borrows the solver. Preserve Verlet history on-device
  // and the exact visible offsets on the CPU, including when preview was paused.
  checkpoint() {
    const initialized = this.initialized,
      dynamic = this.lastDynamic,
      phase = this.phase
    const restoreSurface = this.surface?.checkpoint()
    const hasOffsets = this.hasOffsets
    const visible = hasOffsets ? this.cloth.meshes.map((m) => m.offset.array.slice()) : []
    const restoreOffsets = () => {
      restoreSurface?.()
      this.hasOffsets = hasOffsets
      visible.forEach((values, i) => {
        const { offset } = this.cloth.meshes[i]
        offset.array.set(values)
        offset.needsUpdate = true
      })
    }
    if (!initialized)
      return () => {
        this.reset()
        restoreOffsets()
      }
    const stateBytes = this.cloth.nodes.length * 80
    const unpublished = this.scattered < this.sequence
    const frames = unpublished ? this.frames.slice() : undefined
    const saved = this.device.createBuffer({
      size: stateBytes + (unpublished ? this.outputBytes : 0),
      usage: COPY_SRC | COPY_DST,
    })
    this.resources.add(saved)
    const encoder = this.device.createCommandEncoder()
    encoder.copyBufferToBuffer(this.stateBuffer, 0, saved, 0, stateBytes)
    if (unpublished) encoder.copyBufferToBuffer(this.output, 0, saved, stateBytes, this.outputBytes)
    this.device.queue.submit([encoder.finish()])
    return () => {
      if (!this.resources.delete(saved)) return
      try {
        this.reset()
        const restore = this.device.createCommandEncoder()
        restore.copyBufferToBuffer(saved, 0, this.stateBuffer, 0, stateBytes)
        if (frames) {
          this.frames.set(frames)
          restore.copyBufferToBuffer(saved, stateBytes, this.output, 0, this.outputBytes)
        }
        this.device.queue.submit([restore.finish()])
        this.initialized = true
        this.lastDynamic = dynamic
        this.phase = phase
        restoreOffsets()
        // If capture interrupted a paused scene's first readback, publish that original
        // result after restoring. No new integration step is needed to recover the pose.
        this.sequence++
        if (unpublished) {
          const slot = this.staging.find((slot) => !slot.pending)
          if (slot) void this.readback(this.device.createCommandEncoder(), slot).catch(() => {})
          else this.needsCopy = true
        } else this.scattered = this.sequence
      } finally {
        saved.destroy()
      }
    }
  }

  dispose() {
    if (this.disposed) return
    this.clear()
    this.disposed = true
    for (const buffer of this.resources) buffer.destroy()
    this.resources.clear()
  }
}
