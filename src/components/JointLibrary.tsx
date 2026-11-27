import { useEffect, useRef, useState } from 'react'
import { ChevronRight, UsersRound, FileUp } from 'lucide-react'
import { jointCombos, type JointCombo } from '../data/jointCombos'
import { jointErrorMessage, jointSlug, loadJoint } from '../services/jointLoader'
import { useStudioStore, useText } from '../store/useStudioStore'
import { CastSelect, DropFiles } from './InteractionControls'
import { useModelLabel } from './shared'

export function JointLibrary() {
  const t = useText(),
    label = useModelLabel(),
    lang = useStudioStore((s) => s.language)
  const joint = useStudioStore((s) => s.joint),
    slots = useStudioStore((s) => s.slots)
  const base = useStudioStore((s) => s.proxyBase)
  const [selected, setSelected] = useState(joint.comboId),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<ReturnType<typeof jointErrorMessage> | null>(null)
  const [files, setFiles] = useState(new Map<string, File>())
  const selectedOfficial = jointCombos.find((combo) => !combo.native && combo.id === selected)
  const revision = useRef(0)
  useEffect(() => {
    setSelected(joint.comboId)
    setError(null)
  }, [joint.comboId])
  async function open(combo: JointCombo, local = files) {
    const request = ++revision.current
    setSelected(combo.id)
    setError(null)
    setBusy(true)
    try {
      await loadJoint(combo, local)
    } catch (cause) {
      if (request === revision.current) setError(jointErrorMessage(cause))
    } finally {
      if (request === revision.current) setBusy(false)
    }
  }
  return (
    <div className="work-scroll">
      <details className="disclosure offline-settings">
        <summary>
          {t('offlineProxy')}
          {files.size > 0 && <span className="counter">{files.size}</span>}
        </summary>
        <label className="rig-select">
          {t('proxyUrl')}
          <input
            type="url"
            value={base}
            placeholder="https://…/api/joint/"
            onChange={(e) => useStudioStore.getState().setUrl('proxyBase', e.target.value)}
          />
        </label>
        <DropFiles
          text={t('jointDrop')}
          accept=".joint.br,.glb"
          load={(batch) => {
            const next = new Map(files)
            for (const file of batch) next.set(jointSlug(file.name), file)
            setFiles(next)
            const combo =
              selectedOfficial ??
              jointCombos.find((c) => !c.native && c.members.every((m) => next.has(jointSlug(m.model))))
            if (combo) void open(combo, next)
          }}
        />
        {selectedOfficial?.members.map((m) => {
          const slug = jointSlug(m.model)
          return (
            <label className="member-file" key={slug}>
              <FileUp size={14} />
              {files.get(slug)?.name ?? label(m.model.slice(0, -4))}
              <input
                type="file"
                accept=".joint.br,.glb"
                aria-label={t('jointFiles') + ' · ' + label(m.model.slice(0, -4))}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const next = new Map(files).set(slug, file)
                  setFiles(next)
                  e.target.value = ''
                  if (selectedOfficial.members.every((member) => next.has(jointSlug(member.model))))
                    void open(selectedOfficial, next)
                }}
              />
            </label>
          )
        })}
      </details>
      {[true, false].map((native) => (
        <section key={String(native)}>
          <h3 className="work-heading">
            <UsersRound size={15} />
            {t(native ? 'nativeCombo' : 'official')}
          </h3>
          {jointCombos
            .filter((c) => c.native === native)
            .map((combo) => (
              <article className="asset-row" key={combo.id} data-active={selected === combo.id}>
                <button className="asset-title" onClick={() => void open(combo)}>
                  <b>{combo.title[lang]}</b>
                  <span className="counter">{combo.members.length}</span>
                  <ChevronRight size={14} />
                </button>
                {selected === combo.id && (
                  <div className="asset-detail">
                    {busy && <small role="status">{t('loadingClips')}</small>}
                    {error && <p role="alert">{t(error)}</p>}
                    {combo.members.map((m, i) => {
                      const slot = joint.comboId === combo.id ? slots.find((s) => s.id === i + 1) : undefined
                      return (
                        <div className="member-row" key={m.model}>
                          <div>
                            <small>
                              {t('slot')} {i + 1} · {label(m.model.slice(0, -4))}
                            </small>
                            {slot && <CastSelect slot={slot} />}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </article>
            ))}
        </section>
      ))}
    </div>
  )
}
