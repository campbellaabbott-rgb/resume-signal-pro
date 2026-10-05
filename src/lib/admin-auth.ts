import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

// Shared admin-key storage for internal dashboards (analytics, errors, etc).
// The key itself is the ADMIN_API_KEY secret configured on the Supabase project's
// edge functions — there's no way for the frontend to know it on its own, so the
// operator pastes it in once per browser session via AdminAuthGate below.

const ADMIN_KEY_SESSION_STORAGE_KEY = "admin_dashboard_key";

export function getStoredAdminKey(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_KEY_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAdminKey(key: string): void {
  try {
    sessionStorage.setItem(ADMIN_KEY_SESSION_STORAGE_KEY, key);
  } catch {
    // sessionStorage disabled — the key just won't persist across reloads.
  }
}

export function clearStoredAdminKey(): void {
  try {
    sessionStorage.removeItem(ADMIN_KEY_SESSION_STORAGE_KEY);
  } catch {
    // no-op
  }
}

// Convenience header object to spread into supabase.functions.invoke(...) calls
// that require the admin key (get-analytics, check-error-spikes, etc).
export function adminAuthHeaders(): Record<string, string> {
  const key = getStoredAdminKey();
  return key ? { "x-admin-key": key } : {};
}

type Fns = Database["public"]["Functions"];

/**
 * Call one of the operations readers through the admin-ops edge function.
 *
 * These readers used to be called with supabase.rpc straight from the
 * dashboards, which meant anyone with the publishable key could call them too
 * -- and several returned customer emails, Stripe ids and visitor ids.
 * Migration 20261004110000 closed them to anon and authenticated; admin-ops
 * checks the stored admin key and calls them with the service role. Same
 * `{ data, error }` shape as supabase.rpc, so a panel's error handling is
 * unchanged: without the key (or with a wrong one) every panel reads an error,
 * never another visitor's data.
 */
export async function adminRpc<K extends keyof Fns & string>(
  fn: K,
  args?: Fns[K]["Args"],
): Promise<{ data: Fns[K]["Returns"] | null; error: { message: string } | null }> {
  const { data, error } = await supabase.functions.invoke("admin-ops", {
    body: { fn, args: args ?? {} },
    headers: adminAuthHeaders(),
  });
  if (error) return { data: null, error: { message: error.message } };
  const payload = (data ?? {}) as { data?: Fns[K]["Returns"]; error?: string };
  if (payload.error) return { data: null, error: { message: String(payload.error) } };
  return { data: payload.data ?? null, error: null };
}
