import type { AnimationClip } from 'three'
import type { JointCombo } from '../data/jointCombos'
import { fetchModelBuffer } from './modelCache'
import { useStudioStore } from '../store/useStudioStore'

export const jointSlug = (file: string) =>
  file
    .replace(/(?:\.joint\.br|\.glb)$/i, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export async function readJointFile(file: File) {
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength >= 4 && new DataView(bytes).getUint32(0, true) === 0x46546c67) return bytes
  let decoder: DecompressionStream
  try {
    decoder = new DecompressionStream('brotli' as CompressionFormat)
  } catch {
    // Chromium versions without Compression Streams Brotli still work offline.
    const { BrotliDecode } = await import('../vendor/brotli/decode.js')
    return BrotliDecode(new Int8Array(bytes)).buffer
  }
  return new Response(new Blob([bytes]).stream().pipeThrough(decoder)).arrayBuffer()
}
async function jointClips(data: ArrayBuffer, start: string, end: string) {
  // Joint assets contain tracks and a named hierarchy. Skip material/texture
  // acquisition when a user supplies a complete animated character as a fallback.
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
  const loader = new GLTFLoader()
  loader.register((parser) => ({
    name: 'joint_tracks',
    beforeRoot: () => {
      for (const node of parser.json.nodes ?? []) {
        // Keep morph targets on full local GLBs for GLTFLoader's weight bindings.
        if (node.mesh !== undefined)
          for (const prim of parser.json.meshes[node.mesh].primitives) delete prim.material
      }
      return null
    },
  }))
  const gltf = await loader.parseAsync(data, '')
  try {
    const clips = [start, end].map((name) => gltf.animations.find((c) => c.name === name))
    if (!clips.every((c): c is AnimationClip => !!c && c.tracks.length > 0))
      throw new Error('missing_joint_clip')
    return clips
  } finally {
    gltf.scene.traverse((node) => {
      if ('geometry' in node) (node as import('three').Mesh).geometry.dispose()
      if ('skeleton' in node) (node as import('three').SkinnedMesh).skeleton.dispose()
      if ('material' in node) {
        const mat = (node as import('three').Mesh).material
        for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose()
      }
    })
  }
}

export function jointErrorMessage(error: unknown) {
  return error instanceof Error && error.message === 'joint_proxy_unavailable'
    ? 'proxyUnavailable'
    : 'jointFailed'
}

let pending: AbortController | undefined
export async function loadJoint(combo: JointCombo, local: ReadonlyMap<string, File> = new Map()) {
  pending?.abort()
  const controller = new AbortController()
  pending = controller
  try {
    const { proxyBase } = useStudioStore.getState()
    const clips = await Promise.all(
      combo.members.map(async (member) => {
        if (combo.native) return []
        const slug = jointSlug(member.model)
        const file = local.get(slug)
        if (file) return jointClips(await readJointFile(file), member.start, member.end)
        const base = new URL(
          proxyBase.trim() || '/api/joint/',
          globalThis.location?.href ?? 'http://localhost/',
        )
        if (!/^https?:$/.test(base.protocol)) throw new Error('invalid_proxy')
        if (base.pathname === '/') base.pathname = '/api/joint/'
        const url = new URL(slug + '.joint.br', base.href.replace(/\/?$/, '/')).href
        const data = await fetchModelBuffer(url, undefined, controller.signal).catch((error: unknown) => {
          if (
            error instanceof Error &&
            ['model_http_404', 'model_http_405', 'invalid_glb'].includes(error.message)
          )
            throw new Error('joint_proxy_unavailable', { cause: error })
          throw error
        })
        return jointClips(data, member.start, member.end)
      }),
    )
    controller.signal.throwIfAborted()
    useStudioStore.getState().loadFormation(combo, clips)
  } catch (error) {
    if (controller.signal.aborted) return
    controller.abort()
    throw error
  } finally {
    if (pending === controller) pending = undefined
  }
}
