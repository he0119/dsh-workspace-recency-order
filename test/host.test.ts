/**
 * Host 端接线：活动事件怎么触发重排、置顶列表路由注册成什么样、两者怎么共用一份顺序。
 *
 * 假上下文只提供本插件真正用到的成员：注册表改内存数组、连接服务记下注册的路由。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { apply } from '../src/index.ts'
import type { ConnectionService, HostContext, Logger, SessionController } from '../src/types.ts'

/** 等一次定时器回调落地（`debounceMs: 0` 时一次 tick 就够）。 */
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 25))

/** 这个测试文件独占的 DSH_HOME 根目录；每个用例再分一个子目录。 */
const HOME_ROOT = mkdtempSync(join(tmpdir(), 'dsh-host-'))
let homeSeq = 0
const freshHome = (): string => {
  const dir = join(HOME_ROOT, String(++homeSeq))
  mkdirSync(dir, { recursive: true })
  process.env.DSH_HOME = dir
  return dir
}
after(() => { rmSync(HOME_ROOT, { recursive: true, force: true }) })

/** 注册表里的一个工作区；测试要就地改这个数组。 */
interface FakeWorkspace {
  id: string
  sessionIds: string[]
}

/** 一次 `insertBefore` 调用的记录。 */
type Move = readonly [string, string | undefined]

/** 本插件注册出去的一条路由。 */
interface FakeRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly fetch: (request: Request) => Promise<Response>
}

/** 假上下文的可读面。 */
interface HostHarness {
  readonly ctx: HostContext
  readonly moves: Move[]
  readonly listeners: Map<string, (...args: any[]) => void>
  readonly warnings: string[]
  readonly infos: string[]
  readonly workspaces: FakeWorkspace[]
  readonly routes: Map<string, FakeRoute>
  readonly home: string
}

/**
 * 搭一个插件上下文。
 * @param options - `workspaces` 可变数组；可选 `sessions` 会话控制器、`archived` 归档集合、
 *   `withConnection` 是否提供连接服务、`home` 复用已有的 DSH_HOME。
 */
function harness({ workspaces, sessions, archived = [], withConnection = true, home: reuseHome }: {
  readonly workspaces: FakeWorkspace[]
  readonly sessions?: SessionController
  readonly archived?: readonly string[]
  readonly withConnection?: boolean
  readonly home?: string
}): HostHarness {
  const moves: Move[] = []
  const listeners = new Map<string, (...args: any[]) => void>()
  const warnings: string[] = []
  const infos: string[] = []
  const routes = new Map<string, FakeRoute>()
  const home = reuseHome ?? freshHome()
  process.env.DSH_HOME = home
  const log: Logger = { info: message => infos.push(message), warn: message => warnings.push(message) }
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

  const connection: ConnectionService = {
    fetch: {
      register: (route) => {
        routes.set(route.path, { path: route.path, methods: [...route.methods], fetch: request => route.fetch(request) })
        return () => { routes.delete(route.path) }
      },
    },
  }

  const ctx: HostContext = {
    logger,
    effect: callback => callback(),
    on: (name, listener) => { listeners.set(name, listener); return () => listeners.delete(name) },
    inject: (deps, callback) => {
      const extra: Record<string, unknown> = {}
      if (sessions !== undefined && deps.includes('sessionController')) extra.sessionController = sessions
      if (withConnection && deps.includes('connection')) extra.connection = connection
      if (Object.keys(extra).length > 0) callback(Object.assign({}, ctx, extra))
    },
    workspaceRegistry: registry,
  }
  return { ctx, moves, listeners, warnings, infos, workspaces, routes, home }
}

/** 取一个已注册的监听器；没注册就是测试自己写错了。 */
function listener(harnessed: HostHarness, name: string): (...args: any[]) => void {
  const found = harnessed.listeners.get(name)
  assert.ok(found, `没有注册 ${name} 监听`)
  return found
}

/** 调一次置顶列表路由。 */
async function callRoute(
  harnessed: HostHarness,
  method: 'GET' | 'POST',
  command?: { workspaceId: string; pinned: boolean },
): Promise<{ status: number; value: { pinned?: string[]; error?: string } }> {
  const route = harnessed.routes.get('/api/workspace-recency/pins')
  assert.ok(route, '置顶列表的路由没有注册')
  const response = await route.fetch(new Request('http://localhost/api/workspace-recency/pins', {
    method,
    ...(command === undefined ? {} : { body: JSON.stringify(command), headers: { 'content-type': 'application/json' } }),
  }))
  return { status: response.status, value: await response.json() as { pinned?: string[]; error?: string } }
}

const ids = (harnessed: HostHarness): string[] => harnessed.workspaces.map(workspace => workspace.id)

test('某个工作区里发消息，它移到最前', async () => {
  const host = harness({
    workspaces: [
      { id: 'a', sessionIds: ['sa'] },
      { id: 'b', sessionIds: ['sb'] },
      { id: 'c', sessionIds: ['sc'] },
    ],
  })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  listener(host, 'api-session/activity')('sc', 1000)
  await tick()
  assert.deepEqual(ids(host), ['c', 'a', 'b'])
  listener(host, 'api-session/activity')('sa', 2000)
  await tick()
  assert.deepEqual(ids(host), ['a', 'c', 'b'])
})

test('过时的时间戳与未分组会话不会触发重排', async () => {
  const host = harness({
    workspaces: [
      { id: 'a', sessionIds: ['sa'] },
      { id: 'b', sessionIds: ['sb'] },
    ],
  })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  listener(host, 'api-session/activity')('sb', 5000)
  await tick()
  assert.deepEqual(ids(host), ['b', 'a'])
  const before = host.moves.length
  listener(host, 'api-session/activity')('sb', 4000)
  listener(host, 'api-session/activity')('loose', 9999)
  await tick()
  assert.equal(host.moves.length, before)
})

test('归档会话与子智能体会话不抬升工作区', async () => {
  const host = harness({
    workspaces: [
      { id: 'a', sessionIds: ['sa'] },
      { id: 'b', sessionIds: ['sb'] },
    ],
    archived: ['sb'],
  })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  listener(host, 'api-session/activity')('sb', 9000)
  await tick()
  assert.deepEqual(ids(host), ['a', 'b'])
  listener(host, 'api-session/added')({ sessionId: 'sa', blank: true, updatedAt: 9000, origin: 'subagent' })
  await tick()
  assert.deepEqual(ids(host), ['a', 'b'])
})

test('新建的空会话也会抬升它的工作区', async () => {
  const host = harness({
    workspaces: [
      { id: 'a', sessionIds: ['sa'] },
      { id: 'b', sessionIds: ['sb'] },
    ],
  })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  listener(host, 'api-session/added')({ sessionId: 'sb', blank: true, updatedAt: 9500 })
  await tick()
  assert.deepEqual(ids(host), ['b', 'a'])
})

test('启动种子按已有会话记录排序', async () => {
  const host = harness({
    workspaces: [
      { id: 'a', sessionIds: ['sa1'] },
      { id: 'b', sessionIds: ['sb'] },
      { id: 'c', sessionIds: ['sc'] },
    ],
    sessions: {
      list: async () => ({
        items: [
          { sessionId: 'sa1', updatedAt: 100, blank: false },
          { sessionId: 'sb', updatedAt: 500, blank: false },
          { sessionId: 'sc', updatedAt: 300, blank: false },
          { sessionId: 'sdraft', updatedAt: 900, blank: true },
          { sessionId: 'schild', updatedAt: 999, blank: false, origin: 'subagent' },
        ],
      }),
    },
  })
  apply(host.ctx, { debounceMs: 0 })
  await tick()
  await tick()
  assert.deepEqual(ids(host), ['b', 'c', 'a'])
})

test('关掉插件后不注册任何监听；未知配置键会告警', () => {
  const off = harness({ workspaces: [{ id: 'a', sessionIds: ['sa'] }] })
  apply(off.ctx, { enabled: false })
  assert.equal(off.listeners.size, 0)
  assert.equal(off.routes.size, 0)

  const on = harness({ workspaces: [{ id: 'a', sessionIds: ['sa'] }] })
  apply(on.ctx, { sortOnStart: false, debounceMs: 0, debouceMs: 100 })
  assert.ok(on.warnings.some(message => message.includes('debouceMs')))
})

test('置顶列表路由注册在 /api 下，只收 GET 与 POST', async () => {
  const host = harness({ workspaces: [{ id: 'a', sessionIds: ['sa'] }] })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  const route = host.routes.get('/api/workspace-recency/pins')
  assert.ok(route)
  assert.deepEqual([...route.methods].sort(), ['GET', 'POST'])
  assert.deepEqual((await callRoute(host, 'GET')).value, { pinned: [] })
})

test('置顶一个新工作区只写一次顺序；之后活动只把别的工作区放到它下面', async () => {
  const host = harness({
    workspaces: [
      { id: 'a', sessionIds: ['sa'] },
      { id: 'b', sessionIds: ['sb'] },
      { id: 'c', sessionIds: ['sc'] },
    ],
  })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  await tick()

  const written = await callRoute(host, 'POST', { workspaceId: 'b', pinned: true })
  assert.deepEqual(written.value.pinned, ['b'])
  assert.deepEqual(ids(host), ['b', 'a', 'c'])
  assert.equal(host.moves.length, 1, '置顶一个新工作区只该写一次顺序')

  // 在 c 里发消息：c 排到置顶项下面，置顶项不动。
  const beforeActivity = host.moves.length
  listener(host, 'api-session/activity')('sc', 1000)
  await tick()
  assert.deepEqual(ids(host), ['b', 'c', 'a'])
  assert.ok(host.moves.slice(beforeActivity).every(([id]) => id !== 'b'), '置顶项不该被活动挤动')
})

test('置顶第二个工作区时，已经置顶的那个不动', async () => {
  const host = harness({
    workspaces: [
      { id: 'a', sessionIds: ['sa'] },
      { id: 'b', sessionIds: ['sb'] },
      { id: 'c', sessionIds: ['sc'] },
      { id: 'd', sessionIds: ['sd'] },
    ],
  })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  await tick()
  await callRoute(host, 'POST', { workspaceId: 'a', pinned: true })
  const before = host.moves.length
  await callRoute(host, 'POST', { workspaceId: 'd', pinned: true })
  assert.deepEqual(ids(host), ['a', 'd', 'b', 'c'])
  assert.deepEqual(host.moves.slice(before), [['d', 'b']])
})

test('置顶列表里宿主没有的 id 会被丢掉', async () => {
  const host = harness({
    workspaces: [
      { id: 'a', sessionIds: ['sa'] },
      { id: 'b', sessionIds: ['sb'] },
    ],
  })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  await tick()
  const written = await callRoute(host, 'POST', { workspaceId: 'ghost', pinned: true })
  assert.deepEqual(written.value.pinned, [])
  assert.deepEqual(ids(host), ['a', 'b'])
})

test('取消置顶后回到活跃度顺序里该在的位置', async () => {
  const host = harness({
    workspaces: [
      { id: 'a', sessionIds: ['sa'] },
      { id: 'b', sessionIds: ['sb'] },
      { id: 'c', sessionIds: ['sc'] },
    ],
  })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  await tick()
  listener(host, 'api-session/activity')('sa', 1000)
  await tick()
  await callRoute(host, 'POST', { workspaceId: 'c', pinned: true })
  assert.deepEqual(ids(host), ['c', 'a', 'b'])

  const released = await callRoute(host, 'POST', { workspaceId: 'c', pinned: false })
  assert.deepEqual(released.value.pinned, [])
  assert.deepEqual(ids(host), ['a', 'c', 'b'])
})

test('置顶列表落盘，重启后从文件读回来并排到开头', async () => {
  const workspaces = [
    { id: 'a', sessionIds: ['sa'] },
    { id: 'b', sessionIds: ['sb'] },
    { id: 'c', sessionIds: ['sc'] },
  ]
  const first = harness({ workspaces })
  apply(first.ctx, { debounceMs: 0, sortOnStart: false })
  await tick()
  await callRoute(first, 'POST', { workspaceId: 'c', pinned: true })
  const file = join(first.home, 'workspace-recency-order', 'pins.json')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, workspaceIds: ['c'] })

  // 再起一次（同一个 home，注册表顺序是上一次改出来的 c a b）。
  workspaces.splice(0, 3, { id: 'b', sessionIds: ['sb'] }, { id: 'a', sessionIds: ['sa'] }, { id: 'c', sessionIds: ['sc'] })
  const second = harness({ workspaces, home: first.home })
  apply(second.ctx, { debounceMs: 0, sortOnStart: false })
  await tick()
  assert.deepEqual(ids(second), ['c', 'b', 'a'])
  assert.deepEqual((await callRoute(second, 'GET')).value.pinned, ['c'])
})

test('没有连接服务时仍然排序，只是注册不了置顶列表的路由', async () => {
  const host = harness({ workspaces: [{ id: 'a', sessionIds: ['sa'] }, { id: 'b', sessionIds: ['sb'] }], withConnection: false })
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  listener(host, 'api-session/activity')('sb', 1000)
  await tick()
  assert.deepEqual(ids(host), ['b', 'a'])
  assert.equal(host.routes.size, 0)
})

test('注册表还没有工作区时，置顶文件不被当成「都失效了」清空', async () => {
  const host = harness({ workspaces: [] })
  const dir = join(host.home, 'workspace-recency-order')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'pins.json'), JSON.stringify({ version: 1, workspaceIds: ['later'] }))
  apply(host.ctx, { debounceMs: 0, sortOnStart: false })
  await tick()
  assert.deepEqual((await callRoute(host, 'GET')).value.pinned, ['later'])
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'pins.json'), 'utf8')).workspaceIds, ['later'])
})
