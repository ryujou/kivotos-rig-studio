import { Crosshair, RotateCcw, Search } from 'lucide-react'
import { WeaponControls, HaloControls, SceneOutliner } from './PropInspector'
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
import { SelectBox, Toggle } from './shared'

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

export function AdjustInspector() {
  const slot = useActiveSlot(),
    { rig } = slot,
    t = useText()
  const runtime = useStudioStore((s) => s.runtime[slot.id])
  const ui = useStudioStore((s) => s.ui)
  const setUI = useStudioStore((s) => s.updateUI)
  const slots = useStudioStore((s) => s.slots.length)
  const mounted = useStudioStore((s) => s.props.length)
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
    if (runtime?.manualOnlyTargets?.has(name)) return undefined
    const key = canonicalBoneName(name)
    return mapping.get(rig.mirror ? mirrorBoneName(key) : key)
  }
  const filtered = targets.filter((name) => name.toLowerCase().includes(search.trim().toLowerCase()))
  const actorClips = runtime?.actorClips ?? []
  const activeSecondaryClip = actorClips.some((c) => c.name === rig.secondaryClip)
    ? rig.secondaryClip
    : (actorClips[0]?.name ?? '')
  const autoMappingLabel = t('autoMapping') + ' · ' + (auto(selected) ?? '—')
  return (
    <div className="inspector-scroll adjust-inspector">
      <WeaponControls />
      <HaloControls />
      <section className="control-section">
        <h3>
          <Crosshair />
          {t('rootMode')}
        </h3>
        <div className="rig-segment">
          {(['ground-scaled', 'prop-locked'] as const).map((mode) => (
            <button key={mode} aria-pressed={rig.rootMode === mode} onClick={() => set({ rootMode: mode })}>
              {t(mode === 'ground-scaled' ? 'groundScaled' : 'propLocked')}
            </button>
          ))}
        </div>
        <Toggle
          label={t('expressionSync')}
          checked={rig.expressionSync}
          onChange={() => set({ expressionSync: !rig.expressionSync })}
        />
        <Toggle
          label={t('hairPhysics')}
          checked={rig.spring.enabled}
          onChange={() => set({ spring: { ...rig.spring, enabled: !rig.spring.enabled } })}
        />
        <Toggle label={t('mirror')} checked={rig.mirror} onChange={() => set({ mirror: !rig.mirror })} />
      </section>
      <details className="disclosure">
        <summary>{t('bodyMixer')}</summary>
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
            <SelectBox
              value={activeSecondaryClip}
              displayLabel={activeSecondaryClip}
              disabled={!actorClips.length}
              onChange={(e) => set({ secondaryClip: e.target.value })}
            >
              {actorClips.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </SelectBox>
          </label>
        )}
      </details>
      <details className="disclosure">
        <summary>{t('rootTuning')}</summary>
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
      </details>
      <details className="disclosure remapper">
        <summary>{t('mappingSkeleton')}</summary>
        <Toggle
          label={t('skeleton')}
          checked={ui.skeleton}
          onChange={() => setUI({ skeleton: !ui.skeleton })}
        />
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
              <SelectBox
                value={override.source ?? ''}
                displayLabel={override.source ?? autoMappingLabel}
                onChange={(e) => edit({ source: e.target.value || undefined })}
              >
                <option value="">{autoMappingLabel}</option>
                {names.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </SelectBox>
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
      <details className="disclosure">
        <summary>
          {t('sceneSlots')}
          {(slots > 1 || mounted > 0) && <span className="counter">{slots + mounted}</span>}
        </summary>
        <div className="field-label">{t('gizmo')}</div>
        <div className="weapon-options" role="group" aria-label={t('gizmo')}>
          {(['off', 'move', 'rotate', 'scale'] as const).map((gizmo) => (
            <button key={gizmo} aria-pressed={ui.gizmo === gizmo} onClick={() => setUI({ gizmo })}>
              {t(gizmo)}
            </button>
          ))}
        </div>
        <SceneOutliner />
      </details>
    </div>
  )
}
