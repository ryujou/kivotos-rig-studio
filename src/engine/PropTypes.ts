import type { Vec3 } from './RigDefinition'

export interface Transform {
  position: Vec3
  rotation: Vec3 // Degrees in local XYZ order.
  scale: Vec3
}
export const identityTransform = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
})
export interface WeaponSettings {
  source: 'actorA' | 'motionB' | 'donorC' | 'hidden'
  attach: 'weaponTrack' | 'rightHand'
  donor: string
  position: Vec3
  rotation: Vec3
  scale: number
}
export const defaultWeapon = (): WeaponSettings => ({
  source: 'actorA',
  attach: 'weaponTrack',
  donor: '',
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
})
export interface HaloSettings {
  source: 'actorA' | 'motionB' | 'donorC' | 'hidden'
  donor: string
  position: Vec3
  rotation: Vec3
  scale: number
}
export const defaultHalo = (): HaloSettings => ({
  source: 'actorA',
  donor: '',
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
})
export interface MountedProp extends Transform {
  id: string
  modelId: string
  name?: string
  file?: File
  subset: 'whole' | 'weapon' | 'halo' | string // Also accepts a raw mesh group name for individual Wiki props.
  slotId: number | null
  bone: string
  visible: boolean
  syncAnimation: boolean
  clip: string
  clips: { name: string; duration: number }[]
  status: 'loading' | 'ready' | 'error'
}
export function newProp(modelId: string, subset = 'whole'): MountedProp {
  return {
    ...identityTransform(),
    id: crypto.randomUUID(),
    modelId,
    subset,
    slotId: null,
    bone: 'world',
    visible: true,
    syncAnimation: true,
    clip: '',
    clips: [],
    status: 'loading',
  }
}
