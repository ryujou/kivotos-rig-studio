// Deploy as a module Worker with nodejs_compat and compatibility_date >= 2025-09-01.
// Enter the Worker origin (or its /api/joint/ URL) in the studio's Joint tab.
import { brotliDecompressSync } from 'node:zlib'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const reply = (status, body = null, extra = {}) =>
  new Response(body, { status, headers: { ...headers, ...extra } })

export default {
  async fetch(request) {
    const match = /^\/api\/joint\/([a-z0-9][a-z0-9-]*\.joint\.br|joint-index\.json)$/.exec(new URL(request.url).pathname)
    if (!match) return reply(404)
    if (request.method === 'OPTIONS') return reply(204)
    if (!['GET', 'HEAD'].includes(request.method)) return reply(405)
    const file = match[1]
    try {
      const source = await fetch('https://github.com/dxsworks/SD_archive/releases/download/students/' + file,
        { method: request.method, redirect: 'follow', signal: AbortSignal.timeout(45000) })
      if (!source.ok) return reply(source.status === 404 ? 404 : 502)
      const compressed = file.endsWith('.br')
      const type = compressed ? 'model/gltf-binary' : 'application/json'
      if (request.method === 'HEAD') return reply(200, null, { 'Content-Type': type })
      const bytes = await source.arrayBuffer()
      return reply(200, compressed ? brotliDecompressSync(new Uint8Array(bytes)) : bytes,
        { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' })
    } catch {
      return reply(502)
    }
  },
}
