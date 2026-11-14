# 术语

官方（DSH）怎么说的、本仓库怎么写、别写成什么。看代码或写文档时按这张表对齐。

| 术语 | 官方说法 | 本仓库写法 | 别写成 | 出处 |
| --- | --- | --- | --- | --- |
| 工作区 | workspace | 工作区 | 项目、目录（工作区不等于它的目录） | 宿主的 `workspaceRegistry` |
| 工作区注册表 | workspace registry | 注册表（首次出现写全「工作区注册表」） | 工作区表、workspace 列表 | 注册表服务的 `list()` / `insertBefore()` |
| 持久顺序 | — | 宿主那份持久顺序 | 排序、排序结果（那是动作） | [formats.md](formats.md) |
| 会话 | session | 会话 | 对话、聊天 | `sessionController` |
| 活动 / 活跃 | activity | 活动（一次事件）、活跃度（排序依据） | 活跃（当名词用） | 事件 `api-session/activity` |
| 固定 | —（宿主只有会话级固定） | 固定（动词：固定到最前） | 置顶、钉住 | [design.md](design.md) |
| 固定组 | — | 固定组（列表开头那一段固定项） | 固定区、置顶区、钉住区 | [design.md](design.md) |
| 快照 | snapshot | 快照 | 状态、数据 | `GET /api/workspace-recency/pins` 的回答 |
| 基线模块 | platform baseline modules | 平台基线模块 | 内置模块、核心模块 | [development.md](development.md) |
| 经典脚本 | classic script | 经典脚本（经典脚本契约） | 普通脚本、非模块 | `window.__ModuleLoader__.load(...)` |
| 补丁行 | bundle patch | 补丁行（`cordis.patch.yml` 里本插件那一行） | 配置、注册项 | [formats.md](formats.md) |
| profile | profile | profile（首次出现写「一份 DSH 的 profile」） | 配置、环境 | 安装说明在 [README](../README.md) |

规则：同一件事在代码、文档、提交信息里用同一个词；上面「别写成」那一列出现过一次的，就当它从没
存在过。
