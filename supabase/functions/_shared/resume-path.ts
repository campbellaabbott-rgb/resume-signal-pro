// The résumé file a mandate may point at: one inside its OWN account's folder.
//
// Sweep S8-080. apply-broker signed whatever path the mandate owner had written
// into resume_file_url with the service role, and agent_mandates' owner policy
// lets the owner write any text there. '<another-user-uuid>/resume.pdf' would
// then go out, signed, with the owner's applications. The uploader writes
// '<userId>/<file>' (ApplyProfilePanel), so anything else is refused here and
// by the trigger in 20261009120000.

/** The path if its first segment is this account's id and nothing climbs out; else null. */
export function ownResumePath(path: unknown, userId: unknown): string | null {
  const p = String(path ?? "").trim();
  const u = String(userId ?? "").trim().toLowerCase();
  if (!p || !u) return null;
  const segs = p.split("/");
  if (segs.length < 2 || segs[0]!.toLowerCase() !== u) return null;
  if (segs.some((s) => s === "" || s === "." || s === "..")) return null;
  return p;
}
