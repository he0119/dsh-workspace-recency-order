# Agent Note: 发布以标签为锚，产物在发布时现场构建

Status: implemented

## Problem

插件要能被别人装上，只有两条路：从 git 装，或者从 npm 装。git 这条在这个仓库上是坏的：构建产物
`lib/` 在 `.gitignore` 里、不进仓库，而 `pnpm` 从 git 来源装包时只跑 `prepare`，仓库当时没有这个脚本，
于是装出来的包缺入口文件（`main` 与 `exports` 都指向 `lib/`），加载就报错。也就是说「能构建」这件事
以前只在开发者的机器上成立，谁来装都得先克隆、装依赖、手动构建。

## Decision

发布渠道是 npm 包 `@he0119/dsh-workspace-recency-order`，产物不进 git，由 `package.json` 的 `prepare`
在发布那一刻现场构建（先 `prebuild` 清掉 `lib/`，再跑完整 tsdown）。

发布以**标签**为锚，只有一个入口：推 `v*` 标签触发
[`publish.yml`](../../../../.github/workflows/publish.yml)。工作流先复用 `ci.yml` 那套检查（install →
typecheck → build → check:package → test），再走三道校验，然后 `npm publish`，最后建 GitHub Release：

- 标签指向的提交里 `package.json` 就是 `vX.Y.Z`；
- 那个提交是 `origin/main` 的祖先；
- `main` 当前的 `package.json` 仍是这个版本（防止往旧版本倒灌，把 npm 的 `latest` 拽回去）。

发布用**可信发布**（OIDC 换短期凭据），仓库里没有任何长期 token；`publishConfig.access` 声明 public，
工作流里写裸 `npm publish`。首版是例外：npm 没有 pending publisher，包得先在 registry 上存在才能登记
Trusted Publisher，所以第一个版本只能手动发。整套流程写在 [releasing.md](../../../../docs/releasing.md)。

## Alternatives considered

**把 `lib/` 提交进 git。** 那样从 GitHub 装就能成，但每次发版要提交一遍编译产物：review 里混进几万行
生成的代码，产物还可能和源码不同步（谁改了源码忘了重建，仓库里就是旧产物）。构建产物放仓库是把
构建问题换成「哪个才是真的」问题。

**只加 `prepare`，继续让用户从 git 装。** pnpm 对 git 来源默认拒绝执行构建脚本，用户得先在自己的
`pnpm-workspace.yaml` 里为这个仓库的 git 地址开 `allowBuilds`，装一个插件要走一次审批流程；`prepare`
还会在用户的 profile 目录里跑 tsdown，能不能成功取决于那边的 Node 与依赖。发布 npm 包把这些不确定性
一次抹掉。

**把 `npm pack` 的 tgz 挂到 GitHub Release 上。** 这条路本身能用（DSH 的安装器认得 tarball 地址），
但用户得复制一长串 URL，也没有版本比对式的升级提示；留作 npm 不可用时的退路，不作为主渠道。

**手动 `npm publish`，不写工作流。** 省掉一个文件，代价是把「先构建、先检查、版本与 git 一致、发完建
Release」全押在人的记忆上；顺序错了会出现 npm 上有版本而仓库里没有对应标签，或者 Release 早于发布。

**仓库里存 `NPM_TOKEN` 长期凭据。** 一个只读发布权限的 token 也是长期凭据，泄露就能发版、也能改包；
可信发布用一次性的 OIDC 身份换凭据并顺带签 provenance，不需要在 GitHub 里存任何秘密。

## Consequences

- 版本号只有 `package.json` 一个来源，标签必须打在版本提交上；打错了会被三道校验拦在 npm 之外。
- 首版手动发出来的那个版本没有 provenance 证明，后面的版本都有；这是可信发布机制的限制，不是漏配。
- registry 收下发布是异步的：发完那几分钟里 `npm view` 可能仍查不到这个版本，重复跑同一条工作流会被
  npm 以「该版本已存在」拒绝。
- `prepare` 也会在本地 `pnpm install` 时跑，克隆下来装完依赖就已经有产物；代价是每次装依赖多花一次构建。
- 用户装插件只需要一个包名；从 GitHub 地址装这条路不再被文档推荐（它的失败原因是产物不进 git，不是
  装错了）。
