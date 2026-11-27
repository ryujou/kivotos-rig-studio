export const CACHE_LIMIT = 500 * 1024 * 1024
export interface CacheStats {
  bytes: number
  count: number
}
interface Entry {
  url: string
  bytes: number
  touched: number
}
export type Progress = (received: number, total: number | null) => void

const changes = new EventTarget()
export function onCacheChange(fn: () => void) {
  changes.addEventListener('change', fn)
  return () => changes.removeEventListener('change', fn)
}

let connection: Promise<IDBDatabase> | undefined
function openCache() {
  if (connection) return connection
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ba-rig-studio-cache', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('buffers')
      db.createObjectStore('entries', { keyPath: 'url' }).createIndex('touched', 'touched')
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        connection = undefined
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })
  connection = opening.catch((error) => {
    connection = undefined
    throw error
  })
  return connection
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Both stores share one transaction, including eviction, so concurrent tabs cannot
// commit a buffer without metadata or race past the size limit.
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (buffers: IDBObjectStore, entries: IDBObjectStore) => Promise<T>,
) {
  const db = await openCache()
  const tx = db.transaction(['buffers', 'entries'], mode)
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('cache_aborted'))
  })
  const [result] = await Promise.all([
    operation(tx.objectStore('buffers'), tx.objectStore('entries')),
    done,
  ])
  return result
}

export function getCachedBuffer(url: string): Promise<ArrayBuffer | undefined> {
  return transaction('readwrite', async (buffers, entries) => {
    const entry: Entry | undefined = await requestValue(entries.get(url))
    if (!entry) return undefined
    const data: ArrayBuffer | undefined = await requestValue(buffers.get(url))
    if (data) entries.put({ ...entry, touched: Date.now() })
    else entries.delete(url)
    return data
  })
}
export async function putCachedBuffer(url: string, data: ArrayBuffer) {
  if (data.byteLength > CACHE_LIMIT) return
  await transaction('readwrite', async (buffers, entries) => {
    const rows: Entry[] = await requestValue(entries.index('touched').getAll())
    let bytes = rows.reduce((sum, row) => sum + (row.url === url ? 0 : row.bytes), data.byteLength)
    for (const row of rows) {
      if (bytes <= CACHE_LIMIT) break
      if (row.url !== url) {
        buffers.delete(row.url)
        entries.delete(row.url)
        bytes -= row.bytes
      }
    }
    buffers.put(data, url)
    entries.put({ url, bytes: data.byteLength, touched: Date.now() } satisfies Entry)
  })
  changes.dispatchEvent(new Event('change'))
}
export function getCacheStats(): Promise<CacheStats> {
  return transaction('readonly', async (_, entries) => {
    const rows: Entry[] = await requestValue(entries.getAll())
    return { count: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0) }
  })
}
export async function clearCache() {
  await transaction('readwrite', async (buffers, entries) => {
    buffers.clear()
    entries.clear()
  })
  changes.dispatchEvent(new Event('change'))
}

export async function fetchModelBuffer(url: string, onProgress?: Progress, signal?: AbortSignal) {
  const cached = await getCachedBuffer(url).catch(() => undefined)
  signal?.throwIfAborted()
  if (cached) {
    onProgress?.(cached.byteLength, cached.byteLength)
    return cached
  }
  const timeout = AbortSignal.timeout(120_000)
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  if (!response.ok) throw new Error('model_http_' + response.status)
  const total = Number(response.headers.get('Content-Length')) || null
  onProgress?.(0, total)
  const reader = response.body?.getReader()
  let buffer: ArrayBuffer
  if (reader) {
    const chunks: Uint8Array[] = []
    let received = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.byteLength
      onProgress?.(received, total)
    }
    const joined = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      joined.set(chunk, offset)
      offset += chunk.byteLength
    }
    buffer = joined.buffer
  } else buffer = await response.arrayBuffer()
  onProgress?.(buffer.byteLength, buffer.byteLength)
  // A CDN error document returned with HTTP 200 must not poison future loads.
  const header = new DataView(buffer)
  if (
    buffer.byteLength < 12 ||
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== buffer.byteLength
  )
    throw new Error('invalid_glb')
  await putCachedBuffer(url, buffer).catch(() => undefined)
  return buffer
}
