import { brotliDecompressSync } from 'node:zlib'
import { defineConfig, type Connect, type Plugin } from 'vite'
import tailwind from '@tailwindcss/vite'

const joint: Connect.NextHandleFunction = async (req, res, next) => {
  const path = req.url?.split('?')[0] ?? ''
  if (!path.startsWith('/api/joint/')) return next()
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  const fail = (status: number, error: string) => {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error }))
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'method_not_allowed')
  const file = path.slice('/api/joint/'.length)
  if (!/^[a-z0-9][a-z0-9_-]*\.(?:joint\.br|json(?:\.br)?)$/i.test(file))
    return fail(400, 'invalid_joint_filename')
  const timeout = AbortSignal.timeout(45_000)
  try {
    const upstream = await fetch(
      'https://github.com/dxsworks/SD_archive/releases/download/students/' + file,
      {
        redirect: 'follow',
        signal: timeout,
        method: req.method,
      },
    )
    if (!upstream.ok) return fail(upstream.status === 404 ? 404 : 502, 'upstream_unavailable')
    res.setHeader('Content-Type', /\.json(?:\.br)?$/i.test(file) ? 'application/json' : 'model/gltf-binary')
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const bytes = Buffer.from(await upstream.arrayBuffer())
    const payload = file.toLowerCase().endsWith('.br') ? brotliDecompressSync(bytes) : bytes
    res.setHeader('Content-Length', payload.byteLength)
    res.end(payload)
  } catch {
    fail(timeout.aborted ? 504 : 502, timeout.aborted ? 'upstream_timeout' : 'invalid_upstream_response')
  }
}

const jointProxy: Plugin = {
  name: 'joint-release-proxy',
  configureServer(server) {
    server.middlewares.use(joint)
  },
  configurePreviewServer(server) {
    server.middlewares.use(joint)
  },
}

export default defineConfig({
  base: process.env.BASE_PATH || './',
  plugins: [tailwind(), jointProxy],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/three/build/three.core.js')) return 'three-core'
          if (id.includes('/three/build/three.module.js')) return 'three-renderer'
          if (id.includes('/three/examples/')) return 'three-addons'
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
        },
      },
    },
  },
})
