/**
 * 构建配置：Host 端沿用官方包的产物形状——源码打成一个 ESM `lib/index.js`，依赖保持外部，
 * 声明按源码模块输出到 `lib/types/`；Web Client 端另外出一份 `lib/client.js`，遵守 DSH
 * 客户端模块系统的经典脚本契约（`window.__ModuleLoader__.load({ id, factory })`）。
 *
 * 客户端那一份反过来：它跑在浏览器里，除了平台模块表提供的基线模块，其余都要内联进产物。
 */
import { readFileSync } from 'node:fs'

import { defineConfig, type UserConfig } from 'tsdown'

const { name: PACKAGE } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { name: string }

/** 浏览器模块表里由宿主提供、产物里保持 `require(...)` 的模块：只有平台基线模块能这样要。 */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime'] as const

const host: UserConfig = {
  name: `${PACKAGE}/host`,
  entry: { index: 'src/index.ts' },
  tsconfig: 'tsconfig.json',
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2023',
  dts: false,
  sourcemap: false,
  fixedExtension: false,
  // 三份配置共用 lib/；完整构建由 package.json 的 prebuild 一次性清理。
  clean: false,
  deps: { neverBundle: true },
  outputOptions: {
    entryFileNames: '[name].js',
  },
}

const types: UserConfig = {
  name: `${PACKAGE}/types`,
  // 排除 Web Client 端：它的声明要 React 与 DOM，而这一份是给 Node 侧消费者读的。
  entry: ['src/**/*.ts', '!src/client/**'],
  tsconfig: 'tsconfig.json',
  outDir: 'lib/types',
  root: 'src',
  unbundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2023',
  dts: {
    dtsOnly: true,
    sourcemap: false,
  },
  sourcemap: false,
  fixedExtension: false,
  clean: false,
  deps: {
    neverBundle: true,
    dts: { neverBundle: true },
  },
}

const client: UserConfig = {
  name: `${PACKAGE}/client`,
  entry: { client: 'src/client/index.ts' },
  // Host 端的 tsconfig.json 把 src/client 排除在外，这里必须指到 Web Client 端自己那份。
  tsconfig: 'tsconfig.client.json',
  outDir: 'lib',
  format: 'cjs',
  target: 'es2023',
  // rolldown 的 cjs 产物默认按 Node 解析；这里显式要浏览器条件（客户端不碰任何 Node API）。
  inputOptions: { platform: 'browser' },
  dts: false,
  sourcemap: true,
  fixedExtension: false,
  // Host 端的 lib/index.js 也在同一个目录里，默认的 clean 会把它一起删掉。
  clean: false,
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (specifier: string) => !(CLIENT_EXTERNALS as readonly string[]).includes(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default defineConfig([host, types, client])
