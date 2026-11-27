import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fallbackCatalog } from '../src/data/fallbackCatalog.ts'
import { studentNames } from '../src/i18n/studentNames.ts'
import { studentSchools } from '../src/i18n/schools.ts'
import { expandSnapshotModel, fetchSchaleMatcher } from '../src/services/catalogFeeds.js'
import { filterCharacters, loadWikiCatalog, modelLabel, snapshotModels } from '../src/services/wikiCatalog.ts'
import {
  clearDynamicStandingArt, hasStaticStandingArt, registerDynamicStandingArt, standingArtFrame, standingArtUrl,
} from '../src/data/standingArt.ts'
import { syncCatalog } from '../scripts/sync-catalog.mjs'

afterEach(clearDynamicStandingArt)
const portrait = id => `https://schaledb.com/images/student/portrait/${id}.webp`
const character = (name, ...skins) => ({ name, models: skins.map(skin => expandSnapshotModel(name, skin)) })
const wiki = (...characters) => ({ base: fallbackCatalog.base, characters })
const sample = {
  en: [{ Id: 998, Name: 'Noelle (Bunny)', School: 'WildHunt' }, { Id: 997, Name: 'Noelle', School: 'WildHunt' }],
  cn: { 997: { Name: '诺艾尔' }, 998: { Name: '诺艾尔（兔女郎）' } },
  jp: [{ Id: 997, Name: 'ノエル' }],
  kr: { 998: { Name: '노엘 (바니걸) (한정)' }, 997: { Name: '노엘' } },
}
function feeds(t, catalog, schale = sample) {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(url)
    assert.ok(options.signal instanceof AbortSignal)
    if (url.startsWith('https://bluearchive.wiki/w/api.php?')) {
      assert.equal(new URL(url).searchParams.get('titles'), 'Module:ModelViewer/data.json')
      return Response.json({ query: { pages: { 1: { revisions: [{ slots: { main: { '*': JSON.stringify(catalog) } } }] } } } })
    }
    const [, locale] = url.match(/^https:\/\/schaledb\.com\/data\/(en|cn|jp|kr)\/students\.min\.json$/)
    const rows = schale[locale]
    if (rows instanceof Error) throw rows
    return rows instanceof Response ? rows : Response.json(rows)
  })
  return requests
}

test('a live Wiki revision with complete static metadata skips every SchaleDB request', async t => {
  const known = snapshotModels.filter(m => hasStaticStandingArt(m.id) &&
    Object.hasOwn(studentNames, m.student) && Object.hasOwn(studentSchools, m.student))
  assert.ok(known.length >= 289)
  const ids = new Set(known.map(m => m.id))
  const requests = feeds(t, wiki(...fallbackCatalog.characters.map(({ name, models }) =>
    ({ name, models: models.filter(m => ids.has(m.id)) }))))
  const { status, models } = await loadWikiCatalog()
  assert.equal(status, 'live')
  assert.equal(requests.length, 1)
  assert.deepEqual(models, known)
})

test('new student and alt join four locales by ID and immediately support localized search', async t => {
  const requests = feeds(t, wiki(character('Noelle', '', 'Bunny Girl / Carrier 2', 'Dress'), character('No Match', '')))
  const { status, models } = await loadWikiCatalog()
  assert.equal(status, 'live')
  assert.equal(new Set(requests).size, 5)
  assert.equal(requests.length, 5)
  const [base, alt, unlisted, unknown] = models
  assert.equal(standingArtUrl(base.id), portrait(997))
  assert.equal(standingArtUrl(alt.id), portrait(998))
  assert.equal(standingArtUrl(unlisted.id), portrait(997))
  assert.deepEqual(standingArtFrame(alt.id), [50, -10, 420])
  assert.equal(hasStaticStandingArt(alt.id), false)
  for (const model of [base, alt, unlisted]) {
    assert.deepEqual(model.names, { zh: '诺艾尔', ja: 'ノエル', ko: '노엘', en: 'Noelle' })
    assert.equal(model.school, 'wildhunt')
    for (const term of ['诺艾尔', 'ノエル', '노엘', '狂猎', 'ワイルドハント', '와일드헌트', 'Wildhunt Academy'])
      assert.ok(filterCharacters(models, term, 'wildhunt', 'all').includes(model), term)
  }
  assert.equal(modelLabel(alt, 'zh'), '诺艾尔 (兔女郎 / 载具 2)')
  assert.equal(unknown.school, 'other')
  assert.equal(standingArtUrl(unknown.id), undefined)
})

test('all four requests start together with one 10-second deadline', async t => {
  const controller = new AbortController()
  const timeout = t.mock.method(AbortSignal, 'timeout', () => controller.signal)
  const pending = []
  t.mock.method(globalThis, 'fetch', (url, { signal }) => {
    assert.equal(signal, controller.signal)
    const { promise, resolve } = Promise.withResolvers()
    pending.push({ locale: new URL(url).pathname.split('/')[2], resolve })
    return promise
  })
  const work = fetchSchaleMatcher()
  assert.deepEqual(pending.map(p => p.locale).sort(), ['cn', 'en', 'jp', 'kr'])
  assert.deepEqual(timeout.mock.calls.map(call => call.arguments), [[10_000]])
  for (const { locale, resolve } of pending.reverse()) resolve(Response.json(sample[locale]))
  const match = await work
  assert.equal(match({ id: 'Noelle', student: 'Noelle', skin: '' }).id, 997)
})

test('outfit synonyms, punctuation, model-only suffixes and school IDs', async t => {
  const aliases = [['Bunny Girl', 'Bunny'], ['Riding', 'Cycling'], ['Kid', 'Small'], ['Hot Spring', 'Onsen'],
    ['Battle', 'Armed'], ['School Uniform', 'Uniform'], ['Part-Timer', 'Part-time']]
  const schools = { Abydos: 'abydos', Gehenna: 'gehenna', Millennium: 'millennium', Trinity: 'trinity',
    Hyakkiyako: 'hyakkiyako', Shanhaijing: 'shanhaijing', RedWinter: 'redWinter', Valkyrie: 'valkyrie',
    Arius: 'arius', SRT: 'srt', Highlander: 'highlander', WildHunt: 'wildhunt', Tokiwadai: 'tokiwadai',
    Sakugawa: 'sakugawa', Unknown: 'other' }
  const rows = Object.keys(schools).map((School, i) => ({ Id: i + 1, Name: 'Student ' + i, School }))
  rows.push(...aliases.map(([, alt], i) => ({ Id: i + 80, Name: 'Ru·Mi (' + alt + ')', School: 'SRT' })))
  rows.push({ Id: 200, Name: 'Aris (Onsen)', School: 'Millennium' })
  feeds(t, wiki(), { en: rows, cn: rows, jp: rows, kr: rows })
  const match = await fetchSchaleMatcher()
  assert.equal(match({ student: 'Arisu', id: 'Arisu (Hot Spring)', skin: 'Hot Spring' }).id, 200)
  for (const [i, [skin]] of aliases.entries()) {
    for (const extra of ['Carrier', 'Carrier 2', 'Scenario', 'Scenario 1', 'Scenario 2', 'Cut-in', 'Special', 'No Weapon', 'Cafe', '1', '2']) {
      assert.equal(match({ student: 'Ru-Mi', id: `Ru-Mi (${skin}) (${extra})`, skin: skin + ' / ' + extra }).id, i + 80)
    }
    assert.equal(match({ student: 'Ru-Mi', id: 'opaque_wiki_id', skin }).id, i + 80)
    assert.equal(match({ student: 'unrelated', id: `Ru-Mi (${skin}) (Cut-in)`, skin: '' }).id, i + 80)
  }
  for (const [i, school] of Object.values(schools).entries()) {
    const student = 'Student ' + i
    assert.equal(match({ student, id: student, skin: '' }).school, school)
  }
})

test('static art and custom frames win over dynamic entries, and clearing resets dynamic defaults', () => {
  const id = 'Ichika (Swimsuit)'
  const url = standingArtUrl(id)
  registerDynamicStandingArt(id, portrait(1), [1, 2, 3])
  registerDynamicStandingArt('custom', portrait(2), [5, 6, 7])
  assert.equal(standingArtUrl(id), url)
  assert.deepEqual(standingArtFrame(id), [51, -27, 480])
  assert.deepEqual(standingArtFrame('custom'), [5, 6, 7])
  registerDynamicStandingArt('custom', portrait(3))
  assert.deepEqual(standingArtFrame('custom'), [50, -10, 420])
  clearDynamicStandingArt()
  assert.equal(standingArtUrl('custom'), undefined)
  assert.deepEqual(standingArtFrame('custom'), [50, -8, 380])
})

for (const [error, response] of [['network', new TypeError('offline')], ['HTTP', new Response(null, { status: 503 })], ['empty', {}]]) {
  test(`SchaleDB ${error} failure leaves the live Wiki models intact`, async t => {
    feeds(t, wiki(character('Noelle', '')), { ...sample, jp: response })
    const { models, status } = await loadWikiCatalog()
    assert.equal(status, 'live')
    assert.deepEqual(models.map(model => model.id), ['Noelle'])
    assert.equal(models[0].names.zh, 'Noelle')
    assert.equal(standingArtUrl('Noelle'), undefined)
  })
}

test('snapshot sync is additive, idempotent and retains upstream files and curated data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ba-catalog-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const paths = ['src/data/fallbackCatalog.ts', 'src/i18n/studentNames.ts', 'src/i18n/schools.ts', 'src/data/standingArt.ts']
  for (const path of paths) {
    await mkdir(join(dir, dirname(path)), { recursive: true })
    await cp(new URL('../' + path, import.meta.url), join(dir, path))
  }
  const original = await Promise.all(paths.map(path => readFile(join(dir, path), 'utf8')))
  const newStudent = character('Noelle', '', 'Bunny Girl / Cut-in', 'Dress')
  newStudent.models[1].file = 'custom/bonus.glb'
  newStudent.models[1].label = 'Special illustration'
  const catalog = wiki(character('Ichika', 'Swimsuit'), character('Hina', 'New alt'), newStudent, character('No Match', ''))
  // Wiki can move hosts. Keep the snapshot base for all existing entries.
  catalog.base = 'https://new.example/catalog/'
  const students = structuredClone(sample)
  feeds(t, catalog, students)
  assert.equal(await syncCatalog(dir), true)
  const updated = await Promise.all(paths.map(path => readFile(join(dir, path), 'utf8')))
  assert.match(updated[0], /"Noelle": \[.*"file":"https:\/\/new.example\/catalog\/custom\/bonus.glb"/)
  assert.match(updated[0], /"label":"Special illustration"/)
  const hinaEntries = source => JSON.parse(source.match(/^  "Hina": (\[.*\]),?$/m)[1])
  const newEntries = hinaEntries(updated[0])
  assert.deepEqual(newEntries.slice(0, -1), hinaEntries(original[0]))
  assert.equal(newEntries.at(-1).id, 'Hina (New alt)')
  assert.match(updated[0], /"No Match": \[/)
  assert.match(updated[1], /"Noelle": localized\("诺艾尔", "ノエル", "노엘", "Noelle"\)/)
  assert.match(updated[2], /"Noelle": "wildhunt"/)
  assert.match(updated[3], /"Noelle \(Bunny Girl\) \(Cut-in\)": 998/)
  assert.match(updated[3], /"Noelle": \[50, -10, 420\]/)
  assert.match(updated[3], /"Noelle \(Dress\)": 997, \/\/ using base student portrait/)
  for (const i of [1, 2, 3])
    assert.equal(updated[i].split('\n').filter(line => !line.includes('"Noelle')).join('\n'), original[i])
  assert.equal(await syncCatalog(dir), false)
  assert.deepEqual(await Promise.all(paths.map(path => readFile(join(dir, path), 'utf8'))), updated)
  students.en.push({ Id: 999, Name: 'Noelle (Dress)', School: 'WildHunt' })
  assert.equal(await syncCatalog(dir), true)
  const upgraded = await readFile(join(dir, paths[3]), 'utf8')
  assert.match(upgraded, /"Noelle \(Dress\)": 999,\n/)
  assert.equal(await syncCatalog(dir), false)
  students.jp = new Error('offline')
  await assert.rejects(syncCatalog(dir), /offline/)
  assert.equal(await readFile(join(dir, paths[3]), 'utf8'), upgraded)
})
