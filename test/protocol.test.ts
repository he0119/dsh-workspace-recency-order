/**
 * 两端共用的契约：请求/响应体怎么解析，坏输入怎么拒绝。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PIN_ROUTE, pinListBody, readPinCommand, readPinList } from '../src/protocol.ts'

test('路由固定在 /api 下，并且是完整 pathname', () => {
  assert.equal(PIN_ROUTE, '/api/workspace-recency/pins')
})

test('读置顶列表：只认 { pinned: string[] }，非字符串元素丢掉', () => {
  assert.deepEqual(readPinList({ pinned: ['a', 1, null, 'b'] }), ['a', 'b'])
  assert.deepEqual(readPinList({ pinned: [] }), [])
  assert.equal(readPinList({}), undefined)
  assert.equal(readPinList({ pinned: 'a' }), undefined)
  assert.equal(readPinList(null), undefined)
  assert.equal(readPinList('pinned'), undefined)
})

test('读切换命令：workspaceId 非空字符串，pinned 是布尔', () => {
  assert.deepEqual(readPinCommand({ workspaceId: 'a', pinned: true }), { workspaceId: 'a', pinned: true })
  assert.deepEqual(readPinCommand({ workspaceId: 'a', pinned: false }), { workspaceId: 'a', pinned: false })
  assert.equal(readPinCommand({ workspaceId: '', pinned: true }), undefined)
  assert.equal(readPinCommand({ workspaceId: 'a' }), undefined)
  assert.equal(readPinCommand({ workspaceId: 'a', pinned: 'true' }), undefined)
  assert.equal(readPinCommand(null), undefined)
  assert.equal(readPinCommand([]), undefined)
})

test('响应体带一份新数组，调用方改它不会回头改到源数据', () => {
  const source = ['a', 'b']
  const body = pinListBody(source)
  assert.deepEqual(body, { pinned: ['a', 'b'] })
  source.push('c')
  assert.deepEqual(body.pinned, ['a', 'b'])
})
