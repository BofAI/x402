# logging — capture TRON SDK logs

Install the public TRON logger to capture mechanism logs in a file. This example resolves
RPC URLs for three networks to trigger real fallback warnings without making network requests.
Each network warns once per process, so a different network demonstrates each log sink.

```sh
pnpm install      # from examples/typescript
pnpm dev:logging
cat ./x402.log
```

The example shows default console output, a custom file/console sink, and `noopLogger`.
Only the mainnet fallback warning is captured in the file; the final Shasta warning is silenced.

```ts
import { setLogger, noopLogger, type Logger } from "@bankofai/x402-tron";

setLogger(myLogger); // debug, info, warn, error methods
setLogger(noopLogger);
```

This logger controls TRON mechanism output. Official `@x402/core` and `@x402/extensions`
use their own logging and lifecycle hooks; installing the TRON logger does not intercept them.
