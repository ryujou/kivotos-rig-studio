import { localized, type Localized } from '../i18n/types'
import { studentNames, type StudentName } from '../i18n/studentNames'
import { variantNames } from '../i18n/variants'
export interface ComboMember {
  model: string
  x: number
  z: number
  deg: number
  flip: boolean
  start: string
  end: string
}
export interface JointCombo {
  id: string
  native: boolean
  title: Localized
  members: ComboMember[]
}
const official: { id: string; members: ComboMember[] }[] = [
  {
    id: '1',
    members: [
      {
        model: 'Hina (Dress).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Ako (Dress).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.33,
        z: -0.69,
        deg: 60,
        flip: false,
      },
    ],
  },
  {
    id: '3',
    members: [
      {
        model: 'Kazusa (Band).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Airi (Band).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Yoshimi (Band).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.9,
        z: 0,
        deg: -20,
        flip: false,
      },
    ],
  },
  {
    id: '4',
    members: [
      {
        model: 'Midori (Maid).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Momoi (Maid).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
    ],
  },
  {
    id: '5',
    members: [
      {
        model: 'Shiroko.glb',
        start: 'Victory_Start_Interaction_01',
        end: 'Victory_End_Interaction_01',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Shiroko＊Terror.glb',
        start: 'Victory_Start_Interaction_01',
        end: 'Victory_End_Interaction_01',
        x: 0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
    ],
  },
  {
    id: '6',
    members: [
      {
        model: 'Mine (Idol).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.75,
        z: 0.2,
        deg: 20,
        flip: false,
      },
      {
        model: 'Mari (Idol).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Sakurako (Idol).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
    ],
  },
  {
    id: '7',
    members: [
      {
        model: 'Neru (School Uniform).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.37,
        z: 0.02,
        deg: 5,
        flip: false,
      },
      {
        model: 'Seia.glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
    ],
  },
  {
    id: '8',
    members: [
      {
        model: 'Hikari.glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Nozomi.glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
    ],
  },
  {
    id: '9',
    members: [
      {
        model: 'Natsu (Band).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.9,
        z: 0,
        deg: 20,
        flip: false,
      },
      {
        model: 'Kazusa (Band).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Airi (Band).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Yoshimi (Band).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.9,
        z: 0,
        deg: -20,
        flip: false,
      },
    ],
  },
  {
    id: '10',
    members: [
      {
        model: 'Seia (Swimsuit).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Nagisa (Swimsuit).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.17,
        z: 0.12,
        deg: -5,
        flip: false,
      },
      {
        model: 'Mika (Swimsuit).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.9,
        z: 0,
        deg: -20,
        flip: false,
      },
    ],
  },
  {
    id: '11',
    members: [
      {
        model: 'Saori (Swimsuit).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Hiyori (Swimsuit).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Misaki (Swimsuit).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.37,
        z: 0.41,
        deg: -5,
        flip: false,
      },
      {
        model: 'Atsuko (Swimsuit).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.29,
        z: 0.29,
        deg: -5,
        flip: false,
      },
    ],
  },
  {
    id: '12',
    members: [
      {
        model: 'Suzumi (Magical).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.45,
        z: 0.48,
        deg: 5,
        flip: false,
      },
      {
        model: 'Reisa (Magical).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.33,
        z: 0.18,
        deg: -5,
        flip: false,
      },
    ],
  },
  {
    id: '13',
    members: [
      {
        model: 'Arisu (Battle).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Kei.glb',
        start: 'Victory_Start_Interaction_01',
        end: 'Victory_End_Interaction_01',
        x: 0.36,
        z: -0.03,
        deg: 5,
        flip: false,
      },
    ],
  },
  {
    id: '14',
    members: [
      {
        model: 'Arisu.glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Kei.glb',
        start: 'Victory_Start_Interaction_02',
        end: 'Victory_End_Interaction_02',
        x: 0.38,
        z: 0,
        deg: 5,
        flip: false,
      },
    ],
  },
  {
    id: '15',
    members: [
      {
        model: 'Toki (Battle).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Rio (Battle).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: 0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
    ],
  },
  {
    id: '16',
    members: [
      {
        model: 'Himari (Battle).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.37,
        z: 0.41,
        deg: -5,
        flip: false,
      },
      {
        model: 'Eimi (Battle).glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
    ],
  },
  {
    id: '17',
    members: [
      {
        model: 'Kirara.glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.3,
        z: 0,
        deg: 5,
        flip: false,
      },
      {
        model: 'Erika.glb',
        start: 'Victory_Start_Interaction',
        end: 'Victory_End_Interaction',
        x: -0.37,
        z: 0.41,
        deg: -5,
        flip: false,
      },
    ],
  },
]
function title(members: ComboMember[]): Localized {
  const names = members.map(({ model }) => {
    const id = model.replace(/\.glb$/i, '')
    const [, name, skin] = /^([^()]+?)(?: \(([^()]+)\))?$/.exec(id)!
    const student = studentNames[name as StudentName]
    const variant = variantNames[skin]
    return skin
      ? localized(variant.zh + student.zh, variant.ja + student.ja, variant.ko + ' ' + student.ko, id)
      : student
  })
  const join = (lang: keyof Localized) => names.map((n) => n[lang]).join(' & ')
  return localized(join('zh'), join('ja'), join('ko'), join('en'))
}
function native(model: string, start: string, x = 0, end = ''): ComboMember {
  return { model: model + '.glb', x, z: 0, deg: 0, flip: false, start, end }
}
export const jointCombos: JointCombo[] = [
  ...official.map((combo) => ({ ...combo, native: false, title: title(combo.members) })),
  {
    id: 'toramaru',
    native: true,
    title: localized(
      '伊吕波与伊吹 · 虎丸双人乘组',
      'イロハとイブキ・虎丸相乗り',
      '이로하와 이부키 · 토라마루 동승',
      'Iroha & Ibuki · Toramaru tank tandem',
    ),
    members: [
      native('Iroha', 'SM015601_TSAInteraction', 0, 'SM015601_Riding_Idle'),
      native('Ibuki', 'TSAInteraction', 0, 'Riding_Idle'),
    ],
  },
  {
    id: 'maid-twins',
    native: true,
    title: localized(
      '女仆桃井与绿 · 双子 EX',
      'メイドモモイとミドリ・双子のEX',
      '메이드 모모이와 미도리 · 쌍둥이 EX',
      'Maid Momoi & Midori · Twin EX cut-in',
    ),
    members: [native('Momoi (Maid)', 'CH0202_Exs_Cutin'), native('Midori (Maid)', 'CH0201_Exs_Cutin')],
  },
  {
    id: 'sweets-band',
    native: true,
    title: localized(
      '放学后甜点部 · 四人乐队',
      '放課後スイーツ部・4人ライブ',
      '방과후 디저트부 · 4인 밴드',
      'After-School Sweets · Four-member stage',
    ),
    members: [
      native('Airi (Band)', 'NonWeapon_Keyboard', -1.4),
      native('Kazusa (Band)', 'NonWeapon_Bass', -0.45),
      native('Yoshimi (Band)', 'NonWeapon_Guitar', 0.55),
      native('Natsu (Band) (No Weapon)', 'Drum', 1.6),
    ],
  },
]
