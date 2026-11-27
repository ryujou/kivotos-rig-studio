import { ChevronDown, Link2, Pause, Play, Repeat2, SkipBack, SkipForward } from 'lucide-react'
import { useStudioStore, useText } from '../store/useStudioStore'
import { clipTiming } from '../engine/exportSpec'
import { IconButton } from './shared'

export function TimelineDock() {
  const t = useText(),
    timeline = useStudioStore((s) => s.timeline),
    fps = useStudioStore((s) => s.exportSettings.fps),
    set = useStudioStore((s) => s.setTimeline),
    seek = useStudioStore((s) => s.seek)
  const { time, duration, playing, loop, speed, trimStart, trimEnd, chainStartEnd } = timeline
  const start = trimStart * duration,
    end = trimEnd * duration,
    span = end - start
  const { frames } = clipTiming(timeline, fps)
  const chainLabel = t('start') + ' → ' + t('end')
  return (
    <section className="timeline glass" aria-label={t('timeline')}>
      <div className="transport">
        <IconButton label={t('prev')} disabled={!duration} onClick={() => seek(time - 1 / fps)}>
          <SkipBack size={14} />
        </IconButton>
        <IconButton
          className="play-button"
          label={t(playing && duration ? 'pause' : 'play')}
          disabled={!duration}
          onClick={() => set({ playing: !playing, time: !playing && time >= end ? start : time })}
        >
          {playing && duration ? (
            <Pause size={15} fill="currentColor" />
          ) : (
            <Play size={15} fill="currentColor" />
          )}
        </IconButton>
        <IconButton label={t('next')} disabled={!duration} onClick={() => seek(time + 1 / fps)}>
          <SkipForward size={14} />
        </IconButton>
        <IconButton label={t('loop')} aria-pressed={loop} onClick={() => set({ loop: !loop })}>
          <Repeat2 size={16} />
        </IconButton>
        <button
          className="chain-pill"
          title={t('chain') + ' · ' + chainLabel}
          aria-label={chainLabel}
          aria-pressed={chainStartEnd}
          onClick={() => set({ chainStartEnd: !chainStartEnd })}
        >
          <Link2 size={14} />
          <span>{chainLabel}</span>
        </button>
        <label className="speed-select">
          <select
            aria-label={t('speed')}
            value={speed}
            onChange={(e) => set({ speed: Number(e.target.value) })}
          >
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
              <option value={v} key={v}>
                {v}×
              </option>
            ))}
          </select>
          <ChevronDown size={10} />
        </label>
        <time>
          <b>{time.toFixed(2)}</b>
          <span> / {duration.toFixed(2)} s</span>
        </time>
      </div>
      <div className="timeline-lane">
        <div className="clip-track">
          <div className="trim-bar">
            <i style={{ left: trimStart * 100 + '%', right: (1 - trimEnd) * 100 + '%' }} />
          </div>
          <input
            className="playhead"
            aria-label={t('scrub')}
            type="range"
            min="0"
            max={duration || 1}
            step="any"
            disabled={!duration}
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
          />
          {(['trimStart', 'trimEnd'] as const).map((key, index) => {
            const label = t(index ? 'trimOut' : 'trimIn')
            return (
              <input
                key={key}
                className={'trim-handle ' + (index ? 'out' : 'in')}
                type="range"
                aria-label={label}
                title={label + ' · ' + (timeline[key] * duration).toFixed(2) + ' s'}
                min="0"
                max="1"
                step=".001"
                disabled={!duration}
                value={timeline[key]}
                aria-valuetext={(timeline[key] * duration).toFixed(2) + ' s'}
                onChange={(e) => set({ [key]: Number(e.target.value) })}
              />
            )
          })}
        </div>
        <output
          className="trim-readout"
          title={t('trimIn') + ' ' + start.toFixed(2) + ' s → ' + t('trimOut') + ' ' + end.toFixed(2) + ' s'}
        >
          {span.toFixed(2)} s · {frames} {t('frames')}
        </output>
      </div>
    </section>
  )
}
