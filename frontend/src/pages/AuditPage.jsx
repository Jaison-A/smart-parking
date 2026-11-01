import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../lib/api.js";

const GROUPS = [
  ["", "Everything"], ["settings", "Settings"], ["fine", "Fines"],
  ["zone", "Zones"], ["owner", "Owners"], ["test-data", "Test data"], ["video", "Videos"],
];

const show = (v) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default function AuditPage() {
  const [entries, setEntries] = useState(null);
  const [group, setGroup] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setEntries(null);
    api.get("/api/audit", { params: { limit: 200, ...(group && { action: group }) } })
      .then(({ data }) => setEntries(data.entries))
      .catch((err) => setError(apiErrorMessage(err)));
  }, [group]);

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl">Audit log</h1>
          <p className="text-sm text-ink/60 mt-1">Who changed a setting, fine, zone or owner, what changed, and when. Newest first.</p>
        </div>
        <select className="field w-full md:w-44" value={group} onChange={(e) => setGroup(e.target.value)}>
          {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {error && <div className="text-sm text-signal mb-4">{error}</div>}
      {entries === null ? (
        <div className="text-sm text-ink/50">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink/50">Nothing recorded yet.</div>
      ) : (
        <div className="card divide-y divide-line">
          {entries.map((e) => (
            <div key={e._id} className="px-5 py-3 text-sm">
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                <div>
                  <span className="mono text-xs border border-line px-1.5 py-0.5 mr-2">{e.action}</span>
                  <span className="font-medium">{e.target?.label || "—"}</span>
                </div>
                <div className="text-xs text-ink/50">{new Date(e.createdAt).toLocaleString()}</div>
              </div>
              <div className="text-xs text-ink/60 mt-1">by {e.actorName || "unknown"} ({e.actorRole || "—"})</div>
              {e.changes?.length > 0 && (
                <ul className="mt-2 text-xs space-y-0.5">
                  {e.changes.map((c) => (
                    <li key={c.field}>
                      <span className="text-ink/60">{c.field}:</span>{" "}
                      <span className="mono">{show(c.from)}</span> → <span className="mono font-medium">{show(c.to)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {e.note && <div className="text-xs text-ink/60 mt-1 italic">{e.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
