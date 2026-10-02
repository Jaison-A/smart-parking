import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { apiErrorMessage } from "../lib/api.js";

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
      navigate("/videos");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="font-display text-3xl">Curbside</div>
          <div className="text-sm text-ink/50 mt-1">Parking enforcement control room</div>
        </div>
        <form onSubmit={onSubmit} className="card p-6 space-y-4">
          <div className="flex text-sm border border-line">
            <button type="button" onClick={() => setMode("login")}
              className={`flex-1 py-2 ${mode === "login" ? "bg-ink text-paper" : ""}`}>
              Sign in
            </button>
            <button type="button" onClick={() => setMode("register")}
              className={`flex-1 py-2 ${mode === "register" ? "bg-ink text-paper" : ""}`}>
              Register
            </button>
          </div>
          {mode === "register" && (
            <div>
              <label className="text-xs text-ink/60">Full name</label>
              <input className="field mt-1" name="name" value={form.name} onChange={onChange} required />
            </div>
          )}
          <div>
            <label className="text-xs text-ink/60">Email</label>
            <input className="field mt-1" type="email" name="email" value={form.email} onChange={onChange} required />
          </div>
          <div>
            <label className="text-xs text-ink/60">Password</label>
            <input className="field mt-1" type="password" name="password" value={form.password} onChange={onChange} required minLength={6} />
          </div>
          {error && <div className="text-sm text-signal">{error}</div>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
          {mode === "register" && (
            <p className="text-xs text-ink/50">First account created becomes an admin automatically.</p>
          )}
        </form>
      </div>
    </div>
  );
}
