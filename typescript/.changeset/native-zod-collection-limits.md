---
"@bankofai/x402-core": major
"@bankofai/x402-mcp": patch
---

Use native Zod 4.6.6 or newer to fix GHSA-mrhx-c7xc-m3w5. Oversized resource
tag arrays now stop before element validation instead of accumulating per-element
errors. Update the MCP transport's direct Zod dependency to the same safe range.
Align V1 and V2 payment-option arrays with official Core's 1,024-entry maximum,
so oversized `accepts` arrays also stop before validating individual entries.

The core `/schemas` export now exposes native Zod 4 schemas, `z`, and safe-parse
result types. Consumers that compose schemas must use Zod 4 and use
`error.issues` instead of the removed Zod 3 `error.errors` alias. Normal JSON
payment payloads, extensible records, and nullable optional metadata remain
supported. Do not import `zod/v3` as a compatibility workaround: that entry still
uses the affected collection parser.
