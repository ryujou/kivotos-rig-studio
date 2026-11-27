import test from 'node:test'
import assert from 'node:assert/strict'
import { messages, languages, translate } from '../src/i18n/index.ts'
import { meshLabel } from '../src/i18n/meshLabels.ts'
import { schoolNames, schoolLabels } from '../src/i18n/schools.ts'
import { studentNames } from '../src/i18n/studentNames.ts'
import { variantNames } from '../src/i18n/variants.ts'
import { jointCombos } from '../src/data/jointCombos.ts'
import { standingArtUrl, standingArtFrame, standingArtFrames } from '../src/data/standingArt.ts'
import { snapshotModels } from '../src/services/wikiCatalog.ts'
import { portraitIndex, portraitRows, portraitColumns } from '../src/data/portraits.ts'

test('i18n messages and mesh labels cover the four supported languages', () => {
  assert.deepEqual([...languages].sort(), ['en', 'ja', 'ko', 'zh'])
  for (const key of Object.keys(messages)) {
    for (const lang of languages) {
      assert.ok(translate(lang, key).trim().length > 0, `Empty translation ${lang}.${key}`)
    }
  }
  const t = (k) => translate('zh', k)
  for (const table of [schoolNames, schoolLabels, studentNames, variantNames]) {
    for (const [name, labels] of Object.entries(table))
      for (const lang of languages) assert.ok(labels[lang]?.trim(), name + '.' + lang)
  }
  for (const combo of jointCombos)
    for (const lang of languages) assert.ok(combo.title[lang]?.trim(), combo.id + '.' + lang)
  assert.ok(meshLabel('CH0001_Guitar', 0, t).length > 0)
  assert.ok(meshLabel('CH0001_Tank', 0, t).length > 0)
  assert.ok(meshLabel('UnknownPart', 2, t).includes('3'))
})

test('original portraits stay covered and every catalog portrait has an HTTPS URL and finite frame', () => {
  const modelsWithArt = snapshotModels.filter(m => standingArtUrl(m.id))
  const ids = modelsWithArt.map(m => m.id)
  for (const id of [...Object.keys(portraitIndex), 'Material Development Club Member'])
    assert.ok(ids.includes(id), id)
  assert.ok(ids.length >= 289)
  assert.deepEqual(Object.keys(standingArtFrames).sort(), ids.sort())
  assert.deepEqual(standingArtFrame('unknown'), [50, -8, 380])
  assert.equal(standingArtUrl('unknown'), undefined)
  for (const { id } of modelsWithArt) {
    assert.equal(new URL(standingArtUrl(id)).protocol, 'https:', id)
    const frame = standingArtFrame(id)
    assert.equal(frame.length, 3, id)
    assert.ok(frame.every(Number.isFinite) && frame[2] > 0, id)
  }
  for (const index of Object.values(portraitIndex)) {
    assert.ok(Number.isInteger(index) && index >= 0 && index < portraitRows * portraitColumns)
  }
  assert.deepEqual(standingArtFrame('Ichika (Swimsuit)'), [51, -27, 480])
  assert.deepEqual(standingArtFrame('Kayoko (Dress)'), [44, -40, 500])
  assert.deepEqual(standingArtFrame('Kotori (Cheerleader)'), [47, -75, 480])
})
