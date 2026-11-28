import { Vector3 } from 'three'
import { collisionMasks } from './BodyColliders'
import type { FineClothMesh } from './ClothMeshBuilder'

function cellKey(x: number, y: number, z: number) {
  return (x * 73856093) ^ (y * 19349663) ^ (z * 83492791)
}

// Carry pressure across nearby folds and disconnected panels. Take all sources
// from the original leg pass so a correction cannot propagate indefinitely.
export class GarmentDisplacementField {
  private readonly particles: { id: number; pressure: Vector3; filtered: Vector3 }[]
  private tracking = false
  private readonly buckets = new Map<number, number[]>()
  private readonly cell: number
  private readonly axis = new Vector3()

  constructor(
    private readonly cloth: FineClothMesh,
    private readonly height: number,
  ) {
    this.particles = cloth.nodes.flatMap((node, id) =>
      node.mobility && node.materialMask === collisionMasks.skirt
        ? [{ id, pressure: new Vector3(), filtered: new Vector3() }]
        : [],
    )
    this.cell = height * 0.32
  }

  reset() {
    this.tracking = false
  }
  checkpoint() {
    const tracking = this.tracking
    const previous = this.particles.map((p) => p.filtered.clone())
    return () => {
      this.tracking = tracking
      this.particles.forEach((p, i) => p.filtered.copy(previous[i]))
    }
  }

  project(posed: Vector3[], shifts: Vector3[], dt = 0) {
    this.buckets.clear()
    for (let index = 0; index < this.particles.length; index++) {
      const { id, pressure } = this.particles[index]
      pressure.copy(shifts[id])
      const p = posed[id]
      const key = cellKey(
        Math.floor(p.x / this.cell),
        Math.floor(p.y / this.cell),
        Math.floor(p.z / this.cell),
      )
      const bucket = this.buckets.get(key)
      if (bucket) bucket.push(index)
      else this.buckets.set(key, [index])
    }

    for (const source of this.particles) {
      const length = source.pressure.length()
      if (length < 1e-5) continue
      this.axis.copy(source.pressure).divideScalar(length)
      const center = posed[source.id]
      const radius = Math.min(this.cell, length / 0.23)
      const maxX = Math.floor((center.x + radius) / this.cell)
      const maxY = Math.floor((center.y + radius) / this.cell)
      const maxZ = Math.floor((center.z + radius) / this.cell)
      for (let x = Math.floor((center.x - radius) / this.cell); x <= maxX; x++) {
        for (let y = Math.floor((center.y - radius) / this.cell); y <= maxY; y++) {
          for (let z = Math.floor((center.z - radius) / this.cell); z <= maxZ; z++) {
            const bucket = this.buckets.get(cellKey(x, y, z))
            if (!bucket) continue
            for (const index of bucket) {
              const receiver = this.particles[index]
              if (receiver === source || receiver.pressure.dot(this.axis) < -1e-8) continue
              const distanceSq = center.distanceToSquared(posed[receiver.id])
              if (distanceSq >= radius * radius) continue
              const shift = shifts[receiver.id]
              const deficit = length * (1 - Math.sqrt(distanceSq) / radius) - shift.dot(this.axis)
              if (deficit <= 0) continue
              shift
                .addScaledVector(this.axis, deficit * this.cloth.nodes[receiver.id].mobility)
                .clampLength(0, this.height * 0.085)
            }
          }
        }
      }
    }
    const blend = this.tracking && dt > 0 ? -Math.expm1(-30 * dt) : 1
    this.tracking = true
    for (const { id, pressure, filtered } of this.particles) {
      const extra = shifts[id].sub(pressure)
      filtered.lerp(extra, blend)
      // The filtered contribution may never pull a layer back into the leg.
      const lengthSq = pressure.lengthSq()
      if (lengthSq) filtered.addScaledVector(pressure, Math.max(0, -filtered.dot(pressure) / lengthSq))
      shifts[id]
        .copy(pressure)
        .add(filtered)
        .clampLength(0, Math.max(this.height * 0.085, pressure.length()))
    }
  }
}
