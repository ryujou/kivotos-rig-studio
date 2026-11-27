import { fallbackCatalog } from '../data/fallbackCatalog'
import { propModelIds } from '../data/propModels'
import { searchAliases, studentNames, type StudentName } from '../i18n/studentNames'
import { variantNames } from '../i18n/variants'
import { languages, localized, type Language, type Localized } from '../i18n/types'

interface WikiModel {
  id: string
  label: string
  skin: string
  file: string
}
export interface WikiCatalogData {
  base: string
  characters: { name: string; models: WikiModel[] }[]
}
export interface CatalogModel extends WikiModel {
  student: string
  names: Localized
  tags: string[]
  url: string
  search: string
  hasProps: boolean
}

const endpoint =
  'https://bluearchive.wiki/w/api.php?action=query&prop=revisions&titles=Module:ModelViewer/data.json&rvslots=main&rvprop=content&format=json&origin=*'
export const normalizeSearch = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
export function variantLabel(tag: string, lang: Language) {
  return variantNames[tag]?.[lang] ?? tag
}
export function modelLabel(model: CatalogModel, lang: Language) {
  return (
    model.names[lang] +
    (model.skin ? ' (' + model.tags.map((tag) => variantLabel(tag, lang)).join(' / ') + ')' : '')
  )
}

function enrich(data: WikiCatalogData): CatalogModel[] {
  const seen = new Set<string>()
  const models: CatalogModel[] = []
  for (const { name, models: entries } of data.characters) {
    if (typeof name !== 'string' || !Array.isArray(entries)) throw new Error('invalid_character')
    const key = name as StudentName
    const names = Object.hasOwn(studentNames, name) ? studentNames[key] : localized(name, name, name, name)
    for (const entry of entries) {
      if (
        ![entry.id, entry.label, entry.file, entry.skin].every((v) => typeof v === 'string') ||
        !entry.id ||
        !entry.file ||
        seen.has(entry.id)
      )
        throw new Error('invalid_model')
      const tags = entry.skin ? entry.skin.split(/\s*\/\s*/) : ['Default']
      const url = new URL(entry.file, data.base)
      if (url.protocol !== 'https:') throw new Error('invalid_url')
      const words = [name, entry.id, entry.label, ...Object.values(names), searchAliases[key] ?? '']
      for (const tag of tags) {
        words.push(tag, ...languages.map((lang) => variantLabel(tag, lang)))
        if (tag === 'Riding' || tag === 'Kid')
          words.push(...Object.values(variantNames[tag === 'Riding' ? 'Cycling' : 'Small']))
      }
      models.push({
        ...entry,
        student: name,
        names,
        tags,
        url: url.href,
        search: normalizeSearch(words.join(' ')),
        hasProps: propModelIds.has(entry.id) || tags.includes('Carrier'),
      })
      seen.add(entry.id)
    }
  }
  if (!models.length) throw new Error('empty_catalog')
  return models
}

export const snapshotModels = enrich(fallbackCatalog)
export async function loadWikiCatalog(): Promise<{ models: CatalogModel[]; status: 'live' | 'offline' }> {
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(9000), cache: 'no-cache' })
    if (!res.ok) throw new Error('wiki_http')
    const payload: {
      query?: { pages?: Record<string, { revisions?: { slots?: { main?: { '*'?: string } } }[] }> }
    } = await res.json()
    const content = Object.values(payload.query?.pages ?? {})[0]?.revisions?.[0]?.slots?.main?.['*']
    if (typeof content !== 'string') throw new Error('missing_revision')
    const data = JSON.parse(content) as WikiCatalogData
    if (typeof data.base !== 'string' || !Array.isArray(data.characters)) throw new Error('invalid_catalog')
    return { models: enrich(data), status: 'live' }
  } catch {
    return { models: snapshotModels, status: 'offline' }
  }
}
