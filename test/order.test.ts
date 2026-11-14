/**
 * 纯排序规则：目标顺序怎么算、下一步该移动谁。
 *
 * 不碰任何服务，也不碰文件——宿主与路由的行为在 `test/host.test.ts` 与 `test/route.test.ts` 里。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextMove, orderByActivity } from '../src/order.ts'

test('新的在前，相同排名保持传入顺序', () => {
  const workspaces = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const ranks: Record<string, number> = { a: 10, b: 30, c: 30 }
  assert.deepEqual(orderByActivity(workspaces, workspace => ranks[workspace.id]), ['b', 'c', 'a'])
  assert.deepEqual(orderByActivity(workspaces, () => 0), ['a', 'b', 'c'])
})

test('置顶项整体在开头，组内也按活跃度排', () => {
  const workspaces = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const ranks: Record<string, number> = { a: 10, b: 90, c: 50, d: 70 }
  const rank = (workspace: { id: string }): number => ranks[workspace.id]
  // 置顶 a、c：组内 c(50) 在 a(10) 前；剩下的按活跃度 b(90)、d(70)。
  assert.deepEqual(orderByActivity(workspaces, rank, ['a', 'c']), ['c', 'a', 'b', 'd'])
  assert.deepEqual(orderByActivity(workspaces, rank, ['d']), ['d', 'b', 'c', 'a'])
  // 不在注册表里的 id 不影响结果。
  assert.deepEqual(orderByActivity(workspaces, rank, ['ghost']), ['b', 'd', 'c', 'a'])
})

test('排名都是 0 时，置顶项之间保持传入顺序', () => {
  const workspaces = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(orderByActivity(workspaces, () => 0, ['b', 'a']), ['a', 'b', 'c'])
})

test('nextMove 指出第一处错位，已有序时是 null', () => {
  assert.deepEqual(nextMove(['c', 'a', 'b'], ['a', 'b', 'c']), ['a', 'c'])
  assert.equal(nextMove(['a', 'b', 'c'], ['a', 'b', 'c']), null)
  assert.equal(nextMove(['a', 'b'], ['z', 'a']), null)
})
