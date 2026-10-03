import { useEffect, useRef } from "react";

const AUTO_DISMISS_MS = 7000;

export default function ViolationToast({ violation, onClose }) {
  // A real popup disappears on its own - without this, violations during a busy
  // stretch would just stack up forever and eat the corner of the screen. The
  // full record always stays on the Violations page either way.
  const timer = useRef(null);
  useEffect(() => {
    timer.current = setTimeout(onClose, AUTO_DISMISS_MS);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pause = () => clearTimeout(timer.current);
  const resume = () => { timer.current = setTimeout(onClose, AUTO_DISMISS_MS); };

  return (
    <div
      onMouseEnter={pause}
      onMouseLeave={resume}
      className="card border-signal shadow-lg animate-[fadeIn_.15s_ease-out]"
    >
      <div className="flex items-start justify-between gap-2 px-4 py-3 bg-signal text-paper">
        <div className="text-sm font-medium">Illegal parking detected</div>
        <button onClick={onClose} aria-label="Dismiss" className="text-paper/80 hover:text-paper">
          ✕
        </button>
      </div>
      <div className="px-4 py-3 text-sm space-y-1">
        <div className="mono text-base">{violation.plate || "Plate not read"}</div>
        <div className="text-ink/70">{violation.zoneName} · {violation.vehicleType}</div>
        <div className="text-ink/70">Parked {Math.round(violation.durationSeconds)}s</div>
        {violation.fine && <div className="text-signal font-medium">Fine issued: ₹{violation.fine.amount}</div>}
      </div>
    </div>
  );
}
