import { droppedFiles } from '../services/furniturePack'
import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { useStudioStore, useText, type Slot } from '../store/useStudioStore'
import { modelLabel } from '../services/wikiCatalog'
import type { Vec3 } from '../engine/RigDefinition'
import { canonicalBoneName } from '../engine/RigDefinition'
import type { MessageKey } from '../i18n'
import { SelectBox } from './shared'

export function ModelSelect({
  value,
  onChange,
  label,
  children,
}: {
  value: string
  onChange: (id: string) => void
  label: string
  children?: ReactNode
}) {
  const models = useStudioStore((s) => s.models),
    lang = useStudioStore((s) => s.language),
    t = useText()
  const files = useStudioStore((s) => s.localFiles)
  const model = models.find((m) => m.id === value)
  const selectProps = {
    'aria-label': label,
    value,
    onChange: (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value),
  }
  const options = (
    <>
      {!files[value] && !model && <option value={value}>{t('choose')}</option>}
      {Object.entries(files)
        .filter(([id]) => id.startsWith('local:'))
        .map(([id, file]) => (
          <option key={id} value={id}>
            {file.name}
          </option>
        ))}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {modelLabel(m, lang)}
        </option>
      ))}
    </>
  )
  if (children)
    return (
      <label className="cast-select" title={label}>
        {children}
        <select {...selectProps}>{options}</select>
      </label>
    )
  return (
    <label className="model-select" title={label}>
      <SelectBox
        {...selectProps}
        displayLabel={model ? modelLabel(model, lang) : (files[value]?.name ?? t('choose'))}
      >
        {options}
      </SelectBox>
    </label>
  )
}
export function CastSelect({ slot, children }: { slot: Slot; children?: ReactNode }) {
  const t = useText(),
    s = useStudioStore.getState()
  return (
    <ModelSelect
      value={slot.actor}
      label={t('cast') + ' · ' + t('slot') + ' ' + slot.id}
      onChange={(id) => {
        s.focusSlot(slot.id)
        s.assign('actor', id)
      }}
    >
      {children}
    </ModelSelect>
  )
}
export function DropFiles({
  text,
  accept,
  load,
  disabled,
}: {
  text: string
  accept: string
  load: (files: File[]) => void
  disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div
      className="drop-zone"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (!disabled) void droppedFiles(e.dataTransfer).then(load, () => load([]))
      }}
    >
      <button type="button" disabled={disabled} onClick={() => ref.current?.click()}>
        {text}
      </button>
      <input
        hidden
        type="file"
        multiple
        ref={ref}
        accept={accept}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) load(files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
export function AxisSliders({
  label,
  value,
  limit,
  step,
  onChange,
}: {
  label: string
  value: Vec3
  limit: number
  step: number
  onChange: (v: Vec3) => void
}) {
  return (
    <fieldset className="axis-controls">
      <legend>{label}</legend>
      {(['X', 'Y', 'Z'] as const).map((axis, i) => {
        const update = (n: number) => {
          if (!Number.isFinite(n)) return
          const next: Vec3 = [...value]
          next[i] = n
          onChange(next)
        }
        return (
          <label key={axis}>
            <span>{axis}</span>
            <input
              type="range"
              aria-label={label + ' ' + axis}
              min={Math.min(-limit, value[i])}
              max={Math.max(limit, value[i])}
              step={step}
              value={value[i]}
              onChange={(e) => update(+e.target.value)}
            />
            <input
              type="number"
              aria-label={label + ' ' + axis}
              step={step}
              value={Number(value[i].toFixed(3))}
              onChange={(e) => update(e.target.valueAsNumber)}
            />
          </label>
        )
      })}
    </fieldset>
  )
}

const boneKeys: Record<string, MessageKey> = {
  bip001_weapon: 'weapon',
  bip001_r_hand: 'rightHand',
  bip001_l_hand: 'leftHand',
  bip001_head: 'head',
  bip001_spine1: 'spine',
  bip001_pelvis: 'pelvis',
}
export function BoneSelect({
  slotId,
  bone,
  change,
}: {
  slotId: number | null
  bone: string
  change: (slotId: number | null, bone: string) => void
}) {
  const slots = useStudioStore((s) => s.slots),
    runtime = useStudioStore((s) => s.runtime),
    t = useText()
  function boneLabel(name: string) {
    const key = boneKeys[canonicalBoneName(name)]
    return key ? t(key) + ' · ' + name : name
  }
  return (
    <label className="select-row">
      {t('attachment')}
      <SelectBox
        value={slotId === null ? 'world' : slotId + '/' + bone}
        displayLabel={slotId === null ? t('worldOrigin') : boneLabel(bone)}
        onChange={(e) => {
          const value = e.target.value,
            i = value.indexOf('/')
          if (i < 0) change(null, 'world')
          else change(+value.slice(0, i), value.slice(i + 1))
        }}
      >
        <option value="world">{t('worldOrigin')}</option>
        {slots.map((slot) => (
          <optgroup key={slot.id} label={t('slot') + ' ' + slot.id}>
            {(runtime[slot.id]?.attachmentNames ?? []).map((name) => (
              <option key={name} value={slot.id + '/' + name}>
                {boneLabel(name)}
              </option>
            ))}
          </optgroup>
        ))}
      </SelectBox>
    </label>
  )
}
