import { Hono } from "hono";
import { serve } from "@hono/node-server";

async function verify() {
  const app = new Hono();

  // Middleware mimicking our current x402-hono implementation
  app.use("*", async (c, next) => {
    await next();
    
    let res = c.res;
    console.log("\n--- Test 3: Cloning and Re-assigning ---");
    
    // Simulate reading body which is required for extension enrichment
    const responseBody = await res.clone().arrayBuffer();
    console.log("Body cloned, size:", responseBody.byteLength);

    // Current logic in index.ts:
    // c.res = undefined; // This is what we do in the code
    
    console.log("Setting header on original res...");
    res.headers.set("X-Settlement-Status", "success");
    
    // c.res = res;
    // console.log("Re-assigned c.res, header count:", Array.from(c.res.headers.keys()).length);
  });

  app.get("/test", (c) => {
    return c.json({ message: "hello" });
  });

  const server = serve({ fetch: app.fetch, port: 9999 });

  // Simulate client request
  console.log("Client: Sending request with PAYMENT-SIGNATURE (UPPERCASE)...");
  const res = await fetch("http://localhost:9999/test", {
    headers: {
      "PAYMENT-SIGNATURE": "test-sig-123"
    }
  });

  const settlementHeader = res.headers.get("X-Test-Settlement");
  console.log("\n--- Final Client Perspective ---");
  console.log("X-Test-Settlement in final response:", settlementHeader);

  server.close();
  process.exit(settlementHeader === "verified" ? 0 : 1);
}

verify();
