import { searchAliases, type StudentName } from '../i18n/studentNames'
import { schoolNames, type School } from '../i18n/schools'
import { variantNames } from '../i18n/variants'
import { languages, type Language } from '../i18n/types'
import type { CatalogModel } from './wikiCatalog'

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

export function extraOutfitTags(models: CatalogModel[], featured: readonly string[]) {
  const tags = new Set(models.flatMap((model) => model.tags))
  return [...tags].filter((tag) => !featured.includes(tag) && !/^\d+$/.test(tag))
}

export function filterCharacters(models: CatalogModel[], query: string, school: School | 'all', tag: string) {
  const terms = normalizeSearch(query).split(' ').filter(Boolean)
  return models.filter(
    (model) =>
      (school === 'all' || model.school === school) &&
      (tag === 'all' || (tag === 'hasProps' ? model.hasProps : model.tags.includes(tag))) &&
      terms.every((term) => model.search.includes(term)),
  )
}

export function modelSearch({ student, id, label, names, school, tags }: Omit<CatalogModel, 'search'>) {
  const words = [
    student,
    id,
    label,
    ...Object.values(names),
    ...Object.values(schoolNames[school]),
    Object.hasOwn(searchAliases, student) ? searchAliases[student as StudentName] : '',
  ]
  for (const tag of tags) {
    words.push(tag, ...languages.map((lang) => variantLabel(tag, lang)))
    if (tag === 'Riding' || tag === 'Kid')
      words.push(...Object.values(variantNames[tag === 'Riding' ? 'Cycling' : 'Small']))
  }
  return normalizeSearch(words.join(' '))
}
