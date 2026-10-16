# TRON SDK 3.0.0-beta.1 发布记录

日期：2026-10-16（Asia/Shanghai）。用户明确要求统一版本并发布 Beta。
源码分支：`feat/tron-official-sdk`。
源码提交：`92b1b133d9f020f867b0a4a08de2fd0cf8f0c461`。
发布目标：npm 公共 registry，标签 `beta`；仅发布以下两个 TRON 包。
本次 Beta 按用户要求从当前已验证开发提交发布，稳定版继续遵循 BRANCHING.md 的 release/main 流程。

## 版本和制品

| 包 | 版本 | 已验证制品 SHA-512 integrity |
| --- | --- | --- |
| `@bankofai/x402-tron` | `3.0.0-beta.1` | `sha512-4m4lmgr+lCV54EawIG8pwSB8rbWEleMgcyJrSiUbXdA/SEZ9pYLqgmKhdasFZOD5782NsEhkxCPNGK4KRpWuAA==` |
| `@bankofai/x402-tron-extensions` | `3.0.0-beta.1` | `sha512-h3Bqmx1zxhMGikCNuwCWibd+6lS9Oo7g810usKmNdMyFWBq4/Hw9yf8EPMolkFUK9BdYKE+EyzrvELezEqmqxg==` |

制品位于当前 worktree 的 `dist/releases/tron-3.0.0-beta.1/`，包括两个 tarball 和 `manifest.json`。
扩展包的已打包依赖为 `@bankofai/x402-tron: 3.0.0-beta.1`；两个包精确 peer 依赖官方 Core 2.28.0。
Changesets 的 fixed group 保证两个 TRON 包未来同步递增；当前状态计算出的稳定目标均为 3.0.0。
旧 Core 的已有 changeset 保留供后续独立处理，不在本次发布清单中，也没有执行全仓 Changesets publish。

## 发布前验证

- pnpm 11.1.1：两个包的类型检查、构建、lint、格式检查通过。
- 机制包：26 个文件、224 个单测通过；扩展包：7 个文件、101 个单测通过。
- 对最终两份 tarball 分别执行独立基础消费和完整组合消费：严格 TypeScript 5.7.3 NodeNext、ESM/CJS、全部 20/25 个公开入口、离线真实签名支付与扩展组合通过。
- 检查全部 export 目标实际存在、依赖已重写、无测试或 node_modules 混入；无旧 Core、通用扩展或 Agent Wallet 生产依赖。
- 两个最终 tarball 的 npm publish dry-run 通过，integrity 与发布清单一致。
- Node.js 25.6.0；官方 Core 2.28.0；TronWeb 6.3.0；测试 Agent Wallet 2.4.0。

## 发布与回读

机制包已由 npm 接受并在 registry 可见：`beta = 3.0.0-beta.1`，`latest = 2.0.0`；integrity 与制品一致。从 npm 冷安装的基础 ESM/CJS 严格消费验证通过。
扩展包已在 registry 可见：`beta = 3.0.0-beta.1`；依赖与 integrity 均匹配最终制品。完整组合从 npm 冷安装后的严格 ESM/CJS 编译、全部公开入口和离线签名支付验证通过。
最终 registry 回读记录位于制品目录的 `registry-verified.json`。
发布按机制包、扩展包顺序执行，机制包已有 latest 标签保持 2.0.0。
新扩展包首次发布后回读到额外的 `latest = 3.0.0-beta.1`。尝试删除该标签时，npm 返回 403，并明确说明绕过 2FA 的 granular token 不得执行此操作。该标签尚未清理，需 npm 允许的交互认证；不能将当前发布状态表述为新扩展包只有 beta 标签。安装时使用上面的明确版本或 beta 标签。
用户提供的 npm token 已保存到本机用户配置，权限 0600；凭据不写入仓库或本记录。

## 安装

```sh
npm install @x402/core@2.28.0 @bankofai/x402-tron@3.0.0-beta.1
# 启用资源代付时再安装
npm install @bankofai/x402-tron-extensions@3.0.0-beta.1
```

## 已知范围

本次仅调整版本、包元数据和发布说明，没有修改支付运行逻辑。
M3 外围服务迁移、真实测试网和持久化 coordinator/跨服务恢复仍待验收；M4 旧调用方迁移与退役未完成。
Upto 在 allowance/余额 RPC 读取失败时仍沿用旧的乐观验证行为；稳定发布前需要改为明确拒绝。
全仓发布构建没有验收，本机旧 legacy/x402 缺少依赖的问题不属于两个目标包的通过结果。
本次没有执行真实链交易、Git 分支推送或合并。
