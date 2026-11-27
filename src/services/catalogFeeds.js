// @ts-check
// Shared by the browser and the dependency-free Node snapshot sync.
/** @typedef {import('./wikiCatalog').WikiCatalogData} WikiCatalogData */
/** @typedef {WikiCatalogData['characters'][number]['models'][number]} WikiModel */
/** @typedef {{name: string, id: number, school: string}} Student */
const wikiEndpoint = 'https://bluearchive.wiki/w/api.php?action=query&prop=revisions&titles=Module:ModelViewer/data.json&rvslots=main&rvprop=content&format=json&origin=*'

/** @param {string} url @param {AbortSignal} signal */
async function fetchJson(url, signal) {
  const response = await fetch(url, { signal, cache: 'no-cache' })
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`)
  return response.json()
}

/** @returns {Promise<WikiCatalogData>} */
export async function fetchWikiData() {
  const payload = await fetchJson(wikiEndpoint, AbortSignal.timeout(9000))
  const page = Object.values(payload.query?.pages ?? {})[0]
  const data = JSON.parse(page?.revisions?.[0]?.slots?.main?.['*'])
  if (typeof data?.base !== 'string' || !Array.isArray(data.characters)) throw new Error('invalid_catalog')
  const seen = new Set()
  for (const { name, models } of data.characters) {
    if (typeof name !== 'string' || !name || !Array.isArray(models)) throw new Error('invalid_character')
    for (const { id, label, file, skin } of models) {
      if (![id, label, file, skin].every(v => typeof v === 'string') || !id || !file || seen.has(id))
        throw new Error('invalid_model')
      if (new URL(file, data.base).protocol !== 'https:') throw new Error('invalid_url')
      seen.add(id)
    }
  }
  if (!seen.size) throw new Error('empty_catalog')
  return data
}

/** @param {string} student @param {string | WikiModel} entry @returns {WikiModel} */
export function expandSnapshotModel(student, entry) {
  if (typeof entry !== 'string') return entry
  const id = student + entry.split(' / ').filter(Boolean).map(tag => ' (' + tag + ')').join('')
  const file = encodeURIComponent(id).replaceAll('(', '%28').replaceAll(')', '%29') + '.glb'
  return { id, label: id, skin: entry, file }
}

/** @type {Readonly<Record<string, import('../i18n/schools').School>>} */
const schools = {
  Abydos: 'abydos', Gehenna: 'gehenna', Millennium: 'millennium', Trinity: 'trinity',
  Hyakkiyako: 'hyakkiyako', Shanhaijing: 'shanhaijing', RedWinter: 'redWinter', Valkyrie: 'valkyrie',
  Arius: 'arius', SRT: 'srt', Highlander: 'highlander', WildHunt: 'wildhunt',
  Tokiwadai: 'tokiwadai', Sakugawa: 'sakugawa',
}

/** @param {string} value */
const key = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** @param {string} name */
const baseName = name => name.replace(/(?:\s*(?:\([^()]*\)|（[^（）]*）))+\s*$/u, '').trim()

const variants = new Map(Object.entries({
  bunnygirl: 'bunny', riding: 'cycling', kid: 'small', hotspring: 'onsen',
  battle: 'armed', schooluniform: 'uniform', parttimer: 'parttime',
}))
const secondary = /^(?:carrier2?|scenario[12]?|cutin|special|noweapon|cafe|[12])$/

/** @param {string} name @param {boolean} [wikiSuffixes] */
function modelKey(name, wikiSuffixes = false) {
  const english = name.normalize('NFKC').replace(/^Arisu(?=\s|\(|$)/i, 'Aris')
  return key(english.replace(/\(([^()]*)\)/g, (_, tag) => {
    const variant = key(tag)
    return wikiSuffixes && secondary.test(variant) ? '' : variants.get(variant) ?? variant
  }))
}

/** @param {string} locale @param {AbortSignal} signal @returns {Promise<Map<number, Student>>} */
async function fetchStudents(locale, signal) {
  const data = await fetchJson(`https://schaledb.com/data/${locale}/students.min.json`, signal)
  const students = new Map()
  for (const [index, row] of Object.entries(data)) {
    const id = Number(row?.Id ?? (Array.isArray(data) ? undefined : index))
    if (Number.isSafeInteger(id) && id > 0 && typeof row?.Name === 'string' && row.Name.trim())
      students.set(id, { id, name: row.Name.trim(), school: row.School })
  }
  if (!students.size) throw new Error('empty_students_' + locale)
  return students
}

export async function fetchSchaleMatcher() {
  const signal = AbortSignal.timeout(10_000)
  const [en, cn, jp, kr] = await Promise.all(['en', 'cn', 'jp', 'kr'].map(lang => fetchStudents(lang, signal)))
  /** @type {Map<string, Student>} */
  const byName = new Map()
  for (const student of en.values()) byName.set(modelKey(student.name), student)

  /** @param {{id: string, student: string, skin: string}} model */
  return function match(model) {
    const primary = model.skin.split(/\s*\/\s*/).filter(tag => tag && !secondary.test(key(tag)))
    const candidate = model.student + primary.map(tag => ' (' + tag + ')').join('')
    const baseKey = modelKey(model.student)
    const variantKey = modelKey(candidate)
    const row = byName.get(modelKey(model.id, true)) ?? byName.get(variantKey) ?? byName.get(baseKey)
    if (!row) return
    const english = baseName(row.name)
    const baseId = byName.get(modelKey(english))?.id ?? row.id
    /** @param {Map<number, Student>} rows */
    const name = rows => baseName(rows.get(row.id)?.name ?? rows.get(baseId)?.name ?? english)
    return {
      id: row.id,
      baseFallback: modelKey(row.name) === baseKey && variantKey !== baseKey,
      names: { zh: name(cn), ja: name(jp), ko: name(kr), en: english },
      school: Object.hasOwn(schools, row.school) ? schools[row.school] : 'other',
    }
  }
}
