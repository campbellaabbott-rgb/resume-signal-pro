/**
 * TEXT A STRANGER WROTE, MADE INERT FOR THE OWNER'S INBOX.
 *
 * error_telemetry is written by the browser through log_error_telemetry, which
 * anyone holding the publishable key can call. check-error-spikes mails the
 * newest rows to ADMIN_EMAIL, so without this an anonymous caller could put a
 * clickable phishing link -- or a convincing fake instruction -- into the
 * owner's own alert email. Migration 20261004110000 bounds how many rows a
 * caller can write; this makes what they write unclickable: control
 * characters become spaces, a URL scheme loses its colon, every dot between
 * word characters is bracketed (so neither `evil.example/x` nor
 * `www.evil.example` autolinks) and `@` becomes `[at]` (no mailto). Capped.
 */
export function defang(raw: unknown, max = 300): string {
  const s = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, max);
  return s
    // Any scheme written with `//`, and the ones that open something without it.
    .replace(/\b([a-z][a-z0-9+.-]*):\/\//gi, "$1[:]//")
    .replace(/\b(mailto|javascript|data|tel|sms|file):/gi, "$1[:]")
    .replace(/(\w)\.(?=\w)/g, "$1[.]")
    .replace(/@/g, "[at]");
}
