import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Matrix4,
  Mesh,
  Object3D,
  ShaderMaterial,
  SkinnedMesh,
  Vector3,
} from 'three'

export function ensureClothOffsetAttribute(geometry: BufferGeometry): BufferAttribute {
  let offset = geometry.getAttribute('clothOffset') as BufferAttribute | undefined
  if (!offset) {
    offset = new BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3), 3)
    geometry.setAttribute('clothOffset', offset.setUsage(DynamicDrawUsage))
  }
  return offset
}

export function isBakedOutline(node: Object3D) {
  for (let part: Object3D | null = node; part; part = part.parent)
    if (/(?:^|[\s_-])outline\d*(?:[\s_-]|$)/i.test(part.name)) return true
  return false
}

// Port of the wiki ModelViewer's area-weighted weld at 1e-4 position precision.
export function addSmoothNormals(geometry: BufferGeometry) {
  if (geometry.hasAttribute('smoothNormal')) return
  const position = geometry.getAttribute('position')
  if (!position) return
  const normal = geometry.getAttribute('normal')
  const sums = new Map<string, Float64Array>()
  const groups: Float64Array[] = []
  const local = new Float32Array(position.count * 4)
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)]
      .map((v) => Math.round(v * 1e4))
      .join(',')
    let group = sums.get(key)
    if (!group) {
      group = new Float64Array(4)
      sums.set(key, group)
    }
    groups.push(group)
  }
  const index = geometry.index
  const count = index?.count ?? position.count
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3()
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = index?.getX(i) ?? i,
      ib = index?.getX(i + 1) ?? i + 1,
      ic = index?.getX(i + 2) ?? i + 2
    a.fromBufferAttribute(position, ia)
    b.fromBufferAttribute(position, ib).sub(a)
    c.fromBufferAttribute(position, ic).sub(a)
    b.cross(c)
    const area = b.length()
    for (const k of [ia, ib, ic]) {
      const group = groups[k]
      group[0] += b.x
      group[1] += b.y
      group[2] += b.z
      group[3] += area
      local[k * 4] += b.x
      local[k * 4 + 1] += b.y
      local[k * 4 + 2] += b.z
      local[k * 4 + 3] += area
    }
  }
  const output = new Float32Array(position.count * 3)
  groups.forEach((group, i) => {
    a.fromArray(group)
    if (a.length() < 0.001 * group[3]) {
      if (normal) a.fromBufferAttribute(normal, i)
      else {
        a.fromArray(local, i * 4)
        if (a.length() < 0.001 * local[i * 4 + 3]) a.set(0, 0, 0)
      }
    }
    a.normalize().toArray(output, i * 3)
  })
  geometry.setAttribute('smoothNormal', new BufferAttribute(output, 3))
}

function axisScale(matrix: Matrix4) {
  const e = matrix.elements
  const axes = [0, 4, 8].map((i) => Math.hypot(e[i], e[i + 1], e[i + 2]))
  return axes.sort((a, b) => a - b)[1]
}

const vertexShader = `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#ifdef USE_CLOTH_OFFSET
attribute vec3 clothOffset;
#endif
attribute vec3 smoothNormal;
uniform float outlineWidth;
uniform float restScale;
float axisScale(mat3 m) {
  float a = length(m[0]), b = length(m[1]);
  return max(min(a, b), min(max(a, b), length(m[2])));
}
void main() {
  vec3 objectNormal = smoothNormal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = position;
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #ifdef USE_CLOTH_OFFSET
    transformed += clothOffset;
  #endif
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  float shrink = axisScale(mat3(modelMatrix)) / restScale;
  #ifdef USE_SKINNING
    // skinMatrix is relative to the inverse bind pose, even for props already hidden at load.
    shrink *= axisScale(mat3(skinMatrix));
  #endif
  shrink = smoothstep(0.05, 0.15, shrink);
  vec3 viewNormal = shrink > 1e-6 && dot(objectNormal, objectNormal) > 0.0
    ? normalize(normalMatrix * objectNormal) : vec3(0.0);
  mvPosition.xyz += viewNormal * outlineWidth * shrink * max(-mvPosition.z, 0.05);
  gl_Position = projectionMatrix * mvPosition;
}`
const fragmentShader = `
uniform vec3 outlineColor;
void main() {
  gl_FragColor = vec4(outlineColor, 1.0);
  #include <colorspace_fragment>
}`

export class OutlineEffect {
  private readonly hulls: Mesh<BufferGeometry, ShaderMaterial>[] = []

  constructor(root: Object3D) {
    root.updateMatrixWorld(true)
    const meshes: Mesh[] = []
    root.traverse((node) => {
      if (!(node instanceof Mesh) || isBakedOutline(node)) return
      for (let part: Object3D | null = node; part; part = part.parent)
        if (/halo|^mouth_/i.test(part.name)) return
      meshes.push(node)
    })
    for (const mesh of meshes) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (materials.some((m) => m.transparent || m.alphaTest > 0)) continue
      addSmoothNormals(mesh.geometry)
      if (!mesh.geometry.hasAttribute('smoothNormal')) continue
      const restScale = axisScale(mesh.matrixWorld) || axisScale(root.matrixWorld) || 1
      const material = new ShaderMaterial({
        side: BackSide,
        defines: mesh.geometry.hasAttribute('clothOffset') ? { USE_CLOTH_OFFSET: '' } : {},
        vertexShader,
        fragmentShader,
        uniforms: {
          outlineWidth: { value: 0.0005 },
          outlineColor: { value: new Color(0) },
          restScale: { value: restScale },
        },
      })
      const hull =
        mesh instanceof SkinnedMesh
          ? new SkinnedMesh(mesh.geometry, material)
          : new Mesh(mesh.geometry, material)
      if (hull instanceof SkinnedMesh && mesh instanceof SkinnedMesh) {
        hull.bindMode = mesh.bindMode
        hull.bind(mesh.skeleton, mesh.bindMatrix)
      }
      hull.name = mesh.name + '__outline'
      hull.userData.isOutline = true
      hull.renderOrder = -1
      hull.frustumCulled = false
      hull.morphTargetInfluences = mesh.morphTargetInfluences
      hull.morphTargetDictionary = mesh.morphTargetDictionary
      mesh.add(hull)
      this.hulls.push(hull)
    }
  }
  apply(enabled: boolean, width: number, color: string) {
    for (const hull of this.hulls) {
      hull.visible = enabled && width > 0
      hull.material.uniforms.outlineWidth.value = (0.002 * width) / 100
      hull.material.uniforms.outlineColor.value.set(color)
    }
  }
  dispose() {
    for (const hull of this.hulls) {
      hull.removeFromParent()
      hull.material.dispose()
    }
    this.hulls.length = 0
  }
}
