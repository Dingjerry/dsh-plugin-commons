/**
 * Plugin Commons panel page.
 *
 * A self-contained React component: it fetches the host API, renders the
 * plugin catalogue, and installs or removes a plugin through the host's
 * management endpoints. It deliberately avoids the UI-primitives component
 * library so the browser half stays small and dependency-light.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
  latestVersion?: string | null
  needsUpdate?: boolean
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
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
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

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase()
}

function getRandomColor(name: string): string {
  const colors = [
    '#5B90FF', '#7ED321', '#F5A623', '#D0D0D0', '#BA508F',
    '#5B90FF', '#FF6B6B', '#9B59B6', '#00B894', '#FDCB6E',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const idx = Math.abs(hash) % colors.length
  return colors[idx]!
}

/**
 * Match a catalogue entry to an installed bundle.
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
  const [hasMore, setHasMore] = useState(false)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [sort, setSort] = useState<string>('stars')

  const [installed, setInstalled] = useState<InstalledPlugin[]>([])
  const [managementAvailable, setManagementAvailable] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [showTokenConfig, setShowTokenConfig] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [tokenConfiguring, setTokenConfiguring] = useState(false)

  // Update check state
  const [hasUpdates, setHasUpdates] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [updateList, setUpdateList] = useState<{ name: string; local: string | null; latest: string; repository: string; pkgName: string }[]>([])

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

  const checkUpdates = useCallback(async (): Promise<void> => {
    setUpdating(true)
    setFailure(null)
    try {
      const res = await fetch('/api/plugin-commons/check-updates')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setHasUpdates(data.hasUpdates)
      if (data.hasUpdates && data.updates) {
        setUpdateList(data.updates.map((u: any) => ({ name: u.name, local: u.localVersion, latest: u.latestVersion, repository: u.repository, pkgName: u.name })))
        setShowUpdateDialog(true)
      }
    } catch (err) {
      setFailure(`检查更新失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUpdating(false)
    }
  }, [])

  const batchUpdate = useCallback(async (): Promise<void> => {
    setFailure(null)
    setNotice(`正在批量更新 ${updateList.length} 个插件…完成后将自动刷新。`)
    setShowUpdateDialog(false)
    try {
      const specs = updateList.map((u) => ({ pkgName: u.pkgName, repository: u.repository }))
      const res = await fetch('/api/plugin-commons/batch-update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ specs }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.failed > 0) {
        setFailure(`批量更新完成：${data.success} 成功，${data.failed} 失败。${data.errors?.join('; ')}`)
      } else {
        setNotice(`所有 ${data.success} 个插件已更新成功！页面将自动刷新…`)
      }
      setTimeout(() => { window.location.reload() }, data.failed > 0 ? 5000 : 2000)
    } catch (err) {
      setFailure(`批量更新失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [updateList])

  const saveToken = useCallback(async (): Promise<void> => {
    if (!tokenInput.trim()) {
      setFailure('请输入有效的 GitHub Token')
      return
    }
    setTokenConfiguring(true)
    setFailure(null)
    try {
      const res = await fetch('/api/plugin-commons/save-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.ok) {
        setNotice('GitHub Token 已保存，正在刷新插件列表…')
        setShowTokenConfig(false)
        setTokenInput('')
        setTimeout(() => { window.location.reload() }, 1500)
      } else {
        setFailure(data.error || '保存失败')
      }
    } catch (err) {
      setFailure(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTokenConfiguring(false)
    }
  }, [tokenInput])

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

  const pageRef = useRef(page)
  pageRef.current = page

  const load = useCallback(async (q: string, cat: string, s: string, pg: number) => {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ page: String(pg), limit: '30', sort: s })
      if (cat !== 'all') params.set('category', cat)
      if (q.trim() !== '') params.set('q', q.trim())
      const res = await fetch(`/api/plugin-commons/plugins?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as ListResponse
      setPlugins(data.items)
      setTotal(data.total)
      setHasMore(data.hasMore)
      if (pg !== pageRef.current) setPage(pg)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadMeta() }, [loadMeta])

  useEffect(() => {
    if (tab !== 'market') return
    // Initial load / reload on category, sort, or tab changes (not query)
    void load(query, category, sort, page)
  }, [load, category, sort, tab])

  useEffect(() => {
    if (tab !== 'market' && tab !== 'installed') return
    void loadInstalled().catch(() => { setManagementAvailable(false) })
  }, [loadInstalled, tab])

  // Poll for install/uninstall completion
  useEffect(() => {
    if (busy === null) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      if (cancelled) return
      try {
        const data = await loadInstalled()
        const current = busyRef.current
        if (current === null || cancelled) return
        const plugin = plugins.find((p) => p !== undefined && matchInstalled(p, data) !== undefined)
        const present = data.some((row) => {
          if (current.kind === 'install') {
            return row.name === plugin?.name || row.name === plugin?.full_name.split('/').pop()
          } else {
            return row.name !== plugin?.name && row.name !== plugin?.full_name.split('/').pop()
          }
        })
        if (current.kind === 'install' ? present : !present) {
          setBusy(null)
          window.location.reload()
          return
        }
      } catch { /* a reload mid-poll is expected */ }
      if (!cancelled) setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
    return () => { cancelled = true }
  }, [busy, plugins, loadInstalled])

  const search = useCallback((value: string) => {
    setQuery(value)
    setPage(1)
  }, [])

  // Debounced search: only trigger load 300ms after user stops typing
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchQueryRef = useRef('')
  searchQueryRef.current = query

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      void load(searchQueryRef.current, category, sort, 1)
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [query, tab]) // only react to query changes

  const filterByCategory = useCallback((cat: string) => { setCategory(cat); setPage(1) }, [])
  const sortBy = useCallback((s: string) => { setSort(s); setPage(1) }, [])

  const startOperation = useCallback(
    async (plugin: Plugin, kind: 'install' | 'uninstall', installedRow?: InstalledPlugin) => {
      setFailure(null); setNotice(null)
      const endpoint = kind === 'install' ? 'install' : 'uninstall'
      const body = kind === 'install'
        ? { spec: plugin.html_url, enabled: true }
        : { name: installedRow?.name ?? plugin.name }
      try {
        const res = await fetch(`/api/plugin-commons/${endpoint}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => null)
          throw new Error(payload?.error?.message ?? `HTTP ${res.status}`)
        }
        setNotice(kind === 'install'
          ? `正在安装 ${plugin.full_name}…完成后页面会自动刷新。`
          : `正在卸载 ${plugin.full_name}…完成后页面会自动刷新。`)
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

  const marketGrid = useMemo(
    () => plugins.map((p) => {
      const row = matchInstalled(p, installed)
      const isBusy = busy?.name === p.full_name
      const color = getRandomColor(p.full_name)
      return (
        <div key={p.id} style={styles.card}>
          <div style={styles.cardTop}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color }}>
              {getInitial(p.name)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.cardTitle}>
                <a href={p.html_url} target="_blank" rel="noreferrer noopener" style={{ color: 'inherit', textDecoration: 'none' }}>
                  {p.full_name}
                </a>
                {row && row.version && <span style={styles.versionBadge}>v{row.version}</span>}
              </div>
              <div style={styles.cardAuthor}>{p.owner.login}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, opacity: 0.7, flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 .2a7 7 0 1 1 0 14A7 7 0 0 1 8 .2Zm3.354 4.854-2.172 2.172 2.172 2.172a.75.75 0 1 1-1.06 1.06L7.25 8.31l-2.822 2.822a.75.75 0 0 1-1.06-1.06l2.822-2.822L5.368 5.368a.75.75 0 0 1 1.06-1.06L8.25 7.14l2.172-2.172a.75.75 0 1 1 1.06 1.06Z" /></svg>
              {formatNumber(p.stars)}
            </div>
          </div>
          {p.description && <div style={styles.cardDesc}>{p.description}</div>}
          <div style={styles.cardTags}>
            {p.language && <span style={styles.tag}>{p.language}</span>}
            {p.topics.slice(0, 3).map((t) => <span key={t} style={styles.tag}>{t}</span>)}
          </div>
          <div style={styles.cardBottom}>
            <span style={styles.cardTime}>{relativeTime(p.updated_at)}</span>
            {row !== undefined ? (
              row.removable && row.blockedBy === null ? (
                <button type="button" style={styles.btnSecondary} disabled={isBusy} onClick={() => void startOperation(p, 'uninstall', row)}>
                  {isBusy ? '处理中…' : '卸载'}
                </button>
              ) : (
                <span style={{ fontSize: 12, opacity: 0.5 }}>
                  {row.enabled ? '已启用' : '已安装'}
                </span>
              )
            ) : (
              <button type="button" style={styles.btnPrimary} disabled={isBusy || !managementAvailable} onClick={() => void startOperation(p, 'install')}>
                {isBusy ? '安装中…' : '安装'}
              </button>
            )}
          </div>
        </div>
      )
    }),
    [plugins, installed, busy, managementAvailable, startOperation],
  )

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  return (
    <div style={styles.root}>
      {/* Tabs */}
      <div style={styles.tabBar}>
        <button type="button" style={tab === 'market' ? styles.tabActive : styles.tab} onClick={() => setTab('market')}>
          插件公社 <span style={styles.tabCount}>{total}</span>
        </button>
        <button type="button" style={tab === 'installed' ? styles.tabActive : styles.tab} onClick={() => setTab('installed')}>
          已安装插件 <span style={styles.tabCount}>{installed.length}</span>
        </button>
      </div>

      {/* ====== Market Tab ====== */}
      {tab === 'market' && (
        <>
          <header style={styles.header}>
            <h1 style={styles.title}>
              插件公社
              <span style={styles.versionLabel}>v0.2.0</span>
            </h1>
            <p style={styles.subtitle}>
              社区共建，插件共享 · 浏览、搜索 GitHub 上的 {loading || !total ? 'dsh-plugin' : `${total.toLocaleString()}+ dsh-plugin`} 插件，中文界面 · 动态更新 · 本地缓存
            </p>
          </header>

          <div style={styles.searchRow}>
            <div style={styles.searchWrap}>
              <svg style={styles.searchIcon} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>
              <input
                style={styles.search}
                placeholder="搜索插件名称、描述或关键词，按 Enter 搜索"
                value={query}
                onChange={(e) => search(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') search(e.currentTarget.value) }}
              />
            </div>
          </div>

          <div style={styles.filterRow}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>分类：</span>
              <div style={styles.filterScroll}>
                {CATEGORIES.map((c) => (
                  <button key={c.id} type="button" style={category === c.id ? styles.chipActive : styles.chip} onClick={() => filterByCategory(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>排序：</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {SORTS.map((s) => (
                  <button key={s.id} type="button" style={sort === s.id ? styles.chipActive : styles.chip} onClick={() => sortBy(s.id)}>
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={styles.summary}>
            共 <strong>{total}</strong> 个插件
            {fetchedAt && <> · 清单更新于 {fetchedAt}</>}
            {!managementAvailable && <><br />当前 profile 未挂载插件管理器，仅可浏览</>}
          </div>

          {total < 10000 && (
            <div style={styles.infoBox}>
              <span style={{ marginRight: 8 }}>ℹ️</span>
              <span style={{ flex: 1 }}>默认首屏加载 2000 个高星插件（20 次 API 请求，不会触发限速）。配置 GitHub Token 可拉取全部 17,000+ 插件。</span>
              <button type="button" style={styles.tokenConfigBtn} onClick={() => setShowTokenConfig(true)}>
                配置 Token →
              </button>
            </div>
          )}

          {notice !== null && <div style={styles.notice}>{notice}</div>}
          {failure !== null && <div style={styles.failure}>{failure}</div>}

          {loading ? (
            <div style={styles.state}>正在加载…</div>
          ) : error ? (
            <div style={styles.state}>加载失败，请刷新重试</div>
          ) : plugins.length === 0 ? (
            <div style={styles.state}>{query || category !== 'all' ? '没有匹配的插件' : '目录尚未加载完成，稍后再试。'}</div>
          ) : (
            <>
              <div style={styles.grid}>{marketGrid}</div>
              {hasMore && (
                <div style={styles.pagination}>
                  <button type="button" style={page === 1 ? styles.pageBtnDisabled : styles.pageBtn} disabled={page === 1}
                    onClick={() => { setPage(page - 1); void load(query, category, sort, page - 1) }}>← 上一页</button>
                  <span style={styles.pageInfo}>第 {page} 页 · 共 {Math.ceil(total / 30)} 页</span>
                  <button type="button" style={styles.pageBtn}
                    onClick={() => { setPage(page + 1); void load(query, category, sort, page + 1) }}>下一页 →</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ====== Installed Tab ====== */}
      {tab === 'installed' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 28px 0' }}>
            <div style={{ flex: 1 }}>
              <h1 style={styles.title}>已安装插件</h1>
              <p style={styles.subtitle}>
                查看与管理当前主机的 DSH 插件。项目级与内置插件不在此列表中。
              </p>
            </div>
            <button type="button" style={styles.btnRefresh} onClick={() => { void loadInstalled(); void load(query, category, sort, page) }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.5 8a6.5 6.5 0 1 1 1.9 4.7M14.5 8a6.5 6.5 0 1 0-1.9-4.7"/><path d="M1.5 2.5v5h5" fill="none"/><path d="M14.5 13.5v-5h-5" fill="none"/></svg>
              刷新列表
            </button>
          </div>

          <div style={{ padding: '12px 28px 0' }}>
            <div style={styles.searchWrap}>
              <svg style={styles.searchIcon} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>
              <input style={styles.search} placeholder="搜索已安装插件或路径" />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 28px 0' }}>
            <div style={styles.summary}>
              共 <strong>{installed.length}</strong> 个已安装插件
              {hasUpdates && (
                <span style={{ color: 'var(--dsw-alias-state-business-primary, #2f49d1)', marginLeft: '12px' }}>
                  · {updateList.length} 个有可用更新
                </span>
              )}
              {!managementAvailable && <><br />当前 profile 未挂载插件管理器</>}
            </div>
            <button type="button" style={styles.checkUpdateButton} disabled={updating || !managementAvailable}
              onClick={() => void checkUpdates()}>
              {updating ? '正在检查…' : '🔄 检查更新'}
            </button>
          </div>

          {installed.length === 0 ? (
            <div style={styles.state}>暂无已安装插件</div>
          ) : (
            <div style={styles.installedList}>
              {installed.map((row) => {
                const isBusy = busy && busy.name === row.name
                const color = getRandomColor(row.name)
                return (
                  <div key={row.name} style={styles.installedCard}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 8, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color }}>
                        {getInitial(row.name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{row.name}</span>
                          {row.version && <span style={styles.versionBadge}>v{row.version}</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          {row.enabled ? (
                            <span style={styles.badgeOn}>已启用</span>
                          ) : (
                            <span style={styles.badgeOff}>已安装 · 未启用</span>
                          )}
                          {row.needsUpdate && (
                            <span style={{ ...styles.badgeOn, background: 'rgba(47,73,209,0.12)', color: 'var(--dsw-alias-state-business-primary, #2f49d1)' }}>
                              新版本可用
                            </span>
                          )}
                          {row.repository && (
                            <a href={row.repository} target="_blank" rel="noreferrer noopener" style={{ fontSize: 12, opacity: 0.5, textDecoration: 'none' }}>
                              {row.repository}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {row.removable && row.blockedBy === null ? (
                        <button type="button" style={styles.btnDanger} disabled={!!isBusy}
                          onClick={() => {
                            const p = plugins.find((p) => matchInstalled(p, [row]) === row)
                            startOperation(p ?? { id: 0, name: row.name, full_name: row.name, description: null, html_url: row.repository ?? '', stars: 0, forks: 0, language: null, topics: [], owner: { login: '', avatar_url: '' }, updated_at: new Date().toISOString() } as Plugin, 'uninstall', row)
                          }}>
                          {isBusy ? '处理中…' : '卸载'}
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, opacity: 0.4 }}>不可卸载</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      <footer style={styles.footer}>
        插件由第三方社区作者发布；插件公社是社区项目，并非 DeepSeek 官方出品。
      </footer>

      {/* Update dialog */}
      {showUpdateDialog && createPortal(
        <div style={styles.overlay} onClick={() => setShowUpdateDialog(false)}>
          <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <div style={styles.dialogHeader}>
              <h3 style={styles.dialogTitle}>{hasUpdates ? '🎉 发现更新' : '✅ 已安装插件均为最新版本'}</h3>
              <button type="button" style={styles.dialogClose} onClick={() => setShowUpdateDialog(false)}>✕</button>
            </div>
            <div style={styles.dialogBody}>
              {hasUpdates && updateList.length > 0 ? (
                <>
                  <p style={{ marginBottom: 12, fontSize: 14 }}>以下插件有新版本可用，是否立即更新？</p>
                  <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 16 }}>
                    {updateList.map((item, idx) => (
                      <div key={idx} style={styles.updateItem}>
                        <span style={{ fontWeight: 500 }}>{item.name}</span>
                        <span style={{ color: 'var(--dsw-alias-label-tertiary, #6b7080)', marginLeft: 8 }}>
                          {item.local} → {item.latest}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 16 }}>更新完成后将自动刷新页面</p>
                  <div style={styles.dialogActions}>
                    <button type="button" style={styles.buttonCancel} onClick={() => setShowUpdateDialog(false)}>稍后更新</button>
                    <button type="button" style={styles.buttonConfirm} onClick={() => void batchUpdate()}>确定更新</button>
                  </div>
                </>
              ) : (
                <p style={{ textAlign: 'center', padding: '24px 0' }}>所有已安装插件均为最新版本</p>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Token config dialog */}
      {showTokenConfig && createPortal(
        <div style={styles.overlay} onClick={() => setShowTokenConfig(false)}>
          <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <div style={styles.dialogHeader}>
              <h3 style={styles.dialogTitle}>🔑 配置 GitHub Token</h3>
              <button type="button" style={styles.dialogClose} onClick={() => setShowTokenConfig(false)}>✕</button>
            </div>
            <div style={styles.dialogBody}>
              <p style={{ marginBottom: 12, fontSize: 14, lineHeight: 1.6 }}>
                不配置 Token 时，默认拉取 <strong>2000 个</strong> 高星插件，足够日常使用。
                <br />
                配置 Token 后可拉取 <strong>全部 17,000+</strong> 插件。
              </p>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>GitHub Personal Access Token</label>
                <input
                  style={styles.tokenInput}
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveToken() }}
                />
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 16 }}>
                前往 <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer noopener" style={{ color: '#7da2ff' }}>GitHub Token 设置页</a> 创建（选 scopes: `repo` 即可）。
              </div>
              {failure && <div style={styles.failure}>{failure}</div>}
              <div style={styles.dialogActions}>
                <button type="button" style={styles.buttonCancel} onClick={() => { setShowTokenConfig(false); setTokenInput('') }}>取消</button>
                <button type="button" style={styles.buttonConfirm} disabled={tokenConfiguring} onClick={() => void saveToken()}>
                  {tokenConfiguring ? '保存中…' : '保存并刷新'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
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
    background: '#18191c',
  },
  tabBar: {
    display: 'flex',
    gap: 28,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    padding: '0 28px',
    margin: 0,
    background: '#18191c',
  },
  tab: {
    color: 'rgba(255,255,255,0.5)',
    font: 'inherit',
    background: 'none',
    border: 'none',
    padding: '12px 0 14px',
    fontSize: 14,
    lineHeight: '21px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    position: 'relative',
  },
  tabActive: {
    color: '#fff',
    font: 'inherit',
    background: 'none',
    border: 'none',
    padding: '12px 0 14px',
    fontSize: 14,
    lineHeight: '21px',
    cursor: 'default',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    position: 'relative',
    fontWeight: 600,
  },
  tabCount: {
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.6)',
    borderRadius: 999,
    padding: '0 7px',
    fontSize: 12,
    fontWeight: 500,
    lineHeight: '18px',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 28px 0',
  },
  title: { margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', color: '#fff', display: 'inline', alignItems: 'baseline', gap: 8 },
  versionLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: 400,
    marginLeft: 6,
  },
  subtitle: { margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 },
  searchRow: { padding: '16px 28px 0' },
  searchWrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    color: 'rgba(255,255,255,0.3)',
    pointerEvents: 'none',
  },
  search: {
    flex: 1,
    padding: '8px 12px 8px 34px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    fontSize: 14,
    color: '#fff',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  filterRow: { padding: '8px 28px 0' },
  filterScroll: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip: {
    padding: '4px 10px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'transparent',
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
  },
  chipActive: {
    padding: '4px 10px',
    borderRadius: 999,
    border: '1px solid #2f49d1',
    background: 'rgba(47,73,209,0.15)',
    fontSize: 12,
    color: '#7da2ff',
    cursor: 'pointer',
    fontWeight: 500,
  },
  summary: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    padding: '4px 28px 0',
  },
  notice: {
    padding: '8px 28px',
    borderRadius: 8,
    border: '1px solid rgba(100,130,255,0.4)',
    background: 'rgba(100,130,255,0.1)',
    fontSize: 12,
    color: '#7da2ff',
  },
  failure: {
    padding: '8px 28px',
    borderRadius: 8,
    border: '1px solid rgba(230,90,90,0.5)',
    background: 'rgba(230,90,90,0.1)',
    fontSize: 12,
    color: '#e65a5a',
  },
  state: {
    padding: '40px 28px',
    textAlign: 'center',
    opacity: 0.5,
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
  },
  // --- Grid for market cards ---
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 12,
    padding: '12px 28px 20px',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 16,
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: 'inherit',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  cardTitle: {
    fontWeight: 600,
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  cardAuthor: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  cardDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 1.4,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  cardTags: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  cardBottom: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  cardTime: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  tag: {
    padding: '2px 8px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.06)',
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
  versionBadge: {
    padding: '1px 6px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.12)',
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  // --- Installed list ---
  installedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '8px 28px 20px',
  },
  installedCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: 'inherit',
  },
  // --- Badges ---
  badgeOn: {
    padding: '2px 8px',
    borderRadius: 6,
    background: 'rgba(27,107,69,0.15)',
    color: '#4ade80',
    fontSize: 12,
    fontWeight: 500,
  },
  badgeOff: {
    padding: '2px 8px',
    borderRadius: 6,
    background: 'rgba(200,160,60,0.15)',
    color: '#f0a040',
    fontSize: 11,
  },
  badgeMuted: { fontSize: 11, opacity: 0.55 },
  // --- Buttons ---
  btnPrimary: {
    padding: '6px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#2f49d1',
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnSecondary: {
    padding: '6px 16px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnDanger: {
    padding: '6px 16px',
    borderRadius: 8,
    border: '1px solid rgba(230,90,90,0.5)',
    background: 'rgba(230,90,90,0.08)',
    color: '#e65a5a',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnRefresh: {
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
  },
  infoBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '10px 28px',
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 1.5,
  },
  tokenConfigBtn: {
    padding: '3px 10px',
    borderRadius: 6,
    border: '1px solid rgba(47,73,209,0.5)',
    background: 'rgba(47,73,209,0.12)',
    color: '#7da2ff',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  tokenInput: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    fontSize: 14,
    color: '#fff',
    fontFamily: 'monospace',
    outline: 'none',
    boxSizing: 'border-box',
  },
  checkUpdateButton: {
    margin: '8px 28px 0',
    padding: '8px 18px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    fontWeight: 500,
  },
  footer: {
    marginTop: 'auto',
    padding: '16px 28px',
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    padding: '16px 28px 20px',
  },
  pageBtn: {
    padding: '6px 16px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.04)',
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    fontWeight: 500,
  },
  pageBtnDisabled: {
    padding: '6px 16px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.04)',
    fontSize: 13,
    color: 'rgba(255,255,255,0.25)',
    cursor: 'default',
  },
  pageInfo: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
  },
  // --- Dialog ---
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  dialog: {
    background: '#232429',
    borderRadius: 12,
    boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
    width: '480px',
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  dialogHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  dialogTitle: { margin: 0, fontSize: 16, fontWeight: 600, color: '#fff' },
  dialogClose: {
    background: 'none',
    border: 'none',
    fontSize: 18,
    cursor: 'pointer',
    color: 'rgba(255,255,255,0.5)',
    padding: '0 4px',
  },
  dialogBody: {
    padding: '20px',
    overflowY: 'auto',
    flex: 1,
    color: 'rgba(255,255,255,0.8)',
  },
  updateItem: {
    padding: '8px 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  buttonCancel: {
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'transparent',
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
  },
  buttonConfirm: {
    padding: '8px 20px',
    borderRadius: 8,
    border: 'none',
    background: '#2f49d1',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
}
