# Scheme: `upto`

Code: `mechanisms/{evm,tron}/src/upto/{client,facilitator,server}`. Classes `UptoEvmScheme` / `UptoTronScheme`. EVM + TRON, Permit2-based. No register helper — use `new + register`.

`upto` is **usage-based billing**. The payer signs an authorization for **up to a maximum** amount; the server decides the **real usage** per request and settles only that (`actual ≤ max`). The facilitator submits the on-chain settlement.

## When to use

- Price is not known until after the work is done, but a ceiling is.
- Metered / per-call billing where each request charges a different amount under one signed cap.

## Key invariants

- The client signs the **max**; the server chooses `actual ∈ [0, max]` and settles `actual`. Settling more than the signed max must fail.
- Both chains use Permit2, so the EVM path **reads the chain** — needs a working RPC ([networks/evm.md](../networks/evm.md)).

## Common gotchas

- **Settle-time verification**: the facilitator's `readContract` simulation of the upto proxy's caller-authorized `settle` must set `account` to the authorized caller, or the simulation fails. This is overlay-wiring, not an upstream bug (see [typescript/CLAUDE.md](../../../typescript/CLAUDE.md)).

## Testing

`mechanisms/evm/test/unit/upto/**`, `mechanisms/tron/test/unit/upto-flow.test.ts`.

## Safety

Settlement + signing path — **security-reviewer territory**.
