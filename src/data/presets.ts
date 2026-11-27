import { propModels } from './propModels'
import { jointCombos } from './jointCombos'
import { cancelJointLoad, loadJoint } from '../services/jointLoader'
import { useStudioStore } from '../store/useStudioStore'
import type { MessageKey } from '../i18n'

interface Solo {
  title: MessageKey
  actor: string
  motion: string
  clip: string
  combat?: boolean
}
interface Duo {
  title: MessageKey
  combo: string
  cast: readonly string[]
}
export const showcases: (Solo | Duo)[] = [
  { title: 'hinaKeyboard', actor: 'Hina (Dress)', motion: 'Airi (Band)', clip: 'NonWeapon_Keyboard' },
  { title: 'arisuTank', actor: 'Arisu', motion: 'Cherino (Hot Spring)', clip: 'Tank_Normal_Attack_Ing' },
  { title: 'azusaBike', actor: 'Azusa', motion: 'Fuuka (New Year)', clip: 'Exs' },
  { title: 'yuukaTandem', combo: 'toramaru', cast: ['Yuuka', 'Noa'] },
  { title: 'aruDuet', combo: '1', cast: ['Aru', 'Mutsuki'] },
  { title: 'hoshinoStyle', actor: 'Hoshino', motion: 'Mika', clip: 'Normal_Attack_Ing', combat: true },
]
export async function applyShowcase(preset: Solo | Duo | 'shuffle') {
  const s = useStudioStore.getState()
  if (preset === 'shuffle') {
    const catalog = new Set(s.models.map((model) => model.id))
    const candidates = propModels.filter((model) => model.clip && catalog.has(model.id))
    const motion = candidates[Math.floor(Math.random() * candidates.length)]
    if (!motion) throw Error('presetUnavailable')
    const cast = s.models.filter((model) => model.id !== motion.id)
    if (!cast.length) throw Error('presetUnavailable')
    preset = {
      title: 'randomSwap',
      motion: motion.id,
      clip: motion.clip,
      actor: cast[Math.floor(Math.random() * cast.length)].id,
    }
  }
  if ('combo' in preset) {
    const comboId = preset.combo
    await loadJoint(jointCombos.find((c) => c.id === comboId)!, undefined, preset.cast)
  } else {
    cancelJointLoad()
    s.showcaseSolo(preset.actor, preset.motion, preset.clip, !!preset.combat)
  }
}
