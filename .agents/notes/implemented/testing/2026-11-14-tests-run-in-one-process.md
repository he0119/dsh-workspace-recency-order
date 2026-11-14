# Agent Note: 测试在同一个进程里跑，不靠 node --test 的进程隔离

Status: implemented

## Problem

`node --test test/*.test.ts` 会为**每个**测试文件起一个子进程，用管道读它的输出。在 DSH 的
Windows 沙箱里，子进程不能通过命名管道捕获输出，于是这条命令必然失败在 `spawn EPERM`——与测试写了
什么无关，整套测试一条都跑不起来。

## Decision

`test/run-all.mjs` 是一个进程内 runner：把 `test/` 下每个 `*.test.ts` / `*.test.mjs` 依次
`import()` 一遍，`node:test` 被直接 import 时同样会注册并执行用例，只是不经过子进程隔离。每个文件
单独 `try/catch`，一个文件载入失败不会让后面的文件消失，最后由 `process.exitCode` 汇总。

测试文件本身是 `.ts`，靠 node 自带的类型擦除运行，同一个文件也进 `tsconfig.test.json` 的类型检查。
碰浏览器全局的两份保持 `.mjs`：

- `test/client.test.mjs`：它要 `globalThis.window` 与 `localStorage`，而 Host 侧的类型工程没有 DOM。
- `test/artifact.test.mjs`：它要加载构建产物 `lib/client.js`，在浏览器语义下执行。

`pnpm test:runner` 仍然保留 `node --test` 的原生入口，供能起子进程的环境用。

## Alternatives considered

**只在 Linux/macOS 上跑测试，Windows 上就不验证。** 开发机就是这台 Windows，等于把「改完不验证」
写成常态。

**换 vitest / jest。** 它们同样按文件开 worker（jest）或依赖 worker 线程与子进程（vitest）；为了绕开
沙箱限制引一整套测试框架，代价比 40 行的 runner 大得多。

**把测试都写成 `.mjs`，靠 JSDoc 类型。** 那就失去「测试也进类型检查」这一半——测试里传错参数、写错
字段名不会被 tsc 拦住。

## Consequences

- 测试文件之间不隔离：某个文件在模块顶层抛错会影响同进程的其余文件的执行环境（runner 只保证继续
  往下跑）。因此模块顶层只做「读文件、拼假对象」这类不会失败的事。
- 全套 19 个用例在同一进程里约 4 秒跑完；其中「别的页面反复顶掉固定时主动让位」占 3.5 秒，它按真实
  时间推 5 轮让位窗口。
- `.mjs` 的两份不进类型检查，这是有意的：它们借浏览器/产物的真实语义，硬塞进 tsconfig 只会逼出一堆
  `as unknown as` 断言。
