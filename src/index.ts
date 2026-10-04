/**
 * DSH Plugin Commons — DeepSeek Harness host plugin.
 *
 * Adds the Plugin Commons catalogue to a DSH profile:
 *
 *   - `/api/plugin-commons/*` (status, plugins, categories, search, detail,
 *     refresh) served from the composition's Web server;
 *   - a GitHub-backed catalogue of every repository tagged `dsh-plugin`, seeded
 *     from a bounded snapshot and searchable live against the full corpus.
 *
 * Installation is pure HTTP + filesystem cache: no agent session is involved
 * and the tools registry is untouched.
 *
 * @module dsh-plugin-commons
 */

import type { Context } from '@deepseek-ai/cordis'
import * as path from 'node:path'
import { resolveDshHome, resolveProfileDir } from './utils/paths.ts'
import {
  configureFetcher,
  fetchSnapshot,
  loadOrRefreshSnapshot,
  writeSnapshot,
} from './market/fetcher.ts'
import { setCatalog, setError, setLoading } from './market/catalog.ts'
import {
  registerPluginCommonsRoutes,
  type PluginCommonsRoutesDeps,
  type RequestGate,
  type RequestGateSource,
} from './web-routes.ts'
import type { PluginManagerLike, WebServerLike } from './types.ts'

export const name = 'plugin-commons'

/**
 * Required services.
 *
 * Empty on purpose: the plugin must *load* in every profile. The Web server is
 * looked up lazily and bound whenever it appears, so a headless profile keeps
 * the plugin inert instead of failing on a service key the composition never
 * provides.
 */
export const inject: string[] = []

/** Web-server service keys, newest first. */
const WEB_SERVER_KEYS = ['webServer', 'httpServer'] as const

/** User-facing configuration, all optional. */
export interface PluginConfig {
  /** GitHub personal access token for higher rate limits. */
  githubToken?: string
  /** Snapshot time-to-live in hours (default 12). */
  cacheTtlHours?: number
  /** Number of pages to pull for the seed catalogue (default 20, ~2000 repos covers most plugins). */
  maxPages?: number
  /** Page size for paginated search (default 100). */
  pageSize?: number
}

/** Apply defaults and coerce the config into the shape the fetcher expects. */
function resolveConfig(config: PluginConfig | undefined): Required<Omit<PluginConfig, 'githubToken'>> & { githubToken?: string } {
  return {
    githubToken: config?.githubToken,
    cacheTtlHours: config?.cacheTtlHours ?? 12,
    maxPages: config?.maxPages ?? 20,
    pageSize: config?.pageSize ?? 100,
  }
}

/**
 * Activate the plugin.
 *
 * @param ctx - host plugin context.
 * @param config - plugin configuration (schema defaults already applied).
 */
export function apply(ctx: Context, config?: PluginConfig): void {
  const resolved = resolveConfig(config)

  configureFetcher({
    token: resolved.githubToken,
    cacheDir: path.join(resolveDshHome(), 'cache', 'plugin-commons', 'v1'),
    cacheTtlMs: resolved.cacheTtlHours * 60 * 60 * 1000,
    maxPages: resolved.maxPages,
    pageSize: resolved.pageSize,
  })

  let disposed = false

  /** Pull the seed catalogue from disk cache or GitHub, then publish it. */
  const loadCatalog = async (): Promise<void> => {
    const snapshot = await loadOrRefreshSnapshot()
    if (disposed) return
    setCatalog(snapshot.items, snapshot.total_count, snapshot.fetchedAt)
  }

  /** Force a fresh pull from GitHub (used by `POST /refresh`). */
  const refreshCatalog = async (): Promise<void> => {
    setLoading()
    try {
      const snapshot = await fetchSnapshot()
      if (snapshot.items.length > 0) writeSnapshot(snapshot)
      if (disposed) return
      setCatalog(snapshot.items, snapshot.total_count, snapshot.fetchedAt)
    } catch (error) {
      setError(String(error))
    }
  }

  // Apply is synchronous, but the catalogue loads in the background. Handlers
  // wait on this promise so the first request sees data instead of an empty list.
  const initialLoad = loadCatalog().catch((error) => {
    setError(String(error))
    ctx.logger.warn(`plugin-commons: initial catalogue load failed: ${String(error)}`)
  })

  ctx.effect(() => () => {
    disposed = true
  }, 'plugin-commons: activation state')

  // The Web server may bind before or after this plugin (the Loader activates
  // rows concurrently), and older compositions name the service `httpServer`.
  let webRegistered = false
  const registerWebSurface = (): void => {
    if (webRegistered) return
    const webServer = (ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])) as WebServerLike | undefined
    if (webServer === undefined) return

    // Resolved per request: the Connection row can activate after this route is
    // registered, and a captured snapshot would leave the API unfenced.
    const gate: RequestGateSource = () =>
      ctx.get('connection') as RequestGate | undefined

    const deps: PluginCommonsRoutesDeps = {
      refresh: refreshCatalog,
      ready: () => initialLoad,
      // Resolved per request: the management bundle can activate after this
      // route is registered (rows activate concurrently), and profiles without
      // it must stay browse-only rather than fail to load.
      manager: () => ctx.get('pluginManager') as PluginManagerLike | undefined,
      // `profileContext` is the profile this process actually booted; the
      // environment is only a fallback, because an inherited `DSH_PROFILE_DIR`
      // can name a different profile than the running one.
      profileDir: () => {
        const context = ctx.get('profileContext') as { dir?: unknown } | undefined
        const dir = context?.dir
        if (typeof dir === 'string' && dir.trim() !== '') return dir.trim()
        return resolveProfileDir()
      },
    }

    // The factory returns the route disposer; `webServer.register` throws on a
    // duplicate path, so the flag is set only after registration succeeds.
    ctx.effect(() => registerPluginCommonsRoutes(webServer, gate, deps), 'plugin-commons: HTTP API')
    webRegistered = true
  }
  registerWebSurface()
  ctx.on('internal/service', (serviceName: string) => {
    if (serviceName === WEB_SERVER_KEYS[0] || serviceName === WEB_SERVER_KEYS[1]) registerWebSurface()
  })

  ctx.logger.info(
    `plugin-commons: ready (cache=${path.join(resolveDshHome(), 'cache', 'plugin-commons')}, ttl=${resolved.cacheTtlHours}h, maxPages=${resolved.maxPages})`,
  )
}
