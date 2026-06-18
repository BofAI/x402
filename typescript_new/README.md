# x402 Typescript SDK

This folder contains Typescript packages to help developers implement the x402 protocol in their front-end and back-end applications.

| Package | Description | Latest version |
| --- | --- | --- |
| [`@bankofai/x402-core`](./packages/core) | Transport-agnostic client, server, and facilitator components. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-core.svg)](https://www.npmjs.com/package/@bankofai/x402-core) |
| [`@bankofai/x402-extensions`](./packages/extensions) | Additional functionality built on top of x402 (Bazaar, Sign-in-with-x). | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-extensions.svg)](https://www.npmjs.com/package/@bankofai/x402-extensions) |
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
| [`@bankofai/x402-paywall`](./packages/http/paywall) | Browser paywall UI for x402-enabled apps. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-paywall.svg)](https://www.npmjs.com/package/@bankofai/x402-paywall) |

## Chains implementations

| Package | Description | Latest version |
| --- | --- | --- |
| **EVM** - [`@bankofai/x402-evm`](./packages/mechanisms/evm) | EVM implementation of x402 using the Exact payment scheme. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-evm.svg)](https://www.npmjs.com/package/@bankofai/x402-evm) |
| **Algorand** - [`@bankofai/x402-avm`](./packages/mechanisms/avm) | AVM implementation of x402 using ASA transfers. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-avm.svg)](https://www.npmjs.com/package/@bankofai/x402-avm) |
| **Aptos** - [`@bankofai/x402-aptos`](./packages/mechanisms/aptos) | Aptos implementation of the x402 payment protocol. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-aptos.svg)](https://www.npmjs.com/package/@bankofai/x402-aptos) |
| **Stellar** - [`@bankofai/x402-stellar`](./packages/mechanisms/stellar) | Stellar implementation of x402 using Soroban token transfers. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-stellar.svg)](https://www.npmjs.com/package/@bankofai/x402-stellar) |
| **Solana** - [`@bankofai/x402-svm`](./packages/mechanisms/svm) | SVM implementation of x402 using SPL token transfers. | [![npm version](https://img.shields.io/npm/v/%40bankofai%2Fx402-svm.svg)](https://www.npmjs.com/package/@bankofai/x402-svm) |

