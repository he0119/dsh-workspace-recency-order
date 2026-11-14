# 开发

安装与用法看 [README](../README.md)，决策依据看[决策笔记](../.agents/notes/AGENTS.md)
（[internals.md](internals.md) 是按主题的索引），界面与文案规格看 [design.md](design.md)。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/index.ts` | Host 端插件：监听活动事件、按活跃度重排注册表、启动种子 |
| `src/order.ts` | 纯排序规则（`orderByActivity` / `nextMove`），不碰任何服务 |
| `src/options.ts` | 配置解析与默认值 |
| `src/types.ts` | Host 侧用到的最小服务面（不 import DSH 包） |
| `src/client/index.ts` | Web Client 端：菜单项、固定列表、顺序纠正与让位 |
| `src/client/types.ts` | 客户端侧用到的最小服务面 |
| `test/*.test.ts` | 排序规则、配置解析、决策笔记格式（进类型检查） |
| `test/client.test.mjs` | 客户端固定行为：菜单项、存储、让位（要浏览器全局） |
| `test/artifact.test.mjs` | 构建产物冒烟：经典脚本契约、基线模块、Host 导出面 |
| `test/run-all.mjs` | 进程内测试 runner（原因见[笔记](../.agents/notes/implemented/testing/2026-11-14-tests-run-in-one-process.md)） |
| `scripts/check-package.mjs` | 打包自检：导出路径、classic script 契约、基线模块、语言资源、`files` |
| `tsdown.config.ts` | 三份构建：Host（ESM）、类型声明、客户端（classic script） |
| `docs/` | 机制文档；表格见 [docs/AGENTS.md](AGENTS.md) |
| `.agents/notes/` | 决策笔记：为什么这么做、放弃了什么 |

## 命令

```sh
pnpm install            # 或 npm install（见「装进真实 profile」）
pnpm run build          # tsdown：lib/index.js + lib/types/** + lib/client.js
pnpm test               # = node test/run-all.mjs（进程内跑全部用例）
pnpm run typecheck      # Host（含测试）与 Web Client 两个工程各查一遍
pnpm run check          # typecheck + test（不构建）
pnpm run check:package  # 打包自检，需要先 build
```

单边重建：`pnpm run build:host` / `build:types` / `build:client`。三份配置共用 `lib/`，所以单独重建
一端不会删掉另一端（`clean` 关着，清理只在 `prebuild` 里做一次）。

`pnpm run test:runner` 是 `node --test` 的原生入口，留着给能起子进程的环境用；本项目自己的口径是
`pnpm test`。

## 两份类型工程

| 工程 | 覆盖 | 为什么分开 |
| --- | --- | --- |
| `tsconfig.json` | `src`（不含 `src/client`）+ `tsdown.config.ts` | Host 侧不该看到 DOM：`lib` 里没有浏览器 API，让它在类型层面就「能」引用 browser API 是隐患 |
| `tsconfig.client.json` | `src/client` | 要 DOM 与 `react-jsx`；`"types": []` 连 node 的类型都不加载 |
| `tsconfig.test.json` | `src` + `test` + `scripts`（继承 Host 那份） | 测试与源码一起查；`.mjs` 不进（理由见下） |

`.test.ts` 进类型检查，`.test.mjs` 不进：后者要 `globalThis.window` 或构建产物，硬塞进没有 DOM 的
工程只会逼出一堆断言。这条分工写在
[测试跑在一个进程里](../.agents/notes/implemented/testing/2026-11-14-tests-run-in-one-process.md)。

## 产物契约

`pnpm run build` 出三个产物，各自有硬约束：

- `lib/index.js`：ESM，导出 `apply` / `inject`，外部依赖一律不打包（`deps.neverBundle`）。
- `lib/types/**`：按源码模块拆开的 `.d.ts`，不含 `src/client`（那里要 React 与 DOM）。
- `lib/client.js`：**经典脚本**，以 `window.__ModuleLoader__.load(` 开头、模块 id 等于包名，只有
  `react` / `react/jsx-runtime` 保持 `require`，其余内联。理由见
  [笔记](../.agents/notes/implemented/architecture/2026-11-14-client-artifact-is-a-classic-script.md)。

`scripts/check-package.mjs` 与 `test/artifact.test.mjs` 就是从这两侧盯这份契约的：前者只读文本，
不需要构建环境也能跑；后者真的按宿主方式执行一遍产物。

## 装进真实 profile

本插件**不发布到 npm**，装法只有一种：把本目录 link 进当前 profile（不是 `npm install` 一个包名）。

```sh
pnpm run build          # link 安装不会帮你构建，产物得先有
```

然后在 DSH 的「设置 → 插件」里用「添加插件」选中本目录，或让 agent 用插件管理器的 `install_bundle`
指向本目录。装完刷新页面——客户端那一半是新加载的模块，不刷新看不到菜单项。

改完源码之后：Host 侧改动要重启 DSH（宿主进程里跑的是 `lib/index.js`）；只改客户端的话，重新
`pnpm run build:client` 再刷新页面即可。

## 没有浏览器控制时

只能在命令行做到：类型检查、单元测试、产物自检与 `test/artifact.test.mjs` 的加载冒烟。**菜单项有没有
出现在工作区行上、图标画出来是什么样、提示语位置对不对，都必须在真实页面上看**——没有看过就照实说
「未验证」，不要从「测试全绿」推断界面正常。
