// MediaRecorder timestamps follow wall time, including time spent rendering on a slow GPU.
// Rebuild the single video track's timeline from the actual recorded VP8/VP9 blocks.
const SEGMENT = 0x18538067,
  INFO = 0x1549a966,
  TRACKS = 0x1654ae6b,
  CLUSTER = 0x1f43b675
interface Element {
  id: number
  data: Uint8Array
}
function vint(bytes: Uint8Array, offset: number, keepMarker = false) {
  const head = bytes[offset]
  if (!head) throw Error('webmUnavailable')
  const length = Math.clz32(head) - 23
  if (offset + length > bytes.length) throw Error('webmUnavailable')
  const marker = 1 << (8 - length)
  let value = keepMarker ? head : head - marker
  let unknown = value === marker - 1
  for (let i = 1; i < length; i++) {
    const byte = bytes[offset + i]
    value = value * 256 + byte
    unknown &&= byte === 255
  }
  return { value, length, unknown }
}
function* elements(bytes: Uint8Array): Generator<Element> {
  for (let offset = 0; offset < bytes.length; ) {
    const id = vint(bytes, offset, true)
    offset += id.length
    const size = vint(bytes, offset)
    offset += size.length
    const end = size.unknown ? bytes.length : offset + size.value
    if (end > bytes.length) throw Error('webmUnavailable')
    yield { id: id.value, data: bytes.subarray(offset, end) }
    offset = end
  }
}
function uint(value: number) {
  const bytes = [value % 256]
  while ((value = Math.floor(value / 256)) > 0) bytes.unshift(value % 256)
  return Uint8Array.from(bytes)
}
function join(parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}
function field(id: number, ...payload: Uint8Array[]) {
  const size = payload.reduce((n, part) => n + part.length, 0)
  let length = 1
  while (size >= 2 ** (7 * length) - 1) length++
  return join([uint(id), uint(size + 2 ** (7 * length)), ...payload])
}
function stampBlock(data: Uint8Array, stamp: number) {
  const offset = vint(data, 0).length
  if (data[offset + 2] & 6 || data.length <= offset + 3) throw Error('webmUnavailable')
  const copy = new Uint8Array(data)
  new DataView(copy.buffer).setInt16(offset, stamp)
  return copy
}
export function fixedRateWebm(bytes: Uint8Array, fps: number, frames: number) {
  const top = [...elements(bytes)],
    header = top.find((e) => e.id === 0x1a45dfa3)
  const segment = top.find((e) => e.id === SEGMENT)
  if (!header || !segment) throw Error('webmUnavailable')
  const contents = [...elements(segment.data)]
  const tracks = contents.find((e) => e.id === TRACKS)
  if (!tracks) throw Error('webmUnavailable')
  const track = [...elements(tracks.data)].filter((e) => e.id === 0xae)
  if (track.length !== 1) throw Error('webmUnavailable')
  const trackFields = [...elements(track[0].data)].filter((e) => e.id !== 0x23e383)
  const newTracks = field(
    TRACKS,
    field(0xae, ...trackFields.map((e) => field(e.id, e.data)), field(0x23e383, uint(Math.round(1e9 / fps)))),
  )
  const duration = new Uint8Array(8)
  new DataView(duration.buffer).setFloat64(0, (frames * 1000) / fps)
  const app = new TextEncoder().encode('Kivotos Rig Studio')
  const info = field(
    INFO,
    field(0x2ad7b1, uint(1e6)),
    field(0x4489, duration),
    field(0x4d80, app),
    field(0x5741, app),
  )
  const clusters: Uint8Array[] = []
  let cluster: Uint8Array[] = [],
    base = 0,
    count = 0
  function append(e: Element) {
    const time = Math.round((count++ * 1000) / fps)
    if (time - base >= 1000) {
      clusters.push(field(CLUSTER, ...cluster))
      cluster = []
      base = time
    }
    if (!cluster.length) cluster.push(field(0xe7, uint(base)))
    if (e.id === 0xa3) cluster.push(field(e.id, stampBlock(e.data, time - base)))
    else {
      // Retain BlockAdditions (including alpha), and replace any source BlockDuration.
      const children = [...elements(e.data)]
      if (!children.some((c) => c.id === 0xa1)) throw Error('webmUnavailable')
      cluster.push(
        field(
          e.id,
          ...children
            .filter((c) => c.id !== 0x9b)
            .map((c) => field(c.id, c.id === 0xa1 ? stampBlock(c.data, time - base) : c.data)),
        ),
      )
    }
  }
  function scanCluster(data: Uint8Array) {
    for (const e of elements(data)) {
      if (e.id === 0xa3 || e.id === 0xa0) append(e)
      else if (e.id === CLUSTER) scanCluster(e.data)
    }
  }
  for (const e of contents) if (e.id === CLUSTER) scanCluster(e.data)
  if (count !== frames) throw Error('webmUnavailable')
  clusters.push(field(CLUSTER, ...cluster))
  return new Blob([field(header.id, header.data), field(SEGMENT, info, newTracks, ...clusters)], {
    type: 'video/webm',
  })
}
export function webmMime() {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function' ||
    typeof HTMLCanvasElement === 'undefined' ||
    !HTMLCanvasElement.prototype.captureStream ||
    typeof CanvasCaptureMediaStreamTrack === 'undefined' ||
    !CanvasCaptureMediaStreamTrack.prototype.requestFrame
  )
    return undefined
  return ['video/webm;codecs=vp8', 'video/webm;codecs=vp9'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  )
}
export function recordWebm(canvas: HTMLCanvasElement, fps: number) {
  const mimeType = webmMime()
  if (!mimeType) throw Error('webmUnavailable')
  let stream: MediaStream | undefined
  let track: CanvasCaptureMediaStreamTrack
  let recorder: MediaRecorder
  try {
    stream = canvas.captureStream(0)
    track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    if (!track?.requestFrame) throw Error('webmUnavailable')
    recorder = new MediaRecorder(stream, { mimeType })
  } catch {
    stream?.getTracks().forEach((item) => item.stop())
    throw Error('webmUnavailable')
  }
  let started = false
  const chunks: Blob[] = []
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    recorder.onerror = () => reject(Error('webmUnavailable'))
    recorder.onstop = () => resolve(new Blob(chunks))
  })
  void stopped.catch(() => {})
  function close() {
    try {
      if (recorder.state !== 'inactive') recorder.stop()
    } finally {
      track.stop()
    }
  }
  return {
    async frame() {
      try {
        if (!started) {
          recorder.start()
          started = true
        }
        if (recorder.state !== 'recording') throw Error('webmUnavailable')
        track.requestFrame()
      } catch {
        throw Error('webmUnavailable')
      }
      // Allow a paint + encoder tick for each manually requested frame.
      await new Promise((resolve) => setTimeout(resolve, 1000 / fps + 2))
    },
    async finish(count: number) {
      close()
      return fixedRateWebm(new Uint8Array(await (await stopped).arrayBuffer()), fps, count)
    },
    close,
  }
}
