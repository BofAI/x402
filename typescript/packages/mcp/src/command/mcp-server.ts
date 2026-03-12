/* eslint-disable jsdoc/require-jsdoc */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/x402.js");

function runCli(args: string[]): unknown {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    env: process.env,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();

  if (result.status !== 0) {
    throw new Error(stderr || stdout || `x402 command failed with exit code ${result.status ?? 1}`);
  }

  if (!stdout) {
    return {};
  }

  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return { output: stdout };
  }
}

function toTextResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "x402-mcp",
    version: "2.6.0",
  });

  server.tool("x402_status", "Show configured x402 wallet status.", {}, async () => {
    return toTextResult(runCli(["status"]));
  });

  server.tool(
    "x402_balance",
    "Show configured x402 wallet balances.",
    {
      network: z.string().optional(),
      asset: z.string().optional(),
      token: z.string().optional(),
      pair: z.string().optional(),
    },
    async args => {
      const commandArgs = ["balance"];
      if (args.network) commandArgs.push("--network", args.network);
      if (args.asset) commandArgs.push("--asset", args.asset);
      if (args.token) commandArgs.push("--token", args.token);
      if (args.pair) commandArgs.push("--pair", args.pair);
      return toTextResult(runCli(commandArgs));
    },
  );

  server.tool(
    "x402_pay",
    "Call an x402-protected URL and automatically complete payment.",
    {
      url: z.string().url(),
      method: z.string().optional(),
      data: z.string().optional(),
      query: z.string().optional(),
      headers: z.string().optional(),
      network: z.string().optional(),
      asset: z.string().optional(),
      token: z.string().optional(),
      pair: z.string().optional(),
      max_amount: z.string().optional(),
      correlation_id: z.string().optional(),
    },
    async args => {
      const commandArgs = ["pay", args.url];
      if (args.method) commandArgs.push("-X", args.method);
      if (args.data) commandArgs.push("-d", args.data);
      if (args.query) commandArgs.push("-q", args.query);
      if (args.headers) commandArgs.push("-h", args.headers);
      if (args.network) commandArgs.push("--network", args.network);
      if (args.asset) commandArgs.push("--asset", args.asset);
      if (args.token) commandArgs.push("--token", args.token);
      if (args.pair) commandArgs.push("--pair", args.pair);
      if (args.max_amount) commandArgs.push("--max-amount", args.max_amount);
      if (args.correlation_id) commandArgs.push("--correlation-id", args.correlation_id);

      return toTextResult(runCli(commandArgs));
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
