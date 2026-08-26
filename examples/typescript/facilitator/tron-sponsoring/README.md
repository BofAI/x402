# TRON Approval Resource Sponsoring Facilitator

This standalone Nile Facilitator owns the complete sponsorship lifecycle:

1. strictly verifies the payer-signed TRC-20 Approval;
2. delegates the minimum Stake 2.0 Energy/Bandwidth;
3. broadcasts the unchanged Approval;
4. records recovery debt and submits Undelegate actions;
5. continues Permit2 settlement without waiting for Undelegate confirmation; and
6. reconciles recovery in a background worker.

```bash
cp .env.example .env
pnpm dev
```

The Resource Owner must differ from the payer and must have sufficient Stake 2.0 capacity. Configure
a non-owner Active Permission that allows DelegateResource and UnDelegateResource, authorize the
configured wallet key on that permission, then set its id in `TRON_PERMISSION_ID`. The permission id
is used only for resource delegation and reclamation; Permit2 settlement uses the wallet's default
permission.

The bundled in-memory coordinator and generic agent-wallet signer are development references only.
Production deployments require shared durable coordination, a monitored recovery worker, bounded
tenant policy, and an intent-validating HSM or remote signer.
