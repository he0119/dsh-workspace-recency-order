<p align="center">
  <img src="icon.svg" width="56" alt="">
</p>

<div align="center">

# dsh-workspace-recency-order

[![](https://img.shields.io/badge/powered_by_dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

</div>

让 DSH 侧边栏的工作区列表**按最近用过的会话排序**：你刚在哪个工作区里发过消息，它就在最上面；别的工作区再活跃也挤不掉你固定住的那个。和 Codex 的项目列表一个行为。

[中文](README.md) | [English](README.en.md)

为什么要插件来做：侧边栏渲染的是宿主注册表里那份持久的工作区顺序（`workspaceIds`），浏览器端没有留给插件拦截排序的接口，也没有工作区级的固定（宿主只提供会话级固定）。本插件在 Host 端维护那份顺序，客户端那一半提供固定开关。

## 安装

本仓库是本地目录安装（link 到当前 profile，不经 npm）：

```bash
# 先构建产物：link 安装不会帮你跑构建
pnpm install
pnpm run build
```

然后在 DSH 的「设置 → 插件」里用「添加插件」选中本目录，或让 agent 用插件管理器的 `install_bundle` 指向本目录。装完刷新页面（客户端那一半是新加载的模块）。

## 用法

### 自动排序

- 你在某个工作区的会话里发一条消息 → 该工作区移到列表第一位。
- 在某个工作区里新建会话（还没发言的空会话也算）→ 该工作区移到最前。
- 其余工作区保持原来的相对顺序；从没有过活动的工作区排在后面（彼此顺序不变）。
- DSH 启动时按已有会话记录整理一次（`sortOnStart`），之后才靠事件驱动。

**什么算活动**：会话里人类发出的消息（宿主事件 `api-session/activity`，只在 `source.kind === 'user'` 时触发），以及会话的创建时间。子智能体的会话不参与；已归档会话的历史时间也不参与（否则会出现「最上面的工作区里看不到任何近期会话」）；不属于任何工作区的会话（未分组）不影响顺序。

### 固定工作区到最前

工作区那一行的「…」菜单（右键该行也行）里多一项：

- 「固定工作区到最前」——把这个工作区钉在第一位；可以固定多个，最近固定的排更前。
- 「取消工作区固定」——松开它，重新按活跃度参与排序。

**它是菜单项，不是行上的图标按钮**：宿主的工作区行只留了「…」菜单这一个扩展位（会话行才有悬停按钮的插槽）。要在工作区行上画一颗自己的图标，只能整体替换侧边栏的工作区列表，那会同时丢掉搜索、拖动排序、工作区树和各种对话框。

固定的几件事：

- 固定列表存在**当前浏览器**里（`localStorage`，键 `dsh.workspace-recency.pinned-workspaces.v1`），不同步到别的设备；同一浏览器打开的多个页面共享它。
- 固定**靠页面维持**：宿主每次按活跃度重排后，页面立刻把固定项挪回去。页面关掉期间没人纠正，别处的活动仍可能把它挤下去，下次打开页面会自动挪回。
- 两个浏览器同时固定**不同**工作区会抢同一个顺序。插件发现自己在反复纠正别人刚改的顺序，连续 4 次后主动让位 30 秒并提示一次，不会无限对写。
- 写不进去（权限不足、宿主拒绝）会回滚固定状态并只提示一次失败；浏览器不允许保存设置时会明说「固定无法记住」，不假装成功。

## 配置

`cordis.patch.yml` 里本插件那一行的 `config`（整段替换，要覆盖默认值时请写全想保留的字段）：

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；`false` 时不注册任何监听 |
| `sortOnStart` | `true` | 启动时按已有会话记录整理一次顺序 |
| `trackNewSessions` | `true` | 新建会话（含空会话）也把所属工作区提到最前 |
| `debounceMs` | `600` | 连续活动合并成一次写入的等待时间（毫秒） |

写错的键名或取值会在宿主日志里留一条 `warn`，然后按默认值处理。

## 取舍与限制

- 排序改的是**宿主那份持久顺序**：手动拖动出来的位置会在下一条消息或重启后被覆盖。想完全手动控制就在「设置 → 插件」里关掉本插件。
- 只对默认的「按工作区」分组生效；「工作区树」视图里子工作区跟随上级目录嵌套，被固定的子工作区只能在同级里排最前。
- 每次活动最多触发一次排序；每次移动是一次注册表写入（本机这份约 67 KB 的 JSON），顺序已经正确时不写。
- 固定状态不进会话日志，换机器、换浏览器、清站点数据后需要重新固定。

## 开发

```bash
pnpm install
pnpm run build      # lib/index.js（Host，ESM）+ lib/client.js（Client，classic script）+ lib/types
pnpm run typecheck  # Host 与 Client 两份 tsconfig 各查一遍
pnpm run test       # node --test（直接跑 src 里的 TypeScript，Node 24 类型剥离）
pnpm run check      # 类型检查 + 测试 + 打包自检
```

目录：

| 路径 | 作用 |
| --- | --- |
| `src/index.ts` | Host 端插件：监听活动事件、按活跃度重排注册表 |
| `src/order.ts` | 纯排序规则（`orderByActivity` / `nextMove`），测试直接覆盖 |
| `src/options.ts` | 配置解析与默认值 |
| `src/types.ts` | Host 侧用到的最小服务面（不 import DSH 包） |
| `src/client/index.ts` | 客户端：菜单项、固定列表、顺序纠正与让位 |
| `src/client/types.ts` | 客户端侧用到的最小服务面 |
| `test/*.test.mjs` | 排序规则、配置解析、客户端固定行为 |
| `scripts/check-package.mjs` | 打包自检：导出路径、classic script 契约、基线模块、语言资源 |
| `tsdown.config.ts` | 三份构建：Host、类型声明、客户端 |
