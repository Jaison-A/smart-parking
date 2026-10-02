import { createServer } from "node:http";
import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";
import { initSockets } from "./sockets/index.js";
import { env } from "./config/env.js";

async function main() {
  await connectDB();
  const app = createApp();
  const httpServer = createServer(app);
  initSockets(httpServer);
  httpServer.listen(env.port, () => console.log(`[server] listening on :${env.port}`));
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
