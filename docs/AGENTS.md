# AGENTS.md — 文档规范

本目录每份文档各有一个家；同一条信息只在一处展开，别处放链接或一句话指过去。

| 文档 | 写什么 | 不写什么 |
| --- | --- | --- |
| [internals.md](internals.md) | 决策地图（按主题索引到[决策笔记](../.agents/notes/AGENTS.md)）、没有笔记承载的机制 | 决策依据与被否决的备选方案（→ 笔记） |
| [design.md](design.md) | 界面与文案的完整规格：菜单项、图标、提示语、置顶组与失败的表现、验收 | 决策依据（→ 笔记）；逐文件职责（→ development.md） |
| [development.md](development.md) | 目录结构、逐文件职责、开发命令、怎么装进真实 profile、GitHub 上的检查 | 会与 `package.json` 脚本漂移的逐条清单 |
| [formats.md](formats.md) | 落盘与跨进程的格式：宿主工作区注册表、置顶列表的存储领域与迁移、它的 HTTP 路由、配置对象、语言键 | 决策依据（→ 笔记）；界面规格（→ design.md） |
| [flows.md](flows.md) | 从一次活动或一次点击到宿主写盘的流程：读写哪些状态、失败怎么办 | 字段形状（→ formats.md）；决策依据（→ 笔记） |
| [glossary.md](glossary.md) | 术语：官方怎么说的、本仓库怎么写、别写成什么 | 机制说明（→ internals.md） |
| [releasing.md](releasing.md) | 发布流程：包名与 scope、首版为什么必须手动发、Publish 的三道校验与失败后的重试 | 会与 `package.json` 脚本漂移的逐条清单；决策依据（→ 笔记） |
| 根 [AGENTS.md](../AGENTS.md) | 协作约定、硬约束、提交信息口径、验证清单 | 故事、完整例子、能从链到的家读到的内容 |

放一份新文档之前先问它属于哪一行；都不属于就先想清楚它是哪一类，再回来改这张表。

## 写作规则

- **只写当前状态。** 历史留在提交、PR 与决策笔记里；正文不写「原本是……后来改成……」，只点机制的
  名字。
- **手折行，每行 ≤ 100 字符**（中日韩字符按显示宽度算）：长链接、表格行、代码块与 YAML 头部随内容
  走，不为凑宽度硬断。
- **相对 Markdown 链接指向当下存在的文件**；历史引用用标签号或 PR 号。
- **数字只写实测值**：测试条数、产物字节数、在真实 dev GUI 里量出来的像素；机制写文件与函数名，
  不复述 diff。
- 中文单语，术语按 [glossary.md](glossary.md) 的说法。唯一的英文正文是
  [README.en.md](../README.en.md)，它与 `README.md` 的键与结构保持对齐。
- 语言按根 [AGENTS.md](../AGENTS.md)：写具体动作与结果，不用「收口」「打通」这类黑话。

## 门禁

文档本身没有门禁。决策笔记的格式由 `test/notes.test.ts` 核（在 `pnpm test` 里跑）；本文件这张表与
[.agents/notes/AGENTS.md](../.agents/notes/AGENTS.md) 的分工要保持一致。
