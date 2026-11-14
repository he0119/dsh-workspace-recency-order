// test/run-all.mjs — 进程内测试 runner。
//
// 为什么不用 `node --test`：`node --test` 会为**每个测试文件**起一个子进程（piped stdio），
// 而 DSH 的 Windows 沙箱禁止子进程用命名管道捕获输出，于是必然 `spawn EPERM`——与测试内容无关。
// 本 runner 在**同一进程**里依次 import 每个测试文件：`node:test` 被直接 import 时同样会注册并
// 执行用例，只是不再经过子进程隔离。
//
// 代价：同一进程里一个文件抛错会影响后面的文件，所以这里对每个文件单独 try/catch 汇总。
//
// 测试文件是 .ts，靠 node 自带的类型擦除运行；产物冒烟（test/artifact.test.mjs）是 .mjs，
// 因为它要 import 构建出来的 lib/index.js，用 .mjs 就不必让 tsc 去解析产物路径。
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here)
  .filter(file => file.endsWith('.test.ts') || file.endsWith('.test.mjs'))
  .sort()

let failed = 0
for (const file of files) {
  try {
    // Windows 的绝对路径必须转成 file:// URL 才能动态 import。
    await import(pathToFileURL(join(here, file)).href)
  } catch (error) {
    failed += 1
    console.error(`\n[runner] 载入 ${file} 失败:`, error?.stack ?? error)
  }
}

if (failed > 0) {
  console.error(`\n[runner] ${failed} 个测试文件载入失败`)
  process.exitCode = 1
}
