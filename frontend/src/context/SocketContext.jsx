import { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext.jsx";

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!token) return;
    // websocket-only (no long-polling fallback): for this stack - a local or
    // single-origin deployment with no corporate proxy in the way - polling's
    // handshake/upgrade dance is pure fragility. It's what was behind the
    // repeated "session ID unknown" reconnect loop: once the backend restarts
    // (nodemon picking up an unrelated file write, see nodemon.json) a
    // half-upgraded polling session can get stuck retrying a session that no
    // longer exists. Websocket-only means a restart just drops the connection
    // cleanly and reconnects fresh.
    const s = io(import.meta.env.VITE_API_URL, {
      auth: { token },
      transports: ["websocket"],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    // Expected and harmless whenever the backend restarts - logging it at full
    // volume (the default) just buries real errors. One quiet line is enough.
    s.on("connect_error", (err) => console.debug("[socket] connect_error:", err.message));
    setSocket(s);
    return () => s.disconnect();
  }, [token]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
// Lets the UI show a small "reconnecting…" indicator instead of silently
// going stale when the backend restarts.
export function useSocketConnected() {
  const socket = useSocket();
  const [connected, setConnected] = useState(socket?.connected ?? false);
  useEffect(() => {
    if (!socket) return;
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on("connect", on);
    socket.on("disconnect", off);
    setConnected(socket.connected);
    return () => { socket.off("connect", on); socket.off("disconnect", off); };
  }, [socket]);
  return connected;
}
