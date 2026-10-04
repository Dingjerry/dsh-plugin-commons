/**
 * In-memory plugin catalogue.
 *
 * Owns the list of repositories pulled from GitHub and answers list/search/
 * category/detail queries without touching the network. It is seeded once by
 * the host plugin (`setCatalog`) and read on every API request.
 */

import type { PaginatedResult, PluginCategory, PluginRepo } from '../types.ts'

/** Catalogue metadata exposed through the status endpoint. */
export interface CatalogMeta {
  ready: boolean
  loading: boolean
  error: string | null
  total: number
  fetchedAt: number | null
  snapshotTotal: number
}

const CATEGORY_DEFS: ReadonlyArray<Omit<PluginCategory, 'count'>> = [
  { id: 'ai-assistant', name: 'AI 助手', nameEn: 'AI Assistant' },
  { id: 'code-completion', name: '代码补全', nameEn: 'Code Completion' },
  { id: 'file-management', name: '文件管理', nameEn: 'File Management' },
  { id: 'browser-automation', name: '浏览器自动化', nameEn: 'Browser Automation' },
  { id: 'data-processing', name: '数据处理', nameEn: 'Data Processing' },
  { id: 'communication', name: '通讯集成', nameEn: 'Communication' },
  { id: 'development-tools', name: '开发工具', nameEn: 'Development Tools' },
  { id: 'productivity', name: '效率工具', nameEn: 'Productivity' },
  { id: 'multimedia', name: '多媒体', nameEn: 'Multimedia' },
  { id: 'testing', name: '测试工具', nameEn: 'Testing' },
  { id: 'documentation', name: '文档工具', nameEn: 'Documentation' },
] as const

/** Keyword buckets used to bucket a plugin into a category by description/topics. */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'ai-assistant': ['ai', 'assistant', 'chat', 'agent', 'llm', 'gpt', '智能', '助手'],
  'code-completion': ['code', 'completion', 'autocomplete', 'ide', '补全', '代码'],
  'file-management': ['file', 'manager', 'folder', 'storage', '文件', '管理'],
  'browser-automation': ['browser', 'automation', 'selenium', 'playwright', '浏览器', '爬虫'],
  'data-processing': ['data', 'processing', 'etl', 'excel', 'csv', '数据处理', '表格'],
  'communication': ['chat', 'discord', 'slack', 'wechat', 'telegram', '通讯', '消息'],
  'development-tools': ['dev', 'tool', 'build', 'debug', 'compiler', '开发', '工具'],
  'productivity': ['productivity', 'todo', 'notes', 'task', '效率', '笔记'],
  'multimedia': ['image', 'video', 'audio', 'media', 'music', '图片', '视频', '音频'],
  'testing': ['test', 'jest', 'mocha', 'e2e', '测试'],
  'documentation': ['docs', 'wiki', 'readme', 'markdown', 'sphinx', '文档'],
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _plugins: PluginRepo[] = []
let _meta: CatalogMeta = {
  ready: false,
  loading: false,
  error: null,
  total: 0,
  fetchedAt: null,
  snapshotTotal: 0,
}

/** Replace the catalogue contents (and mark it ready). */
export function setCatalog(items: PluginRepo[], snapshotTotal: number, fetchedAt: number): void {
  _plugins = items
  _meta = {
    ready: true,
    loading: false,
    error: null,
    total: items.length,
    fetchedAt,
    snapshotTotal,
  }
}

/** Mark the catalogue as loading (used between a refresh request and its result). */
export function setLoading(): void {
  _meta = { ..._meta, loading: true, error: null }
}

/** Mark the catalogue as failed, preserving whatever items were already loaded. */
export function setError(message: string): void {
  _meta = { ..._meta, loading: false, error: message }
}

/** Current catalogue metadata. */
export function getMeta(): CatalogMeta {
  return _meta
}

/** True once a catalogue (from disk or network) has been loaded. */
export function isReady(): boolean {
  return _meta.ready
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Categorize a single plugin by inspecting its name/description/topics. */
function categoryOf(plugin: PluginRepo): string | null {
  const text = [plugin.name, plugin.description, ...plugin.topics]
    .join(' ')
    .toLowerCase()
  for (const [id, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) return id
  }
  return null
}

/** List plugins with optional category filter, keyword filter, sorting and paging. */
export function listPlugins(options: {
  page?: number
  limit?: number
  sort?: 'stars' | 'forks' | 'updated'
  category?: string
  q?: string
} = {}): PaginatedResult<PluginRepo> {
  const page = options.page ?? 1
  const limit = options.limit ?? 50
  const sort = options.sort ?? 'stars'
  const category = options.category
  const q = options.q?.toLowerCase().trim()

  let items = [..._plugins]

  if (category && category !== 'all') {
    items = items.filter((p) => categoryOf(p) === category)
  }

  if (q) {
    items = items.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.description?.toLowerCase().includes(q) ?? false) ||
      p.full_name.toLowerCase().includes(q) ||
      p.topics.some((t) => t.toLowerCase().includes(q)),
    )
  }

  items.sort((a, b) => {
    switch (sort) {
      case 'forks': return b.forks - a.forks
      case 'updated': return Date.parse(b.updated_at) - Date.parse(a.updated_at)
      case 'stars':
      default: return b.stars - a.stars
    }
  })

  const total = items.length
  const start = (page - 1) * limit
  const slice = items.slice(start, start + limit)

  return { items: slice, total, page, limit, hasMore: start + limit < total }
}

/** Categories with live counts computed from the loaded catalogue. */
export function listCategories(): PluginCategory[] {
  const counts = new Map<string, number>()
  for (const plugin of _plugins) {
    const cat = categoryOf(plugin)
    if (cat !== null) counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }

  const categories: PluginCategory[] = [
    { id: 'all', name: '全部插件', nameEn: 'All Plugins', count: _plugins.length },
    ...CATEGORY_DEFS.map((def) => ({ ...def, count: counts.get(def.id) ?? 0 })),
  ]
  return categories
}

/** Look up a single plugin by `owner/repo` full name. */
export function getPlugin(fullName: string): PluginRepo | null {
  return _plugins.find((p) => p.full_name === fullName) ?? null
}
