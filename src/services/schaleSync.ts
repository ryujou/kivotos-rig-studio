import { hasStaticStandingArt, registerDynamicStandingArt } from '../data/standingArt'
import { studentSchools } from '../i18n/schools'
import { studentNames } from '../i18n/studentNames'
import { fetchSchaleMatcher } from './catalogFeeds.js'
import { modelSearch } from './catalogSearch'
import type { CatalogModel } from './wikiCatalog'

export async function enrichWithSchaleDb(models: CatalogModel[]): Promise<CatalogModel[]> {
  const missing = models.filter(model =>
    !hasStaticStandingArt(model.id) ||
    !Object.hasOwn(studentNames, model.student) ||
    !Object.hasOwn(studentSchools, model.student),
  )
  if (!missing.length) return models

  // The Wiki catalog remains usable when any of the four optional feeds is unavailable.
  const match = await fetchSchaleMatcher().catch(() => undefined)
  if (!match) return models
  for (const model of missing) {
    const student = match(model)
    if (!student) continue
    if (!hasStaticStandingArt(model.id))
      registerDynamicStandingArt(model.id, `https://schaledb.com/images/student/portrait/${student.id}.webp`)
    if (!Object.hasOwn(studentNames, model.student)) model.names = student.names
    if (model.school === 'other' || !Object.hasOwn(studentSchools, model.student)) model.school = student.school
    model.search = modelSearch(model)
  }
  return models
}
