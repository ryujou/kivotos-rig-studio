import { create } from 'zustand'
import type { SceneManager } from '../engine/SceneManager'
import { exportClip } from '../engine/GifExporter'
import { clipTiming, type ExportFormat, type ExportProgress } from '../engine/exportSpec'
import { useStudioStore } from './useStudioStore'

type Result = Omit<Awaited<ReturnType<typeof exportClip>>, 'blob'> & { url: string; bytes: number }
export type ExportJob = { format: ExportFormat } & (
  | { status: 'busy'; progress: ExportProgress }
  | { status: 'done'; result: Result }
  | { status: 'error'; message: 'webmUnavailable' | 'stageUnavailable' | 'exportFailed' }
)
export const useExportSession = create<{ job: ExportJob | null }>(() => ({ job: null }))
let scene: SceneManager | null = null
let active: AbortController | undefined
export function exportReady(s: ReturnType<typeof useStudioStore.getState>) {
  return (
    s.timeline.duration > 0 &&
    s.timeline.trimEnd > s.timeline.trimStart &&
    s.slots.every((slot) => s.runtime[slot.id]?.status === 'ready') &&
    s.props.every((prop) => !prop.visible || prop.status === 'ready')
  )
}

export function bindExportScene(value: SceneManager | null) {
  if (!value) closeExport()
  scene = value
}
export function closeExport() {
  const { job } = useExportSession.getState()
  if (job?.status === 'done') URL.revokeObjectURL(job.result.url)
  const controller = active
  active = undefined
  controller?.abort()
  useExportSession.setState({ job: null })
}
export async function startExport(format: ExportFormat) {
  if (active || useExportSession.getState().job) return
  const s = useStudioStore.getState()
  const controller = new AbortController()
  active = controller
  const progress = (p: ExportProgress) => {
    if (!controller.signal.aborted)
      useExportSession.setState({ job: { status: 'busy', format, progress: p } })
  }
  try {
    const total = clipTiming(s.timeline, s.exportSettings.fps).frames
    progress({ phase: 'capturing', current: 0, total, percent: 0 })
    if (!scene) throw Error('stageUnavailable')
    const { blob, ...spec } = await exportClip(
      scene,
      format,
      {
        stage: s.stage,
        timeline: s.timeline,
        theme: s.theme,
        settings: s.exportSettings,
        viewport: s.viewport,
        springs: s.slots.some((slot) => slot.rig.spring.enabled),
      },
      controller.signal,
      progress,
    )
    controller.signal.throwIfAborted()
    useExportSession.setState({
      job: { status: 'done', format, result: { ...spec, bytes: blob.size, url: URL.createObjectURL(blob) } },
    })
  } catch (error) {
    const reason = error instanceof Error && error.message
    if (!controller.signal.aborted)
      useExportSession.setState({
        job: {
          format,
          status: 'error',
          message: reason === 'webmUnavailable' || reason === 'stageUnavailable' ? reason : 'exportFailed',
        },
      })
  } finally {
    if (active === controller) active = undefined
  }
}
