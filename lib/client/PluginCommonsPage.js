import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Plugin Commons panel page.
 *
 * A self-contained React component: it fetches the host API, renders the
 * plugin catalogue, and installs or removes a plugin through the host's
 * management endpoints. It deliberately avoids the UI-primitives component
 * library so the browser half stays small and dependency-light.
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
    if (n >= 1000000)
        return `${(n / 1000000).toFixed(1)}M`;
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
function getInitial(name) {
    return name.charAt(0).toUpperCase();
}
function getRandomColor(name) {
    const colors = [
        '#5B90FF', '#7ED321', '#F5A623', '#D0D0D0', '#BA508F',
        '#5B90FF', '#FF6B6B', '#9B59B6', '#00B894', '#FDCB6E',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % colors.length;
    return colors[idx];
}
/**
 * Match a catalogue entry to an installed bundle.
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
    const [showTokenConfig, setShowTokenConfig] = useState(false);
    const [tokenInput, setTokenInput] = useState('');
    const [tokenConfiguring, setTokenConfiguring] = useState(false);
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
                setUpdateList(data.updates.map((u) => ({ name: u.name, local: u.localVersion, latest: u.latestVersion, repository: u.repository, pkgName: u.name })));
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
    const batchUpdate = useCallback(async () => {
        setFailure(null);
        setNotice(`正在批量更新 ${updateList.length} 个插件…完成后将自动刷新。`);
        setShowUpdateDialog(false);
        try {
            const specs = updateList.map((u) => ({ pkgName: u.pkgName, repository: u.repository }));
            const res = await fetch('/api/plugin-commons/batch-update', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ specs }),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.failed > 0) {
                setFailure(`批量更新完成：${data.success} 成功，${data.failed} 失败。${data.errors?.join('; ')}`);
            }
            else {
                setNotice(`所有 ${data.success} 个插件已更新成功！页面将自动刷新…`);
            }
            setTimeout(() => { window.location.reload(); }, data.failed > 0 ? 5000 : 2000);
        }
        catch (err) {
            setFailure(`批量更新失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }, [updateList]);
    const saveToken = useCallback(async () => {
        if (!tokenInput.trim()) {
            setFailure('请输入有效的 GitHub Token');
            return;
        }
        setTokenConfiguring(true);
        setFailure(null);
        try {
            const res = await fetch('/api/plugin-commons/save-token', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token: tokenInput.trim() }),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.ok) {
                setNotice('GitHub Token 已保存，正在刷新插件列表…');
                setShowTokenConfig(false);
                setTokenInput('');
                setTimeout(() => { window.location.reload(); }, 1500);
            }
            else {
                setFailure(data.error || '保存失败');
            }
        }
        catch (err) {
            setFailure(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            setTokenConfiguring(false);
        }
    }, [tokenInput]);
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
    useEffect(() => { void loadMeta(); }, [loadMeta]);
    useEffect(() => {
        if (tab !== 'market')
            return;
        void load(query, category, sort, page);
    }, [load, query, category, sort, tab, page]);
    useEffect(() => {
        if (tab !== 'market' && tab !== 'installed')
            return;
        void loadInstalled().catch(() => { setManagementAvailable(false); });
    }, [loadInstalled, tab]);
    // Poll for install/uninstall completion
    useEffect(() => {
        if (busy === null)
            return;
        let cancelled = false;
        const tick = async () => {
            if (cancelled)
                return;
            try {
                const data = await loadInstalled();
                const current = busyRef.current;
                if (current === null || cancelled)
                    return;
                const plugin = plugins.find((p) => p !== undefined && matchInstalled(p, data) !== undefined);
                const present = data.some((row) => {
                    if (current.kind === 'install') {
                        return row.name === plugin?.name || row.name === plugin?.full_name.split('/').pop();
                    }
                    else {
                        return row.name !== plugin?.name && row.name !== plugin?.full_name.split('/').pop();
                    }
                });
                if (current.kind === 'install' ? present : !present) {
                    setBusy(null);
                    window.location.reload();
                    return;
                }
            }
            catch { /* a reload mid-poll is expected */ }
            if (!cancelled)
                setTimeout(() => void tick(), POLL_MS);
        };
        void tick();
        return () => { cancelled = true; };
    }, [busy, plugins, loadInstalled]);
    const search = useCallback((value) => { setQuery(value); setPage(1); }, []);
    const filterByCategory = useCallback((cat) => { setCategory(cat); setPage(1); }, []);
    const sortBy = useCallback((s) => { setSort(s); setPage(1); }, []);
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
                const payload = await res.json().catch(() => null);
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
    const marketGrid = useMemo(() => plugins.map((p) => {
        const row = matchInstalled(p, installed);
        const isBusy = busy?.name === p.full_name;
        const color = getRandomColor(p.full_name);
        return (_jsxs("div", { style: styles.card, children: [_jsxs("div", { style: styles.cardTop, children: [_jsx("div", { style: { width: 44, height: 44, borderRadius: 10, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color }, children: getInitial(p.name) }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsxs("div", { style: styles.cardTitle, children: [_jsx("a", { href: p.html_url, target: "_blank", rel: "noreferrer noopener", style: { color: 'inherit', textDecoration: 'none' }, children: p.full_name }), row && row.version && _jsxs("span", { style: styles.versionBadge, children: ["v", row.version] })] }), _jsx("div", { style: styles.cardAuthor, children: p.owner.login })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, opacity: 0.7, flexShrink: 0 }, children: [_jsx("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "currentColor", children: _jsx("path", { d: "M8 .2a7 7 0 1 1 0 14A7 7 0 0 1 8 .2Zm3.354 4.854-2.172 2.172 2.172 2.172a.75.75 0 1 1-1.06 1.06L7.25 8.31l-2.822 2.822a.75.75 0 0 1-1.06-1.06l2.822-2.822L5.368 5.368a.75.75 0 0 1 1.06-1.06L8.25 7.14l2.172-2.172a.75.75 0 1 1 1.06 1.06Z" }) }), formatNumber(p.stars)] })] }), p.description && _jsx("div", { style: styles.cardDesc, children: p.description }), _jsxs("div", { style: styles.cardTags, children: [p.language && _jsx("span", { style: styles.tag, children: p.language }), p.topics.slice(0, 3).map((t) => _jsx("span", { style: styles.tag, children: t }, t))] }), _jsxs("div", { style: styles.cardBottom, children: [_jsx("span", { style: styles.cardTime, children: relativeTime(p.updated_at) }), row !== undefined ? (row.removable && row.blockedBy === null ? (_jsx("button", { type: "button", style: styles.btnSecondary, disabled: isBusy, onClick: () => void startOperation(p, 'uninstall', row), children: isBusy ? '处理中…' : '卸载' })) : (_jsx("span", { style: { fontSize: 12, opacity: 0.5 }, children: row.enabled ? '已启用' : '已安装' }))) : (_jsx("button", { type: "button", style: styles.btnPrimary, disabled: isBusy || !managementAvailable, onClick: () => void startOperation(p, 'install'), children: isBusy ? '安装中…' : '安装' }))] })] }, p.id));
    }), [plugins, installed, busy, managementAvailable, startOperation]);
    // -----------------------------------------------------------------------
    // Main render
    // -----------------------------------------------------------------------
    return (_jsxs("div", { style: styles.root, children: [_jsxs("div", { style: styles.tabBar, children: [_jsxs("button", { type: "button", style: tab === 'market' ? styles.tabActive : styles.tab, onClick: () => setTab('market'), children: ["\u63D2\u4EF6\u516C\u793E ", _jsx("span", { style: styles.tabCount, children: total })] }), _jsxs("button", { type: "button", style: tab === 'installed' ? styles.tabActive : styles.tab, onClick: () => setTab('installed'), children: ["\u5DF2\u5B89\u88C5\u63D2\u4EF6 ", _jsx("span", { style: styles.tabCount, children: installed.length })] })] }), tab === 'market' && (_jsxs(_Fragment, { children: [_jsxs("header", { style: styles.header, children: [_jsxs("h1", { style: styles.title, children: ["\u63D2\u4EF6\u516C\u793E", _jsx("span", { style: styles.versionLabel, children: "v0.2.0" })] }), _jsxs("p", { style: styles.subtitle, children: ["\u793E\u533A\u5171\u5EFA\uFF0C\u63D2\u4EF6\u5171\u4EAB \u00B7 \u6D4F\u89C8\u3001\u641C\u7D22 GitHub \u4E0A\u7684 ", loading || !total ? 'dsh-plugin' : `${total.toLocaleString()}+ dsh-plugin`, " \u63D2\u4EF6\uFF0C\u4E2D\u6587\u754C\u9762 \u00B7 \u52A8\u6001\u66F4\u65B0 \u00B7 \u672C\u5730\u7F13\u5B58"] })] }), _jsx("div", { style: styles.searchRow, children: _jsxs("div", { style: styles.searchWrap, children: [_jsxs("svg", { style: styles.searchIcon, width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("circle", { cx: "7", cy: "7", r: "5" }), _jsx("path", { d: "M11 11l3.5 3.5" })] }), _jsx("input", { style: styles.search, placeholder: "\u641C\u7D22\u63D2\u4EF6\u540D\u79F0\u3001\u63CF\u8FF0\u6216\u5173\u952E\u8BCD\uFF0C\u6309 Enter \u641C\u7D22", value: query, onChange: (e) => search(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                        search(e.currentTarget.value); } })] }) }), _jsxs("div", { style: styles.filterRow, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: { fontSize: 13, color: 'rgba(255,255,255,0.4)' }, children: "\u5206\u7C7B\uFF1A" }), _jsx("div", { style: styles.filterScroll, children: CATEGORIES.map((c) => (_jsx("button", { type: "button", style: category === c.id ? styles.chipActive : styles.chip, onClick: () => filterByCategory(c.id), children: c.name }, c.id))) })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: { fontSize: 13, color: 'rgba(255,255,255,0.4)' }, children: "\u6392\u5E8F\uFF1A" }), _jsx("div", { style: { display: 'flex', gap: 6 }, children: SORTS.map((s) => (_jsx("button", { type: "button", style: sort === s.id ? styles.chipActive : styles.chip, onClick: () => sortBy(s.id), children: s.name }, s.id))) })] })] }), _jsxs("div", { style: styles.summary, children: ["\u5171 ", _jsx("strong", { children: total }), " \u4E2A\u63D2\u4EF6", fetchedAt && _jsxs(_Fragment, { children: [" \u00B7 \u6E05\u5355\u66F4\u65B0\u4E8E ", fetchedAt] }), !managementAvailable && _jsxs(_Fragment, { children: [_jsx("br", {}), "\u5F53\u524D profile \u672A\u6302\u8F7D\u63D2\u4EF6\u7BA1\u7406\u5668\uFF0C\u4EC5\u53EF\u6D4F\u89C8"] })] }), total < 10000 && (_jsxs("div", { style: styles.infoBox, children: [_jsx("span", { style: { marginRight: 8 }, children: "\u2139\uFE0F" }), _jsx("span", { style: { flex: 1 }, children: "\u9ED8\u8BA4\u9996\u5C4F\u52A0\u8F7D 2000 \u4E2A\u9AD8\u661F\u63D2\u4EF6\uFF0820 \u6B21 API \u8BF7\u6C42\uFF0C\u4E0D\u4F1A\u89E6\u53D1\u9650\u901F\uFF09\u3002\u914D\u7F6E GitHub Token \u53EF\u62C9\u53D6\u5168\u90E8 17,000+ \u63D2\u4EF6\u3002" }), _jsx("button", { type: "button", style: styles.tokenConfigBtn, onClick: () => setShowTokenConfig(true), children: "\u914D\u7F6E Token \u2192" })] })), notice !== null && _jsx("div", { style: styles.notice, children: notice }), failure !== null && _jsx("div", { style: styles.failure, children: failure }), loading ? (_jsx("div", { style: styles.state, children: "\u6B63\u5728\u52A0\u8F7D\u2026" })) : error ? (_jsx("div", { style: styles.state, children: "\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5" })) : plugins.length === 0 ? (_jsx("div", { style: styles.state, children: query || category !== 'all' ? '没有匹配的插件' : '目录尚未加载完成，稍后再试。' })) : (_jsxs(_Fragment, { children: [_jsx("div", { style: styles.grid, children: marketGrid }), hasMore && (_jsxs("div", { style: styles.pagination, children: [_jsx("button", { type: "button", style: page === 1 ? styles.pageBtnDisabled : styles.pageBtn, disabled: page === 1, onClick: () => { setPage(page - 1); void load(query, category, sort, page - 1); }, children: "\u2190 \u4E0A\u4E00\u9875" }), _jsxs("span", { style: styles.pageInfo, children: ["\u7B2C ", page, " \u9875 \u00B7 \u5171 ", Math.ceil(total / 30), " \u9875"] }), _jsx("button", { type: "button", style: styles.pageBtn, onClick: () => { setPage(page + 1); void load(query, category, sort, page + 1); }, children: "\u4E0B\u4E00\u9875 \u2192" })] }))] }))] })), tab === 'installed' && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 28px 0' }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("h1", { style: styles.title, children: "\u5DF2\u5B89\u88C5\u63D2\u4EF6" }), _jsx("p", { style: styles.subtitle, children: "\u67E5\u770B\u4E0E\u7BA1\u7406\u5F53\u524D\u4E3B\u673A\u7684 DSH \u63D2\u4EF6\u3002\u9879\u76EE\u7EA7\u4E0E\u5185\u7F6E\u63D2\u4EF6\u4E0D\u5728\u6B64\u5217\u8868\u4E2D\u3002" })] }), _jsxs("button", { type: "button", style: styles.btnRefresh, onClick: () => { void loadInstalled(); void load(query, category, sort, page); }, children: [_jsxs("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("path", { d: "M1.5 8a6.5 6.5 0 1 1 1.9 4.7M14.5 8a6.5 6.5 0 1 0-1.9-4.7" }), _jsx("path", { d: "M1.5 2.5v5h5", fill: "none" }), _jsx("path", { d: "M14.5 13.5v-5h-5", fill: "none" })] }), "\u5237\u65B0\u5217\u8868"] })] }), _jsx("div", { style: { padding: '12px 28px 0' }, children: _jsxs("div", { style: styles.searchWrap, children: [_jsxs("svg", { style: styles.searchIcon, width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("circle", { cx: "7", cy: "7", r: "5" }), _jsx("path", { d: "M11 11l3.5 3.5" })] }), _jsx("input", { style: styles.search, placeholder: "\u641C\u7D22\u5DF2\u5B89\u88C5\u63D2\u4EF6\u6216\u8DEF\u5F84" })] }) }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 28px 0' }, children: [_jsxs("div", { style: styles.summary, children: ["\u5171 ", _jsx("strong", { children: installed.length }), " \u4E2A\u5DF2\u5B89\u88C5\u63D2\u4EF6", hasUpdates && (_jsxs("span", { style: { color: 'var(--dsw-alias-state-business-primary, #2f49d1)', marginLeft: '12px' }, children: ["\u00B7 ", updateList.length, " \u4E2A\u6709\u53EF\u7528\u66F4\u65B0"] })), !managementAvailable && _jsxs(_Fragment, { children: [_jsx("br", {}), "\u5F53\u524D profile \u672A\u6302\u8F7D\u63D2\u4EF6\u7BA1\u7406\u5668"] })] }), _jsx("button", { type: "button", style: styles.checkUpdateButton, disabled: updating || !managementAvailable, onClick: () => void checkUpdates(), children: updating ? '正在检查…' : '🔄 检查更新' })] }), installed.length === 0 ? (_jsx("div", { style: styles.state, children: "\u6682\u65E0\u5DF2\u5B89\u88C5\u63D2\u4EF6" })) : (_jsx("div", { style: styles.installedList, children: installed.map((row) => {
                            const isBusy = busy && busy.name === row.name;
                            const color = getRandomColor(row.name);
                            return (_jsxs("div", { style: styles.installedCard, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 12 }, children: [_jsx("div", { style: { width: 40, height: 40, borderRadius: 8, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color }, children: getInitial(row.name) }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: { fontWeight: 600, fontSize: 14 }, children: row.name }), row.version && _jsxs("span", { style: styles.versionBadge, children: ["v", row.version] })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }, children: [row.enabled ? (_jsx("span", { style: styles.badgeOn, children: "\u5DF2\u542F\u7528" })) : (_jsx("span", { style: styles.badgeOff, children: "\u5DF2\u5B89\u88C5 \u00B7 \u672A\u542F\u7528" })), row.needsUpdate && (_jsx("span", { style: { ...styles.badgeOn, background: 'rgba(47,73,209,0.12)', color: 'var(--dsw-alias-state-business-primary, #2f49d1)' }, children: "\u65B0\u7248\u672C\u53EF\u7528" })), row.repository && (_jsx("a", { href: row.repository, target: "_blank", rel: "noreferrer noopener", style: { fontSize: 12, opacity: 0.5, textDecoration: 'none' }, children: row.repository }))] })] })] }), _jsx("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: row.removable && row.blockedBy === null ? (_jsx("button", { type: "button", style: styles.btnDanger, disabled: !!isBusy, onClick: () => {
                                                const p = plugins.find((p) => matchInstalled(p, [row]) === row);
                                                startOperation(p ?? { id: 0, name: row.name, full_name: row.name, description: null, html_url: row.repository ?? '', stars: 0, forks: 0, language: null, topics: [], owner: { login: '', avatar_url: '' }, updated_at: new Date().toISOString() }, 'uninstall', row);
                                            }, children: isBusy ? '处理中…' : '卸载' })) : (_jsx("span", { style: { fontSize: 12, opacity: 0.4 }, children: "\u4E0D\u53EF\u5378\u8F7D" })) })] }, row.name));
                        }) }))] })), _jsx("footer", { style: styles.footer, children: "\u63D2\u4EF6\u7531\u7B2C\u4E09\u65B9\u793E\u533A\u4F5C\u8005\u53D1\u5E03\uFF1B\u63D2\u4EF6\u516C\u793E\u662F\u793E\u533A\u9879\u76EE\uFF0C\u5E76\u975E DeepSeek \u5B98\u65B9\u51FA\u54C1\u3002" }), showUpdateDialog && createPortal(_jsx("div", { style: styles.overlay, onClick: () => setShowUpdateDialog(false), children: _jsxs("div", { style: styles.dialog, onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { style: styles.dialogHeader, children: [_jsx("h3", { style: styles.dialogTitle, children: hasUpdates ? '🎉 发现更新' : '✅ 已安装插件均为最新版本' }), _jsx("button", { type: "button", style: styles.dialogClose, onClick: () => setShowUpdateDialog(false), children: "\u2715" })] }), _jsx("div", { style: styles.dialogBody, children: hasUpdates && updateList.length > 0 ? (_jsxs(_Fragment, { children: [_jsx("p", { style: { marginBottom: 12, fontSize: 14 }, children: "\u4EE5\u4E0B\u63D2\u4EF6\u6709\u65B0\u7248\u672C\u53EF\u7528\uFF0C\u662F\u5426\u7ACB\u5373\u66F4\u65B0\uFF1F" }), _jsx("div", { style: { maxHeight: 200, overflowY: 'auto', marginBottom: 16 }, children: updateList.map((item, idx) => (_jsxs("div", { style: styles.updateItem, children: [_jsx("span", { style: { fontWeight: 500 }, children: item.name }), _jsxs("span", { style: { color: 'var(--dsw-alias-label-tertiary, #6b7080)', marginLeft: 8 }, children: [item.local, " \u2192 ", item.latest] })] }, idx))) }), _jsx("p", { style: { fontSize: 12, opacity: 0.7, marginBottom: 16 }, children: "\u66F4\u65B0\u5B8C\u6210\u540E\u5C06\u81EA\u52A8\u5237\u65B0\u9875\u9762" }), _jsxs("div", { style: styles.dialogActions, children: [_jsx("button", { type: "button", style: styles.buttonCancel, onClick: () => setShowUpdateDialog(false), children: "\u7A0D\u540E\u66F4\u65B0" }), _jsx("button", { type: "button", style: styles.buttonConfirm, onClick: () => void batchUpdate(), children: "\u786E\u5B9A\u66F4\u65B0" })] })] })) : (_jsx("p", { style: { textAlign: 'center', padding: '24px 0' }, children: "\u6240\u6709\u5DF2\u5B89\u88C5\u63D2\u4EF6\u5747\u4E3A\u6700\u65B0\u7248\u672C" })) })] }) }), document.body), showTokenConfig && createPortal(_jsx("div", { style: styles.overlay, onClick: () => setShowTokenConfig(false), children: _jsxs("div", { style: styles.dialog, onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { style: styles.dialogHeader, children: [_jsx("h3", { style: styles.dialogTitle, children: "\uD83D\uDD11 \u914D\u7F6E GitHub Token" }), _jsx("button", { type: "button", style: styles.dialogClose, onClick: () => setShowTokenConfig(false), children: "\u2715" })] }), _jsxs("div", { style: styles.dialogBody, children: [_jsxs("p", { style: { marginBottom: 12, fontSize: 14, lineHeight: 1.6 }, children: ["\u4E0D\u914D\u7F6E Token \u65F6\uFF0C\u9ED8\u8BA4\u62C9\u53D6 ", _jsx("strong", { children: "2000 \u4E2A" }), " \u9AD8\u661F\u63D2\u4EF6\uFF0C\u8DB3\u591F\u65E5\u5E38\u4F7F\u7528\u3002", _jsx("br", {}), "\u914D\u7F6E Token \u540E\u53EF\u62C9\u53D6 ", _jsx("strong", { children: "\u5168\u90E8 17,000+" }), " \u63D2\u4EF6\u3002"] }), _jsxs("div", { style: { marginBottom: 16 }, children: [_jsx("label", { style: { fontSize: 13, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }, children: "GitHub Personal Access Token" }), _jsx("input", { style: styles.tokenInput, type: "password", placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx", value: tokenInput, onChange: (e) => setTokenInput(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                                void saveToken(); } })] }), _jsxs("div", { style: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 16 }, children: ["\u524D\u5F80 ", _jsx("a", { href: "https://github.com/settings/tokens", target: "_blank", rel: "noreferrer noopener", style: { color: '#7da2ff' }, children: "GitHub Token \u8BBE\u7F6E\u9875" }), " \u521B\u5EFA\uFF08\u9009 scopes: `repo` \u5373\u53EF\uFF09\u3002"] }), failure && _jsx("div", { style: styles.failure, children: failure }), _jsxs("div", { style: styles.dialogActions, children: [_jsx("button", { type: "button", style: styles.buttonCancel, onClick: () => { setShowTokenConfig(false); setTokenInput(''); }, children: "\u53D6\u6D88" }), _jsx("button", { type: "button", style: styles.buttonConfirm, disabled: tokenConfiguring, onClick: () => void saveToken(), children: tokenConfiguring ? '保存中…' : '保存并刷新' })] })] })] }) }), document.body)] }));
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
};
//# sourceMappingURL=PluginCommonsPage.js.map