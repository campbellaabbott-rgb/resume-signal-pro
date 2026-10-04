/**
 * THE OWNER'S KEY, COMPARED IN CONSTANT TIME.
 *
 * One comparison for every function an operator key opens (admin-ops,
 * check-alerts): an EMPTY secret never matches anything, an empty header
 * included, so an unset ADMIN_API_KEY locks the door instead of opening it,
 * and the comparison takes the same time however many leading characters of
 * a guess are right.
 */
export function keyMatches(presented: string, secret: string): boolean {
  if (!secret || !presented) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
