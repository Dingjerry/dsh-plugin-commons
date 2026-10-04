window.__ModuleLoader__.load({
	id: "dsh-plugin-commons",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		//#region lib/client/PluginCommonsPage.js
		/**
		* Plugin Commons panel page.
		*
		* A self-contained React component: it fetches the host API, renders the
		* plugin catalogue, and installs or removes a plugin through the host's
		* management endpoints. It deliberately avoids the UI-primitives component
		* library so the browser half stays small and dependency-light.
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
			if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
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
		function getInitial(name) {
			return name.charAt(0).toUpperCase();
		}
		function getRandomColor(name) {
			const colors = [
				"#5B90FF",
				"#7ED321",
				"#F5A623",
				"#D0D0D0",
				"#BA508F",
				"#5B90FF",
				"#FF6B6B",
				"#9B59B6",
				"#00B894",
				"#FDCB6E"
			];
			let hash = 0;
			for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
			return colors[Math.abs(hash) % colors.length];
		}
		/**
		* Match a catalogue entry to an installed bundle.
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
			const [hasMore, setHasMore] = (0, react.useState)(false);
			const [fetchedAt, setFetchedAt] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(false);
			const [page, setPage] = (0, react.useState)(1);
			const [query, setQuery] = (0, react.useState)("");
			const [category, setCategory] = (0, react.useState)("all");
			const [sort, setSort] = (0, react.useState)("stars");
			const [installed, setInstalled] = (0, react.useState)([]);
			const [managementAvailable, setManagementAvailable] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [failure, setFailure] = (0, react.useState)(null);
			const [showTokenConfig, setShowTokenConfig] = (0, react.useState)(false);
			const [tokenInput, setTokenInput] = (0, react.useState)("");
			const [tokenConfiguring, setTokenConfiguring] = (0, react.useState)(false);
			const [hasUpdates, setHasUpdates] = (0, react.useState)(false);
			const [updating, setUpdating] = (0, react.useState)(false);
			const [showUpdateDialog, setShowUpdateDialog] = (0, react.useState)(false);
			const [updateList, setUpdateList] = (0, react.useState)([]);
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
			const checkUpdates = (0, react.useCallback)(async () => {
				setUpdating(true);
				setFailure(null);
				try {
					const res = await fetch("/api/plugin-commons/check-updates");
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const data = await res.json();
					setHasUpdates(data.hasUpdates);
					if (data.hasUpdates && data.updates) {
						setUpdateList(data.updates.map((u) => ({
							name: u.name,
							local: u.localVersion,
							latest: u.latestVersion,
							repository: u.repository,
							pkgName: u.name
						})));
						setShowUpdateDialog(true);
					}
				} catch (err) {
					setFailure(`检查更新失败：${err instanceof Error ? err.message : String(err)}`);
				} finally {
					setUpdating(false);
				}
			}, []);
			const batchUpdate = (0, react.useCallback)(async () => {
				setFailure(null);
				setNotice(`正在批量更新 ${updateList.length} 个插件…完成后将自动刷新。`);
				setShowUpdateDialog(false);
				try {
					const specs = updateList.map((u) => ({
						pkgName: u.pkgName,
						repository: u.repository
					}));
					const res = await fetch("/api/plugin-commons/batch-update", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ specs })
					});
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const data = await res.json();
					if (data.failed > 0) setFailure(`批量更新完成：${data.success} 成功，${data.failed} 失败。${data.errors?.join("; ")}`);
					else setNotice(`所有 ${data.success} 个插件已更新成功！页面将自动刷新…`);
					setTimeout(() => {
						window.location.reload();
					}, data.failed > 0 ? 5e3 : 2e3);
				} catch (err) {
					setFailure(`批量更新失败：${err instanceof Error ? err.message : String(err)}`);
				}
			}, [updateList]);
			const saveToken = (0, react.useCallback)(async () => {
				if (!tokenInput.trim()) {
					setFailure("请输入有效的 GitHub Token");
					return;
				}
				setTokenConfiguring(true);
				setFailure(null);
				try {
					const res = await fetch("/api/plugin-commons/save-token", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ token: tokenInput.trim() })
					});
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const data = await res.json();
					if (data.ok) {
						setNotice("GitHub Token 已保存，正在刷新插件列表…");
						setShowTokenConfig(false);
						setTokenInput("");
						setTimeout(() => {
							window.location.reload();
						}, 1500);
					} else setFailure(data.error || "保存失败");
				} catch (err) {
					setFailure(`保存失败：${err instanceof Error ? err.message : String(err)}`);
				} finally {
					setTokenConfiguring(false);
				}
			}, [tokenInput]);
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
			const pageRef = (0, react.useRef)(page);
			pageRef.current = page;
			const load = (0, react.useCallback)(async (q, cat, s, pg) => {
				setLoading(true);
				setError(false);
				try {
					const params = new URLSearchParams({
						page: String(pg),
						limit: "30",
						sort: s
					});
					if (cat !== "all") params.set("category", cat);
					if (q.trim() !== "") params.set("q", q.trim());
					const res = await fetch(`/api/plugin-commons/plugins?${params.toString()}`);
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const data = await res.json();
					setPlugins(data.items);
					setTotal(data.total);
					setHasMore(data.hasMore);
					if (pg !== pageRef.current) setPage(pg);
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
				load(query, category, sort, page);
			}, [
				load,
				query,
				category,
				sort,
				tab,
				page
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
						const plugin = plugins.find((p) => p !== void 0 && matchInstalled(p, data) !== void 0);
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
				setPage(1);
			}, []);
			const filterByCategory = (0, react.useCallback)((cat) => {
				setCategory(cat);
				setPage(1);
			}, []);
			const sortBy = (0, react.useCallback)((s) => {
				setSort(s);
				setPage(1);
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
			const marketGrid = (0, react.useMemo)(() => plugins.map((p) => {
				const row = matchInstalled(p, installed);
				const isBusy = busy?.name === p.full_name;
				const color = getRandomColor(p.full_name);
				return (0, react_jsx_runtime.jsxs)("div", {
					style: styles.card,
					children: [
						(0, react_jsx_runtime.jsxs)("div", {
							style: styles.cardTop,
							children: [
								(0, react_jsx_runtime.jsx)("div", {
									style: {
										width: 44,
										height: 44,
										borderRadius: 10,
										background: `${color}22`,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										fontSize: 18,
										fontWeight: 700,
										color
									},
									children: getInitial(p.name)
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									style: {
										flex: 1,
										minWidth: 0
									},
									children: [(0, react_jsx_runtime.jsxs)("div", {
										style: styles.cardTitle,
										children: [(0, react_jsx_runtime.jsx)("a", {
											href: p.html_url,
											target: "_blank",
											rel: "noreferrer noopener",
											style: {
												color: "inherit",
												textDecoration: "none"
											},
											children: p.full_name
										}), row && row.version && (0, react_jsx_runtime.jsxs)("span", {
											style: styles.versionBadge,
											children: ["v", row.version]
										})]
									}), (0, react_jsx_runtime.jsx)("div", {
										style: styles.cardAuthor,
										children: p.owner.login
									})]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 4,
										fontSize: 13,
										opacity: .7,
										flexShrink: 0
									},
									children: [(0, react_jsx_runtime.jsx)("svg", {
										width: "14",
										height: "14",
										viewBox: "0 0 16 16",
										fill: "currentColor",
										children: (0, react_jsx_runtime.jsx)("path", { d: "M8 .2a7 7 0 1 1 0 14A7 7 0 0 1 8 .2Zm3.354 4.854-2.172 2.172 2.172 2.172a.75.75 0 1 1-1.06 1.06L7.25 8.31l-2.822 2.822a.75.75 0 0 1-1.06-1.06l2.822-2.822L5.368 5.368a.75.75 0 0 1 1.06-1.06L8.25 7.14l2.172-2.172a.75.75 0 1 1 1.06 1.06Z" })
									}), formatNumber(p.stars)]
								})
							]
						}),
						p.description && (0, react_jsx_runtime.jsx)("div", {
							style: styles.cardDesc,
							children: p.description
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							style: styles.cardTags,
							children: [p.language && (0, react_jsx_runtime.jsx)("span", {
								style: styles.tag,
								children: p.language
							}), p.topics.slice(0, 3).map((t) => (0, react_jsx_runtime.jsx)("span", {
								style: styles.tag,
								children: t
							}, t))]
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							style: styles.cardBottom,
							children: [(0, react_jsx_runtime.jsx)("span", {
								style: styles.cardTime,
								children: relativeTime(p.updated_at)
							}), row !== void 0 ? row.removable && row.blockedBy === null ? (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.btnSecondary,
								disabled: isBusy,
								onClick: () => void startOperation(p, "uninstall", row),
								children: isBusy ? "处理中…" : "卸载"
							}) : (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 12,
									opacity: .5
								},
								children: row.enabled ? "已启用" : "已安装"
							}) : (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.btnPrimary,
								disabled: isBusy || !managementAvailable,
								onClick: () => void startOperation(p, "install"),
								children: isBusy ? "安装中…" : "安装"
							})]
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
			return (0, react_jsx_runtime.jsxs)("div", {
				style: styles.root,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: styles.tabBar,
						children: [(0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							style: tab === "market" ? styles.tabActive : styles.tab,
							onClick: () => setTab("market"),
							children: ["插件公社 ", (0, react_jsx_runtime.jsx)("span", {
								style: styles.tabCount,
								children: total
							})]
						}), (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							style: tab === "installed" ? styles.tabActive : styles.tab,
							onClick: () => setTab("installed"),
							children: ["已安装插件 ", (0, react_jsx_runtime.jsx)("span", {
								style: styles.tabCount,
								children: installed.length
							})]
						})]
					}),
					tab === "market" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsxs)("header", {
							style: styles.header,
							children: [(0, react_jsx_runtime.jsxs)("h1", {
								style: styles.title,
								children: ["插件公社", (0, react_jsx_runtime.jsx)("span", {
									style: styles.versionLabel,
									children: "v0.2.0"
								})]
							}), (0, react_jsx_runtime.jsxs)("p", {
								style: styles.subtitle,
								children: [
									"社区共建，插件共享 · 浏览、搜索 GitHub 上的 ",
									loading || !total ? "dsh-plugin" : `${total.toLocaleString()}+ dsh-plugin`,
									" 插件，中文界面 · 动态更新 · 本地缓存"
								]
							})]
						}),
						(0, react_jsx_runtime.jsx)("div", {
							style: styles.searchRow,
							children: (0, react_jsx_runtime.jsxs)("div", {
								style: styles.searchWrap,
								children: [(0, react_jsx_runtime.jsxs)("svg", {
									style: styles.searchIcon,
									width: "16",
									height: "16",
									viewBox: "0 0 16 16",
									fill: "none",
									stroke: "currentColor",
									strokeWidth: "1.5",
									children: [(0, react_jsx_runtime.jsx)("circle", {
										cx: "7",
										cy: "7",
										r: "5"
									}), (0, react_jsx_runtime.jsx)("path", { d: "M11 11l3.5 3.5" })]
								}), (0, react_jsx_runtime.jsx)("input", {
									style: styles.search,
									placeholder: "搜索插件名称、描述或关键词，按 Enter 搜索",
									value: query,
									onChange: (e) => search(e.target.value),
									onKeyDown: (e) => {
										if (e.key === "Enter") search(e.currentTarget.value);
									}
								})]
							})
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							style: styles.filterRow,
							children: [(0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8
								},
								children: [(0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 13,
										color: "rgba(255,255,255,0.4)"
									},
									children: "分类："
								}), (0, react_jsx_runtime.jsx)("div", {
									style: styles.filterScroll,
									children: CATEGORIES.map((c) => (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: category === c.id ? styles.chipActive : styles.chip,
										onClick: () => filterByCategory(c.id),
										children: c.name
									}, c.id))
								})]
							}), (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8
								},
								children: [(0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 13,
										color: "rgba(255,255,255,0.4)"
									},
									children: "排序："
								}), (0, react_jsx_runtime.jsx)("div", {
									style: {
										display: "flex",
										gap: 6
									},
									children: SORTS.map((s) => (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: sort === s.id ? styles.chipActive : styles.chip,
										onClick: () => sortBy(s.id),
										children: s.name
									}, s.id))
								})]
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
						total < 1e4 && (0, react_jsx_runtime.jsxs)("div", {
							style: styles.infoBox,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									style: { marginRight: 8 },
									children: "ℹ️"
								}),
								(0, react_jsx_runtime.jsx)("span", {
									style: { flex: 1 },
									children: "默认首屏加载 2000 个高星插件（20 次 API 请求，不会触发限速）。配置 GitHub Token 可拉取全部 17,000+ 插件。"
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: styles.tokenConfigBtn,
									onClick: () => setShowTokenConfig(true),
									children: "配置 Token →"
								})
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
						}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("div", {
							style: styles.grid,
							children: marketGrid
						}), hasMore && (0, react_jsx_runtime.jsxs)("div", {
							style: styles.pagination,
							children: [
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: page === 1 ? styles.pageBtnDisabled : styles.pageBtn,
									disabled: page === 1,
									onClick: () => {
										setPage(page - 1);
										load(query, category, sort, page - 1);
									},
									children: "← 上一页"
								}),
								(0, react_jsx_runtime.jsxs)("span", {
									style: styles.pageInfo,
									children: [
										"第 ",
										page,
										" 页 · 共 ",
										Math.ceil(total / 30),
										" 页"
									]
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: styles.pageBtn,
									onClick: () => {
										setPage(page + 1);
										load(query, category, sort, page + 1);
									},
									children: "下一页 →"
								})
							]
						})] })
					] }),
					tab === "installed" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								padding: "24px 28px 0"
							},
							children: [(0, react_jsx_runtime.jsxs)("div", {
								style: { flex: 1 },
								children: [(0, react_jsx_runtime.jsx)("h1", {
									style: styles.title,
									children: "已安装插件"
								}), (0, react_jsx_runtime.jsx)("p", {
									style: styles.subtitle,
									children: "查看与管理当前主机的 DSH 插件。项目级与内置插件不在此列表中。"
								})]
							}), (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								style: styles.btnRefresh,
								onClick: () => {
									loadInstalled();
									load(query, category, sort, page);
								},
								children: [(0, react_jsx_runtime.jsxs)("svg", {
									width: "14",
									height: "14",
									viewBox: "0 0 16 16",
									fill: "none",
									stroke: "currentColor",
									strokeWidth: "1.5",
									children: [
										(0, react_jsx_runtime.jsx)("path", { d: "M1.5 8a6.5 6.5 0 1 1 1.9 4.7M14.5 8a6.5 6.5 0 1 0-1.9-4.7" }),
										(0, react_jsx_runtime.jsx)("path", {
											d: "M1.5 2.5v5h5",
											fill: "none"
										}),
										(0, react_jsx_runtime.jsx)("path", {
											d: "M14.5 13.5v-5h-5",
											fill: "none"
										})
									]
								}), "刷新列表"]
							})]
						}),
						(0, react_jsx_runtime.jsx)("div", {
							style: { padding: "12px 28px 0" },
							children: (0, react_jsx_runtime.jsxs)("div", {
								style: styles.searchWrap,
								children: [(0, react_jsx_runtime.jsxs)("svg", {
									style: styles.searchIcon,
									width: "16",
									height: "16",
									viewBox: "0 0 16 16",
									fill: "none",
									stroke: "currentColor",
									strokeWidth: "1.5",
									children: [(0, react_jsx_runtime.jsx)("circle", {
										cx: "7",
										cy: "7",
										r: "5"
									}), (0, react_jsx_runtime.jsx)("path", { d: "M11 11l3.5 3.5" })]
								}), (0, react_jsx_runtime.jsx)("input", {
									style: styles.search,
									placeholder: "搜索已安装插件或路径"
								})]
							})
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								padding: "4px 28px 0"
							},
							children: [(0, react_jsx_runtime.jsxs)("div", {
								style: styles.summary,
								children: [
									"共 ",
									(0, react_jsx_runtime.jsx)("strong", { children: installed.length }),
									" 个已安装插件",
									hasUpdates && (0, react_jsx_runtime.jsxs)("span", {
										style: {
											color: "var(--dsw-alias-state-business-primary, #2f49d1)",
											marginLeft: "12px"
										},
										children: [
											"· ",
											updateList.length,
											" 个有可用更新"
										]
									}),
									!managementAvailable && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("br", {}), "当前 profile 未挂载插件管理器"] })
								]
							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.checkUpdateButton,
								disabled: updating || !managementAvailable,
								onClick: () => void checkUpdates(),
								children: updating ? "正在检查…" : "🔄 检查更新"
							})]
						}),
						installed.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
							style: styles.state,
							children: "暂无已安装插件"
						}) : (0, react_jsx_runtime.jsx)("div", {
							style: styles.installedList,
							children: installed.map((row) => {
								const isBusy = busy && busy.name === row.name;
								const color = getRandomColor(row.name);
								return (0, react_jsx_runtime.jsxs)("div", {
									style: styles.installedCard,
									children: [(0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 12
										},
										children: [(0, react_jsx_runtime.jsx)("div", {
											style: {
												width: 40,
												height: 40,
												borderRadius: 8,
												background: `${color}22`,
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												fontSize: 16,
												fontWeight: 700,
												color
											},
											children: getInitial(row.name)
										}), (0, react_jsx_runtime.jsxs)("div", {
											style: {
												flex: 1,
												minWidth: 0
											},
											children: [(0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 8
												},
												children: [(0, react_jsx_runtime.jsx)("span", {
													style: {
														fontWeight: 600,
														fontSize: 14
													},
													children: row.name
												}), row.version && (0, react_jsx_runtime.jsxs)("span", {
													style: styles.versionBadge,
													children: ["v", row.version]
												})]
											}), (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 8,
													marginTop: 4
												},
												children: [
													row.enabled ? (0, react_jsx_runtime.jsx)("span", {
														style: styles.badgeOn,
														children: "已启用"
													}) : (0, react_jsx_runtime.jsx)("span", {
														style: styles.badgeOff,
														children: "已安装 · 未启用"
													}),
													row.needsUpdate && (0, react_jsx_runtime.jsx)("span", {
														style: {
															...styles.badgeOn,
															background: "rgba(47,73,209,0.12)",
															color: "var(--dsw-alias-state-business-primary, #2f49d1)"
														},
														children: "新版本可用"
													}),
													row.repository && (0, react_jsx_runtime.jsx)("a", {
														href: row.repository,
														target: "_blank",
														rel: "noreferrer noopener",
														style: {
															fontSize: 12,
															opacity: .5,
															textDecoration: "none"
														},
														children: row.repository
													})
												]
											})]
										})]
									}), (0, react_jsx_runtime.jsx)("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 8
										},
										children: row.removable && row.blockedBy === null ? (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: styles.btnDanger,
											disabled: !!isBusy,
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
											style: {
												fontSize: 12,
												opacity: .4
											},
											children: "不可卸载"
										})
									})]
								}, row.name);
							})
						})
					] }),
					(0, react_jsx_runtime.jsx)("footer", {
						style: styles.footer,
						children: "插件由第三方社区作者发布；插件公社是社区项目，并非 DeepSeek 官方出品。"
					}),
					showUpdateDialog && (0, react_dom.createPortal)((0, react_jsx_runtime.jsx)("div", {
						style: styles.overlay,
						onClick: () => setShowUpdateDialog(false),
						children: (0, react_jsx_runtime.jsxs)("div", {
							style: styles.dialog,
							onClick: (e) => e.stopPropagation(),
							children: [(0, react_jsx_runtime.jsxs)("div", {
								style: styles.dialogHeader,
								children: [(0, react_jsx_runtime.jsx)("h3", {
									style: styles.dialogTitle,
									children: hasUpdates ? "🎉 发现更新" : "✅ 已安装插件均为最新版本"
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: styles.dialogClose,
									onClick: () => setShowUpdateDialog(false),
									children: "✕"
								})]
							}), (0, react_jsx_runtime.jsx)("div", {
								style: styles.dialogBody,
								children: hasUpdates && updateList.length > 0 ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									(0, react_jsx_runtime.jsx)("p", {
										style: {
											marginBottom: 12,
											fontSize: 14
										},
										children: "以下插件有新版本可用，是否立即更新？"
									}),
									(0, react_jsx_runtime.jsx)("div", {
										style: {
											maxHeight: 200,
											overflowY: "auto",
											marginBottom: 16
										},
										children: updateList.map((item, idx) => (0, react_jsx_runtime.jsxs)("div", {
											style: styles.updateItem,
											children: [(0, react_jsx_runtime.jsx)("span", {
												style: { fontWeight: 500 },
												children: item.name
											}), (0, react_jsx_runtime.jsxs)("span", {
												style: {
													color: "var(--dsw-alias-label-tertiary, #6b7080)",
													marginLeft: 8
												},
												children: [
													item.local,
													" → ",
													item.latest
												]
											})]
										}, idx))
									}),
									(0, react_jsx_runtime.jsx)("p", {
										style: {
											fontSize: 12,
											opacity: .7,
											marginBottom: 16
										},
										children: "更新完成后将自动刷新页面"
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										style: styles.dialogActions,
										children: [(0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: styles.buttonCancel,
											onClick: () => setShowUpdateDialog(false),
											children: "稍后更新"
										}), (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: styles.buttonConfirm,
											onClick: () => void batchUpdate(),
											children: "确定更新"
										})]
									})
								] }) : (0, react_jsx_runtime.jsx)("p", {
									style: {
										textAlign: "center",
										padding: "24px 0"
									},
									children: "所有已安装插件均为最新版本"
								})
							})]
						})
					}), document.body),
					showTokenConfig && (0, react_dom.createPortal)((0, react_jsx_runtime.jsx)("div", {
						style: styles.overlay,
						onClick: () => setShowTokenConfig(false),
						children: (0, react_jsx_runtime.jsxs)("div", {
							style: styles.dialog,
							onClick: (e) => e.stopPropagation(),
							children: [(0, react_jsx_runtime.jsxs)("div", {
								style: styles.dialogHeader,
								children: [(0, react_jsx_runtime.jsx)("h3", {
									style: styles.dialogTitle,
									children: "🔑 配置 GitHub Token"
								}), (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: styles.dialogClose,
									onClick: () => setShowTokenConfig(false),
									children: "✕"
								})]
							}), (0, react_jsx_runtime.jsxs)("div", {
								style: styles.dialogBody,
								children: [
									(0, react_jsx_runtime.jsxs)("p", {
										style: {
											marginBottom: 12,
											fontSize: 14,
											lineHeight: 1.6
										},
										children: [
											"不配置 Token 时，默认拉取 ",
											(0, react_jsx_runtime.jsx)("strong", { children: "2000 个" }),
											" 高星插件，足够日常使用。",
											(0, react_jsx_runtime.jsx)("br", {}),
											"配置 Token 后可拉取 ",
											(0, react_jsx_runtime.jsx)("strong", { children: "全部 17,000+" }),
											" 插件。"
										]
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										style: { marginBottom: 16 },
										children: [(0, react_jsx_runtime.jsx)("label", {
											style: {
												fontSize: 13,
												color: "rgba(255,255,255,0.6)",
												display: "block",
												marginBottom: 6
											},
											children: "GitHub Personal Access Token"
										}), (0, react_jsx_runtime.jsx)("input", {
											style: styles.tokenInput,
											type: "password",
											placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
											value: tokenInput,
											onChange: (e) => setTokenInput(e.target.value),
											onKeyDown: (e) => {
												if (e.key === "Enter") saveToken();
											}
										})]
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										style: {
											fontSize: 12,
											color: "rgba(255,255,255,0.4)",
											marginBottom: 16
										},
										children: [
											"前往 ",
											(0, react_jsx_runtime.jsx)("a", {
												href: "https://github.com/settings/tokens",
												target: "_blank",
												rel: "noreferrer noopener",
												style: { color: "#7da2ff" },
												children: "GitHub Token 设置页"
											}),
											" 创建（选 scopes: `repo` 即可）。"
										]
									}),
									failure && (0, react_jsx_runtime.jsx)("div", {
										style: styles.failure,
										children: failure
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										style: styles.dialogActions,
										children: [(0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: styles.buttonCancel,
											onClick: () => {
												setShowTokenConfig(false);
												setTokenInput("");
											},
											children: "取消"
										}), (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											style: styles.buttonConfirm,
											disabled: tokenConfiguring,
											onClick: () => void saveToken(),
											children: tokenConfiguring ? "保存中…" : "保存并刷新"
										})]
									})
								]
							})]
						})
					}), document.body)
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
				color: "var(--dsw-alias-label-primary, #12141a)",
				background: "#18191c"
			},
			tabBar: {
				display: "flex",
				gap: 28,
				borderBottom: "1px solid rgba(255,255,255,0.08)",
				padding: "0 28px",
				margin: 0,
				background: "#18191c"
			},
			tab: {
				color: "rgba(255,255,255,0.5)",
				font: "inherit",
				background: "none",
				border: "none",
				padding: "12px 0 14px",
				fontSize: 14,
				lineHeight: "21px",
				cursor: "pointer",
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				position: "relative"
			},
			tabActive: {
				color: "#fff",
				font: "inherit",
				background: "none",
				border: "none",
				padding: "12px 0 14px",
				fontSize: 14,
				lineHeight: "21px",
				cursor: "default",
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				position: "relative",
				fontWeight: 600
			},
			tabCount: {
				background: "rgba(255,255,255,0.08)",
				color: "rgba(255,255,255,0.6)",
				borderRadius: 999,
				padding: "0 7px",
				fontSize: 12,
				fontWeight: 500,
				lineHeight: "18px"
			},
			header: {
				display: "flex",
				flexDirection: "column",
				padding: "24px 28px 0"
			},
			title: {
				margin: 0,
				fontSize: 20,
				fontWeight: 700,
				letterSpacing: "-0.01em",
				color: "#fff",
				display: "inline",
				alignItems: "baseline",
				gap: 8
			},
			versionLabel: {
				fontSize: 12,
				color: "rgba(255,255,255,0.4)",
				fontWeight: 400,
				marginLeft: 6
			},
			subtitle: {
				margin: "4px 0 0",
				fontSize: 13,
				color: "rgba(255,255,255,0.5)",
				lineHeight: 1.5
			},
			searchRow: { padding: "16px 28px 0" },
			searchWrap: {
				position: "relative",
				display: "flex",
				alignItems: "center"
			},
			searchIcon: {
				position: "absolute",
				left: 12,
				color: "rgba(255,255,255,0.3)",
				pointerEvents: "none"
			},
			search: {
				flex: 1,
				padding: "8px 12px 8px 34px",
				borderRadius: 8,
				border: "1px solid rgba(255,255,255,0.08)",
				background: "rgba(255,255,255,0.04)",
				fontSize: 14,
				color: "#fff",
				outline: "none",
				width: "100%",
				boxSizing: "border-box"
			},
			filterRow: { padding: "8px 28px 0" },
			filterScroll: {
				display: "flex",
				flexWrap: "wrap",
				gap: 6,
				marginBottom: 6
			},
			chip: {
				padding: "4px 10px",
				borderRadius: 999,
				border: "1px solid rgba(255,255,255,0.12)",
				background: "transparent",
				fontSize: 12,
				color: "rgba(255,255,255,0.6)",
				cursor: "pointer"
			},
			chipActive: {
				padding: "4px 10px",
				borderRadius: 999,
				border: "1px solid #2f49d1",
				background: "rgba(47,73,209,0.15)",
				fontSize: 12,
				color: "#7da2ff",
				cursor: "pointer",
				fontWeight: 500
			},
			summary: {
				fontSize: 13,
				color: "rgba(255,255,255,0.45)",
				padding: "4px 28px 0"
			},
			notice: {
				padding: "8px 28px",
				borderRadius: 8,
				border: "1px solid rgba(100,130,255,0.4)",
				background: "rgba(100,130,255,0.1)",
				fontSize: 12,
				color: "#7da2ff"
			},
			failure: {
				padding: "8px 28px",
				borderRadius: 8,
				border: "1px solid rgba(230,90,90,0.5)",
				background: "rgba(230,90,90,0.1)",
				fontSize: 12,
				color: "#e65a5a"
			},
			state: {
				padding: "40px 28px",
				textAlign: "center",
				opacity: .5,
				fontSize: 14,
				color: "rgba(255,255,255,0.6)"
			},
			grid: {
				display: "grid",
				gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
				gap: 12,
				padding: "12px 28px 20px"
			},
			card: {
				display: "flex",
				flexDirection: "column",
				gap: 8,
				padding: 16,
				borderRadius: 12,
				border: "1px solid rgba(255,255,255,0.08)",
				background: "rgba(255,255,255,0.04)",
				color: "inherit"
			},
			cardTop: {
				display: "flex",
				alignItems: "center",
				gap: 10
			},
			cardTitle: {
				fontWeight: 600,
				fontSize: 14,
				color: "rgba(255,255,255,0.9)",
				display: "flex",
				alignItems: "center",
				gap: 6,
				overflow: "hidden",
				textOverflow: "ellipsis"
			},
			cardAuthor: {
				fontSize: 12,
				color: "rgba(255,255,255,0.4)",
				marginTop: 2
			},
			cardDesc: {
				fontSize: 13,
				color: "rgba(255,255,255,0.6)",
				lineHeight: 1.4,
				display: "-webkit-box",
				WebkitLineClamp: 2,
				WebkitBoxOrient: "vertical",
				overflow: "hidden"
			},
			cardTags: {
				display: "flex",
				flexWrap: "wrap",
				gap: 4
			},
			cardBottom: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				marginTop: 2
			},
			cardTime: {
				fontSize: 12,
				color: "rgba(255,255,255,0.35)"
			},
			tag: {
				padding: "2px 8px",
				borderRadius: 999,
				background: "rgba(255,255,255,0.06)",
				fontSize: 11,
				color: "rgba(255,255,255,0.5)"
			},
			versionBadge: {
				padding: "1px 6px",
				borderRadius: 6,
				border: "1px solid rgba(255,255,255,0.12)",
				fontSize: 11,
				color: "rgba(255,255,255,0.5)",
				fontWeight: 500,
				whiteSpace: "nowrap"
			},
			installedList: {
				display: "flex",
				flexDirection: "column",
				gap: 8,
				padding: "8px 28px 20px"
			},
			installedCard: {
				display: "flex",
				alignItems: "center",
				gap: 12,
				padding: "14px 16px",
				borderRadius: 12,
				border: "1px solid rgba(255,255,255,0.08)",
				background: "rgba(255,255,255,0.04)",
				color: "inherit"
			},
			badgeOn: {
				padding: "2px 8px",
				borderRadius: 6,
				background: "rgba(27,107,69,0.15)",
				color: "#4ade80",
				fontSize: 12,
				fontWeight: 500
			},
			badgeOff: {
				padding: "2px 8px",
				borderRadius: 6,
				background: "rgba(200,160,60,0.15)",
				color: "#f0a040",
				fontSize: 11
			},
			badgeMuted: {
				fontSize: 11,
				opacity: .55
			},
			btnPrimary: {
				padding: "6px 16px",
				borderRadius: 8,
				border: "none",
				background: "#2f49d1",
				color: "#fff",
				fontSize: 13,
				fontWeight: 500,
				cursor: "pointer",
				whiteSpace: "nowrap"
			},
			btnSecondary: {
				padding: "6px 16px",
				borderRadius: 8,
				border: "1px solid rgba(255,255,255,0.15)",
				background: "transparent",
				color: "rgba(255,255,255,0.7)",
				fontSize: 13,
				fontWeight: 500,
				cursor: "pointer",
				whiteSpace: "nowrap"
			},
			btnDanger: {
				padding: "6px 16px",
				borderRadius: 8,
				border: "1px solid rgba(230,90,90,0.5)",
				background: "rgba(230,90,90,0.08)",
				color: "#e65a5a",
				fontSize: 13,
				fontWeight: 500,
				cursor: "pointer",
				whiteSpace: "nowrap"
			},
			btnRefresh: {
				padding: "8px 16px",
				borderRadius: 8,
				border: "1px solid rgba(255,255,255,0.1)",
				background: "rgba(255,255,255,0.04)",
				color: "rgba(255,255,255,0.7)",
				fontSize: 13,
				cursor: "pointer",
				display: "flex",
				alignItems: "center",
				gap: 6,
				whiteSpace: "nowrap"
			},
			infoBox: {
				display: "flex",
				alignItems: "flex-start",
				gap: 8,
				padding: "10px 28px",
				fontSize: 12,
				color: "rgba(255,255,255,0.55)",
				lineHeight: 1.5
			},
			tokenConfigBtn: {
				padding: "3px 10px",
				borderRadius: 6,
				border: "1px solid rgba(47,73,209,0.5)",
				background: "rgba(47,73,209,0.12)",
				color: "#7da2ff",
				fontSize: 12,
				fontWeight: 500,
				cursor: "pointer",
				whiteSpace: "nowrap",
				flexShrink: 0
			},
			tokenInput: {
				width: "100%",
				padding: "8px 12px",
				borderRadius: 8,
				border: "1px solid rgba(255,255,255,0.12)",
				background: "rgba(255,255,255,0.06)",
				fontSize: 14,
				color: "#fff",
				fontFamily: "monospace",
				outline: "none",
				boxSizing: "border-box"
			},
			checkUpdateButton: {
				margin: "8px 28px 0",
				padding: "8px 18px",
				borderRadius: 8,
				border: "1px solid rgba(255,255,255,0.1)",
				background: "rgba(255,255,255,0.04)",
				fontSize: 13,
				color: "rgba(255,255,255,0.7)",
				cursor: "pointer",
				fontWeight: 500
			},
			footer: {
				marginTop: "auto",
				padding: "16px 28px",
				fontSize: 12,
				color: "rgba(255,255,255,0.3)",
				textAlign: "center"
			},
			pagination: {
				display: "flex",
				justifyContent: "center",
				alignItems: "center",
				gap: 16,
				padding: "16px 28px 20px"
			},
			pageBtn: {
				padding: "6px 16px",
				borderRadius: 8,
				border: "1px solid rgba(255,255,255,0.12)",
				background: "rgba(255,255,255,0.04)",
				fontSize: 13,
				color: "rgba(255,255,255,0.7)",
				cursor: "pointer",
				fontWeight: 500
			},
			pageBtnDisabled: {
				padding: "6px 16px",
				borderRadius: 8,
				border: "1px solid rgba(255,255,255,0.12)",
				background: "rgba(255,255,255,0.04)",
				fontSize: 13,
				color: "rgba(255,255,255,0.25)",
				cursor: "default"
			},
			pageInfo: {
				fontSize: 13,
				color: "rgba(255,255,255,0.45)"
			},
			overlay: {
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				background: "rgba(0,0,0,0.6)",
				display: "flex",
				justifyContent: "center",
				alignItems: "center",
				zIndex: 9999
			},
			dialog: {
				background: "#232429",
				borderRadius: 12,
				boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
				width: "480px",
				maxWidth: "90vw",
				maxHeight: "80vh",
				display: "flex",
				flexDirection: "column",
				border: "1px solid rgba(255,255,255,0.08)"
			},
			dialogHeader: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				padding: "16px 20px",
				borderBottom: "1px solid rgba(255,255,255,0.08)"
			},
			dialogTitle: {
				margin: 0,
				fontSize: 16,
				fontWeight: 600,
				color: "#fff"
			},
			dialogClose: {
				background: "none",
				border: "none",
				fontSize: 18,
				cursor: "pointer",
				color: "rgba(255,255,255,0.5)",
				padding: "0 4px"
			},
			dialogBody: {
				padding: "20px",
				overflowY: "auto",
				flex: 1,
				color: "rgba(255,255,255,0.8)"
			},
			updateItem: {
				padding: "8px 0",
				borderBottom: "1px solid rgba(255,255,255,0.06)",
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center"
			},
			dialogActions: {
				display: "flex",
				justifyContent: "flex-end",
				gap: 12,
				marginTop: 16
			},
			buttonCancel: {
				padding: "8px 16px",
				borderRadius: 8,
				border: "1px solid rgba(255,255,255,0.12)",
				background: "transparent",
				fontSize: 14,
				color: "rgba(255,255,255,0.7)",
				cursor: "pointer"
			},
			buttonConfirm: {
				padding: "8px 20px",
				borderRadius: 8,
				border: "none",
				background: "#2f49d1",
				color: "#fff",
				fontSize: 14,
				fontWeight: 500,
				cursor: "pointer"
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