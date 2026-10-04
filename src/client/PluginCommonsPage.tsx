/**
 * Plugin Commons panel page.
 *
 * A self-contained React component: it fetches the host API, renders the
 * plugin catalogue, and installs or removes a plugin through the host's
 * management endpoints. It deliberately avoids the UI-primitives component
 * library so the browser half stays small and dependency-light.
 *
 * Installing a plugin changes the application's plugin tree, including this
 * panel's own client bundle, so a successful operation ends in one page reload
 * rather than pretending the running page is still current.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** The compact plugin shape served by `/api/plugin-commons/plugins`. */
interface Plugin {
  id: number
  name: string
  full_name: string
  description: string | null
  html_url: string
  stars: number
  forks: number
  language: string | null
  topics: string[]
  owner: { login: string; avatar_url: string }
  updated_at: string
}

interface ListResponse {
  items: Plugin[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

/** One installed bundle, as served by `/api/plugin-commons/installed`. */
interface InstalledPlugin {
  name: string
  version: string | null
  enabled: boolean
  removable: boolean
  blockedBy: string | null
  repository: string | null
}

interface InstalledResponse {
  available: boolean
  installed: InstalledPlugin[]
}

interface StatusResponse {
  status: {
    ready: boolean
    loading: boolean
    error: string | null
    total: number
    fetchedAt: number | null
    snapshotTotal: number
  }
  management: {
    available: boolean
    profileDir: string | null
  }
}

/** Per-repository work state the toolbar renders. */
type Busy = { name: string; kind: 'install' | 'uninstall'; startedAt: number } | null

/** Tab type. */
type TabId = 'market' | 'installed'

const CATEGORIES = [
  { id: 'all', name: '全部' },
  { id: 'ai-assistant', name: 'AI 助手' },
  { id: 'code-completion', name: '代码补全' },
  { id: 'file-management', name: '文件管理' },
  { id: 'browser-automation', name: '浏览器自动化' },
  { id: 'data-processing', name: '数据处理' },
  { id: 'communication', name: '通讯集成' },
  { id: 'development-tools', name: '开发工具' },
  { id: 'productivity', name: '效率工具' },
  { id: 'multimedia', name: '多媒体' },
  { id: 'testing', name: '测试工具' },
  { id: 'documentation', name: '文档工具' },
] as const

const SORTS = [
  { id: 'stars', name: '星标' },
  { id: 'forks', name: 'Fork' },
  { id: 'updated', name: '更新' },
] as const

/** How often the panel re-reads the installed list while an operation runs. */
const POLL_MS = 2000
/** Give up watching one operation after this long and tell the person. */
const OPERATION_TIMEOUT_MS = 5 * 60 * 1000

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return '今天'
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** Lowercase a repository URL so two spellings compare equal. */
function canonicalRepo(url: string): string {
  return url.trim().replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
}

/**
 * Match a catalogue entry to an installed bundle.
 *
 * The repository URL the package manifest declares is authoritative; the
 * `owner/repo` → `@owner/repo` name identity is the fallback for packages that
 * publish no `repository` field.
 */
function matchInstalled(plugin: Plugin, installed: InstalledPlugin[]): InstalledPlugin | undefined {
  const repo = canonicalRepo(plugin.html_url)
  const byRepository = installed.find((row) => row.repository !== null && canonicalRepo(row.repository) === repo)
  if (byRepository !== undefined) return byRepository
  const owner = plugin.full_name.split('/')[0]?.toLowerCase() ?? ''
  const name = plugin.name.toLowerCase()
  return installed.find((row) => {
    const candidate = row.name.toLowerCase()
    return candidate === name || candidate === `@${owner}/${name}`
  })
}

export function PluginCommonsPage(): JSX.Element {
  const [tab, setTab] = useState<TabId>('market')

  // Market tab state
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [total, setTotal] = useState(0)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [sort, setSort] = useState<string>('stars')

  const [installed, setInstalled] = useState<InstalledPlugin[]>([])
  const [managementAvailable, setManagementAvailable] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  // The polling effect must see the current operation without re-subscribing.
  const busyRef = useRef<Busy>(null)
  busyRef.current = busy

  const loadInstalled = useCallback(async (): Promise<InstalledPlugin[]> => {
    const res = await fetch('/api/plugin-commons/installed')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as InstalledResponse
    setManagementAvailable(data.available)
    setInstalled(data.installed)
    return data.installed
  }, [])

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch('/api/plugin-commons/status')
      if (!res.ok) return
      const data = (await res.json()) as StatusResponse
      if (data.status.fetchedAt) {
        const iso = new Date(data.status.fetchedAt).toISOString()
        setFetchedAt(formatDate(iso))
      }
    } catch { /* ignore */ }
  }, [])

  const load = useCallback(async (q: string, cat: string, s: string) => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ page: '1', limit: '60', sort: s })
      if (cat !== 'all') params.set('category', cat)
      if (q.trim() !== '') params.set('q', q.trim())
      const res = await fetch(`/api/plugin-commons/plugins?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as ListResponse
      setPlugins(data.items)
      setTotal(data.total)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    if (tab !== 'market') return
    void load(query, category, sort)
  }, [load, query, category, sort, tab])

  useEffect(() => {
    if (tab !== 'market' && tab !== 'installed') return
    void loadInstalled().catch(() => {
      setManagementAvailable(false)
    })
  }, [loadInstalled, tab])

  // One watcher for an accepted install/removal: poll until the profile
  // reflects it, then reload so the new plugin's client bundle is picked up.
  useEffect(() => {
    if (busy === null) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      if (cancelled) return
      try {
        const data = (await loadInstalled())
        const current = busyRef.current
        if (current === null || cancelled) return
        const plugin = plugins.find(
          (plugin) =>
            plugin !== undefined && matchInstalled(plugin, data) !== undefined
        )
        const rows = data
        const present = rows.some((row) => {
          if (current.kind === 'install') {
            return row.name === plugin?.name || row.name === plugin?.full_name.split('/').pop()
          } else {
            return row.name !== plugin?.name && row.name !== plugin?.full_name.split('/').pop()
          }
        })
        const done = current.kind === 'install' ? present : !present
        if (done) {
          setBusy(null)
          window.location.reload()
          return
        }
      } catch {
        /* a reload mid-poll is expected; keep waiting */
      }
      if (!cancelled) setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
    return () => {
      cancelled = true
    }
  }, [busy, plugins, loadInstalled])

  const search = useCallback((value: string) => {
    setQuery(value)
  }, [])

  const startOperation = useCallback(
    async (plugin: Plugin, kind: 'install' | 'uninstall', installedRow?: InstalledPlugin) => {
      setFailure(null)
      setNotice(null)
      const endpoint = kind === 'install' ? 'install' : 'uninstall'
      const body =
        kind === 'install'
          ? { spec: plugin.html_url, enabled: true }
          : { name: installedRow?.name ?? plugin.name }
      try {
        const res = await fetch(`/api/plugin-commons/${endpoint}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null
          throw new Error(payload?.error?.message ?? `HTTP ${res.status}`)
        }
        setNotice(
          kind === 'install'
            ? `正在安装 ${plugin.full_name}…完成后页面会自动刷新。`
            : `正在卸载 ${plugin.full_name}…完成后页面会自动刷新。`,
        )
        setBusy({ name: plugin.full_name, kind, startedAt: Date.now() })
      } catch (err) {
        setFailure(`${kind === 'install' ? '安装' : '卸载'}失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [],
  )

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const marketCardList = useMemo(
    () =>
      plugins.map((p) => {
        const row = matchInstalled(p, installed)
        const isBusy = busy?.name === p.full_name
        return (
          <div key={p.id} style={styles.card}>
            <div style={styles.cardHeader}>
              <a
                href={p.html_url}
                target="_blank"
                rel="noreferrer noopener"
                style={styles.pluginName}
              >
                {p.full_name}
              </a>
              <span style={styles.stars}>★ {formatNumber(p.stars)}</span>
            </div>
            {p.description !== null && <div style={styles.description}>{p.description}</div>}
            <div style={styles.metaRow}>
              {p.language !== null && <span style={styles.tag}>{p.language}</span>}
              {p.topics.slice(0, 3).map((t) => (
                <span key={t} style={styles.tag}>
                  {t}
                </span>
              ))}
              <span style={styles.metaRight}>{relativeTime(p.updated_at)}</span>
            </div>
            <div style={styles.actionRow}>
              {row !== undefined ? (
                <>
                  <span style={row.enabled ? styles.badgeOn : styles.badgeOff}>
                    {row.enabled ? '已启用' : '已安装 · 未启用'}
                  </span>
                  {row.version !== null && <span style={styles.badgeMuted}>v{row.version}</span>}
                  {row.removable && row.blockedBy === null ? (
                    <button
                      type="button"
                      style={styles.buttonDanger}
                      disabled={isBusy || !managementAvailable}
                      onClick={() => void startOperation(p, 'uninstall', row)}
                    >
                      {isBusy ? '处理中…' : '卸载'}
                    </button>
                  ) : (
                    <span style={styles.badgeMuted}>不可卸载</span>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  style={styles.buttonPrimary}
                  disabled={isBusy || !managementAvailable}
                  onClick={() => void startOperation(p, 'install')}
                >
                  {isBusy ? '安装中…' : '安装'}
                </button>
              )}
            </div>
          </div>
        )
      }),
    [plugins, installed, busy, managementAvailable, startOperation],
  )

  const installedCardList = useMemo(
    () =>
      installed.length === 0
        ? null
        : installed.map((row) => {
            const isBusy = busy && busy.name === row.name
            return (
              <div key={row.name} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={styles.pluginName}>{row.name}</span>
                  <span style={styles.stars}>v{row.version ?? '?'}</span>
                </div>
                <div style={styles.metaRow}>
                  {row.enabled ? (
                    <span style={styles.badgeOn}>已启用</span>
                  ) : (
                    <span style={styles.badgeOff}>已安装 · 未启用</span>
                  )}
                  {row.repository !== null && (
                    <a
                      href={row.repository}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ fontSize: '12px', opacity: 0.6 }}
                    >
                      {row.repository}
                    </a>
                  )}
                </div>
                <div style={styles.actionRow}>
                  {row.removable && row.blockedBy === null ? (
                    <button
                      type="button"
                      style={styles.buttonDanger}
                      disabled={isBusy || !managementAvailable}
                      onClick={() => {
                        // Find matching plugin to get full_name
                        const p = plugins.find((p) => matchInstalled(p, [row]) === row)
                        startOperation(
                          p ?? {
                            id: 0,
                            name: row.name,
                            full_name: row.name,
                            description: null,
                            html_url: row.repository ?? '',
                            stars: 0,
                            forks: 0,
                            language: null,
                            topics: [],
                            owner: { login: '', avatar_url: '' },
                            updated_at: new Date().toISOString(),
                          } as Plugin,
                          'uninstall',
                          row,
                        )
                      }}
                    >
                      {isBusy ? '处理中…' : '卸载'}
                    </button>
                  ) : (
                    <span style={styles.badgeMuted}>不可卸载</span>
                  )}
                </div>
              </div>
            )
          }),
    [installed, busy, managementAvailable, startOperation, plugins],
  )

  return (
    <div style={styles.root}>
      {/* Tabs */}
      <div style={styles.tabBar}>
        <button
          type="button"
          style={tab === 'market' ? styles.tabActive : styles.tab}
          onClick={() => setTab('market')}
        >
          插件市场
          <span style={styles.tabCount}>{total}</span>
        </button>
        <button
          type="button"
          style={tab === 'installed' ? styles.tabActive : styles.tab}
          onClick={() => setTab('installed')}
        >
          已安装插件
          <span style={styles.tabCount}>{installed.length}</span>
        </button>
      </div>

      {/* Market tab */}
      {tab === 'market' && (
        <>
          <header style={styles.header}>
            <div style={styles.heroIcon}>
              <svg width="36" height="36" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2.5" y="2.5" width="15" height="15" rx="3" />
                <path d="M8 2.5V5a1.6 1.6 0 0 0 3.2 0V2.5" fill="currentColor" fillOpacity={0.1} />
                <path d="M8 17.5V15a1.6 1.6 0 0 1 3.2 0v2.5" />
                <circle cx="10" cy="10" r="2.2" />
                <path d="M10 7.8V4.6M10 12.2v3.2M7.8 10H4.6M12.2 10h3.2" />
              </svg>
            </div>
            <div>
              <h1 style={styles.title}>插件公社</h1>
              <p style={styles.subtitle}>
                社区共建，插件共享 · 浏览并安装 GitHub 上的 dsh-plugin 插件
              </p>
            </div>
          </header>

          <div style={styles.toolbar}>
            <input
              style={styles.search}
              placeholder="搜索插件名称、描述或关键词"
              value={query}
              onChange={(e) => search(e.target.value)}
            />
          </div>

          <div style={styles.filters}>
            <div style={styles.filterGroup}>
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  style={category === c.id ? styles.chipActive : styles.chip}
                  onClick={() => setCategory(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <div style={styles.filterGroup}>
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  style={sort === s.id ? styles.chipActive : styles.chip}
                  onClick={() => setSort(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <div style={styles.summary}>
            共 <strong>{total}</strong> 个插件
            {fetchedAt && <> · 清单更新于 {fetchedAt}</>}
            {!managementAvailable && <><br />当前 profile 未挂载插件管理器，仅可浏览</>}
          </div>

          {notice !== null && <div style={styles.notice}>{notice}</div>}
          {failure !== null && <div style={styles.failure}>{failure}</div>}

          {loading ? (
            <div style={styles.state}>正在加载…</div>
          ) : error ? (
            <div style={styles.state}>加载失败，请刷新重试</div>
          ) : plugins.length === 0 ? (
            <div style={styles.state}>
              {query || category !== 'all' ? '没有匹配的插件' : '目录尚未加载完成，稍后再试。'}
            </div>
          ) : (
            <div style={styles.list}>{marketCardList}</div>
          )}
        </>
      )}

      {/* Installed tab */}
      {tab === 'installed' && (
        <>
          <header style={styles.header}>
            <div style={styles.heroIcon}>
              <svg width="36" height="36" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 10l4 4 8-8" />
              </svg>
            </div>
            <div>
              <h1 style={styles.title}>已安装插件</h1>
              <p style={styles.subtitle}>
                管理已安装的插件
              </p>
            </div>
          </header>

          <div style={styles.summary}>
            共 <strong>{installed.length}</strong> 个已安装插件
            {!managementAvailable && <><br />当前 profile 未挂载插件管理器</>}
          </div>

          {installedCardList ?? (
            <div style={styles.state}>暂无已安装插件</div>
          )}
        </>
      )}

      <footer style={styles.footer}>
        插件由第三方社区作者发布；插件公社是社区项目，并非 DeepSeek 官方出品。
      </footer>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflowY: 'auto',
    padding: '0',
    boxSizing: 'border-box',
    color: 'var(--dsw-alias-label-primary, #12141a)',
  },
  tabBar: {
    display: 'flex',
    gap: '28px',
    borderBottom: '1px solid var(--dsw-alias-border-l2, #e4e6eb)',
    padding: '0 28px',
    margin: '0',
  },
  tab: {
    color: 'var(--dsw-alias-label-secondary, #4a4f5c)',
    font: 'inherit',
    background: 'none',
    border: 'none',
    padding: '10px 0 12px',
    fontSize: '14px',
    lineHeight: '21px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    position: 'relative',
  },
  tabActive: {
    color: 'var(--dsw-alias-label-primary, #12141a)',
    font: 'inherit',
    background: 'none',
    border: 'none',
    padding: '10px 0 12px',
    fontSize: '14px',
    lineHeight: '21px',
    cursor: 'default',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    position: 'relative',
    fontWeight: 600,
  },
  tabCount: {
    background: 'color-mix(in srgb, var(--dsw-alias-label-primary, #12141a) 6%, transparent)',
    color: 'var(--dsw-alias-label-secondary, #4a4f5c)',
    borderRadius: '999px',
    padding: '0 7px',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '18px',
  },
  header: {
    display: 'flex',
    gap: '16px',
    padding: '24px 28px 0',
    alignItems: 'flex-start',
  },
  heroIcon: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    background: 'var(--dsw-alias-bg-layer-1, #fff)',
    border: '1px solid var(--dsw-alias-border-l2, #e4e6eb)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--dsw-alias-label-secondary, #4a4f5c)',
    flexShrink: 0,
  },
  title: { margin: 0, fontSize: '20px', fontWeight: 700, letterSpacing: '-0.01em' },
  subtitle: { margin: '4px 0 0', fontSize: '13px', color: 'var(--dsw-alias-label-tertiary, #6b7080)', lineHeight: 1.5 },
  toolbar: { padding: '16px 28px 0' },
  search: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-border-l2, #e4e6eb)',
    background: 'transparent',
    fontSize: '14px',
    color: 'inherit',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  filters: { padding: '8px 28px 0' },
  filterGroup: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' },
  chip: {
    padding: '4px 10px',
    borderRadius: '999px',
    border: '1px solid var(--dsw-alias-border-l2, #e4e6eb)',
    background: 'transparent',
    fontSize: '12px',
    color: 'var(--dsw-alias-label-secondary, #4a4f5c)',
    cursor: 'pointer',
  },
  chipActive: {
    padding: '4px 10px',
    borderRadius: '999px',
    border: '1px solid var(--dsw-alias-state-business-primary, #2f49d1)',
    background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f49d1) 10%, transparent)',
    fontSize: '12px',
    color: 'var(--dsw-alias-state-business-primary, #2f49d1)',
    cursor: 'pointer',
    fontWeight: 500,
  },
  summary: {
    fontSize: '13px',
    color: 'var(--dsw-alias-label-tertiary, #6b7080)',
    padding: '4px 28px 0',
  },
  notice: {
    padding: '8px 28px',
    borderRadius: '8px',
    border: '1px solid rgba(100,130,255,0.4)',
    background: 'rgba(100,130,255,0.1)',
    fontSize: '12px',
    color: 'var(--dsw-alias-state-business-primary, #2f49d1)',
  },
  failure: {
    padding: '8px 28px',
    borderRadius: '8px',
    border: '1px solid rgba(230,90,90,0.5)',
    background: 'rgba(230,90,90,0.1)',
    fontSize: '12px',
    color: '#e65a5a',
  },
  state: {
    padding: '40px 28px',
    textAlign: 'center',
    opacity: 0.6,
    fontSize: '14px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px 28px 20px',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '14px 16px',
    borderRadius: '10px',
    border: '1px solid var(--dsw-alias-border-l2, #e4e6eb)',
    background: 'var(--dsw-alias-bg-layer-1, #fff)',
    color: 'inherit',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  pluginName: {
    fontWeight: 600,
    fontSize: '14px',
    color: 'inherit',
    textDecoration: 'none',
  },
  stars: { fontSize: '13px', opacity: 0.8, whiteSpace: 'nowrap' },
  description: { fontSize: '13px', opacity: 0.8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  metaRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' },
  metaRight: { fontSize: '12px', opacity: 0.5, marginLeft: 'auto' },
  tag: {
    padding: '2px 8px',
    borderRadius: '999px',
    background: 'rgba(128,128,128,0.1)',
    fontSize: '11px',
    opacity: 0.7,
  },
  actionRow: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' },
  badgeOn: {
    padding: '2px 8px',
    borderRadius: '6px',
    background: 'rgba(27,107,69,0.12)',
    color: '#1b6b45',
    fontSize: '12px',
    fontWeight: 500,
  },
  badgeOff: {
    padding: '2px 8px',
    borderRadius: '6px',
    background: 'rgba(200,160,60,0.18)',
    fontSize: '11px',
    color: '#8a4b00',
  },
  badgeMuted: { fontSize: '11px', opacity: 0.55 },
  buttonPrimary: {
    marginLeft: 'auto',
    padding: '5px 14px',
    borderRadius: '7px',
    border: '1px solid var(--dsw-alias-state-business-primary, #2f49d1)',
    background: 'var(--dsw-alias-state-business-primary, #2f49d1)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  buttonDanger: {
    marginLeft: 'auto',
    padding: '5px 14px',
    borderRadius: '7px',
    border: '1px solid rgba(230,90,90,0.5)',
    background: 'transparent',
    color: '#e65a5a',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  footer: {
    marginTop: 'auto',
    paddingTop: '16px',
    fontSize: '12px',
    opacity: 0.55,
    textAlign: 'center',
    padding: '16px 28px',
  },
}
