# Agent Note: 浏览器半侧的产物是经典脚本，只 require 基线模块

Status: implemented

## Problem

DSH 的客户端模块系统只认 `window.__ModuleLoader__.load({ id, factory })` 这种报名方式：工厂拿到一个
同步的 `require`，返回的 `module.exports` 就是插件的导出面（`inject` 与 `apply`）。

也就是说浏览器半侧**不是**一个 npm 包：没有 node_modules 解析，也没有给插件挂旁路依赖的路由。而界面
要画一个图标、要给菜单项配文案，这些代码得想办法进到这个沙箱里。

## Decision

`lib/client.js` 是一个经典脚本：cjs 外面套三行 banner / intro / footer（在 `tsdown.config.ts` 的
`client` 那份配置里），只有**平台基线模块**保持 `require`，其余全部内联。基线只有两条：

- `react`、`react/jsx-runtime`——模块表按 specifier 分发的基础运行时。

这份名单就是 `tsdown.config.ts` 的 `CLIENT_EXTERNALS`。本插件不 import 任何官方控件包：菜单项的
图标是就地画的一枚 SVG（`src/client/index.ts` 的 `tack()`），文案走宿主提供的 `locale` 服务，所以
除 React 之外没有第三方运行时依赖。

## Alternatives considered

**手写 DOM，不引 React。** 菜单项的 `icon` 位置要的是一个组件；用 `document.createElement` 拼出来，
既拿不到主题 token 的样式，也和官方菜单的渲染方式脱钩。

**把 React 内联进产物。** 那等于在页面里塞进第二份 React：hooks 的上下文、调度器都与宿主那份不同，
两套运行时同时装进一个页面，症状是「组件不更新」这种最难查的一类。

**引官方控件包（如 `dsh-client-ui-primitives`）。** 本插件只画一个图标、只出一行文字，没有按钮、
表单、对话框可以用到它；为两个字形把它写进基线之外的依赖，等于给宿主装包多一个必须对上的版本。

## Consequences

- 契约错了在源码层面看不出来：`test/artifact.test.mjs` 用假的 `window.__ModuleLoader__` 与假
  `require` 按这份契约执行**构建产物**，断言模块 id 等于包名、只 require 基线模块、导出 `apply` /
  `inject`。
- 代码里不许出现 Node API，也不许出现 `process`、`Buffer`——`tsconfig.client.json` 的
  `"types": []` 就是这条：客户端工程连 node 的类型都不加载（`src/client/types.ts` 里也刻意不 import
  任何 DSH 包）。
- 产物保持单文件：`lib/client.js` 约 24 kB（未压缩），随包发布，没有额外资源文件。
