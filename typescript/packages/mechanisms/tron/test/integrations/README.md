# TRON Nile integration tests

These tests instantiate the x402 Resource Server, Client, and Facilitator roles locally while sending every chain action to Nile.

## TRC-20 Approval Resource Sponsoring

```bash
cp test/integrations/.env.example test/integrations/.env
# Fill the Nile-only values, then run from packages/mechanisms/tron:
pnpm test:integration -- trc20-approval-resource-sponsoring.nile.test.ts
```

The test executes and asserts the complete sequence:

1. the Server advertises `trc20ApprovalResourceSponsoring`;
2. the Client signs an unchanged `approve(Permit2, MaxUint256)` transaction;
3. `/verify` performs read-only validation;
4. `/settle` delegates the missing Energy/Bandwidth and waits until visible;
5. the Facilitator broadcasts the payer-signed Approval;
6. the Facilitator undelegates every resource leg;
7. the Facilitator settles `0.001 USDT` through the Exact Permit2 proxy;
8. the test confirms MaxUint allowance, unchanged payer TRX, and no remaining Resource Owner-to-payer delegation.

With `TRON_NILE_FRESH_PAYER=true`, setup creates and funds a new default-owner EOA so repeated runs do not silently skip the Extension because a previous MaxUint allowance is still present.
