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

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl">Videos</h1>
          <p className="text-sm text-ink/60 mt-1">
            Upload a recorded clip to use in place of a live camera feed.
          </p>
        </div>
        <label className="btn-primary cursor-pointer">
          {uploading ? "Uploading…" : "Upload video"}
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={onUpload} disabled={uploading} />
        </label>
      </div>

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
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-ink/[0.03]"
            >
              <div>
                <div className="text-sm font-medium">{v.originalName}</div>
                <div className="text-xs text-ink/50 mt-0.5">
                  {(v.sizeBytes / (1024 * 1024)).toFixed(1)} MB · {new Date(v.createdAt).toLocaleString()}
                </div>
              </div>
              <div className={`text-xs font-medium ${STATUS_STYLE[v.status] || ""}`}>
                {v.status}{v.status === "running" ? ` · ${v.progress}%` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
