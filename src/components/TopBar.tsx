import { ArrowLeftRight, Download, Moon, Plus, Sun, X } from 'lucide-react'
import { languages, type Language } from '../i18n'
import { useStudioStore, useText } from '../store/useStudioStore'
import { IconButton, useModelLabel } from './shared'
import { startExport } from '../store/exportSession'

const langLabels: Record<Language, string> = { zh: '中', ja: '日', ko: '한', en: 'EN' }
const fullNames = { zh: '简体中文', ja: '日本語', ko: '한국어', en: 'English' }
export function TopBar() {
  const t = useText(),
    ui = useStudioStore((s) => s.ui),
    setUI = useStudioStore((s) => s.updateUI)
  const wiki = useStudioStore((s) => s.wiki),
    count = useStudioStore((s) => s.models.length)
  const theme = useStudioStore((s) => s.theme),
    language = useStudioStore((s) => s.language)
  const actions = useStudioStore.getState()
  const label = useModelLabel()
  const slots = useStudioStore((s) => s.slots)
  const activeId = useStudioStore((s) => s.activeId)
  const wikiLabel = t(wiki === 'live' ? 'wikiLive' : wiki === 'offline' ? 'snapshot' : 'connecting')
  return (
    <header className="topbar glass">
      <div className="topbar-brand">
        <div className="brand">
          <img src={import.meta.env.BASE_URL + 'halo.svg'} alt="" />
          <h1>
            KIVOTOS <b>RIG</b>
            <small>STUDIO</small>
          </h1>
        </div>
        <span className={'wiki-badge ' + wiki} title={wikiLabel}>
          <i />
          <span>{wikiLabel}</span>
          <b>{count}</b>
        </span>
      </div>
      <div className="slot-controls" role="group" aria-label={t('activeSlot')}>
        <div className="slot-pills">
          {slots.map((slot) => {
            const actor = label(slot.actor)
            const pair = actor + ' ← ' + label(slot.motion)
            return (
              <button
                key={slot.id}
                className="slot-pill"
                aria-pressed={slot.id === activeId}
                aria-label={t('slot') + ' ' + slot.id + ' · ' + pair}
                title={pair}
                onClick={() => actions.focusSlot(slot.id)}
              >
                {slots.length === 1 ? <i /> : <b>{slot.id}</b>}
                <span>{slots.length === 1 ? pair : actor}</span>
              </button>
            )
          })}
        </div>
        <IconButton label={t('swap')} onClick={actions.swap}>
          <ArrowLeftRight size={15} />
        </IconButton>
        <IconButton label={t('addSlot')} disabled={slots.length >= 4} onClick={actions.addSlot}>
          <Plus size={15} />
        </IconButton>
        {slots.length > 1 && (
          <IconButton label={t('removeSlot')} onClick={() => actions.removeSlot(activeId)}>
            <X size={14} />
          </IconButton>
        )}
      </div>
      <div className="topbar-actions">
        <div className="languages" aria-label={t('language')}>
          {languages.map((lang) => (
            <button
              key={lang}
              lang={lang}
              title={fullNames[lang]}
              aria-label={fullNames[lang]}
              aria-pressed={language === lang}
              onClick={() => actions.setLanguage(lang)}
            >
              {langLabels[lang]}
            </button>
          ))}
        </div>
        <IconButton label={t(theme === 'light' ? 'dark' : 'light')} onClick={actions.toggleTheme}>
          {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
        </IconButton>
        <button
          className="primary export-button"
          aria-label={t('exportGif')}
          title={t('exportGif')}
          onClick={() => {
            if (ui.rightOpen && ui.right === 'export') {
              void startExport('gif')
              return
            }
            setUI({
              rightOpen: true,
              right: 'export',
              ...(window.innerWidth <= 900 ? { leftOpen: false } : {}),
            })
          }}
        >
          <Download size={16} />
          <span>{t('exportGif')}</span>
        </button>
      </div>
    </header>
  )
}
