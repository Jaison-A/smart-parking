import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiErrorMessage } from "../lib/api.js";
import { useSocket } from "../context/SocketContext.jsx";
import ImageModal from "../components/ImageModal.jsx";

const API_URL = import.meta.env.VITE_API_URL;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone; // so days match the viewer's clock

function fmtTime(d) {
  return d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
}
function fmtDuration(s) {
  s = Math.round(s || 0);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
const img = (p) => (p ? `${API_URL}/${p}` : null);
// "2026-10-03" -> local Date without UTC shifting
const parseDay = (d) => new Date(`${d}T12:00:00`);
const fmtDay = (d) => parseDay(d).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtMonth = (m) => parseDay(`${m}-01`).toLocaleDateString([], { month: "long", year: "numeric" });
const todayStr = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/**
 * mode="all"   -> every day, newest first, with day tiles to narrow down (default)
 * mode="today" -> only the current day, loaded from GET /api/violations/by-date/:today
 */
export default function ViolationsPage({ mode = "all" }) {
  const isToday = mode === "today";
  const [days, setDays] = useState(null); // [{date, count, violations}]
  const [selected, setSelected] = useState(null); // null = all days
  const [plateFilter, setPlateFilter] = useState("");
  const [month, setMonth] = useState("");
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState("");
  const socket = useSocket();

  const load = useCallback(async () => {
    try {
      setError("");
      const plate = plateFilter ? { plate: plateFilter } : {};
      if (isToday) {
        const date = todayStr();
        const { data } = await api.get(`/api/violations/by-date/${date}`, { params: { tz: TZ, ...plate } });
        setDays([{ date, count: data.count, violations: data.violations }]);
      } else {
        const { data } = await api.get("/api/violations/grouped", {
          params: { tz: TZ, ...plate, ...(month && { month }) },
        });
        setDays(data.days);
        setSelected((cur) => (data.days.some((d) => d.date === cur) ? cur : null));
      }
    } catch (err) { setError(apiErrorMessage(err)); }
  }, [isToday, plateFilter, month]);

  useEffect(() => { setDays(null); load(); }, [load]);

  useEffect(() => {
    if (!socket) return;
    socket.on("violation:new", load);
    socket.on("violation:updated", load);
    return () => { socket.off("violation:new", load); socket.off("violation:updated", load); };
  }, [socket, load]);

  const acknowledge = async (id) => {
    await api.post(`/api/violations/${id}/acknowledge`);
    load();
  };

  const visibleDays = useMemo(
    () => (days || []).filter((d) => !selected || d.date === selected),
    [days, selected]
  );
  const byMonth = useMemo(() => {
    const groups = new Map();
    (days || []).forEach((d) => {
      const m = d.date.slice(0, 7);
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m).push(d);
    });
    return [...groups.entries()];
  }, [days]);

  const total = (days || []).reduce((n, d) => n + d.count, 0);

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl">{isToday ? "Today's violations" : "Violations"}</h1>
          <p className="text-sm text-ink/60 mt-1">
            {isToday
              ? `${fmtDay(todayStr())} · ${total} violation${total === 1 ? "" : "s"} so far. Updates live.`
              : "Every violation, grouped by day. Duration and fine are provisional until the vehicle leaves, then finalized automatically."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isToday && (
            <input type="month" className="field w-full sm:w-40" value={month}
              onChange={(e) => setMonth(e.target.value)} aria-label="Filter by month" />
          )}
          <input className="field w-full sm:w-40" placeholder="Filter by plate"
            value={plateFilter} onChange={(e) => setPlateFilter(e.target.value)} />
          {(month || plateFilter) && (
            <button className="btn-outline" onClick={() => { setMonth(""); setPlateFilter(""); }}>Clear</button>
          )}
        </div>
      </div>

      {error && <div className="text-sm text-signal mb-4">{error}</div>}

      {days === null ? (
        <div className="text-sm text-ink/50">Loading…</div>
      ) : total === 0 ? (
        <div className="card p-8 text-center text-sm text-ink/50">
          {isToday ? "No violations recorded today." : "No violations recorded for this filter."}
        </div>
      ) : (
        <>
          {/* Day tiles: narrow the list to one day (hidden on the Today page) */}
          {!isToday && (
            <div className="space-y-4 mb-8">
              <button onClick={() => setSelected(null)}
                className={`border px-3 py-1.5 text-sm transition-colors ${
                  !selected ? "border-ink bg-ink text-paper" : "border-line bg-white hover:border-ink"}`}>
                All days · {total}
              </button>
              {byMonth.map(([m, list]) => (
                <div key={m}>
                  <h2 className="text-xs uppercase tracking-wide text-ink/50 mb-2">{fmtMonth(m)}</h2>
                  <div className="flex flex-wrap gap-2">
                    {list.map((d) => (
                      <button key={d.date} onClick={() => setSelected(d.date)}
                        className={`border px-3 py-2 text-left text-sm transition-colors ${
                          selected === d.date ? "border-ink bg-ink text-paper" : "border-line bg-white hover:border-ink"}`}>
                        <div className="font-medium">{parseDay(d.date).toLocaleDateString([], { day: "numeric", month: "short" })}</div>
                        <div className={`text-xs ${selected === d.date ? "text-paper/70" : "text-ink/50"}`}>
                          {d.count} violation{d.count === 1 ? "" : "s"}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-10">
            {visibleDays.map((d) => (
              <section key={d.date}>
                {!isToday && (
                  <h2 className="text-sm font-medium mb-3">
                    {fmtDay(d.date)} <span className="text-ink/40 font-normal">· {d.count}</span>
                  </h2>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {d.violations.map((v) => (
                    <ViolationCard key={v._id} v={v} onPhoto={setPhoto} onAcknowledge={acknowledge} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      <ImageModal src={photo} onClose={() => setPhoto(null)} />
    </div>
  );
}

function ViolationCard({ v, onPhoto, onAcknowledge }) {
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-3">
        <EvidencePhoto src={img(v.entrySnapshotPath)} label="Parked at" time={fmtTime(v.startedAt)} onOpen={onPhoto} />
        <EvidencePhoto src={img(v.snapshotPath)} label="Violation confirmed" accent onOpen={onPhoto} />
        <EvidencePhoto src={img(v.exitSnapshotPath)} label="Left at" time={fmtTime(v.endedAt)} onOpen={onPhoto} />
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
        <div className="text-xs text-ink/40 mt-1">from {fmtTime(v.startedAt)} to {fmtTime(v.endedAt)}</div>
        {!v.acknowledged && (
          <button className="btn-outline mt-3 text-xs" onClick={() => onAcknowledge(v._id)}>Acknowledge</button>
        )}
      </div>
    </div>
  );
}

function EvidencePhoto({ src, label, time, accent, onOpen }) {
  return (
    <div className={`relative aspect-video border-r border-line last:border-r-0 ${accent ? "border-t-2 border-t-signal" : ""}`}>
      {src ? (
        <img src={src} alt={label} onClick={() => onOpen(src)} title="Click to enlarge"
          className="w-full h-full object-cover cursor-zoom-in hover:opacity-85" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-ink/5 text-[10px] text-ink/30">No photo</div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-ink/70 text-paper text-[10px] px-1.5 py-0.5 pointer-events-none">
        {label}{time ? ` · ${time}` : ""}
      </div>
    </div>
  );
}
