/**
 * Web Client 端行为测试：菜单项的置顶/取消置顶、置顶列表的读写与失败提示。
 *
 * 直接跑源码（Node 24 的类型剥离）；浏览器全局只补 `window`/`document`/`fetch`，UI 只断言注册面。
 * `fetch` 用假的：它按一条条切换命令维护「宿主那份列表」，并记下每次请求。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, inject } from '../src/client/index.ts'

/** 等一次微任务/定时器落地。 */
const tick = () => new Promise(resolve => setTimeout(resolve, 20))

/** 浏览器里会被用到的全局：事件监听、页面地址、可见状态。 */
const windowListeners = new Map()
const documentListeners = new Map()

globalThis.window = {
  addEventListener: (type, listener) => { windowListeners.set(type, listener) },
  removeEventListener: (type, listener) => {
    if (windowListeners.get(type) === listener) windowListeners.delete(type)
  },
}

globalThis.document = {
  baseURI: 'http://localhost/',
  visibilityState: 'visible',
  addEventListener: (type, listener) => { documentListeners.set(type, listener) },
  removeEventListener: (type, listener) => {
    if (documentListeners.get(type) === listener) documentListeners.delete(type)
  },
}

const fire = (table, type) => {
  const listener = table.get(type)
  if (listener !== undefined) listener()
}

/** 假的宿主：`pinned` 是它当前那份列表，`known` 是它认识的工作区，`writeFails` 让命令被拒。 */
const server = { pinned: [], known: [], writeFails: false, calls: [], gate: null }

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
})

globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET'
  server.calls.push({ url: String(url), method, body: init.body })
  if (method === 'GET') {
    const snapshot = [...server.pinned]
    if (server.gate !== null) await server.gate
    return json({ pinned: snapshot })
  }
  if (server.writeFails) return new Response('nope', { status: 500 })
  const command = JSON.parse(init.body)
  if (command.pinned) {
    if (server.known.includes(command.workspaceId) && !server.pinned.includes(command.workspaceId)) {
      server.pinned.push(command.workspaceId)
    }
  } else {
    server.pinned = server.pinned.filter(id => id !== command.workspaceId)
  }
  return json({ pinned: server.pinned })
}

/**
 * 搭一个 Client 上下文。
 * @param options - `pinned` 宿主初始的置顶列表；`deny` 让权限面拒绝移动。
 */
function harness({ pinned = [], deny = false } = {}) {
  server.pinned = [...pinned]
  server.known = ['a', 'b', 'c']
  server.gate = null
  server.writeFails = false
  server.calls = []
  windowListeners.clear()
  documentListeners.clear()
  const notices = []
  const menu = { current: undefined }
  const icons = []
  const ctx = {
    effect: callback => callback(),
    locale: { bind: () => key => key, register: () => () => {} },
    slots: {
      inject: (_key, callback) => {
        const effect = callback()
        return () => { for (const dispose of effect) dispose() }
      },
      register: (_options, Icon) => { icons.push(Icon); return () => {} },
    },
    contextMenus: {
      register: definition => { menu.current = definition; return () => { menu.current = undefined } },
      notify: (text, success) => { notices.push({ text, success }) },
    },
    get: name => name === 'remoteAccess'
      ? { source: () => ({ getSnapshot: () => !deny }) }
      : undefined,
  }
  return { ctx, menu, notices, icons }
}

const action = (h, workspaceId) => h.menu.current.resolve({ workspaceId }).at(0)
const commands = () => server.calls.filter(call => call.method === 'POST').map(call => JSON.parse(call.body))

test('注册面：服务对得上（页面不再直接改顺序，所以不需要 workspaces）', () => {
  assert.deepEqual([...inject].sort(), ['contextMenus', 'locale', 'slots'])
})

test('加载时读宿主那份列表，已置顶的工作区显示「取消置顶」', async () => {
  const h = harness({ pinned: ['a'] })
  apply(h.ctx)
  await tick()
  assert.equal(server.calls[0].method, 'GET')
  assert.equal(action(h, 'a').label, 'unpin')
  assert.equal(action(h, 'b').label, 'pin')
})

test('置顶：发一条目标状态命令，以后端的回答为准', async () => {
  const h = harness()
  apply(h.ctx)
  await tick()
  assert.equal(action(h, 'b').label, 'pin')

  await action(h, 'b').run()
  assert.deepEqual(commands(), [{ workspaceId: 'b', pinned: true }])
  assert.equal(action(h, 'b').label, 'unpin')
  assert.deepEqual(h.notices.at(-1), { text: 'pinnedToast', success: true })
})

test('取消置顶：命令带 pinned: false，列表里只剩别的工作区', async () => {
  const h = harness({ pinned: ['b', 'c'] })
  apply(h.ctx)
  await tick()

  await action(h, 'b').run()
  assert.deepEqual(commands(), [{ workspaceId: 'b', pinned: false }])
  assert.equal(action(h, 'b').label, 'pin')
  assert.equal(action(h, 'c').label, 'unpin')
  assert.deepEqual(h.notices.at(-1), { text: 'unpinnedToast', success: true })
})

test('宿主不认识的 id 不会变成置顶，页面以后端的回答为准', async () => {
  const h = harness()
  apply(h.ctx)
  await tick()
  await action(h, 'ghost').run()
  assert.deepEqual(commands(), [{ workspaceId: 'ghost', pinned: true }])
  assert.equal(action(h, 'ghost').label, 'pin')
})

test('宿主拒绝写入时提示一次失败，并重新读回宿主的列表', async () => {
  const h = harness({ pinned: ['c'] })
  apply(h.ctx)
  await tick()
  server.writeFails = true
  const before = server.calls.length

  await action(h, 'b').run()
  await action(h, 'b').run()
  assert.deepEqual(h.notices.map(notice => notice.text), ['failed'])
  assert.equal(action(h, 'b').label, 'pin')
  // 失败后会补一次读取（状态以宿主为准）。
  assert.ok(server.calls.slice(before).some(call => call.method === 'GET'))
})

test('权限面明确拒绝移动时，这一项根本不出现', async () => {
  const h = harness({ deny: true })
  apply(h.ctx)
  await tick()
  assert.deepEqual(h.menu.current.resolve({ workspaceId: 'a' }), [])
})

test('切回这个页面、或网络恢复时重新读一次', async () => {
  const h = harness({ pinned: ['a'] })
  apply(h.ctx)
  await tick()
  assert.equal(action(h, 'a').label, 'unpin')

  server.pinned = []
  fire(windowListeners, 'focus')
  await tick()
  assert.equal(action(h, 'a').label, 'pin')

  server.pinned = ['a']
  fire(documentListeners, 'visibilitychange')
  await tick()
  assert.equal(action(h, 'a').label, 'unpin')

  server.pinned = []
  fire(windowListeners, 'online')
  await tick()
  assert.equal(action(h, 'a').label, 'pin')
})

test('并发触发多次刷新只发一个读请求', async () => {
  const h = harness({ pinned: ['a'] })
  apply(h.ctx)
  await tick()
  const before = server.calls.filter(call => call.method === 'GET').length
  fire(windowListeners, 'focus')
  fire(windowListeners, 'online')
  fire(documentListeners, 'visibilitychange')
  await tick()
  assert.equal(server.calls.filter(call => call.method === 'GET').length, before + 1)
})

test('读取回来晚于一次成功的切换时，不拿旧列表盖掉新状态', async () => {
  const h = harness({ pinned: ['a'] })
  apply(h.ctx)
  await tick()

  let release
  server.gate = new Promise(resolve => { release = resolve })
  fire(windowListeners, 'focus')
  await Promise.resolve()

  await action(h, 'b').run()
  assert.equal(action(h, 'b').label, 'unpin')

  release()
  server.gate = null
  await tick()
  assert.equal(action(h, 'b').label, 'unpin')
  assert.equal(action(h, 'a').label, 'unpin')
})
