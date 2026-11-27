import { JointLibrary } from './JointLibrary'
import { PropLibrary } from './PropLibrary'
import { SceneOutliner } from './PropInspector'
import {
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  FilePlus2,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { memo, useMemo, useRef, useState, type CSSProperties } from 'react'
import { translate, type Language } from '../i18n'
import { normalizeSearch, variantLabel, modelLabel, type CatalogModel } from '../services/wikiCatalog'
import { useStudioStore, useText, useActiveSlot } from '../store/useStudioStore'
import { variantNames } from '../i18n/variants'
import { clipSequence, sequenceDuration, type ClipCategory } from '../engine/AnimationUtils'
import { IconButton, Portrait, Tabs } from './shared'

const featuredTags = ['Default', 'Swimsuit', 'Dress', 'Band', 'Maid', 'Hot Spring']
const CharacterCard = memo(function CharacterCard({
  model,
  actor,
  motion,
  lang,
}: {
  model: CatalogModel
  actor: boolean
  motion: boolean
  lang: Language
}) {
  const assign = useStudioStore.getState().assign
  const actorLabel = translate(lang, 'actor'),
    motionLabel = translate(lang, 'motion')
  const outfit = model.tags.map((tag) => variantLabel(tag, lang)).join(' / ')
  return (
    <article className={'character-card' + (actor ? ' assigned' : '')} title={modelLabel(model, lang)}>
      <div
        className="card-art"
        style={{ '--hue': String(195 + (model.student.charCodeAt(0) % 14) * 9) } as CSSProperties}
      >
        <Portrait id={model.id} />
        {(actor || motion) && (
          <span className="assignment">
            {actor && 'A'}
            {actor && motion && ' / '}
            {motion && 'B'}
          </span>
        )}
      </div>
      <div className="card-identity">
        <strong>{model.names[lang]}</strong>
        <small title={model.student + ' · ' + outfit}>
          {lang !== 'en' && model.student + ' · '}
          {outfit}
        </small>
      </div>
      <div className="assign-buttons">
        <button
          title={actorLabel + ' · ' + modelLabel(model, lang)}
          aria-pressed={actor}
          onClick={() => assign('actor', model.id)}
        >
          {actor && <Check size={10} />}
          {actorLabel}
        </button>
        <button
          title={motionLabel + ' · ' + modelLabel(model, lang)}
          aria-pressed={motion}
          onClick={() => assign('motion', model.id)}
        >
          {motion && <Check size={10} />}
          {motionLabel}
        </button>
      </div>
    </article>
  )
})
function ClipPicker() {
  const t = useText(),
    slot = useActiveSlot(),
    runtime = useStudioStore((s) => s.runtime[s.activeId]),
    setClip = useStudioStore((s) => s.setClip)
  const [open, setOpen] = useState(true),
    [filter, setFilter] = useState<'all' | ClipCategory>('all')
  const chain = useStudioStore((s) => s.timeline.chainStartEnd)
  const [importing, setImporting] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState(false)
  async function importMotion(input: File) {
    const target = slot
    setImportError(false)
    setImporting(true)
    try {
      const { ModelLoader } = await import('../engine/ModelLoader')
      const model = await new ModelLoader(1).load(input)
      try {
        if (!model.animations.length) throw new Error('empty_clips')
        const state = useStudioStore.getState()
        const current = state.slots.find((s) => s.id === target.id)
        if (current?.motion === target.motion && current.externalClips === target.externalClips)
          state.applyExternalClips(target.id, model.animations)
      } finally {
        model.dispose()
      }
    } catch {
      setImportError(true)
    } finally {
      setImporting(false)
    }
  }
  const clips = runtime?.clips ?? [],
    filtered = clips.filter((c) => filter === 'all' || c.category === filter)
  return (
    <section className={'clip-picker' + (open ? ' open' : '')}>
      <button className="section-heading clip-heading" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Clapperboard size={16} />
        <b>{t('clips')}</b>
        <span className="counter">{clips.length}</span>
        {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>
      {open && (
        <>
          <div className="chips clip-chips scroll-chips" aria-label={t('clipFilter')}>
            {(['all', 'cafe', 'interact', 'victory', 'exs', 'combat', 'vehicle', 'other'] as const).map(
              (k) => (
                <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {t(k)}
                </button>
              ),
            )}
          </div>
          <div className="clip-import">
            <button
              className="rig-reset"
              disabled={importing}
              aria-busy={importing}
              onClick={() => file.current?.click()}
            >
              <FilePlus2 size={12} />
              {t(importing ? 'loadingClips' : 'importClips')}
            </button>
            <input
              hidden
              ref={file}
              type="file"
              accept=".glb"
              onChange={(e) => {
                const input = e.target.files?.[0]
                if (input) void importMotion(input)
                e.target.value = ''
              }}
            />
            {importError && <small role="alert">{t('importError')}</small>}
          </div>
          <div className="clip-list">
            {filtered.map((c) => {
              const parts = c.chain === 'start' ? clipSequence(clips, c.name, true) : [c]
              return (
                <button
                  className="clip"
                  key={c.name}
                  aria-pressed={slot.clip === c.name}
                  onClick={() => setClip(c.name)}
                  title={parts.map((p) => p.name).join(' → ')}
                >
                  <i />
                  <span>{c.name}</span>
                  {parts.length > 1 ? (
                    <Link2 size={12} aria-label={t('chain')} />
                  ) : (
                    c.chain && <small>{t(c.chain)}</small>
                  )}
                  <time>{(chain ? sequenceDuration(parts) : c.duration).toFixed(2)} s</time>
                </button>
              )
            })}
            {!filtered.length && (
              <p className="empty-state">{t(runtime?.status === 'loading' ? 'loadingClips' : 'noClips')}</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
function Characters() {
  const t = useText(),
    slot = useActiveSlot(),
    models = useStudioStore((s) => s.models),
    lang = useStudioStore((s) => s.language)
  const [search, setSearch] = useState(''),
    [tag, setTag] = useState('all'),
    [more, setMore] = useState(false)
  const tags = useMemo(
    () => Array.from(new Set(models.flatMap((m) => m.tags))).filter((v) => !featuredTags.includes(v)),
    [models],
  )
  const filtered = useMemo(() => {
    const terms = normalizeSearch(search).split(' ').filter(Boolean)
    return models.filter(
      (m) =>
        (tag === 'all' || (tag === 'vehiclesProps' ? m.hasProps : m.tags.includes(tag))) &&
        terms.every((term) => m.search.includes(term)),
    )
  }, [models, search, tag])
  return (
    <div className="character-pane">
      <div className="browser-controls">
        <div className="search-field">
          <Search size={16} />
          <input
            type="search"
            value={search}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(e) => setSearch(e.target.value)}
          />
          <IconButton label={t('filters')} aria-expanded={more} onClick={() => setMore(!more)}>
            <SlidersHorizontal size={15} />
          </IconButton>
        </div>
        <div className={'chips variant-chips' + (more ? ' wrapped' : ' scroll-chips')}>
          {[
            'all',
            ...featuredTags,
            'vehiclesProps',
            ...(more ? tags : !featuredTags.includes(tag) && variantNames[tag] ? [tag] : []),
          ].map((k) => (
            <button key={k} aria-pressed={tag === k} onClick={() => setTag(k)}>
              {k === 'all' || k === 'vehiclesProps' ? t(k) : variantLabel(k, lang)}
            </button>
          ))}
        </div>
      </div>
      <div className="card-scroll">
        <div className="cards">
          {filtered.map((m) => (
            <CharacterCard
              key={m.id}
              lang={lang}
              model={m}
              actor={slot.actor === m.id}
              motion={slot.motion === m.id}
            />
          ))}
        </div>
        {!filtered.length && <p className="empty-state">{t('noModels')}</p>}
      </div>
      <ClipPicker key={slot.id + slot.motion} />
    </div>
  )
}
export function LeftDrawer() {
  const t = useText(),
    ui = useStudioStore((s) => s.ui),
    setUI = useStudioStore((s) => s.updateUI)
  const count = useStudioStore((s) => s.models.length)
  if (!ui.leftOpen)
    return (
      <IconButton
        className="reopen left glass"
        label={t('showLibrary')}
        onClick={() => setUI({ leftOpen: true, ...(window.innerWidth <= 900 ? { rightOpen: false } : {}) })}
      >
        <PanelLeftOpen size={19} />
      </IconButton>
    )
  return (
    <aside className="panel glass library-panel" aria-label={t('library')}>
      <div className="panel-header">
        <span className="panel-icon">
          <Archive size={18} />
        </span>
        <h2>{t('library')}</h2>
        <span className="counter">{count}</span>
        <IconButton label={t('collapse')} onClick={() => setUI({ leftOpen: false })}>
          <PanelLeftClose size={16} />
        </IconButton>
      </div>
      <Tabs
        keys={['characters', 'joint', 'props', 'scene'] as const}
        value={ui.left}
        onChange={(left) => setUI({ left })}
        label={t('library')}
      />
      {ui.left === 'characters' && <Characters />}
      {ui.left === 'joint' && <JointLibrary />}
      {ui.left === 'props' && <PropLibrary />}
      {ui.left === 'scene' && <SceneOutliner />}
    </aside>
  )
}
