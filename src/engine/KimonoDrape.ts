import { Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import { sleeveSide, type ClothJoint } from './ClothTopology'
import type { BodyColliders } from './BodyColliders'
import type { StudioModel } from './ModelLoader'
import { canonicalBoneName, kimonoHemKey, sleevePanelKey } from './RigDefinition'

const fixedTrim = /cuff|button|bracelet|armband|armor|glove/

function hangingSleeves(model: StudioModel, joints: readonly ClothJoint[], skin: BodyColliders) {
  const candidates = joints.filter(({ chain, bone, material }) =>
    material === 'cloth' &&
    sleevePanelKey.test(canonicalBoneName(chain.name)) &&
    sleevePanelKey.test(canonicalBoneName(bone.name)) &&
    !fixedTrim.test((chain.name + '_' + bone.name).toLowerCase()),
  )
  if (!candidates.length) return []
  const arms = new Map<string, Vector3>()
  for (const [node, bind] of model.rest) {
    const key = canonicalBoneName(node.name)
    if (/^bip001_[lr]_(?:hand|forearm)$/.test(key)) arms.set(key, bind.restWorldPos)
  }
  const lengths = new Map<Object3D, number>()
  const axis = new Vector3(), span = new Vector3()
  for (const { bone, chain } of candidates) {
    if (lengths.has(chain)) continue
    const side = sleeveSide(chain)
    const elbow = arms.get('bip001_' + side + '_forearm'), wrist = arms.get('bip001_' + side + '_hand')
    if (!elbow || !wrist) continue
    axis.subVectors(wrist, elbow)
    const length = axis.length()
    if (length < 1e-6) continue
    if (/sodetake/i.test(chain.name) || skin.hangingSleeveTips.has(chain)) {
      lengths.set(chain, length)
      continue
    }
    if (bone === chain) continue
    axis.divideScalar(length)
    span.subVectors(model.rest.get(bone)!.restWorldPos, model.rest.get(chain)!.restWorldPos)
    const reach = span.length()
    span.addScaledVector(axis, -span.dot(axis))
    if (span.length() > Math.max(0.35 * length, 0.5 * reach)) lengths.set(chain, length)
  }
  const links = new Map<Object3D, number>()
  const sleeves: (ClothJoint & { first: boolean })[] = []
  for (const joint of candidates) {
    const { bone, chain, restTip, attachment } = joint
    const length = lengths.get(chain), used = links.get(chain) ?? 0
    if (length === undefined || used >= 2 || attachment ||
        restTip.distanceTo(model.rest.get(bone)!.restWorldPos) < 0.18 * length) continue
    links.set(chain, used + 1)
    sleeves.push({ ...joint, first: used === 0 })
  }
  return sleeves
}

// For a borrowed motion the actor's long kimono sleeves otherwise inherit
// the T-pose of the arm, and its lower panel pivots travel rigidly with the
// pelvis. Supply the hanging pose before the ordinary spring/contact pass.
export class KimonoDrape {
  private readonly hems: { bone: Object3D; drop: number; bindDown: Vector3 }[] = []
  private readonly sleeves: ReturnType<typeof hangingSleeves>
  private readonly local = new Matrix4()
  private readonly axis = new Vector3()
  private readonly down = new Vector3()
  private readonly origin = new Vector3()
  private readonly turn = new Quaternion()
  private readonly identity = new Quaternion()

  constructor(private readonly model: StudioModel, joints: readonly ClothJoint[], skin: BodyColliders) {
    this.sleeves = hangingSleeves(model, joints, skin)
    for (const joint of joints) {
      const key = canonicalBoneName(joint.bone.name)
      if (kimonoHemKey.test(key)) {
        const parent = model.rest.get(joint.hub)!
        const drop = parent.restWorldPos.y - model.rest.get(joint.bone)!.restWorldPos.y
        const scale = parent.restWorldScale
        if (drop <= 0 || Math.min(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) < 1e-6) continue
        const bindDown = new Vector3(0, -drop, 0)
          .applyQuaternion(parent.restWorldQuat.clone().invert())
          .divide(parent.restWorldScale)
        this.hems.push({ bone: joint.bone, drop, bindDown })
      }
    }
  }

  // Keep a vector's length in stage coordinates even for scaled/reflected rigs.
  private localDown(parent: Object3D, length: number) {
    parent.updateWorldMatrix(true, false)
    this.local.copy(parent.matrixWorld).invert()
    if (this.model.root.parent) this.local.multiply(this.model.root.parent.matrixWorld)
    this.origin.setFromMatrixPosition(this.local)
    return this.down.set(0, -length, 0).applyMatrix4(this.local).sub(this.origin)
  }

  apply(gravity: number) {
    const strength = Math.min(1, Math.max(0, gravity / 1.8))
    if (!strength) return
    for (const { bone, drop, bindDown } of this.hems) {
      // Suspend each pivot directly above its own bind position, preserving
      // the front/back opening. Let the legs carry part of the panel in a bend.
      this.localDown(bone.parent!, drop).sub(bindDown).clampLength(0, bindDown.length() * 0.5)
      bone.position.addScaledVector(this.down, 0.7 * strength)
      bone.updateWorldMatrix(false, false)
    }
    for (const { bone, tip, first } of this.sleeves) {
      this.localDown(bone.parent!, 1).normalize()
      this.axis.copy(tip).multiply(bone.scale).applyQuaternion(bone.quaternion).normalize()
      this.turn.setFromUnitVectors(this.axis, this.down)
      const angle = this.identity.angleTo(this.turn)
      if (angle < 1e-6) continue
      const bend = Math.min(angle * 0.82, (first ? 70 : 44) * Math.PI / 180)
      this.turn.slerp(this.identity, 1 - strength * bend / angle)
      bone.quaternion.premultiply(this.turn).normalize()
      bone.updateWorldMatrix(false, false)
    }
  }
}
