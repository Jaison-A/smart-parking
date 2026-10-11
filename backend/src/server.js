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

  // Without this, a taken port crashes with a raw Node stack trace that doesn't
  // say what to actually do about it. This gives the real fix instead.
  httpServer.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\n[server] Port ${env.port} is already in use - another process (often a ` +
        `previous "npm run dev" left running in another terminal) is still holding it.\n` +
        `  Windows:      netstat -ano | findstr :${env.port}   then   taskkill /PID <pid> /F\n` +
        `  macOS/Linux:  lsof -i :${env.port}                  then   kill -9 <pid>\n` +
        `Or set a different PORT in backend/.env (and update VITE_API_URL in frontend/.env to match).\n`
      );
      process.exit(1);
    }
    throw err;
  });

  httpServer.listen(env.port, () => console.log(`[server] listening on :${env.port}`));
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
