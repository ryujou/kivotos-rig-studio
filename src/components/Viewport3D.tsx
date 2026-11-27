import { FolderOpen, LoaderCircle, MousePointer2, RefreshCw, Scan } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { droppedFiles, parseFurnitureFiles, mountFurniture } from '../services/furniturePack'
import { jointCombos } from '../data/jointCombos'
import { jointErrorMessage, jointSlug, loadJoint } from '../services/jointLoader'
import type { MessageKey } from '../i18n'
import type { SceneManager } from '../engine/SceneManager'
import { useActiveSlot, useStudioStore, useText } from '../store/useStudioStore'
import { CropOverlay } from './CropOverlay'
import { bindExportScene } from '../store/exportSession'
import { useModelLabel } from './shared'

export function Viewport3D() {
  const t = useText(),
    safe = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null),
    manager = useRef<SceneManager | null>(null),
    file = useRef<HTMLInputElement>(null)
  const [webglFailed, setFailed] = useState(false),
    [mount, setMount] = useState(0),
    [dropError, setDropError] = useState<MessageKey | null>(null)
  const slot = useActiveSlot(),
    runtime = useStudioStore((s) => s.runtime[s.activeId]),
    label = useModelLabel()
  const viewfinder = useStudioStore(
    (s) => (s.ui.rightOpen && s.ui.right === 'export') || s.exportSettings.showViewfinder,
  )
  const bg = useStudioStore((s) =>
      s.ui.rightOpen && s.ui.right === 'export' && s.exportSettings.background !== 'stage'
        ? s.exportSettings.background
        : s.stage.background,
    ),
    leftOpen = useStudioStore((s) => s.ui.leftOpen),
    rightOpen = useStudioStore((s) => s.ui.rightOpen),
    open = useStudioStore((s) => s.openLocal)
  useLayoutEffect(() => {
    const canvas = host.current!,
      area = safe.current!
    const measure = () => {
      const full = canvas.getBoundingClientRect(),
        rect = area.getBoundingClientRect()
      if (!full.width || !full.height || !rect.width || !rect.height) return
      useStudioStore.setState({
        viewport: {
          width: full.width,
          height: full.height,
          dpr: useStudioStore.getState().viewport.dpr,
          safe: { x: rect.x - full.x, y: rect.y - full.y, width: rect.width, height: rect.height },
        },
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    observer.observe(area)
    return () => observer.disconnect()
  }, [leftOpen, rightOpen])
  useEffect(() => {
    let active = true
    void import('../engine/SceneManager')
      .then(({ SceneManager }) => {
        if (!active || !host.current) return
        manager.current = new SceneManager(host.current)
        bindExportScene(manager.current)
        setFailed(false)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      bindExportScene(null)
      manager.current?.dispose()
      manager.current = null
    }
  }, [mount])
  const failed = webglFailed || runtime?.status === 'error',
    loading = !failed && runtime?.status !== 'ready'
  const showPoster = (failed || loading) && slot.actor === 'Hina (Dress)' && slot.actor === slot.motion
  const retry = () => {
    if (webglFailed) {
      setFailed(false)
      setMount((n) => n + 1)
    } else manager.current?.retry(slot.id)
  }
  const percent = runtime?.total ? Math.min(100, Math.round((100 * runtime.received) / runtime.total)) : null
  return (
    <>
      <div
        className={'canvas-host bg-' + bg}
        ref={host}
        aria-label={t('viewport')}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const state = useStudioStore.getState()
          setDropError(null)
          void droppedFiles(e.dataTransfer)
            .then(async (files) => {
              if (!files.length) return
              const isJoint =
                files.some((f) => /\.joint\.br$/i.test(f.name)) ||
                (state.ui.left === 'joint' && files.every((f) => /\.glb$/i.test(f.name)))
              if (isJoint) {
                const bySlug = new Map(files.map((f) => [jointSlug(f.name), f]))
                const combo =
                  jointCombos.find(
                    (c) =>
                      !c.native &&
                      c.id === state.joint.comboId &&
                      c.members.some((m) => bySlug.has(jointSlug(m.model))),
                  ) ??
                  jointCombos.find((c) => !c.native && c.members.every((m) => bySlug.has(jointSlug(m.model))))
                if (!combo) {
                  setDropError('jointFailed')
                  state.updateUI({ left: 'joint', leftOpen: true })
                  return
                }
                await loadJoint(combo, bySlug).catch((error) => setDropError(jointErrorMessage(error)))
              } else if (state.ui.left === 'props' || files.length > 1 || /\.zip$/i.test(files[0].name)) {
                mountFurniture(await parseFurnitureFiles(files), state.activeId)
              } else if (/\.glb$/i.test(files[0].name)) open(files[0])
            })
            .catch(() => setDropError('packError'))
        }}
      />
      <input
        hidden
        ref={file}
        type="file"
        accept=".glb,model/gltf-binary"
        onChange={(e) => {
          const item = e.target.files?.[0]
          if (item) open(item)
          e.target.value = ''
        }}
      />
      {viewfinder && <CropOverlay />}
      <div className="stage-overlay" ref={safe}>
        <div className="registration tl" />
        <div className="registration tr" />
        <div className="registration bl" />
        <div className="registration br" />
        <div className="viewport-label">
          <Scan size={14} />
          {t(showPoster ? 'reference' : 'viewport')}
        </div>
        {showPoster && (
          <img
            className="stage-poster"
            src={import.meta.env.BASE_URL + 'hina-dress-preview.webp'}
            alt={label(slot.actor)}
          />
        )}
        {dropError && (
          <div className="load-state" role="alert">
            <button onClick={() => setDropError(null)}>{t(dropError)}</button>
          </div>
        )}
        {(failed || loading) && (
          <div className={'load-state' + (showPoster ? ' with-poster' : '')} role="status">
            {failed ? (
              <>
                <span>{t(webglFailed ? 'webglError' : 'modelError')}</span>
                <div>
                  <button onClick={retry}>
                    <RefreshCw size={13} />
                    {t('retry')}
                  </button>
                  {!webglFailed && (
                    <button onClick={() => file.current?.click()}>
                      <FolderOpen size={14} />
                      {t('openGlb')}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <LoaderCircle size={15} className="spin" />
                {t(percent === 100 ? 'preparing' : 'loading')}
                <code>
                  {percent !== null
                    ? percent + '%'
                    : runtime?.received
                      ? (runtime.received / 1048576).toFixed(1) + ' MiB'
                      : '…'}
                </code>
              </>
            )}
          </div>
        )}
        {!viewfinder && (
          <div className="stage-caption">
            <div className="actor-caption">
              <i />
              <strong>{label(slot.actor)}</strong>
            </div>
            <span className="clip-caption">{runtime?.status === 'ready' && slot.clip}</span>
          </div>
        )}
        {!viewfinder && (
          <div className="view-tools">
            <span>
              <MousePointer2 size={12} />
              {t('orbitHint')}
            </span>
          </div>
        )}
      </div>
    </>
  )
}
