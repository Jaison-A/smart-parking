import { useEffect, useRef, useState } from "react";

// Bright, saturated tones so zones stand out on asphalt, cars and shadows.
const COLORS = { parking: "#22E05A", no_parking: "#FF3D1F", bay: "#1EA7FF" };

/**
 * Click to drop points on the still frame; click near the first point (or
 * double-click) to close the polygon. `zones` are drawn read-only underneath
 * so the user can see what's already there while adding a new one.
 */
export default function ZoneCanvas({ frameUrl, zones, draftType, onComplete }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => { setPoints([]); }, [draftType]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imgRef.current = img; setImgLoaded(true); draw(); };
    img.src = frameUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameUrl]);

  useEffect(draw); // redraw whenever points/zones change

  function draw() {
    const canvas = canvasRef.current, img = imgRef.current;
    if (!canvas || !img) return;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    for (const z of zones) drawPolygon(ctx, z.points.map((p) => [p.x * img.width, p.y * img.height]),
      COLORS[z.type], true, z.name);

    if (points.length) drawPolygon(ctx, points, COLORS[draftType], false);
  }

  function drawPolygon(ctx, pts, color, closed, label) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    if (closed) ctx.closePath();
    // Dark under-stroke first, then the bright line on top, so the edge reads on any background.
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    if (closed) {
      ctx.fillStyle = color + "2E"; // ~18% fill - bright outline, light tint so cars stay visible
      ctx.fill();
    }
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (label) {
      ctx.font = "bold 14px Inter, sans-serif";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(label, pts[0][0] + 6, pts[0][1] - 6);
      ctx.fillStyle = color;
      ctx.fillText(label, pts[0][0] + 6, pts[0][1] - 6);
    }
  }

  function handleClick(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    if (points.length >= 3 && Math.hypot(x - points[0][0], y - points[0][1]) < 12) {
      return finish();
    }
    setPoints((p) => [...p, [x, y]]);
  }

  function finish() {
    if (points.length < 3 || !imgRef.current) return;
    const { width, height } = imgRef.current;
    onComplete(points.map(([x, y]) => ({ x: x / width, y: y / height })));
    setPoints([]);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onDoubleClick={finish}
        className="w-full border border-line cursor-crosshair"
      />
      <div className="flex items-center justify-between mt-2 text-xs text-ink/60">
        <span>
          {!imgLoaded ? "Loading frame…" : points.length === 0
            ? "Click to start drawing a zone."
            : `${points.length} point${points.length > 1 ? "s" : ""} — click near the first point to close.`}
        </span>
        {points.length > 0 && (
          <button className="underline underline-offset-2" onClick={() => setPoints([])}>Clear</button>
        )}
      </div>
    </div>
  );
}
