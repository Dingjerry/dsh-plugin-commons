window.__ModuleLoader__.load({
	id: "dsh-plugin-commons",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region lib/client/PluginCommonsPage.js
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
		const CATEGORIES = [
			{
				id: "all",
				name: "全部"
			},
			{
				id: "ai-assistant",
				name: "AI 助手"
			},
			{
				id: "code-completion",
				name: "代码补全"
			},
			{
				id: "file-management",
				name: "文件管理"
			},
			{
				id: "browser-automation",
				name: "浏览器自动化"
			},
			{
				id: "data-processing",
				name: "数据处理"
			},
			{
				id: "communication",
				name: "通讯集成"
			},
			{
				id: "development-tools",
				name: "开发工具"
			},
			{
				id: "productivity",
				name: "效率工具"
			},
			{
				id: "multimedia",
				name: "多媒体"
			},
			{
				id: "testing",
				name: "测试工具"
			},
			{
				id: "documentation",
				name: "文档工具"
			}
		];
		const SORTS = [
			{
				id: "stars",
				name: "星标"
			},
			{
				id: "forks",
				name: "Fork"
			},
			{
				id: "updated",
				name: "更新"
			}
		];
		/** How often the panel re-reads the installed list while an operation runs. */
		const POLL_MS = 2e3;
		function formatNumber(n) {
			if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
			return String(n);
		}
		function relativeTime(iso) {
			const then = Date.parse(iso);
			if (Number.isNaN(then)) return "";
			const days = Math.floor((Date.now() - then) / 864e5);
			if (days <= 0) return "今天";
			if (days < 30) return `${days} 天前`;
			if (days < 365) return `${Math.floor(days / 30)} 个月前`;
			return `${Math.floor(days / 365)} 年前`;
		}
		function formatDate(iso) {
			const d = new Date(iso);
			if (Number.isNaN(d.getTime())) return "";
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		}
		/** Lowercase a repository URL so two spellings compare equal. */
		function canonicalRepo(url) {
			return url.trim().replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
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
			if (byRepository !== void 0) return byRepository;
			const owner = plugin.full_name.split("/")[0]?.toLowerCase() ?? "";
			const name = plugin.name.toLowerCase();
			return installed.find((row) => {
				const candidate = row.name.toLowerCase();
				return candidate === name || candidate === `@${owner}/${name}`;
			});
		}
		function PluginCommonsPage() {
			const [tab, setTab] = (0, react.useState)("market");
			const [plugins, setPlugins] = (0, react.useState)([]);
			const [total, setTotal] = (0, react.useState)(0);
			const [fetchedAt, setFetchedAt] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(false);
			const [query, setQuery] = (0, react.useState)("");
			const [category, setCategory] = (0, react.useState)("all");
			const [sort, setSort] = (0, react.useState)("stars");
			const [installed, setInstalled] = (0, react.useState)([]);
			const [managementAvailable, setManagementAvailable] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [failure, setFailure] = (0, react.useState)(null);
			const busyRef = (0, react.useRef)(null);
			busyRef.current = busy;
			const loadInstalled = (0, react.useCallback)(async () => {
				const res = await fetch("/api/plugin-commons/installed");
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = await res.json();
				setManagementAvailable(data.available);
				setInstalled(data.installed);
				return data.installed;
			}, []);
			const loadMeta = (0, react.useCallback)(async () => {
				try {
					const res = await fetch("/api/plugin-commons/status");
					if (!res.ok) return;
					const data = await res.json();
					if (data.status.fetchedAt) {
						const iso = new Date(data.status.fetchedAt).toISOString();
						setFetchedAt(formatDate(iso));
					}
				} catch {}
			}, []);
			const load = (0, react.useCallback)(async (q, cat, s) => {
				setLoading(true);
				setError(false);
				try {
					const params = new URLSearchParams({
						page: "1",
						limit: "60",
						sort: s
					});
					if (cat !== "all") params.set("category", cat);
					if (q.trim() !== "") params.set("q", q.trim());
					const res = await fetch(`/api/plugin-commons/plugins?${params.toString()}`);
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const data = await res.json();
					setPlugins(data.items);
					setTotal(data.total);
				} catch {
					setError(true);
				} finally {
					setLoading(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				loadMeta();
			}, [loadMeta]);
			(0, react.useEffect)(() => {
				if (tab !== "market") return;
				load(query, category, sort);
			}, [
				load,
				query,
				category,
				sort,
				tab
			]);
			(0, react.useEffect)(() => {
				if (tab !== "market" && tab !== "installed") return;
				loadInstalled().catch(() => {
					setManagementAvailable(false);
				});
			}, [loadInstalled, tab]);
			(0, react.useEffect)(() => {
				if (busy === null) return;
				let cancelled = false;
				const tick = async () => {
					if (cancelled) return;
					try {
						const data = await loadInstalled();
						const current = busyRef.current;
						if (current === null || cancelled) return;
						const plugin = plugins.find((plugin) => plugin !== void 0 && matchInstalled(plugin, data) !== void 0);
						const present = data.some((row) => {
							if (current.kind === "install") return row.name === plugin?.name || row.name === plugin?.full_name.split("/").pop();
							else return row.name !== plugin?.name && row.name !== plugin?.full_name.split("/").pop();
						});
						if (current.kind === "install" ? present : !present) {
							setBusy(null);
							window.location.reload();
							return;
						}
					} catch {}
					if (!cancelled) setTimeout(() => void tick(), POLL_MS);
				};
				tick();
				return () => {
					cancelled = true;
				};
			}, [
				busy,
				plugins,
				loadInstalled
			]);
			const search = (0, react.useCallback)((value) => {
				setQuery(value);
			}, []);
			const startOperation = (0, react.useCallback)(async (plugin, kind, installedRow) => {
				setFailure(null);
				setNotice(null);
				const endpoint = kind === "install" ? "install" : "uninstall";
				const body = kind === "install" ? {
					spec: plugin.html_url,
					enabled: true
				} : { name: installedRow?.name ?? plugin.name };
				try {
					const res = await fetch(`/api/plugin-commons/${endpoint}`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					});
					if (!res.ok) {
						const payload = await res.json().catch(() => null);
						throw new Error(payload?.error?.message ?? `HTTP ${res.status}`);
					}
					setNotice(kind === "install" ? `正在安装 ${plugin.full_name}…完成后页面会自动刷新。` : `正在卸载 ${plugin.full_name}…完成后页面会自动刷新。`);
					setBusy({
						name: plugin.full_name,
						kind,
						startedAt: Date.now()
					});
				} catch (err) {
					setFailure(`${kind === "install" ? "安装" : "卸载"}失败：${err instanceof Error ? err.message : String(err)}`);
				}
			}, []);
			const marketCardList = (0, react.useMemo)(() => plugins.map((p) => {
				const row = matchInstalled(p, installed);
				const isBusy = busy?.name === p.full_name;
				return (0, react_jsx_runtime.jsxs)("div", {
					style: styles.card,
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							style: styles.cardHeader,
							children: [(0, react_jsx_runtime.jsx)("a", {
								href: p.html_url,
								target: "_blank",
								rel: "noreferrer noopener",
								style: styles.pluginName,
								children: p.full_name
							}), (0, react_jsx_runtime.jsxs)("span", {
								style: styles.stars,
								children: ["★ ", formatNumber(p.stars)]
							})]
						}),
						p.description !== null && (0, react_jsx_runtime.jsx)("div", {
							style: styles.description,
							children: p.description
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							style: styles.metaRow,
							children: [
								p.language !== null && (0, react_jsx_runtime.jsx)("span", {
									style: styles.tag,
									children: p.language
								}),
								p.topics.slice(0, 3).map((t) => (0, react_jsx_runtime.jsx)("span", {
									style: styles.tag,
									children: t
								}, t)),
								(0, react_jsx_runtime.jsx)("span", {
									style: styles.metaRight,
									children: relativeTime(p.updated_at)
								})
							]
						}),
						(0, react_jsx_runtime.jsx)("div", {
							style: styles.actionRow,
							children: row !== void 0 ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								(0, react_jsx_runtime.jsx)("span", {
									style: row.enabled ? styles.badgeOn : styles.badgeOff,
									children: row.enabled ? "已启用" : "已安装 · 未启用"
								}),
								row.version !== null && (0, react_jsx_runtime.jsxs)("span", {
									style: styles.badgeMuted,
									children: ["v", row.version]
								}),
								row.removable && row.blockedBy === null ? (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: styles.buttonDanger,
									disabled: isBusy || !managementAvailable,
									onClick: () => void startOperation(p, "uninstall", row),
									children: isBusy ? "处理中…" : "卸载"
								}) : (0, react_jsx_runtime.jsx)("span", {
									style: styles.badgeMuted,
									children: "不可卸载"
								})
							] }) : (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.buttonPrimary,
								disabled: isBusy || !managementAvailable,
								onClick: () => void startOperation(p, "install"),
								children: isBusy ? "安装中…" : "安装"
							})
						})
					]
				}, p.id);
			}), [
				plugins,
				installed,
				busy,
				managementAvailable,
				startOperation
			]);
			const installedCardList = (0, react.useMemo)(() => installed.length === 0 ? null : installed.map((row) => {
				const isBusy = busy && busy.name === row.name;
				return (0, react_jsx_runtime.jsxs)("div", {
					style: styles.card,
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							style: styles.cardHeader,
							children: [(0, react_jsx_runtime.jsx)("span", {
								style: styles.pluginName,
								children: row.name
							}), (0, react_jsx_runtime.jsxs)("span", {
								style: styles.stars,
								children: ["v", row.version ?? "?"]
							})]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							style: styles.metaRow,
							children: [row.enabled ? (0, react_jsx_runtime.jsx)("span", {
								style: styles.badgeOn,
								children: "已启用"
							}) : (0, react_jsx_runtime.jsx)("span", {
								style: styles.badgeOff,
								children: "已安装 · 未启用"
							}), row.repository !== null && (0, react_jsx_runtime.jsx)("a", {
								href: row.repository,
								target: "_blank",
								rel: "noreferrer noopener",
								style: {
									fontSize: "12px",
									opacity: .6
								},
								children: row.repository
							})]
						}),
						(0, react_jsx_runtime.jsx)("div", {
							style: styles.actionRow,
							children: row.removable && row.blockedBy === null ? (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.buttonDanger,
								disabled: isBusy || !managementAvailable,
								onClick: () => {
									const p = plugins.find((p) => matchInstalled(p, [row]) === row);
									startOperation(p ?? {
										id: 0,
										name: row.name,
										full_name: row.name,
										description: null,
										html_url: row.repository ?? "",
										stars: 0,
										forks: 0,
										language: null,
										topics: [],
										owner: {
											login: "",
											avatar_url: ""
										},
										updated_at: (/* @__PURE__ */ new Date()).toISOString()
									}, "uninstall", row);
								},
								children: isBusy ? "处理中…" : "卸载"
							}) : (0, react_jsx_runtime.jsx)("span", {
								style: styles.badgeMuted,
								children: "不可卸载"
							})
						})
					]
				}, row.name);
			}), [
				installed,
				busy,
				managementAvailable,
				startOperation,
				plugins
			]);
			return (0, react_jsx_runtime.jsxs)("div", {
				style: styles.root,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: styles.tabBar,
						children: [(0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							style: tab === "market" ? styles.tabActive : styles.tab,
							onClick: () => setTab("market"),
							children: ["插件市场", (0, react_jsx_runtime.jsx)("span", {
								style: styles.tabCount,
								children: total
							})]
						}), (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							style: tab === "installed" ? styles.tabActive : styles.tab,
							onClick: () => setTab("installed"),
							children: ["已安装插件", (0, react_jsx_runtime.jsx)("span", {
								style: styles.tabCount,
								children: installed.length
							})]
						})]
					}),
					tab === "market" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsxs)("header", {
							style: styles.header,
							children: [(0, react_jsx_runtime.jsx)("div", {
								style: styles.heroIcon,
								children: (0, react_jsx_runtime.jsxs)("svg", {
									width: "36",
									height: "36",
									viewBox: "0 0 20 20",
									fill: "none",
									stroke: "currentColor",
									strokeWidth: "1.5",
									strokeLinecap: "round",
									strokeLinejoin: "round",
									children: [
										(0, react_jsx_runtime.jsx)("rect", {
											x: "2.5",
											y: "2.5",
											width: "15",
											height: "15",
											rx: "3"
										}),
										(0, react_jsx_runtime.jsx)("path", {
											d: "M8 2.5V5a1.6 1.6 0 0 0 3.2 0V2.5",
											fill: "currentColor",
											fillOpacity: .1
										}),
										(0, react_jsx_runtime.jsx)("path", { d: "M8 17.5V15a1.6 1.6 0 0 1 3.2 0v2.5" }),
										(0, react_jsx_runtime.jsx)("circle", {
											cx: "10",
											cy: "10",
											r: "2.2"
										}),
										(0, react_jsx_runtime.jsx)("path", { d: "M10 7.8V4.6M10 12.2v3.2M7.8 10H4.6M12.2 10h3.2" })
									]
								})
							}), (0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("h1", {
								style: styles.title,
								children: "插件公社"
							}), (0, react_jsx_runtime.jsx)("p", {
								style: styles.subtitle,
								children: "社区共建，插件共享 · 浏览并安装 GitHub 上的 dsh-plugin 插件"
							})] })]
						}),
						(0, react_jsx_runtime.jsx)("div", {
							style: styles.toolbar,
							children: (0, react_jsx_runtime.jsx)("input", {
								style: styles.search,
								placeholder: "搜索插件名称、描述或关键词",
								value: query,
								onChange: (e) => search(e.target.value)
							})
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							style: styles.filters,
							children: [(0, react_jsx_runtime.jsx)("div", {
								style: styles.filterGroup,
								children: CATEGORIES.map((c) => (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: category === c.id ? styles.chipActive : styles.chip,
									onClick: () => setCategory(c.id),
									children: c.name
								}, c.id))
							}), (0, react_jsx_runtime.jsx)("div", {
								style: styles.filterGroup,
								children: SORTS.map((s) => (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: sort === s.id ? styles.chipActive : styles.chip,
									onClick: () => setSort(s.id),
									children: s.name
								}, s.id))
							})]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							style: styles.summary,
							children: [
								"共 ",
								(0, react_jsx_runtime.jsx)("strong", { children: total }),
								" 个插件",
								fetchedAt && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" · 清单更新于 ", fetchedAt] }),
								!managementAvailable && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("br", {}), "当前 profile 未挂载插件管理器，仅可浏览"] })
							]
						}),
						notice !== null && (0, react_jsx_runtime.jsx)("div", {
							style: styles.notice,
							children: notice
						}),
						failure !== null && (0, react_jsx_runtime.jsx)("div", {
							style: styles.failure,
							children: failure
						}),
						loading ? (0, react_jsx_runtime.jsx)("div", {
							style: styles.state,
							children: "正在加载…"
						}) : error ? (0, react_jsx_runtime.jsx)("div", {
							style: styles.state,
							children: "加载失败，请刷新重试"
						}) : plugins.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
							style: styles.state,
							children: query || category !== "all" ? "没有匹配的插件" : "目录尚未加载完成，稍后再试。"
						}) : (0, react_jsx_runtime.jsx)("div", {
							style: styles.list,
							children: marketCardList
						})
					] }),
					tab === "installed" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsxs)("header", {
							style: styles.header,
							children: [(0, react_jsx_runtime.jsx)("div", {
								style: styles.heroIcon,
								children: (0, react_jsx_runtime.jsx)("svg", {
									width: "36",
									height: "36",
									viewBox: "0 0 20 20",
									fill: "none",
									stroke: "currentColor",
									strokeWidth: "1.5",
									strokeLinecap: "round",
									strokeLinejoin: "round",
									children: (0, react_jsx_runtime.jsx)("path", { d: "M4 10l4 4 8-8" })
								})
							}), (0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("h1", {
								style: styles.title,
								children: "已安装插件"
							}), (0, react_jsx_runtime.jsx)("p", {
								style: styles.subtitle,
								children: "管理已安装的插件"
							})] })]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							style: styles.summary,
							children: [
								"共 ",
								(0, react_jsx_runtime.jsx)("strong", { children: installed.length }),
								" 个已安装插件",
								!managementAvailable && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("br", {}), "当前 profile 未挂载插件管理器"] })
							]
						}),
						installedCardList ?? (0, react_jsx_runtime.jsx)("div", {
							style: styles.state,
							children: "暂无已安装插件"
						})
					] }),
					(0, react_jsx_runtime.jsx)("footer", {
						style: styles.footer,
						children: "插件由第三方社区作者发布；插件公社是社区项目，并非 DeepSeek 官方出品。"
					})
				]
			});
		}
		const styles = {
			root: {
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflowY: "auto",
				padding: "0",
				boxSizing: "border-box",
				color: "var(--dsw-alias-label-primary, #12141a)"
			},
			tabBar: {
				display: "flex",
				gap: "28px",
				borderBottom: "1px solid var(--dsw-alias-border-l2, #e4e6eb)",
				padding: "0 28px",
				margin: "0"
			},
			tab: {
				color: "var(--dsw-alias-label-secondary, #4a4f5c)",
				font: "inherit",
				background: "none",
				border: "none",
				padding: "10px 0 12px",
				fontSize: "14px",
				lineHeight: "21px",
				cursor: "pointer",
				display: "inline-flex",
				alignItems: "center",
				gap: "6px",
				position: "relative"
			},
			tabActive: {
				color: "var(--dsw-alias-label-primary, #12141a)",
				font: "inherit",
				background: "none",
				border: "none",
				padding: "10px 0 12px",
				fontSize: "14px",
				lineHeight: "21px",
				cursor: "default",
				display: "inline-flex",
				alignItems: "center",
				gap: "6px",
				position: "relative",
				fontWeight: 600
			},
			tabCount: {
				background: "color-mix(in srgb, var(--dsw-alias-label-primary, #12141a) 6%, transparent)",
				color: "var(--dsw-alias-label-secondary, #4a4f5c)",
				borderRadius: "999px",
				padding: "0 7px",
				fontSize: "12px",
				fontWeight: 500,
				lineHeight: "18px"
			},
			header: {
				display: "flex",
				gap: "16px",
				padding: "24px 28px 0",
				alignItems: "flex-start"
			},
			heroIcon: {
				width: "48px",
				height: "48px",
				borderRadius: "12px",
				background: "var(--dsw-alias-bg-layer-1, #fff)",
				border: "1px solid var(--dsw-alias-border-l2, #e4e6eb)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				color: "var(--dsw-alias-label-secondary, #4a4f5c)",
				flexShrink: 0
			},
			title: {
				margin: 0,
				fontSize: "20px",
				fontWeight: 700,
				letterSpacing: "-0.01em"
			},
			subtitle: {
				margin: "4px 0 0",
				fontSize: "13px",
				color: "var(--dsw-alias-label-tertiary, #6b7080)",
				lineHeight: 1.5
			},
			toolbar: { padding: "16px 28px 0" },
			search: {
				flex: 1,
				padding: "8px 12px",
				borderRadius: "8px",
				border: "1px solid var(--dsw-alias-border-l2, #e4e6eb)",
				background: "transparent",
				fontSize: "14px",
				color: "inherit",
				outline: "none",
				width: "100%",
				boxSizing: "border-box"
			},
			filters: { padding: "8px 28px 0" },
			filterGroup: {
				display: "flex",
				flexWrap: "wrap",
				gap: "6px",
				marginBottom: "6px"
			},
			chip: {
				padding: "4px 10px",
				borderRadius: "999px",
				border: "1px solid var(--dsw-alias-border-l2, #e4e6eb)",
				background: "transparent",
				fontSize: "12px",
				color: "var(--dsw-alias-label-secondary, #4a4f5c)",
				cursor: "pointer"
			},
			chipActive: {
				padding: "4px 10px",
				borderRadius: "999px",
				border: "1px solid var(--dsw-alias-state-business-primary, #2f49d1)",
				background: "color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f49d1) 10%, transparent)",
				fontSize: "12px",
				color: "var(--dsw-alias-state-business-primary, #2f49d1)",
				cursor: "pointer",
				fontWeight: 500
			},
			summary: {
				fontSize: "13px",
				color: "var(--dsw-alias-label-tertiary, #6b7080)",
				padding: "4px 28px 0"
			},
			notice: {
				padding: "8px 28px",
				borderRadius: "8px",
				border: "1px solid rgba(100,130,255,0.4)",
				background: "rgba(100,130,255,0.1)",
				fontSize: "12px",
				color: "var(--dsw-alias-state-business-primary, #2f49d1)"
			},
			failure: {
				padding: "8px 28px",
				borderRadius: "8px",
				border: "1px solid rgba(230,90,90,0.5)",
				background: "rgba(230,90,90,0.1)",
				fontSize: "12px",
				color: "#e65a5a"
			},
			state: {
				padding: "40px 28px",
				textAlign: "center",
				opacity: .6,
				fontSize: "14px"
			},
			list: {
				display: "flex",
				flexDirection: "column",
				gap: "10px",
				padding: "12px 28px 20px"
			},
			card: {
				display: "flex",
				flexDirection: "column",
				gap: "8px",
				padding: "14px 16px",
				borderRadius: "10px",
				border: "1px solid var(--dsw-alias-border-l2, #e4e6eb)",
				background: "var(--dsw-alias-bg-layer-1, #fff)",
				color: "inherit"
			},
			cardHeader: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				gap: "8px"
			},
			pluginName: {
				fontWeight: 600,
				fontSize: "14px",
				color: "inherit",
				textDecoration: "none"
			},
			stars: {
				fontSize: "13px",
				opacity: .8,
				whiteSpace: "nowrap"
			},
			description: {
				fontSize: "13px",
				opacity: .8,
				display: "-webkit-box",
				WebkitLineClamp: 2,
				WebkitBoxOrient: "vertical",
				overflow: "hidden"
			},
			metaRow: {
				display: "flex",
				flexWrap: "wrap",
				alignItems: "center",
				gap: "6px"
			},
			metaRight: {
				fontSize: "12px",
				opacity: .5,
				marginLeft: "auto"
			},
			tag: {
				padding: "2px 8px",
				borderRadius: "999px",
				background: "rgba(128,128,128,0.1)",
				fontSize: "11px",
				opacity: .7
			},
			actionRow: {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				marginTop: "2px"
			},
			badgeOn: {
				padding: "2px 8px",
				borderRadius: "6px",
				background: "rgba(27,107,69,0.12)",
				color: "#1b6b45",
				fontSize: "12px",
				fontWeight: 500
			},
			badgeOff: {
				padding: "2px 8px",
				borderRadius: "6px",
				background: "rgba(200,160,60,0.18)",
				fontSize: "11px",
				color: "#8a4b00"
			},
			badgeMuted: {
				fontSize: "11px",
				opacity: .55
			},
			buttonPrimary: {
				marginLeft: "auto",
				padding: "5px 14px",
				borderRadius: "7px",
				border: "1px solid var(--dsw-alias-state-business-primary, #2f49d1)",
				background: "var(--dsw-alias-state-business-primary, #2f49d1)",
				color: "#fff",
				fontSize: "12px",
				fontWeight: 500,
				cursor: "pointer"
			},
			buttonDanger: {
				marginLeft: "auto",
				padding: "5px 14px",
				borderRadius: "7px",
				border: "1px solid rgba(230,90,90,0.5)",
				background: "transparent",
				color: "#e65a5a",
				fontSize: "12px",
				fontWeight: 500,
				cursor: "pointer"
			},
			footer: {
				marginTop: "auto",
				paddingTop: "16px",
				fontSize: "12px",
				opacity: .55,
				textAlign: "center",
				padding: "16px 28px"
			}
		};
		//#endregion
		//#region lib/client/icons.js
		const stroke = {
			fill: "none",
			stroke: "currentColor",
			strokeLinecap: "round",
			strokeLinejoin: "round"
		};
		/**
		* Sidebar entry glyph: a puzzle piece over a grid (a "commons" of plugins).
		*
		* Renders a bare `<svg>` and never a button: `sidebar.panellist` entries are
		* rendered inside the sidebar's own `<button>`, so an interactive wrapper here
		* would nest a control inside a control.
		*/
		function PluginCommonsIcon({ size = 16, active = false, className }) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 20 20",
				className,
				strokeWidth: active ? 1.8 : 1.6,
				...stroke,
				"aria-hidden": "true",
				focusable: "false",
				children: [
					(0, react_jsx_runtime.jsx)("rect", {
						x: "2.5",
						y: "2.5",
						width: "15",
						height: "15",
						rx: "3"
					}),
					(0, react_jsx_runtime.jsx)("path", {
						d: "M8 2.5V5a1.6 1.6 0 0 0 3.2 0V2.5",
						fill: active ? "currentColor" : "none",
						fillOpacity: active ? .16 : 0
					}),
					(0, react_jsx_runtime.jsx)("path", { d: "M8 17.5V15a1.6 1.6 0 0 1 3.2 0v2.5" }),
					(0, react_jsx_runtime.jsx)("circle", {
						cx: "10",
						cy: "10",
						r: "2.2"
					}),
					(0, react_jsx_runtime.jsx)("path", { d: "M10 7.8V4.6M10 12.2v3.2M7.8 10H4.6M12.2 10h3.2" })
				]
			});
		}
		//#endregion
		//#region lib/client/locales.js
		/**
		* Dictionaries for the Plugin Commons panel.
		*
		* Registration mechanics follow `dsh-agent-teams`: the plugin calls
		* `ctx.locale.register(NS, { zh, en })` and every registration site that
		* declares `locale: NS` receives the framework's typed `t` seat.
		*/
		/** Dictionary namespace owned by the Plugin Commons client plugin. */
		const NS = "pluginCommons";
		/** Simplified Chinese dictionary. */
		const zh = {
			panel: "插件公社",
			title: "插件公社",
			subtitle: "浏览 GitHub 上所有 dsh-plugin 主题插件。",
			searchPlaceholder: "搜索插件名称、描述或关键词",
			clearSearch: "清除搜索",
			categoryAll: "全部",
			loading: "正在加载…",
			empty: "暂无插件",
			emptyHint: "目录尚未加载完成，稍后再试。",
			emptySearch: "没有匹配的插件",
			retry: "重试",
			refresh: "刷新",
			stars: "星标",
			forks: "Fork",
			language: "语言",
			updated: "更新于",
			openRepo: "打开仓库",
			count: "{count} 个插件",
			total: "共 {count} 个插件（快照）",
			disclaimer: "插件由第三方社区作者发布；插件公社是社区项目，并非 DeepSeek 官方出品。",
			"sort.stars": "按星标",
			"sort.forks": "按 Fork",
			"sort.updated": "按更新"
		};
		/** English dictionary, typed against the Chinese key union. */
		const en = {
			panel: "Plugin Commons",
			title: "Plugin Commons",
			subtitle: "Browse every dsh-plugin repository on GitHub.",
			searchPlaceholder: "Search plugin name, description or keyword",
			clearSearch: "Clear search",
			categoryAll: "All",
			loading: "Loading…",
			empty: "No plugins yet",
			emptyHint: "The catalogue has not finished loading. Try again in a moment.",
			emptySearch: "No matching plugins",
			retry: "Retry",
			refresh: "Refresh",
			stars: "Stars",
			forks: "Forks",
			language: "Language",
			updated: "Updated",
			openRepo: "Open repository",
			count: "{count} plugins",
			total: "{count} plugins (snapshot)",
			disclaimer: "Plugins are published by third-party community authors; Plugin Commons is a community project, not an official DeepSeek product.",
			"sort.stars": "Stars",
			"sort.forks": "Forks",
			"sort.updated": "Updated"
		};
		//#endregion
		//#region lib/client/index.js
		/**
		* DSH Plugin Commons, browser half.
		*
		* Two registrations, exactly the shape `@deepseek-ai/dsh-client-ui-plugin-manager`
		* uses for its own panel:
		*
		*   ctx.slots.inject('main', function* () { yield ctx.slots.register({ name: 'main', key: PANEL_ID, … }, Page) })
		*   ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order, label, … }, Icon))
		*
		* `slots.inject` waits for the declaring entry (the frame declares `main`, the
		* sidebar declares `sidebar.panellist`) and keeps the registration on this
		* plugin's fiber, so unloading the plugin removes both contributions.
		*
		* Selecting the panel is not done here: the sidebar renders each
		* `sidebar.panellist` entry inside its own `<button>` whose click calls
		* `selectPanel(id)`. Because our entry `id` equals the `main` registration key,
		* that call opens this panel.
		*/
		/** Stable plugin name of the browser half. */
		const name = "plugin-commons-client";
		/** Services required before the registrations can be made. */
		const inject = ["slots", "locale"];
		/** Sidebar entry id and `main` slot key — the same value links the two. */
		const PANEL_ID = "plugin-commons";
		/** Register the sidebar entry and the panel it opens. */
		function apply(ctx) {
			const slots = ctx.slots;
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "plugin-commons: dictionaries");
			const t = ctx.locale.bind(NS);
			slots.inject("main", function* () {
				yield slots.register({
					name: "main",
					key: PANEL_ID,
					locale: NS
				}, PluginCommonsPage);
			});
			slots.inject("sidebar.panellist", () => slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 20,
				label: () => t("panel"),
				locale: NS
			}, PluginCommonsIcon));
		}
		//#endregion
		exports.PANEL_ID = PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map