import { useCallback, useEffect, useState } from "react";
import { api, apiErrorMessage } from "../lib/api.js";

const EMPTY = { name: "", phone: "", plates: "", sms: true, whatsapp: false, consentGiven: false, consentNote: "" };

const STATUS_STYLE = {
  sent: "text-ok", mock: "text-amber", failed: "text-signal", skipped: "text-ink/50",
};
const STATUS_LABEL = { sent: "sent", mock: "demo (not sent)", failed: "failed", skipped: "skipped" };

export default function OwnersPage() {
  const [owners, setOwners] = useState(null);
  const [log, setLog] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.get("/api/owners", { params: q ? { q } : {} }).then(({ data }) => setOwners(data.owners)).catch((e) => setError(apiErrorMessage(e)));
    api.get("/api/notifications", { params: { limit: 50 } }).then(({ data }) => setLog(data.notifications)).catch(() => {});
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const reset = () => { setForm(EMPTY); setEditingId(null); setError(""); };

  const edit = (o) => {
    setEditingId(o._id);
    setForm({ name: o.name, phone: o.phone, plates: o.plates.join(", "), sms: o.channels?.sms !== false,
      whatsapp: !!o.channels?.whatsapp, consentGiven: true, consentNote: o.consent?.note || "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError("");
    const body = {
      name: form.name, phone: form.phone, plates: form.plates,
      channels: { sms: form.sms, whatsapp: form.whatsapp }, consentNote: form.consentNote,
    };
    try {
      if (editingId) await api.put(`/api/owners/${editingId}`, body);
      else await api.post("/api/owners", { ...body, consentGiven: form.consentGiven });
      reset(); load();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (o) => {
    if (!window.confirm(`Delete ${o.name}? Their phone number and plates are removed permanently.`)) return;
    try { await api.delete(`/api/owners/${o._id}`); if (editingId === o._id) reset(); load(); }
    catch (err) { setError(apiErrorMessage(err)); }
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <h1 className="font-display text-2xl">Owners</h1>
      <p className="text-sm text-ink/60 mt-1 mb-6">
        Residents and staff who have agreed to be told about parking fines. Owners are added here with their
        consent - nothing is looked up from government records. When a fine is issued for a registered plate,
        the owner is messaged.
      </p>
      <div className="border border-amber text-sm px-4 py-3 mb-6">
        <span className="font-medium text-amber">Demo sender.</span> Until a real SMS / WhatsApp provider is
        configured, messages are only recorded in the log below - nothing is actually sent.
      </div>

      <form onSubmit={submit} className="card p-5 space-y-4 mb-8">
        <h2 className="font-medium">{editingId ? "Edit owner" : "Register an owner"}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name"><input className="field" value={form.name} onChange={set("name")} required /></Field>
          <Field label="Mobile number" hint="With or without the country code."><input className="field" value={form.phone} onChange={set("phone")} placeholder="98765 43210" required /></Field>
        </div>
        <Field label="Number plate(s)" hint="Separate several with commas. A plate can belong to one owner only.">
          <input className="field mono" value={form.plates} onChange={set("plates")} placeholder="TN09AB1234, TN10CD5678" required />
        </Field>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.sms} onChange={set("sms")} /> SMS</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.whatsapp} onChange={set("whatsapp")} /> WhatsApp</label>
        </div>
        <Field label="How consent was given (optional)" hint='For your records, e.g. "signed form, 20 Oct 2026".'>
          <input className="field" value={form.consentNote} onChange={set("consentNote")} maxLength={300} />
        </Field>
        {!editingId && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={form.consentGiven} onChange={set("consentGiven")} required />
            <span>This person has agreed to be contacted about parking violations and fines on this number.</span>
          </label>
        )}
        {error && <div className="text-sm text-signal">{error}</div>}
        <div className="flex gap-3">
          <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Register owner"}</button>
          {editingId && <button type="button" className="btn-outline" onClick={reset}>Cancel</button>}
        </div>
      </form>

      <div className="flex items-end justify-between gap-3 mb-3">
        <h2 className="font-medium">Registered owners {owners && `(${owners.length})`}</h2>
        <input className="field w-48" placeholder="Search name, plate, phone" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {owners === null ? <div className="text-sm text-ink/50">Loading…</div>
        : owners.length === 0 ? <div className="card p-6 text-center text-sm text-ink/50">No owners registered yet.</div>
        : (
          <div className="card divide-y divide-line mb-10">
            {owners.map((o) => (
              <div key={o._id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{o.name} <span className="font-normal text-ink/50 mono">{o.phone}</span></div>
                  <div className="mono text-xs mt-0.5">{o.plates.join("  ")}</div>
                  <div className="text-xs text-ink/50 mt-0.5">
                    {[o.channels?.sms !== false && "SMS", o.channels?.whatsapp && "WhatsApp"].filter(Boolean).join(" + ")}
                    {" · consent "}{new Date(o.consent?.at).toLocaleDateString()}{o.consent?.note ? ` (${o.consent.note})` : ""}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="btn-outline text-xs" onClick={() => edit(o)}>Edit</button>
                  <button className="btn-outline text-xs" onClick={() => remove(o)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

      <h2 className="font-medium mb-3">Message log</h2>
      {log.length === 0 ? <div className="card p-6 text-center text-sm text-ink/50">No messages yet.</div> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink/50 border-b border-line">
              <tr>{["When", "Plate", "To", "Channel", "Result"].map((h) => <th key={h} className="text-left font-normal px-4 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {log.map((n) => (
                <tr key={n._id} className="border-b border-line last:border-0" title={n.body || ""}>
                  <td className="px-4 py-2 whitespace-nowrap">{new Date(n.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2 mono">{n.plate || "—"}</td>
                  <td className="px-4 py-2 mono text-xs">{n.to || "—"}</td>
                  <td className="px-4 py-2">{n.channel === "none" ? "—" : n.channel}</td>
                  <td className={`px-4 py-2 ${STATUS_STYLE[n.status]}`}>
                    {STATUS_LABEL[n.status]}{n.error ? ` - ${n.error}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
