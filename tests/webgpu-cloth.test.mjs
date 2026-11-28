import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import {
  Bone,
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { detectWebGPU, getWebGPU, onWebGPULost, resetWebGPUCache } from '../src/engine/WebGPUContext.ts'
import { buildFineClothMesh, MAX_CAPSULES, UNSIMULATED } from '../src/engine/ClothMeshBuilder.ts'
import { WebGPUClothSolver } from '../src/engine/WebGPUClothSolver.ts'
import { bodyColliders, collisionMasks } from '../src/engine/BodyColliders.ts'
import { StudioModel } from '../src/engine/ModelLoader.ts'
import { defaultRig } from '../src/engine/RigDefinition.ts'
import { exportClip } from '../src/engine/GifExporter.ts'
import { SceneManager } from '../src/engine/SceneManager.ts'
import { useStudioStore } from '../src/store/useStudioStore.ts'
import { assertAdjustInspector } from './adjust-inspector.mjs'
import { languages } from '../src/i18n/index.ts'

function adapter(fields) {
  return {
    requestAdapter: async () => fields,
  }
}

test('hardware detection sanitizes labels, caches one probe, and publishes device loss', async (t) => {
  const loss = Promise.withResolvers()
  const device = { lost: loss.promise }
  let requests = 0
  const gpu = adapter({
    info: { description: '  \n ', device: '  Apple   GPU  ' + 'X'.repeat(45) },
    requestDevice: async () => {
      requests++
      return device
    },
  })
  const original = Object.getOwnPropertyDescriptor(navigator, 'gpu')
  Object.defineProperty(navigator, 'gpu', { value: gpu, configurable: true })
  t.after(() => {
    if (original) Object.defineProperty(navigator, 'gpu', original)
    else delete navigator.gpu
    resetWebGPUCache()
  })
  resetWebGPUCache()
  const first = getWebGPU()
  assert.equal(first, getWebGPU())
  const state = await first
  assert.equal(state.status, 'webgpu')
  assert.equal(state.device, device)
  assert.equal(state.label, ('Apple GPU ' + 'X'.repeat(45)).slice(0, 36))
  let notifications = 0
  onWebGPULost(state, () => notifications++)
  const remove = onWebGPULost(state, () => assert.fail('removed observer'))
  remove()
  loss.resolve({ reason: 'destroyed' })
  await tick()
  assert.deepEqual(state, { status: 'fallback', label: '', reason: 'device-lost' })
  assert.equal(notifications, 1)
  assert.equal(await getWebGPU(), state)
  assert.equal(requests, 1)
  resetWebGPUCache()
  assert.notEqual(getWebGPU(), first)
})

test('a mobile compatibility adapter can supply cloth compute after the core requests fail', async () => {
  const attempts = []
  const state = await detectWebGPU({
    async requestAdapter(options) {
      attempts.push(options)
      return options.featureLevel === 'compatibility' ? {
        info: { vendor: 'ARM' }, requestDevice: async () => ({ lost: new Promise(() => {}) }),
      } : null
    },
  })
  assert.equal(state.status, 'webgpu')
  assert.deepEqual(attempts, [{ powerPreference: 'high-performance' }, {}, { featureLevel: 'compatibility' }])
})

test('a system-selected hardware device is tried when the high-performance adapter fails', async () => {
  const attempts = []
  const device = { lost: new Promise(() => {}) }
  const state = await detectWebGPU({
    async requestAdapter(options) {
      attempts.push(options)
      return { requestDevice: async () => {
        if (options.powerPreference) throw Error('device unavailable')
        return device
      } }
    },
  })
  assert.equal(state.device, device)
  assert.deepEqual(attempts, [{ powerPreference: 'high-performance' }, {}])
})

test('unavailable, software and failed adapters fall back before allocating compute resources', async () => {
  const fallback = (reason) => ({ status: 'fallback', label: '', reason })
  assert.deepEqual(await detectWebGPU(null), fallback('unsupported'))
  if (!navigator.gpu) assert.deepEqual(await detectWebGPU(), fallback('unsupported'))
  assert.deepEqual(await detectWebGPU(adapter(null)), fallback('no-adapter'))
  for (const fields of [
    { isFallbackAdapter: true },
    { info: { isFallbackAdapter: true } },
    ...['SwiftShader', 'llvmpipe', 'lavapipe', 'Microsoft Basic Render Driver', 'WARP', 'software'].map(
      (name, i) => ({ info: { [['vendor', 'architecture', 'device', 'description'][i % 4]]: name } }),
    ),
  ]) {
    assert.deepEqual(
      await detectWebGPU(
        adapter({
          ...fields,
          requestDevice: () => assert.fail('requested software device'),
        }),
      ),
      fallback('software'),
    )
  }
  assert.deepEqual(
    await detectWebGPU(
      adapter({
        requestDevice: async () => {
          throw Error('denied')
        },
      }),
    ),
    fallback('request-failed'),
  )
  const state = await detectWebGPU(
    adapter({ requestDevice: async () => ({ lost: Promise.reject(Error('lost')) }) }),
  )
  await tick()
  assert.deepEqual(state, fallback('device-lost'))
})

// Two triangles share a geometric edge across both a UV split and a GLTF primitive boundary.
// The first copy of the waist is cloth-weighted, the second is anchored to the pelvis.
function fixture(t, sparse = false) {
  const root = new Group(),
    bones = []
  function joint(name, parent, y) {
    const b = new Bone()
    b.name = name
    b.position.y = y
    parent.add(b)
    bones.push(b)
    return b
  }
  const hip = joint('Bip001', root, 1),
    pelvis = joint('Bip001_Pelvis', hip, 0)
  const thigh = joint('Bip001_L_Thigh', pelvis, -0.04)
  const knee = joint('Bip001_L_Calf', thigh, -0.46)
  joint('Bip001_L_Foot', knee, -0.45)
  if (!sparse) joint('Bone_Skirt', pelvis, -0.15)
  root.updateMatrixWorld(true)
  const source = new MeshBasicMaterial()
  const skeleton = new Skeleton(bones)
  const names = new Map()
  function skin(vertices, indices, weights) {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(vertices.flat(), 3))
    g.setAttribute('skinIndex', new Uint16BufferAttribute(indices.flat(), 4))
    g.setAttribute('skinWeight', new Float32BufferAttribute(weights.flat(), 4))
    const mesh = new SkinnedMesh(g, source)
    mesh.name = 'Body_' + names.size
    names.set(mesh, 'Body')
    root.add(mesh)
    mesh.bind(skeleton)
    return mesh
  }
  const waist = [-0.04, 1.02, 0.02],
    hem = [0.04, 0.78, 0.02]
  const owner = sparse ? 1 : 5
  const ids = (i, j = 0) => [i, j, 0, 0],
    w = [1, 0, 0, 0]
  const left = skin(
    [waist, hem, [-0.04, 0.78, 0.02]],
    [ids(owner), ids(owner), ids(owner, 2)],
    [w, w, [0.7, 0.3, 0, 0]],
  )
  const right = skin(
    [hem, waist, [0.04, 0.95, 0.02], [0, 0.25, 0.02]],
    [ids(owner), ids(1), ids(owner), ids(3)],
    [w, w, w, w],
  )
  right.geometry.setIndex([0, 1, 2])
  left.geometry.setAttribute('uv', new Float32BufferAttribute([0, 1, 0, 0, 1, 0], 2))
  right.geometry.setAttribute('uv', new Float32BufferAttribute([1, 1, 0, 0, 1, 0, 0, 1], 2))
  const prop = new Mesh(left.geometry, source)
  prop.name = 'Bike'
  root.add(prop)
  const model = new StudioModel(root, [], 1, names)
  t.after(() => model.dispose())
  const colliders = bodyColliders(model)
  return { model, left, right, prop, colliders, thigh, knee }
}

test('welding pins shared waist nodes and produces conflict-free stretch and bending dispatch ranges', (t) => {
  const { model, colliders, left } = fixture(t)
  const cloth = buildFineClothMesh(model, colliders)
  assert.equal(cloth, buildFineClothMesh(model, colliders))
  const [a, b] = cloth.meshes.map((m) => m.vertexToNode)
  assert.equal(a[0], b[1])
  assert.equal(a[1], b[0])
  assert.equal(b[3], UNSIMULATED)
  assert.equal(cloth.nodes[a[0]].mobility, 0)
  assert.equal(cloth.nodes[a[1]].mobility, 1)
  assert.ok(Math.abs(cloth.nodes[a[2]].mobility - 0.7 * (1 - 0.3 * 0.85)) < 1e-6)
  assert.equal(cloth.nodes[a[1]].materialMask, collisionMasks.skirt)
  assert.equal(cloth.edges.length, 6)
  const bend = cloth.edges.filter((e) => e.bending)
  assert.deepEqual(
    bend.map((e) => [e.a, e.b].sort()),
    [[a[2], b[2]].sort()],
  )
  let covered = 0
  for (const { offset, count } of cloth.colorBatches) {
    assert.equal(offset, covered)
    const seen = new Set()
    for (const { a, b, restLength } of cloth.edges.slice(offset, offset + count)) {
      assert.ok(!seen.has(a) && !seen.has(b))
      seen.add(a).add(b)
      assert.equal(restLength, cloth.nodes[a].bind.distanceTo(cloth.nodes[b].bind))
    }
    covered += count
  }
  assert.equal(covered, cloth.edges.length)
  assert.equal(left.geometry.getAttribute('clothOffset').usage, DynamicDrawUsage)
  assert.equal(cloth.bindClearance.length, cloth.nodes.length * MAX_CAPSULES)
  for (const [i, node] of cloth.nodes.entries()) {
    const p = cloth.meshes[node.meshIndex].mesh.getVertexPosition(node.vertex, new Vector3())
    assert.ok(node.bind.distanceTo(p) < 1e-7)
    const radii = colliders.bindRadii(p, 0.004, ~0)
    for (let c = 0; c < radii.length; c++) {
      const clearance = cloth.bindClearance[i * MAX_CAPSULES + c]
      assert.ok(Math.abs(clearance - radii[c]) < 1e-6)
      const capsule = colliders.shapes[c]
      const delta = p.clone().sub(capsule.a)
      delta.addScaledVector(
        capsule.segment,
        -Math.max(0, Math.min(1, delta.dot(capsule.segment) * capsule.inverseLengthSq)),
      )
      assert.ok(clearance <= delta.length(), 'zero bind penetration')
    }
  }
})

test('tight skirts without skirt bones admit pelvis and pelvis/thigh blends only inside the hem band', (t) => {
  const { model, colliders, thigh } = fixture(t, true)
  thigh.rotation.z = 0.7 // Late construction must still classify using the immutable bind pose.
  colliders.update()
  const cloth = buildFineClothMesh(model, colliders)
  const [a, b] = cloth.meshes.map((m) => m.vertexToNode)
  assert.deepEqual(
    Array.from(a, (i) => cloth.nodes[i].mobility),
    [0, 0.35, 0.35],
  )
  assert.equal(b[3], UNSIMULATED)
  assert.equal(cloth.nodes[a[1]].materialMask, collisionMasks.skirt)
})

test('all body shading variants and outline hulls use the same post-skin offset; shared props stay independent', (t) => {
  const { model, left, prop } = fixture(t)
  const hull = left.children.find((m) => m.userData.isOutline)
  assert.equal(hull.geometry, left.geometry)
  assert.equal(hull.material.defines.USE_CLOTH_OFFSET, '')
  assert.match(
    hull.material.vertexShader,
    /#include <skinning_vertex>\s+#ifdef USE_CLOTH_OFFSET\s+transformed \+= clothOffset;/,
  )
  assert.equal(prop.geometry.hasAttribute('clothOffset'), false)
  assert.equal(prop.children[0].material.defines.USE_CLOTH_OFFSET, undefined)
  for (const mode of ['unlit', 'softLit', 'wireframe']) {
    model.setShading(mode)
    const compile = (mesh) => {
      const shader = {
        vertexShader: '#include <skinning_vertex>',
        fragmentShader: '#include <opaque_fragment>',
      }
      mesh.material.onBeforeCompile(shader)
      return shader.vertexShader
    }
    assert.match(
      compile(left),
      /attribute vec3 clothOffset;[\s\S]*<skinning_vertex>\s+transformed \+= clothOffset;/,
    )
    assert.doesNotMatch(compile(prop), /clothOffset/)
    assert.notEqual(left.material.customProgramCacheKey(), prop.material.customProgramCacheKey())
    assert.doesNotThrow(() => left.material.onBeforeCompile({ fragmentShader: '#include <opaque_fragment>' }))
  }
})

// Real queue ordering, byte copies and explicit map gates; the finalize kernel's
// synthetic node IDs make a stale or incorrectly scattered readback observable.
function mockDevice() {
  const modules = [],
    pipelines = [],
    buffers = [],
    maps = [],
    dispatches = [],
    writes = []
  let frame = 0
  const device = {
    modules,
    pipelines,
    buffers,
    maps,
    dispatches,
    writes,
    lost: new Promise(() => {}),
    queue: {
      writeBuffer(b, offset, view) {
        assert.ok(b.usage & 8)
        b.bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), offset)
        writes.push(b.label)
      },
      submit(commands) {
        for (const command of commands) {
          if (command.some((run) => run.finalizes)) frame++
          for (const run of command) run()
        }
      },
    },
    createBuffer({ label, size, usage }) {
      const b = {
        label,
        usage,
        bytes: new Uint8Array(size),
        busy: false,
        destroyed: false,
        async mapAsync(mode) {
          assert.equal(mode, 1)
          assert.equal(this.busy, false, 'mapped twice before unmap')
          this.busy = true
          const gate = Promise.withResolvers()
          maps.push(gate)
          await gate.promise
        },
        getMappedRange() {
          assert.ok(this.busy)
          return this.bytes.buffer
        },
        unmap() {
          assert.ok(this.busy)
          this.busy = false
        },
        destroy() {
          this.destroyed = true
        },
      }
      buffers.push(b)
      return b
    },
    createShaderModule(module) {
      modules.push(module)
      return module
    },
    createComputePipeline({ compute }) {
      assert.ok(compute.module.code.includes('fn ' + compute.entryPoint + '('))
      pipelines.push(compute.entryPoint)
      return { name: compute.entryPoint, getBindGroupLayout: () => compute.entryPoint }
    },
    createBindGroup: (group) => group,
    createCommandEncoder() {
      const commands = []
      return {
        beginComputePass() {
          let pipeline, group
          return {
            setPipeline(p) {
              pipeline = p
            },
            setBindGroup(_, g) {
              group = g
            },
            dispatchWorkgroups(blocks) {
              assert.equal(pipeline.name, group.layout)
              const { name } = pipeline,
                bindings = new Map(group.entries.map((e) => [e.binding, e.resource]))
              const range = bindings.get(6)
              dispatches.push([
                name,
                blocks,
                range && [...new Uint32Array(range.buffer.bytes.buffer, range.offset, 3)],
              ])
              if (name === 'finalize_offsets')
                commands.push(
                  Object.assign(
                    () => {
                      const values = new Float32Array(bindings.get(9).buffer.bytes.buffer)
                      for (let i = 0; i < values.length; i++) values[i] = frame * 100 + i
                    },
                    { finalizes: true },
                  ),
                )
            },
            end() {},
          }
        },
        copyBufferToBuffer(src, from, dst, to, size) {
          assert.ok(src.usage & 4 && dst.usage & 8)
          commands.push(() => {
            assert.equal(dst.busy, false)
            dst.bytes.set(src.bytes.subarray(from, from + size), to)
          })
        },
        finish: () => commands,
      }
    },
  }
  return device
}

test('WGSL groups mixed short-circuit operators at every expression depth', (t) => {
  const { model, colliders } = fixture(t)
  const device = mockDevice()
  const solver = new WebGPUClothSolver(device, model, colliders, buildFineClothMesh(model, colliders))
  t.after(() => solver.dispose())
  const { code } = device.modules[0]
  const operators = [null]
  // Parentheses and subscripts nest expressions. Arguments and statements start fresh ones.
  for (const match of code.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|&&|\|\||[()[\]{},;]/g)) {
    const [token] = match
    const depth = operators.length - 1
    if (token === '(' || token === '[') operators.push(null)
    else if (token === ')' || token === ']') operators.pop()
    else if ([',', ';', '{', '}'].includes(token)) operators[depth] = null
    else if (token === '&&' || token === '||') {
      const line = code.slice(0, match.index).split('\n').length
      assert.ok(!operators[depth] || operators[depth] === token, `Mixed && and || on WGSL line ${line}`)
      operators[depth] = token
    }
  }
})

test('a skinned mesh with a null bone palette initializes before its first render', (t) => {
  const { model, colliders, left, thigh } = fixture(t)
  const { skeleton } = left
  skeleton.boneMatrices = null
  thigh.position.x += 0.25
  model.root.updateMatrixWorld(true)
  const device = mockDevice()
  const solver = new WebGPUClothSolver(device, model, colliders, buildFineClothMesh(model, colliders))
  t.after(() => solver.dispose())
  const translationX = skeleton.bones.indexOf(thigh) * 16 + 12
  assert.equal(skeleton.boneMatrices.length, skeleton.bones.length * 16)
  assert.equal(skeleton.boneMatrices[translationX], 0.25)
})

test('cloth error scopes trigger fallback and report any GPU message', async (t) => {
  const { model, colliders } = fixture(t)
  const warn = t.mock.method(console, 'warn', () => {})
  const fallbackGPU = t.mock.fn()
  for (const error of [null, { message: '' }, { message: 'Invalid WGSL' }]) {
    const device = mockDevice()
    const scopes = []
    device.pushErrorScope = (filter) => scopes.push(filter)
    device.popErrorScope = async () => (scopes.pop() === 'validation' ? error : null)
    const solver = SceneManager.prototype.createFineCloth.call({ fallbackGPU }, device, {
      actorModel: model,
      colliders,
    })
    t.after(() => solver.dispose())
    await tick()
    assert.equal(fallbackGPU.mock.callCount(), Number(error !== null))
    assert.deepEqual(
      warn.mock.calls.map((call) => call.arguments),
      error?.message ? [['WebGPU cloth fallback:', error.message]] : [],
    )
    fallbackGPU.mock.resetCalls()
    warn.mock.resetCalls()
  }
})

test('cloth calibration uses the imported shape key and GPU skinning follows subsequent morphs', (t) => {
  const { model, colliders, left } = fixture(t)
  const geometry=left.geometry, pos=geometry.attributes.position
  geometry.morphTargetsRelative=true
  geometry.morphAttributes.position=[new Float32BufferAttribute(Array.from({length:pos.count*3},(_,i)=>i%3===0?.04:0),3)]
  model.restMorphWeights.set(left,[.25])
  left.morphTargetInfluences=[.75]
  const cloth=buildFineClothMesh(model,colliders), id=cloth.meshes[0].vertexToNode[1]
  const expected=(weight)=>pos.getX(1)+weight*.04
  assert.ok(Math.abs(new Float32Array(cloth.skinData)[id*16]-expected(.25))<1e-6)
  const device=mockDevice(), solver=new WebGPUClothSolver(device,model,colliders,cloth)
  const localX=()=>new Float32Array(device.buffers.find(b=>b.label==='cloth skin').bytes.buffer)[id*16]
  solver.dispatch(defaultRig().spring,0,false)
  assert.ok(Math.abs(localX()-expected(.75))<1e-6)
  left.morphTargetInfluences[0]=0
  solver.dispatch(defaultRig().spring,0,false)
  assert.ok(Math.abs(localX()-expected(0))<1e-6)
  solver.dispose()
})

test('compute queues use color batches and triple-buffered readback, drain deterministically, and discard stale frames', async (t) => {
  const { model, colliders, left, right } = fixture(t)
  const cloth = buildFineClothMesh(model, colliders),
    device = mockDevice()
  const solver = new WebGPUClothSolver(device, model, colliders, cloth)
  const settings = defaultRig().spring
  const offset = left.geometry.getAttribute('clothOffset')
  const seam = cloth.meshes[0].vertexToNode[1] * 3
  solver.dispatch(settings, 0, false)
  const names = ['skin_predict', 'solve_edges', 'solve_collisions', 'finalize_offsets']
  assert.deepEqual(device.pipelines, names)
  assert.equal(device.modules[0].code.match(/@workgroup_size\(64\)/g).length, 4)
  for (const name of ['cloth bones', 'cloth mesh frames', 'cloth parameters', 'cloth capsules'])
    assert.ok(device.writes.includes(name))
  const expected = [['skin_predict', 1, [1, 1, 0]]]
  for (let iteration = 0; iteration < 4; iteration++) {
    for (const { offset, count } of cloth.colorBatches)
      expected.push(['solve_edges', Math.ceil(count / 64), [offset, count, Number(!iteration)]])
    expected.push(['solve_collisions', 1, undefined])
  }
  expected.push(['finalize_offsets', 1, undefined])
  assert.deepEqual(device.dispatches, expected)
  const params = device.buffers.find((b) => b.label === 'cloth parameters')
  assert.equal(new Uint32Array(params.bytes.buffer)[8], 0)
  solver.dispatch(settings, 1 / 60, true)
  solver.dispatch(settings, 1 / 60, true)
  assert.equal(device.dispatches.filter((d) => d[0] === 'solve_collisions').length, 4 + 2 * 6 + 2 * 6)
  assert.equal(device.maps.length, 3)
  solver.dispatch(settings, 1 / 60, true)
  assert.equal(device.maps.length, 3)
  assert.equal(solver.needsCopy, true)
  assert.ok(offset.array.every((v) => v === 0))
  let done = false
  const deterministic = solver.stepDeterministic(settings, 1 / 60, true).then(() => {
    done = true
  })
  // Slot 2 publishes frame 3, then takes the pending copy of frame 4.
  device.maps[2].resolve()
  await tick()
  assert.equal(offset.getX(1), 300 + seam)
  assert.equal(device.maps.length, 4)
  assert.equal(solver.needsCopy, false)
  device.maps[3].resolve()
  device.maps[1].resolve()
  await tick()
  assert.equal(offset.getX(1), 400 + seam)
  assert.equal(device.maps.length, 4)
  device.maps[0].resolve()
  await tick()
  assert.equal(offset.getX(1), 400 + seam)
  assert.equal(device.maps.length, 5)
  assert.equal(done, false)
  device.maps[4].resolve()
  await deterministic
  assert.equal(offset.getX(1), 500 + seam)
  assert.equal(offset.getX(1), right.geometry.getAttribute('clothOffset').getX(0))
  assert.equal(right.geometry.getAttribute('clothOffset').getX(3), 0)

  const resume = solver.checkpoint()
  for (const clear of ['clear', 'reset']) {
    solver.dispatch(settings, 0, false)
    solver[clear]()
    assert.ok(offset.array.every((v) => v === 0))
    device.maps.at(-1).resolve()
    await tick()
    assert.ok(offset.array.every((v) => v === 0))
    solver.dispatch(settings, 1 / 60, true)
    assert.equal(new Uint32Array(params.bytes.buffer)[8], 0)
    device.maps.at(-1).resolve()
    await tick()
  }
  resume()
  assert.equal(offset.getX(1), 500 + seam)
  solver.dispatch(settings, 1 / 60, true)
  solver.dispose()
  assert.ok(device.buffers.every((b) => b.destroyed))
  device.maps.at(-1).resolve()
  await tick()
  assert.ok(offset.array.every((v) => v === 0))
})

test('loop reseed keeps visible offsets, discards stale maps and cold-starts the next submission', async (t) => {
  const { model, colliders, left } = fixture(t)
  const device = mockDevice()
  const solver = new WebGPUClothSolver(device, model, colliders, buildFineClothMesh(model, colliders))
  t.after(() => solver.dispose())
  const settings = defaultRig().spring
  solver.dispatch(settings, 1 / 60, true)
  device.maps[0].resolve()
  await tick()
  const offset = left.geometry.getAttribute('clothOffset')
  const before = offset.array.slice()
  assert.ok(before.some((v) => v !== 0))
  solver.dispatch(settings, 1 / 60, true)
  solver.reseed()
  const resume = solver.checkpoint()
  assert.equal(solver.phase, 0)
  assert.deepEqual(offset.array, before)
  device.maps[1].resolve()
  await tick()
  assert.deepEqual(offset.array, before)
  solver.dispatch(settings, 0, true)
  const params = device.buffers.find((b) => b.label === 'cloth parameters')
  assert.equal(new Uint32Array(params.bytes.buffer)[8], 0)
  assert.deepEqual(offset.array, before)
  device.maps[2].resolve()
  await tick()
  assert.notDeepEqual(offset.array, before)
  resume()
  assert.deepEqual(offset.array, before)
  solver.clear()
  assert.ok(offset.array.every((v) => v === 0))
})

test('scene capture publishes GPU results before drawing and cannot draw after its lease ends', async (t) => {
  const { model, colliders, left } = fixture(t),
    device = mockDevice()
  const scene = Object.create(SceneManager.prototype)
  const original = useStudioStore.getState()
  const slot = { ...original.slots[0], motion: 'driver', rig: defaultRig() }
  const engine = {
    actorModel: model,
    driverModel: {},
    colliders,
    duration: 2,
    sample() {},
    reset() {},
    setClip() {},
  }
  const entry = { actor: model, engine }
  const rendered = []
  Object.assign(scene, {
    capturing: true,
    captureRevision: 1,
    slots: new Map([[slot.id, entry]]),
    device,
    props: { sync() {} },
    renderer: {
      getContext: () => ({ isContextLost: () => false }),
      render: () => rendered.push(left.geometry.getAttribute('clothOffset').getX(1)),
    },
  })
  useStudioStore.setState({ slots: [slot] })
  t.after(() => useStudioStore.setState(original, true))
  const sample = scene.sampleDeterministicAsync(0, 0)
  await tick()
  assert.equal(rendered.length, 0)
  device.maps[0].resolve()
  await sample
  assert.ok(rendered[0] >= 100)
  useStudioStore.getState().setSlotRig(slot.id, { gpuCloth: false })
  await scene.sampleDeterministicAsync(0.2, 0)
  assert.equal(rendered[1], 0)
  useStudioStore
    .getState()
    .setSlotRig(slot.id, { gpuCloth: true, spring: { ...slot.rig.spring, enabled: true } })
  const warmup = scene.resetCapturePoseAsync(0.25)
  for (let i = 1; i <= 30; i++) {
    await tick()
    assert.equal(device.maps.length, i + 1)
    device.maps[i].resolve()
  }
  await warmup
  assert.equal(rendered.length, 2)
  const cancelled = scene.sampleDeterministicAsync(0.25, 0)
  await tick()
  scene.captureRevision++
  scene.resetCapturePose()
  device.maps.at(-1).resolve()
  await assert.rejects(cancelled, /stageUnavailable/)
  assert.equal(rendered.length, 2)
  scene.fallbackGPU()
  assert.deepEqual(useStudioStore.getState().gpu, { status: 'fallback', label: '' })
  assert.ok(device.buffers.every((b) => b.destroyed))
  assert.ok(left.geometry.getAttribute('clothOffset').array.every((v) => v === 0))
})

test('GPU detection leaves the localized Adjust controls identical across devices and themes', () => {
  assert.equal(defaultRig().gpuCloth, true)
  const initial = useStudioStore.getInitialState()
  const { theme, gpu } = initial
  try {
    for (const lang of languages) {
      for (const theme of ['light', 'dark']) {
        initial.theme = theme
        for (const enabled of [false, true]) {
          const html = assertAdjustInspector(lang, enabled)
          for (const status of ['probing', 'webgpu', 'fallback']) {
            initial.gpu = { status, label: 'Fixture GPU' }
            assert.equal(assertAdjustInspector(lang, enabled), html)
          }
        }
      }
    }
  } finally {
    Object.assign(initial, { theme, gpu })
  }
})

test('GIF palette and encoded GIF, WebM and PNG frames await reset and sampling before copying pixels', async (t) => {
  const state = useStudioStore.getInitialState()
  let events, drawn, current
  const scene = {
    canvas: { width: 4, height: 4 },
    beginCapture: () => () => events.push('restored'),
    async resetCapturePoseAsync() {
      await tick()
      events.push('reset')
    },
    async sampleDeterministicAsync() {
      events.push('sample')
      current = undefined
      await tick()
      current = events.length
    },
    resetCapturePose: () => assert.fail('sync reset'),
    sampleDeterministic: () => assert.fail('sync sample'),
  }
  class Track {
    requestFrame() {
      assert.ok(current)
      events.push('encoded')
    }
    stop() {}
  }
  class Canvas {
    getContext() {
      return {
        clearRect() {},
        drawImage() {
          assert.ok(current)
          drawn++
          events.push('draw')
        },
        getImageData: () => ({ data: new Uint8ClampedArray(64) }),
      }
    }
    captureStream() {
      const track = new Track()
      return { getVideoTracks: () => [track], getTracks: () => [track] }
    }
    toBlob(cb) {
      cb(new Blob(['frame']))
    }
  }
  class Recorder {
    static isTypeSupported() {
      return true
    }
    state = 'inactive'
    start() {
      this.state = 'recording'
    }
    stop() {
      this.state = 'inactive'
      // A single video track and one SimpleBlock in a known-size EBML segment.
      const bytes = Buffer.from('1a45dfa38018538067961654ae6b82ae801f43b6758ae78100a38581000080aa', 'hex')
      this.ondataavailable({ data: new Blob([bytes]) })
      this.onstop()
    }
  }
  const globals = {
    document: { createElement: () => new Canvas() },
    MediaRecorder: Recorder,
    HTMLCanvasElement: Canvas,
    CanvasCaptureMediaStreamTrack: Track,
    Worker: class {
      postMessage(m) {
        const data =
          m.type === 'finish'
            ? { type: 'done', bytes: new Uint8Array(1) }
            : m.type === 'frame'
              ? { type: 'progress', progress: { current: 1 } }
              : { type: 'ready' }
        queueMicrotask(() => this.onmessage({ data }))
      }
      terminate() {}
    },
  }
  for (const [key, value] of Object.entries(globals)) {
    const saved = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true })
    t.after(() => {
      if (saved) Object.defineProperty(globalThis, key, saved)
      else delete globalThis[key]
    })
  }
  for (const format of ['gif', 'webm', 'png']) {
    events = []
    drawn = 0
    current = undefined
    const result = await exportClip(
      scene,
      format,
      {
        settings: { ...state.exportSettings, fps: 60, quality: 'balanced', background: 'transparent' },
        timeline: { ...state.timeline, duration: 1 / 60 },
        stage: state.stage,
        theme: 'dark',
        springs: true,
        viewport: { width: 4, height: 4, dpr: 1, safe: { x: 0, y: 0, width: 4, height: 4 } },
      },
      new AbortController().signal,
      () => {},
    )
    assert.equal(result.frames, 1)
    assert.equal(drawn, format === 'gif' ? 2 : 1)
    assert.deepEqual(events, [
      ...(format === 'gif' ? ['sample', 'draw'] : []),
      'reset',
      'sample',
      'draw',
      ...(format === 'webm' ? ['encoded'] : []),
      'restored',
    ])
  }
})

test('the submitted pose owns its seam transforms and body clearance under a reflected, non-uniform stage', async (t) => {
  const { model, right, colliders } = fixture(t)
  const cloth = buildFineClothMesh(model, colliders)
  const device = mockDevice(),
    solver = new WebGPUClothSolver(device, model, colliders, cloth)
  t.after(() => solver.dispose())
  const stage = new Group()
  stage.add(model.root)
  stage.scale.set(-2, 0.5, 3)
  stage.rotation.y = 0.3
  right.rotation.z = Math.PI / 2
  colliders.setDynamicCapsules([{ a: new Vector3(1, 2, 3), b: new Vector3(1, 3, 3), radius: 0.03 }])
  solver.dispatch(defaultRig().spring, 0, false)
  const data = device.buffers.find((b) => b.label === 'cloth capsules').bytes.buffer
  const caps = new Float32Array(data),
    groups = new Uint32Array(data)
  for (let i = 0; i < colliders.bodyShapeCount; i++) {
    assert.equal(groups[12 * i + 9], 1)
    assert.ok(Math.abs(caps[12 * i + 10] - colliders.shapes[i].bindRadius) < 1e-7)
    assert.equal(caps[12 * i + 11], 1)
  }
  const weapon = 12 * colliders.bodyShapeCount
  assert.equal(groups[weapon + 9], 0)
  assert.deepEqual([...caps.slice(weapon, weapon + 3)], [1, 2, 3])
  right.rotation.z = 0
  right.updateMatrixWorld(true)
  device.maps[0].resolve()
  await tick()
  const offset = right.geometry.getAttribute('clothOffset')
  const x = 100 + 3 * cloth.meshes[1].vertexToNode[0]
  assert.ok(Math.abs(offset.getX(0) - (x + 1)) < 1e-5)
  assert.ok(Math.abs(offset.getY(0) + x) < 1e-5)
  assert.ok(Math.abs(offset.getZ(0) - (x + 2)) < 1e-5)
  // Disposing a solver also releases a capture checkpoint whose lease was abandoned.
  const resume = solver.checkpoint()
  solver.dispose()
  resume()
  assert.ok(device.buffers.every((b) => b.destroyed))
})

test('hanging hair receives its contact mask while bangs and wings stay anchored', (t) => {
  for (const name of ['Hair_Back', 'Hair_F_01', 'Wing_L']) {
    const { model, colliders } = fixture(t)
    model.root.getObjectByName('Bone_Skirt').name = name
    const cloth = buildFineClothMesh(model, colliders)
    if (name === 'Hair_Back') {
      const hem = cloth.meshes[0].vertexToNode[1]
      assert.equal(cloth.nodes[hem].materialMask, collisionMasks.hair)
    } else {
      assert.equal(cloth, null)
      assert.equal(buildFineClothMesh(model, colliders), null)
    }
  }
})

test('capture restores an unpublished preview readback even when the timeline remains paused', async (t) => {
  const { model, left, colliders } = fixture(t),
    device = mockDevice()
  const cloth = buildFineClothMesh(model, colliders)
  const solver = new WebGPUClothSolver(device, model, colliders, cloth)
  t.after(() => solver.dispose())
  const spring = defaultRig().spring
  solver.dispatch(spring, 1 / 60, true)
  const restore = solver.checkpoint()
  solver.reset()
  device.maps[0].resolve()
  await tick()
  const sample = solver.stepDeterministic(spring, 1 / 60, true)
  device.maps[1].resolve()
  await sample
  const attr = left.geometry.getAttribute('clothOffset')
  const node = cloth.meshes[0].vertexToNode[1]
  assert.equal(attr.getX(1), 200 + node * 3)
  restore()
  assert.equal(attr.getX(1), 0)
  device.maps[2].resolve()
  await tick()
  assert.equal(attr.getX(1), 100 + node * 3)
  assert.equal(device.dispatches.filter((d) => d[0] === 'finalize_offsets').length, 4)
})

test('fine cloth stays welded and smoothly bounded when a knee enters and leaves the hem', async (t) => {
  const { cpuClothDevice } = await import('./cloth-kernel-reference.mjs')
  const { model, colliders, left, right, thigh } = fixture(t)
  const cloth = buildFineClothMesh(model, colliders)
  const solver = new WebGPUClothSolver(cpuClothDevice(), model, colliders, cloth)
  t.after(() => solver.dispose())
  const spring = { ...defaultRig().spring, enabled: true }
  const previous = new Vector3(),
    current = new Vector3()
  const attr = left.geometry.getAttribute('clothOffset')
  let peak = 0
  for (let i = 0; i < 65; i++) {
    if (i === 5) thigh.position.x += 0.037
    if (i === 35) thigh.position.x -= 0.037
    await solver.stepDeterministic(spring, 1 / 60, true)
    current.fromBufferAttribute(attr, 1)
    if (i < 5) assert.equal(current.length(), 0)
    peak = Math.max(peak, current.length())
    assert.ok(current.distanceTo(previous) < 0.004)
    assert.ok(current.length() <= 0.032)
    assert.ok(
      current.equals(new Vector3().fromBufferAttribute(right.geometry.getAttribute('clothOffset'), 0)),
    )
    previous.copy(current)
  }
  assert.ok(peak > 0.001, 'knee contact must displace the hem')
})

test('a skirt vertex directly over a raised leg cap receives only horizontal contact and releases without a launch', async (t) => {
  const { cpuClothDevice } = await import('./cloth-kernel-reference.mjs')
  for (const tilted of [false, true]) {
    const { model, colliders, left, thigh, knee } = fixture(t)
    const cloth = buildFineClothMesh(model, colliders)
    const hem = left.getVertexPosition(1, new Vector3())
    const thighRest = thigh.position.clone()
    // Isolate capsule projection from forces produced by neighboring constrained edges.
    const solver = new WebGPUClothSolver(cpuClothDevice(), model, colliders, {
      ...cloth,
      edges: [],
      colorBatches: [],
    })
    t.after(() => solver.dispose())
    const stage = new Group()
    if (tilted) {
      stage.rotation.z = 0.4
      stage.scale.set(-1.3, 0.9, 1.1)
    }
    stage.add(model.root)
    const spring = defaultRig().spring
    await solver.stepDeterministic(spring, 1 / 60, true)
    thigh.position.copy(thigh.parent.worldToLocal(hem.clone().applyMatrix4(stage.matrixWorld)))
    thigh.position.y += Math.abs(knee.position.y) * 0.16 - 0.009
    for (let f = 0; f < 12; f++) await solver.stepDeterministic(spring, 1 / 60, true)
    const offset = () => new Vector3().fromBufferAttribute(left.geometry.getAttribute('clothOffset'), 1)
    const contact = offset()
    assert.ok(contact.length() > 0.002)
    assert.ok(Math.abs(contact.y) < 1e-6, 'leg cap lifts the hem')
    thigh.position.copy(thighRest)
    await solver.stepDeterministic(spring, 1 / 60, true)
    assert.ok(offset().length() <= contact.length())
    assert.ok(Math.abs(offset().y) < 1e-6)
  }
})

test('scene loop rollover preserves the fine mesh while seek, placement, clip and capture reset it', (t) => {
  const initial = useStudioStore.getState()
  const slot = { ...initial.slots[0], rig: defaultRig(), clip: 'Walk' }
  useStudioStore.setState({ slots: [slot], timeline: { ...initial.timeline, playing: true, loop: true } })
  t.after(() => useStudioStore.setState(initial, true))
  const events = []
  const boneResets = []
  const timesteps = []
  const engine = {
    actorModel: {}, driverModel: {}, duration: 1, setClip() {},
    sample(_time, dt) { timesteps.push(dt) },
    reset(keepSpring) { boneResets.push(keepSpring) },
  }
  const entry = { engine, gpuCloth: { reset: () => events.push('reset'), reseed: () => events.push('reseed') } }
  const scene = Object.assign(Object.create(SceneManager.prototype), {
    capturing: true, slots: new Map([[slot.id, entry]]), props: { sync() {} },
  })
  const sample = (time, wrapped = false) => scene.samplePose(time, 1 / 60, wrapped, false, 'interactive')
  sample(0.99)
  sample(1.01)
  sample(0.02, true)
  initial.setTimeline({ seekRevision: initial.timeline.seekRevision + 1 })
  sample(0.01, true)
  entry.placementChanged = true
  sample(0.02, true)
  entry.placementChanged = false
  useStudioStore.setState({ slots: [{ ...slot, clip: 'Victory' }] })
  sample(0.03, true)
  scene.samplePose(0.01, 1 / 60, true, true, 'capture')
  assert.deepEqual(events, ['reset', 'reseed', 'reseed', 'reset', 'reset', 'reset', 'reset'])
  assert.deepEqual(boneResets, [false, true, true, false, false, false, false])
  assert.deepEqual(timesteps.slice(0, 6), [0, 1 / 60, 1 / 60, 0, 0, 0])
})

test('fine cloth has no independent wind oscillation on a stationary posed skeleton', async (t) => {
  const { cpuClothDevice } = await import('./cloth-kernel-reference.mjs')
  const { model, colliders, left } = fixture(t)
  const solver = new WebGPUClothSolver(cpuClothDevice(), model, colliders, buildFineClothMesh(model, colliders))
  t.after(() => solver.dispose())
  const spring = { ...defaultRig().spring, enabled: true, wind: 1 }
  for (let i = 0; i < 30; i++) {
    await solver.stepDeterministic(spring, 1 / 120, true)
    assert.ok(left.geometry.getAttribute('clothOffset').array.every((value) => value === 0))
  }
})
