import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api.js";
import { useSocket } from "../context/SocketContext.jsx";
import ZoneCanvas from "../components/ZoneCanvas.jsx";

const DETECTOR_STREAM = import.meta.env.VITE_DETECTOR_STREAM_URL;
const ROWS_COLLAPSED = 6;

// With `responseType: "blob"`, axios hands back the error body as a Blob too
// (not parsed JSON) - apiErrorMessage() can't read that directly, so unwrap it
// here before falling back to the generic message.
async function blobErrorMessage(err) {
  const blob = err?.response?.data;
  if (blob instanceof Blob) {
    try {
      const { error } = JSON.parse(await blob.text());
      if (error) return error;
    } catch { /* not JSON - fall through */ }
  }
  return apiErrorMessage(err);
}

function fmtDuration(s) {
  s = Math.round(s || 0);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function VideoDetailPage() {
  const { id } = useParams();
  const socket = useSocket();
  const [video, setVideo] = useState(null);
  const [zones, setZones] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [frameUrl, setFrameUrl] = useState(null);
  const [draftType, setDraftType] = useState("no_parking");
  const [zoneName, setZoneName] = useState("");
  const [error, setError] = useState("");
  // `busy` covers the click -> server-acknowledged round trip. `stopRequested`
  // covers the longer gap between clicking Stop and the job actually finishing
  // its current frame and shutting down - cleared only by a real
  // "job:finished"/"job:failed" event, never by a timer, so it can't lie about
  // whether it's actually done.
  const [busy, setBusy] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);

  const loadVideo = useCallback(() => {
    api.get(`/api/videos/${id}`).then((r) => setVideo(r.data.video));
  }, [id]);
  const loadZones = useCallback(() => {
    api.get("/api/zones", { params: { video: id } }).then((r) => setZones(r.data.zones));
  }, [id]);
  const loadSessions = useCallback(() => {
    api.get(`/api/videos/${id}/sessions`).then((r) => setSessions(r.data.sessions));
  }, [id]);

  useEffect(() => { loadVideo(); loadZones(); loadSessions(); }, [loadVideo, loadZones, loadSessions]);

  useEffect(() => {
    api.get(`/api/videos/${id}/frame`, { responseType: "blob" })
      .then((r) => setFrameUrl(URL.createObjectURL(r.data)))
      .catch(async (err) => setError(await blobErrorMessage(err)));
  }, [id]);

  // Live updates while a job is running - status, progress and every session change.
  useEffect(() => {
    if (!socket) return;
    const onProgress = (p) => p.videoId === id && setVideo((v) => v && { ...v, status: "running", progress: p.progress });
    const onFinished = (p) => {
      if (p.videoId !== id) return;
      setVideo((v) => v && { ...v, status: p.status, progress: 100 });
      setStopRequested(false);
    };
    const onFailed = (p) => {
      if (p.videoId !== id) return;
      setVideo((v) => v && { ...v, status: "failed", error: p.error });
      setStopRequested(false);
    };
    const onSession = (p) => {
      if (p.videoId !== id) return;
      setSessions((prev) => {
        const i = prev.findIndex((s) => s.sessionKey === p.session.sessionKey);
        if (i === -1) return [p.session, ...prev];
        const next = [...prev];
        next[i] = p.session;
        return next;
      });
    };
    socket.on("job:progress", onProgress);
    socket.on("job:finished", onFinished);
    socket.on("job:failed", onFailed);
    socket.on("session:update", onSession);
    return () => {
      socket.off("job:progress", onProgress);
      socket.off("job:finished", onFinished);
      socket.off("job:failed", onFailed);
      socket.off("session:update", onSession);
    };
  }, [socket, id]);

  const saveZone = async (points) => {
    if (!zoneName.trim()) return setError("Give the zone a name before drawing it.");
    setError("");
    try {
      await api.post("/api/zones", { name: zoneName.trim(), type: draftType, points, video: id });
      setZoneName("");
      loadZones();
    } catch (err) { setError(apiErrorMessage(err)); }
  };

  const deleteZone = async (zoneId) => {
    await api.delete(`/api/zones/${zoneId}`);
    loadZones();
  };

  const start = async () => {
    setBusy(true); setError("");
    try {
      const { data } = await api.post(`/api/videos/${id}/start`);
      setVideo(data.video); // status is now "queued" - the model is loading
    } catch (err) { setError(apiErrorMessage(err)); } finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true); setStopRequested(true); setError("");
    try {
      await api.post(`/api/videos/${id}/stop`);
    } catch (err) {
      setError(apiErrorMessage(err));
      setStopRequested(false); // the request itself failed - nothing to wait for
    } finally {
      setBusy(false);
    }
  };

  const isRunning = video && ["queued", "running"].includes(video.status);
  const active = useMemo(() => sessions.filter((s) => s.status === "active"), [sessions]);
  const history = useMemo(() => sessions.filter((s) => s.status !== "active"), [sessions]);

  if (!video) return <div className="p-4 md:p-8 text-sm text-ink/50">Loading…</div>;

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <Link to="/videos" className="text-xs text-ink/50 underline underline-offset-2">← All videos</Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mt-2 mb-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl md:text-2xl truncate">{video.originalName}</h1>
          <p className="text-sm text-ink/60 mt-1">
            Status: <span className="font-medium">{statusLabel(video, stopRequested)}</span>
            {video.error && <span className="text-signal"> · {video.error}</span>}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {isRunning ? (
            <button className="btn-danger inline-flex items-center gap-2" onClick={stop} disabled={busy || stopRequested}>
              {stopRequested && <Spinner />}
              {stopRequested ? "Stopping…" : "Stop detection"}
            </button>
          ) : (
            <button className="btn-primary inline-flex items-center gap-2" onClick={start} disabled={busy || zones.length === 0}>
              {busy && <Spinner />}
              {busy ? "Starting…" : "Start detection"}
            </button>
          )}
        </div>
      </div>

      {/* Always-visible progress bar whenever something is in flight, so a click
          never just sits there with no feedback. */}
      {(isRunning || stopRequested) && (
        <ProgressBar
          tone={stopRequested ? "amber" : "ink"}
          indeterminate={stopRequested || video.status === "queued" || video.sourceType === "stream"}
          value={video.progress}
        />
      )}
      <div className="mb-6" />

      {error && <div className="text-sm text-signal mb-4">{error}</div>}

      {/* One panel, not two: while detection is running the zone editor is locked
          and irrelevant, so the feed gets the full width. While idle, nobody
          needs a dead "feed appears once started" box - the zone editor gets
          the space instead. */}
      <div className="mb-8">
        {video.status === "running" ? (
          <>
            <h2 className="text-sm font-medium mb-2">Live feed</h2>
            <img src={`${DETECTOR_STREAM}/jobs/${video.jobId}/stream`} alt="Live annotated feed"
              className="w-full border border-line" />
          </>
        ) : video.status === "queued" ? (
          <>
            <h2 className="text-sm font-medium mb-2">Live feed</h2>
            <div className="card aspect-video flex flex-col items-center justify-center gap-3 text-sm text-ink/50 px-6 text-center">
              <Spinner size={18} />
              <span>Loading the model and opening the source…<br />this can take up to 30s the first time.</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-medium">Draw a zone</h2>
              {zones.length === 0 && <span className="text-xs text-amber">Draw at least one zone to start detection</span>}
            </div>
            {frameUrl ? (
              <>
                <div className="flex flex-col sm:flex-row gap-2 mb-2">
                  <input className="field" placeholder="Zone name (e.g. Main gate)"
                    value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
                  <select className="field sm:w-40" value={draftType} onChange={(e) => setDraftType(e.target.value)}>
                    <option value="no_parking">No parking</option>
                    <option value="parking">Parking</option>
                  </select>
                </div>
                <ZoneCanvas frameUrl={frameUrl} zones={zones} draftType={draftType} onComplete={saveZone} />
              </>
            ) : (
              <div className="card aspect-video flex items-center justify-center text-sm text-ink/40">
                Loading video frame…
              </div>
            )}
          </>
        )}
      </div>

      <div className="mb-8">
        <h2 className="text-sm font-medium mb-2">Zones ({zones.length})</h2>
        {zones.length === 0 ? (
          <p className="text-sm text-ink/50">No zones yet — draw at least one before starting detection.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {zones.map((z) => (
              <span key={z._id}
                className={`flex items-center gap-2 border px-3 py-1 text-xs ${
                  z.type === "no_parking" ? "border-signal text-signal" : "border-ok text-ok"}`}>
                {z.name}
                {!isRunning && (
                  <button onClick={() => deleteZone(z._id)} aria-label={`Delete ${z.name}`}>✕</button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <SessionTable title={`Active vehicles (${active.length})`} rows={active} />
      <div className="mt-8">
        <SessionTable title={`History (${history.length})`} rows={history} />
      </div>
    </div>
  );
}

function statusLabel(video, stopRequested) {
  if (stopRequested) return "stopping…";
  if (video.status === "queued") return "starting…";
  if (video.status === "running") return video.sourceType === "stream" ? "running · live" : `running · ${video.progress}%`;
  return video.status;
}

function Spinner({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin shrink-0" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// `indeterminate`: a sliding bar for "something is happening, no % available yet"
// (starting up, stopping, or a live camera that has no fixed length). Otherwise a
// determinate bar filled to `value` percent.
function ProgressBar({ indeterminate, value = 0, tone = "ink" }) {
  const toneClass = { ink: "bg-ink", amber: "bg-amber", signal: "bg-signal", ok: "bg-ok" }[tone];
  return (
    <div className="relative h-1.5 w-full bg-line overflow-hidden">
      {indeterminate ? (
        <div className={`animate-indeterminate ${toneClass}`} />
      ) : (
        <div className={`h-full ${toneClass} transition-[width] duration-500`} style={{ width: `${value}%` }} />
      )}
    </div>
  );
}

// Shows a manageable first slice of rows with a "Show all" toggle, rather than
// either an unbounded table or a nested scroll area fighting the page scroll.
function SessionTable({ title, rows }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, ROWS_COLLAPSED);

  return (
    <div>
      <h2 className="text-sm font-medium mb-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink/50">Nothing here yet.</p>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink/50 border-b border-line">
                <tr>
                  <th className="text-left font-normal px-4 py-2">Plate</th>
                  <th className="text-left font-normal px-4 py-2">Vehicle</th>
                  <th className="text-left font-normal px-4 py-2">Zone</th>
                  <th className="text-left font-normal px-4 py-2">Duration</th>
                  <th className="text-left font-normal px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.sessionKey} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 mono whitespace-nowrap">{s.plate || "—"}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{s.vehicleType}</td>
                    <td className="px-4 py-2">{s.zoneName}</td>
                    <td className="px-4 py-2 mono whitespace-nowrap">{fmtDuration(s.durationSeconds)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {s.isViolation ? (
                        <span className="text-signal font-medium">Violation</span>
                      ) : s.zoneType === "no_parking" ? (
                        <span className="text-amber">Watching</span>
                      ) : (
                        <span className="text-ok">Parked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > ROWS_COLLAPSED && (
            <button className="text-xs underline underline-offset-2 text-ink/60 hover:text-ink mt-2"
              onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
