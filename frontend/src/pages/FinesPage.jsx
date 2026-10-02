import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_COLOR = { issued: "text-amber", paid: "text-ok", cancelled: "text-ink/40" };

export default function FinesPage() {
  const { user } = useAuth();
  const [fines, setFines] = useState(null);
  const [status, setStatus] = useState("");

  const load = () => api.get("/api/fines", { params: status ? { status } : {} }).then((r) => setFines(r.data.fines));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async (id) => { await api.post(`/api/fines/${id}/pay`); load(); };
  const cancel = async (id) => {
    const reason = prompt("Reason for cancelling this fine (e.g. misread plate):");
    if (reason === null) return;
    await api.post(`/api/fines/${id}/cancel`, { reason });
    load();
  };

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl">Fines</h1>
          <p className="text-sm text-ink/60 mt-1">Issued automatically the moment a violation is confirmed.</p>
        </div>
        <select className="field w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="issued">Issued</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {fines === null ? (
        <div className="text-sm text-ink/50">Loading…</div>
      ) : fines.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink/50">No fines match this filter.</div>
      ) : (
        <div className="card divide-y divide-line">
          {fines.map((f) => (
            <div key={f._id} className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="mono text-base">{f.plate || "Plate not read"}</div>
                <div className="text-xs text-ink/50 mt-0.5">{f.reason}</div>
              </div>
              <div className="flex items-center gap-4">
                <span className="mono">₹{f.amount}</span>
                <span className={`text-xs font-medium ${STATUS_COLOR[f.status]}`}>{f.status}</span>
                {f.status === "issued" && (
                  <div className="flex gap-2">
                    <button className="btn-outline text-xs" onClick={() => pay(f._id)}>Mark paid</button>
                    {user?.role === "admin" && (
                      <button className="btn-outline text-xs" onClick={() => cancel(f._id)}>Cancel</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
