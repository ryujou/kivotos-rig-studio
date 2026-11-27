// In a fresh Vite dev tab at 1440 × 900, run in the browser console:
// await (await import('./tests/browser-layout.mjs')).checkStudioLayout()
export async function checkStudioLayout() {
  const one = (selector) => document.querySelector(selector)
  const all = (selector) => [...document.querySelectorAll(selector)]
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
  async function click(el) {
    el.click()
    await tick()
  }
  async function toggle(target) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }))
    await tick()
  }
  function check(ok, message) {
    if (!ok) throw Error(message)
  }

  check(innerWidth === 1440 && innerHeight === 900, 'Set the viewport to 1440 × 900')
  const pages = []
  for (const theme of ['light', 'dark']) {
    if (document.documentElement.dataset.theme !== theme) await click(one('.topbar-actions > .icon-button'))
    check(document.documentElement.dataset.theme === theme, 'Theme toggle')
    for (const lang of ['zh', 'ja', 'ko', 'en']) {
      await click(one('.languages [lang="' + lang + '"]'))
      check(document.documentElement.lang === lang, 'Language switch: ' + lang)
      const filter = one('.browser-controls input')
      await toggle(filter)
      check(!one('.guide-modal'), 'Search field consumed the guide shortcut')
      await toggle(document.body)
      for (let step = 0; step < 4; step++) {
        await click(all('.guide-tabs button')[step])
        await one('.guide-stage img').decode()
        await document.fonts?.ready
        const body = one('.guide-body')
        const clearance =
          body.getBoundingClientRect().bottom - one('.guide-shortcuts').getBoundingClientRect().bottom
        check(
          body.scrollHeight <= body.clientHeight + 1 && clearance >= 0,
          'Clipped guide: ' + [theme, lang, step + 1],
        )
        check(all('.guide-highlight').length === all('.guide-arrow-line').length, 'Missing guide arrow')
        check(!!one('.guide-footer .primary svg') === step < 3, 'Final step chevron')
        pages.push({ theme, lang, step: step + 1, clearance })
      }
      await toggle(one('.guide-body'))
      check(!one('.guide-modal'), 'Cannot close guide with ?')
      const row = one('.clip-chips')
      const rect = row.getBoundingClientRect()
      for (const chip of row.children) {
        const box = chip.getBoundingClientRect()
        check(
          box.left >= rect.left - 1 && box.right <= rect.right + 1 && box.bottom <= rect.bottom + 1,
          'Clipped clip chip: ' + chip.textContent,
        )
      }
      await click(one('.more-filter'))
      check(!all('.extra-tags button').some((chip) => /^\d+$/.test(chip.textContent)), 'Numeric outfit chip')
      await click(one('.more-filter'))
    }
    await click(all('.library-panel .panel-tabs button')[2])
    await click(one('.work-scroll .disclosure > summary'))
    const buttons = all('.work-scroll .quiet-button').filter(
      (button) => button.getBoundingClientRect().height > 0,
    )
    check(buttons.length >= 2, 'Missing donor buttons')
    for (const button of buttons) {
      const style = getComputedStyle(button)
      check(
        style.borderTopWidth === '1px' && style.backgroundColor !== 'rgba(0, 0, 0, 0)',
        'Unstyled donor button',
      )
    }
    await click(all('.library-panel .panel-tabs button')[0])
    const list = one('.bone-list')
    list.closest('details').open = true
    // Allow this typography check to run even in an offline tab with an empty rig.
    let probe
    if (!list.querySelector('button')) {
      probe = document.createElement('button')
      probe.innerHTML = '<span>Bip001_Spine</span><small>← Bip001_Spine</small>'
      list.append(probe)
    }
    try {
      for (const button of list.querySelectorAll('button')) {
        const box = button.getBoundingClientRect()
        const line = button.querySelector('small')
        check(
          box.height >= 36 &&
            line.getBoundingClientRect().bottom <= box.bottom &&
            line.scrollHeight <= line.clientHeight + 1,
          'Clipped bone subline',
        )
      }
    } finally {
      probe?.remove()
    }
  }
  return pages
}
