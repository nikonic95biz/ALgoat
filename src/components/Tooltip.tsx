import { useRef, useState, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Side = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  text: ReactNode;
  children: ReactNode;
  side?: Side;
  /** Delay in ms before showing. Default 400. */
  delay?: number;
  className?: string;
}

/**
 * Lightweight tooltip — portal-rendered so it never gets clipped by overflow:hidden parents.
 * Usage: <Tooltip text="Explain me"><button>...</button></Tooltip>
 */
export function Tooltip({ text, children, side = "top", delay = 400, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    timerRef.current = setTimeout(() => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const GAP = 8;
      let top = 0, left = 0;
      if (side === "top")    { top = r.top - GAP;      left = r.left + r.width / 2; }
      if (side === "bottom") { top = r.bottom + GAP;   left = r.left + r.width / 2; }
      if (side === "left")   { top = r.top + r.height / 2; left = r.left - GAP; }
      if (side === "right")  { top = r.top + r.height / 2; left = r.right + GAP; }
      setPos({ top, left });
      setVisible(true);
    }, delay);
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const transformMap: Record<Side, string> = {
    top:    "translate(-50%, -100%)",
    bottom: "translate(-50%, 0%)",
    left:   "translate(-100%, -50%)",
    right:  "translate(0%, -50%)",
  };

  return (
    <>
      <span
        ref={anchorRef}
        className={`inline-flex items-center ${className ?? ""}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>

      {visible && createPortal(
        <div
          role="tooltip"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            transform: transformMap[side],
            zIndex: 9999,
            pointerEvents: "none",
          }}
          className="max-w-[220px] rounded-lg border border-white/10 bg-[color-mix(in_srgb,var(--color-bg-editor)_92%,#2EA8FF_3%)] px-2.5 py-1.5 text-[10.5px] leading-snug text-[var(--color-fg-dim)] shadow-[0_8px_32px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm"
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
