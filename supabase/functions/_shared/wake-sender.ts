// Ask whatever hosts the apply ... docs/shared-notes.md#s116
const TIMEOUT_MS = 4_000;

// What to POST. `WORKER_START_BODY` verbat ... docs/shared-notes.md#s117
function bodyFor(): string {
  const raw = (Deno.env.get("WORKER_START_BODY") ?? "").trim();
  if (raw) {
    try { JSON.parse(raw); return raw; } catch { /* fall through to default */ }
  }
  return JSON.stringify({ reason: "apply-agent: packets ready, no sender online" });
}

export type WakeResult =
  | { attempted: false; reason: "no-url" | "not-needed" }
  | { attempted: true; ok: boolean; status?: number; error?: string };

// @param needed Whether there is ... docs/shared-notes.md#s118
export async function wakeSender(needed: boolean): Promise<WakeResult> {
  if (!needed) return { attempted: false, reason: "not-needed" };

  const url = (Deno.env.get("WORKER_START_URL") ?? "").trim();
  if (!url) return { attempted: false, reason: "no-url" };

  const token = (Deno.env.get("WORKER_START_TOKEN") ?? "").trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Most start APIs (Fly, GitHub) ... docs/shared-notes.md#s119
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // The body the HOST needs, ... docs/shared-notes.md#s120
      body: bodyFor(),
      signal: ctrl.signal,
    });
    return { attempted: true, ok: resp.ok, status: resp.status };
  } catch (e) {
    return { attempted: true, ok: false, error: String(e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

// IS THE WAKE EVEN CONFIGURED ... docs/shared-notes.md#s121
export type WakeConfig = {
  url: boolean;
  token: boolean;
  /** `default` = no secret set, `json` = valid JSON supplied, `invalid` = set but unparseable. */
  body: "default" | "json" | "invalid";
};

export function wakeConfig(): WakeConfig {
  const raw = (Deno.env.get("WORKER_START_BODY") ?? "").trim();
  let body: WakeConfig["body"] = "default";
  if (raw) {
    try { JSON.parse(raw); body = "json"; } catch { body = "invalid"; }
  }
  return {
    url: (Deno.env.get("WORKER_START_URL") ?? "").trim() !== "",
    token: (Deno.env.get("WORKER_START_TOKEN") ?? "").trim() !== "",
    body,
  };
}
