// node --experimental-transform-types --import ./tests/loader.mjs scripts/check-cloth.mjs [DRIVER ACTOR...]
// Inputs can be upstream URLs, local GLBs, or "-" for a driver streamed over stdin.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buffer } from 'node:stream/consumers'
import { pathToFileURL } from 'node:url'
import { Vector3 } from 'three'
import { ModelLoader, rigBones } from '../src/engine/ModelLoader.ts'
import { RetargetEngine } from '../src/engine/RetargetEngine.ts'
import { defaultRig, canonicalBoneName } from '../src/engine/RigDefinition.ts'
import { SpringBoneSolver } from '../src/engine/SpringBoneSolver.ts'
import { ColliderGroup } from '../src/engine/BodyColliders.ts'
import { fallbackCatalog } from '../src/data/fallbackCatalog.ts'

const upstream = (name) => new URL(encodeURIComponent(name) + '.glb', fallbackCatalog.base).href
const drapeClips = ['Victory_Start', 'Cafe_Walk']

export async function load(input) {
  // Skinning uses the original meshes, inverse binds and animation interpolants.
  globalThis.self ??= globalThis
  globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} })
  const loader = new ModelLoader(1)
  let bytes
  if (input === '-') bytes = await buffer(process.stdin)
  else if (/^https?:/.test(input)) {
    const response = await fetch(input)
    assert.ok(response.ok, input + ' HTTP ' + response.status)
    return loader.load(await response.arrayBuffer())
  } else bytes = await readFile(input)
  return loader.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

export function materialVertices(model, particles, material) {
  const bones = new Set(particles.filter((p) => p.material === material).map((p) => p.bone))
  const vertices = []
  for (const mesh of model.bodyMeshes) {
    if (!mesh.isSkinnedMesh) continue
    const { skinIndex, skinWeight } = mesh.geometry.attributes
    for (let i = 0; i < skinWeight.count; i++) {
      let dominant = 0
      for (let k = 1; k < 4; k++)
        if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, dominant)) dominant = k
      if (bones.has(mesh.skeleton.bones[skinIndex.getComponent(i, dominant)])) vertices.push([mesh, i])
    }
  }
  return vertices
}

function rotationDeg(p, model) {
  // The original float32 quaternions are not quite unit length.
  return (
    (p.bone.quaternion.clone().normalize().angleTo(model.rest.get(p.bone).restLocalQuat.clone().normalize()) *
      180) /
    Math.PI
  )
}

export function bindDeflection(model, colliders) {
  const solver = new SpringBoneSolver(rigBones(model), model.rest, new Set(), defaultRig().spring, colliders)
  solver.solveStaticCollisions()
  const skirt = solver.particles.filter((p) => p.material === 'skirt')
  const maxDeg = Math.max(0, ...skirt.map((p) => rotationDeg(p, model)))
  solver.restore()
  assert.ok(maxDeg < 0.001, `bind skirt deflection ${maxDeg}°`)
  return maxDeg
}

const point = new Vector3(),
  delta = new Vector3()
export function penetration(vertices, thighs) {
  let total = 0,
    contacts = 0,
    worst = 0
  for (const [mesh, index] of vertices) {
    mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld)
    let depth = 0
    for (const s of thighs) {
      delta.subVectors(point, s.a)
      const t = Math.max(0, Math.min(1, delta.dot(s.segment) * s.inverseLengthSq))
      depth = Math.max(depth, s.radius - delta.addScaledVector(s.segment, -t).length())
    }
    total += depth
    if (depth > 0) contacts++
    worst = Math.max(worst, depth)
  }
  assert.ok(Number.isFinite(total))
  return { total, contacts, worst }
}

function drapeAtFrame(model, skirt, waist, hems, context) {
  let maxRootDeg = 0,
    height = 0,
    downwardRoots = 0
  for (const p of skirt) {
    const angle = rotationDeg(p, model)
    if (!p.depth) maxRootDeg = Math.max(maxRootDeg, angle)
    else assert.ok(angle <= 52.001, `${context}: ${p.bone.name} bent ${angle}°`)
  }
  assert.ok(maxRootDeg < 42, `${context}: root bent ${maxRootDeg}°`)
  for (const p of waist) {
    const dy =
      point.copy(p.tip).applyMatrix4(p.bone.matrixWorld).y - delta.setFromMatrixPosition(p.bone.matrixWorld).y
    height += dy
    if (p.depth === 0 && dy < 0) downwardRoots++
  }
  assert.ok(height < 0 && downwardRoots > 0, `${context}: skirt lifted horizontally`)
  for (const hem of hems) {
    const tipY = point.copy(hem.tip).applyMatrix4(hem.bone.matrixWorld).y
    const waistY = delta.setFromMatrixPosition(hem.chain.matrixWorld).y
    assert.ok(tipY < waistY, `${context}: ${hem.bone.name} lifted above the waistband`)
  }
  return { maxRootDeg, meanDy: height / waist.length, downwardRoots }
}

function checkActor(model, driver, clips, log) {
  const engine = new RetargetEngine(model, driver)
  try {
    const bindDeg = bindDeflection(model, engine.colliders)
    const rig = defaultRig()
    const off = { ...rig, antiClip: false }
    engine.sample(0, 0, off)
    const { particles, rings } = engine.spring
    assert.ok(rings.every((r) => r.particles.every((p) => p.material === 'skirt')))
    const skirt = particles.filter((p) => p.material === 'skirt')
    const waist = skirt.filter((p) => canonicalBoneName(p.hub.name) === 'bip001_pelvis')
    const waistParents = new Set(waist.map((p) => p.bone.parent))
    const hems = waist.filter((p) => !waistParents.has(p.bone))
    const body = model.bodyMeshes[0]?.name
    const expectedRoots = body?.startsWith('CH0230_') ? 8 : body?.startsWith('Aru_Original_') ? 6 : 0
    const mika = driver.bodyMeshes.some((m) => m.name.startsWith('CH0069_'))
    const waistPanels = waist.filter((p) => p.depth === 0).length
    if (expectedRoots) {
      assert.equal(waistPanels, expectedRoots)
      assert.equal(hems.length, expectedRoots)
    }
    const vertices = materialVertices(model, particles, skirt.length ? 'skirt' : 'cloth')
    const thighs = engine.colliders.shapes.filter((s) => s.group === ColliderGroup.thigh)
    assert.ok(vertices.length && thighs.length === 2)
    log?.log(body, {
      shapes: engine.colliders.shapes.length,
      classes: Object.fromEntries(
        ['cloth', 'hair', 'skirt', 'wing'].map((material) => {
          const group = particles.filter((p) => p.material === material)
          return [material, { roots: new Set(group.map((p) => p.chain)).size, particles: group.length }]
        }),
      ),
      rings: rings.map((r) => [r.particles[0].hub.name, r.particles.length, r.closed ? 'closed' : 'open']),
      bindSkirtDeg: skirt.length ? bindDeg : null,
      waistPanels,
      vertices: vertices.length,
    })
    const results = []
    for (const name of clips) {
      engine.setClip(name)
      const times = Array.from({ length: Math.ceil(engine.duration * 30) + 1 }, (_, i) =>
        Math.min(i / 30, engine.duration),
      )
      if (name === 'Victory_Start' && engine.duration >= 2.33) times.push(2.33)
      times.sort((a, b) => a - b)
      let baseline = 0
      for (const [mode, settings] of [
        ['off', off],
        ['antiClip', rig],
        ['dynamic', { ...off, spring: { ...rig.spring, enabled: true } }],
      ]) {
        engine.reset()
        let total = 0,
          worst = 0,
          contacts = 0,
          maxRootDeg = 0,
          highestMeanDy = -Infinity
        let at233
        for (const [i, time] of times.entries()) {
          engine.sample(time, i ? time - times[i - 1] : 0, settings)
          if (mode === 'off') engine.colliders.update()
          for (const node of model.rest.keys())
            assert.ok(node.matrixWorld.elements.every(Number.isFinite), node.name)
          if (expectedRoots && mika && drapeClips.includes(name)) {
            const metrics = drapeAtFrame(model, skirt, waist, hems, `${body} ${name} ${mode}@${time}`)
            maxRootDeg = Math.max(maxRootDeg, metrics.maxRootDeg)
            highestMeanDy = Math.max(highestMeanDy, metrics.meanDy)
            if (time === 2.33) at233 = metrics
          }
          const depth = penetration(vertices, thighs)
          total += depth.total
          contacts += depth.contacts
          worst = Math.max(worst, depth.worst)
        }
        if (mode === 'off') baseline = total
        const reduction = baseline ? (1 - total / baseline) * 100 : null
        if (expectedRoots && mika && drapeClips.includes(name) && mode === 'antiClip') {
          if (name === 'Victory_Start') {
            assert.ok(at233, 'missing 2.33 s regression frame')
            assert.equal(at233.downwardRoots, expectedRoots)
          }
          if (name === 'Cafe_Walk') assert.ok(baseline > 0, `${body}: walk did not exercise thigh intrusion`)
          if (baseline > 0) assert.ok(reduction >= 20, `${body} ${name}: only ${reduction}% less penetration`)
          else assert.equal(total, 0, `${body} ${name}: introduced thigh penetration`)
        }
        results.push({
          clip: name,
          mode,
          frames: times.length,
          contacts,
          reduction,
          maxRootDeg: Number.isFinite(highestMeanDy) ? maxRootDeg : null,
          highestMeanDy: Number.isFinite(highestMeanDy) ? highestMeanDy : null,
          at233,
          meanMm: (1000 * total) / (vertices.length * times.length),
          worstMm: 1000 * worst,
        })
      }
    }
    log?.table(
      results.map(({ at233, ...row }) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(4) : v]),
        ),
      ),
    )
    const victory = results.find((r) => r.clip === 'Victory_Start' && r.mode === 'antiClip')
    if (victory?.at233) log?.log('Victory_Start at 2.33 s', victory.at233)
    return { bindDeg, results }
  } finally {
    engine.dispose()
  }
}

export async function checkCloth(driverInput, actorInputs, log = console) {
  const driver = await load(driverInput)
  try {
    const clips = ['Move_Jump', ...drapeClips, 'Tactical_Start', 'Cafe_Reaction']
      .filter((name) => driver.animations.some((clip) => clip.name === name))
      .slice(0, 3)
    assert.ok(clips.length)
    if (driver.bodyMeshes.some((m) => m.name.startsWith('CH0069_')))
      for (const name of drapeClips) assert.ok(clips.includes(name), name)
    log?.log('Driver', driver.bodyMeshes[0]?.name, clips)
    const reports = []
    for (const input of actorInputs) {
      const model = await load(input)
      try {
        reports.push(checkActor(model, driver, clips, log))
      } finally {
        model.dispose()
      }
    }
    return reports
  } finally {
    driver.dispose()
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2)
  if (args.length === 1) throw new Error('Pass a driver and at least one actor')
  const drivers = args.length ? [args[0]] : ['Mika', 'Reisa'].map(upstream)
  const actors = args.length ? args.slice(1) : ['Hina (Dress)', 'Fuuka (New Year)', 'Aru'].map(upstream)
  for (const driver of drivers) await checkCloth(driver, actors)
}
