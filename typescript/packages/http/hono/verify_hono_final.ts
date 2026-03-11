import { Hono } from "hono";
import { serve } from "@hono/node-server";

async function verify() {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    
    const mode = c.req.query("mode");
    let res = c.res;
    
    console.log(`\n--- Mode: ${mode} ---`);
    
    try {
      // 模拟逻辑：结算前清空，准备后续重新赋值
      c.res = undefined;
      
      if (mode === "settle_fail_with_error") {
        // 模拟 processSettlement 内部抛出异常
        throw new Error("Facilitator timeout");
      }
      
      // ... 正常逻辑
    } catch (e) {
      console.log("Caught expected error: " + (e as Error).message);
      // 关键：此时如果直接 new 一个响应返回，就会丢失 header
      res = c.json({ error: (e as Error).message }, 402);
    }
    
    c.res = res;
  });

  app.get("/test", (c) => c.json({ ok: true }));

  const server = serve({ fetch: app.fetch, port: 9999 });

  // 验证方式 3: 模拟失败
  console.log("\n--- Mode: settle_fail_with_error ---");
  const res3 = await fetch("http://localhost:9999/test?mode=settle_fail_with_error");
  console.log("Status:", res3.status);
  console.log("X-Response-Header:", res3.headers.get("X-Response-Header"));
  console.log("Body:", await res3.json());

  server.close();
  process.exit();
}

verify();
