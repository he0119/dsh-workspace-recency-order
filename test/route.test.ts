/**
 * 置顶列表路由：读、写、幂等、坏请求与卸载后的表现。
 *
 * 直接拿 `Request` 调处理函数——鉴权与 Host/Origin 检查是宿主的责任，不在这里测。状态接口是内存假
 * 实现，所以不用临时目录、也不碰真实存储。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PinStore } from '../src/pins.ts'
import { createPinRoute } from '../src/route.ts'
import { fakePinState } from './fake-pin-state.ts'

/** 一套路由 + 它的调用记录。 */
function harness() {
  const warnings: string[] = []
  const changed: number[] = []
  let closed = false
  const store = new PinStore({
    state: fakePinState(),
    knownIds: () => new Set(['a', 'b', 'c']),
    warn: message => warnings.push(message),
  })
  const route = createPinRoute({
    store,
    changed: async () => { changed.push(Date.now()) },
    closed: () => closed,
  })
  const call = async (method: 'GET' | 'POST', body?: string): Promise<{ status: number; body: any }> => {
    const response = await route(new Request('http://localhost/api/workspace-recency/pins', {
      method,
      ...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } }),
    }))
    return { status: response.status, body: await response.json() }
  }
  return { store, warnings, changed, call, close: () => { closed = true } }
}

test('GET 返回当前置顶列表', async () => {
  const h = harness()
  assert.deepEqual(await h.call('GET'), { status: 200, body: { pinned: [] } })
})

test('POST 切换置顶：返回新列表并触发一次重排', async () => {
  const h = harness()
  assert.deepEqual(await h.call('POST', JSON.stringify({ workspaceId: 'b', pinned: true })), {
    status: 200,
    body: { pinned: ['b'] },
  })
  assert.equal(h.changed.length, 1)
  assert.deepEqual((await h.call('GET')).body, { pinned: ['b'] })

  assert.deepEqual(await h.call('POST', JSON.stringify({ workspaceId: 'b', pinned: false })), {
    status: 200,
    body: { pinned: [] },
  })
  assert.equal(h.changed.length, 2)
})

test('重复发送同一条命令不触发重排，也不改列表', async () => {
  const h = harness()
  await h.call('POST', JSON.stringify({ workspaceId: 'b', pinned: true }))
  assert.deepEqual(await h.call('POST', JSON.stringify({ workspaceId: 'b', pinned: true })), {
    status: 200,
    body: { pinned: ['b'] },
  })
  assert.equal(h.changed.length, 1)

  // 宿主里没有的 id 也一样：列表没变就不重排。
  assert.deepEqual(await h.call('POST', JSON.stringify({ workspaceId: 'ghost', pinned: true })), {
    status: 200,
    body: { pinned: ['b'] },
  })
  assert.equal(h.changed.length, 1)
})

test('请求体不是 JSON 或形状不对：400，且不改列表', async () => {
  const h = harness()
  assert.equal((await h.call('POST', '{not json')).status, 400)
  assert.equal((await h.call('POST', JSON.stringify({ pinned: true }))).status, 400)
  assert.equal((await h.call('POST', JSON.stringify({ workspaceId: 'b', pinned: 'yes' }))).status, 400)
  assert.deepEqual((await h.call('GET')).body, { pinned: [] })
  assert.equal(h.changed.length, 0)
})

test('插件卸载后拒绝写入，但读取照常', async () => {
  const h = harness()
  h.close()
  assert.equal((await h.call('POST', JSON.stringify({ workspaceId: 'b', pinned: true }))).status, 503)
  assert.deepEqual((await h.call('GET')).body, { pinned: [] })
})

test('不认识的 HTTP 方法：405', async () => {
  const h = harness()
  const response = await createPinRoute({
    store: h.store,
    changed: async () => {},
    closed: () => false,
  })(new Request('http://localhost/api/workspace-recency/pins', { method: 'DELETE' }))
  assert.equal(response.status, 405)
})
