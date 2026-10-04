/**
 * Dictionaries for the Plugin Commons panel.
 *
 * Registration mechanics follow `dsh-agent-teams`: the plugin calls
 * `ctx.locale.register(NS, { zh, en })` and every registration site that
 * declares `locale: NS` receives the framework's typed `t` seat.
 */
/** Dictionary namespace owned by the Plugin Commons client plugin. */
export const NS = 'pluginCommons';
const zhDictionary = {
    panel: '插件公社',
    title: '插件公社',
    subtitle: '浏览 GitHub 上所有 dsh-plugin 主题插件。',
    searchPlaceholder: '搜索插件名称、描述或关键词',
    clearSearch: '清除搜索',
    categoryAll: '全部',
    loading: '正在加载…',
    empty: '暂无插件',
    emptyHint: '目录尚未加载完成，稍后再试。',
    emptySearch: '没有匹配的插件',
    retry: '重试',
    refresh: '刷新',
    stars: '星标',
    forks: 'Fork',
    language: '语言',
    updated: '更新于',
    openRepo: '打开仓库',
    count: '{count} 个插件',
    total: '共 {count} 个插件（快照）',
    disclaimer: '插件由第三方社区作者发布；插件公社是社区项目，并非 DeepSeek 官方出品。',
    'sort.stars': '按星标',
    'sort.forks': '按 Fork',
    'sort.updated': '按更新',
};
/** Simplified Chinese dictionary. */
export const zh = zhDictionary;
/** English dictionary, typed against the Chinese key union. */
export const en = {
    panel: 'Plugin Commons',
    title: 'Plugin Commons',
    subtitle: 'Browse every dsh-plugin repository on GitHub.',
    searchPlaceholder: 'Search plugin name, description or keyword',
    clearSearch: 'Clear search',
    categoryAll: 'All',
    loading: 'Loading…',
    empty: 'No plugins yet',
    emptyHint: 'The catalogue has not finished loading. Try again in a moment.',
    emptySearch: 'No matching plugins',
    retry: 'Retry',
    refresh: 'Refresh',
    stars: 'Stars',
    forks: 'Forks',
    language: 'Language',
    updated: 'Updated',
    openRepo: 'Open repository',
    count: '{count} plugins',
    total: '{count} plugins (snapshot)',
    disclaimer: 'Plugins are published by third-party community authors; Plugin Commons is a community project, not an official DeepSeek product.',
    'sort.stars': 'Stars',
    'sort.forks': 'Forks',
    'sort.updated': 'Updated',
};
//# sourceMappingURL=locales.js.map