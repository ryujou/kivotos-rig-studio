import { MathUtils, Matrix4, Object3D, Quaternion, Vector3 } from 'three'

export interface ArmChain {
  clavicle?: Object3D
  upperArm: Object3D
  forearm: Object3D
  hand: Object3D
  // Elbow bend direction in the upper arm's bind frame.
  restPoleLocal?: Vector3
}
interface ArmOptions {
  targetHandQuat?: Quaternion
  clavicleMuted?: boolean
}

function invertible(matrix: Matrix4) {
  const determinant = matrix.determinantAffine()
  return Number.isFinite(determinant) && Math.abs(determinant) > 1e-15
}

export class ArmIKSolver {
  private readonly shoulder = new Vector3()
  private readonly elbow = new Vector3()
  private readonly wrist = new Vector3()
  private readonly aim = new Vector3()
  private readonly pole = new Vector3()
  private readonly normal = new Vector3()
  private readonly toElbow = new Vector3()
  private readonly toWrist = new Vector3()
  private readonly from = new Vector3()
  private readonly to = new Vector3()
  private readonly inverse = new Matrix4()
  private readonly handWorld = new Matrix4()
  private readonly delta = new Quaternion()
  private readonly identity = new Quaternion()
  private readonly upperBefore = new Quaternion()
  private readonly foreBefore = new Quaternion()

  // Solve in parent coordinates. An inverse affine direction transform includes
  // the parent's reflection, which a subtracted world quaternion would lose.
  private turn(node: Object3D, from: Vector3, to: Vector3, maxAngle = Math.PI) {
    if (node.parent) this.inverse.copy(node.parent.matrixWorld).invert()
    else this.inverse.identity()
    this.from.copy(from).transformDirection(this.inverse)
    this.to.copy(to).transformDirection(this.inverse)
    this.delta.setFromUnitVectors(this.from, this.to)
    const angle = this.identity.angleTo(this.delta)
    if (angle > maxAngle) this.delta.slerp(this.identity, 1 - maxAngle / angle)
    node.quaternion.premultiply(this.delta).normalize()
    node.updateWorldMatrix(false, true)
  }

  solveArm(chain: ArmChain, targetWorldPos: Vector3, weight: number, options?: ArmOptions) {
    if (!(weight > 0) || !Number.isFinite(targetWorldPos.lengthSq())) return false
    weight = Math.min(1, weight)
    const { upperArm, forearm, hand, clavicle } = chain
    hand.updateWorldMatrix(true, false)
    if (
      !hand.parent ||
      !invertible(hand.matrixWorld) ||
      !invertible(upperArm.matrixWorld) ||
      !invertible(forearm.matrixWorld)
    )
      return false
    const s = this.shoulder.setFromMatrixPosition(upperArm.matrixWorld)
    const e = this.elbow.setFromMatrixPosition(forearm.matrixWorld)
    const w = this.wrist.setFromMatrixPosition(hand.matrixWorld)
    const l1 = s.distanceTo(e),
      l2 = e.distanceTo(w),
      reach = l1 + l2
    if (Math.min(l1, l2) < 1e-7 || Math.abs(l1 - l2) >= 0.985 * reach) return false
    this.upperBefore.copy(upperArm.quaternion)
    this.foreBefore.copy(forearm.quaternion)
    this.handWorld.copy(hand.matrixWorld)
    if (options?.targetHandQuat) {
      this.handWorld.decompose(this.from, this.delta, this.to)
      this.handWorld.compose(this.from, this.delta.normalize().slerp(options.targetHandQuat, weight), this.to)
    }

    let distance = targetWorldPos.distanceTo(s)
    if (clavicle && !options?.clavicleMuted && distance > 0.95 * reach && invertible(clavicle.matrixWorld)) {
      const pivot = this.pole.setFromMatrixPosition(clavicle.matrixWorld)
      this.toElbow.subVectors(s, pivot)
      this.toWrist.subVectors(targetWorldPos, pivot)
      const assist = Math.min(1, (distance / reach - 0.95) / 0.1)
      if (this.toElbow.lengthSq() > 1e-12 && this.toWrist.lengthSq() > 1e-12)
        this.turn(clavicle, this.toElbow, this.toWrist, (weight * assist * Math.PI) / 30)
      s.setFromMatrixPosition(upperArm.matrixWorld)
      e.setFromMatrixPosition(forearm.matrixWorld)
      w.setFromMatrixPosition(hand.matrixWorld)
      distance = targetWorldPos.distanceTo(s)
    }
    const aim = this.aim.subVectors(targetWorldPos, s)
    if (distance < 1e-9) aim.subVectors(w, s)
    if (aim.lengthSq() < 1e-16) aim.subVectors(e, s)
    aim.normalize()

    this.normal.crossVectors(this.from.subVectors(e, s), this.to.subVectors(w, e))
    this.pole.crossVectors(aim, this.normal)
    const area = l1 * l2
    const sinBend = this.normal.length() / area
    const projected = this.pole.length() / area
    const poleWeight = chain.restPoleLocal
      ? MathUtils.smoothstep(sinBend, 0.03, 0.25) * MathUtils.smoothstep(projected, 0, 0.0001)
      : Number(projected >= 0.0001)
    if (poleWeight < 1) {
      const rest = this.from
      if (chain.restPoleLocal) rest.copy(chain.restPoleLocal).transformDirection(upperArm.matrixWorld)
      else rest.subVectors(e, s).normalize()
      rest.addScaledVector(aim, -rest.dot(aim))
      if (rest.lengthSq() < 1e-8) {
        rest.set(0, 1, 0)
        if (Math.abs(aim.y) > 0.9) rest.set(0, 0, 1)
        rest.addScaledVector(aim, -rest.dot(aim))
      }
      rest.normalize()
      // Blend on the circle about the aim, including opposite pole directions.
      const angle = Math.atan2(this.to.crossVectors(rest, this.pole).dot(aim), rest.dot(this.pole))
      this.pole.copy(rest).applyAxisAngle(aim, angle * poleWeight)
    }
    this.pole.normalize()
    const knee = 0.94 * reach,
      band = 0.045 * reach
    const soft = distance > knee ? knee - band * Math.expm1(-(distance - knee) / band) : distance
    const d = Math.max(Math.min(0.985 * reach, Math.abs(l1 - l2) + 0.01 * reach), soft)
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    this.toElbow
      .copy(aim)
      .multiplyScalar(along)
      .addScaledVector(this.pole, Math.sqrt(Math.max(0, l1 * l1 - along * along)))
    this.turn(upperArm, this.from.subVectors(e, s), this.toElbow)
    e.setFromMatrixPosition(forearm.matrixWorld)
    w.setFromMatrixPosition(hand.matrixWorld)
    this.toWrist.copy(s).addScaledVector(aim, d).sub(e)
    this.turn(forearm, this.from.subVectors(w, e), this.toWrist)

    if (weight < 1) {
      upperArm.quaternion.slerp(this.upperBefore, 1 - weight)
      forearm.quaternion.slerp(this.foreBefore, 1 - weight)
      upperArm.updateWorldMatrix(false, true)
    }
    // Strip the actual signed local scale before extracting the wrist rotation.
    // This preserves its original basis even when a reflected axis isn't X.
    this.inverse.copy(hand.parent!.matrixWorld).invert().multiply(this.handWorld)
    this.inverse.scale(this.to.set(1 / hand.scale.x, 1 / hand.scale.y, 1 / hand.scale.z))
    hand.quaternion.setFromRotationMatrix(this.inverse).normalize()
    hand.updateWorldMatrix(false, true)
    return true
  }
}
