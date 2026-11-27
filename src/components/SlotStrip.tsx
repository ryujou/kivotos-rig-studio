import { ArrowLeftRight, Plus, X, UserRoundPen } from 'lucide-react'
import { useStudioStore, useText } from '../store/useStudioStore'
import { IconButton, useModelLabel } from './shared'

import { CastSelect } from './InteractionControls'

export function SlotStrip() {
  const t = useText(),
    label = useModelLabel()
  const slots = useStudioStore((s) => s.slots),
    id = useStudioStore((s) => s.activeId),
    actions = useStudioStore.getState()
  return (
    <div className="slot-strip glass" data-slots={slots.length} aria-label={t('activeSlot')}>
      {slots.map((slot) => (
        <div className="slot-item" key={slot.id}>
          <button
            className="slot-pill"
            aria-pressed={slot.id === id}
            title={`${t('slot')} ${slot.id} · ${label(slot.actor)} ← ${label(slot.motion)}`}
            onClick={() => actions.focusSlot(slot.id)}
          >
            <i />
            <b>
              {t('slot')} {slot.id}
            </b>
            <span>
              {label(slot.actor)}
              {slot.actor !== slot.motion && ' ← ' + label(slot.motion)}
            </span>
          </button>
          <CastSelect slot={slot}>
            <UserRoundPen size={13} />
          </CastSelect>
        </div>
      ))}
      <IconButton label={t('addSlot')} disabled={slots.length === 4} onClick={actions.addSlot}>
        <Plus size={15} />
        <span>{t('addSlot')}</span>
      </IconButton>
      <IconButton label={t('swap')} onClick={actions.swap}>
        <ArrowLeftRight size={14} />
        <span>{t('swap')}</span>
      </IconButton>
      {slots.length > 1 && (
        <IconButton label={t('removeSlot')} onClick={() => actions.removeSlot(id)}>
          <X size={14} />
        </IconButton>
      )}
    </div>
  )
}
