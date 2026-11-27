import { Aperture, Download, Film, Focus, Images, Palette, Scan, Scissors } from 'lucide-react'
import { useStudioStore, useText } from '../store/useStudioStore'
import { startExport } from '../store/exportSession'
import { Toggle } from './shared'
import { useOutputSpec } from './CropOverlay'
import { webmMime } from '../engine/webm'

function Choices<T extends string | number>({
  label,
  values,
  value,
  select,
  name,
}: {
  label: string
  values: readonly T[]
  value: T
  select: (v: T) => void
  name: (v: T) => string
}) {
  return (
    <div className="export-field">
      <span className="field-label">{label}</span>
      <div className="export-choices" role="group" aria-label={label}>
        {values.map((v) => (
          <button key={v} aria-pressed={value === v} onClick={() => select(v)}>
            {name(v)}
          </button>
        ))}
      </div>
    </div>
  )
}
export function ExportInspector() {
  const t = useText(),
    { settings, width, height, frames, start, end, duration, clipDuration, speed } = useOutputSpec()
  const set = useStudioStore((s) => s.setExport)
  const transparentStage = useStudioStore((s) => s.stage.background === 'transparent')
  const ready =
    useStudioStore(
      (s) =>
        s.slots.every((slot) => s.runtime[slot.id]?.status === 'ready') &&
        s.props.every((prop) => !prop.visible || prop.status === 'ready'),
    ) && frames > 0
  const webm = !!webmMime()
  return (
    <div className="inspector-scroll export-inspector">
      <section className="control-section">
        <h3>
          <Scan />
          {t('aspect')}{' '}
          <output>
            {width} × {height}
          </output>
        </h3>
        <div className="export-choices" role="group" aria-label={t('aspect')}>
          {(['1:1', '4:3', '16:9', 'free'] as const).map((a) => (
            <button key={a} aria-pressed={settings.aspect === a} onClick={() => set({ aspect: a })}>
              {a === 'free' ? t(a) : a}
            </button>
          ))}
        </div>
        <Toggle
          label={t('viewfinder')}
          checked={settings.showViewfinder}
          onChange={() => set({ showViewfinder: !settings.showViewfinder })}
        />
        <button className="frame-button" onClick={() => useStudioStore.getState().setCamera('fitCrop')}>
          <Focus size={14} />
          {t('fitCrop')}
        </button>
        <Choices
          label={t('resolution')}
          values={['original', 256, 360, 480, 512, 720] as const}
          value={settings.resolution}
          select={(resolution) => set({ resolution })}
          name={(resolution) => (resolution === 'original' ? t('originalResolution') : String(resolution))}
        />
        <Choices
          label={t('fps')}
          values={[15, 20, 24, 30]}
          value={settings.fps}
          select={(fps) => set({ fps })}
          name={String}
        />
      </section>
      <section className="control-section">
        <h3>
          <Palette />
          {t('background')}
        </h3>
        <div className="export-backgrounds" role="group" aria-label={t('background')}>
          {(['transparent', 'stage', 'solid'] as const).map((bg) => (
            <button
              key={bg}
              aria-pressed={settings.background === bg}
              onClick={() => set({ background: bg })}
            >
              <i
                className={'swatch swatch-' + bg}
                style={bg === 'solid' ? { background: settings.solidColor } : undefined}
              />
              {t(bg === 'stage' ? 'matchStage' : bg === 'transparent' ? 'sticker' : 'solid')}
            </button>
          ))}
        </div>
        {settings.background === 'solid' && (
          <label className="color-row">
            {t('color')}
            <input
              type="color"
              value={settings.solidColor}
              onChange={(e) => set({ solidColor: e.target.value })}
            />
          </label>
        )}
        {(settings.background === 'transparent' || (settings.background === 'stage' && transparentStage)) && (
          <label className="slider-row matte">
            <span>{t('alphaCutoff')}</span>
            <input
              type="range"
              min="0"
              max="255"
              value={settings.alphaCutoff}
              onChange={(e) => set({ alphaCutoff: +e.target.value })}
            />
            <code>{settings.alphaCutoff}</code>
          </label>
        )}
        <label className="select-row">
          <span>{t('palette')}</span>
          <select
            value={settings.quality}
            onChange={(e) => set({ quality: e.target.value as typeof settings.quality })}
          >
            {(['fast', 'balanced', 'crisp'] as const).map((q) => (
              <option key={q} value={q}>
                {t(q)}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="control-section export-trim">
        <h3>
          <Scissors />
          {t('clipTrim')}{' '}
          <span className="trim-buttons">
            {frames > 120 && (
              <button
                onClick={() =>
                  useStudioStore.getState().setTimeline({ trimEnd: (start + 3 * speed) / clipDuration })
                }
              >
                {t('trim3s')}
              </button>
            )}
            <button onClick={() => useStudioStore.getState().setTimeline({ trimStart: 0, trimEnd: 1 })}>
              {t('resetTrim')}
            </button>
          </span>
        </h3>
        {frames > 120 && <p className="trim-tip">{t('trim3sTip')}</p>}
        <div>
          <span>
            {t('trimIn')} → {t('trimOut')}
          </span>
          <code>
            {start.toFixed(2)} → {end.toFixed(2)} s
          </code>
        </div>
        <div>
          <span>
            {t('duration')} · {speed}×
          </span>
          <b>
            {duration.toFixed(2)} s · {frames} {t('frames')}
          </b>
        </div>
      </section>
      <div className="export-actions">
        <button className="primary" disabled={!ready} onClick={() => void startExport('gif')}>
          <Download size={16} />
          {t('exportGif')}
        </button>
        <div>
          <button disabled={!ready} title={t('exportPng')} onClick={() => void startExport('png')}>
            <Images size={14} /> PNG ZIP
          </button>
          <button
            disabled={!ready || !webm}
            title={t(webm ? 'exportWebm' : 'webmUnavailable')}
            onClick={() => void startExport('webm')}
          >
            <Film size={14} /> WebM
          </button>
        </div>
        {!ready && (
          <small>
            <Aperture size={13} />
            {t('stageUnavailable')}
          </small>
        )}
        {!webm && <small>{t('webmUnavailable')}</small>}
      </div>
    </div>
  )
}
