import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, Keyboard, Mouse, X } from 'lucide-react'
import type { MessageKey } from '../i18n'
import { useStudioStore, useText } from '../store/useStudioStore'
import { IconButton } from './shared'

type Rect = readonly [x: number, y: number, width: number, height: number]
type Pin = {
  title: MessageKey
  text: MessageKey
  box: Rect
  extraBox?: Rect
  extraArrow?: string
  badge: readonly [number, number]
  arrow: string
}
type GuideStep = { title: MessageKey; tab: MessageKey; pins: readonly Pin[] }

// Coordinates are in the original 1440 × 900 screenshot, independent of dialog size.
const steps: readonly GuideStep[] = [
  {
    title: 'guideStep1',
    tab: 'guideTab1',
    pins: [
      {
        title: 'guideTarget',
        text: 'guideTargetText',
        box: [22, 168, 292, 47],
        badge: [444, 147],
        arrow: 'M444 147 Q381 143 320 186',
      },
      {
        title: 'guideFilter',
        text: 'guideFilterText',
        box: [22, 216, 292, 73],
        badge: [420, 274],
        arrow: 'M420 274 Q377 257 317 258',
      },
      {
        title: 'guideCards',
        text: 'guideCardsText',
        box: [22, 353, 292, 388],
        badge: [453, 449],
        arrow: 'M453 449 Q399 430 317 457',
      },
      {
        title: 'guideClips',
        text: 'guideClipsText',
        box: [20, 747, 295, 138],
        extraBox: [628, 18, 184, 40],
        extraArrow: 'M430 700 C548 625 439 242 533 124 Q570 78 624 48',
        badge: [430, 700],
        arrow: 'M430 700 Q385 697 321 754',
      },
    ],
  },
  {
    title: 'guideStep2',
    tab: 'guideTab2',
    pins: [
      {
        title: 'guidePropTab',
        text: 'guidePropTabText',
        box: [215, 124, 99, 35],
        badge: [430, 125],
        arrow: 'M430 125 Q375 114 320 138',
      },
      {
        title: 'guideLoadProp',
        text: 'guideLoadPropText',
        box: [22, 306, 292, 126],
        badge: [439, 384],
        arrow: 'M439 384 Q386 364 317 388',
      },
      {
        title: 'guideWeapon',
        text: 'guideWeaponText',
        box: [1113, 164, 305, 224],
        badge: [996, 260],
        arrow: 'M996 260 Q1053 250 1107 272',
      },
      {
        title: 'guideMount',
        text: 'guideMountText',
        box: [1113, 654, 305, 156],
        badge: [986, 676],
        arrow: 'M986 676 Q1045 674 1107 722',
      },
    ],
  },
  {
    title: 'guideStep3',
    tab: 'guideTab3',
    pins: [
      {
        title: 'guideJointTab',
        text: 'guideJointTabText',
        box: [118, 124, 99, 35],
        badge: [393, 108],
        arrow: 'M393 108 Q307 93 222 136',
      },
      {
        title: 'guideCast',
        text: 'guideCastText',
        box: [22, 413, 292, 187],
        badge: [442, 487],
        arrow: 'M442 487 Q389 475 317 502',
      },
      {
        title: 'guideSlots',
        text: 'guideSlotsText',
        box: [621, 18, 198, 40],
        badge: [913, 124],
        arrow: 'M913 124 Q889 78 825 55',
      },
      {
        title: 'guideChain',
        text: 'guideChainText',
        box: [420, 827, 95, 32],
        badge: [598, 751],
        arrow: 'M598 751 Q543 757 483 821',
      },
    ],
  },
  {
    title: 'guideStep4',
    tab: 'guideTab4',
    pins: [
      {
        title: 'guideTrim',
        text: 'guideTrimText',
        box: [352, 857, 649, 30],
        badge: [617, 758],
        arrow: 'M617 758 Q638 795 622 851',
      },
      {
        title: 'guideCrop',
        text: 'guideCropText',
        box: [347, 76, 734, 734],
        badge: [471, 176],
        arrow: 'M471 176 Q416 184 351 91',
      },
      {
        title: 'guideOutput',
        text: 'guideOutputText',
        box: [1113, 171, 305, 294],
        badge: [986, 299],
        arrow: 'M986 299 Q1038 275 1116 314',
      },
      {
        title: 'guideSave',
        text: 'guideSaveText',
        box: [1113, 739, 305, 77],
        badge: [995, 686],
        arrow: 'M995 686 Q1057 693 1107 760',
      },
    ],
  },
]

function Illustration({ step, index }: { step: GuideStep; index: number }) {
  const t = useText()
  const [failed, setFailed] = useState(false)
  return (
    <figure className="guide-stage" aria-label={t(step.title)}>
      {!failed && (
        <img
          src={import.meta.env.BASE_URL + 'guide/step-' + (index + 1) + '.webp'}
          width="1440"
          height="900"
          alt={t(step.title)}
          onError={() => setFailed(true)}
        />
      )}
      <svg className="guide-overlay" viewBox="0 0 1440 900" aria-hidden="true">
        <defs>
          <marker
            id="guide-arrow"
            markerWidth="12"
            markerHeight="12"
            refX="10"
            refY="6"
            orient="auto"
            markerUnits="userSpaceOnUse"
            overflow="visible"
          >
            <path d="M0 0 L11 6 L0 12 L3 6 Z" fill="#00a2ff" stroke="white" strokeWidth="1" />
          </marker>
          <filter id="guide-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#004775" floodOpacity=".35" />
          </filter>
        </defs>
        {failed && (
          <g className="guide-schematic">
            <rect x="16" y="12" width="1408" height="52" rx="16" />
            <rect x="16" y="76" width="304" height={index === 0 ? 812 : 738} rx="16" />
            <rect x="1110" y="76" width="314" height="738" rx="16" />
            <rect x="342" y="820" width="756" height="72" rx="16" />
          </g>
        )}
        {step.pins.map(({ title, box, extraBox, badge: [cx, cy], arrow, extraArrow }, i) => (
          <g key={title}>
            {(extraBox ? [box, extraBox] : [box]).map(([x, y, width, height]) => (
              <rect key={x + ':' + y} className="guide-highlight" {...{ x, y, width, height }} rx="12" />
            ))}
            {failed && (
              <foreignObject x={box[0]} y={box[1]} width={box[2]} height={box[3]}>
                <div className="guide-fallback-label">{t(title)}</div>
              </foreignObject>
            )}
            {(extraArrow ? [arrow, extraArrow] : [arrow]).map((path) => (
              <g key={path}>
                <path className="guide-arrow-halo" d={path} />
                <path className="guide-arrow-line" d={path} markerEnd="url(#guide-arrow)" />
              </g>
            ))}
            <g filter="url(#guide-glow)">
              <circle cx={cx} cy={cy} r="18" fill="#0089db" stroke="white" strokeWidth="2" />
              <text className="guide-pin-number" x={cx} y={cy} dy=".35em" textAnchor="middle">
                {i + 1}
              </text>
            </g>
          </g>
        ))}
      </svg>
    </figure>
  )
}

export function GuideDialog({ index, setIndex }: { index: number; setIndex: (index: number) => void }) {
  const t = useText()
  const dialog = useRef<HTMLDialogElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const step = steps[index]
  const close = () => useStudioStore.getState().updateUI({ guideOpen: false })
  useLayoutEffect(() => {
    const el = dialog.current!
    el.showModal()
    return () => el.close()
  }, [])
  useLayoutEffect(() => {
    body.current?.scrollTo(0, 0)
  }, [index])
  return (
    <dialog
      className="guide-modal glass"
      ref={dialog}
      aria-labelledby="guide-title"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <header className="guide-header">
        <BookOpen aria-hidden="true" size={20} />
        <h2 id="guide-title">{t('guide')}</h2>
        <IconButton label={t('close')} onClick={close}>
          <X size={18} />
        </IconButton>
      </header>
      <div className="guide-tabs" role="tablist" aria-label={t('guide')}>
        {steps.map((item, i) => (
          <button
            key={item.tab}
            id={'guide-tab-' + i}
            role="tab"
            aria-selected={i === index}
            aria-controls="guide-panel"
            tabIndex={i === index ? 0 : -1}
            onClick={() => setIndex(i)}
            onKeyDown={(event) => {
              const next = {
                ArrowRight: (i + 1) % steps.length,
                ArrowLeft: (i + steps.length - 1) % steps.length,
                Home: 0,
                End: steps.length - 1,
              }[event.key]
              if (next === undefined) return
              event.preventDefault()
              setIndex(next)
              document.getElementById('guide-tab-' + next)?.focus()
            }}
          >
            <b>{i + 1}</b>
            <span>{t(item.tab)}</span>
          </button>
        ))}
      </div>
      <div
        className="guide-body"
        ref={body}
        role="tabpanel"
        id="guide-panel"
        aria-labelledby={'guide-tab-' + index}
        tabIndex={0}
      >
        <h3>{t(step.title)}</h3>
        <Illustration key={index} step={step} index={index} />
        <ol className="guide-notes">
          {step.pins.map((pin, i) => (
            <li key={pin.title}>
              <b className="guide-note-number" aria-hidden="true">
                {i + 1}
              </b>
              <div>
                <h4>{t(pin.title)}</h4>
                <p>{t(pin.text)}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="guide-shortcuts" aria-label={t('guideShortcuts')}>
          <Keyboard size={16} aria-hidden="true" />
          <span>
            <kbd>/</kbd>
            {t('guideSearch')}
          </span>
          <span>
            <kbd>{t('guideSpace')}</kbd>
            {t('guidePlayback')}
          </span>
          <span>
            <kbd>←/→</kbd>
            {t('guideFrame')}
          </span>
          <span>
            <kbd>?</kbd>
            {t('guide')}
          </span>
          <span>
            <Mouse size={14} aria-hidden="true" />
            {t('guideMouse')}
          </span>
        </div>
      </div>
      <footer className="guide-footer">
        <span aria-live="polite">
          {index + 1} / {steps.length}
        </span>
        <button disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ChevronLeft size={15} />
          {t('guidePrevious')}
        </button>
        <button className="primary" onClick={index === steps.length - 1 ? close : () => setIndex(index + 1)}>
          {t(index === steps.length - 1 ? 'guideDone' : 'guideNext')}
          {index < steps.length - 1 && <ChevronRight size={15} />}
        </button>
      </footer>
    </dialog>
  )
}

function Walkthrough() {
  const [index, setIndex] = useState(0)
  return <GuideDialog index={index} setIndex={setIndex} />
}

export function toggleGuideShortcut(event: KeyboardEvent) {
  if (
    event.key !== '?' ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey
  )
    return
  const el = event.target instanceof HTMLElement ? event.target : null
  if (
    el?.isContentEditable ||
    el?.closest('input, textarea, select') ||
    document.querySelector('dialog[open]:not(.guide-modal)')
  )
    return
  event.preventDefault()
  const state = useStudioStore.getState()
  state.updateUI({ guideOpen: !state.ui.guideOpen })
}

export function GuideModal() {
  const open = useStudioStore((s) => s.ui.guideOpen)
  useEffect(() => {
    window.addEventListener('keydown', toggleGuideShortcut)
    return () => window.removeEventListener('keydown', toggleGuideShortcut)
  }, [])
  return open ? <Walkthrough /> : null
}
