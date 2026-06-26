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
