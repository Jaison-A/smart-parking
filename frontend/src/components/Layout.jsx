import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useSocket } from "../context/SocketContext.jsx";
import ViolationToast from "./ViolationToast.jsx";

const nav = [
  { to: "/videos", label: "Videos" },
  { to: "/violations", label: "Violations" },
  { to: "/fines", label: "Fines" },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();
  const [toasts, setToasts] = useState([]);

  // Immediate controller notification, per the project's core requirement:
  // a violation anywhere pushes a toast here without a page refresh.
  useEffect(() => {
    if (!socket) return;
    const onViolation = ({ violation }) => {
      setToasts((t) => [...t, { id: violation._id, violation }]);
    };
    socket.on("violation:new", onViolation);
    return () => socket.off("violation:new", onViolation);
  }, [socket]);

  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-line flex flex-col">
        <div className="px-5 py-6 border-b border-line">
          <div className="font-display text-xl leading-none">Curbside</div>
          <div className="text-xs text-ink/50 mt-1">Parking enforcement</div>
        </div>
        <nav className="flex-1 py-4">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block px-5 py-2.5 text-sm border-l-2 ${
                  isActive ? "border-ink font-medium" : "border-transparent text-ink/60 hover:text-ink"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-line text-xs">
          <div className="font-medium">{user?.name}</div>
          <div className="text-ink/50 mb-2">{user?.role}</div>
          <button className="underline underline-offset-2" onClick={() => { logout(); navigate("/login"); }}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 w-80">
        {toasts.map((t) => (
          <ViolationToast key={t.id} violation={t.violation} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </div>
  );
}
