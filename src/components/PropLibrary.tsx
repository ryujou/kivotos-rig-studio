import { useEffect, useRef, useState } from 'react'
import { meshLabel } from '../i18n/meshLabels'
import { Armchair, PackagePlus, Paperclip, Search } from 'lucide-react'
import { propModels, type PropCategory, type PropModel } from '../data/propModels'
import { newProp } from '../engine/PropTypes'
import {
  mountFurniture,
  parseFurnitureFiles,
  readPackIndex,
  readRemotePack,
  type FurniturePack,
} from '../services/furniturePack'
import { normalizeSearch } from '../services/wikiCatalog'
import { useActiveSlot, useStudioStore, useText } from '../store/useStudioStore'
import type { MessageKey } from '../i18n'
import { BoneSelect, DropFiles, ModelSelect } from './InteractionControls'
import { IconButton, useModelLabel } from './shared'

function PackImport() {
  const t = useText(),
    activeId = useStudioStore((s) => s.activeId),
    url = useStudioStore((s) => s.indexUrl)
  const [target, setTarget] = useState<{ id: number | null; bone: string }>({ id: null, bone: 'world' })
  const [packs, setPacks] = useState<{ name: string; url: string }[]>([])
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<MessageKey | null>(null)
  async function mount(work: Promise<FurniturePack>) {
    setBusy(true)
    setNotice(null)
    const active = activeId
    try {
      const pack = await work
      mountFurniture(pack, pack.student ? active : (target.id ?? active), target.bone)
      setNotice('importReady')
    } catch {
      setNotice('packError')
    } finally {
      setBusy(false)
    }
  }
  async function index() {
    setBusy(true)
    setNotice(null)
    try {
      const list = await readPackIndex(url)
      setPacks(list)
      if (!list.length) setNotice('noPacks')
    } catch {
      setPacks([])
      setNotice('indexError')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="import-section">
      <h3 className="work-heading">
        <Armchair size={15} />
        {t('importPack')}
      </h3>
      <DropFiles
        text={t(busy ? 'loading' : 'packDrop')}
        accept=".glb,.zip,.json"
        disabled={busy}
        load={(files) => void mount(parseFurnitureFiles(files))}
      />
      <BoneSelect slotId={target.id} bone={target.bone} change={(id, bone) => setTarget({ id, bone })} />
      <details className="url-setting">
        <summary>{t('packIndex')}</summary>
        <input
          type="url"
          value={url}
          aria-label={t('packIndex')}
          onChange={(e) => {
            useStudioStore.getState().setUrl('indexUrl', e.target.value)
            setPacks([])
          }}
        />
        <button className="quiet-button" disabled={!url.trim() || busy} onClick={() => void index()}>
          {t('loadIndex')}
        </button>
        {packs.map((p) => (
          <button
            className="pack-link"
            key={p.url}
            disabled={busy}
            onClick={() => void mount(readRemotePack(p.url))}
          >
            {p.name}
          </button>
        ))}
      </details>
      {notice && <small role="status">{t(notice)}</small>}
    </section>
  )
}
function borrow(id: string, subset: string, clip = '', slotId: number | null = null, bone = 'world') {
  const s = useStudioStore.getState(),
    prop = newProp(id, subset)
  prop.clip = clip
  prop.slotId = slotId
  prop.bone = bone
  s.upsertProp(prop)
  s.selectProp(prop.id)
  s.updateUI({ right: 'adjust', rightOpen: typeof window === 'undefined' || window.innerWidth > 900 })
}
function PropRow({ model }: { model: PropModel }) {
  const t = useText(),
    label = useModelLabel(),
    [selection, setSelection] = useState(model.meshes[0])
  function useMotion() {
    const s = useStudioStore.getState(),
      slot = s.slots.find((k) => k.id === s.activeId)!
    s.updateSlot(slot.id, {
      motion: model.id,
      clip: model.clip,
      externalClips: [],
      endClip: undefined,
      socket: undefined,
      embedded: {},
      rig: { ...slot.rig, rootMode: 'prop-locked', selectedBone: '', overrides: {} },
    })
    s.focusSlot(slot.id)
    s.seek(0)
    s.setTimeline({ playing: true, trimStart: 0, trimEnd: 1 })
  }
  return (
    <article className="asset-row prop-row">
      <b>{label(model.id)}</b>
      <small>{model.tags.map((tag) => t(tag)).join(' · ')}</small>
      {model.meshes.length > 1 && (
        <select
          aria-label={t('meshGroup') + ' · ' + label(model.id)}
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
        >
          {model.meshes.map((mesh, i) => (
            <option key={mesh} value={mesh}>
              {meshLabel(mesh, i, t)} · {mesh}
            </option>
          ))}
        </select>
      )}
      <div className="asset-actions">
        <button onClick={useMotion}>{t('loadMotionProp')}</button>
        <IconButton
          label={t('mountOnly') + ' · ' + label(model.id)}
          onClick={() => borrow(model.id, selection, model.clip)}
        >
          <Paperclip size={14} />
        </IconButton>
      </div>
    </article>
  )
}
function DonorBrowser() {
  const t = useText(),
    slot = useActiveSlot()
  const [id, setId] = useState(slot.actor),
    [choices, setChoices] = useState<string[] | null>(null)
  const [subset, setSubset] = useState('weapon'),
    [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [target, setTarget] = useState<{ id: number | null; bone: string }>({ id: null, bone: 'world' })
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  async function inspect() {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setStatus('loading')
    try {
      const s = useStudioStore.getState()
      const source = s.localFiles[id] ?? s.models.find((m) => m.id === id)?.url
      if (!source) throw Error('unknown_model')
      const { ModelLoader } = await import('../engine/ModelLoader')
      const model = await new ModelLoader(1).load(source, undefined, controller.signal)
      try {
        const meshes = Array.from(new Set(model.propMeshes.map((mesh) => model.meshGroups.get(mesh)!)))
        if (model.weaponMeshes.length) meshes.push('weapon')
        setChoices(meshes)
        setSubset(meshes[0] ?? '')
        setStatus('idle')
      } finally {
        model.dispose()
      }
    } catch {
      if (!controller.signal.aborted) setStatus('error')
    }
  }
  return (
    <section>
      <h3 className="work-heading">{t('anyDonor')}</h3>
      <ModelSelect
        label={t('donorModel')}
        value={id}
        onChange={(next) => {
          pending.current?.abort()
          setId(next)
          setChoices(null)
          setSubset('weapon')
          setStatus('idle')
        }}
      />
      <button className="quiet-button" disabled={status === 'loading'} onClick={() => void inspect()}>
        {t(status === 'loading' ? 'loading' : 'inspectMeshes')}
      </button>
      {choices &&
        (choices.length ? (
          <select aria-label={t('meshGroup')} value={subset} onChange={(e) => setSubset(e.target.value)}>
            {choices.map((name, i) => (
              <option key={name} value={name}>
                {name === 'weapon' ? t('weapon') : meshLabel(name, i, t) + ' · ' + name}
              </option>
            ))}
          </select>
        ) : (
          <small>{t('noProps')}</small>
        ))}
      {status === 'error' && <small role="alert">{t('propFailed')}</small>}
      <BoneSelect slotId={target.id} bone={target.bone} change={(id, bone) => setTarget({ id, bone })} />
      <button
        className="quiet-button"
        disabled={!subset}
        onClick={() => borrow(id, subset, '', target.id, target.bone)}
      >
        {t('mountOnly')}
      </button>
    </section>
  )
}
export function PropLibrary() {
  const t = useText(),
    models = useStudioStore((s) => s.models)
  const [category, setCategory] = useState<PropCategory | 'all'>('all'),
    [query, setQuery] = useState('')
  const search = new Map(models.map((m) => [m.id, m.search]))
  const terms = normalizeSearch(query).split(' ').filter(Boolean)
  const list = propModels.filter(
    (p) =>
      (category === 'all' || p.categories.includes(category)) &&
      terms.every((word) =>
        normalizeSearch([search.get(p.id), ...p.meshes, ...p.tags.map((tag) => t(tag))].join(' ')).includes(
          word,
        ),
      ),
  )
  return (
    <div className="work-scroll">
      <details className="disclosure">
        <summary>{t('importBorrow')}</summary>
        <PackImport />
        <DonorBrowser />
      </details>
      <h3 className="work-heading">
        <PackagePlus size={15} />
        {t('propLibrary')}
        <span className="counter">{list.length}</span>
      </h3>
      <div className="search-field">
        <Search size={14} />
        <input
          aria-label={t('propSearch')}
          placeholder={t('propSearch')}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="chips wrapped">
        {(['all', 'instruments', 'furniture', 'vehicles', 'props'] as const).map((c) => (
          <button key={c} aria-pressed={c === category} onClick={() => setCategory(c)}>
            {t(c)}
          </button>
        ))}
      </div>
      {list.map((model) => (
        <PropRow key={model.id} model={model} />
      ))}
      {!list.length && <p className="empty-state">{t('noModels')}</p>}
    </div>
  )
}
