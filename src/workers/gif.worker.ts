import { applyPalette, GIFEncoder, quantize } from 'gifenc/dist/gifenc.esm.js'
import { gifPaletteFrames, type GifInit, type GifMessage, type WorkerReply } from '../engine/exportSpec'

const maxPalettePixels = 250_000
let options: GifInit | undefined
let gif: ReturnType<typeof GIFEncoder> | undefined
let globalColors: number[][] | undefined
let samples: Uint32Array | undefined
let sampleCount = 0
let sampleLength = 0
let count = 0
function reply(message: WorkerReply, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer })
}

// One pixel per equal-sized interval of foreground pixels.
// Alpha is represented by a dedicated GIF index, so only visible colors train the palette.
function sampleColors(
  rgba: Uint8ClampedArray,
  dest: Uint32Array,
  offset: number,
  budget: number,
  cutoff: number,
  phase = 0.5,
) {
  const raw = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length / 4)
  let visible = raw.length
  if (cutoff) {
    visible = 0
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] >= cutoff) visible++
  }
  if (!visible) return offset
  const stride = visible / Math.min(visible, budget)
  // Vary the phase across keyframes to avoid repeatedly sampling the same texture rows.
  let next = stride * phase
  let seen = 0
  for (let i = 0; i < raw.length; i++) {
    if (rgba[i * 4 + 3] < cutoff) continue
    if (seen++ === Math.floor(next)) {
      dest[offset++] = raw[i]
      next += stride
    }
  }
  return offset
}
function collectSample(rgba: Uint8ClampedArray, config: GifInit) {
  const total = gifPaletteFrames(config.total)
  if (config.quality !== 'balanced' || count || sampleCount >= total) throw Error('invalid_sample')
  const budget = Math.min(rgba.length / 4, Math.floor(maxPalettePixels / total))
  samples ??= new Uint32Array(budget * total)
  const cutoff = config.transparent ? Math.max(1, config.alphaCutoff ?? 128) : 0
  sampleLength = sampleColors(rgba, samples, sampleLength, budget, cutoff, (sampleCount + 0.5) / total)
  if (++sampleCount === total) {
    // gifenc reads the entire backing buffer, even when passed a shorter view.
    if (sampleLength) {
      const pixels = new Uint8ClampedArray(samples.buffer.slice(0, sampleLength * 4))
      globalColors = quantize(pixels, 256 - Number(config.transparent), { format: 'rgb565' })
    }
    samples = undefined
  }
  reply({ type: 'ready' })
}
function encode(rgba: Uint8ClampedArray, config: GifInit) {
  const { width, height, transparent, quality, fps, total } = config
  if (count >= total || (sampleCount > 0 && sampleCount !== gifPaletteFrames(total)))
    throw Error('invalid_frame')
  const format =
    quality === 'balanced' ? 'rgb565' : transparent ? 'rgba4444' : quality === 'fast' ? 'rgb444' : 'rgb565'
  const cutoff = Math.max(1, config.alphaCutoff ?? 128)
  let colors = globalColors
  if (!colors) {
    let pixels = rgba
    if (quality === 'balanced') {
      // A frame-only stream or an entirely blank preview still gets bounded palette training.
      const sample = new Uint32Array(Math.min(width * height, maxPalettePixels))
      const used = sampleColors(rgba, sample, 0, sample.length, transparent ? cutoff : 0)
      pixels = new Uint8ClampedArray(sample.buffer.slice(0, used * 4))
    } else if (transparent) {
      let offset = 0
      const foreground = new Uint8ClampedArray(rgba.length)
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] < cutoff) continue
        foreground[offset++] = rgba[i]
        foreground[offset++] = rgba[i + 1]
        foreground[offset++] = rgba[i + 2]
        foreground[offset++] = 255
      }
      pixels = foreground.slice(0, offset)
    }
    colors = pixels.length
      ? quantize(pixels, (quality === 'fast' ? 128 : 256) - Number(transparent), { format })
      : [[0, 0, 0, 255]]
    if (quality !== 'crisp' && !count && pixels.length) globalColors = colors
  }
  // Map every original pixel, including fine edges. Only palette training is subsampled.
  const indices = applyPalette(rgba, colors, format)
  if (transparent) {
    for (let i = 0; i < indices.length; i++) indices[i] = rgba[i * 4 + 3] >= cutoff ? indices[i] + 1 : 0
  }
  const palette = count && globalColors ? undefined : transparent ? [[0, 0, 0, 0], ...colors] : colors
  gif!.writeFrame(indices, width, height, {
    palette,
    transparent,
    transparentIndex: 0,
    dispose: transparent ? 2 : 1,
    repeat: config.loop ? 0 : -1,
    // Distribute GIF's 10 ms rounding error across the sequence.
    delay: 10 * (Math.round(((count + 1) * 100) / fps) - Math.round((count * 100) / fps)),
  })
  count++
  reply({
    type: 'progress',
    progress: { phase: 'encoding', current: count, total, percent: (100 * count) / total },
  })
}
self.onmessage = ({ data }: MessageEvent<GifMessage>) => {
  try {
    if (data.type === 'init') {
      options = data
      gif = GIFEncoder()
      globalColors = samples = undefined
      sampleCount = sampleLength = count = 0
      reply({ type: 'ready' })
    } else if (data.type === 'cancel') {
      gif = options = globalColors = samples = undefined
      self.close()
    } else if ((data.type === 'frame' || data.type === 'sample') && options && gif) {
      const rgba = data.rgba
      if (rgba.length !== options.width * options.height * 4) throw Error('invalid_dimensions')
      const pixels = rgba.byteOffset || rgba.byteLength !== rgba.buffer.byteLength ? rgba.slice() : rgba
      if (data.type === 'sample') collectSample(pixels, options)
      else encode(pixels, options)
    } else if (data.type === 'finish' && gif && options && count === options.total && count > 0) {
      gif.finish()
      const bytes = gif.bytes()
      reply({ type: 'done', bytes }, [bytes.buffer])
      gif = options = globalColors = samples = undefined
    } else throw Error('invalid_sequence')
  } catch {
    reply({ type: 'error' })
  }
}
