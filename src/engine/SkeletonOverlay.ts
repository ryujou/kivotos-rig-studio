import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  Vector3,
  type Object3D,
} from 'three'
import { rigBones, type StudioModel } from './ModelLoader'

export class SkeletonOverlay {
  readonly lines: LineSegments<BufferGeometry, LineBasicMaterial>
  readonly marker: Points<BufferGeometry, PointsMaterial>
  private readonly edges: [Object3D, Object3D][] = []
  private readonly joints: Map<string, Object3D>
  private readonly point = new Vector3()
  private readonly cyan = new Color(0x00bfff)
  private readonly amber = new Color(0xffa119)
  constructor(model: StudioModel) {
    const bones = rigBones(model),
      set = new Set(bones)
    this.joints = new Map(bones.map((b) => [b.name, b]))
    for (const bone of bones) {
      let parent = bone.parent
      while (parent && !set.has(parent)) parent = parent.parent
      if (parent) this.edges.push([parent, bone])
    }
    const geometry = new BufferGeometry()
    for (const name of ['position', 'color'])
      geometry.setAttribute(name, new BufferAttribute(new Float32Array(this.edges.length * 6), 3))
    this.lines = new LineSegments(
      geometry,
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.87,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    this.lines.frustumCulled = false
    this.lines.renderOrder = 1000
    this.marker = new Points(
      new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(3), 3)),
      new PointsMaterial({
        size: 8,
        sizeAttenuation: false,
        color: this.amber,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
      }),
    )
    this.marker.frustumCulled = false
    this.marker.renderOrder = 1001
    this.lines.add(this.marker)
  }
  update(selected: string) {
    const { position, color } = this.lines.geometry.attributes
    this.edges.forEach(([parent, bone], i) => {
      const ink = bone.name === selected || parent.name === selected ? this.amber : this.cyan
      for (const [j, node] of [parent, bone].entries()) {
        this.point.setFromMatrixPosition(node.matrixWorld)
        position.setXYZ(i * 2 + j, this.point.x, this.point.y, this.point.z)
        color.setXYZ(i * 2 + j, ink.r, ink.g, ink.b)
      }
    })
    position.needsUpdate = color.needsUpdate = true
    const active = this.joints.get(selected)
    this.marker.visible = !!active
    if (active) this.marker.position.setFromMatrixPosition(active.matrixWorld)
  }
  dispose() {
    this.lines.removeFromParent()
    for (const object of [this.lines, this.marker]) {
      object.geometry.dispose()
      object.material.dispose()
    }
  }
}
