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
    const [plugins, setPlugins] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');
    const [sort, setSort] = useState('stars');
    const [installed, setInstalled] = useState([]);
    const [managementAvailable, setManagementAvailable] = useState(false);
    const [busy, setBusy] = useState(null);
    const [notice, setNotice] = useState(null);
    const [failure, setFailure] = useState(null);
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
    const load = useCallback(async (q, cat, s) => {
        setLoading(true);
        setError(false);
        try {
            const params = new URLSearchParams({ page: '1', limit: '60', sort: s });
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
        }
        catch {
            setError(true);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        void load(query, category, sort);
    }, [load, query, category, sort]);
    useEffect(() => {
        void loadInstalled().catch(() => {
            setManagementAvailable(false);
        });
    }, [loadInstalled]);
    // One watcher for an accepted install/removal: poll until the profile
    // reflects it, then reload so the new plugin's client bundle is picked up.
    useEffect(() => {
        if (busy === null)
            return;
        let cancelled = false;
        const tick = async () => {
            if (cancelled)
                return;
            const current = busyRef.current;
            if (current === null)
                return;
            if (Date.now() - current.startedAt > OPERATION_TIMEOUT_MS) {
                setBusy(null);
                setFailure(`${current.fullName} 的${current.kind === 'install' ? '安装' : '卸载'}超时。` +
                    '网络较慢时 GitHub 下载可能耗时较久，请稍后在插件面板中确认结果。');
                return;
            }
            try {
                const rows = await loadInstalled();
                const plugin = plugins.find((p) => p.full_name === current.fullName);
                const present = plugin !== undefined && matchInstalled(plugin, rows) !== undefined;
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
            setBusy({ fullName: plugin.full_name, kind, startedAt: Date.now() });
        }
        catch (err) {
            setFailure(`${kind === 'install' ? '安装' : '卸载'}失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }, []);
    const cardList = useMemo(() => plugins.map((p) => {
        const row = matchInstalled(p, installed);
        const isBusy = busy?.fullName === p.full_name;
        return (_jsxs("div", { style: styles.card, children: [_jsxs("div", { style: styles.cardHeader, children: [_jsx("a", { href: p.html_url, target: "_blank", rel: "noreferrer noopener", style: styles.pluginName, children: p.full_name }), _jsxs("span", { style: styles.stars, children: ["\u2605 ", formatNumber(p.stars)] })] }), p.description !== null && _jsx("div", { style: styles.description, children: p.description }), _jsxs("div", { style: styles.metaRow, children: [p.language !== null && _jsx("span", { style: styles.tag, children: p.language }), p.topics.slice(0, 3).map((t) => (_jsx("span", { style: styles.tag, children: t }, t))), _jsx("span", { style: styles.metaRight, children: relativeTime(p.updated_at) })] }), _jsx("div", { style: styles.actionRow, children: row !== undefined ? (_jsxs(_Fragment, { children: [_jsx("span", { style: row.enabled ? styles.badgeOn : styles.badgeOff, children: row.enabled ? '已启用' : '已安装 · 未启用' }), row.version !== null && _jsxs("span", { style: styles.badgeMuted, children: ["v", row.version] }), row.removable && row.blockedBy === null ? (_jsx("button", { type: "button", style: styles.buttonDanger, disabled: isBusy || !managementAvailable, onClick: () => void startOperation(p, 'uninstall', row), children: isBusy ? '处理中…' : '卸载' })) : (_jsx("span", { style: styles.badgeMuted, children: "\u4E0D\u53EF\u5378\u8F7D" }))] })) : (_jsx("button", { type: "button", style: styles.buttonPrimary, disabled: isBusy || !managementAvailable, onClick: () => void startOperation(p, 'install'), children: isBusy ? '安装中…' : '安装' })) })] }, p.id));
    }), [plugins, installed, busy, managementAvailable, startOperation]);
    return (_jsxs("div", { style: styles.root, children: [_jsxs("header", { style: styles.header, children: [_jsx("h1", { style: styles.title, children: "\u63D2\u4EF6\u516C\u793E" }), _jsx("p", { style: styles.subtitle, children: "\u793E\u533A\u5171\u5EFA\uFF0C\u63D2\u4EF6\u5171\u4EAB \u00B7 \u6D4F\u89C8\u5E76\u5B89\u88C5 GitHub \u4E0A\u7684 dsh-plugin \u63D2\u4EF6" })] }), _jsx("div", { style: styles.toolbar, children: _jsx("input", { style: styles.search, placeholder: "\u641C\u7D22\u63D2\u4EF6\u540D\u79F0\u3001\u63CF\u8FF0\u6216\u5173\u952E\u8BCD", value: query, onChange: (e) => search(e.target.value) }) }), _jsxs("div", { style: styles.filters, children: [_jsx("div", { style: styles.filterGroup, children: CATEGORIES.map((c) => (_jsx("button", { type: "button", style: category === c.id ? styles.chipActive : styles.chip, onClick: () => setCategory(c.id), children: c.name }, c.id))) }), _jsx("div", { style: styles.filterGroup, children: SORTS.map((s) => (_jsx("button", { type: "button", style: sort === s.id ? styles.chipActive : styles.chip, onClick: () => setSort(s.id), children: s.name }, s.id))) })] }), _jsxs("div", { style: styles.summary, children: ["\u5171 ", total, " \u4E2A\u63D2\u4EF6 \u00B7 \u5DF2\u5B89\u88C5 ", installed.length, " \u4E2A", !managementAvailable && ' · 当前 profile 未挂载插件管理器，仅可浏览'] }), notice !== null && _jsx("div", { style: styles.notice, children: notice }), failure !== null && _jsx("div", { style: styles.failure, children: failure }), loading ? (_jsx("div", { style: styles.state, children: "\u6B63\u5728\u52A0\u8F7D\u2026" })) : error ? (_jsx("div", { style: styles.state, children: "\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5" })) : plugins.length === 0 ? (_jsx("div", { style: styles.state, children: "\u6CA1\u6709\u5339\u914D\u7684\u63D2\u4EF6" })) : (_jsx("div", { style: styles.list, children: cardList })), _jsx("footer", { style: styles.footer, children: "\u63D2\u4EF6\u7531\u7B2C\u4E09\u65B9\u793E\u533A\u4F5C\u8005\u53D1\u5E03\uFF1B\u63D2\u4EF6\u516C\u793E\u662F\u793E\u533A\u9879\u76EE\uFF0C\u5E76\u975E DeepSeek \u5B98\u65B9\u51FA\u54C1\u3002" })] }));
}
const styles = {
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
};
//# sourceMappingURL=PluginCommonsPage.js.map