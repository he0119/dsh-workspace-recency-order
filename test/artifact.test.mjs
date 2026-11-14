// test/artifact.test.mjs — 构建产物冒烟。
//
// 其余测试都直接 import `src/*.ts`，所以「源码通过」并不等于「产物能装进宿主」。本文件补上这一环：
//   1) `lib/index.js` 真的导出 apply / inject，并且 apply 在一个假上下文里能跑起来、注册出监听；
//   2) `lib/client.js` 仍是 DSH 客户端模块系统认的经典脚本（`window.__ModuleLoader__.load`），
//      模块 id 等于包名，并且只 require 平台基线模块。
//
// 为什么用 .mjs 而不是 .ts：客户端产物要在**浏览器语义**下执行（`window` 是全局），而 Host 侧的
// 类型工程没有 DOM；让 tsc 去解析产物路径也只会把构建结果当成源码来挑刺。
//
// 产物不存在时整组跳过：源码开发不必先构建。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test, { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const HOST_ENTRY = join(ROOT, 'lib', 'index.js')
// 产物执行会读/写 $DSH_HOME 下的固定列表；给它一个临时 home，别碰开发机上真的那份。
const TEST_HOME = mkdtempSync(join(tmpdir(), 'dsh-artifact-home-'))
process.env.DSH_HOME = TEST_HOME
const CLIENT_ENTRY = join(ROOT, 'lib', 'client.js')
const MISSING = existsSync(HOST_ENTRY) && existsSync(CLIENT_ENTRY)
  ? false
  : 'lib/index.js 或 lib/client.js 不存在，先跑 pnpm run build'

/** 包名：客户端产物的模块 id 与它一致，`require` 也按它分发。 */
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** 假上下文：Host 端 apply 只用到日志器、effect、on 与注册表。 */
function hostContext() {
  const listeners = new Map()
  const log = { info: () => {}, warn: () => {} }
  return {
    listeners,
    ctx: {
      logger: Object.assign(() => log, log),
      effect: callback => callback(),
      on: (name, listener) => { listeners.set(name, listener); return () => listeners.delete(name) },
      inject: () => {},
      workspaceRegistry: {
        archivedSessionIds: [],
        list: () => [{ id: 'a', sessionIds: ['sa'] }, { id: 'b', sessionIds: ['sb'] }],
        insertBefore: async () => ['a', 'b'],
      },
    },
  }
}

test('Host 产物导出 apply / inject，并在假上下文里跑得起来', { skip: MISSING }, async () => {
  const entry = await import(pathToFileURL(HOST_ENTRY).href)
  assert.equal(typeof entry.apply, 'function')
  assert.ok(Array.isArray(entry.inject) && entry.inject.includes('workspaceRegistry'))

  const host = hostContext()
  entry.apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  assert.ok(host.listeners.has('api-session/activity'), 'apply 没有注册活动监听')
})

after(() => { rmSync(TEST_HOME, { recursive: true, force: true }) })

test('客户端产物是经典脚本，模块 id 等于包名，只 require 基线模块', { skip: MISSING }, () => {
  const source = readFileSync(CLIENT_ENTRY, 'utf8')
  assert.ok(source.startsWith('window.__ModuleLoader__.load('), '不是经典脚本契约')

  const loaded = []
  const window = {
    __ModuleLoader__: {
      load: definition => { loaded.push(definition) },
    },
  }
  // 按宿主的做法执行：脚本自己去 window 上报名，工厂拿到一个同步 require。
  new Function('window', source)(window)
  assert.equal(loaded.length, 1, '脚本没有报名一次模块')
  const [definition] = loaded
  assert.equal(definition.id, MANIFEST.name)

  const require = createRequire(import.meta.url)
  const exotics = []
  const exports = definition.factory(specifier => {
    if (specifier !== 'react' && specifier !== 'react/jsx-runtime') exotics.push(specifier)
    return require(specifier)
  })
  assert.deepEqual(exotics, [], '客户端产物 require 了非基线模块')
  assert.equal(typeof exports.apply, 'function')
  assert.ok(Array.isArray(exports.inject) && exports.inject.includes('contextMenus'))
})
