# SDK 3.0.0-beta.1 外围服务兼容验证

用户目标：用两个已发布 Beta 包验证外围服务完整功能，核对新旧客户端/服务端组合。
依据：已批准 TRON x402 改造方案 M3。使用真实 npm 制品，官方 Core 2.28.0。
范围：Facilitator、Gateway、Catalog；不改 CLI/recharge，不部署、不发布服务，不使用主网资金。

## 工作区与基线

- Facilitator：`/Users/bobo/code/x402/.worktrees/facilitator-sdk3-beta-compat`，origin/develop `071b517`。
- Gateway：`/Users/bobo/code/x402/.worktrees/gateway-sdk3-beta-compat`，origin/develop `e6cb07b`。
- Catalog：`/Users/bobo/code/x402/.worktrees/catalog-sdk3-beta-compat`，origin/develop `9e87dc1`。
- 三个仓库分支均为 `feature/sdk3-beta-compat`；保护原检出的未提交内容。

## 验证安排

- [x] 记录原服务基线；在隔离 worktree 安装 npm 精确 Beta，复现直接替换的失败。
- [x] Facilitator 对接官方 Core 和独立扩展公开入口；保留钱包、结算、重放防护、资源权限、SQLite/PostgreSQL账本与恢复。
- [x] Gateway 保留原provider配置与HTTP行为，补充默认关闭的可选资源声明；验证已有EVM/TRON/GasFree/CLI/代理流程。
- [x] Catalog 验证现有发现数据与新旧SDK公开API及HTTP服务契约；不扩大现有scheme范围。
- [x] 独立HTTP联合链路：Catalog发现、Gateway 402、旧/新客户端签名、Facilitator verify/settle、上游响应；包括普通付款、资源代付、错误、pending与恢复。
- [x] 三类TRON机制及GasFree的服务层回归；SQLite重启/PostgreSQL共享协调、权限/预算/回收边界。
- [x] 用户指定测试环境后执行可用真实Nile测试；凭据或资金缺失时精确记录未验收范围，不能用模拟测试替代真实链结论。
- [x] 独立审查变动，中文验证记录与必要迁移说明；不以单元测试通过声称无条件drop-in或生产全兼容。

## 接口约束

支付wire与HTTP header保持v2；同一调用链使用同一Core类型/实例。旧调用方通过序列化消息兼容，不将两个Core运行对象混用。
资源schema、扩展key、Approval交易绑定、原txID恢复、幂等和账本数据必须保留。遇到源代码API移除先记录失败，再做必要迁移。
Gateway只支持既有exact/exact_gasfree路由；upto/batch在Facilitator层验证，不臆造Gateway支持。

## 审查重点

新旧消息与数据恢复的兼容；官方hook时序和错误码；钱包签名/权限/预算；重复授权拒绝与pending处理；默认配置不改变原付款行为；真实链/模拟链结果准确区分。
