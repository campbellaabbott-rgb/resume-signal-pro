// ⌘K command palette + "?" shortcuts overlay for the job board.
// Self-contained: no external command lib — a filterable action list with
// full keyboard support (arrows/enter/escape), rendered as a modal.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Search, Command } from "lucide-react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function JobsCommandPalette({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useReturnFocus(open);
  const filtered = useMemo(
    () => actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase())),
    [actions, q],
  );
  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh] bg-black/50" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("jobsPage.paletteTitle", "Quick actions")}
      // THE PALETTE KEEPS THE KEYBOARD (NB-26): Tab stays in its box, which
      // is the search field (the arrows choose the action).
      onKeyDown={(e) => { if (e.key === "Tab") { e.preventDefault(); inputRef.current?.focus(); } }}
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter" && filtered[idx]) { e.preventDefault(); filtered[idx].run(); onClose(); }
              else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
            }}
            placeholder={t("jobsPage.paletteHint", "Type a command or filter…")}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            aria-label={t("jobsPage.paletteTitle", "Quick actions")}
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">esc</kbd>
        </div>
        <ul className="max-h-72 overflow-auto py-1" role="listbox">
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">{t("jobsPage.paletteEmpty", "No matching action")}</li>
          )}
          {filtered.map((a, i) => (
            <li key={a.id} role="option" aria-selected={i === idx}>
              <button
                type="button"
                className={`w-full flex items-center justify-between text-left px-4 py-2.5 text-sm ${i === idx ? "bg-muted" : "hover:bg-muted/60"}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => { a.run(); onClose(); }}
              >
                <span>{a.label}</span>
                {a.hint && <span className="text-[11px] text-muted-foreground">{a.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Where focus was when a layer opened, given back when it closes (NB-26), so
 * a keyboard reader lands where they were rather than at the top of the page.
 */
function useReturnFocus(open: boolean) {
  const before = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    before.current = document.activeElement as HTMLElement | null;
    return () => {
      const el = before.current;
      before.current = null;
      if (el && typeof el.focus === "function" && document.contains(el)) el.focus();
    };
  }, [open]);
  return before;
}

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  useReturnFocus(open);
  // THE CARD OWNS THE KEYBOARD WHILE IT IS OPEN (NB-26). It took no focus
  // and read no key, so Escape closed the posting behind it and Enter opened
  // that posting's apply page and marked it Applied.
  useEffect(() => {
    if (open) boxRef.current?.focus();
  }, [open]);
  if (!open) return null;
  const rows: Array<[string, string]> = [
    ["↑ / ↓  ·  j / k", t("jobsPage.scNavigate", "Move through postings")],
    ["Enter", t("jobsPage.scApply", "Apply to the open posting")],
    ["Esc", t("jobsPage.scClose", "Close the posting panel")],
    ["/", t("jobsPage.scSearch", "Focus the search box")],
    ["⌘K / Ctrl+K", t("jobsPage.scPalette", "Open quick actions")],
    ["?", t("jobsPage.scHelp", "Show or hide this help")],
  ];
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("jobsPage.scTitle", "Keyboard shortcuts")}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onClose(); }
        else if (e.key === "Tab") { e.preventDefault(); boxRef.current?.focus(); }
      }}
    >
      <div ref={boxRef} tabIndex={-1} data-shortcuts-card="" className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl p-5 focus:outline-none" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Command className="w-4 h-4" />
          {t("jobsPage.scTitle", "Keyboard shortcuts")}
        </h2>
        <ul className="space-y-2">
          {rows.map(([keys, label]) => (
            <li key={keys} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{label}</span>
              <kbd className="text-[11px] px-2 py-0.5 rounded border border-border whitespace-nowrap">{keys}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Convenience hook so Jobs.tsx wires one line per binding.
export function useGlobalPaletteKeys(opts: {
  onPalette: () => void;
  onHelp: () => void;
  onSlash: () => void;
}) {
  const { onPalette, onHelp, onSlash } = opts;
  const nav = useNavigate();
  void nav; // reserved for nav actions supplied by the caller
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); onPalette(); return; }
      if (typing) return;
      if (e.key === "/") { e.preventDefault(); onSlash(); }
      else if (e.key === "?") { e.preventDefault(); onHelp(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPalette, onHelp, onSlash]);
}
