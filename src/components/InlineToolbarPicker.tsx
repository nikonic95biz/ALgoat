import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type InlinePickerItem = { value: string; label: string };

type Group = { heading: string; items: InlinePickerItem[] };

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  items?: InlinePickerItem[];
  groups?: Group[];
  /** When set, shown instead of resolving `value` from items/groups (e.g. hidden engine ID). */
  displayValue?: string;
  placeholder?: string;
  "aria-label"?: string;
};

function labelFor(
  value: string,
  items: InlinePickerItem[] | undefined,
  groups: Group[] | undefined,
  placeholder: string,
): string {
  if (items) {
    const hit = items.find((x) => x.value === value);
    if (hit) return hit.label;
  }
  if (groups) {
    for (const g of groups) {
      const hit = g.items.find((x) => x.value === value);
      if (hit) return hit.label;
    }
  }
  return placeholder;
}

export function InlineToolbarPicker({
  id,
  value,
  onChange,
  items,
  groups,
  displayValue,
  placeholder = "Choose…",
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const display = displayValue ?? labelFor(value, items, groups, placeholder);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div
      ref={rootRef}
      id={id}
      className="unt-inline-picker min-w-0 w-full"
      data-open={open ? "true" : "false"}
    >
      <button
        type="button"
        id={id + "-trigger"}
        className="unt-inline-picker-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        title={display}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={
            "min-w-0 flex-1 truncate text-left font-[family-name:var(--font-mono)] text-[11px] " +
            (value === "" ? "text-[var(--color-fg-dim)]" : "")
          }
        >
          {display}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-[var(--color-fg-muted)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="unt-inline-picker-list" role="listbox" aria-labelledby={id + "-trigger"}>
          {items
            ? items.map((opt) => (
                <button
                  key={opt.value === "" ? "placeholder" : opt.value}
                  type="button"
                  role="option"
                  aria-selected={value === opt.value}
                  data-active={value === opt.value ? "true" : "false"}
                  className="unt-inline-picker-option"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  title={opt.label}
                >
                  {opt.label}
                </button>
              ))
            : null}
          {groups
            ? groups.map((g) => (
                <div key={g.heading}>
                  <div className="unt-inline-picker-group-label">{g.heading}</div>
                  {g.items.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={value === opt.value}
                      data-active={value === opt.value ? "true" : "false"}
                      className="unt-inline-picker-option"
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      title={opt.label}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
