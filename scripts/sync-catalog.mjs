import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expandSnapshotModel, fetchSchaleMatcher, fetchWikiData } from '../src/services/catalogFeeds.js'

const basePortraitComment = '// using base student portrait'
const root = fileURLToPath(new URL('../', import.meta.url))
const files = ['src/data/fallbackCatalog.ts', 'src/i18n/studentNames.ts', 'src/i18n/schools.ts', 'src/data/standingArt.ts']

// Each curated table stores one quoted key per line. Only edit rows explicitly set below.
// Leave existing whitespace, comments, Wiki image overrides and frame values intact.
function sourceTable(source, name) {
  const block = new RegExp(`(const ${name}\\b[^\\n]* = \\{\\n)([\\s\\S]*?)(?=^\\})`, 'm')
  const body = source.match(block)?.[2]
  if (body === undefined) throw new Error('Missing source table: ' + name)
  const rows = new Map()
  const lines = body.split('\n')
  for (const [index, line] of lines.entries()) {
    if (!line.trim() || line.trimStart().startsWith('//')) continue
    const entry = line.match(/^(\s*("(?:\\.|[^"\\])*"):\s*)("(?:\\.|[^"\\])*"|\[.*\]|localized\(.*\)|\d+)(,?\s*(?:\/\/.*)?)$/)
    if (!entry) throw new Error('Unrecognized row in ' + name + ': ' + line)
    rows.set(JSON.parse(entry[2]), { index, prefix: entry[1], value: entry[3], suffix: entry[4] })
  }
  const additions = new Map()
  return {
    get(key) { return additions.get(key)?.value ?? rows.get(key)?.value },
    suffix(key) { return rows.get(key)?.suffix ?? '' },
    set(key, value, comment) {
      const row = rows.get(key)
      if (!row) additions.set(key, { value, comment })
      else {
        row.value = value
        if (comment !== undefined) row.suffix = comment ? ', ' + comment : ','
        lines[row.index] = row.prefix + value + row.suffix
      }
    },
    render(text) {
      const inserted = [...additions].map(([key, { value, comment }]) =>
        `  ${JSON.stringify(key)}: ${value},${comment ? ' ' + comment : ''}\n`).join('')
      return text.replace(block, (_, header) => header + inserted + lines.join('\n'))
    },
  }
}

export async function syncCatalog(directory = root) {
  const [wiki, match, sources] = await Promise.all([
    fetchWikiData(), fetchSchaleMatcher(),
    Promise.all(files.map(file => readFile(join(directory, file), 'utf8'))),
  ])
  const [catalog, names, schools, art] = sources
  const skins = sourceTable(catalog, 'skins')
  const studentNames = sourceTable(names, 'studentNames')
  const studentSchools = sourceTable(schools, 'studentSchools')
  const schaleIds = sourceTable(art, 'schaledbIds')
  const wikiUrls = sourceTable(art, 'wikiUrls')
  const frames = sourceTable(art, 'standingArtFrames')
  const base = JSON.parse(catalog.match(/^  base: (".*"),$/m)[1])
  let modelsAdded = 0
  let portraitsUpdated = 0
  const unmatched = []

  for (const { name, models } of wiki.characters) {
    const entries = JSON.parse(skins.get(name) ?? '[]')
    const ids = new Set(entries.map(entry => expandSnapshotModel(name, entry).id))
    for (const { id, skin, label, file } of models) {
      if (!ids.has(id)) {
        const standard = expandSnapshotModel(name, skin)
        const url = new URL(file, wiki.base).href
        const conventional = id === standard.id && label === standard.label && url === new URL(standard.file, base).href
        entries.push(conventional ? skin : { id, label, skin, file: wiki.base === base ? file : url })
        skins.set(name, JSON.stringify(entries))
        modelsAdded++
      }

      const hasArt = schaleIds.get(id) !== undefined || wikiUrls.get(id) !== undefined
      const provisional = schaleIds.suffix(id).trim() === ', ' + basePortraitComment
      if (hasArt && !provisional && frames.get(id) && studentNames.get(name) && studentSchools.get(name)) continue
      const student = match({ id, skin, student: name })
      if (student) {
        if (!studentNames.get(name)) {
          const { zh, ja, ko, en } = student.names
          studentNames.set(name, 'localized(' + [zh, ja, ko, en].map(s => JSON.stringify(s)).join(', ') + ')')
        }
        if (!studentSchools.get(name) || studentSchools.get(name) === '"other"')
          studentSchools.set(name, JSON.stringify(student.school))
        if (!hasArt || (provisional && !student.baseFallback)) {
          schaleIds.set(id, String(student.id), student.baseFallback ? basePortraitComment : '')
          portraitsUpdated++
        }
      } else if (!hasArt) unmatched.push(id)
      if ((hasArt || student) && !frames.get(id)) frames.set(id, '[50, -10, 420]')
    }
  }

  const updated = [skins.render(catalog), studentNames.render(names), studentSchools.render(schools),
    frames.render(schaleIds.render(art))]
  let changed = false
  for (const [i, content] of updated.entries()) {
    if (content === sources[i]) continue
    const path = join(directory, files[i])
    const temporary = path + '.' + process.pid + '.tmp'
    await writeFile(temporary, content)
    await rename(temporary, path)
    changed = true
  }
  console.log(`Added ${modelsAdded} model(s), updated ${portraitsUpdated} portrait(s).`)
  if (unmatched.length) console.log('Awaiting SchaleDB portraits: ' + unmatched.join(', '))
  console.log('CHANGED=' + changed)
  return changed
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncCatalog().catch(error => {
    console.error('Catalog sync failed:', error.cause?.message ?? error.message)
    process.exitCode = 1
  })
}
