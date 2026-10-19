# x402 Typescript SDK

This folder contains Typescript packages to help developers implement the x402 protocol in their front-end and back-end applications.

| Package | Description | Latest version |
| --- | --- | --- |
| [`@bankofai/x402-core`](./packages/core) | Transport-agnostic client, server, and facilitator components. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-core.svg)](https://www.npmjs.com/package/@bankofai/x402-core) |
| [`@x402/extensions`](https://www.npmjs.com/package/@x402/extensions) | Official Bazaar, Sign-in-with-x, and EVM gas sponsorship extensions; depend on this package directly. | [![npm version](https://img.shields.io/npm/v/%40x402%2Fextensions.svg)](https://www.npmjs.com/package/@x402/extensions) |
| [`@bankofai/x402-mcp`](./packages/mcp) | MCP server integration for x402. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-mcp.svg)](https://www.npmjs.com/package/@bankofai/x402-mcp) |

## HTTP integrations

| Package | Description | Latest version |
| --- | --- | --- |
| [`@bankofai/x402-axios`](./packages/http/axios) | Axios interceptor for x402 payment flows. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-axios.svg)](https://www.npmjs.com/package/@bankofai/x402-axios) |
| [`@bankofai/x402-express`](./packages/http/express) | Express middleware for x402-protected routes. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-express.svg)](https://www.npmjs.com/package/@bankofai/x402-express) |
| [`@bankofai/x402-fastify`](./packages/http/fastify) | Fastify middleware for x402-protected routes. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-fastify.svg)](https://www.npmjs.com/package/@bankofai/x402-fastify) |
| [`@bankofai/x402-fetch`](./packages/http/fetch) | Fetch wrapper for x402 payment handling. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-fetch.svg)](https://www.npmjs.com/package/@bankofai/x402-fetch) |
| [`@bankofai/x402-hono`](./packages/http/hono) | Hono middleware for x402 integrations. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-hono.svg)](https://www.npmjs.com/package/@bankofai/x402-hono) |
| [`@bankofai/x402-next`](./packages/http/next) | Next.js integration for x402. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-next.svg)](https://www.npmjs.com/package/@bankofai/x402-next) |

## Chains implementations

| Package | Description | Latest version |
| --- | --- | --- |
| **EVM** - [`@bankofai/x402-evm`](./packages/mechanisms/evm) | EVM implementation of x402 using the Exact payment scheme. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-evm.svg)](https://www.npmjs.com/package/@bankofai/x402-evm) |
| **TRON** - [`@bankofai/x402-tron`](./packages/mechanisms/tron) | TRON implementation of x402 (exact, permit, GasFree, batch-settlement). | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-tron.svg)](https://www.npmjs.com/package/@bankofai/x402-tron) |


TRON resource sponsorship: [`@bankofai/x402-tron-extensions`](./packages/extensions) uses official Core 2.28.0; generic extensions use official `@x402/extensions@2.28.0` directly.
