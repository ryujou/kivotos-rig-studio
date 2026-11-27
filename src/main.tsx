import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ExportModal } from './components/ExportModal'
import { TopBar } from './components/TopBar'
import { SlotStrip } from './components/SlotStrip'
import { Viewport3D } from './components/Viewport3D'
import { LeftDrawer } from './components/LeftDrawer'
import { RightInspector } from './components/RightInspector'
import { TimelineDock } from './components/TimelineDock'
import { useStudioStore } from './store/useStudioStore'
import { loadWikiCatalog } from './services/wikiCatalog'
import './index.css'

function Studio() {
  const theme = useStudioStore((s) => s.theme),
    lang = useStudioStore((s) => s.language),
    ui = useStudioStore((s) => s.ui)
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dataset.theme = theme
  }, [theme, lang])
  useEffect(() => {
    const breakpoint = window.matchMedia('(max-width: 900px)')
    const onBreakpoint = () =>
      useStudioStore.getState().updateUI({ leftOpen: !breakpoint.matches, rightOpen: !breakpoint.matches })
    breakpoint.addEventListener('change', onBreakpoint)
    let live = true
    void loadWikiCatalog().then(({ models, status }) => {
      if (live) useStudioStore.getState().setCatalog(models, status)
    })
    return () => {
      live = false
      breakpoint.removeEventListener('change', onBreakpoint)
    }
  }, [])
  return (
    <main className="workspace" data-left={ui.leftOpen} data-right={ui.rightOpen}>
      <Viewport3D />
      <TopBar />
      <SlotStrip />
      <LeftDrawer />
      <RightInspector />
      <TimelineDock />
      <ExportModal />
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Studio />)
