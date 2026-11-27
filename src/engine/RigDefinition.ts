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
  gravity: number
}
export interface RigSettings {
  rootMode: 'ground-scaled' | 'prop-locked'
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
    spring: { enabled: false, stiffness: 0.5, damping: 0.15, gravity: 1.8 },
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
export function classifyBone(key: string): BodyPart | 'secondary' {
  if (/weapon/.test(key)) return 'weapon'
  if (/(?:^|_)(?:eye|eyes|eyelid|eyelash|eyebrow|eyeblow|eyeball|cheek|mouth|brow)(?:_|\d|$)/.test(key))
    return 'face'
  if (/^(?:bip001_(?:head|neck)|haloroot)$/.test(key)) return 'head'
  if (/^bip001(?:_(?:spine\d*|pelvis))?$/.test(key)) return 'torso'
  if (/thigh|calf|foot|toe|knee|_hip/.test(key)) return 'legs'
  if (/clavicle|upperarm|forearm|hand|finger|wrist|deltoid|elbow/.test(key)) {
    if (key.split('_').includes('l')) return 'leftArm'
    if (key.split('_').includes('r')) return 'rightArm'
  }
  return 'secondary'
}
