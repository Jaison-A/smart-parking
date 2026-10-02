// Thin wrapper so routes/services never touch `io` directly - keeps Socket.IO
// swappable (e.g. for a push-notification service) without touching business logic.
let io = null;

export function attachIO(socketIoInstance) {
  io = socketIoInstance;
}

export function notifyControllers(event, payload) {
  if (io) io.to("controllers").emit(event, payload);
}
