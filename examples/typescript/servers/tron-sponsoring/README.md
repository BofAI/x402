# TRON Approval Resource Sponsoring Server

This Nile-only Server advertises one `exact + Permit2` USDT payment and declares the canonical
`trc20ApprovalResourceSponsoring` Extension. It remains keyless and delegates verification and
settlement to the standalone Facilitator.

```bash
cp .env.example .env
pnpm dev
```

`TRON_ADDRESS` is the merchant payout address. The protected resource is available at
`http://localhost:4041/weather`.
