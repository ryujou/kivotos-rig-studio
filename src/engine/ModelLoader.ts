import {
  AnimationClip,
  Bone,
  Box3,
  BufferGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Texture,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { fetchModelBuffer, type Progress } from '../services/modelCache'
import { propModels } from '../data/propModels'
import { OutlineEffect } from './OutlineEffect'

import { canonicalBoneName } from './RigDefinition'
import { describeClip, type ClipInfo } from './AnimationUtils'
export type { ClipCategory, ClipInfo } from './AnimationUtils'

const surveyedProps = new Set(propModels.flatMap((model) => model.meshes))

export type Shading = 'unlit' | 'softLit' | 'wireframe'
export interface RestTransform {
  restLocalPos: Vector3
  restLocalQuat: Quaternion
  restLocalScale: Vector3
  restWorldPos: Vector3
  restWorldQuat: Quaternion
  restWorldScale: Vector3
}
export class StudioModel {
  readonly bodyMeshes: Mesh[] = []
  readonly mouthMeshes: Mesh[] = []
  readonly haloNodes: Object3D[] = []
  readonly weaponMeshes: Mesh[] = []
  readonly propMeshes: Mesh[] = []
  readonly meshGroups = new Map<Mesh, string>()
  readonly labels = new Map<Mesh, string>()
  readonly rest = new Map<Object3D, RestTransform>()
  readonly restMouthWeights = new Map<Mesh, number[]>()
  readonly hipRestHeight: number
  readonly bounds = new Box3()
  readonly clips: ClipInfo[]
  readonly outline: OutlineEffect
  private readonly originals = new Map<Mesh, Material | Material[]>()
  private readonly variants = new Map<
    Material,
    {
      unlit: MeshBasicMaterial
      wireframe: MeshBasicMaterial
      clay?: MeshLambertMaterial
    }
  >()

  constructor(
    readonly root: Object3D,
    readonly animations: AnimationClip[],
    anisotropy: number,
    meshNames = new Map<Object3D, string>(),
  ) {
    root.updateMatrixWorld(true)
    root.traverse((node) => {
      this.rest.set(node, {
        restLocalPos: node.position.clone(),
        restLocalQuat: node.quaternion.clone(),
        restLocalScale: node.scale.clone(),
        restWorldPos: node.getWorldPosition(new Vector3()),
        restWorldQuat: node.getWorldQuaternion(new Quaternion()),
        restWorldScale: node.getWorldScale(new Vector3()),
      })
      if (/halo/i.test(node.name)) this.haloNodes.push(node)
      if (!(node instanceof Mesh)) return
      const mesh: Mesh = node
      const ancestry = [mesh.name, mesh.parent?.name ?? '']
      const group =
        meshNames.get(mesh) ??
        (mesh.parent?.type === 'Group' && /_\d+$/.test(mesh.name) ? mesh.parent.name : mesh.name)
      this.meshGroups.set(mesh, group)
      const label = group
        .replace(/^CH\d+[_ ]*/i, '')
        .replace(/_Original_/i, ' ')
        .replace(/_(Mesh|Outline)(?=_|$)/gi, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
      this.labels.set(mesh, label || mesh.name)
      if (mesh instanceof SkinnedMesh) mesh.frustumCulled = false
      const name = group || ancestry.join(' ')
      if (ancestry.some((n) => /^mouth_/i.test(n))) this.mouthMeshes.push(mesh)
      else if (/halo/i.test(name)) {
        if (!this.haloNodes.includes(mesh)) this.haloNodes.push(mesh)
      } else if (/body|(?:^|_)(?:face|hair|eyebrow|eyemouth)\d*(?:_|$)|^faceCH|^CH\d+(?:_Mesh)?$/i.test(name))
        this.bodyMeshes.push(mesh)
      else if (
        (/weapon/i.test(name) && !/shield_weapon|weapon_can/i.test(name)) ||
        (!surveyedProps.has(name) &&
          !/bag|prop|instrument|tank|bike/i.test(name) &&
          mesh instanceof SkinnedMesh &&
          mesh.skeleton.bones.some((b) => /^bip001[_ ]weapon$/i.test(b.name)))
      )
        this.weaponMeshes.push(mesh)
      else this.propMeshes.push(mesh)
      mesh.castShadow = true
      this.originals.set(mesh, mesh.material)
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(mat)) if (value instanceof Texture) value.anisotropy = anisotropy
      }
    })
    for (const mouth of this.mouthMeshes)
      this.restMouthWeights.set(mouth, [...(mouth.morphTargetInfluences ?? [])])
    const hip = [...this.rest.keys()].find((n) => canonicalBoneName(n.name) === 'bip001')
    this.hipRestHeight = hip ? this.rest.get(hip)!.restWorldPos.y : 0
    // Hidden bind-pose props can be metres away. Frame the character and halo.
    for (const mesh of [...this.bodyMeshes, ...this.haloNodes.filter((n) => n instanceof Mesh)])
      this.bounds.expandByObject(mesh, true)
    if (this.bounds.isEmpty()) this.bounds.setFromObject(root, true)
    this.clips = animations.map(describeClip)
    this.outline = new OutlineEffect(root)
  }

  /** Measure only posed source vertices. Recursive Three.js boxes also include invisible children and hulls. */
  expandVisibleBounds(box: Box3, meshes: Iterable<Object3D> = this.meshGroups.keys()) {
    const part = new Box3(),
      point = new Vector3()
    for (const mesh of meshes) {
      if (!(mesh instanceof Mesh)) continue
      let node: Object3D | null = mesh
      while (node && node.visible) node = node.parent
      if (node) continue
      part.makeEmpty()
      const count = mesh.geometry.getAttribute('position').count
      for (let i = 0; i < count; i++)
        part.expandByPoint(mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld))
      if (part.getSize(point).length() > 0.025) box.union(part)
    }
  }

  setShading(mode: Shading) {
    const substitute = (material: Material, prop: boolean) => {
      let pair = this.variants.get(material)
      if (!pair) {
        const source = material as MeshBasicMaterial
        const unlit = new MeshBasicMaterial({
          map: source.map ?? null,
          color: source.color ?? 0xffffff,
          side: source.side,
          transparent: source.transparent,
          opacity: source.opacity,
          alphaTest: source.alphaTest,
          alphaMap: source.alphaMap ?? null,
          vertexColors: source.vertexColors,
          depthWrite: source.depthWrite,
          toneMapped: false,
        })
        pair = { unlit, wireframe: new MeshBasicMaterial({ wireframe: true, color: 0x4298bc }) }
        this.variants.set(material, pair)
      }
      if (mode === 'wireframe') return pair.wireframe
      const source = pair.unlit
      if (
        prop &&
        !source.map &&
        !source.transparent &&
        source.opacity === 1 &&
        !source.alphaMap &&
        source.alphaTest === 0 &&
        source.color.r > 0.94 &&
        source.color.g > 0.94 &&
        source.color.b > 0.94
      ) {
        // A body mesh can share this source material with an untextured prop.
        return (pair.clay ??= new MeshLambertMaterial({
          color: 0xc7d2e0,
          side: source.side,
          depthWrite: source.depthWrite,
          vertexColors: source.vertexColors,
          toneMapped: false,
        }))
      }
      return source
    }
    for (const [mesh, original] of this.originals) {
      const prop = this.propMeshes.includes(mesh)
      mesh.material =
        mode === 'softLit'
          ? original
          : Array.isArray(original)
            ? original.map((material) => substitute(material, prop))
            : substitute(original, prop)
    }
  }
  dispose() {
    this.root.removeFromParent()
    this.outline.dispose()
    const textures = new Set<Texture>(),
      materials = new Set<Material>(),
      geometries = new Set<BufferGeometry>(),
      skeletons = new Set<Skeleton>()
    for (const [mesh, original] of this.originals) {
      geometries.add(mesh.geometry)
      if (mesh instanceof SkinnedMesh) skeletons.add(mesh.skeleton)
      for (const m of Array.isArray(original) ? original : [original]) materials.add(m)
    }
    for (const mat of materials) {
      for (const value of Object.values(mat)) if (value instanceof Texture) textures.add(value)
      mat.dispose()
    }
    const images = new Set<ImageBitmap>()
    for (const tex of textures) {
      if (typeof ImageBitmap !== 'undefined' && tex.source.data instanceof ImageBitmap)
        images.add(tex.source.data)
      tex.dispose()
    }
    for (const image of images) image.close()
    for (const pair of this.variants.values()) {
      pair.unlit.dispose()
      pair.wireframe.dispose()
      pair.clay?.dispose()
    }
    for (const geometry of geometries) geometry.dispose()
    for (const skeleton of skeletons) skeleton.dispose()
  }
}

export class ModelLoader {
  constructor(private readonly maxAnisotropy: number) {}
  async load(source: string | File | ArrayBuffer, onProgress?: Progress, signal?: AbortSignal) {
    const buffer =
      typeof source === 'string'
        ? await fetchModelBuffer(source, onProgress, signal)
        : source instanceof ArrayBuffer
          ? source
          : await source.arrayBuffer()
    signal?.throwIfAborted()
    const gltf = await new GLTFLoader().parseAsync(
      buffer,
      typeof source === 'string' ? new URL('.', source).href : '',
    )
    const names = new Map<Object3D, string>()
    gltf.scene.traverse((node) => {
      const index = gltf.parser.associations.get(node)?.meshes
      const name = index === undefined ? undefined : gltf.parser.json.meshes[index]?.name
      if (name) names.set(node, name)
    })
    const model = new StudioModel(gltf.scene, gltf.animations, this.maxAnisotropy, names)
    if (signal?.aborted) {
      model.dispose()
      signal.throwIfAborted()
    }
    return model
  }
}

export function rigBones(model: StudioModel) {
  const nodes: Object3D[] = []
  const ancestors = new Set<Object3D>()
  for (const node of model.rest.keys()) {
    if (!(node instanceof Bone) && canonicalBoneName(node.name) !== 'bip001') continue
    let parent = node.parent
    while (parent && parent !== model.root && !ancestors.has(parent)) {
      ancestors.add(parent)
      parent = parent.parent
    }
  }
  // The hip, HaloRoot and unweighted helpers are ordinary Object3Ds in these GLBs.
  function visit(node: Object3D, belowHip: boolean) {
    if (!model.rest.has(node) || node instanceof Mesh) return
    const within = belowHip || canonicalBoneName(node.name) === 'bip001'
    if (node.name && (within || node instanceof Bone || ancestors.has(node))) nodes.push(node)
    for (const child of node.children) visit(child, within)
  }
  visit(model.root, false)
  return nodes
}
