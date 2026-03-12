/* eslint-disable jsdoc/require-jsdoc */
import { parseCliOptions, runBalance, runPay, runStatus } from "./runtime.js";

function printHelp(): void {
  process.stdout.write(
    [
      "x402 CLI",
      "",
      "Usage:",
      "  x402 status",
      "  x402 balance [--network <network>] [--asset <asset>] [--pair <pair>]",
      "  x402 pay <url> [-X <method>] [-d <json>] [-q <params>] [-h <json>]",
      "           [--network <network>] [--asset <asset>] [--pair <pair>]",
      "           [--max-amount <atomic-units>] [--correlation-id <id>] [--json]",
      "",
      "Notes:",
      "  - `pay` is the primary payment command.",
    ].join("\n") + "\n",
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "status") {
    await runStatus();
    return;
  }

  if (command === "balance") {
    await runBalance(parseCliOptions(rest));
    return;
  }

  if (command === "pay") {
    await runPay(parseCliOptions(rest));
    return;
  }

  if (command.startsWith("--")) {
    await runPay(parseCliOptions(argv));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
