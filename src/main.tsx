import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useStudioStore } from './store/useStudioStore'
import './index.css'

const portraitAtlas = new URL(import.meta.env.BASE_URL + 'student-portraits.webp', document.baseURI)
document.documentElement.lang = useStudioStore.getState().language
document.documentElement.style.setProperty('--portrait-atlas', `url("${portraitAtlas.href}")`)

createRoot(document.getElementById('root')!).render(<App />)
