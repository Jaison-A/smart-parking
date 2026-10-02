import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { attachIO } from "../services/notifier.js";

// Controllers join a shared room so `notifyControllers` can broadcast to all
// of them at once (multiple staff can watch the same dashboard).
export function initSockets(httpServer) {
  const io = new Server(httpServer, { cors: { origin: env.frontendUrl } });

  io.use((socket, next) => {
    try {
      socket.data.user = jwt.verify(socket.handshake.auth?.token || "", env.jwtSecret);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.join("controllers");
    socket.on("disconnect", () => {});
  });

  attachIO(io);
  return io;
}
