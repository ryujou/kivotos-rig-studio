import type { MessageKey } from './index'

// GLB identifiers stay available in the tooltip for matching assets in a DCC editor.
const labels: [RegExp, MessageKey][] = [
  [/CH0251_Instrument/i, 'keyboard'],
  [/CH0230_SkillProp/i, 'score'],
  [/Wheelchair/i, 'wheelchair'],
  [/DjTable|Mike/i, 'microphone'],
  [/CH0221_Instrument|Drum/i, 'drums'],
  [/Instrument/i, 'instruments'],
  [/Guitar/i, 'guitar'],
  [/Bass/i, 'bass'],
  [/(?:^|_)Amp/i, 'amp'],
  [/Tank/i, 'tank'],
  [/Bike|Cycle/i, 'bike'],
  [/SM017601/i, 'helicopter'],
  [/Train/i, 'train'],
  [/Truck/i, 'truck'],
  [/Cockpit/i, 'cockpit'],
  [/Boat/i, 'boat'],
  [/_Car_/i, 'car'],
  [/Chair/i, 'chair'],
  [/Table/i, 'table'],
  [/Pillow/i, 'pillow'],
  [/HotSpring/i, 'bath'],
  [/Platform/i, 'platform'],
  [/Bag|Backpack|Travelpack/i, 'bag'],
  [/Book|NotePad|Diary|Paper/i, 'book'],
  [/Dron/i, 'drone'],
  [/Camera/i, 'cameraTag'],
  [/Drawing|Crayon/i, 'drawing'],
  [/Umbrella/i, 'umbrella'],
  [/Shield/i, 'shield'],
  [/Icecream|Dango|Bowl|Lunch|Doughnut|Cake|Dessert|Food/i, 'food'],
  [/SkillPro[bp]/i, 'skillProp'],
]
export function meshLabel(group: string, index: number, t: (k: MessageKey) => string) {
  const key = labels.find(([pattern]) => pattern.test(group))?.[1] ?? 'props'
  return t(key) + ' · ' + (index + 1)
}
