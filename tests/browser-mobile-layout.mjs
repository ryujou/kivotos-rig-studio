// In a fresh studio dev tab at 360×800 or 390×844:
// await (await import('./tests/browser-mobile-layout.mjs')).checkMobileLayout()
export async function checkMobileLayout() {
  const one = selector => document.querySelector(selector)
  const all = selector => [...document.querySelectorAll(selector)]
  const tick = () => new Promise(resolve => setTimeout(resolve, 16))
  const box = el => el.getBoundingClientRect()
  const visible = el => box(el).width > 0
  const check = (ok, message) => { if (!ok) throw Error(message + ' at ' + innerWidth + 'px') }
  async function click(el) {
    el.click()
    await tick()
  }
  async function select(el, value) {
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
  }
  function checkRow(parent, elements, minSize = 0) {
    const outer = box(parent)
    let last = outer.left
    for (const element of elements.filter(visible)) {
      const r = box(element)
      check(r.left >= last - 1 && r.right <= outer.right + 1, 'Horizontal overlap: ' + element.outerHTML.slice(0, 110))
      check(r.top < outer.top + outer.height / 2 && r.bottom > outer.top + outer.height / 2, 'Wrapped control')
      check(r.width >= minSize && r.height >= minSize, `Small touch target ${element.tagName}.${element.className} ${r.width}×${r.height}`)
      last = r.right
    }
  }

  check(innerWidth <= 640, 'Use a phone viewport')
  check(!visible(one('.viewport-label')), 'Viewport label overlaps reopen controls')
  const topbar = one('.topbar')
  const controls = () => all('.brand img, .slot-controls button, .slot-controls select, .topbar-actions button, .mobile-lang-select select')
  const lang = one('.mobile-lang-select select')
  check(lang.options.length === 4 && !visible(one('.languages')), 'Language picker')
  checkRow(topbar, controls())
  checkRow(topbar, controls().filter(el => el.tagName !== 'IMG'), 32)
  for (let slots = 2; slots <= 4; slots++) {
    await click(all('.slot-controls > .icon-button')[1])
    const slot = one('.mobile-slot-select select')
    check(slot.options.length === slots, 'Slot count')
    checkRow(topbar, controls().filter(el => el.tagName !== 'IMG'), 32)
  }
  await select(one('.mobile-slot-select select'), '1')
  check(one('.mobile-slot-select .select-value').textContent === '1', 'Active slot')
  const theme = () => document.documentElement.dataset.theme
  let guides = 0
  for (const mode of ['light', 'dark']) {
    if (theme() !== mode) await click(one('.topbar-actions > .icon-button'))
    check(theme() === mode, 'Theme change')
    for (const language of ['zh', 'ja', 'ko', 'en']) {
      await select(lang, language)
      check(document.documentElement.lang === language, 'Language change')
      checkRow(topbar, controls().filter(el => el.tagName !== 'IMG'), 32)
      checkRow(one('.transport'), [...one('.transport').children])
      await click(one('.guide-trigger'))
      for (let step = 0; step < 4; step++) {
        await click(all('.guide-tabs button')[step])
        const modal = one('.guide-modal'), body = one('.guide-body')
        checkRow(one('.guide-tabs'), all('.guide-tabs button'))
        check(box(modal).left >= 0 && box(modal).right <= innerWidth && box(modal).height <= innerHeight - 15, 'Guide bounds')
        check(body.scrollWidth <= body.clientWidth + 1 && box(one('.guide-shortcuts')).right <= box(modal).right, 'Guide overflow')
        guides++
      }
      await click(one('.guide-header .icon-button'))
    }
  }
  await click(one('.reopen.left'))
  const panel = one('.library-panel')
  check(visible(one('.drawer-scrim')) && !one('.inspector-panel'), 'Library/scrim state')
  check(box(panel).width === Math.min(344, innerWidth - 16) && box(panel).bottom < box(one('.timeline')).top, 'Library bounds')
  check(getComputedStyle(one('.search-field input')).fontSize === '16px', 'Search field zoom')
  for (const side of ['right', 'left']) {
    const switcher = one('.reopen.' + side)
    check(!visible(switcher), 'Opposite reopen visible with drawer open')
    await click(one('.drawer-scrim'))
    const b = box(switcher)
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    check(hit?.closest('.reopen') === switcher, 'Reopen covered after drawer dismissal')
    await click(switcher)
    check(all('.panel').length === 1, 'Overlapping drawers')
  }
  await click(one('.export-button'))
  check(one('.inspector-panel') && !one('.library-panel'), 'Export drawer exclusivity')
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
  await tick()
  check(one('.library-panel') && !one('.inspector-panel'), 'Search shortcut exclusivity')
  const r = box(one('.library-panel'))
  const outside = document.elementFromPoint((innerWidth + r.right) / 2, r.top + r.height / 2)
  check(outside?.matches('.drawer-scrim'), 'Outside tap hit target')
  await click(outside)
  check(!one('.panel') && !one('.drawer-scrim'), 'Tap outside closes drawers')
  for (const button of all('.reopen')) check(box(button).width === 38 && box(button).height === 38, 'Reopen target')
  for (const [selector, width, height] of [['.trim-handle', 12, 20], ['.playhead', 15, 15]]) {
    const thumb = one(selector)
    check(box(thumb).width === width && box(thumb).height === height, 'Slider size')
    check(getComputedStyle(thumb, '::before').left === '-10px', 'Slider hit area')
    for (const handle of all(selector)) {
      const r = box(handle), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      check(hit === handle, 'Slider obscured: ' + handle.dataset.thumb)
    }
  }
  check(document.documentElement.scrollWidth === innerWidth, 'Page overflow')
  return { width: innerWidth, height: innerHeight, guides }
}
