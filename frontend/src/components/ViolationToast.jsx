export default function ViolationToast({ violation, onClose }) {
  return (
    <div className="card border-signal shadow-lg animate-[fadeIn_.15s_ease-out]">
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
