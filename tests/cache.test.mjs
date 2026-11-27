import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CACHE_LIMIT,
  getCacheStats,
  getCachedBuffer,
  putCachedBuffer,
  clearCache,
  fetchModelBuffer,
  onCacheChange,
} from '../src/services/modelCache.ts'

// Model the two asynchronous IndexedDB object stores at the adapter boundary.
// Transaction completion follows the microtasks queued by successful requests.
function memoryDatabase() {
  const tables = new Map()
  const request = (read) => {
    const req = {}
    queueMicrotask(() => {
      req.result = read()
      req.onsuccess()
    })
    return req
  }
  function store(name) {
    const table = tables.get(name)
    return {
      get: (key) => request(() => table.get(key)),
      put: (row, key) => table.set(key ?? row.url, row),
      delete: (key) => table.delete(key),
      clear: () => table.clear(),
      getAll: () => request(() => [...table.values()]),
      index: () => ({
        getAll: () => request(() => [...table.values()].sort((a, b) => a.touched - b.touched)),
      }),
      createIndex() {},
    }
  }
  const db = {
    createObjectStore(name) {
      tables.set(name, new Map())
      return store(name)
    },
    transaction() {
      const tx = { objectStore: store }
      setImmediate(() => tx.oncomplete())
      return tx
    },
    close() {},
  }
  return {
    tables,
    db,
    open() {
      const req = { result: db }
      queueMicrotask(() => {
        if (!tables.size) req.onupgradeneeded()
        req.onsuccess()
      })
      return req
    },
  }
}

test('model cache hits, replacement, oldest-entry eviction and clearing keep metadata and buffers in sync', async (t) => {
  const database = memoryDatabase()
  globalThis.indexedDB = database
  t.after(() => {
    database.db.onversionchange()
    delete globalThis.indexedDB
  })
  const changes = t.mock.fn()
  const unsubscribe = onCacheChange(changes)
  t.after(unsubscribe)
  const a = Uint8Array.of(1, 2, 3).buffer
  await putCachedBuffer('a', a)
  await putCachedBuffer('a', a.slice(1))
  assert.deepEqual(await getCacheStats(), { count: 1, bytes: 2 })
  const first = await getCachedBuffer('a')
  assert.deepEqual([...new Uint8Array(first)], [2, 3])
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    throw Error('unexpected cache miss')
  })
  assert.deepEqual(await fetchModelBuffer('a'), first)
  assert.equal(fetch.mock.callCount(), 0)
  database.tables.get('entries').set('old', { url: 'old', touched: 0, bytes: CACHE_LIMIT - 2 })
  database.tables.get('buffers').set('old', a)
  await putCachedBuffer('b', a)
  assert.equal(await getCachedBuffer('old'), undefined)
  assert.deepEqual(await getCacheStats(), { count: 2, bytes: 5 })
  database.tables.get('buffers').delete('a')
  assert.equal(await getCachedBuffer('a'), undefined)
  assert.deepEqual(await getCacheStats(), { count: 1, bytes: 3 })
  await clearCache()
  assert.deepEqual(await getCacheStats(), { count: 0, bytes: 0 })
  assert.equal(changes.mock.callCount(), 4)
})
