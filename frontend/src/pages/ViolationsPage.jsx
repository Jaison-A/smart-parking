import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSocket } from "../context/SocketContext.jsx";

const API_URL = import.meta.env.VITE_API_URL;

function fmtTime(d) {
  return d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
}
function fmtDuration(s) {
  s = Math.round(s || 0);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function img(p) {
  return p ? `${API_URL}/${p}` : null;
}

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
    const refresh = () => load(plateFilter);
    socket.on("violation:new", refresh);
    socket.on("violation:updated", refresh);
    return () => { socket.off("violation:new", refresh); socket.off("violation:updated", refresh); };
  }, [socket, plateFilter]);

  const acknowledge = async (id) => {
    await api.post(`/api/violations/${id}/acknowledge`);
    load(plateFilter);
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl">Violations</h1>
          <p className="text-sm text-ink/60 mt-1">
            Every confirmed no-parking violation, newest first. Duration and fine are provisional
            until the vehicle leaves, then finalized automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <input className="field w-full md:w-48" placeholder="Filter by plate"
            value={plateFilter} onChange={(e) => setPlateFilter(e.target.value)} />
          <button className="btn-outline shrink-0" onClick={() => load(plateFilter)}>Search</button>
        </div>
      </div>

      {violations === null ? (
        <div className="text-sm text-ink/50">Loading…</div>
      ) : violations.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink/50">No violations recorded yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {violations.map((v) => (
            <div key={v._id} className="card overflow-hidden">
              <div className="grid grid-cols-3">
                <EvidencePhoto src={img(v.entrySnapshotPath)} label="Parked at" time={fmtTime(v.startedAt)} />
                <EvidencePhoto src={img(v.snapshotPath)} label="Violation confirmed" accent />
                <EvidencePhoto src={img(v.exitSnapshotPath)} label="Left at" time={fmtTime(v.endedAt)} />
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <span className="mono text-lg">{v.plate || "Plate not read"}</span>
                  {v.fine && (
                    <span className="text-xs font-medium border border-signal text-signal px-2 py-0.5">
                      ₹{v.fine.amount} · {v.fine.status}
                    </span>
                  )}
                </div>
                <div className="text-sm text-ink/60 mt-1">{v.zoneName} · {v.vehicleType}</div>
                <div className="text-sm mt-1">
                  <span className="mono">{fmtDuration(v.durationSeconds)}</span> total
                  {!v.finalized && <span className="text-amber"> · still parked (estimate)</span>}
                </div>
                <div className="text-xs text-ink/40 mt-1">
                  {new Date(v.startedAt).toLocaleDateString()} · from {fmtTime(v.startedAt)} to {fmtTime(v.endedAt)}
                </div>
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

function EvidencePhoto({ src, label, time, accent }) {
  return (
    <div className={`relative aspect-video border-r border-line last:border-r-0 ${accent ? "border-t-2 border-t-signal" : ""}`}>
      {src ? (
        <img src={src} alt={label} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-ink/5 text-[10px] text-ink/30">
          No photo
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-ink/70 text-paper text-[10px] px-1.5 py-0.5">
        {label}{time ? ` · ${time}` : ""}
      </div>
    </div>
  );
}
