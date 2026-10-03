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
 * With the key set:
 *   - Cloudflare's script is loaded once, on first need; a widget renders into
 *     a fixed corner box that shows nothing unless Cloudflare asks for
 *     interaction; its token is exchanged for a pass by the board-pass action;
 *   - ONE DEADLINE covers the whole attempt -- loading the script, the check
 *     and the exchange -- so a stalled challenges.cloudflare.com holds the
 *     board for at most DEADLINE_MS, then the board is read without a pass.
 *     If Cloudflare asks the person to interact (never in Invisible mode, the
 *     mode the owner is told to create; possible in Managed mode) the widget
 *     stays up and the deadline becomes INTERACTIVE_DEADLINE_MS, so a person
 *     can actually complete it;
 *   - the pass is kept by THIS browser's clock: board-pass says how long it
 *     lives (ttlSeconds), and it is held in memory and sessionStorage until a
 *     minute before then. A visitor's clock can be any distance from ours, and
 *     an absolute expiry read against it once made a fresh pass look lapsed;
 *   - concurrent callers share one attempt; a failed attempt is not repeated
 *     for five minutes, and a refusal's fresh attempt is not repeated for five
 *     minutes either once one has failed;
 *   - a refusal names the pass it refused, so a later refusal of an OLD pass
 *     uses the newer one instead of throwing it away and solving again;
 *   - if job-board answers board_pass_unconfigured (the site key is in the page
 *     but TURNSTILE_SECRET_KEY is not on the function yet), the check is off
 *     for the rest of the tab's session -- nothing can be refused for lack of
 *     a pass then -- until a refusal with code "pass" proves it is on.
 */
import { supabase } from "@/integrations/supabase/client";

export const BOARD_PASS_HEADER = "x-rb-pass";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const STORAGE_KEY = "rb_board_pass";
const OFF_KEY = "rb_board_pass_off";
const BOX_ID = "rb-board-pass";
/** A pass is dropped this long before it expires, so a request never carries one that lapses in flight. */
const EARLY_MS = 60_000;
/** The whole attempt: script, check and exchange. Turnstile normally answers in about a second; past this the board is read without a pass. */
export const BOARD_PASS_DEADLINE_MS = 10_000;
/** Once Cloudflare asks the person to interact, they get this long, and the widget stays up. */
export const BOARD_PASS_INTERACTIVE_DEADLINE_MS = 120_000;
export const BOARD_PASS_FAIL_COOLDOWN_MS = 5 * 60_000;

/** expiresAt is on THIS browser's clock. */
type Held = { pass: string; expiresAt: number };
type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
  remove: (id: string) => void;
};
type Outcome = { pass: string; ttlMs: number } | "unconfigured";

let held: Held | null = null;
let inflight: Promise<string | null> | null = null;
/** Any failed attempt: an ordinary read waits this out. */
let failedAt = 0;
/** A failed attempt a refusal asked for: a refusal's fresh attempt waits this out too. */
let freshFailedAt = 0;
/** null = not read from sessionStorage yet. */
let offMemo: boolean | null = null;
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

function hold(h: Held): void {
  held = h;
  failedAt = 0;
  freshFailedAt = 0;
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(h)); } catch { /* memory still holds it */ }
}

/** The server has no secret: off for this tab's session (nothing can be refused for lack of a pass). */
function isOff(): boolean {
  if (offMemo === null) {
    try { offMemo = sessionStorage.getItem(OFF_KEY) === "1"; } catch { offMemo = false; }
  }
  return offMemo;
}

function setOff(on: boolean): void {
  offMemo = on;
  try { if (on) sessionStorage.setItem(OFF_KEY, "1"); else sessionStorage.removeItem(OFF_KEY); } catch { /* memory holds it */ }
}

/**
 * Drop the pass (a refusal said it no longer serves, or a request carrying it
 * never got an answer). Given a pass, only that one: a newer pass obtained
 * while the old request was in flight is kept.
 */
export function forgetBoardPass(which?: string | null): void {
  if (which && current()?.pass !== which) return;
  held = null;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked: memory is cleared */ }
}

/** The pass held right now, or null. Never fetches. */
export function heldBoardPass(): string | null {
  return boardPassEnabled() ? current()?.pass ?? null : null;
}

/** The header for a board call: the pass when one is held, else nothing. Never fetches. */
export function boardPassHeader(): Record<string, string> {
  const pass = heldBoardPass();
  return pass ? { [BOARD_PASS_HEADER]: pass } : {};
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

/** The answer is board_pass_unconfigured: the function has no Turnstile secret. */
async function unconfiguredAnswer(error: unknown): Promise<boolean> {
  const ctx = (error as { context?: unknown } | null | undefined)?.context as
    | { status?: unknown; clone?: () => { json: () => Promise<unknown> } }
    | undefined;
  if (!ctx || ctx.status !== 503 || typeof ctx.clone !== "function") return false;
  try {
    return ((await ctx.clone().json()) as { error?: unknown } | null)?.error === "board_pass_unconfigured";
  } catch {
    return false;
  }
}

type Hooks = { onInteractive: () => void; setCancel: (cancel: () => void) => void; abandoned: () => boolean };

async function attempt(siteKey: string, hooks: Hooks): Promise<Outcome> {
  const ts = await loadTurnstile();
  if (hooks.abandoned()) throw new Error("abandoned at the deadline");
  const token = await new Promise<string>((resolve, reject) => {
    let id: string | undefined;
    let over = false;
    const finish = (err: Error | null, t?: string) => {
      if (over) return;
      over = true;
      setTimeout(() => { try { if (id) ts.remove(id); } catch { /* already gone */ } }, 0);
      if (err) reject(err); else resolve(t as string);
    };
    hooks.setCancel(() => finish(new Error("turnstile deadline")));
    try {
      id = ts.render(box(), {
        sitekey: siteKey,
        action: "board",
        appearance: "interaction-only",
        "refresh-expired": "never",
        callback: (t: string) => finish(null, t),
        "error-callback": (code?: string) => { finish(new Error(`turnstile error ${code ?? ""}`)); return true; },
        "expired-callback": () => finish(new Error("turnstile token expired")),
        "timeout-callback": () => finish(new Error("turnstile timed out")),
        // Cloudflare wants a person to click: keep the widget and give them time.
        "before-interactive-callback": () => hooks.onInteractive(),
      }) ?? undefined;
    } catch (e) {
      finish(e instanceof Error ? e : new Error(String(e)));
    }
  });
  const { data, error } = await supabase.functions.invoke("job-board", { body: { action: "board-pass", token } });
  if (error) {
    if (await unconfiguredAnswer(error)) return "unconfigured";
    throw new Error("no pass");
  }
  const d = data as { pass?: unknown; expiresAt?: unknown; ttlSeconds?: unknown } | null;
  const ttlMs = typeof d?.ttlSeconds === "number" && d.ttlSeconds > 0
    ? d.ttlSeconds * 1000
    : typeof d?.expiresAt === "string" ? Date.parse(d.expiresAt) - Date.now() : NaN;
  if (typeof d?.pass !== "string" || !Number.isFinite(ttlMs)) throw new Error("no pass");
  return { pass: d.pass, ttlMs };
}

/** One attempt under one deadline. Resolves the pass, or null; never rejects. */
function obtain(siteKey: string, fresh: boolean): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel = () => {};
    const settle = (pass: string | null, failed: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cancel();
      if (failed) {
        failedAt = Date.now();
        if (fresh) freshFailedAt = failedAt;
      }
      resolve(pass);
    };
    const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => settle(null, true), ms); };
    arm(BOARD_PASS_DEADLINE_MS);
    attempt(siteKey, {
      onInteractive: () => { if (!done) arm(BOARD_PASS_INTERACTIVE_DEADLINE_MS); },
      setCancel: (c) => { cancel = c; },
      abandoned: () => done,
    }).then((out) => {
      if (out === "unconfigured") { setOff(true); settle(null, false); return; }
      const h = { pass: out.pass, expiresAt: Date.now() + out.ttlMs };
      if (!usable(h)) { settle(null, true); return; }
      hold(h); // even past the deadline: the reads behind this one can use it
      settle(h.pass, false);
    }, () => settle(null, true));
  });
}

/**
 * A pass, reusing the one held. Resolves null when the feature is off or the
 * check failed; never rejects, so a board call is never lost to the check.
 *
 * `fresh` is a refusal with code "pass" asking for a new one; `refused` is the
 * pass that refused call carried (null when it carried none). A pass held now
 * that is not the refused one is returned as it is -- another refusal already
 * replaced it. Otherwise a new attempt runs, past the ordinary cooldown, unless
 * the refused call carried no pass and a refusal's own attempt failed within
 * the cooldown (a broken check is not re-run for every refused call).
 */
export function ensureBoardPass({ fresh = false, refused = null }: { fresh?: boolean; refused?: string | null } = {}): Promise<string | null> {
  const siteKey = boardPassSiteKey();
  if (!siteKey) return Promise.resolve(null);
  const h = current();
  if (!fresh) {
    if (h) return Promise.resolve(h.pass);
    if (inflight) return inflight;
    if (isOff() || Date.now() - failedAt < BOARD_PASS_FAIL_COOLDOWN_MS) return Promise.resolve(null);
  } else {
    if (h && h.pass !== refused) return Promise.resolve(h.pass);
    if (inflight) return inflight;
    if (isOff()) setOff(false); // refused for lack of a pass: the server is configured after all
    else if (!h && refused === null && Date.now() - freshFailedAt < BOARD_PASS_FAIL_COOLDOWN_MS) return Promise.resolve(null);
    if (h) forgetBoardPass(h.pass);
  }
  inflight = obtain(siteKey, fresh).finally(() => { inflight = null; });
  return inflight;
}

/** For tests: forget the pass, the cooldowns, the off switch and any half-loaded script. */
export function resetBoardPassForTests(): void {
  held = null;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* jsdom always has it */ }
  inflight = null;
  failedAt = 0;
  freshFailedAt = 0;
  offMemo = null;
  scriptLoad = null;
}
