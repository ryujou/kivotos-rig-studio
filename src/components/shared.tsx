import { useCallback, useState, type CSSProperties, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ChevronDown, UserRound } from 'lucide-react'
import { portraitColumns, portraitIndex, portraitRows } from '../data/portraits'
import { standingArtFrame, standingArtUrl } from '../data/standingArt'
import { modelLabel, snapshotModels } from '../services/wikiCatalog'
import { useStudioStore, useText } from '../store/useStudioStore'
import type { MessageKey } from '../i18n'

export function SelectBox({
  displayLabel,
  chevronSize = 12,
  className,
  disabled,
  children,
  ...selectProps
}: SelectHTMLAttributes<HTMLSelectElement> & { displayLabel: string; chevronSize?: number }) {
  return (
    <span className={'select-box' + (disabled ? ' disabled' : '') + (className ? ' ' + className : '')}>
      <span className="select-value" aria-hidden="true">{displayLabel}</span>
      <ChevronDown className="select-chevron" size={chevronSize} aria-hidden="true" />
      <select {...selectProps} disabled={disabled}>
        {children}
      </select>
    </span>
  )
}

export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      {...props}
      className={'icon-button ' + (props.className ?? '')}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}
export function Portrait({ id }: { id: string }) {
  const index = portraitIndex[id]
  if (!Object.hasOwn(portraitIndex, id))
    return (
      <span className="portrait empty">
        <UserRound />
      </span>
    )
  return (
    <span
      className="portrait"
      aria-hidden="true"
      style={{
        backgroundSize: `${portraitColumns * 100}% ${portraitRows * 100}%`,
        backgroundPosition: `${((index % portraitColumns) * 100) / (portraitColumns - 1)}% ${(Math.floor(index / portraitColumns) * 100) / (portraitRows - 1)}%`,
      }}
    />
  )
}
function StandingArtImage({ id }: { id: string }) {
  const url = standingArtUrl(id)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const [cx, top, height] = standingArtFrame(id)
  const checkCached = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setStatus('loaded')
  }, [])
  if (!url || status === 'failed')
    return (
      <span className="portrait-medallion">
        <Portrait id={id} />
      </span>
    )
  return (
    <img
      ref={checkCached}
      className="standing-art"
      style={{ '--art-cx': cx + '%', '--art-top': top + '%', '--art-h': height + '%' } as CSSProperties}
      data-loaded={status === 'loaded'}
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onLoad={() => setStatus('loaded')}
      onError={() => setStatus('failed')}
    />
  )
}
export function StandingArt({ id }: { id: string }) {
  return <StandingArtImage key={id} id={id} />
}
export function useModelLabel() {
  const models = useStudioStore((s) => s.models),
    files = useStudioStore((s) => s.localFiles),
    lang = useStudioStore((s) => s.language)
  return (id: string) => {
    const model = models.find((m) => m.id === id) ?? snapshotModels.find((m) => m.id === id)
    return model ? modelLabel(model, lang) : (files[id]?.name ?? id)
  }
}
export function Tabs<K extends MessageKey>({
  keys,
  value,
  onChange,
  label,
}: {
  keys: readonly K[]
  value: K
  onChange: (key: K) => void
  label: string
}) {
  const t = useText()
  return (
    <nav className="panel-tabs" aria-label={label}>
      {keys.map((key) => (
        <button key={key} aria-pressed={value === key} onClick={() => onChange(key)}>
          {t(key)}
        </button>
      ))}
    </nav>
  )
}
export function Toggle({
  label,
  checked,
  title,
  onChange,
}: {
  label: string
  checked: boolean
  title?: string
  onChange: () => void
}) {
  return (
    <button className="toggle-row" title={title} role="switch" aria-checked={checked} onClick={onChange}>
      <span>{label}</span>
      <span className="switch" aria-hidden="true" />
    </button>
  )
}
export function ShellSection({
  icon,
  title,
  note,
  children,
}: {
  icon: ReactNode
  title: MessageKey
  note: MessageKey
  children?: ReactNode
}) {
  const t = useText()
  return (
    <section className="shell-section">
      <span className="section-symbol">{icon}</span>
      <h3>{t(title)}</h3>
      <p>{t(note)}</p>
      {children}
    </section>
  )
}
