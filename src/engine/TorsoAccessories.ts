import { Mesh, type Object3D } from 'three'
import type { RestTransform } from './ModelLoader'
import { canonicalBoneName, classifyBone } from './RigDefinition'

const carried =
  /(?:^|_)(?:bag|pack|backpack|randoseru|satchel|sling|quiver|pouch|holster|rucksack)(?:_|\d|$)/
const rigid = /(?:^|_)(?:case|shield|armor)(?:_|\d|$)/
const limbWear = /sleeve|sodetake|cuff|armband|bracelet|watch|glove/

export function isRigidAccessory(key: string) {
  return !limbWear.test(key) && (carried.test(key) || rigid.test(key))
}

// Some straps are rigged to a limb even though their load rests on the torso.
// Read the original bind positions so discovery is independent of the current clip.
export function torsoAccessoryAnchor(
  root: Object3D,
  rest: ReadonlyMap<Object3D, RestTransform>,
  pelvisX: number | undefined,
) {
  const parent = root.parent
  if (!parent) return
  const group = classifyBone(canonicalBoneName(parent.name))
  if (group !== 'leftArm' && group !== 'rightArm' && group !== 'legs') return
  let anchor = parent.parent
  while (anchor && classifyBone(canonicalBoneName(anchor.name)) !== 'torso') anchor = anchor.parent
  const parentBind = rest.get(parent)
  const anchorBind = anchor && rest.get(anchor)
  if (!anchor || !anchorBind || !parentBind) return
  const midline = pelvisX ?? anchorBind.restWorldPos.x
  const side = Math.sign(parentBind.restWorldPos.x - midline)
  const wearableRoot = limbWear.test(canonicalBoneName(root.name))
  function spansTorso(node: Object3D): boolean {
    const bind = rest.get(node)
    if (!bind || node instanceof Mesh) return false
    const key = canonicalBoneName(node.name)
    return (
      (bind.restWorldPos.x - midline) * side < -0.025 ||
      (!wearableRoot && carried.test(key) && !limbWear.test(key)) ||
      node.children.some(spansTorso)
    )
  }
  if (spansTorso(root)) return anchor
}
