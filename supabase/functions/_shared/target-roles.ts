/**
 * THE ROLES AN ATS DEFENSE BUYER NAMES AT CHECKOUT (S11-074; owner decision
 * 2026-10-11).
 *
 * ATS Defense ($15) sold "multi-role targeting (up to 3 roles)", but no
 * purchase or delivery path collected them: the webhook, the success page's
 * verifier, the retry sweep and the page itself all sent targetRoles: [], so
 * the model guessed the primary and secondary roles. The buy button now asks
 * for up to three roles; create-product-checkout writes them to the Stripe
 * session's metadata (target_roles) or the Pro grant, and every deliverer
 * reads them back through targetRolesOf.
 *
 * NO IMPORTS: vitest imports this file directly.
 */

export const MAX_TARGET_ROLES = 3;
const MAX_ROLE_CHARS = 80;
/** How the roles are joined in Stripe metadata (a value of at most 500 characters). */
export const TARGET_ROLES_SEPARATOR = " | ";

/**
 * Up to three roles from a body array or a metadata string: trimmed, control
 * characters and the separator removed, each at most 80 characters, without
 * repeats (case-insensitive) or blanks.
 */
export function targetRolesOf(v: unknown): string[] {
  const raw: unknown[] = Array.isArray(v)
    ? v
    : typeof v === "string" ? v.split("|") : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const role = item.replace(/[\u0000-\u001f\u007f|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_ROLE_CHARS).trim();
    if (!role || seen.has(role.toLowerCase())) continue;
    seen.add(role.toLowerCase());
    out.push(role);
    if (out.length === MAX_TARGET_ROLES) break;
  }
  return out;
}

/** The metadata value for these roles, or null when there are none. */
export function targetRolesMetadata(v: unknown): string | null {
  const roles = targetRolesOf(v);
  return roles.length ? roles.join(TARGET_ROLES_SEPARATOR) : null;
}
