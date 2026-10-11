import { useEffect } from "react";

// Lightbox: closes on the X button, a click outside the image, or Escape.
export default function ImageModal({ src, alt, onClose }) {
  // Hook must run on every render (before the early return below).
  useEffect(() => {
    if (!src) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
    >
      <button
        onClick={onClose}
        aria-label="Close image"
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center bg-paper text-ink text-xl hover:bg-white"
      >
        ✕
      </button>
      <img
        src={src}
        alt={alt || "Full size photo"}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-[90vh] object-contain"
      />
    </div>
  );
}
