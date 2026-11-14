<p align="center">
  <img src="icon.svg" width="56" alt="">
</p>

<div align="center">

# dsh-workspace-recency-order

[![](https://img.shields.io/badge/powered_by_dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

</div>

让 DSH 侧边栏的工作区列表**按最近用过的会话排序**：你刚在哪个工作区里发过消息，它就在最上面；别的工作区再活跃也挤不掉你置顶的那个。和 Codex 的项目列表一个行为。

[中文](README.md) | [English](README.en.md)

为什么要插件来做：侧边栏渲染的是宿主注册表里那份持久的工作区顺序（`workspaceIds`），浏览器端没有留给插件拦截排序的接口，也没有工作区级的置顶（宿主只提供会话级置顶）。本插件在 Host 端维护那份顺序，客户端那一半只负责菜单和读写置顶列表。

## 安装

本插件不发布到 npm，只有一种装法：克隆仓库，把这份目录 link 进当前 profile。

```bash
git clone https://github.com/he0119/dsh-workspace-recency-order.git
cd dsh-workspace-recency-order
pnpm install
pnpm run build      # link 安装不会帮你跑构建，产物得先有
```

然后在 DSH 的「设置 → 插件」里用「添加插件」选中这个目录，或让 agent 用插件管理器的 `install_bundle` 指向它。装完刷新页面（客户端那一半是新加载的模块）。

## 用法

### 自动排序

- 你在某个工作区的会话里发一条消息 → 该工作区移到列表第一位。
- 在某个工作区里新建会话（还没发言的空会话也算）→ 该工作区移到最前。
- 其余工作区保持原来的相对顺序；从没有过活动的工作区排在后面（彼此顺序不变）。
- DSH 启动时按已有会话记录整理一次（`sortOnStart`），之后才靠事件驱动。

**什么算活动**：会话里人类发出的消息（宿主事件 `api-session/activity`，只在 `source.kind === 'user'` 时触发），以及会话的创建时间。子智能体的会话不参与；已归档会话的历史时间也不参与（否则会出现「最上面的工作区里看不到任何近期会话」）；不属于任何工作区的会话（未分组）不影响顺序。

### 置顶

工作区那一行的「…」菜单（右键该行也行）里多一项：

- 「置顶」——把这个工作区放进开头那一组；可以置顶多个，组里的先后就是你看到的样子，新置顶的排在组尾。
- 「取消置顶」——松开它，立刻回到按活跃度该在的位置。

**它是菜单项，不是行上的图标按钮**：宿主的工作区行只留了「…」菜单这一个扩展位（会话行才有悬停按钮的插槽）。要在工作区行上画一颗自己的图标，只能整体替换侧边栏的工作区列表，那会同时丢掉搜索、拖动排序、工作区树和各种对话框。

置顶的几件事：

- 顺序**只有一个写手：宿主**。页面点置顶只是把「置顶了谁」告诉宿主（`POST /api/workspace-recency/pins`），由宿主把置顶项排到开头。所以置顶项不会在每次活动之后被挤下去再弹回来，页面关掉期间置顶也照样生效。
- 置顶列表存在宿主这边：`<DSH_HOME>/workspace-recency-order/pins.json`（默认 `~/.dsh/workspace-recency-order/pins.json`）。这台机器上的所有浏览器看到同一份，切回页面时会重新读一次。
- 置顶项只占开头那一段，**不会把刚用过的工作区挡在更下面**：在别的工作区发消息，那个工作区会排到置顶组下面，置顶组本身一动不动。
- 写不进去（宿主拒绝、连接断了）会提示一次失败，并且以后端那份列表为准，不假装成功。

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

- 排序改的是**宿主那份持久顺序**：手动拖动出来的位置会在下一条消息或重启后被覆盖；置顶组内部例外——组里的先后会保持你拖出来的样子。想完全手动控制就在「设置 → 插件」里关掉本插件。
- 只对默认的「按工作区」分组生效；「工作区树」视图里子工作区跟随上级目录嵌套，被置顶的子工作区只能在同级里排最前。
- 每次活动最多触发一次排序；每次移动是一次注册表写入（本机这份约 67 KB 的 JSON），顺序已经正确时不写。
- 置顶列表不进会话日志，写在上面那个 `pins.json` 里；删掉这个文件就回到没有置顶。它跟着这台机器的 `DSH_HOME` 走，不随会话同步到别的机器。

## 文档

- [docs/design.md](docs/design.md)——菜单项、图标与提示语的完整规格
- [docs/flows.md](docs/flows.md)——一次活动、一次点击分别走到哪一步
- [docs/internals.md](docs/internals.md)——宿主的接口面与决策索引
- [docs/development.md](docs/development.md)——目录结构、构建、测试、装进真实 profile
- [.agents/notes/](.agents/notes/AGENTS.md)——每条决策的依据与被放弃的做法

## 许可证

MIT
