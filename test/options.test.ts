/**
 * 配置解析测试：默认值、字符串布尔兼容与不可用取值的告警。
 *
 * 配置来自 bundle 补丁里的 YAML，取值可能是写错的字符串或数字，所以这里逐条摆开「收下什么、
 * 回落到什么、留哪条告警」。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_OPTIONS, readOptions } from '../src/options.ts'

test('空配置得到默认值', () => {
  const warnings: string[] = []
  assert.deepEqual(readOptions(undefined, message => warnings.push(message)), DEFAULT_OPTIONS)
  assert.deepEqual(warnings, [])
})

test('字符串布尔按布尔处理，其余非法取值回落到默认并告警', () => {
  const warnings: string[] = []
  assert.equal(readOptions({ enabled: 'false' }, message => warnings.push(message)).enabled, false)
  assert.equal(readOptions({ sortOnStart: 'yes' }, message => warnings.push(message)).sortOnStart, true)
  assert.ok(warnings.some(message => message.includes('sortOnStart')))
})

test('debounceMs 只接受非负有限数', () => {
  assert.equal(readOptions({ debounceMs: 0 }, () => {}).debounceMs, 0)
  assert.equal(readOptions({ debounceMs: -1 }, () => {}).debounceMs, DEFAULT_OPTIONS.debounceMs)
  assert.equal(readOptions({ debounceMs: 'nope' }, () => {}).debounceMs, DEFAULT_OPTIONS.debounceMs)
})
