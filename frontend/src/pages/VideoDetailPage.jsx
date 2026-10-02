import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api.js";
import { useSocket } from "../context/SocketContext.jsx";
import ZoneCanvas from "../components/ZoneCanvas.jsx";

const DETECTOR_STREAM = import.meta.env.VITE_DETECTOR_STREAM_URL;

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
  const [busy, setBusy] = useState(false);

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
      .catch(() => {}); // fine before a video has a readable frame yet
  }, [id]);

  // Live updates while a job is running - status, progress and every session change.
  useEffect(() => {
    if (!socket) return;
    const onProgress = (p) => p.videoId === id && setVideo((v) => v && { ...v, status: "running", progress: p.progress });
    const onFinished = (p) => p.videoId === id && setVideo((v) => v && { ...v, status: p.status, progress: 100 });
    const onFailed = (p) => p.videoId === id && setVideo((v) => v && { ...v, status: "failed", error: p.error });
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
      setVideo(data.video);
    } catch (err) { setError(apiErrorMessage(err)); } finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true);
    try { await api.post(`/api/videos/${id}/stop`); } finally { setBusy(false); }
  };

  const isRunning = video && ["queued", "running"].includes(video.status);
  const active = useMemo(() => sessions.filter((s) => s.status === "active"), [sessions]);
  const history = useMemo(() => sessions.filter((s) => s.status !== "active"), [sessions]);

  if (!video) return <div className="p-8 text-sm text-ink/50">Loading…</div>;

  return (
    <div className="p-8 max-w-6xl">
      <Link to="/videos" className="text-xs text-ink/50 underline underline-offset-2">← All videos</Link>
      <div className="flex items-start justify-between mt-2 mb-6">
        <div>
          <h1 className="font-display text-2xl">{video.originalName}</h1>
          <p className="text-sm text-ink/60 mt-1">
            Status: <span className="font-medium">{video.status}</span>
            {video.status === "running" && ` · ${video.progress}%`}
            {video.error && <span className="text-signal"> · {video.error}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {isRunning ? (
            <button className="btn-danger" onClick={stop} disabled={busy}>Stop detection</button>
          ) : (
            <button className="btn-primary" onClick={start} disabled={busy || zones.length === 0}>
              Start detection
            </button>
          )}
        </div>
      </div>
      {error && <div className="text-sm text-signal mb-4">{error}</div>}

      <div className="grid grid-cols-2 gap-6 mb-8">
        <div>
          <h2 className="text-sm font-medium mb-2">Live feed</h2>
          {isRunning ? (
            <img src={`${DETECTOR_STREAM}/jobs/${video.jobId}/stream`} alt="Live annotated feed"
              className="w-full border border-line" />
          ) : (
            <div className="card aspect-video flex items-center justify-center text-sm text-ink/40">
              Feed appears once detection starts
            </div>
          )}
        </div>
        <div>
          <h2 className="text-sm font-medium mb-2">Draw a zone</h2>
          {!isRunning && frameUrl ? (
            <>
              <div className="flex gap-2 mb-2">
                <input className="field" placeholder="Zone name (e.g. Main gate)"
                  value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
                <select className="field w-40" value={draftType} onChange={(e) => setDraftType(e.target.value)}>
                  <option value="no_parking">No parking</option>
                  <option value="parking">Parking</option>
                </select>
              </div>
              <ZoneCanvas frameUrl={frameUrl} zones={zones} draftType={draftType} onComplete={saveZone} />
            </>
          ) : (
            <div className="card aspect-video flex items-center justify-center text-sm text-ink/40 text-center px-6">
              {isRunning ? "Stop detection to edit zones" : "Loading video frame…"}
            </div>
          )}
        </div>
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

function SessionTable({ title, rows }) {
  return (
    <div>
      <h2 className="text-sm font-medium mb-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink/50">Nothing here yet.</p>
      ) : (
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
              {rows.map((s) => (
                <tr key={s.sessionKey} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 mono">{s.plate || "—"}</td>
                  <td className="px-4 py-2">{s.vehicleType}</td>
                  <td className="px-4 py-2">{s.zoneName}</td>
                  <td className="px-4 py-2 mono">{fmtDuration(s.durationSeconds)}</td>
                  <td className="px-4 py-2">
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
      )}
    </div>
  );
}
