


















const TIMEOUT_MS = 4_000;










function bodyFor(): string {
  const raw = (Deno.env.get("WORKER_START_BODY") ?? "").trim();
  if (raw) {
    try { JSON.parse(raw); return raw; } catch {  }
  }
  return JSON.stringify({ reason: "apply-agent: packets ready, no sender online" });
}

export type WakeResult =
  | { attempted: false; reason: "no-url" | "not-needed" }
  | { attempted: true; ok: boolean; status?: number; error?: string };






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
        
        
        
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      
      
      
      
      
      
      
      
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






















export type WakeConfig = {
  url: boolean;
  token: boolean;
  
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
