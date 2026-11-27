import test from 'node:test'
import assert from 'node:assert/strict'
import { fixedRateWebm, recordWebm, webmMime } from '../src/engine/webm.ts'

test('WebM recorder timestamps SimpleBlock and BlockGroup frames and releases its track', async (t) => {
  function u(v) {
    const b = [v % 256]
    while ((v = Math.floor(v / 256)) > 0) b.unshift(v % 256)
    return Uint8Array.from(b)
  }
  function j(parts) {
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
    let o = 0
    for (const p of parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }
  function el(id, ...payload) {
    const size = payload.reduce((a, p) => a + p.length, 0)
    let len = 1
    while (size >= 2 ** (7 * len) - 1) len++
    return j([u(id), u(size + 2 ** (7 * len)), ...payload])
  }
  const simpleBlock = new Uint8Array([0x81, 0x00, 0x00, 0x80, 0xaa, 0xbb])
  const blockGroup = el(0xa0, el(0xa1, simpleBlock), el(0x9b, u(33)))
  const webm = j([
    el(0x1a45dfa3, el(0x4282, new TextEncoder().encode('webm'))),
    el(
      0x18538067,
      el(0x1654ae6b, el(0xae, el(0xd7, u(1)), el(0x83, u(1)))),
      el(0x1f43b675, el(0xe7, u(0)), el(0xa3, simpleBlock), blockGroup),
    ),
  ])
  const fixed = fixedRateWebm(webm, 20, 2)
  assert.ok(fixed instanceof Blob && fixed.size > 20)
  assert.equal(webmMime(), undefined) // Node has no MediaRecorder
  assert.throws(() => fixedRateWebm(new Uint8Array([0]), 20, 1), /webmUnavailable/)
  assert.throws(() => fixedRateWebm(webm, 20, 5), /webmUnavailable/)
  class Track {
    frames = 0
    requestFrame() {
      this.frames++
    }
    stop() {
      this.stopped = true
    }
  }
  const track = new Track()
  globalThis.CanvasCaptureMediaStreamTrack = Track
  globalThis.HTMLCanvasElement = class {
    captureStream() {
      return { getTracks: () => [track], getVideoTracks: () => [track] }
    }
  }
  globalThis.MediaRecorder = class {
    static isTypeSupported(type) {
      return type.includes('vp8')
    }
    state = 'inactive'
    start() {
      this.state = 'recording'
    }
    stop() {
      this.state = 'inactive'
      this.ondataavailable({ data: new Blob([webm]) })
      this.onstop()
    }
  }
  t.after(() => {
    delete globalThis.CanvasCaptureMediaStreamTrack
    delete globalThis.HTMLCanvasElement
    delete globalThis.MediaRecorder
  })
  const recorder = recordWebm(new HTMLCanvasElement(), 1000)
  await recorder.frame()
  await recorder.frame()
  const video = await recorder.finish(2)
  assert.equal(video.type, 'video/webm')
  assert.equal(track.frames, 2)
  assert.ok(track.stopped)
  assert.deepEqual(await video.arrayBuffer(), await fixedRateWebm(webm, 1000, 2).arrayBuffer())
})

test('Workers: gif.worker (balanced/fast/crisp + transparent + errors) & png.worker', async () => {
  const replies = []
  globalThis.self = {
    postMessage: (msg) => replies.push(msg),
    close: () => {},
  }
  await import('../src/workers/gif.worker.ts')
  const sendGif = (data) => {
    replies.length = 0
    globalThis.self.onmessage({ data })
    return replies[0]
  }
  const rgba = new Uint8ClampedArray(4 * 4 * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 200
    rgba[i + 1] = 100
    rgba[i + 2] = 250
    rgba[i + 3] = i < 32 ? 255 : 0
  }

  for (const quality of ['balanced', 'fast', 'crisp']) {
    assert.equal(
      sendGif({
        type: 'init',
        width: 4,
        height: 4,
        total: 2,
        fps: 20,
        transparent: true,
        alphaCutoff: 128,
        quality,
        loop: true,
      }).type,
      'ready',
    )
    if (quality === 'balanced') {
      assert.equal(sendGif({ type: 'sample', rgba: rgba.slice() }).type, 'ready')
      assert.equal(sendGif({ type: 'sample', rgba: rgba.slice() }).type, 'ready')
    }
    assert.equal(sendGif({ type: 'frame', rgba: rgba.slice() }).type, 'progress')
    assert.equal(sendGif({ type: 'frame', rgba: rgba.slice() }).type, 'progress')
    const done = sendGif({ type: 'finish' })
    assert.equal(done.type, 'done')
    assert.equal(new TextDecoder().decode(done.bytes.slice(0, 6)), 'GIF89a')
  }
  // Invalid sequence & wrong dimensions
  assert.equal(sendGif({ type: 'finish' }).type, 'error')

  // PNG worker
  await import('../src/workers/png.worker.ts')
  const sendPng = (data) => {
    replies.length = 0
    globalThis.self.onmessage({ data })
    return replies[0]
  }
  assert.equal(sendPng({ type: 'finish' }).type, 'error')
  assert.equal(sendPng({ type: 'unexpected' }).type, 'error')
  assert.equal(sendPng({ type: 'frame', png: new Uint8Array([137, 80, 78, 71]), total: 1 }).type, 'ready')
  const zipRes = sendPng({ type: 'finish' })
  assert.equal(zipRes.type, 'done')
  assert.equal(zipRes.bytes[0], 0x50) // 'P' of PK zip header
  assert.equal(zipRes.bytes[1], 0x4b) // 'K'
})
