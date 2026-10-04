# DSH 插件公社 / DSH Plugin Commons

<p align="center">
  <strong>社区共建，插件共享。</strong><br>
  Community-built. Community-driven.
</p>

<p align="center">
  浏览、搜索 GitHub 上所有 <code>dsh-plugin</code> 主题插件（17,000+ 个）。
  中文界面 · 动态更新 · 本地缓存
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#api">API</a> ·
  <a href="#开发">开发</a> ·
  <a href="./LICENSE">MIT</a>
</p>

## 免责声明

> **Community-built, not affiliated with DeepSeek.**
>
> DSH 插件公社是一个社区驱动的项目，旨在整理和展示 GitHub 上所有的 DSH
> 插件。本项目与 DeepSeek 官方无任何隶属或背书关系。所有插件版权归原作者
> 所有，以每个插件自己声明的许可证为准。安装前请查看插件的安全说明。

## 在 Harness 里发现和浏览插件

从 GitHub 的 `dsh-plugin` topic 自动获取插件，提供中文界面浏览、分类筛选、
关键词搜索，帮助你找到合适的 DSH 插件。

## 功能

| 功能 | 说明 |
| --- | --- |
| **插件目录** | 启动时从 GitHub 拉取热门插件快照（默认 500 个），按星标数排序 |
| **实时搜索** | 关键词直达 GitHub 全量语料（17,000+ 个仓库），不受本地快照限制 |
| **分类浏览** | 按功能分类（AI 助手、代码补全、文件管理、开发工具等）筛选 |
| **插件详情** | 查看描述、作者、星标数、语言、更新时间等元数据 |
| **本地缓存** | 快照持久化到 `$DSH_HOME/cache`，离线可用，TTL 默认 12 小时 |
| **手动刷新** | `POST /refresh` 立即从 GitHub 重新拉取目录 |

## 快速开始

适用于 **DeepSeek Harness 0.2.0-rc.2**。

打开 **DeepSeek Harness 桌面端 → 插件 → 安装插件**，粘贴 GitHub 仓库地址：

```text
https://github.com/Dingjerry/dsh-plugin-commons
```

点击 **安装**，等待安装完成后 **立即启用**。

> 安装过程会通过 `pnpm` 从 GitHub 拉取仓库并安装到当前 profile
> （`$DSH_HOME/profiles/<profile>`）。首次安装需要联网访问
> `github.com` / `codeload.github.com`；网络较慢时请耐心等待，
> 不要重复点击安装。

启用后，左侧边栏会出现 **插件公社** 入口（与「技能市场」并列），点击即可浏览和搜索 GitHub 上的 DSH 插件。

### 手动安装（网络受限时）

若图形界面安装因网络中断失败，可在 profile 目录下用 `pnpm` 手动添加，
然后在插件面板里启用：

```bash
cd "$DSH_HOME/profiles/desktop"
pnpm add https://github.com/Dingjerry/dsh-plugin-commons
```

再在 **插件** 面板中启用 `dsh-plugin-commons` 并重启 Harness。

## 配置（可选）

安装后可在插件配置中设置：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `githubToken` | 无 | GitHub 个人访问令牌，提高 API 速率限制 |
| `cacheTtlHours` | `12` | 目录快照的有效期（小时） |
| `maxPages` | `5` | 种子目录拉取的页数（每页 100 个仓库） |
| `pageSize` | `100` | 分页大小（GitHub 上限 100） |

> 未配置 token 时使用 GitHub 匿名速率限制（搜索接口每分钟约 10 次），
> 目录快照有磁盘缓存，正常浏览不受影响。

## API

插件通过 DSH Web Server 暴露以下前缀路由 `ROUTE_PREFIX = /api/plugin-commons`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/status` | 目录状态（ready/loading/error/total） |
| `GET` | `/plugins` | 插件列表，支持 `page`、`limit`、`sort`、`category`、`q` |
| `GET` | `/plugins/detail?full_name=owner/repo` | 单个插件详情（快照未命中时实时查询） |
| `GET` | `/search?q=...` | 实时搜索全量 GitHub 语料 |
| `GET` | `/categories` | 分类及计数 |
| `POST` | `/refresh` | 强制重新拉取目录快照 |

**列表参数**

| 参数 | 值 | 说明 |
| --- | --- | --- |
| `page` | `1..n` | 页码（默认 `1`） |
| `limit` | `1..100` | 每页条数（默认 `50`） |
| `sort` | `stars` / `forks` / `updated` | 排序（默认 `stars`） |
| `category` | 分类 id | 按分类筛选 |
| `q` | 字符串 | 在快照内做本地关键词过滤 |

**示例**

```bash
curl 'http://localhost:3900/api/plugin-commons/plugins?page=1&limit=20&sort=stars'
curl 'http://localhost:3900/api/plugin-commons/search?q=ai'
curl 'http://localhost:3900/api/plugin-commons/categories'
```

## 开发

```bash
# 安装依赖
pnpm install

# 类型检查
pnpm typecheck

# 构建（输出到 lib/）
pnpm build

# 本地 API 测试服务器（复用编译后的 lib/ 模块）
pnpm serve
# 浏览器打开 http://localhost:3900
```

> `pnpm serve` 依赖已构建的 `lib/`，首次请先执行 `pnpm build`。

### 项目结构

```
src/
  index.ts          # 插件入口（host，name/inject/apply）
  types.ts          # WebServerLike、PluginRepo 等共享类型
  web-routes.ts     # HTTP 路由（/api/plugin-commons/*）
  market/
    fetcher.ts      # GitHub API 获取 + 磁盘快照缓存
    catalog.ts      # 内存目录（搜索/分类/分页）
  utils/
    paths.ts        # DSH 目录解析
  client/
    index.tsx       # 客户端入口（注册侧边栏 + 主面板）
    PluginCommonsPage.tsx  # 插件列表页面
    icons.tsx       # 侧边栏图标
    locales.ts      # 中英文文案
scripts/
  serve-api.mjs     # 本地 API 测试服务器
  fetch-plugins.mjs # 手动抓取插件数据到 data/（开发辅助）
```

构建产物：

- `lib/index.js` — host bundle（DSH 后端加载）
- `lib/client.js` — client bundle（`window.__ModuleLoader__.load` 格式，注入 DSH Web GUI）

## 技术细节

- **数据来源**：GitHub Search API 的 `topic:dsh-plugin`，按星标排序
- **快照策略**：启动时读磁盘快照（未过期直接用），否则拉取网络并持久化
- **缓存位置**：`$DSH_HOME/cache/plugin-commons/v1/catalog-snapshot.json`
- **架构参考**：路由与浏览器信任栅栏设计参照 [dsh-skills-hub](https://github.com/NanmiCoder/dsh-skills-hub)

## 贡献

欢迎提交 Issue 和 Pull Request。

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/amazing`）
3. 提交更改（`git commit -m 'Add amazing feature'`）
4. 推送到分支（`git push origin feature/amazing`）
5. 提交 Pull Request

## 版权

- **插件内容**版权归原作者所有，以每个插件自己声明的许可证为准
- **本插件代码**采用 MIT 许可证
- **DSH 插件公社**是独立的社区项目，与 DeepSeek 官方无任何隶属或背书关系

[反馈问题](https://github.com/Dingjerry/dsh-plugin-commons/issues) · [MIT 许可证](./LICENSE)
