import { Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import { ColliderGroup, collisionMasks, type BodyColliders, type PointContact } from './BodyColliders'
import { buildRings, discoverCloth, type ClothJoint, type RingEdge } from './ClothTopology'
import type { RestTransform } from './ModelLoader'
import { canonicalBoneName, kimonoHemKey, type SpringSettings } from './RigDefinition'

const h = 1 / 120
const rad = Math.PI / 180
const thickness = 0.004
const panelMask = ColliderGroup.legs
const response = {
  tail: { wind: 0.2, damping: 1.25 },
  bangs: { wind: 0.45, damping: 1.2 },
  hair: { wind: 1, damping: 0.95 },
  cloth: { wind: 1.25, damping: 0.9 },
  skirt: { wind: 0.72, damping: 1.35 },
  wing: { wind: 0.2, damping: 1.25 },
}
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

interface Particle extends ClothJoint {
  hubPosition: Vector3
  hubQuaternion: Quaternion
  restOutwardLocal?: Vector3
  outward?: Vector3
  current: Vector3
  previous: Vector3
  next: Vector3
  goal: Vector3
  contact: Vector3
  base: Quaternion
  priorSwing: Quaternion
  prevStepSwing: Quaternion
  swing: Quaternion
  bindRadii?: Float64Array
  bindRadiiMid?: Float64Array
  contactLegElevation: number
  bindUpLocal: Vector3
  gravityFactor: number
  probes?: { local: Vector3; bindRadii: Float64Array }[]
  phaseOffset: number
  scale: number
  bindScale: number
  kimonoHem: boolean
}

export class SpringBoneSolver {
  readonly particles: Particle[]
  readonly rings: { particles: Particle[]; closed: boolean }[]
  readonly bendingEdges: RingEdge<Particle>[]
  readonly edges: RingEdge<Particle>[]
  private readonly syncTip = (child: Object3D) => {
    const p = this.byBone.get(child)
    if (p) p.next.copy(p.tip).applyMatrix4(child.matrixWorld)
  }
  private readonly roots: Object3D[]
  private readonly byBone: Map<Object3D, Particle>
  private initialized = false
  private staticInitialized = false
  private applied = false
  private remainder = 0
  private phase = 0
  private readonly origin = new Vector3()
  private readonly goal = new Vector3()
  private readonly axis = new Vector3()
  private readonly direction = new Vector3()
  private readonly radial = new Vector3()
  private readonly difference = new Vector3()
  private readonly normal = new Vector3()
  private readonly contactOptions: PointContact = {}
  private readonly midpoint = new Vector3()
  private readonly midDirection = new Vector3()
  private readonly probe = new Vector3()
  private readonly probeTarget = new Vector3()
  private readonly probeTurn = new Quaternion()
  private readonly inverse = new Matrix4()
  private readonly turn = new Quaternion()
  private readonly hubRotation = new Quaternion()
  private readonly identity = new Quaternion()
  private readonly vertical = new Vector3(0, 1, 0)

  constructor(
    bones: Object3D[],
    rest: Map<Object3D, RestTransform>,
    exclude: ReadonlySet<Object3D>,
    public settings: SpringSettings,
    readonly colliders?: BodyColliders,
  ) {
    const phases = new Map<Object3D, number>()
    this.particles = discoverCloth(bones, rest, exclude, colliders).map((joint) => {
      if (!phases.has(joint.chain)) phases.set(joint.chain, phases.size * 2.39996)
      const hub = rest.get(joint.hub)!
      const s = hub.restWorldScale
      const bindUpLocal = new Vector3(0, 1, 0).applyQuaternion(hub.restWorldQuat.clone().invert())
      if (s.x && s.y && s.z) bindUpLocal.divide(s).normalize()
      let restOutwardLocal: Vector3 | undefined
      if (joint.material === 'hair' || joint.material === 'cloth') {
        const fromHub = joint.restTip.clone().sub(hub.restWorldPos)
        const outward = fromHub.clone().setY(0)
        if (outward.lengthSq() < 1e-12) outward.copy(fromHub)
        outward.applyQuaternion(hub.restWorldQuat.clone().invert())
        if (s.x && s.y && s.z) outward.divide(s)
        if (outward.lengthSq() > 0) restOutwardLocal = outward.normalize()
      }
      const bind = rest.get(joint.bone)!
      const probes =
        (joint.material === 'skirt' || joint.material === 'cloth') && colliders
          ? colliders.skinProbes.get(joint.bone)?.map((local) => {
              const point = local
                .clone()
                .multiply(bind.restWorldScale)
                .applyQuaternion(bind.restWorldQuat)
                .add(bind.restWorldPos)
              return { local, bindRadii: colliders.bindRadii(point, thickness, panelMask) }
            })
          : undefined
      return {
        ...joint,
        kimonoHem: kimonoHemKey.test(canonicalBoneName(joint.bone.name)),
        hubPosition: new Vector3(),
        hubQuaternion: new Quaternion(),
        restOutwardLocal,
        outward: restOutwardLocal?.clone(),
        current: new Vector3(),
        previous: new Vector3(),
        next: new Vector3(),
        goal: new Vector3(),
        contact: new Vector3(),
        base: new Quaternion(),
        priorSwing: new Quaternion(),
        prevStepSwing: new Quaternion(),
        swing: new Quaternion(),
        bindRadii: colliders?.bindRadii(joint.restTip, thickness, collisionMasks[joint.material]),
        bindRadiiMid:
          joint.attachment || joint.material === 'wing'
            ? undefined
            : colliders?.bindRadii(
                bind.restWorldPos.clone().lerp(joint.restTip, 0.5),
                thickness,
                collisionMasks[joint.material],
              ),
        bindUpLocal,
        gravityFactor: 0,
        contactLegElevation: 0,
        probes,
        phaseOffset: phases.get(joint.chain)!,
        scale: 1,
        bindScale: Math.max(1e-8, Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)),
      }
    })
    const { rings, edges, bendingEdges } = buildRings(this.particles, rest)
    this.byBone = new Map(this.particles.map((p) => [p.bone, p]))
    this.roots = [...phases.keys()]
    this.rings = rings
    this.edges = edges
    this.bendingEdges = bendingEdges
  }

  restore() {
    if (!this.applied) return
    for (const p of this.particles) p.bone.quaternion.copy(p.base)
    for (const root of this.roots) root.updateWorldMatrix(true, true)
    this.applied = false
  }

  checkpoint() {
    const { initialized, staticInitialized, applied, remainder, phase } = this
    const saved = this.particles.map((p) => ({
      hubPosition: p.hubPosition.clone(),
      hubQuaternion: p.hubQuaternion.clone(),
      priorSwing: p.priorSwing.clone(),
      prevStepSwing: p.prevStepSwing.clone(),
      current: p.current.clone(),
      previous: p.previous.clone(),
      swing: p.swing.clone(),
      base: p.base.clone(),
      rotation: p.bone.quaternion.clone(),
    }))
    return () => {
      this.initialized = initialized
      this.staticInitialized = staticInitialized
      this.applied = applied
      this.remainder = remainder
      this.phase = phase
      this.particles.forEach((p, i) => {
        p.hubPosition.copy(saved[i].hubPosition)
        p.hubQuaternion.copy(saved[i].hubQuaternion)
        p.priorSwing.copy(saved[i].priorSwing)
        p.prevStepSwing.copy(saved[i].prevStepSwing)
        p.current.copy(saved[i].current)
        p.previous.copy(saved[i].previous)
        p.swing.copy(saved[i].swing)
        p.base.copy(saved[i].base)
        p.bone.quaternion.copy(saved[i].rotation)
      })
      for (const root of this.roots) root.updateWorldMatrix(true, true)
    }
  }

  reset() {
    this.restore()
    this.initialized = this.staticInitialized = false
    this.phase = this.remainder = 0
  }

  private prepare(transportBase = false) {
    this.restore()
    this.colliders?.update()
    for (const p of this.particles) {
      if (!this.colliders) p.hub.updateWorldMatrix(true, false)
      if (p.restOutwardLocal) p.outward!.copy(p.restOutwardLocal).transformDirection(p.hub.matrixWorld)
      const up = this.colliders?.up ?? this.vertical
      const tilt = clamp01(
        1 - this.direction.copy(p.bindUpLocal).transformDirection(p.hub.matrixWorld).dot(up),
      )
      // The bind skirt already includes the weight of the hanging fabric.
      // Add gravity as the hub tilts away from that authored vertical.
      if (p.material === 'skirt') p.gravityFactor = Math.sqrt(tilt)
      else p.gravityFactor = p.bangs || p.material === 'wing' ? 0.25 * tilt : 0.15 + 0.85 * Math.sqrt(tilt)
      if (transportBase && !p.attachment && !p.base.equals(p.bone.quaternion)) {
        // Native secondary bones have their own animation tracks. Express both
        // simulated rotations in the new base before limiting/interpolating them.
        this.turn.copy(p.bone.quaternion).normalize().invert().premultiply(p.base).normalize()
        p.swing.multiply(this.turn).normalize()
        p.prevStepSwing.multiply(this.turn).normalize()
      }
      p.base.copy(p.bone.quaternion)
      p.scale = p.hub.matrixWorld.getMaxScaleOnAxis() / p.bindScale
    }
    this.applied = true
  }

  solveStaticCollisions(dt = 0) {
    if (!this.particles.length) return
    this.prepare()
    this.substep(false, this.staticInitialized && dt > 0 ? Math.min(0.1, dt) : 0)
    for (const p of this.particles) p.priorSwing.copy(p.swing)
    this.staticInitialized = true
    this.initialized = false
    this.phase = this.remainder = 0
  }

  step(dt: number) {
    this.staticInitialized = false
    if (!this.settings.enabled) {
      this.reset()
      return
    }
    if (!this.particles.length) return
    this.prepare(this.initialized && dt > 0)
    this.remainder += Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0
    const steps = Math.floor((this.remainder + 1e-10) / h)
    this.remainder = Math.max(0, this.remainder - steps * h)
    if (!this.initialized) {
      this.substep(false)
      for (const p of this.particles) p.prevStepSwing.copy(p.swing)
      this.initialized = true
    }
    for (let i = 0; i < steps; i++) {
      for (const p of this.particles) p.prevStepSwing.copy(p.swing)
      this.phase += h
      this.substep(true, h)
    }
    const interpolate = this.remainder > 1e-9
    if (interpolate || !steps) {
      const alpha = clamp01(this.remainder / h)
      for (const p of this.particles) {
        const visual = interpolate ? this.turn.slerpQuaternions(p.prevStepSwing, p.swing, alpha) : p.swing
        p.bone.quaternion.copy(visual).multiply(p.base).normalize()
        p.bone.updateWorldMatrix(true, false)
      }
    }
  }

  private frame(p: Particle) {
    p.bone.quaternion.copy(p.base)
    p.bone.updateWorldMatrix(true, false)
    this.origin.setFromMatrixPosition(p.bone.matrixWorld)
    this.goal.copy(p.tip).applyMatrix4(p.bone.matrixWorld)
    this.axis.subVectors(this.goal, this.origin)
    if (p.material === 'skirt' || p.bangs) {
      const up = this.colliders?.up ?? this.vertical
      this.radial.setFromMatrixPosition(p.hub.matrixWorld).sub(this.origin).negate()
      this.radial.addScaledVector(up, -this.radial.dot(up)).normalize()
    }
  }

  private substep(dynamic: boolean, slewDt = 0) {
    const k = clamp01(this.settings.stiffness)
    const damping = clamp01(this.settings.damping)
    const gravity = Number.isFinite(this.settings.gravity) ? this.settings.gravity : 0
    const wind = clamp01(this.settings.wind)
    const angle = (Number.isFinite(this.settings.windAngle) ? this.settings.windAngle : 0) * rad
    const windX = Math.cos(angle),
      windZ = Math.sin(angle)
    for (const p of this.particles) {
      this.frame(p)
      p.priorSwing.copy(p.swing)
      p.goal.copy(this.goal)
      p.contact.set(0, 0, 0)
      p.contactLegElevation = 0
      p.hub.matrixWorld.decompose(this.difference, this.hubRotation, this.direction)
      this.hubRotation.normalize()
      if (dynamic) {
        const maxStepMove = 0.012 * p.scale
        const material = response[p.bangs && p.material === 'hair' ? 'bangs' : p.material]
        const retention = Math.pow(1 - damping, material.damping)
        this.turn.copy(this.hubRotation).multiply(p.hubQuaternion.invert())
        const angle = this.identity.angleTo(this.turn)
        if (angle > 1e-9) {
          this.turn.slerp(this.identity, 0.35 * Math.min(1, 3.5 * rad / angle))
          p.current.sub(p.hubPosition).applyQuaternion(this.turn).add(p.hubPosition)
          p.previous.sub(p.hubPosition).applyQuaternion(this.turn).add(p.hubPosition)
        }
        const transport = this.difference.setFromMatrixPosition(p.hub.matrixWorld).sub(p.hubPosition)
        // A discontinuous root shift carries the cloth with it. Keep at most
        // one bounded step of relative inertia, even across a loop or teleport.
        transport.multiplyScalar(1 - Math.min(0.45, maxStepMove / Math.max(1e-9, transport.length())))
        p.current.add(transport)
        p.previous.add(transport)
        const velocity = this.difference.subVectors(p.current, p.previous).clampLength(0, maxStepMove)
        const waistPull = p.material === 'skirt' && p.depth === 0 ? 1.35 : 1
        p.next
          .copy(p.current)
          .addScaledVector(velocity, retention)
          .addScaledVector(
            this.difference.subVectors(this.goal, p.current),
            (0.012 + 0.16 * k) * p.stiffnessScale * waistPull,
          )
        const gust = Math.sin(1.7 * this.phase) + 0.4 * Math.sin(3.1 * this.phase + p.phaseOffset)
        const flutter = Math.sin(2.3 * this.phase + p.phaseOffset) * 2
        const impulse = wind * material.wind * h * h * p.scale
        p.next.x += (windX * gust * 5 - windZ * flutter) * impulse
        p.next.z += (windZ * gust * 5 + windX * flutter) * impulse
        p.next.y -= gravity * p.gravityFactor * h * h * p.scale
        if ((p.material === 'hair' && !p.bangs) || p.material === 'cloth') {
          // The authored hanging shape already balances gravity at bind.
          // Transport that rest force with the hub as the character leans.
          this.direction.copy(p.bindUpLocal).transformDirection(p.hub.matrixWorld)
          p.next.addScaledVector(this.direction, 0.15 * gravity * h * h * p.scale)
        }
      } else p.next.copy(this.goal)
      p.hubQuaternion.copy(this.hubRotation)
      p.hubPosition.setFromMatrixPosition(p.hub.matrixWorld)
      this.project(p)
      if (!p.attachment && (p.material === 'skirt' || p.material === 'cloth')) this.clearPanel(p)
    }

    if (this.edges.length) {
      for (const edge of this.edges) edge.lambda = 0
      for (const edge of this.bendingEdges) edge.lambda = 0
      for (let iteration = 0; iteration < 2; iteration++) {
        for (const edge of this.edges) this.relax(edge)
        for (const edge of this.bendingEdges) this.relax(edge)
        for (const p of this.particles) {
          if (p.material !== 'skirt') continue
          this.frame(p)
          p.next.add(this.difference.subVectors(this.goal, p.goal))
          p.goal.copy(this.goal)
          this.project(p)
        }
      }
    }
    for (const p of this.particles) {
      if (this.colliders && this.colliders.floorDepth(p.next, thickness * p.scale) > 1e-7) {
        this.frame(p)
        this.project(p)
      }
      this.supportFloorContact(p)
    }
    for (const p of this.particles) {
      // Floor sharing can rotate a parent after its own contact pass. Limit the final
      // pose, parent first, and keep the integration history at the tip we actually drew.
      if (slewDt > 0 && !p.attachment) {
        const rate = p.material === 'skirt' ? 360 : 420
        p.swing.copy(this.turn.copy(p.priorSwing).rotateTowards(p.swing, rate * rad * slewDt))
        p.bone.quaternion.copy(p.swing).multiply(p.base).normalize()
      }
      p.bone.updateWorldMatrix(true, false)
      p.next.copy(p.tip).applyMatrix4(p.bone.matrixWorld)
      if (slewDt > 0 && !p.attachment && this.colliders && this.colliders.floorDepth(p.next, 0) > 1e-7) {
        this.origin.setFromMatrixPosition(p.bone.matrixWorld)
        this.colliders.resolvePoint(p.next, 0, ColliderGroup.floor, undefined, this.origin)
        this.applyTip(p)
      }
      const velocity = this.difference.subVectors(p.next, p.current)
      if (p.contact.lengthSq() > 1e-12) {
        p.contact.normalize()
        velocity.addScaledVector(p.contact, -velocity.dot(p.contact)).multiplyScalar(0.45)
      }
      p.previous.copy(p.next)
      if (dynamic) p.previous.sub(velocity.clampLength(0, 0.012 * p.scale))
      p.current.copy(p.next)
    }
  }

  // A long hem can reach the floor with its last joint already at its cone
  // limit. Let the preceding joint share the bend while preserving both cones.
  private supportFloorContact(tip: Particle) {
    const colliders = this.colliders
    if (!colliders || !tip.depth) return
    const margin = thickness * tip.scale
    for (
      let node = tip.bone.parent;
      node && colliders.floorDepth(tip.next, margin) > 1e-7;
      node = node.parent
    ) {
      const parent = this.byBone.get(node)
      if (!parent || parent.attachment) break
      this.frame(parent)
      this.probeTarget.copy(tip.next)
      this.contactOptions.skirtOutward = parent.material === 'skirt' ? this.radial : undefined
      colliders.resolvePoint(
        this.probeTarget,
        margin,
        ColliderGroup.floor,
        undefined,
        this.origin,
        this.contactOptions,
      )
      this.probeTurn.setFromUnitVectors(
        this.probe.subVectors(tip.next, this.origin).normalize(),
        this.probeTarget.sub(this.origin).normalize(),
      )
      parent.next.sub(this.origin).applyQuaternion(this.probeTurn).add(this.origin)
      parent.contact.add(colliders.up)
      tip.contact.add(colliders.up)
      this.project(parent)
      node.updateWorldMatrix(false, true)
      node.traverse(this.syncTip)
    }
  }

  private clearPanel(p: Particle) {
    if (!p.probes || !this.colliders) return
    let largest = 0
    for (const { local, bindRadii } of p.probes) {
      this.probe.copy(local).applyMatrix4(p.bone.matrixWorld)
      this.probeTarget.copy(this.probe)
      if (!this.resolve(p, this.probeTarget, panelMask, bindRadii, p.scale)) continue
      const displacement = this.probeTarget.distanceToSquared(this.probe)
      if (displacement <= largest) continue
      largest = displacement
      this.probeTurn.setFromUnitVectors(
        this.probe.sub(this.origin).normalize(),
        this.probeTarget.sub(this.origin).normalize(),
      )
    }
    if (!largest) return
    p.next.sub(this.origin).applyQuaternion(this.probeTurn).add(this.origin)
    this.frame(p)
    this.project(p)
  }

  private relax(edge: RingEdge<Particle>) {
    const { a, b } = edge
    const diff = this.difference.subVectors(b.next, a.next)
    const length = diff.length(),
      rest = edge.restLength * a.scale
    if (length < 1e-8) return
    // Only immediate neighbors have a stretch band. Bending chords use pure XPBD.
    const alpha = (edge.bending ? 0.0018 : 0.00025) / (h * h)
    let correction = (rest - length - alpha * edge.lambda) / (2 + alpha)
    edge.lambda += correction
    const relaxed = length + 2 * correction
    if (!edge.bending) correction += (Math.max(0.88 * rest, Math.min(1.28 * rest, relaxed)) - relaxed) / 2
    diff.multiplyScalar(correction / length)
    a.next.sub(diff)
    b.next.add(diff)
  }

  private constrainCone(p: Particle, length: number) {
    this.direction.subVectors(p.next, this.origin).normalize()
    if (this.direction.lengthSq() === 0) this.direction.copy(this.axis)
    this.turn.setFromUnitVectors(this.axis, this.direction)
    let limit = p.material === 'wing' || p.material === 'tail' ? 30 : 45
    if (p.material === 'skirt' || p.bangs) {
      const inward = this.difference.subVectors(this.direction, this.axis).dot(this.radial) < 0
      if (p.bangs) limit = inward ? 7 : 19
      else if (inward) limit = 12
      else {
        const base = p.depth === 0 ? 41 : 52
        const t = clamp01((p.contactLegElevation / rad - 32) / (85 - 32))
        limit = base + ((p.depth === 0 ? 76 : 80) - base) * t * t * (3 - 2 * t)
      }
    }
    // These low pivots normally translate. Large rotations twist the panel
    // around the shin while the rest of the same fabric stays bound to the leg.
    if (p.kimonoHem) limit = Math.min(limit, 18)
    const angle = this.identity.angleTo(this.turn)
    if (angle > limit * rad) this.turn.slerp(this.identity, 1 - (limit * rad) / angle)
    p.next.copy(this.axis).applyQuaternion(this.turn).multiplyScalar(length).add(this.origin)
  }

  private resolve(p: Particle, point: Vector3, mask: number, radii?: Float64Array, panelScale?: number) {
    const options = this.contactOptions
    options.bindRadii = radii
    options.panelScale = panelScale
    options.skirtOutward = p.material === 'skirt' ? this.radial : undefined
    options.outward = p.outward
    options.legElevation = p.material === 'skirt' ? p.contactLegElevation : undefined
    const hit = this.colliders!.resolvePoint(
      point,
      thickness * p.scale,
      mask,
      this.normal,
      this.origin,
      options,
    )
    if (hit) {
      p.contact.add(this.normal)
      p.contactLegElevation = options.legElevation ?? 0
    }
    return hit
  }

  private project(p: Particle) {
    const length = this.axis.length()
    if (p.attachment || length < 1e-8) {
      p.next.copy(this.goal)
      p.swing.identity()
      return
    }
    this.axis.divideScalar(length)
    this.constrainCone(p, length)
    if (this.colliders) {
      const mask = collisionMasks[p.material]
      for (let i = 0; i < 3; i++) {
        const hitTip = this.resolve(p, p.next, mask, p.bindRadii)
        if (hitTip) this.constrainCone(p, length)
        let hitMid = false
        if (p.bindRadiiMid) {
          this.midpoint.lerpVectors(this.origin, p.next, 0.5)
          this.midDirection.subVectors(this.midpoint, this.origin).normalize()
          hitMid = this.resolve(p, this.midpoint, mask, p.bindRadiiMid)
          if (hitMid) {
            this.turn.setFromUnitVectors(this.midDirection, this.midpoint.sub(this.origin).normalize())
            p.next.sub(this.origin).applyQuaternion(this.turn).add(this.origin)
            this.constrainCone(p, length)
            if (this.resolve(p, p.next, mask, p.bindRadii)) this.constrainCone(p, length)
          }
        }
        if (!hitTip && !hitMid) break
      }
      const margin = thickness * p.scale
      let depth = this.colliders.floorDepth(p.next, margin)
      // The cone can undo part of each floor correction. Keep the hem's
      // tangential position while the two constraints converge.
      for (let i = 0; i < 12 && depth > 1e-7; i++) {
        const previousDepth = depth
        this.resolve(p, p.next, ColliderGroup.floor)
        this.constrainCone(p, length)
        depth = this.colliders.floorDepth(p.next, margin)
        if (depth >= previousDepth) break
      }
      if (depth > 1e-7) {
        // The inward cone can block floor clearance. Retry from the neutral axis.
        p.next.copy(this.goal)
        this.resolve(p, p.next, ColliderGroup.floor)
        this.constrainCone(p, length)
      }
    }
    this.applyTip(p)
  }

  private applyTip(p: Particle) {
    // Convert directions into the actual parent frame, including reflected BA
    // limbs. Extracting a world quaternion here loses negative bind scales.
    this.inverse.copy(p.bone.parent!.matrixWorld).invert()
    this.direction.copy(p.next).applyMatrix4(this.inverse).sub(p.bone.position).normalize()
    this.axis.copy(p.tip).multiply(p.bone.scale).applyQuaternion(p.base).normalize()
    p.swing.setFromUnitVectors(this.axis, this.direction)
    p.bone.quaternion.copy(p.swing).multiply(p.base).normalize()
    p.bone.updateWorldMatrix(false, false)
    p.next.copy(p.tip).applyMatrix4(p.bone.matrixWorld)
  }
}
