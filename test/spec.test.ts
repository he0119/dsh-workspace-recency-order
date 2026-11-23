/**
 * 领域声明：宿主的两条命名规则、`single` 布局与 `pinnedAt` 记录 schema。
 *
 * 这一份会真的 import `@deepseek-ai/dsh-storage-domain` 与 `zod`（声明只能这么建），所以它同时是
 * 「产物里的这两个 import 在 Node 下解析得到」的第一道信号；其余用例都绕开这两个包。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PIN_DOMAIN_NAME, PIN_DOMAIN_VERSION, PIN_TABLE_NAME, pinDomainSpec, pinRecord } from '../src/spec.ts'

test('领域名与表名符合宿主的 UNIT_NAME_RE，版本 1、single 布局', () => {
  assert.equal(PIN_DOMAIN_NAME, 'workspace_recency_order')
  assert.equal(PIN_TABLE_NAME, 'pins')
  assert.equal(PIN_DOMAIN_VERSION, 1)
  // 宿主 `@deepseek-ai/dsh-storage` 的 UNIT_NAME_RE；不合规时 defineDomain 自己就会抛。
  for (const name of [pinDomainSpec.name, ...Object.keys(pinDomainSpec.tables)]) {
    assert.match(name, /^[a-z][a-z0-9_]*$/)
  }
  assert.equal(pinDomainSpec.version, 1)
  assert.equal(pinDomainSpec.layout, 'single')
  assert.deepEqual(Object.keys(pinDomainSpec.tables), ['pins'])
})

test('pins 表的记录 schema 只收带非负整数 pinnedAt 的对象', () => {
  assert.deepEqual(pinRecord.parse({ pinnedAt: 0 }), { pinnedAt: 0 })
  assert.deepEqual(pinDomainSpec.tables.pins.valueSchema.parse({ pinnedAt: 1234 }), { pinnedAt: 1234 })
  for (const bad of [{}, { pinnedAt: -1 }, { pinnedAt: 1.5 }, { pinnedAt: '1' }, null, []]) {
    assert.equal(pinRecord.safeParse(bad).success, false, `不该接受 ${JSON.stringify(bad)}`)
  }
})
