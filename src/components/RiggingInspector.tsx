import {
  Activity,
  Bone,
  ChevronDown,
  CircleUserRound,
  Crosshair,
  Layers,
  RotateCcw,
  Search,
} from 'lucide-react'
import { useState } from 'react'
import {
  bodyParts,
  canonicalBoneName,
  mirrorBoneName,
  type BoneOverride,
  type PartSource,
  type Vec3,
} from '../engine/RigDefinition'
import { useActiveSlot, useStudioStore, useText } from '../store/useStudioStore'
import { Toggle } from './shared'

const sources: PartSource[] = ['motionB', 'actorA', 'rest']
const sourceLabels = { motionB: 'motion', actorA: 'actor', rest: 'restLock' } as const
function Axes({
  label,
  value,
  limit,
  step,
  unit,
  change,
}: {
  label: string
  value: Vec3
  limit: number
  step: number
  unit: string
  change: (v: Vec3) => void
}) {
  return (
    <div className="rig-axes" role="group" aria-label={label}>
      {['X', 'Y', 'Z'].map((axis, i) => (
        <label className="slider-row" key={axis}>
          <span>{axis}</span>
          <input
            type="range"
            aria-label={label + ' ' + axis}
            min={-limit}
            max={limit}
            step={step}
            value={value[i]}
            onChange={(e) => {
              const v: Vec3 = [...value]
              v[i] = Number(e.target.value)
              change(v)
            }}
          />
          <code>
            {value[i].toFixed(step < 1 ? 3 : 0)}
            {unit}
          </code>
        </label>
      ))}
    </div>
  )
}

export function RiggingInspector() {
  const slot = useActiveSlot(),
    { rig } = slot,
    t = useText()
  const runtime = useStudioStore((s) => s.runtime[slot.id])
  const update = useStudioStore((s) => s.setSlotRig)
  const set = (value: Partial<typeof rig>) => update(slot.id, value)
  const [search, setSearch] = useState('')
  const names = runtime?.sourceNames ?? [],
    targets = runtime?.targetNames ?? []
  const selected = targets.includes(rig.selectedBone) ? rig.selectedBone : ''
  const override = rig.overrides[selected] ?? {}
  const edit = (patch: BoneOverride) => {
    const overrides = { ...rig.overrides },
      value = { ...override, ...patch }
    if (!value.muted && !value.source && !value.rotation?.some(Boolean)) delete overrides[selected]
    else overrides[selected] = value
    set({ overrides })
  }
  const mapping = new Map(names.map((name) => [canonicalBoneName(name), name]))
  const auto = (name: string) => {
    const key = canonicalBoneName(name)
    return mapping.get(rig.mirror ? mirrorBoneName(key) : key)
  }
  const filtered = targets.filter((name) => name.toLowerCase().includes(search.trim().toLowerCase()))
  const actorClips = runtime?.actorClips ?? []
  return (
    <div className="inspector-scroll rig-controls">
      <section className="control-section">
        <h3>
          <Crosshair />
          {t('rootMotion')}
        </h3>
        <div className="rig-segment">
          {(['ground-scaled', 'prop-locked'] as const).map((mode) => (
            <button key={mode} aria-pressed={rig.rootMode === mode} onClick={() => set({ rootMode: mode })}>
              {t(mode === 'ground-scaled' ? 'groundScaled' : 'propLocked')}
            </button>
          ))}
        </div>
        <div className="rig-subheading">
          <span>{t('rootOffset')}</span>
          <button className="rig-reset" onClick={() => set({ offset: [0, 0, 0] })}>
            <RotateCcw size={12} />
            {t('zeroOffset')}
          </button>
        </div>
        <Axes
          label={t('rootOffset')}
          value={rig.offset}
          limit={0.5}
          step={0.001}
          unit=" m"
          change={(offset) => set({ offset })}
        />
      </section>
      <section className="control-section">
        <h3>
          <Layers />
          {t('bodyMixer')}
        </h3>
        <div className="part-mixer">
          {bodyParts.map((part) => {
            const mode = rig.mixer[part]
            return (
              <button
                key={part}
                data-source={mode}
                aria-label={t(part) + ' · ' + t(sourceLabels[mode])}
                onClick={() =>
                  set({
                    mixer: { ...rig.mixer, [part]: sources[(sources.indexOf(mode) + 1) % sources.length] },
                  })
                }
              >
                <strong>{t(part)}</strong>
                <span>{t(sourceLabels[mode])}</span>
              </button>
            )
          })}
        </div>
        {Object.values(rig.mixer).includes('actorA') && (
          <label className="rig-select">
            {t('secondaryClip')}
            <select
              value={
                actorClips.some((c) => c.name === rig.secondaryClip)
                  ? rig.secondaryClip
                  : (actorClips[0]?.name ?? '')
              }
              disabled={!actorClips.length}
              onChange={(e) => set({ secondaryClip: e.target.value })}
            >
              {actorClips.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
      </section>
      <section className="control-section">
        <h3>
          <Activity />
          {t('physics')}
        </h3>
        <Toggle
          label={t('springEnabled')}
          checked={rig.spring.enabled}
          onChange={() => set({ spring: { ...rig.spring, enabled: !rig.spring.enabled } })}
        />
        {(['stiffness', 'damping'] as const).map((key) => (
          <label className="slider-row" key={key}>
            <span>{t(key)}</span>
            <input
              type="range"
              min="0"
              max="1"
              step=".01"
              disabled={!rig.spring.enabled}
              value={rig.spring[key]}
              onChange={(e) => set({ spring: { ...rig.spring, [key]: Number(e.target.value) } })}
            />
            <code>{Math.round(100 * rig.spring[key])}%</code>
          </label>
        ))}
      </section>
      <section className="control-section">
        <h3>
          <CircleUserRound />
          {t('expressionSync')}
        </h3>
        <Toggle
          label={t('eyesMouth')}
          checked={rig.expressionSync}
          onChange={() => set({ expressionSync: !rig.expressionSync })}
        />
        <Toggle
          label={t('actorWeapon')}
          checked={rig.showActorWeapon && slot.weapon.source === 'actorA'}
          onChange={() => {
            const show = !rig.showActorWeapon || slot.weapon.source !== 'actorA'
            useStudioStore
              .getState()
              .updateSlot(slot.id, {
                weapon: { ...slot.weapon, source: show ? 'actorA' : 'hidden' },
                rig: { ...rig, showActorWeapon: show },
              })
          }}
        />
      </section>
      <details className="control-section remapper">
        <summary>
          <Bone size={15} />
          {t('boneMapper')}
          <ChevronDown size={14} />
        </summary>
        <Toggle label={t('mirror')} checked={rig.mirror} onChange={() => set({ mirror: !rig.mirror })} />
        <label className="search-field">
          <Search size={14} />
          <input
            type="search"
            aria-label={t('boneSearch')}
            placeholder={t('boneSearch')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="bone-list">
          {filtered.map((name) => {
            const src = rig.overrides[name]?.source ?? auto(name) ?? '—'
            return (
              <button
                key={name}
                title={name + ' ← ' + src}
                aria-pressed={selected === name}
                onClick={() => {
                  set({ selectedBone: name })
                  useStudioStore.getState().updateUI({ skeleton: true })
                }}
              >
                <span>{name}</span>
                <small>← {src}</small>
              </button>
            )
          })}
          {!filtered.length && <p className="empty-state">{t('noBones')}</p>}
        </div>
        {selected && (
          <>
            <label className="rig-select">
              {t('sourceBone')}
              <select
                value={override.source ?? ''}
                onChange={(e) => edit({ source: e.target.value || undefined })}
              >
                <option value="">
                  {t('autoMapping')} · {auto(selected) ?? '—'}
                </option>
                {names.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <Toggle
              label={t('restLock')}
              checked={!!override.muted}
              onChange={() => edit({ muted: !override.muted })}
            />
            <div className="field-label">{t('rotationOffset')}</div>
            <Axes
              label={t('rotationOffset')}
              value={override.rotation ?? [0, 0, 0]}
              limit={180}
              step={1}
              unit="°"
              change={(rotation) => edit({ rotation })}
            />
          </>
        )}
        <button
          className="quiet-button"
          disabled={!Object.keys(rig.overrides).length}
          onClick={() => set({ overrides: {} })}
        >
          <RotateCcw size={13} />
          {t('resetMapping')}
        </button>
      </details>
    </div>
  )
}
