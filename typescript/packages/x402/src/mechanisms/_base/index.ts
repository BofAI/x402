/**
 * Base mechanism interfaces — mirrors Python `bankofai.x402.mechanisms._base`.
 *
 * The three role interfaces (`ClientMechanism`, `ServerMechanism`,
 * `FacilitatorMechanism`) currently live close to where they're consumed:
 *
 * - `ClientMechanism`     → `src/client/x402Client.ts`
 * - `ServerMechanism`     → `src/server/types.ts`
 * - `FacilitatorMechanism` → `src/facilitator/x402Facilitator.ts`
 *
 * This file re-exports them under one mechanism-rooted location so that
 * `mechanisms/<chain>/<scheme>/{client,server,facilitator}.ts` modules import
 * their role contract from a single canonical path. Mirrors how Python's
 * `_base/{client,server,facilitator}.py` are imported by concrete mechanisms.
 */

export type { ClientMechanism, ClientSigner } from '../../client/x402Client.js';
export type { ServerMechanism } from '../../server/types.js';
export type {
  FacilitatorMechanism,
  FacilitatorLogger,
} from '../../facilitator/x402Facilitator.js';
