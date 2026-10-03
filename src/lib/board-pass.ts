/**
 * THE BOARD PASS, AS THE BROWSER HOLDS IT.
 *
 * A scraper on a rotating proxy pool walks past any per-address cap, so the
 * board can ask a browser to finish a Cloudflare Turnstile check and carry the
 * half-hour pass job-board signs for it (supabase/functions/job-board/
 * board-pass.ts; docs/job-board-deploy-notes.md, 2026-09-09.87).
 *
 * INERT WITHOUT VITE_TURNSTILE_SITE_KEY. With the key unset nothing here runs:
 * no script is loaded, no widget is rendered, no header is ever sent, and
 * invokeJobBoard is exactly supabase.functions.invoke("job-board", ...).
 *
 * With the key set: Cloudflare's script is loaded once, on first need; a
 * widget renders into a fixed corner box that shows nothing unless Cloudflare
 * asks for interaction (the owner creates the widget in Invisible mode, so in
 * practice it never does); its token is exchanged for a pass by the board-pass
 * action; the pass is held in memory and sessionStorage until a minute before
 * it expires; concurrent callers share one exchange; and a failed attempt is
 * not repeated for five minutes unless a refusal asks for a fresh pass.
 */
import { supabase } from "@/integrations/supabase/client";

export const BOARD_PASS_HEADER = "x-rb-pass";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const STORAGE_KEY = "rb_board_pass";
const BOX_ID = "rb-board-pass";
/** A pass is dropped this long before it expires, so a request never carries one that lapses in flight. */
const EARLY_MS = 60_000;
/** Turnstile normally answers in about a second; past this the board is read without a pass. */
const TOKEN_DEADLINE_MS = 10_000;
const FAIL_COOLDOWN_MS = 5 * 60_000;

type Held = { pass: string; expiresAt: number };
type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
  remove: (id: string) => void;
};

let held: Held | null = null;
let inflight: Promise<string | null> | null = null;
let failedAt = 0;
let scriptLoad: Promise<TurnstileApi> | null = null;

/** The public site key, or "" when the feature is off. Read on every call so a test can stub it. */
export function boardPassSiteKey(): string {
  return String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim();
}

export function boardPassEnabled(): boolean {
  return boardPassSiteKey() !== "";
}

const usable = (h: Held | null): h is Held => !!h && h.expiresAt - EARLY_MS > Date.now();

function stored(): Held | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const h = raw ? (JSON.parse(raw) as Partial<Held>) : null;
    return h && typeof h.pass === "string" && typeof h.expiresAt === "number" ? { pass: h.pass, expiresAt: h.expiresAt } : null;
  } catch {
    return null;
  }
}

function current(): Held | null {
  if (!usable(held)) held = stored();
  return usable(held) ? held : null;
}

/** Drop the pass (a refusal said it no longer serves, or a request carrying it never got an answer). */
export function forgetBoardPass(): void {
  held = null;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked: memory is cleared */ }
}

/** The header for a board call: the pass when one is held, else nothing. Never fetches. */
export function boardPassHeader(): Record<string, string> {
  if (!boardPassEnabled()) return {};
  const h = current();
  return h ? { [BOARD_PASS_HEADER]: h.pass } : {};
}

function loadTurnstile(): Promise<TurnstileApi> {
  const w = window as unknown as { turnstile?: TurnstileApi };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  scriptLoad ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error("turnstile did not load")));
    s.onerror = () => reject(new Error("turnstile script failed"));
    document.head.appendChild(s);
  }).catch((e) => { scriptLoad = null; throw e; });
  return scriptLoad;
}

function box(): HTMLElement {
  let el = document.getElementById(BOX_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = BOX_ID;
    el.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000";
    document.body.appendChild(el);
  }
  return el;
}

async function turnstileToken(siteKey: string): Promise<string> {
  const ts = await loadTurnstile();
  return new Promise<string>((resolve, reject) => {
    let id: string | undefined;
    let settled = false;
    const finish = (err: Error | null, token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setTimeout(() => { try { if (id) ts.remove(id); } catch { /* already gone */ } }, 0);
      if (err) reject(err); else resolve(token as string);
    };
    const timer = setTimeout(() => finish(new Error("turnstile deadline")), TOKEN_DEADLINE_MS);
    try {
      id = ts.render(box(), {
        sitekey: siteKey,
        action: "board",
        appearance: "interaction-only",
        "refresh-expired": "never",
        callback: (token: string) => finish(null, token),
        "error-callback": (code?: string) => { finish(new Error(`turnstile error ${code ?? ""}`)); return true; },
        "expired-callback": () => finish(new Error("turnstile token expired")),
        "timeout-callback": () => finish(new Error("turnstile timed out")),
      });
    } catch (e) {
      finish(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

async function obtain(siteKey: string): Promise<string | null> {
  try {
    const token = await turnstileToken(siteKey);
    const { data, error } = await supabase.functions.invoke("job-board", { body: { action: "board-pass", token } });
    const d = data as { pass?: unknown; expiresAt?: unknown } | null;
    const expiresAt = typeof d?.expiresAt === "string" ? Date.parse(d.expiresAt) : NaN;
    if (error || typeof d?.pass !== "string" || !Number.isFinite(expiresAt)) throw new Error("no pass");
    held = { pass: d.pass, expiresAt };
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(held)); } catch { /* memory still holds it */ }
    failedAt = 0;
    return d.pass;
  } catch {
    failedAt = Date.now();
    return null;
  }
}

/**
 * A pass, reusing the one held. Resolves null when the feature is off or the
 * check failed; never rejects, so a board call is never lost to the check.
 * `fresh` asks for a new one whatever is held (a pass refusal), past the
 * failure cooldown.
 */
export function ensureBoardPass({ fresh = false }: { fresh?: boolean } = {}): Promise<string | null> {
  const siteKey = boardPassSiteKey();
  if (!siteKey) return Promise.resolve(null);
  if (fresh) forgetBoardPass();
  else {
    const h = current();
    if (h) return Promise.resolve(h.pass);
    if (!inflight && Date.now() - failedAt < FAIL_COOLDOWN_MS) return Promise.resolve(null);
  }
  inflight ??= obtain(siteKey).finally(() => { inflight = null; });
  return inflight;
}

/** For tests: forget the pass, the cooldown and any half-loaded script. */
export function resetBoardPassForTests(): void {
  forgetBoardPass();
  inflight = null;
  failedAt = 0;
  scriptLoad = null;
}
