# AGENTS.md

本仓库的协作约定，给 AI 助手与贡献者看。安装与用法在 [README](README.md)，英文版在
[README.en.md](README.en.md)。文档、提交信息、给维护者的报告一律用中文，术语第一次出现先解释。

## 文档分工

每条信息只写一处，别处放链接：

| 文档 | 写什么 |
| --- | --- |
| `README.md` / `README.en.md` | 安装、用法、配置、取舍与限制；两份的键与结构保持对齐 |
| `AGENTS.md` | 本文件：写码约定、验证清单、界面与接口的硬约束 |
| `src/*` 的文件头注释 | 这个文件为什么存在、和宿主哪个接口对应；不重复 README 的用法 |

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
- **固定列表只存在浏览器**（`localStorage`），页面负责维持；不要在 Host 端假装知道它，也不要为了同步它去加远程接口。
- **纠正顺序要对别人让位**：任何「收到快照就写顺序」的逻辑都必须节流、合并，并在反复被顶掉时主动停手（见 `src/client/index.ts` 的 `CONFLICT_LIMIT` / `YIELD_MS`）。
- **清理失效的固定项只在快照完整时做**（`phase === 'ready' && state === 'idle'`）：列表加载中或断线时的快照不代表工作区被删了。
- **客户端产物只 `require` 平台基线模块**（`react` / `react/jsx-runtime`）；颜色只用主题 token，不 import 官方控件包。

## 接口以官方包为准

`src/types.ts` 与 `src/client/types.ts` 是**本插件用到的成员**的最小结构化声明，故意不 import DSH 包
（产物里一个 require 都不多）。这些声明必须与官方实现一致；核对位置：

- 工作区注册表：`@deepseek-ai/dsh-workspace`（`list()` / `insertBefore()` / `archivedSessionIds`）
- 会话列表：`@deepseek-ai/dsh-api-session-controller`（`sessionController.list()` 的 `SessionSummary`）
- 活动事件：同包的 `api-session/activity`（只在人类消息时触发）
- 客户端顺序与权限：`@deepseek-ai/dsh-api-workspace-controller/client`、`@deepseek-ai/dsh-client-ui-context-menu/client`

改了这些用到的地方就要同步改两处 `types.ts`，并在 `test/` 里体现。

## 验证清单

改动前后都跑：

```bash
pnpm run check        # tsc（两份工程）+ node --test + 打包自检
```

另外按改动范围补：

- 改了构建或导出：`pnpm run build` 后看 `lib/` 三个产物（`index.js`、`client.js`、`types/`），
  确认 `lib/client.js` 仍以 `window.__ModuleLoader__.load(` 开头、模块 id 等于包名。
- 改了 Host 排序：用真实 profile 装一次，看侧边栏顺序是否按最近活动变化；顺序已正确时不应写盘。
- 改了客户端固定：在真实页面上点一次菜单项，确认固定后行停住、取消后放回，并确认控制台没有
  `slot entry crashed` 或重复注册报错。

没有浏览器控制时，只能做到类型检查、单元测试与产物自检；界面是否出现、图标是否渲染要如实报告为未验证。
