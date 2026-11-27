import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { zipSync } from 'fflate'
import { makeGlbBytes, animatedGlb } from './fixtures.mjs'
import {
  parseFurnitureFiles,
  mountFurniture,
  droppedFiles,
  readPackIndex,
  readRemotePack,
} from '../src/services/furniturePack.ts'
import { jointSlug, jointErrorMessage, readJointFile, loadJoint } from '../src/services/jointLoader.ts'
import { fetchModelBuffer, onCacheChange } from '../src/services/modelCache.ts'
import { jointCombos } from '../src/data/jointCombos.ts'
import { propModels } from '../src/data/propModels.ts'
import {
  snapshotModels,
  normalizeSearch,
  variantLabel,
  modelLabel,
  filterCharacters,
  loadWikiCatalog,
} from '../src/services/wikiCatalog.ts'
import { useStudioStore } from '../src/store/useStudioStore.ts'

test('furniturePack: GLB, 2-GLB, ZIP, manifest validation, mountFurniture, droppedFiles, readPackIndex & remote', async () => {
  const furnBytes = makeGlbBytes({
    asset: { version: '2.0' },
    meshes: [{ primitives: [] }],
    animations: [{ name: 'Chair_Idle' }],
  })
  const studBytes = makeGlbBytes({
    asset: { version: '2.0' },
    nodes: [{ name: 'Bip001 Pelvis' }],
    animations: [{ name: 'Cafe_Sit' }],
  })
  const furnFile = new File([furnBytes], 'furniture_chair.glb')
  const studFile = new File([studBytes], 'student_sit.glb')
  const manifestFile = new File(
    [JSON.stringify({ name: 'Cafe Chair', offset: [0, 0, 0.2], yaw: 90, rootMode: 'prop-locked' })],
    'pack.json',
  )

  const pack = await parseFurnitureFiles([furnFile, studFile, manifestFile])
  assert.equal(pack.furnitureClip, 'Chair_Idle')
  assert.equal(pack.studentClip, 'Cafe_Sit')

  const zipBytes = zipSync({
    'chair/pack.json': new TextEncoder().encode(
      JSON.stringify({ name: 'Zip Chair', furniture: 'furniture.glb' }),
    ),
    'chair/furniture.glb': furnBytes,
    '__MACOSX/._furniture.glb': new Uint8Array([1, 2, 3]),
  })
  const zipPack = await parseFurnitureFiles([new File([zipBytes], 'chair.zip')])
  assert.equal(zipPack.manifest.name, 'Zip Chair')

  await assert.rejects(() => parseFurnitureFiles([new File([new Uint8Array(24)], 'bad.glb')]), /invalid_glb/)
  await assert.rejects(
    () => parseFurnitureFiles([furnFile, new File([JSON.stringify({ yaw: 'bad' })], 'pack.json')]),
    /yaw/,
  )
  await assert.rejects(
    () => parseFurnitureFiles([furnFile, new File([JSON.stringify({ rootMode: 'wrong' })], 'pack.json')]),
    /root_mode/,
  )
  await assert.rejects(
    () => parseFurnitureFiles([furnFile, manifestFile, new File(['{}'], 'sub/pack.json')]),
    /multiple_manifests/,
  )

  const activeId = useStudioStore.getState().activeId
  const propId = mountFurniture(pack, activeId)
  assert.equal(useStudioStore.getState().slots.find((slot) => slot.id === activeId).clip, 'Cafe_Sit')
  useStudioStore.getState().removeProp(propId)

  // Mount furniture-only pack (else branch)
  const propId2 = mountFurniture(zipPack, activeId, 'Bip001_R_Hand')
  assert.ok(useStudioStore.getState().props.some((p) => p.id === propId2))
  useStudioStore.getState().removeProp(propId2)

  const origFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('index.json')) {
        return new Response(JSON.stringify({ packs: [{ name: 'Desk', url: 'desk.glb' }] }), { status: 200 })
      }
      return new Response(furnBytes, { status: 200 })
    }
    const list = await readPackIndex('https://example.com/packs/index.json')
    assert.equal(list[0].url, 'https://example.com/packs/desk.glb')
    const remotePack = await readRemotePack(list[0].url)
    assert.equal(remotePack.furnitureClip, 'Chair_Idle')
    await assert.rejects(() => readPackIndex('ftp://example.com/index.json'), /invalid_url/)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('jointLoader & modelCache: slug, Brotli decode, proxy unavailable error, fetchModelBuffer', async () => {
  assert.equal(jointSlug('Hina (Dress).glb'), 'hina-dress')
  assert.equal(jointSlug('Ako (Dress).joint.br'), 'ako-dress')
  assert.equal(jointErrorMessage(new Error('joint_proxy_unavailable')), 'proxyUnavailable')
  assert.equal(jointErrorMessage(new Error('other')), 'jointFailed')

  const glb = makeGlbBytes({ asset: { version: '2.0' } })
  const rawBuf = await readJointFile(new File([glb], 'test.glb'))
  assert.equal(rawBuf.byteLength, glb.byteLength)

  const br = zlib.brotliCompressSync(glb)
  const decBuf = await readJointFile(new File([br], 'test.joint.br'))
  assert.equal(decBuf.byteLength, glb.byteLength)
  assert.equal(new DataView(decBuf).getUint32(0, true), 0x46546c67)

  const unsub = onCacheChange(() => {})
  unsub()

  const origFetch = globalThis.fetch
  try {
    let progressCalls = 0
    globalThis.fetch = async () =>
      new Response(glb, { status: 200, headers: { 'Content-Length': String(glb.byteLength) } })
    const fetched = await fetchModelBuffer('https://example.com/model.glb', () => progressCalls++)
    assert.equal(fetched.byteLength, glb.byteLength)
    assert.ok(progressCalls >= 2)

    // Invalid GLB returned with HTTP 200
    globalThis.fetch = async () => new Response('<html>404</html>', { status: 200 })
    await assert.rejects(() => fetchModelBuffer('https://example.com/bad.glb'), /invalid_glb/)

    // Official joint combo against static host returning 404 -> joint_proxy_unavailable
    globalThis.fetch = async () => new Response('Not found', { status: 404 })
    const officialCombo = jointCombos.find((c) => !c.native)
    await assert.rejects(() => loadJoint(officialCombo), /joint_proxy_unavailable/)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('wikiCatalog: search, localization, filtering, live & offline fallback', async () => {
  assert.equal(normalizeSearch('Hina (Dress)!!'), 'hina dress')
  assert.equal(variantLabel('Swimsuit', 'zh'), '泳装')
  assert.equal(variantLabel('UnknownTag', 'en'), 'UnknownTag')

  const hina = snapshotModels.find((m) => m.id === 'Hina')
  assert.equal(modelLabel(hina, 'zh'), '日奈')

  const trinity = filterCharacters(snapshotModels, '', 'trinity', 'all')
  assert.ok(trinity.length > 20 && trinity.every((m) => m.school === 'trinity'))
  assert.equal(filterCharacters(snapshotModels, '', 'all', 'hasProps').length, propModels.length)
  assert.ok(filterCharacters(snapshotModels, '妃咲', 'all', 'all').some((m) => m.id === 'Kisaki'))

  const origFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('err', { status: 500 })
    const fb = await loadWikiCatalog()
    assert.equal(fb.status, 'offline')
    assert.equal(fb.models.length, snapshotModels.length)

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          query: {
            pages: {
              1: {
                revisions: [
                  {
                    slots: {
                      main: {
                        '*': JSON.stringify({
                          base: 'https://cdn.example.com/',
                          characters: [
                            {
                              name: 'Hina',
                              models: [{ id: 'Hina', label: 'Hina', skin: '', file: 'Hina.glb' }],
                            },
                          ],
                        }),
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
        { status: 200 },
      )
    const live = await loadWikiCatalog()
    assert.equal(live.status, 'live')
    assert.equal(live.models.length, 1)
  } finally {
    globalThis.fetch = origFetch
  }
})

test(
  'aborting a pending stream read cancels it, releases its lock, and rejects with the abort reason',
  { timeout: 2000 },
  async (t) => {
    const started = Promise.withResolvers()
    let cancelled = 0
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0x67, 0x6c]))
      },
      cancel() {
        cancelled++
      },
    })
    t.mock.method(globalThis, 'fetch', async () => new Response(body))
    const controller = new AbortController()
    const pending = fetchModelBuffer(
      'https://example.test/partial',
      (received) => {
        if (received) started.resolve()
      },
      controller.signal,
    )
    await started.promise
    controller.abort()
    await assert.rejects(pending, (error) => error === controller.signal.reason)
    assert.equal(cancelled, 1)
    assert.equal(body.locked, false)
  },
)

test('short GLBs produce the domain error, and mounted offsets are owned by the prop', async () => {
  for (const length of [0, 1, 12, 19])
    await assert.rejects(parseFurnitureFiles([new File([new Uint8Array(length)], 'tiny.glb')]), {
      message: 'invalid_glb',
    })
  const manifest = { offset: [1, 2, 3] }
  const id = mountFurniture({ manifest, furniture: new File([], 'bench.glb'), furnitureClip: '' }, 1)
  const position = useStudioStore.getState().props.find((p) => p.id === id).position
  manifest.offset[0] = 42
  assert.deepEqual(position, [1, 2, 3])
})

test('local and remote joint clips bind to their member files before committing the formation', async (t) => {
  const combo = jointCombos.find((combo) => !combo.native)
  const { start, end } = combo.members[0]
  const bytes = animatedGlb([start, end])
  const local = new Map([[jointSlug(combo.members[0].model), new File([bytes], 'animation.glb')]])
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes))
  await loadJoint(combo, local)
  for (const slot of useStudioStore.getState().slots) {
    assert.deepEqual(
      slot.externalClips.map((clip) => clip.name),
      [start, end],
    )
    assert.equal(slot.externalClips[0].tracks.length, 1)
  }
  const invalid = new Map([[jointSlug(combo.members[0].model), new File([animatedGlb()], 'wrong.glb')]])
  await assert.rejects(loadJoint(combo, invalid), /missing_joint_clip/)
})

test('directory import reads successive batches and remote manifests resolve relative assets', async (t) => {
  const file = new File([animatedGlb()], 'chair.glb')
  const entries = [
    [{ name: '.hidden', isFile: true }],
    [{ name: file.name, fullPath: '/room/chair.glb', isFile: true, file: (cb) => cb(file) }],
    [],
  ]
  const dir = {
    name: 'room',
    isDirectory: true,
    createReader: () => ({ readEntries: (cb) => cb(entries.shift()) }),
  }
  const files = await droppedFiles({ files: [], items: [{ webkitGetAsEntry: () => dir }] })
  assert.deepEqual(
    files.map((f) => f.name),
    ['room/chair.glb'],
  )
  assert.deepEqual(await droppedFiles({ files, items: [] }), files)
  const urls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url)
    return url.endsWith('.json') ? Response.json({ furniture: 'chair.glb' }) : new Response(file)
  })
  assert.equal((await readRemotePack('https://example.test/room/pack.json')).furnitureClip, 'Cafe_Reaction')
  assert.deepEqual(urls, ['https://example.test/room/pack.json', 'https://example.test/room/chair.glb'])
})
