import { createRequire, registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

// Browser preferences stay in the test process, including on Node versions with Web Storage.
const preferences = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => preferences.get(key) ?? null,
    setItem: (key, value) => preferences.set(key, value),
  },
})

// Match Vite's extensionless TypeScript imports and gifenc's browser ESM entry.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'gifenc') return nextResolve('gifenc/dist/gifenc.esm.js', context)
    if (/^\.{1,2}\//.test(specifier) && !/\.\w+$/.test(specifier)) {
      for (const suffix of ['.ts', '/index.ts', '.tsx']) {
        const url = new URL(specifier + suffix, context.parentURL)
        if (existsSync(url)) return nextResolve(url.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context)
    // Node handles .ts itself. For JSX use the project's existing build compiler.
    const ts = require('typescript')
    const source = readFileSync(new URL(url), 'utf8').replaceAll(
      'import.meta.env.BASE_URL',
      "'/kivotos-rig-studio/'",
    )
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        inlineSourceMap: true,
        inlineSources: true,
      },
    })
    return { format: 'module', shortCircuit: true, source: outputText }
  },
})
