import type { AnimationClip } from 'three'

export type ClipCategory = 'cafe' | 'interact' | 'victory' | 'exs' | 'combat' | 'vehicle' | 'other'
export interface ClipInfo {
  name: string
  duration: number
  category: ClipCategory
  chain: 'start' | 'end' | null
}

function cleanName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/callsigh/g, 'callsign')
    .replace(/fomation/g, 'formation')
}
const prefix = /^(?:(?:\d{2}|tank|sm\d+)_)+/
export function normalizeClipName(name: string) {
  return cleanName(name).replace(prefix, '')
}
export function describeClip(clip: Pick<AnimationClip, 'name' | 'duration'>): ClipInfo {
  const raw = cleanName(clip.name),
    name = normalizeClipName(raw)
  let category: ClipCategory = 'other'
  if (/victory/.test(name)) category = 'victory'
  else if (/cafe/.test(name)) category = 'cafe'
  else if (/^exs?|cutin/.test(name)) category = 'exs'
  else if (/(?:^|_)(tank|sm\d+|vehicle|ride|bike|carrier)_/.test(raw)) category = 'vehicle'
  else if (/interact|nonweapon|public|formation|pickup/.test(name)) category = 'interact'
  else if (/normal|attack|vital|reload|move|stand|kneel|tactical|idle|cover|callsign/.test(name))
    category = 'combat'
  return {
    name: clip.name,
    duration: clip.duration,
    category,
    chain: /(?:^|_)start(?:_|$)|^formation_pickup$/.test(name)
      ? 'start'
      : /(?:^|_)end(?:_|$)/.test(name)
        ? 'end'
        : null,
  }
}

type TimedClip = { name: string; duration: number }
export function clipSequence<T extends TimedClip>(
  clips: readonly T[],
  selected: string,
  chain: boolean,
  end?: string,
): T[] {
  const first = clips.find((c) => c.name === selected)
  if (!first) return []
  const sequence = [first]
  if (!chain) return sequence
  if (end) {
    const next = clips.find((c) => c.name === end)
    return next && next !== first ? [first, next] : sequence
  }
  // Keep the form/vehicle prefix and Random/Interaction suffix when pairing siblings.
  const raw = cleanName(first.name)
  const lookup = (key: string) => clips.find((c) => cleanName(c.name) === key)
  if (/(^|_)start(?=_|$)/.test(raw)) {
    for (const phase of ['ing', 'end']) {
      const next = lookup(raw.replace(/(^|_)start(?=_|$)/, '$1' + phase))
      if (next) sequence.push(next)
    }
  } else if (normalizeClipName(raw) === 'formation_pickup') {
    const idle = lookup(raw.replace(/pickup$/, 'idle'))
    if (idle) sequence.push(idle)
  }
  return sequence
}
export function sequenceDuration(clips: readonly TimedClip[], startWindow = 0) {
  return clips.reduce(
    (sum, clip, index) =>
      sum + (index === 0 && clips.length > 1 ? Math.max(clip.duration, startWindow) : clip.duration),
    0,
  )
}
export function sampleSequence<T extends TimedClip>(sequence: readonly T[], time: number, startWindow = 0) {
  let local = Math.max(time, 0)
  for (const [index, clip] of sequence.entries()) {
    const span = index === 0 && sequence.length > 1 ? Math.max(clip.duration, startWindow) : clip.duration
    if (local < span) return { clip, time: Math.min(local, clip.duration) }
    local -= span
  }
  const last = sequence.at(-1)
  return last && { clip: last, time: last.duration }
}
