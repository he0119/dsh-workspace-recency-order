/**
 * 打包自检：manifest 与构建产物必须对得上。
 *
 * 检查项都是安装后才会出问题、但构建阶段就能发现的东西：导出路径是否落地、
 * 客户端产物是否还是那个经典脚本契约、Host 产物是否导出 apply/inject。
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const read = path => readFileSync(new URL(path, root), 'utf8')
const exists = path => existsSync(new URL(path, root))

assert.equal(typeof manifest.name, 'string')
assert.ok(manifest.name.startsWith('@'), '包名需要带 scope，cordis.patch.yml 会按这个引用它')
assert.equal(manifest.type, 'module')
assert.equal(manifest.main, 'lib/index.js')
assert.equal(manifest.icon, './icon.svg')

// 导出路径必须存在（link 安装时不会跑构建，产物得先有）。
assert.ok(exists('lib/index.js'), '缺少宿主产物 lib/index.js，先跑 pnpm run build')
assert.ok(exists('lib/types/index.d.ts'), '缺少 lib/types/index.d.ts')
assert.ok(exists(manifest.exports['./client']), `缺少客户端产物 ${manifest.exports['./client']}`)
assert.ok(exists(manifest.icon), '缺少图标')

// bundle 补丁必须存在，并且真的插入了本包这一行。
const patch = read(manifest.dsh.bundle.patch)
assert.match(patch, /- insert:/)
assert.ok(patch.includes(manifest.name), 'cordis.patch.yml 里没有本包名')

// Host 产物导出 apply/inject。
const host = read('lib/index.js')
assert.match(host, /export\s*\{[^}]*apply/, 'lib/index.js 没有导出 apply')
assert.match(host, /export\s*\{[^}]*inject/, 'lib/index.js 没有导出 inject')

// 客户端产物必须是经典脚本契约：包住 window.__ModuleLoader__.load，且 id 等于包名。
const client = read('lib/client.js')
assert.ok(client.startsWith('window.__ModuleLoader__.load('), 'lib/client.js 不是 classic script 契约')
assert.ok(client.includes(JSON.stringify(manifest.name)), 'lib/client.js 里的模块 id 与包名不一致')
assert.match(client, /exports\.apply = apply/)
assert.match(client, /exports\.inject = inject/)

// 客户端产物只许 require 平台基线模块。
const requires = [...client.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
const allowed = new Set(['react', 'react/jsx-runtime'])
for (const specifier of requires) {
  assert.ok(allowed.has(specifier), `客户端产物内联或引入了非基线模块：${specifier}`)
}

// files 要把运行时需要的东西一起带上。
for (const required of ['lib', 'locale/*.json', 'icon.svg', 'cordis.patch.yml', 'README.md', 'README.en.md', 'LICENSE']) {
  assert.ok(manifest.files.includes(required), `package.json 的 files 缺少 ${required}`)
}

// 语言资源：中英两份都在，且 meta 有标题与说明。
for (const locale of ['zh', 'en']) {
  const dictionary = JSON.parse(read(`locale/${locale}.json`))
  assert.ok(dictionary.meta?.title, `locale/${locale}.json 缺少 meta.title`)
  assert.ok(dictionary.meta?.description, `locale/${locale}.json 缺少 meta.description`)
}

console.log('check-package: ok')
