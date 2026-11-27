import { Scan } from 'lucide-react'
import { clipTiming, cropRect, outputSize } from '../engine/exportSpec'
import { useStudioStore, useText } from '../store/useStudioStore'

export function useOutputSpec() {
  const settings = useStudioStore((s) => s.exportSettings)
  const viewport = useStudioStore((s) => s.viewport)
  const speed = useStudioStore((s) => s.timeline.speed)
  const duration = useStudioStore((s) => s.timeline.duration)
  const trimStart = useStudioStore((s) => s.timeline.trimStart)
  const trimEnd = useStudioStore((s) => s.timeline.trimEnd)
  const crop = cropRect(viewport, settings.aspect)
  return {
    settings,
    crop,
    speed,
    clipDuration: duration,
    ...outputSize(crop, settings.resolution, viewport.dpr),
    ...clipTiming({ duration, speed, trimStart, trimEnd }, settings.fps),
  }
}
export function CropOverlay() {
  const t = useText()
  const { settings, crop, width, height, frames } = useOutputSpec()
  const stage = useStudioStore((s) => s.stage.background)
  const safe = useStudioStore((s) => s.viewport.safe)
  return (
    <div className="crop-layer" aria-label={t('aspect')}>
      <div className="crop-box" style={{ left: crop.x, top: crop.y, width: crop.width, height: crop.height }}>
        {['tl', 'tr', 'bl', 'br'].map((pos) => (
          <i key={pos} className={'crop-corner ' + pos} />
        ))}
        <div className="crop-thirds" />
      </div>
      <output
        className="crop-spec"
        style={{
          left: Math.max(crop.x, safe.x) + 8,
          top: Math.min(crop.y + crop.height, safe.y + safe.height) - 8,
          maxWidth: Math.min(crop.width, safe.width) - 16,
        }}
      >
        <Scan size={12} /> {width} × {height} · {settings.fps} FPS · {frames} {t('frames')} ·{' '}
        {t(settings.background === 'stage' ? stage : settings.background)}
      </output>
    </div>
  )
}
