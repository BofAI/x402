# Upto RPC fail-closed 验证记录

日期：2026-10-19（Asia/Shanghai）。范围：`b414fc8a..a39d486e`，分支 `feat/tron-official-sdk`。
用户要求修掉 TRON upto RPC 异常时乐观预检通过的问题，补测试并再次走读。

## 行为

- 必须读取的 allowance/balance RPC 抛错，统一返回 `isValid:false`、`invalidReason:chain_read_failed`、固定 `invalidMessage:TRON contract read failed` 和 payer。
- 无效 uint256 输出也拒绝：缺失/null/bool/object/array、非法或空字符串、负值、溢出、非整数、非安全整数、NaN/Infinity。不使用隐式关系比较接受无效结果。
- 保留 bigint、原子十进制/十六进制字符串、安全整数；正常不足仍为 `permit2_allowance_required` / `insufficient_funds`。离线检查真实 TronWeb ABI uint256 解码结果为 bigint，单输出 `.call()` 会返回该元素。
- settle 仍先按已授权最大额重新验证，再处理部分或零结算。失败返回 `success:false`、`errorReason:chain_read_failed`、空 transaction，不签发结算交易、不等待回执。
- 资源扩展预检仍可在 Approval 前暂缓 allowance；balance 始终必须读取。委托后的 scheme revalidation 失败会向 runtime 返回拒绝，已注册扩展的集成用例验证不继续结算。
- 原始 RPC URL、凭据片段或异常诊断不回显。

## 回归证据

- 新增机制用例36个：基线29失败/7通过；修复后36通过。包含官方 Core 的 verify/settle、两类读取失败、非法值、有效值、真实不足、部分和零金额、资源回调的余额拒绝。
- 新增资源扩展集成用例2个：使用真实离线签名 Approval、官方 Core extension 注册；旧机制产物运行失败，重建修复后的机制产物后通过。覆盖首次预检和委托后 revalidation 的 RPC 失败。
- 完整机制：28文件、266/266；完整扩展：7文件、103/103。
- 两包 source TypeScript、build、lint、format 通过。Node25 对既有 ESLint config 的 module 类型提示不影响检查退出状态。
- 独立打包消费：严格 TypeScript5.7.3 NodeNext、ESM/CJS、20+5公开入口、真实离线 Approval 签名及扩展注册通过。机制 ESM/CJS 消费脚本额外断言 allowance/balance 失败时 verify 拒绝、settle 拒绝且广播次数为0。
- 执行日志保存在 `/tmp/upto-fail-closed-` 前缀的 red、green、full、extension-red、ext-green、consumer、ext-consumer 等 `.log` 文件。

## 范围

本次只修改源码、回归测试和待发布 patch changeset；未变更 npm 版本/标签、未发布、未推送或合并、未部署、未发起真实链交易。
已发布 `2.1.0-beta.1` 仍不含此修复，README 明确区别已发布制品与当前未发布源码。

## 独立走读

审查者以全新上下文只读审阅 `b414fc8a..a39d486e`，未发现阻断问题、需要延期的minor或本次修改引入的可触发回归。独立使用不加载默认环境变量的隔离配置重跑两个upto测试文件，46/46通过。另以离线stub `triggerSmartContract` 实际执行TronWeb allowance/balanceOf的相同ABI `.call()`，两者均返回 `2000000n`。

审查核对了两个catch、uint256转换、部分/零额结算顺序、资源代付allowance延后和必需balance重验。未独立重复全量构建/packed消费者，使用主实现者已运行证据；资源新增测试使用真实扩展注册和模拟runtime，未执行真实委托/链交易/资源恢复。
