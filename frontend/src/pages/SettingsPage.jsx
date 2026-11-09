import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";

// Same arithmetic as the backend (services/fineMath.js), used only for the live preview.
// The backend is the source of truth for the amount actually charged.
function previewFine(minutesOver, s) {
  const unitSeconds = s.rateUnit === "hour" ? 3600 : 60;
  const units = (minutesOver * 60) / unitSeconds;
  const billed = s.roundUp ? Math.ceil(units) : units;
  return Math.round(Number(s.baseAmount) + billed * Number(s.rate));
}

const EXAMPLES = [15, 61, 150];
const fmtMins = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim());

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [form, setForm] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ kind: "", text: "" });
  const [testData, setTestData] = useState(null);   // what a one-click delete would remove
  const [cleaning, setCleaning] = useState(false);
  const [cleanMessage, setCleanMessage] = useState({ kind: "", text: "" });

  const loadTestData = () =>
    api.get("/api/test-data/summary").then(({ data }) => setTestData(data.summary)).catch(() => {});

  useEffect(() => { if (isAdmin) loadTestData(); }, [isAdmin]);

  useEffect(() => {
    api.get("/api/settings")
      .then(({ data }) => { setForm(data.settings); setUpdatedAt(data.updatedAt); })
      .catch((err) => setMessage({ kind: "error", text: apiErrorMessage(err) }));
  }, []);

  const set = (key) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: v }));
    setMessage({ kind: "", text: "" });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ kind: "", text: "" });
    try {
      const { data } = await api.put("/api/settings", form);
      setForm(data.settings);
      setUpdatedAt(new Date().toISOString());
      setMessage({ kind: "ok", text: "Saved. The new rates apply to fines issued from now on." });
    } catch (err) {
      setMessage({ kind: "error", text: apiErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const deleteTestData = async () => {
    const t = testData;
    const ok = window.confirm(
      `Delete ALL test data?\n\n${t.videos} video(s), ${t.violations} violation(s), ${t.fines} fine(s), ` +
      `${t.sessions} session(s) and their photos.\n\nThis cannot be undone.`
    );
    if (!ok) return;
    setCleaning(true);
    setCleanMessage({ kind: "", text: "" });
    try {
      const { data } = await api.delete("/api/test-data");
      const r = data.removed;
      setCleanMessage({ kind: "ok", text: `Deleted ${r.videos} video(s), ${r.violations} violation(s), ${r.fines} fine(s) and ${r.filesRemoved} file(s).` });
      loadTestData();
    } catch (err) {
      setCleanMessage({ kind: "error", text: apiErrorMessage(err) });
    } finally {
      setCleaning(false);
    }
  };

  if (!form) return <div className="p-4 md:p-8 text-sm text-ink/50">{message.text || "Loading…"}</div>;

  const unit = form.rateUnit;
  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <h1 className="font-display text-2xl">Settings</h1>
      <p className="text-sm text-ink/60 mt-1 mb-6">
        Fine rates. Changes apply to fines issued from now on - fines already issued keep the
        rates they were issued with, so the amount a driver was shown never changes.
      </p>
      {!isAdmin && (
        <div className="border border-amber text-sm px-4 py-3 mb-6">Only an admin can change these settings.</div>
      )}

      <form onSubmit={save} className="card p-5 space-y-5">
        <Field label="Base fine (₹)" hint="Charged as soon as a vehicle overstays the free limit.">
          <input type="number" min="0" step="1" className="field" value={form.baseAmount}
            onChange={set("baseAmount")} disabled={!isAdmin} required />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={`Extra charge (₹ per ${unit})`} hint="Added for the time over the free limit.">
            <input type="number" min="0" step="any" className="field" value={form.rate}
              onChange={set("rate")} disabled={!isAdmin} required />
          </Field>
          <Field label="Charged per" hint="Minute or hour.">
            <select className="field" value={form.rateUnit} onChange={set("rateUnit")} disabled={!isAdmin}>
              <option value="minute">Minute</option>
              <option value="hour">Hour</option>
            </select>
          </Field>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={form.roundUp} onChange={set("roundUp")} disabled={!isAdmin} />
          <span>
            Charge a part {unit} as a full {unit}
            <span className="block text-xs text-ink/50">
              On: 61 minutes at ₹60/hour is billed as 2 hours. Off: charged for the exact time, so
              ₹1/minute and ₹60/hour give the same amount.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={form.bayRulesEnabled !== false}
            onChange={set("bayRulesEnabled")} disabled={!isAdmin} />
          <span>
            Check parking bays
            <span className="block text-xs text-ink/50">
              Off: bays stay drawn on the feed, but vehicles are not allocated to them and no
              "outside bay" or "bay occupied" violations are raised. Applies the next time detection starts.
            </span>
          </span>
        </label>

        <Field label="Fine for spacing / bay violations (₹)" hint="A flat amount - these have no time over the limit.">
          <input type="number" min="0" step="1" className="field" value={form.ruleAmount}
            onChange={set("ruleAmount")} disabled={!isAdmin} required />
        </Field>

        {/* Live preview so an admin can see what a setting actually does before saving */}
        <div className="border border-line bg-ink/[0.03] p-4 text-sm">
          <div className="font-medium mb-2">What this charges</div>
          <table className="w-full">
            <tbody>
              {EXAMPLES.map((m) => (
                <tr key={m}>
                  <td className="text-ink/60 py-0.5">Parked {fmtMins(m)} over the limit</td>
                  <td className="mono text-right">₹{previewFine(m, form)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {message.text && (
          <div className={`text-sm ${message.kind === "ok" ? "text-ok" : "text-signal"}`}>{message.text}</div>
        )}
        <div className="flex items-center gap-4">
          {isAdmin && <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>}
          {updatedAt && <span className="text-xs text-ink/40">Last saved {new Date(updatedAt).toLocaleString()}</span>}
        </div>
      </form>

      {isAdmin && (
        <div className="card p-5 mt-6">
          <h2 className="font-medium">Test data</h2>
          <p className="text-xs text-ink/50 mt-1 mb-3">
            Records from test images, and from any video you have marked as a test, are kept apart
            from real ones. Delete them all in one go when you have finished testing.
          </p>
          {testData ? (
            <div className="text-sm mb-3">
              {testData.videos} video(s) · {testData.violations} violation(s) · {testData.fines} fine(s) · {testData.sessions} session(s)
              {testData.running.length > 0 && (
                <div className="text-amber mt-1">Still running: {testData.running.join(", ")} - stop detection before deleting.</div>
              )}
            </div>
          ) : <div className="text-sm text-ink/50 mb-3">Loading…</div>}
          {cleanMessage.text && (
            <div className={`text-sm mb-3 ${cleanMessage.kind === "ok" ? "text-ok" : "text-signal"}`}>{cleanMessage.text}</div>
          )}
          <button className="btn-danger" onClick={deleteTestData}
            disabled={cleaning || !testData || testData.videos === 0 || testData.running.length > 0}>
            {cleaning ? "Deleting…" : "Delete all test data"}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && <div className="text-xs text-ink/50 mt-1">{hint}</div>}
    </div>
  );
}
