import type { ReactNode } from 'react'
import { meshLabel } from '../i18n/meshLabels'
import { Box, Crosshair, Layers3, RotateCcw, Trash2 } from 'lucide-react'
import { identityTransform, type HaloSettings, type MountedProp, type WeaponSettings } from '../engine/PropTypes'
import { useActiveSlot, useStudioStore, useText } from '../store/useStudioStore'
import { AxisSliders, BoneSelect, ModelSelect } from './InteractionControls'
import { Toggle, IconButton, SelectBox, useModelLabel } from './shared'

function MountedList() {
  const t = useText(),
    label = useModelLabel(),
    props = useStudioStore((s) => s.props),
    selected = useStudioStore((s) => s.selectedProp)
  const s = useStudioStore.getState()
  const edit = (prop: MountedProp, change: Partial<MountedProp>) => s.upsertProp({ ...prop, ...change })
  return (
    <section>
      <h3 className="work-heading">
        <Box size={15} />
        {t('mounted')}
        <span className="counter">{props.length}</span>
      </h3>
      {!props.length && <small>{t('emptyMounted')}</small>}
      {props.map((p) => (
        <article className="asset-row mounted-row" data-active={selected === p.id} key={p.id}>
          <div className="mount-title">
            <button className="asset-title" onClick={() => s.selectProp(p.id)}>
              <Crosshair size={14} />
              <b>{p.name ?? label(p.modelId)}</b>
            </button>
            <IconButton label={t('deleteProp')} onClick={() => s.removeProp(p.id)}>
              <Trash2 size={13} />
            </IconButton>
          </div>
          {p.subset !== 'whole' && <small>{p.subset === 'weapon' ? t('weapon') : p.subset}</small>}
          {p.status !== 'ready' && (
            <small role="status">{t(p.status === 'error' ? 'propFailed' : 'loading')}</small>
          )}
          {selected === p.id && (
            <div className="asset-detail">
              <Toggle
                label={t('visible')}
                checked={p.visible}
                onChange={() => edit(p, { visible: !p.visible })}
              />
              <BoneSelect
                slotId={p.slotId}
                bone={p.bone}
                change={(slotId, bone) => edit(p, { slotId, bone })}
              />
              {p.clips.length > 0 && (
                <>
                  <Toggle
                    label={t('syncAnimation')}
                    checked={p.syncAnimation}
                    onChange={() => edit(p, { syncAnimation: !p.syncAnimation })}
                  />
                  <label className="select-row">
                    {t('clips')}
                    <SelectBox
                      value={p.clip}
                      displayLabel={p.clip}
                      onChange={(e) => edit(p, { clip: e.target.value })}
                    >
                      {p.clips.map((c) => (
                        <option key={c.name}>{c.name}</option>
                      ))}
                    </SelectBox>
                  </label>
                </>
              )}
              <AxisSliders
                label={t('position')}
                value={p.position}
                limit={3}
                step={0.01}
                onChange={(position) => edit(p, { position })}
              />
              <AxisSliders
                label={t('rotation')}
                value={p.rotation}
                limit={180}
                step={1}
                onChange={(rotation) => edit(p, { rotation })}
              />
              <AxisSliders
                label={t('scale')}
                value={p.scale}
                limit={3}
                step={0.01}
                onChange={(scale) => edit(p, { scale: scale.map((v) => v || 0.001) as typeof scale })}
              />
              <button className="quiet-button" onClick={() => edit(p, identityTransform())}>
                <RotateCcw size={12} />
                {t('zeroOffset')}
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  )
}
function SourceControls({
  title, offsetLabel, value, defaultDonor, change, error, children,
}: {
  title: string
  offsetLabel: string
  value: HaloSettings
  defaultDonor: string
  change: (change: Partial<HaloSettings>) => void
  error?: string
  children?: ReactNode
}) {
  const t = useText()
  const registerFile = useStudioStore((s) => s.registerFile)
  return (
    <section className="control-section">
      <h3 className="work-heading">{title}</h3>
      <div className="weapon-options">
        {(
          [
            ['actorA', 'actor'],
            ['motionB', 'motion'],
            ['donorC', 'donor'],
            ['hidden', 'hide'],
          ] as const
        ).map(([source, key]) => (
          <button
            key={source}
            aria-pressed={value.source === source}
            onClick={() => change({ source, donor: value.donor || defaultDonor })}
          >
            {t(key)}
          </button>
        ))}
      </div>
      {value.source === 'donorC' && (
        <>
          <label className="field-label">{t('donorModel')}</label>
          <ModelSelect label={t('donorModel')} value={value.donor} onChange={(donor) => change({ donor })} />
          <label className="local-donor">
            {t('openGlb')}
            <input
              type="file"
              accept=".glb"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) change({ donor: registerFile(file) })
                e.target.value = ''
              }}
            />
          </label>
          {error && <small role="alert">{error}</small>}
        </>
      )}
      {value.source !== 'hidden' && (
        <details className="disclosure grip-offset">
          <summary>{offsetLabel}</summary>
          {children}
          <AxisSliders
            label={t('rootOffset')}
            value={value.position}
            onChange={(position) => change({ position })}
            limit={1}
            step={0.005}
          />
          <AxisSliders
            label={t('rotationOffset')}
            value={value.rotation}
            onChange={(rotation) => change({ rotation })}
            limit={180}
            step={1}
          />
          <label className="slider-row">
            <span>{t('scale')}</span>
            <input
              type="range"
              min=".01"
              max="4"
              step=".01"
              value={value.scale}
              onChange={(e) => change({ scale: +e.target.value })}
            />
            <code>{value.scale.toFixed(2)}×</code>
          </label>
          <button
            className="quiet-button"
            onClick={() => change({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })}
          >
            {t('zeroOffset')}
          </button>
        </details>
      )}
    </section>
  )
}

export function WeaponControls() {
  const t = useText(),
    slot = useActiveSlot(),
    runtime = useStudioStore((s) => s.runtime[s.activeId])
  const s = useStudioStore.getState(),
    w = slot.weapon
  function weapon(change: Partial<WeaponSettings>) {
    s.updateSlot(slot.id, {
      weapon: { ...w, ...change },
      ...(change.source === 'actorA' ? { rig: { ...slot.rig, showActorWeapon: true } } : {}),
    })
    if (runtime?.donorError) s.updateRuntime(slot.id, { donorError: false })
  }
  return (
    <>
      {!!runtime?.propGroups.length && (
        <section className="control-section">
          <h3 className="work-heading">
            <Layers3 size={15} />
            {t('embeddedProps')}
          </h3>
          {runtime?.propGroups.map((name, i) => (
            <Toggle
              key={name}
              title={name}
              label={meshLabel(name, i, t)}
              checked={slot.embedded[name] !== false}
              onChange={() =>
                s.updateSlot(slot.id, {
                  embedded: { ...slot.embedded, [name]: slot.embedded[name] === false },
                })
              }
            />
          ))}
        </section>
      )}
      <SourceControls
        title={t('weaponSource')}
        offsetLabel={t('gripOffset')}
        value={w}
        defaultDonor={slot.motion}
        change={weapon}
        error={runtime?.donorError ? t('propFailed') : undefined}
      >
        <label className="select-row">
          {t('attachMode')}
          <SelectBox
            value={w.attach}
            displayLabel={t(w.attach === 'weaponTrack' ? 'followWeapon' : 'snapHand')}
            onChange={(e) => weapon({ attach: e.target.value as WeaponSettings['attach'] })}
          >
            <option value="weaponTrack">{t('followWeapon')}</option>
            <option value="rightHand">{t('snapHand')}</option>
          </SelectBox>
        </label>
      </SourceControls>
    </>
  )
}
export function HaloControls() {
  const t = useText()
  const slot = useActiveSlot()
  const failed = useStudioStore((s) => s.runtime[slot.id]?.haloDonorError)
  const updateSlot = useStudioStore((s) => s.updateSlot)
  return (
    <SourceControls
      title={t('haloSource')}
      offsetLabel={t('haloOffset')}
      value={slot.halo}
      defaultDonor={slot.motion}
      change={(patch) => {
        if (failed) useStudioStore.getState().updateRuntime(slot.id, { haloDonorError: false })
        updateSlot(slot.id, { halo: { ...slot.halo, ...patch } })
      }}
      error={failed ? t('haloFailed') : undefined}
    />
  )
}

export function SceneOutliner() {
  const t = useText(),
    label = useModelLabel(),
    slots = useStudioStore((s) => s.slots)
  const active = useStudioStore((s) => s.activeId),
    selected = useStudioStore((s) => s.selectedProp),
    s = useStudioStore.getState()
  return (
    <>
      <h3 className="work-heading">
        <Layers3 size={15} />
        {t('outliner')}
      </h3>
      {slots.map((slot) => (
        <article className="asset-row" key={slot.id} data-active={active === slot.id && !selected}>
          <button className="asset-title" onClick={() => s.focusSlot(slot.id)}>
            <Crosshair size={14} />
            <small>
              {t('slot')} {slot.id}
            </small>
            <b>{label(slot.actor)}</b>
          </button>
          {active === slot.id && !selected && (
            <div className="asset-detail">
              <AxisSliders
                label={t('position')}
                value={slot.position}
                limit={4}
                step={0.01}
                onChange={(position) => s.transformSlot(slot.id, { position })}
              />
              <AxisSliders
                label={t('rotation')}
                value={slot.rotation}
                limit={180}
                step={1}
                onChange={(rotation) => s.transformSlot(slot.id, { rotation })}
              />
              <div className="asset-actions">
                <button onClick={() => s.transformSlot(slot.id, identityTransform())}>
                  {t('zeroOffset')}
                </button>
                {slots.length > 1 && <button onClick={() => s.removeSlot(slot.id)}>{t('removeSlot')}</button>}
              </div>
            </div>
          )}
        </article>
      ))}
      <MountedList />
    </>
  )
}
