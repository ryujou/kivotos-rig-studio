import test from 'node:test'
import assert from 'node:assert/strict'
import { exportClip } from '../src/engine/GifExporter.ts'
import { bindExportScene, closeExport, startExport, useExportSession } from '../src/store/exportSession.ts'
import { useStudioStore } from '../src/store/useStudioStore.ts'

function captureInput() {
  const s = useStudioStore.getInitialState()
  return {
    stage: s.stage,
    settings: { ...s.exportSettings, fps: 2 },
    timeline: { ...s.timeline, duration: 1 },
    theme: 'light',
    springs: true,
    viewport: { width: 12, height: 14, dpr: 2, safe: { x: -2, y: -3, width: 12, height: 12 } },
  }
}

function capturePlatform() {
  const draws = [],
    workers = [],
    samples = [],
    outputs = []
  const context = {
    drawImage: (...args) => draws.push(args),
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    clearRect() {},
    fillRect() {},
    save() {},
    restore() {},
    scale() {},
    translate() {},
    createRadialGradient: () => ({ addColorStop() {} }),
  }
  let capture = false
  let restores = 0
  const scene = {
    canvas: { width: 10, height: 8 },
    beginCapture() {
      if (capture) throw Error('stageUnavailable')
      capture = true
      return () => {
        capture = false
        restores++
      }
    },
    sampleDeterministic(...args) {
      assert.ok(capture)
      samples.push(args)
    },
    resetCapturePose() {},
  }
  const platform = {
    scene,
    draws,
    samples,
    workers,
    outputs,
    get restores() {
      return restores
    },
    png: (callback) => callback(new Blob(['fixture'])),
  }
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas')
      const canvas = { getContext: () => context, toBlob: (cb) => platform.png(cb) }
      outputs.push(canvas)
      return canvas
    },
  }
  globalThis.Worker = class {
    frames = 0
    constructor(url) {
      this.gif = url.pathname.endsWith('gif.worker.ts')
      workers.push(this)
    }
    postMessage(message) {
      let data = { type: 'ready' }
      if (message.type === 'frame' && this.gif)
        data = { type: 'progress', progress: { current: ++this.frames } }
      if (message.type === 'finish') data = { type: 'done', bytes: Uint8Array.of(1, 2) }
      queueMicrotask(() => this.onmessage({ data }))
    }
    terminate() {
      this.terminated = true
    }
  }
  return platform
}

test('empty timelines, viewports, safe rectangles and drawing buffers reject before capture', async () => {
  const { scene } = capturePlatform()
  const run = (input) => exportClip(scene, 'gif', input, new AbortController().signal, () => {})
  for (const key of ['width', 'height']) {
    const input = captureInput()
    input.viewport[key] = 0
    await assert.rejects(run(input), /stageUnavailable/)
    const emptyCrop = captureInput()
    emptyCrop.viewport.safe[key] = 0
    await assert.rejects(run(emptyCrop), /stageUnavailable/)
  }
  const empty = captureInput()
  empty.timeline.duration = 0
  await assert.rejects(run(empty), /stageUnavailable/)
  scene.canvas.height = 0
  await assert.rejects(run(captureInput()), /stageUnavailable/)
})

test('native output clips both source edges and axes to actual drawing-buffer pixels', async () => {
  for (const [x, y, size, dpr, expected] of [
    [-3, -4, 12, 2, [0, 0, 10, 8]],
    [-3, -4, 3, 1, [0, 0, 3, 3]],
    [12, 14, 3, 1, [7, 5, 3, 3]],
  ]) {
    const p = capturePlatform()
    const input = captureInput()
    input.viewport.dpr = dpr
    input.viewport.safe = { x, y, width: size, height: size }
    const progress = []
    const result = await exportClip(p.scene, 'gif', input, new AbortController().signal, (step) =>
      progress.push(step),
    )
    const [, , width, height] = expected
    assert.deepEqual([result.width, result.height], [width, height])
    assert.deepEqual([p.outputs[0].width, p.outputs[0].height], [width, height])
    assert.ok(p.draws.length > 0)
    for (const draw of p.draws) assert.deepEqual(draw.slice(1), [...expected, 0, 0, width, height])
    assert.equal(result.blob.type, 'image/gif')
    assert.equal(progress.at(-1).percent, 100)
    assert.equal(p.restores, 1)
    assert.ok(p.workers[0].terminated)
  }
})

test('scaled PNG export paints the stage and signals encoding progress', async () => {
  const p = capturePlatform()
  const input = captureInput()
  input.settings = { ...input.settings, resolution: 256, background: 'stage' }
  const result = await exportClip(p.scene, 'png', input, new AbortController().signal, () => {})
  assert.equal(result.blob.type, 'application/zip')
  assert.equal(result.width, 256)
  assert.equal(p.outputs.length, 2)
  assert.equal(p.restores, 1)
})

test('export sessions release capture synchronously and an old finally cannot clear its successor', async () => {
  const p = capturePlatform()
  const input = captureInput()
  useStudioStore.setState({
    timeline: input.timeline,
    exportSettings: input.settings,
    viewport: input.viewport,
  })
  bindExportScene(null)
  await startExport('gif')
  assert.equal(useExportSession.getState().job.message, 'stageUnavailable')
  closeExport()
  bindExportScene(p.scene)
  const pendingPng = []
  p.png = (cb) => pendingPng.push(cb)
  const first = startExport('png')
  assert.equal(pendingPng.length, 1)
  closeExport()
  assert.equal(p.restores, 1)
  const second = startExport('png')
  assert.equal(pendingPng.length, 2)
  await first
  assert.equal(useExportSession.getState().job.status, 'busy')
  closeExport()
  assert.equal(p.restores, 2)
  pendingPng.forEach((cb) => cb(new Blob(['late'])))
  await second
  assert.equal(useExportSession.getState().job, null)
  await startExport('gif')
  const { result } = useExportSession.getState().job
  assert.equal(result.format, 'gif')
  assert.equal((await (await fetch(result.url)).blob()).size, result.bytes)
  bindExportScene(null)
  await assert.rejects(fetch(result.url))
})
