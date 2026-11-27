import {
  Axis3d,
  Box,
  Camera,
  CircleDot,
  Database,
  Focus,
  Grid2x2,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  PersonStanding,
  ScanFace,
  SlidersHorizontal,
  Sun,
  Trash2,
  UsersRound,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import {
  CACHE_LIMIT,
  clearCache,
  getCacheStats,
  onCacheChange,
  type CacheStats,
} from '../services/modelCache'
import { useActiveSlot, useStudioStore, useText, type CameraPreset } from '../store/useStudioStore'
import { IconButton, Tabs, Toggle } from './shared'

import { ExportInspector } from './ExportInspector'
import { PropInspector } from './PropInspector'
import { RiggingInspector } from './RiggingInspector'

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="control-section">
      <h3>
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}
function CacheSection() {
  const t = useText(),
    [stats, setStats] = useState<CacheStats | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const read = () => {
      void getCacheStats()
        .then((value) => {
          if (alive) {
            setStats(value)
            setFailed(false)
          }
        })
        .catch(() => {
          if (alive) setFailed(true)
        })
    }
    read()
    const unsubscribe = onCacheChange(read)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  const clear = async () => {
    setBusy(true)
    try {
      await clearCache()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('cache')} icon={<Database />}>
      <div className="cache-summary">
        <span>IndexedDB</span>
        <code>
          {failed ? t('cacheUnavailable') : stats ? (stats.bytes / 1048576).toFixed(1) + ' / 500 MiB' : '…'}
        </code>
      </div>
      <div className="cache-meter">
        <i style={{ width: (stats ? (stats.bytes / CACHE_LIMIT) * 100 : 0) + '%' }} />
      </div>
      <button className="quiet-button" disabled={busy || !stats?.count} onClick={() => void clear()}>
        <Trash2 size={13} />
        {t(busy ? 'cacheBusy' : 'clearCache')}
      </button>
    </Section>
  )
}
const cameras = [
  { key: 'front', icon: PersonStanding },
  { key: 'threeQuarter', icon: Box },
  { key: 'side', icon: Axis3d },
  { key: 'back', icon: CircleDot },
  { key: 'face', icon: ScanFace },
  { key: 'group', icon: UsersRound },
] as const
function StageControls() {
  const t = useText(),
    stage = useStudioStore((s) => s.stage),
    set = useStudioStore((s) => s.setStage),
    camera = useStudioStore((s) => s.camera.preset),
    frame = useStudioStore((s) => s.setCamera)
  return (
    <div className="inspector-scroll">
      <Section title={t('appearance')} icon={<Layers />}>
        <div className="field-label">{t('shading')}</div>
        <div className="shade-options">
          {(
            [
              { key: 'unlit', icon: CircleDot },
              { key: 'softLit', icon: Sun },
              { key: 'wireframe', icon: Grid2x2 },
            ] as const
          ).map(({ key, icon: Icon }) => (
            <button
              className="whitespace-nowrap"
              key={key}
              aria-pressed={stage.shading === key}
              onClick={() => set({ shading: key })}
            >
              <Icon size={15} />
              {t(key)}
            </button>
          ))}
        </div>
        <Toggle
          label={t('outline')}
          checked={stage.outline}
          onChange={() => set({ outline: !stage.outline })}
        />
        <div className="outline-details">
          <label className="slider-row">
            <span>{t('width')}</span>
            <input
              type="range"
              min="0"
              max="200"
              value={stage.width}
              onChange={(e) => set({ width: Number(e.target.value) })}
            />
            <code>{stage.width}%</code>
          </label>
          <label className="color-row">
            <span>{t('color')}</span>
            <span className="hex-color">
              <input type="color" value={stage.color} onChange={(e) => set({ color: e.target.value })} />
              <code>{stage.color.toUpperCase()}</code>
            </span>
          </label>
        </div>
      </Section>
      <Section title={t('environment')} icon={<Sun />}>
        <label className="select-row">
          <span>{t('background')}</span>
          <select
            value={stage.background}
            onChange={(e) => set({ background: e.target.value as typeof stage.background })}
          >
            {(['studio', 'transparent', 'solid', 'chroma'] as const).map((k) => (
              <option key={k} value={k}>
                {t(k)}
              </option>
            ))}
          </select>
        </label>
        {stage.background === 'solid' && (
          <label className="color-row">
            {t('color')}
            <input
              type="color"
              value={stage.solidColor}
              onChange={(e) => set({ solidColor: e.target.value })}
            />
          </label>
        )}
        <Toggle
          label={t('floorGrid')}
          checked={stage.floorGrid}
          onChange={() => set({ floorGrid: !stage.floorGrid })}
        />
        <Toggle label={t('shadow')} checked={stage.shadow} onChange={() => set({ shadow: !stage.shadow })} />
      </Section>
      <Section title={t('camera')} icon={<Camera />}>
        <div className="camera-options">
          {cameras.map(({ key, icon: Icon }) => (
            <button
              key={key}
              aria-pressed={camera === key}
              title={t(key)}
              onClick={() => frame(key as CameraPreset)}
            >
              <Icon size={14} />
              {t(key)}
            </button>
          ))}
        </div>
        <button className="frame-button" onClick={() => frame('reset')}>
          <Focus size={14} />
          {t('reset')}
        </button>
      </Section>
      <CacheSection />
    </div>
  )
}
export function RightInspector() {
  const t = useText(),
    ui = useStudioStore((s) => s.ui),
    set = useStudioStore((s) => s.updateUI),
    slot = useActiveSlot()
  if (!ui.rightOpen)
    return (
      <IconButton
        className="reopen right glass"
        label={t('showInspector')}
        onClick={() => set({ rightOpen: true, ...(window.innerWidth <= 900 ? { leftOpen: false } : {}) })}
      >
        <PanelRightOpen size={19} />
      </IconButton>
    )
  return (
    <aside className="panel glass inspector-panel" aria-label={t('inspector')}>
      <div className="panel-header">
        <span className="panel-icon">
          <SlidersHorizontal size={18} />
        </span>
        <h2>{t('inspector')}</h2>
        <span className="slot-tag">
          <i />
          {t('slot')} {slot.id}
        </span>
        <IconButton label={t('collapse')} onClick={() => set({ rightOpen: false })}>
          <PanelRightClose size={16} />
        </IconButton>
      </div>
      <Tabs
        keys={['props', 'rigging', 'stage', 'export'] as const}
        value={ui.right}
        onChange={(right) => set({ right })}
        label={t('inspector')}
      />
      {ui.right === 'stage' && <StageControls />}
      {ui.right === 'export' && <ExportInspector />}
      {ui.right === 'props' && <PropInspector />}
      {ui.right === 'rigging' && <RiggingInspector key={slot.id} />}
    </aside>
  )
}
