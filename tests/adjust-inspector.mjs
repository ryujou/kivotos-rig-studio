import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdjustInspector } from '../src/components/AdjustInspector.tsx'
import { translate } from '../src/i18n/index.ts'
import { useStudioStore } from '../src/store/useStudioStore.ts'

export function assertAdjustInspector(lang, springEnabled) {
  const initial = useStudioStore.getInitialState()
  const { language, slots } = initial
  try {
    initial.language = lang
    initial.slots = slots.map((slot) => slot.id === initial.activeId
      ? { ...slot, rig: { ...slot.rig, spring: { ...slot.rig.spring, enabled: springEnabled } } }
      : slot)
    const html = renderToStaticMarkup(createElement(AdjustInspector))
    const t = (key) => translate(lang, key).replaceAll('&', '&amp;')
    const root = html.split(t('rootMode') + '</h3>')[1].split('</section>')[0]
    const switches = [...root.matchAll(/role="switch"[^>]*><span>([^<]+)<\/span>/g)]
    assert.deepEqual(switches.map((m) => m[1]), ['expressionSync', 'hairPhysics', 'mirror'].map(t))
    assert.equal((root.match(/role="switch"/g) ?? []).length, 3)
    assert.doesNotMatch(root, /role="status"/)
    assert.doesNotMatch(html, /gpu-status/)
    const tuning = html.split('<summary>' + t('rootTuning') + '</summary>')[1].split('</details>')[0]
    assert.ok(tuning.includes('aria-label="' + t('rootOffset') + '"'))
    assert.ok(tuning.includes(t('zeroOffset') + '</button>'))
    const labels = [...tuning.matchAll(/<label[^>]*><span>([^<]+)<\/span><input type="range"/g)]
    const expected = ['X', 'Y', 'Z', t('armSpread')]
    if (springEnabled) expected.push(...['stiffness', 'damping', 'wind'].map(t))
    assert.deepEqual(labels.map((m) => m[1]), expected)
    assert.equal((tuning.match(/type="range"/g) ?? []).length, expected.length)
    assert.doesNotMatch(tuning, /disabled=""/)
    const direction = { zh: '风向', ja: '風向き', ko: '풍향', en: 'Wind direction' }[lang]
    assert.ok(!html.includes(direction))
    return html
  } finally {
    Object.assign(initial, { language, slots })
  }
}
