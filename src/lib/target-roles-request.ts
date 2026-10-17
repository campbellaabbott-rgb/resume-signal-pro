/**
 * THE ROLES AN ATS DEFENSE PURCHASE TARGETS, ASKED BEFORE CHECKOUT (S11-074;
 * owner decision 2026-10-11).
 *
 * ATS Defense sells "multi-role targeting (up to 3 roles)", and nothing ever
 * asked the buyer for a role: every delivery path sent none and the model
 * guessed. Every buy button reaches the checkout through purchaseProduct, so
 * the question is asked there: askForTargetRoles() opens the one dialog the
 * app mounts (TargetRolesDialog) and answers the roles, or null when the buyer
 * closes it (no checkout starts). With no dialog mounted it answers no roles
 * at once, so a page without one never hangs a purchase.
 */
import { useSyncExternalStore } from "react";

export const MAX_TARGET_ROLES = 3;
const MAX_ROLE_CHARS = 80;

type Request = { suggested: string[]; resolve: (roles: string[] | null) => void };
let request: Request | null = null;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

/** Up to three roles, trimmed, each at most 80 characters, no repeats or blanks. */
export function cleanTargetRoles(roles: ReadonlyArray<unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of roles) {
    if (typeof r !== "string") continue;
    const role = r.replace(/[\u0000-\u001f\u007f|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_ROLE_CHARS).trim();
    if (!role || seen.has(role.toLowerCase())) continue;
    seen.add(role.toLowerCase());
    out.push(role);
    if (out.length === MAX_TARGET_ROLES) break;
  }
  return out;
}

export function askForTargetRoles(suggested: ReadonlyArray<string> = []): Promise<string[] | null> {
  if (hosts === 0) return Promise.resolve(cleanTargetRoles(suggested));
  request?.resolve(null);
  return new Promise((resolve) => {
    request = { suggested: cleanTargetRoles(suggested), resolve };
    emit();
  });
}

/** Called by the dialog with the buyer's answer (null: closed without one). */
export function answerTargetRoles(roles: string[] | null): void {
  const r = request;
  request = null;
  emit();
  r?.resolve(roles === null ? null : cleanTargetRoles(roles));
}

/** The dialog's view of the open request; registers it as the host while mounted. */
export function useTargetRolesRequest(): { open: boolean; suggested: string[] } {
  const snap = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => request,
    () => request,
  );
  return { open: snap !== null, suggested: snap?.suggested ?? [] };
}

/** The dialog counts itself as mounted (so a request waits for it). */
export function registerTargetRolesHost(): () => void {
  hosts += 1;
  return () => {
    hosts -= 1;
    if (hosts === 0 && request) answerTargetRoles(null);
  };
}
