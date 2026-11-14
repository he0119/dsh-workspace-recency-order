/**
 * Host 端行为测试：排序规则、重排触发条件、启动种子。
 *
 * 直接跑源码（Node 24 的类型剥离），不依赖构建产物。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply } from '../src/index.ts'
import { nextMove, orderByActivity } from '../src/order.ts'

const tick = () => new Promise(resolve => setTimeout(resolve, 25))

/**
 * 搭一个插件上下文：注册表改的是内存里的工作区数组。
 * @param options - `workspaces` 可变数组、可选的 `sessions` 假会话控制器、`archived` 归档集合。
 */
function harness({ workspaces, sessions, archived = [] }) {
  const moves = []
  const listeners = new Map()
  const warnings = []
  // Cordis 的 `ctx.logger` 可调用：`ctx.logger('名字')` 返回带 info/warn 的日志器。
  const log = { info: () => {}, warn: message => warnings.push(message) }
  const logger = () => log
  const registry = {
    archivedSessionIds: archived,
    list: () => workspaces.map(workspace => ({ ...workspace, sessionIds: [...workspace.sessionIds] })),
    insertBefore: async (id, before) => {
      moves.push([id, before])
      const from = workspaces.findIndex(workspace => workspace.id === id)
      const [entry] = workspaces.splice(from, 1)
      const to = before === undefined ? workspaces.length : workspaces.findIndex(workspace => workspace.id === before)
      workspaces.splice(to, 0, entry)
      return workspaces.map(workspace => workspace.id)
    },
  }
  const ctx = {
    logger,
    effect: fn => fn(),
    on: (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name) },
    inject: (deps, callback) => {
      if (sessions !== undefined && deps.includes('sessionController')) callback({ ...ctx, sessionController: sessions })
    },
    workspaceRegistry: registry,
  }
  return { ctx, moves, listeners, warnings, workspaces }
}

test('orderByActivity：新的在前，相同排名保持传入顺序', () => {
  const workspaces = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const ranks = { a: 10, b: 30, c: 30 }
  assert.deepEqual(orderByActivity(workspaces, workspace => ranks[workspace.id]), ['b', 'c', 'a'])
  assert.deepEqual(orderByActivity(workspaces, () => 0), ['a', 'b', 'c'])
})

test('nextMove：指出第一处错位，已有序时返回 null', () => {
  assert.deepEqual(nextMove(['c', 'a', 'b'], ['a', 'b', 'c']), ['a', 'c'])
  assert.equal(nextMove(['a', 'b', 'c'], ['a', 'b', 'c']), null)
  assert.equal(nextMove(['a', 'b'], ['z', 'a']), null)
})

test('某个工作区里发消息，它移到最前', async () => {
  const workspaces = [
    { id: 'a', sessionIds: ['sa'] },
    { id: 'b', sessionIds: ['sb'] },
    { id: 'c', sessionIds: ['sc'] },
  ]
  const { ctx, listeners, workspaces: list } = harness({ workspaces })
  apply(ctx, { debounceMs: 0, sortOnStart: false })
  listeners.get('api-session/activity')('sc', 1000)
  await tick()
  assert.deepEqual(list.map(workspace => workspace.id), ['c', 'a', 'b'])
  listeners.get('api-session/activity')('sa', 2000)
  await tick()
  assert.deepEqual(list.map(workspace => workspace.id), ['a', 'c', 'b'])
})

test('过时的时间戳与未分组会话不会触发重排', async () => {
  const workspaces = [
    { id: 'a', sessionIds: ['sa'] },
    { id: 'b', sessionIds: ['sb'] },
  ]
  const { ctx, listeners, moves, workspaces: list } = harness({ workspaces })
  apply(ctx, { debounceMs: 0, sortOnStart: false })
  listeners.get('api-session/activity')('sb', 5000)
  await tick()
  assert.deepEqual(list.map(workspace => workspace.id), ['b', 'a'])
  const before = moves.length
  listeners.get('api-session/activity')('sb', 4000)
  listeners.get('api-session/activity')('loose', 9999)
  await tick()
  assert.equal(moves.length, before)
  assert.deepEqual(list.map(workspace => workspace.id), ['b', 'a'])
})

test('归档会话与子智能体会话不抬升工作区', async () => {
  const workspaces = [
    { id: 'a', sessionIds: ['sa'] },
    { id: 'b', sessionIds: ['sb'] },
  ]
  const { ctx, listeners, workspaces: list } = harness({ workspaces, archived: ['sb'] })
  apply(ctx, { debounceMs: 0, sortOnStart: false })
  listeners.get('api-session/activity')('sb', 9000)
  await tick()
  assert.deepEqual(list.map(workspace => workspace.id), ['a', 'b'])
  listeners.get('api-session/added')({ sessionId: 'sa', blank: true, updatedAt: 9000, origin: 'subagent' })
  await tick()
  assert.deepEqual(list.map(workspace => workspace.id), ['a', 'b'])
})

test('新建的空会话也会抬升它的工作区', async () => {
  const workspaces = [
    { id: 'a', sessionIds: ['sa'] },
    { id: 'b', sessionIds: ['sb'] },
  ]
  const { ctx, listeners, workspaces: list } = harness({ workspaces })
  apply(ctx, { debounceMs: 0, sortOnStart: false })
  listeners.get('api-session/added')({ sessionId: 'sb', blank: true, updatedAt: Date.now() })
  await tick()
  assert.deepEqual(list.map(workspace => workspace.id), ['b', 'a'])
})

test('启动种子按已有会话记录排序', async () => {
  const workspaces = [
    { id: 'a', sessionIds: ['sa1'] },
    { id: 'b', sessionIds: ['sb'] },
    { id: 'c', sessionIds: ['sc'] },
  ]
  const sessions = {
    list: async () => ({
      items: [
        { sessionId: 'sa1', updatedAt: 100, blank: false },
        { sessionId: 'sb', updatedAt: 500, blank: false },
        { sessionId: 'sc', updatedAt: 300, blank: false },
        { sessionId: 'sdraft', updatedAt: 900, blank: true },
        { sessionId: 'schild', updatedAt: 999, blank: false, origin: 'subagent' },
      ],
    }),
  }
  const { ctx, workspaces: list } = harness({ workspaces, sessions })
  apply(ctx, { debounceMs: 0 })
  await tick()
  await tick()
  assert.deepEqual(list.map(workspace => workspace.id), ['b', 'c', 'a'])
})

test('关闭后不注册任何监听，未知配置键会告警', () => {
  const workspaces = [{ id: 'a', sessionIds: ['sa'] }]
  const off = harness({ workspaces })
  apply(off.ctx, { enabled: false })
  assert.equal(off.listeners.size, 0)

  const on = harness({ workspaces })
  apply(on.ctx, { sortOnStart: false, debounceMs: 0, debouceMs: 100 })
  assert.ok(on.warnings.some(message => message.includes('debouceMs')))
})
