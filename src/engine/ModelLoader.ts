import {
  AnimationClip,
  Bone,
  Box3,
  BufferGeometry,
  Material,
  type Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  PropertyBinding,
  Skeleton,
  SkinnedMesh,
  Texture,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { fetchModelBuffer, type Progress } from '../services/modelCache'
import { propModels } from '../data/propModels'
import { isBakedOutline, OutlineEffect } from './OutlineEffect'

import { canonicalBoneName } from './RigDefinition'
import { describeClip, type ClipInfo } from './AnimationUtils'
export type { ClipCategory, ClipInfo } from './AnimationUtils'

const surveyedProps = new Set(propModels.flatMap((model) => model.meshes))
const unlitPart = /(?:^|[\s_-])(?:halo|mouth|eyemouth|eyebrow|eyelash|eye|eyes|outline)(?:[\s_\d-]|$)/i

export type Shading = 'unlit' | 'softLit' | 'wireframe'
export interface RestTransform {
  restLocalPos: Vector3
  restLocalQuat: Quaternion
  restLocalScale: Vector3
  restWorldPos: Vector3
  restWorldQuat: Quaternion
  restWorldScale: Vector3
}
// Three returns unit scale and identity rotation for exactly singular matrices.
// Preserve the actual axis lengths and let the caller choose a bind rotation.
export function decomposeRigTransform(
  matrix: Matrix4,
  position: Vector3,
  rotation: Quaternion,
  scale: Vector3,
) {
  if (matrix.determinantAffine() === 0) {
    position.setFromMatrixPosition(matrix)
    scale.setFromMatrixScale(matrix)
    return false
  }
  matrix.decompose(position, rotation, scale)
  const length = rotation.lengthSq()
  return (
    Math.min(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) >= 1e-4 &&
    Number.isFinite(length) &&
    length >= 1e-8
  )
}

// GLTFLoader sanitizes node names for animation bindings. The wiki uses the same
// normalization for part selectors, preferring named nodes to tagged nodes.
const partKey = (name: string) => PropertyBinding.sanitizeNodeName(name.trim()).toLowerCase()

function addPart(index: Map<string, Set<Mesh>>, key: string, mesh: Mesh) {
  let meshes = index.get(key)
  if (!meshes) index.set(key, (meshes = new Set()))
  meshes.add(mesh)
}

function collapsesToPoint(geometry: BufferGeometry) {
  const target = geometry.morphAttributes.position?.[0]
  const base = geometry.getAttribute('position')
  if (!target || !base || target.count !== base.count || !base.count) return false
  const box = new Box3(),
    point = new Vector3(),
    offset = new Vector3()
  for (let i = 0; i < target.count; i++) {
    point.fromBufferAttribute(target, i)
    if (geometry.morphTargetsRelative) point.add(offset.fromBufferAttribute(base, i))
    box.expandByPoint(point)
    if (box.min.distanceToSquared(box.max) >= 0.04 ** 2) return false
  }
  return true
}

function studioLambert(source: MeshBasicMaterial, face: boolean, slate: boolean) {
  const mat = new MeshLambertMaterial({
    color: slate ? 0xc7d2e0 : source.color,
    map: source.map,
    side: source.side,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    alphaMap: source.alphaMap,
    vertexColors: source.vertexColors,
    depthWrite: source.depthWrite,
    toneMapped: false,
  })
  // Keep Three's skin/morph normals, view-space lights, texture/alpha pipeline
  // and output color space. Bound the diffuse response even on back-facing normals.
  mat.customProgramCacheKey = () => (face ? 'studio-face' : 'studio-body')
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      float lightSum = 0.0;
      float wrappedSum = 0.0;
      #if NUM_DIR_LIGHTS > 0
        for (int i = 0; i < NUM_DIR_LIGHTS; ++i) {
          float strength = dot(directionalLights[i].color, vec3(0.2126, 0.7152, 0.0722));
          float halfDot = dot(normal, directionalLights[i].direction) * 0.5 + 0.5;
          wrappedSum += strength * smoothstep(0.0, 1.0, halfDot);
          lightSum += strength;
        }
      #endif
      float wrap = lightSum > 0.0 ? wrappedSum / lightSum : 0.5;
      ${
        face
          ? `
        outgoingLight = diffuseColor.rgb * mix(vec3(0.91, 0.89, 0.88), vec3(1.04, 1.025, 1.015), wrap);
      `
          : `
        vec3 tint = mix(vec3(0.91, 0.94, 1.0), vec3(1.03, 1.01, 0.99), wrap);
        float rim = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.8);
        outgoingLight = diffuseColor.rgb * (0.78 + 0.28 * wrap) * tint + rim * 0.12 * diffuseColor.a * vec3(0.95, 0.98, 1.0);
      `
      }
      #include <opaque_fragment>
    `,
    )
  }
  return mat
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
  private readonly namedParts = new Map<string, Set<Mesh>>()
  private readonly taggedParts = new Map<string, Set<Mesh>>()
  private readonly collapseMeshes = new Set<Mesh>()
  private readonly disabledParts = new Set<Mesh>()
  private weaponsCollapsed = false
  private readonly initiallyHidden = new Set<Mesh>()
  private readonly clipVisibility = new Map<Mesh, boolean>()
  private visibilityClip?: AnimationClip
  readonly restMouthWeights = new Map<Mesh, number[]>()
  readonly restMorphWeights = new Map<Mesh, number[]>()
  readonly restGroundOffset = new Vector3()
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
      face?: MeshLambertMaterial
      body?: MeshLambertMaterial
      slate?: MeshLambertMaterial
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
      const restWorldPos = new Vector3(),
        restWorldQuat = new Quaternion(),
        restWorldScale = new Vector3()
      if (!decomposeRigTransform(node.matrixWorld, restWorldPos, restWorldQuat, restWorldScale)) {
        const parent = node.parent && this.rest.get(node.parent)
        if (parent) restWorldQuat.copy(parent.restWorldQuat)
        else restWorldQuat.identity()
        restWorldQuat.multiply(node.quaternion).normalize()
      }
      this.rest.set(node, {
        restLocalPos: node.position.clone(),
        restLocalQuat: node.quaternion.clone(),
        restLocalScale: node.scale.clone(),
        restWorldPos,
        restWorldQuat,
        restWorldScale,
      })
      if (/halo/i.test(node.name)) this.haloNodes.push(node)
      if (!(node instanceof Mesh)) return
      const mesh: Mesh = node
      const ancestry: string[] = []
      let switchTagged = false
      for (let part: Object3D | null = mesh; part; part = part.parent) {
        ancestry.push(part.name)
        if (part.name) addPart(this.namedParts, partKey(part.name), mesh)
        for (const [key, value] of Object.entries(part.userData)) {
          if (value) addPart(this.taggedParts, partKey(key), mesh)
          if (/^switch/i.test(key) && typeof value === 'boolean') switchTagged = true
        }
        if (part === root) break
      }
      const mouth = ancestry.some((n) => /^mouth_/i.test(n))
      const weights = mesh.morphTargetInfluences ?? []
      this.restMorphWeights.set(mesh, [...weights])
      if (!mesh.visible) this.initiallyHidden.add(mesh)
      if (
        !mouth &&
        weights.length &&
        ((switchTagged && weights[0] >= 0.5) || collapsesToPoint(mesh.geometry))
      ) {
        this.collapseMeshes.add(mesh)
        this.updateVisibility(mesh)
      }
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
      const summonName = [group, mesh.name].find((n) => /^SM\d+/i.test(n))
      const name = summonName || group || ancestry.join(' ')
      const namedWeapon = /weapon/i.test(name) && !/shield_weapon|weapon_can/i.test(name)
      if (summonName) {
        // Vehicle skins can share character joints, including the weapon grip.
        if (namedWeapon) this.weaponMeshes.push(mesh)
        else this.propMeshes.push(mesh)
      } else if (mouth) {
        this.mouthMeshes.push(mesh)
        this.restMouthWeights.set(mesh, this.restMorphWeights.get(mesh)!)
      } else if (/halo/i.test(name) || ancestry.some((n) => /halo/i.test(n))) {
        if (!this.haloNodes.includes(mesh)) this.haloNodes.push(mesh)
      } else if (/body|(?:^|_)(?:face|hair|eyebrow|eyemouth)\d*(?:_|$)|^faceCH|^CH\d+(?:_Mesh)?$/i.test(name))
        this.bodyMeshes.push(mesh)
      else if (
        namedWeapon ||
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
    const nodes = [...this.rest.keys()]
    const hip = nodes.find((n) => canonicalBoneName(n.name) === 'bip001')
    const charRoot = nodes.find((n) => /^character_root$/i.test(n.name))
    const hipPos = hip && this.rest.get(hip)!.restWorldPos
    const rootZ = charRoot ? this.rest.get(charRoot)!.restWorldPos.z : 0
    // The body's lowest bind-pose vertex can be on a vehicle seat above the stage floor.
    this.expandVisibleBounds(this.bounds, this.bodyMeshes)
    const groundY = !this.bounds.isEmpty() && Math.abs(this.bounds.min.y) > 0.05 ? this.bounds.min.y : 0
    this.restGroundOffset.set(
      hipPos && Math.abs(hipPos.x) > 0.05 ? hipPos.x : 0,
      groundY,
      Math.abs(rootZ) > 0.01 ? rootZ : 0,
    )
    this.hipRestHeight = hipPos ? hipPos.y - groundY : 0
    this.expandVisibleBounds(this.bounds, this.haloNodes)
    if (this.bounds.isEmpty()) this.expandVisibleBounds(this.bounds)
    this.clips = animations.map(describeClip)
    this.outline = new OutlineEffect(root)
  }

  private updateVisibility(mesh: Mesh) {
    mesh.visible =
      !this.disabledParts.has(mesh) &&
      !(this.weaponsCollapsed && this.weaponMeshes.includes(mesh)) &&
      (this.clipVisibility.get(mesh) ?? !this.initiallyHidden.has(mesh)) &&
      !(this.collapseMeshes.has(mesh) && mesh.morphTargetInfluences![0] >= 0.95)
  }

  setWeaponsCollapsed(collapsed: boolean) {
    if (this.weaponsCollapsed === collapsed) return
    this.weaponsCollapsed = collapsed
    for (const mesh of this.weaponMeshes) this.updateVisibility(mesh)
  }

  setPartEnabled(mesh: Mesh, enabled: boolean) {
    if (enabled) this.disabledParts.delete(mesh)
    else this.disabledParts.add(mesh)
    this.updateVisibility(mesh)
  }

  setWeaponsEnabled(enabled: boolean) {
    for (const mesh of this.weaponMeshes) this.setPartEnabled(mesh, enabled)
  }

  setHalosEnabled(enabled: boolean) {
    for (const node of this.haloNodes) if (node instanceof Mesh) this.setPartEnabled(node, enabled)
  }

  syncSwitchVisibility(clip?: AnimationClip) {
    if (clip !== this.visibilityClip) {
      this.visibilityClip = clip
      this.clipVisibility.clear()
      for (const rule of ['hide', 'show'] as const) {
        const values = clip?.userData?.[rule]
        for (const value of Array.isArray(values) ? values : [values]) {
          if (typeof value !== 'string') continue
          const key = partKey(value)
          const matches = this.namedParts.get(key) ?? this.taggedParts.get(key)
          if (matches) for (const mesh of matches) this.clipVisibility.set(mesh, rule === 'show')
        }
      }
      for (const mesh of this.meshGroups.keys()) this.updateVisibility(mesh)
    } else {
      for (const mesh of this.collapseMeshes) this.updateVisibility(mesh)
    }
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
    const substitute = (material: Material, accessory: boolean, partName: string) => {
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
      const name = partName + ' ' + material.name
      if (mode === 'softLit' && unlitPart.test(name)) return source
      const slate =
        accessory &&
        !source.map &&
        !source.transparent &&
        source.opacity === 1 &&
        !source.alphaMap &&
        source.alphaTest === 0 &&
        source.color.r > 0.94 &&
        source.color.g > 0.94 &&
        source.color.b > 0.94
      if (mode === 'softLit') {
        const key = slate ? 'slate' : /face/i.test(name) ? 'face' : 'body'
        return (pair[key] ??= studioLambert(source, key === 'face', slate))
      }
      if (slate) {
        // A body mesh can share this source material with an untextured accessory.
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
      const accessory = this.propMeshes.includes(mesh) || this.weaponMeshes.includes(mesh)
      const name = [
        mesh.name,
        this.meshGroups.get(mesh),
        this.haloNodes.includes(mesh) ? 'halo' : '',
        this.mouthMeshes.includes(mesh) ? 'mouth' : '',
        isBakedOutline(mesh) ? 'outline' : '',
      ].join(' ')
      mesh.material = Array.isArray(original)
        ? original.map((material) => substitute(material, accessory, name))
        : substitute(original, accessory, name)
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
      pair.face?.dispose()
      pair.body?.dispose()
      pair.slate?.dispose()
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
