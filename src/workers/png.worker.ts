import { zipSync, type Zippable } from 'fflate'
import type { WorkerReply } from '../engine/exportSpec'

const files: Zippable = {}
let count = 0
self.onmessage = ({
  data,
}: MessageEvent<{ type: 'frame'; png: Uint8Array; total: number } | { type: 'finish' }>) => {
  try {
    if (data.type === 'frame') {
      files['frame_' + String(++count).padStart(4, '0') + '.png'] = data.png
      self.postMessage({ type: 'ready' } satisfies WorkerReply)
    } else if (data.type === 'finish' && count > 0) {
      // PNGs are already compressed. A fixed archive timestamp makes repeated exports identical.
      const bytes = zipSync(files, { level: 0, mtime: new Date(2000, 0, 1) })
      self.postMessage({ type: 'done', bytes }, { transfer: [bytes.buffer] })
    } else throw Error('invalid_sequence')
  } catch {
    self.postMessage({ type: 'error' } satisfies WorkerReply)
  }
}
