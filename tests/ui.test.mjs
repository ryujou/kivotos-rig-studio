import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GuideDialog, toggleGuideShortcut } from '../src/components/GuideModal.tsx'
import { HaloControls } from '../src/components/PropInspector.tsx'
import { CropOverlay } from '../src/components/CropOverlay.tsx'
import { useStudioStore as store } from '../src/store/useStudioStore.ts'
import { languages, translate } from '../src/i18n/index.ts'
import { extraOutfitTags, filterCharacters, snapshotModels } from '../src/services/wikiCatalog.ts'

test('the guide shortcut toggles inside the guide, and respects editors, modifiers and other open dialogs', () => {
  let otherDialog = false
  globalThis.HTMLElement = class {
    constructor(ancestors) {
      this.ancestors = ancestors
    }
    closest(selectors) {
      return selectors.split(',').some((tag) => this.ancestors.includes(tag.trim()))
    }
  }
  globalThis.document = {
    querySelector(selector) {
      if (selector === 'dialog[open]') return store.getState().ui.guideOpen || otherDialog
      assert.equal(selector, 'dialog[open]:not(.guide-modal)')
      return otherDialog
    },
  }
  function press(target, patch = {}) {
    let consumed = false
    toggleGuideShortcut({
      key: '?',
      target,
      preventDefault() {
        consumed = true
      },
      ...patch,
    })
    return consumed
  }
  const body = new HTMLElement(['body'])
  const guideBody = new HTMLElement(['div', 'dialog', 'body'])
  assert.equal(press(body), true)
  assert.equal(store.getState().ui.guideOpen, true)
  assert.equal(press(guideBody), true)
  assert.equal(store.getState().ui.guideOpen, false)
  for (const tag of ['input', 'textarea', 'select'])
    assert.equal(press(new HTMLElement(['span', tag])), false)
  assert.equal(press(Object.assign(new HTMLElement(['div']), { isContentEditable: true })), false)
  for (const flag of ['repeat', 'isComposing', 'ctrlKey', 'altKey', 'metaKey', 'defaultPrevented'])
    assert.equal(press(body, { [flag]: true }), false)
  otherDialog = true
  assert.equal(press(guideBody), false)
  assert.equal(store.getState().ui.guideOpen, false)
})

test('all localized guide steps render their image, shortcuts, arrows and final action under the deployment base', (t) => {
  // Zustand reads its initial snapshot for React server renders.
  const snapshot = store.getInitialState()
  const original = snapshot.language
  t.after(() => {
    snapshot.language = original
  })
  for (const lang of languages) {
    snapshot.language = lang
    for (let index = 0; index < 4; index++) {
      const html = renderToStaticMarkup(createElement(GuideDialog, { index, setIndex() {} }))
      assert.ok(html.includes('/kivotos-rig-studio/guide/step-' + (index + 1) + '.webp'))
      assert.ok(html.includes('class="guide-shortcuts"'))
      const arrows = html.match(/class="guide-arrow-line"/g) ?? []
      const boxes = html.match(/class="guide-highlight"/g) ?? []
      assert.equal(boxes.length, index === 0 ? 5 : 4)
      assert.equal(arrows.length, boxes.length)
      const footer = html.slice(html.indexOf('<footer'))
      assert.ok(footer.includes(translate(lang, index === 3 ? 'guideDone' : 'guideNext')))
      assert.equal(footer.includes('lucide-chevron-right'), index < 3)
    }
  }
})

test('halo controls render localized modes, donor errors and collapsed fine tuning in every language', (t) => {
  const snapshot = store.getInitialState()
  const { slots, language, runtime } = snapshot
  t.after(() => Object.assign(snapshot, { slots, language, runtime }))
  snapshot.runtime = { 1: { haloDonorError: true } }
  for (const lang of languages) {
    snapshot.language = lang
    for (const source of ['actorA', 'motionB', 'donorC', 'hidden']) {
      snapshot.slots = [{ ...slots[0], halo: { ...slots[0].halo, source } }]
      const html = renderToStaticMarkup(createElement(HaloControls))
      assert.ok(html.includes(translate(lang, 'haloSource')))
      assert.equal((html.match(/aria-pressed=/g) ?? []).length, 4)
      assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1)
      assert.equal(html.includes('role="alert"'), source === 'donorC')
      assert.equal(html.includes(translate(lang, 'haloFailed')), source === 'donorC')
      assert.equal(html.includes('accept=".glb"'), source === 'donorC')
      assert.equal(html.includes('<details class="disclosure grip-offset">'), source !== 'hidden')
      assert.equal((html.match(/type="range"/g) ?? []).length, source === 'hidden' ? 0 : 7)
    }
  }
})

test('a narrow crop overlay has a nonnegative label width', (t) => {
  const snapshot = store.getInitialState()
  const original = snapshot.viewport
  t.after(() => {
    snapshot.viewport = original
  })
  snapshot.viewport = { ...original, safe: { x: 0, y: 0, width: 6, height: 6 } }
  assert.match(renderToStaticMarkup(createElement(CropOverlay)), /max-width:0(?:px)?(?:;|")/)
})

test('outfit chip options omit numeric disambiguators while search keeps both Shun variants', () => {
  const tags = extraOutfitTags(snapshotModels, ['Default'])
  assert.ok(tags.includes('Dress') && !tags.includes('Default'))
  assert.equal(
    tags.some((tag) => /^\d+$/.test(tag)),
    false,
  )
  for (const n of [1, 2]) {
    const matches = filterCharacters(snapshotModels, 'Shun Swimsuit ' + n, 'all', 'all')
    assert.ok(matches.some((model) => model.id === 'Shun (Swimsuit) (' + n + ')'))
  }
})

test('inspector controls and filter rows retain their layout rules', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  const rule = (selector) => {
    const start = css.indexOf('\n' + selector + ' {')
    assert.ok(start !== -1, selector)
    return css.slice(start, css.indexOf('}', start))
  }
  assert.match(rule('.quiet-button'), /background:\s*var\(--control\)/)
  assert.match(rule('.quiet-button'), /border:\s*1px solid var\(--panel-border\)/)
  assert.match(rule('.bone-list'), /display:\s*grid/)
  assert.match(rule('.bone-list button'), /min-height:\s*36px/)
  assert.match(rule('.clip-chips'), /flex-wrap:\s*wrap/)
  assert.match(rule('.scroll-chips'), /24px/)
})
