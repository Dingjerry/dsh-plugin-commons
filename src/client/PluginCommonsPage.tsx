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

/** Per-repository work state the toolbar renders. */
type Busy = { fullName: string; kind: 'install' | 'uninstall'; startedAt: number } | null

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
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [total, setTotal] = useState(0)
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
    void load(query, category, sort)
  }, [load, query, category, sort])

  useEffect(() => {
    void loadInstalled().catch(() => {
      setManagementAvailable(false)
    })
  }, [loadInstalled])

  // One watcher for an accepted install/removal: poll until the profile
  // reflects it, then reload so the new plugin's client bundle is picked up.
  useEffect(() => {
    if (busy === null) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      if (cancelled) return
      const current = busyRef.current
      if (current === null) return
      if (Date.now() - current.startedAt > OPERATION_TIMEOUT_MS) {
        setBusy(null)
        setFailure(
          `${current.fullName} 的${current.kind === 'install' ? '安装' : '卸载'}超时。` +
            '网络较慢时 GitHub 下载可能耗时较久，请稍后在插件面板中确认结果。',
        )
        return
      }
      try {
        const rows = await loadInstalled()
        const plugin = plugins.find((p) => p.full_name === current.fullName)
        const present =
          plugin !== undefined && matchInstalled(plugin, rows) !== undefined
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
        setBusy({ fullName: plugin.full_name, kind, startedAt: Date.now() })
      } catch (err) {
        setFailure(`${kind === 'install' ? '安装' : '卸载'}失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [],
  )

  const cardList = useMemo(
    () =>
      plugins.map((p) => {
        const row = matchInstalled(p, installed)
        const isBusy = busy?.fullName === p.full_name
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

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <h1 style={styles.title}>插件公社</h1>
        <p style={styles.subtitle}>社区共建，插件共享 · 浏览并安装 GitHub 上的 dsh-plugin 插件</p>
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
        共 {total} 个插件 · 已安装 {installed.length} 个
        {!managementAvailable && ' · 当前 profile 未挂载插件管理器，仅可浏览'}
      </div>

      {notice !== null && <div style={styles.notice}>{notice}</div>}
      {failure !== null && <div style={styles.failure}>{failure}</div>}

      {loading ? (
        <div style={styles.state}>正在加载…</div>
      ) : error ? (
        <div style={styles.state}>加载失败，请刷新重试</div>
      ) : plugins.length === 0 ? (
        <div style={styles.state}>没有匹配的插件</div>
      ) : (
        <div style={styles.list}>{cardList}</div>
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
    padding: '20px 24px',
    gap: '14px',
    boxSizing: 'border-box',
  },
  header: { display: 'flex', flexDirection: 'column', gap: '4px' },
  title: { margin: 0, fontSize: '20px', fontWeight: 600 },
  subtitle: { margin: 0, fontSize: '13px', opacity: 0.65 },
  toolbar: { display: 'flex', gap: '8px' },
  search: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(128,128,128,0.3)',
    background: 'transparent',
    fontSize: '14px',
    color: 'inherit',
    outline: 'none',
  },
  filters: { display: 'flex', flexDirection: 'column', gap: '8px' },
  filterGroup: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  chip: {
    padding: '4px 10px',
    borderRadius: '999px',
    border: '1px solid rgba(128,128,128,0.3)',
    background: 'transparent',
    fontSize: '12px',
    color: 'inherit',
    cursor: 'pointer',
  },
  chipActive: {
    padding: '4px 10px',
    borderRadius: '999px',
    border: '1px solid rgba(100,130,255,0.6)',
    background: 'rgba(100,130,255,0.15)',
    fontSize: '12px',
    color: 'inherit',
    cursor: 'pointer',
  },
  summary: { fontSize: '12px', opacity: 0.6 },
  notice: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(100,130,255,0.4)',
    background: 'rgba(100,130,255,0.1)',
    fontSize: '12px',
  },
  failure: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(230,90,90,0.5)',
    background: 'rgba(230,90,90,0.1)',
    fontSize: '12px',
  },
  state: { padding: '40px 0', textAlign: 'center', opacity: 0.6 },
  list: { display: 'flex', flexDirection: 'column', gap: '10px' },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '14px 16px',
    borderRadius: '10px',
    border: '1px solid rgba(128,128,128,0.2)',
    color: 'inherit',
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' },
  pluginName: { fontWeight: 600, fontSize: '14px', color: 'inherit' },
  stars: { fontSize: '13px', opacity: 0.8, whiteSpace: 'nowrap' },
  description: {
    fontSize: '13px',
    opacity: 0.8,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  metaRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' },
  tag: {
    padding: '2px 8px',
    borderRadius: '6px',
    background: 'rgba(128,128,128,0.12)',
    fontSize: '11px',
  },
  metaRight: { marginLeft: 'auto', fontSize: '11px', opacity: 0.55 },
  actionRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  badgeOn: {
    padding: '2px 8px',
    borderRadius: '6px',
    background: 'rgba(60,170,110,0.18)',
    fontSize: '11px',
  },
  badgeOff: {
    padding: '2px 8px',
    borderRadius: '6px',
    background: 'rgba(200,160,60,0.18)',
    fontSize: '11px',
  },
  badgeMuted: { fontSize: '11px', opacity: 0.55 },
  buttonPrimary: {
    marginLeft: 'auto',
    padding: '5px 14px',
    borderRadius: '7px',
    border: '1px solid rgba(100,130,255,0.6)',
    background: 'rgba(100,130,255,0.18)',
    color: 'inherit',
    fontSize: '12px',
    cursor: 'pointer',
  },
  buttonDanger: {
    marginLeft: 'auto',
    padding: '5px 14px',
    borderRadius: '7px',
    border: '1px solid rgba(230,90,90,0.5)',
    background: 'transparent',
    color: 'inherit',
    fontSize: '12px',
    cursor: 'pointer',
  },
  footer: {
    marginTop: 'auto',
    paddingTop: '16px',
    fontSize: '12px',
    opacity: 0.55,
    textAlign: 'center',
  },
}
