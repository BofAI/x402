/**
 * Shared base for the `exact_permit` scheme — mirrors Python
 * `bankofai.x402.mechanisms._exact_permit_base`.
 *
 * Concrete client mechanisms (`evm/exact_permit/client.ts`,
 * `tron/exact_permit/client.ts`) currently embed the shared logic directly.
 * Server + facilitator base classes (Python's
 * `_exact_permit_base/{server,facilitator}.py`) will be added here when their
 * TS counterparts are ported.
 *
 * Placeholder file — keeps the directory structure aligned with Python and
 * gives `mechanisms/<chain>/exact_permit/{server,facilitator}.ts` a canonical
 * place to import shared bases from once they exist.
 */

export {};
