/**
 * Host 端行为测试：排序规则、重排触发条件、启动种子。
 *
 * 直接跑源码（node 自带的类型擦除），不依赖构建产物；假上下文只提供本插件真正用到的成员，
 * 所以这里能覆盖「注册表被谁改成了什么顺序」，而不用起一个真的 DSH。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply } from '../src/index.ts'
import { nextMove, orderByActivity } from '../src/order.ts'
import type { HostContext, Logger, SessionController } from '../src/types.ts'

/** 等一次定时器回调落地（`debounceMs: 0` 时一次 tick 就够）。 */
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 25))

/** 注册表里的一个工作区；测试要就地改这个数组，所以不能是只读的。 */
interface FakeWorkspace {
  id: string
  sessionIds: string[]
}

/** 一次 `insertBefore` 调用的记录：把谁插到谁前面。 */
type Move = readonly [string, string | undefined]

/** 假上下文的可读面：测试直接看注册表顺序、收到的移动与监听器。 */
interface HostHarness {
  readonly ctx: HostContext
  readonly moves: Move[]
  readonly listeners: Map<string, (...args: any[]) => void>
  readonly warnings: string[]
  readonly workspaces: FakeWorkspace[]
}

/**
 * 搭一个插件上下文：注册表改的是内存里的工作区数组。
 * @param options - `workspaces` 可变数组、可选的 `sessions` 假会话控制器、`archived` 归档集合。
 */
function harness({ workspaces, sessions, archived = [] }: {
  readonly workspaces: FakeWorkspace[]
  readonly sessions?: SessionController
  readonly archived?: readonly string[]
}): HostHarness {
  const moves: Move[] = []
  const listeners = new Map<string, (...args: any[]) => void>()
  const warnings: string[] = []
  // Cordis 的 `ctx.logger` 可调用：`ctx.logger('名字')` 返回带 info/warn 的日志器。
  const log: Logger = { info: () => {}, warn: message => warnings.push(message) }
  const logger: HostContext['logger'] = Object.assign((): Logger => log, log)
  const registry: HostContext['workspaceRegistry'] = {
    archivedSessionIds: archived,
    list: () => workspaces.map(workspace => ({ ...workspace, sessionIds: [...workspace.sessionIds] })),
    insertBefore: async (id, before) => {
      moves.push([id, before])
      const from = workspaces.findIndex(workspace => workspace.id === id)
      const [entry] = workspaces.splice(from, 1)
      const to = before === undefined ? workspaces.length : workspaces.findIndex(workspace => workspace.id === before)
      workspaces.splice(to, 0, entry!)
      return workspaces.map(workspace => workspace.id)
    },
  }
  const ctx: HostContext = {
    logger,
    effect: callback => callback(),
    on: (name, listener) => { listeners.set(name, listener); return () => listeners.delete(name) },
    inject: (deps, callback) => {
      if (sessions !== undefined && deps.includes('sessionController')) callback({ ...ctx, sessionController: sessions })
    },
    workspaceRegistry: registry,
  }
  return { ctx, moves, listeners, warnings, workspaces }
}

/** 取一个已注册的监听器；没注册就是测试自己写错了。 */
function listener(harnessed: HostHarness, name: string): (...args: any[]) => void {
  const found = harnessed.listeners.get(name)
  assert.ok(found, `没有注册 ${name} 监听`)
  return found
}

test('orderByActivity：新的在前，相同排名保持传入顺序', () => {
  const workspaces = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const ranks: Record<string, number> = { a: 10, b: 30, c: 30 }
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
  const host = harness({ workspaces })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  listener(host, 'api-session/activity')('sc', 1000)
  await tick()
  assert.deepEqual(host.workspaces.map(workspace => workspace.id), ['c', 'a', 'b'])
  listener(host, 'api-session/activity')('sa', 2000)
  await tick()
  assert.deepEqual(host.workspaces.map(workspace => workspace.id), ['a', 'c', 'b'])
})

test('过时的时间戳与未分组会话不会触发重排', async () => {
  const workspaces = [
    { id: 'a', sessionIds: ['sa'] },
    { id: 'b', sessionIds: ['sb'] },
  ]
  const host = harness({ workspaces })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  listener(host, 'api-session/activity')('sb', 5000)
  await tick()
  assert.deepEqual(host.workspaces.map(workspace => workspace.id), ['b', 'a'])
  const before = host.moves.length
  listener(host, 'api-session/activity')('sb', 4000)
  listener(host, 'api-session/activity')('loose', 9999)
  await tick()
  assert.equal(host.moves.length, before)
  assert.deepEqual(host.workspaces.map(workspace => workspace.id), ['b', 'a'])
})

test('归档会话与子智能体会话不抬升工作区', async () => {
  const workspaces = [
    { id: 'a', sessionIds: ['sa'] },
    { id: 'b', sessionIds: ['sb'] },
  ]
  const host = harness({ workspaces, archived: ['sb'] })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  listener(host, 'api-session/activity')('sb', 9000)
  await tick()
  assert.deepEqual(host.workspaces.map(workspace => workspace.id), ['a', 'b'])
  listener(host, 'api-session/added')({ sessionId: 'sa', blank: true, updatedAt: 9000, origin: 'subagent' })
  await tick()
  assert.deepEqual(host.workspaces.map(workspace => workspace.id), ['a', 'b'])
})

test('新建的空会话也会抬升它的工作区', async () => {
  const workspaces = [
    { id: 'a', sessionIds: ['sa'] },
    { id: 'b', sessionIds: ['sb'] },
  ]
  const host = harness({ workspaces })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  listener(host, 'api-session/added')({ sessionId: 'sb', blank: true, updatedAt: Date.now() })
  await tick()
  assert.deepEqual(host.workspaces.map(workspace => workspace.id), ['b', 'a'])
})

test('启动种子按已有会话记录排序', async () => {
  const workspaces = [
    { id: 'a', sessionIds: ['sa1'] },
    { id: 'b', sessionIds: ['sb'] },
    { id: 'c', sessionIds: ['sc'] },
  ]
  const sessions: SessionController = {
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
  const host = harness({ workspaces, sessions })
  apply(host.ctx, { debounceMs: 0 })
  await tick()
  await tick()
  assert.deepEqual(host.workspaces.map(workspace => workspace.id), ['b', 'c', 'a'])
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
