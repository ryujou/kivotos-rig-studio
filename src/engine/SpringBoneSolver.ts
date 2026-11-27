import { Quaternion, Vector3, type Object3D } from 'three'
import type { RestTransform } from './ModelLoader'
import type { SpringSettings } from './RigDefinition'

const decorative = /hair|skirt|ribbon|cape|tail|ear|wing|tie|scarf|sleeve|coat|ahoge|ponytail|twin|braid/i
const fixedStep = 1 / 120
const maxAngle = (42 * Math.PI) / 180

interface Particle {
  bone: Object3D
  tip: Vector3
  current: Vector3
  previous: Vector3
  swing: Quaternion
  base: Quaternion
}

// Particles live in world space. Each constraint rotates its bone about the posed
// anchor. It never writes a joint translation or changes the rest segment length.
export class SpringBoneSolver {
  readonly particles: Particle[] = []
  private initialized = false
  private applied = false
  private remainder = 0
  private readonly origin = new Vector3()
  private readonly goal = new Vector3()
  private readonly next = new Vector3()
  private readonly axis = new Vector3()
  private readonly direction = new Vector3()
  private readonly turn = new Quaternion()
  private readonly parentRotation = new Quaternion()
  private readonly identity = new Quaternion()

  constructor(
    bones: Object3D[],
    rest: Map<Object3D, RestTransform>,
    exclude: ReadonlySet<Object3D>,
    public settings: SpringSettings,
  ) {
    for (const bone of bones) {
      if (exclude.has(bone) || !decorative.test(bone.name)) continue
      const child = bone.children.find((n) => rest.has(n) && rest.get(n)!.restLocalPos.lengthSq() > 1e-8)
      const bind = rest.get(bone)!
      // Leaf bones still deform the skin. Continue their incoming segment.
      const tip = child
        ? rest.get(child)!.restLocalPos.clone()
        : bind.restLocalPos.clone().applyQuaternion(bind.restLocalQuat.clone().invert()).multiplyScalar(0.65)
      if (tip.lengthSq() < 1e-8) continue
      this.particles.push({
        bone,
        tip,
        current: new Vector3(),
        previous: new Vector3(),
        swing: new Quaternion(),
        base: new Quaternion(),
      })
    }
  }

  // Undo only the procedural layer before sampling the next native animation.
  restore() {
    if (!this.applied) return
    for (const p of this.particles) p.bone.quaternion.copy(p.base)
    this.applied = false
  }
  checkpoint() {
    const { initialized, applied, remainder } = this
    const saved = this.particles.map((p) => ({
      current: p.current.clone(),
      previous: p.previous.clone(),
      swing: p.swing.clone(),
      base: p.base.clone(),
      rotation: p.bone.quaternion.clone(),
    }))
    return () => {
      this.initialized = initialized
      this.applied = applied
      this.remainder = remainder
      this.particles.forEach((p, i) => {
        p.current.copy(saved[i].current)
        p.previous.copy(saved[i].previous)
        p.swing.copy(saved[i].swing)
        p.base.copy(saved[i].base)
        p.bone.quaternion.copy(saved[i].rotation)
        p.bone.updateWorldMatrix(true, true)
      })
    }
  }
  reset() {
    this.restore()
    for (const p of this.particles) p.swing.identity()
    this.initialized = false
    this.remainder = 0
  }
  step(dt: number) {
    if (!this.settings.enabled) {
      this.reset()
      return
    }
    this.restore()
    for (const p of this.particles) p.base.copy(p.bone.quaternion)
    this.remainder += Math.min(0.25, Math.max(0, dt))
    const steps = Math.floor((this.remainder + 1e-10) / fixedStep)
    this.remainder = Math.max(0, this.remainder - steps * fixedStep)
    const stiffness = Math.min(1, Math.max(0, this.settings.stiffness))
    const retention = 1 - Math.min(1, Math.max(0, this.settings.damping))
    // Even a paused frame needs its constrained orientation after pose sampling.
    for (let i = 0; i < Math.max(1, steps); i++) {
      for (const p of this.particles) {
        const { bone } = p
        bone.quaternion.copy(p.base)
        bone.updateWorldMatrix(true, false)
        this.origin.setFromMatrixPosition(bone.matrixWorld)
        this.goal.copy(p.tip).applyMatrix4(bone.matrixWorld)
        this.axis.subVectors(this.goal, this.origin)
        const length = this.axis.length()
        if (!this.initialized || length < 1e-7) {
          p.previous.copy(this.goal)
          p.current.copy(this.goal)
          continue
        }
        this.axis.divideScalar(length)
        this.next.copy(p.current)
        if (steps) {
          this.next
            .addScaledVector(this.direction.subVectors(p.current, p.previous), retention)
            .addScaledVector(this.direction.subVectors(this.goal, p.current), 0.012 + stiffness * 0.19)
          this.next.y -= this.settings.gravity * fixedStep * fixedStep
        }
        this.direction.subVectors(this.next, this.origin)
        if (this.direction.lengthSq() < 1e-14) this.direction.copy(this.axis)
        this.turn.setFromUnitVectors(this.axis, this.direction.normalize())
        const angle = this.identity.angleTo(this.turn)
        if (angle > maxAngle) this.turn.slerp(this.identity, 1 - maxAngle / angle)
        bone.parent!.getWorldQuaternion(this.parentRotation).normalize()
        this.turn.multiply(this.parentRotation).premultiply(this.parentRotation.invert())
        // A short leaf reversing through its anchor can flip the axis of the
        // shortest arc. Limit angular velocity as well as the absolute cone.
        if (steps) p.swing.rotateTowards(this.turn, 8 * fixedStep)
        bone.quaternion.copy(p.swing).multiply(p.base).normalize()
        if (steps) {
          this.turn.copy(this.parentRotation).invert().multiply(p.swing).multiply(this.parentRotation)
          p.previous.copy(p.current)
          p.current.copy(this.axis).applyQuaternion(this.turn).multiplyScalar(length).add(this.origin)
        }
        bone.updateWorldMatrix(false, false)
      }
      this.initialized = true
    }
    this.applied = true
  }
}
