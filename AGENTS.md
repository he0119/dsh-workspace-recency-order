# AGENTS.md

本仓库的协作约定，给 AI 助手与贡献者看。安装与用法在 [README](README.md)，英文版在
[README.en.md](README.en.md)；决策的依据与被否决的备选方案在 [.agents/notes/](.agents/notes/AGENTS.md)，
决策地图在 [docs/internals.md](docs/internals.md)，界面与文案规格在 [docs/design.md](docs/design.md)，
落盘与键名在 [docs/formats.md](docs/formats.md)，各种操作的流程在 [docs/flows.md](docs/flows.md)，
目录结构与逐文件职责在 [docs/development.md](docs/development.md)。文档、提交信息、给维护者的报告
一律用中文，术语按 [docs/glossary.md](docs/glossary.md) 的说法，第一次出现先解释。

## 文档分工

每条信息只写一处，别处放链接：

| 文档 | 写什么 |
| --- | --- |
| `README.md` / `README.en.md` | 安装、用法、配置、取舍与限制；两份的键与结构保持对齐 |
| `AGENTS.md` | 本文件：协作约定、提交信息口径、硬约束、验证清单 |
| `.agents/notes/` | 决策的依据、被否决的备选方案与代价；一条决策一篇，格式由 `test/notes.test.ts` 核 |
| `docs/AGENTS.md` | `docs/` 这一层的文档规范与写作规则 |
| `docs/internals.md` | 决策地图（按主题索引到笔记），以及没有笔记承载的当前机制 |
| `docs/design.md` | 界面与文案的唯一规格：菜单项、图标、提示语、置顶组与失败的表现、验收 |
| `docs/development.md` | 目录结构、逐文件职责、开发命令、怎么装进真实 profile、GitHub 上的检查 |
| `docs/formats.md` | 落盘与跨进程的格式：宿主注册表、置顶列表的存储领域与老数据迁移、置顶列表的 HTTP 路由、配置对象、语言键 |
| `docs/flows.md` | 从一次活动或一次点击到宿主写盘的流程，失败怎么办 |
| `docs/releasing.md` | 发布流程：包名与 scope、首版为什么必须手动发、标签触发后那三道校验 |
| `docs/glossary.md` | 术语表：官方怎么说、照写什么、别写成什么 |
| `src/*` 的文件头注释 | 这个文件为什么存在、和宿主哪个接口对应；不重复 README 的用法 |

一次改动**引入了新的决策**（默认值、对外契约、文件格式、工作区里的活动口径、修掉一个有现象可查的
缺陷）时，与代码同一个提交里写一篇笔记，判据见 [.agents/notes/AGENTS.md](.agents/notes/AGENTS.md)；
已经有一篇笔记持有该决策就更新它，不新建重复笔记。措辞调整与纯局部实现细节豁免。

## 提交信息

提交信息按约定式提交（Conventional Commits）写：首行是 `<类型>: <说明>`，类型用英文小写，
说明用中文，冒号后空一格，结尾不加句号。正文空一行再写，讲清为什么改、影响哪些行为；
破坏性变更在正文里另起一段写 `BREAKING CHANGE: <哪里不兼容、怎么迁移>`。

| 类型 | 用在什么时候 |
| --- | --- |
| `feat` | 新增用户能感知的功能 |
| `fix` | 修掉已有的错误行为 |
| `docs` | 只改文档、注释 |
| `test` | 只改测试 |
| `refactor` | 不改行为的代码整理 |
| `build` / `ci` | 改构建、依赖、打包产物、CI |
| `chore` | 其它杂事，如版本号、脚手架 |

例：`fix: 顺序已被别的页面改对时不再写盘`

## 硬约束

- **排序改的是宿主那份持久工作区顺序**（注册表 `workspaceIds`）。不要试图在浏览器里改渲染顺序：侧边栏按那份顺序渲染，客户端没有排序接口。
- **工作区行只有一个扩展位**：行上的「…」菜单（`ctx.contextMenus.register({ target: 'workspace' })`）。行内按钮没有插槽；整体替换 `sidebar.workspaces` 会丢搜索、拖动、树形分组与对话框，别这么做。
- **顺序只有一个写手：Host。** 页面不许再自己挪工作区；它只发一条 `{ workspaceId, pinned }` 命令（`POST /api/workspace-recency/pins`），由 Host 在排序里把置顶项放开头。这一条是「置顶项不会下掉再弹回」的唯一保证。
- **置顶列表归 Host**：存在宿主的存储领域 `workspace_recency_order`（`pins` 表，落在 `<DSH_HOME>/storages/workspace_recency_order.json`），读写走 `ctx.connection.fetch.register()` 注册的认证路由（`GET/POST /api/workspace-recency/pins`）；不要在页面里另存一份当权威。写入是幂等的「目标状态」命令，不是整份列表替换。报文的形状不变。
- **两端共用一个契约**：路由路径、请求/响应形状只写在 `src/protocol.ts`，Host 与页面都 import 它；不要在两边各写一份字符串。
- **置顶项只收宿主注册表里还有的 id**：加载与每次写入时都按注册表过滤（`src/pins.ts` 的 `PinStore`），免得删掉的工作区一直留在开头占位。
- **客户端产物只 `require` 平台基线模块**（`react` / `react/jsx-runtime`）；颜色只用主题 token，不 import 官方控件包。
- **装插件只走 npm，本地目录只留给开发**：发给别人装就报包名
  `@he0119/dsh-workspace-recency-order`；自己调这个插件时把本目录 `link:` 进正在用的开发 profile（软链，
  重新构建即生效，不用重装）。文档与给用户的建议里不要出现从 GitHub 地址或 `github:` 规格装的写法——
  仓库里没有 `lib/`，那样装出来是坏的。

## 接口以官方包为准

`src/types.ts` 与 `src/client/types.ts` 是**本插件用到的成员**的最小结构化声明，故意不 import
DSH 包。唯一的真 import 是领域声明 `src/spec.ts`（`@deepseek-ai/dsh-storage-domain` 见
`peerDependencies`、`zod` 见 `dependencies`）。这些声明必须与官方实现一致；核对位置：

- 工作区注册表：`@deepseek-ai/dsh-workspace`（`list()` / `insertBefore()` / `archivedSessionIds`）
- 会话列表：`@deepseek-ai/dsh-api-session-controller`（`sessionController.list()` 的 `SessionSummary`）
- 活动事件：同包的 `api-session/activity`（只在人类消息时触发）
- 置顶列表路由：`@deepseek-ai/dsh-client-connection` 的 `ctx.connection.fetch.register()`
  （路径是含 `/api` 的完整 pathname，只有 owner 身份的浏览器会话能访问）
- 客户端菜单与权限：`@deepseek-ai/dsh-client-ui-context-menu/client`、
  `@deepseek-ai/dsh-api-remote-access` 的权限源

改了这些用到的地方就要同步改两处 `types.ts`，并在 `test/` 里体现。

## 验证清单

改动前后都跑：

```bash
pnpm run check        # tsc（两份工程，含 test/ 与 scripts/）+ 进程内 runner 跑全部用例
```

`check` 不构建，所以 `check:package` 不在里面；要验产物就多跑一步：

```bash
pnpm run build && pnpm run check:package   # 产物 + 打包自检
```

另外按改动范围补：

- 改了构建或导出：`pnpm run build` 后看 `lib/` 三个产物（`index.js`、`client.js`、`types/`），
  确认 `lib/client.js` 仍以 `window.__ModuleLoader__.load(` 开头、模块 id 等于包名；
  `test/artifact.test.mjs` 会按宿主方式加载这两个产物。
- 改了 Host 排序：用真实 profile 装一次，看侧边栏顺序是否按最近活动变化；顺序已正确时不应写盘。
- 改了客户端置顶：在真实页面上点一次菜单项，确认置顶后行停在开头那一组、在别的工作区发消息时
  置顶项不动，取消后回到活跃度位置，并确认控制台没有 `slot entry crashed` 或重复注册报错。
- 改了置顶列表的路由或落盘：确认 `$DSH_HOME/storages/workspace_recency_order.json` 的 `pins` 表在
  切换置顶后被改写、刷新页面后菜单仍显示「取消置顶」；升级后第一次启动要看到老 `pins.json` 变成
  `pins.json.migrated`，且置顶项原样还在。
- 改了 `.agents/notes/` 或新增笔记：`pnpm test` 里的 `test/notes.test.ts` 会核路径、头部三行、
  `Status:` 与目录一致、必备章节与相对链接。

GitHub 上的检查（`.github/workflows/ci.yml`）跑的就是这两组命令，顺序是先 build、再
check:package、最后 test；本地照这个顺序跑一遍，红了就不用等 CI。

没有浏览器控制时，只能做到类型检查、单元测试与产物自检；界面是否出现、图标是否渲染要如实报告为未验证。
