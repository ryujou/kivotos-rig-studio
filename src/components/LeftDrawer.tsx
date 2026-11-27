import { JointLibrary } from './JointLibrary'
import { PropLibrary } from './PropLibrary'
import {
  Archive,
  History,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Plus,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { Language } from '../i18n'
import { extraOutfitTags, filterCharacters, variantLabel, modelLabel, type CatalogModel } from '../services/wikiCatalog'
import { useStudioStore, useText, useActiveSlot, type AssignmentTarget } from '../store/useStudioStore'
import { schoolNames, schoolLabels, type School } from '../i18n/schools'
import { clipSequence, sequenceDuration, type ClipCategory } from '../engine/AnimationUtils'
import { IconButton, Portrait, SelectBox, StandingArt, Tabs, useModelLabel } from './shared'

const featuredTags = ['Default', 'Swimsuit', 'Dress', 'Band', 'Maid']
const CharacterCard = memo(function CharacterCard({
  model,
  actor,
  motion,
  target,
  lang,
}: {
  model: CatalogModel
  target: AssignmentTarget
  actor: boolean
  motion: boolean
  lang: Language
}) {
  const assign = useStudioStore.getState().assign
  const outfit = model.tags.map((tag) => variantLabel(tag, lang)).join(' / ')
  return (
    <button
      type="button"
      className={'character-card' + (actor || motion ? ' assigned' : '')}
      aria-label={modelLabel(model, lang)}
      aria-pressed={target === 'actor' ? actor : motion}
      title={modelLabel(model, lang)}
      onClick={() => assign(target, model.id)}
    >
      <span
        className="card-art"
        style={{ '--hue': String(195 + (model.student.charCodeAt(0) % 14) * 9) } as CSSProperties}
      >
        <StandingArt id={model.id} />
        {(actor || motion) && (
          <span className="assignment">
            {actor && 'A'}
            {actor && motion && ' / '}
            {motion && 'B'}
          </span>
        )}
      </span>
      <span className="card-identity">
        <strong>{model.names[lang]}</strong>
        <small title={model.student + ' · ' + outfit}>
          {lang !== 'en' && model.student + ' · '}
          {outfit}
        </small>
      </span>
    </button>
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
      <div className="clip-header">
        <button className="section-heading clip-heading" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Clapperboard size={16} />
          <b>{t('clips')}</b>
          <span className="counter">{clips.length}</span>
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
        <IconButton
          label={t(importing ? 'loadingClips' : 'importClips')}
          disabled={importing}
          onClick={() => file.current?.click()}
        >
          <Plus size={15} />
        </IconButton>
      </div>
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
      {open && (
        <>
          <div className="chips clip-chips" aria-label={t('clipFilter')}>
            {(['all', 'cafe', 'interact', 'victory', 'exs', 'combat', 'vehicle', 'other'] as const).map(
              (k) => (
                <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {t(k)}
                </button>
              ),
            )}
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
function Characters({ input }: { input: RefObject<HTMLInputElement | null> }) {
  const t = useText(),
    slot = useActiveSlot(),
    models = useStudioStore((s) => s.models),
    lang = useStudioStore((s) => s.language)
  const [search, setSearch] = useState(''),
    [tag, setTag] = useState('all'),
    [more, setMore] = useState(false)
  const [school, setSchool] = useState<School | 'all'>('all')
  const target = useStudioStore((s) => s.ui.target)
  const recent = useStudioStore((s) => s.recentPicks)
  const label = useModelLabel()
  const list = useRef<HTMLDivElement>(null)
  const extraTags = useMemo(() => extraOutfitTags(models, featuredTags), [models])
  const filtered = useMemo(() => filterCharacters(models, search, school, tag), [models, search, school, tag])
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0
  }, [search, school, tag])
  function chip(key: string) {
    return (
      <button key={key} aria-pressed={tag === key} onClick={() => setTag(key)}>
        {key === 'all' || key === 'hasProps' ? t(key) : variantLabel(key, lang)}
      </button>
    )
  }
  return (
    <div className="character-pane">
      <div className="browser-controls">
        <div className="target-switch">
          {(['actor', 'motion'] as const).map((role) => (
            <button
              key={role}
              aria-pressed={target === role}
              title={label(slot[role])}
              onClick={() => useStudioStore.getState().updateUI({ target: role })}
            >
              <b>{t(role)}</b>
              <span>{label(slot[role])}</span>
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={15} />
          <input
            ref={input}
            type="search"
            value={search}
            placeholder={t('search')}
            aria-label={t('search')}
            aria-keyshortcuts="/"
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <IconButton
              label={t('clearSearch')}
              onClick={() => {
                setSearch('')
                input.current?.focus()
              }}
            >
              <X size={13} />
            </IconButton>
          ) : (
            <kbd>/</kbd>
          )}
        </div>
        <label className="school-select">
          <span>{t('school')}</span>
          <SelectBox
            value={school}
            displayLabel={school === 'all' ? t('allSchools') : schoolLabels[school][lang]}
            onChange={(e) => setSchool(e.target.value as School | 'all')}
          >
            <option value="all">{t('allSchools')}</option>
            {(Object.keys(schoolNames) as School[]).map((key) => (
              <option key={key} value={key} title={schoolNames[key][lang]}>
                {schoolLabels[key][lang]}
              </option>
            ))}
          </SelectBox>
        </label>
        <div className="quick-filters">
          <div className="chips scroll-chips">{['all', ...featuredTags, 'hasProps'].map(chip)}</div>
          <button className="more-filter" aria-expanded={more} onClick={() => setMore(!more)}>
            {!more && extraTags.includes(tag) ? variantLabel(tag, lang) : t('more')} <ChevronDown size={11} />
          </button>
        </div>
        {more && <div className="chips extra-tags">{extraTags.map(chip)}</div>}
        {recent.length > 0 && (
          <div className="recent-picks" role="group" aria-label={t('recent')}>
            <History size={14} aria-hidden="true" />
            {recent.map((id) => (
              <button
                key={id}
                title={label(id)}
                aria-label={label(id)}
                onClick={() => useStudioStore.getState().assign(target, id)}
              >
                <Portrait id={id} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="card-scroll" ref={list}>
        <div className="cards">
          {filtered.map((m) => (
            <CharacterCard
              key={m.id}
              lang={lang}
              model={m}
              target={target}
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
  const input = useRef<HTMLInputElement>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.key !== '/' ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.isComposing ||
        (e.target instanceof HTMLElement &&
          (e.target.isContentEditable || e.target.closest('input, textarea, select, dialog')))
      )
        return
      e.preventDefault()
      setUI({ left: 'characters', leftOpen: true })
      setFocusRequest((n) => n + 1)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [setUI])
  useEffect(() => {
    if (focusRequest) {
      input.current?.focus()
      input.current?.select()
    }
  }, [focusRequest])
  if (!ui.leftOpen)
    return (
      <IconButton
        className="reopen left glass"
        label={t('showLibrary')}
        onClick={() => setUI({ leftOpen: true })}
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
        keys={['characters', 'joint', 'props'] as const}
        value={ui.left}
        onChange={(left) => setUI({ left })}
        label={t('library')}
      />
      {ui.left === 'characters' && <Characters input={input} />}
      {ui.left === 'joint' && <JointLibrary />}
      {ui.left === 'props' && <PropLibrary />}
    </aside>
  )
}
