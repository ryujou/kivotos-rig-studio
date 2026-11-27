import type { SceneManager } from './SceneManager'
import {
  clipTiming,
  cropRect,
  gifPaletteFrames,
  outputSize,
  type ClipWindow,
  type ExportFormat,
  type ExportProgress,
  type ExportSettings,
  type Viewport,
  type WorkerReply,
} from './exportSpec'
import type { StageSettings } from '../store/useStudioStore'
import { recordWebm, webmMime } from './webm'

export interface CaptureInput {
  settings: ExportSettings
  timeline: ClipWindow & { loop: boolean }
  stage: StageSettings
  theme: 'light' | 'dark'
  viewport: Viewport
  springs: boolean
}
type CaptureScene = Pick<SceneManager, 'canvas' | 'beginCapture' | 'sampleDeterministic' | 'resetCapturePose'>
function workerChannel(worker: Worker, signal: AbortSignal) {
  let resolve: ((reply: WorkerReply) => void) | undefined
  let reject: ((error: Error) => void) | undefined
  let failed = false
  const stop = () => {
    worker.terminate()
    failed = true
    reject?.(signal.aborted ? signal.reason : Error('exportFailed'))
  }
  signal.addEventListener('abort', stop, { once: true })
  worker.onerror = worker.onmessageerror = stop
  worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
    if (data.type === 'error') stop()
    else resolve?.(data)
  }
  return {
    send(data: unknown, transfer: Transferable[] = []) {
      signal.throwIfAborted()
      if (failed) throw Error('exportFailed')
      return new Promise<WorkerReply>((ok, fail) => {
        resolve = ok
        reject = fail
        worker.postMessage(data, transfer)
      })
    },
    close() {
      signal.removeEventListener('abort', stop)
      worker.terminate()
    },
  }
}
// Native canvas and recorder promises do not accept AbortSignal. Release the
// capture lease immediately even when the browser is still finishing a blob.
function interruptible<T>(work: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
function canvasPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(Error('exportFailed'))), 'image/png'),
  )
}
export async function exportClip(
  scene: CaptureScene,
  format: ExportFormat,
  input: CaptureInput,
  signal: AbortSignal,
  progress: (value: ExportProgress) => void,
) {
  signal.throwIfAborted()
  const { settings, timeline, stage, theme, viewport } = input
  const { fps } = settings
  const { frames, start, step } = clipTiming(timeline, fps)
  const crop = cropRect(viewport, settings.aspect)
  const canvas = scene.canvas
  if (
    !frames || viewport.width <= 0 || viewport.height <= 0 ||
    crop.width <= 0 || crop.height <= 0 || canvas.width <= 0 || canvas.height <= 0
  ) throw Error('stageUnavailable')
  if (format === 'webm' && !webmMime()) throw Error('webmUnavailable')
  const native = settings.resolution === 'original'
  let { width, height } = outputSize(crop, settings.resolution, viewport.dpr)
  if (native) {
    width = Math.min(canvas.width, width)
    height = Math.min(canvas.height, height)
  }
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const ctx = output.getContext('2d', { willReadFrequently: format === 'gif' })
  if (!ctx) throw Error('exportFailed')
  ctx.imageSmoothingQuality = 'high'
  const background = settings.background === 'stage' ? stage.background : settings.background
  const transparent = background === 'transparent'
  const sx = canvas.width / viewport.width,
    sy = canvas.height / viewport.height
  ctx.imageSmoothingEnabled = !native
  // Snap native captures to texel boundaries so fractional CSS crop coordinates cannot blur edges.
  const sourceX = native ? Math.max(0, Math.min(canvas.width - width, Math.round(crop.x * sx))) : crop.x * sx
  const sourceY = native ? Math.max(0, Math.min(canvas.height - height, Math.round(crop.y * sy))) : crop.y * sy
  // Reproduce CSS radial-gradient(ellipse farthest-corner at 50% 42%) in
  // viewport coordinates, then crop it with exactly the same transform as WebGL.
  if (background === 'studio') {
    ctx.save()
    ctx.scale(width / crop.width, height / crop.height)
    ctx.translate(viewport.width / 2 - crop.x, viewport.height * 0.42 - crop.y)
    ctx.scale(viewport.width * 0.5 * Math.SQRT2, viewport.height * 0.58 * Math.SQRT2)
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    gradient.addColorStop(0, theme === 'light' ? '#fafdfe' : '#182235')
    gradient.addColorStop(theme === 'light' ? 0.55 : 0.58, theme === 'light' ? '#eef4fc' : '#0f1624')
    gradient.addColorStop(1, theme === 'light' ? '#dfeafa' : '#090e18')
    // Canvas gradients use the transform at paint time. Bake once for the clip.
    ctx.fillStyle = gradient
    ctx.fillRect(-3, -3, 6, 6)
    ctx.restore()
  }
  const backdrop = background === 'studio' ? document.createElement('canvas') : undefined
  if (backdrop) {
    backdrop.width = width
    backdrop.height = height
    backdrop.getContext('2d')!.drawImage(output, 0, 0)
  }
  ctx.fillStyle =
    background === 'chroma'
      ? '#00ff00'
      : settings.background === 'solid'
        ? settings.solidColor
        : stage.solidColor
  function draw() {
    if (transparent) ctx!.clearRect(0, 0, width, height)
    else if (backdrop) ctx!.drawImage(backdrop, 0, 0)
    else ctx!.fillRect(0, 0, width, height)
    ctx!.drawImage(
      canvas,
      sourceX,
      sourceY,
      native ? width : crop.width * sx,
      native ? height : crop.height * sy,
      0,
      0,
      width,
      height,
    )
  }
  const restore = scene.beginCapture(background)
  // A replacement export can acquire the same scene before the aborted promise settles.
  let released = false
  const release = () => {
    if (released) return
    released = true
    restore()
  }
  signal.addEventListener('abort', release, { once: true })
  let channel: ReturnType<typeof workerChannel> | undefined
  let video: ReturnType<typeof recordWebm> | undefined
  try {
    if (format !== 'webm') {
      const worker =
        format === 'gif'
          ? new Worker(new URL('../workers/gif.worker.ts', import.meta.url), { type: 'module' })
          : new Worker(new URL('../workers/png.worker.ts', import.meta.url), { type: 'module' })
      channel = workerChannel(worker, signal)
      if (format === 'gif')
        await channel.send({
          type: 'init',
          width,
          height,
          total: frames,
          fps,
          transparent,
          alphaCutoff: settings.alphaCutoff,
          quality: settings.quality,
          loop: timeline.loop,
        })
    } else video = recordWebm(output, fps)
    if (format === 'gif' && settings.quality === 'balanced') {
      const samples = gifPaletteFrames(frames)
      for (let i = 0; i < samples; i++) {
        signal.throwIfAborted()
        const frame = samples === 1 ? 0 : Math.round((i * (frames - 1)) / (samples - 1))
        scene.sampleDeterministic(start + frame * step, 0)
        draw()
        const rgba = ctx.getImageData(0, 0, width, height).data
        await channel!.send({ type: 'sample', rgba }, [rgba.buffer])
      }
      scene.resetCapturePose()
    }
    if (timeline.loop && input.springs) {
      for (let i = 0; i < 6; i++) scene.sampleDeterministic(start, 1 / fps)
    }
    for (let i = 0; i < frames; i++) {
      signal.throwIfAborted()
      scene.sampleDeterministic(start + i * step, 1 / fps)
      draw()
      progress({
        phase: 'capturing',
        current: i + 1,
        total: frames,
        percent: (100 * (i + 0.5)) / (frames + 1),
      })
      if (video) await interruptible(video.frame(), signal)
      else if (format === 'gif') {
        const rgba = ctx.getImageData(0, 0, width, height).data
        const ack = await channel!.send({ type: 'frame', rgba }, [rgba.buffer])
        if (ack.type !== 'progress' || ack.progress.current !== i + 1) throw Error('exportFailed')
      } else {
        const bytes = await interruptible(
          canvasPng(output).then((blob) => blob.arrayBuffer()),
          signal,
        )
        const png = new Uint8Array(bytes)
        await channel!.send({ type: 'frame', png, total: frames }, [png.buffer])
      }
    }
    signal.throwIfAborted()
    progress({ phase: 'encoding', current: frames, total: frames, percent: (100 * frames) / (frames + 1) })
    let blob: Blob
    if (video) blob = await interruptible(video.finish(frames), signal)
    else {
      const result = await channel!.send({ type: 'finish' })
      if (result.type !== 'done') throw Error('exportFailed')
      blob = new Blob([result.bytes], { type: format === 'gif' ? 'image/gif' : 'application/zip' })
    }
    signal.throwIfAborted()
    progress({ phase: 'encoding', current: frames, total: frames, percent: 100 })
    return { blob, width, height, frames, format, fps }
  } finally {
    try {
      channel?.close()
      video?.close()
    } finally {
      signal.removeEventListener('abort', release)
      release()
    }
  }
}
