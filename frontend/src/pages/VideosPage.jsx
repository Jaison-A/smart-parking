import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api.js";

const STATUS_STYLE = {
  uploaded: "text-ink/50", queued: "text-amber", running: "text-amber",
  completed: "text-ok", failed: "text-signal", stopped: "text-ink/50",
};

export default function VideosPage() {
  const [videos, setVideos] = useState(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showCameraForm, setShowCameraForm] = useState(false);
  const [camera, setCamera] = useState({ name: "", streamUrl: "" });
  const fileRef = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.get("/api/videos").then((r) => setVideos(r.data.videos)).catch((e) => setError(apiErrorMessage(e)));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000); // picks up progress/status without sockets on this page
    return () => clearInterval(id);
  }, [load]);

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("video", file);
      const { data } = await api.post("/api/videos", fd, { headers: { "Content-Type": "multipart/form-data" } });
      navigate(`/videos/${data.video._id}`);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const connectCamera = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const { data } = await api.post("/api/videos/live", camera);
      navigate(`/videos/${data.video._id}`);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl">Videos</h1>
          <p className="text-sm text-ink/60 mt-1">
            Upload a recorded clip, or connect a live camera.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-outline flex-1 sm:flex-none" onClick={() => setShowCameraForm((v) => !v)}>
            Connect camera
          </button>
          <label className="btn-primary cursor-pointer flex-1 sm:flex-none text-center">
            {uploading ? "Uploading…" : "Upload video"}
            <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={onUpload} disabled={uploading} />
          </label>
        </div>
      </div>

      {showCameraForm && (
        <form onSubmit={connectCamera} className="card p-4 mb-6 flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <label className="text-xs text-ink/60">Camera name</label>
            <input className="field mt-1" placeholder="e.g. Main gate CCTV"
              value={camera.name} onChange={(e) => setCamera((c) => ({ ...c, name: e.target.value }))} required />
          </div>
          <div className="flex-1">
            <label className="text-xs text-ink/60">Stream URL or webcam index</label>
            <input className="field mt-1" placeholder="rtsp://... or 0"
              value={camera.streamUrl} onChange={(e) => setCamera((c) => ({ ...c, streamUrl: e.target.value }))} required />
          </div>
          <button className="btn-primary">Connect</button>
        </form>
      )}

      {error && <div className="text-sm text-signal mb-4">{error}</div>}

      {videos === null ? (
        <div className="text-sm text-ink/50">Loading…</div>
      ) : videos.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink/50">
          No videos yet — upload one to get started.
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {videos.map((v) => (
            <button
              key={v._id}
              onClick={() => navigate(`/videos/${v._id}`)}
              className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-5 py-4 text-left hover:bg-ink/[0.03]"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {v.originalName}
                  {v.sourceType === "stream" && (
                    <span className="ml-2 text-xs border border-ink/30 px-1.5 py-0.5">LIVE</span>
                  )}
                </div>
                <div className="text-xs text-ink/50 mt-0.5 truncate">
                  {v.sourceType === "stream"
                    ? v.streamUrl
                    : `${(v.sizeBytes / (1024 * 1024)).toFixed(1)} MB`} · {new Date(v.createdAt).toLocaleString()}
                </div>
              </div>
              <div className={`text-xs font-medium shrink-0 ${STATUS_STYLE[v.status] || ""}`}>
                {v.status}{v.status === "running" ? ` · ${v.progress}%` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
