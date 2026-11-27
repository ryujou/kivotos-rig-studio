import { useEffect, useRef } from 'react'
import { Download, Film, X } from 'lucide-react'
import { closeExport, useExportSession } from '../store/exportSession'
import { useText } from '../store/useStudioStore'
import { IconButton } from './shared'

export function ExportModal() {
  const t = useText(),
    job = useExportSession((s) => s.job)
  const dialog = useRef<HTMLDialogElement>(null)
  const open = !!job
  useEffect(() => {
    if (!open || !dialog.current) return
    const el = dialog.current
    el.showModal()
    return () => {
      el.close()
    }
  }, [open])
  if (!job) return null
  const { format } = job
  const title =
    job.status === 'done'
      ? t(format === 'gif' ? 'gifPreview' : 'preview')
      : t(
          job.status === 'error'
            ? 'exportFailed'
            : job.progress.phase === 'capturing'
              ? 'rendering'
              : 'finalizing',
        )
  return (
    <dialog
      className="export-modal glass"
      aria-labelledby="export-title"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault()
        closeExport()
      }}
    >
      <header>
        <Film size={19} />
        <h2 id="export-title">{title}</h2>
        <IconButton label={t(job.status === 'busy' ? 'cancel' : 'close')} onClick={closeExport}>
          <X size={16} />
        </IconButton>
      </header>
      {job.status === 'busy' && (
        <>
          <div className="progress-info">
            <span>{format === 'png' ? 'PNG ZIP' : format.toUpperCase()}</span>
            <code>
              {job.progress.current} / {job.progress.total} {t('frames')}
            </code>
          </div>
          <progress value={job.progress.percent} max={100} aria-label={title} />
          <footer>
            <button onClick={closeExport}>{t('cancel')}</button>
          </footer>
        </>
      )}
      {job.status === 'error' && (
        <>
          <p role="alert">{t(job.message)}</p>
          <footer>
            <button onClick={closeExport}>{t('close')}</button>
          </footer>
        </>
      )}
      {job.status === 'done' && (
        <>
          {format !== 'png' && (
            <div className="export-preview">
              {format === 'gif' ? (
                <img
                  src={job.result.url}
                  width={job.result.width}
                  height={job.result.height}
                  alt={t('gifPreview')}
                />
              ) : (
                <video src={job.result.url} controls loop autoPlay muted playsInline />
              )}
            </div>
          )}
          <div className="file-spec">
            <b>
              {job.result.width} × {job.result.height}
            </b>
            <span>
              {job.result.frames} {t('frames')} · {job.result.fps} FPS
            </span>
            <span title={job.result.bytes.toLocaleString() + ' B'}>
              {job.result.bytes < 1e6
                ? (job.result.bytes / 1000).toFixed(2) + ' KB'
                : (job.result.bytes / 1e6).toFixed(2) + ' MB'}
            </span>
          </div>
          <footer>
            <button onClick={closeExport}>{t('close')}</button>
            <a
              className="primary"
              href={job.result.url}
              download={
                'kivotos-' +
                job.result.width +
                'x' +
                job.result.height +
                '.' +
                (format === 'png' ? 'zip' : format)
              }
            >
              <Download size={15} />
              {t(format === 'gif' ? 'downloadGif' : format === 'png' ? 'downloadZip' : 'downloadWebm')}
            </a>
          </footer>
        </>
      )}
    </dialog>
  )
}
