# TRON Approval Resource Sponsoring Facilitator

This standalone Nile Facilitator owns the complete sponsorship lifecycle:

1. strictly verifies the payer-signed TRC-20 Approval;
2. delegates the minimum Stake 2.0 Energy/Bandwidth;
3. broadcasts the unchanged Approval;
4. records recovery debt and submits Undelegate actions;
5. continues Permit2 settlement without waiting for Undelegate confirmation; and
6. reconciles recovery in a background worker.

```bash
cd ../../
cp .env-tron-sponsoring.example .env-tron-sponsoring
cd facilitator/tron-sponsoring
pnpm dev
```

The Resource Owner must differ from the payer and must have sufficient Stake 2.0 capacity. Configure
a non-owner Active Permission that allows DelegateResource and UnDelegateResource, authorize the
configured wallet key on that permission, then set its id in `TRON_PERMISSION_ID`. The permission id
is used only for resource delegation and reclamation; Permit2 settlement uses the wallet's default
permission.

Set `TRON_SPONSORING_RESOURCE_OWNER_WALLET_ID` to the Resource Owner's configured `agent-wallet` ID.
The shared scenario file must not contain either role's private key.

The bundled in-memory coordinator and generic agent-wallet signer are development references only.
Production deployments require shared durable coordination, a monitored recovery worker, bounded
tenant policy, and an intent-validating HSM or remote signer.

Operational limits and the recovery interval are parsed in `src/config.ts`. Override their
`TRON_SPONSORING_*` environment variables in the shared scenario file when testing a different
Resource Owner capacity. Invalid or missing security-sensitive values fail at startup.
