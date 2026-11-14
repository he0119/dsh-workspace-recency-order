/**
 * Web Client 端行为测试：菜单项的固定/取消固定、顺序纠正、存储与让位。
 *
 * 直接跑源码（Node 24 的类型剥离）；浏览器全局只补 localStorage，UI 只断言注册面。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, inject } from '../src/client/index.ts'

/** 页面里会被用到的存储。 */
const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)) },
    removeItem: key => { storage.delete(key) },
  },
}

const STORAGE_KEY = 'dsh.workspace-recency.pinned-workspaces.v1'
const tick = () => new Promise(resolve => setTimeout(resolve, 20))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 搭一个 Client 上下文：工作区顺序改内存数组，快照变化通知订阅者。
 * @param options - `order` 有序工作区 id、可选 `phase`/`state` 覆盖快照状态。
 */
function harness({ order, phase = 'ready', state = 'idle' }) {
  storage.clear()
  const listeners = new Set()
  const notices = []
  const menu = { current: undefined }
  const icons = []
  let reject = false
  const publish = () => { for (const listener of listeners) listener() }
  const ctx = {
    effect: fn => fn(),
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
    workspaces: {
      list: {
        getSnapshot: () => ({ items: order.map(id => ({ workspaceId: id })), phase, state }),
        subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
      },
      insertBefore: async (id, before) => {
        if (reject) throw new Error('refused')
        const from = order.indexOf(id)
        const [entry] = order.splice(from, 1)
        order.splice(before === undefined ? order.length : order.indexOf(before), 0, entry)
        publish()
      },
    },
  }
  return {
    ctx, menu, notices, icons, publish, order,
    setReject: value => { reject = value },
  }
}

const pin = (h, workspaceId) => h.menu.current.resolve({ workspaceId }).at(0)
const readStored = () => JSON.parse(storage.get(STORAGE_KEY) ?? '[]')

test('注册面：服务与包名对得上', () => {
  assert.deepEqual([...inject].sort(), ['contextMenus', 'locale', 'slots', 'workspaces'])
})

test('固定把工作区放到最前，取消固定后放回活跃度顺序', async () => {
  const h = harness({ order: ['a', 'b', 'c'] })
  apply(h.ctx)
  const action = pin(h, 'b')
  assert.equal(action.label, 'pin')
  action.run()
  await tick()
  assert.deepEqual(h.order, ['b', 'a', 'c'])
  assert.equal(h.notices.at(-1).success, true)

  // 宿主按活跃度重排：固定项被挤下去后立刻被拉回。
  h.order.splice(0, 3, 'c', 'a', 'b')
  h.publish()
  await tick()
  assert.deepEqual(h.order, ['b', 'c', 'a'])

  const release = pin(h, 'b')
  assert.equal(release.label, 'unpin')
  release.run()
  await tick()
  h.order.splice(0, 3, 'c', 'a', 'b')
  h.publish()
  await tick()
  assert.deepEqual(h.order, ['c', 'a', 'b'])
})

test('多个固定项按固定顺序排成前缀，最近固定的在前', async () => {
  const h = harness({ order: ['a', 'b', 'c'] })
  apply(h.ctx)
  pin(h, 'a').run()
  await tick()
  pin(h, 'c').run()
  await tick()
  assert.deepEqual(h.order, ['c', 'a', 'b'])
})

test('已删除工作区的固定项会被清理（只在快照完整时）', async () => {
  const pending = harness({ order: ['a', 'b'], phase: 'pending', state: 'loading' })
  apply(pending.ctx)
  storage.set(STORAGE_KEY, JSON.stringify(['gone', 'a']))
  pending.publish()
  await tick()
  assert.deepEqual(readStored(), ['gone', 'a'])

  const ready = harness({ order: ['a', 'b'] })
  apply(ready.ctx)
  storage.set(STORAGE_KEY, JSON.stringify(['gone', 'a']))
  ready.publish()
  await tick()
  assert.deepEqual(readStored(), ['a'])
})

test('写入被拒时回滚固定状态，只报一次失败', async () => {
  const h = harness({ order: ['a', 'b'] })
  apply(h.ctx)
  h.setReject(true)
  await pin(h, 'b').run()
  assert.deepEqual(readStored(), [])
  assert.deepEqual(h.notices.map(notice => notice.text), ['failed'])

  h.setReject(false)
  await pin(h, 'b').run()
  assert.deepEqual(readStored(), ['b'])
  assert.deepEqual(h.order, ['b', 'a'])
})

test('别的页面反复顶掉固定时主动让位', async () => {
  const h = harness({ order: ['a', 'b', 'c'] })
  apply(h.ctx)
  await pin(h, 'a').run()
  assert.deepEqual(h.order, ['a', 'b', 'c'])
  for (let round = 0; round < 5; round += 1) {
    h.order.splice(h.order.indexOf('b'), 1)
    h.order.unshift('b')
    h.publish()
    await pause(700)
  }
  assert.ok(h.notices.some(notice => notice.text === 'yielding'))
  const settled = [...h.order]
  h.publish()
  await tick()
  assert.deepEqual(h.order, settled)
})
