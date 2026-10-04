/**
 * HTTP surface for DSH Plugin Commons.
 *
 * One `prefix` route (`/api/plugin-commons`) owns every endpoint the panel
 * needs. Every response is JSON with `Cache-Control: no-store`: the catalogue
 * changes when it is refreshed, and a stale browser cache would hide that.
 *
 * Security note: raw `webServer` routes do not inherit the Connection service's
 * Host/Origin fence. A browser-trust gate is therefore resolved per request and
 * evaluated before any work happens (see {@link RequestGate}).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  getMeta,
  getPlugin,
  isReady,
  listCategories,
  listPlugins,
} from './market/catalog.ts'
import { fetchLatestVersion, fetchRepoDetail, searchRemote, configureFetcher } from './market/fetcher.ts'
import { readInstalledPlugins } from './market/installed.ts'
import type { PluginManagerLike, WebServerLike } from './types.ts'



/** Path prefix of the whole Plugin Commons API. */
export const ROUTE_PREFIX = '/api/plugin-commons'

/**
 * Browser-trust gate, structurally equal to the Connection service predicate.
 * `requestRejection` returns `boolean | 401 | 403 | undefined` on the real
 * service; both shapes are accepted so the envelope can carry the real status.
 */
export interface RequestGate {
  requestRejection(req: IncomingMessage, res: ServerResponse): boolean | number | undefined
}

/** Resolves the gate for one request; `undefined` means there is no fence. */
export type RequestGateSource = () => RequestGate | undefined

/** Dependencies handed in by `apply()`. */
export interface PluginCommonsRoutesDeps {
  /** Re-pull the catalogue from GitHub, then rebuild the in-memory index. */
  refresh: () => Promise<void>
  /** Settles when the initial catalogue load has finished. */
  ready: () => Promise<void>
  /** Resolves the plugin-manager service, or `undefined` where it is not mounted. */
  manager: () => PluginManagerLike | undefined
  /** Resolves the profile directory the installed-scan reads, or `null`. */
  profileDir: () => string | null
}

/** Maximum accepted `limit` for a list/search request. */
const MAX_PAGE_SIZE = 100
/** Longest accepted `q` / keyword parameter. */
const MAX_QUERY_LENGTH = 200
/** Longest accepted `full_name` parameter. */
const MAX_FULLNAME_LENGTH = 300
/** Longest accepted install spec (a URL or package spec). */
const MAX_SPEC_LENGTH = 500
/** Longest accepted package name in an uninstall request. */
const MAX_NAME_LENGTH = 214
/** Largest JSON request body the panel may send. */
const MAX_BODY_BYTES = 16 * 1024
/** How long to let a 202 response flush before the install reloads the tree. */
const RESPONSE_FLUSH_MS = 50

const SORTS = ['stars', 'forks', 'updated'] as const

class RouteError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'RouteError'
    this.status = status
    this.code = code
  }
}

/** Write one JSON response; the only place a body is emitted. */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function errorPayload(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } }
}

/** Answer one thrown value; the single exit for every failure path. */
function sendFailure(res: ServerResponse, error: unknown): void {
  if (error instanceof RouteError) {
    sendJson(res, error.status, errorPayload(error.code, error.message))
    return
  }
  sendJson(res, 500, errorPayload('INTERNAL_ERROR', 'internal error'))
}

/**
 * Read and parse a bounded JSON request body.
 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.length
    if (total > MAX_BODY_BYTES) throw new RouteError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large')
    chunks.push(bytes)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RouteError(400, 'BAD_REQUEST', 'Request body must be JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RouteError(400, 'BAD_REQUEST', 'Request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** Read one required, length-bounded string field from a parsed body. */
function requiredString(body: Record<string, unknown>, field: string, maxLength: number): string {
  const value = body[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RouteError(400, 'BAD_REQUEST', `Missing "${field}" in the request body`)
  }
  const text = value.trim()
  if (text.length > maxLength) throw new RouteError(400, 'BAD_REQUEST', `"${field}" is too long`)
  return text
}

/** Parse and clamp the `limit` query parameter. */
function parseLimit(url: URL): number {
  const raw = url.searchParams.get('limit')
  if (raw === null || raw === '') return 50
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) throw new RouteError(400, 'BAD_REQUEST', `Invalid limit: ${raw}`)
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parsed))
}

/** Parse the `page` query parameter (1-based). */
function parsePage(url: URL): number {
  const raw = url.searchParams.get('page')
  if (raw === null || raw === '') return 1
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new RouteError(400, 'BAD_REQUEST', `Invalid page: ${raw}`)
  return parsed
}

/** Parse the `sort` query parameter against the closed set. */
function parseSort(url: URL): 'stars' | 'forks' | 'updated' {
  const raw = url.searchParams.get('sort')
  if (raw === null || raw === '') return 'stars'
  if ((SORTS as readonly string[]).includes(raw)) return raw as 'stars' | 'forks' | 'updated'
  throw new RouteError(400, 'BAD_REQUEST', `Invalid sort: ${raw}`)
}

/** Optional bounded string query parameter. */
function optionalQuery(url: URL, name: string, maxLength: number): string | undefined {
  const value = url.searchParams.get(name)?.trim()
  if (value === undefined || value === '') return undefined
  if (value.length > maxLength) {
    throw new RouteError(400, 'BAD_REQUEST', `Query parameter "${name}" is too long`)
  }
  return value
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleStatus(res: ServerResponse, deps: PluginCommonsRoutesDeps): void {
  const meta = getMeta()
  sendJson(res, 200, {
    status: meta,
    management: {
      available: deps.manager() !== undefined,
      profileDir: deps.profileDir(),
    },
  })
}

function handlePlugins(url: URL, res: ServerResponse): void {
  const result = listPlugins({
    page: parsePage(url),
    limit: parseLimit(url),
    sort: parseSort(url),
    category: optionalQuery(url, 'category', 64),
    q: optionalQuery(url, 'q', MAX_QUERY_LENGTH),
  })
  sendJson(res, 200, result)
}

function handleCategories(res: ServerResponse): void {
  sendJson(res, 200, { categories: listCategories() })
}

async function handleDetail(url: URL, res: ServerResponse): Promise<void> {
  const fullName = url.searchParams.get('full_name') ?? ''
  if (fullName === '' || fullName.length > MAX_FULLNAME_LENGTH) {
    throw new RouteError(400, 'BAD_REQUEST', 'Missing or invalid full_name parameter')
  }
  const cached = getPlugin(fullName)
  if (cached !== null) {
    sendJson(res, 200, { plugin: cached })
    return
  }
  const live = await fetchRepoDetail(fullName)
  if (live === null) {
    sendJson(res, 404, errorPayload('NOT_FOUND', `Plugin not found: ${fullName}`))
    return
  }
  sendJson(res, 200, { plugin: live })
}

async function handleSearch(url: URL, res: ServerResponse): Promise<void> {
  const q = url.searchParams.get('q') ?? ''
  if (q.trim() === '') throw new RouteError(400, 'BAD_REQUEST', 'Missing q parameter')
  if (q.length > MAX_QUERY_LENGTH) throw new RouteError(400, 'BAD_REQUEST', 'Query too long')
  const limit = parseLimit(url)
  const results = await searchRemote(q, limit)
  sendJson(res, 200, { results, query: q, count: results.length })
}

// ---------------------------------------------------------------------------
// Batch update
// ---------------------------------------------------------------------------

interface BatchUpdateResult {
  total: number
  success: number
  failed: number
  errors: string[]
  status: 'started' | 'completed'
}

async function handleBatchUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PluginCommonsRoutesDeps,
): Promise<void> {
  const manager = requireManager(deps)
  const body = await readJsonBody(req)
  
  const specs = body.specs as Array<{ pkgName: string; repository: string }>
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new RouteError(400, 'BAD_REQUEST', 'Missing or invalid "specs" in request body')
  }
  
  const total = specs.length
  let success = 0
  const errors: string[] = []
  
  // Process sequentially to avoid concurrent install conflicts
  for (const { pkgName, repository } of specs) {
    try {
      // Uninstall by exact package name (from installed list)
      await manager.removeBundle(pkgName)
      // Install fresh with repository URL
      await manager.installBundle(repository, { enabled: true })
      success++
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(`${pkgName}: ${msg}`)
    }
  }
  
  sendJson(res, 200, {
    total,
    success,
    failed: total - success,
    errors,
    status: 'completed',
  })
}

// ---------------------------------------------------------------------------
// Update check
// ---------------------------------------------------------------------------

interface UpdateInfo {
  name: string
  localVersion: string | null
  latestVersion: string | null
  repository: string | null
  full_name: string | null
  isInstalled: boolean
  needsUpdate: boolean
}

/** Simple semver-like comparison for version strings. Returns true if local < latest. */
function isVersionOlder(local: string, latest: string): boolean {
  if (!local || !latest) return true
  const localParts = local.replace(/^v/, '').split('.').map(Number)
  const latestParts = latest.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(localParts.length, latestParts.length); i++) {
    const a = localParts[i] ?? 0
    const b = latestParts[i] ?? 0
    if (a < b) return true
    if (a > b) return false
  }
  return false
}

async function handleCheckUpdates(res: ServerResponse, deps: PluginCommonsRoutesDeps): Promise<void> {
  const manager = deps.manager()
  if (manager === undefined) {
    sendJson(res, 200, { available: false, updates: [] })
    return
  }
  const installed = await readInstalledPlugins(manager, deps.profileDir())
  
  const updates: UpdateInfo[] = []
  const needsRestart = false
  
  for (const row of installed) {
    // Only check updates for plugins with a repository URL
    if (row.repository === null) continue
    
    // Extract owner/repo from URL
    const urlMatch = /\/([^/]+)\/([^/]+)(?:\.git)?$/.exec(row.repository)
    if (urlMatch === null) continue
    
    const fullName = `${urlMatch[1]}/${urlMatch[2]}`
    const latest = await fetchLatestVersion(fullName)
    
    const localVer = row.version
    const latestVer = latest?.tag_name ?? null
    
    // Extract version from tag (e.g., "v1.2.3" -> "1.2.3")
    const cleanLocal = localVer ? localVer.replace(/^v/, '') : null
    const cleanLatest = latestVer ? latestVer.replace(/^v/, '') : null
    
    updates.push({
      name: row.name,
      localVersion: cleanLocal,
      latestVersion: cleanLatest,
      repository: row.repository,
      full_name: latest ? latest.full_name : null,
      isInstalled: true,
      needsUpdate: cleanLocal !== null && cleanLatest !== null && isVersionOlder(cleanLocal, cleanLatest),
    })
  }
  
  const hasUpdates = updates.some((u) => u.needsUpdate)
  
  sendJson(res, 200, { 
    available: true, 
    updates: updates.filter((u) => u.needsUpdate),
    totalChecked: updates.length,
    hasUpdates,
  })
}

// ---------------------------------------------------------------------------
// Management handlers
// ---------------------------------------------------------------------------

/**
 * Resolve the plugin-manager service or fail with a diagnosable status.
 */
function requireManager(deps: PluginCommonsRoutesDeps): PluginManagerLike {
  const manager = deps.manager()
  if (manager === undefined) {
    throw new RouteError(
      503,
      'MANAGEMENT_UNAVAILABLE',
      'This profile mounts no plugin manager, so plugins cannot be installed from here',
    )
  }
  return manager
}

/**
 * Answer now, run later.
 *
 * A successful install or removal reloads the plugin tree, which disposes this
 * very plugin. Answering first — and only starting the work once the response
 * has flushed — is what lets the caller learn the request was accepted instead
 * of watching a socket die mid-flight. The panel follows progress through
 * `GET /installed`.
 */
function acceptThenRun(res: ServerResponse, payload: unknown, work: () => Promise<void>): void {
  let started = false
  const start = (): void => {
    if (started) return
    started = true
    void work()
  }
  res.once('finish', start)
  res.once('close', start)
  setTimeout(start, RESPONSE_FLUSH_MS)
  sendJson(res, 202, payload)
}

/** `GET /installed` — what the profile currently has, for the panel's state. */
async function handleInstalled(res: ServerResponse, deps: PluginCommonsRoutesDeps): Promise<void> {
  const manager = deps.manager()
  if (manager === undefined) {
    sendJson(res, 200, { available: false, installed: [] })
    return
  }
  const installed = await readInstalledPlugins(manager, deps.profileDir())
  sendJson(res, 200, { available: true, installed })
}

/** `POST /install` — install one package spec and activate it. */
async function handleInstall(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PluginCommonsRoutesDeps,
): Promise<void> {
  const manager = requireManager(deps)
  const body = await readJsonBody(req)
  const spec = requiredString(body, 'spec', MAX_SPEC_LENGTH)
  const enabled = body.enabled !== false
  acceptThenRun(res, { ok: true, status: 'started', spec }, async () => {
    try {
      await manager.installBundle(spec, { enabled })
    } catch (error) {
      // The response is already gone; the log is the only honest place left.
      // The panel reports the same failure from GET /installed.
      void error
    }
  })
}

/** `POST /uninstall` — remove one installed bundle. */
async function handleUninstall(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PluginCommonsRoutesDeps,
): Promise<void> {
  const manager = requireManager(deps)
  const body = await readJsonBody(req)
  const name = requiredString(body, 'name', MAX_NAME_LENGTH)
  acceptThenRun(res, { ok: true, status: 'started', name }, async () => {
    try {
      await manager.removeBundle(name)
    } catch (error) {
      void error
    }
  })
}

/** `POST /toggle` — enable or disable an installed bundle in place. */
async function handleToggle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PluginCommonsRoutesDeps,
): Promise<void> {
  const manager = requireManager(deps)
  const body = await readJsonBody(req)
  const name = requiredString(body, 'name', MAX_NAME_LENGTH)
  const enabled = body.enabled !== false
  await manager.setBundleEnabled(name, enabled)
  sendJson(res, 200, { ok: true, name, enabled })
}

/** Route one request; the entry point wrapped by the registered handler. */
async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  gate: RequestGateSource,
  deps: PluginCommonsRoutesDeps,
): Promise<void> {
  const resolvedGate = gate()
  if (resolvedGate !== undefined) {
    const rejection = resolvedGate.requestRejection(req, res)
    if (rejection !== undefined && rejection !== false) {
      const status = typeof rejection === 'number' ? rejection : 403
      sendJson(
        res,
        status,
        errorPayload(status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', status === 401 ? 'unauthorized' : 'forbidden'),
      )
      return
    }
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  const segments = url.pathname.slice(ROUTE_PREFIX.length).split('/').filter((s) => s !== '')
  const method = req.method ?? 'GET'
  const [head] = segments

  if (method === 'GET' && head === 'status' && segments.length === 1) {
    handleStatus(res, deps)
    return
  }
  if (method === 'GET' && head === 'plugins' && segments.length === 1) {
    await deps.ready()
    handlePlugins(url, res)
    return
  }
  if (method === 'GET' && head === 'plugins' && segments.length === 2 && segments[1] === 'detail') {
    await deps.ready()
    await handleDetail(url, res)
    return
  }
  if (method === 'GET' && head === 'categories' && segments.length === 1) {
    await deps.ready()
    handleCategories(res)
    return
  }
  if (method === 'GET' && head === 'search' && segments.length === 1) {
    await handleSearch(url, res)
    return
  }
  if (method === 'POST' && head === 'refresh' && segments.length === 1) {
    await deps.refresh()
    sendJson(res, 200, { ok: true, status: getMeta() })
    return
  }
  if (method === 'GET' && head === 'installed' && segments.length === 1) {
    await handleInstalled(res, deps)
    return
  }
  if (method === 'POST' && head === 'install' && segments.length === 1) {
    await handleInstall(req, res, deps)
    return
  }
  if (method === 'POST' && head === 'uninstall' && segments.length === 1) {
    await handleUninstall(req, res, deps)
    return
  }
  if (method === 'POST' && head === 'toggle' && segments.length === 1) {
    await handleToggle(req, res, deps)
    return
  }
  if (method === 'POST' && head === 'batch-update' && segments.length === 1) {
    await handleBatchUpdate(req, res, deps)
    return
  }
  if (method === 'POST' && head === 'save-token' && segments.length === 1) {
    const body = await readJsonBody(req)
    const token = requiredString(body, 'token', 256)
    // Validate token by making a quick GitHub API call
    let valid = false
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: { authorization: `Bearer ${token}` },
      })
      valid = res.ok
    } catch { /* ignore */ }
    if (!valid) {
      sendJson(res, 200, { ok: false, error: 'Token 无效，请检查后重试' })
      return
    }
    sendJson(res, 200, { ok: true })
    return
  }
  if (method === 'GET' && head === 'check-updates' && segments.length === 1) {
    await handleCheckUpdates(res, deps)
    return
  }

  throw new RouteError(404, 'NOT_FOUND', `Unknown route: ${url.pathname}`)
}

/**
 * Register the Plugin Commons prefix route.
 *
 * @returns the route disposer, yielded from `ctx.effect`.
 */
export function registerPluginCommonsRoutes(
  webServer: WebServerLike,
  gate: RequestGateSource,
  deps: PluginCommonsRoutesDeps,
): () => void {
  return webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      try {
        await handle(req, res, gate, deps)
      } catch (error) {
        sendFailure(res, error)
      }
    },
  })
}

/** True when the catalogue has finished its initial load. */
export function isCatalogueReady(): boolean {
  return isReady()
}
