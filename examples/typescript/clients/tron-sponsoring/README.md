# TRON Approval Resource Sponsoring Client

This payer runs only on Nile. When the Server declares `trc20ApprovalResourceSponsoring`, the exact
Client signs the one-time USDT `approve(Permit2)` transaction but does not broadcast it. The signed
transaction is attached to the x402 payload for the Facilitator.

```bash
cp .env.example .env
pnpm dev
```

Use a payer wallet that is different from the Facilitator Resource Owner. The payer must be an
activated EOA with enough Nile USDT for the payment; it does not need TRX for the sponsored Approval.
