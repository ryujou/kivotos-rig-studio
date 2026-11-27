import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { UserRound } from 'lucide-react'
import { portraitColumns, portraitIndex, portraitRows } from '../data/portraits'
import { modelLabel, snapshotModels } from '../services/wikiCatalog'
import { useStudioStore, useText } from '../store/useStudioStore'
import type { MessageKey } from '../i18n'

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
  if (index === undefined)
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
