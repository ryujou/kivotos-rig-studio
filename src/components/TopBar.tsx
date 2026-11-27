import {
  Aperture,
  Bone,
  Box,
  ChevronDown,
  Download,
  Layers3,
  Moon,
  Move3d,
  Sun,
  Shuffle,
  UsersRound,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { languages, type Language } from '../i18n'
import { useStudioStore, useText, type Mode } from '../store/useStudioStore'
import { IconButton, Portrait, useModelLabel } from './shared'
import { showcases, applyShowcase } from '../data/presets'
import { startExport } from '../store/exportSession'
import { cancelJointLoad } from '../services/jointLoader'

const modes = [
  { key: 'solo', icon: Layers3 },
  { key: 'jointVictory', icon: UsersRound },
  { key: 'propMode', icon: Box },
] as const
const langLabels: Record<Language, string> = { zh: '中', ja: '日', ko: '한', en: 'EN' }
const fullNames = { zh: '简体中文', ja: '日本語', ko: '한국어', en: 'English' }
export function TopBar() {
  const t = useText(),
    ui = useStudioStore((s) => s.ui),
    setUI = useStudioStore((s) => s.updateUI)
  const mode = useStudioStore((s) => s.mode),
    setMode = useStudioStore((s) => s.setMode)
  const wiki = useStudioStore((s) => s.wiki),
    count = useStudioStore((s) => s.models.length)
  const theme = useStudioStore((s) => s.theme),
    language = useStudioStore((s) => s.language)
  const actions = useStudioStore.getState(),
    menu = useRef<HTMLDivElement>(null)
  const label = useModelLabel()
  const [pending, setPending] = useState(false),
    [presetError, setPresetError] = useState<'jointFailed' | 'presetUnavailable' | null>(null)
  const request = useRef(0)
  const dismiss = () => {
    request.current++
    if (pending) cancelJointLoad()
    setPending(false)
    setPresetError(null)
    setUI({ presets: false })
  }
  const choose = async (preset: Parameters<typeof applyShowcase>[0]) => {
    const id = ++request.current
    setPending(true)
    setPresetError(null)
    try {
      await applyShowcase(preset)
    } catch {
      if (id === request.current)
        setPresetError(preset !== 'shuffle' && 'combo' in preset ? 'jointFailed' : 'presetUnavailable')
    } finally {
      if (id === request.current) setPending(false)
    }
  }
  useEffect(() => {
    if (!ui.presets) return
    const close = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) dismiss()
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [ui.presets, pending, setUI])
  const wikiLabel = t(wiki === 'live' ? 'wikiLive' : wiki === 'offline' ? 'snapshot' : 'connecting')
  return (
    <header className="topbar glass">
      <div className="brand">
        <img src="./halo.svg" alt="" />
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
      <nav className="modes" aria-label={t('stage')}>
        {modes.map(({ key, icon: Icon }) => (
          <button key={key} title={t(key)} aria-pressed={mode === key} onClick={() => setMode(key as Mode)}>
            <Icon size={15} />
            <span>{t(key)}</span>
          </button>
        ))}
      </nav>
      <div className="command-tools">
        <div className="popover-anchor" ref={menu}>
          <button
            className="presets"
            title={t('presets')}
            aria-expanded={ui.presets}
            onClick={() => (ui.presets ? dismiss() : setUI({ presets: true }))}
          >
            <Aperture size={16} />
            <span>{t('presets')}</span>
            <ChevronDown size={12} />
          </button>
          {ui.presets && (
            <div className="popover glass showcase-menu" aria-label={t('presets')}>
              <h2>{t('presets')}</h2>
              {showcases.map((preset) => {
                const actor = 'actor' in preset ? preset.actor : preset.cast[0]
                return (
                  <button key={preset.title} onClick={() => void choose(preset)}>
                    <span className="showcase-portrait">
                      <Portrait id={actor} />
                    </span>
                    <span>
                      <b>{t(preset.title)}</b>
                      <small>
                        {'motion' in preset
                          ? label(preset.actor) + ' ← ' + label(preset.motion)
                          : preset.cast.map(label).join(' + ')}
                      </small>
                    </span>
                  </button>
                )
              })}
              <button className="shuffle" onClick={() => void choose('shuffle')}>
                <Shuffle size={16} />
                {t('randomSwap')}
              </button>
              {pending && <small role="status">{t('loadingClips')}</small>}
              {presetError && <small role="alert">{t(presetError)}</small>}
            </div>
          )}
        </div>
        <IconButton
          label={t('skeleton')}
          aria-pressed={ui.skeleton}
          onClick={() => setUI({ skeleton: !ui.skeleton })}
        >
          <Bone size={17} />
        </IconButton>
        <label
          className={'gizmo-control icon-button ' + (ui.gizmo !== 'off' ? 'selected' : '')}
          title={t('gizmo') + ' · ' + t(ui.gizmo)}
        >
          <Move3d size={17} />
          <select
            aria-label={t('gizmo')}
            value={ui.gizmo}
            onChange={(e) => setUI({ gizmo: e.target.value as typeof ui.gizmo })}
          >
            {(['off', 'move', 'rotate', 'scale'] as const).map((k) => (
              <option key={k} value={k}>
                {t(k)}
              </option>
            ))}
          </select>
        </label>
      </div>
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
        title={t('exportGif')}
        onClick={() => {
          if (ui.rightOpen && ui.right === 'export') {
            void startExport('gif')
            return
          }
          actions.setExport({ showViewfinder: true })
          setUI({
            rightOpen: true,
            right: 'export',
            presets: false,
            ...(window.innerWidth <= 900 ? { leftOpen: false } : {}),
          })
        }}
      >
        <Download size={16} />
        <span>{t('exportGif')}</span>
      </button>
    </header>
  )
}
