import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
];
const SORTS = [
    { id: 'stars', name: '星标' },
    { id: 'forks', name: 'Fork' },
    { id: 'updated', name: '更新' },
];
/** How often the panel re-reads the installed list while an operation runs. */
const POLL_MS = 2000;
/** Give up watching one operation after this long and tell the person. */
const OPERATION_TIMEOUT_MS = 5 * 60 * 1000;
function formatNumber(n) {
    if (n >= 1000)
        return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}
function relativeTime(iso) {
    const then = Date.parse(iso);
    if (Number.isNaN(then))
        return '';
    const days = Math.floor((Date.now() - then) / 86_400_000);
    if (days <= 0)
        return '今天';
    if (days < 30)
        return `${days} 天前`;
    if (days < 365)
        return `${Math.floor(days / 30)} 个月前`;
    return `${Math.floor(days / 365)} 年前`;
}
function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
/** Lowercase a repository URL so two spellings compare equal. */
function canonicalRepo(url) {
    return url.trim().replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}
/**
 * Match a catalogue entry to an installed bundle.
 *
 * The repository URL the package manifest declares is authoritative; the
 * `owner/repo` → `@owner/repo` name identity is the fallback for packages that
 * publish no `repository` field.
 */
function matchInstalled(plugin, installed) {
    const repo = canonicalRepo(plugin.html_url);
    const byRepository = installed.find((row) => row.repository !== null && canonicalRepo(row.repository) === repo);
    if (byRepository !== undefined)
        return byRepository;
    const owner = plugin.full_name.split('/')[0]?.toLowerCase() ?? '';
    const name = plugin.name.toLowerCase();
    return installed.find((row) => {
        const candidate = row.name.toLowerCase();
        return candidate === name || candidate === `@${owner}/${name}`;
    });
}
export function PluginCommonsPage() {
    const [tab, setTab] = useState('market');
    // Market tab state
    const [plugins, setPlugins] = useState([]);
    const [total, setTotal] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [fetchedAt, setFetchedAt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [page, setPage] = useState(1);
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');
    const [sort, setSort] = useState('stars');
    const [installed, setInstalled] = useState([]);
    const [managementAvailable, setManagementAvailable] = useState(false);
    const [busy, setBusy] = useState(null);
    const [notice, setNotice] = useState(null);
    const [failure, setFailure] = useState(null);
    // Update check state
    const [hasUpdates, setHasUpdates] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [showUpdateDialog, setShowUpdateDialog] = useState(false);
    const [updateList, setUpdateList] = useState([]);
    // The polling effect must see the current operation without re-subscribing.
    const busyRef = useRef(null);
    busyRef.current = busy;
    const loadInstalled = useCallback(async () => {
        const res = await fetch('/api/plugin-commons/installed');
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const data = (await res.json());
        setManagementAvailable(data.available);
        setInstalled(data.installed);
        return data.installed;
    }, []);
    const checkUpdates = useCallback(async () => {
        setUpdating(true);
        setFailure(null);
        try {
            const res = await fetch('/api/plugin-commons/check-updates');
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setHasUpdates(data.hasUpdates);
            if (data.hasUpdates && data.updates) {
                setUpdateList(data.updates.map((u) => ({ name: u.name, local: u.localVersion, latest: u.latestVersion })));
                setShowUpdateDialog(true);
            }
        }
        catch (err) {
            setFailure(`检查更新失败：${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            setUpdating(false);
        }
    }, []);
    const loadMeta = useCallback(async () => {
        try {
            const res = await fetch('/api/plugin-commons/status');
            if (!res.ok)
                return;
            const data = (await res.json());
            if (data.status.fetchedAt) {
                const iso = new Date(data.status.fetchedAt).toISOString();
                setFetchedAt(formatDate(iso));
            }
        }
        catch { /* ignore */ }
    }, []);
    const pageRef = useRef(page);
    pageRef.current = page;
    const load = useCallback(async (q, cat, s, pg) => {
        setLoading(true);
        setError(false);
        try {
            const params = new URLSearchParams({ page: String(pg), limit: '30', sort: s });
            if (cat !== 'all')
                params.set('category', cat);
            if (q.trim() !== '')
                params.set('q', q.trim());
            const res = await fetch(`/api/plugin-commons/plugins?${params.toString()}`);
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const data = (await res.json());
            setPlugins(data.items);
            setTotal(data.total);
            setHasMore(data.hasMore);
            if (pg !== pageRef.current)
                setPage(pg);
        }
        catch {
            setError(true);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        void loadMeta();
    }, [loadMeta]);
    useEffect(() => {
        if (tab !== 'market')
            return;
        void load(query, category, sort, page);
    }, [load, query, category, sort, tab, page]);
    useEffect(() => {
        if (tab !== 'market' && tab !== 'installed')
            return;
        void loadInstalled().catch(() => {
            setManagementAvailable(false);
        });
    }, [loadInstalled, tab]);
    // One watcher for an accepted install/removal: poll until the profile
    // reflects it, then reload so the new plugin's client bundle is picked up.
    useEffect(() => {
        if (busy === null)
            return;
        let cancelled = false;
        const tick = async () => {
            if (cancelled)
                return;
            try {
                const data = (await loadInstalled());
                const current = busyRef.current;
                if (current === null || cancelled)
                    return;
                const plugin = plugins.find((plugin) => plugin !== undefined && matchInstalled(plugin, data) !== undefined);
                const rows = data;
                const present = rows.some((row) => {
                    if (current.kind === 'install') {
                        return row.name === plugin?.name || row.name === plugin?.full_name.split('/').pop();
                    }
                    else {
                        return row.name !== plugin?.name && row.name !== plugin?.full_name.split('/').pop();
                    }
                });
                const done = current.kind === 'install' ? present : !present;
                if (done) {
                    setBusy(null);
                    window.location.reload();
                    return;
                }
            }
            catch {
                /* a reload mid-poll is expected; keep waiting */
            }
            if (!cancelled)
                setTimeout(() => void tick(), POLL_MS);
        };
        void tick();
        return () => {
            cancelled = true;
        };
    }, [busy, plugins, loadInstalled]);
    const search = useCallback((value) => {
        setQuery(value);
        setPage(1);
    }, []);
    const filterByCategory = useCallback((cat) => {
        setCategory(cat);
        setPage(1);
    }, []);
    const sortBy = useCallback((s) => {
        setSort(s);
        setPage(1);
    }, []);
    const startOperation = useCallback(async (plugin, kind, installedRow) => {
        setFailure(null);
        setNotice(null);
        const endpoint = kind === 'install' ? 'install' : 'uninstall';
        const body = kind === 'install'
            ? { spec: plugin.html_url, enabled: true }
            : { name: installedRow?.name ?? plugin.name };
        try {
            const res = await fetch(`/api/plugin-commons/${endpoint}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const payload = (await res.json().catch(() => null));
                throw new Error(payload?.error?.message ?? `HTTP ${res.status}`);
            }
            setNotice(kind === 'install'
                ? `正在安装 ${plugin.full_name}…完成后页面会自动刷新。`
                : `正在卸载 ${plugin.full_name}…完成后页面会自动刷新。`);
            setBusy({ name: plugin.full_name, kind, startedAt: Date.now() });
        }
        catch (err) {
            setFailure(`${kind === 'install' ? '安装' : '卸载'}失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }, []);
    // -----------------------------------------------------------------------
    // Render helpers
    // -----------------------------------------------------------------------
    const marketCardList = useMemo(() => plugins.map((p) => {
        const row = matchInstalled(p, installed);
        const isBusy = busy?.name === p.full_name;
        return (_jsxs("div", { style: styles.card, children: [_jsxs("div", { style: styles.cardHeader, children: [_jsx("a", { href: p.html_url, target: "_blank", rel: "noreferrer noopener", style: styles.pluginName, children: p.full_name }), _jsxs("span", { style: styles.stars, children: ["\u2605 ", formatNumber(p.stars)] })] }), p.description !== null && _jsx("div", { style: styles.description, children: p.description }), _jsxs("div", { style: styles.metaRow, children: [p.language !== null && _jsx("span", { style: styles.tag, children: p.language }), p.topics.slice(0, 3).map((t) => (_jsx("span", { style: styles.tag, children: t }, t))), _jsx("span", { style: styles.metaRight, children: relativeTime(p.updated_at) })] }), _jsx("div", { style: styles.actionRow, children: row !== undefined ? (_jsxs(_Fragment, { children: [_jsx("span", { style: row.enabled ? styles.badgeOn : styles.badgeOff, children: row.enabled ? '已启用' : '已安装 · 未启用' }), row.version !== null && _jsxs("span", { style: styles.badgeMuted, children: ["v", row.version] }), row.removable && row.blockedBy === null ? (_jsx("button", { type: "button", style: styles.buttonDanger, disabled: isBusy || !managementAvailable, onClick: () => void startOperation(p, 'uninstall', row), children: isBusy ? '处理中…' : '卸载' })) : (_jsx("span", { style: styles.badgeMuted, children: "\u4E0D\u53EF\u5378\u8F7D" }))] })) : (_jsx("button", { type: "button", style: styles.buttonPrimary, disabled: isBusy || !managementAvailable, onClick: () => void startOperation(p, 'install'), children: isBusy ? '安装中…' : '安装' })) })] }, p.id));
    }), [plugins, installed, busy, managementAvailable, startOperation]);
    const installedCardList = useMemo(() => installed.length === 0
        ? null
        : installed.map((row) => {
            const isBusy = busy && busy.name === row.name;
            return (_jsxs("div", { style: styles.card, children: [_jsxs("div", { style: styles.cardHeader, children: [_jsx("span", { style: styles.pluginName, children: row.name }), _jsxs("span", { style: styles.stars, children: ["v", row.version ?? '?', row.needsUpdate && row.latestVersion && (_jsxs("span", { style: { color: 'var(--dsw-alias-state-business-primary, #2f49d1)', marginLeft: '8px' }, children: ["\u2197 v", row.latestVersion] }))] })] }), _jsxs("div", { style: styles.metaRow, children: [row.enabled ? (_jsx("span", { style: styles.badgeOn, children: "\u5DF2\u542F\u7528" })) : (_jsx("span", { style: styles.badgeOff, children: "\u5DF2\u5B89\u88C5 \u00B7 \u672A\u542F\u7528" })), row.needsUpdate && (_jsx("span", { style: { ...styles.badgeOn, background: 'rgba(47,73,209,0.12)', color: 'var(--dsw-alias-state-business-primary, #2f49d1)' }, children: "\u65B0\u7248\u672C\u53EF\u7528" })), row.repository !== null && (_jsx("a", { href: row.repository, target: "_blank", rel: "noreferrer noopener", style: { fontSize: '12px', opacity: 0.6 }, children: row.repository }))] }), _jsx("div", { style: styles.actionRow, children: row.removable && row.blockedBy === null ? (_jsx("button", { type: "button", style: styles.buttonDanger, disabled: isBusy || !managementAvailable, onClick: () => {
                                // Find matching plugin to get full_name
                                const p = plugins.find((p) => matchInstalled(p, [row]) === row);
                                startOperation(p ?? {
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
                                }, 'uninstall', row);
                            }, children: isBusy ? '处理中…' : '卸载' })) : (_jsx("span", { style: styles.badgeMuted, children: "\u4E0D\u53EF\u5378\u8F7D" })) })] }, row.name));
        }), [installed, busy, managementAvailable, startOperation, plugins]);
    return (_jsxs("div", { style: styles.root, children: [_jsxs("div", { style: styles.tabBar, children: [_jsxs("button", { type: "button", style: tab === 'market' ? styles.tabActive : styles.tab, onClick: () => setTab('market'), children: ["\u63D2\u4EF6\u5E02\u573A", _jsx("span", { style: styles.tabCount, children: total })] }), _jsxs("button", { type: "button", style: tab === 'installed' ? styles.tabActive : styles.tab, onClick: () => setTab('installed'), children: ["\u5DF2\u5B89\u88C5\u63D2\u4EF6", _jsx("span", { style: styles.tabCount, children: installed.length })] })] }), tab === 'market' && (_jsxs(_Fragment, { children: [_jsxs("header", { style: styles.header, children: [_jsx("div", { style: styles.heroIcon, children: _jsxs("svg", { width: "36", height: "36", viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("rect", { x: "2.5", y: "2.5", width: "15", height: "15", rx: "3" }), _jsx("path", { d: "M8 2.5V5a1.6 1.6 0 0 0 3.2 0V2.5", fill: "currentColor", fillOpacity: 0.1 }), _jsx("path", { d: "M8 17.5V15a1.6 1.6 0 0 1 3.2 0v2.5" }), _jsx("circle", { cx: "10", cy: "10", r: "2.2" }), _jsx("path", { d: "M10 7.8V4.6M10 12.2v3.2M7.8 10H4.6M12.2 10h3.2" })] }) }), _jsxs("div", { children: [_jsx("h1", { style: styles.title, children: "\u63D2\u4EF6\u516C\u793E" }), _jsxs("p", { style: styles.subtitle, children: ["\u793E\u533A\u5171\u5EFA\uFF0C\u63D2\u4EF6\u5171\u4EAB \u00B7 \u6D4F\u89C8\u3001\u641C\u7D22 GitHub \u4E0A\u7684 ", loading || !total ? 'dsh-plugin' : `${total.toLocaleString()}+ dsh-plugin`, " \u63D2\u4EF6\uFF0C\u4E2D\u6587\u754C\u9762 \u00B7 \u52A8\u6001\u66F4\u65B0 \u00B7 \u672C\u5730\u7F13\u5B58"] })] })] }), _jsx("div", { style: styles.toolbar, children: _jsx("input", { style: styles.search, placeholder: "\u641C\u7D22\u63D2\u4EF6\u540D\u79F0\u3001\u63CF\u8FF0\u6216\u5173\u952E\u8BCD", value: query, onChange: (e) => search(e.target.value) }) }), _jsxs("div", { style: styles.filters, children: [_jsx("div", { style: styles.filterGroup, children: CATEGORIES.map((c) => (_jsx("button", { type: "button", style: category === c.id ? styles.chipActive : styles.chip, onClick: () => filterByCategory(c.id), children: c.name }, c.id))) }), _jsx("div", { style: styles.filterGroup, children: SORTS.map((s) => (_jsx("button", { type: "button", style: sort === s.id ? styles.chipActive : styles.chip, onClick: () => sortBy(s.id), children: s.name }, s.id))) })] }), _jsxs("div", { style: styles.summary, children: ["\u5171 ", _jsx("strong", { children: total }), " \u4E2A\u63D2\u4EF6", fetchedAt && _jsxs(_Fragment, { children: [" \u00B7 \u6E05\u5355\u66F4\u65B0\u4E8E ", fetchedAt] }), !managementAvailable && _jsxs(_Fragment, { children: [_jsx("br", {}), "\u5F53\u524D profile \u672A\u6302\u8F7D\u63D2\u4EF6\u7BA1\u7406\u5668\uFF0C\u4EC5\u53EF\u6D4F\u89C8"] })] }), notice !== null && _jsx("div", { style: styles.notice, children: notice }), failure !== null && _jsx("div", { style: styles.failure, children: failure }), loading ? (_jsx("div", { style: styles.state, children: "\u6B63\u5728\u52A0\u8F7D\u2026" })) : error ? (_jsx("div", { style: styles.state, children: "\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5" })) : plugins.length === 0 ? (_jsx("div", { style: styles.state, children: query || category !== 'all' ? '没有匹配的插件' : '目录尚未加载完成，稍后再试。' })) : (_jsxs(_Fragment, { children: [_jsx("div", { style: styles.list, children: marketCardList }), hasMore && (_jsxs("div", { style: styles.pagination, children: [_jsx("button", { type: "button", style: page === 1 ? styles.pageButtonDisabled : styles.pageButton, disabled: page === 1, onClick: () => { setPage(page - 1); void load(query, category, sort, page - 1); }, children: "\u2190 \u4E0A\u4E00\u9875" }), _jsxs("span", { style: styles.pageInfo, children: ["\u7B2C ", page, " \u9875 \u00B7 \u5171 ", Math.ceil(total / 30), " \u9875"] }), _jsx("button", { type: "button", style: styles.pageButton, onClick: () => { setPage(page + 1); void load(query, category, sort, page + 1); }, children: "\u4E0B\u4E00\u9875 \u2192" })] }))] }))] })), tab === 'installed' && (_jsxs(_Fragment, { children: [_jsxs("header", { style: styles.header, children: [_jsx("div", { style: styles.heroIcon, children: _jsx("svg", { width: "36", height: "36", viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M4 10l4 4 8-8" }) }) }), _jsxs("div", { children: [_jsx("h1", { style: styles.title, children: "\u5DF2\u5B89\u88C5\u63D2\u4EF6" }), _jsx("p", { style: styles.subtitle, children: "\u7BA1\u7406\u5DF2\u5B89\u88C5\u7684\u63D2\u4EF6" })] })] }), _jsxs("div", { style: styles.summary, children: ["\u5171 ", _jsx("strong", { children: installed.length }), " \u4E2A\u5DF2\u5B89\u88C5\u63D2\u4EF6", hasUpdates && (_jsxs("span", { style: { color: 'var(--dsw-alias-state-business-primary, #2f49d1)', marginLeft: '12px' }, children: ["\u00B7 ", updateList.length, " \u4E2A\u6709\u53EF\u7528\u66F4\u65B0"] })), !managementAvailable && _jsxs(_Fragment, { children: [_jsx("br", {}), "\u5F53\u524D profile \u672A\u6302\u8F7D\u63D2\u4EF6\u7BA1\u7406\u5668"] })] }), _jsx("div", { style: { padding: '0 28px', marginBottom: '8px' }, children: _jsx("button", { type: "button", style: styles.checkUpdateButton, disabled: updating || !managementAvailable, onClick: () => void checkUpdates(), children: updating ? '正在检查…' : '🔄 检查更新' }) }), installedCardList ?? (_jsx("div", { style: styles.state, children: "\u6682\u65E0\u5DF2\u5B89\u88C5\u63D2\u4EF6" }))] })), _jsx("footer", { style: styles.footer, children: "\u63D2\u4EF6\u7531\u7B2C\u4E09\u65B9\u793E\u533A\u4F5C\u8005\u53D1\u5E03\uFF1B\u63D2\u4EF6\u516C\u793E\u662F\u793E\u533A\u9879\u76EE\uFF0C\u5E76\u975E DeepSeek \u5B98\u65B9\u51FA\u54C1\u3002" }), showUpdateDialog && createPortal(_jsx("div", { style: styles.overlay, children: _jsxs("div", { style: styles.dialog, children: [_jsxs("div", { style: styles.dialogHeader, children: [_jsx("h3", { style: styles.dialogTitle, children: hasUpdates ? '🎉 发现更新' : '✅ 已安装插件均为最新版本' }), _jsx("button", { type: "button", style: styles.dialogClose, onClick: () => setShowUpdateDialog(false), children: "\u2715" })] }), _jsx("div", { style: styles.dialogBody, children: hasUpdates && updateList.length > 0 ? (_jsxs(_Fragment, { children: [_jsx("p", { style: { marginBottom: '12px', fontSize: '14px' }, children: "\u4EE5\u4E0B\u63D2\u4EF6\u6709\u65B0\u7248\u672C\u53EF\u7528\uFF0C\u662F\u5426\u7ACB\u5373\u66F4\u65B0\uFF1F" }), _jsx("div", { style: { maxHeight: '200px', overflowY: 'auto', marginBottom: '16px' }, children: updateList.map((item, idx) => (_jsxs("div", { style: styles.updateItem, children: [_jsx("span", { style: { fontWeight: 500 }, children: item.name }), _jsxs("span", { style: { color: 'var(--dsw-alias-label-tertiary, #6b7080)', marginLeft: '8px' }, children: [item.local, " \u2192 ", item.latest] })] }, idx))) }), _jsx("p", { style: { fontSize: '12px', opacity: 0.7, marginBottom: '16px' }, children: "\u66F4\u65B0\u5B8C\u6210\u540E\u5C06\u81EA\u52A8\u91CD\u542F DSH" }), _jsxs("div", { style: styles.dialogActions, children: [_jsx("button", { type: "button", style: styles.buttonCancel, onClick: () => setShowUpdateDialog(false), children: "\u7A0D\u540E\u66F4\u65B0" }), _jsx("button", { type: "button", style: styles.buttonConfirm, onClick: () => {
                                                    setShowUpdateDialog(false);
                                                    // TODO: 批量更新并重启
                                                    setNotice(`正在批量更新 ${updateList.length} 个插件…完成后将自动重启。`);
                                                }, children: "\u786E\u5B9A\u66F4\u65B0" })] })] })) : (_jsx("p", { style: { textAlign: 'center', padding: '24px 0' }, children: "\u6240\u6709\u5DF2\u5B89\u88C5\u63D2\u4EF6\u5747\u4E3A\u6700\u65B0\u7248\u672C" })) })] }) }), document.body)] }));
}
const styles = {
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
    pagination: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '16px',
        padding: '16px 28px 20px',
    },
    pageButton: {
        padding: '6px 16px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2, #e4e6eb)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        fontSize: '13px',
        color: 'inherit',
        cursor: 'pointer',
        fontWeight: 500,
    },
    pageButtonDisabled: {
        padding: '6px 16px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2, #e4e6eb)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-tertiary, #6b7080)',
        cursor: 'default',
        opacity: 0.4,
    },
    pageInfo: {
        fontSize: '13px',
        color: 'var(--dsw-alias-label-tertiary, #6b7080)',
    },
    checkUpdateButton: {
        padding: '6px 14px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2, #e4e6eb)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        fontSize: '13px',
        color: 'inherit',
        cursor: 'pointer',
        fontWeight: 500,
    },
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
    },
    dialog: {
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        borderRadius: '12px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
        width: '480px',
        maxWidth: '90vw',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
    },
    dialogHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 20px',
        borderBottom: '1px solid var(--dsw-alias-border-l2, #e4e6eb)',
    },
    dialogTitle: {
        margin: 0,
        fontSize: '16px',
        fontWeight: 600,
    },
    dialogClose: {
        background: 'none',
        border: 'none',
        fontSize: '18px',
        cursor: 'pointer',
        opacity: 0.5,
        padding: '0 4px',
    },
    dialogBody: {
        padding: '20px',
        overflowY: 'auto',
        flex: 1,
    },
    updateItem: {
        padding: '8px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l2, #e4e6eb)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    dialogActions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '12px',
        marginTop: '16px',
    },
    buttonCancel: {
        padding: '8px 16px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2, #e4e6eb)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        fontSize: '14px',
        color: 'inherit',
        cursor: 'pointer',
    },
    buttonConfirm: {
        padding: '8px 20px',
        borderRadius: '8px',
        border: 'none',
        background: 'var(--dsw-alias-state-business-primary, #2f49d1)',
        color: '#fff',
        fontSize: '14px',
        fontWeight: 500,
        cursor: 'pointer',
    },
};
//# sourceMappingURL=PluginCommonsPage.js.map