import { fallbackCatalog } from '../data/fallbackCatalog'
import { propModelIds } from '../data/propModels'
import { studentNames, type StudentName } from '../i18n/studentNames'
import { studentSchools, type School } from '../i18n/schools'
import { localized, type Localized } from '../i18n/types'
import { fetchWikiData } from './catalogFeeds.js'
import { modelSearch } from './catalogSearch'
import { enrichWithSchaleDb } from './schaleSync'
export { normalizeSearch, variantLabel, modelLabel, extraOutfitTags, filterCharacters } from './catalogSearch'

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
  school: School
  student: string
  names: Localized
  tags: string[]
  url: string
  search: string
  hasProps: boolean
}

function catalogModels(data: WikiCatalogData): CatalogModel[] {
  return data.characters.flatMap(({ name, models }) => {
    const key = name as StudentName
    const names = Object.hasOwn(studentNames, name) ? studentNames[key] : localized(name, name, name, name)
    const school = Object.hasOwn(studentSchools, name) ? studentSchools[key] : 'other'
    return models.map(entry => {
      const model = {
        ...entry,
        student: name,
        school,
        names,
        tags: entry.skin ? entry.skin.split(/\s*\/\s*/) : ['Default'],
        url: new URL(entry.file, data.base).href,
        hasProps: propModelIds.has(entry.id),
      }
      return { ...model, search: modelSearch(model) }
    })
  })
}

export const snapshotModels = catalogModels(fallbackCatalog)
export async function loadWikiCatalog(): Promise<{ models: CatalogModel[]; status: 'live' | 'offline' }> {
  try {
    const models = catalogModels(await fetchWikiData())
    return { models: await enrichWithSchaleDb(models), status: 'live' }
  } catch {
    return { models: snapshotModels, status: 'offline' }
  }
}
