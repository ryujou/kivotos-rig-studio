export type Aspect = '1:1' | '4:3' | '16:9' | 'free'
export type PaletteQuality = 'fast' | 'balanced' | 'crisp'
export type ExportFormat = 'gif' | 'png' | 'webm'
export interface ExportSettings {
  aspect: Aspect
  resolution: 'original' | 256 | 360 | 480 | 512 | 720
  fps: number
  background: 'stage' | 'transparent' | 'solid'
  solidColor: string
  alphaCutoff: number
  quality: PaletteQuality
  showViewfinder: boolean
}
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface Viewport {
  width: number
  height: number
  dpr: number
  safe: Rect
}
export function cropRect(view: Viewport, aspect: Aspect): Rect {
  if (aspect === 'free') return { x: 0, y: 0, width: view.width, height: view.height }
  const [a, b] = aspect.split(':').map(Number)
  const box = view.safe
  const width = Math.min(box.width, (box.height * a) / b)
  const height = (width * b) / a
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height }
}
export function outputSize(rect: Rect, resolution: ExportSettings['resolution'], dpr = 1) {
  const scale = resolution === 'original' ? dpr : resolution / Math.max(1, rect.width, rect.height)
  return {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  }
}
export interface ClipWindow {
  trimStart: number
  trimEnd: number
  duration: number
  speed: number
}
export function clipTiming(t: ClipWindow, fps: number) {
  const start = t.trimStart * t.duration,
    end = t.trimEnd * t.duration
  const duration = (end - start) / t.speed
  const frames = duration > 0 ? Math.max(1, Math.ceil(duration * fps - 1e-8)) : 0
  return { start, end, duration, frames, step: t.speed / fps }
}
export interface ExportProgress {
  phase: 'capturing' | 'encoding'
  current: number
  total: number
  percent: number
}
export interface GifInit {
  type: 'init'
  width: number
  height: number
  total: number
  fps: number
  transparent: boolean
  alphaCutoff?: number
  quality: PaletteQuality
  loop: boolean
}
export const gifPaletteFrames = (frames: number) => Math.min(frames, 5)
export type GifMessage =
  | GifInit
  | { type: 'sample' | 'frame'; rgba: Uint8ClampedArray }
  | { type: 'finish' | 'cancel' }
export type WorkerReply =
  | { type: 'ready' }
  | { type: 'progress'; progress: ExportProgress }
  | { type: 'done'; bytes: Uint8Array<ArrayBuffer> }
  | { type: 'error' }
