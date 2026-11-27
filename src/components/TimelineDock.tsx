import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ChevronDown, Link2, Pause, Play, Repeat2 } from 'lucide-react'
import { useStudioStore, useText } from '../store/useStudioStore'
import { clipTiming } from '../engine/exportSpec'
import { IconButton } from './shared'

type Thumb = 'trimStart' | 'time' | 'trimEnd'

function togglePlayback() {
  const { timeline: t, setTimeline } = useStudioStore.getState()
  if (!t.duration) return
  const restart = !t.playing && t.time >= t.trimEnd * t.duration
  setTimeline({ playing: !t.playing, time: restart ? t.trimStart * t.duration : t.time })
}
function changeTime(thumb: Thumb, seconds: number) {
  const { timeline, seek, setTimeline } = useStudioStore.getState()
  if (!timeline.duration) return
  if (thumb === 'time') seek(seconds)
  else setTimeline({ [thumb]: seconds / timeline.duration })
}

export function TimelineDock() {
  const t = useText(),
    timeline = useStudioStore((s) => s.timeline),
    fps = useStudioStore((s) => s.exportSettings.fps),
    set = useStudioStore((s) => s.setTimeline)
  const { time, duration, playing, loop, speed, trimStart, trimEnd, chainStartEnd } = timeline
  const start = trimStart * duration,
    end = trimEnd * duration,
    span = end - start
  const { frames } = clipTiming(timeline, fps)
  const chainLabel = t('start') + ' → ' + t('end')
  const axis = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; thumb: Thumb; offset: number } | null>(null)
  const gap = Math.min(duration, 1 / fps)
  const bounds = {
    time: [start, end],
    trimStart: [0, Math.max(0, end - gap)],
    trimEnd: [Math.min(duration, start + gap), duration],
  }
  const values = { time, trimStart: start, trimEnd: end }
  const labels = { time: t('scrub'), trimStart: t('trimIn'), trimEnd: t('trimOut') }

  function movePointer(event: ReactPointerEvent<HTMLDivElement>) {
    const active = drag.current
    if (!active || active.id !== event.pointerId || !axis.current) return
    const rect = axis.current.getBoundingClientRect()
    if (rect.width)
      changeTime(active.thumb, ((event.clientX - active.offset - rect.left) / rect.width) * duration)
  }
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!duration || event.button !== 0 || drag.current || !axis.current) return
    const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-thumb]')
    const thumb = (hit?.dataset.thumb ?? 'time') as Thumb
    const handle = axis.current.querySelector<HTMLElement>(`[data-thumb="${thumb}"]`)!
    const rect = handle.getBoundingClientRect()
    drag.current = {
      id: event.pointerId,
      thumb,
      offset: hit ? event.clientX - (rect.left + rect.width / 2) : 0,
    }
    event.preventDefault()
    handle.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    movePointer(event)
  }
  function sliderKey(event: ReactKeyEvent, thumb: Thumb) {
    const [min, max] = bounds[thumb]
    let next = values[thumb]
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next += 1 / fps
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        next -= 1 / fps
        break
      case 'PageUp':
        next += 10 / fps
        break
      case 'PageDown':
        next -= 10 / fps
        break
      case 'Home':
        next = min
        break
      case 'End':
        next = max
        break
      default:
        return
    }
    event.preventDefault()
    changeTime(thumb, Math.max(min, Math.min(max, next)))
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
        return
      const el = event.target instanceof HTMLElement ? event.target : null
      if (el?.isContentEditable || el?.closest('input,select,textarea,dialog')) return
      const state = useStudioStore.getState()
      if (!state.timeline.duration) return
      if (event.key === ' ') {
        if (el?.closest('button,a,summary')) return
        event.preventDefault()
        if (!event.repeat) togglePlayback()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        state.seek(state.timeline.time + (event.key === 'ArrowLeft' ? -1 : 1) / state.exportSettings.fps)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  return (
    <section className="timeline glass" aria-label={t('timeline')}>
      <div className="transport">
        <IconButton
          className="play-button"
          label={t(playing && duration ? 'pause' : 'play')}
          disabled={!duration}
          onClick={togglePlayback}
        >
          {playing && duration ? (
            <Pause size={15} fill="currentColor" />
          ) : (
            <Play size={15} fill="currentColor" />
          )}
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
        <div
          className="clip-track"
          onPointerDown={startDrag}
          onPointerMove={movePointer}
          onPointerUp={(event) => {
            movePointer(event)
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onLostPointerCapture={(event) => {
            if (drag.current?.id === event.pointerId) drag.current = null
          }}
          onPointerCancel={(event) => {
            if (drag.current?.id === event.pointerId) drag.current = null
          }}
        >
          <div className="rail-axis" ref={axis}>
            <div
              className="rail-fill"
              style={{ left: trimStart * 100 + '%', right: (1 - trimEnd) * 100 + '%' }}
            />
            {(['trimStart', 'time', 'trimEnd'] as const).map((thumb) => (
              <span
                key={thumb}
                role="slider"
                data-thumb={thumb}
                tabIndex={duration ? 0 : -1}
                aria-label={labels[thumb]}
                aria-disabled={!duration}
                aria-orientation="horizontal"
                aria-valuemin={bounds[thumb][0]}
                aria-valuemax={bounds[thumb][1]}
                aria-valuenow={values[thumb]}
                aria-valuetext={values[thumb].toFixed(2) + ' s'}
                title={labels[thumb] + ' · ' + values[thumb].toFixed(2) + ' s'}
                onKeyDown={(event) => sliderKey(event, thumb)}
                className={thumb === 'time' ? 'playhead' : 'trim-handle'}
                style={{
                  left: (thumb === 'time' ? (duration ? time / duration : 0) : timeline[thumb]) * 100 + '%',
                }}
              />
            ))}
          </div>
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
