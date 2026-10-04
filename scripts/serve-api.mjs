#!/usr/bin/env node

/**
 * serve-api.mjs — Standalone HTTP server for testing the Plugin Commons API.
 *
 * Mounts the *real* router from `lib/web-routes.js` on a plain Node server, so
 * the endpoints behave exactly as they do inside DSH. The plugin-manager
 * service is absent here, which is itself worth testing: `/installed` must
 * report `available: false` and the mutating endpoints must answer 503.
 *
 * Build first: `pnpm build`.
 *
 * Usage: pnpm build && node scripts/serve-api.mjs
 * Open:  http://localhost:3900
 */

import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setCatalog, setError, setLoading } from '../lib/market/catalog.js'
import {
  configureFetcher,
  fetchSnapshot,
  loadOrRefreshSnapshot,
  writeSnapshot,
} from '../lib/market/fetcher.js'
import { registerPluginCommonsRoutes } from '../lib/web-routes.js'

const PORT = Number.parseInt(process.env.PORT ?? '3900', 10)
const HOST = '127.0.0.1'

configureFetcher({
  cacheDir: join(homedir(), '.dsh', 'cache', 'plugin-commons', 'v1'),
  cacheTtlMs: 12 * 60 * 60 * 1000,
  maxPages: Number.parseInt(process.env.MAX_PAGES ?? '5', 10),
  pageSize: 100,
})

const loadCatalog = async () => {
  const snapshot = await loadOrRefreshSnapshot()
  setCatalog(snapshot.items, snapshot.total_count, snapshot.fetchedAt)
}
const refreshCatalog = async () => {
  setLoading()
  try {
    const snapshot = await fetchSnapshot()
    if (snapshot.items.length > 0) writeSnapshot(snapshot)
    setCatalog(snapshot.items, snapshot.total_count, snapshot.fetchedAt)
  } catch (error) {
    setError(String(error))
  }
}
const ready = loadCatalog().catch((error) => setError(String(error)))

// ---------------------------------------------------------------------------
// Mount the production router on a minimal WebServerLike adapter
// ---------------------------------------------------------------------------

/** @type {{kind: string, path: string, handler: Function}[]} */
const routes = []
const fakeWebServer = {
  register({ kind, path, handler }) {
    const row = { kind, path, handler }
    routes.push(row)
    return () => {
      const index = routes.indexOf(row)
      if (index >= 0) routes.splice(index, 1)
    }
  },
}

registerPluginCommonsRoutes(fakeWebServer, () => undefined, {
  refresh: refreshCatalog,
  ready: () => ready,
  // No management bundle in a bare Node process — this is the read-only case.
  manager: () => undefined,
  profileDir: () => process.env.DSH_PROFILE_DIR ?? null,
})

function dispatch(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  for (const route of routes) {
    const matches = route.kind === 'prefix' ? url.pathname.startsWith(route.path) : url.pathname === route.path
    if (matches) {
      void route.handler(req, res)
      return true
    }
  }
  return false
}

const server = createServer((req, res) => {
  if (dispatch(req, res)) return
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(infoPage())
})

server.listen(PORT, HOST, () => {
  console.log('\nDSH Plugin Commons API server (real router)')
  console.log(`  http://localhost:${PORT}`)
  console.log('  GET  /api/plugin-commons/status')
  console.log('  GET  /api/plugin-commons/plugins?page=1&limit=20&sort=stars')
  console.log('  GET  /api/plugin-commons/search?q=ai')
  console.log('  GET  /api/plugin-commons/categories')
  console.log('  GET  /api/plugin-commons/installed')
  console.log('  POST /api/plugin-commons/refresh')
  console.log('  POST /api/plugin-commons/install      {"spec":"..."}')
  console.log('  POST /api/plugin-commons/uninstall    {"name":"..."}\n')
})

function infoPage() {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>DSH Plugin Commons</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;background:#14142b;color:#e6e6f0}code,a{color:#8b9bff}h1{color:#fff}.ep{background:#1d1d3d;padding:10px;margin:8px 0;border-radius:6px;font-family:monospace;word-break:break-all}</style></head>
<body><h1>DSH 插件公社 · Plugin Commons</h1><p>社区共建，插件共享。</p>
<div class="ep"><a href="/api/plugin-commons/status">GET /api/plugin-commons/status</a></div>
<div class="ep"><a href="/api/plugin-commons/plugins?page=1&limit=20&sort=stars">GET /api/plugin-commons/plugins</a></div>
<div class="ep"><a href="/api/plugin-commons/search?q=ai">GET /api/plugin-commons/search?q=ai</a></div>
<div class="ep"><a href="/api/plugin-commons/categories">GET /api/plugin-commons/categories</a></div>
<div class="ep"><a href="/api/plugin-commons/installed">GET /api/plugin-commons/installed</a></div>
</body></html>`
}
