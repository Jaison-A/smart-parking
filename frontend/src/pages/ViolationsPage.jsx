import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSocket } from "../context/SocketContext.jsx";

const API_URL = import.meta.env.VITE_API_URL;

export default function ViolationsPage() {
  const [violations, setViolations] = useState(null);
  const [plateFilter, setPlateFilter] = useState("");
  const socket = useSocket();

  const load = (plate) => {
    api.get("/api/violations", { params: plate ? { plate } : {} }).then((r) => setViolations(r.data.violations));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!socket) return;
    const onNew = () => load(plateFilter);
    socket.on("violation:new", onNew);
    return () => socket.off("violation:new", onNew);
  }, [socket, plateFilter]);

  const acknowledge = async (id) => {
    await api.post(`/api/violations/${id}/acknowledge`);
    load(plateFilter);
  };

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl">Violations</h1>
          <p className="text-sm text-ink/60 mt-1">Every confirmed no-parking violation, newest first.</p>
        </div>
        <div className="flex gap-2">
          <input className="field w-48" placeholder="Filter by plate"
            value={plateFilter} onChange={(e) => setPlateFilter(e.target.value)} />
          <button className="btn-outline" onClick={() => load(plateFilter)}>Search</button>
        </div>
      </div>

      {violations === null ? (
        <div className="text-sm text-ink/50">Loading…</div>
      ) : violations.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink/50">No violations recorded yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {violations.map((v) => (
            <div key={v._id} className="card overflow-hidden">
              {v.snapshotPath && (
                <img src={`${API_URL}/${v.snapshotPath}`} alt="Violation snapshot" className="w-full aspect-video object-cover" />
              )}
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <span className="mono text-lg">{v.plate || "Plate not read"}</span>
                  {v.fine && <span className="text-xs font-medium border border-signal text-signal px-2 py-0.5">₹{v.fine.amount} · {v.fine.status}</span>}
                </div>
                <div className="text-sm text-ink/60 mt-1">
                  {v.zoneName} · {v.vehicleType} · parked {Math.round(v.durationSeconds)}s
                </div>
                <div className="text-xs text-ink/40 mt-1">{new Date(v.createdAt).toLocaleString()}</div>
                {!v.acknowledged && (
                  <button className="btn-outline mt-3 text-xs" onClick={() => acknowledge(v._id)}>
                    Acknowledge
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
