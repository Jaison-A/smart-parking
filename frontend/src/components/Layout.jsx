import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useSocket, useSocketConnected } from "../context/SocketContext.jsx";
import ViolationToast from "./ViolationToast.jsx";

const nav = [
  { to: "/videos", label: "Videos" },
  { to: "/violations", label: "Violations" },
  { to: "/fines", label: "Fines" },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const socket = useSocket();
  const connected = useSocketConnected();
  const navigate = useNavigate();
  const location = useLocation();
  const [toasts, setToasts] = useState([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  // Close the mobile drawer automatically on navigation.
  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Mobile top bar - sidebar replacement below the md breakpoint */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-line">
        <div className="font-display text-lg leading-none">Curbside</div>
        <button
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-label="Toggle menu"
          className="w-8 h-8 flex flex-col items-center justify-center gap-1.5"
        >
          <span className="w-5 h-px bg-ink" />
          <span className="w-5 h-px bg-ink" />
          <span className="w-5 h-px bg-ink" />
        </button>
      </div>

      <SidebarContent
        user={user} logout={logout} navigate={navigate} connected={connected}
        className="hidden md:flex md:w-56 md:shrink-0 md:border-r md:border-line md:flex-col
                   md:sticky md:top-0 md:h-screen md:overflow-y-auto"
      />

      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-ink/40" onClick={() => setMobileNavOpen(false)}>
          <div className="absolute inset-y-0 left-0 w-64 bg-paper" onClick={(e) => e.stopPropagation()}>
            <SidebarContent user={user} logout={logout} navigate={navigate} connected={connected} className="flex flex-col h-full" />
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0">{children}</main>

      <div className="fixed bottom-4 right-4 left-4 md:left-auto flex flex-col gap-2 z-50 md:w-80">
        {toasts.map((t) => (
          <ViolationToast key={t.id} violation={t.violation} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </div>
  );
}

function SidebarContent({ user, logout, navigate, connected, className }) {
  return (
    <aside className={className}>
      <div className="px-5 py-6 border-b border-line hidden md:block">
        <div className="font-display text-xl leading-none">Curbside</div>
        <div className="text-xs text-ink/50 mt-1 flex items-center gap-1.5">
          Parking enforcement
          <span
            title={connected ? "Live updates connected" : "Reconnecting…"}
            className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? "bg-ok" : "bg-amber animate-pulse"}`}
          />
        </div>
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
  );
}
