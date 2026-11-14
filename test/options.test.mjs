/**
 * 配置解析测试：默认值、字符串布尔兼容与不可用取值的告警。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_OPTIONS, readOptions } from '../src/options.ts'

test('空配置得到默认值', () => {
  const warnings = []
  assert.deepEqual(readOptions(undefined, m => warnings.push(m)), DEFAULT_OPTIONS)
  assert.deepEqual(warnings, [])
})

test('字符串布尔按布尔处理，其余非法取值回落到默认并告警', () => {
  const warnings = []
  assert.equal(readOptions({ enabled: 'false' }, m => warnings.push(m)).enabled, false)
  assert.equal(readOptions({ sortOnStart: 'yes' }, m => warnings.push(m)).sortOnStart, true)
  assert.ok(warnings.some(message => message.includes('sortOnStart')))
})

test('debounceMs 只接受非负有限数', () => {
  assert.equal(readOptions({ debounceMs: 0 }, () => {}).debounceMs, 0)
  assert.equal(readOptions({ debounceMs: -1 }, () => {}).debounceMs, DEFAULT_OPTIONS.debounceMs)
  assert.equal(readOptions({ debounceMs: 'nope' }, () => {}).debounceMs, DEFAULT_OPTIONS.debounceMs)
})
