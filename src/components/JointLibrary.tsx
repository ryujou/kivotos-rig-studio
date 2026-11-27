import { useEffect, useRef, useState } from 'react'
import { ChevronRight, UsersRound, FileUp } from 'lucide-react'
import { jointCombos, type JointCombo } from '../data/jointCombos'
import { jointSlug, loadJoint } from '../services/jointLoader'
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
    [error, setError] = useState(false)
  const [files, setFiles] = useState(new Map<string, File>())
  const revision = useRef(0)
  useEffect(() => {
    setSelected(joint.comboId)
    setError(false)
  }, [joint.comboId])
  async function open(combo: JointCombo, local = files) {
    const request = ++revision.current
    setSelected(combo.id)
    setError(false)
    setBusy(true)
    try {
      await loadJoint(combo, local)
    } catch {
      if (request === revision.current) setError(true)
    } finally {
      if (request === revision.current) setBusy(false)
    }
  }
  return (
    <div className="work-scroll">
      <details className="url-setting">
        <summary>{t('proxyUrl')}</summary>
        <input
          type="url"
          value={base}
          placeholder="/api/joint/"
          aria-label={t('proxyUrl')}
          onChange={(e) => useStudioStore.getState().setUrl('proxyBase', e.target.value)}
        />
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
                    {error && <p role="alert">{t('jointFailed')}</p>}
                    {combo.members.map((m, i) => {
                      const slot = joint.comboId === combo.id ? slots.find((s) => s.id === i + 1) : undefined
                      const slug = jointSlug(m.model)
                      return (
                        <div className="member-row" key={m.model}>
                          <div>
                            <small>
                              {t('slot')} {i + 1} · {label(m.model.slice(0, -4))}
                            </small>
                            {slot && <CastSelect slot={slot} />}
                          </div>
                          {!native && (
                            <label className="file-icon" title={files.get(slug)?.name ?? t('jointFiles')}>
                              <FileUp size={15} />
                              <input
                                type="file"
                                aria-label={t('jointFiles') + ' · ' + label(m.model.slice(0, -4))}
                                accept=".joint.br,.glb"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (!file) return
                                  const next = new Map(files).set(slug, file)
                                  setFiles(next)
                                  e.target.value = ''
                                  if (combo.members.every((member) => next.has(jointSlug(member.model))))
                                    void open(combo, next)
                                }}
                              />
                            </label>
                          )}
                        </div>
                      )
                    })}
                    {!native && (
                      <DropFiles
                        text={t('jointDrop')}
                        accept=".joint.br,.glb"
                        load={(batch) => {
                          const next = new Map(files)
                          for (const f of batch) next.set(jointSlug(f.name), f)
                          setFiles(next)
                          void open(combo, next)
                        }}
                      />
                    )}
                  </div>
                )}
              </article>
            ))}
        </section>
      ))}
    </div>
  )
}
