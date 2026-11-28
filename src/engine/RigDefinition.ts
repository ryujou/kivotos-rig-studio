export type Vec3 = [number, number, number]
export const bodyParts = ['head', 'face', 'leftArm', 'rightArm', 'torso', 'legs', 'weapon'] as const
export type BodyPart = (typeof bodyParts)[number]
export type PartSource = 'motionB' | 'actorA' | 'rest'
export interface BoneOverride {
  source?: string
  muted?: boolean
  rotation?: Vec3
}
export interface SpringSettings {
  enabled: boolean
  stiffness: number
  damping: number
  windAngle: number
  wind: number
  gravity: number
}
export interface RigSettings {
  rootMode: 'ground-scaled' | 'prop-locked'
  gpuCloth: boolean
  gripIK: boolean
  antiClip: boolean
  armSpread: number
  offset: Vec3
  mixer: Record<BodyPart, PartSource>
  spring: SpringSettings
  expressionSync: boolean
  mirror: boolean
  secondaryClip: string
  overrides: Record<string, BoneOverride>
  selectedBone: string
  showActorWeapon: boolean
}
export function defaultRig(): RigSettings {
  return {
    rootMode: 'ground-scaled',
    antiClip: true,
    gripIK: true,
    gpuCloth: true,
    armSpread: 0,
    offset: [0, 0, 0],
    mixer: {
      head: 'motionB',
      face: 'motionB',
      leftArm: 'motionB',
      rightArm: 'motionB',
      torso: 'motionB',
      legs: 'motionB',
      weapon: 'motionB',
    },
    spring: { enabled: true, stiffness: 0.55, damping: 0.55, gravity: 1.8, wind: 0, windAngle: 0 },
    expressionSync: true,
    mirror: false,
    secondaryClip: '',
    overrides: {},
    selectedBone: '',
    showActorWeapon: true,
  }
}

const aliases: Record<string, string> = { tw: 'twist', eyeblow: 'eyebrow', left: 'l', right: 'r' }
export function canonicalBoneName(name: string) {
  const words = name
    .trim()
    .toLowerCase()
    .replace(
      /(eye|eyeblow|eyebrow|skirt|hair|ribbon|wing|hand|foot|sleeve|coat|tail)([lr])(?=\d|_|$)/g,
      '$1_$2',
    )
    .replace(/([lr])(\d+)/g, '$1_$2')
    .split(/[\s_:-]+/)
    .filter(Boolean)
    .map((word) => aliases[word] ?? word)
  // The twist helpers have both Bone and Bip001(_B) spellings in official rigs.
  return words
    .join('_')
    .replace(/^(?:bone|bip001(?:_b)?)_([lr])_(forearm|upperarm|thigh)_twist$/, 'bip001_$1_$2_twist')
}
const opposite: Record<string, string> = { l: 'r', r: 'l', fl: 'fr', fr: 'fl', bl: 'br', br: 'bl' }
export function mirrorBoneName(key: string) {
  return key
    .split('_')
    .map((word) => opposite[word] ?? word)
    .join('_')
}
export const weaponKey = /^bip001_weapon(?:_[rl])?$/
export function weaponSourceKey(key: string, mirror: boolean, available: ReadonlyMap<string, unknown>) {
  if (key === 'bip001_weapon' && available.has(key)) return key
  const left = key.endsWith('_l') !== mirror
  const dual = left ? 'bip001_weapon_l' : 'bip001_weapon_r'
  if (available.has(dual)) return dual
  if (!left && available.has('bip001_weapon')) return 'bip001_weapon'
}
// Both spellings occur in the game rigs. The unweighted "_Point" markers
// and the anatomical calf joints are separate nodes.
export const kimonoHemKey = /^(?:bone|boen)_calfpoint_[fb]$/
export const sleevePanelKey = /(?:^|_)(?:[lr]?sleeves?|handsleeve|sodetake|sode|yukata)(?=_|\d|$)/
export const bodyTailKey = /^(?:(?:bone|bip001)_(?:hip_|cat_?|dog_?)?tail|tail_bone)(?:_?(?:\d+|[lr]|end|nub))*$/
export function classifyBone(key: string): BodyPart | 'secondary' {
  if (/weapon/.test(key)) return 'weapon'
  if (/(?:^|_)(?:eye|eyes|eyelid|eyelash|eyebrow|eyeblow|eyeball|cheek|mouth|brow)(?:_|\d|$)/.test(key))
    return 'face'
  if (/^(?:bip001_(?:head|neck)|haloroot)$/.test(key)) return 'head'
  if (/^bip001(?:_(?:spine\d*|pelvis))?$/.test(key)) return 'torso'
  if (kimonoHemKey.test(key) || sleevePanelKey.test(key) || bodyTailKey.test(key)) return 'secondary'
  if (/thigh|calf|foot|toe|knee|_hip/.test(key)) return 'legs'
  if (/clavicle|upperarm|forearm|hand|finger|wrist|deltoid|elbow/.test(key)) {
    if (key.split('_').includes('l')) return 'leftArm'
    if (key.split('_').includes('r')) return 'rightArm'
  }
  return 'secondary'
}
