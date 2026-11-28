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
function segmentInfo(fps: number, frames: number) {
  const duration = new Uint8Array(8)
  new DataView(duration.buffer).setFloat64(0, (frames * 1000) / fps)
  const app = new TextEncoder().encode('Kivotos Rig Studio')
  return field(
    INFO,
    field(0x2ad7b1, uint(1e6)),
    field(0x4489, duration),
    field(0x4d80, app),
    field(0x5741, app),
  )
}

// Leave the Segment length unknown so long mobile exports can assemble a Blob
// from its parts without allocating a second copy of the whole video.
function movie(
  header: Uint8Array<ArrayBuffer>,
  tracks: Uint8Array<ArrayBuffer>,
  clusters: BlobPart[],
  fps: number,
  frames: number,
) {
  return new Blob(
    [header, Uint8Array.of(0x18, 0x53, 0x80, 0x67, 0xff), segmentInfo(fps, frames), tracks, ...clusters],
    { type: 'video/webm' },
  )
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
  const clusters: Uint8Array<ArrayBuffer>[] = []
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
  return movie(field(header.id, header.data), newTracks, clusters, fps, frames)
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
export async function canEncodeVp8(config: VideoEncoderConfig) {
  if (typeof VideoFrame === 'undefined' || typeof VideoEncoder === 'undefined') return false
  try {
    return (await VideoEncoder.isConfigSupported(config)).supported === true
  } catch {
    return false
  }
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

type Packet = { bytes: Uint8Array<ArrayBuffer>; key: boolean }

function vp8Movie(
  color: Map<number, Packet>,
  alpha: Map<number, Packet> | undefined,
  width: number,
  height: number,
  fps: number,
  frames: number,
) {
  if (!frames || color.size !== frames || (alpha && alpha.size !== frames)) throw Error('webmUnavailable')
  const text = new TextEncoder()
  const header = field(
    0x1a45dfa3,
    field(0x4286, uint(1)),
    field(0x42f7, uint(1)),
    field(0x42f2, uint(4)),
    field(0x42f3, uint(8)),
    field(0x4282, text.encode('webm')),
    field(0x4287, uint(4)),
    field(0x4285, uint(2)),
  )
  const video = field(
    0xe0,
    field(0xb0, uint(width)),
    field(0xba, uint(height)),
    ...(alpha ? [field(0x53c0, uint(1))] : []),
  )
  const tracks = field(
    TRACKS,
    field(
      0xae,
      field(0xd7, uint(1)),
      field(0x73c5, uint(1)),
      field(0x83, uint(1)),
      field(0x86, text.encode('V_VP8')),
      field(0x23e383, uint(Math.round(1e9 / fps))),
      ...(alpha ? [field(0x55ee, uint(1))] : []),
      video,
    ),
  )
  const clusters: Blob[] = []
  let blocks: Uint8Array<ArrayBuffer>[] = [],
    base = 0,
    previous = 0
  for (let i = 0; i < frames; i++) {
    const time = Math.round((i * 1000) / fps)
    const pixels = color.get(i),
      mask = alpha?.get(i)
    if (!pixels || (alpha && !mask)) throw Error('webmUnavailable')
    if (time - base >= 1000) {
      clusters.push(new Blob([field(CLUSTER, ...blocks)]))
      blocks = []
      base = time
    }
    if (!blocks.length) blocks.push(field(0xe7, uint(base)))
    const stamp = time - base
    const prefix = Uint8Array.of(0x81, stamp >> 8, stamp & 255, !mask && pixels.key ? 0x80 : 0)
    if (mask) {
      const additions = field(0x75a1, field(0xa6, field(0xee, uint(1)), field(0xa5, mask.bytes)))
      // BlockGroup keyframes omit ReferenceBlock. VP8 delta frames refer to the previous picture.
      const ref = new Uint8Array(2)
      new DataView(ref.buffer).setInt16(0, previous - time)
      blocks.push(
        field(
          0xa0,
          field(0xa1, prefix, pixels.bytes),
          additions,
          ...(pixels.key && mask.key ? [] : [field(0xfb, ref)]),
        ),
      )
    } else blocks.push(field(0xa3, prefix, pixels.bytes))
    color.delete(i)
    alpha?.delete(i)
    previous = time
  }
  clusters.push(new Blob([field(CLUSTER, ...blocks)]))
  return movie(header, tracks, clusters, fps, frames)
}

// Offline encoders acknowledge submitted pictures independently of display refresh.
// Canvas captureStream can silently coalesce 30 FPS frames on mobile.
export async function createWebmWriter(canvas: HTMLCanvasElement, fps: number, transparent: boolean) {
  const { width, height } = canvas
  const config: VideoEncoderConfig = {
    codec: 'vp8',
    width,
    height,
    framerate: fps,
    bitrate: Math.max(350000, Math.round(width * height * fps * 0.36)),
    latencyMode: 'quality',
  }
  if (!(await canEncodeVp8(config))) return recordWebm(canvas, fps)

  const color = new Map<number, Packet>(),
    alpha = transparent ? new Map<number, Packet>() : undefined
  const encoders: VideoEncoder[] = []
  let error: DOMException | undefined,
    submitted = 0
  function encoder(packets: Map<number, Packet>) {
    const e = new VideoEncoder({
      output(chunk) {
        const bytes = new Uint8Array(chunk.byteLength)
        chunk.copyTo(bytes)
        // Safari can round a canvas VideoFrame timestamp down by a microsecond.
        // Match the frame grid, keeping gaps detectable even for reordered output.
        const index = Math.round((chunk.timestamp * fps) / 1e6)
        packets.set(index, { bytes, key: chunk.type === 'key' })
      },
      error(reason) {
        error = reason
      },
    })
    encoders.push(e)
    e.configure(config)
    return e
  }
  function close() {
    for (const e of encoders) if (e.state !== 'closed') e.close()
    color.clear()
    alpha?.clear()
  }
  let picture: VideoEncoder, matte: VideoEncoder | undefined
  try {
    picture = encoder(color)
    if (alpha) matte = encoder(alpha)
  } catch {
    close()
    return recordWebm(canvas, fps)
  }
  const ctx = matte ? canvas.getContext('2d') : null
  // WebM stores alpha as another VP8 picture with opacity in the luma plane.
  const luma = matte
    ? new Uint8Array(width * height + 2 * Math.ceil(width / 2) * Math.ceil(height / 2)).fill(128)
    : undefined
  function submit(e: VideoEncoder, frame: VideoFrame) {
    try {
      e.encode(frame, { keyFrame: submitted % fps === 0 })
    } finally {
      frame.close()
    }
  }
  function flush() {
    return Promise.all(encoders.map((e) => e.flush()))
  }
  return {
    async frame() {
      if (error) throw error
      const timestamp = Math.round((submitted * 1e6) / fps)
      const duration = Math.round(((submitted + 1) * 1e6) / fps) - timestamp
      submit(picture, new VideoFrame(canvas, { timestamp, duration, alpha: 'discard' }))
      if (matte && luma && ctx) {
        const rgba = ctx.getImageData(0, 0, width, height).data
        for (let i = 0; i < width * height; i++) luma[i] = rgba[i * 4 + 3]
        submit(
          matte,
          new VideoFrame(luma, {
            format: 'I420',
            codedWidth: width,
            codedHeight: height,
            timestamp,
            duration,
            colorSpace: { fullRange: true },
          }),
        )
      }
      submitted++
      if (submitted % 8 === 0) await flush()
    },
    async finish(count: number) {
      await flush()
      if (error) throw error
      return vp8Movie(color, alpha, width, height, fps, count)
    },
    close,
  }
}
