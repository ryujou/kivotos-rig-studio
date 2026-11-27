import { unzip, type Unzipped } from 'fflate'
import { newProp } from '../engine/PropTypes'
import type { Vec3, RigSettings } from '../engine/RigDefinition'
import { useStudioStore } from '../store/useStudioStore'

interface Manifest {
  name?: string
  furniture?: string
  student?: string
  offset?: Vec3
  yaw?: number
  furnitureClip?: string
  studentClip?: string
  rootMode?: RigSettings['rootMode']
}
export interface FurniturePack {
  manifest: Manifest
  furniture: File
  student?: File
  furnitureClip: string
  studentClip: string
}
function manifestOf(input: unknown): Manifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('manifest')
  const m = input as Manifest
  for (const key of ['name', 'furniture', 'student', 'furnitureClip', 'studentClip'] as const)
    if (m[key] !== undefined && typeof m[key] !== 'string') throw Error('manifest_text')
  if (
    m.offset !== undefined &&
    !(Array.isArray(m.offset) && m.offset.length === 3 && m.offset.every(Number.isFinite))
  )
    throw Error('offset')
  if (m.yaw !== undefined && !Number.isFinite(m.yaw)) throw Error('yaw')
  if (m.rootMode !== undefined && !['prop-locked', 'ground-scaled'].includes(m.rootMode))
    throw Error('root_mode')
  return m
}
const basename = (path: string) => path.split(/[\\/]/).pop()!
async function glbInfo(file: File) {
  const header = new DataView(await file.slice(0, 20).arrayBuffer())
  if (
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== file.size ||
    header.getUint32(16, true) !== 0x4e4f534a
  )
    throw Error('invalid_glb')
  const length = header.getUint32(12, true)
  if (length > file.size - 20) throw Error('invalid_chunk')
  const json = JSON.parse(await file.slice(20, 20 + length).text())
  const clips: string[] = (json.animations ?? []).map(
    (a: { name?: string }, i: number) => a.name || 'animation_' + i,
  )
  return {
    file,
    clips,
    mesh: !!json.meshes?.length,
    humanoid: (json.nodes ?? []).some((node: { name?: string }) =>
      /^bip001[ _]pelvis$/i.test(node.name ?? ''),
    ),
  }
}
export async function parseFurnitureFiles(files: readonly File[]): Promise<FurniturePack> {
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    const compressed = new Uint8Array(await files[0].arrayBuffer())
    const archive = await new Promise<Unzipped>((ok, fail) =>
      unzip(
        compressed,
        {
          filter: (e) =>
            !/(?:^|\/)(?:__MACOSX|\.)/.test(e.name) && /(?:\.glb|(?:^|\/)pack\.json)$/i.test(e.name),
        },
        (error, entries) => (error ? fail(error) : ok(entries)),
      ),
    )
    files = Object.entries(archive).map(([name, bytes]) => new File([new Uint8Array(bytes)], name))
  }
  const manifests = files.filter((f) => /^pack\.json$/i.test(basename(f.name)))
  if (manifests.length > 1) throw Error('multiple_manifests')
  const manifest = manifests[0] ? manifestOf(JSON.parse(await manifests[0].text())) : {}
  const assets = await Promise.all(files.filter((f) => /\.glb$/i.test(f.name)).map(glbInfo))
  if (!assets.length || assets.length > 2) throw Error('pack_files')
  const named = (name: string) => {
    const manifestPath = manifests[0]?.webkitRelativePath || manifests[0]?.name || ''
    const folder = manifestPath.slice(0, Math.max(0, manifestPath.lastIndexOf('/') + 1))
    const relative = name.replace(/^\.\//, '')
    const exact = assets.filter((a) => {
      const path = a.file.webkitRelativePath || a.file.name
      return path === folder + relative || path === relative
    })
    const matches = exact.length
      ? exact
      : assets.filter((a) => basename(a.file.name) === basename(relative))
    if (matches.length !== 1) throw Error('ambiguous_file')
    return matches[0]
  }
  let student = manifest.student ? named(manifest.student) : undefined
  let furniture = manifest.furniture ? named(manifest.furniture) : undefined
  if (assets.length === 2) {
    student ??=
      assets.find(
        (a) =>
          a !== furniture && /^(?:student|interaction|animation)([_. -]|$)/i.test(basename(a.file.name)),
      ) ??
      assets.find((a) => a !== furniture && !a.mesh) ??
      assets.find((a) => manifest.studentClip && a !== furniture && a.clips.includes(manifest.studentClip))
    if (!student && assets.filter((a) => a.humanoid).length === 1)
      student = assets.find((a) => a.humanoid && a !== furniture)
    furniture ??= assets.find(
      (a) => a !== student && /^(?:furniture|prop)([_. -]|$)/i.test(basename(a.file.name)),
    )
    if (!student && !furniture) throw Error('ambiguous_pack')
    student ??= assets.find((a) => a !== furniture)
  }
  furniture ??= assets.find((a) => a !== student)
  if (!furniture?.mesh || furniture === student || (manifest.studentClip && !student))
    throw Error('missing_furniture')
  function clip(clips: string[], preferred?: string) {
    if (preferred && !clips.includes(preferred)) throw Error('missing_clip')
    return preferred || clips[0] || ''
  }
  const studentClip = student ? clip(student.clips, manifest.studentClip) : ''
  if (student && !studentClip) throw Error('missing_interaction')
  return {
    manifest,
    furniture: furniture.file,
    student: student?.file,
    furnitureClip: clip(furniture.clips, manifest.furnitureClip),
    studentClip,
  }
}
export function mountFurniture(pack: FurniturePack, slotId: number, bone = 'world') {
  const s = useStudioStore.getState(),
    slot = s.slots.find((v) => v.id === slotId)
  if (!slot) throw Error('missing_slot')
  const m = pack.manifest,
    id = 'local:' + crypto.randomUUID()
  const prop = newProp(id)
  prop.file = pack.furniture
  prop.name = m.name || basename(pack.furniture.name)
  prop.clip = pack.furnitureClip
  prop.bone = pack.student ? 'world' : bone
  prop.slotId = prop.bone === 'world' ? null : slotId
  if (pack.student) {
    // Manifest offset and yaw place the student's origin relative to the furniture.
    prop.position = [...slot.position]
    prop.rotation = [0, slot.rotation[1], 0]
    prop.scale = [...slot.scale]
    const [x, y, z] = (m.offset ?? [0, 0, 0]).map((v, i) => v * slot.scale[i])
    const { yaw } = slot,
      studentId = s.registerFile(pack.student)
    const degrees = slot.rotation[1] + (m.yaw ?? 0)
    s.updateSlot(slotId, {
      motion: studentId,
      socket: undefined,
      clip: pack.studentClip,
      endClip: undefined,
      externalClips: [],
      embedded: {},
      position: [
        slot.position[0] + x * Math.cos(yaw) + z * Math.sin(yaw),
        slot.position[1] + y,
        slot.position[2] - x * Math.sin(yaw) + z * Math.cos(yaw),
      ],
      rotation: [0, degrees, 0],
      yaw: (degrees * Math.PI) / 180,
      rig: { ...slot.rig, rootMode: m.rootMode ?? 'prop-locked', overrides: {} },
    })
    s.setTimeline({ time: 0, trimStart: 0, trimEnd: 1 })
  } else {
    prop.position = m.offset ?? [0, 0, 0]
    prop.rotation[1] = m.yaw ?? 0
  }
  s.upsertProp(prop)
  s.selectProp(prop.id)
  return prop.id
}

function httpUrl(path: string, base?: string) {
  const url = new URL(path, base)
  if (!/^https?:$/.test(url.protocol)) throw Error('invalid_url')
  return url.href
}
async function remote(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw Error('pack_http')
  return response
}
export async function readPackIndex(url: string): Promise<{ name: string; url: string }[]> {
  const response = await remote(httpUrl(url))
  const data = await response.json()
  if (!Array.isArray(data.packs)) throw Error('invalid_index')
  return data.packs.map((p: { name: string; url: string }) => {
    if (typeof p?.name !== 'string' || typeof p.url !== 'string') throw Error('invalid_entry')
    return { name: p.name, url: httpUrl(p.url, response.url || url) }
  })
}
export async function readRemotePack(url: string) {
  const response = await remote(httpUrl(url))
  if (/\.json$/i.test(new URL(url).pathname)) {
    const manifest = manifestOf(await response.json())
    const files = await Promise.all(
      [manifest.furniture ?? 'furniture.glb', ...(manifest.student ? [manifest.student] : [])].map(
        async (name) => new File([await (await remote(httpUrl(name, response.url || url))).blob()], name),
      ),
    )
    return parseFurnitureFiles([...files, new File([JSON.stringify(manifest)], 'pack.json')])
  }
  return parseFurnitureFiles([new File([await response.blob()], basename(new URL(url).pathname))])
}

// Directory drops arrive as entries; one readEntries call can return a partial batch.
export async function droppedFiles(transfer: DataTransfer): Promise<File[]> {
  const fallback = Array.from(transfer.files)
  const entries = Array.from(transfer.items ?? [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter((v): v is FileSystemEntry => !!v)
  if (!entries.some((e) => e.isDirectory)) return fallback
  async function filesIn(entry: FileSystemEntry): Promise<File[]> {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') return []
    if (entry.isFile) {
      const file = await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail))
      return [
        new File([file], entry.fullPath.replace(/^\/+/, ''), {
          type: file.type,
          lastModified: file.lastModified,
        }),
      ]
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader(),
      files: File[] = []
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail))
      if (!batch.length) return files
      files.push(...(await Promise.all(batch.map(filesIn))).flat())
    }
  }
  return (await Promise.all(entries.map(filesIn))).flat()
}
